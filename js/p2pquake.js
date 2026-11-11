/* p2pquake.js — P2PQuake JSON API v2（免费、无 key）紧急地震速报推送层
 *
 * 为什么加这一层（2026-10-28）：
 *   现在震前那一段只有 wolfx 一家（ws.js）。P2PQuake 是日本社群做的
 *   气象厅电文中继，v2 有两套接口：
 *     · REST  https://api.p2pquake.net/v2/history?codes=556   （data.js 里 551 已在用）
 *     · WSS   wss://api.p2pquake.net/v2/ws                    （本文件）
 *   实测 556 电文带 **areas[].arrivalTime**（一条 205 区域里 164 个非 null），
 *   这是 wolfx 的 jma_eew 拿不到的 —— 详情页「预计 XX 秒后到达」就靠它。
 *
 * 实测约束（2026-10-28，必须遵守，否则会被挡）：
 *   · Origin: null（file:// 页面 / Electron 渲染进程）→ 101 Switching Protocols ✅
 *   · 短时间内连续握手 → **HTTP 429 Too Many Requests**
 *     ⇒ 重连最小间隔 30 秒，指数退避到 5 分钟，绝不做「秒级重连」
 *   · 没有 ping/pong 应用层心跳；无事件时**长时间不推任何数据**（正常，不代表断线）
 *
 * 数据映射（关键）：
 *   P2P 的 scale 码 : 10 20 30 40 45 50 55 60 70
 *   JMA 含义        : 1  2  3  4 5弱 5強 6弱 6強 7
 *   本项目内部编码   : 1  2  3  4 50 55 60 65 70   ← 与 data.js sParse 一致，震度7 = 70
 *   ⚠ data.js 里老表 P2P_SCALE 的 `70: 7` 与 sParse 的 70 不一致，见文件末尾注释
 *
 * 用法：
 *   QVP2P.on(function (ev, q) { ... });   // ev: 'quake' | 'status' | 'open' | 'close'
 *   QVP2P.start();  QVP2P.stop();  QVP2P.status();
 */
(function (global) {
  'use strict';

  var WS_URL = 'wss://api.p2pquake.net/v2/ws';
  var MIN_RETRY = 30000;    /* ★ 30 秒起步：实测更快会被 429 */
  var MAX_RETRY = 300000;   /* 封顶 5 分钟 */

  /* JMA scale 码 → 项目内部编码 */
  var SCALE = { 0: -1, 10: 1, 20: 2, 30: 3, 40: 4, 45: 50, 50: 55, 55: 60, 60: 65, 70: 70 };
  function toShindo(v) { var s = SCALE[v]; return s == null ? -1 : s; }

  var S = {
    on: false, ws: null, status: 'idle', count: 0,
    lastMsgAt: 0, lastOpenAt: 0, retry: 0, lastError: '', lastCode: 0
  };
  var listeners = [];
  var timer = null;

  function emit(ev, data) {
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](ev, data); } catch (e) { } }
  }
  function snapshot() {
    return { on: S.on, status: S.status, count: S.count, lastMsgAt: S.lastMsgAt,
      lastOpenAt: S.lastOpenAt, lastCode: S.lastCode, lastError: S.lastError };
  }
  function setStatus(st, msg) {
    S.status = st;
    if (msg != null) S.lastError = String(msg);
    emit('status', snapshot());
  }
  function pj(s) {
    var F = global.Fmt;
    if (!s) return null;
    return (F && F.parse) ? F.parse(s, 'Asia/Tokyo') : null;
  }

  /* ---------------- 556 → 项目统一事件对象 ---------------- */
  function parseEew(o) {
    if (!o || o.code !== 556) return null;
    var eq = o.earthquake || {}, hp = eq.hypocenter || {}, iss = o.issue || {};
    if (!hp.name && !o.cancelled) return null;

    var lat = parseFloat(hp.latitude), lon = parseFloat(hp.longitude);
    var mag = parseFloat(hp.magnitude), dep = parseFloat(hp.depth);
    if (!isFinite(lat) || !isFinite(lon)) { lat = NaN; lon = NaN; }

    /* 逐区域：预计震度区间 + 到达时刻 */
    var maxS = -1, areas = [];
    var list = o.areas || [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var from = toShindo(a.scaleFrom), to = toShindo(a.scaleTo);
      if (to > maxS) maxS = to;
      var at = pj(a.arrivalTime);
      areas.push({
        pref: a.pref || '', name: a.name || '', kind: a.kindCode || '',
        from: from, to: to,
        /* 预计到达（ms）。0 = 这一报没给该区域的到达时刻 */
        arrivalMs: at ? at.getTime() : 0
      });
    }

    var t = pj(eq.originTime), p = pj(iss.time);
    var q = {
      /* ★ id 不带报数：QData.inject 按 id 去重 → 同一条地震的多报就地更新，
         否则 serial 1/2/3 会在列表里堆成三条。报数看 q.seq。 */
      id: 'P2PEEW:' + (iss.eventId || ''),
      source: 'P2P', feed: 'eew_p2p', isEew: true,
      timeMs: t ? t.getTime() : (p ? p.getTime() : 0), pubMs: p ? p.getTime() : 0,
      lat: lat, lon: lon,
      depthKm: isFinite(dep) ? dep : -1,
      mag: isFinite(mag) ? mag : -1,
      place: hp.name || '',
      shindo: maxS, maxShindo: maxS, liedu: -1,
      tsunami: 0, detail: 'P2P 紧急地震速报', detailJson: '',
      seq: parseInt(iss.serial, 10) || 0,
      isFinal: !!(o.final || o.isFinal || (iss && (iss.type === 'Final' || /final/i.test(String(iss.type || ''))))),
      isCancel: !!o.cancelled,
      /* ⚠ P2P 不单独给「训练/测试」标记（实测 M9.9 那条训练电文也没有） */
      isTraining: !!(o.test || /training|test/i.test(String(iss.type || ''))),
      isAssumption: false,
      eventId: String(iss.eventId || ''),
      /* P2P 不给警報标志；判「低精度」靠 accuracy 文本，这里留空 = 不可判 → 不拦 */
      isWarn: false, accuracy: { Epicenter: '' },
      /* ★ 本层独有：逐区域到达时刻（详情页用） */
      eewAreas: areas,
      reduceName: String(hp.reduceName || '').trim()
    };
    if (!q.timeMs) q.timeMs = Date.now();
    return q;
  }

  /* ---------------- 连接 ---------------- */
  function open() {
    if (!S.on) return;
    if (S.ws) { try { S.ws.close(); } catch (e) { } S.ws = null; }

    var ws;
    try { ws = new WebSocket(WS_URL); }
    catch (e) { setStatus('err', e && e.message); schedule(); return; }
    S.ws = ws;

    ws.onopen = function () {
      S.retry = 0; S.lastOpenAt = Date.now();
      setStatus('open');
      emit('open', snapshot());
    };
    ws.onclose = function (e) {
      S.lastCode = (e && e.code) || 0;
      setStatus('closed', 'code ' + S.lastCode + (e && e.reason ? ' ' + e.reason : ''));
      emit('close', snapshot());
      if (S.on) schedule();
    };
    ws.onerror = function () { setStatus('error'); };
    ws.onmessage = function (e) {
      var raw = e && e.data; if (!raw) return;
      S.lastMsgAt = Date.now();
      var j; try { j = JSON.parse(raw); } catch (err) { return; }
      if (!j) return;
      S.count++;
      if (global.QVRec && QVRec.raw) { try { QVRec.raw('ws', 'eew_p2p', j); } catch (eR) { } }
      /* 只接管 556；551/552/553… 交给 data.js 的轮询，避免同一份数据两条路径 */
      if (j.code !== 556) return;
      var q = parseEew(j);
      if (q) emit('quake', q);
    };
  }

  function schedule() {
    if (!S.on) return;
    S.retry = Math.min(S.retry + 1, 5);
    var wait = Math.min(MAX_RETRY, MIN_RETRY * Math.pow(2, S.retry - 1));
    setStatus('retry', wait);
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; open(); }, wait);
  }

  var W = {
    start: function () {
      if (S.on) return;
      S.on = true;
      open();
    },
    stop: function () {
      S.on = false;
      if (timer) { clearTimeout(timer); timer = null; }
      if (S.ws) { try { S.ws.close(); } catch (e) { } S.ws = null; }
      setStatus('idle');
    },
    on: function (f) { if (typeof f === 'function') listeners.push(f); },
    status: snapshot,
    /* 自测钩子：不联网也能验解析 */
    _parse: parseEew,
    _toShindo: toShindo
  };
  global.QVP2P = W;
})(window);
