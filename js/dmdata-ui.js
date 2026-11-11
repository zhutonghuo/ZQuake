/* dmdata-ui.js — 付费电报（VXSE51/53/62・VTSE41/51/52）→ 界面
 *
 * 分工：
 *   dmdata.js  负责「连上 → 收报 → 解析成统一结构」
 *   本文件     负责「把解析结果接到地图 / 速报卡 / 海啸页」
 *
 * 数据性质标注（用户 2026-10-23 明确要求）：
 *   · wolfx EEW 推来的区域震度 = 【推定】（views.onRealEew）
 *   · 本文件拿到的 VXSE51/53  = 【实测】→ 覆盖地图色块与速报卡（views.applyMeasured）
 *
 * 观测点坐标：震度电报里只有观测点编号（如 210），坐标来自
 *   GET /v2/parameter/earthquake/station（4376 个，30 天缓存，主进程带 key 拉取）
 */
(function (g) {
  'use strict';

  var M = { areas: [], points: [], marks: [], key: '', timeMs: 0, lat: NaN, lon: NaN };
  var lastKey = '';
  var master = null;
  var masterTried = false;

  function bridge() { return (g.qv && g.qv.dmdata) ? g.qv.dmdata : null; }
  /* ★ 2026-10-25：前缀必须是 `[dmdata` 开头 —— main.js 只把匹配 /\[dmdata\]/ 的
     console 落盘，写成 `[dmdata-ui]` 会一条都进不了 startup.log（排查时看不到收报记录）。 */
  function log(s) { try { console.log('[dmdata] ui: ' + s); } catch (e) { } }

  /* ---------------- 观测点坐标表 ---------------- */
  /** 服务器给的 items → master.map（与主进程那份字段一致：code/name/region/lat/lon） */
  function buildMaster(items, cached) {
    var map = {}, n = 0;
    (items || []).forEach(function (s) {
      if (!s || !s.code) return;
      var lat = +s.lat, lon = +s.lon;
      if (!isFinite(lat) || !isFinite(lon)) return;
      map[String(s.code)] = { lat: lat, lon: lon, name: s.name || '', region: String(s.region || '') };
      n++;
    });
    master = { map: map, n: n, at: Date.now(), cached: !!cached };
    log('station master: ' + n + (cached ? ' (cache)' : ' (fresh)'));
    return master;
  }
  function loadMaster() {
    if (master) return Promise.resolve(master);
    if (masterTried) return Promise.resolve(null);
    masterTried = true;
    var b = bridge();
    /* ① Electron 本机直连：主进程带 key 拉（30 天缓存） */
    if (b && typeof b.station === 'function') {
      return b.station(false).then(function (r) {
        if (!r || !r.ok || !r.items) { log('station master failed: ' + ((r && r.message) || '')); return null; }
        return buildMaster(r.items, r.cached);
      }, function (e) { log('station master error: ' + e); return null; });
    }
    /* ② 中转模式（浏览器版也有）：服务器代拉的那份 */
    var url = (g.QVDmdata && g.QVDmdata.relayStation) ? g.QVDmdata.relayStation() : '';
    if (!url || typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(url, { cache: 'force-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !j.items) return null;
      return buildMaster(j.items, false);
    }, function (e) { log('station master relay error: ' + ((e && e.message) || e)); return null; });
  }

  /* ---------------- 地震电报（VXSE51/52/53/62） ---------------- */
  function isQuake(kind) { return /^VXSE5[123]$/.test(kind || ''); }
  function isLongPeriod(kind) { return kind === 'VXSE62'; }
  function isTsunami(kind) { return /^VTSE(41|51|52)$/.test(kind || ''); }

  function apply(q, areas, points, marks) {
    M.areas = areas || [];
    M.points = points || [];
    M.marks = marks || [];
    M.key = (q.kind || '') + ':' + (q.eventId || '') + ':' + (q.serial || '');
    M.timeMs = q.originMs || q.reportMs || Date.now();
    M.lat = +q.lat; M.lon = +q.lon;

    if (g.QVShindo) {
      if (areas.length && QVShindo.set) QVShindo.set(areas);
      /* ★★★ 2026-10-26 用户：「地图填色为什么全都被挡住了，模拟的时候都没被挡住」
         —— 模拟那边 views.rebuildAreas() 有阶段分工：
              · EEW / 检测态 → 只画圆形观测点徽章
              · 震源速報 / 各地の震度（正式报）→ 先 clearStations() 收掉圆形徽章，
                再一区一标地盖区域数字（否则圆徽章层 #mapstations z=8 会把
                #mapoverlay 里的区域数字 z=7 整片压住，看起来就是「全被挡住了」）。
           真实电报这条路径以前两个层**一起上**，正好踩中同一个坑。
         ⇒ VXSE51/53 走和模拟完全一样的规则。 */
      var finalLike = (q.kind === 'VXSE51' || q.kind === 'VXSE53');
      if (finalLike && marks.length) {
        if (g.QVMapCam && QVMapCam.clearStations) QVMapCam.clearStations();
        if (QVShindo.setStations) QVShindo.setStations([]);
        if (QVShindo.setPoints) QVShindo.setPoints(marks);
      } else {
        if (points.length && QVShindo.setStations) QVShindo.setStations(points);
        if (marks.length && QVShindo.setPoints) QVShindo.setPoints(marks);
      }
    }
    if (g.QVViews && QVViews.applyMeasured) {
      QVViews.applyMeasured({
        kind: q.kind, originMs: q.originMs, maxShindo: q.maxShindo, maxLg: q.maxLg, serial: q.serial,
        mag: q.mag, depthKm: q.depthKm, place: q.place,
        /* ★ 2026-10-29：eventId 必须传 —— applyMeasured 现在靠它「认邻」：
           有 EEW 时 E.eventId 对得上才算同一场；对不上且时间更新 → 重建 E。 */
        eventId: q.eventId || '',
        /* ★★★ 2026-10-27 用户（截图）：「这场地震地图一块颜色都没有」
           —— views.applyMeasured 以前拿不到**经纬度**，没前置 EEW 的小震就没法建状态，
              卡片/填色全退回普通版面。这里把位置一并传过去。 */
        lat: +q.lat, lon: +q.lon,
        areas: areas, points: points, areaMarks: marks
      });
    }
    if (g.QVRedraw) QVRedraw();
  }
  
  /** 观测点 → [{points, marks}]（marks = 按 JMA 细分区域取重心，一区一标） */
  function buildFromStations(ms, st) {
    var points = [], byArea = {};
    if (ms && ms.map && st && st.length) {
      st.forEach(function (s) {
        if (!s || s.shindo < 0) return;
        var m = ms.map[String(s.code)];
        if (!m) return;
        points.push({ lat: m.lat, lon: m.lon, v: s.shindo, shindo: s.shindo,
          name: s.name || m.name, area: m.region });
        var a = m.region; if (!a) return;
        var cur = byArea[a];
        if (!cur) byArea[a] = { area: a, v: s.shindo, shindo: s.shindo, lat: m.lat, lon: m.lon,
          n: 1, sLat: m.lat, sLon: m.lon, name: s.name || m.name };
        else {
          cur.n++; cur.sLat += m.lat; cur.sLon += m.lon;
          if (s.shindo > cur.shindo) { cur.shindo = s.shindo; cur.v = s.shindo; }
        }
      });
    }
    var marks = Object.keys(byArea).map(function (a) {
      var o = byArea[a];
      return { lat: o.sLat / o.n, lon: o.sLon / o.n, v: o.shindo, shindo: o.shindo,
        area: o.area, n: o.n, name: o.name };
    });
    return { points: points, marks: marks };
  }

  function onQuake(q) {
    if (!q || q.isCancel) return;
    var key = (q.kind || '') + '|' + (q.eventId || '') + '|' + (q.serial || '');
    if (key === lastKey) return;
    lastKey = key;

    /* ★ 2026-10-29：把区域名一起带上 —— views.applyMeasured 的正式报
       「观测震度」列表直接用这份实测区，不能再拿 EEW 的推定区名。 */
    var areas = (q.regions || [])
      .filter(function (r) { return r && r.code && r.shindo >= 0; })
      .map(function (r) { return { code: String(r.code), name: r.name || '', shindo: r.shindo }; });

    var st = q.stations || [];
    loadMaster().then(function (ms) {
      var b = buildFromStations(ms, st);
      apply(q, areas, b.points, b.marks);
      log('applied ' + q.kind + ' areas=' + areas.length + ' stations=' + b.points.length +
        ' marks=' + b.marks.length + ' max=' + q.maxShindo + (q.maxLg >= 0 ? (' lg=' + q.maxLg) : ''));
    });
  }

  /* ---------------- 海啸电报（VTSE41/51/52） ---------------- */
  function numOf(o) { var v = o && o.value != null ? parseFloat(o.value) : NaN; return isFinite(v) ? v : NaN; }
  function onTsunami(q) {
    /* 取消报 / 解除报 → 立刻收回海啸页 */
    if (q.isCancel) { if (g.QData) QData.setDmTsunami(null); if (g.QVRedraw) QVRedraw(); return; }
    var j = q.raw; if (!j) return;
    var b = j.body || {};
    var ts = b.tsunami || {};
    var items = [];
    (ts.forecasts || []).forEach(function (f) {
      var k = f.kind || {};
      var code = String(k.code || '');
      var gd = (g.QData && QData.tsunamiGrade && QData.tsunamiGrade[code]) || null;
      var lv = gd ? gd.lv
        : (/大津波/.test(k.name || '') ? 4 : /警報/.test(k.name || '') ? 3
          : /注意報/.test(k.name || '') ? 2 : 1);
      var h = (f.maxHeight && f.maxHeight.height) || {};
      var hv = '';
      if (h.value != null) hv = (+h.value) + 'm';
      else if (h.condition) hv = String(h.condition);
      if (h.over) hv = (hv ? hv.replace(/m<?$/, '') : '10') + 'm<';
      var fh = f.firstHeight || {};
      items.push({
        code: String(f.code || ''), name: f.name || '',
        grade: lv, gradeName: (gd && gd.cn) || k.name || '', raw: k.name || '',
        height: String(hv || ''),
        firstCond: String(fh.condition || ''), firstAt: String(fh.arrivalTime || ''),
        maxCond: '', maxAt: ''
      });
    });
    if (!items.length) { if (g.QData) QData.setDmTsunami(null); return; }

    var maxLv = 0, best = '';
    items.forEach(function (x) { if (x.grade > maxLv) maxLv = x.grade; });
    var hr = (g.QData && QData.heightRank) ? QData.heightRank : function () { return 0; };
    items.forEach(function (x) {
      if (x.grade === maxLv && x.height && hr(x.height) > hr(best)) best = x.height;
    });

    var eq = (b.earthquakes && b.earthquakes[0]) || {};
    var hp = eq.hypocenter || {};
    var coord = hp.coordinate || {};
    var out = {
      ttl: '', ift: q.infoType || '', at: '', anm: hp.name || q.place || '',
      mag: numOf(eq.magnitude), dep: numOf(hp.depth),
      lat: numOf(coord.latitude), lon: numOf(coord.longitude),
      atMs: q.originMs, pubMs: q.reportMs,
      items: items, maxLv: maxLv, height: best,
      head: j.headline || '', src: 'dmdata', kind: q.kind
    };
    if (g.QData) QData.setDmTsunami(out);
    log('tsunami ' + q.kind + ' lv=' + maxLv + ' areas=' + items.length + ' height=' + best);
    if (g.QVRedraw) QVRedraw();
  }

  /* ---------------- 订阅 ---------------- */
  function onTelegram(q) {
    if (!q || !q.kind) return;
    if (isTsunami(q.kind)) return onTsunami(q);
    if (isQuake(q.kind) || isLongPeriod(q.kind)) return onQuake(q);
    if (q.kind === 'VZSE40') return;    /* 地震・津波に関するお知らせ：只记录 */
  }

  function start() {
    if (!g.QVDmdata || !g.QVDmdata.on) return;
    g.QVDmdata.on(function (ev, payload) {
      if (ev !== 'quake') return;
      try { onTelegram(payload); } catch (e) { log('handler error: ' + ((e && e.message) || e)); }
    });
    /* 预热坐标表（不阻塞首屏） */
    setTimeout(function () { loadMaster(); }, 4000);
    log('ready');
  }

  /* ---------------- 历史电文（中转 REST 补拉） ----------------
   * WebSocket 只推「连上之后」的新电报，历史地震它不补发 →
   * 中转服务器用 REST 拉最近若干条 VXSE53（JMAXML），解析成 JSON 缓存 5 分钟。
   * 这里拿到的是**已解析**的区域震度 + 观测点编号，坐标再经 station master 还原。 */
  var HIST = [];                 /* [{t, key, areas, points, marks, place, mag}] */
  var histAt = 0;
  function loadHistory(force) {
    if (!force && Date.now() - histAt < 4 * 60000) return Promise.resolve(HIST);
    histAt = Date.now();
    var url = (g.QVDmdata && g.QVDmdata.relayHistory) ? g.QVDmdata.relayHistory() : '';
    if (!url || typeof fetch !== 'function') return Promise.resolve(HIST);
    return loadMaster().then(function (ms) {
      return fetch(url, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        if (!j || !j.items) return HIST;
        var out = [];
        j.items.forEach(function (it) {
          var areas = (it.areas || []).map(function (a) { return { code: String(a.code), shindo: +a.shindo }; });
          if (!areas.length) return;
          var b = buildFromStations(ms, it.stations || []);
          out.push({ t: +it.originMs || 0, key: it.id || ('h' + out.length),
            areas: areas, points: b.points, marks: b.marks,
            lat: +it.lat, lon: +it.lon,
            place: it.place || '', mag: +it.mag || NaN });
        });
        HIST = out;
        log('history loaded ' + out.length + ' item(s), first=' +
          (out[0] ? out[0].place + ' areas=' + out[0].areas.length : '-'));
        /* ★ 2026-10-27：history 一旦落地，就让 views 按实测补一条最小 E
           （没发过 EEW 的小震，卡片阶段/区域数字都靠它） */
        try { if (g.QVViews && QVViews.ensureEFromHistory) QVViews.ensureEFromHistory(); } catch (eE) { }
        if (g.QVRedraw) g.QVRedraw();
        return HIST;
      });
    }, function (e) { log('history failed: ' + ((e && e.message) || e)); return HIST; });
  }

  /** 两个震源是不是同一场（经纬度差 ≤ maxDeg 度，经度按纬度收缩） */
  function nearLatLon(aLat, aLon, bLat, bLon, maxDeg) {
    if (!isFinite(aLat) || !isFinite(aLon) || !isFinite(bLat) || !isFinite(bLon)) return false;
    var dy = aLat - bLat;
    var dx = (aLon - bLon) * Math.cos(bLat * Math.PI / 180);
    return Math.sqrt(dx * dx + dy * dy) <= maxDeg;
  }

  /** render3.syncAreas 用：按【那一场地震】取实测覆盖层
   *  ★★★ 2026-10-25 用户：「为什么巴布亚新几内亚也有 DM-D.S.S，这才 5.2 级」
   *  —— 真因：以前只比**时间**（±15 分钟），海外地震一旦和某场日本地震撞在同一个 15 分钟窗口里，
   *     就会把日本的震度分布画到它身上。DM-D.S.S 的 `telegram.earthquake` 只含**日本气象厅**电文，
   *     根本没有海外震度分布 ⇒ 必须再加一道**震源位置**判定（≤ 1.0°，约 110km）。
   *  · 传了 t → 时间 + 位置都对得上才给；否则 null（绝不拿别的场乱套）
   *  · 不传 t → 旧的「实时那一层」 */
  g.QVDmAreas = function (t, lat, lon) {
    if (!t) return M;
    if (M && M.areas && M.areas.length && Math.abs((M.timeMs || 0) - t) <= 15 * 60000 &&
      nearLatLon(M.lat, M.lon, lat, lon, 1.0)) return M;
    for (var i = 0; i < HIST.length; i++) {
      var h = HIST[i];
      if (h.areas.length && Math.abs(h.t - t) <= 15 * 60000 && nearLatLon(h.lat, h.lon, lat, lon, 1.0)) {
        return { areas: h.areas, points: h.points, marks: h.marks, timeMs: h.t, key: 'hist:' + h.key };
      }
    }
    return null;
  };
  g.QVDmUI = { start: start, feed: onTelegram, master: function () { return master; },
    state: function () { return M; }, history: function () { return HIST; }, reloadHistory: function () { return loadHistory(true); } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  /* 首屏稳定后再补拉历史（不抢数据洪峰） */
  /* ★★★ 2026-10-27 用户：「刷新后要等十几秒地图才上色」
     原来 history 补拉要等 **7 秒**，而且只拉一次 ——
     WS 只推「连上之后」的电报，所以刚刷新时当前这场只能靠这次补拉，晚到就等于「不填色」。
     ⇒ 1.2 秒就开拉（与首屏并行）→ 6 秒再拉一次 → 25 秒强制再拉。
     ★ 建 E（ensureEFromHistory）必须**每次拉完都试**，包括命中缓存的那两次：
       首屏时 QData 列表可能还没到（q=null）→ 第一次会失败，必须有人重试。 */
  function pullHistory(force) {
    var retry = function () {
      try { if (g.QVViews && QVViews.ensureEFromHistory) QVViews.ensureEFromHistory(); } catch (eR) { }
    };
    loadHistory(force).then(retry, retry);
    setTimeout(retry, 2500);
  }
  setTimeout(function () { pullHistory(false); }, 1200);
  setTimeout(function () { pullHistory(false); }, 6000);
  setTimeout(function () { pullHistory(true); }, 25000);
})(window);
