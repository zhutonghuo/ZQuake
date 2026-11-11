/* replay.js —— 近一个月「真电文」全程回放
 *
 * 为什么要有：用户要对照的不是「最终那张填色图」，而是**0 → 结束的整个流程**
 *   （震度速報 → 震源に関する情報 → 震源・震度情報 陆续进来），
 *   这些在 JMA 的 bosai/quake/data/list.json 里是**多条电文**，每条有自己的发布时刻。
 *   以前选一场地震只能看到「最全那一份」，中间过程全被 jmaDetailOf 的「择优」吞掉了。
 *
 * 做法：
 *   1. list.json 按 eid 分组 → 每场地震拿到它的全部电文（ttl/json/ctt/at）
 *   2. 按【発表時刻 ctt】排序，一条一条喂进现有渲染链路：
 *        QVHist.setCurrent(q)  →  主卡 + 色块 + 观测点全部照旧渲染
 *        q.detailJson = 指定的那一报、q.noMerge = 1（禁止 data.js 替换成最全那份）
 *   3. 相邻两报的真实间隔 / 倍速 = 等待时间（夹在 0.8~12 秒）
 *
 * 用法：QVReplay.open() / QVReplay.start(eid) / QVReplay.stop()
 */
(function (g) {
  'use strict';
  var JMA = 'https://www.jma.go.jp/bosai/quake/data/';
  var SPEEDS = [1, 2, 5, 10, 30, 60];

  var LIST = null;          /* [{eid, atMs, anm, mag, maxi, lat, lon, dep, frames:[...]}] */
  var EV = null;            /* 当前回放的事件 */
  var FRAMES = [];          /* 该事件的全部电文，按発表時刻排序 */
  var fi = -1, timer = 0, speed = 10, playing = false, seq = 0;
  var panel = null, bar = null;

  /* ---------- 小工具 ---------- */
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function pad(n) { return ('0' + n).slice(-2); }
  function fmtTime(ms) {
    var d = new Date(ms);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function cttToMs(s) {                       /* "20261025111715" → ms */
    s = String(s || '');
    if (s.length < 14) return 0;
    return Date.parse(s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) + 'T' +
      s.slice(8, 10) + ':' + s.slice(10, 12) + ':' + s.slice(12, 14) + '+09:00');
  }
  function parseCod(cod) {                    /* "+28.0+139.9-470000/" */
    var m = /([+-]\d+\.?\d*)([+-]\d+\.?\d*)([+-]\d+)\//.exec(String(cod || ''));
    if (!m) return null;
    return { lat: parseFloat(m[1]) , lon: parseFloat(m[2]), dep: Math.abs(parseInt(m[3], 10)) / 1000 };
  }
  var NORM = { '1': 1, '2': 2, '3': 3, '4': 4, '5-': 50, '5+': 55, '6-': 60, '6+': 65, '7': 70 };
  function normI(v) {
    var s = String(v == null ? '' : v).trim();
    return (NORM[s] != null) ? NORM[s] : -1;
  }
  function rank(v) {
    return (g.QVShindo && g.QVShindo.rankOf) ? g.QVShindo.rankOf(v)
      : (v === 70 ? 9 : v >= 65 ? 8 : v >= 60 ? 7 : v >= 55 ? 6 : v >= 50 ? 5 : Math.max(0, v));
  }
  function shindoTxt(v) {
    if (v === 50) return '5弱'; if (v === 55) return '5強';
    if (v === 60) return '6弱'; if (v === 65) return '6強';
    if (v === 70 || v === 7) return '7';
    return String(v);
  }
  function ttlCn(t) {
    t = String(t || '');
    if (/震度速報/.test(t)) return '震度速報';
    if (/震源・震度/.test(t)) return '震源・震度情報';
    if (/震源.*震度/.test(t)) return '震源・震度情報';
    if (/震源に関する/.test(t)) return '震源に関する情報';
    if (/震源/.test(t)) return '震源情報';
    if (/長周期/.test(t)) return '長周期地震動情報';
    return t;
  }

  /* ---------- 拉 list.json 并按 eid 分组 ---------- */
  function loadIndex(force) {
    if (LIST && !force) return Promise.resolve(LIST);
    return fetch(JMA + 'list.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (arr) {
      var by = {};
      arr.forEach(function (e) {
        if (!e || !e.eid || !e.json) return;
        var o = by[e.eid];
        if (!o) {
          o = by[e.eid] = { eid: e.eid, atMs: Date.parse(e.at) || 0, anm: e.anm || '', mag: parseFloat(e.mag), maxi: -1, frames: [] };
        }
        var vi = normI(e.maxi);
        if (rank(vi) > rank(o.maxi)) o.maxi = vi;
        var cod = parseCod(e.cod);
        if (cod) { o.lat = cod.lat; o.lon = cod.lon; o.dep = cod.dep; }
        if (!isFinite(o.mag) && e.mag) o.mag = parseFloat(e.mag);
        o.frames.push({ ttl: e.ttl || '', json: e.json, cttMs: cttToMs(e.ctt) || Date.parse(e.rdt) || 0, maxi: vi, anm: e.anm || '' });
      });
      LIST = Object.keys(by).map(function (k) {
        var o = by[k];
        if (!o.anm) o.anm = o.frames.length ? o.frames[0].anm : '';
        o.frames.sort(function (a, b) { return a.cttMs - b.cttMs; });
        return o;
      }).filter(function (o) { return o.frames.length && isFinite(o.lat) && isFinite(o.mag); })
        .sort(function (a, b) { return b.atMs - a.atMs; });
      return LIST;
    });
  }

  /* ---------- 样式（只注入一次，配色跟主界面一致） ---------- */
  function css() {
    if (document.getElementById('qvrp-css')) return;
    var s = el('style');
    s.id = 'qvrp-css';
    s.textContent = [
      '#qvrp{position:fixed;inset:0;z-index:9998;display:none;background:rgba(6,10,18,.72);backdrop-filter:blur(2px)}',
      '#qvrp.on{display:block}',
      '#qvrp .box{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(760px,92vw);max-height:80vh;display:flex;flex-direction:column;background:#1d2a41;color:#e8eef8;border:1px solid #31476d;border-radius:8px;overflow:hidden;box-shadow:0 18px 48px rgba(0,0,0,.55)}',
      '#qvrp .hd{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#31476d;font-size:15px}',
      '#qvrp .hd h3{margin:0;font-size:15px;font-weight:600;flex:1}',
      '#qvrp .x{background:none;border:0;color:#cfd9ea;font-size:20px;line-height:1;cursor:pointer;padding:0 4px}',
      '#qvrp .rb{background:#3d5783;border:0;color:#e8eef8;border-radius:4px;padding:3px 9px;font-size:12px;cursor:pointer}',
      '#qvrp .bd{overflow:auto;padding:10px 12px}',
      '#qvrp .row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:6px;cursor:pointer;border:1px solid transparent}',
      '#qvrp .row:hover{background:#233350;border-color:#31476d}',
      '#qvrp .row b{font-weight:600}',
      '#qvrp .row .mt{color:#9fb0c9;font-size:12px}',
      '#qvrp .row .mg{margin-left:auto;color:#c8d6ea;font-size:12px;white-space:nowrap}',
      '#qvrp .note{padding:8px 12px;color:#9fb0c9;font-size:12px;border-top:1px solid #26364f}',
      '#qvrbar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9997;display:none;align-items:center;gap:8px;background:#1d2a41;border:1px solid #31476d;border-radius:999px;padding:7px 14px;color:#e8eef8;font-size:13px;box-shadow:0 10px 26px rgba(0,0,0,.45)}',
      '#qvrbar.on{display:flex}',
      '#qvrbar button{background:#31476d;border:0;color:#e8eef8;border-radius:999px;padding:4px 10px;font-size:13px;cursor:pointer}',
      '#qvrbar button:hover{background:#3d5783}',
      '#qvrbar .pg{width:120px;height:5px;border-radius:3px;background:#2a3a55;overflow:hidden}',
      '#qvrbar .pg i{display:block;height:100%;background:#e6b422;width:0}',
      '#qvrbar .st{color:#9fb0c9;white-space:nowrap}',
      '#qvrbar .st b{color:#e8eef8;font-weight:600}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ---------- 列表面板 ---------- */
  function ensurePanel() {
    if (panel) return panel;
    css();
    panel = el('div', '', '');
    panel.id = 'qvrp';
    panel.innerHTML = '<div class="box"><div class="hd"><h3>回放 · 近一个月的真电文</h3>' +
      '<button class="rb" title="把这一批事件全部跑一遍对照">批量对照</button>' +
      '<button class="x" title="关闭">&times;</button></div><div class="bd" id="qvrpList">载入中…</div>' +
      '<div class="note">每一行是一场地震；点开后按【発表時刻】一条一条重放（震度速報 → 震源 → 各地の震度），速度和进度可在下方控制。</div></div>';
    document.body.appendChild(panel);
    panel.querySelector('.x').addEventListener('click', function () { close(); });
    panel.querySelector('.rb').addEventListener('click', function () { close(); batchRun(2, 30); });
    panel.addEventListener('click', function (e) { if (e.target === panel) close(); });
    return panel;
  }
  function open() {
    ensurePanel();
    panel.classList.add('on');
    var box = panel.querySelector('#qvrpList');
    box.textContent = '载入中…';
    loadIndex(true).then(function (list) {
      if (!list.length) { box.textContent = '这一个月没有可用事件'; return; }
      box.innerHTML = '';
      list.slice(0, 120).forEach(function (o) {
        var r = el('div', 'row');
        r.innerHTML = '<b>' + fmtTime(o.atMs) + '</b> ' + (o.anm || '—') +
          ' <span class="mt">M' + (isFinite(o.mag) ? o.mag.toFixed(1) : '?') +
          (isFinite(o.dep) ? ' / ' + Math.round(o.dep) + 'km' : '') + '</span>' +
          '<span class="mg">' + (o.maxi >= 0 ? '最大震度' + shindoTxt(o.maxi) + ' · ' : '') +
          o.frames.length + ' 报 ▶</span>';
        r.addEventListener('click', function () { close(); start(o.eid); });
        box.appendChild(r);
      });
    }).catch(function (e) {
      box.textContent = '载入失败：' + (e && e.message || e);
    });
  }
  function close() { if (panel) panel.classList.remove('on'); }

  /* ---------- 回放控制条 ---------- */
  function ensureBar() {
    if (bar) return bar;
    css();
    bar = el('div', '');
    bar.id = 'qvrbar';
    bar.innerHTML = '<button data-k="prev" title="上一报">⏮</button>' +
      '<button data-k="play" title="播放/暂停">⏸</button>' +
      '<button data-k="next" title="下一报">⏭</button>' +
      '<span class="st" id="qvrSt">—</span>' +
      '<span class="pg"><i id="qvrPg"></i></span>' +
      '<button data-k="spd" title="倍速">10×</button>' +
      '<button data-k="cmp" title="官方 vs 我们 对照">对照</button>' +
      '<button data-k="exit" title="退出回放">✕</button>';
    document.body.appendChild(bar);
    bar.addEventListener('click', function (e) {
      var k = e.target && e.target.getAttribute && e.target.getAttribute('data-k');
      if (!k) return;
      if (k === 'exit') { stop(); return; }
      if (k === 'cmp') { openCompare(); return; }
      if (k === 'play') { playing ? pause() : resume(); return; }
      if (k === 'prev') { goto_(fi - 1); return; }
      if (k === 'next') { goto_(fi + 1); return; }
      if (k === 'spd') {
        var i = SPEEDS.indexOf(speed); speed = SPEEDS[(i + 1) % SPEEDS.length];
        e.target.textContent = speed + '×';
        if (playing) { clearTimeout(timer); schedule(); }
      }
    });
    return bar;
  }
  function paintBar() {
    if (!bar) return;
    var st = bar.querySelector('#qvrSt'), pg = bar.querySelector('#qvrPg');
    var f = FRAMES[fi] || {};
    st.innerHTML = '<b>' + (EV ? EV.anm : '') + '</b> · 第 ' + (fi + 1) + '/' + FRAMES.length +
      ' 报 · ' + ttlCn(f.ttl) + (f.maxi >= 0 ? ' · 最大震度' + shindoTxt(f.maxi) : '');
    pg.style.width = (FRAMES.length ? ((fi + 1) / FRAMES.length * 100) : 0).toFixed(1) + '%';
    bar.querySelector('[data-k="play"]').textContent = playing ? '⏸' : '▶';
  }

  /* ---------- 单帧渲染 ---------- */
  function playFrame(i) {
    if (!EV || i < 0 || i >= FRAMES.length) return;
    fi = i;
    var f = FRAMES[i];
    var q = {
      id: 'REPLAY:' + EV.eid + '#' + (++seq),
      src: 'JMA', feed: 'jma', hist: 1, metric: 'shindo', replay: 1,
      timeMs: EV.atMs, pubMs: f.cttMs || EV.atMs,
      place: EV.anm, mag: EV.mag, depthKm: EV.dep, lat: EV.lat, lon: EV.lon,
      maxShindo: f.maxi, shindo: f.maxi, ttl: f.ttl,
      /* ★ 指定「就是这一报」，并禁止 data.js 择优替换成最全那份 */
      detailJson: f.json, noMerge: 1,
      tsunami: 0, detail: '', alts: []
    };
    try { if (g.QVHist && g.QVHist.setCurrent) g.QVHist.setCurrent(q); } catch (e) { }
    try {
      if (g.QVMapCam) {
        if (g.QVMapCam.lockPin) g.QVMapCam.lockPin([{ lat: EV.lat, lon: EV.lon, kind: 'eew' }]);
        if (g.QVMapCam.setPins) g.QVMapCam.setPins([{ lat: EV.lat, lon: EV.lon, kind: 'eew' }]);
      }
    } catch (e2) { }
    if (g.QVRedraw) g.QVRedraw();
    paintBar();
  }

  /* ---------- 时间轴 ---------- */
  function schedule() {
    if (!playing || !EV) return;
    if (fi + 1 >= FRAMES.length) {
      playing = false; paintBar();
      /* 回放结束 → 自动弹对照表（这正是用户要看的「过程差异」） */
      try { openCompare(); } catch (e) { }
      return;
    }
    var d = FRAMES[fi + 1].cttMs - FRAMES[fi].cttMs;
    if (!(d > 0)) d = 1500;
    d = Math.max(800, Math.min(12000, Math.round(d / speed)));
    clearTimeout(timer);
    timer = setTimeout(function () {
      playFrame(fi + 1);
      schedule();
    }, d);
  }
  function pause() { playing = false; clearTimeout(timer); paintBar(); }
  function resume() {
    if (!EV) return;
    playing = true;
    if (fi + 1 >= FRAMES.length) { goto_(0); return; }   /* 播完了 → 从头再放 */
    paintBar(); schedule();
  }
  function goto_(i) {
    if (!EV) return;
    if (i < 0) i = 0;
    if (i >= FRAMES.length) i = FRAMES.length - 1;
    clearTimeout(timer);
    playFrame(i);
    if (playing) schedule();
  }

  /* ---------- 对外 ---------- */
  function start(eid) {
    loadIndex().then(function (list) {
      var o = null;
      for (var i = 0; i < list.length; i++) if (list[i].eid === String(eid)) { o = list[i]; break; }
      if (!o) { if (g.QVViews && g.QVViews.toast) g.QVViews.toast('找不到这场地震'); return; }
      EV = o; FRAMES = o.frames.slice(); fi = -1; speed = speed || 10; playing = true;
      ensureBar(); bar.classList.add('on');
      bar.querySelector('[data-k="spd"]').textContent = speed + '×';
      try { if (g.QVMapCam && g.QVMapCam.focus) g.QVMapCam.focus({ lat: o.lat, lon: o.lon, mag: o.mag, id: 'replay:' + o.eid }, true); } catch (e) { }
      playFrame(0);
      schedule();
      if (g.QVViews && g.QVViews.toast) g.QVViews.toast('回放：' + o.anm + '（' + FRAMES.length + ' 报）');
    });
  }
  function stop() {
    clearTimeout(timer); playing = false; EV = null; FRAMES = []; fi = -1;
    if (bar) bar.classList.remove('on');
    try { if (g.QVHist && g.QVHist.clear) g.QVHist.clear(); } catch (e) { }
    try {
      if (g.QVMapCam) {
        if (g.QVMapCam.lockPin) g.QVMapCam.lockPin(null);
        if (g.QVMapCam.setPins) g.QVMapCam.setPins([]);
        if (g.QVMapCam.clearStations) g.QVMapCam.clearStations();
      }
    } catch (e2) { }
    if (g.QVRedraw) g.QVRedraw();
    if (g.QVViews && g.QVViews.toast) g.QVViews.toast('已退出回放');
  }
  /* ══════════ 对照：官方真电文 vs 我们模型 ══════════ */
  var CMP = null, cmpPanel = null, showingMine = false;
  var LOGKEY = 'qv.replay.cmp.v1';

  /** 对照历史（localStorage，按 eid 去重，最多 40 条） */
  function readLog() {
    try { return JSON.parse(localStorage.getItem(LOGKEY) || '[]') || []; } catch (e) { return []; }
  }
  function pushLog(rec) {
    var a = readLog().filter(function (x) { return x.eid !== rec.eid; });
    a.unshift(rec);
    if (a.length > 40) a = a.slice(0, 40);
    try { localStorage.setItem(LOGKEY, JSON.stringify(a)); } catch (e) { }
    return a;
  }

  /** 统计一报：区域数 / 观测点数 / 最大震度（全用官方 JSON 里的原始字段） */
  function frameStat(f) {
    return fetch(JMA + f.json, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      var obs = ((((d || {}).Body || {}).Intensity || {}).Observation) || {};
      var pref = [].concat(obs.Pref || []);
      var areas = {}, nSta = 0, mx = -1;
      pref.forEach(function (pf) {
        [].concat(pf.Area || []).forEach(function (a) {
          if (a && a.Code) {
            var v = (g.QData && g.QData.parseMaxInt) ? g.QData.parseMaxInt(a.MaxInt) : normI(a.MaxInt);
            if (v >= 0 && !(areas[a.Code] != null && rank(areas[a.Code]) >= rank(v))) areas[a.Code] = v;
            if (rank(v) > rank(mx >= 0 ? mx : -1)) mx = v;
          }
          [].concat(a && a.City || []).forEach(function (c) {
            [].concat(c && c.IntensityStation || []).forEach(function (s) {
              if (s && s.Int != null) nSta++;
            });
          });
        });
      });
      return { nArea: Object.keys(areas).length, nSta: nSta, maxi: mx };
    }).catch(function () { return { nArea: 0, nSta: 0, maxi: -1 }; });
  }

  /** 我们模型在某场地震上的结果（静态场 + 首报时刻）
   *  ★ 2026-10-25：改成收参数（ev），批量对照要对每场都跑一遍 */
  function mineStatOf(ev) {
    var V = g.QVViews;
    if (!V || !V.genStations || !ev) return null;
    var out = V.genStations(ev.lat, ev.lon, ev.maxi, 'shindo', ev.dep, ev.mag);
    var areas = {}, nSta = 0, mx = -1, hypMin = 1e9, maxKm = 0;
    (out || []).forEach(function (o) {
      if (o.hyp < hypMin) hypMin = o.hyp;
      if (o.shindo >= 1) {
        var dy = (o.lat - ev.lat) * 111, dx = (o.lon - ev.lon) * 111 * Math.cos(ev.lat * Math.PI / 180);
        var km = Math.sqrt(dx * dx + dy * dy);
        if (km > maxKm) maxKm = km;
        nSta++;
      }
      if (o.area) {
        var c = String(o.area);
        if (areas[c] == null || rank(o.shindo) > rank(areas[c])) areas[c] = o.shindo;
      }
      if (rank(o.shindo) > rank(mx >= 0 ? mx : -1)) mx = o.shindo;
    });
    var det = (out && out.det) ? out.det.length : 0;
    return {
      nArea: Object.keys(areas).length, nSta: nSta, maxi: mx, areas: areas,
      /* 首报 = P 波（≈6km/s）走到最近一个测站；与 views.fireSim 的 delay 同一套 */
      tFirst: isFinite(hypMin) ? Math.round(hypMin / 6) : null,
      nRep: Math.max(1, Math.min(60, Math.round(det / 14))),
      det: det, radiusKm: isFinite(maxKm) ? Math.round(maxKm) : 0
    };
  }
  function mineStat() { return mineStatOf(EV); }

  function buildCompare() {
    if (!EV) return Promise.resolve(null);
    if (CMP && CMP.eid === EV.eid) return Promise.resolve(CMP);
    var origin = EV.atMs;
    return Promise.all(FRAMES.map(function (f) {
      return frameStat(f).then(function (s) {
        s.ttl = f.ttl; s.t = Math.round((f.cttMs - origin) / 1000); s.maxi = (s.maxi >= 0 ? s.maxi : f.maxi);
        return s;
      });
    })).then(function (list) {
      var mine = null;
      try { mine = mineStat(); } catch (e) { }
      CMP = { eid: EV.eid, official: list, mine: mine };
      /* 存一条对照记录（同一场只留最新） */
      var last = list.length ? list[list.length - 1] : { nArea: 0, nSta: 0, maxi: -1 };
      pushLog({
        eid: EV.eid, anm: EV.anm, mag: EV.mag, dep: EV.dep, at: EV.atMs, nRep: list.length,
        oArea: last.nArea, oSta: last.nSta, oMax: last.maxi,
        mArea: mine ? mine.nArea : -1, mSta: mine ? mine.nSta : -1, mMax: mine ? mine.maxi : -1,
        tFirst: mine ? mine.tFirst : null, tOff: list.length ? list[0].t : null
      });
      return CMP;
    });
  }

  function cmpCss() {
    if (document.getElementById('qvrc-css')) return;
    var s = el('style');
    s.id = 'qvrc-css';
    s.textContent = [
      '#qvrc{position:fixed;right:14px;top:64px;z-index:9997;display:none;width:420px;max-height:calc(100vh - 140px);overflow:auto;background:#1d2a41;color:#e8eef8;border:1px solid #31476d;border-radius:8px;box-shadow:0 14px 34px rgba(0,0,0,.5);font-size:13px}',
      '#qvrc.on{display:block}',
      '#qvrc.wide{width:min(880px,94vw)}',
      '#qvrc .hd{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#31476d;font-weight:600}',
      '#qvrc .hd span{flex:1}',
      '#qvrc .hd button{background:#3d5783;border:0;color:#e8eef8;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:12px}',
      '#qvrc table{width:100%;border-collapse:collapse}',
      '#qvrc th,#qvrc td{padding:5px 10px;border-bottom:1px solid #22324b;text-align:left}',
      '#qvrc th{color:#9fb0c9;font-weight:500;font-size:12px}',
      '#qvrc td.n{text-align:right;font-variant-numeric:tabular-nums}',
      '#qvrc .sec{padding:7px 12px 4px;color:#9fb0c9;font-size:12px}',
      '#qvrc .dg{color:#e6b422}',
      '#qvrc .sw{display:flex;gap:6px;padding:8px 12px}',
      '#qvrc .sw button{flex:1;background:#26364f;border:1px solid #31476d;color:#e8eef8;border-radius:5px;padding:5px 0;cursor:pointer;font-size:12px}',
      '#qvrc .sw button.on{background:#e6b422;color:#1d2a41;border-color:#e6b422;font-weight:600}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function openCompare() {
    cmpCss();
    if (!cmpPanel) {
      cmpPanel = el('div', '');
      cmpPanel.id = 'qvrc';
      cmpPanel.innerHTML = '<div class="hd"><span>对照 · 官方 vs 我们</span><button data-k="close">×</button></div><div id="qvrcBody">计算中…</div>';
      document.body.appendChild(cmpPanel);
      cmpPanel.addEventListener('click', function (e) {
        var k = e.target.getAttribute && e.target.getAttribute('data-k');
        if (k === 'close') { cmpPanel.classList.remove('on'); return; }
        if (k === 'off') { showingMine = false; applyMap('official'); return; }
        if (k === 'mine') { showingMine = true; applyMap('mine'); return; }
      });
    }
    cmpPanel.classList.add('on');
    var body = cmpPanel.querySelector('#qvrcBody');
    body.textContent = '计算中…';
    buildCompare().then(function (c) {
      if (!c) { body.textContent = '没有正在回放的地震'; return; }
      var o = c.official, m = c.mine;
      var last = o.length ? o[o.length - 1] : { nArea: 0, nSta: 0, maxi: -1 };
      var sTxt = function (v) { return v >= 0 ? shindoTxt(v) : '—'; };
      var h = '<div class="sec">最终状态</div><table>' +
        '<tr><th>指标</th><th class="n">官方</th><th class="n">我们</th><th class="n">差</th></tr>' +
        row2('最大震度', sTxt(last.maxi), m ? sTxt(m.maxi) : '—', m ? (rank(m.maxi) - rank(last.maxi)) : null) +
        row2('区域色块数', last.nArea, m ? m.nArea : '—', m ? (m.nArea - last.nArea) : null) +
        row2('观测点数', last.nSta, m ? m.nSta : '—', m ? (m.nSta - last.nSta) : null) +
        '</table>' +
        '<div class="sec">过程（官方逐报 / 我们）</div><table>' +
        '<tr><th>发震后</th><th>官方</th><th class="n">区域</th><th class="n">点</th><th class="n">震度</th></tr>' +
        o.map(function (f) {
          return '<tr><td class="n">+' + f.t + 's</td><td>' + ttlCn(f.ttl) + '</td><td class="n">' + f.nArea + '</td><td class="n">' + f.nSta + '</td><td class="n">' + sTxt(f.maxi) + '</td></tr>';
        }).join('') +
        '<tr><td class="n dg">+' + (m && m.tFirst != null ? m.tFirst + 's' : '?') + '</td><td class="dg">我们首报(P波到最近测站)</td><td class="n dg">' +
        (m ? m.nArea : '—') + '</td><td class="n dg">' + (m ? m.nSta : '—') + '</td><td class="n dg">' + (m ? sTxt(m.maxi) : '—') + '</td></tr>' +
        '</table>' +
        '<div class="sec">说明：官方第一报只报「震度3以上」的区域，所以区域数从 1 几个起步；我们的场是一次性算全量的（' +
        (m ? m.det + ' 个检出点 → 约 ' + m.nRep + ' 报' : '—') + '）。</div>' +
        '<div class="sw"><button data-k="off"' + (showingMine ? '' : ' class="on"') + '>地图：官方</button>' +
        '<button data-k="mine"' + (showingMine ? ' class="on"' : '') + '>地图：我们</button></div>' +
        '<div class="sec">对照历史（你回放过的，存浏览器）</div>' + logTable();
      body.innerHTML = h;
    });
  }
  function logTable() {
    var a = readLog();
    if (!a.length) return '<div class="sec">还没有记录</div>';
    var s = function (v) { return v >= 0 ? shindoTxt(v) : '—'; };
    return '<table><tr><th>地震</th><th class="n">报</th><th class="n">区域 官/我</th><th class="n">点 官/我</th><th class="n">首报</th></tr>' +
      a.map(function (r) {
        var d = new Date(r.at);
        return '<tr><td>' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + (r.anm || '') + '</td>' +
          '<td class="n">' + r.nRep + '</td>' +
          '<td class="n">' + r.oArea + ' / ' + r.mArea + '</td>' +
          '<td class="n">' + r.oSta + ' / ' + r.mSta + '</td>' +
          '<td class="n">' + (r.tFirst != null ? '+' + r.tFirst + 's' : '—') + '</td></tr>';
      }).join('') + '</table>';
  }
  function row2(k, a, b, d) {
    return '<tr><td>' + k + '</td><td class="n">' + a + '</td><td class="n">' + b + '</td><td class="n ' +
      (d === null ? '' : (d > 0 ? 'dg' : '')) + '">' + (d === null ? '—' : (d > 0 ? '+' : '') + d) + '</td></tr>';
  }

  /* ══════════ 批量对照：近一个月整批跑一遍 ══════════ */
  var BATCH = null;
  function batchRun(minMaxi, maxN) {
    minMaxi = (minMaxi == null) ? 2 : minMaxi;
    maxN = maxN || 30;
    cmpCss();
    if (!cmpPanel) { openCompare(); }
    cmpPanel.classList.add('on'); cmpPanel.classList.add('wide');
    var body = cmpPanel.querySelector('#qvrcBody');
    return loadIndex().then(function (list) {
      var sel = list.filter(function (o) { return rank(o.maxi) >= rank(minMaxi) && o.frames.length; }).slice(0, maxN);
      var rows = [], i = 0;
      body.innerHTML = '<div class="sec">批量对照中… 0/' + sel.length + '</div>';
      function step() {
        if (i >= sel.length) return finish();
        var o = sel[i++];
        var last = o.frames[o.frames.length - 1];
        return frameStat(last).then(function (s) {
          var m = null; try { m = mineStatOf(o); } catch (e) { }
          rows.push({
            anm: o.anm, at: o.atMs, mag: o.mag, dep: o.dep, nRep: o.frames.length,
            oArea: s.nArea, oSta: s.nSta, oMax: (s.maxi >= 0 ? s.maxi : o.maxi),
            mArea: m ? m.nArea : -1, mSta: m ? m.nSta : -1, mMax: m ? m.maxi : -1,
            tOff: Math.round((o.frames[0].cttMs - o.atMs) / 1000), tMine: m ? m.tFirst : null
          });
          body.innerHTML = '<div class="sec">批量对照中… ' + rows.length + '/' + sel.length + '</div>';
          return step();
        });
      }
      function finish() {
        BATCH = rows;
        var n = rows.length || 1;
        var rA = rows.filter(function (r) { return r.oArea > 0 && r.mArea >= 0; });
        var med = function (a) { a = a.slice().sort(function (x, y) { return x - y; }); return a.length ? a[Math.floor(a.length / 2)] : 0; };
        var ratioA = med(rA.map(function (r) { return r.mArea / r.oArea; }));
        var ratioS = med(rA.map(function (r) { return r.mSta / Math.max(1, r.oSta); }));
        var sameMax = rows.filter(function (r) { return rank(r.mMax) === rank(r.oMax); }).length;
        var hi = rows.filter(function (r) { return rank(r.mMax) > rank(r.oMax); }).length;
        var lo = rows.filter(function (r) { return rank(r.mMax) < rank(r.oMax); }).length;
        var dT = rows.filter(function (r) { return r.tMine != null && r.tOff != null; }).map(function (r) { return r.tMine - r.tOff; });
        var s = function (v) { return v >= 0 ? shindoTxt(v) : '—'; };
        var h = '<div class="sec">汇总（' + rows.length + ' 场，震度' + shindoTxt(minMaxi) + ' 以上）</div><table>' +
          '<tr><th>项目</th><th class="n">值</th></tr>' +
          '<tr><td>区域色块比（我们/官方，中位数）</td><td class="n dg">' + ratioA.toFixed(2) + '×</td></tr>' +
          '<tr><td>观测点数比（中位数）</td><td class="n dg">' + ratioS.toFixed(2) + '×</td></tr>' +
          '<tr><td>最大震度一致</td><td class="n">' + sameMax + ' / ' + rows.length + '（偏高 ' + hi + '，偏低 ' + lo + '）</td></tr>' +
          '<tr><td>首报时刻差（我们 EEW 首报 − 官方第一份情报电文）</td><td class="n dg">' + (dT.length ? (med(dT) > 0 ? '+' : '') + med(dT) + ' 秒' : '—') + '</td></tr>' +
          '</table><div class="sec">⚠ 口径：官方这些时刻是【地震情報】系列（震度速報 / 震源 / 各地の震度），<b>不是 EEW</b>；我们的首报是模型推算的「P 波到最近测站」。两者不是同一种产品，看量级就行。</div>' +
          '<div class="sec">逐场</div><table>' +
          '<tr><th>地震</th><th class="n">M/深</th><th class="n">报</th><th class="n">区域 官/我</th><th class="n">点 官/我</th><th class="n">最大 官/我</th><th class="n">首报 官/我</th></tr>' +
          rows.map(function (r) {
            var d = new Date(r.at);
            var bad = rank(r.mMax) !== rank(r.oMax);
            return '<tr><td>' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + r.anm + '</td>' +
              '<td class="n">' + r.mag.toFixed(1) + '/' + Math.round(r.dep) + '</td>' +
              '<td class="n">' + r.nRep + '</td>' +
              '<td class="n">' + r.oArea + ' / ' + r.mArea + '</td>' +
              '<td class="n">' + r.oSta + ' / ' + r.mSta + '</td>' +
              '<td class="n' + (bad ? ' dg' : '') + '">' + s(r.oMax) + ' / ' + s(r.mMax) + '</td>' +
              '<td class="n">+' + r.tOff + 's / +' + (r.tMine != null ? r.tMine + 's' : '—') + '</td></tr>';
          }).join('') + '</table>' +
          '<div class="sw"><button data-k="close">关闭</button></div>';
        body.innerHTML = h;
        return rows;
      }
      return step();
    });
  }

  /** 地图在「官方这一报」和「我们的场」之间切换 */
  function applyMap(which) {
    if (!EV) return;
    if (which === 'mine') {
      var m = CMP && CMP.mine;
      if (!m) return;
      var list = Object.keys(m.areas).map(function (c) { return { code: c, shindo: m.areas[c] }; });
      try { if (g.QVMapCam && g.QVMapCam.clearStations) g.QVMapCam.clearStations(); } catch (e) { }
      try { if (g.QVShindo && g.QVShindo.set) g.QVShindo.set(list); } catch (e2) { }
      /* 镜头框到我们自己的有效范围（否则停在震源附近的空海面上，看不出形状） */
      try {
        if (g.QVMapCam && g.QVMapCam.fitCircle && m.radiusKm > 30) {
          g.QVMapCam.fitCircle(EV.lat, EV.lon, m.radiusKm * 1.15, 0.42);
        }
      } catch (e3) { }
      if (g.QVRedraw) g.QVRedraw();
      if (g.QVViews && g.QVViews.toast) g.QVViews.toast('地图：我们的推算场（' + list.length + ' 个区域）');
    } else {
      showingMine = false;
      playFrame(fi >= 0 ? fi : 0);
      if (g.QVViews && g.QVViews.toast) g.QVViews.toast('地图：官方第 ' + (fi + 1) + ' 报');
    }
  }

  /** 入口小按钮（右下角） */
  function chip() {
    if (document.getElementById('qvrpChip')) return;
    css();
    var b = el('button', '');
    b.id = 'qvrpChip';
    b.textContent = '回放';
    b.title = '回放近一个月的真电文（震度速報 → 震源 → 各地の震度）';
    b.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9996;background:#31476d;color:#e8eef8;border:1px solid #3d5783;border-radius:999px;padding:6px 14px;font-size:13px;cursor:pointer;opacity:.85';
    b.addEventListener('click', open);
    document.body.appendChild(b);
  }

  g.QVReplay = { open: open, close: close, start: start, stop: stop, chip: chip,
    compare: openCompare, batch: batchRun,
    next: function () { goto_(fi + 1); }, prev: function () { goto_(fi - 1); },
    pause: pause, resume: resume, state: function () { return { eid: EV && EV.eid, i: fi, n: FRAMES.length, playing: playing, speed: speed }; } };

  /* ★★★ 2026-10-25 用户：「把这个测试的按钮删掉」
     —— 右下角「回放」是开发期留下的入口，正式界面不该出现。
     ⇒ 默认**不再自动创建**；调试时加 `?replay=1` 或控制台 `QVReplay.chip()` 仍可调出。 */
  var _showChip = /(?:^|[?&])replay=1(?:&|$)/.test(String(location.search || ''));
  if (_showChip) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(chip, 1500);
    else document.addEventListener('DOMContentLoaded', function () { setTimeout(chip, 1500); });
  }
})(window);
