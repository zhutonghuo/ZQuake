/* dmdata.js — DM-D.S.S（dmdata.jp）付费电报推送适配层
 *
 * 为什么现在有这一层：
 *   官方 SREV 用的就是 dmdata.jp 的同源电文，我们 2026-10-23 买了
 *   「地震・津波関連」区分（550 円/月）→ 分类名 telegram.earthquake
 *   覆盖：震度速報(VXSE51) / 震源に関する情報(VXSE52) / 震源・震度(VXSE53)
 *         / 長周期地震動観測 / 浄波 / 推計震度分布
 *   ⚠ 不含 EEW（eew.forecast 1650 円 / eew.warning 440 円是另外的区分）
 *     → 震前那一段继续由 ws.js（wolfx）负责。
 *
 * 链路（v2）：
 *   主进程 POST https://api.dmdata.jp/v2/socket  →  一次性 websocket URL
 *   渲染进程 new WebSocket(url, ['dmdata.v2'])
 *   服务端下发 {"type":"ping","pingId"} → 必须回 {"type":"pong","pingId"}
 *   120 秒不回 pong 会被踢；服务器每月维护会主动断 → 必须能重连
 *
 * 密钥安全：
 *   key 只存在 %APPDATA%\koneew\dmdata.json，由 main.js 读取，渲染进程拿不到。
 *   本文件只负责「拿 URL → 连 → 保活 → 分发」。
 *
 * 用法：
 *   QVDmdata.start();                       // 连上（key 缺失时静默 idle）
 *   QVDmdata.on('data', function (m) {});   // 每一条电报
 *   QVDmdata.on('status', function (s) {}); // 连接状态变化
 *   QVDmdata.status();  QVDmdata.stop();
 */
(function (global) {
  'use strict';

  var SUBPROTO = 'dmdata.v2';
  /* 只申请我们买了的那一档；以后升级 EEW 时在这里加 'eew.forecast' */
  var CLASSES = ['telegram.earthquake'];
  var BASE_WS = 'wss://ws.api.dmdata.jp/v2/websocket';

  /* ★★★ 2026-10-25 中转模式（默认开）
     dmdata 账号契约实测：`telegram.earthquake` 的 connectionCounts = **1**
     （websocket.plus2 / plus5 都没买）⇒ 整个账号同时只能有 1 条 WebSocket：
       · 多开一台设备 → 把前一条挤掉
       · App 里带 key → 谁拿到安装包谁就能占用这条唯一连接
     ⇒ 服务器（香港 konwk.com）维持唯一一条上游连接，App 全部连服务器。
       好处：① 不再有 1 条的限制 ② 浏览器版也能收到付费电报（原来不行）
             ③ key 只留在服务器。
     部署完 relay 后把 token 填进 RELAY_TOKEN（对应 relay/config.php 的 'token'）。
     ⚠ 置空 RELAY_BASE = '' → 退回「本机 key 直连」（只有 Electron 版可用）。 */
  var RELAY_BASE = 'wss://konwk.com/dmdata/ws';
  var RELAY_TOKEN = 'ac3d55e9b76392904ff7cbf1eb44b60b';
  var RELAY = RELAY_BASE + (RELAY_TOKEN ? ('?t=' + encodeURIComponent(RELAY_TOKEN)) : '');
  /* 中转模式下的观测点坐标表（服务器代拉并缓存 30 天，nginx 反代 /dmdata/station.json）
     ⚠ 这里必须把 ws(s) 换成 http(s)：坐标表是普通 HTTPS 请求，不是 WebSocket。 */
  var RELAY_STATION = RELAY_BASE.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
    .replace(/\/ws$/, '/station.json') +
    (RELAY_TOKEN ? ('?t=' + encodeURIComponent(RELAY_TOKEN)) : '');
  /* ★ 最近几场「震源・震度情報」（中转服务器用 REST 补拉 + 解析 JMAXML，缓存 5 分钟）
     —— WebSocket 只推连上之后的新电报，历史地震靠这个补。 */
  var RELAY_HISTORY = RELAY_BASE.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
    .replace(/\/ws$/, '/history.json') +
    (RELAY_TOKEN ? ('?t=' + encodeURIComponent(RELAY_TOKEN) + '&limit=12') : '?limit=12');

  var S = {
    on: false, ws: null, status: 'idle', retry: 0,
    lastAt: 0, count: 0, lastError: '', socketId: null, classes: CLASSES.slice()
  };
  var listeners = [];

  function emit(ev, data) {
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](ev, data); } catch (e) { } }
  }
  function snapshot() {
    return {
      on: S.on, status: S.status, count: S.count, lastAt: S.lastAt,
      lastError: S.lastError, socketId: S.socketId, classes: S.classes.slice()
    };
  }
  function setStatus(st, msg) {
    S.status = st;
    if (msg != null) S.lastError = String(msg);
    emit('status', snapshot());
    if (typeof console !== 'undefined' && console.log) {
      try { console.log('[dmdata] ' + st + (msg ? ' — ' + msg : '')); } catch (e) { }
    }
  }
  function bridge() {
    return (global.qv && global.qv.dmdata && typeof global.qv.dmdata.socket === 'function') ? global.qv.dmdata : null;
  }

  /* ---- base64 → gzip → 文本（XML 兜底路径用，正常走 formatMode=json）---- */
  function b64ToBytes(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function gunzipToText(b64, cb) {
    try {
      if (typeof DecompressionStream === 'undefined') return cb(new Error('no DecompressionStream'));
      var stream = new Blob([b64ToBytes(b64)]).stream().pipeThrough(new DecompressionStream('gzip'));
      new Response(stream).arrayBuffer().then(function (buf) {
        cb(null, new TextDecoder('utf-8').decode(buf));
      }, function (e) { cb(e); });
    } catch (e) { cb(e); }
  }

  function pickXml(text, tag) {
    var m = String(text || '').match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>'));
    return m ? m[1] : '';
  }

  /* ============ 电报 → 项目内统一结构 ============
   * 震度编码与 data.js 的 sParse 完全一致：1..4 / 50=5弱 / 55=5强 / 60=6弱 / 65=6强 / 70=7
   * dmdata JSON 里的写法是 `5-` / `5+` / `6-` / `6+` / `!5-`（5弱以上未入电） */
  var INT_VAL = {
    '1': 1, '2': 2, '3': 3, '4': 4,
    '5-': 50, '5+': 55, '6-': 60, '6+': 65, '7': 70,
    '!5-': 50, '5弱': 50, '5強': 55, '5强': 55, '6弱': 60, '6強': 65, '6强': 65
  };
  function intVal(s) {
    if (s == null || s === '') return -1;
    var k = String(s).trim();
    if (INT_VAL[k] != null) return INT_VAL[k];
    var n = parseFloat(k);
    if (!isFinite(n)) return -1;
    return n >= 7 ? 70 : n;
  }
  function tms(s) { var t = Date.parse(s || ''); return isFinite(t) ? t : 0; }
  function areaList(list) {
    return (list || []).map(function (a) {
      return {
        code: String((a && a.code) || ''),
        name: (a && a.name) || '',
        shindo: intVal(a && a.maxInt),
        lg: (a && a.maxLgInt != null) ? parseInt(a.maxLgInt, 10) : -1,
        revise: (a && a.revise) || ''
      };
    }).filter(function (a) { return !!a.code; });
  }
  function stationList(list) {
    return (list || []).map(function (a) {
      return {
        code: String((a && a.code) || ''),
        name: (a && a.name) || '',
        shindo: (a && a.int != null) ? intVal(a.int) : -1,
        lg: (a && a.lgInt != null) ? parseInt(a.lgInt, 10) : -1
      };
    }).filter(function (a) { return !!a.code || !!a.name; });
  }
  /* obj = WS data.body 解析出来的整封 JSON（head 字段在顶层，正文在 obj.body） */
  function parseEarthquake(obj, reportKey) {
    var h = obj || {}, b = h.body || {};
    var eq = b.earthquake || null;
    var it = b.intensity || null;
    var hp = (eq && eq.hypocenter) || {};
    var coord = hp.coordinate || {};
    function cval(o, k) { return (o && o[k] && o[k].value != null) ? parseFloat(o[k].value) : NaN; }
    var out = {
      kind: reportKey || '',                       /* VXSE51/52/53/62/40 */
      infoType: h.infoType || '',                  /* 発表 / 訂正 / 遅延 / 取消 */
      isCancel: h.infoType === '取消',
      isTest: h.status === '訓練' || h.status === '試験',
      typeName: h.type || '',                      /* 震源・震度に関する情報 */
      title: h.title || '',
      headline: h.headline || '',
      eventId: h.eventId || '',
      serial: h.serialNo != null ? String(h.serialNo) : '',
      reportMs: tms(h.reportDateTime),
      originMs: tms(eq && eq.originTime),
      place: hp.name || '',
      lat: cval(coord, 'latitude'),
      lon: cval(coord, 'longitude'),
      depthKm: cval(hp, 'depth'),
      mag: (eq && eq.magnitude && eq.magnitude.value != null) ? parseFloat(eq.magnitude.value) : NaN,
      maxShindo: -1,
      maxLg: -1,
      prefectures: [], regions: [], cities: [], stations: [],
      text: b.text || '',
      free: (b.comments && b.comments.free) || ''
    };
    if (it) {
      out.maxShindo = intVal(it.maxInt);
      out.maxLg = (it.maxLgInt != null) ? parseInt(it.maxLgInt, 10) : -1;
      out.prefectures = areaList(it.prefectures);
      out.regions = areaList(it.regions);
      out.cities = areaList(it.cities);
      out.stations = stationList(it.stations);
    }
    return out;
  }

  /* 一条 data 的统一外形（先不做业务解析，界面层再按 head.type 处理） */
  function handleData(msg) {
    S.lastAt = Date.now(); S.count++;
    var out = {
      classification: msg.classification || '',
      id: msg.id || '',
      head: msg.head || {},
      reportKey: (msg.head && msg.head.type) || '',
      test: !!(msg.head && msg.head.test),
      format: msg.format || '',
      json: null, xml: '', text: '', title: ''
    };
    if (msg.format === 'json') {
      var b = msg.body;
      try { out.json = (typeof b === 'string') ? JSON.parse(b) : b; } catch (e) { out.json = null; }
      if (global.QV_DMDATA_LOG !== false) {
        try { console.log('[dmdata] telegram ' + (out.reportKey || out.classification) + (out.test ? ' [TEST]' : '')); } catch (e) { }
      }
      emit('data', out);
      if (out.json) {
        var q = null;
        try { q = parseEarthquake(out.json, out.reportKey); } catch (e) { q = null; }
        if (q) {
          q.test = out.test || q.isTest;
          q.raw = out.json;
          if (global.QV_DMDATA_LOG !== false) {
            try { console.log('[dmdata] quake ' + q.kind + ' ' + q.infoType + ' ' + q.place + ' M' + q.mag + ' max=' + q.maxShindo + ' areas=' + q.regions.length); } catch (e) { }
          }
          emit('quake', q);
        }
      }
      return;
    }
    if (msg.format === 'xml' && msg.encoding === 'base64') {
      gunzipToText(msg.body, function (err, text) {
        if (err) { emit('error', err); return; }
        out.xml = text;
        out.title = pickXml(text, 'Title');
        emit('data', out);
      });
      return;
    }
    out.text = msg.body || '';
    emit('data', out);
  }

  function connect(url, socketId) {
    var ep = url || BASE_WS;
    var ws;
    /* ★ 中转模式不能带 subprotocol：
       Chrome 的规则是「客户端发了非空 Sec-WebSocket-Protocol，服务端必须回一个」，
       而 Workerman 的 websocket 握手不会回显它 →
       "Sent non-empty 'Sec-WebSocket-Protocol' header but no response was received"，
       握手直接失败（实测 2026-10-25）。直连 dmdata 时才需要 'dmdata.v2'。 */
    var isRelay = !!RELAY && ep === RELAY;
    try {
      ws = isRelay ? new WebSocket(ep) : new WebSocket(ep, [SUBPROTO]);
    } catch (e) { return onFail('构造 WebSocket 失败: ' + e.message); }
    S.ws = ws;
    S.socketId = socketId || null;
    setStatus('connecting', '');

    ws.onopen = function () {
      S.retry = 0;
      /* ★ 中转模式下服务器不一定回 start（它只是转发上游 data）→ 握手成功就算 open，
         否则状态会永远停在 connecting（实测踩过）。 */
      if (RELAY) setStatus('open', 'relay');
    };
    ws.onmessage = function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || !msg.type) return;
      if (msg.type === 'start') {
        if (msg.socketId != null) S.socketId = msg.socketId;
        setStatus('open', '');
        emit('start', msg);
        return;
      }
      if (msg.type === 'ping') {
        try { ws.send(JSON.stringify({ type: 'pong', pingId: msg.pingId })); } catch (e) { }
        return;
      }
      if (msg.type === 'pong') return;
      if (msg.type === 'data') { handleData(msg); return; }
      if (msg.type === 'error') {
        emit('error', msg);
        /* 4807 = 连接中的区分被解约（其他区分也没有了）→ 不再重连 */
        if (msg.code === 4807) { S.on = false; setStatus('stopped', msg.error || 'contract closed'); }
        else setStatus('error', (msg.code ? msg.code + ': ' : '') + (msg.error || ''));
        return;
      }
    };
    ws.onclose = function (ev) {
      S.ws = null;
      if (!S.on) { setStatus('closed', ''); return; }
      setStatus('reconnecting', 'code ' + (ev && ev.code));
      var delay = Math.min(30000, 1000 * Math.pow(2, Math.min(S.retry++, 5)));
      delay += Math.floor(Math.random() * 500);
      setTimeout(function () { if (S.on) start(true); }, delay);
    };
    ws.onerror = function () { /* 随后必到 onclose，交给它处理 */ };
  }

  function onFail(msg) {
    S.ws = null;
    if (!S.on) { setStatus('idle', msg); return; }
    setStatus('reconnecting', msg);
    var delay = Math.min(30000, 1000 * Math.pow(2, Math.min(S.retry++, 5)));
    setTimeout(function () { if (S.on) start(true); }, delay);
  }

  function start(force) {
    if (S.on && S.ws && !force) return;
    S.on = true;
    /* ① 中转模式：不需要 Electron 主进程、不需要本机 key */
    if (RELAY) {
      setStatus('starting', 'relay');
      connect(RELAY, null);
      return;
    }
    /* ② 本机直连（旧模式，受 connectionCounts=1 限制） */
    var br = bridge();
    if (!br) { S.on = false; setStatus('no-bridge', '需要 Electron 主进程（浏览器版不支持直连 dmdata）'); return; }
    setStatus('starting', '');
    br.socket(S.classes).then(function (r) {
      if (!S.on) return;
      if (!r || !r.ok) {
        /* 401 = 没有 key / key 无效；403 = key 没勾这一档契约 */
        S.on = false;
        setStatus('no-key', (r && (r.code + ': ' + r.message)) || 'socket start failed');
        return;
      }
      connect(r.url, r.socketId);
    }, function (e) { onFail(String((e && e.message) || e)); });
  }

  function stop() {
    S.on = false;
    if (S.ws) { try { S.ws.close(); } catch (e) { } S.ws = null; }
    setStatus('stopped', '');
  }

  global.QVDmdata = {
    start: function () { start(false); },
    stop: stop,
    status: snapshot,
    on: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    off: function (fn) {
      for (var i = 0; i < listeners.length; i++) if (listeners[i] === fn) { listeners.splice(i, 1); break; }
    },
    config: function () { var br = bridge(); return br ? br.config() : Promise.resolve({ has: false, hint: '', file: '' }); },
    /* ★ 中转模式下 App 没有 key，观测点坐标表由服务器提供（dmdata-ui 用） */
    relayStation: function () { return RELAY ? RELAY_STATION : ''; },
    /* ★ 中转模式下的历史电文（最近几场 VXSE53 的解析结果） */
    relayHistory: function () { return RELAY ? RELAY_HISTORY : ''; },
    /* 电报 JSON → 项目内统一结构（离线自测：QVDmdata.parse(json,'VXSE53')） */
    parse: parseEarthquake,
    /* 给控制台手测用：QVDmdata.raw('telegram.earthquake') */
    raw: function (classes) { if (Array.isArray(classes) && classes.length) S.classes = classes.slice(); return start(true); }
  };

  /* 开机自动连接：中转模式下直接连；本机直连要先确认有 key
     —— 延 3 秒避开首屏数据洪峰，也避开和 wolfx 的握手撞车 */
  if (typeof setTimeout === 'function') {
    setTimeout(function () {
      if (RELAY) { start(false); return; }
      var br = bridge();
      if (!br) return;
      br.config().then(function (c) {
        if (!c || !c.has) { setStatus('no-key', '没有找到 ' + ((c && c.file) || 'dmdata.json')); return; }
        start(false);
      }, function (e) { setStatus('no-key', String((e && e.message) || e)); });
    }, 3000);
  }
})(window);
