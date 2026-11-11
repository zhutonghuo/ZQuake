/* ws.js — 实时推送层：wolfx WebSocket（服务端主动推，延迟远低于轮询）
 *
 * 为什么用这个而不抄官方的 API：
 *   官方快是因为它是「服务端推送」而非轮询；它自己的通道是作者自建私有云
 *   （clouddata-srev.kothn.net），底层是他付费订阅的 dmdata.jp，
 *   且原项目 terms.md 明确禁止以本服务以外的方式访问其内部 API。
 *   所以这里走等价的公开推送：wolfx 提供同名 WebSocket 频道。
 *
 * 频道（与 KonTP 项目一致）：
 *   wss://ws-api.wolfx.jp/{jma_eew,cenc_eew,sc_eew,fj_eew,cq_eew,jma_eqlist,cenc_eqlist}
 *   心跳包形如 {"type":"heartbeat"}，业务包含 type 与数据字段。
 */
(function (global) {
  'use strict';
  /** 中文地名规范化（与 data.js 同一套：南南西 → 西南偏南） */
  function cnPlace(s) {
    var t = String(s == null ? '' : s);
    return (global.QVPZ && global.QVPZ.clean) ? global.QVPZ.clean(t) : t;
  }

  /* 实测：eew 频道可用；eqlist 频道返回 503（服务端未开放），
     故只连 EEW；已地震列表由轮询（data.js）负责。
     ⚠ cq_eew 实测也是 503（重庆源已停）→ 已移除，否则每 5 秒白重连一次。 */
  var FEEDS = ['jma_eew', 'cwa_eew', 'cenc_eew', 'sc_eew', 'fj_eew'];
  var BASE = 'wss://ws-api.wolfx.jp/';
  var RECONNECT_MS = 5000;

  var S = { on: false, sockets: {}, status: {}, lastMsgAt: 0, count: 0 };
  var listeners = [];

  function emit(ev, data) {
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](ev, data); } catch (e) { } }
  }

  function parseEew(tag, o) {
    if (!o || typeof o !== 'object') return null;
    var F = global.Fmt;
    function pick() {
      for (var i = 1; i < arguments.length; i++) {
        var k = arguments[i];
        if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
      }
      return undefined;
    }
    var isJp = (tag === 'jma' || tag === 'cwa');
    var tz = isJp ? 'Asia/Tokyo' : 'Asia/Shanghai';
    /* ★ timeMs = 発生時刻（OriginTime），pubMs = 発報時刻
       —— 与 data.js srcEewOne 保持一致，否则 WS 推的和轮询抓的同一条地震
          时间会差 30~60 秒，分组判定（sameEvent ≤ 90 秒）就靠运气了。 */
    var at = pick('AnnouncedTime', 'ReportTime', 'time');
    var ot = pick('OriginTime') || at;
    var d = ot ? F.parse(ot, tz) : null;
    var dp = at ? F.parse(at, tz) : null;
    var q = {
      id: 'EEW:' + tag + ':' + (pick('EventID', 'ID') || ot),
      source: tag.toUpperCase() + '_EEW', feed: 'eew_' + tag, isEew: true, timeMs: d ? d.getTime() : 0,
      pubMs: dp ? dp.getTime() : 0,
      place: cnPlace(pick('Hypocenter', 'HypoCenter', 'location', 'placeName')),
      mag: parseFloat(pick('Magunitude', 'Magnitude')),
      depthKm: parseFloat(String(pick('Depth', 'depth') || '').replace(/[^\d.\-]/g, '')),
      lat: parseFloat(pick('Latitude', 'latitude')), lon: parseFloat(pick('Longitude', 'longitude')),
      detail: String(pick('Title', 'CodeType') || ''), maxShindo: -1, shindo: -1,
      liedu: -1,
      seq: parseInt(pick('Serial', 'ReportNum'), 10) || 0,
      isFinal: !!pick('isFinal'), isAssumption: !!pick('isAssumption'),
      isCancel: !!pick('isCancel'), isTraining: !!pick('isTraining'),
      /* ★ 2026-10-23 新增：警報标志 / 警报区域 / 定位精度（推不推定的门槛） */
      eventId: String(pick('EventID', 'ID') || ''),
      isWarn: !!pick('isWarn'),
      warnArea: pick('WarnArea') || [],
      accuracy: pick('Accuracy') || null,
      codeType: String(pick('CodeType') || ''),
      isSea: !!pick('isSea')
    };
    /* ★ 震度 vs 烈度：jma / cwa（日、台）= 震度；大陆各地预警 = 烈度 */
    if (tag === 'jma' || tag === 'cwa') {
      var sv = global.QData && global.QData.parseShindo ? global.QData.parseShindo(pick('MaxIntensity', 'shindo')) : -1;
      if (sv >= 0) { q.shindo = sv; q.maxShindo = sv; }
    } else {
      var li = parseFloat(pick('MaxIntensity', 'intensity'));
      if (isFinite(li) && li >= 1) q.liedu = li;
    }
    if (!q.timeMs) q.timeMs = Date.now();
    return q;
  }

  function parseEq(tag, o) {
    if (!o || typeof o !== 'object') return null;
    var F = global.Fmt;
    function pick() {
      for (var i = 1; i < arguments.length; i++) {
        var k = arguments[i];
        if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
      }
      return undefined;
    }
    var t = pick('time_full', 'time', 'OriginTime', 'at');
    var d = t ? F.parse(t, tag === 'cenc_eqlist' ? 'Asia/Shanghai' : 'Asia/Tokyo') : null;
    var q = {
      id: (tag === 'cenc_eqlist' ? 'CENC:' : 'JMA:') + (pick('EventID', 'ID') || t),
      source: tag === 'cenc_eqlist' ? 'CENC' : 'JMA', feed: tag === 'cenc_eqlist' ? 'cenc' : 'jmaeq',
      isEew: false,
      timeMs: d ? d.getTime() : 0,
      place: cnPlace(pick('location', 'placeName', 'en_anm', 'anm')),
      mag: parseFloat(pick('magnitude', 'Magunitude')),
      depthKm: parseFloat(String(pick('depth', 'dep') || '').replace(/[^\d.\-]/g, '')),
      lat: parseFloat(pick('latitude', 'lat')), lon: parseFloat(pick('longitude', 'lon')),
      detail: String(pick('info', 'ttl') || ''), maxShindo: -1, shindo: -1, liedu: -1
    };
    var sv = global.QData && global.QData.parseShindo ? global.QData.parseShindo(pick('shindo', 'maxIntensity')) : -1;
    if (tag !== 'cenc_eqlist' && sv >= 0) { q.shindo = sv; q.maxShindo = sv; }
    var li = parseFloat(pick('intensity', 'MaxIntensity'));
    if (isFinite(li) && li >= 1) q.liedu = li;
    return q.timeMs ? q : null;
  }

  function open(feed) {
    var url = BASE + feed;
    var ws;
    try { ws = new WebSocket(url); } catch (e) { S.status[feed] = 'err'; return; }
    S.sockets[feed] = ws;

    ws.onopen = function () { S.status[feed] = 'open'; emit('open', { feed: feed }); };
    ws.onclose = function () { S.status[feed] = 'closed'; emit('close', { feed: feed });
      if (S.on) setTimeout(function () { if (S.on) open(feed); }, RECONNECT_MS); };
    ws.onerror = function () { S.status[feed] = 'error'; };
    ws.onmessage = function (e) {
      var raw = e && e.data; if (!raw) return;
      var j; try { j = JSON.parse(raw); } catch (err) { return; }
      if (!j || j.type === 'heartbeat') { S.lastMsgAt = Date.now(); return; }
      S.lastMsgAt = Date.now(); S.count++;
      var payload = j.data || j;
      /* ★ 2026-10-27 事件录制：原始帧（未解析）也留一份，解析坏了能对账 */
      if (global.QVRec && global.QVRec.raw) { try { QVRec.raw('ws', feed, payload); } catch (eR) { } }
      var isEew = /_eew$/.test(feed);
      var q = isEew ? parseEew(feed.replace(/_eew$/, ''), payload) : parseEq(feed, payload);
      if (q && !q.isCancel && !q.isTraining) emit('quake', q);
    };
  }

  var W = {
    start: function () {
      if (S.on) return;
      S.on = true;
      for (var i = 0; i < FEEDS.length; i++) open(FEEDS[i]);
    },
    stop: function () {
      S.on = false;
      for (var k in S.sockets) { try { S.sockets[k].close(); } catch (e) { } }
      S.sockets = {};
    },
    on: function (f) { listeners.push(f); },
    status: function () { return { on: S.on, feeds: S.status, count: S.count, lastMsgAt: S.lastMsgAt }; }
  };
  global.QVWs = W;
})(window);
