/* customsrc.js — 自定义数据源（ZQuake 地震观测台）
 *
 * 作用：让用户把自己的 JSON 数据接进现有的速报链路，格式沿用项目「现有的」那套：
 *   ① ZQuake 归一化事件对象（realsrc.js / QData.inject 用的 q）；
 *   ② WOLF-X 原始 jma_eew.json / jma_eqlist.json；
 *   ③ P2PQuake v2 history 原始数组（code 551 / 556）。
 *
 * 接入方式：URL 轮询 / 粘贴 JSON / 本地 .json 文件，配置存 localStorage。
 * 注入链路（与 app.js 里 wolfx / P2P 的 handler 完全一致，不改原有数据源）：
 *   QData.injectBatch(list)  → 履历 / 情报列表
 *   QVViews.onRealEew(q)     → Tab2 速报卡 / 音效 / 取景 / 记录器
 *
 * ⚠ 用 XMLHttpRequest 而不是 fetch：pack-boot.js 会劫持 window.fetch 把
 *   「路径里带 assets/ 的 URL」改从内存单包取，用户自定义地址里若含 /assets/
 *   会被误判成 404。XHR 不走那条钩子。
 *
 * 暴露：window.QVCustomSrc
 *   .boot()  .setConfig(o)  .config()  .start()  .stop()  .once()  .ingestText(text)
 *   .status()  .display()  .on(fn)  .EXAMPLE(tpl)
 */
(function (g) {
  'use strict';

  var LS_KEY = 'zq_custom_src_v1';
  var DEF = { mode: 'url', url: '', interval: 10, enabled: false, allowOld: true, json: '' };
  var cfg = readCfg();
  var listeners = [];
  var timer = 0;
  var seen = Object.create(null);
  var memoryText = '';                 /* 文件模式：不写进 localStorage 的临时文本 */
  var S = {
    on: false, round: 0, lastAt: 0, lastErr: '', lastCount: 0, total: 0,
    status: '未启用', lastEvent: null
  };

  /* ---------------- 配置 ---------------- */
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function readCfg() {
    var o = {}, c = {}, k;
    try { o = JSON.parse(g.localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { }
    for (k in DEF) c[k] = (o[k] === undefined ? DEF[k] : o[k]);
    if (['url', 'paste', 'file'].indexOf(c.mode) < 0) c.mode = 'url';
    c.interval = Math.max(2, Math.min(3600, parseInt(c.interval, 10) || 10));
    c.enabled = !!c.enabled;
    c.allowOld = (o.allowOld === undefined) ? true : !!c.allowOld;
    c.url = String(c.url || '');
    c.json = String(c.json || '');
    return c;
  }
  function saveCfg() {
    try { g.localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) { }
  }
  function emit(o) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](o); } catch (e) { }
    }
  }
  function snapshot() {
    return {
      on: S.on, round: S.round, lastAt: S.lastAt, lastErr: S.lastErr,
      lastCount: S.lastCount, total: S.total, status: S.status,
      mode: cfg.mode, url: cfg.url, interval: cfg.interval,
      enabled: cfg.enabled, allowOld: cfg.allowOld
    };
  }
  function status(txt, err) {
    S.status = txt;
    if (err !== undefined) S.lastErr = err || '';
    emit({ kind: 'status', state: snapshot() });
  }

  /* ---------------- 归一化工具 ---------------- */
  function toMs(v) {
    if (v == null || v === '') return NaN;
    if (v instanceof Date) return isFinite(v.getTime()) ? v.getTime() : NaN;
    if (typeof v === 'number') return isFinite(v) ? (v > 0 && v < 1e11 ? v * 1000 : v) : NaN;
    var s = String(v).trim();
    if (/^\d{10,13}$/.test(s)) { var n = +s; return s.length <= 10 ? n * 1000 : n; }
    var d = (g.Fmt && g.Fmt.parse) ? g.Fmt.parse(s) : null;
    if (d && isFinite(d.getTime())) return d.getTime();
    var d2 = new Date(s);
    return isFinite(d2.getTime()) ? d2.getTime() : NaN;
  }
  function nOf(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var n = parseFloat(String(v).replace(/[^\d.\-+eE]/g, ''));
    return isFinite(n) ? n : NaN;
  }
  /* 内部震度编码：0 / 1 / 2 / 3 / 4 / 50(5弱) / 55(5強) / 60 / 65 / 70(7)，-1=不明。
     同时兼容 10/20/30/40 写法与 「5弱」「5+」「7」 这类常见文本。 */
  function shindoOf(v) {
    if (v == null || v === '') return -1;
    var t = v;
    if (typeof t === 'string') {
      var s = t.trim();
      if (/不明|未知|undefined/i.test(s)) return -1;
      if (/5\s*[-−ー–—]?\s*弱/.test(s) || /^!?\s*5\s*[-−ー–—]$/.test(s)) return 50;
      if (/5\s*[+＋]?\s*[強强]/.test(s) || /^!?\s*5\s*[+＋]$/.test(s)) return 55;
      if (/6\s*[-−ー–—]?\s*弱/.test(s) || /^!?\s*6\s*[-−ー–—]$/.test(s)) return 60;
      if (/6\s*[+＋]?\s*[強强]/.test(s) || /^!?\s*6\s*[+＋]$/.test(s)) return 65;
      if (/^7$/.test(s)) return 70;
      t = parseFloat(s);
    }
    var n = +t;
    if (!isFinite(n) || n < 0) return -1;
    if (n === 10) return 1;
    if (n === 20) return 2;
    if (n === 30) return 3;
    if (n === 40) return 4;
    if (n === 45) return 50;
    if (n === 5) return 50;
    if (n === 6) return 60;
    if (n === 7) return 70;
    if (n >= 70) return 70;
    if (n >= 45) return Math.max(50, Math.min(70, Math.round(n / 5) * 5));
    if (n <= 4) return Math.round(n);
    return -1;
  }
  function lieduOf(v) {
    var n = nOf(v);
    if (!isFinite(n) || n < 0) return -1;
    return Math.max(0, Math.min(12, Math.round(n)));
  }
  function boolOf(v) { return !!(v === true || v === 1 || v === '1' || v === 'true'); }

  /* ---------------- 顶层结构 ---------------- */
  function collect(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    var K = ['list', 'data', 'events', 'quakes', 'results', 'items', 'records', 'features'];
    for (var i = 0; i < K.length; i++) if (Array.isArray(data[K[i]])) return data[K[i]];
    /* 单条归一化对象 / 单条 WOLF-X EEW / 单条 P2P 电报 */
    if (data.timeMs != null || data.isEew != null || data.isEEW != null || data.id != null ||
        data.OriginTime || data.time_full || data.code != null) return [data];
    /* WOLF-X jma_eqlist.json：以事件号为键的大对象 */
    var vals = [];
    for (var k in data) {
      if (hasOwn(data, k) && data[k] && typeof data[k] === 'object') vals.push(data[k]);
    }
    return vals.length ? vals : [data];
  }

  /* ---------------- 原始上游格式识别 ---------------- */
  function detectRaw(o) {
    var R = g.QVRealSrc;
    if (!R || !o || typeof o !== 'object') return null;
    try {
      if (o.code != null && (o.earthquake || o.issue)) {
        var f = (+o.code === 556) ? R._parseP2pEew : R._parseP2pEq;
        if (typeof f === 'function') { var a = f(o); if (a) return a; }
      }
      if (o.OriginTime || o.AnnouncedTime || o.Hypocenter || o.MaxIntensity) {
        if (typeof R._parseWolfEew === 'function') { var b = R._parseWolfEew(o); if (b) return b; }
      }
      if (o.time_full || o.Magunitude || (o.location && o.magnitude)) {
        if (typeof R._parseWolfEq === 'function') { var c = R._parseWolfEq(o); if (c) return c; }
      }
    } catch (e) { }
    return null;
  }

  /* ---------------- 归一化事件对象 ---------------- */
  function normalizeInternal(o, i) {
    var q = {}, k;
    for (k in o) if (hasOwn(o, k)) q[k] = o[k];
    var isE = boolOf(o.isEew !== undefined ? o.isEew :
      (o.isEEW !== undefined ? o.isEEW : (o.is_eew !== undefined ? o.is_eew : o.eew)));
    q.isEew = isE;

    var t = toMs(o.timeMs != null ? o.timeMs : (o.originTime || o.time || o.time_full));
    if (!isFinite(t)) t = Date.now();
    q.timeMs = t;
    var p = toMs(o.pubMs != null ? o.pubMs : (o.announcedTime || o.reportTime || o.publishTime));
    q.pubMs = isFinite(p) ? p : t;

    q.id = String(o.id || (o.eventId ? 'CUSTOM:' + o.eventId : 'CUSTOM:' + t + ':' + i));
    q.eventId = String(o.eventId || '');
    q.place = String(o.place || o.location || o.hypocenter || '');
    q.mag = nOf(o.mag != null ? o.mag : o.magnitude);
    q.depthKm = nOf(o.depthKm != null ? o.depthKm : o.depth);
    q.lat = nOf(o.lat != null ? o.lat : o.latitude);
    q.lon = nOf(o.lon != null ? o.lon : o.longitude);

    var s0 = shindoOf(o.shindo != null ? o.shindo : (o.maxShindo != null ? o.maxShindo : o.maxIntensity));
    q.shindo = s0;
    q.maxShindo = shindoOf(o.maxShindo != null ? o.maxShindo : (o.maxIntensity != null ? o.maxIntensity : s0));
    if (q.maxShindo < 0) q.maxShindo = s0;
    q.liedu = lieduOf(o.liedu);
    q.seq = parseInt(o.seq != null ? o.seq : (o.serial || o.reportNum), 10) || 0;

    q.isFinal = boolOf(o.isFinal);
    q.isCancel = boolOf(o.isCancel || o.cancelled);
    q.isTraining = boolOf(o.isTraining);
    q.isWarn = boolOf(o.isWarn);
    q.isAssumption = boolOf(o.isAssumption);
    q.detail = String(o.detail || o.info || '');
    if (o.metric === 'liedu') q.metric = 'liedu';
    if (o.accuracy && typeof o.accuracy === 'object') q.accuracy = o.accuracy;
    else q.accuracy = { Epicenter: '' };
    if (Array.isArray(o.warnArea)) q.warnArea = o.warnArea;

    var areas = Array.isArray(o.eewAreas) ? o.eewAreas : (Array.isArray(o.areas) ? o.areas : null);
    if (areas) {
      q.eewAreas = areas.map(function (a) {
        a = a || {};
        return {
          pref: String(a.pref || ''), name: String(a.name || a.pref || ''),
          kind: String(a.kind || a.kindCode || ''),
          from: shindoOf(a.from != null ? a.from : a.scaleFrom),
          to: shindoOf(a.to != null ? a.to : (a.scaleTo != null ? a.scaleTo : a.level)),
          arrivalMs: toMs(a.arrivalMs || a.arrivalTime) || 0
        };
      });
    } else q.eewAreas = null;

    q.source = String(o.source || (isE ? 'CUSTOM_EEW' : 'CUSTOM'));
    q.feed = String(o.feed || 'custom');
    return q;
  }

  function tagCustom(q) {
    q.srcTag = 'CUSTOM';
    q.__custom = 1;
    /* 允许历史数据 → 复用回放标记，绕过 QVViews.eewIsFresh 的 10 分钟门槛 */
    if (cfg.allowOld) q.__replay = 1;
    if (!q.id) q.id = 'CUSTOM:' + q.timeMs;
    if (!q.pubMs) q.pubMs = q.timeMs;
    if (!q.source) q.source = 'CUSTOM';
    if (!q.feed) q.feed = 'custom';
    if (q.shindo == null || !isFinite(+q.shindo)) q.shindo = -1;
    if (q.maxShindo == null || !isFinite(+q.maxShindo)) q.maxShindo = q.shindo;
    if (q.liedu == null || !isFinite(+q.liedu)) q.liedu = -1;
    return q;
  }

  function parsePayload(text) {
    var data = JSON.parse(text);
    var arr = collect(data), out = [], skipped = 0;
    for (var i = 0; i < arr.length; i++) {
      var o = arr[i];
      if (!o || typeof o !== 'object') { skipped++; continue; }
      var q = detectRaw(o) || normalizeInternal(o, i);
      if (!q || !isFinite(+q.timeMs)) { skipped++; continue; }
      out.push(tagCustom(q));
    }
    return {
      list: out, skipped: skipped,
      top: Array.isArray(data) ? 'array' : (data && typeof data === 'object' ? 'object' : 'other')
    };
  }

  /* ---------------- 注入 ---------------- */
  function deliver(parsed, label) {
    var list = parsed.list;
    if (!list.length) {
      status('未解析到事件', 'JSON 里没有可识别的事件对象（可点「JSON 格式说明」看字段）');
      emit({ kind: 'error', text: '0 条有效事件 · 请检查 JSON 格式' });
      return { n: 0, eew: 0 };
    }
    var fresh = [], eew = [], i, q, key, stale = 0, dup = 0;
    for (i = 0; i < list.length; i++) {
      q = list[i];
      key = [q.id, q.seq || 0, q.pubMs || 0, q.isCancel ? 1 : 0, q.isFinal ? 1 : 0].join('|');
      if (seen[key]) { dup++; continue; }
      seen[key] = 1;
      /* 与 app.js 一致：过期 EEW 默认既不进列表也不弹提示 */
      if (q.isEew && !cfg.allowOld && !(g.QVViews && g.QVViews.eewIsFresh && g.QVViews.eewIsFresh(q))) {
        stale++; continue;
      }
      fresh.push(q);
      if (q.isEew) eew.push(q);
    }
    if (!fresh.length) {
      var why = stale ? ('已过滤 ' + stale + ' 条过期速报（可勾选「允许历史数据」）') :
        (dup ? '本轮 ' + list.length + ' 条均为已处理过的报文' : '本轮没有可注入的报文');
      status(stale ? '仅有过期的速报' : '无新增（已去重）', '');
      emit({ kind: 'status', state: snapshot(), text: why });
      return { n: 0, eew: 0, dedup: true, parsed: list.length, stale: stale };
    }
    /* 模拟进行中不接真实数据，避免顶掉模拟画面（与 app.js 的 realsrc handler 一致） */
    if (g.QVViews && g.QVViews.simOn) {
      status('模拟中 · 暂缓接入', '');
      emit({ kind: 'warn', text: '模拟进行中，自定义源数据暂缓接入' });
      return { n: 0, eew: 0, skipped: 'sim' };
    }
    try {
      if (g.QData && g.QData.injectBatch) g.QData.injectBatch(fresh);
      else if (g.QData && g.QData.inject) fresh.forEach(function (x) { g.QData.inject(x); });
    } catch (e) { }

    var accepted = 0;
    for (i = 0; i < eew.length; i++) {
      try {
        if (g.QVViews && g.QVViews.onRealEew && g.QVViews.onRealEew(eew[i])) accepted++;
      } catch (e) { }
    }
    /* display() 兜底用：取最新一条 */
    var last = null;
    for (i = 0; i < fresh.length; i++) {
      if (!last || (+fresh[i].pubMs || 0) >= (+last.pubMs || 0)) last = fresh[i];
    }
    if (last) S.lastEvent = last;
    S.lastAt = Date.now();
    S.lastCount = fresh.length;
    S.total += fresh.length;
    S.round++;
    status((label || '已接入') + ' · ' + fresh.length + ' 条 / 速报 ' + eew.length + ' 条', '');
    emit({
      kind: 'data', state: snapshot(), count: fresh.length, eew: eew.length,
      accepted: accepted, skipped: parsed.skipped, last: last,
      text: '自定义源接入 ' + fresh.length + ' 条' + (eew.length ? ' · 速报 ' + eew.length + ' 报' : '')
    });
    return { n: fresh.length, eew: eew.length };
  }

  /* ---------------- 取数 ---------------- */
  function fetchUrl(cb) {
    var url = String(cfg.url || '').trim();
    if (!url) { cb(new Error('请先填写 JSON 地址')); return; }
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    var finalUrl = url + sep + '_zq=' + Date.now();
    var x;
    try { x = new XMLHttpRequest(); } catch (e) { cb(new Error('浏览器不支持 XMLHttpRequest')); return; }
    x.open('GET', finalUrl, true);
    x.timeout = 15000;
    x.onload = function () {
      if (x.status >= 200 && x.status < 300 || x.status === 304) return cb(null, x.responseText);
      cb(new Error('HTTP ' + x.status));
    };
    x.onerror = function () { cb(new Error('请求失败：跨域(CORS)被拦截、地址不可达或协议不允许')); };
    x.ontimeout = function () { cb(new Error('请求超时（15 秒）')); };
    try { x.send(null); } catch (e) { cb(e); }
  }

  function textForMode() {
    if (cfg.mode === 'url') return null;
    if (cfg.mode === 'file') return memoryText || cfg.json;
    return cfg.json || memoryText;
  }

  function once(label, force) {
    if (force) seen = Object.create(null);
    function handle(err, text) {
      if (err) {
        status('取数失败', err.message || String(err));
        emit({ kind: 'error', text: err.message || String(err) });
        return;
      }
      var parsed;
      try { parsed = parsePayload(text); }
      catch (e) {
        var m = 'JSON 解析失败：' + (e && e.message || e);
        status('格式错误', m);
        emit({ kind: 'error', text: m });
        return;
      }
      status('解析中 · ' + parsed.list.length + ' 条', '');
      deliver(parsed, label || '已接入');
    }
    if (cfg.mode === 'url') fetchUrl(handle);
    else {
      var t = textForMode();
      if (!t || !t.trim()) handle(new Error(cfg.mode === 'file' ? '请先选择 .json 文件' : '请先粘贴 JSON 内容'));
      else handle(null, t);
    }
  }

  /* ---------------- 生命周期 ---------------- */
  function clearTimer() { if (timer) { g.clearInterval(timer); timer = 0; } }
  function start() {
    clearTimer();
    cfg.enabled = true;
    saveCfg();
    S.on = true;
    status('启动中…', '');
    once('已接入');
    if (cfg.mode === 'url') {
      timer = g.setInterval(function () { once('轮询'); }, cfg.interval * 1000);
    }
    emit({ kind: 'status', state: snapshot(), text: cfg.mode === 'url' ? '自定义源已启用 · 每 ' + cfg.interval + ' 秒拉取' : '自定义源已载入' });
  }
  function stop() {
    clearTimer();
    cfg.enabled = false;
    saveCfg();
    S.on = false;
    S.lastEvent = null;
    status('已停用', '');
    emit({ kind: 'status', state: snapshot(), text: '自定义源已停用' });
  }
  function setConfig(o) {
    o = o || {};
    var restart = false;
    if (o.mode !== undefined && ['url', 'paste', 'file'].indexOf(o.mode) >= 0) cfg.mode = o.mode;
    if (o.url !== undefined) cfg.url = String(o.url || '');
    if (o.json !== undefined) cfg.json = String(o.json || '').slice(0, 512000);
    if (o.interval !== undefined) {
      cfg.interval = Math.max(2, Math.min(3600, parseInt(o.interval, 10) || 10));
      restart = true;
    }
    if (o.allowOld !== undefined) cfg.allowOld = !!o.allowOld;
    if (o.enabled !== undefined) cfg.enabled = !!o.enabled;
    if (o.memoryText !== undefined) memoryText = String(o.memoryText || '');
    saveCfg();
    if (S.on && cfg.mode === 'url' && restart) {
      clearTimer();
      timer = g.setInterval(function () { once('轮询'); }, cfg.interval * 1000);
    }
    emit({ kind: 'status', state: snapshot() });
    return cfg;
  }

  /* 兜底卡片：官方速报链路没接管画面时（例如中国坐标走 Tab1、或纯情报条目），
     观测台左卡仍然显示自定义源的最新事件。 */
  function display() {
    var q = S.lastEvent;
    if (!q) return null;
    var base = +q.pubMs || +q.timeMs || 0;
    /* 允许历史数据时兜底卡片不过期（回放/演练场景）；否则沿用 10 分钟时效 */
    if (!cfg.allowOld && base && Date.now() - base > 10 * 60000) return null;
    var metric = q.metric === 'liedu' ? 'liedu' : 'shindo';
    var lv = +q.maxShindo;
    if (!isFinite(lv) || lv < 0) lv = +q.shindo;
    if (!isFinite(lv) || lv < 0) lv = (metric === 'liedu' && +q.liedu >= 0) ? +q.liedu : null;
    var areas = (q.eewAreas || []).map(function (a) {
      return { name: a.name || a.pref || '', level: a.to };
    });
    return {
      eventId: q.eventId || q.id, metric: metric,
      mag: q.mag, depth: q.depthKm, place: q.place || '自定义数据源',
      timeMs: q.timeMs, lat: q.lat, lon: q.lon,
      level: lv, report: q.seq || 1, plan: 0,
      isFinal: !!q.isFinal,
      kind: q.isCancel ? 'cancel' : (q.isEew ? 'alert' : 'info'),
      areas: areas, allAreas: areas, fillShown: [], obsN: null, q: q
    };
  }

  /* 可复制 / 可一键填入的示例。live=true 时把时间戳换成「刚刚」，直接就能看到效果。 */
  /* live 参数保留兼容：无论哪种都用「当前时刻」生成，复制后立即可用 */
  function EXAMPLE(live) {
    var now = Date.now();
    var t = now - 20000, p = now - 8000, a = now + 20000;
    return JSON.stringify([
      {
        id: 'CUSTOM:DEMO-001', eventId: '20261111210000',
        isEew: true,
        timeMs: t, pubMs: p,
        place: '示例海域（自定义数据源）',
        mag: 6.3, depthKm: 20, lat: 38.2, lon: 142.4,
        shindo: 50, maxShindo: 50, liedu: -1,
        seq: 1, isFinal: false, isCancel: false, isTraining: false,
        source: 'CUSTOM_EEW', feed: 'custom',
        eewAreas: [{ pref: '宫城县', name: '石卷市', from: 40, to: 50, arrivalMs: a }]
      }
    ], null, 2);
  }

  var API = {
    boot: function () { if (cfg.enabled) start(); else status('未启用', ''); },
    setConfig: setConfig,
    config: function () {
      return {
        mode: cfg.mode, url: cfg.url, interval: cfg.interval,
        enabled: cfg.enabled, allowOld: cfg.allowOld, json: cfg.json
      };
    },
    start: start,
    stop: stop,
    once: once,
    reset: function () {
      seen = Object.create(null);
      S.lastEvent = null; S.total = 0; S.lastCount = 0;
      status('去重缓存已清空', '');
      emit({ kind: 'status', state: snapshot(), text: '自定义源去重缓存已清空' });
    },
    ingestText: function (text, label) {
      memoryText = String(text || '');
      var parsed;
      try { parsed = parsePayload(memoryText); }
      catch (e) {
        var m = 'JSON 解析失败：' + (e && e.message || e);
        status('格式错误', m);
        emit({ kind: 'error', text: m });
        return { n: 0, error: m };
      }
      return deliver(parsed, label || '手动载入');
    },
    status: snapshot,
    display: display,
    on: function (f) { if (typeof f === 'function') listeners.push(f); },
    EXAMPLE: EXAMPLE,
    _parse: parsePayload
  };
  g.QVCustomSrc = API;
})(window);
