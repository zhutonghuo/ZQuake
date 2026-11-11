/* titlebar.js — 自绘标题栏（KonS / KonT Screen Tracker 同款结构）（2026-10-28）
 *
 * 用户：「把顶部 Windows 原生的顶部栏改成 KonS 同款的更好看」
 *
 * 设计取自 KonT Screen Tracker（C:\kont-exe\styles.css `.titlebar`）：
 *   · 40px 高，左侧 图标+标题（13px/600），右侧三个 46px 宽的窗口按钮
 *   · 整条 -webkit-app-region: drag（可拖窗口），按钮区 no-drag
 *   · 关闭键 hover 变 Windows 红 #e81123
 *   · 最大化/还原两个图标按状态切换（.maximized）
 *
 * ⚠️ 只在 Electron 里生效：window.qv.win.min 不存在（网页版）就整条不显示，
 *    也不给 <body> 加 .shell —— 网页版一行布局都不动。
 * ⚠️ frame:false 后系统按钮消失，所以 main.js / preload.js 那边配了
 *    qv:win:min|max|close|state 四个 IPC + qv:win:maxchanged 推送。
 */
(function () {
  'use strict';
  var W = window.qv && window.qv.win;
  if (!W || typeof W.min !== 'function') return;      /* 网页版：不做任何事 */

  var bar = document.getElementById('qvtitlebar');
  if (!bar) return;

  /* 先把 .shell 打上再显示，避免 #stage/#boot 从 0 高度跳一下 */
  document.body.classList.add('shell');
  bar.hidden = false;

  var btnMin = document.getElementById('tbMin');
  var btnMax = document.getElementById('tbMax');
  var btnClose = document.getElementById('tbClose');

  if (btnMin) btnMin.addEventListener('click', function (e) { e.stopPropagation(); W.min(); });
  if (btnMax) btnMax.addEventListener('click', function (e) { e.stopPropagation(); W.max(); });
  if (btnClose) btnClose.addEventListener('click', function (e) { e.stopPropagation(); W.close(); });

  /* 双击拖动区 = 最大化/还原（Windows 原生行为） */
  bar.addEventListener('dblclick', function (e) {
    if (e.target && e.target.closest && e.target.closest('button')) return;
    W.max();
  });

  function setMax(v) { if (btnMax) btnMax.classList.toggle('maximized', !!v); }
  try {
    if (typeof W.state === 'function') {
      W.state().then(setMax, function () { });
    }
    if (typeof W.onMax === 'function') W.onMax(setMax);
  } catch (e) { }

  /* ★★★ 2026-10-30 用户：「全屏应该隐藏顶部栏」
     全屏（F11 / qv.win.fullscreen()）时：
       · body.fs  —— CSS 里把 #qvtitlebar 关掉（兜底层）
       · 摘掉 .shell —— app.js layout() 的 TB 因此变 0、#stage 顶回 0，
         舞台铺满整块屏幕（否则顶上会空 40px 黑条）
     退出全屏时原样恢复。 */
  function setFs(v) {
    var fs = !!v;
    document.body.classList.toggle('fs', fs);
    document.body.classList.toggle('shell', !fs);
    try { if (window.QVLayout) window.QVLayout(); } catch (e) { }
    try { window.dispatchEvent(new Event('resize')); } catch (e) { }
  }
  try {
    if (typeof W.onFs === 'function') W.onFs(setFs);
  } catch (e) { }
})();
