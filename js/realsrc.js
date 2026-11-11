/* realsrc.js — 真数据源双端同步（WOLF-X + P2PQuake）
 *
 * 目标：WOLF-X 与 P2P 两端同时拉取同一条地震信息，跨端去重后合成一条，
 *      两端字段互补（WOLF-X 有 Hypocenter/MaxIntensity，P2P 有 areas[].arrivalTime）。
 *
 * 与既有层的关系：
 *   · js/ws.js        = WOLF-X WebSocket 推送（低延迟，但握手不稳）
 *   · js/p2pquake.js  = P2P WSS 推送（同上）
 *   · js/data.js      = 多源轮询 + mergeList 跨源分组（60 秒一轮，源很多）
 *   · 本文件          = 【只盯 WOLF-X + P2P 两端】的高频轮询（2 秒），
 *                      专门负责「同一条地震两端各来一份」的去重合并。
 *
 * 为什么不用 data.js 的 refresh()：
 *   refresh() 会把 USGS / GDACS / EMSC / JMA list / 海啸 等十来个源一起拉，
 *   2 秒一轮会把这些源打爆（GDACS 实测单次就 33 秒）。本文件只拉 4 个端点。
 *
 * 端点（实测 2026-10-31 均可用）：
 *   WOLF-X  https://api.wolfx.jp/jma_eqlist.json   震源列表（近 100 条）
 *            https://api.wolfx.jp/jma_eew.json      最新 EEW（单条）
 *   P2P      https://api.p2pquake.net/v2/history?codes=556&limit=20   EEW
 *            https://api.p2pquake.net/v2/history?codes=551&limit=100  震源列表
 *
 * 去重判据（跨端）：
 *   1) JMA 14 位事件 ID 两端都有且不同 → 一定不是同一场
 *   2) 发震时刻差 ≤ 10 分钟
 *   3) 震中相距 ≤ 2°
 *   4) 震级差 ≤ 1.5
 *   5) 核心地名一致或互相包含
 *   命中即合并：同一 id 的后续报文（Serial 递增）是同一条速报的更新，就地覆盖；
 *   两端同一场地震 → 合成一条，字段取「有值的优先」。
 *
 * 用法：
 *   QVRealSrc.on(function (ev, q) { ... });  // ev: 'quake' | 'status'
 *   QVRealSrc.start();  QVRealSrc.stop();  QVRealSrc.status();
 */
(function (global) {
  'use strict';

  var POLL_MS = 2000;          /* ★ 用户要求：每 2 秒拉一次 */
  var TIMEOUT = 9000;          /* 单个请求超时（略大于轮询间隔，允许重叠一轮） */
  var WOLF_EQ = 'https://api.wolfx.jp/jma_eqlist.json';
  var WOLF_EEW = 'https://api.wolfx.jp/jma_eew.json';
  var P2P_EEW = 'https://api.p2pquake.net/v2/history?codes=556&limit=20';
  var P2P_EQ = 'https://api.p2pquake.net/v2/history?codes=551&limit=100';

  /* JMA scale 码 → 项目内部编码（与 data.js / p2pquake.js 一致）
     ⚠ 只用于【P2P】：P2P 的 scaleFrom/scaleTo 是 JMA scale 码（10/20/…/45/50/55/60/65/70）。 */
  var SCALE = { 0: -1, 10: 1, 20: 2, 30: 3, 40: 4, 45: 50, 50: 55, 55: 60, 60: 65, 70: 70 };
  /* WOLF-X 的 MaxIntensity 是【震度数字】不是 scale 码：
     "1".."4" = 震度1~4，"5-" = 5弱，"5+" = 5強，"6-" = 6弱，"6+" = 6強，"7" = 震度7。
     ⚠ 早先误用 SCALE 表解析它 → "1" 查不到 → 恒为 -1（震度全丢）。 */
  function shindoOf(v) {
    if (v == null || v === '') return -1;
    var t = String(v).trim();
    if (!t || /不明|未知/.test(t)) return -1;
    if (/5\s*[-−ー–—]?\s*弱/.test(t)) return 50;
    if (/5\s*[+＋]?\s*[強强]/.test(t)) return 55;
    if (/6\s*[-−ー–—]?\s*弱/.test(t)) return 60;
    if (/6\s*[+＋]?\s*[強强]/.test(t)) return 65;
    if (/^!?\s*5\s*[-−ー–—]$/.test(t)) return 50;
    if (/^!?\s*5\s*[+＋]$/.test(t)) return 55;
    if (/^!?\s*6\s*[-−ー–—]$/.test(t)) return 60;
    if (/^!?\s*6\s*[+＋]$/.test(t)) return 65;
    var n = parseFloat(t);
    if (!isFinite(n)) return -1;
    if (n >= 70) return 70;
    if (n >= 45) return Math.max(50, Math.round(n / 5) * 5);
    if (n >= 0 && n <= 7) { var r = Math.round(n); return r === 7 ? 70 : r; }
    return -1;
  }

  var S = {
    on: false, timer: null, inflight: false, round: 0,
    lastAt: 0, lastErr: '', counts: { wolfEq: 0, wolfEew: 0, p2pEew: 0, p2pEq: 0 },
    health: {}, merged: 0, emitted: 0
  };
  var listeners = [];

  function emit(ev, data) {
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](ev, data); } catch (e) { } }
  }
  function snapshot() {
    return {
      on: S.on, round: S.round, lastAt: S.lastAt, lastErr: S.lastErr,
      counts: { wolfEq: S.counts.wolfEq, wolfEew: S.counts.wolfEew, p2pEew: S.counts.p2pEew, p2pEq: S.counts.p2pEq },
      merged: S.merged, emitted: S.emitted, health: S.health
    };
  }
  function pick(o) {
    for (var i = 1; i < arguments.length; i++) {
      var k = arguments[i];
      if (o && o[k] != null && o[k] !== '') return o[k];
    }
    return undefined;
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : NaN; }
  function numU(v) {
    if (v == null || v === '') return NaN;
    var n = parseFloat(String(v).replace(/[^\d.\-+eE]/g, ''));
    return isFinite(n) ? n : NaN;
  }
  function parseTime(s, tz) {
    var F = global.Fmt;
    return (F && F.parse) ? F.parse(s, tz || 'Asia/Tokyo') : null;
  }
  function eqArr(j) {
    if (Array.isArray(j)) return j;
    if (!j || typeof j !== 'object') return [];
    var out = [];
    for (var k in j) {
      if (!Object.prototype.hasOwnProperty.call(j, k)) continue;
      var v = j[k];
      if (v && typeof v === 'object') out.push(v);
    }
    return out;
  }
  /* P2P 专用：JMA scale 码 → 项目内部编码 */
  function toShindo(v) {
    if (v == null || v === '') return -1;
    var n = parseInt(v, 10);
    if (!isFinite(n)) return -1;
    var s = SCALE[n];
    return s == null ? -1 : s;
  }
  function corePlace(s) {
    var t = String(s == null ? '' : s);
    return t.replace(/について$/, '').replace(/付近$/, '').replace(/海域$/, '沖').trim();
  }
  function distDeg(a, b) {
    if (!isFinite(a.lat) || !isFinite(a.lon) || !isFinite(b.lat) || !isFinite(b.lon)) return Infinity;
    var R = 6371, r1 = a.lat * Math.PI / 180, r2 = b.lat * Math.PI / 180;
    var dp = (b.lat - a.lat) * Math.PI / 180, dl = (b.lon - a.lon) * Math.PI / 180;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(r1) * Math.cos(r2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function jmaEventId(s) {
    var t = String(s == null ? '' : s);
    var m = t.match(/(\d{14})/);
    return m ? m[1] : '';
  }
  /** 两端判定是否同一场地震 */
  function sameEvent(a, b) {
    var ea = jmaEventId(a.eventId), eb = jmaEventId(b.eventId);
    if (ea && eb && ea !== eb) return false;
    if (Math.abs((a.timeMs || 0) - (b.timeMs || 0)) > 10 * 60000) return false;
    var d = distDeg(a, b);
    if (isFinite(d) && d > 200) return false;          /* 200km ≈ 2° */
    if (isFinite(a.mag) && isFinite(b.mag) && a.mag > 0 && b.mag > 0 && Math.abs(a.mag - b.mag) > 1.5) return false;
    var ca = corePlace(a.place), cb = corePlace(b.place);
    if (ca && cb && ca !== cb && ca.indexOf(cb) < 0 && cb.indexOf(ca) < 0) return false;
    return true;
  }

  /* ---------------- WOLF-X 解析 ---------------- */
  function parseWolfEq(o) {
    var t = pick(o, 'time_full', 'time');
    if (!t) return null;
    var d = parseTime(t, 'Asia/Tokyo');
    if (!d) return null;
    var evId = String(pick(o, 'EventID', 'ID') || '');
    var q = {
      id: 'WOLF:' + (evId || t),
      srcTag: 'WOLF',
      source: 'JMA', feed: 'jmaeq',
      isEew: false,
      eventId: evId,
      timeMs: d.getTime(), pubMs: d.getTime(),
      place: String(pick(o, 'location', 'placeName') || ''),
      mag: num(pick(o, 'magnitude', 'Magunitude')),
      depthKm: numU(pick(o, 'depth')),
      lat: num(pick(o, 'latitude')), lon: num(pick(o, 'longitude')),
      shindo: shindoOf(pick(o, 'shindo', 'maxIntensity')),
      maxShindo: -1, liedu: -1,
      detail: String(pick(o, 'info') || ''),
      seq: 0, isFinal: false, isCancel: false, isTraining: false, isAssumption: false,
      eewAreas: null
    };
    if (q.shindo >= 0) q.maxShindo = q.shindo;
    return q;
  }
  function parseWolfEew(o) {
    if (!o || typeof o !== 'object') return null;
    if (o.Type && /^(cancel|取消報|取消報)$/i.test(String(o.Type))) return null;
    var at = pick(o, 'AnnouncedTime', 'ReportTime', 'time');
    var ot = pick(o, 'OriginTime') || at;
    if (!ot) return null;
    var d = parseTime(ot, 'Asia/Tokyo'), dp = parseTime(at, 'Asia/Tokyo');
    if (!d) return null;
    var evId = String(pick(o, 'EventID', 'ID') || '');
    var q = {
      id: 'WOLFEW:' + (evId || ot),
      srcTag: 'WOLF',
      source: 'JMA_EEW', feed: 'eew_jma',
      isEew: true,
      eventId: evId,
      timeMs: d.getTime(), pubMs: dp ? dp.getTime() : d.getTime(),
      place: String(pick(o, 'Hypocenter', 'HypoCenter', 'location') || ''),
      mag: num(pick(o, 'Magunitude', 'Magnitude')),
      depthKm: numU(pick(o, 'Depth', 'depth')),
      lat: num(pick(o, 'Latitude', 'latitude')), lon: num(pick(o, 'Longitude', 'longitude')),
      shindo: shindoOf(pick(o, 'MaxIntensity', 'shindo')),
      maxShindo: -1, liedu: -1,
      detail: String(pick(o, 'Title', 'CodeType') || ''),
      codeType: String(pick(o, 'CodeType') || ''),
      seq: parseInt(pick(o, 'Serial', 'ReportNum'), 10) || 0,
      isFinal: !!pick(o, 'isFinal'), isCancel: !!pick(o, 'isCancel'),
      isTraining: !!pick(o, 'isTraining'), isAssumption: !!pick(o, 'isAssumption'),
      isWarn: !!pick(o, 'isWarn'),
      warnArea: pick(o, 'WarnArea') || [],
      accuracy: pick(o, 'Accuracy') || null,
      eewAreas: null
    };
    if (q.shindo >= 0) q.maxShindo = q.shindo;
    return q;
  }

  /* ---------------- P2P 解析 ---------------- */
  function parseP2pEew(o) {
    if (!o || o.code !== 556) return null;
    var eq = o.earthquake || {}, hp = eq.hypocenter || {}, iss = o.issue || {};
    if (!hp.name && !o.cancelled) return null;
    var ot = eq.originTime || eq.time;
    var d = parseTime(ot, 'Asia/Tokyo');
    var dp = parseTime(iss.time, 'Asia/Tokyo');
    if (!d) return null;
    var evId = String(iss.eventId || '');
    var maxS = -1, areas = [];
    var list = o.areas || [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var to = toShindo(a.scaleTo);
      if (to > maxS) maxS = to;
      var at2 = parseTime(a.arrivalTime, 'Asia/Tokyo');
      areas.push({
        pref: a.pref || '', name: a.name || '', kind: a.kindCode || '',
        from: toShindo(a.scaleFrom), to: to,
        arrivalMs: at2 ? at2.getTime() : 0
      });
    }
    return {
      id: 'P2PEW:' + (evId || ''),
      srcTag: 'P2P',
      source: 'P2P', feed: 'eew_p2p',
      isEew: true,
      eventId: evId,
      timeMs: d.getTime(), pubMs: dp ? dp.getTime() : d.getTime(),
      place: String(hp.name || ''),
      mag: num(hp.magnitude), depthKm: numU(hp.depth),
      lat: num(hp.latitude), lon: num(hp.longitude),
      shindo: maxS, maxShindo: maxS, liedu: -1,
      detail: 'P2P 紧急地震速报',
      seq: parseInt(iss.serial, 10) || 0,
      isFinal: !!(o.final || o.isFinal || /final/i.test(String(iss.type || ''))),
      isCancel: !!o.cancelled,
      isTraining: !!(o.test || /training|test/i.test(String(iss.type || ''))),
      isAssumption: false,
      isWarn: false, accuracy: { Epicenter: '' },
      eewAreas: areas
    };
  }
  function parseP2pEq(o) {
    if (!o) return null;
    var eq = o.earthquake || {}, hp = eq.hypocenter || {}, iss = o.issue || {};
    if (!hp.name) return null;
    var d = parseTime(eq.time || eq.originTime, 'Asia/Tokyo');
    if (!d) return null;
    var dp = parseTime(iss.time, 'Asia/Tokyo');
    var s = toShindo(eq.maxScale);
    return {
      id: 'P2PEQ:' + (o.id || ''),
      srcTag: 'P2P',
      source: 'JMA', feed: 'p2p',
      isEew: false,
      eventId: String(iss.eventId || ''),
      timeMs: d.getTime(), pubMs: dp ? dp.getTime() : d.getTime(),
      place: String(hp.name || ''),
      mag: num(hp.magnitude), depthKm: numU(hp.depth),
      lat: num(hp.latitude), lon: num(hp.longitude),
      shindo: s, maxShindo: s, liedu: -1,
      detail: String(iss.source || '') + (iss.type ? ' ' + iss.type : ''),
      seq: 0, isFinal: false, isCancel: false, isTraining: false, isAssumption: false,
      eewAreas: null
    };
  }

  /* ---------------- 请求 ---------------- */
  function fetchJSON(url, ms) {
    var ctl = global.AbortController ? new global.AbortController() : null;
    var to = global.setTimeout(function () { try { if (ctl) ctl.abort(); } catch (e) { } }, ms || TIMEOUT);
    return global.fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        global.clearTimeout(to);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function (e) { global.clearTimeout(to); throw e; });
  }

  /** 值是否等价（用于「补空字段」时判断是否真的有变化） */
  function sameValue(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a == null && b == null;
    if (typeof a === 'number' && typeof b === 'number') return a === b;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
      return true;
    }
    if (typeof a === 'object' && typeof b === 'object') {
      var ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (var j = 0; j < ka.length; j++) if (!sameValue(a[ka[j]], b[ka[j]])) return false;
      return true;
    }
    return String(a) === String(b);
  }

  /* ---------------- 跨端去重合并 ---------------- */
  var merged = {};   /* 归一化 key → 合并后的记录 */
  var srcSeen = {};  /* 备用 */

  function normKey(q) {
    var e = jmaEventId(q.eventId);
    if (e) return 'E:' + e;
    return 'T:' + Math.round((q.timeMs || 0) / 60000) + ':' +
      corePlace(q.place).slice(0, 6) + ':' + (isFinite(q.mag) ? q.mag.toFixed(1) : '?');
  }
  /** 字段合并：后端（另一源）只补空，不覆盖已有值；但 serial 更大的报覆盖旧的 */
  function mergeInto(base, add) {
    var changed = false;
    if (add.seq > (base.seq || 0)) {
      /* 新报文 → 整体覆盖（同一场地震的后续报） */
      var keepAreas = base.eewAreas && base.eewAreas.length ? base.eewAreas : null;
      var keys = Object.keys(base);
      for (var i = 0; i < keys.length; i++) delete base[keys[i]];
      for (var k in add) base[k] = add[k];
      if (!base.eewAreas && keepAreas) base.eewAreas = keepAreas;
      changed = true;
    } else {
      /* 另一端同场 → 只补空字段 */
      for (var f in add) {
        var av = add[f], bv = base[f];
        var empty = (bv == null || bv === '' || bv === -1 || bv === false ||
          (Array.isArray(bv) && !bv.length) || (typeof bv === 'number' && !isFinite(bv)));
        if (!empty) continue;
        if (av == null || av === '' || av === -1) continue;
        /* ★ 值【本来就一样】就不算变化 —— 否则每轮轮询都会把同一批数据
           "补"一次 → changed=true → 每 2 秒重复 emit 同一批地震。 */
        if (sameValue(bv, av)) continue;
        base[f] = av; changed = true;
      }
      /* ★ 到达时刻互补：P2P 有、WOLF-X 没有 → 保留 P2P 的 */
      if (!base.eewAreas && add.eewAreas && add.eewAreas.length) { base.eewAreas = add.eewAreas; changed = true; }    }
    return changed;
  }
  /** 在已合并集合里找同一场地震的其他源记录 */
  function findTwin(q) {
    var keys = Object.keys(merged);
    for (var i = 0; i < keys.length; i++) {
      var rec = merged[keys[i]];
      if (rec.srcs.indexOf(q.srcTag) >= 0) continue;   /* 同源 → 不是"另一端" */
      if (sameEvent(rec.q, q)) return rec;
    }
    return null;
  }

  function ingest(q) {
    if (!q || !q.timeMs) return;
    var key = normKey(q);
    var rec = merged[key];
    if (!rec) {
      /* 先看看是不是另一端的同一场 */
      var twin = findTwin(q);
      if (twin) {
        mergeInto(twin.q, q);
        twin.srcs.push(q.srcTag);
        twin.q.srcTag = twin.srcs.join('+');
        S.merged++;
        emit('quake', twin.q);
        return;
      }
      merged[key] = { q: q, srcs: [q.srcTag], at: Date.now() };
      S.emitted++;
      emit('quake', q);
      return;
    }
    /* 同一 key → 可能是同一条速报的新报文（Serial 递增）→ 内容变了才 emit。
       ★ 同一来源的同一条记录每轮轮询都会重复到达：内容没变就**不 emit**，
         否则每 2 秒把全部历史重播一遍，下游 QData.inject / onRealEew 被反复喂同一堆数据。 */
    if (mergeInto(rec.q, q)) {
      emit('quake', rec.q);
    }
  }

  /* ---------------- 一轮轮询 ---------------- */
  function round() {
    if (!S.on) return;
    S.round++;
    var t0 = Date.now();
    var jobs = [];

    jobs.push(fetchJSON(WOLF_EQ, TIMEOUT).then(function (j) {
      var list = eqArr(j).map(parseWolfEq).filter(Boolean);
      S.counts.wolfEq = list.length;
      S.health.wolfEq = { ok: true, n: list.length, at: Date.now() };
      for (var i = 0; i < list.length; i++) ingest(list[i]);
    }).catch(function (e) {
      S.health.wolfEq = { ok: false, err: String(e && e.message || e), at: Date.now() };
    }));

    jobs.push(fetchJSON(WOLF_EEW, TIMEOUT).then(function (j) {
      var q = parseWolfEew(j);
      S.counts.wolfEew = q ? 1 : 0;
      S.health.wolfEew = { ok: true, n: q ? 1 : 0, at: Date.now() };
      if (q) ingest(q);
    }).catch(function (e) {
      S.health.wolfEew = { ok: false, err: String(e && e.message || e), at: Date.now() };
    }));

    jobs.push(fetchJSON(P2P_EEW, TIMEOUT).then(function (a) {
      var list = (a || []).map(parseP2pEew).filter(Boolean);
      S.counts.p2pEew = list.length;
      S.health.p2pEew = { ok: true, n: list.length, at: Date.now() };
      for (var i = 0; i < list.length; i++) ingest(list[i]);
    }).catch(function (e) {
      S.health.p2pEew = { ok: false, err: String(e && e.message || e), at: Date.now() };
    }));

    jobs.push(fetchJSON(P2P_EQ, TIMEOUT).then(function (a) {
      var list = (a || []).map(parseP2pEq).filter(Boolean);
      S.counts.p2pEq = list.length;
      S.health.p2pEq = { ok: true, n: list.length, at: Date.now() };
      for (var i = 0; i < list.length; i++) ingest(list[i]);
    }).catch(function (e) {
      S.health.p2pEq = { ok: false, err: String(e && e.message || e), at: Date.now() };
    }));

    Promise.all(jobs).then(function () {
      S.lastAt = Date.now();
      S.lastErr = '';
      emit('status', snapshot());
    });
  }

  function schedule() {
    if (!S.on) return;
    if (S.timer) global.clearTimeout(S.timer);
    S.timer = global.setTimeout(function () { S.timer = null; round(); schedule(); }, POLL_MS);
  }

  var W = {
    start: function () {
      if (S.on) return;
      S.on = true;
      round();
      schedule();
    },
    stop: function () {
      S.on = false;
      if (S.timer) { global.clearTimeout(S.timer); S.timer = null; }
      emit('status', snapshot());
    },
    on: function (f) { if (typeof f === 'function') listeners.push(f); },
    status: snapshot,
    _sameEvent: sameEvent,
    _parseWolfEew: parseWolfEew,
    _parseWolfEq: parseWolfEq,
    _parseP2pEew: parseP2pEew,
    _parseP2pEq: parseP2pEq
  };
  global.QVRealSrc = W;
})(window);
