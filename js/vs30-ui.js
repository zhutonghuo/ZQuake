/* vs30-ui.js — 「场地格点（精度）」向导 / 设置面板（2026-10-28）
 *
 * 用户给的稿子（koneewapp向导.html）是 macOS 风格三/四步向导：
 *   欢迎 → 选择精细度 → 下载 → 完成
 * 这里实现到 APP 里，但做了三处必要调整：
 *   ① 去掉 macOS 的红黄绿「交通灯」——这是 Windows 应用，假窗控会让人以为是原生按钮
 *   ② 档位按**官方数据本身**来：内置标准（= 网页版同款，随包，不用下）
 *      / 高精度 0.1° / 极高 0.05° / 全量 1km（30″）
 *   ③ 下载的是**官方原始文件**（USGS 581.9MB），下载完在 APP 内本地聚合
 *
 * 数据链路全部走主进程 IPC（preload 暴露的 qv.vs30.*）：
 *   status() → download() → build(tier) → setTier(tier)
 *   进度通过 onEvent({type:'job', job:{kind,done,total,phase}}) 回推
 *
 * 对外：QVVs30UI.open(mode)  mode='wizard' | 'settings'
 * 首次启动：prefs.firstRun 未标记时，等启动页消失后自动 open('wizard')
 */
(function (global) {
  'use strict';

  var SVC = global.qv && global.qv.vs30;
  var TIERS = [
    { k: 'builtin', t: '内置标准', s: '0.25°', d: '随包内置，与网页版完全一致，不需要下载', size: '0 MB' },
    { k: 'd01', t: '高精度', s: '0.1°', d: '城市与平原尺度，日常分析足够', size: '≈ 5 MB' },
    { k: 'd005', t: '极高', s: '0.05°', d: '山区与盆地边缘的场地放大更贴近实际', size: '≈ 20 MB' },
    { k: 'full', t: '全量', s: '1 km', d: '官方原始分辨率（30″），适合野外与离线校核', size: '≈ 692 MB' }
  ];

  var CSS = [
    '#qvvs30{position:fixed;inset:0;z-index:300;display:none;align-items:center;justify-content:center;',
    'background:rgba(0,0,0,.62);font-family:"NotoSC",sans-serif;color:#f2f5f9}',
    '#qvvs30.on{display:flex}',
    '#qvvs30 .vwin{width:min(720px,calc(100vw - 64px));height:min(520px,calc(100vh - 80px));',
    'display:flex;flex-direction:column;background:#15181d;border:1px solid rgba(255,255,255,.1);',
    'border-radius:10px;box-shadow:0 24px 80px rgba(0,0,0,.7);overflow:hidden}',
    '#qvvs30 .vbar{flex:0 0 44px;display:flex;align-items:center;gap:10px;padding:0 16px;',
    'background:#1b1f26;border-bottom:1px solid rgba(255,255,255,.08)}',
    '#qvvs30 .vbar .vt{flex:1 1 auto;font-size:13px;font-weight:600;color:#c9d3e0}',
    '#qvvs30 .vbar .vs{font-size:12px;color:#6f7b8c;font-variant-numeric:tabular-nums}',
    '#qvvs30 .vbody{position:relative;flex:1 1 auto;min-height:0}',
    '#qvvs30 .vscr{position:absolute;inset:0;display:flex;flex-direction:column;padding:26px 30px 18px;',
    'opacity:0;visibility:hidden;transform:translateY(6px);transition:opacity .16s,transform .2s,visibility .2s}',
    '#qvvs30 .vscr.on{opacity:1;visibility:visible;transform:none}',
    '#qvvs30 .vscr.mid{align-items:center;justify-content:center;text-align:center}',
    '#qvvs30 .vsc{flex:1 1 auto;min-height:0;overflow-y:auto;width:100%}',
    '#qvvs30 .vmark{width:64px;height:64px;border-radius:14px;background:#1d232c;',
    'box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center}',
    '#qvvs30 .vh{margin:0;font-size:19px;font-weight:700;letter-spacing:.2px}',
    '#qvvs30 .vscr.mid .vh{margin-top:16px}',
    '#qvvs30 .vp{margin:8px 0 0;font-size:13px;line-height:1.6;color:#94a1b3;max-width:56ch}',
    '#qvvs30 .vhead{margin-bottom:16px}',
    '#qvvs30 .vhint{margin:14px 0 0;font-size:12px;line-height:1.6;color:#68737f}',
    '#qvvs30 .vopts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}',
    '#qvvs30 .vopt{display:flex;flex-direction:column;gap:8px;padding:12px;min-height:132px;text-align:left;',
    'background:#22272f;border:1px solid transparent;border-radius:8px;color:inherit;font:inherit;cursor:pointer;',
    'transition:background .15s,border-color .15s}',
    '#qvvs30 .vopt:hover{background:#2a3038}',
    '#qvvs30 .vopt.sel{background:rgba(84,150,240,.12);border-color:rgba(96,160,255,.5)}',
    '#qvvs30 .vopt .vt2{display:flex;align-items:baseline;gap:6px;font-size:13px;font-weight:600}',
    '#qvvs30 .vopt .vdeg{font-size:11px;color:#7c8794;font-weight:400}',
    '#qvvs30 .vopt .vd{flex:1 1 auto;font-size:11.5px;line-height:1.5;color:#8d99a7}',
    '#qvvs30 .vopt .vsz{font-size:11.5px;color:#68737f;font-variant-numeric:tabular-nums}',
    '#qvvs30 .vopt.sel .vsz{color:#6fa8ff}',
    '#qvvs30 .vopt .vst{font-size:11px;color:#5abf7a}',
    '#qvvs30 .vfoot{flex:0 0 auto;display:flex;justify-content:flex-end;gap:9px;padding-top:16px}',
    '#qvvs30 .vbtn{height:34px;padding:0 18px;border:0;border-radius:6px;font:inherit;font-size:13px;',
    'font-weight:600;cursor:pointer;background:#2a3038;color:#e8eef6;transition:background .15s}',
    '#qvvs30 .vbtn:hover{background:#333a44}',
    '#qvvs30 .vbtn.pri{background:#1d5fa8;color:#fff}',
    '#qvvs30 .vbtn.pri:hover{background:#2470c4}',
    '#qvvs30 .vbtn[disabled]{opacity:.5;cursor:default}',
    '#qvvs30 .vdl{width:100%;max-width:400px;margin-top:22px;text-align:left}',
    '#qvvs30 .vdh{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px;font-size:12px}',
    '#qvvs30 .vdh .pc{font-weight:700;font-variant-numeric:tabular-nums;color:#e8eef6}',
    '#qvvs30 .vdh .am{color:#68737f;font-variant-numeric:tabular-nums}',
    '#qvvs30 .vtrk{height:6px;background:#22272f;border-radius:3px;overflow:hidden}',
    '#qvvs30 .vfil{height:100%;width:0;background:#3d8bfd;border-radius:3px;transition:width .12s linear}',
    '#qvvs30 .vdf{display:flex;justify-content:space-between;margin-top:7px;font-size:11.5px;',
    'color:#68737f;font-variant-numeric:tabular-nums}',
    '#qvvs30 .vsum{display:inline-flex;align-items:center;gap:10px;margin-top:18px;padding:8px 14px;',
    'border-radius:8px;background:#22272f;font-size:12.5px}',
    '#qvvs30 .vsum b{color:#6fa8ff;font-size:13px}'
  ].join('');

  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  }); }

  var root = null, cur = 'welcome', mode = 'wizard';
  var sel = { k: 'builtin', label: '内置标准' };
  var st = null, busy = false, job = null, lastBytes = 0, lastAt = 0, speed = 0;

  function build() {
    if (root) return root;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    root = el('div', '');
    root.id = 'qvvs30';
    root.innerHTML =
      '<div class="vwin" role="dialog" aria-modal="true">' +
        '<div class="vbar"><span class="vt">场地格点</span><span class="vs" id="vStep"></span></div>' +
        '<div class="vbody">' +
          /* 1 欢迎 */
          '<section class="vscr mid on" id="vWelcome"><div class="vsc" style="display:flex;flex-direction:column;align-items:center;justify-content:center">' +
            '<div class="vmark"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#5f9dff" stroke-width="1.5" stroke-linecap="round">' +
            '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4.2" ry="9"/><path d="M3.4 9.2h17.2M3.4 14.8h17.2"/></svg></div>' +
            '<h1 class="vh">场地格点（Vs30）</h1>' +
            '<p class="vp">用于「软土放大 / 硬岩缩小」。默认使用随包内置的标准格点，与网页版一致；若需要更细的精度，可在这里下载官方原始数据，由本机完成聚合。</p>' +
          '</div><div class="vfoot">' +
            '<button class="vbtn" id="vSkip">保持默认</button>' +
            '<button class="vbtn pri" id="vNext">选择精度</button>' +
          '</div></section>' +
          /* 2 选档 */
          '<section class="vscr" id="vData"><div class="vsc">' +
            '<div class="vhead"><h1 class="vh">选择精度</h1>' +
            '<p class="vp">官方只提供一个原始文件（USGS Global Vs30，581.9 MB，1 km / 30″）。档位是下载后在本机聚合出来的分辨率，一次生成长期可用。</p></div>' +
            '<div class="vopts" id="vOpts"></div>' +
            '<p class="vhint">已下载的档位会保留，随时可在设置里切换；不会重复下载。</p>' +
          '</div><div class="vfoot">' +
            '<button class="vbtn" id="vBack">返回</button>' +
            '<button class="vbtn pri" id="vGo">开始</button>' +
          '</div></section>' +
          /* 3 进度 */
          '<section class="vscr mid" id="vJob"><div class="vsc" style="display:flex;flex-direction:column;align-items:center;justify-content:center">' +
            '<div class="vmark"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#5f9dff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg></div>' +
            '<h1 class="vh" id="vJobTitle">正在下载官方数据</h1>' +
            '<p class="vp" id="vJobSub">USGS Global Vs30 · 581.9 MB</p>' +
            '<div class="vdl"><div class="vdh"><span class="pc" id="vPct">0%</span><span class="am" id="vAmt">0 / 0 MB</span></div>' +
            '<div class="vtrk"><div class="vfil" id="vFil"></div></div>' +
            '<div class="vdf"><span id="vSpd">正在连接…</span><span id="vEta"></span></div></div>' +
          '</div><div class="vfoot"><button class="vbtn" id="vCancel">取消</button>' +
            '<button class="vbtn pri" id="vJobNext" hidden>下一步</button></div></section>' +
          /* 4 完成 */
          '<section class="vscr mid" id="vDone"><div class="vsc" style="display:flex;flex-direction:column;align-items:center;justify-content:center">' +
            '<div class="vmark"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#5f9dff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M4.6 12.6l4.9 4.9 9.9-10.9"/></svg></div>' +
            '<h1 class="vh" id="vDoneT">已生效</h1>' +
            '<p class="vp" id="vDoneS">场地格点已切换，之后可在设置里更改。</p>' +
            '<div class="vsum"><span>当前档位</span><b id="vSumVal">内置标准</b></div>' +
          '</div><div class="vfoot"><button class="vbtn pri" id="vFinish">完成</button></div></section>' +
        '</div></div>';
    document.body.appendChild(root);

    root.querySelector('#vNext').onclick = function () { show('data'); };
    root.querySelector('#vSkip').onclick = function () { applyTier('builtin'); };
    root.querySelector('#vBack').onclick = function () { show('welcome'); };
    root.querySelector('#vGo').onclick = function () { start(); };
    root.querySelector('#vCancel').onclick = function () { cancelJob(); };
    root.querySelector('#vJobNext').onclick = function () { show('done'); };
    root.querySelector('#vFinish').onclick = function () { close(); };
    root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !busy) close(); });
    return root;
  }

  function show(id) {
    if (!root) return;
    var map = { welcome: 'vWelcome', data: 'vData', job: 'vJob', done: 'vDone' };
    ['vWelcome', 'vData', 'vJob', 'vDone'].forEach(function (k) {
      root.querySelector('#' + k).classList.toggle('on', k === map[id]);
    });
    cur = id;
    var steps = mode === 'wizard' ? 4 : 1;
    var idx = { welcome: 1, data: mode === 'wizard' ? 2 : 1, job: 3, done: steps }[id] || 1;
    var stepEl = root.querySelector('#vStep');
    stepEl.textContent = mode === 'wizard' ? ('步骤 ' + Math.min(idx, steps) + ' / ' + steps) : '';
    root.querySelector('.vt').textContent = mode === 'wizard' ? '场地格点 · 首次设置' : '场地格点';
  }

  function renderOpts() {
    var host = root.querySelector('#vOpts');
    host.innerHTML = '';
    TIERS.forEach(function (t) {
      var info = (st && st.tiers && st.tiers[t.k]) || {};
      var ready = t.k === 'builtin' || info.ready;
      var b = el('button', 'vopt' + (sel.k === t.k ? ' sel' : ''));
      b.type = 'button';
      b.innerHTML =
        '<span class="vt2">' + esc(t.t) + '<span class="vdeg">' + esc(t.s) + '</span></span>' +
        '<span class="vd">' + esc(t.d) + '</span>' +
        '<span class="vsz">' + esc(t.size) + '</span>' +
        '<span class="vst">' + (t.k === 'builtin' ? '内置' : (ready ? '已就绪' : '需下载')) + '</span>';
      b.onclick = function () {
        if (busy) return;
        sel = { k: t.k, label: t.t + '（' + t.s + '）' };
        renderOpts();
      };
      host.appendChild(b);
    });
  }

  function fmtMB(mb) { return mb < 10 ? mb.toFixed(1) : String(Math.round(mb)); }

  function setBar(pct, amt, spd, eta) {
    root.querySelector('#vFil').style.width = Math.max(0, Math.min(100, pct)) + '%';
    root.querySelector('#vPct').textContent = Math.floor(pct) + '%';
    if (amt != null) root.querySelector('#vAmt').textContent = amt;
    if (spd != null) root.querySelector('#vSpd').textContent = spd;
    if (eta != null) root.querySelector('#vEta').textContent = eta;
  }

  function onJob(ev) {
    var j = ev && ev.job;
    job = j;
    if (!j) { setBar(100, null, '完成', ''); return; }
    if (j.kind === 'download') {
      var mb = j.done / 1048576, tot = j.total / 1048576;
      var now = Date.now(), dt = (now - lastAt) / 1000;
      if (lastAt && dt > 0.15) { speed = (j.done - lastBytes) / 1048576 / dt; lastAt = now; lastBytes = j.done; }
      else if (!lastAt) { lastAt = now; lastBytes = j.done; }
      root.querySelector('#vJobTitle').textContent = '正在下载官方数据';
      root.querySelector('#vJobSub').textContent = 'USGS Global Vs30 · 581.9 MB（下完自动在本地聚合）';
      setBar(tot ? mb / tot * 100 : 0, fmtMB(mb) + ' / ' + fmtMB(tot) + ' MB',
        speed > 0 ? speed.toFixed(1) + ' MB/s' : '正在连接…',
        speed > 0 ? '剩余约 ' + Math.ceil((tot - mb) / speed) + ' 秒' : '');
    } else {
      root.querySelector('#vJobTitle').textContent = '正在本地聚合';
      root.querySelector('#vJobSub').textContent = '在 APP 内解析官方 HDF5 并生成格点，不联网、不依赖 Python';
      setBar(j.done / (j.total || 1) * 100, '当前档位：' + sel.label, j.phase || '', '');
    }
  }

  function start() {
    if (busy) return;
    show('job');
    busy = true;
    root.querySelector('#vCancel').hidden = false;
    root.querySelector('#vJobNext').hidden = true;
    root.querySelector('#vJobTitle').textContent = '准备中';
    root.querySelector('#vJobSub').textContent = sel.label;
    setBar(0, '', '正在检查已有数据…', '');
    var t = sel.k;
    if (t === 'builtin') { busy = false; return applyTier('builtin'); }
    if (st && st.tiers && st.tiers[t] && st.tiers[t].ready) { busy = false; return applyTier(t); }

    var needDownload = !(st && st.src);
    var p = needDownload ? SVC.download() : Promise.resolve({ ok: true });
    p.then(function () { return SVC.build(t); })
      .then(function (r) {
        busy = false;
        return SVC.setTier(t).then(function () {
          st = null;
          root.querySelector('#vSumVal').textContent = sel.label;
          root.querySelector('#vJobNext').hidden = false;
          root.querySelector('#vCancel').hidden = true;
          root.querySelector('#vJobTitle').textContent = '聚合完成';
          root.querySelector('#vJobSub').textContent = (r.rows + ' × ' + r.cols + ' 格 · ' + (r.bytes / 1048576).toFixed(1) + ' MB');
          setBar(100, '', '完成', '');
          applyRuntime(t);
          setTimeout(function () { show('done'); }, 500);
        });
      })
      .catch(function (e) {
        busy = false;
        root.querySelector('#vCancel').hidden = false;
        root.querySelector('#vJobNext').hidden = true;
        root.querySelector('#vJobTitle').textContent = '出错了';
        root.querySelector('#vJobSub').textContent = String(e && e.message || e);
        setBar(0, '', '已停止', '');
        if (global.QVToast) QVToast('场地数据：' + (e && e.message || e));
      });
  }

  function cancelJob() {
    if (!busy) { show('data'); return; }
    SVC.cancel().then(function () { busy = false; show('data'); }, function () { busy = false; show('data'); });
  }

  function applyTier(t) {
    SVC.setTier(t).then(function () {
      var lbl = t === 'builtin' ? '内置标准（0.25°）' : (sel.label || t);
      root.querySelector('#vSumVal').textContent = lbl;
      return applyRuntime(t).then(function () { show('done'); });
    });
  }

  /** 收集需要预热的坐标（测站 + 区县中心 + 海底站）—— 1km 档靠这个工作 */
  function primeCoords() {
    var pts = [], seen = {};
    ['QV_TEN', 'QV_TEN_REMOTE', 'QV_CN', 'QV_STEN'].forEach(function (n) {
      var a = global[n];
      if (!a || !a.length) return;
      for (var i = 0; i < a.length; i++) {
        var p = a[i];
        if (!p) continue;
        var la = +p[1], lo = +p[0];
        if (!isFinite(la) || !isFinite(lo)) continue;
        var k = la.toFixed(4) + ',' + lo.toFixed(4);
        if (seen[k]) continue;
        seen[k] = 1; pts.push([la, lo]);
      }
    });
    return pts;
  }

  /** 调渲染层批量预热（异步；失败不影响主流程） */
  function prime() {
    if (!global.QVVs30Prime) return Promise.resolve(0);
    var pts = primeCoords();
    if (!pts.length) return Promise.resolve(0);
    return global.QVVs30Prime(pts).catch(function () { return 0; });
  }

  /** 通知渲染层：切到哪一档（vs30.js 会据此加载） */
  function applyRuntime(t) {
    if (!global.QVVs30SetTier) return Promise.resolve(null);
    return Promise.resolve(global.QVVs30SetTier(t)).then(function (r) {
      return prime().then(function () { return r; });
    }, function () { return null; });
  }

  var UI = {
    open: function (m) {
      if (!SVC) SVC = global.qv && global.qv.vs30;      /* 允许延迟注入（网页版调试用） */
      if (!SVC) { if (global.QVToast) QVToast('场地数据仅在桌面版可用'); return; }
      mode = m === 'settings' ? 'settings' : 'wizard';
      build();
      root.classList.add('on');
      root.focus();
      busy = false;
      st = null;
      SVC.status().then(function (s) {
        st = s;
        var active = s.tier || 'builtin';
        var hit = TIERS.filter(function (t) { return t.k === active; })[0];
        sel = { k: active, label: hit ? (hit.t + '（' + hit.s + '）') : active };
        renderOpts();
        root.querySelector('#vSumVal').textContent = sel.label;
        show(mode === 'wizard' ? 'welcome' : 'data');
      }, function () { renderOpts(); show('data'); });
    },
    close: function () { if (root) root.classList.remove('on'); }
  };
  function close() { UI.close(); }

  if (SVC && SVC.onEvent) SVC.onEvent(onJob);

  /* 启动时恢复上次选的档位，并把测站坐标预热好（1km 档必需） */
  try {
    setTimeout(function () {
      var S = global.qv && global.qv.vs30;
      if (!S) return;
      S.status().then(function (s) {
        var t = (s && s.tier) || 'builtin';
        if (t === 'builtin') return;
        return applyRuntime(t);
      }, function () { });
    }, 3000);
  } catch (e) { }

  global.QVVs30UI = UI;
  /* 调试用：一眼看内部状态（会不会卡在 busy / sel 上） */
  global.QVVs30DBG = function () {
    return { cur: cur, busy: busy, sel: sel, hasSt: !!st, hasSvc: !!SVC,
      tiers: st && st.tiers, mode: mode };
  };

  /* 首次启动：启动页消失后自动弹出向导（只弹一次） */
  try {
    var KEY = 'koneew_vs30_wizard_done';
    var first = !global.localStorage || localStorage.getItem(KEY) !== '1';
    if (first) {
      var tick = setInterval(function () {
        var boot = document.getElementById('boot');
        var stage = document.getElementById('stage');
        if (boot && boot.hasAttribute('hidden') && stage && !stage.hasAttribute('hidden')) {
          clearInterval(tick);
          localStorage.setItem(KEY, '1');
          if (SVC) UI.open('wizard');
        }
      }, 800);
      setTimeout(function () { clearInterval(tick); }, 120000);
    }
  } catch (e) { }
})(window);
