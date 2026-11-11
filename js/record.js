/* record.js — 事件录制 / 回放（记 API 层的报文，不是录视频）
 *
 * 为什么：出问题的时候最想知道的是「当时程序到底收到了什么」——
 *   哪一报、几点几分几秒、M/深度/震度是多少、来自哪个源、界面最后变成了什么样。
 *   截图和视频都回答不了「电文本身」，而且体积大得多。
 *
 * 记什么（三类，全部带毫秒时间戳）：
 *   k='ws'   wolfx WebSocket 的**原始帧**（未经解析，解析坏了一眼就能看出来）
 *   k='eew'  QVViews.onRealEew() 收到的**解析后**报文（= 界面真正吃进去的那一份）
 *   k='dm'   DM-D.S.S 电报（VXSE51/52/53/62 …）的解析结果
 *   k='poll' 轮询新增/变化的地震（CENC / USGS / P2P / JMA 明细 …）
 *
 * 存哪：
 *   · Electron（window.qv.rec 存在）→ 写到 userData/records/*.json + *.txt
 *   · 网页版 → 直接下载 .json / .txt（服务器端上传接口留待后续）
 *
 * 回放：按原始间隔重新喂进现有链路（EEW → onRealEew / 轮询 → QData.inject）。
 *   ⚠️ 回放时把「発生時刻」整体平移到现在，否则 P/S 波圆按几十小时前算，
 *      一上来就超时（600 秒上限）什么都不画。
 *
 * 文本时间轴格式照《地震示例手动时间轴》那三份样本，字段更全。
 *
 * 用法：QVRec.open()（设置页「其他 → 事件录制・回放」）
 */
(function (g) {
  'use strict';

  var MAX_EV = 8000;                 /* 环形缓冲：最多 8000 条 */
  var MAX_MS = 3 * 3600 * 1000;      /* 只留最近 3 小时 */
  var KEY_ON = 'qv.rec.on';
  var KEY_SIM = 'qv.rec.sim';        /* ★ 「记录模拟地震」开关（默认关） */

  var S = { on: false, buf: [], n: 0, startedAt: 0, hooked: false, seen: {}, replayT: [], playing: false, primed: false,
    optSim: false };
  var dlg = null, listEl = null, statEl = null, playBar = null;
  var API = 'api/rec.php';           /* 网页版的服务端接口（相对 index.html） */

  /* ---------------- 小工具 ---------------- */
  function pad(n, w) { n = String(n); w = w || 2; while (n.length < w) n = '0' + n; return n; }
  function hms(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function ymd(ms) { var d = new Date(ms); return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()); }
  function stamp(ms) {
    var d = new Date(ms);
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }
  function num(v) { return (v == null || v === '' || !isFinite(+v)) ? null : +v; }
  /** 震度码(0..4/50/55/60/65/70) → 「5弱」这类文本 */
  function shindoTxt(v) {
    v = +v;
    if (!isFinite(v) || v < 0) return '不明';
    if (v === 50) return '5弱'; if (v === 55) return '5強';
    if (v === 60) return '6弱'; if (v === 65) return '6強';
    if (v === 70) return '7';
    return String(v);
  }
  function isJp(feed, place) {
    return /jma|cwa|eew_jma|eew_cwa/.test(String(feed || '')) || /[県町村]/.test(String(place || ''));
  }
  /** 等级文本：「震度5弱」/「烈度4」 */
  function lvText(v, metric) {
    if (metric === 'liedu') { var n = +v; return (isFinite(n) && n >= 1) ? ('烈度' + n) : '不明'; }
    return '震度' + shindoTxt(v);
  }
  /** 状态卡片名：把电文/事件翻译成官方那套阶段名
   *  紧急地震速报 #02 / 调查中 #01 / 震源速报 #01 / 正式报 #01 / 海啸警报 #01 / 地震情报 #01 */
  var CARDN = {};
  function nextNo(key) { CARDN[key] = (CARDN[key] || 0) + 1; return CARDN[key]; }
  function cardOf(ev) {
    if (ev.card) return ev.card;
    var q = ev.q || {};
    if (ev.k === 'eew') {
      var n = q.seq || nextNo('eew');
      if (q.isCancel) return '取消报 #' + pad(n);
      return '紧急地震速报 #' + pad(n);
    }
    if (ev.k === 'dm') {
      var kd = String(q.kind || '');
      var sn = (q.serial != null) ? pad(q.serial) : pad(nextNo(kd || 'dm'));
      if (/^VXSE51$/.test(kd)) return '调查中 #' + sn;
      if (/^VXSE52$/.test(kd)) return '震源速报 #' + sn;
      if (/^VXSE53$/.test(kd)) return '正式报 #' + sn;
      if (/^VXSE62$/.test(kd)) return '长周期 #' + sn;
      if (/^VTSE(41|51|52)$/.test(kd)) return '海啸警报 #' + sn;
      return (kd || 'DM') + ' #' + sn;
    }
    if (ev.k === 'poll') {
      return '地震情报 #' + pad(nextNo('poll|' + (q.place || '') + '|' + (q.source || '')));
    }
    return ev.k || '';
  }
  /** 表格一行的 8 列：时间 / 状态卡片 / 震度·烈度 / 长地震周期 / 规模 / 深度 / 海啸 / API */
  function tokLine(ev) {
    var q = ev.q || {};
    var jp = q.liedu >= 1 ? false : true;
    var lv = (q.liedu >= 1) ? ('烈度' + q.liedu)
      : ((q.maxShindo >= 0 && q.maxShindo != null) ? ('震度' + shindoTxt(q.maxShindo))
        : ((q.shindo >= 0 && q.shindo != null) ? ('震度' + shindoTxt(q.shindo)) : '—'));
    var lg = (q.maxLg > 0) ? ('階級' + q.maxLg) : '—';
    var m = (num(q.mag) != null) ? (+q.mag).toFixed(1) : '—';
    var dep = (num(q.depthKm) != null) ? (Math.round(q.depthKm) + 'km') : '—';
    var tsu = '—';
    if (ev.k === 'dm' && /^VTSE/.test(String(q.kind || ''))) {
      tsu = /52$/.test(String(q.kind)) ? '警报' : '注意报';
    } else if (q.tsuKind) {
      tsu = String(q.tsuKind);
    }
    var api = ev.k === 'dm' ? ((q.kind || 'DM') + (q.codeType ? '' : ''))
      : ev.k === 'ws' ? ('WS ' + (ev.feed || ev.name || ''))
        : (q.source || q.feed || (ev.k === 'info' ? '—' : '?'));
    var card = cardOf(ev);
    var tag = '';
    if (ev.k === 'eew') {
      if (q.isWarn) tag = '[警報]';
      else if (q.isCancel) tag = '[取消]';
      else if (q.isFinal) tag = '[最終報]';
      else tag = '[予報]';
    }
    return [hms(ev.t), card + (tag ? tag : ''), lv, lg, m, dep, tsu, api].join('  ');
  }

  /* ---------------- 采集 ---------------- */
  function fmtVal(v) { return v; }

  function push(ev) {
    if (!S.on || S.quiet) return;
    /* ★ 模拟地震单独开关（默认关）：默认不把模拟出来的东西录进正式录像里，
       否则“模拟一场 M9.9”会混在真实事件里，回放时也分不清。
       判据：事件自己带 sim 标记（QData.inject 的模拟地震 q.sim == 1），
             或当下正处于模拟中（QVViews.simOn）。 */
    if (!S.optSim && isSimEv(ev)) return;
    ev.t = ev.t || Date.now();
    /* ★ 2026-10-29 回放时要把发生时刻整体平移到「现在」（否则 P/S 波圆按几小时前算，
       一上来就超时什么都不画；日本地震还会因为条目太旧而落在列表底部）。
       这里把「录到时它已经是多久前的事件」存下来，回放时用。 */
    if (ev.age == null && ev.q) {
      var _t0 = +ev.q.timeMs || +ev.q.originMs || 0;
      if (_t0 > 0) ev.age = Math.max(0, ev.t - _t0);
    }
    /* ★ 卡片名/编号在【记录时】就定下来：
       eew/dm 用电报自带的报号；地震情报用本场计数。
       以后重复生成时间轴/列表时不会再重新编号。 */
    if (!ev.card && ev.k !== 'ws' && ev.k !== 'info') {
      try { ev.card = cardOf(ev); } catch (e0) { }
    }
    S.buf.push(ev);
    S.n++;
    if (S.buf.length > MAX_EV) S.buf.splice(0, S.buf.length - MAX_EV);
    var cut = Date.now() - MAX_MS;
    while (S.buf.length && S.buf[0].t < cut) S.buf.shift();
    if (ev.k !== 'ws') uiKick();          /* 原始帧不逐条刷界面（太密） */
  }
  /** 这条事件是不是「模拟」产生的 */
  function isSimEv(ev) {
    if (!ev) return false;
    if (ev.sim) return true;
    if (ev.q && (ev.q.sim || ev.q.isSim)) return true;
    return !!(g.QVViews && g.QVViews.simOn);
  }
  /* 界面刷新防抖：密集来报时最多 2 次/秒 */
  var uiT = 0, uiPending = 0;
  function uiKick() {
    if (!dlg || dlg.className !== 'on') return;
    var n = Date.now();
    if (n - uiT < 500) {
      if (!uiPending) {
        uiPending = 1;
        setTimeout(function () { uiPending = 0; uiKick(); }, 500 - (n - uiT));
      }
      return;
    }
    uiT = n;
    refreshLive();
    paintList(); syncUi();
    if (UI.cur === '@live') { UI.view = { item: liveItem(), ev: S.buf.slice() }; renderDetail(UI.view); }
  }
  /** 把「正在录」那条从缓冲区重算一遍（列表里的数字/时长会跟着长） */
  function refreshLive() {
    var li = liveItem();
    var rest = UI.items.filter(function (x) { return !x.live; });
    UI.items = (li ? [li] : []).concat(rest);
  }

  /** ws.js 的原始帧钩子 */
  function raw(name, feed, payload) {
    if (!S.on) return;
    push({ k: 'ws', name: name || '', feed: feed || '', isEew: /_eew$/.test(String(feed || '')),
      raw: payload });
  }

  function slimQ(q) {
    if (!q) return null;
    return {
      id: q.id, source: q.source, feed: q.feed, isEew: !!q.isEew, eventId: q.eventId || '',
      seq: q.seq || 0, timeMs: q.timeMs || 0, pubMs: q.pubMs || 0,
      place: q.place || '', mag: num(q.mag), depthKm: num(q.depthKm), lat: num(q.lat), lon: num(q.lon),
      maxShindo: num(q.maxShindo), shindo: num(q.shindo), liedu: num(q.liedu),
      maxLg: num(q.maxLg), isWarn: !!q.isWarn, isFinal: !!q.isFinal, isCancel: !!q.isCancel,
      isAssumption: !!q.isAssumption, accuracy: q.accuracy || null, codeType: q.codeType || '',
      lowAccuracy: !!q.lowAccuracy,
      areas: (q.areas && q.areas.length) ? q.areas.slice(0, 200) : undefined
    };
  }

  function hook() {
    if (S.hooked) return true;
    var ok = true;
    /* ① 真实 EEW：包一层 QVViews.onRealEew（app.js 就是调这个） */
    if (g.QVViews && g.QVViews.onRealEew && !g.QVViews.onRealEew.__rec) {
      var orig = g.QVViews.onRealEew;
      var wrap = function (q) {
        try {
          if (S.on && q && q.isEew) push({ k: 'eew', q: slimQ(q), age: Math.max(0, Date.now() - (q.timeMs || Date.now())) });
        } catch (e) { }
        return orig.apply(this, arguments);
      };
      wrap.__rec = 1;
      g.QVViews.onRealEew = wrap;
    } else if (!g.QVViews) ok = false;

    /* ② 轮询：QData.on 每次 refresh 给整个 st，这里只记「新增 / 变了的」 */
    if (g.QData && g.QData.on && !g.QData.__recOn) {
      g.QData.__recOn = 1;
      g.QData.on(function (st) {
        if (!S.on || !st || !st.list) return;
        /* ★ 第一条 refresh 只是「已有数据的快照」：只建立基线，不刷几百条“新增” */
        if (!S.primed) {
          S.primed = true;
          for (var j = 0; j < st.list.length && j < 400; j++) {
            var b = st.list[j];
            if (!b || !b.id) continue;
            S.seen[b.id] = 1;
            S.seen[b.id + '|' + (b.pubMs || 0) + '|' + (b.seq || 0) + '|' + (b.liedu || '') + '|' + (b.maxShindo || '')] = 1;
          }
          push({ k: 'info', note: '基线：启动时列表已有 ' + st.list.length + ' 条地震记录（不逐条记录）' });
          return;
        }
        for (var i = 0; i < st.list.length && i < 400; i++) {
          var q = st.list[i];
          if (!q || !q.id) continue;
          /* ★ 只记「最近 3 小时内发生」的地震：JMA 列表里几十天前的历史条目
             每次刷新都会被细分区域明细回填一次（pubMs/震度变化）→ 一刷新就刷出上百条噪声。 */
          if (q.timeMs && Date.now() - q.timeMs > 3 * 3600 * 1000) continue;
          var key = q.id + '|' + (q.pubMs || 0) + '|' + (q.seq || 0) + '|' + (q.liedu || '') + '|' + (q.maxShindo || '');
          if (S.seen[key]) continue;
          var isNew = !S.seen[q.id];
          S.seen[key] = 1;
          if (isNew) S.seen[q.id] = 1;
          push({ k: 'poll', q: slimQ(q), isNew: isNew });
        }
      });
    } else if (!g.QData) ok = false;

    /* ③ DM-D.S.S 电报（dmdata-ui 也是这么拿的） */
    if (g.QVDmdata && g.QVDmdata.on && !g.QVDmdata.__recOn) {
      g.QVDmdata.__recOn = 1;
      g.QVDmdata.on(function (ev, payload) {
        if (!S.on || ev !== 'data' || !payload) return;
        try {
          var body = payload.body || payload;
          var head = body.head || {};
          var j = (body.json) || {};
          var kind = head.type || head.test || j.type || '';
          var eq = j.body || j;
          var sh = eq.earthquake || eq;
          var inten = sh.intensity || eq.intensity || {};
          var q = {
            kind: String(kind), eventId: String(head.eventId || sh.eventId || ''),
            serial: sh.serial != null ? sh.serial : null,
            place: (sh.hypocenter && (sh.hypocenter.name || sh.hypocenter.detailedName)) || '',
            mag: num(sh.hypocenter && sh.hypocenter.magnitude),
            depthKm: num(sh.hypocenter && sh.hypocenter.depth),
            lat: num(sh.hypocenter && sh.hypocenter.latitude),
            lon: num(sh.hypocenter && sh.hypocenter.longitude),
            maxShindo: (inten.maxIntensity != null) ? num(inten.maxIntensity) : null,
            maxLg: num(sh.maxIntLongPer || null)
          };
          push({ k: 'dm', q: q, raw: payload });
        } catch (e) { }
      });
    } else if (!g.QVDmdata) ok = false;

    S.hooked = ok;
    return ok;
  }

  /* ---------------- 开关 ---------------- */
  function start(silent) {
    if (S.on) return;
    if (!hook()) { setTimeout(function () { if (!S.on) start(silent); }, 800); }
    S.on = true;
    S.primed = false;             /* 下一条 refresh 只当基线 */
    S.seen = {};
    S.startedAt = Date.now();
    try { localStorage.setItem(KEY_ON, '1'); } catch (e) { }
    if (!silent && g.QVViews && g.QVViews.toast) QVViews.toast('开始录制事件（API 层）');
    syncUi();
    if (dlg && dlg.className === 'on') { refreshLive(); paintList(); }
  }
  function stop(silent) {
    if (!S.on) return;
    S.on = false;
    try { localStorage.setItem(KEY_ON, '0'); } catch (e) { }
    if (!silent && g.QVViews && g.QVViews.toast) QVViews.toast('已停止录制（' + S.buf.length + ' 条）');
    syncUi();
    if (dlg && dlg.className === 'on') { refreshLive(); paintList(); }
  }

  /* ---------------- 导出 ---------------- */
  function dump() {
    return { v: 1, app: 'ZQuake', at: Date.now(), startedAt: S.startedAt, n: S.buf.length, ev: S.buf };
  }

  /** 人类可读时间轴（照《地震示例手动时间轴》格式，字段更全） */
  function timeline() {
    var L = [];
    var evs = S.buf.filter(function (e) { return e.k !== 'ws'; });   /* 原始帧不进正文，JSON 里留 */
    var rows = evs.filter(function (e) { return e.k !== 'info'; });   /* 基线不是事件，放表头 */
    var base = evs.filter(function (e) { return e.k === 'info'; })[0];
    var srcCnt = {};
    rows.forEach(function (e) {
      var k = e.k === 'eew' ? ((e.q && (e.q.source || e.q.feed)) || 'EEW')
        : e.k === 'dm' ? 'DM-D.S.S'
          : ((e.q && (e.q.source || e.q.feed)) || '轮询');
      srcCnt[k] = (srcCnt[k] || 0) + 1;
    });
    var t0 = rows.length ? rows[0].t : S.startedAt || Date.now();
    var t1 = rows.length ? rows[rows.length - 1].t : Date.now();
    var main = rows.filter(function (e) { return e.k === 'eew'; })[0] ||
      rows.filter(function (e) { return e.k === 'poll'; })[0] || null;
    var mq = main && main.q;

    L.push((ymd(t0) + '  ' + (mq ? (mq.place || '震源不明') + (num(mq.mag) ? ' M' + (+mq.mag).toFixed(1) : '') : '事件') +
      ' 全过程   ZQuake模拟器 自动录制（API 层事件，非录像）'));
    L.push('录制 ' + hms(t0) + ' → ' + hms(t1) + '（' + Math.round((t1 - t0) / 1000) + ' 秒）  共 ' + rows.length + ' 条情报 / ' +
      S.buf.filter(function (e) { return e.k === 'ws'; }).length + ' 条原始帧' +
      (base ? ('  基线：启动时列表已有 ' + String(base.note || '').replace(/\D+/g, '') + ' 条（不逐条记录）') : ''));
    var parts = [];
    for (var k in srcCnt) parts.push(k + ' ' + srcCnt[k]);
    L.push('来源：' + parts.join(' · '));
    L.push('');
    /* 列头：时间 / 状态卡片 / 震度·烈度 / 长地震周期 / 规模 / 深度 / 海啸 / API */
    L.push('时间      状态卡片            震度·烈度  长地震周期  规模   深度     海啸    API');
    L.push('--------  ------------------  ---------  ----------  -----  ------  -----  -------------');
    rows.forEach(function (e) { L.push(tokLine(e)); });
    return L.join('\n');
  }

  function dl(name, text, mime) {
    try {
      var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) { } }, 3000);
      return true;
    } catch (e) { return false; }
  }

  function save() {
    if (!S.buf.length) { if (g.QVViews && QVViews.toast) QVViews.toast('还没有录到任何事件'); return; }
    var base = 'eewrec-' + stamp(S.buf[0].t);
    var js = JSON.stringify(dump());
    var tx = timeline();
    var br = (g.qv && g.qv.rec) ? g.qv.rec : null;
    if (br && br.save) {
      /* 桌面版：写 userData/records/ */
      br.save(base + '.json', js).then(function (r) {
        if (g.QVViews && QVViews.toast) QVViews.toast(r && r.ok ? ('已保存 ' + base + '.json') : ('保存失败：' + ((r && r.message) || '')));
        refreshSaved();
      }, function (e) {
        if (g.QVViews && QVViews.toast) QVViews.toast('保存失败：' + ((e && e.message) || e));
      });
      br.save(base + '.txt', tx);
      return;
    }
    /* 网页版：先传服务器（api/rec.php 会清洗 + 落盘 + 建索引），失败才退回本地下载 */
    if (g.QVViews && QVViews.toast) QVViews.toast('正在上传到服务器…');
    fetch(API + '?action=save', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, name: base, json: dump(), txt: tx })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) {
        if (g.QVViews && QVViews.toast) QVViews.toast('已存到服务器：' + j.id + '（' + j.n + ' 条）');
        refreshSaved();
      } else {
        dl(base + '.json', js, 'application/json');
        dl(base + '.txt', tx, 'text/plain');
        if (g.QVViews && QVViews.toast) QVViews.toast('服务器不可用（' + ((j && j.message) || '?') + '），已改为下载');
      }
    }, function () {
      dl(base + '.json', js, 'application/json');
      dl(base + '.txt', tx, 'text/plain');
      if (g.QVViews && QVViews.toast) QVViews.toast('服务器连不上，已改为下载');
    });
  }

  /* ---------------- 回放 ---------------- */
  function clearReplayTimers() {
    S.replayT.forEach(function (t) { clearTimeout(t); });
    S.replayT = []; S.playing = false; S.quiet = false;
  }

  function fire(ev) {
    try {
      /* ★★★ 2026-10-29 用户：「地震记录回放日本记录不了」
       —— 两个真因都在这两个分支里：
         ① poll 分支以前把 発生時刻 原样还原成【原始时刻】
            （Date.now() - (Date.now() - q.timeMs) 恒等于 q.timeMs），
            回放几小时前的日本地震时，条目落在列表很下面、卡片还是旧时间
            → 看上去就像「回放了但什么都没发生」。
         ② 录制器以前只把 EEW 写进 k='eew'，而日本 EEW 在部分网络下
            只能从 60 秒轮询进来（不经过 onRealEew）→ 一份录像里只有一条 poll，
            回放被「事件太少，没法回放」拦住。
       ⇒ 现在统一按「录下来的间隔」整体平移到现在。 */
      var dt = Date.now() - (+ev.t || Date.now());
      if (ev.k === 'eew' && ev.q && g.QVViews && QVViews.onRealEew) {
        var q = JSON.parse(JSON.stringify(ev.q));
        /* 発生時刻整体平移到「刚刚」：保持「发生时 → 发报」的间隔，
           否则 P/S 波圆按几十小时前算，一上来就超时什么都不画。 */
        if (q.timeMs) q.timeMs = (+q.timeMs) + dt;
        if (q.pubMs) q.pubMs = (+q.pubMs) + dt;
        q.eventId = String(q.eventId || '') + '#rp';
        /* ★ 2026-11-04：回放豁免 EEW 时效门槛（旧录像里录到的本来就是历史事件） */
        q.__replay = 1;
        QVViews.onRealEew(q);
      } else if (ev.k === 'poll' && ev.q && g.QData && QData.inject) {
        var p = JSON.parse(JSON.stringify(ev.q));
        if (p.timeMs) p.timeMs = (+p.timeMs) + dt;
        if (p.pubMs) p.pubMs = (+p.pubMs) + dt;
        QData.inject(p);
      } else if (ev.k === 'dm' && ev.q && g.QVViews && QVViews.applyMeasured) {
        var d = ev.q;
        QVViews.applyMeasured({
          kind: d.kind, originMs: Date.now(), maxShindo: d.maxShindo, maxLg: d.maxLg,
          serial: d.serial, mag: d.mag, depthKm: d.depthKm, place: d.place, lat: d.lat, lon: d.lon,
          /* ★ 2026-10-29 事件号要一起还原 —— views.applyMeasured 靠它判断
             「这条 VXSE51/53 属于哪一场」，回放时不能丢。 */
          eventId: d.eventId || ''
        });
      } else {
        return;
      }
      if (g.QVRedraw) QVRedraw();
    } catch (e) { }
  }

  function replay(speed, fromMs) {
    var evs = viewEvents();
    if (!evs.length) evs = S.buf.filter(function (e) { return e.k !== 'ws' && e.k !== 'info'; });
    /* ★ 2026-10-29 用户：「地震记录回放日本记录不了」
       —— 一场日本地震（尤其是只能从 60 秒轮询拿到的那一段）常常只录到 **1 条**事件，
          以前 `< 2` 就直接拦下（toast「事件太少，没法回放」）→ 看起来就是日本没法回放。
          单条也应该能播：立刻 fire 一次，把画面摆到那一条的状态。 */
    if (!evs.length) { if (g.QVViews && QVViews.toast) QVViews.toast('这份录像里还没有情报，没法回放'); return; }
    clearReplayTimers();
    var sp = +speed || 10;
    var base = evs[0].t, off = Math.max(0, +fromMs || 0);
    S.playing = true;
    /* ★ 回放期间暂停录制，否则回放出来的事件又被记一遍（时间轴会重复） */
    S.quiet = true;
    S.playBase = base; S.playOff = off; S.playStart = Date.now(); S.playSp = sp;
    var lastAt = 0;
    evs.forEach(function (ev) {
      var at = (ev.t - base - off) / sp;
      if (at <= 0) { fire(ev); return; }            /* 定位点之前的事件：直接瞬间补上状态 */
      if (at > lastAt) lastAt = at;
      S.replayT.push(setTimeout(function () { fire(ev); }, at));
    });
    S.replayT.push(setTimeout(function () {
      S.quiet = false; S.playing = false; stopPlayTick(); syncUi();
    }, lastAt + 1200));
    startPlayTick();
    if (g.QVViews && QVViews.toast) QVViews.toast('开始回放（' + sp + '×，共 ' + evs.length + ' 条）');
    syncUi();
  }
  /* 播放条进度（按真实时间走） */
  var playTick = 0;
  function startPlayTick() {
    stopPlayTick();
    playTick = setInterval(function () {
      if (!S.playing || !dlg) { stopPlayTick(); return; }
      var evs = viewEvents();
      if (evs.length < 2) return;
      var total = evs[evs.length - 1].t - evs[0].t;
      if (!(total > 0)) return;
      var pass = (Date.now() - S.playStart) * S.playSp + S.playOff;
      var f = Math.max(0, Math.min(1, pass / total));
      var fill = dlg.querySelector('#qvrecFill'), knob = dlg.querySelector('#qvrecKnob'), tm = dlg.querySelector('#qvrecTm');
      if (fill) fill.style.width = (f * 100) + '%';
      if (knob) knob.style.left = (f * 100) + '%';
      if (tm) tm.textContent = fmtDur(evs[0].t, evs[0].t + Math.min(total, pass)) + ' / ' + fmtDur(evs[0].t, evs[evs.length - 1].t);
    }, 120);
  }
  function stopPlayTick() { if (playTick) { clearInterval(playTick); playTick = 0; } }
  function stopReplay() {
    clearReplayTimers();
    stopPlayTick();
    syncUi();
    if (g.QVViews && QVViews.toast) QVViews.toast('已停止回放');
  }

  /* ---------------- 面板 UI（2026-10-27 换成「固定卡片 + 8 列表格」版） ----------------
   * 版式来自桌面示例页 koneew-rec-manager.html（用户自己调的），这里做了三件事：
   *   ① 所有选择器收进 #qvrec，避免污染 app 自己的 header/.row/.badge
   *   ② 左列表 = 录制列表（当前正在录的那份 + 已保存的），右详情 = 该录制的 8 列时间轴
   *   ③ 播放条接真的回放（播放/暂停/倍速/拖动定位）
   */
  var UI = { items: [], cur: null, sel: {}, kw: '', filter: 'all', view: null };

  function fmtDate(ms) { var d = new Date(ms); return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()); }
  function fmtDur(a, b) { var s = Math.max(0, Math.round((b - a) / 1000)); return Math.floor(s / 60) + '分' + pad(s % 60) + '秒'; }
  function fmtSize(n) { n = +n || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function escapeHtml(s) { return esc(s); }
  function badgeOf(it) {
    if (it.maxLiedu) { var l = Math.min(7, Math.max(1, Math.round(+it.maxLiedu / 2))); return { text: '烈' + it.maxLiedu, cls: 'b' + l }; }
    var v = it.maxShindo;
    if (v == null || v < 0) return { text: '—', cls: 'bX' };
    var M = { 0: ['0', 'bX'], 1: ['1', 'b1'], 2: ['2', 'b2'], 3: ['3', 'b3'], 4: ['4', 'b4'],
      50: ['5弱', 'b5'], 55: ['5強', 'b5'], 60: ['6弱', 'b6'], 65: ['6強', 'b6'], 70: ['7', 'b7'] };
    var m = M[v] || [String(v), 'bX'];
    return { text: m[0], cls: m[1] };
  }

  function css() {
    if (document.getElementById('qvrec-css')) return;
    var s = document.createElement('style');
    s.id = 'qvrec-css';
    s.textContent = [
      '#qvrec{--bg:#0f172a;--panel:#1e293b;--panel-2:#182233;--line:#334155;--line-soft:rgba(255,255,255,.06);',
      '--text:#f8fafc;--muted:#94a3b8;--dim:#64748b;--primary:#3b82f6;--primary-dark:#2563eb;--danger:#ef4444;--warning:#f59e0b;',
      '--r-sm:4px;--r-md:6px;--list-w:clamp(340px,38vw,560px);--card-h:80px;',
      'position:fixed;inset:0;z-index:9997;display:none;background:var(--bg);color:var(--text);',
      "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans SC','Microsoft YaHei UI',sans-serif}",
      '#qvrec.on{display:block}',
      '#qvrec .wrap{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--bg)}',
      /* 顶栏 */
      '#qvrec header{display:flex;align-items:center;gap:16px;padding:14px 22px;border-bottom:1px solid var(--line);background:rgba(15,23,42,.6)}',
      '#qvrec header h1{margin:0;font-size:17px;font-weight:800;display:flex;align-items:center;gap:10px}',
      '#qvrec header h1 .dot{width:8px;height:8px;border-radius:50%;background:var(--primary);box-shadow:0 0 10px var(--primary)}',
      '#qvrec .spacer{flex:1}',
      '#qvrec .stats{display:flex;gap:20px}',
      '#qvrec .stats .kv{text-align:right;line-height:1.25}',
      '#qvrec .stats .kv b{display:block;font-size:16px;font-weight:800;font-variant-numeric:tabular-nums}',
      '#qvrec .stats .kv span{font-size:11px;color:var(--muted);font-weight:600}',
      '#qvrec .x{background:none;border:0;color:var(--muted);font-size:22px;line-height:1;cursor:pointer;padding:0 6px;margin-left:8px}',
      '#qvrec .x:hover{color:var(--text)}',
      /* 工具条 */
      '#qvrec .toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:11px 22px;border-bottom:1px solid var(--line);background:var(--panel)}',
      '#qvrec .search{position:relative}',
      '#qvrec .search input{width:230px;padding:8px 30px 8px 12px;border-radius:var(--r-md);border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:13px;outline:none}',
      '#qvrec .search input:focus{border-color:var(--primary)}',
      "#qvrec .search::after{content:'⌕';position:absolute;right:10px;top:50%;transform:translateY(-52%);color:var(--dim);font-size:16px}",
      '#qvrec .seg{display:flex;border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden}',
      '#qvrec .seg button{padding:7px 13px;background:var(--bg);color:var(--muted);border:0;border-right:1px solid var(--line);font-size:12px;font-weight:600;cursor:pointer}',
      '#qvrec .seg button:last-child{border-right:0}',
      '#qvrec .seg button:hover{color:var(--text)}',
      '#qvrec .seg button.on{background:var(--primary);color:#fff;border-color:var(--primary)}',
      '#qvrec .btn{padding:7px 13px;border-radius:var(--r-md);border:1px solid var(--line);background:var(--panel-2);color:var(--text);font-size:12.5px;font-weight:600;cursor:pointer}',
      '#qvrec .btn:hover{background:var(--line)}',
      '#qvrec .btn.pri{background:var(--primary);border-color:var(--primary);color:#fff}',
      '#qvrec .btn.pri:hover{background:var(--primary-dark)}',
      '#qvrec .btn.rec{background:#7f1d1d;border-color:#b91c1c;color:#fff}',
      '#qvrec .btn.ghost{background:transparent;color:var(--muted)}',
      '#qvrec .btn:disabled{opacity:.4;cursor:not-allowed}',
      '#qvrec .toolbar .right{margin-left:auto;display:flex;gap:10px;align-items:center}',
      '#qvrec .hint{color:var(--dim);font-size:12px;font-weight:600}',
      '#qvrec .chk{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;user-select:none;padding:6px 10px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--bg)}',
      '#qvrec .chk:hover{color:var(--text)}',
      '#qvrec .chk input{accent-color:var(--primary);width:14px;height:14px;cursor:pointer}',
      '#qvrec .chk.on{color:var(--text);border-color:var(--primary)}',
      /* 主体 */
      '#qvrec main{flex:1;display:flex;min-height:0}',
      '#qvrec .list{width:var(--list-w);flex:0 0 var(--list-w);border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0;background:var(--bg)}',
      '#qvrec .list-head{display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-bottom:1px solid var(--line);background:var(--panel);font-size:12px;font-weight:700;color:var(--muted);z-index:2}',
      '#qvrec .list-head label{display:flex;align-items:center;gap:8px;cursor:pointer}',
      '#qvrec .list-head input[type=checkbox]{accent-color:var(--primary);width:15px;height:15px;cursor:pointer}',
      '#qvrec .list .body{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}',
      /* 固定卡片 */
      '#qvrec .row{display:flex;align-items:center;height:var(--card-h);background:var(--panel-2);border:1px solid var(--line);border-radius:var(--r-md);padding:0 14px;gap:12px;cursor:pointer;position:relative;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,.2);transition:background .18s,border-color .18s,transform .18s}',
      '#qvrec .row:hover{background:#1e293b;border-color:rgba(59,130,246,.5);transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.3)}',
      '#qvrec .row.sel{background:rgba(59,130,246,.08);border-color:var(--primary);box-shadow:inset 3px 0 0 var(--primary)}',
      '#qvrec .row .row-ck{flex:0 0 20px;display:flex;align-items:center}',
      '#qvrec .row input[type=checkbox]{accent-color:var(--primary);width:16px;height:16px;cursor:pointer}',
      '#qvrec .row .row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
      '#qvrec .row .place{font-size:15px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#qvrec .row .meta{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);font-weight:600;white-space:nowrap;overflow:hidden}',
      '#qvrec .row .meta .dur{color:var(--dim)}',
      '#qvrec .row .meta .src-dot{width:3px;height:3px;border-radius:50%;background:var(--dim)}',
      '#qvrec .row .row-metrics{flex:0 0 128px;display:flex;align-items:center;justify-content:flex-end;gap:12px}',
      '#qvrec .row .metric-mag{font-size:18px;font-weight:900;color:var(--primary);font-family:monospace;letter-spacing:-.5px;line-height:1;width:52px;text-align:right}',
      '#qvrec .row .metric-mag.dim{color:var(--dim);font-size:15px;font-family:inherit;font-weight:700}',
      '#qvrec .row .row-extra{flex:0 0 66px;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:2px;font-size:11px;color:var(--dim);font-weight:600;line-height:1.2}',
      '#qvrec .row .row-extra .n-ev{color:var(--muted)}',
      '#qvrec .badge{display:inline-flex;align-items:center;justify-content:center;width:44px;height:26px;border-radius:var(--r-sm);font-size:12px;font-weight:800;color:#0f172a;flex:0 0 auto}',
      '#qvrec .b1{background:#e2e8f0}#qvrec .b2{background:#bae6fd}#qvrec .b3{background:#7dd3fc}#qvrec .b4{background:#fef08a}',
      '#qvrec .b5{background:#fcd34d}#qvrec .b6{background:#fdba74}#qvrec .b7{background:#ef4444;color:#fff}',
      '#qvrec .bX{background:var(--line);color:var(--muted)}',
      /* 详情 */
      '#qvrec .detail{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--bg)}',
      '#qvrec .detail .empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--dim);gap:10px}',
      '#qvrec .detail .empty .big{font-size:40px;opacity:.3}',
      '#qvrec .dhead{padding:18px 20px;border-bottom:1px solid var(--line);background:var(--panel)}',
      '#qvrec .dhead .t1{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
      '#qvrec .dhead .t1 h2{margin:0;font-size:19px;font-weight:900}',
      '#qvrec .dhead .t1 .m{color:var(--primary);font-weight:900;font-size:17px;font-family:monospace}',
      '#qvrec .dhead .t2{display:flex;gap:20px;flex-wrap:wrap;margin-top:9px;color:var(--muted);font-size:12px;font-weight:600}',
      '#qvrec .dhead .t2 b{color:var(--text);font-weight:700}',
      '#qvrec .tl{flex:1;overflow:auto;min-height:0}',
      '#qvrec .tl table{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px}',
      '#qvrec .tl thead th{position:sticky;top:0;z-index:2;background:#162032;font-weight:700;font-size:11px;color:var(--muted);text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}',
      '#qvrec .tl tbody td{padding:8px 12px;border-bottom:1px solid var(--line-soft);white-space:nowrap}',
      '#qvrec .tl tbody tr:hover td{background:rgba(255,255,255,.02)}',
      '#qvrec .tl td.t{color:var(--dim);font-variant-numeric:tabular-nums;font-family:monospace}',
      '#qvrec .tl td.c{color:var(--text)}',
      '#qvrec .tl td.n{color:#cbd5e1;font-variant-numeric:tabular-nums}',
      '#qvrec .tl td.api{color:var(--dim);font-size:11px;font-family:monospace}',
      '#qvrec .tl .card{display:inline-flex;align-items:center;gap:8px;font-weight:600}',
      "#qvrec .tl .card::before{content:'';width:4px;height:14px;border-radius:2px;background:var(--dim)}",
      '#qvrec .tl .card.k-eew::before{background:var(--danger)}',
      '#qvrec .tl .card.k-dm::before{background:var(--warning)}',
      '#qvrec .tl .card.k-poll::before{background:#10b981}',
      '#qvrec .tl .card.k-ws::before{background:var(--muted)}',
      '#qvrec .tl .tag{font-size:10px;padding:1px 4px;border-radius:3px;margin-left:6px;background:var(--line);color:var(--muted)}',
      '#qvrec .tl .tag.warn{background:rgba(239,68,68,.2);color:#fca5a5}',
      '#qvrec .tl .foot{color:var(--dim);font-size:11px;padding:16px;text-align:center}',
      /* 播放条 */
      '#qvrec .player{border-top:1px solid var(--line);background:var(--panel);padding:11px 20px;display:flex;align-items:center;gap:14px}',
      '#qvrec .player .pbtn{width:36px;height:36px;border-radius:50%;border:1px solid var(--primary);background:var(--primary);color:#fff;font-size:13px;cursor:pointer;flex:none;display:flex;align-items:center;justify-content:center}',
      '#qvrec .player .pbtn:hover{background:var(--primary-dark)}',
      '#qvrec .player .pbtn.sec{background:transparent;color:var(--muted);border-color:var(--line)}',
      '#qvrec .player .pbtn.sec:hover{background:var(--line);color:var(--text)}',
      '#qvrec .player .track{flex:1;height:6px;border-radius:3px;background:var(--line);position:relative;cursor:pointer}',
      '#qvrec .player .track .fill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:3px;background:var(--primary)}',
      '#qvrec .player .track .knob{position:absolute;left:0;top:50%;width:12px;height:12px;border-radius:50%;background:#fff;transform:translate(-50%,-50%);box-shadow:0 0 0 3px rgba(59,130,246,.3)}',
      '#qvrec .player .tm{font-variant-numeric:tabular-nums;color:var(--muted);font-size:12px;font-weight:700;flex:none}',
      '#qvrec .player select{background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:var(--r-sm);padding:6px 8px;font-size:12px;font-weight:600;outline:none}',
      '#qvrec ::-webkit-scrollbar{width:8px;height:8px}',
      '#qvrec ::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px}',
      '#qvrec ::-webkit-scrollbar-thumb:hover{background:var(--dim)}'
    ].join('');
    document.head.appendChild(s);
  }

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function build() {
    css();
    dlg = el('div', '');
    dlg.id = 'qvrec';
    dlg.innerHTML =
      '<div class="wrap">' +
      '<header><h1><span class="dot"></span>事件录制・回放</h1>' +
      '<div class="spacer"></div>' +
      '<div class="stats">' +
      '<div class="kv"><b id="qvrecN">0</b><span>份录制</span></div>' +
      '<div class="kv"><b id="qvrecSize">0 KB</b><span>占用</span></div>' +
      '<div class="kv"><b id="qvrecEv">0</b><span>总事件</span></div>' +
      '<div class="kv"><b id="qvrecLast">—</b><span>最近一次</span></div>' +
      '</div><button class="x" id="qvrecX" title="关闭">×</button></header>' +

      '<div class="toolbar">' +
      '<div class="search"><input id="qvrecQ" placeholder="搜索地点 / M / 震度"></div>' +
      '<div class="seg" id="qvrecSeg">' +
      '<button class="on" data-f="all">全部</button>' +
      '<button data-f="live">正在录</button>' +
      '<button data-f="eew">含 EEW</button>' +
      '<button data-f="today">今天</button>' +
      '</div>' +
      '<button class="btn" id="qvrecReload">刷新</button>' +
      '<button class="btn pri" id="qvrecRec">开始录制</button>' +
      '<button class="btn" id="qvrecSave2">保存当前</button>' +
      '<label class="chk" id="qvrecSimWrap" title="模拟出来的地震（模拟面板/Enter 跳阶段）也一起记录；默认关，免得模拟数据混进真实录像"><input type="checkbox" id="qvrecSim"> 记录模拟</label>' +
      '<div class="right">' +
      '<span class="hint" id="qvrecSelInfo">未选择</span>' +
      '<button class="btn" id="qvrecDl" disabled>导出所选</button>' +
      '<button class="btn" id="qvrecDel" disabled>删除所选</button>' +
      '</div></div>' +

      '<main>' +
      '<section class="list">' +
      '<div class="list-head"><label><input type="checkbox" id="qvrecAll"> 全选</label><span id="qvrecCount">共 0 条</span></div>' +
      '<div class="body" id="qvrecList"></div>' +
      '</section>' +
      '<section class="detail" id="qvrecDetail">' +
      '<div class="empty"><div class="big">▤</div><div>从左侧选择一份录像进行回放</div></div>' +
      '</section>' +
      '</main></div>';
    document.body.appendChild(dlg);
    listEl = dlg.querySelector('#qvrecList');

    dlg.querySelector('#qvrecX').addEventListener('click', close);
    dlg.querySelector('#qvrecQ').addEventListener('input', function (e) { UI.kw = e.target.value.trim(); paintList(); });
    dlg.querySelector('#qvrecSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      [].forEach.call(dlg.querySelector('#qvrecSeg').children, function (x) { x.classList.toggle('on', x === b); });
      UI.filter = b.dataset.f; paintList();
    });
    dlg.querySelector('#qvrecReload').addEventListener('click', function () { refreshSaved(); });
    /* 记录模拟：默认关；开了才把模拟面板造出来的地震/海啸事件写进缓冲 */
    var simCk = dlg.querySelector('#qvrecSim'), simWrap = dlg.querySelector('#qvrecSimWrap');
    simCk.checked = !!S.optSim;
    if (simWrap) simWrap.classList.toggle('on', !!S.optSim);
    simCk.addEventListener('change', function () {
      S.optSim = !!simCk.checked;
      if (simWrap) simWrap.classList.toggle('on', S.optSim);
      try { localStorage.setItem(KEY_SIM, S.optSim ? '1' : '0'); } catch (e) { }
      if (g.QVViews && QVViews.toast) QVViews.toast('记录模拟：' + (S.optSim ? '开' : '关'));
    });
    dlg.querySelector('#qvrecRec').addEventListener('click', function () { S.on ? stop() : start(); });
    dlg.querySelector('#qvrecSave2').addEventListener('click', save);
    dlg.querySelector('#qvrecAll').addEventListener('change', function (e) {
      UI.sel = {};
      if (e.target.checked) visibleItems().forEach(function (it) { UI.sel[it.id] = 1; });
      paintList(); syncSel();
    });
    dlg.querySelector('#qvrecDl').addEventListener('click', function () {
      var ids = Object.keys(UI.sel);
      if (g.QVViews && QVViews.toast) QVViews.toast('导出所选（' + ids.length + ' 份）—— 还没接');
    });
    dlg.querySelector('#qvrecDel').addEventListener('click', function () {
      var ids = Object.keys(UI.sel);
      if (g.QVViews && QVViews.toast) QVViews.toast('删除所选（' + ids.length + ' 份）—— 还没接');
    });

    /* 列表：勾选 / 选中 */
    listEl.addEventListener('click', function (e) {
      var ck = e.target.closest('input[type=checkbox]');
      if (ck) {
        var id = ck.dataset.ck;
        if (ck.checked) UI.sel[id] = 1; else delete UI.sel[id];
        syncSel(); paintList(); return;
      }
      var row = e.target.closest('.row');
      if (!row) return;
      selectItem(row.dataset.id);
    });

    /* 详情里的播放条 */
    dlg.addEventListener('click', function (e) {
      if (e.target.id === 'qvrecPlay') {
        if (S.playing) { stopReplay(); }
        else { replay(UI.speed || 10, 0); }
      }
      if (e.target.id === 'qvrecHome') { replay(UI.speed || 10, 0); }
      if (e.target.id === 'qvrecTrack') {
        var r = e.target.getBoundingClientRect();
        var f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        var evs = viewEvents();
        if (evs.length > 1) replay(UI.speed || 10, (evs[evs.length - 1].t - evs[0].t) * f);
      }
    });
    dlg.addEventListener('change', function (e) {
      if (e.target.id === 'qvrecSpeed') { UI.speed = +String(e.target.value).replace(/[^\d.]/g, '') || 10; }
    });
  }

  /* ---- 列表数据 ---- */
  function liveItem() {
    var evs = S.buf.filter(function (e) { return e.k !== 'ws' && e.k !== 'info'; });
    if (!evs.length) return null;
    var mq = null;
    for (var i = 0; i < evs.length; i++) { if (evs[i].q && evs[i].q.place) { mq = evs[i].q; break; } }
    var srcs = {};
    evs.forEach(function (e) { if (e.q && e.q.source) srcs[e.q.source] = 1; });
    /* ★ 震度 / 烈度不能混：先看主震用的是哪套刻度，只统计同一套
       （以前一场日本地震和一条青海烈度混在一个卡片上 → 日本 M4.1 却标「烈4」） */
    var metric = null;
    for (var m0 = 0; m0 < evs.length; m0++) {
      var q0 = evs[m0].q;
      if (!q0) continue;
      if (q0.liedu >= 1) { metric = 'liedu'; break; }
      if (q0.maxShindo != null && q0.maxShindo >= 0) { metric = 'shindo'; break; }
    }
    var maxSh = null, maxLi = null, maxLg = null, mag = null;
    evs.forEach(function (e) {
      var q = e.q; if (!q) return;
      if (metric !== 'liedu' && q.maxShindo != null && q.maxShindo >= 0 && (maxSh == null || q.maxShindo > maxSh)) maxSh = q.maxShindo;
      if (metric === 'liedu' && q.liedu != null && q.liedu >= 1 && (maxLi == null || q.liedu > maxLi)) maxLi = q.liedu;
      if (q.maxLg > 0 && (maxLg == null || q.maxLg > maxLg)) maxLg = q.maxLg;
      if (q.mag && !mag) mag = q.mag;
    });
    return {
      id: '@live', live: true, place: (mq && mq.place) || '（正在录制）',
      t0: evs[0].t, t1: evs[evs.length - 1].t,
      n: evs.length, nWs: S.buf.length - evs.length,
      size: JSON.stringify(S.buf).length,
      mag: mag, maxShindo: maxSh, maxLiedu: maxLi, maxLg: maxLg,
      src: Object.keys(srcs)
    };
  }
  function visibleItems() {
    var out = UI.items.slice();
    var kw = UI.kw.toLowerCase();
    return out.filter(function (it) {
      if (kw) {
        var hay = ((it.place || '') + ' M' + (it.mag == null ? '' : it.mag) + ' ' + (it.maxShindo == null ? '' : it.maxShindo) + ' ' + (it.maxLiedu == null ? '' : it.maxLiedu)).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      if (UI.filter === 'live') return !!it.live;
      if (UI.filter === 'eew') return (it.src || []).some(function (s) { return /EEW/.test(s); });
      if (UI.filter === 'today') {
        var d = new Date(), a = new Date(it.t0);
        return a.getFullYear() === d.getFullYear() && a.getMonth() === d.getMonth() && a.getDate() === d.getDate();
      }
      return true;
    });
  }

  /** 已保存的录制：Electron 读 userData/records，网页版读 api/rec.php?action=list */
  function refreshSaved() {
    var br = (g.qv && g.qv.rec) ? g.qv.rec : null;
    if (br && br.list) {
      br.list().then(function (r) {
        var items = [];
        ((r && r.items) || []).forEach(function (f) {
          if (!/\.json$/i.test(f.name)) return;
          items.push({ id: 'file:' + f.name, file: f.name, place: f.name.replace(/^eewrec-|\.json$/g, ''), t0: f.mtime || 0, t1: f.mtime || 0, n: 0, nWs: 0, size: f.size, src: [] });
        });
        UI.items = (liveItem() ? [liveItem()] : []).concat(items);
        paintList(); syncUi();
      }, function () { paintList(); });
      return;
    }
    fetch(API + '?action=list&limit=60', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var items = ((j && j.items) || []).map(function (it) {
        return { id: 'srv:' + it.id, sid: it.id, place: it.place || '（无地震）', t0: it.t0, t1: it.t1,
          n: it.n, nWs: it.nWs, size: it.size || 0, mag: it.mag,
          maxShindo: it.maxShindo, maxLiedu: it.maxLiedu, maxLg: it.maxLg, src: it.src || [] };
      });
      UI.items = (liveItem() ? [liveItem()] : []).concat(items);
      paintList(); syncUi();
    }, function () {
      UI.items = (liveItem() ? [liveItem()] : []);
      paintList(); syncUi();
    });
  }

  function selectItem(id) {
    var it = UI.items.filter(function (x) { return x.id === id; })[0];
    UI.cur = id;
    if (!it) { UI.view = null; paintList(); renderDetail(null); return; }
    if (it.live) { UI.view = { item: it, ev: S.buf.slice() }; paintList(); renderDetail(UI.view); return; }
    if (it.file) {                                     /* 桌面版：读本地 json */
      var br = (g.qv && g.qv.rec);
      br.read(it.file).then(function (r) {
        if (!r || !r.ok) return;
        var d = {}; try { d = JSON.parse(r.body); } catch (e) { }
        UI.view = { item: it, ev: d.ev || [] };
        paintList(); renderDetail(UI.view);
      });
      return;
    }
    fetch(API + '?action=get&type=json&id=' + encodeURIComponent(it.sid), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { UI.view = { item: it, ev: (d && d.ev) || [] }; paintList(); renderDetail(UI.view); },
        function () { UI.view = { item: it, ev: [] }; paintList(); renderDetail(UI.view); });
  }

  function viewEvents() { return UI.view ? UI.view.ev.filter(function (e) { return e.k !== 'ws' && e.k !== 'info'; }) : []; }

  function paintList() {
    if (!listEl) return;
    var rows = visibleItems();
    dlg.querySelector('#qvrecCount').textContent = '共 ' + rows.length + ' 条';
    if (!rows.length) {
      listEl.innerHTML = '<div class="hint" style="padding:26px 0;text-align:center">还没有可回放的录像' +
        (S.on ? '（正在录制，稍等第一条事件）' : '，点「开始录制」') + '</div>';
      return;
    }
    listEl.innerHTML = rows.map(function (it) {
      var b = badgeOf(it);
      var magStr = it.mag ? 'M' + (+it.mag).toFixed(1) : '—';
      var srcTxt = (it.src && it.src.length) ? (it.src[0] + (it.src.length > 1 ? ' 等' : '')) : (it.live ? '正在录制' : '');
      return '<div class="row' + (UI.cur === it.id ? ' sel' : '') + '" data-id="' + esc(it.id) + '">' +
        '<div class="row-ck"><input type="checkbox" data-ck="' + esc(it.id) + '"' + (UI.sel[it.id] ? ' checked' : '') + '></div>' +
        '<div class="row-main"><div class="place" title="' + esc(it.place) + '">' + esc(it.place || '（无地震）') + '</div>' +
        '<div class="meta"><span>' + (it.t0 ? fmtDate(it.t0).slice(5) + ' ' + hms(it.t0) : '') + '</span>' +
        (it.t1 > it.t0 ? '<span class="dur">· ' + fmtDur(it.t0, it.t1) + '</span>' : '') +
        '<span class="src-dot"></span><span>' + esc(srcTxt) + '</span></div></div>' +
        '<div class="row-metrics"><div class="metric-mag' + (it.mag ? '' : ' dim') + '">' + magStr + '</div>' +
        '<div class="badge ' + b.cls + '">' + esc(b.text) + '</div></div>' +
        '<div class="row-extra"><span class="n-ev">' + (it.n || 0) + '事件</span><span>' + fmtSize(it.size) + '</span></div>' +
        '</div>';
    }).join('');
    syncSel();
  }

  function syncSel() {
    if (!dlg) return;
    var n = Object.keys(UI.sel).length;
    dlg.querySelector('#qvrecSelInfo').textContent = n ? ('已选 ' + n + ' 份') : '未选择';
    dlg.querySelector('#qvrecDl').disabled = !n;
    dlg.querySelector('#qvrecDel').disabled = !n;
  }

  /** 一条事件 → 表格的 8 个格子 */
  function evCells(ev) {
    var q = ev.q || {};
    var lv = (q.liedu >= 1) ? ('烈度' + q.liedu)
      : ((q.maxShindo != null && q.maxShindo >= 0) ? ('震度' + shindoTxt(q.maxShindo))
        : ((q.shindo != null && q.shindo >= 0) ? ('震度' + shindoTxt(q.shindo)) : ''));
    var lg = (q.maxLg > 0) ? ('階級' + q.maxLg) : '';
    var m = (num(q.mag) != null) ? ('M' + (+q.mag).toFixed(1)) : '';
    var dep = (num(q.depthKm) != null) ? (Math.round(q.depthKm) + 'km') : '';
    var tsu = '';
    if (ev.k === 'dm' && /^VTSE/.test(String(q.kind || ''))) tsu = /52$/.test(String(q.kind)) ? '警报' : '注意报';
    else if (q.tsuKind) tsu = String(q.tsuKind);
    var api = (ev.k === 'dm') ? (q.kind || 'DM')
      : (ev.k === 'ws') ? ('WS ' + (ev.feed || ev.name || ''))
        : (q.source || q.feed || '');
    var tag = '';
    if (ev.k === 'eew') tag = q.isWarn ? '警報' : (q.isCancel ? '取消報' : (q.isFinal ? '最終報' : '予報'));
    if (isSimEv(ev)) tag = (tag ? tag + '·' : '') + '模拟';
    return { t: hms(ev.t), k: ev.k, card: cardOf(ev), tag: tag, warn: !!q.isWarn,
      lv: lv, lg: lg, m: m, dep: dep, tsu: tsu, api: api };
  }

  function renderDetail(view) {
    var host = dlg && dlg.querySelector('#qvrecDetail');
    if (!host) return;
    if (!view) {
      host.innerHTML = '<div class="empty"><div class="big">▤</div><div>从左侧选择一份录像进行回放</div></div>';
      return;
    }
    var it = view.item, b = badgeOf(it);
    var rows = viewEvents().map(function (ev) {
      var c = evCells(ev);
      var tag = c.tag ? '<span class="tag' + (c.warn ? ' warn' : '') + '">' + esc(c.tag) + '</span>' : '';
      var dash = function (v) { return v ? esc(v) : '<span style="color:var(--dim)">—</span>'; };
      return '<tr><td class="t">' + c.t + '</td>' +
        '<td class="c"><span class="card k-' + esc(c.k) + '">' + esc(c.card) + tag + '</span></td>' +
        '<td class="n">' + dash(c.lv) + '</td><td class="n">' + dash(c.lg) + '</td>' +
        '<td class="n">' + dash(c.m) + '</td><td class="n">' + dash(c.dep) + '</td>' +
        '<td class="n">' + dash(c.tsu) + '</td><td class="api">' + dash(c.api) + '</td></tr>';
    }).join('');

    host.innerHTML =
      '<div class="dhead"><div class="t1"><h2>' + esc(it.place || '（无地震）') + '</h2>' +
      (it.mag ? '<span class="m">M' + (+it.mag).toFixed(1) + '</span>' : '') +
      '<span class="badge ' + b.cls + '" style="width:auto;padding:0 8px">' + esc(b.text) + '</span></div>' +
      '<div class="t2"><span>时间 <b>' + (it.t0 ? fmtDate(it.t0) + ' ' + hms(it.t0) : '—') +
      (it.t1 && it.t1 > it.t0 ? ' → ' + hms(it.t1) : '') + '</b></span>' +
      '<span>时长 <b>' + (it.t1 > it.t0 ? fmtDur(it.t0, it.t1) : '—') + '</b></span>' +
      '<span>事件 <b>' + viewEvents().length + '</b> / 帧 <b>' + (it.nWs || 0) + '</b></span>' +
      '<span>大小 <b>' + fmtSize(it.size) + '</b></span>' +
      (it.live ? '<span style="color:#f59e0b">● 正在录制</span>' : '') +
      '</div></div>' +
      '<div class="tl"><table><thead><tr><th>时间</th><th>状态卡片</th><th>震度 / 烈度</th>' +
      '<th>长地震周期</th><th>规模</th><th>深度</th><th>海啸</th><th>API源</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="foot">' + (viewEvents().length ? '— ' + viewEvents().length + ' 条情报（原始帧在导出的 JSON 里）—' : '这份录像里还没有情报') + '</div></div>' +
      '<div class="player">' +
      '<button class="pbtn" id="qvrecPlay" title="播放 / 暂停">' + (S.playing ? '❚❚' : '▶') + '</button>' +
      '<button class="pbtn sec" id="qvrecHome" title="从头回放">⏮</button>' +
      '<div class="track" id="qvrecTrack"><div class="fill" id="qvrecFill"></div><div class="knob" id="qvrecKnob"></div></div>' +
      '<div class="tm" id="qvrecTm">00:00 / ' + (it.t1 > it.t0 ? fmtDur(it.t0, it.t1) : '—') + '</div>' +
      '<select id="qvrecSpeed"><option>1×</option><option>2×</option><option selected>10×</option><option>30×</option><option>60×</option></select>' +
      '</div>';
  }

  function syncUi() {
    if (!dlg) return;
    var b = dlg.querySelector('#qvrecRec');
    if (b) { b.textContent = S.on ? '停止录制' : '开始录制'; b.className = 'btn ' + (S.on ? 'rec' : 'pri'); }
    var n = UI.items.length, size = 0, ev = 0, last = 0;
    UI.items.forEach(function (it) { size += (+it.size || 0); ev += (+it.n || 0); if ((+it.t0 || 0) > last) last = +it.t0; });
    var set = function (id, v) { var e = dlg.querySelector(id); if (e) e.textContent = v; };
    set('#qvrecN', String(n)); set('#qvrecSize', fmtSize(size)); set('#qvrecEv', String(ev));
    set('#qvrecLast', last ? (fmtDate(last).slice(5) + ' ' + hms(last).slice(0, 5)) : '—');
    var btn = dlg.querySelector('#qvrecPlay');
    if (btn) btn.textContent = S.playing ? '❚❚' : '▶';
  }

  function open() {
    if (!dlg) build();
    dlg.className = 'on';
    hook();
    refreshSaved();
    if (UI.cur) selectItem(UI.cur);
    syncUi();
  }
  function close() {
    if (dlg) dlg.className = '';
    stopReplay();
  }

  /* ---------------- 开机自动续录（上次开着的继续录） ---------------- */
  function boot() {
    var want = false, sim = false;
    try { want = localStorage.getItem(KEY_ON) === '1'; } catch (e) { }
    try { sim = localStorage.getItem(KEY_SIM) === '1'; } catch (e) { }   /* 默认关 */
    S.optSim = !!sim;
    if (want) start(true);
    hook();
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 1200);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 1200); });
  }

  g.QVRec = {
    open: open, close: close,
    start: start, stop: stop, isOn: function () { return S.on; },
    raw: raw,
    dump: dump, timeline: timeline, save: save,
    replay: replay, stopReplay: stopReplay,
    /* 调试：QVRec.pushTest() 手工塞一条，验证面板/导出 */
    _push: push, _buf: function () { return S.buf; }
  };
})(window);
