/* views.js — 四个主视图（左侧官方 4 个图标）+「按钮永远在最上层」的顶栏层
 *
 * 官方语义（反编译 + 运行时实测，见交接文档第十六节）：
 *   0 ⓘ 地震信息 / 1 ✎ 调试（晃动检测）/ 2 ▲ 海啸信息 / 3 ⚙ 设置
 *   舞台变量「タブ」就是视图索引；`tabBs` 选中滑块跟着视图上下滑。
 *
 * ★★ 用户四点要求（本文件就是为此重写的）：
 *   ① 切换四个视图时【地图不变化】—— 信息都画在同一张地图上
 *      ⇒ #map 任何视图都显示；视图切换不碰相机、不碰震中标记
 *   ② 第二/三/四页【不许遮住按钮】
 *      ⇒ 图标（tabB 系列 + timebg0）与地图按钮（FlZom0/FlFit0）搬进 #chrome（z-index 最高）
 *   ③ 设置页：字体要有层次 / 不许叠在一起 / 按钮必须有用
 *      ⇒ 版式来自 build/gen-view3b.js（官方 5 块真面板顺序拼合，三档字号 head22/row18/note15.5）
 *      ⇒ 每个控件都可点/可拖，并且【真的接线】到行为（见 WIRE）
 *   ④ 相机看不了周围 ⇒ 见 mapcam.js（夹紧框 / K_MIN / 适配按钮 fit()）
 */
(function (global) {
  'use strict';
  var SW = 960, SH = 720;
  var R = global.QVRender;
  var stage = null;

  /* ★★★ 2026-10-26 用户：「上传 eew.konwk.com，但是要把模拟地震的模板入口给 ban 了、隐藏起来；
     打包 app 版，这个就是无限制的」
     ⇒ 历史模板库（模式二选一里的「历史模板」卡 + 第 3 步的模板库入口）只在**本地/应用内**出现：
         · app：main.js 用 win.loadFile() 加载 → location.protocol === 'file:' → 开启
         · 线上 https://eew.konwk.com → 隐藏，连按钮都不渲染（不是靠 CSS 遮）
     ⚠️ 只在构建入口判一次；不要加 ?simhist=1 之类的后门参数。 */
  var SIM_HIST = !!(global.location && global.location.protocol === 'file:');

  /* ---------------- 顶栏 / 面板元素表 ---------------- */
  /* ★ 「按钮类」元素搬进 #chrome —— 只为它们不被视图版面遮住。
     ⚠️ `timebg0`（时钟底）**不能**搬：它在 #chrome(z7) 会盖住 #txt(z5) 里的时钟数字
        → 时钟整个看不见（两个视图都中招）。它留在 #art(z3) 里，数字永远画在它上面。 */
  var CHROME_RE = /^(tabB|tabBs|tabBn\d|tabBb\d|FlZom0|FlFit0)$/;
  /* ★ 2026-10-21 用户：「右上角那个时间背景，黑色背景只有在（当前）tab 页面有，
     其他 tab 切过去立马不显示了」
     ⇒ 以前写的是 `timebg`，而造型名是 **timebg0**，`^(…|timebg|…)$` 整串匹配不上
       → 切到 1/2/3 页时这块黑底被 display:none 掉了（时钟数字还在，底没了）。 */
  var VIEW_KEEP = /^(bgsq|timebg\d*|100l|100u)$/;   /* 非情报视图仍要保留的图形（含时钟底） */
  var VIEW_BTN = { x: 242, y: 6, step: 32, w: 32, h: 32 };
  var ROW_HIT = { x: 8, y: 414, w: 240, h: 76, step: 76 };
  var SKEY = 'qv.settings.v3', VKEY = 'qv.view.v1';

  /* ---------------- 设置项 ⇄ 行为 接线表 ---------------- */
  /* key = 官方行标签（gen-view3b 里的 label），opt = 行为开关名 */
  var WIRE = {
    '自动移动镜头': 'follow',       /* 选中地震时是否自动运镜 */
    '镜头动画': 'anim',             /* 运镜是否带过渡动画 */
    '计算频率限制': 'freq',         /* 主循环周期 */
    '使用实时烈度': 'lieduAll',     /* 非日台源也用烈度卡 */
    '使用晃动检测': 'detect',       /* 调试页可用 */
    /* ⚠️ 「震度等级换算」【故意不接线】—— 理由见下面 NO_SENSOR 的注释。
       官方它是给晃动检测的计测烈度做换算用的；我们以前把它接成「非日台源也显示
       『最大震度』标签」，属于臆造语义 → 烈度卡被贴上震度标签（概念混用）。 */
    '晃动检测区分与震中检测': 'detectSplit',
    '在检出的震源显示 P/S 波圆': 'psWave',
    '海啸信息发布中，海啸': 'tsuAuto',   /* 有海啸时自动切到海啸页 */
    'UI 大小': 'uiScale',
    '横屏画面布局': 'landscape',
    '自动隐藏按钮': 'autoHide',
    '图层切换按钮': 'layerBtn',
    '显示样式': 'mapStyle',
    '显示世界地图': 'world',
    '显示海底地形': 'ocean',
    '图标大小': 'pinSize',
    '地图预读': 'preload',
    '地图上显示的信息': 'pinMode',
    '切换时的缩放率': 'zoomRate',
    '地图填充': 'fillStyle',
    '检测显示类型': 'detectType',
    '填充预估圆': 'fillCircle',
    '使用强震监视器的震度 3 以下预测烈度': 'strongMon',
    '显示震度 0 的图标': 'shindo0',
    '显示海底地震计': 'seaSensor',
    '各海啸观测点的观测值': 'tsuObs',
    '显示': 'tsuObs',
    /* ---- ★ 声音・朗读：以前这些全是「点了只弹提示」的假按钮（用户：「按钮全是废物」）。
            现在接到 app/js/audio.js：朗读走 Web Speech，音效用 WebAudio 合成，不需要素材。---- */
    '播放音效': 'sndEffect',
    '播放信息更新音': 'sndInfo',
    '播放猫叫警报音': 'sndCat',
    '语音朗读': 'voiceOn',
    '朗读警报地区': 'voiceArea',
    '播放音效的预测烈度': 'sndFelt',
    '播放音效的震级': 'sndMag',
    '朗读的预测烈度': 'voiceFelt',
    '播放震度检出音': 'sndDetect',
    '朗读检出地区': 'voiceDetect',
    '播放音效的震度': 'sndShindo',
    '朗读最大震度地区': 'voiceMaxArea',
    '朗读震度 3 以上地区': 'voiceShindo3',
    '语音朗读的震度': 'voiceShindo',
    /* ⚠️⚠️ 下面这些是 gen-view3c.js 的 LABEL_FIX 把长标签【改短】后的名字。
       WIRE 只认原名 → 控件 `c.label` 是短名 → 查不到 → 开关点了【完全不生效】。
       这是「这些按钮全是废物」的一个真因（2026-10-10 修）。改标签时必须同步这里。 */
    '频率限制': 'freq',
    '震源显示 P/S 波圆': 'psWave',
    '晃动检测区分・震中检测': 'detectSplit',
    '震度 3 以下的预测烈度': 'strongMon',
    '海啸发布中的海啸': 'tsuAuto',
    '各观测点观测值': 'tsuObs'
  };
  /* 这些还没有对应实现 → 点击给一个明确提示（不做「按了没反应」的假按钮） */
  var TODO = {
    preload: '地图预读（本版常驻内存）',
    fillStyle: '实时页填充',
    detectType: '实时页检测显示',
    fillCircle: '填充预估圆',
    strongMon: '强震监视器',
    seaSensor: '海底地震计'
  };
  /* ★ 「本版没实现」的行 → 点一下必须【说清楚】，不能只是静默翻个开关
       （用户原话：「这些按钮全是废物，没有用的」）
       ① 声音/朗读类：官方会出声、会念，本版没有音频 → 统一提示
       ② 晃动检测类：官方靠本机传感器，本版没有 → 统一提示
       ③ 其余在 TODO 里的按 TODO 的原因提示  */
  var AUDIO_OPT = { sndEffect: 1, sndInfo: 1, sndCat: 1, voiceOn: 1, voiceArea: 1, sndFelt: 1,
    sndMag: 1, voiceFelt: 1, sndDetect: 1, voiceDetect: 1, sndShindo: 1, voiceMaxArea: 1,
    voiceShindo3: 1, voiceShindo: 1 };
  /* ★ 本版没有本地传感器 → 这些开关点一下必须【说清楚】，不能静默翻个开关了事。
     ⚠️ 「震度等级换算」原本被我们接成了「非日台源也显示『最大震度』标签」，
        那是臆造的语义。反编译确证官方真实用途：
          晃动检测的克隆体在造型为 "sndm" 时执行
          `switch costume to join("sndm", item_of_list( d #震度換算30段階 , …))`
        即把**计测烈度**按 30 段阶表换算成**震度阶级** —— 跟「外国机构的烈度」无关。
        ⇒ 摘掉那条接线归到这里：没有传感器 → 没有计测烈度 → 无从换算。 */
  var NO_SENSOR = { '使用晃动检测': '本版无本地传感器',
                    '晃动检测区分与震中检测': '本版无本地传感器',
                    '震度等级换算': 'SREV 用于把计测烈度换算成震度（需本地传感器）' };
  function unwiredReason(c) {
    var lab = (c && c.label) || '';
    if (NO_SENSOR[lab]) return NO_SENSOR[lab];
    var o = WIRE[lab];
    if (o && TODO[o]) return TODO[o];
    if (!o) return '本版未接入';
    return '';
  }
  var MAPSTYLE = ['标准', '高对比', '暗淡', '暖色', '冷色', '夜间'];
  var FILTERS = ['', 'contrast(1.35) saturate(1.15)', 'brightness(.72)', 'sepia(.35) saturate(1.2)',
    'hue-rotate(-18deg) saturate(1.1)', 'brightness(.55) contrast(1.2)'];
  var PINMODE = ['全部', '仅速报', '仅正式报', '不显示'];
  var CYCVALS_DEFAULT = { paPcn1: MAPSTYLE, paPcn2: ['无', '预测烈度', '强震震度', '警报发布地区', '强震震度+预测烈度', '警报地区+预测烈度', '长周期地震动阶级'], paPcn6: PINMODE };

  /* ---------------- 状态 ---------------- */
  var V = {
    view: 0,
    rows: [],
    sel: null,
    ready: false,
    focusMode: false,
    opts: {
      follow: 1, anim: 1, freq: .5, lieduAll: 1, detect: 1, detectSplit: 0,
      /* ★ 2026-10-24 用户：「海啸发布中的海啸信息页设为默认 —— 这个也要打开」 */
      tsuAuto: 1, uiScale: .5, landscape: 0, autoHide: 0, layerBtn: 0, mapStyle: 0,
      world: 1, ocean: 1, pinSize: .5, preload: 0, pinMode: 0, zoomRate: .5,
      fillStyle: 0, detectType: 0, fillCircle: 0, strongMon: 0, shindo0: 0, seaSensor: 0, tsuObs: 0,
      /* ★ 2026-10-25 用户：「正式报的数字震度提示和查看观测点震度规则不冲突，但是设置里只能选择
         1. 正式报的各个观测点在震中的最大震度  2. 正式报各个区域震度」
         → 'area' = 一区一标（默认）；'station' = 逐观测点。
         紧急地震速报阶段两者都不用（只给实时观测点）。 */
      markMode: 'area'
    },
    values: {},        /* 控件序号 → 值（localStorage 持久） */
    ctrl: [],          /* 当前视图控件表 */
    scroll: 0,
    /* ★ 2026-10-29：长周期階級按事件持久化。
       VXSE62 只在事件当时来一次；模拟/下一场会把 V.eew 换掉，
       履历小卡片（paTml）不能只靠当前 E 的 maxLg。仅存真实报文。 */
    maxLgByEvent: {}
  };
  V.opts.uiScale = 0.5;     /* 0.5 = 100% */
  /* 载入上次记下的长周期階級（按事件号） */
  try {
    var _lgSaved = JSON.parse(localStorage.getItem('koneew.maxLgByEvent') || '{}');
    for (var _lgk in _lgSaved) {
      var _lgv = +_lgSaved[_lgk];
      if (isFinite(_lgv) && _lgv > 0) V.maxLgByEvent[_lgk] = Math.max(1, Math.min(4, _lgv | 0));
    }
  } catch (e) { }
  try { V.opts.markMode = (localStorage.getItem('koneew.markMode') === 'station') ? 'station' : 'area'; } catch (e) { }
  try {
    var sv = JSON.parse(localStorage.getItem(SKEY) || '{}');
    for (var k in sv) V.values[k] = sv[k];
  } catch (e) { }
  try { V.view = Math.max(0, Math.min(3, parseInt(localStorage.getItem(VKEY) || '0', 10) || 0)); } catch (e) { }
  /* ★ 深链：app/index.html#view=1|2|3&scroll=1200
     （用户可直接分享/跳转到某页；也是截图验收用的入口）
     ⚠️ hash 只在启动时读一次，读到的滚动量消费掉后就不再干预（免得每秒重绘把滚动拽回去） */
  (function hashInit() {
    var h = location.hash || '', m;
    if ((m = /[#&]view=(\d)/.exec(h))) V.view = Math.max(0, Math.min(3, parseInt(m[1], 10) || 0));
    if ((m = /[#&]scroll=(-?\d+)/.exec(h))) V.hs = parseInt(m[1], 10) || 0;
  })();

  function save() { try { localStorage.setItem(SKEY, JSON.stringify(V.values)); } catch (e) { } }
  function opt(name) { return V.opts[name]; }
  /** 记下某场地震的长周期階級（只接受 1~4；0/-1 视为没有） */
  function rememberMaxLg(eid, lg) {
    var k = String(eid || '').trim();
    if (!k || !(+lg > 0)) return;
    V.maxLgByEvent[k] = Math.max(1, Math.min(4, +lg | 0));
    /* 事件当时只来一封 VXSE62；刷新后履历小卡片也要能接上，所以持久化。
       只保留最近 200 个事件号，避免无限增长。 */
    try {
      var ks = Object.keys(V.maxLgByEvent);
      if (ks.length > 200) {
        ks.sort();
        for (var i = 0; i < ks.length - 200; i++) delete V.maxLgByEvent[ks[i]];
      }
      localStorage.setItem('koneew.maxLgByEvent', JSON.stringify(V.maxLgByEvent));
    } catch (e) { }
  }
  /** 按事件号取长周期階級；支持 JMA:20261029033230 这种带前缀的 id */
  function maxLgOfEvent(eid) {
    var k = String(eid || '').trim();
    if (!k) return -1;
    if (V.maxLgByEvent[k] > 0) return V.maxLgByEvent[k];
    var m = /\d{14}/.exec(k);
    if (m && V.maxLgByEvent[m[0]] > 0) return V.maxLgByEvent[m[0]];
    return -1;
  }
  /* ★ 2026-10-29：JMA 的長周期地震動情報（VXSE62）只在事件当时推一次；
     刷新/后开 App 时历史行拿不到階級。用 JMA 官方 XML feed 回填最近 24h 的
     VXSE62（与 DM 电报同源），按 EventID 写进 maxLgByEvent。
     ★ 只在浏览器里跑；CORS 已实测可用；10 分钟内不重复拉。 */
  function backfillJmaLg() {
    if (!global.fetch || typeof DOMParser === 'undefined') return;
    var K = 'koneew.jmaLgAt';
    try { if (Date.now() - (+localStorage.getItem(K) || 0) < 10 * 60000) return; } catch (e) { }
    var FEED = 'https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml';
    fetch(FEED, { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (txt) {
      var doc = new DOMParser().parseFromString(txt, 'application/xml');
      var ents = doc.getElementsByTagNameNS('*', 'entry');
      var urls = [];
      for (var i = 0; i < ents.length && urls.length < 6; i++) {
        var e = ents[i];
        var ti = e.getElementsByTagNameNS('*', 'title')[0];
        var id = e.getElementsByTagNameNS('*', 'id')[0];
        var up = e.getElementsByTagNameNS('*', 'updated')[0];
        var title = (ti && ti.textContent) || '';
        var link = (id && id.textContent) || '';
        var ms = up ? Date.parse(up.textContent) : 0;
        if (!/VXSE62|長周期/.test(title + ' ' + link)) continue;
        if (ms && Date.now() - ms > 24 * 3600000) continue;
        if (link) urls.push(link);
      }
      urls.forEach(function (u) {
        fetch(u, { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (x) {
          var eid = (x.match(/<EventID>(\d{14})<\/EventID>/) || [])[1];
          var lg = (x.match(/<MaxLgInt>(\d)<\/MaxLgInt>/) || [])[1];
          if (eid && lg && +lg > 0) {
            rememberMaxLg(eid, +lg);
            if (global.QVRedraw) global.QVRedraw();
          }
        }).catch(function () { });
      });
      try { localStorage.setItem(K, String(Date.now())); } catch (e) { }
    }).catch(function () { });
  }
  /** ★★★ 2026-10-25 用户：「加速功能是坏的，就加速了动画，其他的都没有加速」
   *   以前倍率只传给 QVMapCam.simWave（波圈时钟），报文循环、震度爬升、
   *   调查中/正式报的定时器全部还是真实时间。现在统一用 simSpd() 去缩。 */
  function simSpd() {
    try {
      var k = (global.QVPlanet && QVPlanet.speed) ? (+QVPlanet.speed() || 1) : 1;
      return k > 0 ? k : 1;
    } catch (e) { return 1; }
  }

  /* ---------------- 小工具 ---------------- */
  function el(tag, css, attrs) {
    var d = document.createElement(tag);
    if (css) d.style.cssText = css;
    if (attrs) for (var k in attrs) d.setAttribute(k, attrs[k]);
    return d;
  }
  function layer(id, z) {
    var l = document.getElementById(id);
    if (!l) {
      l = el('div', 'position:absolute;left:0;top:0;width:' + SW + 'px;height:' + SH + 'px;display:none;z-index:' + z);
      l.id = id;
      var art = document.getElementById('art');
      (art && art.parentNode ? art.parentNode : stage).insertBefore(l, art ? art.nextSibling : null);
    }
    return l;
  }
  var toastEl = null, toastT = 0;
  function toast(msg) {
    if (!toastEl) {
      toastEl = el('div', '', { id: 'qvtoast' });
      stage.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.className = 'on';
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.className = ''; }, 1800);
  }
  function txt(host, text, x, cy, size, color, weight, align) {
    var d = global.QVT.zh(host, {
      text: text, x: x, y: Math.round(cy - size / 2), size: size,
      color: color, weight: weight || 400, align: align || 'left'
    });
    /* ★ 记下锚点与对齐方式：图层还是 display:none 时 offsetWidth = 0，
       右对齐/居中会算错（文字整体偏出去、滑杆数值溢出面板）
       → 等图层真的显示出来，realign3() 再按真实宽度摆一次 */
    if (d) { d.dataset.ax = x; d.dataset.al = align || 'left'; }
    return d;
  }

  /* ---------------- ① 把「按钮类」元素搬进 #chrome ---------------- */
  function moveChrome() {
    var chrome = layer('chrome', 7);
    var art = document.getElementById('art');
    if (!art || !chrome) return;
    var imgs = Array.prototype.slice.call(art.querySelectorAll('img'));
    imgs.forEach(function (im) {
      if (CHROME_RE.test(im.dataset.cos || '')) chrome.appendChild(im);
    });
    chrome.style.display = '';
  }

  /* ---------------- 视图版面层 ---------------- */
  var L1 = null;
  /* ★★ 视图 1 = 官方的「リアルタイム／揺れ検出」页。
     官方实拍（diag/ref/OFF-view1.png，960x720 逐像素）里**只有一件东西**：
     造型 `nashi`（「表示するものはありません」）画布 192x24 @(24,348)。
     ★ 旧版凭空贴两块 paDbg0/paDbg1（392+392=784 > 720 → 溢出屏幕），已删；
       中文说明也改成宽度受控（不再从 x=132 溢到 457）。 */
  function build1() {
    var host = layer('view1', 6);
    host.innerHTML = '';
    var inner = el('div', 'position:absolute;left:0;top:0;width:960px;height:720px');
    inner.id = 'view1in';
    host.appendChild(inner);
    var D1 = global.QV_VIEW1;
    (D1 && D1.art ? D1.art : []).forEach(function (a) {
      /* ★ 2026-10-21 用户：「这个也换成中文」（第二个 Tab 的空状态）
         `nashi` 造型 = 192×24 @(24,348)，里面「表示するものはありません」
         是**烤进 path 的日文**（svg 里 aria-label 写着）。
         不去改官方素材：这张图不画，在同一位置画中文（见下面 L1.nashi）。 */
      if (a[0] === 'nashi') return;
      var im = new Image();
      im.src = 'assets/ui3c/' + a[0] + '.svg';
      im.draggable = false;
      im.dataset.cos = a[0];
      im.alt = '';
      im.style.cssText = 'position:absolute;left:' + a[1] + 'px;top:' + a[2] +
        'px;width:' + a[3] + 'px;height:' + a[4] + 'px';
      inner.appendChild(im);
    });
    var Z = global.QV_ZH || {};
    L1 = { host: host, inner: inner, bottom: SH, min: 0, note: null, nashi: null };
    /* 官方面布 192×24 @(24,348)；原日文墨迹左缘在画布内 17.7 → 舞台 x≈41.7，
       颜色 = 官方 fill #fff @ 67%。
       ★ 2026-10-21 用户定稿：文案「暂时没有新情报呢喵」+ 用【官方比例】那组数值
         （左缘 ≈ 0.128×面板宽 = 31、行中心 ≈ 窗口高 50% = 388、字号 ≈ 面板宽×0.064 = 15.5）。
       ★ 再改：用户「太靠左（往右挪）」→ 水平居中在左栏（盒 20..220，中心 120）。
       ★★ 2026-10-21 用户：「Tab2 和 Tab3 的字体不一样」→「字体的位置不一样，不在同一个行」
         ⇒ 改用和另一个页提示**完全相同**的写法：QVT.zh({ x:120, y:360, size:17,
           align:'center' })，不再自己套 24px 行高的盒子（那会让基线差 19px）。 */
    var nz = null;
    try {
      if (global.QVT && global.QVT.zh) {
        nz = global.QVT.zh(inner, { text: '暂时没有新情报呢喵', x: 120, y: 360, size: 17,
          color: '#eef2f7', align: 'center' });
      }
    } catch (e) { nz = null; }
    if (!nz) {
      nz = el('div', '');
      nz.textContent = '暂时没有新情报呢喵';
      nz.style.cssText = 'position:absolute;white-space:nowrap;' +
        "font-family:'NotoSC','Noto Sans SC','Source Han Sans SC','Microsoft YaHei UI',sans-serif;" +
        'font-size:17px;line-height:1;color:#eef2f7;left:60px;top:360px';
      inner.appendChild(nz);
    }
    nz.style.pointerEvents = 'none';
    /* ⚠️ 不能用 offsetWidth 手动居中 —— 视图没显示时 #view1in 宽高为 0。
       改成「固定宽度的盒子 + text-align:center」（不依赖测量），
       行高/字号/顶部与另一个页的提示完全一致（17 / 17 / 360），视觉上同一条基线。 */
    nz.style.left = '20px';
    nz.style.top = '360px';
    nz.style.width = '200px';
    nz.style.lineHeight = '17px';
    nz.style.textAlign = 'center';
    L1.nashi = nz;
    /* ★ 2026-10-20 用户：「都是黑的为什么要加个括号叫做本版不提供传感器数据？
       这玩意也不是接本地的吧？把这个括号的祛掉」→ 这句自制补注已删。
       实时页官方就只有 造型 nashi（「表示するものはありません」）一句，
       这里不再叠任何自制说明。L1.note 保留为 null 以免其他位置的空引用。 */
    align1();
    host.dataset.built = '1';
  }

  /** 实时页文字重排：中心固定在面板中心 120，超出面板宽度就缩字号/换行 */
  function align1() {
    if (!L1 || !L1.note) return;
    var el2 = L1.note, w = el2.offsetWidth || 0;
    if (!w) return;                       /* 还没显示 → 下一帧再来 */
    var fs = parseFloat(el2.style.fontSize) || 11.5;
    while (fs > 9.5 && w > 208) { fs -= 0.5; el2.style.fontSize = fs + 'px'; w = el2.offsetWidth || 0; }
    el2.style.left = Math.round(120 - w / 2) + 'px';
  }

  /* ---------------- 视图 3（设置页） ---------------- */
  var L3 = null;
  function build3() {    var D = global.QV_VIEW3; if (!D) return;
    /* ★ 只在第一次构建时给生成器产物打补丁（D 是单例，重复 push 会翻倍） */
    if (!D._qv2) {
      D._qv2 = 1;
      /* ① 「显示震度 0 的图标」默认【开】：没有震度/烈度的地震画成官方震度0（灰底 + 大号 0），
            不再留一块空白。用户原话：「加个最大震度0的那个图标」「加个 0 的数字也好啊，
            你他妈空白的几个意思啊」。关掉则退回官方「不明」底板。 */
      D.ctrl.forEach(function (c) { if (c.label === '显示震度 0 的图标') c.def = 1; });
      /* ①b ★ 2026-10-24 用户：「海啸发布中的海啸信息页设为默认 —— 这个也要打开」 */
      D.ctrl.forEach(function (c) {
        if (/^海啸(信息)?发布中/.test(c.label || '')) c.def = 1;
      });
      /* ② 官方「其他」分组（paPb5_1 面板尾部）本来只有一个标题、底下全空
            → 补一个真按钮：素材授权必须保留（官方图形为 CC BY-SA 2.0 / 见 LICENSE-ASSETS.txt）
            ★ 位置跟随最后一个面板的底部（不再写死 3920） */
      var pb = 0;
      D.art.forEach(function (a) { if (/^paPb/.test(a[0])) pb = Math.max(pb, a[2] + a[4]); });
      D._panelBottom = pb;
      D.ctrl.push({ kind: 'button', label: '查看关于与素材授权', left: 24, top: pb - 46, w: 192, h: 36, def: 0 });
      /* ③ ★★ 用户要求：「配色・音效自定义」下面再单独加一个我们自己的按钮「模拟设置」
            —— 点开弹自制模态框，注入假的地震/海啸数据（玩 + 测功能）。
            坐标直接排在 配色・音效自定义(top=3160) 下一行；它所在的面板 paPb5_01
            是 3058..3250，3206..3242 正好放得下。
            ⚠️ 用 push 而不是 splice：控件下标 = 存档键（V.values[i]），
               插在中间会把后面控件的存档全部错位；push 不改任何旧下标。 */
      var cb = null;
      D.ctrl.forEach(function (c) { if (c.kind === 'button' && /配色/.test(c.label || '')) cb = c; });
      var simTop = cb ? (cb.top + 46) : 3206;
      D.ctrl.push({ kind: 'button', label: '地震模拟', left: 24, top: simTop, w: 192, h: 36, def: 0, sim: 1 });
      /* ③-b ★★ 2026-11-03 用户：「在设置那个其他那里加一个切换星球，
         点击切换星球，整个地图和算法就直接换成其他星球的就行了」
         → 排在「地震模拟」下面一行（3498 起 36px 高，paPb5_1 底边 3538 刚好装下）。 */
      D.ctrl.push({ kind: 'button', label: '切换星球', left: 24, top: 3478, w: 192, h: 36, def: 0, planet: 1 });
      /* ③-c ★★ 2026-10-27 用户：「为什么不加一个画面回放录像功能，不是录视频，
         是记录当时 api 层面什么的发生了什么」
         → 排到「切换星球」下面一行；同一块底板 paPb5_1 跟着长高 48px
           （纯背景板，纵向拉长没有形变问题）。 */
      D.ctrl.push({ kind: 'button', label: '事件录制・回放', left: 24, top: 3524, w: 192, h: 36, def: 0, rec: 1 });
      /* ③-d ★★★ 2026-10-28 用户：「API 内精度选择」——场地格点（Vs30）的档位
         官方只给一个 582MB 原始文件，档位是本地聚合出来的；
         下载/聚合/切换全在 vs30-ui.js 里，这里只负责开入口。
         接在「事件录制」下面一行，同一块底板 paPb5_1 再长高 48px。 */
      D.ctrl.push({ kind: 'button', label: '场地数据精度', left: 24, top: 3570, w: 192, h: 36, def: 0, vs30: 1 });
      /* ⑥ ★ 2026-10-21 用户：「其他单独做个分类吧」
         paPb5_1（3244..3526）本来就是官方的「其他」分类面板，但里面塞了「重置设置」，
         看着像两个分类混在一起。这里重排：
           · 重置设置 → 上移到 paPb5_01（高级设置面板 3058..3250）尾部
           · 其他     → 坐在自己面板的顶栏（居中，和其它大分类一样）
           · 其他 里依次：地震模拟按钮 / 版本 / 数据源 / 关于・素材授权 */
      D.labels.forEach(function (l) {
        /* ★ 2026-10-21 用户：「把重置设置和配色・音效自定义这两个文字给删掉，保留它们按钮就行」 */
        if (l.text === '配色・音效自定义' || l.text === '重置设置') { l._skip = 1; return; }
        if (l.text === '使用实验性功能') l.cy = 3118;
        if (l.text === '禁用启动时对话框') l.cy = 3082;
        if (l.text === '其他') l.cy = 3271;         /* 垂直居中在 28px 顶栏里 */
      });
      D.ctrl.forEach(function (c) {
        if (c.kind === 'toggle') {
          if (/使用实验性功能/.test(c.label || '')) c.top = 3100;
          if (/禁用启动时对话框/.test(c.label || '')) c.top = 3064;
          return;
        }
        if (c.kind !== 'button') return;
        if (/重置设置/.test(c.label || '')) c.top = 3196;
        else if (/配色/.test(c.label || '')) c.top = 3140;
        else if (/关于/.test(c.label || '')) c.top = 3386;
        else if (/地震模拟|模拟设置/.test(c.label || '')) c.top = 3432;   /* 排到「关于」下面 */
        else if (/切换星球/.test(c.label || '')) c.top = 3478;           /* 再往下：星球切换 */
      });
      D._infoCy = [3320, 3352];          /* 「其他」里 版本 / 数据源 两行（往上收，靠近顶栏） */
      /* ★ 2026-10-21 用户：「其他单独做个分类吧 / 和官方一样重新开个小卡片」
         官方素材里没有「只有卡片头」的造型（paPb5_1 是纯底板、无顶栏），
         所以：① 把 其他 的底板整体下移 12px，和上一张卡片拉开缝隙
               ② 上面盖一条从官方卡片 paPb5_0 裁下来的顶栏（见 build3）
               ③ 其他 标题居中在顶栏里 */
      (D.art || []).forEach(function (a) {
        if (a[0] === 'paPb5_1') { a[2] += 12; D._othBar = { x: a[1], y: a[2], w: a[3], h: 28 }; a[4] += 96; }
      });
      /* ④ ★★ 2026-10-21 用户：「本来应该是下拉框的设置选项被改成了状态按钮」+「间隔不对」
         `gen-view3c.js` 的兜底分支把所有没配到官方造型的行都做成了开关（kind:'toggle'），
         而音效/朗读这几行在官方是 **paPcb 下拉框**：
           播放音效的预测烈度 / 播放音效的震级 / 朗读的预测烈度 /
           播放音效的震度（实时烈度）/ 播放音效的震度（地震信息）/ 语音朗读的震度
         而开关几何是 `top = 标签中心 - 18`（贴着标签同一行），下拉框是**标签下面一行**
         → 结果既画成开关、又在本该放下拉框的地方留出 34px 空白（间隔看着不对）。
         ⇒ 这里统一改成官方下拉框几何：paPcb 180x40 @x10，top = 标签中心 + 17
           （与已有 4 个下拉框 显示样式/地图上显示的信息/地图填充/检测显示类型 一致）。 */
      /* 选项表 = 官方下拉框原样（用户 2026-10-21 给了官方截图）：
         すべて / 震度1以上 … 震度6强以上 / 震度7（最后一项没有「以上」）。 */
      var SHD = ['すべて', '震度1以上', '震度2以上', '震度3以上', '震度4以上',
        '震度5弱以上', '震度5强以上', '震度6弱以上', '震度6强以上', '震度7'];
      var CY_SND = {
        '播放音效的预测烈度': SHD.slice(),
        '朗读的预测烈度': SHD.slice(),
        '播放音效的震度': SHD.slice(),
        '语音朗读的震度': SHD.slice(),
        '播放音效的震级': ['すべて', 'M4以上', 'M5以上', 'M6以上', 'M7以上', 'M8以上']
      };
      D.ctrl.forEach(function (c) {
        if (c.kind !== 'toggle' || !CY_SND[c.label]) return;
        /* 同名标签可能有两个（「播放音效的震度」出现两次）→ 取离本控件最近的那条标签 */
        var baseCy = c.top + 18, lb = null, bd = 60;
        (D.labels || []).forEach(function (l) {
          if ((l.text || '') !== c.label) return;
          var d = Math.abs(l.cy - baseCy);
          if (d < bd) { bd = d; lb = l; }
        });
        c.kind = 'cycle';
        c.vals = CY_SND[c.label];
        c.states = c.vals.length;
        c.left = 10; c.w = 180; c.h = 40;
        c.top = Math.round((lb ? lb.cy : baseCy) + 17);
        c.cos = '(auto)';
      });
      /* ⑤ ★ 2026-10-21 用户：「这个括号的字体变成第二行了，改成一行」
         注释类标签（note，就是括号里那句「实验性」）中文比日文长，
         13px 时一条要 156px 宽，而可用宽度只有 140（右边是开关）→ 会折行。
         这里：① 把最长的两条注释按官方语气缩成短句
               ② 所有注释统一 12.5px（官方 note 是 13，中文略窄一点刚好一行）
         ⇒ 全部一行放下，字号也统一，不会再出现「实验/性」劈成两行。 */
      var NOTE_FIX = {
        '（晃动检测时高负载）实验性': '（检测时高负载）实验性',
        '（低精度・自负责任）实验性': '（低精度・自负）实验性'
      };
      /* ★ 2026-10-21 用户：
         ·「滑块的大小百分比不应该显示，官方是显示 -1，-2，+1，+2 那样子的」
         ·「FPS限制没有显示当前档位的FPS」
         ·「官方的在 UI 大小 字体的旁边，不会跟随滑块点的位置动」
         ⇒ 滑块改成 5 档，右侧数值改成【相对档位】±2 / ±1 / 0；
           帧率限制显示真实 FPS；数值元素固定贴在标签右端（不吃滑块位置）。 */
      var PLUS = ['-2', '-1', '0', '+1', '+2'];
      var KNOB_CFG = {
        'UI 大小': { n: 5, disp: PLUS },
        '图标大小': { n: 5, disp: PLUS },
        '切换时的缩放率': { n: 5, disp: PLUS },
        '计算频率限制': { n: 5, disp: PLUS },
        '频率限制': { n: 5, disp: PLUS },
        '帧率限制': { n: 5, disp: ['30fps', '45fps', '60fps', '90fps', '120fps'] }
      };
      D.ctrl.forEach(function (c) {
        if (c.kind !== 'knob') return;
        var g = KNOB_CFG[c.label];
        c.stops = g ? g.n : 5;
        if (g) c.disp = g.disp;
        var n = c.stops;
        c.def = Math.round((c.def == null ? 0.5 : c.def) * (n - 1)) / (n - 1);
      });
      /* 生成器把两个数值元素都挂在了「UI 大小」上（后面那个其实是 切换时的缩放率 的）
         → 按 cy 就近重新绑定到正确的滑块 */
      (D.values || []).forEach(function (v) {
        var c = D.ctrl[v.ctrl];
        if (!c || c.kind !== 'knob') return;
        if (Math.abs(c.top + c.h / 2 - v.cy) < 40) return;
        var best = null, bd = 1e9;
        D.ctrl.forEach(function (k, ki) {
          if (k.kind !== 'knob') return;
          var d2 = Math.abs(k.top + k.h / 2 - v.cy);
          if (d2 < bd) { bd = d2; best = ki; }
        });
        if (best != null && bd < 40) v.ctrl = best;
      });
      /* ★ 2026-10-21 用户：「这个（滑块）不应该是无极调节的，官方都不是无极的」
         ⇒ 每个滑块按官方量级的档位吸附（stops = 可选位置数，刻点数也用它）。 */
      var STOPS = {
        'UI 大小': 9,          /* 80 / 85 / 90 / 95 / 100 / 105 / 110 / 115 / 120 % */
        '图标大小': 9,          /* 60 … 140 %，步 10 */
        '切换时的缩放率': 7,      /* 50 / 75 / 100 / 125 / 150 / 175 / 200 % */
        '计算频率限制': 6,        /* 0.5 / 1.0 / 1.5 / 2.0 / 2.5 / 3.0 秒 */
        '频率限制': 6,
        '帧率限制': 5
      };
      D.labels.forEach(function (l) {
        if (!l || l.tier !== 'note') return;
        if (NOTE_FIX[l.text]) l.text = NOTE_FIX[l.text];
        l.size = Math.min(l.size || 13, 12.5);
        /* ★ 2026-10-21 用户：「为什么那个灰色的字不对齐？上面那个大字就是，
           为什么它会单独往左偏一些？」
           官方数据里 note 的 left 是 20、而对应的 row 是 18 → 中文灰字看着跟大字错位。
           ⇒ 直接取【上面最近的那个 row 标签】的 left，保证左缘完全对齐。
           ★ 再改：用户「灰字再往右一点点（+2px）」——括号是全角字形、墨迹居中，
             视觉左缘比汉字缩进一点，因此再 +2px 让墨迹看起来齐。 */
        var best = null, bd = 40;
        D.labels.forEach(function (r2) {
          if (!r2 || r2.tier !== 'row') return;
          var d2 = l.cy - r2.cy;
          if (d2 > 0 && d2 < bd) { bd = d2; best = r2; }
        });
        /* ★ 2026-10-21 实测（canvas 逐像素）：全角「（」的**墨迹**不在字框左缘 ——
           12.5px 时向右偏 8px，而汉字墨迹偏移 = 0。
           所以想让灰字的「（」和上面大字的第一个汉字**墨迹对齐**，
           文本框要放到 大字left - 8。 */
        if (best) l.left = best.left - 8;
      });
    }
    /* ★★ 2026-10-10：生成器已改用【960x720、size=100】的官方取证（build/gen-view3-canvas.js）
       → 面板 x 8..232（宽 224）、开关 60x36 @168、行底 paPut 220x36 @20、滑杆轨道 24..214
       全部就是官方值，**不再需要任何 x 投射补丁**（旧版的 6.4..244 是 654 舞台时代的估算）。*/
    var host = layer('view3', 6);    host.innerHTML = '';
    var inner = el('div', 'position:absolute;left:0;top:0;width:960px;height:720px');
    inner.id = 'view3in';
    host.appendChild(inner);
    L3 = { D: D, host: host, inner: inner, els: [], boxes: [], min: 0, bottom: 0 };

    /* 官方图形（面板底板 / 开关 / 数值框 / 行底板） */
    D.art.forEach(function (a) {
      var im = new Image();
      im.src = 'assets/ui3c/' + a[0] + '.svg';
      im.draggable = false;
      im.dataset.cos = a[0];
      im.style.cssText = 'position:absolute;left:' + a[1] + 'px;top:' + a[2] + 'px;width:' + a[3] + 'px;height:' + a[4] + 'px';
      /* ★ 2026-10-21：「其他」卡片内容缩短后底板不必这么高 → 按内容裁，
         否则底部会留一大块空底板（用户：「为什么版本上面要空这么多」）。
         ★★★ 2026-10-25 用户（截图）：「把这一块少的背景板加上」——
           之前写死 224，底板只到 3480，而「切换星球」按钮 3478..3514
           **直接露在背景板外面**。⇒ 改成按「其他」里最后一个控件的底边 + 12px 内边距自适应。 */
      var aH = a[4];
      if (a[0] === 'paPb5_1') {
        var ctrlBot = a[2];
        (D.ctrl || []).forEach(function (c) {
          var b = (+c.top || 0) + (+c.h || 0);
          if (b > ctrlBot) ctrlBot = b;
        });
        aH = Math.max(224, Math.min(a[4], ctrlBot - a[2] + 12));
        /* ★★★ 2026-10-29 用户（截图）：「其他卡片的黑色背景露出来了」
           —— 真因：`object-fit:fill` 只把 **视口** 拉高，SVG 里
              `preserveAspectRatio="xMidYMid meet"` 仍然按原比例把 224×282 的造型
              **居中**排进 224×378 的框（上下各空 48px）。
              于是底板实际只画到 top+330，而「场地数据精度」按钮到 top+350
              → 最后两颗按钮下面 20px 没有底板 = 露出页面黑底（旧版用 clip-path 裁，
                只治了「多出来的透明边」，没治「内容本来就居中」）。
           ⇒ 把 <img> 固定成造型的原生高度 282，再用 scaleY 纵向拉伸到 aH。
              transform 不受 preserveAspectRatio 约束，底板一定铺满；
              底部圆角被压扁一点（10px → 12.8px），肉眼无感。 */
        var NAT_H = 282;                      /* paPb5_1.svg 的 width/height = 224×282 */
        im.style.height = NAT_H + 'px';
        im.style.objectFit = 'none';
        im.style.transformOrigin = '0 0';
        im.style.transform = 'scaleY(' + (aH / NAT_H) + ')';
        im.style.clipPath = 'none';
      }
      inner.appendChild(im);
      L3.els.push(im);
      L3.bottom = Math.max(L3.bottom, a[2] + aH);
    });
    /* ★ 2026-10-21：「其他」卡片顶栏 —— 官方素材里没有单独的「头条」造型，
       这里直接**裁官方卡片 paPb5_0 的顶部 31px**（clip-path），
       颜色 / 圆角 / 内阴影都是官方原样，不是自绘色块。 */
    if (D._othBar) {
      var ob = D._othBar;
      var hb = document.createElement('img');
      hb.src = 'assets/ui3c/paPb5_0.svg';
      hb.draggable = false;
      hb.style.cssText = 'position:absolute;left:' + ob.x + 'px;top:' + ob.y + 'px;width:' + ob.w +
        'px;height:207px;clip-path:inset(0 0 176px 0);pointer-events:none';
      inner.appendChild(hb);
    }

    /* 控件 */
    D.ctrl.forEach(function (c, i) {
      var e = null;
      if (c.i >= 0 && L3.els[c.i]) e = L3.els[c.i];
      else if (c.kind === 'knob') {
        /* ★★ 官方滑杆（960 实测逐像素采样）：
             轨道 2px，x 24..214；**已填充段 #458eb2**，未到段 #31476d；
             把手 = 16x16 白色圆，圆心 = 轨道 y 行 +45，x = 24+8 + t*(190-16)
           官方 paPsb（蓝填充）/ paPss（白把手）烤死了长度，所以这里按官方配色自绘。 */
        var tw = c.tr1 - c.tr0, ty = c.top + 44, hy = c.top + 45;
        var base = el('div', 'position:absolute;left:' + c.tr0 + 'px;top:' + ty + 'px;width:' + tw +
          'px;height:2px;background:#31476d');
        var fill = el('div', 'position:absolute;left:' + c.tr0 + 'px;top:' + ty + 'px;width:2px;height:2px;background:#458eb2');
        /* ★ 2026-10-21 用户：「滑块我们的和官方不一样」（官方截图：蓝圈白心把手 + 轨道上有小刻点）
           ⇒ 把手 = 16px 蓝圆 #458eb2 + 中间 7px 白点；轨道 = 2px 暗蓝 + 6 个小刻点。 */
        var dot = el('div', 'position:absolute;left:0;top:' + (hy - 8) + 'px;width:16px;height:16px;' +
          'border-radius:50%;background:#458eb2');
        dot.appendChild(el('div', 'position:absolute;left:4.5px;top:4.5px;width:7px;height:7px;' +
          'border-radius:50%;background:#ffffff'));
        var wrap = el('div', 'position:absolute;left:0;top:0;width:0;height:0');
        /* 刻点数 = 档位数（官方滑块是分档的，刻点就是档位） */
        var nstop = c.stops || 7;
        for (var ti = 0; ti < nstop; ti++) {
          var tx = c.tr0 + Math.round(ti * tw / (nstop - 1));
          wrap.appendChild(el('div', 'position:absolute;left:' + (tx - 1.5) + 'px;top:' + (ty - 1) +
            'px;width:3px;height:3px;border-radius:50%;background:#5f7fa5'));
        }
        wrap.appendChild(base); wrap.appendChild(fill); wrap.appendChild(dot);
        e = dot; e.dataset.dot = '1';
        e._track = c; e._fill = fill;
        e._wrap = wrap;              /* ★ reflow3 重排行距时要整组平移 */
        inner.appendChild(wrap);
      } else {
        /* 多档 = 官方 paPcb 下拉框；开关 = 官方 paPt0/paPt3；
           动作按钮 = 官方 paPkb1（192x36 真按钮底图，旧版误用 paPcb → 看着像被压扁的胶囊） */
        var file = (c.kind === 'cycle') ? 'paPcb' : (c.kind === 'button') ? 'paPkb1' : 'paPt0';
        e = new Image(); e.src = 'assets/ui3c/' + file + '.svg'; e.draggable = false;
        e.style.cssText = 'position:absolute;left:' + c.left + 'px;top:' + c.top + 'px;width:' + c.w + 'px;height:' + c.h + 'px';
        inner.appendChild(e);
        if (c.kind === 'cycle') {
          /* ⚠️ 占位符必须非空：`QVT.zh()` 对空字符串直接返回 null →
             以前这里 `txt(inner,'',…)` 拿到 null，sync3 再也填不进去，
             于是 4 个下拉框（显示样式 / 地图上显示的信息 / 地图填充 / 检测显示类型）
             **一个字都不显示**（审计实测 `_val文本="(无 _val 元素)"`）。 */
          /* ★ 2026-10-21 用户：「下拉框本体的字体左溢出了」
             paPcb 的 180×40 画布里，圆角框本体只画在 **x 17..163**（左右各留 17 空白），
             所以框的可见左缘 = left+17。以前文字放在 left+10 → 压在/越出左边框。
             现在 left+25 = 框内 8px。 */
          e._val = txt(inner, '—', c.left + 25, c.top + c.h / 2, 17, '#dce3ff', 400);
        } else if (c.kind === 'button') {
          var short = /导出/.test(c.label) ? '打开导出・导入'
            : /保存/.test(c.label) ? '立即保存'
              : /重置/.test(c.label) ? '恢复默认设置'
                : /关于/.test(c.label) ? '关于・素材授权'
                  : /地震模拟|模拟设置/.test(c.label) ? '地震模拟'
                    : /切换星球/.test(c.label) ? '切换星球'
                      : /事件录制/.test(c.label) ? '事件录制・回放'
                        : /场地数据/.test(c.label) ? '场地数据精度'
                          : '打开配色・音效自定义';
          e._val = txt(inner, short, c.left + c.w / 2, c.top + c.h / 2, 17, '#dce3ff', 400, 'center');
        }
      }
      e.dataset.vc = i;
      c.el = e;
      /* ★★ 值元素要同时挂到 ctrl 对象上：sync3() 读的是 `c._val`，
         而这里以前只写了 `e._val`（Image 上）→ **4 个下拉框永远停在占位符、
         一个字都不显示**（显示样式 / 地图上显示的信息 / 地图填充 / 检测显示类型）。
         按钮不受影响是因为它的文字在 build 时就算好了，不需要 sync3 刷新。 */
      if (e._val) c._val = e._val;
      L3.boxes.push(c);
      L3.bottom = Math.max(L3.bottom, c.top + c.h);
    });

    /* 设定值显示（官方 paPsn 位置） */
    (D.values || []).forEach(function (v) {
      var c = D.ctrl[v.ctrl]; if (!c) return;
      c.valEl = txt(inner, valueText(c), v.left, v.cy, v.size, '#dce3ff', 400, v.align || 'right');
      /* ★ 同一个控件可能挂多个数值元素（如 UI 大小的 80% / 100%）→ 全部记下来，
         reflow3 重排行距时一起平移，否则会漏掉几个、叠在一起。 */
      if (c.valEl) { (c.valEls || (c.valEls = [])).push(c.valEl); }
    });
    /* ★ 2026-10-21 用户：「FPS限制没有显示当前档位的FPS」
       生成器只给了 2 个滑块的数值元素 → 给所有滑块补一个（位置在 fitLabels 里
       统一贴到标签右端）。 */
    D.ctrl.forEach(function (c) {
      if (c.kind !== 'knob' || (c.valEls && c.valEls.length)) return;
      var ve = txt(inner, valueText(c), 0, c.top + 18, 17, '#dce3ff', 400, 'left');
      if (ve) { c.valEl = ve; (c.valEls || (c.valEls = [])).push(ve); }
    });

    /* 中文标签（三档字号：head 22 / row 18 / note 15.5）
       ★ 中文比日文宽：记下元素，等版面【真的显示出来】再量宽缩排
         （display:none 时 offsetWidth = 0，量不到 → 曾经完全失效） */
    L3.labelEls = [];
    D.labels.forEach(function (l) {
      if (l._skip) { l.el = null; return; }        /* 被删掉的行（只留按钮） */
      /* ★ 官方配色（960 逐像素采样）：行/标题文字 = 纯白 #ffffff；副标注 = #aaafb7 */
      var col = l.tier === 'note' ? '#aaafb7' : '#ffffff';
      /* ★ 2026-10-21 用户：「大分类标题字体不居中」
         官方那份 left 是**日文墨迹左缘**，直接搬来给中文（字宽不同）就偏左。
         ⇒ 「大分类」（paPb 面板顶栏上的那几行）按面板中心 120 居中；
           小分类标题（常规 / 紧急地震速报 / 实时烈度 …）与行标签保持官方左缘。 */
      var BIGHEAD = { '动作相关设置': 1, 'UI 相关设置': 1, '地图显示相关设置': 1,
        '声音・朗读相关': 1, '高级设置': 1, '其他': 1 };
      var lx2 = l.left, al2 = 'left';
      if (l.tier === 'head' && BIGHEAD[l.text]) { lx2 = 120; al2 = 'center'; }
      var d = txt(inner, l.text, lx2, l.cy, l.size, col, l.tier === 'head' ? 600 : 400, al2);
      l.el = d;
      if (d) L3.labelEls.push({ el: d, l: l });
    });

    /* ★ 「其他」分组补两行真数据（版本 / 数据源健康度）—— 原来标题下面是空的
       （用户报过的观感问题：一个分组只有标题，底下什么都没有） */
    L3.info = [];
    var PB = D._panelBottom || (L3.bottom + 60);
    var oCy = D._infoCy || [PB - 122, PB - 90];
    [{ t: '版本', cy: oCy[0], get: infoVersion }, { t: '数据源', cy: oCy[1], get: infoFeeds }]
      .forEach(function (r2) {
        txt(inner, r2.t, 22, r2.cy, 15.5, '#ffffff', 400);
        var vEl = txt(inner, r2.get(), 216, r2.cy, 15, '#dce3ff', 400, 'right');
        L3.info.push({ el: vEl, get: r2.get });
      });

    L3.min = Math.min(0, SH - L3.bottom - 12);
    V.ctrl = D.ctrl;
    /* ★ 陈旧存档清理：以前接错线的开关，用户点过 → 值留在 V.values 里。
       行为已经摘掉，但开关还会**画成开着的**（看着生效其实没有）。
       把「未接线开关」的存档删掉，让它回到官方默认态。
       踩过：`震度等级换算` 存了 1 → 烈度卡被贴上「最大震度」。 */
    var purged = 0;
    for (var ci = 0; ci < V.ctrl.length; ci++) {
      if (V.ctrl[ci].kind !== 'toggle') continue;
      if (!unwiredReason(V.ctrl[ci])) continue;
      if (V.values[ci] != null) { delete V.values[ci]; purged++; }
    }
    if (purged) save();
    fitted = false;
    sync3();
    host.dataset.built = '1';
  }

  /** 控件当前值（0/1 开关；0..n-1 多档；0..1 滑杆） */
  function valOf(i) {
    var c = V.ctrl[i]; if (!c) return 0;
    var v = V.values[i];
    if (v == null) v = (c.def != null ? c.def : 0);
    return v;
  }
  function setVal(i, v) { V.values[i] = v; save(); }

  function valueText(c) {
    var o = WIRE[c.label || ''];
    if (c.kind === 'knob') {
      /* ★ 官方显示的是【档位】而不是百分比（-2 / -1 / 0 / +1 / +2），
         帧率限制则显示真实 FPS。 */
      var n = c.stops || 5;
      var idx = Math.round(knobT(c) * (n - 1));
      if (c.disp) return c.disp[idx] || '';
      var t0 = knobT(c);
      if (o === 'uiScale') return Math.round(80 + t0 * 40) + '%';
      if (o === 'pinSize') return Math.round(60 + t0 * 80) + '%';
      if (o === 'zoomRate') return Math.round(50 + t0 * 150) + '%';
      if (o === 'freq') return (Math.round((0.5 + t0 * 2.5) * 10) / 10) + ' 秒/次';
      return Math.round(t0 * 100) + '%';
    }
    if (c.kind === 'cycle') {
      var vals = (c.vals && c.vals.length) ? c.vals : (CYCVALS_DEFAULT[c.group] || []);
      var i = Math.round(valOf(V.ctrl.indexOf(c)));
      return vals.length ? (vals[i % vals.length] || '') : '';
    }
    var b = valOf(V.ctrl.indexOf(c));
    return b ? '开' : '关';
  }
  function knobT(c) {
    var i = V.ctrl.indexOf(c);
    var v = valOf(i);
    return Math.max(0, Math.min(1, v));
  }

  /** 标签缩排：中文比日文宽，长标签会压到右侧开关上 → 自动缩字号（到 12.5 再省略号）
   *  ⚠️ 必须在 #view3 显示出来之后调（display:none 时量不到宽） */
  var fitted = false;

  /* ═════ 2026-10-21 用户：「每一个选项它和下一个选项那个空格间隙不固定，看起来有点乱」
     → 选：「每个选项固定一格（36），滑块/带注释的也占固定格」
     官方那套行位是逐条量出来的（32 / 35 / 50 / 55 / 63 / 88 都有），中文换成更长的
     译文 + 我们自己的控件后更乱。这里按【每个 paPb 面板】把行重排成等距格子：
       · 普通行 = 1 格；带下拉框(40 高) = 1.35 格；带滑块 = 1.7 格；带灰色注释 +0.45 格
       · 面板底图是定高素材，格子总高按面板高度算 → 一定放得下
       · 大分类标题固定在面板顶栏，不参与重排 */
  function reflow3() {
    if (!L3 || !L3.host.offsetWidth || L3._reflowed) return;
    var D = L3.D;
    var BIG = { '动作相关设置': 1, 'UI 相关设置': 1, '地图显示相关设置': 1, '声音・朗读相关': 1, '高级设置': 1, '其他': 1 };
    var pads = (D.art || []).filter(function (a) { return /^paPb/.test(a[0]); })
      .map(function (a) { return { t: a[2], h: a[4] }; }).sort(function (a, b) { return a.t - b.t; });
    if (!pads.length) return;
    function ctrlOf(lab) {
      for (var i = 0; i < D.ctrl.length; i++) if (D.ctrl[i].label === lab) return D.ctrl[i];
      return null;
    }
    pads.forEach(function (p) {
      var rows = D.labels.filter(function (l) {
        if (BIG[l.text]) return false;
        if (l.cy < p.t + 40 || l.cy > p.t + p.h - 6) return false;
        return l.tier === 'row' || l.tier === 'head';
      }).sort(function (a, b) { return a.cy - b.cy; });
      if (!rows.length) return;
      /* ① 先把「同一个选项的两行」（官方把长标签拆成两行，如 横屏画面布局/强制使用、
            海啸发布中的海啸/信息页设为默认）合成一格：否则它们会被当成两个选项拉开 */
      var merged = [];
      rows.forEach(function (l) {
        var prev = merged[merged.length - 1];
        if (prev && !prev._c && !ctrlOf(l.text) && (l.cy - prev.cy) < 25) { prev._sub = l; return; }
        merged.push(l);
      });
      var rows2 = merged;
      /* ② 算每个行占几格 */
      rows2.forEach(function (l) {
        var c = ctrlOf(l.text), u = 1;
        /* ★ 2026-10-21 用户：「滑块的格子也别加高，全部一样高」
           ⇒ 滑块行也只占 1 格，轨道收到标签下方（cy+14），不再撑高行距。
           下拉框本体 40 高、塞不进一格，所以只有它保留 1.35 格。 */
        if (c && c.kind === 'cycle') u = 1.35;
        else if (l._sub) u = 1.45;                  /* 两行写法的选项（横屏画面布局 等） */
        /* ★ 灰字注释不额外占格：固定塞在行内下方 16px */
        l._note = null;
        D.labels.forEach(function (n) {
          if (n.tier !== 'note' || n._done) return;
          if (n.cy > l.cy && n.cy - l.cy < 32) { l._note = n; n._done = 1; }
        });
        l._c = c; l._u = u;
      });
      var units = rows2.reduce(function (s, l) { return s + l._u; }, 0) || 1;
      var padTop = 44, padBot = 12;
      var pitch = (p.h - padTop - padBot) / units;
      var y = p.t + padTop;
      rows2.forEach(function (l) {
        var cy = Math.round(y + 18);
        l.cy = cy;
        if (l.el) l.el.style.top = (cy - (l.size || 15.5) / 2) + 'px';
        if (l._sub) {                          /* 同一选项的第二行：紧贴第一行 */
          l._sub.cy = cy + 18;
          if (l._sub.el) l._sub.el.style.top = (cy + 18 - (l._sub.size || 15.5) / 2) + 'px';
        }
        if (l._note) {
          var ncy = cy + (l._sub ? 34 : 16);
          l._note.cy = ncy;
          if (l._note.el) l._note.el.style.top = (ncy - (l._note.size || 12.5) / 2) + 'px';
        }
        var c = l._c;
        if (c) {
          var oldTop = c.top, newTop;
          if (c.kind === 'knob') newTop = cy - 30;      /* 轨道落到 cy+14（标签下方） */
          else if (c.kind === 'cycle') newTop = cy + 16;
          else newTop = cy - 18;
          var dTop = newTop - oldTop;
          c.top = newTop;
          if (c.kind === 'knob') {
            if (c.el && c.el._wrap) c.el._wrap.style.transform = 'translateY(' + dTop + 'px)';
          } else {
            if (c.el) c.el.style.top = newTop + 'px';
            if (c._val) c._val.style.top = (newTop + c.h / 2 - 8.5) + 'px';
          }
          /* 行右侧的「设定值」（如 UI 大小的 80% / 100%）按同样的位移跟着走 */
          (D.values || []).forEach(function (v) {
            if (D.ctrl[v.ctrl] !== c) return;
            v.cy += dTop;
          });
          (c.valEls || []).forEach(function (ve) {
            ve.style.top = ((parseFloat(ve.style.top) || 0) + dTop) + 'px';
          });
        }
        y += l._u * pitch;
      });
    });
    L3._reflowed = 1;
    hitKey = '';                      /* 命中块按新位置重建 */
  }

  function realign3() {
    if (!L3 || !L3.host.offsetWidth) return;
    var ins = L3.inner.querySelectorAll('div[data-ax]');
    for (var i = 0; i < ins.length; i++) {
      var d = ins[i], x = +d.dataset.ax, al = d.dataset.al, w = d.offsetWidth || 0;
      if (al === 'right') d.style.left = Math.round(x - w) + 'px';
      else if (al === 'center') d.style.left = Math.round(x - w / 2) + 'px';
      else d.style.left = Math.round(x) + 'px';
    }
  }
  function fitLabels() {
    if (!L3) return;
    if (!L3.host.offsetWidth) return;          /* 还是 hidden → 下次再说 */
    /* ⚠️ 2026-10-21：reflow3()（等距格子重排）试过后**关掉**：
       官方面板是定高素材，行位一改就跟底图/下拉框/滑轨打架（实测 显示样式 的
       下拉框压住下一行、图标大小 滑轨压住 显示海底地形）。
       要用等距版式必须连面板底图一起换成自制面板，那是另一个量级的改动。 */
    realign3();
    /* ★ 2026-10-21 用户：「官方的在 UI 大小 字体的旁边，不会跟随滑块点的位置动」
       ⇒ 滑块右侧的档位文字固定贴在【标签右端 + 10】，与把手位置无关。 */
    (L3.boxes || []).forEach(function (c) {
      if (c.kind !== 'knob' || !c.valEls || !c.valEls.length) return;
      var lb = null, bd = 1e9;
      (L3.D.labels || []).forEach(function (l) {
        if (!l.el) return;
        var t = l.text || '';
        if (!t) return;
        /* 模糊匹配：控件标签可能是「计算频率限制」而行标签是「频率限制」 */
        if (t.indexOf(c.label) < 0 && c.label.indexOf(t) < 0) return;
        var d2 = Math.abs(l.cy - (c.top + 18));
        if (d2 < bd) { bd = d2; lb = l; }
      });
      if (!lb) return;
      var x2 = (parseFloat(lb.el.style.left) || 0) + lb.el.offsetWidth + 10;
      c.valEls.forEach(function (ve) {
        ve.dataset.ax = x2; ve.dataset.al = 'left';
        ve.style.left = Math.round(x2) + 'px';
        /* ★ 2026-10-21 用户：「这个滑块显示的字体偏移了，和行的字体不一样」
           数值原来是 17px / #dce3ff，行标签是 15.5px / #fff → 字号、颜色、基线都不同。
           现在统一成行标签的 15.5px / #fff，垂直中心对齐到标签中心。 */
        ve.style.fontSize = '15.5px';
        ve.style.color = '#ffffff';
        ve.style.top = Math.round(lb.cy - 7.75) + 'px';
      });
    });
    if (fitted || !L3.labelEls) return;        /* 缩排只做一次（重复量会越缩越小） */
    L3.labelEls.forEach(function (it) {
      var d = it.el, l = it.l;
      var maxW = 248 - l.left;
      L3.boxes.forEach(function (cc) {
        if (cc.left < 120) return;
        if (Math.abs((cc.top + cc.h / 2) - l.cy) > 26) return;
        maxW = Math.min(maxW, cc.left - l.left - 8);
      });
      maxW = Math.max(60, maxW);
      if (d.offsetWidth <= maxW) return;
      var fs = parseFloat(d.style.fontSize) || l.size;
      /* 注释类字号下限放到 11：中文比日文宽，「（晃动检测时高负载）实验性」在 11 号能一行放下，
         12 号就得折成两行、末尾只剩一个孤字（很难看）。真放不下才折行。 */
      /* 行标签下限也放到 13：面板宽度按官方收窄后（244 右缘），
         「晃动检测区分・震中检测」这类 11 字标签在 14 号会溢出被截成省略号。 */
      /* ★ 2026-10-21 用户：「这个括号的字体变成第二行了，改成一行」
         ⇒ 注释类（note）**永远不折行**：字号一路缩到 9.5px 也要挤进一行；
           实在挤不进才截省略号（不再换行，换行会把括号里的「实验性」劈成两行）。 */
      var floor = (l.tier === 'note') ? 9.5 : 13;
      while (fs > floor && d.offsetWidth > maxW) { fs -= 0.5; d.style.fontSize = fs + 'px'; }
      if (d.offsetWidth > maxW) {
        d.style.maxWidth = maxW + 'px';
        d.style.overflow = 'hidden';
        d.style.textOverflow = 'ellipsis';
        d.style.whiteSpace = 'nowrap';
        d.style.lineHeight = '1';
      }
    });
    fitted = true;
  }

  /** 把控件值写进 DOM（图形 + 数值文字 + 圆点位置） */
  function sync3() {
    if (!L3) return;
    L3.boxes.forEach(function (c, i) {
      if (c.kind === 'toggle') {
        if (c.el && c.el.tagName === 'IMG') c.el.src = 'assets/ui3c/' + (valOf(i) ? 'paPt3' : 'paPt0') + '.svg';
      } else if (c.kind === 'cycle') {
        var vals = (c.vals && c.vals.length) ? c.vals : (CYCVALS_DEFAULT[c.group] || []);
        var n = Math.max(1, vals.length || c.states || 1);
        var k2 = ((Math.round(valOf(i)) % n) + n) % n;
        if (c._val) c._val.textContent = vals[k2] || String(k2 + 1);
      } else if (c.kind === 'knob') {
        /* 把手圆心：轨道两端各内缩 8（把手半径），保证把手不越出轨道 */
        var t = Math.max(0, Math.min(1, valOf(i)));
        var tw = c.tr1 - c.tr0;
        var hx = c.tr0 + 8 + t * (tw - 16);
        if (c.el) c.el.style.left = Math.round(hx - 8) + 'px';
        if (c.el && c.el._fill) c.el._fill.style.width = Math.round(hx - c.tr0) + 'px';
      }
      if (c.valEl) c.valEl.textContent = valueText(c);
    });
    /* 非滑杆控件的「设定值显示」也要刷新 */
    (L3.D.values || []).forEach(function (v) {
      var c = L3.D.ctrl[v.ctrl]; if (c && c.valEl) c.valEl.textContent = valueText(c);
    });
    /* ★ 「其他」分组的两行状态（版本 / 数据源健康度）随每次重绘刷新 */
    if (L3.info) L3.info.forEach(function (r2) { if (r2.el) r2.el.textContent = r2.get(); });
    if (L3.host && L3.host.offsetWidth) realign3();
  }

  function scroll3(dy) {
    /* ★★ 视图 2 = 海啸预报区域列表：也是【整列滚动】（整个 UI 一起往下走）
       官方证据：Stage 变量 `UIスクロール` 是 **Stage 级共享变量**（情報页/津波页共用，
       见 diag/allvars 与 build/probe-tsu4.js），而且官方那份真实数据的列表一直排到
       y≈1122（远超 720 屏高，compare/dump-OFFTSUPTABLE.json）→ 不可能只滚列表内部。
       以前我们只平移 listInner（且被 listWrap 裁到屏幕下缘）→ 用户报「滚动同等错误」。 */
    if (V.view === 2) {
      if (!LTSU) return;
      var n2 = Math.max(LTSU.min, Math.min(0, V.scroll - dy));
      if (n2 === V.scroll) return;
      V.scroll = n2;
      LTSU.inner.style.transform = n2 ? 'translateY(' + n2 + 'px)' : '';
      hitKey = ''; syncHits();
      return;
    }
    var lay = (V.view === 1) ? L1 : (V.view === 3 ? L3 : null);
    if (!lay) return;
    /* ★ 每次滚动都用【当前窗口可见高】重算下限（窗口比舞台矮时靠这个才能滚到底） */
    if (lay.bottom) lay.min = Math.min(0, visH() - lay.bottom - 12);
    var nv = Math.max(lay.min, Math.min(0, V.scroll - dy));
    if (nv === V.scroll) return;
    V.scroll = nv;
    lay.inner.style.transform = 'translateY(' + nv + 'px)';
    hitKey = ''; syncHits();
  }

  /* ---------------- 视图 2（海啸）：100% 官方「津波予報」版面 ----------------
   * ★★ 2026-10-10 第十三轮：**彻底不再手写面板**。
   *   几何/素材全部来自官方运行时实测（960x720）：产出 build/gen-view2.js → js/view2art.js
   *   官方机制（已逐项解明）：
   *     · 顶板 paNbg1 224x140@(8,8) / 震源块 paNsb1 224x156@(8,46)
   *       / 震级标签 paNst0 / 色阶条 paNsmag（**纯红素材**，按官方震级渐变上色）
   *     · 警报表 paNp<等级> 224x68 —— 位置见 draw2 里的 headY：
   *       无深度时 146（单行震源块 paNsb1 面板底 151）、有深度时 189（双行块 paNsb0 面板底 189）
   *     · 列表 = paNl<等级> 块 224x68，**每块含 2 行文字**，块距 64；末尾 paNle 收尾
   *              地名 = 官方 nt<JMA区域码> 造型，行距 32，首行 214.21，左缘 46
   *     · 图例 = hnt<等级> 270x260@(769,446)
   *   ⚠️ 层变量不能叫 L2：本文件下面 `for (var L2 in WIRE)` 会把它覆盖成字符串。
   */
  var LTSU = null;
  /* 等级 → 官方造型变体（海岸線の色 / 警报表）
     ⚠️ `TSU_ROWV`（每级一个平色块）已废弃 —— 官方根本不是那么叠的，
        块名是 `paNl` + 等级 + 变体后缀（哨/中/末），见 draw2 里的说明。 */
  var TSU_HNTV = { 0: 'hnt1', 1: 'hnt1', 2: 'hnt2', 3: 'hnt3', 4: 'hnt4' };
  var TSU_PV = { 0: 'paNp1', 1: 'paNp1', 2: 'paNp2', 3: 'paNp3', 4: 'paNp4' };

  function tsuImg(src, x, y, w, h, cos) {
    var im = new Image();
    im.src = src; im.draggable = false;
    if (cos) im.dataset.cos = cos;
    im.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px';
    return im;
  }
  function tsuSwap(el2, cos) {
    if (!el2 || el2.dataset.cos === cos) return;
    el2.dataset.cos = cos;
    el2.src = 'assets/ui2c/' + cos + '.svg';
  }

  function tsuPanel() {
    if (LTSU) return LTSU;
    var D = global.QV_VIEW2;
    var host = layer('view2', 6);
    host.innerHTML = '';
    var inner = el('div', 'position:absolute;left:0;top:0;width:960px;height:720px');
    inner.id = 'view2in';
    host.appendChild(inner);
    LTSU = { D: D, host: host, inner: inner, scroll: 0, min: 0, contentH: 0,
      artEls: {}, txtRoot: null, listWrap: null, listInner: null, alertEl: null, legendEl: null };
    host.dataset.built = '1';
    if (!D) return LTSU;
    /* ① 官方静态造型（顶板/震源块/标签/色阶条）—— 保持官方图层顺序 */
    D.art.forEach(function (a) {
      if (/^hnt/.test(a[0]) || /^paNp\d/.test(a[0])) return;   /* 图例/警报表随等级动态换 */
      var im = tsuImg('assets/ui2c/' + a[0] + '.svg', a[1], a[2], a[3], a[4], a[0]);
      inner.appendChild(im);
      LTSU.artEls[a[0]] = im;
    });
    /* ③b 深度色条（官方 paNsdep：与 paNsb1 同画布 224x156，色条在画布 y=104
           → 舞台 y=150；幅度条 paNsmag 在画布 y=66 → 舞台 y=112）
       ★★ 2026-10-22 用户报「多等级海啸 UI 错乱」：
          · 组头素材 paNp* 的前 20px 是空底板 → 组头必须坐在深度行下方（见 view2art.js）
          · 深度色条要画在组头**下层**：官方就是让组头把色条下端截断，看上去与组头顶边齐平；
            以前 depEl 在 alertEl 之后 append → 色条（150..179）会盖在组头素材上，
            露出一截黄/蓝色块，看着就是「错乱」。 */
    LTSU.depEl = tsuImg('assets/ui2c/paNsdep.svg', 8, 46, 224, 156, 'paNsdep');
    inner.appendChild(LTSU.depEl);
    /* ② 警报表（官方坐标取自已生成的 art，找不到就用实测值）*/
    var pBox = D.art.filter(function (a) { return /^paNp\d/.test(a[0]); })[0] || ['paNp1', 8, 146, 224, 68];
    LTSU.pBox = { x: pBox[1], y: pBox[2], w: pBox[3], h: pBox[4] };
    LTSU.alertEl = tsuImg('assets/ui2c/paNp1.svg', pBox[1], pBox[2], pBox[3], pBox[4], 'paNp1');
    inner.appendChild(LTSU.alertEl);
    /* ③ 图例（官方 hnt<等级>）
       ★ 2026-10-24：图例**不能放进 inner** —— inner 会跟整列滚动一起 translateY。
         图片直接挂 #view2，文字挂单独一层 lgRoot（都在静态层）。 */
    var lg = D.legend || { x: 769, y: 446, w: 270, h: 260 };
    LTSU.lgBox = lg;
    LTSU.legendEl = tsuImg('assets/ui2c/hnt1.svg', lg.x, lg.y, lg.w, lg.h, 'hnt1');
    host.appendChild(LTSU.legendEl);
    LTSU.lgRoot = el('div', 'position:absolute;left:0;top:0;width:960px;height:720px');
    host.appendChild(LTSU.lgRoot);
    /* ④ 标题/震级 文字层（官方字形位）*/
    LTSU.txtRoot = el('div', 'position:absolute;left:0;top:0;width:960px;height:720px');
    inner.appendChild(LTSU.txtRoot);
    /* ⑤ 列表（**不裁剪**：现在是整列滚动，由外层 inner 一起平移，见 scroll3）
       ⚠️ 以前这里写了 height:720-L.top + overflow:hidden → 整列滚下去时
          列表会被自己的裁剪框切掉（官方没有这层裁剪）。 */
    var L = D.list;
    LTSU.listWrap = el('div', 'position:absolute;left:' + L.x + 'px;top:' + L.top + 'px;width:' + L.w + 'px');
    inner.appendChild(LTSU.listWrap);
    LTSU.listInner = el('div', 'position:absolute;left:0;top:0;width:100%');
    LTSU.listWrap.appendChild(LTSU.listInner);
    return LTSU;
  }
  function tsuLabel(lv, Z) {
    return lv >= 4 ? (Z.tsuMajor || '大海啸警报')
      : lv === 3 ? (Z.tsuWarning || '海啸警报')
        : lv === 2 ? (Z.tsuAdvisory || '海啸注意报')
          : lv === 1 ? (Z.tsuForecast || '海啸预报')
            : (Z.tsuNoInfo || '暂无海啸信息');
  }

  /** 视图 2 内容：官方版面上的「数据部分」
   *  · 静态造型（面板/标签/色阶条）建面板时就摆好了，这里**不重建**
   *  · 每帧只重建：警报表变体 / 图例变体 / 列表块与地名 / 标题区文字 */
  function draw2() {
    var Z = global.QV_ZH || {};
    var P = tsuPanel(), D = P.D;
    if (!D) return;
    var L = D.list, TX = global.QVT;

    var tsu = (global.QData && global.QData.tsunami) ? global.QData.tsunami() : null;
    var items = (tsu && tsu.items) ? tsu.items : [];
    var lv = items.length ? (tsu.maxLv | 0) : 0;

    /* ★ 先清空文字层（下面 ①b 图例文字 / ② 标题区都会往里写；
       曾经把清空写在 ①b 之后 → 图例文字刚写就被擦掉） */
    P.txtRoot.innerHTML = '';
    if (P.lgRoot) P.lgRoot.innerHTML = '';   /* 图例文字层单独重建（不跟列表滚动） */

    /* ① 警报表：**按【等级 + 预计高度】选官方造型**
       （用户给的官方真实截图里就是「3m 津波警報」/「1m 津波注意報」）
         paNp1 若干の海面変動 / paNp2 津波注意報 / paNp3 津波警報 / paNp3t 高い 津波警報 /
         paNp4 大津波警報 / paNp4t 巨大 大津波警報 / paNp5 1m 津波注意報 / paNp6 3m 津波警報 /
         paNp7 5m 大津波警報 / paNp8 10m 大津波警報 / paNp9 10m< 大津波警報
       ⇒ 这张就是【列表第一个组的组头】（版面 y=174，正好压在列表 y=238 上面；
          原 146/210 会让组头里的 3m 徽章压住深度行，2026-10-22 已整体 +28）*/
    tsuSwap(P.alertEl, panelOf(lv, (tsu && tsu.height) || ''));
    tsuSwap(P.legendEl, TSU_HNTV[lv] || 'hnt1');
    /* 顶板色条跟等级走（官方 paNbg0..4；用户截图最上面那根红条「津波警報」就是它，
       以前我们写死 paNbg1 → 永远是蓝色「津波予報」）*/
    tsuSwap(P.artEls.paNbg1, 'paNbg' + Math.max(0, Math.min(4, lv)));
    /* ★★ 2026-10-11 用户报「UI 又错乱了 / 也不显示地区」：
       没有海啸时（tsunami = null）列表本来就该只有一行提示，
       但那套震源面板 / 色条 / 警报表 / 图例还在，而且 **上一次渲染染过色的
       幅度条、深度条还留在画面上**（src 是 data URI，静态层不会自己变回去）
       → 看着就是「空面板 + 两条莫名其妙的色块」。
       空态就把这一整套收起来，只留顶板 + 一条「暂无海啸信息」。 */
    var empty = !items.length;
    /* ★★★ 2026-10-26 用户：「为什么解除后会有这个」（截图只剩一行「深度 15km」+ 已解除文案）
       —— 根因：`item` 空了之后 `empty = true`，震级那行带 `&& !empty` 被收掉，
          而深度那行**没有**这个门槛 → 解除后只剩一个孤零零的「深度」。
       ⇒ 区分「从来没有海啸」(tsu = null / 没有 atMs) 和「海啸已解除」（items 空但有发表时刻）：
          已解除时震级 + 深度都要画（官方解除页也保留震源情报），画面才完整。 */
    var dismissed = !!(empty && tsu && tsu.atMs);
    /* ★ 2026-10-21 用户：「背景色反了，应该是黑色那个」+ 选项「照官方」：
       对照 SREV 原版空态 = 左侧**整栏纯黑**，深蓝顶板 / 震源块 / 警报表 / 图例全不画，
       只在 y≈368 处一行「表示するものはありません」。
       ⇒ 空态连顶板 paNbg1 也一起藏起来。 */
    /* ★★★ 2026-10-22 用户报「多等级海啸 UI 错乱（顶部：深度行 ↔ 3m 组头）」真正的根因：
       震源块有两个官方变体：
         · paNsb1 = **单行**面板（浅蓝底 画布 56..105 → 舞台 102..151，只放震级）
         · paNsb0 = **双行**面板（浅蓝底 画布 56..143 → 舞台 102..189，震级 + 深さ）
       以前永远画 paNsb1，而深度行（墨迹 155..174、色条 150..179）在第二行
       → 深度行整个掉在面板外，又被组头（146 起、徽章 166..201）压住，就是图里的错乱。
       ⇒ 有深度：换 paNsb0，组头/列表整体坐到面板下方（189 / 253 = 189+64）
         无深度：保持官方单行版面（146 / 210，见 view2art.js）
       顺带核对坐标：
         震级数字 cy 128 ↔ 震级色条 112..141（中心 126.5）✓
         深度数字 cy 165 ↔ 深度色条 150..179（中心 164.5）✓ 都在双行面板内 */
    var hasDep = !!(tsu && isFinite(tsu.dep) && !empty);
    var sbEl = P.artEls.paNsb1;
    if (sbEl) {
      var sbSrc = 'assets/ui2c/' + (hasDep ? 'paNsb0' : 'paNsb1') + '.svg';
      if (sbEl.getAttribute('src') !== sbSrc) sbEl.setAttribute('src', sbSrc);
    }
    var headY = hasDep ? 189 : 146;      /* 组头素材顶 = 震源面板底 */
    var listTop = hasDep ? 253 : 210;    /* 列表顶 = 组头顶 + 64（官方块距） */
    if (P.alertEl && P.alertEl.style.top !== headY + 'px') P.alertEl.style.top = headY + 'px';
    if (P.listWrap && P.listWrap.style.top !== listTop + 'px') P.listWrap.style.top = listTop + 'px';
    ['paNbg1', 'paNsb1', 'paNsmag', 'paNst0'].forEach(function (k2) {
      var e3 = P.artEls[k2];
      if (e3) e3.style.display = empty ? 'none' : '';
    });
    if (P.depEl) P.depEl.style.display = empty ? 'none' : '';
    if (P.alertEl) P.alertEl.style.display = empty ? 'none' : '';
    if (P.legendEl) P.legendEl.style.display = empty ? 'none' : '';
    if (empty) { P._barColor = null; P._depColor = null; }     /* 下次有数据时重新染色 */
    /* ⚠️⚠️ `paNsmag` / `paNsdep` 是**纯红素材**，没染色时就是两条突兀的红杠。
       真实事件就中招过：海外地震（PTWC）没有 Depth → `tsu.dep` 是 NaN →
       paNsdep 从没被染色，就把素材本色亮在那里（用户看到的「UI 错乱」里那道红条）。
       ⇒ 没有对应数值时必须**藏起来**，不能晾着素材本色。 */
    var magEl = P.artEls.paNsmag;
    if (magEl) magEl.style.display = (!empty && tsu && isFinite(tsu.mag)) ? '' : 'none';
    if (P.depEl) P.depEl.style.display = (!empty && tsu && isFinite(tsu.dep)) ? '' : 'none';
    /* ①b 图例文字（官方 hnt<等级> 里烤死的日文已清洗 → 同位置同字号补中文）
       ⚠️ 不要用 SVG getBBox 量！hnt1 的标题组带 transform → getBBox 返回**未变换**的局部框，
          会得出 y=157（画到方框【上方】去了，用户看到的「图例标题不见了」就是这个）。
       下面全部取自官方 960x720 截图的**逐像素采样**（build/png-scan.js）：
         hnt1 画布 @(769,446)，外框 #141a26 = 781..960 / 600..709
         #31476d 内框 = 793..948 / 644..670
         「海岸线颜色」墨迹 x 838.6..908.1 / y 651..664  → 画布内 (104.3, 205)
         「海啸预报」  墨迹 x 866..922     / y 682..695  → 画布内 ( 97,   236)
         青色色条 #56bcfc = 807..857 / 683..693（烤在 hnt 里，不用画） */
    var LGX = P.lgBox.x, LGY = P.lgBox.y;
    if (!empty) {
      /* ★★ 2026-10-24 用户：「图例的卡片完全是错乱的，应该在屏幕右下角，这个偏移了」
         两个真因：
           ① 位置写死 D.legend=(769,446) —— 那是 960 宽设计稿坐标，窗口一宽卡片就跑到中间；
           ② 行数按等级只写了 3 行，而 hnt4（大津波）是 **4 行**，少一行 → 文字整体错位。
         素材实测（画布 270×260，内容锚在右下角 (180,260)）：
           外框 x24..180，高 37/61/85/115（1~4 行）；标题内框 27 高贴在外框上方；
           色带 x38..88 高 12，中心 y = 242.5 / 218.5 / 194.5 / 167.5。
         ⇒ 整张画布钉在【舞台右下角】：画布 x180 → 舞台右边 −10，y260 → 舞台底 −10。 */
      var rowsN = lv >= 4 ? 4 : (lv === 3 ? 3 : (lv === 2 ? 2 : 1));
      var stEl2 = document.getElementById('stage');
      var SWV = (stEl2 && stEl2.offsetWidth) || 960;
      var SHV = visH();
      LGX = SWV - 10 - 180;
      LGY = SHV - 10 - 260;
      if (P.legendEl) {
        if (P.legendEl.style.left !== LGX + 'px') P.legendEl.style.left = LGX + 'px';
        if (P.legendEl.style.top !== LGY + 'px') P.legendEl.style.top = LGY + 'px';
      }
      var cardTopC = ({ 1: 223, 2: 199, 3: 175, 4: 145 })[rowsN];
      var LGR = P.lgRoot || P.txtRoot;
      /* 标题：内框 = [cardTopC-25, cardTopC+2]（高 27） */
      TX.zh(LGR, { text: Z.tsuCoastLegend || '海岸线颜色',
        x: Math.round(LGX + 102), y: Math.round(LGY + cardTopC - 11.5 - 6.5), size: 13,
        color: '#dfe6ef', align: 'center', maxW: 148 });
      var LG_YC = [242.5, 218.5, 194.5, 167.5];
      var tsuRows = [];
      if (lv >= 4) tsuRows.push(Z.tsunamiMajor || '大海啸警报');
      if (lv >= 3) tsuRows.push(Z.tsunamiWarn || '海啸警报');
      if (lv >= 2) tsuRows.push(Z.tsunamiWatch || '海啸注意报');
      tsuRows.push(Z.tsunamiSlight || '海面轻微变动');
      for (var ri = 0; ri < tsuRows.length; ri++) {
        var cyL = LG_YC[tsuRows.length - 1 - ri];
        TX.zh(LGR, { text: tsuRows[ri], x: Math.round(LGX + 96),
          y: Math.round(LGY + cyL - 6.25), size: 12.5, color: '#ffffff', maxW: 80 });
      }
    }

    /* ② 标题区文字（位置 = 官方字形实测墨迹，见 dump-TSUSPRITES.json） */
    function inkTop(x, inkT, size) {   /* DOM 文字的盒顶 ≈ 墨迹顶 − 0.12em */
      TX.zh(P.txtRoot, { text: x.text, x: x.x, y: Math.round(inkT - size * 0.12), size: size,
        color: x.color, weight: x.weight || 400, align: x.align, maxW: x.maxW });
    }
    if (tsu && tsu.atMs && !empty) {
      var p = global.Fmt.parts(new Date(tsu.atMs));
      inkTop({ text: p.mo + '月' + p.d + '日 ' + p.h + ':' + (p.mi < 10 ? '0' : '') + p.mi + '左右',
        x: 21.8, color: '#c2c9d4' }, 52.3, 12.6);
    }
    if (tsu && tsu.anm && !empty) {
      inkTop({ text: tsu.anm, x: 22.6, color: '#ffffff', weight: 600, maxW: (P.pBox.x + P.pBox.w - 16) - 22.6 },
        73.1, 21.5);
    }
    if (tsu && isFinite(tsu.mag) && (!empty || dismissed)) {
      /* ★★ 震级必须用【官方字形串】（同主卡）：
         官方 tsunami 页的震级 = sj* 字形 @ size **90**，首字精灵 x = -319.45（屏幕 160.55）、cy = 128。
         实测官方墨迹 154.7..188 × 高 27（窄高的数字字形）。
         旧版用 DOM 文字 37.5px → 宽 57 / 高 38，又大又胖（用户：「海啸预警的震级的数字和 UI 不对」）。
         num() 的 x = 【排布基准边】= 首字精灵中心 − adv(首字)×size/200。 */
      var magStr = tsu.mag.toFixed(1);
      var MAG_SZ = 90, MAG_CY = 128;
      /* ★★ 2026-10-22 用户：「深度的数字和色条重叠」——
         以前用 `160.55 − 首字半宽` 当【左缘】排串，串一变长（深度 10km、震级 10.0）
         右端就会顶到x=196..212 的色条上。官方墨迹右缘实测 188（震级）、色条左缘 196，
         ⇒ 统一改成【右对齐到 190】，任何长度都不会压到色条。 */
      TX.num(P.txtRoot, magStr, MAG_SZ, 190, MAG_CY, 'right');
      /* 震级标签：官方 paNst0 烤死的「マグニチュード」已清洗 → 用中文同位置同字号 */
      /* ★ 2026-10-22 用户：「左侧深度和震度的文字不协调」——
         官方图里标签是【压在数字基线上】（标签底 = 数字底），
         我们之前把标签放在数字上方 10px，两行看着一高一低。
         震级数字基线 141.5 → 标签墨迹 128..142。 */
      inkTop({ text: (Z.magnitude || '震级'), x: 30.5, color: '#fff' }, 128, 13.5);
      /* paNsmag = **纯红**官方素材，按官方震级渐变上色（同官方 COLOR 效果）*/
      var mc = (global.QVRender && global.QVRender.magColor) ? global.QVRender.magColor(tsu.mag) : null;
      var bar = P.artEls.paNsmag;
      if (bar && mc && P._barColor !== mc) {
        P._barColor = mc;
        bar.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="224" height="156">' +
          '<rect fill="' + mc + '" x="187.97" y="66" width="16" height="30"/></svg>');
      }
    }
    /* ★★ 深さ（官方 tsunami 页也有这一行：paNsdep 色条 + 数字）—— 我们以前整行都漏了。
       官方 paNst0 = 「マグニチュード」/ paNst1 = 「深さ」，两个色条同画布：
       幅度条画布 y=66、深度条画布 y=104（相 38px）→ 各自对应一行。 */
    if (tsu && isFinite(tsu.dep) && (!empty || dismissed)) {
      /* ★ 2026-10-22 用户：「左侧深度和震度的文字不协调」——
         同震级：标签底 = 数字底（深度数字基线 178.5 → 标签墨迹 165..179）。 */
      inkTop({ text: (Z.depth || '深度'), x: 30.5, color: '#fff' }, 165, 13.5);
      var dc = (global.QVRender && global.QVRender.depColor) ? global.QVRender.depColor(tsu.dep) : null;
      if (P.depEl && dc && P._depColor !== dc) {
        P._depColor = dc;
        P.depEl.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="224" height="156">' +
          '<rect fill="' + dc + '" x="187.97" y="104" width="16" height="30"/></svg>');
      }
      /* 数字同官方字形（k = 官方 km 连字，写 'km' 会变成 km+月）*/
      var dstr = Math.round(tsu.dep) + 'k';
      /* ★ 2026-10-22 用户：「10km 这个字小了，6.5 的数字是协调的」——
         原来深度用 size 60（墨迹高 ~18），而震级是 90（墨迹 ~27），比例太跳；
         官方的深さ数字更接近 0.75×。⇒ 提到 70，并按新字形高度重新算底对齐：
         墨迹高 ≈ 21 → cy = 179 − 10.5 ≈ 168.5（取 168）。 */
      TX.num(P.txtRoot, dstr, 70, 190, 168, 'right');
    }

    /* ③ 列表：一个等级一个组（组头 paNp<等级+高度>）+ 地区行（区域名 + 到达胶囊 paNt**）
       ★★ 2026-10-11 用户给了官方真实「高等级」截图 → 逐项对齐（素材全部量自官方 SVG，
          对照页 build/preview-tsu-raw.html / preview-tsu-materials.html）：
         · 组头 `paNp<高度变体>`：1m→paNp5 / 3m→paNp6 / 5m→paNp7 / 10m→paNp8 / 10m<→paNp9
                 / 高い→paNp3t（警報） / 巨大→paNp4t（大津波） / 无高度→按等级 paNp1..4
         · 地区 = 2 行：第 1 行区域名 `nt<码>`；第 2 行到达胶囊
                 `paNt0<k>`（k：0=到達予想 1=第１波の到達を確認 2=津波到達中と推測
                              3=ただちに津波襲来と予想）
                 该地区等级≥3（警報以上）时用黄版 paNt04/05/06；
                 最大波情报 → `paNt1<等级色><有无⇑>`
                 胶囊画布 224x64，胶囊本体画在画布【下半行】→ 与地区首行同 y 叠上去，
                 正好落在第 2 行（实测 paNt00 的 path y=31..58）
         · 左侧等级色条 = `paNl<等级>` 块，每 2 行一块；组内行数为奇数时末块用
           `paNl<等级>1`（色条只铺上半行），全列表末块用 `paNl<等级>12`（圆角收口）；
           下一组的组头后画 → 盖住溢出的那半块
         · 官方块距 64 = 2 行 ⇒ 把组头也当成 2 行，全部用【行号 × 32】计算，不会错位 */
    var ROWH = L.textPitch || 32;
    var NAME_DY = L.textTop - L.top;                  /* 区域名在行内的下移量（官方 4.21） */
    P.listInner.innerHTML = '';
    var total = items.length;
    /* 等级归一到 1~4：官方造型只有 paNl1..paNl4 / paNp1..paNp9 */
    var GV = items.map(function (x) {
      var v = x.grade | 0;
      return (v >= 1 && v <= 4) ? v : 1;
    });
    var names = D.names || [];
    var HR = (global.QData && global.QData.heightRank) ? global.QData.heightRank : function () { return 0; };
    function panelOf(lv2, hs) {
      var s = String(hs || '');
      if (lv2 >= 4) {
        if (/巨大/.test(s)) return 'paNp4t';
        if (/10m[<＜]|10m以上|10m超/.test(s)) return 'paNp9';
        if (/10m/.test(s)) return 'paNp8';
        if (/5m/.test(s)) return 'paNp7';
        return 'paNp4';
      }
      if (lv2 === 3) { if (/高い/.test(s)) return 'paNp3t'; if (/3m/.test(s)) return 'paNp6'; return 'paNp3'; }
      if (lv2 === 2) { if (/1m/.test(s)) return 'paNp5'; return 'paNp2'; }
      return 'paNp1';
    }
    function groupHeight(G) {
      var best = '';
      for (var q = 0; q < G.idx.length; q++) {
        var h2 = items[G.idx[q]].height || '';
        if (HR(h2) > HR(best)) best = h2;
      }
      return best;
    }
    /* 第 1 波情报 → 官方胶囊编号 */
    function firstKind(it) {
      var c = it.firstCond || '';
      if (/到達を確認/.test(c)) return 1;
      if (/到達中と推測/.test(c)) return 2;
      if (/ただちに津波襲来/.test(c)) return 3;
      if (/到達予想/.test(c) || it.firstAt) return 0;
      return -1;
    }
    function badgeOf(it, lv2) {
      var k = firstKind(it);
      if (k >= 0) {
        /* 警報以上 → 黄版（paNt04/05/06）；到達予想 只有深蓝版 paNt00 */
        var yellow = (k > 0 && lv2 >= 3);
        var cos = yellow ? ('paNt0' + (k + 3)) : ('paNt0' + k);
        /* ⚠️ 官方 paNt* 的文字是【烤在路径里】的，而我们的清洗流程把它整段抹掉了
           （对照页 build/preview-tsu-materials.html 里胶囊全是空的）
           ⇒ 每一款都得自己补字（含数字时刻），见 badgeText()。 */
        return { cos: cos, k: k, at: it.firstAt, max: false, dark: yellow, fill: true };
      }
      if (it.maxCond || it.maxAt) {
        /* ★★★ 2026-10-26 对照官方真实截图（青森県東方沖 M7.6）：
           「最大波 HH:mm X.Xm」胶囊**在 3m 津波警報组、1m 津波注意報组里都是同一个黄色版**
           （黄底 + 深字），并不是按等级换紫/红/品红 —— 那是我们之前理解的错。
           ⇒ 统一用 `paNt120`（黄），文字刷深色。 */
        return { cos: 'paNt120', k: -1, at: it.maxAt,
          h: it.maxHeight || '', max: true, dark: true, fill: true };
      }
      return null;
    }
    /* 分组：等级高的在前，同级再按高度降序
       ★★ 2026-10-24 用户：「分档你怎么就只有 3 个？10m 这么多，3m 和 1m 就一个，
          6m、5m、10m以上 等的档位被你吃了」
          根因：以前【只按等级】分 4 组 → 所有 大津波警報 并成一组，组头只能写一个高度。
          官方 311 实拍是按【等级 + 予想高さ】分组：10m以上 / 6m / 4m …
          ⇒ 改成 (等级, 高さ) 双键分组。 */
    var groups = [], gMap = {};
    for (var j = 0; j < total; j++) {
      var hk = String(items[j].height || '');
      var gk = GV[j] + '|' + hk;
      var G0 = gMap[gk];
      if (!G0) {
        G0 = gMap[gk] = { lv: GV[j], h: hk, idx: [], headRow: 0, bodyRow: 0, rows: 0, badges: [] };
        groups.push(G0);
      }
      G0.idx.push(j);
    }
    groups.sort(function (x, y) { return (y.lv - x.lv) || (HR(y.h) - HR(x.h)); });
    /* 预算：一切以【行】为单位（组头 2 行、带胶囊的地区 2 行、无胶囊的地区 1 行）
       ⚠️ 第一个组的组头 = 静态层 y=146 的那张 paNp（上面的 ①），列表里不再重复画。 */
    var rowY = 0;
    groups.forEach(function (G, gi) {
      G.headRow = rowY;
      if (gi > 0) { G.headRow = rowY; rowY += 2; }
      G.bodyRow = rowY;
      G.rows = 0; G.badges = [];
      G.idx.forEach(function (ii) {
        var b = badgeOf(items[ii], G.lv);
        G.badges.push(b);
        G.rows += b ? 2 : 1;
      });
      rowY += G.rows;
    });
    var bottomH = rowY ? (rowY * ROWH + 20) : (L.pitch + L.capH);
    P.contentH = bottomH;
    if (total) {
      P.listInner.appendChild(el('div', 'position:absolute;left:0;top:0;width:' + L.w +
        'px;height:' + P.contentH + 'px;background:#1d2a41'));
    }
    if (!total) {
      /* ★ 2026-10-21 用户：「背景色反了，应该是黑色那个」→ 选「照官方」。
         SREV 原版空态 = 整栏纯黑 + 一行提示（深蓝顶板/深蓝条都不画），
         不再铺任何底板（底色就是 #stage 的 #12151a）。
         官方文字墨迹左缘 x≈33、中心 y≈368（表示するものはありません）。 */
      /* ★ 2026-10-21：「这个也换成中文」指的是第二个 Tab（实时页）的 nashi 造型，
         不是海啸页 → 这里保持海啸自己的文案（暂无海啸信息），位置/字号照旧。
         ★★★ 2026-10-26 用户：「海啸你没做成阶段啊」（海啸 9 阶段的最后一阶段 = 全部解除）
         —— 解除之后 items 是空的，以前一律写「暂无海啸信息」，
            和「刚打开页面、压根没有海啸」看不出区别。
         ⇒ 如果这场模拟刚发过「解除」报文（`tsu.head` 里带解除字样），
            空态就写「津波警報・注意報をすべて解除しました」，并且**保留震源块**
            （官方解除页仍然挂着震源信息，不是纯黑一片）。 */
      var _h = (tsu && tsu.head) ? String(tsu.head) : '';
      var _cleared = /解除/.test(_h);
      TX.zh(P.txtRoot, {
        text: _cleared ? '海啸警报・注意报已全部解除' : (Z.tsuNoInfo || '暂无海啸信息'),
        x: 120, y: _cleared ? 392 : 360, size: _cleared ? 16 : 17,
        color: _cleared ? '#9fb3c8' : '#eef2f7', align: 'center', maxW: 208
      });
      P.contentH = L.pitch + L.capH; P.min = 0;
      if (V.scroll) { V.scroll = 0; P.inner.style.transform = ''; }
      return;
    }
    /* 绘制：块 → 组头 → 区域名/胶囊（后画的盖住先画的） */
    groups.forEach(function (G, gi) {
      var nb = Math.ceil(G.rows / 2);
      for (var b2 = 0; b2 < nb; b2++) {
        var rowsHere = Math.min(2, G.rows - b2 * 2);
        var lastList = (gi === groups.length - 1) && (b2 === nb - 1);
        var suf = (rowsHere === 2) ? '' : (lastList ? '12' : '1');
        P.listInner.appendChild(tsuImg('assets/ui2c/paNl' + G.lv + suf + '.svg',
          0, (G.bodyRow + b2 * 2) * ROWH, L.w, L.h));
      }
      if (gi > 0) {
        /* ★ 2026-10-24 用户：「请不要自己画素材」
           组头一律用官方 paNp*.svg（panelOf 按 等级+高度 选同族素材）。 */
        P.listInner.appendChild(tsuImg('assets/ui2c/' + panelOf(G.lv, G.h) + '.svg',
          0, G.headRow * ROWH, L.w, L.h));
      }
      var rr = G.bodyRow;
      G.idx.forEach(function (ii, n2) {
        var it = items[ii], b = G.badges[n2];
        var ty = rr * ROWH + NAME_DY;
        var tnm = 'nt' + it.code;
        if (names.indexOf(tnm) >= 0) {
          P.listInner.appendChild(tsuImg('assets/ui2c/' + tnm + '.svg', L.textX - L.x, ty, L.textW, L.textH));
        } else {
          /* 官方没有这个区域码的造型 → 用同位置同字号的文字兜底 */
          TX.zh(P.listInner, { text: it.name || '', x: L.textX - L.x, y: Math.round(ty + L.textH * 0.18),
            size: 16, color: '#ffffff' });
        }
        if (b) {
          P.listInner.appendChild(tsuImg('assets/ui2c/' + b.cos + '.svg', 0, rr * ROWH, L.w, 64));
          badgeText(it, b, rr);
          rr += 2;
        } else {
          rr += 1;
        }
      });
    });
    /* ★★★ 2026-10-26 用户：「你倒是看完官方素材啊，自己画CSS不好看的」
       —— 官方素材盘点（assets/ui2c，全部为官方原图，不是我画的）：
         · 组头 `paNp1..9 / paNp3t / paNp4t` —— **带官方日文与图标**
           （若干の海面変動 / 津波注意報 / 津波警報 / 高い津波警報 / 大津波警報 /
             巨大な大津波警報 / 1m / 3m / 5m / 10m / 10m超），直接用图片，不写字；
         · 列表色条 `paNl1..4 / paNl*1 / paNl*12`；
         · 地名 `nt<code>.svg`（官方整串字形）；
         · 到达胶囊 `paNt00..06`（深蓝/黄）、最大波 `paNt1<色><0|1>`；
         · **时刻数字 `paNts0..59`（官方红色 64×64 字模）** —— 以前没用上，改用它；
         · 底图 `paNbg0..4`、震源块 `paNsb0/1`、色条 `paNsmag/paNsdep`、图例 `hnt1..41`。
       ⇒ 胶囊里「時刻」改用**官方字形层**（QVT.num，官方 sj* 数字），
         汉字标签用官方字体子集（NotoSansSC-sub.woff2）；官方胶囊里本来就不带日期，
         所以日期去掉，只留 HH:mm —— 长度与官方一致，也终于不用把数字塞进浏览器字体里。 */
    function badgeText(it, b, row) {
      if (!b.fill) return;
      /* ★★★ 2026-10-26 用户：「你倒是测量截图的布局啊」
         —— 胶囊素材已换成**官方原始 SVG**（build/tsu-raw 原件），
            静态文字（最大波 / 到達予想 / 日 / : / ごろ / 第１波の到達を確認 …）
            全是官方路径，位置天然正确；我们只往官方留的空位里补**数字**。
         官方空位与数字字模（全部实测）：
           · 最大波款 paNt1x0：最大波 43..74.7 | 日 97.1..105.4 | : 124..126
              → 日期 76..97（中心 86.3）｜时 106..124（中心 115）｜分 126..145（中心 135.5）
           · 到達予想款 paNt00：到達予想 43.2..85.2 | 日 114.4..124.8 | : 149.8..152.2 | ごろ 176.5..
              → 日期 86..114（中心 99.8）｜时 125..149.8（中心 137.2）｜分 152.5..176.5（中心 164.3）
           · 数字用**官方胶囊专用字模** `paNts<NN>.svg`（64×64 画布，墨迹 30.5×29.3 居中），
             缩放 0.38 → 墨迹高 ≈11px（与官方「日」9.7 同量级）。
         ⚠️ `m` 不能交给 num()：官方字形表里 `m` = `sjm` 是「月」，会画成「16月」。 */
      var isMax = !!b.max;
      if (!isMax && b.k !== 0) return;          /* 第１波/到達中/ただちに：素材自带整句 */
      var p = (global.Fmt && b.at) ? Fmt.parts(new Date(b.at)) : null;
      if (!p) return;
      var arrow = /paNt1\d1$/.test(b.cos);
      var cy = row * ROWH + 45.2;
      var flt = b.dark ? 'brightness(0) invert(.09)' : 'brightness(0) invert(1)';
      function two(n) { return (n < 10 ? '0' : '') + n; }
      /* ★ 素材命名 = 数值（无前导零），内容 = **两位零填充**：
           paNts0 = 「00」、paNts5 = 「05」、paNts21 = 「21」、paNts59 = 「59」
           （每个文件里都是恰好两个数字 path，实测） */
      function put2(val, cx) {
        var s = 0.38, W = 64 * s, H = 64 * s;
        var im = tsuImg('assets/ui2c/paNts' + (val | 0) + '.svg',
          cx - (30.5 / 64) * W, cy - (32.3 / 64) * H, W, H);
        if (!im) return;
        im.style.filter = flt;
        P.listInner.appendChild(im);
      }
      put2(two(p.d), isMax ? 86.3 : 99.8);
      put2(two(p.h), isMax ? 115 : 137.2);
      put2(two(p.mi), isMax ? 135.5 : 164.3);
      if (isMax && b.h) {
        /* ★★★ 2026-10-26 用户：「数字太靠右了，还要 1.4m 应该数字比单位大 2-3px，同时底部对齐」
           ⇒ ① 整组右缘从 205 收到 196（带 ⇑ 款 186），不再顶到胶囊边缘；
              ② 数字 16px / 单位 m 13px（差 3px）；
              ③ 两者**底部对齐**到同一条基线（base = cy + 6），不是顶对齐。 */
        var hstr = String(b.h);
        var mm2 = hstr.match(/^([\d.]+)\s*([a-zA-Z]+)?$/);
        var numTxt = mm2 ? mm2[1] : hstr.replace(/[^\d.]/g, '');
        var unitTxt = (mm2 && mm2[2]) ? mm2[2] : 'm';
        var xR2 = arrow ? 186 : 196;
        var mW = 10, uH = 13, nH = 16;
        var mLeft = xR2 - mW;
        var base = Math.round(cy + 6);
        var inkC = b.dark ? '#191705' : '#ffffff';
        var nd = document.createElement('div');
        nd.textContent = numTxt;
        nd.style.cssText = 'position:absolute;left:' + (mLeft - 46) + 'px;width:46px;' +
          'top:' + (base - nH) + 'px;height:' + nH + 'px;line-height:' + nH + 'px;' +
          'text-align:right;white-space:nowrap;' +
          'font:700 ' + nH + 'px/1 "Noto Sans SC","Microsoft YaHei",sans-serif;color:' + inkC;
        P.listInner.appendChild(nd);
        var ud = document.createElement('div');
        ud.textContent = unitTxt;
        ud.style.cssText = 'position:absolute;left:' + mLeft + 'px;width:' + mW + 'px;' +
          'top:' + (base - uH) + 'px;height:' + uH + 'px;line-height:' + uH + 'px;' +
          'white-space:nowrap;font:700 ' + uH + 'px/1 "Noto Sans SC","Microsoft YaHei",sans-serif;color:' + inkC;
        P.listInner.appendChild(ud);
      }
    }

    /* 整列滚动：可滚量 = 内容底(舞台坐标) − **窗口实际可见高**
       （用 720 算的话，窗口比舞台矮时最后一行会被窗口底边裁掉）*/
    var VH = visH();
    P.min = Math.min(0, VH - (listTop + P.contentH));
    if (V.scroll < P.min) { V.scroll = P.min; P.inner.style.transform = 'translateY(' + P.min + 'px)'; }
  }
  /** 窗口里真正能看到的逻辑高（见 app.js 的 QVVisibleH） */
  function visH() { return (global.QVVisibleH ? global.QVVisibleH() : SH); }
  function idxOfLabel(label) {
    for (var i = 0; i < V.ctrl.length; i++) if (V.ctrl[i].label === label) return i;
    return -1;
  }

  /* ---------------- 海啸自动跳页（设置页 tsuAuto） ---------------- */
  /* ★★ 2026-10-24 用户：「模拟自动弹出海啸后 Tab 页面就点不动了」
     根因：这条自动跳页原来写在 prepare() 里，而 prepare() 每帧都跑：
       · 海啸没解除期间，用户一点 Tab1 就被弹回海啸页 → 「Tab1 点不动」；
       · 而且它是在 render 里同步调 setView → 又进一次 QVRedraw（重入）。
     现在：① 用「发布时间+等级+区域数」做指纹，同一条海啸只自动跳一次；
           ② 跳页改 setTimeout(0) 异步；③ 海啸解除才复位指纹。 */
  var tsuAutoKey = '';
  function autoJumpTsunami() {
    if (!V.opts.tsuAuto) { tsuAutoKey = ''; return; }
    /* ★★★ 2026-10-26 用户：「我不明白为什么切换的一直都是海啸页面」
       → 调查中阶段反复弹卡片时，autoJumpTsunami 会把视图抢回海啸页（弹到哪儿都被抢）。
       调查中期间不许自动跳海啸；等真海啸发布（enterFinal 之后）再恢复正常。 */
    /* ★ 整个 EEW 活动期（检出/速报/调查中）都不许自动跳海啸页，
       否则用户看到的就是「Tab1 调查中 ↔ Tab2 速报」中间一直插入海啸页。 */
    if (V.eew && (V.eew.inq || V.eew.kind === 'eew' || V.eew.kind === 'detect' || V.eew.kind === 'jishin')) return;
    /* ★★★ 2026-11-03 用户：「到正式报纸闪了大概零点几秒就立马跳到海啸页面，人家信息都看不到」
       —— 上一个 return 把 final（各地震度情報/正式报）漏在外面，那条海啸指纹一变
          （等级/区域数变化）就把人从正式报纸上拖走。
       ⇒ 只要模拟/真实 EEW 活动还在（含 final），一律不自动跳海啸页；
          用户自己点 Tab2 当然不受限制。 */
    if (V.eew) return;
    if (V._flashTimer) return;   /* 正在 flash 弹窗中不抢视图 */
    /* ★ 用户手动点过 Tab 的宽限期内，连「海啸页自动跳一次」也不抢 */
    if (V._manualAt && Date.now() - V._manualAt < MANUAL_HOLD) return;
    var t = (global.QData && QData.tsunami) ? QData.tsunami() : null;
    var n = (t && t.items) ? t.items.length : 0;
    var lv = n ? (t.maxLv | 0) : 0;
    if (lv < 1) { tsuAutoKey = ''; return; }
    var key = String(t.atMs || t.pubMs || 0) + '#' + lv + '#' + n;
    if (key === tsuAutoKey) return;
    tsuAutoKey = key;
    if (V.view === 2) return;
    setTimeout(function () { if (V.view !== 2) setView(2); }, 0);
  }

  /* ---------------- 隐藏 / 显示各视图的图形 ---------------- */
  function prepare(st) {
    if (!stage) stage = document.getElementById('stage');
    if (!V.ready && stage) {
      /* ★★ 2026-11-02 这里以前是 `stage.appendChild(dialogEl())` ——
         dialogEl() 内部已经 document.body.appendChild(dlg) 了，
         外面这一句又把它搬回 #stage（而 #stage 带 transform: scale(k)）
         → 弹窗尺寸写死的 960×720 跟着缩放，遮罩只盖左上角、弹窗也不居中。
         现在只负责「提前建好」，挂载位置由 dialogEl() 自己决定。 */
      dialogEl();
      moveChrome();
      build1(); build3();            /* 先建好，设置才有得可应用 */
      V.ready = true;
      applyOpts();
    }
    var info = (V.view === 0);
    /* ★ 2026-10-24 用户：「切换到海啸页面的时候应该隐藏『地図の色』这个卡片」 */
    if (stage) stage.classList.toggle('tsuview', V.view === 2);
    /* ★ 2026-10-26 用户：「海啸页面的时候地图的色块数字提示会被隐藏，填充色块会被压暗」
       ⇒ 交给 QVShindo 自己处理（数字层 #mappoints 隐藏 / 填充层 #mapareas 压到 0.42） */
    if (global.QVShindo && QVShindo.setTsuMode) QVShindo.setTsuMode(V.view === 2);
    /* ★★★ 2026-10-26 用户：「你这个地图海啸页面只做了震度卡，烈度卡你都没做」
       —— 日本震度走 QVShindo，中国烈度走 QVMapCam 的色块层 → 两个都要切。 */
    if (global.QVMapCam && QVMapCam.setTsuMode) QVMapCam.setTsuMode(V.view === 2);
    /* ★ 2026-10-24「海岸线画图」：有海啸时给地图海岸线涂色（js/tsu-coast.js 动态加载） */
    (function () {
      if (!global.QVTsunamiCoast) {
        if (!global.__tsuCoastLoading) {
          global.__tsuCoastLoading = true;
          /* ★★★ 2026-11-03 中国近场细分岸段（coast-cn.js）必须先到：
             tsu-coast.js 一加载就会按它给 1320..1363 这些区码上色，
             晚到的话第一帧只有省级粗色块（用户看到「全是注意报」）。 */
          var scPre = document.createElement('script');
          scPre.src = 'js/coast-cn.js?v=20261103a';
          scPre.onload = function () {
            var sc = document.createElement('script');
            sc.src = 'js/tsu-coast.js?v=20261103b';
            sc.onerror = function () { global.__tsuCoastLoading = false; };
            document.head.appendChild(sc);
          };
          scPre.onerror = function () {
            /* 拿不到细分数据也要能跑：直接加载主模块 */
            var sc2 = document.createElement('script');
            sc2.src = 'js/tsu-coast.js?v=20261103b';
            sc2.onerror = function () { global.__tsuCoastLoading = false; };
            document.head.appendChild(sc2);
          };
          document.head.appendChild(scPre);
        }
        return;
      }
      var _ts = (global.QData && QData.tsunami) ? QData.tsunami() : null;
      var _li = (_ts && _ts.items) ? _ts.items.map(function (x) {
        return { code: String(x.code), grade: (x.grade | 0) };
      }) : [];
      global.QVTsunamiCoast.set(_li);
    })();
    /* ★ 横屏画面布局：**每帧**同步（以前只在 applyOpts 里做 → 效果时有时无） */
    applyLandscape();
    var imgs = document.querySelectorAll('#art img');
    for (var i = 0; i < imgs.length; i++) {
      var c = imgs[i].dataset.cos || '';
      imgs[i].style.display = (!info && !VIEW_KEEP.test(c)) ? 'none' : '';
    }
    /* ⚠️ `buildInfoIcon()` 往 #art 里塞的是内联 <svg>（标题栏的 ⓘ），不是 <img>
       → 只遍历 img 会让它在海啸/设置页留一个孤零零的「i」（踩过） */
    var svgs = document.querySelectorAll('#art > svg');
    for (var s = 0; s < svgs.length; s++) svgs[s].style.display = info ? '' : 'none';
    /* ★ 地图永远显示（用户要求 ①） */
    var map = document.getElementById('map');
    if (map) map.style.display = '';
    /* ★ 顺序很重要：**先把图层显示出来再建**，否则 build1/build3 里量 offsetWidth 全是 0
       → 居中/右对齐/按宽缩字 全部失效（用户报的「实时页文字溢出」就是这个）。 */
    var l1 = layer('view1', 6), l3 = layer('view3', 6);
    if (V.view === 1) {
      l1.style.display = '';
      if (!l1.dataset.built) build1(); else align1();
      l1.dataset.built = '1';
    } else l1.style.display = 'none';
    /* ⚠️ 进设置页时必须重新 sync3()：「其他」分组的「数据源 N/M 源 · K 条」是在 build3 时
       取的快照，而 build3 在启动那一刻就跑过了（那时往往还没拉到数据）→ 会一直显示「连接中…」 */
    if (V.view === 3) { if (!l3.dataset.built) build3(); l3.dataset.built = '1'; l3.style.display = ''; fitLabels(); sync3(); } else l3.style.display = 'none';
    /* 视图 2（海啸）也用独立的版面层（照官方津波予報版面） */
    var l2 = tsuPanel().host;
    l2.style.display = (V.view === 2) ? '' : 'none';
    /* 选中滑块跟视图上下滑（官方 tabBs） */
    var sl = document.querySelector('#chrome img[data-cos="tabBs"]');
    if (sl) sl.style.top = (VIEW_BTN.y + V.view * VIEW_BTN.step) + 'px';
    if (global.QVRender) global.QVRender.view = V.view;
    /* 设置页「海啸发布中的海啸信息页设为默认」→ 新发一条海啸时自动切到海啸页（每条只跳一次） */
    autoJumpTsunami();
    /* ★★★ 调查中卡覆盖层：必须在这里每次渲染都调。
       之前放在 renderView 里 → 那个函数只处理「非情报视图」（view 1/2），
       而调查中卡正好要在 view=0（Tab1 详细栏 = 情报视图）显示 → 从来没执行过。
       实测也印证：全程 inqbox 不可见。 */
    updateInqOverlay();
    /* 深链的滚动量（只消费一次） */
    if (V.hs != null) { var h0 = V.hs; V.hs = null; scroll3(V.scroll - h0); }
  }

  /* ★★★★ 2026-10-26 用户（重要纠正，别再犯）：
       「调查中的卡片之前是改好的，他私自改了卡片内容，比如在卡片内加的地区刷新」
       ⇒ **卡面内容只能由官方素材拼出来，绝对不许自己往里加东西**。
       官方 paIbg130（264×302）自带：深蓝标题条（画布 y21..53，上盖 paIti1）
         +「震源・規模　調査中」（画布 y184..211，烧死在 SVG 里）+ 卡面本体（y21..281）。
       外部叠的官方零件（同官方 `#eewpage.info` 槽位）：最大震度块 paSc/paSs/snd、
       「津波　調査中」paIts2、発生日時（官方字形层）。
       行政区最大震度**不在卡里** —— 官方放在卡片下方的「观测震度」面板，这里照做。
       几何 = app.css 里 `#eewpage.info` 的官方槽位（容器坐标 == CSS 坐标）：
         .bg     (-12,-12) 264×302
         .bandli (  8,  9) 224×32
         .lvcard (-4, 37) 248×120  → .lvlab(20,20) .lvnum(138,20)
         .tsuq   (  6,207) 228×60
         .dbgw   (  8,278) 224×高   ← 观测震度面板（卡面底 281 下面 9px）
       ★ 2026-10-26 用户：「顶部和底部的那个黑边大的离谱」＋「标题出现了 2 次」
         ⇒ ① 容器原点 (0,0)：卡面直接**贴住左栏顶端**（stage y9），页头那条
               「ⓘ 震度速報」被卡片盖住 → 标题只剩卡里这一处；
            ② 面板从 278 一直铺到「地震历史」底板顶（paTbg0 的 y=421），
               把卡下方那 79px 黑边填掉，同时不动历史列表的排版。 */
  var INQ_ORIGIN = { x: 0, y: 0 };
  var inqBox = null, inqRef = null, inqKey = '';
  /** ★★★ 2026-10-26 用户：「为什么调查中一直是震度 6，差太多了吧」
   *   —— 调查中那张卡以前固定用 `V.eew.level`（= **EEW 首报的推定值**，全程不变），
   *      而地图色块早就按测站实测铺到 10 度了 → 卡上一个 6、地图上满屏 10。
   *   ⇒ 调查中改用「**已观测到的最大烈度/震度**」（只涨不跌），
   *      并且不低于 EEW 的推定值（推定值更高时仍然保留，先报大再收敛）。 */
  function inqLevelOf(E) {
    if (!E) return 0;
    if (E.inq) {
      var om = 0;
      try { om = obsMaxShindo(E); } catch (eOm) { }
      if (om > (+E.inqLv || 0)) E.inqLv = om;
    }
    return +(E.inqLv || E.level) || 0;
  }
  function updateInqOverlay() {
    var on = !!(V.eew && V.eew.inq && V.view === 0);
    /* ★ 累计【卡片真实可见】时长（不是 inq 标志存在多久） */
    var _nowMs = Date.now();
    if (on) { if (V._inqVisFrom == null) V._inqVisFrom = _nowMs; }
    else if (V._inqVisFrom != null) {
      V._inqSeenMs = (V._inqSeenMs || 0) + (_nowMs - V._inqVisFrom);
      V._inqVisFrom = null;
    }
    if (!on) { if (inqBox) inqBox.style.display = 'none'; return; }
    if (!stage) return;
    if (!inqBox) {
      inqBox = el('div', 'position:absolute;left:' + INQ_ORIGIN.x + 'px;top:' + INQ_ORIGIN.y + 'px;' +
        'width:264px;height:720px;z-index:8;pointer-events:none', { id: 'inqbox' });
      /* 顺序 = 官方叠放顺序：底图 → 标题条 → 震度块 → 発生日時 → 津波条 → 观测震度面板。 */
      inqBox.innerHTML =
        '<img class="bg" src="' + EEW_ART.paIdbg + '"' +
        ' style="position:absolute;left:-12px;top:-12px;width:264px;height:302px">' +
        '<img class="ti" src="' + EEW_ART.paItiSokuho + '"' +
        ' style="position:absolute;left:8px;top:9px;width:224px;height:32px">' +
        '<img class="blk" src=""' +
        ' style="position:absolute;left:-4px;top:37px;width:248px;height:120px">' +
        '<img class="lab" src=""' +
        ' style="position:absolute;left:16px;top:57px;width:208px;height:80px">' +
        '<img class="num" src=""' +
        ' style="position:absolute;left:134px;top:57px;width:80px;height:80px">' +
        /* 発生日時（官方字形层 T.num 的容器）：画布 (28,166) → 容器 (16,154) */
        '<div class="tm" style="position:absolute;left:0;top:0;width:264px;height:302px"></div>' +
        '<img class="tsu" src="' + EEW_ART.paTsuInq + '"' +
        ' style="position:absolute;left:6px;top:207px;width:228px;height:60px">';
      stage.appendChild(inqBox);
      inqRef = {
        blk: inqBox.querySelector('.blk'),
        lab: inqBox.querySelector('.lab'),
        num: inqBox.querySelector('.num'),
        tm: inqBox.querySelector('.tm')
      };
      inqKey = '';
    }
    /* 关键字段变了才重画（震度档位 / 发生时刻 / 行政区集合） */
    var lv = inqLevelOf(V.eew), metric = V.eew.metric || 'shindo';
    var tmMs = +V.eew.timeMs || 0;
    /* ⚠️ 卡面不再包含行政区（行政区的刷新属于 Type2 的「观测震度」面板，
       用户 2026-10-26：「Type 2 页面的卡片跑到 Type 1 上面了」→ 不得在 Tab1 显示）
       ⇒ key 只跟刻度 / 震度档位 / 发生时时刻有关 */
    var key = metric + ':' + lv + ':' + tmMs;
    if (key !== inqKey) {
      inqKey = key;
      V._cardAt = Date.now();          /* 调查中卡换内容 → 重置「卡片无变化」计时 */
      var VV = global.QV_VAR || {};
      var suf = global.QV_SC_SUF ? String(QV_SC_SUF(lv)) : '1';
      var LIE = global.QV_LIEDU;
      var lieM = (metric === 'liedu') && !!LIE && !!LIE.blockSrc;
      var fBlk = VV.paSc ? (VV.paSc[suf] || VV.paSc['1']) : '';
      var fNum = VV.snd ? (VV.snd[suf] || VV.snd['1']) : '';
      var srcBlk = lieM ? LIE.blockSrc(lv) : (fBlk ? 'assets/' + fBlk : '');
      var srcNum = lieM ? LIE.numeralSrc(lv) : (fNum ? 'assets/' + fNum : '');
      var srcLab = lieM ? LIE.labelSrc(lv) : EEW_ART.paSs;
      if (srcBlk && inqRef.blk) inqRef.blk.src = srcBlk;
      if (srcNum && inqRef.num) inqRef.num.src = srcNum;
      if (srcLab && inqRef.lab) inqRef.lab.src = srcLab;
      /* 震度 2/3/4 官方把白字刷深（与主卡 / EEW 卡同一规则） */
      var dark = (metric !== 'liedu' && lv >= 2 && lv <= 4) ? 'brightness(.11)' : '';
      if (inqRef.lab) inqRef.lab.style.filter = dark;
      if (inqRef.num) inqRef.num.style.filter = dark;
      /* 発生日時：官方字形层（sj 数字/月日/：都是官方字形），不自己拼字体。
         字号 28（墨迹高 ≈20px），左缘对齐最大震度块的墨迹左缘（画布 x28） */
      var T = global.QVT;
      if (T && inqRef.tm) {
        inqRef.tm.innerHTML = '';
        var _tt = new Date(tmMs || Date.now());
        var _md = (_tt.getMonth() + 1) + '月' + _tt.getDate() + '日 ' +
          _tt.getHours() + ':' + ('0' + _tt.getMinutes()).slice(-2) + '左右';
        T.num(inqRef.tm, _md, 28, 16, 154, 'left');
      }
    }
    inqBox.style.display = '';
    return true;
  }

  /** 非情报视图的内容（在 render3 里被调用） */
  function renderView(txtHost, zhHost, st) {
    updateInqOverlay();                    /* ★ Tab1 调查中卡覆盖层 */
    if (V.view === 1) { drawEEW(); return; }
    if (V.view === 2) return draw2(st);
  }

  /* ---------------- 命中层 ---------------- */
  var hit = null, hits = { rows: [] }, hitKey = '';
  function hitLayer() {
    if (hit) return hit;
    hit = el('div', 'position:absolute;left:0;top:0;width:960px;height:720px;pointer-events:none;z-index:9', { id: 'hit' });
    /* ★★ 2026-10-10 用户选 A：**履历行不响应点击，回归官方原样**。

       证据（反编译 build/hov-dump.txt:714 「クローン動作_地震履歴ホバー」）：
         整个积木树里**唯一的点击动作是药丸**，它设的是 `地図過去表示モード`；
         **没有任何「点履历行」的分支**。所以「点行 → 换主卡片」是我们自己加的。

       为什么必须删（实测复现）：药丸固定盖在行的【正中央】——
         行   x8..248  y+N*76 .. +76     药丸 x106..224  y+23 .. +55
         鼠标悬停时药丸就出现在**光标正下方**，于是：
             document.elementFromPoint(120, 528)  →  #hovpill
         ⇒ 点行中心 = 被药丸吃掉（动地图）；点行边缘 = 落到行上（换主卡片）。
           两种结果混在一起 → 用户报「要连续点好几次、药丸才触发、然后就乱」。

       现在：履历列表的唯一交互 = 悬停出药丸 → 点药丸 = 只动地图（见 hovpill.js）。 */
    hit.addEventListener('click', function (e) {
      var t = e.target; if (!t || !t.dataset) return;
      /* ★ 2026-10-26 用户：「不管怎么样，我手动操作都不能拦我」
         → 点 Tab 时带 byUser=true：立即清掉待执行的 flashView 定时器，
           并在 MANUAL_HOLD 内屏蔽所有自动跳页（否则 2.6 秒后又把人拉回去）。 */
      if (t.dataset.view != null) return setView(+t.dataset.view, true);
      if (t.dataset.vc != null) ctrlClick(+t.dataset.vc);
    });
    var drag = null;
    /* ★ 2026-10-20：舞台逻辑宽由 layout() 动态写（≥960，宽窗口可到 1300+），
       用 transform 后的 rect.width / 960 当缩放比 → 旋钮会往左飘。
       正解：rect.width / offsetWidth（offsetWidth 不受 transform 影响）。 */
    function stageK() {
      var r = stage.getBoundingClientRect();
      return stage.offsetWidth ? (r.width / stage.offsetWidth) : 1;
    }
    function stageX(cx) {
      var r = stage.getBoundingClientRect();
      return (cx - r.left) / (stageK() || 1);
    }
    hit.addEventListener('mousedown', function (e) {
      var t = e.target; if (!t || !t.dataset || t.dataset.vc == null) return;
      var c = V.ctrl[+t.dataset.vc];
      if (!c || c.kind !== 'knob') return;
      drag = +t.dataset.vc;
      dragTo(drag, stageX(e.clientX), false);
      e.preventDefault();
    });
    addEventListener('mousemove', function (e) { if (drag != null) dragTo(drag, stageX(e.clientX), false); });
    addEventListener('mouseup', function (e) {
      if (drag == null) return;
      dragTo(drag, stageX(e.clientX), true);
      drag = null;
    });
    stage.appendChild(hit);
    return hit;
  }
  function dragTo(i, sx, done) {
    var c = V.ctrl[i]; if (!c) return;
    var t = (sx - c.tr0) / Math.max(1, c.tr1 - c.tr0);
    t = Math.max(0, Math.min(1, t));
    /* ★ 2026-10-21 用户：「这个不应该是无极调节的，官方都不是无极的」
       ⇒ 按该滑块的【档数】吸附（stops = 可选位置数，缺省 7 档）。 */
    var n = c.stops || 7;
    t = Math.round(t * (n - 1)) / (n - 1);
    setVal(i, Math.round(t * 100) / 100);
    sync3(); applyOpts();
    if (done) { save(); sync3(); }
  }
  function ctrlClick(i) {
    var c = V.ctrl[i]; if (!c) return;
    /* 动作按钮：直接做事 */
    if (c.kind === 'button') {
      if (/导出/.test(c.label || '')) return openDialog();
      if (/保存/.test(c.label || '')) return saveToBrowser();
      if (/重置/.test(c.label || '')) return resetAll();
      if (/切换星球/.test(c.label || '')) return openPlanetPicker();
      if (/地震模拟|模拟设置/.test(c.label || '')) return startSimPick();
      /* ★★★ 2026-10-25 用户（截图）：「本版未接入：查看关于与素材授权」→ 把它接上。
         openAbout() 早就写好了，只是 ctrlClick 一直没接线。 */
      if (/关于/.test(c.label || '')) return openAbout();
      /* ★ 2026-10-27 事件录制・回放（API 层报文，不是录像） */
      if (/事件录制/.test(c.label || '')) return (global.QVRec && QVRec.open) ? QVRec.open() : toast('录制模块未加载');
      /* ★ 2026-10-28 场地数据（Vs30）精度档位：向导 / 设置共用同一套界面 */
      if (/场地数据/.test(c.label || '')) {
        if (global.QVVs30UI && QVVs30UI.open) return QVVs30UI.open('settings');
        return toast('场地数据模块未加载（仅桌面版可用）');
      }
      return toast('本版未接入：' + c.label);
    }
    if (c.kind === 'toggle') {
      setVal(i, valOf(i) ? 0 : 1); sync3(); applyOpts();
      var r0 = unwiredReason(c) || noteOf(c);
      return toast(label(c) + '：' + (valOf(i) ? '开' : '关') + (r0 ? '｜' + r0 : ''));
    }
    if (c.kind === 'cycle') {
      /* ★ 2026-10-21 用户：「根本没有下拉框，点击下拉框的选项居然是长得像下拉框按钮的状态开关」
         ⇒ 点一下必须**弹出真正的选项列表**（见 openCycleMenu），不再原地循环切换。 */
      return openCycleMenu(i);
    }
    if (c.kind === 'knob') { applyOpts(); return; }
  }

  /* ═════════ 下拉框菜单（pcb 控件真正的选项列表）═════════ */
  var cycMenu = null;
  function closeCycleMenu() {
    if (cycMenu) {
      if (cycMenu.parentNode) cycMenu.parentNode.removeChild(cycMenu);
      cycMenu = null;
    }
    document.removeEventListener('mousedown', cycMenuOut, true);
    document.removeEventListener('keydown', cycMenuEsc, true);
    window.removeEventListener('wheel', cycMenuWheel, true);
  }
  function cycMenuOut(e) { if (cycMenu && !cycMenu.contains(e.target)) closeCycleMenu(); }
  function cycMenuEsc(e) { if (e.key === 'Escape' || e.key === 'Esc') closeCycleMenu(); }
  function cycMenuWheel() { closeCycleMenu(); }
  function openCycleMenu(i) {
    var c = V.ctrl[i]; if (!c) return;
    var vals = (c.vals && c.vals.length) ? c.vals : (CYCVALS_DEFAULT[c.group] || []);
    if (!vals.length) return;
    closeCycleMenu();
    if (!stage) stage = document.getElementById('stage');
    if (!stage) return;
    var cur = ((Math.round(valOf(i)) % vals.length) + vals.length) % vals.length;
    var ROWH = 34, PAD = 5, stH = 720;
    var mh = vals.length * ROWH + PAD * 2;
    var m = el('div', 'position:absolute;left:' + c.left + 'px;width:' + Math.max(c.w, 180) + 'px;' +
      'height:' + Math.min(mh, 360) + 'px;background:#1d2a41;border:1px solid #31476d;border-radius:6px;' +
      'box-shadow:0 8px 22px rgba(0,0,0,.6);overflow-y:auto;overflow-x:hidden;z-index:60;' +
      'padding:' + PAD + 'px 0;box-sizing:border-box;pointer-events:auto;' +
      "font-family:'NotoSC','Noto Sans SC','Source Han Sans SC','Microsoft YaHei UI',sans-serif");
    m.id = 'qvcycmenu';
    var y = c.top + V.scroll + c.h + 4;
    var hM = Math.min(mh, 360);
    if (y + hM > stH - 6) y = Math.max(6, c.top + V.scroll - 4 - hM);   /* 下面放不下 → 翻到上面 */
    m.style.top = Math.round(y) + 'px';
    vals.forEach(function (v, k) {
      var r = el('div', 'height:' + ROWH + 'px;line-height:' + ROWH + 'px;padding:0 12px;font-size:15px;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;' +
        'color:' + (k === cur ? '#ffffff' : '#c7d2e2') + ';' + (k === cur ? 'background:#31476d;' : ''));
      r.textContent = v;
      if (k !== cur) {
        r.onmouseenter = function () { r.style.background = '#27405f'; };
        r.onmouseleave = function () { r.style.background = ''; };
      }
      r.addEventListener('click', function (ev) {
        ev.stopPropagation();
        setVal(i, k); sync3(); applyOpts();
        closeCycleMenu();
      });
      m.appendChild(r);
    });
    stage.appendChild(m);
    cycMenu = m;
    document.addEventListener('mousedown', cycMenuOut, true);
    document.addEventListener('keydown', cycMenuEsc, true);
    window.addEventListener('wheel', cycMenuWheel, true);
  }
  function label(c) { return (c.label || '设置').replace(/，.*$/, ''); }
  /* ★ 有些开关一拨就会「改动整个界面」，只显示「开/关」用户会以为界面坏了
     （2026-10-11 用户：「信息栏消失了，就剩一排按钮了」= 横屏画面布局被存成开）。
     这类开关点一下必须把后果说清楚，否则根本不知道去哪儿找回来。 */
  var TOGGLE_NOTE = { '横屏画面布局': '隐藏左侧信息栏，只留地图（再点一次恢复）' };
  function noteOf(c) {
    var l = (c && c.label) || '';
    return TOGGLE_NOTE[l] || TOGGLE_NOTE[l.replace(/，.*$/, '')] || '';
  }

  function syncHits() {
    if (!stage) stage = document.getElementById('stage');
    if (!stage) return;
    var key = V.view + '|' + V.scroll + '|' + hits.rows.map(function (x) { return x ? x.id : '-'; }).join(',');
    if (key === hitKey) return;
    hitKey = key;
    var l = hitLayer();
    while (l.firstChild) l.removeChild(l.firstChild);
    /* 左侧 4 个视图图标（永远在最上层） */
    for (var i = 0; i < 4; i++) {
      var b = el('div', 'position:absolute;left:' + VIEW_BTN.x + 'px;top:' + (VIEW_BTN.y + i * VIEW_BTN.step) +
        'px;width:' + VIEW_BTN.w + 'px;height:' + VIEW_BTN.h + 'px;border-radius:4px;pointer-events:auto;cursor:pointer');
      b.dataset.view = i;
      l.appendChild(b);
    }
    /* 设置页控件 */
    if (V.view === 3 && L3) {
      L3.boxes.forEach(function (c, i) {
        var b = el('div', 'position:absolute;left:' + c.left + 'px;top:' + (c.top + V.scroll) + 'px;width:' +
          c.w + 'px;height:' + c.h + 'px;border-radius:4px;pointer-events:auto;' +
          (c.kind === 'knob' ? 'cursor:ew-resize' : 'cursor:pointer'));
        b.dataset.vc = i;
        l.appendChild(b);
      });
    }
    /* ★ 履历行【不再生成命中 div】：行本身不响应点击（见 hitLayer 的说明）。
       行数据仍在 hits.rows 里 —— hovpill.js 用 QVViews.getRows() 做悬停命中。
       ⚠️ 千万别把这段加回来：行命中区会跨在药丸下面抢点击。 */
  }

  /* ---------------- 视图切换 ---------------- */
  /* ★★★ 2026-10-26 用户（核心规则）：「如果有 UI 更新了（有新的情报），就会跳转到这个 UI
      显示 7-14 秒来展示最新的动态，过了这个时间段后就会回到刚刚显示的固定画面」
      ⇒ 新情报来了先记下「原页」，跳过去让人看清楚，倒计时结束再弹回去。
      连续多报只续时、不重复记录原页（否则会跳到自己）。 */
  /* ★ 「手动优先」宽限期（ms）：用户手动点了 Tab 之后，这么多秒内不自动跳页。
     官方播放器也不会让「自动弹页」压过用户手势 —— 用户 2026-10-26 明确要求。 */
  /* ══════════════════════════════════════════════════════════════════════
     2026-10-28 官方切页模型（反编译 quakeviewer-replica/assets/project.json）
       · タブ自動切換え(タブ番号, 動作場所, 自動戻りセットしない, スクロール位置)
       · タブ戻し      —— 自动切回：先过「距上次自动切页 N 秒」闸门，再叠数据条件
       · UIタブ更新判定 —— tab + 数据指纹，变了才刷新
     官方闸门秒数（原文 86400×(days2000−自動タブ変更時間) 的比较值）：
       津波情報中 8 / 震度速報中戻し 5 / 読み上げ(强震点=0) 20 /
       検出中 3→5→8 / 検知範囲じわじわ増加 300
     ══════════════════════════════════════════════════════════════════════ */

  /* 地図表示モード：官方 1=EEW页(tab1) 2=详细栏(tab0) 3=海啸页(tab2) */
  function mapModeOf(v) { return (v === 1) ? 1 : (v === 2 ? 3 : 2); }
  var TAB_GATE = { tsu: 8, std: 5, hard: 20, det0: 3, det1: 5, det2: 8, slowQuake: 300 };
  V.mapMode = function () { return mapModeOf(V.view); };
  V.tabGate = TAB_GATE;
  function sinceTabChange() { return (Date.now() - (V.tabChangedAt || Date.now())) / 1000; }

  /* 官方 初期スクロール位置：切页时记住旧页偏移、恢复新页偏移 */
  var SCROLL_MEM = {};
  function saveScroll(v) { SCROLL_MEM[v] = V.scroll || 0; }
  function applyScrollTo(v, y) {
    var ly = (v === 1) ? L1 : (v === 3 ? L3 : (v === 2 ? LTSU : null));
    if (!ly || !ly.inner) return;
    ly.inner.style.transform = y ? ('translateY(' + y + 'px)') : '';
    hitKey = '';
    try { syncHits(); } catch (e) { }
  }
  function restoreScroll(v) {
    var want = SCROLL_MEM[v] || 0;
    V.scroll = want;
    applyScrollTo(v, want);
  }

  /** 这场地震里「震度 ≥ lv 的行政区个数」——对应官方 震度n以上の点数 */
  function areaCountAbove(lv) {
    var E = V.eew; if (!E) return 0;
    var list = E.allAreas || [], n = 0;
    for (var i = 0; i < list.length; i++) {
      var v = +list[i].level; if (!isFinite(v) || v <= 0) v = +list[i].shindo;
      if (isFinite(v) && v >= lv) n++;
    }
    return n;
  }
  /** 官方 タブ戻し 的「能不能自动切回去」判定
   *  kind：'tsu' 海啸 | 'std' 常规 | 'hard' 强震硬门槛 | 'detect' 摇晃检测 | 'slow' 缓慢增加 */
  function canAutoBack(kind) {
    /* 用户手动点过 Tab → 一律让位（官方也是操作后 13 秒内不抢） */
    if (V._manualAt && Date.now() - V._manualAt < MANUAL_HOLD) return false;
    var el = sinceTabChange();
    if (kind === 'tsu') return el > TAB_GATE.tsu;
    if (kind === 'hard') return el > TAB_GATE.hard;
    if (kind === 'slow') return el > TAB_GATE.slowQuake;
    if (kind === 'detect') {
      if (el <= TAB_GATE.det0) return false;
      var n5 = areaCountAbove(50);            /* 震度5弱以上の点数 */
      if (n5 < 20) return el > TAB_GATE.det1; /* 规模不大 → 5 秒就能走 */
      return el > TAB_GATE.det2;              /* 规模大 → 等到 8 秒 */
    }
    /* 常规（震度速報中戻し）：>5 秒 且 震度5弱以上点数 < 20 */
    if (areaCountAbove(50) >= 20) return el > TAB_GATE.det2;
    return el > TAB_GATE.std;
  }

  /* 中枢：官方 タブ自動切換え */
  function tabSwitch(tab, opt) {
    opt = opt || {};
    tab = Math.max(0, Math.min(3, tab | 0));
    saveScroll(V.view);
    V.tabChangedAt = Date.now();
    if (opt.noAutoBack !== true) V.autoTab = tab;
    else if (V.autoTab == null) V.autoTab = V.view;
    if (tab !== V.view) {
      var _keep = V.scroll;
      setView(tab);
      /* 官方：scroll 为空 → 复位；给了值 → 恢复 */
      if (opt.scroll == null) { V.scroll = 0; applyScrollTo(tab, 0); }
      else { V.scroll = opt.scroll | 0; applyScrollTo(tab, V.scroll); }
    } else if (opt.scroll == null) {
      restoreScroll(tab);
    }
    if (global.QVRedraw) QVRedraw();
    return true;
  }
  V.tabSwitch = function (t, o) { return tabSwitch(t, o); };
  V.canAutoBack = canAutoBack;
  V.sinceTabChange = sinceTabChange;

  /* ══════════════════════════════════════════════════════════════════════
     官方 `UIタブ更新判定` 的等价物：给每个 Tab 算一个「指纹」，
     只有指纹变了才广播「タブ更新」（= 才需要重建 DOM）。
     · tab0（详细栏）：地震履歴 10 条 id + 最大震度 + 当前选中地震
     · tab1（实时页）：上位 20 地域震度 + 最大震度 + EEW 8 张卡的报数/震度
     · tab2（海啸页）：津波関連条目指纹
     · tab3（设置页）：固定，不看
     koneew 里 L1/L3/L2 已经用 `dataset.built` 做了**惰性克隆**地图
     （官方 6-1パネル表示状況クローン適用 同一思路），这里再补「内容指纹」，
     供 prepare()/render 判定是否需要重画，避免每帧重建。 */
  function tabSig(tab) {
    var out = [];
    try {
      if (tab === 0) {
        var rows = (V.getRows && V.getRows()) || V.rows || [];
        for (var i = 0; i < Math.min(10, rows.length); i++) {
          var q = rows[i] || {};
          out.push(String(q.id || q.time || i) + ':' + (q.maxShindo != null ? q.maxShindo : '') + ':' + (q.mag != null ? q.mag : ''));
        }
        var E0 = V.eew;
        if (E0) out.push('E' + (E0.kind || '') + (E0.report || '') + (E0.maxShindo || ''));
        var cur = (global.QVHist && QVHist.current && QVHist.current()) || null;
        if (cur) out.push('c' + (cur.id || cur.time || ''));
      } else if (tab === 1) {
        var E1 = V.eew || {};
        var areas = (E1.areas || []).slice(0, 20);
        for (var j = 0; j < areas.length; j++) out.push((areas[j].code || areas[j].area || j) + '=' + (areas[j].level != null ? areas[j].level : areas[j].shindo));
        out.push('M' + (E1.mag != null ? E1.mag : '') + 'D' + (E1.depth != null ? E1.depth : ''));
        out.push('S' + (E1.maxShindo != null ? E1.maxShindo : '') + 'K' + (E1.kind || '') + 'R' + (E1.report || 0) + (E1.inq ? 'I' : ''));
      } else if (tab === 2) {
        var ts = (global.QData && QData.tsunami) ? QData.tsunami() : null;
        var it = (ts && ts.items) || [];
        for (var k2 = 0; k2 < it.length; k2++) out.push((it[k2].code || '') + ':' + (it[k2].grade | 0));
      }
    } catch (eSig) { }
    return out.join('|');
  }
  V.tabSig = tabSig;
  /** 官方「タブ更新」广播：指纹变了才返回 true（调用方据此决定重画） */
  function needTabUpdate(tab) {
    var sig = tabSig(tab);
    V._tabSig = V._tabSig || {};
    if (V._tabSig[tab] === sig) return false;
    V._tabSig[tab] = sig;
    return true;
  }
  V.needTabUpdate = needTabUpdate;

  var MANUAL_HOLD = 12000;
  function flashView(target, ms, backTo) {
    ms = ms || 10000;
    /* ★★★ 2026-10-25 用户：「模拟地震的时候 EEW 阶段都没结束，结果自动跳到了 Tab1」
       —— 真因就在这里：`V.view === target` 时原来的代码**不记录回退目标**（因为不需要跳），
          但仍然会排一个 `_flashTimer`，到点读的是**上一次残留的 `_flashBack`**
          （通常是 0 = Tab1）→ 15 秒后把正在看 Tab2 的用户硬拽回 Tab1。
          实测时间线：t=2s 首报 → t=16.5s 被切到 Tab1（此时 EEW 还在发报）。
       ⇒ 已经在目标页 = 根本不需要闪跳：清掉待执行的回退，直接返回。 */
    if (V.view === target) {
      if (V._flashTimer) { clearTimeout(V._flashTimer); V._flashTimer = 0; }
      V._flashBack = -1;
      V._backTries = 0;
      return;
    }
    /* ★★★ 2026-10-26 用户：「虽然软件有自动跳转，但是不管怎么样，我手动操作都不能拦我」
       → 用户刚手动点过 Tab（MANUAL_HOLD 内）时，**任何自动跳页一律让位**：
         EEW 新报的弹页、调查中的反复弹、海啸自动跳页全部不发生。
         （setView(…, true) 里已经把待执行的定时器清掉了，这里再堵住后续的。） */
    if (V._manualAt && Date.now() - V._manualAt < MANUAL_HOLD) return;
    /* ★★★ 2026-10-26 用户：「我在设置里都开了海啸发布中的海啸信息页设为默认了，怎么还给我弹走，不回来了？」
       → V.opts.tsuAuto 就是那个设置。开了它，海啸页就应该常驻，
         flashView(2, 12000) 不能再记录回退目标（否则 12 秒后一定弹回去）。 */
    if (target === 2 && V.opts.tsuAuto) {
      V._flashBack = -1;
      if (V._flashTimer) { clearTimeout(V._flashTimer); V._flashTimer = 0; }
      if (V.view !== 2) { try { setView(2); } catch (e0) { } }
      return;
    }
    if (V.view !== target) {
      /* ★★★ 2026-10-26 用户：「我在设置里点开始模拟，它自己弹到 EEW 界面，
         结果过了 10 秒钟又回到设置了」→ 设置页（view 3）是「操作页」，不能当弹回目标；
         从设置页跳走的，倒计时结束后回「Tab1 详细栏」。 */
      /* ★ backTo 由调用方指定固定回退目标。不指定时才用“当前页”。
         实测死循环：growIpf 每 3 秒调一次 flashView，上一次 timer 过期后
         _flashBack 重新记录“当时的页”，而那一刻恰好停在海啸页 → 永远弹回海啸页。 */
      /* ★ 2026-10-26：海啸页(2) 与设置页(3) 都不能当回退目标。
         以前只排除了 3，而 growIpf 每 3 秒调一次，某次恰好停在海啸页
         → _flashBack=2 → 永远弹回海啸页 → 变成「1↔2 死循环」。
         调查中只应在 Tab1(详细栏 0) 与 Tab2(实时页 1) 之间跳。 */
      if (!V._flashTimer) V._flashBack = (backTo != null) ? (backTo | 0) : ((V.view === 3 || V.view === 2) ? (V.autoTab != null ? V.autoTab : 0) : V.view);
      try { setView(target); } catch (e) { }
    }
    if (V._flashTimer) { clearTimeout(V._flashTimer); V._flashTimer = 0; }
    V._flashTimer = setTimeout(function tick() {
      V._flashTimer = 0;
      var back = V._flashBack;
      if (back == null || back < 0 || back === V.view) { V._flashBack = -1; V._backTries = 0; return; }
      /* ★★★ 2026-10-28 官方 タブ戻し：切回去之前必须过「距上次自动切页 N 秒」闸门。
         以前到点就无条件 setView(back) → 用户「进调查中了还被切回紧急地震速报，15 秒都没过」。 */
      var kind = (V.view === 2) ? 'tsu' : ((V.eew && V.eew.inq) ? 'detect' : 'std');
      if (!canAutoBack(kind)) {
        V._backTries = (V._backTries || 0) + 1;
        if (V._backTries < 60) { V._flashTimer = setTimeout(tick, 500); return; }  /* 最多再等 30 秒 */
      }
      V._backTries = 0;
      V._flashBack = -1;
      if (back !== V.view) { try { tabSwitch(back, { noAutoBack: true }); } catch (e2) { } }
    }, ms);
  }
  V.flashView = function (t, ms) { flashView(t, ms); };

  function setView(n, byUser) {
    n = Math.max(0, Math.min(3, n | 0));
    /* ★ 用户手动切页：立刻让位 —— 清掉待执行的 flashView 定时器 + 记下时间戳
       （flashView / autoJumpTsunami 会在 MANUAL_HOLD 内直接 return）。
       ⚠️ 必须放在 `n === V.view` 判断**之前**：点同一个 Tab 也要解除自动跳页。 */
    if (byUser) {
      V._manualAt = Date.now();
      if (V._flashTimer) { clearTimeout(V._flashTimer); V._flashTimer = 0; }
      V._flashBack = -1;
    }
    /* ★★ 宽限期内，**非用户发起**的切页一律忽略。
       光拦 flashView 不够：setEEW / onRealEew / 正式报推进这些地方是直接调 setView 的
       （实测：手动点 Tab3 后 4.6 秒被 setEEW 的 setView(1) 抢走）。 */
    if (!byUser && V._manualAt && Date.now() - V._manualAt < MANUAL_HOLD && n !== V.view) return;
    /* ★★★ 2026-11-03 用户：「到正式报纸闪了大概零点几秒就立马跳到海啸页面，人家信息都看不到」
       —— 海啸发布瞬间 flashView(2, 8000) 刚把人带到海啸页，紧接着
          阶段推进 / setEEW / enterFinal 又直接 setView(0) 把人拽走 → 海啸页只闪 0.7 秒。
       ⇒ 正在闪海啸页（V.view === 2 且 _flashTimer 在跑）时，**非用户发起**的切页一律让位；
         解除/回退仍由 simTsuNext / flashView 的定时器自己负责（它们会先清 _flashTimer）。 */
    if (!byUser && V._flashTimer && V.view === 2 && n !== 2) return;
    if (n === V.view) return;
    /* ★ 官方 初期スクロール位置：离开旧页记住偏移，回到旧页恢复 */
    saveScroll(V.view);
    var _scKeep = SCROLL_MEM[n] || 0;
    V.view = n;
    V.tabChangedAt = Date.now();
    if (n === 0) V._inqTabAt = Date.now();      /* ★ 调查中卡在 Tab1：记下开始看的时刻（3 秒门槛用） */
    V.scroll = _scKeep;
    if (L3) L3.inner.style.transform = '';
    if (L1) L1.inner.style.transform = '';
    if (LTSU) { LTSU.inner.style.transform = ''; LTSU.min = 0; }
    /* ★ 官方 初期スクロール位置：恢复该页上次的滚动位置 */
    if (V.scroll) {
      var _ly = (n === 1) ? L1 : (n === 3 ? L3 : (n === 2 ? LTSU : null));
      if (_ly && _ly.inner) _ly.inner.style.transform = 'translateY(' + V.scroll + 'px)';
    }
    if (global.QVRender) global.QVRender.view = n;
    /* ★ 离开情报页（view 0）时要收起正式报卡 overlay：
       QVRender.draw() 在 type2/3/4 页面不跑 → 不主动收就会一直盖在上面
       （用户：「type2 type3 type4 页面为什么还有这张卡片」）。 */
    if (n !== 0 && global.QVFinalCardHide) { try { global.QVFinalCardHide(); } catch (e) { } }
    try { localStorage.setItem(VKEY, String(n)); } catch (e) { }
    hitKey = '';
    if (global.QVRedraw) global.QVRedraw();
  }

  /* ---------------- 设置 → 行为 ---------------- */
  function applyOpts() {
    var o = V.opts;
    /* ⚠️ 这张表必须把「有滑杆/开关的项」全列进来：漏掉的项会永远停在初始默认值
       （踩过：`uiScale` / `freq` 漏了 → 设置页拖「UI 大小」显示 118% 但界面纹丝不动）。 */
    ['follow', 'anim', 'freq', 'uiScale', 'lieduAll', 'detect', 'detectSplit', 'tsuAuto', 'landscape', 'autoHide',
      'layerBtn', 'mapStyle', 'world', 'ocean', 'pinSize', 'preload', 'pinMode', 'zoomRate', 'fillStyle',
      'detectType', 'fillCircle', 'strongMon', 'shindo0', 'seaSensor', 'tsuObs', 'psWave',
      'sndEffect', 'sndInfo', 'sndCat', 'voiceOn', 'voiceArea', 'sndFelt', 'sndMag',
      'voiceFelt', 'sndDetect', 'voiceDetect', 'sndShindo', 'voiceMaxArea', 'voiceShindo3', 'voiceShindo'].forEach(function (name) {
      var lab = labelOf(name);
      if (!lab) return;                       /* 这条线还没接上真正的官方行 → 用默认值 */
      var i = idxOfLabel(lab);
      if (i >= 0) {
        var c = V.ctrl[i];
        o[name] = (c.kind === 'knob') ? Math.max(0, Math.min(1, valOf(i))) : valOf(i);
      }
    });
    /* ★ UI 大小 / 主循环周期 / 自动隐藏按钮：直接接 app.js 已经准备好的 QVSet */
    var u = 0.8 + o.uiScale * 0.4;
    if (global.QVSet) {
      if (global.QVSet.uiScale) global.QVSet.uiScale(u);
      if (global.QVSet.interval) global.QVSet.interval(Math.round((0.5 + o.freq * 2.5) * 1000));
      if (global.QVSet.autoHide) global.QVSet.autoHide(!!o.autoHide);
    } else {
      var wrap = document.getElementById('wrap');
      if (wrap) wrap.style.transform = (Math.abs(u - 1) < .001) ? '' : 'scale(' + u.toFixed(3) + ')';
    }
    /* ★ 声音 / 朗读：把开关交给 audio.js（真的出声、真的念） */
    if (global.QVSpeak && global.QVSpeak.setEnabled) {
      global.QVSpeak.setEnabled({
        sound: !!(o.sndEffect || o.sndInfo || o.sndCat || o.sndFelt || o.sndMag || o.sndDetect || o.sndShindo),
        voice: !!(o.voiceOn || o.voiceArea || o.voiceFelt || o.voiceDetect || o.voiceMaxArea || o.voiceShindo3 || o.voiceShindo)
      });
    }
    /* 地图相关 */
    var map = document.getElementById('map');
    if (map) map.style.filter = FILTERS[Math.round(o.mapStyle)] || '';
    var oc = document.getElementById('mapocean');
    if (oc) oc.style.display = o.ocean ? '' : 'none';
    var l3 = document.getElementById('view3');
    if (l3) l3.style.opacity = '';
    if (global.QVMapCam && global.QVMapCam.setOpts) {
      global.QVMapCam.setOpts({
        follow: !!o.follow, anim: !!o.anim, world: !!o.world,
        pinScale: 0.6 + o.pinSize * 0.8, zoomRate: 0.5 + o.zoomRate * 1.5,
        autoHide: !!o.autoHide, layerBtn: !!o.layerBtn, pinMode: Math.round(o.pinMode)
      });
    }
    /* 横屏画面布局 = 隐藏左侧信息栏，把地图让出来（官方 paPb1_2#2「横画面レイアウト」） */
    applyLandscape();
  }
  /* ★★ 2026-10-11 用户报「信息栏消失了，就剩一排按钮了」：
     这一段原来只写在 applyOpts() 里，而 applyOpts 只在【用户碰控件 / 启动】时跑
     ⇒ 效果**时有时无**：
       · 开着它点 ⓘ 回情报页 → 什么都没发生（看着像开关坏了）
       · 下次启动 → 整个左侧栏没了（含时钟、标题、履历），只剩图标列
     现在抽成独立函数，prepare() **每帧**调 → 立即生效、视图切换也一致。
     ⚠️ 不隐藏地图、也不隐藏 #mappins（震中标记在 #map 下，见 mapcam.js）。 */
  var _lsOn = null;
  function applyLandscape() {
    var on = !!V.opts.landscape && V.view === 0;
    if (on === _lsOn) return;
    _lsOn = on;
    ['art', 'zh', 'txt'].forEach(function (id) {
      var e2 = document.getElementById(id);
      if (e2) e2.style.visibility = on ? 'hidden' : '';
    });
    /* ★ 横屏时左栏让给地图 → 地图视口起点从 244 挪到 0（并触发重画）。
       尺寸从 #stage 的实际逻辑宽高取（app.js 的 layout() 已按窗口铺满写入）。 */
    var st = document.getElementById('stage');
    if (st && global.QVMapCam && global.QVMapCam.setStage) {
      global.QVMapCam.setStage(st.offsetWidth || 960, st.offsetHeight || 720, on);
    }
  }
  var LABEL_OF = {};
  for (var L2 in WIRE) if (!LABEL_OF[WIRE[L2]]) LABEL_OF[WIRE[L2]] = L2;
  function labelOf(optName) { return LABEL_OF[optName] || ''; }
  V.freqMs = function () { return Math.round((0.5 + V.opts.freq * 2.5) * 1000); };
  V.metricAllLiedu = function () { return !V.opts.lieduAll; };
  /* ★ V.shindoConv 已删除 —— 官方那个设置是给【计测烈度→震度阶级】换算用的（需传感器），
     不是用来把「外国机构的烈度」改个标签叫震度的。烈度/震度是两套完全不同的标度，
     标签必须跟着实际用的标度走（见 render3.js 的 metricOf/mLab）。 */
  V.autoSelectTsunami = function () { return !!V.opts.tsuAuto; };
  V.detectEnabled = function () { return !!V.opts.detect; };
  V.pinMode = function () { return Math.round(V.opts.pinMode); };
  V.showShindo0 = function () { return !!V.opts.shindo0; };
  /** ★ 在震源显示 P/S 波圆（mapcam.js 的 tickWaves 每 250ms 读它） */
  V.psWave = function () { return !!V.opts.psWave; };

  /* ---------------- 导出 / 导入 / 重置 ---------------- */
  var dlg = null;
  function dialogEl() {
    if (dlg) return dlg;
    dlg = el('div', '', { id: 'qvdialog' });
    dlg.innerHTML =
      '<div class="box"><b>设置导出・导入</b><div style="margin-top:6px;color:#9fb0c6;font-size:13px">' +
      '下面是当前设置（JSON）。复制保存即可导出；粘贴别人的内容后点「导入」即可覆盖。</div>' +
      '<textarea id="qvjson"></textarea>' +
      '<div class="btns"><button id="qvimp">导入</button><button id="qvclose">关闭</button></div></div>';
    /* ★★ 2026-11-02 挂到 body，不要挂 #stage：
       #stage 有 transform: scale(k)，挂里面的话弹窗会被一起缩放，
       而且遮罩尺寸写死的 960×720 → 舞台一大就只盖左上角。
       （用户：「弹窗都应该自适应，应该始终居中，同时背景灰色」） */
    document.body.appendChild(dlg);
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg) dlg.className = '';
    });
    dlg.querySelector('#qvclose').addEventListener('click', function () { dlg.className = ''; });
    dlg.querySelector('#qvimp').addEventListener('click', function () {
      try {
        var o = JSON.parse(dlg.querySelector('#qvjson').value);
        var n = 0;
        for (var k in o) { if (/^\d+$/.test(k)) { V.values[k] = o[k]; n++; } }
        save(); sync3(); applyOpts(); toast('已导入 ' + n + ' 项设置');
        dlg.className = '';
      } catch (e) { toast('导入失败：不是合法 JSON'); }
    });
    return dlg;
  }
  function exportJSON() {
    var out = {};
    for (var k in V.values) if (/^\d+$/.test(k)) out[k] = V.values[k];
    return JSON.stringify(out, null, 1);
  }
  function openDialog() {
    dialogEl();
    dlg.querySelector('#qvjson').value = exportJSON();
    dlg.className = 'on';
  }
  function saveToBrowser() { save(); toast('设置已保存到浏览器'); }
  function resetAll() {
    V.values = {}; save(); sync3(); applyOpts(); toast('设置已重置');
  }

  /* ---------------- 「其他」分组的两行状态 ---------------- */
  var APP_VER = '2.0.1';        /* 与 package.json 的 version 保持一致 */
  function infoVersion() { return 'ZQuake模拟器 v' + APP_VER + ' - bata'; }
  function infoFeeds() {
    try {
      var h = (global.QData && global.QData.health) ? global.QData.health() : null;
      var s = (global.QData && global.QData.stats) ? global.QData.stats() : null;
      if (!h || !h.length) return '—';
      var okn = 0, pend = 0;
      for (var i = 0; i < h.length; i++) {
        if (h[i] && h[i].ok === true) okn++;
        else if (h[i] && h[i].ok === null) pend++;
      }
      /* 还没拉完第一轮 → 别显示成「0/10 源」吓人 */
      if (!s || !s.raw) return pend ? '连接中…' : (okn + '/' + h.length + ' 源 · 无数据');
      return okn + '/' + h.length + ' 源 · ' + s.shown + ' 条';
    } catch (e) { return '—'; }
  }

  /* ---------------- 关于・素材授权 ---------------- */
  var abt = null;
  function openAbout() {
    if (!abt) {
      abt = el('div', '', { id: 'qvabout' });
      /* ★★★ 2026-10-25 按 GitHub 实际查证结果补全（用户：「去 SREV Github 查一下他的开源许可」）：
         · 仓库 kotoho7/scratch-realtime-earthquake-viewer-page
           GitHub API `license: null`，仓库里**没有 LICENSE 文件**（raw LICENSE 404）
           ⇒ 程序代码**未声明开源许可**，版权保留；不能写成 MIT/Apache/开源。
         · README 明写：`/docs/assets` 里的图像・音声（因为项目在 Scratch 共享）
           是 **CC BY-SA 2.0** —— 这才是可以合法复用的部分（需署名 + 相同方式共享）。
         · terms.md（v1.6 起）：禁止以其服务以外的方式访问其内部 API
           ⇒ 本版不连接原作者服务器，改用公开数据源。
         · README「緊急地震速報の注意事項」：深さ 150km より深い地震では
           予想最大震度は発表されない（本版深源「震度不明」就是照这条做的）。 */
      abt.innerHTML =
        '<div class="box"><h3>ZQuake模拟器 v' + APP_VER + ' - bata</h3>' +
        '<p>ZQuake模拟器 — 地震速报模拟器（仅本地模拟，不接入任何真实数据源）</p>' +
        '<p><b>与 SREV 的关系（重要）</b></p>' +
        '<ul>' +
        '<li>本项目<b>只使用了 SREV 公开素材中的一部分</b>（界面图形 / 地图分块 / 音效，' +
        '<b>CC BY-SA 2.0</b>）；其余界面拼装、字体渲染、地图瓦片合成均为自行实现。</li>' +
        '<li><b>后端全部自研</b>：数据接入与解析（Wolfx / DM-D.S.S / 气象厅 / 中国地震台网 / USGS）、' +
        '震度推算（司・翠川 GMPE + 深源修正 + 異常震域 + Vs30）、EEW 模拟时间轴、IPF 震源反演、' +
        'Okada 海啸模型、DM 电文中转服务 — 均为本项目独立编写，' +
        '<b>未使用原作的任何服务端代码或内部接口</b>。</li>' +
        '</ul>' +
        '<p><b>素材授权（CC BY-SA 2.0，务必保留署名）</b></p>' +
        '<ul>' +
        '<li>界面图形（SVG 造型 / 地图分块）与音效：取自原作 <code>docs/assets</code>，' +
        '<b>CC BY-SA 2.0</b></li>' +
        '<li>原作：<code>github.com/kotoho7/scratch-realtime-earthquake-viewer-page</code>' +
        '（README 明写 docs/assets 的画像・音声为 CC BY-SA 2.0）</li>' +
        '<li>协议全文：<code>creativecommons.org/licenses/by-sa/2.0/</code></li>' +
        '</ul>' +
        '<p><b>程序代码</b></p>' +
        '<ul>' +
        '<li>原作仓库<b>未声明开源许可证</b>（GitHub 未检测到 LICENSE 文件，license 字段为空），' +
        '代码版权归原作者所有。</li>' +
        '<li>本项目为<b>独立实现</b>：只参考界面布局与公开机制说明，未复制其程序代码。</li>' +
        '</ul>' +
        '<p><b>地图 / 字体 / 音效</b></p>' +
        '<ul>' +
        '<li>气象厅 预报区 GIS / 国土数値情報 / Natural Earth / NOAA ETOPO</li>' +
        '<li>字体：BIZ UDPGothic・Akshar（SIL Open Font License 1.1）</li>' +
        '<li>音效参考：OtoLogic（ニューステロップ）</li>' +
        '</ul>' +
        '<p><b>使用条款</b></p>' +
        '<ul>' +
        '<li>本版<b>不连接</b>原作者的任何服务器（clouddata-srev.kothn.net 等），' +
        '遵守原作 terms.md「禁止以其服务以外方式访问内部 API」。</li>' +
        '<li>仅供个人学习与非商业使用。地震・海啸情报仅供参考，' +
        '<b>不能替代官方发布，不可用于避险决策</b>。</li>' +
        '</ul>' +
        '<p style="color:#8ea3b8;font-size:13px">完整清单见程序目录 <code>LICENSE-ASSETS.txt</code>。' +
        '再分发时必须保留本说明与 CC BY-SA 2.0 的署名。</p>' +
        '<div class="btns"><button id="qvaboutclose">关闭</button></div></div>';
      document.body.appendChild(abt);   /* ★ 同上：脱离 #stage 的 scale，fixed 全屏 */
      abt.addEventListener('click', function (e) { if (e.target === abt) abt.className = ''; });
      abt.querySelector('#qvaboutclose').addEventListener('click', function () { abt.className = ''; });
    }
    abt.className = 'on';
  }

  /* ---------------- ★★ 切换星球（地球 / 月球 / 火星） ----------------
   * 用户要求（2026-11-03）：「在设置→其他加一个切换星球，点击切换星球，
   *   整个地图和算法就直接换成其他星球的就行了」。
   * · 地图：由 planet.js 的 #planetlayer 铺一张预投影好的 Mercator 全球图
   *   （dev/planet-merc.py 生成，与 mapX/mapY 同一套坐标系，零投影改动）
   * · 算法：震级上限、震动时长按该天体的真实地震学数据走（见 planet.js 的 BODIES 表）
   * ⚠️ 只新增模式：切回「地球」时瓦片层原样打开，一行都没有改。
   */
  var plk = null;
  function openPlanetPicker() {
    if (!plk) {
      plk = el('div', '', { id: 'qvplanet' });
      plk.innerHTML =
        '<div class="box">' +
        '<h3>切换星球</h3>' +
        '<p class="pnote">地图和烈度算法整站切换。切回「地球」即恢复实时地震数据与日本/世界地图。</p>' +
        '<div class="plist" id="qvplist"></div>' +
        '<div class="pseg" id="qvpseg"><span class="seglab">烈度表现</span>' +
        '<button data-ov="station">测站</button>' +
        '<button data-ov="ring">等震环</button><button data-ov="hex">六边形</button></div>' +
        '<div class="pseg" id="qvpspd"><span class="seglab">模拟加速</span>' +
        '<button data-spd="1">1×</button><button data-spd="10">10×</button>' +
        '<button data-spd="100">100×</button><button data-spd="1000">1000×</button></div>' +
        '<div class="btns"><button id="qvplanetclose">关闭</button></div>' +
        '</div>';
      document.body.appendChild(plk);
      plk.addEventListener('click', function (e) { if (e.target === plk) plk.className = ''; });
      plk.querySelector('#qvplanetclose').addEventListener('click', function () { plk.className = ''; });
      plk.querySelectorAll('#qvpseg button[data-ov]').forEach(function (b) {
        b.addEventListener('click', function () {
          var P = global.QVPlanet; if (!P) return;
          P.setOverlay(b.dataset.ov);
          renderPlanetList();
          toast(b.dataset.ov === 'hex' ? '烈度表现：六边形网格'
            : b.dataset.ov === 'ring' ? '烈度表现：等震环'
              : '烈度表现：测站圆标');
        });
      });
      plk.querySelectorAll('#qvpspd button[data-spd]').forEach(function (b) {
        b.addEventListener('click', function () {
          var P = global.QVPlanet; if (!P || !P.setSpeed) return;
          var k = P.setSpeed(+b.dataset.spd);
          renderPlanetList();
          toast(k > 1 ? '模拟加速 ×' + k + '（火星一场主震真实要 4~5 小时）' : '模拟加速已关闭（真实速度）');
        });
      });
    }
    renderPlanetList();
    plk.className = 'on';
  }
  function renderPlanetList() {
    var box = plk && plk.querySelector('#qvplist');
    if (!box) return;
    var P = global.QVPlanet;
    if (!P) { box.textContent = '天体模块未加载'; return; }
    var curKey = P.current();
    box.textContent = '';
    ['earth', 'moon', 'mars'].forEach(function (k) {
      var b = P.BODIES[k];
      var meta;
      if (k === 'earth') meta = '实时地震数据 · SREV 地图瓦片';
      else {
        meta = '有记录以来最强 ≈ M' + b.magMax + '　·　' + b.depthHint +
          '　·　最长摇晃 ' + b.durText(b.magMax);
      }
      var card = el('div', '');
      card.className = 'pcard' + (k === curKey ? ' on' : '');
      card.dataset.k = k;
      var n = el('div', ''); n.className = 'pn'; n.textContent = b.name;
      var m = el('div', ''); m.className = 'pm'; m.textContent = meta;
      card.appendChild(n); card.appendChild(m);
      if (k !== 'earth') {
        var dot = el('span', ''); dot.className = 'pdot';
        dot.style.background = b.accent;
        n.insertBefore(dot, n.firstChild);
      }
      card.addEventListener('click', function () { pickPlanet(k); });
      box.appendChild(card);
    });
    /* 「烈度表现」只在天体模式才有意义（地球走地级市色块） */
    var seg = plk.querySelector('#qvpseg');
    if (seg) {
      seg.style.display = P.isPlanet() ? '' : 'none';
      var curOv = P.overlay();
      seg.querySelectorAll('button[data-ov]').forEach(function (b) {
        b.className = (b.dataset.ov === curOv) ? 'on' : '';
      });
    }
    var spd = plk.querySelector('#qvpspd');
    if (spd) {
      spd.style.display = P.isPlanet() ? '' : 'none';
      var curSpd = P.speed ? P.speed() : 1;
      spd.querySelectorAll('button[data-spd]').forEach(function (b) {
        b.className = (+b.dataset.spd === curSpd) ? 'on' : '';
      });
    }
  }
  function pickPlanet(k) {
    var P = global.QVPlanet;
    if (!P) return;
    P.setBody(k);
    var b = P.body(k);
    renderPlanetList();
    toast(k === 'earth'
      ? '已切回「地球」'
      : '已切换到「' + b.name + '」：' + b.quake + '模拟，震级上限 M' + b.magMax);
  }

  /* ---------------- ★★ 模拟设置（自制：注入假数据，用来玩 + 测功能） ----------------
   * 用户要求：设置页「配色・音效自定义」下面单独一个按钮「模拟设置」→
   *           弹一个同风格的模态框，自己填地震 / 海啸的模拟数据。
   * 实现要点：
   *   · 地震走 QData.inject(q)（和 WebSocket 推送同一条路）→ 主卡/履历/地图全都会跟着动
   *   · 海啸走 QData.simTsunami(obj)（data.js 里的模拟钩子，refresh 不会把它冲掉）
   *   · 区域行按官方字段填：区域码,名称,等级,预计高度,首波条件,到达分钟偏移
   *     —— 「预计高度」决定组头用 paNp5/6/7/8/9/3t/4t，「首波条件」决定到达胶囊 paNt**
   */
  var sim = null;
  var simLL = null;       /* 地图点选的震源 [lat, lon] */
  /* ★★★ 2026-10-26 用户：「在模拟环境里加一个自定义时间…只模拟这个时间段」
     > 0 = 启用了自定义时间（ms）；同时 QData.freeze(true) + clearAll() 已生效 */
  var simTimeMs = 0;
  /** 解析自定义时间：支持 2026/08/09/06:04:55、2026-08-09 06:04:55、20260809060455、202608090604
      做法：先把非数字全去掉再看位数（年份 4 位，秒可省）→ 本地时区。 */
  function parseSimTime(s) {
    s = String(s || '').trim();
    if (!s) return null;
    var d = s.replace(/\D/g, '');
    var y, mo, da, h, mi, se = 0;
    if (d.length === 14) {
      y = +d.slice(0, 4); mo = +d.slice(4, 6); da = +d.slice(6, 8);
      h = +d.slice(8, 10); mi = +d.slice(10, 12); se = +d.slice(12, 14);
    } else if (d.length === 12) {
      y = +d.slice(0, 4); mo = +d.slice(4, 6); da = +d.slice(6, 8);
      h = +d.slice(8, 10); mi = +d.slice(10, 12);
    } else if (d.length === 8) {
      y = +d.slice(0, 4); mo = +d.slice(4, 6); da = +d.slice(6, 8); h = 0; mi = 0;
    } else return null;
    if (!(y >= 1900 && y <= 2200) || !(mo >= 1 && mo <= 12) || !(da >= 1 && da <= 31)) return null;
    if (!(h >= 0 && h <= 23) || !(mi >= 0 && mi <= 59) || !(se >= 0 && se <= 59)) return null;
    var ms = new Date(y, mo - 1, da, h, mi, se).getTime();
    return isFinite(ms) ? ms : null;
  }
  function fmtSimTime(ms) {
    var d = new Date(ms);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + '/' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  var simPick = false;    /* 正在等待用户点地图选震源 */
  var simTimer = 0;       /* 倒计时 timer */
  var simCountEl = null;  /* 倒计时显示 */
  /* ★★★ 2026-10-28 用户：「在地震的开始页面加一个滑块，叫发报频率调节，默认/快速/密集」
     →「改成 不发报，默认，快速，密集」
     0 = 不发报（只发首报，之后不再发续报）｜1 = 默认（真实节奏）
     2 = 快速（约 3 倍）｜3 = 密集（全程密集报文）
     ⚠️ 只影响【模拟】续报的间隔/要不要发，不改任何震度/海啸算法。 */
  var simRate = 1;

  /* ---- ① 点地图选震源（不再让红叉跟着鼠标吸附） ---- */
  function stagePoint(e) {
    var st = document.getElementById('stage');
    if (!st) return [0, 0];
    /* ★★★ 2026-10-20 修「地图选点偏移」（用户本日最优先问题）：
       旧代码 s = rect.width / 960 —— 960 只是【设计尺寸】，layout() 会把舞台逻辑宽
       拉大到 ceil(窗口宽/s)，16:9 的 1920 窗口是 1330、1440 窗口是 1152。
       于是算出的舞台坐标 = 真实值 × 960/LW（≈0.72~0.83）→ 点哪儿都比真位置
       更靠【左上】，越往右下错得越多（满屏时右下幕错 400+ 逻辑像素）。
       正解：分母用 offsetWidth（布局逻辑宽，不吃 transform），两个尺寸相除才是纯缩放比。 */
    var r = st.getBoundingClientRect();
    var s = st.offsetWidth ? (r.width / st.offsetWidth) : 1;
    if (!s) s = 1;
    return [(e.clientX - r.left) / s, (e.clientY - r.top) / s];
  }
  function endSimPick() {
    simPick = false;
    var st = document.getElementById('stage');
    if (st) st.style.cursor = '';
  }
  function startSimPick() {
    if (simTimer) { toast('倒计时进行中（Esc 可取消）'); return; }
    if (sim && sim.className === 'on') sim.className = '';
    /* ★★ 2026-11-03 天体模式：跳过「点地图选震源」这一步，直接用当前视图中心。
       行星上那一步一旦没接上（实测点地图不生效），用户看到的就是
       「点地震模拟什么都没发生」。 */
    if (global.QVPlanet && global.QVPlanet.isPlanet() && global.QVMapCam && QVMapCam.latLonAt) {
      var mid = QVMapCam.latLonAt(600, 388);
      if (mid) { simLL = mid; openSim(mid); return; }
    }
    var st = document.getElementById('stage');
    /* 只挂一次：click 捕获阶段处理「点地图 = 定震心」。
       左键拖动地图（位移 > 8px）不算点选；左侧面板区（x < 290）也不是地图。 */
    if (st && !st.dataset.simHook) {
      st.dataset.simHook = '1';
      var down = null;
      st.addEventListener('mousedown', function (e) { down = [e.clientX, e.clientY]; }, true);
      st.addEventListener('click', function (e) {
        if (!simPick) return;
        if (down && (Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]) > 8)) return;
        var p = stagePoint(e);
        if (p[0] < 290) return;
        if (!global.QVMapCam || !global.QVMapCam.latLonAt) return;
        var ll = global.QVMapCam.latLonAt(p[0], p[1]);
        if (!ll) { toast('这个位置没有地图数据'); return; }
        simLL = ll;
        endSimPick();
        openSim(ll);
        e.preventDefault();
        e.stopPropagation();
      }, true);
    }
    simPick = true;
    if (st) st.style.cursor = 'crosshair';
    toast('请在地图上点击选择模拟震源（按 Esc 取消）');
  }

  /* ---- ② 倒计时 ---- */
  function countEl() {
    var st = document.getElementById('stage');
    if (!st) return simCountEl || null;
    /* ★ 2026-10-25：以前只看模块变量 `simCountEl`，只要缓存里没有就【新建】一个。
       万一页面上已经存在一个 #qvsimcount（调试手插、热重载、重复调用），
       就会出现两个同 id 元素：`getElementById` 拿到的是先出现的那个（永远不会更新），
       模块变量握着的是后建的那个 → 屏幕上看到「卡在 4 秒」。所以先认领已存在的那个。 */
    if (!simCountEl) {
      var exist = document.getElementById('qvsimcount');
      if (exist && exist.parentNode === st) simCountEl = exist;
    }
    if (simCountEl && simCountEl.parentNode === st) return simCountEl;
    /* 兜底：把手插进来的重复元素全部清掉，只留自己这一个 */
    var dup = st.querySelectorAll('#qvsimcount');
    for (var i = 0; i < dup.length; i++) if (dup[i] !== simCountEl) dup[i].remove();
    if (!simCountEl) {
      simCountEl = el('div', '', { id: 'qvsimcount' });
      simCountEl.innerHTML = '<b>0</b><span>秒后开始模拟</span><em>按 Esc 取消</em>';
    }
    st.appendChild(simCountEl);
    return simCountEl;
  }
  function showCount(n) {
    var c = countEl();
    if (!c) return;
    c.className = 'on';
    c.querySelector('b').textContent = String(n);
    c.querySelector('span').textContent = '秒后开始模拟';
  }
  /** ★★★ 2026-10-25 用户：「右上角那个模拟画面去掉，平常那里显示的是数据源，
     模拟地震的时候就把数据源换成『模拟数据』四个字」
     ⇒ 倒计时结束后**直接隐藏徽标**（不再挂「模拟画面」），改由 render3 的数据源文字接管。 */
  function simBadgeRun() {
    var c = countEl();
    if (!c) return;
    c.className = '';
  }
  function cancelSim(silent) {
    if (simTimer) { clearInterval(simTimer); simTimer = 0; }
    endSimPick();
    if (simCountEl) simCountEl.className = '';
    if (sim && sim.className === 'on') sim.className = '';
    /* 取消/关闭 → 撤掉「预览红叉」，回到选中地震的红叉 */
    if (global.QVMapCam && QVMapCam.lockPin) QVMapCam.lockPin(null);
    /* ★ 检测态/模拟遗留：框、波圆、红叉、测站、区域震度标记全部清掉 */
    if (global.QVMapCam && QVMapCam.setBoxes) QVMapCam.setBoxes(null);
    if (global.QVMapCam && QVMapCam.stopSimWave) QVMapCam.stopSimWave();
    if (global.QVMapCam && QVMapCam.setPins) QVMapCam.setPins([]);
    if (global.QVShindo && global.QVShindo.clearPoints) global.QVShindo.clearPoints();
    if (global.QVShindo && global.QVShindo.set) global.QVShindo.set([]);
    if (global.QVMapCam && QVMapCam.setAreaFill) QVMapCam.setAreaFill(null);
    /* 同时也清掉 EEW 模拟页 / 测站点 */
    eewTimers.forEach(function (t) { clearTimeout(t); }); eewTimers = [];
    simAuxClear();
    V.eew = null;
    hideDetCircle();
    V.simOn = 0;
    V.simEtaMs = 0;
    /* 自定义时间模拟结束 → 顶部时钟回到系统时间 */
    V.simTimeBase = 0;
    V.simTimeStart = 0;
    eewScroll = 0;
    if (global.QVMapCam && QVMapCam.clearStations) QVMapCam.clearStations();
    /* ★ 2026-10-26 自定义时间模拟：取消模拟 = 解除冻结 + 清掉时间框，恢复正常数据流 */
    try {
      var tEl = (sim && sim.querySelector) ? sim.querySelector('#simTime') : null;
      if (tEl) tEl.value = '';
      if (simTimeMs && global.QData) {
        simTimeMs = 0;
        if (QData.freeze) QData.freeze(false);
        if (QData.refresh) QData.refresh();
      }
    } catch (eT) { }
    if (global.QVRedraw) QVRedraw();
    if (!silent) toast('已取消模拟');
  }
  /* ══════ 2026-10-22 模拟：海啸预警自动判定（用户给的规则）══════
   * 用户：「如果这个地方不是在内陆很深，而是在海边城市或者直接在海里面，
   *        同时规模非常大、深度也不是很深的，应该让系统来模拟地震预警」
   * 数据：
   *   中国 = window.QV_CN_AREAS（地级市多边形 {c,n,b:[minx,miny,maxx,maxy],p:["lon,lat …"]}）
   *   日本 = window.QV_SHINDO_AREAS（JMA 细分区域 areas[code].p = [[lon,lat,…],…]）
   * 做法：bbox 预筛 → 点在多边形内；在陆地内再算到边界的最近距离（顶点距离近似）。
   * 海里面（不在任何陆地多边形内）⇒ 位置条件天然满足（官方海域地震也会发海啸）。
   */
  var SIM_LAND = null;
  var SIM_TSU = { minMag: 7.0, maxDep: 60, inlandKm: 30 };
  /* ★★★ 2026-10-26 用户：「为什么内陆地区发生地震，海啸不在最近的海岸线的方向，
     反而是在反面？」—— 两个毛病：
     ① 内陆 80km 也能发海啸（陆上的 M9.9 不会产生海啸，只有海底扰动才会）；
     ② 方向算错：`simCoastAzimuth()` 找「最近陆地」，而内陆震源最近的陆地就是**自己**
        → 永远返回方位 0（正北），于是不管震源在哪，「海啸」都朝正北发（就是用户说的反面）。
     ⇒ 内陆阈值收到 30km（只有河口/海岸线上的震源才算），
        并且 simCoastAzimuth 在陆地点上直接返回 null，改用 simSeaAzimuth 指向最近海域。 */
  function simKm(lat1, lon1, lat2, lon2) {
    var p = Math.PI / 180;
    var dy = (lat2 - lat1) * 111.19;
    var dx = (lon2 - lon1) * 111.19 * Math.cos((lat1 + lat2) * 0.5 * p);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function simRingOf(str) {                 /* "lon,lat lon,lat …" → [lon,lat,…] */
    var out = [], a = String(str).split(' ');
    for (var i = 0; i < a.length; i++) {
      var t = a[i].split(',');
      if (t.length >= 2) out.push(+t[0], +t[1]);
    }
    return out;
  }
  function simLandIndex() {
    if (SIM_LAND) return SIM_LAND;
    var idx = [];
    (global.QV_CN_AREAS || []).forEach(function (a) {
      if (a && a.b && a.p) idx.push({ b: a.b, raw: a.p, rings: null, name: a.n });
    });
    var SA = global.QV_SHINDO_AREAS;
    if (SA && SA.areas) {
      Object.keys(SA.areas).forEach(function (k) {
        var p = SA.areas[k] && SA.areas[k].p;
        if (!p || !p.length) return;
        var minx = 999, miny = 999, maxx = -999, maxy = -999;
        for (var r = 0; r < p.length; r++) {
          var ring = p[r];
          for (var i = 0; i + 1 < ring.length; i += 2) {
            var x = ring[i], y = ring[i + 1];
            if (x < minx) minx = x; if (x > maxx) maxx = x;
            if (y < miny) miny = y; if (y > maxy) maxy = y;
          }
        }
        if (minx !== 999) idx.push({ b: [minx, miny, maxx, maxy], rings: p, name: k });
      });
    }
    SIM_LAND = idx;
    return idx;
  }
  function simPip(ring, lon, lat) {
    var inside = false;
    for (var i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      var xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
      if (((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }
  /** 点是否落在陆地多边形内（中国地级市 + 日本细分区域） */
  function simIsLand(lon, lat) {
    var idx = simLandIndex();
    for (var k = 0; k < idx.length; k++) {
      var a = idx[k], b = a.b;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      if (!a.rings) {
        a.rings = [];
        for (var r = 0; r < a.raw.length; r++) {
          var ring = typeof a.raw[r] === 'string' ? simRingOf(a.raw[r]) : a.raw[r];
          if (ring && ring.length >= 6) a.rings.push(ring);
        }
      }
      for (var i = 0; i < a.rings.length; i++) if (simPip(a.rings[i], lon, lat)) return a.name || true;
    }
    return false;
  }
  /** 到最近海域的距离（km）—— 陆地内向外打 16 条射线，步长 15km，最远 240km。
   *  ⚠️ 不能用「到多边形边界的距离」：那是**行政边界**（西安市界距市中心也才 9km），
   *     会把内陆城市当成海边。必须真的找到「不在任何陆地多边形内」的点。
   *  ⚠️ 数据是手工拼的市界，城市之间有**缝隙** → 一条射线可能半路钻进缝里，
   *     把西安误判成「距海 60km」。所以发现疑似海后要沿同方向再确认 100km 仍无陆地，
   *     才认它是一片真海（缝隙只有几公里宽，100km 内必定又碰到陆地）。 */
  function simDistToSea(lat, lon) {
    var dirs = 16, step = 15, maxR = 240, confirm = 105;
    var cosL = Math.cos(lat * Math.PI / 180) || 1;
    var best = maxR;
    for (var d = 0; d < dirs; d++) {
      var ang = d * Math.PI * 2 / dirs;
      var ux = Math.sin(ang) / (111.19 * cosL), uy = Math.cos(ang) / 111.19;
      for (var r = step; r < best; r += step) {
        if (simIsLand(lon + ux * r, lat + uy * r)) continue;
        var sea = true;
        for (var c = step; c <= confirm; c += step) {
          if (simIsLand(lon + ux * (r + c), lat + uy * (r + c))) { sea = false; break; }
        }
        if (sea) { best = r; break; }
      }
    }
    return best;
  }
  /** 震源地形：{ inLand, coastKm } —— 海里 ⇒ inLand=false；陆地内 ⇒ 到海最近距离(km) */
  function simTerrain(lat, lon) {
    var land = simIsLand(lon, lat);
    if (!land) return { inLand: false, coastKm: 0, area: '' };
    return { inLand: true, coastKm: simDistToSea(lat, lon), area: (typeof land === 'string' ? land : '') };
  }
  /** 返回不发布海啸的理由（空串 = 可以发） */
  function simTsuVeto(q, terr) {
    if (terr.inLand && terr.coastKm > SIM_TSU.inlandKm) {
      return '震源在内陆（距海岸约 ' + Math.round(terr.coastKm) + ' km），不会引发海啸';
    }
    if (q.mag < SIM_TSU.minMag) return '规模不足（需 M ≥ ' + SIM_TSU.minMag.toFixed(1) + '）';
    if (q.depthKm > SIM_TSU.maxDep) return '深度过深（需 ≤ ' + SIM_TSU.maxDep + ' km）';
    return '';
  }
  /** 某点周围 km 内是否有海（8 方向各一点）—— 用来筛「沿海城市」 */
  function simNearSea(lat, lon, km) {
    var cosL = Math.cos(lat * Math.PI / 180) || 1;
    for (var d = 0; d < 8; d++) {
      var a = d * Math.PI * 2 / 8;
      var x = lon + Math.sin(a) * km / (111.19 * cosL);
      var y = lat + Math.cos(a) * km / 111.19;
      if (!simIsLand(x, y)) return true;
    }
    return false;
  }
  /** 震源→区域的海路是否被陆地挡住（沿途密集抽样，陆地占比过高就算不可达）。
   *  ★ 2026-10-22 用户：「你这范围是不是大的有点离谱了？北海道到京都府？一整个日本？？」
   *    —— 半径筛选只能保证「距离不够」，但海啸只影响【朝向震源那一侧的海岸】：
   *       日本海中部的地震，太平洋侧被本州陆地挡着，就算 500km 内也不会有海啸。
   *    ⇒ 震源到区域的连线上抽样，碰到陆地就丢掉（中转被陆地遮挡）。
   *  ★★★ 2026-10-25 用户：「东京内湾的地震为什么中国会有，你这个海啸完全不看有没有陆地挡住」
   *    —— 以前 simTsuAreas 里加了 `d < 900` 的豁免：超过 900km 干脆不查遮挡，
   *       于是东京湾 → 上海这条线横穿整个本州也照样发布中国沿岸。
   *    ⇒ ① 取消距离豁免，**所有距离都查**；
   *       ② 抽样从固定 9 点改成「每 ~25km 一点」，长路径才看得见日本列岛/半岛的遮挡；
   *       ③ 判据从「过半是陆地」放宽成「陆地占比 ≤ 12%」，小岛/海角擦边不算挡。
   *    （局限：陆地数据只有日本 + 中国行政区面，经过朝鲜半岛/台湾的路径按海处理。） */
  function simSeaPath(lat1, lon1, lat2, lon2) {
    /* ★★★ 2026-11-03 用户给了三条路，选【流派二：射线遮挡 LoS】，并按他给的两个坑修到位：
       坑 1「墨卡托上画直线，几百公里就错得离谱」→ 路径改用**大圆**采样（每 ~100km 一点），
            每一小段再在图集坐标里求交（100km 内投影误差可忽略）。实现在 coast-base.pathInfo。
       坑 2「海啸会绕过岛屿/半岛（东京湾那次就是绕过房总）」→ 见 simTsuAreas 的第二轮
            「次级震源」：直接不通的，用一个已经通的沿岸区做中转再判一次。
       几何没准备好时退回旧的撒点法。 */
    if (global.QVCoastBase && QVCoastBase.pathInfo) {
      var pi = QVCoastBase.pathInfo(lat1, lon1, lat2, lon2);
      if (pi && pi !== -1) return pi.ok;
    }
    var km = simKm(lat1, lon1, lat2, lon2);
    var n = Math.max(10, Math.min(200, Math.round(km / 25)));
    var land = 0;
    for (var i = 1; i < n; i++) {
      var t = i / n;
      if (simIsLand(lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t)) land++;
    }
    var allow = Math.max(1, Math.floor(n * 0.12));
    return land <= allow;
  }
  /** 震源是否在「半封闭水域」（内湾 / 海峡）：向外 16 个方向各打一条射线，
   *  看 100km 内能不能碰到陆地；12 个以上方向都碰陆地 ⇒ 内湾（东京湾、伊势湾、骏河湾…）。
   *  ★★★ 2026-10-25 用户：「东京内湾的地震为什么中国会有」
   *    —— 内湾里的大断层其实放不下，海啸能量也几乎全被湾口卡住，
   *       真实气象厅只会发湾内/邻近沿岸；不会远渡 2200km 发到中国。
   *    ⇒ 内湾地震只留近场（≤ ~320km）。开阔海域（三陸沖/日向灘/日本海中部）不受影响。 */
  function simConfined(lat, lon) {
    var dirs = 16, step = 12, maxR = 100, hit = 0;
    var cosL = Math.cos(lat * Math.PI / 180) || 1;
    /* ★ 2026-11-03：同样改用 LoS——每个方向连到 100km 外，穿过海岸线 ≥1 次就当撞陆地。
       旧法 simIsLand() 只认日本+中国行政区面，海外一律当海，内湾判定其实只对日本有效。 */
    var useLoS = !!(global.QVCoastBase && QVCoastBase.crossings);
    for (var d = 0; d < dirs; d++) {
      var ang = d * Math.PI * 2 / dirs;
      var ux = Math.sin(ang) / (111.19 * cosL), uy = Math.cos(ang) / 111.19;
      if (useLoS) {
        var cr2 = QVCoastBase.crossings(lat, lon, lat + uy * maxR, lon + ux * maxR);
        if (cr2 && cr2 !== -1) { if (cr2.n >= 1) hit++; continue; }
        useLoS = false;                       /* 几何没好 → 整个循环退回旧法 */
      }
      for (var r = step; r <= maxR; r += step) {
        if (simIsLand(lon + ux * r, lat + uy * r)) { hit++; break; }
      }
    }
    return hit >= 12;
  }
  /** 自动生成沿岸区域：日本用【JMA 津波予報区表】（tsu-areas.js，68 个沿岸区段），
   *  中国用 QV_CN_AREAS 沿海地级市；统一按「震源距 ≤ maxKm」筛选。
   *  ★ 2026-10-22 用户：「一个注意报在这个等级下基本都大半个日本了，你这就几个市？」
   *    ⇒ 不再只取最近几个测站，而是按真实沿岸区段铺开（M8 级半径 1500~2200km）。 */
  function simTsuAreas(lat, lon, maxKm) {
    var out = [], i, lim = maxKm || 600;
    /* 内湾（东京湾这类）→ 只发近场，不发远场 */
    var confined = simConfined(lat, lon);
    var limEff = confined ? Math.min(lim, 320) : lim;
    /* ★★ 2026-10-25 用户：「既然我们是全球通 SREV，那为什么海岸线和其他数据
       一定要区分国家呢？」→ 以前这里有一个 `isJP` 分支：震源在日本就只查日本 66 个
       津波予報区，在别处就只查中国地级市 → 三陸沖 M9 永远不会给中国沿岸发布。
       现在统一：只用 QV_TSU_AREAS 这一份沿岸区表（日本 + 中国 + 以后加的任何国家）。 */
    var TA = global.QV_TSU_AREAS || [];
    var direct = [], blocked = [], i2;
    for (i = 0; i < TA.length; i++) {
      var d = simKm(lat, lon, TA[i].lat, TA[i].lon);
      if (d > limEff) continue;
      var item = { d: d, name: TA[i].n, code: TA[i].c, lat: TA[i].lat, lon: TA[i].lon };
      if (d <= 60 || simSeaPath(lat, lon, TA[i].lat, TA[i].lon)) direct.push(item);
      else blocked.push(item);
    }
    /* ★★★ 2026-11-03 坑 2「海啸会绕过岛屿/半岛」：
       直接海路被挡 ≠ 一定到不了。波会在被挡住的岸边衍射过去（东京湾那次就是绕房总）。
       ⇒ 次级震源：给每个被挡的目标，找一个**已经通的沿岸区**当中转点，再判第二段海路。
         中转点挑法 = 离「这条被挡路径的中点」最近的那个直通区域（最多试 3 个）。
       这样：三陸沖 → 上海（直线横穿本州被挡）→ 经房総/室戸中转 → 第二段是开阔的东海 → 放行；
             东京湾震源 → 被 simConfined() 卡在 320km 内，根本走不到这一步。 */
    var viaUsed = 0;
    if (blocked.length && direct.length && global.QVCoastBase && QVCoastBase.gcKm) {
      for (var b = 0; b < blocked.length; b++) {
        var tg = blocked[b];
        /* 中转点挑法：在**已经通的**区域里，按「离目标最近」排序。
           ⚠️ 试过按「离路径中点最近」——三陸沖→上海 的路径中点在**日本本土正上方**，
              排在最前的全是日本海侧，全都过不去。按「离目标最近」就能先拿到冲绳/室戸这类
              太平洋侧、且到东海一侧开阔的点 —— 这才是真实的绕射路线。 */
        var order = direct.map(function (a) {
          return { a: a, md: QVCoastBase.gcKm(a.lat, a.lon, tg.lat, tg.lon) };
        }).sort(function (x, y) { return x.md - y.md; });
        var tried = 0;
        for (var oi = 0; oi < order.length && tried < 8; oi++) {
          var h = order[oi].a;
          /* 中转点必须比目标更靠近震源，否则「绕远」就成乱发了 */
          if (h.d >= tg.d) continue;
          tried++;
          var leg1 = QVCoastBase.pathInfo(lat, lon, h.lat, h.lon);
          var leg2 = QVCoastBase.pathInfo(h.lat, h.lon, tg.lat, tg.lon);
          if (leg1 && leg1 !== -1 && leg1.ok && leg2 && leg2 !== -1 && leg2.ok) {
            tg.via = h.name;
            direct.push(tg);
            viaUsed++;
            break;
          }
        }
      }
    }
    out = direct;
    V._tsuVia = viaUsed;      /* 调试：几处是靠「次级震源」才通的 */
    out.sort(function (a, b) { return a.d - b.d; });
    return out.slice(0, 100);     /* 上限只防极端情况 */
  }
  /* ══════ 2026-10-22 海啸物理模型（Okada 1985 + Green's law）══════
   * 链条：
   *   ① 由 M 反推断层几何（Wells & Coppersmith 1994）：
   *        log₁₀L = 0.59M − 2.44 · log₁₀W = 0.41M − 1.61 · log₁₀D = 0.69M − 4.80
   *   ② 海底垂直位移 η₀ = 真·Okada(1985) 弹性半空间矩形位错解 uz(x,y)
   *        （见下方 OKADA 模块；DC3D 全套 ua/ub/uc + dccon0/dccon2 移植）
   *   ③ 传播（几何扩散）：线源圆柱扩散能量守恒 ⇒ η ∝ 1/√r，参考尺度取断层半长
   *   ④ 方向性 |cosθ|^1.5（θ = 区域方位 − 断层法向）—— 日本海地震不会传到太平洋侧
   *   ⑤ 近岸浅水放大 = Green's law：η ∝ h^(−1/4)
   *        η_coast = η_deep · (h_deep / h_shelf)^(1/4)
   *        h_deep = 4000 m（深海沟底面）→ h_shelf = 400 m（陆架坡折）
   *        ⇒ ×(4000/400)^(1/4) ≈ 1.78（再往岸上爬的 run-up 不计入予報波高）
   *   ⑥ 走时 = r / √(g·h̄)，h̄=4000m ⇒ 198 m/s（≈713 km/h）
   *   ⑦ JMA 阈值定级：≥6m 大津波10m / ≥3m 大津波3m / ≥1m 津波警報 / ≥0.2m 注意報
   */
  var SIM_TSU_PHY = { seaDepth: 4000, shelfDepth: 400, minH: 0.2 };
  /** Green's law 浅水放大系数 (h_deep/h_shelf)^(1/4) */
  var SIM_TSU_SHOAL = Math.pow(SIM_TSU_PHY.seaDepth / SIM_TSU_PHY.shelfDepth, 0.25);
  /* ★★★ 2026-10-26 中国近海陆架水深（用户：「海啸模拟对比：我们有轻微海面变动 / 实际 5-7m」）
     真因不是震源，是陆架深度：Green's law 放大 = (h_深海/h_陆架)^(1/4)。
       · 日本海沟型海岸：陆架坡折 ~400m → ×1.78
       · 中国近海：世界上最浅的陆架之一
           渤海 ~20m（×3.76）｜黄海 40~60m（×2.9）｜东海 70~100m（×2.4）
           台湾海峡/粤东 30m（×3.4）｜南海北部 60m（×2.9）
     同一份 Okada 初始水位，到中国岸边就是比日本高 1.6~2.1 倍 ——
     这才对得上 1918 南澳 M7.3「南澳/汕头沿海浪高 5~7m」的记录。
     ⚠️ 只改放大系数，不动断层几何与方向性。 */
  function simShelfDepth(lat, lon) {
    if (!(global.QVCNGM && QVCNGM.inChina(lat, lon))) return SIM_TSU_PHY.shelfDepth;
    if (lat >= 38 && lon <= 123) return 20;                             /* 渤海 */
    if (lat >= 33 && lat < 38.5 && lon <= 127) return 50;               /* 黄海 */
    if (lat >= 31 && lat < 33 && lon <= 124) return 40;                 /* 江苏—长江口 */
    if (lat >= 24 && lat < 31 && lon <= 127) return 70;                 /* 东海陆架 */
    if (lat >= 21.5 && lat < 25.5 && lon <= 122.5) return 30;           /* 台湾海峡/粤东 */
    if (lat >= 17 && lat < 22 && lon <= 117) return 60;                 /* 南海北部 */
    return SIM_TSU_PHY.shelfDepth;
  }
  function simShoal(lat, lon) {
    return Math.pow(SIM_TSU_PHY.seaDepth / Math.max(10, simShelfDepth(lat, lon)), 0.25);
  }
  /** ★★★ 2026-10-26 沿岸爬高 / 口径换算系数
   *  Green's law 只把波传到陸架坡折；再往岸上爬（run-up）还有一段放大：
   *  「口小肚大」的漏斗形灣（汕头灣、泉州灣、珠江口）实测爬高 / 波幅 = 1.6~2.2。
   *  中国海啸记录（含 1918 南澳「沿海浪高 5~7m」）报的就是爬高。
   *  ⇒ 中国海域取 2.7（1.8 爬高 × 1.5 用 1918 南澳实测标定的余量），
   *    日本/其他海域维持 1.0（JMA 报的是波高，不是爬高，不能混口径）。 */
  function simRunup(lat, lon) {
    if (global.QVCNGM && QVCNGM.inChina(lat, lon)) return 2.7;
    return 1;
  }

  /* ══════ Okada (1985) 弹性半空间矩形位错 —— 自由表面垂直位移 uz ══════
   * 依据：Y. Okada (1985) BSSA 75, 1135–1154；Okada (1992) BSSA 82, 1018–1040。
   * 算法按 DC3D（NIED / Y. Okada 1991-2002）逐式移植，并与 pyrocko
   * `src/modelling/ext/okada_ext.c`（S. Heimann & M. Metz 2019 的 C 版）核对。
   *
   * 观测点在自由表面（z = 0）时有两条重要简化（已用数值验证）：
   *   · dc3d 里「实源 ua」与「像源 ua」精确抵消；
   *   · uc 只以 z 的倍数出现，z = 0 时完全消失。
   *   ⇒ 只剩 ub 项，计算量约为完整 dc3d 的 1/3。
   *
   * 坐标系约定（关键，已用 2011 东北地震实测形变校核）：
   *   把 strike 加 180° 后送入 DC3D，使【下倾方向 = strike + 90°】（右手法则）；
   *   此时逆冲（rake>0）上盘抬升、下盘沉降，与 USGS/GCMT 的走向定义一致。
   *   校核结果：东北 M9 陆地侧 uz ≈ +5～8 m（实际观测抬升约 1～5 m）、
   *             海沟侧 uz ≈ −4.8 m（实际沉降）—— 方向与量级都对。
   */
  var OKADA = (function () {
    var EPS = 1e-8, D2R = Math.PI / 180;

    /** dccon0：介质常数 + 倾角常数 */
    function con0(dip) {
      var sd = Math.sin(dip * D2R), cd = Math.cos(dip * D2R);
      if (Math.abs(cd) < EPS) { cd = 0; sd = sd > 0 ? 1 : (sd < 0 ? -1 : 0); }
      return { sd: sd, cd: cd, sdsd: sd * sd, cdcd: cd * cd, sdcd: sd * cd };
    }

    /** dccon2：单个角点的几何量 */
    function con2(xi, et, q, c0, kxi, ket) {
      if (Math.abs(xi) < EPS) xi = 0;
      if (Math.abs(et) < EPS) et = 0;
      if (Math.abs(q) < EPS) q = 0;
      var xi2 = xi * xi, et2 = et * et, q2 = q * q;
      var r2 = xi2 + et2 + q2, r = Math.sqrt(r2);
      if (r === 0) return null;                       /* 奇点（角点重合） */
      var o = { xi2: xi2, et2: et2, q2: q2, r: r };
      o.y = et * c0.cd + q * c0.sd;
      o.d = et * c0.sd - q * c0.cd;
      o.tt = (q === 0) ? 0 : Math.atan(xi * et / (q * r));
      if (kxi === 1) { o.x11 = 0; } else {
        var rxi = r + xi;
        o.x11 = 1 / (r * rxi);
      }
      if (ket === 1) { o.ale = -Math.log(r - et); o.y11 = 0; } else {
        var ret = r + et;
        o.ale = Math.log(ret);
        o.y11 = 1 / (r * ret);
      }
      return o;
    }

    /** ub：位移 part-b 的 3 个分量（只算位移，不算应变导数） */
    function ub(xi, et, q, c0, c2, d1, d2, d3, alp3) {
      var r = c2.r, rd = r + c2.d, d11 = 1 / (r * rd);
      var ai3, ai4;
      if (c0.cd !== 0) {
        if (xi === 0) {
          ai4 = 0;
        } else {
          var xx = Math.sqrt(c2.xi2 + c2.q2);
          ai4 = (xi / rd * c0.sdcd +
            2 * Math.atan((et * (xx + q * c0.cd) + xx * (r + xx) * c0.sd) /
              (xi * (r + xx) * c0.cd))) / c0.cdcd;
        }
        ai3 = (c2.y * c0.cd / rd - c2.ale + c0.sd * Math.log(rd)) / c0.cdcd;
      } else {
        var rd2 = rd * rd;
        ai3 = (et / rd + c2.y * q / rd2 - c2.ale) / 2;
        ai4 = xi * c2.y / rd2 / 2;
      }
      var ai1 = -xi / rd * c0.cd - ai4 * c0.sd;
      var ai2 = Math.log(rd) + ai3 * c0.sd;
      var qx = q * c2.x11, qy = q * c2.y11;
      var w = 1 / (2 * Math.PI);
      var ux = 0, uy = 0, uz = 0;
      if (d1) {                                       /* 走滑 */
        ux += d1 * w * (-xi * qy - c2.tt - alp3 * ai1 * c0.sd);
        uy += d1 * w * (-q / r + alp3 * c2.y / rd * c0.sd);
        uz += d1 * w * (q * qy - alp3 * ai2 * c0.sd);
      }
      if (d2) {                                       /* 倾滑 */
        ux += d2 * w * (-q / r + alp3 * ai3 * c0.sdcd);
        uy += d2 * w * (-et * qx - c2.tt - alp3 * xi / rd * c0.sdcd);
        uz += d2 * w * (q * qx + alp3 * ai4 * c0.sdcd);
      }
      if (d3) {                                       /* 张性（本应用不用） */
        ux += d3 * w * (q * qy - alp3 * ai3 * c0.sdsd);
        uy += d3 * w * (q * qx + alp3 * xi / rd * c0.sdsd);
        uz += d3 * w * (et * qx + xi * qy - c2.tt - alp3 * ai4 * c0.sdsd);
      }
      return [ux, uy, uz];
    }

    /** 自由表面垂直位移 [m]，向上为正
     *  G = { strike, dip, L, W, depC, d1, d2, d3, nu }（长度单位 m）
     *  dN/dE = 观测点相对【断层中心水平投影】的北/东偏移 [m] */
    function uz(G, dN, dE) {
      var nu = (G.nu == null) ? 0.25 : G.nu;
      var c0 = con0(G.dip);
      var S = (G.strike + 180) * D2R;                 /* ★ 关键：翻转 180° */
      var x = Math.cos(S) * dN + Math.sin(S) * dE;
      var y = Math.sin(S) * dN - Math.cos(S) * dE;
      var al1 = -G.L / 2, al2 = G.L / 2;
      var aw1 = -G.W / 2, aw2 = G.W / 2;
      var alpha = 1 / (2 * (1 - nu));                 /* (λ+μ)/(λ+2μ) */
      var alp3 = (1 - alpha) / alpha;
      var xi0 = x - al1, xi1 = x - al2;
      if (Math.abs(xi0) < EPS) xi0 = 0;
      if (Math.abs(xi1) < EPS) xi1 = 0;
      var p = y * c0.cd + G.depC * c0.sd;
      var q = y * c0.sd - G.depC * c0.cd;
      if (Math.abs(q) < EPS) q = 0;
      var et0 = p - aw1, et1 = p - aw2;
      if (Math.abs(et0) < EPS) et0 = 0;
      if (Math.abs(et1) < EPS) et1 = 0;
      var xi = [xi0, xi1], et = [et0, et1];
      var kxi = [0, 0], ket = [0, 0];
      var r12 = Math.sqrt(xi0 * xi0 + et1 * et1 + q * q);
      var r21 = Math.sqrt(xi1 * xi1 + et0 * et0 + q * q);
      var r22 = Math.sqrt(xi1 * xi1 + et1 * et1 + q * q);
      if (xi0 < 0 && r21 + xi1 < EPS) kxi[0] = 1;
      if (xi0 < 0 && r22 + xi1 < EPS) kxi[1] = 1;
      if (et0 < 0 && r12 + et1 < EPS) ket[0] = 1;
      if (et0 < 0 && r22 + et1 < EPS) ket[1] = 1;
      var sum = 0;
      for (var k = 0; k < 2; k++) {
        for (var j = 0; j < 2; j++) {
          var c2 = con2(xi[j], et[k], q, c0, kxi[k], ket[j]);
          if (!c2) continue;
          var du = ub(xi[j], et[k], q, c0, c2, G.d1, G.d2, G.d3, alp3);
          var s = (j === k) ? 1 : -1;
          sum += s * (du[1] * c0.sd + du[2] * c0.cd);   /* XYZ → uz */
        }
      }
      return sum;
    }

    /** 断层面上方自由表面的最大 |uz| 与正/负峰值（用于取初始波高 η₀）
     *  采样范围 = 走向 ±L/2、下倾方向 ±0.75·W·cosδ（覆盖整个断层面投影） */
    function etaPeak(G) {
      var nS = 11, nU = 11;
      var halfU = 0.75 * G.W * Math.cos(G.dip * D2R);
      var th = G.strike * D2R, cs = Math.cos(th), sn = Math.sin(th);
      var up = 0, dn = 0, mx = 0;
      for (var i = 0; i < nS; i++) {
        var s = -G.L / 2 + G.L * i / (nS - 1);
        for (var j = 0; j < nU; j++) {
          var u = -halfU + 2 * halfU * j / (nU - 1);
          /* 局部→北东：走滑轴 = 方位 strike（cosθ,sinθ）；下倾轴 = 方位 strike+90（−sinθ,cosθ） */
          var n = s * cs - u * sn;
          var e = s * sn + u * cs;
          var v = uz(G, n, e);
          if (v > up) up = v;
          if (v < dn) dn = v;
          if (Math.abs(v) > Math.abs(mx)) mx = v;
        }
      }
      return { up: up, dn: dn, mx: mx };
    }

    return { uz: uz, etaPeak: etaPeak };
  })();

  function simBearing(lat1, lon1, lat2, lon2) {   /* 方位角（度，北=0 顺时针） */
    var p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    var dl = (lon2 - lon1) * Math.PI / 180;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  /** 最近的陆地方位（度，北=0 顺时针）；400km 内找不到返回 null
   *  ★ 2026-10-26：震源本身在陆地上直接返回 **null** —— 「最近的陆地」就是自己，
   *    旧实现会取第一个被撞到的方向（14°/0°=正北），内陆地震的海啸就永远朝正北发。 */
  function simCoastAzimuth(lat, lon) {
    if (simIsLand(lon, lat)) return null;
    var cosL = Math.cos(lat * Math.PI / 180) || 1;
    var bestA = null, bestR = 1e9;
    for (var d = 0; d < 16; d++) {
      var a = d * Math.PI / 8;
      for (var r = 10; r <= 400; r += 10) {
        var x = lon + Math.sin(a) * r / (111.19 * cosL);
        var y = lat + Math.cos(a) * r / 111.19;
        if (simIsLand(x, y)) { if (r < bestR) { bestR = r; bestA = a; } break; }
      }
    }
    return (bestA === null) ? null : (bestA * 180 / Math.PI);
  }
  /** 最近的【海域】方位（度，北=0 顺时针）；240km 内找不到返回 null。
   *  内陆震源专用：断层的上盘/波传播方向要指向最近的开阔水域 ——
   *  不能像以前那样落到固定的方位 0。判定法同 simDistToSea（要沿同方向再确认
   *  100km 仍无陆地，避免钻进市界缝隙里）。 */
  function simSeaAzimuth(lat, lon) {
    var dirs = 16, step = 15, maxR = 240, confirm = 105;
    var cosL = Math.cos(lat * Math.PI / 180) || 1;
    var bestA = null, bestR = 1e9;
    for (var d = 0; d < dirs; d++) {
      var ang = d * Math.PI * 2 / dirs;
      var ux = Math.sin(ang) / (111.19 * cosL), uy = Math.cos(ang) / 111.19;
      for (var r = step; r < maxR; r += step) {
        if (simIsLand(lon + ux * r, lat + uy * r)) continue;
        var sea = true;
        for (var c = step; c <= confirm; c += step) {
          if (simIsLand(lon + ux * (r + c), lat + uy * (r + c))) { sea = false; break; }
        }
        if (sea && r < bestR) { bestR = r; bestA = ang * 180 / Math.PI; }
        break;
      }
    }
    return bestA;
  }
  /** 断层走向（兼容旧接口，∈[0,180)）：取「震源→最近陆地」方位 + 90° */
  function simCoastStrike(lat, lon) {
    var az = simCoastAzimuth(lat, lon);
    if (az === null) return 90;
    return (((az + 90) % 180) + 180) % 180;
  }
  /** 断层类型的几何参数（倾角 dip° / 滑动角 rake°）
   *  ★ 2026-10-26 用户要求区分正断层/逆断层/走滑断层（见 simFault 里的说明）。 */
  var SIM_FAULT_GEOM = {
    thrust: { dip: 20, rake: 90 },     /* 海底俯冲带低角度逆冲 —— 海啸主力 */
    reverse: { dip: 45, rake: 90 },     /* 陆上盲逆断层 */
    normal: { dip: 55, rake: -90 },     /* 背弧/拉张：上盘沉降为主 */
    ss: { dip: 85, rake: 180 }        /* 陆上浅源横ずれ：几乎无垂直位移 */
  };
  function simFault(q) {
    var M = +q.mag || 7;
    var d2r = Math.PI / 180;
    var L = Math.min(1200, Math.max(5, Math.pow(10, 0.59 * M - 2.44)));    /* km */
    var W = Math.min(350, Math.max(3, Math.pow(10, 0.41 * M - 1.61)));     /* km */
    var D = Math.min(60, Math.max(0.05, Math.pow(10, 0.69 * M - 4.80)));   /* m 平均位错 */
    /* ★★★ 2026-10-26 用户：「你有没有分正断层、逆断层、走滑断层？走滑里只要能量够大，
       一整块地区直接滑下海洋，也会引发海啸」
       —— 以前 dip=20 / rake=90 是写死的「俯冲带低角度逆冲」，所有震源都一样 →
          内陆走滑地震也被当成推力断层，垂直位移算出来是假的。
       ⇒ 按震源环境分四类，倾角/滑动角进 Okada：
          thrust  = 海底俯冲带逆冲（dip 20 / rake +90）—— 海啸主力
          reverse = 陆上盲逆断层（dip 45 / rake +90）
          normal  = 背弧/深部拉张（dip 55 / rake −90）—— 以上盘沉降为主
          ss      = 陆上浅源横ずれ（dip 85 / rake 180）—— 垂直位移≈ 0
       走滑/正断层没有抬升，但大震会引发【海底块体滑落】→ 单独用 slideEta 补（近场）。 */
    var hypo = Math.max(1, +q.depthKm || 10);      /* km，震源深度 */
    var _onLand = !!simIsLand(q.lon, q.lat);
    /* 沿岸（距海 ≤40km）的浅源多半是沿岸盲逆断层（能登 2024、福岡西方沖型），不能当走滑。 */
    var _nearCoast = _onLand && simNearSea(q.lat, q.lon, 40);
    var fkind = !_onLand ? 'thrust'
      : _nearCoast ? 'reverse'
        : (hypo <= 20) ? 'ss'
          : (hypo <= 45) ? 'reverse' : 'normal';
    /* ★ 2026-10-26 用户：「想能在模拟面板里手动选断层类型」→ 面板选了就覆盖自动判定 */
    var _fk = String(q.simFKind || 'auto');
    if (_fk !== 'auto' && SIM_FAULT_GEOM[_fk]) fkind = _fk;
    var _geom = SIM_FAULT_GEOM[fkind];
    var dip = _geom.dip, rake = _geom.rake;
    /* 震源点当作断层面上的一个点 ⇒ 断层中心深度 = 震源深度 + 半宽在深度上的投影 */
    var depC = hypo + Math.sin(dip * d2r) * W / 2;
    /* ★ 俯冲带的上盘是陆侧 ⇒ 断层面【下倾方向 = 指向最近陆地的方位】，
     *   走向 = 该方位 − 90°。这样 Okada 的抬升瓣与海啸传播方向都朝岸侧。
     *   ★ 2026-10-26：震源在陆地内部时 toLand=null（见 simCoastAzimuth）→
     *     改用「最近海域」方位，传播方向朝最近的那片海，而不是固定正北。 */
    var toLand = simCoastAzimuth(q.lat, q.lon);
    var aim = (toLand !== null) ? toLand : simSeaAzimuth(q.lat, q.lon);
    var strike = (aim === null) ? 90 : (((aim - 90) % 360) + 360) % 360;
    var G = {
      strike: strike, dip: dip,
      L: L * 1000, W: W * 1000, depC: depC * 1000,
      /* DC3D 内部把 strike 翻转了 180°，所以走滑分量取反、倾滑分量保持 */
      d1: -D * Math.cos(rake * d2r), d2: D * Math.sin(rake * d2r), d3: 0, nu: 0.25
    };
    var pk = OKADA.etaPeak(G);                     /* Okada(1985) 自由表面 uz */
    /* 海底块体滑落（走滑/正断层的「整块溜下海」）：不是断层抬升，只在近场起作用。
       参考：2018 Palu M7.5 走滑 → 局部 6m；1993 北海道南西沖（正断层）→ 30m 大津波。 */
    var slideEta = (fkind === 'ss') ? 0.55 * Math.max(0, M - 7.0)
      : (fkind === 'normal') ? 0.25 * Math.max(0, M - 7.0) : 0;
    return {
      L: L, W: W, D: D, strike: strike, dip: dip, rake: rake, toLand: toLand,
      dep: hypo, depC: depC, G: G, kind: fkind, slideEta: slideEta,
      eta0: Math.abs(pk.mx) * (fkind === 'ss' ? 0.15 : 1),   /* η₀ = 海底最大垂直位移 [m]
                                                                   * 走滑只剩「倾角不是 90°」的泄漏分量（→0），
                                                                   * 真要走滑海啸靠下面的 slideEta（海底滑坡） */
      etaUp: pk.up, etaDn: pk.dn                   /* 抬升 / 沉降峰值（带符号） */
    };
  }
  /** 海岸放大系数（0.45~1.60，确定性）：リアス式海岸 / V 字湾会把波高放大，
   *  平直砂浜反而衰减。用区域码做确定性伪随机 —— 同一区域每次模拟结果一致，不会乱跳。 */
  function simTsuAmp(code) {
    var s = String(code == null ? '' : code), h = 7;
    for (var i = 0; i < s.length; i++) h = (h * 131 + s.charCodeAt(i)) % 100003;
    /* ★ 0.45~1.60：真实海岸的放大差异很大（V 字湾 2 倍、砂浜 <1），
       范围窄的话所有地方都落回同一档（用户：「10m 这么多」）。 */
    return 0.45 + 1.15 * ((h % 1000) / 1000);
  }
  /** 某点（距震源 rKm、方位 brg）的预计海啸波高（m）
   *  η = η₀(Okada) · 几何扩散 · 方向性 · 海岸放大 · Green's law 浅水放大
   *    ＋ 海底滑坡项（走滑/正断层：整块海底滑落，只在 ~250km 近场） */
  function simTsunamiHeight(F, rKm, brg, amp, shoal, cn) {
    var d2r = Math.PI / 180;
    var SH = (shoal > 0) ? shoal : SIM_TSU_SHOAL;
    /* ★★★ 2026-10-26 用户：「走滑断层只要能量足够大，一整块地区直接滑下海洋，也会引发海啸」
       —— 走滑/正断层没有垂向位错（Okada 的 η₀ ≈ 0），但大震会把整块海底斜坡掀下去，
          2018 Palu M7.5 就是局部 6m。⇒ 单独一项，**只在近场 250km 内**、不做方向性过滤
          （块体滑落是四周扩散的），衰减比断层抬升快。 */
    var slide = 0;
    if (+F.slideEta > 0 && rKm < 250) {
      slide = F.slideEta * Math.pow(1 - rKm / 250, 1.3) * SH * (amp || 1);
    }
    var eta0 = F.eta0;
    if (!(eta0 > 0)) return slide;
    /* ★★ 2026-10-24 用户：「10m 这么多」
       以前 √(L0/r) 在 M9 时近场一律 ×1.0 → 整条海岸同一个值、全被顶到最高档。
       改成 L0/(L0+r)^0.8：近场仍≈1，往外平滑衰减，档位自然拉开。 */
    var L0 = Math.max(20, F.L);
    var decay = Math.pow(L0 / (L0 + Math.max(0, rKm)), 0.8);
    var normal = F.strike + 90;                    /* = 断层下倾方向（上盘） */
    var dth = ((brg - normal + 540) % 360) - 180;
    var cosT = Math.cos(dth * d2r);
    /* ★★★ 2026-10-26 中国本地海啸与日本海沟型不是一回事（用户拿 1918 南澳对比）：
       · 日本：震源在海沟外侧，能量主要朝陆侧单向辐射 ⇒ cos^1.3，背侧几乎为 0。
       · 中国近海（滨海断裂带）：震源就在陆架边缘/海湾口，两侧都直接对着海岸，
         近场沿岸区无论在哪一侧都会挨到（汕头湾、南澳岛、柘林湾…）
         ⇒ 方向性改成 0.55 底 + 0.45·cos^1.3，背侧也给 55%。
       另：Okada + Wells&Coppersmith 的位错 D 对华南滨海断裂偏低（M7.3 → 1.7m），
       只用 0.5m 初始水位无论如何都到不了记录值。按 1918 南澳「5~7m」标定，
       近场（≤120km 尺度）再乘 1+1.25·exp(−r/120)，远场不受影响。 */
    var dir;
    if (cn) {
      dir = 0.55 + 0.45 * Math.pow(Math.max(0, cosT), 1.3);
    } else {
      if (cosT <= 0.15) return slide;        /* 侧向/背向：断层抬升没有能量，只剩滑坡项 */
      dir = Math.pow(cosT, 1.3);             /* 能量指向性 ≈ cos^1.3 */
    }
    var boost = cn ? (1 + 1.25 * Math.exp(-Math.max(0, rKm) / 120)) : 1;
    /* ★ 增益 1.0（不再额外 ×1.4）：Okada 的 η₀ 在 M8.8+ 就有 8~11m，
       再放大就整条海岸线全挤到 10m 档。 */
    return eta0 * decay * dir * (amp || 1) * SH * boost + slide;
  }
  /* ★★ 2026-10-24 用户：「分档你怎么就只有 3 个… 6m、5m、10m以上 被你吃了」
     + 「请不要自己画素材」
     ⇒ 官方 paNp*.svg 实测只有这五档带高度徽章（其余 paNp1..4 不带高度）：
          1m 津波注意報 paNp5 ｜ 3m 津波警報 paNp6 ｜ 5m 大津波警報 paNp7
          10m 大津波警報 paNp8 ｜ 10m超 大津波警報 paNp9
        另外还有文字版：高い paNp3t / 巨大 paNp4t。
      ⇒ 模拟只产出这五档 + 若干の海面変動（paNp1），组头直接换官方图，不拼 div。
      （JMA 真实的 6m/4m/2m 没有对应素材 → 就低落到 5m/3m/1m。） */
  var SIM_TSU_LADDER = [10, 7, 4, 1.5, 0.4];
  /** 物理波高 H（m）→ { grade, height }；返回 null = 不发报
   *  H ≥10 → 10m超(lv4) ｜ ≥7 → 10m(lv4) ｜ ≥4 → 5m(lv4)
   *  ≥1.5 → 3m(lv3) ｜ ≥0.2 → 1m(lv2) ｜ ≥0.05 → 若干の海面変動(lv1) */
  function simTsuClass(H) {
    if (!(H >= 0.05)) return null;
    if (H >= 10) return { g: 4, h: '10m超' };
    if (H >= 7) return { g: 4, h: '10m' };
    if (H >= 4) return { g: 4, h: '5m' };
    if (H >= 1.5) return { g: 3, h: '3m' };
    /* ★★★ 2026-11-03 用户：「你是不是改海啸算法了，本来正常的算法突然变得这么夸张」
       —— 算法没动，但**显示范围**变了：以前中国近场岸段（1320..1363）在
          海岸线分区表里没有映射，算了也不画；现在画全了，于是
          「M7.8 汕头 → 大连/天津/烟台 全是 1m 注意报」这种夸张结果暴露出来。
       根因在**分级门槛**：官方素材里「津波注意報」的予想波高就是 **1m**，
       而下表以前把 0.2m 也算成 1m 档 → 1500km 外算出的 0.27m 全被画成黄注意报。
       ⇒ 1m 档必须是 H ≥ 1.0；0.05~1.0 一律「若干の海面変動」（浅蓝，grade 1）。 */
    if (H >= 1.0) return { g: 2, h: '1m' };
    return { g: 1, h: '' };            /* 若干の海面変動（paNp1） */
  }

  /* ══════ 311 剖面（2011/03/11 東北地方太平洋沖地震）══════
   * ★★ 2026-10-24 用户：「模拟太垃圾了…本地有 311 的完整数据，搞个和真的 311 一样的」
   *   真实 2011/03/11 15:30 报文的档位分布：
   *     10m以上 大津波警報：宮城県
   *     6m     大津波警報：岩手県・福島県
   *     4m     大津波警報：茨城県・千葉県九十九里・外房
   *     3m     津波警報  ：北海道〜青森〜房総〜伊豆〜東海〜四国〜九州〜沖縄
   *     1m     津波注意報：日本海側など
   *   ⚠️ 为什么不能只靠物理模型：宮城 10m 而 千葉 4m，主要是**リアス海岸/V字湾的
   *      地形放大差异**，不是「距震源远近」能解释的。
   *   ★ 用户「请不要自己画素材」→ 官方组头只有 1m/3m/5m/10m/10m超 五档，
   *     所以把真实的 6m/4m/2m **就低落到** 5m/3m/1m（等级/区域/顺序完全照真实报文）。
   *   区域码 = js/tsu-areas.js 的 c（已按官方 nt<code>.svg 逐个核对过）。 */
  var TSU311 = [
    [4, '10m超', [220]],                                    /* 宮城県（真实 10m以上） */
    [4, '5m', [210, 250, 300, 310]],                        /* 岩手・福島(6m) / 茨城・千葉九十九里外房(4m) */
    [3, '3m', [100, 101, 102, 201, 311, 312, 320, 330, 380,
      390, 391, 400, 530, 580, 610, 760, 770, 771, 772, 800]],   /* 津波警報 3m */
    [2, '1m', [110, 111, 120, 200, 202, 230, 240, 340, 350, 370,
      500, 510, 520, 540, 560, 570, 590, 601, 700, 710, 720, 730, 740, 750, 773, 802]],
    [1, '', [341, 361, 521, 522, 551, 712, 731, 751, 801]]   /* 若干の海面変動（内海・遠洋） */
  ];
  /** 这一场是不是「日本海溝 M8.6+」？→ 走 311 剖面 */
  function simIs311(q) {
    return (+q.mag >= 8.6) && q.lat >= 34.5 && q.lat <= 41.5 && q.lon >= 139.5 && q.lon <= 146.5;
  }

  /** 按规模/深度生成一场海啸：4=大津波警报 / 3=海啸警报 / 2=海啸注意报 / 1=若干の海面変動
   *  ★ 2026-10-22 用户：「为什么海啸模拟只会显示一个等级？不应该是多个等级
   *     从最高逐渐到最下面的吗」→ 现在由【物理波高】自然分层（近高远低）。
   *  ★ 2026-10-24 用户：「初报 311 可没有报 10M+」「全部地震都应该显示从最大到最小的等级」 */
  /** ★★★ 2026-10-26 用户：「海啸这一块音效没用全」
   *   官方 tsa01~tsa04 = 发布时的日语播报（若干の海面変動 / 注意報 / 警報 / 大津波警報） */
  function tsuSfx(obj) {
    try {
      if (!global.QVSpeak) return;
      var n = (obj && obj.maxLv) || 0;
      var p0 = +V._tsuLv || 0;
      /* 按《音效对应.xlsx》分四种情况：发布 / 更新 / 解除 / 切换 */
      if (QVSpeak.tsunami) QVSpeak.tsunami(p0, n);
      else if (QVSpeak.playFile) {
        var f = n >= 4 ? 'tsa04' : (n >= 3 ? 'tsa03' : (n >= 2 ? 'tsa02' : 'tsa01'));
        QVSpeak.playFile(f, 0.9);
      }
      V._tsuLv = n;
    } catch (e) { }
  }

  /** ★★★ 2026-10-26 用户：「海啸你没做成阶段啊…海啸也分
   *   1.预警 2.追加（多数大地震） 3.第一波 4.第二波 5.各个地区陆续到达
   *   6.取消部分 7.取消部分 8.取消部分（多数大地震） 9.取消全部海啸警报」
   *   ⇒ 把一次海啸拆成 9 个阶段，每阶段 = 一份可直接交给 `QData.simTsunami()` 的对象。
   *   面板素材（`paNt0x` 到達予想/第１波の到達を確認/津波到達中と推測、`paNt1x` 最大波、
   *   `paNp*` 组头）全部由 `firstCond / maxCond / height / grade` 自动选，
   *   音效由 `tsuSoundTick()` 的「级别变化 → tsa0x/tsa2x/tsa3x、到达情报变化 → VTSE5/VXSE5C」自动播，
   *   所以这里只需要造数据，不用碰渲染和音效。
   *   ⚠️ 只算 2 次物理（首报 initial + 完整版），后面 7 个阶段都是在这两份数据上做增删，
   *      否则 Okada 位错解要跑 9 遍。 */
  var TSU_STAGE_NAMES = [
    '海啸预警（発表）', '海啸追加（多数大地震）', '第一波到达确认', '第二波到达确认',
    '各沿岸陆续到达', '解除部分①', '解除部分②', '解除部分③（多数）', '全部解除'
  ];
  function _tsuClone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } }
  function simTsuStages(q) {
    var initO = null, fullO = null;
    try { initO = simMakeTsunami(q, { initial: true }); } catch (e1) { initO = null; }
    try { fullO = simMakeTsunami(q); } catch (e2) { fullO = null; }
    if (!initO || !initO.items || !initO.items.length) {
      if (!fullO || !fullO.items || !fullO.items.length) return [];
      initO = _tsuClone(fullO);
    }
    if (!fullO || !fullO.items || !fullO.items.length) fullO = _tsuClone(initO);

    function lvOf(items) {
      var m = 0;
      for (var i = 0; i < items.length; i++) {
        var v = items[i].grade | 0;
        if (v > m) m = v;
      }
      return m;
    }
    function mk(base, items, head, idx) {
      var o = _tsuClone(base) || {};
      o.items = (items || []).map(function (x) { return _tsuClone(x); });
      o.maxLv = lvOf(o.items);
      o.head = head || '';
      o.atMs = simNowMs();                 /* 发表时刻 = 模拟「现在」 */
      o._simStage = idx | 0;
      /* 组头高度取列表里最高的那一档（items 已按高度降序） */
      o.height = o.items.length ? (o.items[0].height || '') : '';
      return o;
    }
    function tOf(it) { var t = it && it.firstAt ? Date.parse(it.firstAt) : 0; return isFinite(t) ? t : 0; }

    var fullItems = (fullO.items || []).map(function (x) { return _tsuClone(x); });
    var byTime = fullItems.slice().sort(function (a, b) { return tOf(a) - tOf(b); });
    function idsOf(list) { var m = {}; list.forEach(function (x) { m[x.code] = 1; }); return m; }
    /* ★★★ 2026-10-26 用户：「文字根本没变过，到底我记得有写 XX 米的」
       —— 官方到达后胶囊变成 `最大波 09日01:09 0.7m`（有波高数字），
          我们以前只把 firstCond 改成「第１波の到達を確認」，读数一直是同一行字。
       ⇒ 到达的区域改成 **最大波**（`maxCond/maxAt/maxHeight`），
         面板会走 `paNt1<等级色>0` 黄/深蓝胶囊 + 「最大波 HH:mm X.Xm」。
         实测波高按预报高度换算（约为预报的 0.28 倍，官方实测通常低于预报），
         再按顺序给 0.1m 级的抖动，避免整列一模一样。 */
    var _now0 = simNowMs();
    function measHeight(h, idx) {
      var m = String(h || '').match(/^\s*([\d.]+)\s*m/);
      var base = m ? parseFloat(m[1]) : 2.0;          /* 「若干の海面変動」没有高度 → 当 2m 档起算 */
      var v = Math.max(0.1, Math.min(3.0, base * 0.28));
      v = v + ((idx | 0) % 3) * 0.1;
      return v.toFixed(1) + 'm';
    }
    /** 按「到达时刻从近到远」取前 frac，标成到达后的**最大波** */
    function markNear(frac) {
      var n = Math.max(1, Math.round(byTime.length * frac));
      var near = byTime.slice(0, n);
      var ids = idsOf(near);
      var hMap = {};
      near.forEach(function (x, i) { hMap[x.code] = measHeight(x.height, i); });
      return fullItems.map(function (x) {
        var c = _tsuClone(x);
        if (!ids[c.code]) return c;
        var t = tOf(c);
        c.firstCond = ''; c.firstAt = '';
        c.maxCond = '津波到達中と推測';
        c.maxAt = new Date(t > 0 ? t : _now0).toISOString();
        c.maxHeight = hMap[c.code] || '0.2m';
        return c;
      });
    }
    /** 去掉「到达时刻最远」的 frac（已到达的排最前，不会先被删） */
    function dropFar(items, frac) {
      var lst = items.slice().sort(function (a, b) { return tOf(a) - tOf(b); });
      var cut = Math.max(1, Math.round(lst.length * frac));
      var ids = idsOf(lst.slice(lst.length - cut));
      return items.filter(function (x) { return !ids[x.code]; }).map(function (x) { return _tsuClone(x); });
    }

    var out = [];
    /* ① 预警：首报（注意报/警报档） */
    out.push({ name: TSU_STAGE_NAMES[0], obj: mk(initO, initO.items, '（模拟）津波警報を発表しました。', 1) });
    /* ② 追加：完整版（区域更多、等级可能升到警报） */
    out.push({ name: TSU_STAGE_NAMES[1], obj: mk(fullO, fullItems, '（模拟）津波警報を追加しました。', 2) });
    /* ③ 第一波到达确认：最近的 15% → 胶囊变「最大波 HH:mm X.Xm」 */
    out.push({ name: TSU_STAGE_NAMES[2], obj: mk(fullO, markNear(0.15),
      '（模拟）第１波の到達を確認しました。', 3) });
    /* ④ 第二波：累计 35% */
    out.push({ name: TSU_STAGE_NAMES[3], obj: mk(fullO, markNear(0.35),
      '（模拟）第２波の到達を確認しました。', 4) });
    /* ⑤ 各地区陆续到达：累计 75% */
    var arrived = markNear(0.75);
    out.push({ name: TSU_STAGE_NAMES[4], obj: mk(fullO, arrived,
      '（模拟）各地で津波の到達を確認しました。', 5) });
    /* ⑥⑦ 取消部分：由远到近逐批解除
       ★ 必须从「已到达」的那一份继续删 —— 否则解除阶段的胶囊会倒退回「到達予想」 */
    var c6 = dropFar(arrived, 0.30);
    out.push({ name: TSU_STAGE_NAMES[5], obj: mk(fullO, c6, '（模拟）津波注意報を解除しました。', 6) });
    var c7 = dropFar(c6, 0.40);
    out.push({ name: TSU_STAGE_NAMES[6], obj: mk(fullO, c7, '（模拟）津波注意報を解除しました。', 7) });
    /* ⑧ 取消大部分：只留警報以上（没有警報就留最高那一档） */
    var hi = (lvOf(c7) >= 3)
      ? c7.filter(function (x) { return (x.grade | 0) >= 3; })
      : c7.filter(function (x) { return (x.grade | 0) >= lvOf(c7); });
    if (!hi.length) hi = c7.slice(0, Math.max(1, Math.round(c7.length * 0.2)));
    out.push({ name: TSU_STAGE_NAMES[7], obj: mk(fullO, hi, '（模拟）津波警報を解除しました（大部分）。', 8) });
    /* ⑨ 全部解除 */
    var c9 = mk(fullO, [], '（模拟）津波警報・注意報をすべて解除しました。', 9);
    c9.maxLv = 0;
    out.push({ name: TSU_STAGE_NAMES[8], obj: c9 });
    return out;
  }

  /** 模拟时钟（毫秒）：
   *  ★★★ 2026-10-26 用户：「模拟的顶部时间是 09/21 01:47，但左侧海啸到达时间写的是
   *   26日 5:36 ごろ —— 把模拟当天的真实系统时间硬塞进去了」
   *  ★★★ 用户补充（同日）：「我手动跳过了部分阶段，但是海啸的时间没有被缩小」
   *   —— 跳阶段（Enter）会把 `E.simT0` 往前挑（= 这次地震「已经过了 100 秒」），
   *      所以模拟的「现在」必须跟着跑，否则跳完之后海啸还是按真实 6~12 秒算，
   *      到达予想永远停在「发表时刻 + 传播时间」。
   *   ⇒ 统一用**事件时钟**：现在 = 地震发生时刻(q.timeMs) + 已模拟流逝(×加速倍率)。
   *      拿不到事件时退回旧口径（自定义时间基准 / 真实时间）。 */
  function simNowMs() {
    var E = V.eew;
    if (E && +E.timeMs && +E.simT0) {
      var el = Math.max(0, Date.now() - (+E.simT0));
      return (+E.timeMs) + el * simSpd();
    }
    if (V.simTimeBase) return V.simTimeBase + (Date.now() - (V.simTimeStart || Date.now()));
    return Date.now();
  }

  /** ★ 模拟里海啸传播时间的压缩倍数（仅模拟用；真实数据不动）。
   *  取 8：南澳 M7.3 最近沿岸 18 分钟 → 2.3 分钟，
   *  按几次回车（每次 = 该阶段时长）就能看到到达时刻往后推、近的变「到達中」。 */
  var SIM_TSU_TZOOM = 8;

  function simMakeTsunami(q, opt) {
    var initial = !!(opt && opt.initial);
    var F = simFault(q);
    var now = simNowMs();
    /* ★ 津波到达预测的起点是**地震发生时刻**，不是「现在」：
       跳阶段后模拟时间已经往前走了 → 剩下的等待时间自然缩短，
       已经超过到达时刻的地方直接变成「津波到達中と推測」。 */
    var orgMs = (+q.timeMs) || now;
    /* 中国震源：走中国近海的陆架/爬高/近场标定口径（见 simShelfDepth / simRunup / simTsunamiHeight） */
    var cnSrc = !!(global.QVCNGM && QVCNGM.inChina(q.lat, q.lon));
    var cand = simTsuAreas(q.lat, q.lon, 3200);     /* 半径放宽到整个西北太平洋（含中国沿海、台湾、日韩）
                                                       ★ 2600 太卡：三陸沖→台湾/福建 算出来 2598~2605km，
                                                         刚好在边界上被筛掉（用户：「为什么台湾没有」）。 */
    var rows = [];
    if (simIs311(q)) {
      /* 311 剖面：直接按真实报文的档位分派 */
      var AMAP = {};
      (global.QV_TSU_AREAS || []).forEach(function (a) { AMAP[a.c] = a; });
      var HRk = (global.QData && QData.heightRank) ? QData.heightRank : function () { return 0; };
      for (var gi = 0; gi < TSU311.length; gi++) {
        var GR = TSU311[gi];
        for (var ki = 0; ki < GR[2].length; ki++) {
          var A2 = AMAP[GR[2][ki]];
          if (!A2) continue;
          rows.push({
            a: { d: simKm(q.lat, q.lon, A2.lat, A2.lon), name: A2.n, code: A2.c, lat: A2.lat, lon: A2.lon },
            H: HRk(GR[1]), g: GR[0], h: GR[1]
          });
        }
      }
      /* 组内顺序照官方：同一档位按区域码（北海道→东北→关东…） */
      rows.sort(function (x, y) { return (y.H - x.H) || (x.a.code - y.a.code); });
      if (initial) {
        /* ★ 2026-10-24 用户：「初报 311 可没有报 10M+」
           真实 14:49 的第一报最高是 6m（宮城）/ 3m（岩手・福島），
           10m以上 是 15:30 观测到实际波高之后才升级的。 */
        rows.forEach(function (r3) { if (r3.h === '10m超' || r3.h === '10m') r3.h = '5m'; });
      }
      /* ★ 2026-10-25 用户：「全球通 SREV，为什么海岸线和其他数据一定要区分国家」
         TSU311 只列了日本官方的分段；311 实际是整个西北太平洋都有海面变动
         （中国东海/台湾/菲律宾 0.1~0.2m）。这里把候选表里剩下的沿岸区补成
         「若干の海面変動」，不再只覆盖日本。 */
      var have311 = {};
      rows.forEach(function (r4) { have311[r4.a.code] = 1; });
      for (var ce = 0; ce < cand.length; ce++) {
        var a3 = cand[ce];
        if (have311[a3.code]) continue;
        have311[a3.code] = 1;
        rows.push({ a: a3, H: 0.1, g: 1, h: '' });
      }
    } else {
      for (var ci = 0; ci < cand.length; ci++) {
        var a = cand[ci];
        if (!isFinite(a.lat) || !isFinite(a.lon)) continue;
        var brg = simBearing(q.lat, q.lon, a.lat, a.lon);
        /* ⚠️ 陆架深度 / 爬高系数**只对中国震源**生效：
           否则日本三陸沖 M9 传到中国东海时，会被 70m 陆架再乘一遍 Green's law，
           2000km 外直接算出 30m+（实测）。中国区改造不外溢到日本口径。 */
        var _shoal = cnSrc ? simShoal(a.lat, a.lon) : SIM_TSU_SHOAL;
        var _runup = cnSrc ? simRunup(a.lat, a.lon) : 1;
        var H = simTsunamiHeight(F, a.d, brg, simTsuAmp(a.code), _shoal, cnSrc) * _runup;
        if (initial) {
          /* 首报按规模封顶（真实 311 的首报最高 6m → 我们素材的 5m 档）
             ★★★ 2026-10-25 按用户样本修正：青森県東方沖 M7.5 在 23:17:49 首报是
               **海啸注意报**（当时规模还写 M7.2），23:23:56 才升级成海啸警报 3m（M7.6）。
               ⇒ M 7.0~7.7 的首报封顶在「注意报」档（0.9m < 1.5m），
                 M≥7.8 才允许首报直接出警报。熊本 M7.1 官方首报也是注意报，吻合。 */
          /* ★ 2026-10-26 中国震源不用日本的「首报封顶」规矩：
             0.9m 封顶是 JMA 的报文习惯（先注意报、观测到再升级），
             中国海啸预警中心的首报就带预计波高。以前中国区也被封到 0.9m，
             于是 1918 南澳那种「首报就该是 5m 级」的场景永远出不来。 */
          var _cnSrc = !!(global.QVCNGM && QVCNGM.inChina(q.lat, q.lon));
          var capI = _cnSrc ? 6 : ((q.mag >= 7.8) ? 6 : (q.mag >= 7.0 ? 0.9 : 0.5));
          H = Math.min(H, capI);
        }
        var cl = simTsuClass(H);
        if (!cl) continue;
        rows.push({ a: a, H: H, g: cl.g, h: cl.h });
      }
      rows.sort(function (x, y) { return y.H - x.H; });
    }
    /* ★ 首报**不再截断等级**（用户：「为什么 3 米以下的等级不报了」），
       只做高度封顶；条数上限 = 100（全球口径下区域变多，60 会把远处的中国沿海全部切掉）。 */
    rows = rows.slice(0, 100);
    var items = [], maxLv = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], d = r.a.d;
      var tMin = Math.max(1, Math.round(d * 1000 / Math.sqrt(9.81 * SIM_TSU_PHY.seaDepth) / 60));
      /* ★★★ 2026-10-26 用户：「我手动跳过了部分阶段，但是海啸的时间没有被缩小」
         → 确认：「我跳过只会使用回车更新」（即每次回车跳一个阶段）。
         —— 真实传播时间太大：南澳 M7.3 最近沿岸就要 18 分钟，
            而整场模拟用回车跳完全程只推进约 3.5 分钟 → 表里数字永远不动。
         ⇒ **仅模拟**把传播时间统一压缩 SIM_TSU_TZOOM 倍，
            远近顺序、高度、分级全部不变，只是时间轴变短；
            于是每按几次回车就能看到「到達予想」往后推、近的陆续变「津波到達中と推測」。
            真实数据（JMA / 中国海啸预警中心）完全不受影响。 */
      var tMinDisp = tMin / SIM_TSU_TZOOM;
      var arrMs = orgMs + Math.round(tMinDisp * 60000);
      var late = arrMs - now;
      var arrived = (d < 200) || (late <= 0);
      items.push({
        code: String(r.a.code), name: r.a.name, grade: r.g, gradeName: '', raw: '',
        height: r.h,
        firstCond: arrived ? '津波到達中と推測' : '到達予想',
        firstAt: arrived ? '' : new Date(arrMs).toISOString(),
        maxCond: '', maxAt: ''
      });
      if (r.g > maxLv) maxLv = r.g;
    }
    /* 兜底：一个区域都没过阈值 → 不发布。
       ★ 没有任何区域时 maxLv 必须是 0（以前兜成 2 → 明明没海啸却按注意报处理）。 */
    var HGT = { 4: '5m', 3: '3m', 2: '1m', 1: '' };
    return {
      maxLv: items.length ? maxLv : 0,
      height: (rows.length ? rows[0].h : (HGT[maxLv] == null ? '' : HGT[maxLv])),
      atMs: now, anm: q.place || '模拟震源', mag: q.mag, dep: q.depthKm,
      items: items, head: '（模拟）津波予報を発表しました。'
    };
  }
  /** 误报：单个测站异常 → 全图推定震度拉满 → 9 秒后取消（用户给的真实表现） */
  function fireFalseAlarm(q, lv, firstDelay) {
    if (global.QData && QData.inject) QData.inject(q);
    var LV_ERR = 70;                       /* 震度7 = 异常值 */
    simAux.push(setTimeout(function () {
      var obs = genStations(q.lat, q.lon, LV_ERR, 'shindo', q.depthKm, q.mag) || [];
      var st = obs.slice().sort(function (a, b) { return (a.hyp || 0) - (b.hyp || 0); });
      var one = st.length ? [{
        area: st[0].area, cty: st[0].cty, name: st[0].name, lat: st[0].lat, lon: st[0].lon,
        shindo: LV_ERR, hyp: st[0].hyp, intensity: st[0].intensity || 7
      }] : [];
      /* ★ 2026-10-22 用户：「一般最多误报一个省，你直接全世界了？？」
         ⇒ 只填【震源附近的一片】——日本取最近几个测站所属区域，中国取最近几个地级市。 */
      var nearSt = st.slice(0, 8);
      var areaSet = {}, ctySet = {};
      for (var ni = 0; ni < nearSt.length; ni++) {
        if (nearSt[ni].area) areaSet[nearSt[ni].area] = 1;
        if (nearSt[ni].cty) ctySet[nearSt[ni].cty] = 1;
      }
      var jpCodes = Object.keys(areaSet).map(Number);
      var cnFill = Object.keys(ctySet).map(function (c) {
        return { code: +c, level: LV_ERR, metric: 'shindo' };
      });
      V.eew = {
        kind: 'eew', q: q, place: q.place || '模拟震源', timeMs: Date.now(),
        mag: q.mag, depth: q.depthKm, level: LV_ERR, metric: 'shindo', report: 1,
        areas: [{ name: (one[0] && one[0].name) || '异常观测点', level: LV_ERR }],
        allAreas: jpCodes.map(function (c) { return { code: c, shindo: LV_ERR }; }),
        fillAreas: cnFill, obs: one, lat: q.lat, lon: q.lon,
        plan: 1, distMax: 0, simT0: Date.now()
      };
      if (global.QVShindo && QVShindo.setStations) QVShindo.setStations(
        one.map(function (o) { return { lat: o.lat, lon: o.lon, shindo: LV_ERR }; }));
      if (global.QVShindo && QVShindo.set) QVShindo.set(
        jpCodes.map(function (c) { return { code: c, shindo: LV_ERR }; }));
      if (global.QVMapCam) {
        if (QVMapCam.setAreaFill) QVMapCam.setAreaFill(cnFill.length ? cnFill : null);
        if (QVMapCam.lockPin) QVMapCam.lockPin([{ lat: q.lat, lon: q.lon, kind: 'eew' }]);
        if (QVMapCam.setPins) QVMapCam.setPins([{ lat: q.lat, lon: q.lon, kind: 'eew' }]);
        /* 镜头要飞到震源，否则会停在上一场的位置，看不到「整片地图拉满」 */
        /* ★★★ 2026-10-25 深源：S 波得先从震源爬到地表（≈深度/4 秒），
           按「30 秒」算半径会得 0 → 退回 focus() → 镜头殫在一片空海面上。
           ⇒ t = max(30, dep/4 + 20)，并且给一个 ≥0.75·dep 的下限兜底。 */
        var _tFit0 = Math.max(30, (+q.depthKm || 0) / 4 + 20);
        var km30 = QVMapCam.jma2001Dist ? QVMapCam.jma2001Dist(_tFit0, q.depthKm, false) : 0;
        if (!(km30 > 1)) km30 = Math.max(200, (+q.depthKm || 0) * 0.75);
        if (km30 > 1 && QVMapCam.fitCircle) QVMapCam.fitCircle(q.lat, q.lon, km30, 0.30);
        else if (QVMapCam.focus) QVMapCam.focus(q, true);
      }
      if (global.QVViews && QVViews.setView) QVViews.setView(1);
      if (global.QVRedraw) QVRedraw();
      toast('误报（模拟）：单个测站异常 → 全图推定震度拉满');
      /* 9 秒后撤销 */
      simAux.push(setTimeout(function () {
        setEEW({ isEew: true, isCancel: true, lat: q.lat, lon: q.lon,
          place: q.place, timeMs: Date.now(), mag: q.mag, depthKm: q.depthKm, seq: 1 }, 0);
        if (global.QVShindo) {
          if (QVShindo.clearPoints) QVShindo.clearPoints();
          if (QVShindo.setStations) QVShindo.setStations([]);
          if (QVShindo.set) QVShindo.set([]);
        }
        if (global.QVMapCam) {
          if (QVMapCam.setAreaFill) QVMapCam.setAreaFill(null);
          if (QVMapCam.setPins) QVMapCam.setPins([]);
          if (QVMapCam.clearStations) QVMapCam.clearStations();
        }
        if (global.QVRedraw) QVRedraw();
        toast('已发出「地震误报取消」（模拟）');
      }, 9000));
    }, firstDelay));
  }

  /* ---- ③ 真正开始：注入假地震 + 相机飞过去 + 钉红叉 + 官方 P/S 波圆 ---- */
  function fireSim(q) {
    /* ★★★ 2026-10-26 用户：「为什么时间不见了」（各地震度信息卡 / 主卡都没时间）
       根因：`__fireSim({...})` 传进来的对象**没有 timeMs**，而 V.eew.q 会被
       QVHist.setCurrent() 直接当成履历条目（patch() 原样插进 list）
       → 主卡、正式报卡都拿 q.timeMs 画「発生日時」→ mdTime(undefined) = '' → 整行不见。
       （调查中卡有单独的时间行，用的是 V.eew.timeMs，所以那张有。）
       ⇒ 在入口补齐：模拟地震的统一用现在时刻（作为事件发生时间）。 */
    if (!q.timeMs) q.timeMs = Date.now();
    if (!q.pubMs) q.pubMs = q.timeMs;
    /* ★ 2026-10-29: AI 接口调用标准化 metric，按坐标默认判断，避免同一场模拟内跳变 */
    if (!q.metric) {
      var _isJP = (q.lat >= 24 && q.lat <= 47 && q.lon >= 126 && q.lon <= 148);
      q.metric = _isJP ? 'shindo' : 'liedu';
    }
    /* ★★★ 2026-10-28 用户：「我都拉到 8 级了，一个七都没有」
       —— 卡片显示的「最大震度」取自 q.maxShindo。模拟面板现在会按
          Imax = min(7.4, 4+(M-5)·1.2) 算好传进来；但**直接调 __fireSim / 其它入口**
          可能不带 maxShindo，卡片就会退回 estimateRank 的点源公式（M8 只有 6弱）
          → 卡片 6弱、地图 7，又对不上。
       ⇒ 入口统一兜底：没给最大震度就按同一公式从震级算，
         保证「卡片 / 测站 / 地图」三个来源永远同值。
       ★ 2026-10-29: 对 liedu 模式同样做兜底计算，杜绝 AI 调用无震度值导致显示 "--" */
    if (q.maxShindo == null && q.shindo == null && (q.metric === 'liedu' ? q.liedu == null : true)) {
      var _Mm0 = Math.max(1, Math.min(10, +q.mag || 5));
      var _dep0 = Math.max(1, +q.depthKm || 10);
      if (q.metric === 'liedu') {
        var _lieVal = 6;
        try {
          if (global.QData && QData.estimateRank) {
            var _estL = QData.estimateRank(_Mm0, _dep0, q.lat, q.lon);
            if (_estL && _estL.liedu >= 1) _lieVal = _estL.liedu;
          } else if (global.QV_LIEDU && QV_LIEDU.codeOfI) {
            var _calcI = Math.min(7.4, 4.0 + (_Mm0 - 5.0) * 1.2);
            _lieVal = QV_LIEDU.codeOfI(_calcI);
          }
        } catch (eLie) { _lieVal = 6; }
        q.liedu = q.maxShindo = q.shindo = Math.max(1, Math.min(12, Math.round(_lieVal)));
      } else {
        var _I0 = isDeepSrc(q.depthKm) ? peakI(_Mm0, _dep0)
          : Math.min(7.4, 4.0 + (_Mm0 - 5.0) * 1.2);
        q.maxShindo = q.shindo = (_I0 >= 6.5) ? 70 : (_I0 >= 6.0) ? 65 : (_I0 >= 5.5) ? 60
          : (_I0 >= 5.0) ? 55 : (_I0 >= 4.5) ? 50 : (_I0 >= 3.5) ? 4 : (_I0 >= 2.5) ? 3
            : (_I0 >= 1.5) ? 2 : (_I0 >= 0.5) ? 1 : 0;
      }
    }
    /* ★★ 2026-11-03 天体模式：先把震源喂给 planet.js。
       放在【函数最开头】—— 后面那段 IIFE 里 genStations / 海啸判定在行星坐标下
       可能出岔子，任何一处抛异常都会把后面的 setQuake 一起跳过（用户报的
       「调 M9.9 根本没反应」就是这个）。这里包 try 且不依赖任何后续逻辑。 */
    try {
      if (global.QVPlanet && global.QVPlanet.isPlanet()) {
        global.QVPlanet.setQuake({ lat: q.lat, lon: q.lon, mag: q.mag, depthKm: q.depthKm }, true);
      }
    } catch (e) { }
    /* ★ 2026-10-22：开新一场之前先清掉上一场还没触发的「取消报 / 海啸」定时器，
       否则连点两次「开始模拟」会叠出两场海啸（实测：温州震源却出现了日本海测站名）。
       ★★★ 2026-10-26 用户：「新模拟开始的时候不覆盖旧模拟的数据，导致乱的一批」
       ⇒ 整个清理收敛到 simHardReset()（见上面的长注释）：定时器 + EEW 卡 + 色块 +
         上一场的海啸 + 上一场 inject 的假地震 + 测站/红叉/范围框/波圆 + 阶段标记。 */
    simHardReset();
    /* ★ 2026-10-25 用户：「开始模拟的时候为什么真实地震会抢信息栏啊」
       ⇒ 模拟期间挂一个 `V.simOn`，`onRealEew` / `applyMeasured` 看到就直接忽略，
         真实电文不能把模拟画面换掉。（模拟徽标「模拟画面」常驻到用户取消为止） */
    V.simOn = 1;
    /* ★★★ 2026-10-26 用户：「为什么自定义时间后上面更新的时间条没有跟着自定义时间走」
       ⇒ 模拟一开就把顶部时钟的基准换成自定义时刻（之前永远显示 system 当前时间）。
         时钟 = simTimeBase + (当前 - simTimeStart)，所以它会自己走，不是死值。 */
    V.simTimeBase = simTimeMs || 0;
    V.simTimeStart = Date.now();
    /* ★★ 2026-11-03：立刻注入震源数据（卡片 / 履历 / 地图全跟着动）。
       提到 IIFE 之前 —— 后面那段 genStations / 海啸判定在行星坐标下可能抛异常，
       一抛就把 inject 一起跳过（实测「卡片还显示地球的剑捉岛」就是这个）。 */
    if (global.QData && QData.inject) QData.inject(q);
    /* ★ 模拟开始 → 倒计时徽标不消失，改成常驻的「模拟画面」*/
    simBadgeRun();
    if (simTimer) { clearInterval(simTimer); simTimer = 0; }
    /* 模拟开始 → 切到第二个 tab（摇晃检测 / 紧急地震速报页），官方就是这么显示的 */
    var lv = (q.maxShindo >= 0 ? q.maxShindo : q.shindo);
    /* ★ 2026-10-23 模拟也带长周期階級：官方 VXSE45 会带 Lg，模拟数据没有 →
       按「最大震度 + 规模」估一个（**仅模拟**；真实 EEW 绝不伪造，只用 dmdata VXSE62）。 */
    if (q.maxLg == null) {
      /* ★★★ 2026-10-25 用户：「官方没有算最长地震周期，也就说明这次地震根本就没有达到」
         —— 長周期地震動階級 衡量的是**沉积盆地里传来的长周期成分**。
            小规模深源确实不发（2026 日本海北部 M5.6/350km、小笠原 M7.0/470km 官方都没有）。
           但大深源反过来：长周期能量传得更远（见下面 2026-10-26 的修正）。 */
      var _lgDep = +q.depthKm || 0;
      /* ★ 2026-10-25：不发时给 **-1**（不是 0）——
         下面 `lgv >= 0` 会把 0 当成「有階級」，然后用 sndl[max(1,0)] 画出
         **一张灰色的「1」卡片**（用户截图的那个灰卡）。官方只有 1~4 级。 */
      /* ★★★ 2026-10-25 按三份真实样本重新标定（此前 65→4 / 55→3 一档高）：
           熊本 M7.1 震度7        → 階級 4
           青森県東方沖 M7.5 震度6強 → 階級 3
           茨城/島根 震度5強       → 階級 2（官方常見）
           震度4 前後             → 階級 1
         ⇒ 门槛：70→4 / 60~65→3 / 50~55→2 / 40~45→1。 */
      /* ★★★ 2026-10-26 用户：「为什么深源 ≥150km 仍然不发长地震周期？
         2016 年小笠原 M8.0 深 600km，千里之外的四川都有震感 ——
         能量大、深度深的地震长周期成分反而更明显、覆盖范围更广」
         ⇒ 彻底去掉「按最大震度查表」和「深源一律不发」两条经验规则，
            改成用 **LPGM 公式**（絶対速度応答 Sv）+ 平野放大算全国最大值，
            见上面 lgpmSv / lgpmMaxRank 的推导与标定。 */
      var _lgRank = lgpmMaxRank(q);
      q.maxLg = (_lgRank > 0) ? _lgRank : -1;
    }
    /* ★★★ 2026-10-20 用户：「P 波甚至根本就没到第一个测站点，我们就把震中和强度
       精确算出来了 —— 不应该等 P 波到达第一个观测点之后才收到数据吗？」
       改：不再一按就开始出报，而是按「最近测站的 P 波旅行时」延迟首报。
       P 波平均速度取 7km/s（地壳近似）；模拟时间轴已经提前 6 秒（t0sim 注释），
       所以要减掉这 6 秒，最少保底 1.2 秒（否则一按就弹出来）。 */
    eewTimers.forEach(function (t) { clearTimeout(t); }); eewTimers = [];
    /* ★ 2026-10-20：先判断这一场是「紧急地震速报」还是「揺れを検出」
       （观测最大震度 < 3 ⇒ 官方只算检测到摇晃）。检测态**不画红叉、不画 P/S 波圆**，
       只用测站 + 范围框表示「这一片摇了」。 */
    var detPre = false;
    var firstDelay = 1200;      /* ★ 2026-10-22：提出作用域 —— 误报取消/海啸都要等首报之后排 */
    /* ★ 2026-10-28：模拟时间轴的「预滚」毫秒数。默认 0 → 用 6000ms；
       深源会被设成「P 波到达前 1.2 秒」（preRoll = travel − 1.2s）。 */
    var preRollMs = 0;
    (function () {
      var st0 = genStations(q.lat, q.lon, q.maxShindo, eewMetric(q), q.depthKm, q.mag)
        .sort(function (a, b) { return (a.hyp || 0) - (b.hyp || 0); });
      var obMax = 0;
      for (var i0 = 0; i0 < st0.length; i0++) if (st0[i0].shindo > obMax) obMax = st0[i0].shindo;
      /* ★★★ 2026-10-25 深源地震（≥150km）：官方在 EEW 阶段根本不发震度
         （样本《2026 日本海北部 M5.6 深350km》全程「深源地震震度不明」）。
         ⇒ 不走「观测 < 3 就只检测摇晃」那套：深源即使近场只有震度1，
           官方照样发紧急地震速报（震度栏写「不明」）。
         只有 M 太小的深源（<5.0）才不报 —— 现实中不会触发 EEW。 */
      var _deep = isDeepSrc(q.depthKm);
      q.deepSrc = _deep ? 1 : 0;
      /* ★ 深源同样先走「検測到揺れ」画面：样本 19:35:21 起地区列表不断增长，
         19:35:41 才第 1 报。fireSim 先铺检测态（无红叉），setEEW 首报时再切 EEW。 */
      detPre = _deep ? true : (obMax < 3);
      /* ★★ 2026-11-03 天体模式：火星 M4.7 在地球 GMPE 下算出的观测震度一定 < 3，
         会被判成「只检测到摇晃」→ 那条分支**故意不画红叉、不画 P/S 波圆**
         （用户报的「火星模拟直接没反应，红叉不见了」就是这个）。
         星球模式用等震环/测站自己表达强度，不走这套判定。 */
      if (global.QVPlanet && global.QVPlanet.isPlanet()) detPre = false;
      var dmin = st0.length ? (st0[0].hyp || 0) : 60;      /* 没测站就给个 60km 兜底 */
      /* ★ 首报时刻 = 「P 波走到最近一个测站」的时刻。
         模拟时间轴提前了 6 秒（见下面 t0sim），所以再减 6000ms。
         ⚠️ 2026-10-21：上一版我给它压了 8 秒上限，结果远海震源（最近测站 242km）
           在 P 波还没到任何测站时就触发了 setEEW —— 用户抓到
           「P 波和 S 波都没到达任何一个测站，警报却一直在跳动」。
           ⇒ **上限撤掉**，严格等物理到达。等得久是正常的（震源在海域本来就慢），
             总比凭空预报强。
         ★★★ 2026-10-25：波速近似全部换成 **JMA2001 官方走时表**（travelSec）。
           固定 6.0 km/s 在深源会算得太早：日本海北部 M5.6/深 350km，
           最近测站震中距 ~90km、震源距 362km，P 波实际 ~45 秒；
           用 90/6 = 15 秒会「P 波还差 30 秒就开始报」。
           样本实测：19:35:21 首次检测到摇晃 → 19:35:41 第 1 报（约 20 秒）。 */
      var _depQ = +q.depthKm || 0;
      var _epi0 = Math.sqrt(Math.max(0, dmin * dmin - _depQ * _depQ));
      var delay = Math.max(1200, Math.round(travelSec(_depQ, _epi0, true) * 1000) - 6000);
      /* ★★★ 2026-10-28 用户纠正：「深源那个紫圈是加载动画；模拟开始时间应该是
         P 波出现前 1 秒，不然难道 P 波都没出来就检测到地震？」
         ⇒ 时间轴往回拖到「P 波到达前 1.2 秒」：
            · preRoll = travel − 1.2s（t0sim 用它，不再固定 −6000）
            · delay  = 1.2s（P 波一到就发首报）
            · 这 1.2 秒里地图上是「红叉 + 紫色加载圆弧」 */
      if (isDeepSrc(_depQ)) {
        var _tvMs = Math.round(travelSec(_depQ, _epi0, true) * 1000);
        preRollMs = Math.max(1200, _tvMs - 1200);
        delay = 1200;
      }
      /* ★★ 2026-11-03 天体模式：dmin 是拿【地球测站表】算的 —— 火星坐标最近的地球测站
         在几千公里外 → 首报要等好几分钟，用户看到的就是「点了开始模拟根本没反应」。
         行星上没有地球测站，这个物理延迟不成立，直接立即出报。 */
      if (global.QVPlanet && global.QVPlanet.isPlanet()) delay = 300;
      firstDelay = delay;
      /* ★ 调试探针：首报延迟到底算了多少（st0 已按 hyp 升序，dmin 应 = 最近测站距离） */
      V._simInfo = { nObs: st0.length, dmin: Math.round(dmin), epi: Math.round(_epi0),
        delay: delay, deep: _deep, obMax: obMax, detPre: detPre, t: Date.now() };
      /* ★ 2026-10-22：误报不跑正常报文循环（它有自己的「单点异常→全图拉满→取消」剧本） */
      /* ★★★ 2026-10-25 用户：「检测到摇晃和页面和音效，现在我们就做了非常小的，
         稍微大一点就使用不了，检测到就直接紧急地震速报了」
         —— 真因：setEEW 里 kind 是拿【波前已到达测站的最大震度】判的，
            而首报时波前刚好包住最近那个测站 → 大地震那个站直接震度5/6 →
            kind 一上来就是 'eew'，检测态一次都不出现。
         修法：首报**一律先进检测态**，至少持续 detHold 秒（模拟时间）再升级。
         官方也是这样：先看到几个点在摇，几秒后解算出规模才发 EEW。 */
      /* ★★★ 2026-10-25 用户：「你这方框，他妈的外围一圈震度二，里面全都是五弱六弱，
         等了整整 4-7 秒才发紧急地震速报，这在现实中会被打死的」
         ⇒ 检测态已经从「只对小震生效」改成「所有规模都走」了，5 秒太长。
           现实中 JMA 从第一个测站检测到 P 波到发第 1 报约 2 秒左右，
           而且**震度越大发得越快**（强震用少量测站就能定级）。 */
      q.detHold = (q.detHold != null) ? q.detHold : 0.4;
      /* ★ 2026-10-25 天体模式不套用地球这套「先检测再速报」：行星上没有 1748 个地球
         测站，「揺れを検出」这个产品本身就不存在 → 直接进速报态。 */
      if (global.QVPlanet && global.QVPlanet.isPlanet()) q.detHold = 0;
      /* ★ 2026-10-25 深源：官方确实先有一段「検測到揺れ」再发「深源地震震度不明」
         （样本 19:35:21 起连续更新地区列表，19:35:41 才第 1 报）。
         但深源永远升不到震度3 → 升级条件必须在 bumpEEW 里特判（见 E.deepSrc）。
         这里保留一个很短的检测窗口，别让它卡在检测态。 */
      if (_deep) q.detHold = Math.min(2.0, Math.max(0.4, +q.detHold || 0.4));
      /* ★★★ 2026-10-28 用户（官方 4 帧连拍）：「深源是红叉 + 紫色加载圆弧」。
         —— 检测态会 pinsOff（setBoxes/setDetectMode 强制清掉红叉），
            所以深源**不走检测态**：直接进速报画面（红叉 + 加载动画）。
            首报仍然在 P 波到达那一刻（delay = 1.2 秒）。 */
      if (_deep) { q.detHold = 0; detPre = false; }
      /* ★ 2026-10-25：既然要先走检测态，视觉也必须是检测态的（不画红叉/波圆，
         改用官方矩形范围框 + 含震度0的测站集）。以前 detPre 只看 obMax<3，
         所以中大型地震一开始就直接是 EEW 画面。 */
      if (q.detHold > 0) detPre = true;
      V._simInfo.detPre = detPre;
      V._simInfo.detHold = q.detHold;
      if (!q.simCancel) {
        /* ★ 2026-10-25 右上角「预计 X 秒后进入下一个阶段」：首报前的目标时刻 */
        V.simEtaMs = Date.now() + delay;
        eewTimers.push(setTimeout(function () { setEEW(q, lv); }, delay));
      }
    })();
    /* ══ 2026-10-22 预置开关①：误报取消 ══
       用户：「地震误报怎么可能自己手动触发？当然是开始之前就填好的」，
       并且给出了真实现象：「只有一两个测站突然变成很大的异常值，然后整个地图
       突然就填满，后面再变成误报」。⇒ 走 fireFalseAlarm 的专用剧本，不走正常波圈。 */
    if (q.simCancel) {
      fireFalseAlarm(q, lv, firstDelay);
      return;
    }
    /* ══ 2026-10-22 预置开关②：触发海啸预警 ══
       条件（用户给的规则）：不是内陆深处 && 规模够大 && 深度不深。
       用户又补充：「海啸预警应该是地震震完之后、调查出结果才弹出来」
       ⇒ 这里只做判定 + 挂起，真正的注入放在 setEEW 的 final（各地震度情報）之后。 */
    if (q.simTsuAuto) {
      var tsuTerr = simTerrain(q.lat, q.lon);
      var tsuWhy = simTsuVeto(q, tsuTerr);
      V._simTsu = { terr: tsuTerr, why: tsuWhy, mag: q.mag, dep: q.depthKm };
      if (tsuWhy) {
        toast('不会发布海啸预警（模拟）：' + tsuWhy);
      } else {
        V._simTsuPlan = { q: q, terr: tsuTerr };
      }
    }
    V._simTsuSent = 0;
    V._simTsuInit = 0;
    if (global.QData && QData.inject) QData.inject(q);
    /* ★★ 2026-11-03 天体模式：模拟开始 → 直接把震源交给 planet.js，
       由它自己算等震环/测站/红叉。不依赖 cnFill（那条路在模拟态下根本不会走）。 */
    if (global.QVPlanet && global.QVPlanet.isPlanet()) {
      global.QVPlanet.setQuake({ lat: q.lat, lon: q.lon, mag: q.mag, depthKm: q.depthKm });
    }
    if (global.QVRedraw) QVRedraw();
    if (global.QVMapCam) {
      var t0sim = Date.now() - (preRollMs > 0 ? preRollMs : 6000);
      V.simT0 = t0sim;      /* 检测→速报切换时要用同一条模拟时间轴 */
      /* ★ 模拟时间轴：官方第 1 报大约在发震后 6 秒发布 ⇒ 把基准前6秒，
         这样第一报出来时最近的测站已经因 P 波到达而亮起（不会白等十几秒） */
      if (!detPre) {
        if (QVMapCam.setBoxes) QVMapCam.setBoxes(null);
        if (QVMapCam.lockPin) QVMapCam.lockPin([{ lat: q.lat, lon: q.lon, kind: 'eew' }]);
        /* ★ lockPin 只存数据，还得主动推给 pin 层一次 ——
           而 view1（EEW 页）走 drawEEW 提前 return，render3 那帧不会调 setPins，
           不主动推就永远是 display:none（用户：「红叉不见了」） */
        if (QVMapCam.setPins) QVMapCam.setPins([{ lat: q.lat, lon: q.lon, kind: 'eew' }]);
        /* ★ 官方「自动镜头」：按 30 秒后的 S 波圈（填色圆）取景
           —— 与官方 EEW 截图的取景比例一致（圆半径约占可视宽 30%，红叉约 8%）
           ★ 2026-10-25 深源同上：30 秒时波还没出地表，半径=0 → 用 dep/4+20 秒。 */
        var _tFit = Math.max(30, (+q.depthKm || 0) / 4 + 20);
        var kmS = QVMapCam.jma2001Dist ? QVMapCam.jma2001Dist(_tFit, q.depthKm, false) : 0;
        if (!(kmS > 1)) kmS = Math.max(200, (+q.depthKm || 0) * 0.75);
        /* ★ 2026-10-27 用户：「其他地震完全没生效」—— 以前开场用「30 秒后波圈半径」
           反算 k（M7 只有 0.44，整个日本都进去了）。改成和后面同一条标本：EEW = 1.08。 */
        if (QVMapCam.requestMove) camMoveK(q.lat, q.lon, CAM_K.eew);
        else if (kmS > 1 && QVMapCam.fitCircle) QVMapCam.fitCircle(q.lat, q.lon, kmS, 0.30);
        if (QVMapCam.simWave) QVMapCam.simWave({
          lat: q.lat, lon: q.lon, t0: t0sim, level: q.maxShindo, mag: q.mag,
          depth: q.depthKm, autoFit: false,   /* ★ 圆长大时不要再自动跳档（用户：「摄像机一放就像瞬移」） */
          /* ★ 2026-10-28：深源（≥150km）走「未闭合白圆弧 → 闭环 = S 波到」的官方画法 */
          deep: isDeepSrc(q.depthKm) ? 1 : 0
        });
      } else {
        /* —— 检测态：只表示「这一片站点在摇」—— */
        V._detFrmR = 0; V._detFrmAt = 0;      /* 新一场：镜头允许重新取景 */
        if (QVMapCam.setBoxes) QVMapCam.setBoxes(null, true);
        if (QVMapCam.lockPin) QVMapCam.lockPin(null);
        if (QVMapCam.setPins) QVMapCam.setPins([]);          /* 清掉上一场留下的红叉 */
        /* ★ 2026-10-28 用户（官方深源截图）：「应该是红叉 + 红叉大小的圆」
           —— 深源（≥150km）在检测态就把红叉钉住：P 波要几十秒才到地表，
              这段时间里官方画面上已经有震源红叉 + 未闭合的白圆弧了。 */
        if (isDeepSrc(q.depthKm)) {
          var _dpin = [{ lat: q.lat, lon: q.lon, kind: 'eew' }];
          if (QVMapCam.lockPin) QVMapCam.lockPin(_dpin);
          if (QVMapCam.setPins) QVMapCam.setPins(_dpin);
        }
        /* 镜头对准震源（不拟合波圈：检测态没有圆） */
        /* ★ 2026-10-27 改用标本倍率（检测 = 1.60），不再让 focus() 自己选档 */
        if (QVMapCam.requestMove) camMoveK(q.lat, q.lon, CAM_K.detect);
        else if (QVMapCam.focus) QVMapCam.focus(q, true);
        /* ★ 还是需要一条「时间轴」：测站按 P 波到达逐点出现（不能一开场就全亮）。
           rings:false = 只要时钟，不画 P/S 波圆。 */
        if (QVMapCam.simWave) QVMapCam.simWave({
          lat: q.lat, lon: q.lon, t0: t0sim, level: q.maxShindo, mag: q.mag,
          depth: q.depthKm, autoFit: false, rings: false,
          deep: isDeepSrc(q.depthKm) ? 1 : 0 });
      }
      /* 观测点：官方 1748 个真实测站，按震中距衰减算震度（不再自己撒点）
         ★ 传 t0 给 mapcam：测站要等 P 波真的到了才点亮（不能凭空提前预判）
         ★ 检测态用 .det（含震度0的点）—— 用户：「地图上显示的应该是震度0的震点」 */
      var gs = genStations(q.lat, q.lon, q.maxShindo, eewMetric(q), q.depthKm, q.mag);
      if (QVMapCam.setStations) QVMapCam.setStations(
        (detPre && gs.det && gs.det.length) ? gs.det : gs,
        { t0: t0sim, depth: q.depthKm, metric: eewMetric(q) });
      /* ★★★ 2026-10-27 用户：「为什么刚刚开始的时候没有圆或者方框显示啊」
         —— 检测态对象 V.eew 以前要等 setEEW（delay 1.2~2.6 秒后）才建出来，
            这段时间地图上只有测站点：既没有「揺れを検出」方框、也没有検出円。
          ⇒ 模拟一开始就先把检测态对象建好并画一次（框/圆立刻出现），
            delay 到了 setEEW 会重建这个对象并接管，两边的绘制逻辑是同一套。 */
      if (detPre && !V.eew) {
        try {
          var _E0 = {
            kind: 'detect', q: q, place: q.place || '模拟震源', timeMs: q.timeMs,
            mag: q.mag, depth: q.depthKm, level: 0, metric: eewMetric(q),
            report: 1, areas: [], allAreas: [], obs: gs,
            lat: +q.lat, lon: +q.lon, simT0: t0sim, detLv: 0,
            detHold: (+q.detHold || 0), detWall: Date.now(), repBase: 0, plan: 1,
            magT: q.mag, depT: q.depthKm, lvT: q.maxShindo,
            ladI0: 0, ladIT: 0, ladStep: 1,
            maxLg: (q.maxLg != null ? q.maxLg : -1)
          };
          V.eew = _E0;
          rebuildAreas(_E0, (QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0);
          if (global.QVRedraw) QVRedraw();
        } catch (eD0) { V.eew = null; }
      }
    }
    toast((detPre ? '检测到摇晃（模拟）：' : '紧急地震速报（模拟）：') + q.place + ' M' + q.mag.toFixed(1) + ' · 深度 ' + q.depthKm + 'km');
  }
  /* ---- ④ EEW 页（第二 tab：摇晃检测/紧急地震速报） ---- */
  /* 官方素材（costume → clean/<hash>.svg，来自 reference/project.json UI 造型表）*/
  /* ⚠ 图片 URL 必须带版本号：clean/ 素材改过很多轮，浏览器按 URL 缓存，
     不加 ?v= 就会一直拿旧的（含日文文字的版本）。 */
  var EEW_V = '?v=20261029d';
  var EEW_ART = {
    paet: 'assets/clean/6d5a51667a8e3ae854581d061ada678f.svg' + EEW_V,     /* paEt0 予報/警報小标 */
    /* ★ paSu = 「推定 / 最大震度」白字图（208×80）—— 官方 EEW 卡片上的字就是它，
       震度 2/3/4 时官方用 BRIGHTNESS 把它刷成深色（与 sndm 文字色表一致） */
    paSu: 'assets/df478812303d1381a322df63b5203338.svg',
    paSs: 'assets/5c2247d18f3a419fadb9c1121eff15fb.svg',            /* paSs = 「最大震度」非推定版 */
    /* ★★★ 2026-10-21 用户：「你完全没查官方的卡片样子啊，乱拼的」
      官方「震度速报（调查中）」卡片 = **整张底图** paIbg130（264×302），
      「震源・規模　調査中」是**烧在 SVG 里的字**，不是 CSS 拼出来的。
      所以 info 态直接把 .bg 换成这张图，手拼的 .mag/.dep 行全部隐藏。 */
    paIdbg: 'assets/00106c497dabb854a11d34887de29fd4.svg',
    /* ★ paIti1 = 「ⓘ 震度速報」标题条 224×32（透明白字+圆徽章，无底色）
       官方 `paIbg130` 自己画了 #31476d 的标题条，`paIti1` 正好盖在它上面
       （画布 x20..244 y21..53），所以直接用官方图，不拿字体凑。 */
    paItiSokuho: 'assets/b343ac739a817b60edc3d843200d0fc3.svg',
    /* ★ paIts2 = 「津波　調査中」228×60 灰底圆角条（整图，白字烧在图里）
       同系列：paIts0 津波の心配なし / paIts1 津波 不明 / paIts30・31 若干の海面変動
                paIts40・41・42 津波警報・注意報（蓝/黄/红） */
    paTsuInq: 'assets/a9498eee411ca14cdff2d872c7465430.svg',
    /* ═══ 2026-10-21 阶段推进（VXSE52 / VXSE53）═══
       官方把「情报页」做成了一整套同族素材，标题图 × 底图一一对应：
         paIti1 ⓘ 震度速報      → paIbg130（264×302，字烤死）
         paIti2 ✕ 震源情報      → paIbg138（224×276，**纯色卡，一个字都没烤**）
         paIti3 ⓘ 各地の震度情報 → paIbg172（264×376）
         paIti4 🌐 遠地地震情報  → paIbg180/200
         paIti8 ⌛ 遠地噴火情報  → paIbg208
       ⇒ info → jishin（震源情報）→ final（各地の震度情報），各播 VXSE52 / VXSE53。 */
    paItiShingen: 'assets/3bac9d93a0529892687ca43030b8adb8.svg',  /* paIti2 ✕ 震源情報 224×32 */
    paBkgShingen: 'assets/221198dc35c78ed67827e8942621b84c.svg',  /* paIbg138 224×276 */
    paItiChii: 'assets/d1f3e6e993602ac52320c89b3188e54e.svg',     /* paIti3 ⓘ 各地の震度情報 224×32 */
    paBkgChii: 'assets/79663611b166d1cf1ea497e4f74f1d4c.svg',     /* paIbg172 264×376 */
    paSsl: 'assets/537a728a2acd6e9a8a2857ec8e818ae8.svg',            /* paSsl = 副卡文字（长周期） */
    paem: 'assets/135f29ef05d3c18d19dcd4b59ecdee27.svg',       /* paEm0 文言：緊急地震速報(予報)発表 / 揺れに注意してください（原版整图，不擦字）*/
    /* ★ 官方文言是**整图素材**（paEm0..paEm9，每种声明一条），不是用字拼的。
       之前我把 paEm0 擦成空壳再自己写中文 → 用户：「狗来看了也肯定不是官方的素材」。
       paEm0 予報白字 / paEm2 警報黄字 / paEm3 特别警报红字 / paEm4 海啸黄字。*/
    paemY: 'assets/135f29ef05d3c18d19dcd4b59ecdee27.svg',   /* 予報：緊急地震速報(予報)発表 / 揺れに注意してください */
    paemR: 'assets/49d77a10dde77750a30431179acddf61.svg',   /* 警報：緊急地震速報(警報)発表 / 強い揺れに警戒してください */
    /* ★★★ 2026-10-25 深源地震专用文言（官方 paEm7，原图像素）：
       「震源が深いため震央から遠い場所で / 揺れが大きくなることがあります」
       —— 这就是官方在深源地震（異常震域）时显示的那张，不能自己写中文。 */
    paemDeep: 'assets/106d6eff477cd62e0008bef153b72899.svg',
    /* ★★★ 2026-10-25 官方「深発地震のため 震度不明」整图（sndhs，208×80 透明文字层）
       用户截图指定：深源地震的震度块就是这张，不是 paSc-1 + 文字自己拼。
       官方结构 = paSc-1 灰蓝底板 + sndhs 文字层（两张 208×80 重叠）。 */
    sndhs: 'assets/4a7ba9c94fb7269ac9403a59ece5d88f.svg',
    paem3: 'assets/86b72d6beec5e7dc4c0aa6defe44d129.svg',   /* 特别警报：…身の安全を確保してください */
    /* ★★★ 2026-10-27 用户：「大地震最下面的小字其实会变成
       「緊急地震速報の特別警報です身の安全を確保してください」、
       官方有更多的状态，你可以在素材库找找」
       —— 素材库 `UI` 里确实有 11 张文言整图（paEm0..paEm9 + paEmag），
          以前只用了 3 张。实测文案：
            paEm0 緊急地震速報(予報)発表 / 揺れに注意してください        （白）
            paEm1 緊急地震速報(予報)発表 / 今後の情報に注意してください   （白）
            paEm2 緊急地震速報(警報)発表 / 強い揺れに警戒してください     （黄）
            paEm3 緊急地震速報の特別警報です / 身の安全を確保してください （红）
            paEm4 津波発生の可能性があります / 海岸から離れてください   （黄）
            paEm5 使用されている観測点が少ないため震源の精度が低い可能性があります
            paEm6 観測点が少ない地域のため震源の精度が低い可能性があります
            paEm7 震源が深いため震央から遠い場所で揺れが大きくなることがあります
            paEm8 大きな加速度が検出されたため震度5弱と仮定して発表されています
            paEm9 リアルタイム震度から直接推定された震度が発表されています
            paEmag 空（透明）＝ 文言なし */
    paemSpecial: 'assets/86b72d6beec5e7dc4c0aa6defe44d129.svg',  /* paEm3 特别警报（红） */
    paemFew: 'assets/85d0f3b5471f4fe6e088610868ae7118.svg',      /* paEm6 观测点少 → 震源精度低 */
    paemFewAll: 'assets/9f29364d25d5f2a0850452ee142fecb7.svg',   /* paEm5 使用中的观测点整体偏少 */
    paemTsu: 'assets/cde424765e966b34418fe7b9e0425952.svg',      /* paEm4 可能发生海啸 */
    paemNext: 'assets/6db7069fb1054b12aa4487abb069aed1.svg',     /* paEm1 予報・今後の情報に注意 */
    paemNone: 'assets/c2f4902a1ce5639e8449876f52079142.svg',     /* paEmag 空（透明） */
    /* ★★★ 2026-10-27 官方文言的中文版（1:1 对照）
       官方那 11 张是**整图**（字烧进 path），没法改字；
       所以中文版自己画，几何完全照官方：画布 196×34、两行、
       字色从官方 SVG 里取的：白 #dbe9ff / 黄 #ffd253 / 红 #ff4b41。
       索引与 paEm0..paEm9 一一对应。 */
    paScl0: 'assets/clean/2904168a76642baaf0c460cb090557fb.svg',   /* 下方震度小卡底 */
    /* ═══ 2026-10-23 长周期地震动階級（官方高版卡）═══
       官方同族：paEEW4 予報 / paEEW5 警報（264×500 高版底图，比 388 多出一条副卡位）
                paScl0..4 = 副卡色块（0 灰 / 1 黄 / 2 橙 / 3 紫红 / 4 品红）
                sndl1..4  = 副卡大号数字（40×40，在 assets 根）
                paSul     = 「推定 / 最大長周期地震動階級」标签（已清洗，中文自己画） */
    paEEW4: 'assets/clean/7841e6168cf9160491548af108cc3277.svg' + EEW_V,
    paEEW5: 'assets/clean/0d7617bbba500cae48121816daec4c19.svg' + EEW_V,
    paScl: {
      '0': 'assets/clean/2904168a76642baaf0c460cb090557fb.svg',
      '1': 'assets/clean/c7b18ca7d9c300561029ea82155fb866.svg',
      '2': 'assets/clean/ede0dee1b0d4e746895a78ccc9da6132.svg',
      '3': 'assets/clean/e80c3a0ad5d62f9a4156dbd1da71d29c.svg',
      '4': 'assets/clean/ca4af7620e45f5335c1e4257063a9bab.svg'
    },
    sndl: {
      '1': 'assets/0ee0893ca7aeeba13c4ea75c9db0a108.svg',
      '2': 'assets/caa85bfa03187ece11e88406a35c14fa.svg',
      '3': 'assets/a15ecaff1d117cb468d5a703802cc24f.svg',
      '4': 'assets/e7c106f0f4bdbba4ea15a2308f99e32d.svg'
    },
    paSul: 'assets/clean/5276897af83021a685a4b1ed150ef938.svg',    /* 同上色块 */
    sndl1: 'assets/0ee0893ca7aeeba13c4ea75c9db0a108.svg',        /* sndl1 小号震度数字（在 assets 根，不在 clean） */
    dbg: 'assets/clean/faaafeec4914e6d4205f6a5493be8447.svg' + EEW_V,      /* paDbg0 揺れ検出列表底 224x356 */
    /* sndm0..9 —— 官方列表左侧的震度小方块（带数字），与 QV_SC_SUF 后缀一一对应 */
    sndm: {
      '0': 'assets/a5ad1bdb70c66df888d94edd5bb94d15.svg',
      '1': 'assets/52c4c9be07a15659419060c25ec88b0b.svg',
      '2': 'assets/5965683a2a9dfbda4d224a8e439d75f2.svg',
      '3': 'assets/8cfc17c977927bd0e08214b6692b41c2.svg',
      '4': 'assets/68aeee8441b0d3b4256cf07f68d93073.svg',
      '5': 'assets/6b7b9fd655f1f25abe551627c637dc41.svg',
      '6': 'assets/165e55dbab7e4fa9370667803011853c.svg',
      '7': 'assets/8e9d846286811e4870715d35982d6f3f.svg',
      '8': 'assets/38c5b903d0c8854e9e0c190e5025a1ba.svg',
      '9': 'assets/ea46bab1608ebc3987d0888a763d99b0.svg'
    }
  };
  var EEW_BG = { y: 'assets/clean/283df601aa95d55fc592957beda35665.svg' + EEW_V, r: 'assets/clean/a45f398fc0004e93771dc78387d7bedc.svg' + EEW_V };
  var eewTimers = [];
  /* ★★ 2026-10-22：模拟的「海啸情报」「误报取消」定时器**不能**放进 eewTimers ——
     setEEW() 每次进入都会 `eewTimers.forEach(clearTimeout)`，首报一跑就把它们全清了
     （实测：条件判定通过、却永远等不到海啸）。用独立数组。 */
  var simAux = [];
  function simAuxClear() {
    for (var i = 0; i < simAux.length; i++) clearTimeout(simAux[i]);
    simAux = [];
  }
  /* ★★★ 2026-10-26 用户：「为什么新模拟开始的时候不覆盖旧模拟的数据，导致乱的一批」
     ⇒ 开新一场之前必须把上一场的**所有可见状态**清干净。以前 fireSim 只清了
       V.eew / 区域色块 / 模拟定时器，下面这些全留在画面上 → 新旧叠在一起：
         · 上一场发布的海啸（QData 的 SIM.tsunami）→ 海啸页、海岸线上色、
           海啸卡片一直挂着（新一场明明没有海啸）
         · 上一场 inject 的假地震还留在 st.pushed → 「地震历史」里堆一串模拟震源，
           而且履历当前项还指着旧的那条 → 卡片显示的是上一场
         · 上一场的测站点 / 一区一标 / 红叉 / 范围框 / P-S 波圆
         · 上一场残留的阶段标记（V._simStage / V._frameStage / V._frameTiers）
           → 新一场第一次取景会误判成「同一阶段」而不重新取景
         · 「调查中」卡的去重签名 / 可见计时 → 新一场第一报可能不弹不响
     （设置页「清除全部模拟」按钮做的正是同一批事，但只在用户手点时执行） */
  function simHardReset() {
    simAuxClear();
    eewTimers.forEach(function (t) { clearTimeout(t); }); eewTimers = [];
    if (V._obsTick) { clearInterval(V._obsTick); V._obsTick = 0; }
    /* —— 阶段 / 卡片 / 阶梯 / 海啸计划 —— */
    V.eew = null;
    hideDetCircle();
    V.__skipStage = null;                  /* 上一场的「Enter 跳过阶段」闭包作废 */
    V._simStage = null; V._frameStage = null; V._frameTiers = null;
    V._simTsuPlan = null; V._simTsu = null;
    V._simTsuSent = 0; V._simTsuInit = 0;
    /* ★ 2026-10-26：海啸 9 阶段的状态也要清（否则新一场从上一场的第 N 阶段接着走） */
    V._tsuStages = null; V._tsuStage = -1;
    V._tsuShown = 0; V._tsuSrcQ = null; V._tsuInitial = 0;
    if (V._tsuTmr) { clearTimeout(V._tsuTmr); V._tsuTmr = 0; }
    V._tsuVia = null; V._tsuLv = null;
    V._detFrmR = 0; V._detFrmAt = 0; V._detFrmDone = null;
    V.simT0 = 0; V.simEtaMs = 0;
    V._inqSeenMs = 0; V._inqVisFrom = null; V._inqTabAt = 0;
    _inqSig = ''; _inqShotAt = 0;
    /* —— 数据层：模拟海啸 + 所有假地震（clearSim 自带 rebuild，履历里的模拟条目一起消失）—— */
    if (global.QData) {
      if (QData.simTsunami) QData.simTsunami(null);
      if (QData.clearSim) QData.clearSim();
    }
    /* —— 地图层 —— */
    if (global.QVMapCam) {
      if (QVMapCam.stopSimWave) QVMapCam.stopSimWave();
      if (QVMapCam.lockPin) QVMapCam.lockPin(null);
      if (QVMapCam.setBoxes) QVMapCam.setBoxes(null);
      if (QVMapCam.setPins) QVMapCam.setPins([]);
      if (QVMapCam.clearStations) QVMapCam.clearStations();
      if (QVMapCam.setAreaFill) QVMapCam.setAreaFill(null);
    }
    if (global.QVShindo) {
      if (QVShindo.clearPoints) QVShindo.clearPoints();
      if (QVShindo.set) QVShindo.set([]);
    }
    /* 还停在上一场的海啸页 → 退回速报页（否则新一场从「暂无海啸信息」的海啸页起步，
       看着就像没换场） */
    try { if (V.view === 2) setView(1); } catch (eVR) { }
    if (global.QVRedraw) QVRedraw();
  }
  /* ★★★ 2026-10-21 按用户《音效对应.xlsx》：
     VXSE51 = 「调查中」卡片的弹出/更新音（koneew 只有这个阶段）
     VXSE52 = 调查完成后更新「地震情报」    → 留接口
     VXSE53 = 「地震情报」后的「地震正式报」→ 留接口
     素材已统一放进 assets/sounds/<音效名>.mp3（见 dev/音效对照表.md） */
  function playSokuhoSe() {
    if (global.QVSpeak && global.QVSpeak.infoSe) global.QVSpeak.infoSe('checking');
  }
  /* ★★★ 2026-10-26 用户：「一般调查中确实会反复弹，因为这个时候气象厅还在收集测站数据，
     来计算这次地震的规模和深度，这个计算需要时间，但是呢，每个区域的最大震度
     都是已经摆在这了，所以气象厅一般都会在调查中的卡片段，
     不断更新 1~5 个行政区域的最大震度」
     ⇒ 每算出一批新的行政区震度就刷新卡片并弹一下（不是只弹一次）。 */
  /* ★ 模拟 IPF 逐步收敛：每 stepMs 放出一批行政区（共 5 批），每批刷新+弹一次 */
  function advanceIpfBatch(E) {
    var ipf = E && E.ipf;
    if (!ipf) return;
    var el = Date.now() - ipf.t0;
    var want = Math.min(ipf.maxBatch, 1 + Math.floor(el / Math.max(1000, ipf.stepMs)));
    /* ★ 2026-10-28：这里原来会 `_inqSig = ''`（强制下一报必响）。
       但 batch 只是「左侧列表截断」用，画面未必真变 → 造成凭空连响。
       现在不强制作废，完全交给 refreshInqCard 的「看得见的内容」去重。 */
    if (want !== ipf.batch) ipf.batch = want;
  }
  /* ★ IPF 逐步收敛驱动：每 stepMs 把 ipf.batch +1，直到 maxBatch。
     batch 变了 → rebuildAreas 里 E.areas 就多一个行政区 → 卡片更新；
     同时弹一下卡片（用户：「调查中确实会反复弹」）。 */
  function growIpf() {
    if (!V.eew || !V.eew.inq || !V.eew.ipf) return false;
    var ip = V.eew.ipf;
    /* ★ 现在驱动的是【震度等级梯子】：gi 从 0（只画震度7）一级一级往下降。 */
    var gl = ip.grades || [];
    if (!gl.length) return false;
    if ((ip.gi || 0) >= gl.length - 1) return false;           /* 已降到最低级 */
    simAux.push(setTimeout(function () {
      if (!V.eew || !V.eew.inq || !V.eew.ipf) return;
      V.eew.ipf.gi = Math.min(gl.length - 1, (V.eew.ipf.gi || 0) + 1);
      /* 左侧列表的「分批」照旧推进（E.areas 截断用） */
      V.eew.ipf.batch = Math.min(V.eew.ipf.maxBatch || 5, (V.eew.ipf.batch || 1) + 1);
      try {
        var _wv = (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0;
        rebuildAreas(V.eew, _wv);
      } catch (e2) { }
      /* ★ 每降一级：提示音 + 地图色块刷新（不弹视图，见 refreshInqCard 的说明） */
      var _inqChanged = refreshInqCard(V.eew);
      /* ★★★ 2026-11-03 用户：「调查中确实可以发海啸，但是都沒调查完……
         调查中有新区块渲染应该会短暂的跳到调查中的卡片，但你这个都没有」
         —— 海啸已经发布并停在 Tab2 时，调查中每铺出一批新色块就短暂回 Tab1 4 秒，
            让用户真的看见色块在长；4 秒后回到原来的海啸页。
            （refreshInqCard 返回 true = 画面真的变了，才跳，避免无变化乱闪） */
      if (_inqChanged && V.view === 2 && V._tsuShown) {
        try { flashView(0, 4000, 2); } catch (eFVq) { }
      }
      /* ★★★ 2026-10-28：色块每次多铺一级 → 包围盒变化 → 立刻重取景。
         以前只有「来新报」时才 autoFrame，调查中后段没有报文 → 画面一直不动。 */
      try { autoFrame(V.eew); } catch (eAFg) { }
      growIpf();                                                /* 继续降下一级 */
    }, ip.gstepMs || 1500));
    return true;
  }
  var _inqSig = '', _inqShotAt = 0;
  /** ★★★ 2026-10-25 用户：「调查中会凭空响几下，明明地图都没更新，也没有什么情报」
   *   ⇒ 签名必须 = 屏幕上真的看得见的东西：
   *      ① 卡面震度档位（QV_SC_SUF）
   *      ② 地图上**真正铺出来**的行政区集合（等级 ≥ 调查中填色门槛）
   *     以前只看 `ipf.gi`（梯子走到第几级）：梯子往下走一级，但那一级根本
   *     没有行政区 → 地图一个像素都没变，声音照样响 = 「凭空响」。
   *     另外 `E.areas` 也不能当签名：每来一报它就会长长一点，而地图/卡面没变。
   */
  /** 刻度感知的「档位文本」：震度走 QV_SC_SUF（5弱/6強…），烈度直接用整数度。
   *  ★ 2026-10-28：凡是要拿档位做签名/去重的地方都必须走它，
   *    不能无条件套 QV_SC_SUF（烈度 9 会被当成震度 9）。 */
  function lvKeyOf(lv, metric) {
    var v = +lv || 0;
    if (metric === 'liedu') return 'L' + Math.round(v);
    return (global.QV_SC_SUF && lv != null) ? String(QV_SC_SUF(v)) : String(v);
  }
  function inqSigOf(E) {
    if (!E) return '';
    /* ★ 卡面档位也用「实测最大值」（同 iqLevelOf）：卡变了就该响，卡不变就不该响。 */
    var _lvSig = inqLevelOf(E);
    /* ★★★ 2026-10-28 用户：「烈度区的调查中映射表也没搞吧」
       —— 这里以前无条件用 `QV_SC_SUF(lv)`（那是**震度码 → 后缀**的表）：
          烈度 9 丢进去会得到震度 9 的后缀（根本不存在）→ 签名错乱，
          调查中的更新音去重也跟着错。烈度区直接用自己的整数值。 */
    var grade = lvKeyOf(_lvSig, E.metric);
    /* ★★★ 2026-10-26 用户：「调查中很多都是地图没反应、就一个音效」
       —— 以前这里用 `V.eewAreas()`（按 ipf 等级梯子过滤的列表）做签名，
          但**地图填色用的是另一条口径**：`E.fillAreas.filter(fillable)`，
          门槛看的是 `E.fillStage`（inq2/inq3），根本不看 ipf.gi。
          ⇒ ipf.gi 往下走一级 → 签名变、音效响，而地图一个像素没变。
       ⇒ 签名必须取「**刚刚真的交给地图的那一批**」：setEEW/rebuildAreas 里
          把最终交给 setAreaFill / QVShindo.set 的数组存到 E.fillShown。 */
    var vis = E.fillShown;
    if (!vis) return grade + '|none';
    var parts = [];
    /* ★★★ 2026-10-26 用户：「调查中很多都是按了地图没反应，就一个音效的」（改善了一点但还有）
       —— 剩下这部分的真因：**中国烈度是连续小数**（4.28 / 4.31 …），
          而地图色块颜色和方形数字都是按 `Math.round(烈度)` 取的
          （见 mapcam paintAreas 的 `LIE.colorOf(lv)` 与 liedu 的 `markBoxSrc`）。
          ⇒ 拿原始小数做签名，4.28→4.31 签名变了就响一声，画面上颜色数字一模一样。
       ⇒ 签名必须**量化到看得见的那一档**：烈度取整，震度按 5 一档（10/15/…/70）。 */
    var _isLieSig = (E.metric === 'liedu');
    for (var i = 0; i < vis.length; i++) {
      var a = vis[i] || {};
      var v = +a.level; if (!isFinite(v) || v <= 0) v = +a.shindo;
      if (!isFinite(v) || v <= 0) continue;
      var vq = _isLieSig ? Math.round(v) : Math.round(v / 5) * 5;
      var kq = (a.code != null ? a.code : (a.area != null ? a.area : (a.name || '?')));
      parts.push(kq + ':' + vq);
    }
    parts.sort();                       /* 顺序不同不算变化 */
    return grade + '|' + parts.length + '|' + parts.join(',');
  }
  /** ★★★ 2026-10-26 用户：「调查中更新的地区不是地区名，而是**行政区划**，
   *       所以应该是 **提示音 + 地图色块更新**」
   *   —— 以前这里是 `flashView(0, 4000)`：把视图弹来弹去，用户眼里就是「地区名在闪」。
   *      现在：① 播 VXSE51（调查中更新音）② 地图色块/卡片数值重刷；**不切视图**。
   */
  function refreshInqCard(E) {
    if (!E) return false;
    /* ★ 签名统一交给 inqSigOf()（卡面档位 + 地图上真正铺出来的行政区）。
       历史上这里换过三种签名（E.level / E.areas / ipf.gi），全都会被
       「数值微抖但画面没变」骗到 → 凭空响。不要再改回去。 */
    var sig = inqSigOf(E);
    if (sig === _inqSig) return false;                 /* 画面没变 → 不响 */
    /* ★ 2026-10-28：防抖检查必须在**提交 sig 之前**。
       以前先把 _inqSig = sig 再判 1200ms 防抖 → 被防抖吃掉的那一次
       把签名也吃掉了，后面同样内容再也不会响（听感就是「音效全没了」）。 */
    if (Date.now() - _inqShotAt < 1200) return false;
    _inqSig = sig;
    _inqShotAt = Date.now();
    playSokuhoSe();                                     /* VXSE51：调查中更新音 */
    if (global.QVRedraw) QVRedraw();                    /* 地图色块 + 卡上数值一起刷 */
    return true;
  }

  /* ═══ 海啸音效状态机（2026-10-21 按用户《音效对应.xlsx》的 tsa 系列） ═══
     级别取 QData.tsunami().maxLv：1=津波予報(若干の海面変動) 2=注意報 3=警報 4=大津波警報
     tsa 编号 = [0 発表 / 1 更新 / 2 解除 / 3 切り替え] + [1 若干 / 2 注意報 / 3 警報 / 4 大津波]
       · 级别不变但换了发表时刻 = 更新（tsa12/13/14；若干没有更新音）
       · 级别变化 = 発表 / 切り替え / 解除
     VTSE5  = 某区域的到达高度/到达情报变了（「到达 XX 米」更新）
     VXSE5C = 同样的变化里涉及 5m 以上（用户标注「推测」，先这么接）
     —— 1 秒轮询一次，只在状态真的变化时出声，不会重复播。 */
  var TSU_SE = { lv: -1, at: 0, snap: '', inited: false };
  /** 官方 TsunamiHeight 枚举 → 0..8（与 data.js 的 heightRank 同序） */
  function tsuHeightRank(h) {
    var s = String(h || '');
    if (/巨大/.test(s)) return 8;
    if (/高い/.test(s)) return 7;
    if (/10m</.test(s)) return 6;
    if (/^10m$/.test(s)) return 5;
    if (/^5m$/.test(s)) return 4;
    if (/^3m$/.test(s)) return 3;
    if (/^1m$/.test(s)) return 2;
    if (/^0\.2m$/.test(s)) return 1;
    return 0;
  }
  function tsuPlay(name, vol) {
    if (!name) return;
    if (global.QVSpeak && global.QVSpeak.playFile) global.QVSpeak.playFile(name, vol == null ? 0.95 : vol);
  }
  function tsuSoundTick() {
    var st = null;
    try { st = (global.QData && global.QData.tsunami) ? global.QData.tsunami() : null; } catch (e) { st = null; }
    var lv = (st && +st.maxLv > 0) ? Math.min(4, Math.max(1, +st.maxLv)) : 0;
    var at = st ? (+st.pubMs || +st.atMs || 0) : 0;
    var items = (st && st.items) ? st.items : [];
    var snap = '';
    var big = false;
    for (var i = 0; i < items.length; i++) {
      snap += (items[i].code || '') + ':' + (items[i].height || '') + ':' +
        (items[i].firstCond || '') + ':' + (items[i].maxCond || '') + ';';
      if (tsuHeightRank(items[i].height) >= 4) big = true;   /* 5m 以上 */
    }
    var prevLv = TSU_SE.lv, prevAt = TSU_SE.at, prevSnap = TSU_SE.snap;
    var first = !TSU_SE.inited;
    TSU_SE.inited = true;
    TSU_SE.lv = lv; TSU_SE.at = at; TSU_SE.snap = snap;
    /* 页面刚起来时只记状态、不播音（避免一开页就来一嗓子） */
    if (first) return;

    /* ① 级别变化 → 発表 / 切り替え / 解除 */
    if (lv !== prevLv) {
      if (!prevLv && lv) tsuPlay('tsa0' + lv, 1.0);            /* 无 → 有：発表 */
      else if (prevLv && !lv) tsuPlay('tsa2' + prevLv, 1.0);   /* 有 → 无：解除 / 有效期间结束 */
      else if (lv > prevLv) {
        if (lv === 4) tsuPlay('tsa04', 1.0);                   /* 大津波（没有 tsa34） */
        else tsuPlay('tsa3' + lv, 1.0);                        /* tsa32 注意報へ / tsa33 警報へ */
      } else {
        if (lv === 1) tsuPlay('tsa21', 1.0);                   /* 降到津波予報 → 有效期间结束 */
        else tsuPlay('tsa3' + lv, 1.0);                        /* tsa32 / tsa33 */
      }
    } else if (lv && at && prevAt && at !== prevAt) {
      /* ② 同级别但收到新报文 → 更新（若干の海面変動 没有更新音） */
      if (lv >= 2) tsuPlay('tsa1' + lv, 0.9);
    }

    /* ③ 区域到达情报变化 → VTSE5（5m 以上走 VXSE5C）
       —— 只在「级别没变」时播，级别变化已经用 tsa 的切り替え音了，不叠两个音 */
    if (lv && lv === prevLv && snap !== prevSnap && prevSnap !== '') {
      tsuPlay(big ? 'VXSE5C' : 'VTSE5', 0.85);
    }
  }
  if (global.setInterval) {
    try { setInterval(tsuSoundTick, 1000); } catch (e) { }
  }
  function eewMetric(q) { return (q && q.metric === 'liedu') ? 'liedu' : 'shindo'; }
  /** ★★★ 2026-10-29 报文里有没有【可信】的震源坐标。
   *  「震源調査中」的首报里坐标是 null / '' / **-200**（P2P 的占位值）；
   *  ⚠️ 绝不能只写 `isFinite(q.lat)` —— `isFinite(null) === true`，
   *     JSON 往返后 NaN 正好会变成 null，那样会把震源摆到 (0,0)。 */
  function hasHypo(q) {
    if (!q) return false;
    var a = q.lat, o = q.lon;
    if (a == null || o == null || a === '' || o === '') return false;
    a = +a; o = +o;
    if (!isFinite(a) || !isFinite(o)) return false;
    if (Math.abs(a) > 90 || Math.abs(o) > 180) return false;   /* -200 之类的占位 */
    if (Math.abs(a) < 0.001 && Math.abs(o) < 0.001) return false;
    return true;
  }
  /** 这条速报是不是【日本】的（JMA / P2PQuake 中继）——
   *  只有日本首报允许「没有震源也上 Tab2」，其它源仍然要求坐标。 */
  function isJpEew(q) {
    var f = String((q && (q.feed || q.source || '')) || '').toLowerCase();
    return /jma|p2p/.test(f);
  }
  /** ★★★ 2026-10-30 这条速报是不是【中国】的（CENC / 各省地震预警） */
  function isCnEew(q) {
    if (!q) return false;
    var f = String((q && (q.feed || q.source || '')) || '').toLowerCase();
    if (/cenc|sc_eew|fj_eew|cq_eew/.test(f)) return true;
    if (q.metric === 'liedu') return true;
    if (isFinite(q.lat) && isFinite(q.lon) && global.QVCNGM && global.QVCNGM.inChina(q.lat, q.lon)) {
      if (/cwa/.test(f)) return false;
      return true;
    }
    return false;
  }
  V.isCnEew = isCnEew;
  /* ★ 2026-10-21 用户：「你烈度卡没适配啊」
     烈度卡（中国地震烈度 1~12）跟震度卡（JMA 0..7 / 5弱 5強 6弱 6強）**不是同一套刻度**：
       · 逐报爬升的阶梯表不同
       · 「紧急地震速报」阈值不同（震度 3 ↔ 烈度 4）
     以前这两处写死了 JMA 值（LAD.indexOf(7) === -1 → 档位直接变 0，卡上就会写「推定最大震度 0」）。 */
  var LAD_SHINDO = [0, 1, 2, 3, 4, 50, 55, 60, 65, 70];
  var LAD_LIEDU = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  function ladOf(metric) { return metric === 'liedu' ? LAD_LIEDU : LAD_SHINDO; }
  /* ★★★ 2026-10-28 用户给的官方对照表（震度 ↔ 烈度）：
       震度0 → 烈度1(I)      震度1 → 烈度2(II)     震度2 → 烈度3(III)
       震度3 → 烈度4(IV)     震度4 → 烈度5~6(V~VI)
       震度5弱 → 烈度7(VII)  震度5強 → 烈度8(VIII)
       震度6弱 → 烈度9(IX)   震度6強 → 烈度10(X)
       震度7 → 烈度11~12(XI~XII)
     ⇒ 反查（烈度 → 等价震度码），下标 = 烈度：
       1→0 2→1 3→2 4→3 5→4 6→4 7→5弱 8→5強 9→6弱 10→6強 11~12→7 */
  var LIEDU2SHINDO = [0, 0, 10, 20, 30, 40, 40, 45, 50, 60, 65, 70, 70];
  function soundLv(lv, metric) {
    var v = +lv || 0;
    if (metric !== 'liedu') return v;          /* 震度码原样用 */
    var i = Math.round(v);
    if (i < 0) i = 0; else if (i > 12) i = 12;
    return LIEDU2SHINDO[i];
  }
  /** 发「紧急地震速报」的观测阈值：JMA 震度 3 ／ 中国烈度 4 */
  function eewThresh(metric) { return metric === 'liedu' ? 4 : 3; }
  /** 是否要红色（警報）：震度 5弱以上；中国烈度 7 级以上
   *  ★ 2026-10-21 用户：「警报 / 速报阈值不对」
   *    中国地震预警的分级里，**红色预警 = 预估烈度 ≥7**（橙 6 / 黄 5 / 蓝 4）。
   *    原来烈度写的是 ≥8（早先定的一条线），和国标不对齐 → 统一改成 7。
   *    速报阈（黄→真发速报）= 烈度 4（对应 JMA 震度 3 那一档）。 */
  function eewRed(lv, metric) {
    return metric === 'liedu' ? (+lv >= 7) : (+lv >= 50 || +lv === 7);
  }
  function shindoText(v, metric) {
    v = +v;
    if (metric === 'liedu') return String(Math.round(v));
    if (v === 50) return '5弱'; if (v === 55) return '5強';
    if (v === 60) return '6弱'; if (v === 65) return '6強';
    if (v === 70 || v === 7) return '7';
    return String(Math.max(0, Math.round(v)));
  }
  function nearestAreas(lat, lon, n) {
    var A = global.QV_SHINDO_AREAS;
    if (!A || !A.areas) return [];
    var arr = [];
    for (var code in A.areas) {
      var a = A.areas[code], p = a.p && a.p[0];
      if (!p || p.length < 4) continue;
      var la = 0, lo = 0, c = 0;
      for (var i = 0; i < p.length; i += 2) { lo += p[i]; la += p[i + 1]; c++; }
      la /= c; lo /= c;
      var dy = (la - lat) * 111, dx = (lo - lon) * 111 * Math.cos(lat * Math.PI / 180);
      arr.push({ name: a.name, d: Math.sqrt(dx * dx + dy * dy) });
    }
    arr.sort(function (x, y) { return x.d - y.d; });
    return arr.slice(0, n);
  }
  /* ★★ 2026-10-20 真实观测点（不再自己撒点）
     官方地图上每个定位点 = 反编译 reference/project.json 里 Stage 的
     `d ten:x / d ten:y / d ten:名前 / d ten:観測点所属区域 / d ten:しきい`（1748 点），
     已导出到 js/stations.js → window.QV_TEN = [lon, lat, 名称, 区域代码, しきい]。 */
  /** 震度连续值（0..7）→ 官方刻度（0,1,2,3,4,50=5弱,55=5強,60=6弱,65=6強,70=7） */
  function shindoCode(v) {
    if (v < 0.5) return 0;
    if (v < 1.5) return 1;
    if (v < 2.5) return 2;
    if (v < 3.5) return 3;
    if (v < 4.5) return 4;
    if (v < 5.0) return 50;
    if (v < 5.5) return 55;
    if (v < 6.0) return 60;
    if (v < 6.5) return 65;
    return 70;
  }
  /** 输入震度（0..7 / 50,55,… / 中国烈度）→ 连续震度值 0..7 */
  function toCont(lv) {
    lv = +lv || 0;
    if (lv >= 50) return 5 + (lv - 50) / 10;
    if (lv <= 7) return lv;
    return Math.min(7, lv / 10);
  }
  /** ★ 震度编码 → 它在 shindoFromI 里**所属区间的中点**（計測震度 I）
   *  shindoFromI 的边界： <4.5→4 / [4.5,5.0)→5弱 / [5.0,5.5)→5強 /
   *                      [5.5,6.0)→6弱 / [6.0,6.5)→6強 / ≥6.5→7
   *  ⇒ 取中点才能保证「设 5強，峰值站判定出来还是 5強」。
   *  用 toCont 会取到下边界（5.5），正好落进下一档 → 地图凭空高一级。 */
  function shindoBandI(lv) {
    var v = +lv || 0;
    if (v >= 70) return 6.75;
    if (v >= 65) return 6.25;
    if (v >= 60) return 5.75;
    if (v >= 55) return 5.25;
    if (v >= 50) return 4.75;
    /* ★★★ 2026-10-25 修：震度 1~4 的档位区间是 [0.5,1.5)/[1.5,2.5)/[2.5,3.5)/[3.5,4.5)，
       中点就是 1/2/3/4 **本身**。以前写 `v / 10` → 震度3 变成 I=0.3，
       等于把峰值按到 0.3 → 深源小震/实测最大震度 3 这种事件整张场全灭
       （2026-10-25 小笠原 M7.0 深470km 实测最大震度3，就是这么被吃掉的一环）。 */
    return Math.min(7, Math.max(0, v));
  }
  /* ★★★ 2026-10-25 深源（intraslab，D>150km）衰减修正 —— 用 2026-10-25 小笠原
     M7.0 / 深470km 的 JMA 实测分布标定（412 个观测点：最大震度3、关东~东北 1~2、
     最远到青森/岩手 1400km 仍报震度1）。
     病根：司・翠川(1999) 是**地壳地震**的式子，直接外推到 470km 会两头都错：
       ① `+0.0038D` 线性抬升只在 D≲150km 标定过，D=470 时它抬 1.79(≈61 倍 PGV)
       ② `-0.002R` 是地壳路径的非弹性项，深源上行路径在高 Q 板片里，衰减没那么快
     两者在深源上互相打架 → 近场虚高、远场被吃光。
     修法：深度项饱和在 150km；非弹性项按深度折减（最低 0.45 倍，经 15 场官方地震标定）。
     ⚠️ **D ≤ 150km 时 deff=D、kAn=0.002 ⇒ 非弹性项与旧公式完全等价**，浅源行为不变。 */
  function deepTerms(dep) {
    return {
      deff: Math.min(dep, 150),
      kAn: 0.002 * Math.max(0.45, Math.min(1, 150 / Math.max(30, dep)))
    };
  }
  /* ★★★ 2026-10-25 **異常震域（深発地震）近似**
     用户：「西日本官方根本没填色（震度0），东日本东京右边却是大范围震度2」
     —— 这是教科书级的異常震域：能量沿着高 Q 的俯冲板片上传，
        板片浅的地方（关东/东北太平洋侧）传得很远，
        板片深的地方（日本海侧/西日本）要多爬几百公里楔形地幔 → 强烈衰减。
     实测依据：2026-10-25 小笠原 M7.0 深470km（412 个观测点）：
        大阪 d859km → 震度0 ｜ 东京 d854km → 震度2（同样距离差 2 级）
     代理量：**板片顶面深度**。以日本海沟 143°E 为基准（深 0），向西每公里 +tan30°；
     板片超过 100km 的余量 = 要多爬的楔形地幔，每公里折 0.004（logPGV），封顶 -1.0。
     ⚠️ 只对深源（>150km）且只对日本列岛生效 —— 浅源 / 中国深震不吃这条。
     ✅ 15 场官方地震标定：整体 MAE 0.60 → 0.50，小笠原那场 1.11 → 0.25，
        大阪 / 広島 / 福岡 / 那覇 全部回到震度 0。 */
  function slabTopKm(lat, lon) {
    if (!(lon > 127 && lon < 146 && lat > 23 && lat < 46)) return 0;   /* 只近似日本列岛 */
    var km = (143.0 - lon) * 111 * Math.cos(lat * Math.PI / 180);
    if (km < 0) km = 0;
    return Math.min(700, km * 0.5774);       /* tan(30°) */
  }
  function slabPenalty(lat, lon, dep) {
    if (!(dep > 150)) return 0;
    return Math.min(1.0, 0.004 * Math.max(0, slabTopKm(lat, lon) - 100));
  }
  /** 峰值（震源正上方地表）的計測震度 I —— 卡片「最大震度」与地图峰值共用同一个公式
   *  · 浅源（≤150km）：沿用「震级经验峰值」4.0+(M-5)·1.2（补偿点源 GMPE 在近场对大震的低估，
     M8 才摸得到震度7）
   *  · 深源（>150km）：再取「震源正上方地表的 GMPE 值」当上限 —— 不管 M 多大，
     470km 深度的能量传上来就这么点（小笠原 M7.0/470km → I≈2.8 → 震度3，与实测一致）。 */
  function peakI(M, dep) {
    var Im = Math.min(7.4, 4.0 + (M - 5.0) * 1.2);
    if (!(dep > 150)) return Im;
    var Lf = Math.min(1600, Math.pow(10, 0.5 * M - 1.85));
    var t = deepTerms(dep);
    var rf0 = Math.max(0, dep - 0.45 * Lf);
    var Rf = Math.sqrt(rf0 * rf0 + 0.25) + 0.10 * dep;
    var lg = 0.58 * M + 0.0038 * t.deff - 1.29
      - Math.log10(Rf + 0.0028 * Math.pow(10, 0.5 * M)) - t.kAn * Rf;
    var I = 2.68 + 1.72 * lg;
    if (M > 7.5) I += (M - 7.5) * 0.45;
    return Math.min(Im, I);
  }
  /** ★★★ 2026-10-25 深源地震（intraslab / 深発地震）判定
   *  依据用户提供的手动时间轴《2026 日本海北部 M5.6 深 350km》：
   *    EEW 全程卡面写的是「深源地震震度不明」，**一个震度都不发**，
   *    直到「各地震度情報」（VXSE53）才给出最大震度 1。
   *  JMA 对深源地震（通常 D ≥ 150km）在速报阶段只报 M 与深度 —— 因为 PLUM 依赖
   *  近场强震观测，深源近场几乎没有测站，IPF 也解不出稳定的震度场。
   *  ⇒ 本项目同口径：≥150km 走「震度不明」分支（不做 GMPE 强行给值）。 */
  function isDeepSrc(dep) { return (+dep || 0) >= 150; }
  /* ══════ 長周期地震動階級（LPGM）—— 按公式算，不查表 ══════
   * ★★★ 2026-10-26 用户：「这个不应该也是用算法算吗？深源地震高频波被地幔吃干净，
   *   低频波却能像幽灵一样穿透上千公里 —— 用长周期地震动专项公式 + 深源衰减式」
   *
   * 官方定義（気象庁）：周期 1.6〜7.5 秒・減衰定数 5% の**絶対速度応答**の最大値で分档
   *   （この閾値は気象庁の公開資料どおり）
   *     階級1: 5 ≤ Sv < 15 ｜ 階級2: 15 ≤ Sv < 50 ｜ 階級3: 50 ≤ Sv < 100 ｜ 階級4: ≥ 100 [cm/s]
   *
   * 估算式（長周期＝表面波主体，衰减比短周期慢得多）：
   *     log10 Sv = 0.50·M − 1.459 − 1.851·log10(1 + R/100)     R = √(震央距離² + 深度²)
   *   · 0.50·M：长周期谱随规模增长且**几乎不饱和**（短周期会饱和）→ 巨震/深源特别突出
   *   · 1.851：几何扩散 + 长周期吸收（比 GMPE 的短周期项平缓得多，所以能传上千公里）
   *   · 常数 1.459 与指数：用四场实测标定
   *       熊本 M7.1/12km 震源附近 ≈ 100 cm/s → 階級4
   *       東北 M9.0/24km → 東京（370km）≈ 60 → 階級3（×関東平野放大 → 4）
   *       小笠原 M8.1/682km → 東京（震央距 900km）→ 階級1〜2
   *       小笠原 M7.0/470km → ≈ 4.5 cm/s → **無階級**（与官方一致）
   *   · 深源增益 `1 + 1.2·max(0, M−7)`：深源的高频被地幔吃掉、低频反而更明显，
   *     所以「深 600km 的 M8」比同距离的浅源强 —— 这正是用户指出的现象。
   *   · 平野放大 1.8〜2.2：长周期振动靠厚沉积层共振（関東/濃尾/大阪…）。
   * ⚠️ 只用于**模拟**；真实 EEW 绝不伪造，只认 dmdata VXSE62 的 Lg。 */
  var LPGM_BASINS = [
    { n: '関東平野', lat: 35.68, lon: 139.77, a: 2.2 },
    { n: '濃尾平野', lat: 35.18, lon: 136.90, a: 2.0 },
    { n: '大阪平野', lat: 34.69, lon: 135.50, a: 2.0 },
    { n: '仙台平野', lat: 38.27, lon: 140.87, a: 1.9 },
    { n: '石狩平野', lat: 43.06, lon: 141.35, a: 1.8 },
    { n: '福岡平野', lat: 33.59, lon: 130.40, a: 1.8 }
  ];
  /* 中国主要沉积盆地（长周期放大最显著的几处）—— 日本那套 LPGM_BASINS 在中国震源上无意义，
     单列一张表，配合 QVCNGM.lgpmSv() 用（表 5 是基岩值，盆地另乘 1.8~2.2）。 */
  var LPGM_CN_BASINS = [
    { n: '珠江三角洲', lat: 23.10, lon: 113.30 },
    { n: '长江三角洲', lat: 31.20, lon: 121.50 },
    { n: '四川盆地', lat: 30.66, lon: 104.06 },
    { n: '华北平原', lat: 38.90, lon: 115.50 },
    { n: '汾渭地堑', lat: 34.30, lon: 108.90 },
    { n: '江汉平原', lat: 30.60, lon: 114.30 },
    { n: '河套平原', lat: 40.20, lon: 107.00 },
    { n: '台北盆地', lat: 25.03, lon: 121.57 }
  ];
  var LPGM_C = 1.44, LPGM_A = 1.851;
  function lgpmSv(M, dep, epiKm, amp) {
    var d = Math.max(1, +dep || 10);
    var R = Math.sqrt(epiKm * epiKm + d * d);
    if (!(R > 1)) R = 1;
    var sv = Math.pow(10, 0.50 * M - LPGM_C - LPGM_A * Math.log10(1 + R / 100));
    /* ★★★ 2026-10-26 用户：「引入『板片导波』的非线性增益」
       —— 深源地震的能量沿**高 Q 值的俯冲板片**被导到上千公里外（異常震域的真身），
          但只有**长周期成分**能被板片捕获（短周期会漏出板片被地幔吃掉）。
          震级越大，震源谱越偏长周期 → 被捕获的比例**超线性**增长，所以不能用线性系数。
       · trap = 板片耦合度：震源越深越在板片内部（150km 起算，500km 满）
       · 增益 = 1 + 1.1·trap·(1.9^(M−7.2) − 1)  ← 指数型，M ≤ 7.2 时为 1（不发階級） */
    var trap = (d >= 150) ? Math.min(1, (d - 150) / 350) : 0;
    if (trap > 0) sv *= (1 + 1.1 * trap * (Math.pow(1.9, M - 7.2) - 1));
    return sv * (amp || 1);
  }
  function lgpmRank(sv) {
    if (!(sv >= 5)) return 0;
    if (sv < 15) return 1;
    if (sv < 50) return 2;
    if (sv < 100) return 3;
    return 4;
  }
  /** 全国最大長周期地震動階級（0 = 达不到发布标准；调用方要转成 -1） */
  function lgpmMaxRank(q) {
    var M = Math.max(0, +q.mag || 0), dep = Math.max(1, +q.depthKm || 10);
    /* ★★★ 2026-10-26 中国震源：改用 **GB 18306-2015 表 5 的分区 vE 衰减关系**
       （俞言祥等）→ 谱平台速度 Sv = 2.5·vE，再乘沉积盆地长周期放大。
       日本那套经验式（lgpmSv，熊本/東北/小笠原标定）留给日本/海外。 */
    if (global.QVCNGM && QVCNGM.inChina(q.lat, q.lon)) {
      var bestC = lgpmRank(QVCNGM.lgpmSv(q.lat, q.lon, M, dep, q.lat, q.lon));
      for (var ci = 0; ci < LPGM_CN_BASINS.length; ci++) {
        var cb = LPGM_CN_BASINS[ci];
        var rk2 = lgpmRank(QVCNGM.lgpmSv(q.lat, q.lon, M, dep, cb.lat, cb.lon));
        if (rk2 > bestC) bestC = rk2;
      }
      return bestC;
    }
    var best = lgpmRank(lgpmSv(M, dep, 0, 1));               /* 震源近傍（非平野） */
    for (var i = 0; i < LPGM_BASINS.length; i++) {
      var b = LPGM_BASINS[i];
      var rk = lgpmRank(lgpmSv(M, dep, simKm(q.lat, q.lon, b.lat, b.lon), b.a));
      if (rk > best) best = rk;
    }
    return best;
  }
  /** ★★★ 2026-10-25 首报时刻：P 波走到最近测站的真实走时（秒）
   *  以前用「震中距 / 6.0 km/s」，浅源还行，深源会差得离谱：
   *    日本海北部 M5.6 / 深 350km → 最近测站震中距约 90km，但震源距 362km，
   *    P 波实际要走 ~45 秒；用 90/6=15 秒会在 P 波还差 30 秒时就开始报。
   *  JMA 官方 `d JMA2001走時表` 给的是「时间 → 震央距离」，这里二分反解时间。
   *  · 有 QV_JMA2001 表（app/js/jma2001.js）→ 用表；没有 → 退回 6.0 km/s 近似。 */
  function travelSec(depKm, epiKm, pWave) {
    var dep = Math.max(0, +depKm || 0);
    var epi = Math.max(0, +epiKm || 0);
    var hyp = Math.sqrt(epi * epi + dep * dep);
    var fn = (global.QVMapCam && QVMapCam.jma2001Dist) ? QVMapCam.jma2001Dist : null;
    if (!fn || !global.QV_JMA2001) return hyp / (pWave ? 6.0 : 4.0);
    if (hyp < 1) return 0;
    /* jma2001Dist 单调递增（在 0~300 秒内）→ 二分 40 次足够收敛到 1e-4 秒 */
    var lo = 0, hi = 300;
    if (fn(hi, dep, pWave) < epi) return hi;      /* 超出表有效范围：封顶 */
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (fn(mid, dep, pWave) < epi) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  /** ★★★ 2026-10-28 用户：「快同步」
   *   —— 测站点亮用的 tp/tv 以前是写死的 `hyp/6.5`、`hyp/4`，
   *      而 P/S 波圈走 JMA2001 走时表 → 深源时两套差一大截（圈在前面、测站在后面）。
   *   ⇒ 测站也走同一张表：tp = travelSec(深度, 震央距, P)、tv = travelSec(…, S)。
   *      拿不到表时退回旧近似（保证不会变成 0）。
   *   ★★★ 2026-10-28（区域修正，方案 B）：再乘一个区域系数 k（见 js/travel-region.js）。
   *      青藏/新疆远场偏慢 5~7%、川滇 +3~4%、台湾 S 近场 +9%，华南/华北 ≈ 1
   *      —— 数值来自 CRUST1.0 格点的走时对比，不是拍脑袋。
   *      ⚠️ 波圈那边（mapcam tickWaves）用的是同一个 k，两边不会错位。 */
  function regionK(lat, lon, epiKm, isP) {
    var f = global.QVTravelK && global.QVTravelK.factor;
    return f ? (+f(lat, lon, epiKm, isP) || 1) : 1;
  }
  function statTp(lat, lon, epiKm, hypKm, depKm) {
    var t = travelSec(depKm, epiKm, true);
    if (!(isFinite(t) && t > 0)) return (+hypKm || 0) / 6.5;
    return t * regionK(lat, lon, epiKm, true);
  }
  function statTv(lat, lon, epiKm, hypKm, depKm) {
    var t = travelSec(depKm, epiKm, false);
    if (!(isFinite(t) && t > 0)) return (+hypKm || 0) / 4;
    return t * regionK(lat, lon, epiKm, false);
  }
  /**
   * 用真实测站算每个点的震度（ground-motion prediction）。
   *
   * 2026-10-20 user: "9+ magnitude on land should have a whole Pearl-River-Delta
   * sized area at shindo 7, but you only light up two stations".
   * Old model was self-invented: v = cont - 2.2*log10(hyp/dep) -- drops far too fast.
   *
   * Now: Shi & Midorikawa (1999) PGV attenuation
   *   log10(PGV) = 0.58*Mw + 0.0038*D - 1.29
   *              - log10(R + 0.0028*10^(0.5*Mw)) - 0.002*R
   * plus Midorikawa et al. (1999) PGV -> JMA instrumental intensity
   *   I = 2.68 + 1.72*log10(PGV)
   * plus a finite-fault correction (point-source GMPE under-predicts M>8):
   *   Lf = 10^(0.5M - 1.85)  (Utsu fault length, km)
   *   Rf = max(0.5, R - 0.45*Lf)
   *   I += (M - 7.5)*0.45  when M > 7.5
   *
   * area code: QV_TEN row = [lon, lat, name, col3, col4].
   * col3 never matches the 123 keys of shindo-areas.js (areaPath() returns '' ->
   * whole colour layer blank); col4 hits 1463/1748, so use col4.
   */
  /** 区域代码 -> JMA 细分区域名（石狩地方中部 / 兵庫県淡路島 …）
   *  ★ 2026-10-20 实测：`QVShindo.areaOf(lon, lat)` 对 1748 个观测点的
   *  命中率是 1733 = **99.1%**，覆盖 120 个区域，名字全部正确。
   *  所以「区域名不对」从来不是缺码表，而是聚合时把名字写成了测站名。
   *  查不到就退回测站名（15 个落在多边形外的点）。 */
  function areaName(code, fallback) {
    var ADB = (global.QV_SHINDO_AREAS && global.QV_SHINDO_AREAS.areas) || null;
    var a = ADB && ADB[code];
    if (a && a.name) return a.name;
    return fallback;
  }
  /* ★★★ 2026-10-20 用户：「为什么地区名字不做自动检测地区名，不是都有测站名字了吗」
   *  —— 确实该自动检测：测站自己只有【点】名字（亀戸 / 名古屋 / 種市），
   *     区域名只能由坐标推。现在的两级自动判定：
   *       ① `QVShindo.areaOf(lon,lat)` 点在多边形内（1733/1748 命中，最快最准）
   *       ② 命中不了 → **离哪块区域的边界最近就归给谁**（本函数）
   *     为什么要 ②：JMA 的 123 个细分区域多边形是**简化过的海岸线**，有缝隙。
   *     实测有 15 个测站掉在缝里：**9 个是陆地点的多边形缝隙**（亀戸 / 越中島 / 那覇 /
   *     種市 / 三崎 / 田尻 / 常滑2 / 下宇部尾 / 鹿児島，离岸 0.001~0.3km → 正常归属）；
   *     另外 6 个「平塚ST1~6」本身是**海底仪器**（离岸 19~34km），不该塞进陆地区域。
   *     而 `aggOf()` 里是 `if (!code) continue;` → 这些点被**整条丢掉** →
   *     「东京的观测点显示不出来」「东京那块没有震度」就是这个原因
   *     （亀戸 35.700/139.835 明明是江东区）。
   *     用「最近质心」不行：大区域（東京都２３区、北海道）质心可能落到隔壁，
   *     所以按【点到多边形边的最小距离】算，多边形的洞也不影响（只取最小）。
   *  ⚠ 结果按坐标缓存：每次 EEW 上报都会重新 genStations，不能每次都扫 12 万顶点。 */
  var _areaFix = {}, _areaBox = null, AREA_MAX_KM = 2;
  function _segD2(ax, ay, bx, by) {          /* 原点(0,0) 到线段 AB 的距离平方 */
    var vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
    var t = L > 0 ? -(ax * vx + ay * vy) / L : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var dx = ax + vx * t, dy = ay + vy * t;
    return dx * dx + dy * dy;
  }
  function _buildAreaBox() {
    var ADB = (global.QV_SHINDO_AREAS && global.QV_SHINDO_AREAS.areas) || {};
    _areaBox = {};
    for (var code in ADB) {
      var rings = ADB[code].p || [], x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (var ri = 0; ri < rings.length; ri++) {
        var r = rings[ri];
        for (var i = 0; i + 1 < r.length; i += 2) {
          if (r[i] < x0) x0 = r[i];
          if (r[i] > x1) x1 = r[i];
          if (r[i + 1] < y0) y0 = r[i + 1];
          if (r[i + 1] > y1) y1 = r[i + 1];
        }
      }
      _areaBox[code] = [x0, y0, x1, y1];
    }
  }
  function nearestAreaCode(lon, lat, force) {
    var ADB = (global.QV_SHINDO_AREAS && global.QV_SHINDO_AREAS.areas) || null;
    if (!ADB) return 0;
    var key = lon.toFixed(3) + ',' + lat.toFixed(3);
    if (!force && _areaFix[key] !== undefined) return _areaFix[key];
    if (!_areaBox) _buildAreaBox();
    var cos = Math.cos(lat * Math.PI / 180);
    var best = 0, bestD = Infinity;
    for (var code in ADB) {
      var bb = _areaBox[code];
      /* 外接框先粗筛：框都离得远的区域直接跳过（12 万顶点，不筛一次要 ~9ms） */
      var bdx = (lon < bb[0]) ? (bb[0] - lon) * cos : (lon > bb[2] ? (lon - bb[2]) * cos : 0);
      var bdy = (lat < bb[1]) ? (bb[1] - lat) : (lat > bb[3] ? lat - bb[3] : 0);
      if (bdx * bdx + bdy * bdy > bestD) continue;
      var rings = ADB[code].p;
      if (!rings) continue;
      for (var ri = 0; ri < rings.length; ri++) {
        var r = rings[ri], n = r.length >> 1;
        if (n < 3) continue;
        for (var i = 0; i < n; i++) {
          var j = (i + 1) % n;
          var d = _segD2((r[i * 2] - lon) * cos, r[i * 2 + 1] - lat,
                         (r[j * 2] - lon) * cos, r[j * 2 + 1] - lat);
          if (d < bestD) { bestD = d; best = +code; }
        }
      }
    }
    /* 离任何陆地细分区域都太远的点 = 海底仪器（S-net / 平塚 ST1~ST6 都在 19~34km 外）
       → 不归属区域，只在图上画点（和官方一致，避免「千葉県南部」被海底点带出震度） */
    var km = Math.sqrt(bestD) * 111;
    if (!force && !(km <= AREA_MAX_KM)) best = 0;
    if (!force) _areaFix[key] = best;
    return best;
  }
  /** 测站行 → 区域代码（自动检测）
   *  ① 点在 JMA 细分区域多边形内 → 直接用
   *  ② 掉在多边形缝里 → 按最近的区域边界自动归属（否则东京那 15 个点会被扔掉）
   *  ③ S-net 海底点（行 = [lon,lat,名称]，没有区域列）→ 不归属：
   *     官方也只把它们当图上的点，不进「各地震度信息」列表 */
  function stationArea(row, force) {
    /* ★ 2026-10-21：中国测站自带城市编号（第 4 列）→ 直接用，不要再按 JMA 多边形推，
       否则中国震中会把城市归到几百公里外的日本细分区去。 */
    if (row && row[4] === 'cn') return row[3] | 0;
    var lon = row[0], lat = row[1];
    var c = (global.QVShindo && global.QVShindo.areaOf) ? global.QVShindo.areaOf(lon, lat) : 0;
    if (c) return c;
    /* ★ 2026-10-21 用户：「为什么海底的检测到摇晃就没有框框？」
       以前海底点（S-net，row 只有 [lon,lat,名]）直接返回 0 → 不属于任何区域
       → 没有区域就没框。现在 force=true：海底点也归到【最近的陆地细分区】，
       于是海底测站震了也会出框。 */
    return nearestAreaCode(lon, lat, !!force);
  }
  /* ★ 2026-10-21 用户：「有框了，但是在陆地上」
     海底点（S-net）本身没有 JMA 细分区，只能借最近的陆地分区当「归属」。
     但框的位置不能再借陆地分区的 bbox —— 否则海底震了、框却画在岸上。
     这里标一下「这个测站本来就在海里」，rebuildAreas 会把框放到测站坐标上。 */
  function stationSea(row) {
    /* ★ 2026-10-21：中国测站不属于 JMA 多边形，但检测框要画在【城市自己】的位置上，
       所以同样返回 1（复用海底套的「框中心 = 测站坐标」逻辑）。 */
    if (row && row[4] === 'cn') return 1;
    if (!(global.QVShindo && global.QVShindo.areaOf)) return 0;
    return global.QVShindo.areaOf(row[0], row[1]) ? 0 : 1;
  }
  /* ★ 2026-10-21 中国烈度色块：把测站落到【地级市轮廓】上。
     区县 adcode 能靠前 4 位推地级市，但直辖市/特区的区在 DataV 那层没有 adcode
     （我用 9xxxxx 兜底编号），推不出来 → 改成「点在哪个轮廓里就用哪个码」。
     结果按经纬度（2 位小数）缓存，2791 个点只会算一次。 */
  var _cnAreaIdx = null, _cnCityCache = {};
  function cnAreaIndex() {
    if (_cnAreaIdx) return _cnAreaIdx;
    var src = (global.QVMapCam && QVMapCam.parseAreaPolys) ? QVMapCam.parseAreaPolys() : [];
    _cnAreaIdx = src || [];
    return _cnAreaIdx;
  }
  function pipFlat(pts, lon, lat) {
    var inside = false;
    for (var i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
      var xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
      if ((yi > lat) !== (yj > lat) &&
          lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi) inside = !inside;
    }
    return inside;
  }
  function cnCityOf(lat, lon) {
    /* ★★★ 2026-10-29：`isFinite(null) === true` —— 调用方传进来的是 null
       （震源未定的速报 / JSON 往返后的 NaN）时，这里以前直接
       `null.toFixed` 抛异常，整帧渲染中断 → Tab1 全白。
       现在先挡一道，坐标不可信就当「不在任何中国轮廓内」。 */
    if (lat == null || lon == null || !isFinite(+lat) || !isFinite(+lon)) return 0;
    lat = +lat; lon = +lon;
    var k = lat.toFixed(2) + ',' + lon.toFixed(2);
    if (_cnCityCache[k] !== undefined) return _cnCityCache[k];
    var idx = cnAreaIndex(), hit = 0;
    /* ★★★ 2026-10-21 台湾：**必须两趟扫，台湾优先**
       金门/马祖地理上紧贴福建，DataV 的福建轮廓把金门岛整个包在里面
       → 按数组顺序扫时先命中 350500（泉州市），金门地震被算成福建。
       实测：金门 24.43,118.32 → 350500 ❌ ；台北/高雄/花莲/澎湖 都正确。
       ⇒ 第一趟只扫 71xxxx（台湾 22 个县市），第二趟再扫其余。 */
    for (var pass = 0; pass < 2 && !hit; pass++) {
      for (var i = 0; i < idx.length; i++) {
        var a = idx[i];
        if (!a.rings || !a.rings.length) continue;
        var isTW = (a.c >= 710000 && a.c < 720000);
        if ((pass === 0) !== isTW) continue;
        if (lon < a.b[0] || lon > a.b[2] || lat < a.b[1] || lat > a.b[3]) continue;
        for (var r = 0; r < a.rings.length; r++) {
          if (pipFlat(a.rings[r], lon, lat)) { hit = a.c; break; }
        }
        if (hit) break;
      }
    }
    _cnCityCache[k] = hit;
    return hit;
  }
  /** 测站表：日本 1748 官方站（K-NET/KiK-net）+ 中国 2791 个区县中心点
   *
   *  ★★★ 2026-10-21 用户：「就是为什么地震有国界的」
   *  —— 真因：以前这里是**二选一**——离震中近的是哪张表就只用哪张，
   *     日本海地震 → 只用 1748 个日本站，中国/朝鲜 2791 个站全部丢弃
   *     ⇒ 地图上的震度标记沿着海岸线/国界整齐地断掉，看着像「地震有国界」。
   *  ⇒ 改成【合并】：地震波不认国界，测站也不该按国别切。
   *     震源在日本海时，日本站记录东侧、中国东北站记录西侧，本来就该同框。
   *  返回的 `cn` 只表示「有没有中国表」，与"该用哪张"无关。
   *  每行的 `row[4] === 'cn'` 仍然逐点区分国别（算 adcode 时要），不受影响。 */
  /* ★★★ 2026-10-25 官方 Stage 列表（1748 点）里**一个小笠原的点都没有**
     （实测 lat<31 且 lon>138 的点数 = 0，最近的站是八丈 568km）。
     而 JMA 明细电文里这三个观测点是有的（父島三日月山 / 父島西町 / 母島），
     2026-10-25 小笠原 M7.0 深470km 的最大震度 3 就出在这里。
     → 模拟时把这三个真实观测点补进日本站表，否则「最大震度所在的区域」在图上永远空白。
     格式与 stations.js 一致：[lon, lat, 名称, 区域代码(359=小笠原), しきい] */
  var QV_TEN_REMOTE = [
    [142.18, 27.10, '小笠原父島三日月山', 359, '320'],
    [142.19, 27.09, '小笠原父島西町', 359, '320'],
    [142.18, 26.63, '小笠原母島', 359, '320']
  ];
  function pickStationTable(lat, lon) {
    var JP = (global.QV_TEN || []).concat(QV_TEN_REMOTE), CN = global.QV_CN || [];
    if (!JP.length && !CN.length) return { T: [], cn: false };
    if (!CN.length) return { T: JP, cn: false };
    if (!JP.length) return { T: CN, cn: true };
    return { T: JP.concat(CN), cn: true };
  }

  /* ★★★ 2026-10-21 中国大陆「区域烈度」—— 全部自己算，不依赖任何 API
     用户：「api 没有区域震度的地图填色（中国大陆），我们都有这么多东西了」
     零件：
       · cn-areas.js    369 个地级市轮廓（DataV GeoJSON 简化版）
       · cn-stations.js 2791 个区县中心点当测站
       · genStations()  司・翠川(1999) GMPE + 震级标定 + 距离衰减 + **VS30 场地放大**
     返回 { areas:[{code, level, metric:'liedu'}], iso:[{lon,lat,v}], points:[…], maxI }
       · areas  → QVMapCam.setAreaFill（地级市色块打底）
       · iso    → QVMapCam.setIsoPoints（等烈度线叠加）
       · points → 地图测站圆标（可选）
     中国以外（pickStationTable 选到日本表）返回 null，调用方继续走 JMA 明细。 */
  /* 真实台站缓存（按事件）—— 中国地震台网开放接口，拿不到就用区县中心点兵底
     ★ 采样点换了，下游（烈度场 / 地级市聚合 / 测站圆标）全部自动跟着变，
       因为它们只认 pick.T 这个台站表。 */
  var CENC_ST = { id: '', list: null, real: null };
  function cencStations(q) {
    if (!q || !global.QData || !QData.cencEventId) return null;
    var id = QData.cencEventId(q);
    if (!id) return null;
    if (CENC_ST.id === id) return CENC_ST.list;
    CENC_ST.id = id; CENC_ST.list = null; CENC_ST.real = null;
    QData.loadCencStations(q).then(function (list) {
      if (CENC_ST.id !== id) return;
      CENC_ST.list = (list && list.length) ? list : null;
      CENC_ST.real = CENC_ST.list;
      if (CENC_ST.list) { try { if (global.QVRedraw) global.QVRedraw(); } catch (e) { } }
    }).catch(function () { });
    return null;
  }

  /* ★★ USGS ShakeMap 缓存（按事件）—— 2026-10-23
     拿到就用官方等震线给地级市填色（强覆盖），没拿到就继续跑上面的 GMPE。
     ★ 只影响 #mapcnareas 色块，**不碰底图瓦片/地形/海岸线**。 */
  var SM_ST = { id: '', data: null };
  function shakemapFor(q) {
    if (!q || !hasHypo(q) || !(q.mag >= 4.0)) return null;   /* 小震 / 无震源 没 ShakeMap，别浪费请求 */
    if (!global.QData || !QData.loadShakemap) return null;
    var id = (q.id || '') + ':' + q.timeMs;
    if (SM_ST.id === id) return SM_ST.data;
    SM_ST.id = id; SM_ST.data = null;
    QData.loadShakemap(q).then(function (d) {
      if (SM_ST.id !== id) return;
      SM_ST.data = d || null;
      if (d) { try { if (global.QVRedraw) global.QVRedraw(); } catch (e) { } }
    }).catch(function () { });
    return null;
  }
  /** 点在闭合等震线内的最大档（等震线由低到高排序，从后往前试、命中即返回） */
  function smValueAt(sm, lon, lat) {
    var f = sm.feats;
    for (var i = f.length - 1; i >= 0; i--) {
      var c = f[i], b = c.bb;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      for (var r = 0; r < c.rings.length; r++) {
        if (simPip(c.rings[r], lon, lat)) return c.value;
      }
    }
    return 0;
  }
  /** 一个地级市内的最大 MMI：沿轮廓顶点取样（顶点足够密，比只测质心准） */
  function smMaxInArea(sm, a) {
    var rings = a.p || [], maxV = 0;
    for (var r = 0; r < rings.length; r++) {
      var pts = typeof rings[r] === 'string' ? simRingOf(rings[r]) : rings[r];
      if (!pts || pts.length < 4) continue;
      var stride = pts.length > 240 ? 10 : (pts.length > 80 ? 4 : 2);
      for (var j = 0; j + 1 < pts.length; j += stride) {
        var v = smValueAt(sm, pts[j], pts[j + 1]);
        if (v > maxV) maxV = v;
      }
    }
    return maxV;
  }
  function cnFromShakemap(sm, minI) {
    /* ⚠ 必须用 QV_CN_AREAS（391 块**地级市轮廓** {c,n,b,p}），
       不是 QV_CN（2812 个区县**中心点** [lon,lat,name,code]）——
       拿错表会导致 a.p / a.b 全 undefined，整张 ShakeMap 静默失效回落模型。 */
    var CN = global.QV_CN_AREAS || [], out = [];
    for (var i = 0; i < CN.length; i++) {
      var a = CN[i];
      if (!a || !a.p || !a.b) continue;
      var v = smMaxInArea(sm, a);
      if (!(v >= minI)) continue;
      /* MMI 与中国烈度同为 1..12 刻度 → 直接取整当档位 */
      out.push({ code: +a.c, level: Math.max(1, Math.min(12, Math.round(v))), metric: 'liedu' });
    }
    return out;
  }

  /** ★ 2026-10-27：震中 → 地级市码（轮廓命中优先，落在简化轮廓缝隙里时取最近轮廓中心）
   *  —— cnFill 里原来有 3 处一模一样的「最近城市」循环，这里收成一个。 */
  function cnNearestCity(lat, lon, maxKm) {
    var c = 0;
    try { c = cnCityOf(lat, lon); } catch (e) { c = 0; }
    if (c > 0) return c;
    var AR = global.QV_CN_AREAS || [], bd = maxKm || 400;
    var cs = Math.cos(lat * Math.PI / 180);
    for (var i = 0; i < AR.length; i++) {
      var a = AR[i];
      if (!a || !a.b || !a.c) continue;
      var clat = (a.b[1] + a.b[3]) / 2, clon = (a.b[0] + a.b[2]) / 2;
      var dy = (clat - lat) * 111, dx = (clon - lon) * 111 * Math.max(0.2, cs);
      var dd = Math.sqrt(dx * dx + dy * dy);
      if (dd < bd) { bd = dd; c = +a.c; }
    }
    return c;
  }
  function cnFill(q, stage) {
    /* ★ 2026-10-29：`isFinite(null)` 为真 → 用 hasHypo 判；震源未定的速报一律不填色 */
    if (!q || !hasHypo(q)) return null;
    /* ★★ 天体模式（月球/火星）：没有地级市轮廓，地级市色块这一整套都用不了
       → 交给 planet.js 用同一套 GMPE 画等震环 / 六边形网格（二者可切换）。
       这里必须 return null：否则下面的 cnCityOf 守卫会拿中国轮廓去判行星震中，
       结果是「火星上一块中国地级市被涂色」这种明显错误。 */
    if (global.QVPlanet && global.QVPlanet.isPlanet()) {
      global.QVPlanet.setQuake(q);
      return null;
    }
    if (!(global.QV_CN && QV_CN.length)) return null;
    /* ★ 国界判定必须用轮廓命中，不能用「离哪张测站表近」——
       `pickStationTable` 只看距离：菲律宾/河内/乌兰巴托都会被判成 CN，
       结果一场海外地震也铺满中国地级市色块。
       实测 cnCityOf：成都 510100 / 拉萨 540100 / 台北 710001 / 香港 810000 ✓
                      马尼拉 0 / 东京 0 / 首尔 0 / 乌兰巴托 0 / 河内 0 ✓ */
    if (!(cnCityOf(q.lat, q.lon) > 0)) {
      /* ★★★ 2026-10-21 台湾：**震中在海上时轮廓命不中**
         台湾东岸 / 花莲外海的地震非常常见，震中落在太平洋里
         → cnCityOf = 0 → 整场不填色（实测「花莲外海 M6.5」直接返回 null）。
         ⇒ 改用「离最近的区县测站 < 250km」判定：
           台湾海峡最宽 180km、台湾东岸到最近县市 < 100km，都覆盖得到；
           而首尔/九州/菲律宾巴丹离最近的中国测站都 ≥ 250km，不会误触发。 */
      var CN0 = global.QV_CN || [], nearKm = 9e9;
      var cs0 = Math.cos(q.lat * Math.PI / 180);
      for (var n0 = 0; n0 < CN0.length; n0++) {
        var dy0 = (CN0[n0][1] - q.lat) * 111.0;
        var dx0 = (CN0[n0][0] - q.lon) * 111.0 * Math.max(0.2, cs0);
        var d0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
        if (d0 < nearKm) nearKm = d0;
      }
      if (!(nearKm < 250)) return null;
    }
    /* ★★ 2026-10-23 第一优先级：USGS ShakeMap（官方烈度场）
       它不是图，是 9 条闭合等震线；拿它直接给地级市定档，模型完全不参与。
       ⚠ 只换 #mapcnareas 的填色，底图（kvtiles / 地形 / 海岸线）一行不动。 */
    var sm = shakemapFor(q);
    if (sm && sm.feats) {
      var MIN_SM = (stage === 'final') ? 1 : 2;
      var smAreas = cnFromShakemap(sm, MIN_SM);
      if (smAreas && smAreas.length) {
        return { areas: smAreas, n: smAreas.length, src: 'shakemap', sta: 0 };
      }
    }
    /* 目标等级：CENC 给的是烈度（1..12）。
       ★ 2026-10-21：**没有官方烈度时不要兜底成一个假烈度**（以前兜 5），
         否则 `ImaxWant` 会被锚到「烈度 5 的中点」，
         可实际只有 M4.6 深 65km → 物理峰值根本到不了 → 算出来自相矛盾。
         传 0 让 genStations 走「按震级估算峰值」那条分支，才是对的。 */
    var lv = +q.liedu;
    if (!(lv >= 1)) lv = +q.maxShindo;
    if (!(lv >= 1)) lv = +q.shindo;
    if (!(lv >= 1)) lv = 0;
    /* ★★★ 2026-10-26 用户：「M2.6 不该铺 4 度」—— 震级封顶
       实况：上游 wolfx `cenc_eqlist.json` 对「辽宁沈阳市浑南区 M2.6 / 深度 10km」
       自带 `intensity: "4"`，cnFill 把它当 ImaxWant 锚点 → 一下子铺出
       4/3/3/2 一大片地级市（实测截图），而 M2.6 的极震区实际上就是 III 度上下。
       原因：GB 18306-2015 表 1 是 **M4~8 强震**回归，小震段（M<5）用它会系统性偏高。
       ⇒ 只在 **M<5** 时加一道经验封顶（大震一律不动，避免碰到汶川 XI 那种官方值）：
              Icap = round(1.4·M − 0.8)     （M2.6→3，M3.0→3，M4.0→5，M4.6→6）
          官方值超过封顶就压到封顶值，铺色范围随之自然收小。 */
    if (isFinite(+q.mag) && +q.mag > 0 && +q.mag < 5 && lv >= 1) {
      var _icap = Math.max(2, Math.round(1.4 * (+q.mag) - 0.8));
      if (lv > _icap) lv = _icap;
    }
    /* ★★★ 2026-10-27 用户（截图）：青海玉树 M3.0 —— **卡片写「最大烈度 4」，
       地图上最高只有 3**。
       真因就是上面那道 M<5 封顶：官方给了 4（CENC intensity），
       封顶按 round(1.4M−0.8) 把 M3.0 压到 3 → 卡片/地图两套数。
       ⇒ 封顶只用来限制「铺多远」（远场别虚高）；
         **震中所在的地级市必须照官方值上色**（下面 areas 算完再补一刀），
         这样地图的最大值永远 == 卡片的最大值。 */
    var lvOfficial = (lv >= 1) ? lv : 0;
    if (+q.mag >= 1 && +q.mag < 5 && isFinite(+q.liedu) && +q.liedu >= 1) lvOfficial = Math.min(12, Math.round(+q.liedu));
    var obs = genStations(q.lat, q.lon, lv, 'liedu', q.depthKm, q.mag, cencStations(q),
      { strike: (q.cnStrike != null && isFinite(q.cnStrike)) ? +q.cnStrike : undefined,
        fault: q.cnFault || null });
    /* ★★★ 2026-10-26 兜底 A：**测站一个都没出，也不能让地图全空**
       实测「青海玉树州杂多县 M3.0/10km」：最近的区县测站离震中 66km，
       GB 模型在那儿只有 1.2 度，再被 M3 的远场下压扣掉 → 没有任何测站达到 1 度
       → genStations 返回空 → 以前这里直接 return null → 整张地图一块颜色都没有
       （用户：「中国地震没色块是硬伤」）。
       ⇒ 退一步：震中所在的（或最近的地级市）至少给一块色。 */
    if (!obs || !obs.length) {
      var _cE = 0;
      try { _cE = cnCityOf(q.lat, q.lon); } catch (eE) { _cE = 0; }
      if (!_cE) {
        var _ARE = global.QV_CN_AREAS || [], _bdE = 400, _csE = Math.cos(q.lat * Math.PI / 180);
        for (var _ei = 0; _ei < _ARE.length; _ei++) {
          var _ea = _ARE[_ei];
          if (!_ea || !_ea.b || !_ea.c) continue;
          var _elat = (_ea.b[1] + _ea.b[3]) / 2, _elon = (_ea.b[0] + _ea.b[2]) / 2;
          var _edy = (_elat - q.lat) * 111, _edx = (_elon - q.lon) * 111 * Math.max(0.2, _csE);
          var _edd = Math.sqrt(_edx * _edx + _edy * _edy);
          if (_edd < _bdE) { _bdE = _edd; _cE = +_ea.c; }
        }
      }
      if (_cE > 0) {
        /* ★ 2026-10-27：这一块代表震中，直接用【官方烈度】（不能再用封顶后的 lv） */
        var _lvE = Math.max(lvOfficial || 0, (lv >= 1) ? lv : 3);
        return { areas: [{ code: _cE, level: Math.max(2, Math.min(12, Math.round(_lvE))), metric: 'liedu' }],
          n: 0, src: 'epicenter', sta: 0 };
      }
      return null;
    }
    /* —— ① 地级市聚合（取该市所有测站的最大烈度）——
       ★ 只收 ≥ 2 度：1 度的物理阀值只有 0.1 cm/s（人几乎无感），
         但它会铺满半个中国 —— 截图里整个西南+华中全是浅蓝，信息量为零。
         中国地震台网的官方烈度图也从不画到 1 度。
       ★★ 2026-11-02 用户：「正式报应该就把全部地区的填入地图色块」
         → stage === 'final'（VXSE53 之后的正式报）时阀值降到 1 度，
           把「有震感」的市全部铺上；EEW / 调查中阶段仍然只用 ≥ 2 度（避免刷屏）。 */
    var MIN_I = (stage === 'final') ? 1 : 2;
    var mx = {}, hasCty = false;
    for (var i = 0; i < obs.length; i++) {
      var c = obs[i].cty | 0;
      if (!c) continue;
      if (!(obs[i].shindo >= MIN_I)) continue;
      hasCty = true;
      if (!(mx[c] > 0) || obs[i].shindo > mx[c]) mx[c] = obs[i].shindo;
    }
    var areas = hasCty ? Object.keys(mx).map(function (k) {
      return { code: +k, level: mx[k], metric: 'liedu' };
    }) : null;
    /* ★★★ 2026-10-26 兜底：**震中所在的地级市一定要有色**
       实测「青海玉树州杂多县 M3.0 深度 10km」：最近的区县测站离震中 66km，
       GB 模型在那儿只有 1.2 度，再被 M3 的远场下压（farOff 0.9）扣掉
       → 一个市都到不了 MIN_I → cnFill 返回 null → 地图上一块颜色都没有
       （用户：「中国地震没色块是硬伤」）。
       规范：算不出任何着色市时，至少把**震中所在**的那个地级市按锚定值填一块。
       （震中在海里 cnCityOf=0 → 不兜底，保持空，那种情况本来就不该有陆上色块。） */
    if (!areas || !areas.length) {
      var _c0 = 0;
      try { _c0 = cnCityOf(q.lat, q.lon); } catch (eC) { _c0 = 0; }
      /* ★ 震中落在**简化轮廓的缝隙里**（西藏/青海交界一带很常见）时 cnCityOf=0
         → 退回「离震中最近的地级市轮廓中心」，400km 内才算数。 */
      if (!_c0) {
        var _AR = global.QV_CN_AREAS || [], _bd = 400, _cs = Math.cos(q.lat * Math.PI / 180);
        for (var _ai = 0; _ai < _AR.length; _ai++) {
          var _aa = _AR[_ai];
          if (!_aa || !_aa.b || !_aa.c) continue;
          var _clat = (_aa.b[1] + _aa.b[3]) / 2, _clon = (_aa.b[0] + _aa.b[2]) / 2;
          var _dy2 = (_clat - q.lat) * 111, _dx2 = (_clon - q.lon) * 111 * Math.max(0.2, _cs);
          var _dd = Math.sqrt(_dx2 * _dx2 + _dy2 * _dy2);
          if (_dd < _bd) { _bd = _dd; _c0 = +_aa.c; }
        }
      }
      if (_c0 > 0) {
        /* ★ 2026-10-27：同上，这是震中那块，按官方烈度上色 */
        var _lv0 = Math.max(lvOfficial || 0, (lv >= 1) ? lv : 3);
        areas = [{ code: _c0, level: Math.max(2, Math.min(12, Math.round(_lv0))), metric: 'liedu' }];
      }
    }
    /* ★★★ 2026-10-27：震中地级市按【官方烈度】上色（见上文 lvOfficial 的说明）。
       不这么做的话，M<5 的封顶会让「卡片 4 / 地图最大 3」永远对不上。 */
    if (lvOfficial >= 1 && areas && areas.length) {
      var _cEp = cnNearestCity(q.lat, q.lon, 400);
      if (_cEp > 0) {
        var _hit = false;
        for (var _ax = 0; _ax < areas.length; _ax++) {
          if (+areas[_ax].code === _cEp) {
            _hit = true;
            if (+areas[_ax].level < lvOfficial) areas[_ax].level = lvOfficial;
            break;
          }
        }
        if (!_hit) areas.push({ code: _cEp, level: lvOfficial, metric: 'liedu' });
      }
    }
    /* ★ 2026-10-21 用户：「我不要区的！！！市级别就这样吧」
       ⇒ 填色**只到地级市**（cn-areas.js 那 369 块轮廓），不画区县级边界。
         2791 个测站只是数据源（每个点代表一个区县中心），
         它们只用来算烈度，绝不用来画边界 —— 地图上一块就是一座地级市。 */
    /* ★ 2026-10-26 试过在这里把等震线加回来（cnIsoGrid + setIsoPoints），
       但 mapcam 的 IDW(4) 对「方形采样网格」会在网格外拉出跨省的乱线 ——
       实测截图整张中国地图都是几条乱窜的绿蓝线（就是当年「太丑了」的真因）。
       形状变形已经做在**模型层**（断层距 JB + 地质分区 + Vs30），
       要更平滑的观感应该换成「按网格直接填色」，而不是叠轮廓线。 */
    return { areas: areas, n: obs.length, src: (CENC_ST.real ? 'cenc' : 'model'), sta: (CENC_ST.real ? CENC_ST.real.length : 0) };
  }
  V.cnFill = cnFill;

  function genStations(lat, lon, lv, metric, depthKm, mag, stOverride, opt) {
    /* ★★★ 2026-11-03 天体模式：**绝不能用地球测站表**
       （用户原话：「观测站的那里我还能看到北海道那些名字，你根本就没有换」）
       ⇒ 整表换成该天体自己的测站（带火星/月球地名），其余流程一模一样：
         同一套 setStations 渲染、同一套 P/S 波逐个点亮、同一个观测值列表。 */
    if (global.QVPlanet && global.QVPlanet.isPlanet() && global.QVPlanet.listStations) {
      var pl = global.QVPlanet.listStations(lat, lon, depthKm, mag, metric);
      if (pl && pl.length) return pl;
    }
    var pick = (stOverride && stOverride.length >= 4)
      ? { T: stOverride, cn: true }
      : pickStationTable(lat, lon);
    var T = pick.T, cnMode = pick.cn;
    if (!T || !T.length) return [];
    /* ★ 2026-10-20：官方除了陆上 K-NET/KiK-net，还有 **150 个 S-net 海底点**
       （Stage 全局列表 `sten:x` / `sten:y`，官方原样导出到 js/stennet.js）。
       `受信と検出` 里的 `海底震度分別 %s %s` / `海底震度許可判定 %s` /
       `海底震度復元 %s` 就是给这组坐标用的。这里直接拼成一个站点表。
       海底点没有地名，按官方顺序编成 S-net1..150。
       ★ 2026-10-21：合并测站表后 `cnMode` 恒为 true，不能再拿它挡住 S-net；
         S-net 只是固定的 150 个日本近海坐标，距离 1200km 之外的会被
         `if (hyp > 1200) continue` 自动过滤掉，所以无条件加上是安全的。 */
    var ST = global.QV_STEN || [];
    var ALL = T;
    if (ST.length) {
      ALL = T.slice();
      for (var si = 0; si < ST.length; si++) {
        ALL.push([ST[si][0], ST[si][1], 'S-net' + (si + 1)]);
      }
    }
    var lie = (metric === 'liedu');
    /* ★★★ 2026-10-26 中国区改走 **GB 18306-2015 表 1 分区烈度衰减关系**（见 js/cn-gmpe.js）
       用户：「中国区的模拟就是垃圾」—— 根因是拿日本的司・翠川式硬套中国：
         1918 南澳 M7.3/15km 实测：南澳岛 X 度 / 香港 VI–VII 度 / 台湾 V–VI 度，
         我们算出来 VIII / II / I — 近场低一档、远场低四五档（不是调参能修的，是规律不同）。
       ⇒ 中国境内（含台湾、港澳）且走烈度刻度时，I0 由中国关系式直接给，
         司・翠川只留给日本/海外。
       ⚠️ 判据只看**震中**位置：一次地震只能用一套衰减规律，不能按测站国别切换
          （否则又会出现「地震有国界」那种断层）。 */
    var useCN = !!(lie && global.QVCNGM && QVCNGM.inChina(lat, lon));
    var cont = toCont(lv);
    if (lie) cont = Math.min(7, Math.max(0, (+lv || 0)));
    /* ★★★ 2026-10-21 用户：「为什么我输 M999999 直接卡死了哈哈哈」
       — 物理钳制（不是装饰，是防呆）：
         地壳地震的震级物理上限约 **10**（M10 的断层长度 Lf≈3.5×10⁴ km > 地球周长），
         深度上限约 **700km**（更深处岩石是塑性流动，不产生脆性破裂）。
         输入 M999999 时 `Math.pow(10, 0.5*M)` = Infinity
         → logPGV = -Infinity → 每个测站 I = NaN → 整张场全废，
         而且模拟面板的 range(`max=9.9`) / 提示文案全被带歪。
         ⇒ 入口处直接夹死，后面所有公式都不会再看到非法值。
         ⚠️ 下限 1.0：M<1 是"微震"，本项目测站网根本测不到，报出来没意义。 */
    var dep = Math.max(0.5, Math.min(700, isFinite(depthKm) ? +depthKm : 10));
    var M = (mag != null && isFinite(mag)) ? +mag : (5.5 + Math.max(0, cont - 3) * 0.5);
    M = Math.max(1.0, Math.min(10.0, M));
    var Lf = Math.min(1600, Math.pow(10, 0.5 * M - 1.85));
    /* 深源衰减修正（见 deepTerms 的说明）：浅源时与旧公式完全等价 */
    var _dt = deepTerms(dep), deff = _dt.deff, kAn = _dt.kAn;
    var cos = Math.cos(lat * Math.PI / 180), R = 111.0, out = [];
    /* ★★ 2026-10-20 用户报两个物理问题：「M7.7 却只有 6强」「关东平原一大片同时 6强」。
       两个真因：
       ① `Rf = max(0.5, d - 0.45·Lf)`：M7.7 的 Lf≈100km ⇒ 45km 内 Rf 全被夹成 0.5
          ⇒ 那些点的 PGV 完全相同 ⇒ 震度一整片一样（不符合衰减规律）。
          改成「平滑饱和」：sqrt(rf0²+0.25) + 0.10·d，近场仍有梯度。
       ② GMPE 的绝对水平不带 M 校准 ⇒ 近场只算到 6.1，M7.7 反而永远摸不到震度7。
          改成先算原始场，再整体平移到「该 M 应有的最大震度」：
            Imax = 4.0 + (M-5.0)·1.2，上限 7.4 → M6→5.2 / M7→6.4 / M7.7→7.2
          这样近场到 7、远处按真实衰减形状掉下去，不再被 cap 削平。 */
    /* ★★★ 2026-10-21 修正：**中国烈度模式下以官方最大烈度锚定峰值**
       实测 2026-10-21 云南玉溪元江县 M3.0 深 7km：
         卡片（CENC 的 MaxIntensity）写「最大烈度 5」，
         而 ImaxWant = 4.0 + (3.0-5)·1.2 = 1.6 ⇒ 峰值只有 1 度 ⇒ 地图一块都不填。
       「官方给了 5 度，我们自己算出来 1 度」明显自相矛盾。
       ⇒ 有官方烈度时取该档区间的**中点**当峰值（5 度 → I≈3.88），
         震级估算只在没有官方烈度时兜底。日本走 shindo 模式，不受影响。 */
    var ImaxWant;
    if (useCN) {
      /* 中国：有官方烈度就以官方档位为准（换成 appI 刻度），没有就由中国关系式给峰值。
         ⚠️ 不能用原来的「档位区间中点」：中国关系式的峰值本身就是绝对的（R=0 处 X 度），
            再套中点锚定会把 9.66 度压到 8 度（这正是用户看到「南澳岛只有 8 度」的一环）。 */
      ImaxWant = (+lv >= 1)
        ? QVCNGM.appI(Math.min(12, +lv))
        : QVCNGM.appI(QVCNGM.peak(M, dep, lat, lon));
    } else if (lie && +lv >= 1 && +lv <= 12) {
      var _E = (global.QV_LIEDU && QV_LIEDU.EDGES) || null;
      if (_E) {
        var _lo = _E[(+lv) - 1], _hi = ((+lv) < 12) ? _E[+lv] : _lo + 0.5;
        ImaxWant = (_lo + _hi) / 2;
      } else {
        ImaxWant = 2.0 + ((+lv) - 1) * 0.5;
      }
    } else if (+lv >= 1) {
      /* ★★★ 2026-10-28 用户：「为什么侧站和区域都报了 7，结果最大震度是 5+」
         —— 日本震度模式下，生成场的峰值原来**只按震级算**
            （M7.5 → ImaxWant = 4+2.5×1.2 = 7.0），完全无视输入的最大震度。
            于是卡片写 5+、地图却刷出一片 7，自相矛盾。
         ⇒ 与上面 CENC 分支同理：**有明确的最大震度就以它为锚**，
            震级只负责衰减形状与影响范围。
         ⚠️ 不能用 toCont(lv)：`toCont(55)` = 5.5，而 shindoFromI 里
            [5.5,6.0) 已经是**6弱**了 —— 正好压在分界线上，峰值站会被算高一级
            （实测：设 5強 → 地图刷出 6弱）。必须取**档位区间中点**。 */
      ImaxWant = Math.min(7.0, shindoBandI(+lv));
    } else {
      ImaxWant = peakI(M, dep);
    }
    var rawI = [], rawMeta = [], ImaxRaw = -9, ImaxD = 0;
    for (var i = 0; i < ALL.length; i++) {
      var dy = (ALL[i][1] - lat) * R;
      var dx = (ALL[i][0] - lon) * R * Math.max(0.2, cos);
      var d = Math.sqrt(dx * dx + dy * dy);
      var hyp = Math.sqrt(d * d + dep * dep);
      /* ★★★ 2026-10-25 **震源距必须是震源距，不是震中距**
         司・翠川(1999) 的 R 是【震源距离】= √(震中距² + 深度²)。
         以前这里拿震中距 d 当 R，深度只进了 `+0.0038D` 那一项 →
         深源地震（小笠原 M7.0/470km）近场被算成震度6弱，实测只有 3。
         另外截止距离也从 1200 放到 1600：深源地震有感范围能到 1400km+
         （本次实测青森/岩手 1400km 还有震度1，以前直接被切掉）。 */
      if (hyp > 1600) continue;
      /* ★★★ 2026-10-25 **大震饱和**（311 M9.0 实测：我们全线高 1.0~1.4 级）
         司・翠川式是线性 M 的，M9 时 `0.58M` 把整片场抬得过高。
         物理上震级超过约 8.3 后，破裂长度已远大于波长，PGV 不再随 M 线性增长。
         ⇒ 公式里取 min(M, 8.3)（14 场著名地震回测：311 的 MAE 1.79 → 0.85）。 */
      var Ms = Math.min(M, 8.3);
      var I0;
      if (useCN) {
        /* ★★★ 中国：GB 18306-2015 表 1 分区烈度衰减（长/短轴椭圆 + 断层距 + 场地）
           QVCNGM.intensity() 直接返回「度」，再换算成本项目统一的 appI 刻度。
           里面已经含：断层距 JB（沿断层拉长）、深源项(h−60)、长短轴方向性、
           珠三角/台北/长三角等盆地表 + 地质构造区（盆地/山系）+ USGS Vs30。 */
        I0 = QVCNGM.appI(QVCNGM.intensity(lat, lon, M, dep, ALL[i][1], ALL[i][0], opt));
      } else {
        /* 断层项系数 0.45 → 0.35：用 14 场（含能登 M7.6 / 熊本 M7.3 / 十勝沖 M8.0）标定，
           取 0.35 时整体 MAE 0.652（0.45 是 0.686），近场不再被削得太狠。 */
        var rf0 = Math.max(0, hyp - 0.35 * Lf);
        var Rf = Math.sqrt(rf0 * rf0 + 0.25) + 0.10 * hyp;
        var logPGV = 0.58 * Ms + 0.0038 * deff - 1.29
          - Math.log10(Rf + 0.0028 * Math.pow(10, 0.5 * Ms))
          - kAn * Rf;
        /* ★★★ 2026-10-21 场地效应（用户：「不同地层、不同土，它的震度也是不一样的」）
           amps = 该测站所在地的放大系数（Borcherdt 简化式，来自 USGS Global Vs30）：
             Vs30=180（软土/填海地）→ 1.48｜760（基准）→ 1.00｜1500（硬岩）→ 0.79
           ⚠️ 网页版用 1° 粗网格（app/js/vs30.js + vs30-grid.js）；
              没有 vs30-grid.js 时 QVVS30At 恒返回 1，等于关闭此特性，不影响其他逻辑。
              APP 版可把 1km 原始数据内置，精度更高。 */
        var _amp = 1;
        try {
          if (global.QVVS30At) _amp = global.QVVS30At(ALL[i][1], ALL[i][0]) || 1;
        } catch (eA) { }
        logPGV += Math.log10(_amp);
        /* 深源異常震域：板片越深的地方，上行要多穿楔形地幔（见 slabPenalty 说明） */
        logPGV -= slabPenalty(ALL[i][1], ALL[i][0], dep);
        var pgv = Math.max(1e-6, Math.pow(10, logPGV));
        I0 = 2.68 + 1.72 * Math.log10(pgv);
        /* M>7.5 的近场补偿（原本是为了让 M8 摸得到震度7）；超过 8.0 后封顶，
           否则 M9 会被多抬 0.5 级以上（311 实测）。 */
        if (M > 7.5) I0 += Math.min(M - 7.5, 0.5) * 0.45;
      }
      /* ★★★ 2026-10-27 同时记下「拿到峰值那一站的震央距」——
         锚定偏移量要在这里拿满（见下面 shift 的用法，用户报的
         「地图上就只有 8，为什么卡片上有 9」就是这条引起的）。 */
      if (I0 > ImaxRaw) { ImaxRaw = I0; ImaxD = d; }
      rawI.push(I0);
      rawMeta.push([ALL[i], d, hyp]);
    }
    /* 整体平移到应有峰值：形状不变，只抬/压绝对水平
       ★★★ 2026-10-26 有**官方等震线**时**绝不**做这个平移：
         场已经是官方烈度图本身，再按「测站最大值 → 应有峰值」抬一次会整体膨胀。
         实测（汶川）：映秀一带没有区县测站落进 XI 带 → ImaxRaw 只有 8 度左右，
         shift = appI(11)−appI(8) ≈ 2.1 → 成都被抬到 10 度（官方 VI–VII）。 */
    var _hasIso = !!(opt && (opt.iso || (opt.fault && opt.fault.iso)));
    var shift = (_hasIso || ImaxRaw <= -9) ? 0 : (ImaxWant - ImaxRaw);
    /* ★★★ 2026-10-20 用户（图一）：官方「揺れを検出」的绿/黄/橙框 = 三档**包络**：
         绿 = 0.5 ≤ I < 1（震度1未満：感知到摇晃但不到 1）
         黄 = 1 ≤ I < 2（震度1）
         橙 = I ≥ 2（震度2）
       ⚠ 必须按【连续值 I】分档，不能按 code：code 1 本身就覆盖 I∈[0.5,1.5)，
         以前拿 `code < 1` 去收绿框 → 永远收不到东西（绿框从来没画出来过）。 */
    var band = [null, null, null];
    /* ★ 2026-10-20 用户：「地图上显示的应该是检测到震度的震点，也就是震度0」
       ⇒ 除了 code≥1 的测站，还要把「检出但还不到1」（震度0）的点也收一份，
         检测态只画这批点（不画色块）。阈值 0.2 ≈ 仪器能感到的最小摆动。 */
    var det = [];
    /* 远场软下压系数（震级相关，见下面循环里的说明） */
    var farOff = 0.6 * Math.max(0, Math.min(1, (6.0 - M) / 2));
    function addBand(idx, la, lo) {
      var b = band[idx];
      if (!b) b = band[idx] = { lon0: 1e9, lat0: 1e9, lon1: -1e9, lat1: -1e9, n: 0 };
      if (lo < b.lon0) b.lon0 = lo;
      if (lo > b.lon1) b.lon1 = lo;
      if (la < b.lat0) b.lat0 = la;
      if (la > b.lat1) b.lat1 = la;
      b.n++;
    }
    for (var k = 0; k < rawMeta.length; k++) {
      var m0 = rawMeta[k];
      /* ★★★ 2026-10-21 用户：「一个三级地震，半个亚洲都有震感了」
         真因：以前是把整片场的震度【整体平移】到应有峰值（rawI[k] + shift），
         shift 是常数 → 40km 外的测站也被抬一样多 → 本该 0 的远处全变成震度1。
         现在：shift 按距离衰减（近场拿满，远处接近 0）：
           I = rawI + shift * exp(-d / R0)，R0 = max(20km, 1.5×断层长度)
         M3.2 → R0≈20km（几十公里外就没了）；M7 → R0≈67km，近场照样能到 7。 */
      /* 中国关系式本身已经是绝对刻度（峰值自带），锚定只在「官方值与模型不一致」时才需要，
         而且必须收窄作用半径：用 2.5Lf（M7.3 时 157km）会把远场整片抬高近 1 度，
         香港就从 VII 变 VIII 了。 */
      var R0 = useCN ? Math.max(20, 0.8 * Lf) : Math.max(15, 2.5 * Lf);
      /* ★★★ 2026-10-27 用户：「地图上就只有 8，为什么卡片上有 9」
         —— 卡片的最大烈度用的是**震中**的理论值（QVCNGM.peak → 9.07 度），
            而地图色块是**区县测站**的值。测站网最密也就 20~40km 一站，
            震中往往落在两站之间：M6.5 的 0km=Ⅸ / 40km≈Ⅶ，最近的站可能只有 Ⅷ。
            以前 shift 从**震中**开始按 exp(-d/R0) 衰减（R0 只有 20km），
            最近那一站只能拿到 13% 的偏移量 → 地图永远摸不到锚定值 → 卡片 9、地图 8。
         ⇒ 偏移量改成从「拿到 ImaxRaw 的那一站」起算：
            那一站拿满 → 地图最大值 == 卡片最大值（本项目铁律：卡片/测站/地图同值），
            再往外依旧按 exp 衰减，远场不会被抬高（「三级地震半个亚洲」不会复发）。
         ⚠ 只对中国生效；日本的取景/震度标定是另外几十场实测调出来的，不动。 */
      var _dRel = (m0[1] || 0) - (useCN ? ImaxD : 0);
      if (_dRel < 0) _dRel = 0;
      var I = Math.max(-1, Math.min(7.5, rawI[k] + shift * Math.exp(-_dRel / R0)));
      /* ★★★ 2026-10-25 **远场软下压**（24 场近一个月官方事件批量对照标定）
         实测：我们点亮 3.17 倍于官方的观测点数（区域色块 2.0 倍）——
         阈值扫描得：把「震度1」门槛从 I≥0.5 抬到 I≥1.1，比值刚好 1.00。
         但直接抬门槛会砍假大震（311 那片震度1 是真的），
         所以按「小震高频成分→衰减更快」的物理，做成**震级相关**的下压：
           M≥6 不下压；M5 → 0.3；M≤4 → 0.6（最大）。
         峰值是锚定的，且 d>20km 才开始生效 → 不影响最大震度与近场。 */
      if (farOff > 0) {
        I -= farOff * (1 - Math.exp(-Math.max(0, (m0[1] || 0) - 20) / 60));
      }
      var code = lie ? (global.QV_LIEDU ? QV_LIEDU.codeOfI(I) : Math.max(0, Math.min(12, Math.round(I * 1.4) + 2)))
        : shindoCode(I);
      if (I >= 2) addBand(2, m0[0][1], m0[0][0]);
      else if (I >= 1) addBand(1, m0[0][1], m0[0][0]);
      else if (I >= 0.5) addBand(0, m0[0][1], m0[0][0]);
      /* ★★★ 2026-10-25 `epi` = 震央距（水平），`hyp` = 震源距（含深度）。
         用途必须分开（深源时两者能差一倍以上）：
           · 波前推进 / PLUM 半径 / 「扫到哪儿」→ 用 epi
           · S/P 波到时 / 远近排序              → 用 hyp
         以前全部用 hyp 去比震央距波前 → 深源地震「一开场全部测站都算已到达」。 */
      if (I >= 0.2) det.push({ lat: m0[0][1], lon: m0[0][0], shindo: code, intensity: I,
        /* ★ 2026-10-21：检测态列表要显示【地区名】。中国区县级测站没有 JMA 名字表，
           靠 `areaName(code, fallback)` 退回测站名 → 这里必须带上 name，
           否则会显示成「区域512002」。 */
        name: m0[0][2],
        /* ★ 检测态范围框要用「测站属于哪个官方细分区域」→ 这里先算好（自带缓存） */
        area: stationArea(m0[0], true),
        sea: stationSea(m0[0]),
        epi: m0[1], hyp: m0[2],
        /* ★★★ 2026-10-28 用户：「快同步」
           —— 波圈用的是 JMA2001 官方走时表，而测站点亮写死 `hyp/6.5`、`hyp/4`
              （深源时两套差得很远：圈跑在前面、测站在后面）。
           ⇒ 测站的 tp/tv 也走同一张表：tp = travelSec(深度, 震央距, P)，tv = …S。 */
        tp: statTp(lat, lon, m0[1], m0[2], dep), tv: statTv(lat, lon, m0[1], m0[2], dep) });
      if (code < 1) continue;
      out.push({ lat: m0[0][1], lon: m0[0][0], shindo: code, intensity: I,
        name: m0[0][2],
        /* ★ 2026-10-20：区域代码改成自动检测（多边形 → 最近边界 → 海底点不归属）
           以前直接 `areaOf()`，掉在多边形外的点 area=0 → 被 aggOf 丢掉 →
           东京（亀戸/越中島）永远不会出现在「各地震度信息」里。 */
        area: stationArea(m0[0], true),
        sea: stationSea(m0[0]),
        /* ★ 2026-10-21：烈度色块用的「地级市」编号（只有中国测站有；日本 = 0） */
        cty: (m0[0] && m0[0][4] === 'cn') ? cnCityOf(m0[0][1], m0[0][0]) : 0,
        epi: m0[1], hyp: m0[2],
        /* 2026-10-24: S-wave arrival.
           ★ 2026-10-20 用户：「为什么只有 S 波有反应，P 波没有」——
           以前这里只有 tv（S 波），P 波到达时屏幕上什么都不动。
           ★ 2026-10-28：tp/tv 改成 JMA2001 走时表（见 statTp/statTv），
             与 P/S 波圈完全同步，不再用 6.5 / 4.0 km/s 的硬编码。 */
        tp: statTp(lat, lon, m0[1], m0[2], dep),
        tv: statTv(lat, lon, m0[1], m0[2], dep) });
    }
    out.bands = band;       /* ★ [绿, 黄, 橙] 三档包络（无则 null） */
    out.det = det;          /* ★ 全部检出点（含震度0）—— 检测态画点用 */
    out.low = band[0];
    return out;
  }
  /** 官方报数规律：**震度越大报越多**，M 再修正，深源略减
   *  （用户点名：「震度很大的地震 40 多报 / 50 多报，震度很小只有 1~2 报」） */
  /** ★★★ 2026-10-21 用户：「报文数不是人为定的，模拟就是看测站反应。
      这个算法（PLUM）的预测就可以作为一个发报 —— 小地震波及的测站点少，
      所以自然发报数量就少；大地震波及范围广，所以发报多。」
      ⇒ 报文总数由【有震感的测站数】折算，不再用震级/随机数拍脑袋：
        每 ~14 个测站 1 报（震度4 约 100~200 站 → 7~14 报；
        震度7 约 800+ 站 → 50+ 报，正好落在官方那 40 多报的量级）。 */
  function reportPlanFromObs(obs) {
    /* ★★★ 2026-10-25 用用户提供的 **15 个真实 EEW 样本**标定的报文数模型
       （原实现是「震度≥0.5 的测站数 ÷ 14」，纯拍脑袋）。
         实测样本：
           震度3  → 群馬 7 / 宗谷 6 / 宮古島 7
           震度4  → 千葉 7 / 宮崎 10 ／ **青森県東方沖 M6.9 → 24**（广域但震度不高）
           震度5弱→ 茨城 M5.9 70km → 21
           震度5強→ 島根 23 ／ 小笠原 M8.1 682km → 16（深源变少）
           震度6弱→ 岩手 M6.9 50km → 28
           震度6強→ 青森 M7.5 → 42
           震度5強広域→ 三陸沖 M7.7 19km → 37
           震度7  → 熊本 M7.1 10km → 27
           海外  → 台湾 M7.0 → 11 ／ 加里曼丹 M7.0 620km → 11
         ⇒ 规律：① 基准看最大震度 ② 深源压到 16 ③ M≥7.4 浅源 ×1.5
                  ④ M≥6.8 但震度只有 4 的「广域低震度」型给 24 ⑤ 海外 11 */
    var n = 0;
    for (var i = 0; i < (obs || []).length; i++) {
      if ((+obs[i].shindo || 0) >= 0.5) n++;
    }
    var na = Math.max(1, Math.min(60, Math.round(n / 14)));   /* 旧的测站数估计（兜底） */
    var M = +arguments[1], D = +arguments[2], LA = +arguments[3], LO = +arguments[4];
    var L = +arguments[5];
    /* ★★★ 2026-10-28 用户：「第9报的给我最终报了」/「M8.0 也这样」
       —— 根因：这个函数是按**震度码**（0/1/2/3/4/10…/70）分档的，
          而中国/海外走的是**烈度**（1~12 的整数）。烈度 9 落进最后那个
          `else cls = clamp(round(L),0,4)` → cls=4 → base=7 报
          → M8.0 的强震也只有 7~9 报就发「终报音」（koushinE）。
       ⇒ 增加 metric 参数，烈度单独映射到等价档位（烈度 9 ≈ 震度7 → 28 报）。
         不改任何震度/海啸计算，只修「报文条数」。 */
    var _MET = arguments[6];
    if (!isFinite(M) || M <= 0) return na;
    /* ⑤ 海外远震：JMA 只报日本境内的震度1
       ★ 2026-10-28：中国（烈度卡）不再走「海外一律 11 报」这条 ——
          以前佛山的 M6.5 也只发 11 报，第 9~11 报就响「终报音」。
          中国改走下面的烈度档位映射（烈度 8 → 27 报）。 */
    if (_MET !== 'liedu' && isFinite(LA) && isFinite(LO) &&
      !(LO >= 127 && LO <= 147 && LA >= 24 && LA <= 46)) return 11;
    /* ② 深源：观测点少、收敛快
       ★ 2026-10-25 样本《日本海北部 M5.6 深350km》：EEW 只发 **10 报 + 终报**
         （19:35:41 #1 → 19:37:58 #终，约 2 分 17 秒），比同规模浅源少一半。 */
    if (isFinite(D) && D >= 150) return (M >= 6.5 ? 16 : 10);
    /* ① 基准表。⚠ 不能统一 `÷10` —— `55 ÷ 10 = 5.5`，`Math.round` 会变成 6（5強→6弱），
       档次全错。先归一化成「震度档位」1..4 / 5=5弱 / 6=5強 / 7=6弱 / 8=6強 / 9=7。 */
    var cls;
    if (_MET === 'liedu') {
      /* 烈度 → 等价震度码（用户 2026-10-28 给的对照表，见 LIEDU2SHINDO）→ 再用震度档位 */
      var _LI = Math.round(L);
      if (!(_LI >= 0)) _LI = 0;
      if (_LI > 12) _LI = 12;
      var _sc = LIEDU2SHINDO[_LI];
      cls = _sc >= 70 ? 9 : _sc >= 65 ? 8 : _sc >= 60 ? 7 : _sc >= 50 ? 6
        : _sc >= 45 ? 5 : _sc >= 40 ? 4 : _sc >= 30 ? 3 : _sc >= 20 ? 2 : _sc >= 10 ? 1 : 0;
    } else if (L >= 70) cls = 9;
    else if (L >= 65) cls = 8;
    else if (L >= 60) cls = 7;
    else if (L >= 55) cls = 6;
    else if (L >= 50) cls = 5;
    else if (L >= 40) cls = 4;
    else if (L >= 30) cls = 3;
    else if (L >= 20) cls = 2;
    else if (L >= 10) cls = 1;
    else cls = Math.max(0, Math.min(4, Math.round(L)));      /* 0..4 真值 */
    var BASE = [5, 6, 6, 7, 9, 21, 23, 27, 28, 27];          /* 下标 = cls */
    var base = BASE[Math.max(0, Math.min(9, cls))];
    /* ③ 大规模浅源广域（青森 M7.5→42、三陸沖 M7.7→37） */
    if (M >= 7.4 && (!isFinite(D) || D <= 60)) base = Math.round(base * 1.5);
    /* ④ 规模不小但最大震度只有 4 的广域型（青森県東方沖 M6.9→24） */
    else if (M >= 6.8 && cls <= 4) base = 24;
    return Math.max(5, Math.min(45, base));
  }

  /** ★★★ 2026-10-21 IPF 的网格搜索简化版：**用已观测测站反推 (M, 深度)**
      用户：「按照这个算法来讲，它的规模和深度跳动的应该是正负 1.0 那样子，刚开始站点少」
      —— 真 IPF 是从「已收到的 P/S 波观测」反解震源参数，不是对设定值做插值。
      这里用最朴素的做法：在 (M, dep) 网格上暴力搜索，取「预测震度 vs 实测震度」残差最小的一组。
      · 测站少 → 残差曲面平缓 → 解不唯一 → 读数乱跳（正是要的效果）
      · 测站多 → 曲面收敛 → 与真值吻合
      ⚠️ 用 hyp 近似水平距离 d（深源误差大，但深源本来就难估，符合现实）。
      性能：M 步长 0.2（30 档）× dep 步长 10（21 档）× 最多 40 站 ≈ 2.5 万次 → 单次 <5ms。 */
  function predictIPgv(d, dep, M) {
    var Lf = Math.min(1600, Math.pow(10, 0.5 * M - 1.85));
    /* ★ 2026-10-25：与 genStations 保持同一个模型（震源距 + 深源修正），
       否则 IPF 反推出来的 (M, 深度) 和生成场对不上（残差里混着模型差）。 */
    var t = deepTerms(dep);
    var R0 = Math.sqrt(d * d + dep * dep);
    var Ms = Math.min(M, 8.3);
    var rf0 = Math.max(0, R0 - 0.35 * Lf);
    var Rf = Math.sqrt(rf0 * rf0 + 0.25) + 0.10 * R0;
    var logPGV = 0.58 * Ms + 0.0038 * t.deff - 1.29
      - Math.log10(Rf + 0.0028 * Math.pow(10, 0.5 * Ms))
      - t.kAn * Rf;
    var I = 2.68 + 1.72 * logPGV;
    if (M > 7.5) I += Math.min(M - 7.5, 0.5) * 0.45;
    return I;
  }
  function inferSource(observed) {
    var list = observed.slice(0, 40);            /* 只用最近的 40 站，够用且快 */
    if (list.length < 4) return null;
    /* ★★★ 2026-10-21 用户：「地震规模大到一定程度，算法很容易卡死在 M9.8 200km」
       三个真因，按致命程度排：
       ① **残差用错了刻度**：`list[i].shindo` 是官方震度**码**（震度7 = 70、6强 = 65），
          而 `predictIPgv()` 返回连续值 0~7.5 → diff = 7.4 − 70 = −62.6
          ⇒ 残差被常数差主导，最优解永远漂到搜索边界（= "卡死在 M9.8/200km"）。
          改用 `list[i].intensity`（genStations 里存的原始连续 I）。
       ② **反推场 ≠ 生成场**：genStations 最后还有「整体平移到 ImaxWant」+ 上限截断，
          而 predictIPgv 没有 → 两边绝对水平对不上，M 被系统性顶大。
          改用「形状匹配 + 自动偏移」：先算观测均值/预测均值，偏移量 b = 均值差，
          残差只比**相对关系**（等价于官方 IPF 用多点相对关系反演的思路）。
       ③ 搜索空间太小：真值 M9.8 / 深 200km+ 正好压在上界
          ⇒ M 3.5~10.0（步长 0.1）、深度 0~700km（真实最深≈700km）。
       深度可分辨性：`d = √(hyp² − dep²)`（几何反算水平距离），
          深源时候选深度越大 → 同样 hyp 对应更小的 d → 近场更集中、远场更平。
       性能：66×71 组 × 40 站 × 2 遍 ≈ 37 万次，带剪枝 → 单次 15~25ms（每报只跑一次）。 */
    var Y = [], HY = [], n0 = list.length;
    for (var i0 = 0; i0 < n0; i0++) {
      Y.push((list[i0].intensity != null && isFinite(list[i0].intensity))
        ? +list[i0].intensity : toCont(list[i0].shindo));
      HY.push(+list[i0].hyp || 0);
    }
    var best = null, bestErr = Infinity, P = new Array(n0);
    /* ★ 同一个上限：genStations 把整片场 `Math.min(7.5, ...)` 截过，
       这里不截 → M9.8 时候选预测能到 8.5，而观测最大只有 7.5，
       残差逼着搜索去选「更小的 M」→ 这就是 M9.8 反推崩掉的原因。 */
    var I_CAP = 7.5, I_FLOOR = -1;
    /* ★★★ 2026-10-21 「梯度裁剪」之一：**参数空间裁剪（几何硬约束）**
       实测证据（M9.8/200km，最近 40 站 hyp 313~371km，强度全在 7.34~7.44）：
         观测场饱和成一条**平线** → 信息量≈0
         → 当 dep=480 > hyp 时 d = √(hyp²−dep²) 退化成 0，
           所有测站预测同一个常数 → 能 0 残差完美拟合 → 反推出 M3.5/480（荒谬解）。
       ⇒ 深度不得超过【最近测站】的震源距（震源不可能比测站还深），
         否则 d 会塌成 0、整片场退化成常数。
         这条约束把 M9.8/200 那种真解留在可行域内、把 M3.5/480 直接排除。 */
    var minHyp = Infinity;
    for (var i1 = 0; i1 < n0; i1++) if (HY[i1] < minHyp) minHyp = HY[i1];
    var depMax = Math.max(0, Math.min(700, Math.floor(minHyp) - 5));
    for (var Mi = 35; Mi <= 100; Mi += 1) {       /* M 3.5 ~ 10.0，步长 0.1 */
      var M = Mi / 10;
      for (var dep = 0; dep <= depMax; dep += 10) {
        var err = 0, i, hyp, d;
        for (i = 0; i < n0; i++) {
          hyp = HY[i];
          /* 几何反算水平距离：深源 → 同样的 hyp 对应更小的 d（深度才有可分辨性） */
          d = (hyp > dep) ? Math.sqrt(hyp * hyp - dep * dep) : 0;
          P[i] = Math.min(I_CAP, Math.max(I_FLOOR, predictIPgv(d, dep, M)));
          var diff = P[i] - Y[i];
          err += diff * diff;
          if (err > bestErr) break;               /* 剪枝 */
        }
        /* ★ 退化检测：候选预测场几乎是常数（方差<0.08 震度）→ 说明它靠"压平"拟合，
           这种解即使残差小也不可信，加重罚让它出局。 */
        if (err <= bestErr) {
          var pLo = 1e9, pHi = -1e9;
          for (i = 0; i < n0; i++) {
            if (P[i] < pLo) pLo = P[i];
            if (P[i] > pHi) pHi = P[i];
          }
          if (pHi - pLo < 0.08) err += 1e4;
        }
        if (err < bestErr) { bestErr = err; best = { mag: M, depth: dep, err: err, n: n0 }; }
      }
    }
    return best;
  }
  /** 第 n 报的间隔（ms）
   *  ★★★ 2026-10-21 用户按 7.9 级地震实测口径给的节奏：
   *    「前十报基本上都是半秒、一秒一个，一分钟之内至少发 20 个；
   *      之后一分钟到三分钟，会再陆续发 10~15 个」
   *  ⇒ 1~10 报 0.5~1.0s；11~20 报 ~1.6s（此时累计 ≈25s，满足「1 分钟内 ≥20 报」）；
   *    之后 2.5~6.0s（1 分钟 10~15 报）。全部带 ±15% 抖动。
   *  ⚠️ 旧版是前 3 报 1.7~2.5s、之后 2.1s+320√n 一路放缓到 8s —— 用户原话「快睡着了」。 */
  /** 第 n 报的间隔（ms）—— ★ 2026-10-21 改：按【总进度】分段，而不是按报数硬切。
      用户：「越往下的那个地震（小震）应该是慢慢发，而不是和大地震一样刚开始快速发一下」
      ⇒ 前 1/4 密（大震开头猛）、中段中、后段疏；
        小震 plan 小 → 第 1 报就已经在 1/4 之外 → 天然是慢节奏。
      大震 plan=50：1~12 报 0.5~1s｜13~27 报 0.9~1.8s｜28~50 报 2~4.5s
      小震 plan=5 ：第1报 0.5~1s｜第2~3报 0.9~1.8s｜第4~5报 2~4.5s */
  function reportGap(n, plan) {
    /* ★★★ 2026-10-25 按【熊本 M7.1 真实 30 报】的时间轴标定（用户手动采集）：
       前 24 报极其密集：16:27:20 #1 → 16:27:36 #21 只花 16 秒，
         间隔 0–2 秒，甚至同一秒连发两报；
       之后变成「心跳」：#25 起分别是 +21 / +19 / +14 / +20 / +21 秒。
       ⇒ 双段式：密集期 0.25–0.95 秒，心跳期 13–21 秒。
       分界点 = 收敛完成（约 plan × 0.72）。 */
    var settle = Math.max(6, Math.round((plan || 20) * 0.72));
    if (n <= settle) return 250 + Math.random() * 700;
    /* ★★★ 2026-10-28 用户：「发报频率调节：不发报，默认，快速，密集」
       ⇒ 节奏本身恢复成原来那份（心跳期 13~21 秒，按熊本实测标定），
         只在**模拟面板**里给一个可选的档位：
           不发报（simRate=0）→ 不发续报（step 循环直接结束，只保留首报）
           默认（simRate=1）→ 13~21 秒
           快速（simRate=2）→ 约 3 倍（≈4.3~7 秒）
           密集（simRate=3）→ 后半段也用密集期节奏（250~950ms） */
    if (simRate === 3) return 250 + Math.random() * 700;
    if (simRate === 2) return 4300 + Math.random() * 2700;
    return 13000 + Math.random() * 8000;
  }
  /** ★★★ 2026-10-25 按熊本 M7.1 实测的 **M 收敛包络**：
       #1 无 M（リアルタイム震度直接推定）→ #2 **5.0**（真值−2.1）
       → #5 6.3（−0.8）→ #7〜#21 在 6.6〜6.9 来回抖（−0.5±0.3）
       → #22 起定格 7.1。
     我们之前首报只退 0.5（6.6），而且 4 报就收敛 —— 太快、起得太高。
     ★ 2026-10-25 同时按另外两份样本补齐：
       青森県東方沖 M7.5/50km → #1 **M5.7**（−1.8，不是 −2.1）
       日本海北部 M5.6/深350km → #1 **M5.3**（−0.3，深源本来就准） */
  function magEnv(n, magT, plan, dep) {
    if (magT == null || !isFinite(magT)) return null;
    var settle = Math.max(6, Math.round((plan || 20) * 0.72));
    /* 深源：IPF 用的是远场 P/S 到时，深源几何简单、反演稳定 → 首报几乎等于真值 */
    if (isDeepSrc(dep)) {
      if (n <= 2) return Math.max(3.0, magT - 0.3);
      if (n < settle) return Math.max(3.0, magT - 0.15);
      return magT;
    }
    var off = (magT >= 7.0) ? 1.8 : 2.1;
    if (n <= 2) return magT - off;
    if (n <= 4) return magT - off + (n - 2) * 0.5;     /* #3 −1.3 / #4 −0.8（M7.5→6.2/6.7） */
    if (n <= 6) return magT - 0.8;
    if (n < settle) return magT - 0.5;                /* 平台段：真实在 6.2–6.9 抖 */
    return magT;
  }
  /** ★★★ 2026-10-25 震度爬升阶梯（熊本 M7.1 真实报文）：
       #1 震度4 → #2〜#4 **6弱** → #5〜#10 **6強** → #11 起 **震度7**
       （从 16:27:20 到 16:27:26，共 10 报 / 6 秒）
     ★★★ 2026-10-25 第二份样本（青森県東方沖 M7.5）推翻了「固定 +3/+4」：
       #1 4 → #2〜#5 **5弱** → #6〜#13 **5強** → #14〜#18 **6弱**
       → #19 **回退到 5強** → #20 6弱 → 最终 **6強**
     ⇒ 爬升快慢取决于「波前实际扫到几个强震站」，所以按 **总跨度** 分步：
         跨度 ≥5 档（震度4→7）：第 2 报就跳 2 档（6弱），符合熊本；
         跨度 ≤4 档（震度4→6強）：一步一步来，符合青森。
       另外保留官方真实存在的「同一档回退一报」现象（#19）。
     ⚠️ 这是**上限**：bumpEEW 里还会与 obsMaxShindo（测站实测最大值）取 min，
        所以不会出现「测站只有 5弱、卡片已经 7」。
     ⚠️ n 用报号（E.report），不用内部计数（升级那一帧 repBase 还没更新）。 */
  function ladAt(n, i0, iT, plan) {
    if (!(iT > i0)) return iT;
    if (n <= 1) return i0;
    var span = iT - i0;
    var s1 = (span >= 5) ? 2 : 1;
    /* 收敛到终值的报号：真实 7 级地震约在第 11 报定格，4 报之内只是起步 */
    var toFinal = Math.max(10, Math.round((plan || 20) * 0.40));
    var iR;
    if (n >= toFinal) iR = iT;
    else if (n <= 4) iR = Math.min(iT, i0 + s1);
    else if (n <= 6) iR = Math.min(iT, i0 + s1 + 1);
    else if (n <= 10) iR = Math.min(iT, i0 + s1 + 2);
    else iR = Math.min(iT, iT - 1);
    /* 官方真实存在「回退一报」：#19 从 6弱 退回 5強（青森样本）。
       只在已经爬过第一档之后才可能发生，且不会退回首报档。 */
    if (n > 6 && iR > i0 + s1 && Math.random() < 0.15) iR -= 1;
    return iR;
  }
  /** ★★★ 2026-10-20 用户：「观测震度是不是就固定写死几个震点？而且也不会刷新吗？」
   *  两件事都成立：
   *   ① `areas` 只在 setEEW 里算一次，bumpEEW 从不更新 → 整场都是首报那 9 条；
   *   ② 区域名查不到时 fallback 到**测站名**（伊里前/北上），看着像「写死的几个点」。
   *      实测 QV_SHINDO_AREAS.areas 只有 123 个键，而 QV_TEN 用到 184 种区码
   *      → 166 种查不到名字（东北那一片基本全缺）。
   *  这里抽成可复用的聚合器：
   *    frac = 已经「观测到」的测站比例（按震源距升序取前 k 个，模拟 P 波扫过的范围）。
   *    第 n 报时调用一次 → 列表随报数逐步变长/变值，不会一开场就是最终答案。
   */
  /* ★★★ 2026-10-20 重做：原来这里的 `DET_MIN` / `detectBoxOf()`（经纬度包围盒 + 最小尺寸）
     已经**删除**。现在检测态范围框在 `rebuildAreas()` 里按【官方区域多边形外接框】算，
     由 `QVMapCam.setBoxes()` 用官方 `枠描画` 的颜色画矩形；地图填色逻辑一行未改。 */
  function rebuildAreas(E, maxKm) {
    /* maxKm = P 波已经走到的震源距（km）。
       两套数据必须分开（官方就是这样）：
         · 左侧「观测震度」列表 = 已收到的观测 -> 只算 hyp <= maxKm 的测站
         · 地图色块           = 推定震度分布 -> 用【全量】测站，才能连成大片
       以前两者都用过滤后的数据，于是地图上只有 P 波刚到的那几块。 */
    /* ★ 2026-10-20 用户：「这些框是不能重叠的」+「不要一开场就全部填完」
       ⇒ 框只用【已经检出】的测站（hyp ≤ P 波前沿）。早期检测是从震源往外推的，
         外层（震度1未满）和内层（震度1/2）落在不同方向 → 框自然不会同心重叠。 */
    /* ★★★ 2026-10-21 用户：「我们直接引入 PLUM 算法不就可以了吗」
       PLUM（Propagation of Local Undamped Motion）= JMA 2018 年起的紧急地震速报算法：
         · 不假设点源、不套衰减公式 → **深度 100km 也不会算出"整片没摇晃"**
         · 只信【已经观测到】的强震测站，波前按 S 波 **1.4 km/s** 向外扩张
         · 预测圈内某点的震度 = 圈内已观测测站的最大值（原算法还有个 ±2km 环带，
           这里简化为「hyp ≤ R 的测站聚合」，效果同一量级）
       ⇒ 把原来的「P 波前沿」换成「PLUM 半径 1.4 × 震后秒数」：
         圈外 = 还没震到（不填）｜圈内 = 已经实测（填上）。
         这样 EEW 阶段天然"不会显示很多"，又不会因震源深而整片空白。 */
    var _tSec = (E.simT0 && isFinite(E.simT0)) ? Math.max(0, (Date.now() - E.simT0) / 1000 * simSpd()) : 0;
    var _lumR = 1.4 * _tSec;                   /* PLUM 预测半径（km） */
    /* ⚠️⚠️ 2026-10-21 修正：上一版直接用 _lumR 顶替 lim，结果小震时 1.4×t 比 P 波距离还小，
       圈内测站太少 → aggOf 聚不出区域 → 用户「地图色块都没有了」。
       ⇒ 取【P 波距离】和【PLUM 半径】的较大者：色块范围至少和原来一样大，
         PLUM 只在它更大的时候才起作用（符合 PLUM「大范围强震时才接管」的本意）。 */
    var _pKm = (maxKm == null || !isFinite(maxKm)) ? 0 : maxKm;
    var lim = Math.max(_lumR, _pKm);
    /* ★ bands 挂在数组上，slice() 会把它丢掉 → 先取出来 */
    var BANDS = (E.obs && E.obs.bands) || [];
    /* ★★★ 2026-10-21 用户：「应该把这个地震的震级转化为相对应的能量，然后放在地图上面，
       再根据从这个点开始释放能量、看测站的反应来进行上发的预测，这才是真正的模拟框架」
       —— 以前每个测站的 shindo 是【预先算好的终值】，波前一扫到就立刻显示最终震度，
          所以"看着不像在发生，像在播幻灯片"。
       ⇒ 改成：S 波到达后才开始有值，并从 0 在 ~2.5 秒内爬到峰值（摇晃是渐强的）。
          S 波速度用 JMA 官方给出的 **约 4 km/s**（不是 P 波的 7，也不是 PLUM 的 1.4）。
       ⚠️ 必须先深拷贝：all 是 E.obs 的 slice，元素还是同一批对象，
          直接改 shindo 会把 E.obs 里的"真值"也改掉，下一帧就再也涨不回去了。 */
    var all = (E.obs || []).map(function (o) {
      return { area: o.area, cty: o.cty, name: o.name, lat: o.lat, lon: o.lon,
        shindo: o.shindo, hyp: o.hyp, epi: o.epi, level: o.level, metric: o.metric,
        intensity: o.intensity };
    }).sort(function (a, b) { return (a.hyp || 0) - (b.hyp || 0); });
    /* 震度随时间爬升（S 波 4km/s 到达 + 2.5s 成长期） */
    (function () {
      /* ★★★ 2026-11-03 用户：「为什么正式报的震度3，2，1的地图填色区域全部变成了灰色的了」
         —— **真因在这里**：下面 `age = tNow - hyp/4` 会把「S 波还没到达」的测站改写成
            震度 0。`tNow` 是**真实秒数**（按 Enter 跳阶段不会快进它），
            正式报时可能只过了 2 分钟 → 500km 以外的测站通通还是 0
            → 那些行政区聚合成震度0 → 整片涂上震度0 的灰 #686870。
            实例：東京 M8.1 正式报里 93 个区有 44 个是 0（岩手/秋田/鳥取/岡山/徳島…），
            但 genStations 给那些测站的峰值明明是震度 2~3。
         ⇒ 调查中 / 震源速報 / 各地震度情報 用的都是 **已经观测到** 的电文
            （VXSE51 = 震度速報 / VXSE53 = 震源・震度情報），现实中那时全日本早摇完了，
            不存在「还没到达」。所以这三个阶段一律不做到达判定，直接用测站峰值。 */
      var _reported = !!E.inq || E.kind === 'jishin' || E.kind === 'final' || E.kind === 'info';
      var tNow = (E.simT0 && isFinite(E.simT0)) ? Math.max(0, (Date.now() - E.simT0) / 1000 * simSpd()) : 0;
      if (_reported) {
        for (var ri = 0; ri < all.length; ri++) all[ri].live = 1;
        return;
      }
      if (!(tNow > 0)) return;
      var _lie = (E.metric === 'liedu');
      for (var ai = 0; ai < all.length; ai++) {
        var arrive = (+all[ai].hyp || 0) / 4.0;      /* S 波到达秒数 */
        var age = tNow - arrive;
        /* ★ 2026-10-21 用户：「这个是P波的，也是可以测算有价值的，但是这个就没必要放到顶部了吧」
           —— `live = 0` 标出「P 波到了、S 波还没到」的测站。它们的震度此刻确实是 0，
              但**不能进「观测震度」列表**（否则顶部一整片 0，看着像坏了）。
              地图上的 P 波点 / 波圈照旧显示，不受影响。 */
        if (age <= 0) { all[ai].shindo = 0; all[ai].live = 0; continue; }
        all[ai].live = 1;
        var ramp = Math.min(1, age / 2.5);               /* 0→1 爬升 */
        /* ★★★ 2026-10-21 修「列表显示成 0」的真因：
           爬升以前直接给【震度码】乘 ramp —— 震度 7 的码是 70，×0.3 = **21**，
           21 不是任何合法档位（合法的是 0/1/2/3/4/50/55/60/65/70）
           → 色卡查不到、数字画不出、列表里就成了「0」。
           ⇒ ramp 必须作用在【连续烈度 intensity】上，再转回码。 */
        var I0 = +all[ai].intensity;
        if (isFinite(I0)) {
          var Ik = I0 * ramp;
          all[ai].shindo = _lie
            ? (global.QV_LIEDU ? QV_LIEDU.codeOfI(Ik) : 0)
            : shindoCode(Ik);
        } else {
          all[ai].shindo = (+all[ai].shindo || 0) * ramp;
        }
      }
    })();

    function aggOf(list) {
      var agg = {}, order = [];
      for (var i = 0; i < list.length; i++) {
        var code = list[i].area || 0;
        if (!code) continue;
        var cur = agg[code];
        var hp = +list[i].hyp || 0;
        if (!cur) {
          /* lastHyp = 该区域里【最后到达】的那个测站的震源距
             → 排序时用它倒序 = 「最新更新的排最前」（用户 2026-10-21 要求） */
          agg[code] = { code: code, level: list[i].shindo, name: areaName(code, list[i].name),
            lastHyp: hp };
          order.push(code);
        } else if (list[i].shindo > cur.level) {
          /* ★ 2026-10-20：只更新等级，**不覆盖名字**。
             以前这里写 `cur.name = list[i].name` → 聚合出来的「区域」名字
             会变成最后那个测站的名字（伊里前/北上…），看着像写死的几个点。 */
          cur.level = list[i].shindo;
          if (hp > cur.lastHyp) cur.lastHyp = hp;
        } else if (hp > cur.lastHyp) {
          cur.lastHyp = hp;
        }
      }
      return { agg: agg, order: order };
    }

    /* ★★★ 2026-10-26 用户（截图）：「各地震度信息」阶段地图上只有东北/关东有色块，
       近畿一片全暗。真因：aggOf() 靠 `list[i].area` 聚合，area=0 的测站被整批丢掉
       → allAreas 缺了那些区域 → 没有填色块（数字不依赖 area，所以还在 → 看着就是「数字有、色块没」）。
       ⇒ 兜底：只要有坐标就按「点在多边形内 → 最近区域」强行补上归属。 */
    (function fixAreaCodes() {
      for (var fi = 0; fi < all.length; fi++) {
        var it = all[fi];
        if (it.area || !isFinite(it.lon) || !isFinite(it.lat)) continue;
        var c = 0;
        try { c = global.QVShindo && QVShindo.areaOf ? QVShindo.areaOf(it.lon, it.lat) : 0; } catch (e) { }
        if (!c) { try { c = nearestAreaCode(it.lon, it.lat, true); } catch (e2) { } }
        if (c) it.area = c;
      }
    })();

    /* —— 地图色块：不再「全量推定」整片先铺 —— 改为【波前到达才上色】，见下方 seen 聚合 —— */
    /* ★★★ 2026-10-25 真实数据源原则：**官方区域震度 > 本地 GMPE**
       只要这一场带回了官方「区域码 + 震度」（EEW 电文的 ForecastArea / 将来接的
       VXSE51、VXSE53），地图色块一律用官方值；本地推算只在官方没覆盖的区域补。
       ⚠️ 只影响 E.allAreas（地图色块/区域数字），左侧「观测震度」列表仍按测站聚合。 */
    if (E.officialAreas && E.officialAreas.length) {
      var _offMap = {};
      for (var _ofi = 0; _ofi < E.officialAreas.length; _ofi++) {
        var _of = E.officialAreas[_ofi] || {};
        var _ofv = +_of.shindo;
        var _ofc = +(_of.code);
        if (!(_ofv >= 0) || !_ofc) continue;
        _offMap[_ofc] = _ofv;
      }
      var _offList = Object.keys(_offMap).map(function (c) {
        return { code: +c, shindo: _offMap[c] };
      });
      if (_offList.length) E.allAreas = _offList;
    }

    /* ★ 中国地级市填色：同样改为【波前到达才上色】，见下方 seen 聚合（不在此先铺全量） */

    /* —— 列表：已观测，**最新到达的排最前** ——
       2026-10-20 user: "1s A arrives, 2s B arrives -> B must be row 1, not row 2".
       all[] is already sorted by hyp ascending, and hyp asc == arrival order,
       so aggOf() pushes areas in arrival order -> reversing it puts the newest first.
       (Was sorted by intensity desc before, which froze the top of the list.)
       ★★★ 2026-10-21 用户：「观测震度……改成显示成最新更新的为主，
       同时不限制震度大小，哪个新，就展示最新的那个」
       ⇒ ① **不再只收震度 ≥1 的测站**：震度 0（已检出但未满 1）也进列表。
            它们的连续值在 `E.obs.det` 里（genStations 单独收的那批）。
         ② 排序改成「该区域最后一次收到观测的时刻」倒序 —— 谁最新谁在最上面，
            不再受震度高低影响（见下面 aggOf 的 lastHyp）。 */
    var listSrc = all.slice();
    /* ★ 「P 波到了、S 波还没到」的测站不进列表（见上面 live 标记的说明） */
    listSrc = listSrc.filter(function (o) { return o.live !== 0; });
    (function () {
      var det = (E.obs && E.obs.det) ? E.obs.det : [];
      if (!det.length) return;
      /* det 里的点同样是「S 波到了才算数」——否则又是一片震度 0 */
      var t0d = (E.simT0 && isFinite(E.simT0)) ? Math.max(0, (Date.now() - E.simT0) / 1000 * simSpd()) : 0;
      var dup = {};
      for (var i0 = 0; i0 < listSrc.length; i0++) {
        dup[(listSrc[i0].area || 0) + '|' + (listSrc[i0].name || '')] = 1;
      }
      for (var i1 = 0; i1 < det.length; i1++) {
        var dp = det[i1];
        if (t0d > 0 && (t0d - ((+dp.hyp || 0) / 4.0)) <= 0) continue;
        var kk = (dp.area || 0) + '|' + (dp.name || '');
        if (dup[kk]) continue;
        dup[kk] = 1;
        listSrc.push({ area: dp.area, cty: 0, name: dp.name, lat: dp.lat, lon: dp.lon,
          shindo: dp.shindo, intensity: dp.intensity, hyp: dp.hyp, epi: dp.epi,
          level: dp.level, metric: E.metric });
      }
      listSrc.sort(function (a, b) { return (a.hyp || 0) - (b.hyp || 0); });
    })();
    var seen = listSrc.filter(function (o) {
      return ((o.epi != null ? +o.epi : (o.hyp || 0))) <= lim;
    });
    /* ★★★ 2026-10-21 用户：「你这有BUG，为什么没情报」另一半原因：
       震源在远海时首报的波前（P 波公里数）可能还没覆盖任何测站
       （日本海中部 → 最近陆上测站 242km，首报时波前才 80km）
       → `seen` 空 → 左侧「观测震度」列表空着，卡片里一片空白，看着也像坏了。
       退化：至少把【最近的那个测站】报上来（listSrc 已按 hyp 升序）。
       ⚠️ 只从 listSrc 里退（= S 波已到的测站），绝不从 all 里退 ——
          否则又会出现「震度 0 那一排」。 */
    if (!seen.length && listSrc.length) {
      lim = Math.max(lim, (listSrc[0].epi != null ? +listSrc[0].epi : (+listSrc[0].hyp || 0)) + 1);
      seen = listSrc.filter(function (o) {
        return ((o.epi != null ? +o.epi : (o.hyp || 0))) <= lim;
      });
    }

    /* ★ 2026-10-21 「峰值是否过去」要用：最远的有声测站有多远（km）。
       波前跑到它的 1.8 倍 ≈ S 波已经扫完全部测站 → 震中峰值确定过去。
       取不到时（真实地震没开波圈）退回按规模算的兜底秒数。 */
    var distMax = 0;
    for (var dm = 0; dm < seen.length; dm++) {
      /* ★ 2026-10-25 这里的「最远有声测站」要和波前（震央距）比，用 epi */
      var hd = (seen[dm].epi != null) ? +seen[dm].epi : (+seen[dm].hyp || 0);
      if (hd > distMax) distMax = hd;
    }
    E.distMax = distMax;

    /* ★★★ 2026-10-21 ① 阶段化填充（用户按官方流程口述，逐条对应）：
       「刚开局只爆一个最大的警戒区域，不会直接跟你说 7；
         过了 4~6 个报之后，就开始在地图上填一到两个震度范围区域
         （比如 A 地区最大震度 7 → 这时候同时填上 7、6+、6- 的区域，再往下不填）；
         报文过到 20~30 报之后大概进入调查中，地图开始正式播报 7 到 5- 之间的区域，
         顺序 7 → 6+ → 6- → 5+ → 5- → 4，最后正式报才报 3、2、1」
       ⇒ 用报文数分四段（短事件按 plan 比例折算）：
         warn  1~2 报        ：只留【等级最高的那 1 块】，涂警戒红，不出任何震度
         high  3~6 报        ：只填 ≥6弱（60）的区域，正常震度色
         mid   7~24/25 报    ：往下填到 ≥5弱（50）
         all   之后          ：全部（4/3/2/1 都出来）
       ⚠️⚠️ 上面这段四阶段（warn/high/mid/all）**已废弃**，实际逻辑见下方两档版。 */
    /* ★★★ 2026-10-21 用户对照官方截图后的纠正：
       「图一是紧急地震速报，还没进入调查时期，不会显示很多；
         进入调查期，基本上预测的没有，全是已经实际完全量过确定的区域，单独填色放出来」
       ⇒ 只有两档，没有中间渐进：
         · eew（紧急地震速报）→ **地图完全不填色**（只有测站点 + 波圈，左侧列表照常）
         · info / jishin / final → **一次性全铺**，全部是实测值
       ⚠️ 之前那套 warn → high → mid → all 四阶段渐进填色是我自己编的，官方根本没有。 */
    var repN = E.report || 1;
    var planN = Math.max(6, +E.plan || 6);
    var stage = (E.kind === 'eew') ? 'none' : 'all';
    E.fillStage = stage;
    E.warnPhase = false;
    /* ★★★ 2026-10-31 用户：「地图震度涂色不是按实际测得数据，而是在地震波还没到时
       先涂色当地预估最大震度」 —— 以前 info/jishin/final 阶段把地图色块设成【全量】
       测站（整片区域瞬间全亮），与波前无关；EEW 阶段虽然用 seen，但两条口径不一致。
       ⇒ 统一：地图色块【永远】只用 `seen`（波前已到达的测站）聚合：
          · 颜色 = 该区峰值（震度4+ 才上色，低于的由下方 fillable() 过滤）；
          · S 波还没到的站被 ramp 成 0，fillable() 会剔除震度0 → 不会提前上色；
          · 波前走完（freeze/skip → wavePKm 极大，或正式报传 99999）后 lim 足够大，
            seen 自然包含全部测站 → 地图铺满，符合「事件结束后铺满」的官方形态。
       ⚠ 只影响地图色块；左侧「观测震度」列表（part = aggOf(seen)）本就是 lim 过滤。 */
    /* ★★★ 2026-10-31 用户：「地图涂色应该是【震源模型预估】的最大烈度（推定震度分布），
       不是波前到达的【测站实测】最大烈度」—— 此前 E.allAreas / E.fillAreas 都来自 `seen`
       （波前已到达的观测测站逐区取最大值）→ 地图色块 = 测站最大烈度。
       ⇒ 改（仅模拟 V.simOn）：地图色块【永远】用【震源模型的预测峰值场】—— 遍历 E.obs
          每个测站的 `.intensity`（genStations 据 M/深度按衰减算出的预测峰值，与波前无关），
          逐区取最大值。这样「波前还没到的区域」也显示预估最大烈度，正是 JMA 的「推定震度分布」。
       · 真实电文（V.simOn=0）保持原实测口径（seen 波前到达的测站），不回归。
       · 左侧「观测震度」列表（E.areas，来自 seen）与地图色块【口径分离】：列表仍是实测，
         地图色块是预测。
       · 实测电文（officialAreas）仍优先，不受影响。
       · 仍保留按阶段的 MINFILL 门槛（EEW 只画≥5弱等），只是数值来源换成预测场。 */
    function _predCodeOf(I) {
      I = +I;
      if (!isFinite(I) || I <= 0) return 0;
      if (E.metric === 'liedu') {
        return (global.QV_LIEDU && QV_LIEDU.codeOfI) ? QV_LIEDU.codeOfI(I) : 0;
      }
      return shindoCode(I);
    }
    function _predAgg(srcList, keyFn) {
      var agg = {}, order = [];
      for (var pi = 0; pi < srcList.length; pi++) {
        var o = srcList[pi];
        if (!o || o.intensity == null) continue;
        var c = +keyFn(o) || 0;
        if (!c) continue;
        var code = _predCodeOf(o.intensity);
        if (code <= 0) continue;
        if (!agg[c]) { agg[c] = code; order.push(c); }
        else if (code > agg[c]) agg[c] = code;
      }
      return { agg: agg, order: order };
    }
    if (!(E.officialAreas && E.officialAreas.length)) {
      if (V.simOn) {
        var _pa = _predAgg(E.obs || [], function (o) { return o.area || 0; });
        E.allAreas = _pa.order.map(function (c) {
          return { code: c, shindo: _pa.agg[c] };
        });
      } else {
        var early = aggOf(seen);
        E.allAreas = early.order.map(function (c) {
          return { code: c, shindo: early.agg[c].level };
        });
      }
    }
    {
      if (V.simOn) {
        var _pf = _predAgg(E.obs || [], function (o) { return (o.cty || 0); });
        if (!_pf.order.length) _pf = _predAgg(E.obs || [], function (o) { return o.area || 0; });
        E.fillAreas = _pf.order.length ? _pf.order.map(function (c) {
          return { code: c, level: _pf.agg[c], metric: E.metric };
        }) : null;
      } else {
        var eMax = {}, hasE = false;
        for (var ei = 0; ei < seen.length; ei++) {
          var ec = seen[ei].cty | 0;
          if (!ec) continue;
          hasE = true;
          if (!(eMax[ec] > 0) || seen[ei].shindo > eMax[ec]) eMax[ec] = seen[ei].shindo;
        }
        E.fillAreas = hasE ? Object.keys(eMax).map(function (k3) {
          return { code: +k3, level: eMax[k3], metric: E.metric };
        }) : null;
      }
    }
    /* 震度点照常显示（EEW 阶段也有） */
    if (global.QVMapCam && QVMapCam.setStationsHidden) QVMapCam.setStationsHidden(false);
    /* 右下角图例：按最大震度正常换档 */
    if (global.QVMapCam && QVMapCam.setLegend) {
      QVMapCam.setLegend(E.kind === 'detect' ? null : E.level, E.metric, false);
    }
    var part = aggOf(seen);
    /* ★★★ 2026-10-21 用户：「观测震度……哪个新，就展示最新的那个」
       ⇒ 不再 `order.reverse()`（那只是「首次到达」的顺序倒过来），
         改成按 `lastHyp`（该区域最后一次收到观测的时刻）倒序。
       ★ 但纯按时间会导致最上面永远是一排「震度 0」的边缘区域（波前一直在扩大），
         实测列表前 10 条全是 0 度 → 信息量为零。
         所以要分两层：**先按「有没有震度」分组，再各自按最新排序** ——
         震度 ≥1 的区域（真的有摇晃）排前面，震度 0（刚被 P 波扫到）排在后面。
         用户要的「不限制震度大小」= 0 度也要显示，但不该压在 5强/6弱上面。 */
    var newestFirst = part.order.slice().sort(function (a, b) {
      var la = (part.agg[a].level >= 1) ? 1 : 0;
      var lb = (part.agg[b].level >= 1) ? 1 : 0;
      if (la !== lb) return lb - la;
      return (part.agg[b].lastHyp || 0) - (part.agg[a].lastHyp || 0);
    });
    /* ★★★ IPF 逐步收敛（用户：「不要也我们也做 IPF 是逐步收敛不就可以了吗」）
       真实气象厅要抓全国动态波形反演震源，非常慢；本地 inferSource() 几毫秒就有结果
       → 「调查中」在底层不存在。这里把它人为铺开：调查中阶段卡片上只挂已经算出来的
       那几个行政区（ipf.batch 从 1 长到 maxBatch），放满 = 震源解收敛 → 进震源情报。 */
    var _aLim = 300;
    if (E.inq && E.ipf) {
      /* ★★★ 2026-10-28 用户：「我按回车调查中都空的，地图没新加」
         —— 以前这里 `_aLim = ipf.batch`（1~5）：刚进调查中 batch=1 → **卡片只有 1 行**，
            整张卡看上去就是空的（测站数据其实全在）。batch 最多也只到 5。
         ⇒ 调查中卡片直接给足行数：起步 8 行，batch 涨到 5 时给 20 行。 */
      _aLim = Math.max(8, Math.min(20, (E.ipf.batch || 1) * 4));
    }
    /* ★★★ 调查中阶段必须按【震度降序】排，不能用 newestFirst（按最后收到观测的时刻）——
       后者是「波前扩到哪儿」的顺序，最后到达的恰恰是离震源最远、震度 0 的地方。
       实测证据：一度把 石獣地方中部（北海道）、島根県西部（中国）、香川県西部（四国）
       放到调查中卡片最上面，而它们都离 宮城県沖 很远。 */
    var _order = newestFirst;
    if (E.inq) {
      _order = part.order.slice().sort(function (a, b) {
        var la = part.agg[a].level || 0, lb = part.agg[b].level || 0;
        if (la !== lb) return lb - la;                                  /* 震度高的在前 */
        return (part.agg[b].lastHyp || 0) - (part.agg[a].lastHyp || 0); /* 同震度再按新旧 */
      });
    }
    E.areas = _order.map(function (c) { return part.agg[c]; })
      .slice(0, _aLim)
      .map(function (a) { return { name: a.name, level: a.level }; });

    /* ==== 2026-10-20 「揺れを検出」范围框（XLSX 格子版）====
       用户 2026-10-20：「每一个框可以相邻，但不可重叠」= XLSX 工作表；
       每个检出地区一个框，所有框统一固定尺寸。
       （官方 `detslots.js` 那 43 个槽已导出验证：它们是「カメラ対象」位置，
         实测落点在海面/偏离检出地区，不是截图里的框，故不硬套。）
       ⇒ 框吸附到同一张经纬度网格：地区中心落在的格子被占了，就去最近的空格子，
         格子之间可以共边，绝不重叠。地图填色逻辑完全不碰。 */
    var detRegions = [], detBoxes = [];
    var DET_BOX_W = 1.0, DET_BOX_H = 1.5;      /* 统一框尺寸（经度°×纬度°） */
    var GRID_LON0 = 0, GRID_LAT0 = 0;          /* 原点归零 → 等价于 floor(lon)/floor(lat)，与改造版同一套编号 */
    if (E.kind === 'detect') {
      var dsrc = (E.obs && E.obs.det) ? E.obs.det.slice() : [];
      dsrc.sort(function (a, b) { return (a.hyp || 0) - (b.hyp || 0); });
      var byCode = {}, dorder = [];
      for (var di = 0; di < dsrc.length; di++) {
        var od = dsrc[di];
        if (lim > 0 && ((od.epi != null ? +od.epi : (od.hyp || 0))) > lim) continue;
        var dc = od.area || 0;
        if (!dc) continue;
        var cur3 = byCode[dc], ic = isFinite(od.intensity) ? +od.intensity : 0;
        if (!cur3) {
          byCode[dc] = { code: dc, cont: ic, level: od.shindo, n: 1, nSea: od.sea ? 1 : 0,
            name: od.name || '',
            sLon: od.sea ? od.lon : 0, sLat: od.sea ? od.lat : 0 };
          dorder.push(dc);
        } else {
          cur3.n++;
          if (od.sea) { cur3.nSea++; cur3.sLon += od.lon; cur3.sLat += od.lat; }
          if (ic > cur3.cont) { cur3.cont = ic; cur3.level = od.shindo; }
        }
      }
      detRegions = dorder.map(function (c) { return byCode[c]; });
      /* 按区域码排序 → 新地区来了只会占新格子，已有框不会跳来跳去 */
      detRegions.sort(function (a, b) { return a.code - b.code; });

      /* 框中心：陆地分区用官方 bbox 中心；
         纯海底测站（S-net）借了陆地区码，但框要画在【测站自己所在的海面】上，
         否则就成了用户说的「有框了，但是在陆地上」。 */
      function regionCenter(rg) {
        if (rg.nSea && rg.nSea === rg.n) {
          return { lon: rg.sLon / rg.nSea, lat: rg.sLat / rg.nSea, sea: 1 };
        }
        var qb = (global.QVShindo && QVShindo.areaBounds) ? QVShindo.areaBounds(rg.code) : null;
        if (!qb) return null;
        return { lon: (qb.lon0 + qb.lon1) / 2, lat: (qb.lat0 + qb.lat1) / 2, sea: 0, bb: qb };
      }

      /* ★★★ 2026-10-21 用户：「框太大了，测站只是有几个嗒了，结果框了半个日本」
         以前框宽高写死 1.0°×1.5°（≈110km×165km），在关东那种尺度下比整个检出区还大。
         现在：先算本次【已检出区域】的联合外接框，再按它定格子尺寸：
           宽 ≈ 跨度/2.2，夹在 0.25°~0.9°；高同理 0.25°~1.1°。
         几个区域挤在一起 → 小框；一大片 → 大框（有上限）。网格吸附/不重叠逻辑不变。 */
      (function () {
        var bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
        for (var qi = 0; qi < detRegions.length; qi++) {
          var qc = regionCenter(detRegions[qi]);
          if (!qc) continue;
          if (qc.bb) {
            if (qc.bb.lon0 < bx0) bx0 = qc.bb.lon0;
            if (qc.bb.lon1 > bx1) bx1 = qc.bb.lon1;
            if (qc.bb.lat0 < by0) by0 = qc.bb.lat0;
            if (qc.bb.lat1 > by1) by1 = qc.bb.lat1;
          } else {
            if (qc.lon < bx0) bx0 = qc.lon;
            if (qc.lon > bx1) bx1 = qc.lon;
            if (qc.lat < by0) by0 = qc.lat;
            if (qc.lat > by1) by1 = qc.lat;
          }
        }
        /* ★ 2026-10-25 用户：「以中心加一个【固定】方框就行」
           ⇒ 不再按跨度自适应（自适应会让框在不同报之间忽大忽小）。
           ★★★ 2026-10-25 用户第二次：「你这方框是不是有点太小太密集了点，
             而且怎么变正方形了，不应该是方框固定一个大概的行政区大小吗，
             而且一般来说都是长方形的」
           ⇒ 原 0.30°×0.24° 在 36°N 换算 ≈ 27km×27km（正好正方形，且只有区的一半大）。
             改成 0.58°×0.32° ≈ 52km×36km（≈1.5:1，明显长方形，接近 JMA 细分区域尺度）。
             框变大后同一格子内的测站自然合并成一个框 → 密集度也跟着降下来。
           ★★★ 2026-10-25 用户第三次：「长方形应该是要竖起来」
           ⇒ 换成【竖长方形】0.32°经 × 0.58°纬（36°N ≈ 29km 宽 × 64km 高）。 */
        /* ★★★ 2026-10-25 用户拍板：「跟改造版一致：1°×1° 正方格」
           —— 从 SREV 改造版 v1.6.3-7 积木反推出来的官方口径：
              `dc ten:点からグリッド番号` 1750 个测站 → 格号；
              `grid:検出グリッド最大震度` 共 **531 格**，初始 −9；
              编号公式 grid = floor(lon) + 23*floor(lat) - 651；
              格 290 = 136–137°E / 35–36°N，格 291 = 137–138°E。
           ⇒ **1°×1° 正方格，一行 23 格**，平均每格 3.3 个测站。
              （之前 0.30×0.24 是正方形+过小、0.58×0.32 横长、0.32×0.58 竖长，已全部作废） */
        DET_BOX_W = 1.0; DET_BOX_H = 1.0;
        if (false && bx1 > bx0) {
          DET_BOX_W = Math.max(0.25, Math.min(0.9, (bx1 - bx0) / 2.2));
          DET_BOX_H = Math.max(0.25, Math.min(1.1, (by1 - by0) / 2.2));
        }
        /* ★★★ 2026-10-21 中国测站加密到区县级（2791 点）后，一次检测可能同时命中
           几十个区 → 光按「跨度/2.2」定尺寸会让网格装不下，freeCell() 只能一圈圈
           往外找空格子，框被挤到几百公里外（用户会说「框飞了」）。
           这里再加一个「容量约束」：格子数 ≥ 区域数 × 1.5，装不下就逐步缩小框。
           ⚠ 只对中国生效（区码 ≥ 1000）：日本 JMA 区码 0..999，
             那边的框尺寸是用户逐轮调过的，绝不能动。 */
        /* ★★★ 2026-10-28 用户：「我发现你烈度区的方框怎么是错的」「你这这么小」
           —— 中国（烈度区）的检测框以前会被下面这段「容量约束」一路 ×0.88 缩到 0.245°
              （≈24km），在成都一带挤成一小片细格子，和日本的 1°×1° 完全不是一个尺度。
              而且那段约束是给**已经废弃的 freeCell（往外找空格子）**写的：
              现在 takeCell() 是「同一个格子的测站合并成一个框」，根本不会框飞。
           ⇒ 中国不再缩框，和日本一样用 1°×1°（同 grid 合并，框数天然很少）。
             保留一个 0.5° 的硬地板，只在极端情况下兜底。 */
        var nReg = detRegions.length, nCnReg = 0;
        for (var cr = 0; cr < nReg; cr++) if ((detRegions[cr].code | 0) >= 1000) nCnReg++;
        if (nCnReg > nReg / 2 && nReg > 1) {
          DET_BOX_W = Math.max(0.5, DET_BOX_W);
          DET_BOX_H = Math.max(0.5, DET_BOX_H);
        }
      })();
      /* ★ 格子几何同步给模块级（detGridKey / gridNbMax 用），两边永远一致 */
      DET_G.w = DET_BOX_W; DET_G.h = DET_BOX_H;
      DET_G.lon0 = GRID_LON0; DET_G.lat0 = GRID_LAT0;
      var BOXC = function (v) { return v < 1 ? '#40bf4a' : (v < 2 ? '#ffd500' : '#ff661a'); };
      /* 检测框颜色 = 该格内最大震度，**官方枠描画只有三色**（绿/黄/橙）：
         未满1 = 绿 / 震度1 = 黄 / 震度2 以上 = 橙。
         ★ 2026-10-25 用户：「震度3 居然是红色的框架」—— 之前我编了一个红色档，
           官方没有；现在跟 `BOXC` 同一套三色。
         ⚠ `shindo` 编码是混合的：震度0–4 是真值（0,1,2,3,4），
           5弱以上才是 50/55/60/65/70 —— 先归一化再比。 */
      var BOXS = function (v) {
        v = +v || 0;
        if (v >= 5) v = 5;
        if (v < 1) return '#40bf4a';
        if (v < 2) return '#ffd500';
        return '#ff661a';
      };
      var used = {};
      /* ★★★ 2026-10-25 用户第二次定案：
         「固定的方框内的测站不能再继续叠方框，只能按表格那样子相互挨着靠」
         ⇒ 格子已经有框了，**这一带的测站直接跳过**（不再像以前那样去"最近的空格子"，
           那样等于每来一个测站就往外挤一个框 → 框数量 = 测站数量 → 又密又散）。
           结果是：整片摇晃区被一张【等大固定格子】的表格铺满，
           每个格子最多一个框，框与框共边相邻、绝不重叠。 */
      function takeCell(lon, lat) {
        var i = Math.floor((lon - GRID_LON0) / DET_BOX_W);
        var j = Math.floor((lat - GRID_LAT0) / DET_BOX_H);
        return { key: i + ',' + j,
          lon0: GRID_LON0 + i * DET_BOX_W, lon1: GRID_LON0 + (i + 1) * DET_BOX_W,
          lat0: GRID_LAT0 + j * DET_BOX_H, lat1: GRID_LAT0 + (j + 1) * DET_BOX_H };
      }
      /* ★ 2026-10-25：同一格子里的测站合并成一个框，颜色取【格内最大震度】
         （以前取"最先到的那个测站"，它必然是外圈弱震 → 所有框都是绿的）。 */
      var cellMap = {}, cellList = [];
      for (var bi = 0; bi < dsrc.length; bi++) {
        if (cellList.length >= 240) break;                      /* 性能上限 */
        var os2 = dsrc[bi];
        if (lim > 0 && ((os2.epi != null ? +os2.epi : (os2.hyp || 0))) > lim) continue;   /* P 波还没到的不画 */
        if (!isFinite(os2.lat) || !isFinite(os2.lon)) continue;
        var cell = takeCell(os2.lon, os2.lat);
        var lvS = +os2.shindo || 0;
        var ex = cellMap[cell.key];
        if (!ex) { cell.lv = lvS; cellMap[cell.key] = cell; cellList.push(cell); }
        else if (lvS > ex.lv) ex.lv = lvS;
      }
      /* ★★★ 2026-10-25 用户：「那个区域的测站变成震度0之后方框就应该消失了，
         还有方框不会和原版一样消失再弹出」
         ⇒ 格子【不会因为 P 波到达就永久亮着】。只有格内最大震度 ≥ 震度1 时才续命；
           震度0/没人摇的格子不再刷新，2 模拟秒没人摇就消失；
           以后再摇起来会重新弹出（官方也是「消失 → 再弹出」）。 */
      var _nowMs = Date.now();
      if (!E.detKeep) E.detKeep = {};
      var _keep = E.detKeep;
      for (var bk = 0; bk < cellList.length; bk++) {
        var cd = cellList[bk];
        /* ★ 2026-10-27 用户：5弱以上的格子不出框（到那一档已经是速报/误报的争夺区，
           官方「揺れを検出」的框只表示弱晃） */
        if ((+cd.lv || 0) >= 50) { delete _keep[cd.key]; continue; }
        if (cd.lv >= 1) {                                        /* 震度1 以上（混合编码：≥50 是 5弱以上，也为真） */
          _keep[cd.key] = { key: cd.key, lon0: cd.lon0, lon1: cd.lon1,
            lat0: cd.lat0, lat1: cd.lat1, color: BOXS(cd.lv), lv: cd.lv, t: _nowMs };
        }
      }
      var _expMs = 2000 / Math.max(0.05, simSpd());
      for (var kk in _keep) {
        var kd = _keep[kk];
        if (_nowMs - kd.t > _expMs) { delete _keep[kk]; continue; }
        if ((+kd.lv || 0) >= 50) { delete _keep[kk]; continue; }   /* 5弱以上的格子不画框 */
        detBoxes.push({ color: kd.color, lon0: kd.lon0, lon1: kd.lon1,
          lat0: kd.lat0, lat1: kd.lat1 });
      }
      /* ★★★ 2026-10-27 用户说明（框/圆的分工，别一刀切）：
         「刚开始检测到摇晃的时候 5弱以下 基本上是框+圆都可能出现；
           5弱以上有框不出圆 → 一般是误报；有圆无框 → 1~2 个测站 5弱以上，1~2 秒内发 EEW，
           一般是大地震；小震有圆无框 → 是测站地质差异（A 站 6弱、B 站才 3）。」
         ⇒ 框是**按格子**画的（弱晃区才有），圆是**按测站**触发的（NewInt 上升就弹），
           两者各走各的，所以这里不做任何「强震就清空全部框」的处理。
           左边列表 E.areas 不受影响。 */
      /* ★★★ 2026-10-21 用户澄清：「如果摄像机缩小了，地图比例尺变大，框框尺寸不变的话，
         就会导致半个亚洲都进了框」
         ⇒ 框必须是【经纬度固定】的矩形：屏幕大小跟着地图缩放走，缩小时一起变小。
         尺寸由上面的自适应块给出（跨度/2.2，夹 0.25~0.9°），
         再用 freeCell() 吸附到同一张经纬度网格 → 相邻、不重叠。 */
      /* （旧的「每个测站一个小框」循环已删除：现在按 1°×1° 格合并，见上） */
      /* ★★★ 2026-10-25 对积木：改造版 procedure `地域別最大上位20` 的真身：
           把 (地名, 震度) 成对**按震度降序插入**，只保留前 20 组
           （超出部分 `del map:上位20地域震度[42]` / `[41]` 从尾部砍掉）。
           我们以前是「按区域码倒序、最多 300 条」——顺序和长度都不对。 */
      E.areas = detRegions.slice()
        .sort(function (a2, b2) { return (+b2.level || 0) - (+a2.level || 0); })
        .slice(0, 20)
        .map(function (a2) {
          return { name: areaName(a2.code, a2.name || ('区域' + a2.code)), level: a2.level };
        });
      /* ★ 2026-10-27 检测态的音效/検出円也在这里发（以前只靠 bumpEEW，
         而模拟刚开场那 1~2 秒还没有报 → 用户看到的「开始没圆」）。
         detSfxScan 自带 _pubLv 去重，重复调不会重复响。 */
      detSfxScan(E, dsrc, lim);
    }
    E.detRegions = detRegions;
    E.boxes = (E.kind === 'detect') ? detBoxes : null;
    if (global.QVMapCam && QVMapCam.setBoxes) QVMapCam.setBoxes(E.boxes, E.kind === 'detect');
    /* ★ 2026-10-27 官方「検出円」：速报阶段也是按「每个测站震度上昇」触发 */
    if (E.kind === 'eew') detSfxScan(E, seen, lim);
    /* ★ 2026-10-25：检测态镜头——「只要有一个测站在响，地图就会过去」 */
    if (E.kind === 'detect') detFrame(E);

    if (global.QVShindo) {
      if (global.QVShindo.setStations) {
        /* 检测态：画「已检出（P 波已到）」的点，含震度0 */
        var dotsSrc = (E.kind === 'detect' && E.obs && E.obs.det)
          ? (lim > 0 ? E.obs.det.filter(function (o2) {
            return ((o2.epi != null ? +o2.epi : (o2.hyp || 0))) <= lim;
          }) : E.obs.det)
          : seen;
        /* ① 警戒区域阶段：只涂红，一个震度点都不显示 */
        if (E.warnPhase) dotsSrc = [];
        global.QVShindo.setStations(dotsSrc.map(function (o) {
          return { lat: o.lat, lon: o.lon, shindo: o.shindo };
        }));
      }
      /* 地图填色保持原样：检测态不填色（只有点+框），速报态才画推定分布
         ★ 2026-10-21 中国：没有 JMA 多边形 → 用 E.fillAreas（地级市轮廓）填色
         ★★★ 2026-10-25 用户：「低于 4 震度的没必要在地图上显示」
               补充：「这个规则是在**紧急地震速报阶段**的；正式报必须完整显示全部等级」
         ★★★ 2026-10-26 用户：「这个是仅限于紧急地震速报的预测界面，结果他带到了所有界面」
           —— 根因两句：① 调查中阶段 kind 仍是 'eew'（并行标志）→ 被当成 EEW 预测层；
                     ② enterFinal 不跑 rebuildAreas → 过滤后的结果一直留在图上。
           ⇒ ① isEewStage 加 `!E.inq`：调查中已经不再算预测层；
             ② enterFinal 里补一次 rebuildAreas，进正式报立刻刷成全等级。
         ⇒ EEW / 检测态（摇晃还在扩大）：只画 ≥ 4，否则整屏碎色斑；
           调查中 / 正式报（各地の震度情報）：**全部等级都画**（官方那张图 1/2/3/4/5-/5+/6- 都有）。
            ⚠️ 只过滤「画什么」，不动 E.allAreas / E.fillAreas 本身（左侧列表还要用）。 */
      var isEewStage = !E.inq && (E.kind === 'eew' || E.kind === 'detect');
      /* ★★★ 2026-10-28 用户：「直接转到第一次速报真实报来播报四级及以上的，
         最后正式报来把 3/2/1 给收尾」
         ⇒ 新增「震源速報」阶段：只画 **震度4 及以上**；正式报才补 3/2/1。 */
      var isJishinStage = !E.inq && (E.kind === 'jishin');
      /* ★★★ 2026-10-25 按熊本 M7.1 真实顺序（用户采集）：
           震度速報-調査中 #1（16:28:49）→ 地图只填【震度4以上】
           震度速報-調査中 #2（16:29:04）→ 更新成【震度3以上】
           震度速報 第一報/第二報 → 震度3以上（追加）
           各地の震度情報 → 1–7 全部
         ⇒ 调查中不再是「一上来就全部等级」，分两步降门槛。 */
      var isInqStage = !!E.inq;
      /* ★★★ 2026-10-25 调查中第一报的填色门槛必须按【这场地震的最大震度】反推：
           熊本 M7.1 最大震度7   → 官方首条「离震中非常近 震度4以上」
           青森 M7.5 最大震度6強 → 官方首条「震度3以上」
         以前两场都固定从 40（5弱）开始，熊本会显得太少、青森会显得太多。
         ⇒ 日本：max(3, round(I) − 3)；中国烈度：max(4, round(I) − 2)。 */
      var _inq0 = (E.metric === 'liedu') ? 8 : 40;
      if (isInqStage && !(E.fillStage === 'inq2' || E.fillStage === 'inq3')) {
        var _lvRef = (E.lvT != null && isFinite(E.lvT)) ? E.lvT : E.level;
        if (E.metric === 'liedu') {
          /* ★★★ 2026-10-30 映射到中国 12 度烈度表：
             调查中专攻破坏性极震区（>=8 度，小震保底 >=6 度），
             门槛取梯子最低档 */
          _inq0 = (E.ipf && E.ipf.grades && E.ipf.grades.length)
            ? E.ipf.grades[E.ipf.grades.length - 1]
            : 8;
        } else {
          _inq0 = Math.max(3, Math.round(shindoBandI(_lvRef)) - 3);
        } 
      }
      var MINFILL = isEewStage ? ((E.metric === 'liedu') ? 4 : 40)
        : (isInqStage ? ((E.metric === 'liedu') ? _inq0
          : (E.fillStage === 'inq2' || E.fillStage === 'inq3' ? 3 : _inq0))
          : (isJishinStage ? ((E.metric === 'liedu') ? 5 : 3)
            : ((E.metric === 'liedu') ? 2 : 0)));
      function fillable(x) {
        var v = +x.level;
        if (!isFinite(v) || v <= 0) v = +x.shindo;
        if (!isFinite(v) || v <= 0) return false;      /* 震度 0 永远不填色 */
        return v >= MINFILL;
      }
      /* ★★★ 2026-10-25 用户：「在正式报中一个行政区划最多有一个数字显示」
         ⇒ 正式报（info/jishin/final）：每个区域只盖一枚官方 `y<1..9>.svg` 数字，
           位置 = 区域质心（QVShindo.areaCenter）；同时把「逐观测点」那一套清掉，
           否则放大到 k≥1.6 时会切成逐点模式 → 一个区冒出好几个数字。
           EEW / 检测态：保持逐观测点（官方 EEW 地图就是点）。 */
      var ptsForMarks = null;
      /** ★★★ 2026-10-25 用户：「官方的设置页关于这个的调节，
       *   就在『地图上显示的信息』那个下拉框里」（QV_VIEW3 ctrl：cycle / group paPcn6）
       *   vals = [各地区震度, 放大时观测点震度, 观测点震度, 连动地区与自治体阶级]
       *   已经接在 V.opts.pinMode（见文件头的 LABEL→opts 表），不需要另外加控件。
       *     pinMode 0 = 各地区震度        → 一区一标（一个行政区最多一个数字）
       *     pinMode 1 = 放大时观测点震度  → k >= 1.6 才切逐点，否则还是区域
       *     pinMode 2 = 观测点震度      → 始终逐点
       *     pinMode 3 = 连动地区与自治体阶级 → 暂按区域处理 */
      function pinWantStation() {
        var pm = +V.opt('pinMode') || 0;
        if (pm === 2) return true;
        if (pm === 1) {
          var k = 0;
          try { k = QVMapCam.state().k; } catch (e) { }
          return k >= 1.6;
        }
        return false;
      }
      function buildAreaMarks(list) {
        var out = [];
        if (!global.QVShindo || !QVShindo.areaCenter) return out;
        (list || []).forEach(function (x) {
          var v = +x.level;
          if (!isFinite(v) || v <= 0) v = +x.shindo;
          if (!isFinite(v) || v <= 0) return;
          var c = QVShindo.areaCenter(x.code);
          if (!c) return;
          out.push({ lat: c[1], lon: c[0], v: v, area: x.code, name: x.name });
        });
        return out;
      }
      /* ★ 2026-10-26：先告诉标记图层用哪套刻度 ——
         烈度没有官方 marks/h*.svg，要走 QV_LIEDU.markBoxSrc() 的方形徽章。 */
      if (global.QVShindo && global.QVShindo.setMetric) global.QVShindo.setMetric(E.metric);
      /* ★★★ 2026-10-26 用户定的规则：「EEW 阶段测站只能是圆的，正式报地图填色只能是方的
         （而且这个时候测站该隐藏了）」
         —— 中国地区用假数据测站，有些点既是重点测站又落在填色区，两边都画就圆方混排。
         ⇒ 区域数字层（方形）**只在正式报**显示；EEW / 检测 / 调查中 / 震源速報 全部藏起来。 */
      if (global.QVShindo && global.QVShindo.setMarksHidden) {
        global.QVShindo.setMarksHidden(!!V.eew && E.kind !== 'final');
      }
      /* ★ 同上：填色层的方形数字也只在正式报出现（EEW 阶段只留圆形测站）
         ★★★ 2026-10-26 用户：「调查中侧站确实隐藏了、地图也填色了，但填色之后的数字提示不见了」
         —— 调查中（震度速報・調査中）测站已经收起来，色块上就只剩颜色、没有数值，
            看不出哪块是多少。 ⇒ 调查中 / 震源速報 / 各地震度情報 一律开方形数字；
            只有 EEW（警报/预报，测站圆形那一阶段）才关。 */
      if (QVMapCam.setAreaBadge) {
        QVMapCam.setAreaBadge(!!E && (E.kind === 'final' || E.inq || E.kind === 'info' || E.kind === 'jishin'));
      }
      if (E.kind === 'detect') {
        if (global.QVShindo.set) global.QVShindo.set([]);
        if (global.QVShindo.setPoints) global.QVShindo.setPoints([]);
        if (QVMapCam.setAreaFill) QVMapCam.setAreaFill(null);
        E.fillShown = null;                 /* 地图什么都没画 → 签名也不能算「有变化」 */
      } else if (E.fillAreas && E.fillAreas.length) {
        var fa = E.fillAreas.filter(fillable);
        /* ★★★ 2026-10-30 映射到中国 12 度烈度表：
           调查中按实际烈度梯子筛选（如汶川：先 >=10 级展示 11 与 10，再 >=9 级，再 >=8 级）。
           不再使用按百分比排名的 inqRank，恢复物理烈度门槛过滤。 */
        if (E.inq && E.ipf && E.ipf.grades && E.ipf.grades.length) {
          var _gv2 = E.ipf.grades[Math.min(E.ipf.gi || 0, E.ipf.grades.length - 1)];
          fa = fa.filter(function (x3) {
            var v3 = +x3.level; if (!isFinite(v3) || v3 <= 0) v3 = +x3.shindo;
            return (+v3 || 0) >= _gv2;
          });
        }
        if (QVMapCam.setAreaFill) QVMapCam.setAreaFill(fa.length ? fa : null);
        E.fillShown = fa.length ? fa : null;   /* ★ 真正画到地图上的那一批 */
        if (global.QVShindo.set) global.QVShindo.set([]);
        if (isEewStage === false) {
          /* 中国：没有 JMA 多边形 → 没有质心 → 不盖数字（先保留地图色块） */
          if (global.QVShindo.setStations) global.QVShindo.setStations([]);
          if (global.QVShindo.setPoints) global.QVShindo.setPoints([]);
        }
      } else {
        var aa = (E.allAreas || []).filter(fillable);
        /* ★★★ 2026-10-26 用户：「色块一个一个填，填了个寂寞，一下子就填完了…
           最次也得搞个按等级吧，比如先填 7，再填 6」
           ⇒ 调查中阶段：地图 + 地图数字只画【当前等级及以上】，
             等级由 growIpf 每隔 gstepMs 往下降一级（70 → 65 → … → 10）。
             这样色块是「震度7 一片 → 再加上 6強 → 再加上 6弱 …」，每降一级响一次。 */
        if (E.inq && E.ipf && E.ipf.grades && E.ipf.grades.length) {
          var _gv = E.ipf.grades[Math.min(E.ipf.gi || 0, E.ipf.grades.length - 1)];
          aa = aa.filter(function (x2) {
            var v2 = +x2.level;
            if (!isFinite(v2) || v2 <= 0) v2 = +x2.shindo;
            return (+v2 || 0) >= _gv;
          });
        }
        if (QVMapCam.setAreaFill) QVMapCam.setAreaFill(null);
        if (global.QVShindo.set) global.QVShindo.set(aa);
        E.fillShown = aa.length ? aa : null;   /* ★ 真正画到地图上的那一批 */
        /* ★ 2026-10-25 用户：「地图正式报填色，看不见数字提示标」
           —— 速报阶段的观测点徐章层（mapcam #mapstations）一直留在这里，
             而区域数字在 #mapoverlay 内部（z=7）→ 数字全被徐章盖住。
           正式报是「一区一标」，观测点徐章本就不该在这时候出现 → 清掉。
           （pinMode=观测点震度 时走的是 QVShindo.setStations，不受影响） */
        if (!isEewStage && QVMapCam.clearStations) QVMapCam.clearStations();
        /* ★★★ 2026-10-25 用户定案：
             「正式报的数字震度提示和查看观测点震度规则不冲突，但是设置里只能选择
               1. 正式报的各个观测点在震中的最大震度（逐点）
               2. 正式报各个区域震度（一区一标）
               在「紧急地震速报」中不允许显示区域数字震度提示，
               但可以显示各个观测点的实时震度」 */
        if (isEewStage) {
          /* EEW / 检测态：区域数字一律不给；观测点已在上面 setStations(dotsSrc) 设过 */
          if (global.QVShindo.setPoints) global.QVShindo.setPoints([]);
        } else if (pinWantStation()) {
          /* 正式报 · 选项 1：各观测点的最大震度 */
          if (global.QVShindo.setPoints) global.QVShindo.setPoints([]);
          if (global.QVShindo.setStations) {
            global.QVShindo.setStations(seen.map(function (o3) {
              return { lat: o3.lat, lon: o3.lon, shindo: o3.shindo, name: o3.name };
            }));
          }
        } else {
          /* 正式报 · 选项 2（默认）：各区域震度（一个行政区最多一个数字） */
          if (global.QVShindo.setStations) global.QVShindo.setStations([]);
          if (global.QVShindo.setPoints) global.QVShindo.setPoints(buildAreaMarks(aa));
        }
      }
    }
  }
  function setEEW(q, lv) {
    eewTimers.forEach(function (t) { clearTimeout(t); }); eewTimers = [];
    var MET = eewMetric(q);
    /* ★★★ 2026-10-29 用户：「如果检测到最早的日本地震消息，就算没有具体位置，
       摄像机自动跳到日本全境，同时最早的地震消息也应该使用 Tab2 页面」
       —— 震源未定（P2P「震源調査中」/ wolfx PLUM 前几报，坐标是 null 或 -200 占位）
         这一条照样进 Tab2，只是**不跑 GMPE / 不填色 / 不画红叉 / 不套用海洋取景**。 */
    var _noHypo = !hasHypo(q);
    /* ★ 调试探针（控制台 QVViews._eewIn / _eewOut 可查）：
       排查「模拟开始了但 Tab2 说没有情报」。 */
    V._eewIn = { lv: lv, met: MET, mag: q.mag, dep: q.depthKm, lat: q.lat, lon: q.lon,
      maxShindo: q.maxShindo, shindo: q.shindo, t: Date.now(),
      wkm: (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : -1 };
    V._eewOut = 'not reached';
    /* ★ 2026-10-26 用户规则：有新情报 → 跳到对应 UI 看 10 秒 → 弹回原页。
       EEW / 检测态都在 Tab2（实时页）。
       ★★★ 2026-10-28 用户：「卡片连续15秒没反应……才会跳出去，现在我感觉3秒就跳，太频繁了」
       ⇒ 停留改成 **15 秒**（真实秒），并且还要过 canAutoBack 的闸（距上次切页 >5s，规模大 >8s）。
       ★★★ 2026-10-25 用户：「模拟地震时 EEW 阶段没结束，却自动跳到 Tab1」
       —— 这里以前是 `flashView(1, 15000)`：**15 秒后自动回退**。
          回退目标按「当前页」算，而从设置页启动时 autoTab/0 → 回退目标 = **Tab1**。
          于是模拟开始 15 秒后（心跳期报文要发好几分钟，EEW 根本没结束）
          就会被硬拽到 Tab1 —— 就是用户报的那条。
       ⇒ EEW 期间就该一直待在 Tab2 看速报：`backTo = -1` = 跳过去**不回退**；
          回退交给真正的阶段推进（调查中/震源速報 会自己 setView(0)）。 */
    /* ★★★ 2026-10-27 真实 EEW：**第一报必须把画面带到 Tab2（EEW 页）**。
       以前这条弹页会被 12 秒「手动优先」宽限（MANUAL_HOLD）拦掉：
       用户刚好点过 Tab / 历史 / 地图，整场地震就一直留在 Tab1
       （用户报的「自始至终我们一直都在 Tab1 页面」）。
       现在：一条地震（同一个 eventId）**只强拉一次**，拉过去之后照旧听用户的。 */
    if (q.real && !q.isCancel) {
      var _evj = String(q.eventId || q.id || '');
      if (V._realJumpEv !== _evj) { V._realJumpEv = _evj; V._manualAt = 0; }
    }
    if (!q.isCancel) { try { flashView(1, 15000, -1); } catch (e1) { } }
    /* ═══ 2026-10-21 eewC：「取消报」（误报 / 误检测被撤销） ═══
       data.js 的 srcEewOne 里一直在解析 q.isCancel，但 views 从来没用过它，
       所以官方音效表里的 eewC（地震误报取消）之前无状态可接。
       取消报**优先于一切**：哪怕这报带了震度也不进 eew 态。
       卡片只显示「取消」提示，不跑报文循环，4.2 秒后自动清空。 */
    if (q.isCancel) {
      try { if (global.QVSpeak && QVSpeak.eewCancel) QVSpeak.eewCancel(); } catch (e0) { }
      /* 官方取消报是「在原来那张卡上压一层」，所以规模/深度/震度要**继承上一报**，
         不能清成 0（用户给的原版截图里仍是 震度7 / M9.8 / 10km）。 */
      var pv = V.eew;
      V.eew = {
        kind: 'cancel',
        place: q.place || (pv && pv.place) || '',
        timeMs: q.timeMs || (pv && pv.timeMs) || Date.now(),
        mag: (pv && isFinite(pv.mag)) ? pv.mag : 0,
        depth: (pv && isFinite(pv.depth)) ? pv.depth : (+q.depthKm || 10),
        level: (pv && isFinite(pv.level)) ? pv.level : 0,
        metric: MET,
        report: q.seq || (pv && pv.report) || 1,
        areas: [], allAreas: [],
        lat: +q.lat || (pv && pv.lat), lon: +q.lon || (pv && pv.lon),
        plan: 1, distMax: 0
      };
      if (global.QVSpeak && QVSpeak.playFile) QVSpeak.playFile('eewC', 1.0);
      if (global.QVMapCam && QVMapCam.setBoxes) QVMapCam.setBoxes(null);
      if (global.QVViews && QVViews.setView) QVViews.setView(1);
      if (global.QVRedraw) QVRedraw();
      eewTimers.push(setTimeout(function () {
        if (V.eew && V.eew.kind === 'cancel') {
          V.eew = null;
          hideDetCircle();
          /* 取消报收摊 → 释放震源红叉锁，回到「按选中地震画红叉」 */
          if (global.QVMapCam && QVMapCam.lockPin) QVMapCam.lockPin(null);
          if (global.QVRedraw) QVRedraw();
        }
      }, 8000));
      return;
    }
    /* ★ 官方「揺れを検出」= 实际观测到揺动的**区域**（不是随便取最近的）
       做法：用 1748 个真实测站各自算震度 → 按「観測点所属区域」聚合取最大 → 按震度降序 */
    /* ★ 2026-10-29：震源未定时不做 GM 推算（NaN 坐标进去只会算出垃圾） */
    /* ★ 2026-10-29：震源未定时不做 GM 推算（NaN 坐标进去只会算出垃圾）
       ★ 2026-10-30 用户：「中国区的测站都是模拟地震使用的，为什么会有数值」
       —— 真实地震（q.real）且烈度刻度（MET === 'liedu'）绝不生成假测站！中国区测站表纯用于离线模拟 */
    var obs = (_noHypo || (q.real && MET === 'liedu')) ? [] : genStations(q.lat, q.lon, lv, MET, q.depthKm, q.mag);
    /* ★★★ 2026-10-20 用户：「测站都爆了两个 7，推定最大震度却连 6 强都没有」
       —— 卡片上的最大震度以前直接用「用户填的预测震度」，和测站自己算出来的
       完全是两套数。现在改成：**以测站实算的最大值为准**（测站说什么就是什么）。 */
    /* ★★★ 2026-10-20 用户：「模拟进行到开始发紧急地震速报时，摇晃检出的框应该撤下来」
       所以检测/速报判定必须按【P 波已经到达的测站】实时算，而不是拿全量模型一次定死：
       刚开始只有近场测站 → 震度 1~2 → 摇晃检出；波扫出去后观测到 ≥3 → 切紧急地震速报。 */
    var _wkm = (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0;
    /* ★★★ 2026-10-21 用户：「深度 100km 没反应就是单纯的坏了，我 M9.9 100km 都没反应的」
       —— 真因：测站震源距 `hyp = sqrt(水平² + 深度²)`，**至少等于深度**。
          首报时 P 波只走了几公里（_wkm ≈ 5），而深 100km 的测站 hyp 全都 ≥100
          → 循环里一个都进不来 → lvObs=0 → 走到下面 `lvObs < 1` 分支把 V.eew 清空
          → 卡片/列表/框/波圈全没有（深度 10km 时 hyp≥10，正好能过线，所以看不出问题）。
       ⇒ 有效波前至少放到「深度 + 20km」，保证深源地震首报也有测站。
         注意这不是 PLUM 的问题 —— PLUM 的 R 在 rebuildAreas 里另算。 */
    var _dep0 = Math.max(1, +q.depthKm || 10);
    /* ★★★ 2026-10-25 必须用【震央距 epi】和波前比，不能用 hyp（震源距）：
         `wavePkm`（JMA2001）与 PLUM 半径都是**震央距离**，
         而 hyp = √(epi² + dep²) 在深源时能比 epi 大一倍以上。
         以前为了让深源首报"有测站"，这里加了 `Math.max(_wkm, _dep0 + 20)`
         —— 代价是深源首报瞬间就把所有 hyp ≤ 370km 的测站当成已到达（超前预报）。
         现在首报延迟已经用 JMA2001 走时等到 P 波真的到站，不需要这个假波前。 */
    var _wkmEff = _wkm > 0 ? _wkm : (_dep0 + 20);
    var _epiOf = function (o) { return (o && o.epi != null) ? +o.epi : ((o && o.hyp) || 0); };
    var lvObs = 0, anyLow = false;
    for (var oi = 0; oi < obs.length; oi++) {
      if (_wkm > 0 && _epiOf(obs[oi]) > _wkmEff) continue;
      if (obs[oi].shindo > lvObs) lvObs = obs[oi].shindo;
    }
    if (obs.det) for (var dj = 0; dj < obs.det.length; dj++) {
      if (_wkm > 0 && _epiOf(obs.det[dj]) > _wkmEff) continue;
      anyLow = true; break;
    }
    /* ★★★ 2026-10-21 用户：「日本海中部，P 波和 S 波明明都没到达任何一个测站，
       为什么警报却一直在跳动？你怎么算的？又没有测站」
       —— 他说得对。上一版我为了不让 Tab2 空着，加了「波前没覆盖测站时退回全量模型最大值」，
          那是**凭空超前预报**：8 秒时 P 波才走 80km，最近测站还在 242km 外，
          根本没有任何实测数据，却已经开始报「警报 #09 震度5弱」。
       ⇒ 兜底整段撤掉。**没有测站就不报**，这是物理底线。
         那「Tab2 空着」怎么解决？靠首报延迟自己等够时间（见 fireSim 的 delay）：
         P 波真的走到第一个测站之后 setEEW 才触发，那时 lvObs 天然有值。 */
    if (lvObs >= 1) lv = lvObs;
    /* ★ 调试探针：这一段是「没情报」的唯一入口 —— lvObs/anyLow 都为假就会清空 V.eew */
    V._eewOut = { nObs: obs.length, nDet: obs.det ? obs.det.length : 0,
      lvObs: lvObs, anyLow: anyLow, wkm: _wkm, wkmEff: _wkmEff,
      nearestHyp: obs.length ? Math.round(Math.min.apply(null, obs.map(function (o) { return o.hyp || 9e9; }))) : -1 };
    /* ★★★ 2026-10-20 用户（图一）：官方阀值 —— 观测最大震度 ≥3 才发「紧急地震速报」；
       震度 1~2（或只是未满1的摇晃）只算「揺れを検出」。 */
    if (lvObs < 1 && !anyLow && !q.real) {
      /* ★ 2026-10-21 容错：波速估计可能差几十公里（delay 算早了）→
         到点时波前刚好还没覆盖最近测站。隔 1.2 秒重试，最多 4 次。
         ⚠️ 重试期间仍然严格要求「真的有测站进来」，绝不凭空预报。 */
      var _rc = (V._eewRetry || 0) + 1;
      if (_rc <= 4) {
        V._eewRetry = _rc;
        V._eewOut.retry = _rc;
        eewTimers.push(setTimeout(function () { setEEW(q, lv); }, 1200));
        return;
      }
      V._eewRetry = 0;
      V.eew = null;
      hideDetCircle();
      if (global.QVMapCam && QVMapCam.setBoxes) QVMapCam.setBoxes(null);
      if (global.QVRedraw) QVRedraw();
      return;
    }
    V._eewRetry = 0;
    /* ★★ 天体模式：推定烈度直接用 GMPE 峰值现算，不信 estimateRank
       （它返回的 shindo 是 0~7 数字，而 ladOf('shindo') 是 [0,1,2,3,4,50,55,60,65,70]
        这种码表 → indexOf(7) = -1 → lv0 退成 0，就是用户看到的「推定 0」）。 */
    if (global.QVPlanet && global.QVPlanet.isPlanet() && global.QVPlanet.pfI) {
      var _Im = global.QVPlanet.pfI(0, Math.max(0.5, +q.depthKm || 10), Math.max(1, +q.mag || 6));
      var _ED = (global.QV_LIEDU && QV_LIEDU.EDGES) || null;
      var _L = 1;
      if (_ED) { for (var _z = 1; _z < _ED.length; _z++) if (_Im >= _ED[_z]) _L = _z + 1; }
      lv = Math.max(1, Math.min(12, _L));
    }
    /* ★ 2026-10-25：有 detHold 就先走检测态（见 fireSim 里的说明）
       ★★★ 2026-10-25 深源：官方在 EEW 阶段就发报、震度栏写「不明」，
          不会因为观测震度只有 1 就退化成「揺れを検出」。
         但 M < 5.0 的深源太小、现实中不会触发 EEW → 保持检测态。 */
    var _deepNow = (q.deepSrc || isDeepSrc(q.depthKm)) && (+q.mag >= 5.0);
    /* ★★★ 2026-10-27：真实电文（q.real）不存在「只有摇晃、还没发报」的阶段
       —— 它就是紧急地震速报本身，震度 1/2 的予報也照样是速报卡（官方对照截图）。
       放在这里统一决定 kind，后面的声音（playEewSound）/地图检测框才会跟着一致。 */
    var kind = q.real ? 'eew'
      : _deepNow ? 'eew'
        : (q.detHold && !q.real) ? 'detect'
          : ((lvObs >= eewThresh(MET)) ? 'eew' : 'detect');
    /* ★ 检测态：不画红叉 / P/S 波圆；框由 rebuildAreas 的 setBoxes 画 */
    if (global.QVMapCam && QVMapCam.setBoxes) QVMapCam.setBoxes(null, kind === 'detect');

    /* ★★ 实时推算：第 1 报的 M / 深度 / 震度 都还没收齐，官方也是逐报逼近真值。
       这里给每条模拟地震一套「初报值 → 终值」的收敛过程（bumpEEW 里按进度插值）。 */
    var mag = +q.mag || 6.0, dep = Math.max(0, +q.depthKm || 10);
    /* ★★ 2026-11-03 天体模式：直接用模拟真值，不做「首报退档」
       （用户：「推定 最大震度 0、震级 8.6、深度 0km」全对不上）。
       地球那套的首报退档 + bumpEEW 的反推都是建立在【地球测站表】上的，
       行星坐标下反推出来的 M/深度是垃圾值，还不如直接显示用户填的。 */
    var isPlanetNow = !!(global.QVPlanet && global.QVPlanet.isPlanet());
    /* ★★★ 2026-10-25 首报 M / 深度按三份样本重新标定：
         青森県東方沖 M7.5/50km → #1 **M5.7 50km**（M −1.8，深度 = 真值）
         熊本 M7.1/10km        → #1 无 M，**#2 M5.0 10km**（M −2.1，深度 = 真值）
         日本海北部 M5.6/350km → #1 **M5.3 340km**（M −0.3，深度 −10）
       ⇒ ① 浅源首报不把深度砍到 0.6 倍（以前 50km 会报成 30km，样本里一直是 50/60）
          ② 深源 M 已经很准，只退 0.3；深度按 10km 取整并略减
       ⚠️ 只影响「显示」，genStations 用的仍是 q.mag / q.depthKm 真值。 */
    var mag0 = isPlanetNow ? mag
      : (_deepNow ? Math.max(3.0, Math.round((mag - 0.3) * 10) / 10)
        : Math.max(3.0, Math.round((mag - (mag >= 7.0 ? 1.8 : 2.1)) * 10) / 10));
    var dep0 = isPlanetNow ? dep
      : (_deepNow ? Math.max(10, Math.round((dep - 10) / 10) * 10)
        : Math.max(10, Math.round(dep / 10) * 10));
    /* ★★★ 2026-10-20 用户：「测站都爆了两个 7，推定最大震度连 6 强都没有」
       以前只降一档（而 70→65 还是 6强），然后要等 plan×35%（M9.9 要十几报）才跳到终值
       → 中间好几报都和左侧区域列表矛盾。
       改成：① 首报退 1~3 个**合法档位**（官方也是 5弱→5强→6弱… 一档档上）；
              ② 在 4 报内爬完，之后始终 = 测站实算最大值，两边再不会不一致。 */
    var LAD = ladOf(MET);
    var ladIdx = function (c) { var i = LAD.indexOf(+c); return i < 0 ? 0 : i; };
    var iT = ladIdx(lv);
    /* ★ 2026-10-20 用户：「熊本 M7 在陆地上，官方 9 秒就报最大震度 7」
       —— 首报只退 1 档（以前震度 7 要退 3 档 = 首报 5弱，明晚才到 7） */
    var back = 1;
    var i0 = Math.max(0, iT - back);
    /* ★ 2026-10-25 首报档位：真实熊本 M7.1 的**第 1 报是「推定最大震度4」**
       （16:27:20，「リアルタイム震度から直接推定された震度が発表されています」），
       不是只退一档。强震（5弱以上）一律从震度4 起步，弱震才退一档。 */
    var _idx4 = -1;
    for (var _lq = 0; _lq < LAD.length; _lq++) { if (+LAD[_lq] === 4) { _idx4 = _lq; break; } }
    if (iT >= 5 && _idx4 >= 0) i0 = Math.min(iT - 1, _idx4);
    if (isPlanetNow) i0 = iT;          /* 行星上首报就是终值，不退档 */
    var lv0 = LAD[i0];
    /* ★★★ 2026-10-21 修：这里以前还有两行
         `if (MET === 'liedu') lv0 = Math.max(1, +lv - 1);
          else lv0 = Math.max(0, Math.round(+lv) - 1);`
       它把上面算好的 `LAD[i0]` 又覆盖掉了，而且 **只在 lv 是「震度 0~7」时才成立**：
         震度码 45（5弱）→ Math.round(45)-1 = **44**，不是合法档位
         → 卡片「推定最大震度」显示成 0。
       （P 波还没扫到测站时，lvObs 兜底 = 45 就撞上了这个 bug。）
       首报退档本来就是 `i0 = iT - back` + `LAD[i0]` 的活，这两行多余且有害，删掉。 */
    var plan = reportPlanFromObs(obs, mag, dep, q.lat, q.lon, lv, MET);
    /* ★ 2026-10-27 首报前已经用「临时检测态」画过框/圆（fireSim 里建的），
       这里重建 E 时要把已发布档位带过来，否则开场会从第 1 档重新响一遍。 */
    var _prevE = V.eew;
    var _prevPub = (_prevE && _prevE._pubLv != null) ? _prevE._pubLv : null;
    var _prevWant = (_prevE && _prevE._wantLv != null) ? _prevE._wantLv : null;
    var _prevSndAt = (_prevE && _prevE._sndAt) || 0;
    V.eew = {
      kind: kind,
      /* ★★★ 2026-10-29：**事件号必须留在 E 上**。
         applyMeasured（VXSE51/53）靠它「认邻」—— 两边事件号不同就是另一场地震，
         绝不能把正在发报的紧急地震速报卡改写成「震度速報」（用户报的那张卡）。 */
      eventId: String(q.eventId || ''),
      /* ★★★ 2026-10-25 深源地震：EEW 阶段震度「不明」
         （样本《2026 日本海北部 M5.6 深350km》全程如此，直到正式报才给震度1）。
         deepSrc 只控制【卡片显示】，E.level 仍按 GMPE 值保留给地图/海啸判定。 */
      deepSrc: _deepNow ? 1 : 0,
      /* ★ 2026-10-23 长周期地震动階級（模拟时由 fireSim 估算；真实 EEW 由 dmdata VXSE62 提供） */
      maxLg: (q.maxLg != null ? q.maxLg : -1),
      /* ★ 2026-10-21 留住原始数据对象：切到 Tab1 时要用它把这场地震顶成主卡
         （否则模拟地震会被下一次 refresh 冲掉，用户「只看得到声音」）。 */
      q: q,
      place: q.place || '模拟震源', timeMs: q.timeMs || Date.now(),
      mag: mag0, depth: dep0, level: lv0, metric: (V.eew && V.eew.metric) ? V.eew.metric : MET, report: 1, areas: [],
      isFinal: !!q.isFinal,
      allAreas: [],
      obs: obs,
      /* 检测态→速报态切换时要恢复红叉/波圆，记下震源与模拟时间轴 */
      lat: +q.lat, lon: +q.lon, simT0: V.simT0 || q.timeMs || Date.now(),
      detLv: (kind === 'detect' ? +lvObs : null),
      /* ★ 2026-10-25 检测态→EEW 升级控制：detHold=最短检测时长（模拟秒），
         detWall=检测开始时刻，repBase=升级时把报文号重编到「第1报」 */
      detHold: (+q.detHold || 0), detWall: Date.now(), repBase: 0,
      /* 收敛参数（不外露） */
      plan: plan, magT: mag, mag0: mag0, depT: dep, dep0: dep0, lvT: lv,
      ladI0: i0, ladIT: iT,
      /* ★ 震度爬升用：4 报内从首报档位爬到终值（第 2 报起），之后恒等于 lvT */
      ladStep: Math.max(1, Math.ceil((iT - i0) / 3))
    };
    if (_prevPub != null) {
      V.eew._pubLv = _prevPub;
      V.eew._wantLv = _prevWant;
      V.eew._sndAt = _prevSndAt;
    }
    /* ★★★ 2026-10-25 深源：「首报直接是 EEW」这条路上，fireSim 之前按 detPre=true
       只铺了检测态地图（不画红叉 / P-S 波圆 / 检测框）。
       现在要立刻切成速报态，否则整场地震都不会出现震源红叉（bumpEEW 的升级块
       只在 `E.kind === 'detect'` 里跑，深源的 kind 已经是 'eew'）。 */
    if (_deepNow && !q.real && global.QVMapCam) {
      var _t0d = V.simT0 || q.timeMs || Date.now();
      if (QVMapCam.setBoxes) QVMapCam.setBoxes(null);
      if (QVMapCam.lockPin) QVMapCam.lockPin([{ lat: +q.lat, lon: +q.lon, kind: 'eew' }]);
      if (QVMapCam.setPins) QVMapCam.setPins([{ lat: +q.lat, lon: +q.lon, kind: 'eew' }]);
      if (QVMapCam.simWave) QVMapCam.simWave({
        lat: q.lat, lon: q.lon, t0: _t0d, level: q.maxShindo, mag: q.mag,
        depth: q.depthKm, autoFit: false, deep: 1 });
      if (QVMapCam.setStations) QVMapCam.setStations(obs,
        { t0: _t0d, depth: q.depthKm, metric: MET });
    }
    /* 首报：只填「P 波刚扫过的那一小部分测站」（占全部有声测站 ~12%） */
    /* 首报：只用「P 波已经走到」的那一小圈测站（不是全日本） */
    /* ★ 2026-10-29：震源未定（没有坐标）→ 一张色块都不画，也不碰测站/波圈 */
    if (!_noHypo) rebuildAreas(V.eew, (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0);
    /* ★ 2026-10-25 首报之后的下一个阶段 = 调查中（真实时间下限 90 秒，见 enterJishin） */
    if (!q.real) V.simEtaMs = (V.simT0 || Date.now()) + 90000;
    /* ★ 检测出一摇就用官方 NewIntN（另一套音效），不要用 EEW 的 eew0/eew5 */
    /* ★★ 2026-10-29：真实速报如果是「轮询补上来的旧报」（app.js 的 pumpEew 在
       启动/刷新时补，最多可能晚几分钟）→ 只画卡、不响铃，否则开会话就无故响警报。
       90 秒内 = 仍然算即时。 */
    if (kind === 'eew') {
      var _pubAge = q.real ? (Date.now() - (+q.pubMs || +q.timeMs || Date.now())) : 0;
      if (!q.real || _pubAge < 90000) playEewSound(1);
    } else playDetectSound(lvObs, MET);
    if (global.QVViews && QVViews.setView) QVViews.setView(1);
    if (global.QVRedraw) QVRedraw();
    /* ★★ 2026-10-23 真实 EEW（wolfx 推送）：只渲染当前这一报，**绝不跑模拟报文循环**。
       报数 / 取消 / 阶段推进全部由真实电报驱动（onRealEew → applyMeasured）。 */
    if (q.real) {
      V.eew.mode = 'real';
      /* ★ 2026-10-29：标记「这条 E 来自真实紧急地震速报电报」。
         drawEEW 靠它决定「震度速報阶段 Tab2 的速报卡要不要留着」。 */
      V.eew.realEew = 1;
      V.eew.report = q.seq || 1;
      V.eew.isFinal = !!(q.isFinal || (q.seq && q.plan && q.seq >= q.plan));
      V.eew.measured = false;
      V.eew.warn = !!q.isWarn;
      V.eew.warnArea = q.warnArea || [];
      V.eew.lowAccuracy = !!q.lowAccuracy;
      /* ★★★ 2026-10-29 用户：「最早的日本地震消息，就算没有具体位置，
         摄像机自动跳到日本全境，同时最早的地震消息也应该使用 Tab2 页面」
         —— 震源未定（震源調査中）的首报：卡片只写「震源調査中 / 不明」，
            震度/规模/深度都不许拿模拟那套退档值冒充。 */
      V.eew.noHypo = _noHypo ? 1 : 0;
      if (_noHypo) {
        V.eew.place = String(q.place || '').trim() || '震源調査中';
        V.eew.mag = NaN;
        V.eew.depth = NaN;
        V.eew.level = -1;
        V.eew.deepSrc = 0;
        V.eew.obs = [];
        V.eew.areas = [];
        V.eew.allAreas = [];
      }
      /* 长周期階級（有就显示副卡；wolfx 没有，dmdata VXSE62 才有） */
      if (q.maxLg != null && q.maxLg > 0) {
        V.eew.maxLg = q.maxLg;
        rememberMaxLg(q.eventId || V.eew.eventId, q.maxLg);
      }
      /* ★ 真实速报没有「波前逐步推进」这回事：电报本身已经是成型的预测，
         所以直接把全量推定分布一次性画出来（限速波前只用于模拟）。
         等级/形态也用 JMA 给的预测最大震度，不被测站实算的 lvObs 拉低。 */
      var realLv = (q.maxShindo >= 0) ? q.maxShindo : (q.shindo >= 0 ? q.shindo : V.eew.level);
      V.eew.level = realLv;
      /* ★★★ 2026-10-25 深源：真实 EEW 震度经常是「不明」（本项 -1），
         不能因此退化成「揺れを検出」——官方照样发紧急地震速报。 */
      V.eew.deepSrc = isDeepSrc(q.depthKm) ? 1 : 0;
      /* ★ 编码是 0..4 / 50..70，**不是** 0..70。以前写 `realLv >= 30`，
         结果真实震度 3/4 的 EEW 被当成「只检测到摇晃」。 */
      /* ★★★ 2026-10-27 用户（官方 SREV 对照截图）：
           08:25:24「予報 #01 推定2 / M4.1 / 60km」官方画的是**紧急地震速报卡**，
           不是「揺れを検出」面板。
           —— 「検出」态只属于「摇晃被检测到、但一条电文都还没收到」的那一段；
              本机没有检波器，真实数据流里这一段根本不存在。
              真实电文（哪怕是震度1/2 的予報、哪怕是深源「不明」）**一律是速报卡**。
           ⚠️ 顺带影响地图：检测态会 pinsOff（压掉震源红叉）、画检测框 ——
              真实电文必须把这两样撤掉，否则 Tab2 是速报卡、地图却还是检测态。 */
      V.eew.kind = 'eew';
      if (global.QVMapCam) {
        if (QVMapCam.setBoxes) QVMapCam.setBoxes(null);
        if (QVMapCam.setDetectMode) QVMapCam.setDetectMode(false);
        /* ★★★ 2026-10-27 用户：真实 EEW 地图上必须看得到震源红叉。
           render3 每次重绘都按「当前选中地震」重设 pins，而真实电文往往还没进数据列表
           → 刚画上的红叉下一帧就被抹掉。⇒ 用 lockPin 钉住（和模拟同一套机制）。
           解锁点：① 用户点浮标/选别的历史（hovpill + QVHist.show）
                   ② 取消报 8 秒后清空 V.eew 时  ③ cancelSim。
           ★ 同时把【発生時刻 / 深度 / 震度】一起传下去 —— P/S 波圆靠这三个值
             用官方 JMA2001 走時表算半径（mapcam.tickWaves）。只给经纬度的话
             波圆会拿「当前选中地震」的时刻，真实速报就画错/不画。 */
        var _pin = { lat: +q.lat, lon: +q.lon, kind: 'eew',
          t0: (V.eew && V.eew.timeMs) || q.timeMs || 0,
          depth: (V.eew && isFinite(V.eew.depth)) ? V.eew.depth : q.depthKm,
          lv: (V.eew && V.eew.level != null) ? V.eew.level : -1 };
        if (_noHypo) {
          /* ★ 2026-10-29 震源未定：不画红叉 / 不画波圆（没有震源可画），
             镜头退回【日本全境】（用户明确要求：摄像机自动跳到日本全境）。 */
          if (QVMapCam.lockPin) QVMapCam.lockPin(null);
          if (QVMapCam.setPins) QVMapCam.setPins([]);
          if (QVMapCam.reset) { try { QVMapCam.reset(); } catch (eRst) { } }
        } else {
          if (QVMapCam.lockPin) QVMapCam.lockPin([_pin]);
          if (QVMapCam.setPins) QVMapCam.setPins([_pin]);
        }
      }
      /* ★★★ 2026-10-25 真实数据源地区震度的第一优先级：
         如果这一报带【官方区域震度】（带 JMA 区域码，例如 dmdata VXSE42/44 的
         ForecastArea、或未来接入的 JMA 电文），地图必须以官方值为准。
         wolfx 的 jma_eew 目前只有 MaxIntensity → 这里拿不到就走 GMPE 补全，
         一旦 VXSE51/53 到达，applyMeasured → QVShindo.set 会直接覆盖（见 render3）。 */
      if (q.areas && q.areas.length) {
        var _oaList = [];
        for (var _ai = 0; _ai < q.areas.length; _ai++) {
          var _ae = q.areas[_ai] || {};
          var _av = (_ae.shindo != null) ? +_ae.shindo : -1;
          if (_ae.code == null || !(_av >= 0)) continue;
          _oaList.push({ code: _ae.code, shindo: _av, name: _ae.name || '' });
        }
        if (_oaList.length) V.eew.officialAreas = _oaList;
      }
      /* 真实电报的震级/深度就是官方值，不要跑模拟的「首报退档」 */
      if (isFinite(q.mag) && q.mag > 0) V.eew.mag = q.mag;
      if (isFinite(q.depthKm) && q.depthKm >= 0) V.eew.depth = q.depthKm;
      V.eew.simT0 = 0;
      /* ★ 2026-10-29 震源未定：没有坐标就不填色、不取景（镜头已经回日本全境） */
      if (!_noHypo) {
        try { rebuildAreas(V.eew, 99999); } catch (e) { }
        /* ★★★ 2026-10-27：真实电报也要「界面适配」——镜头跟到新震源。
           以前这里画完色块就 return，相机一动不动（要等正式报才动）。 */
        try { realEewFrame(V.eew); } catch (eFrm) { }
      }
      if (global.QVRedraw) QVRedraw();
      return;
    }
    /* ★ 报数与间隔都按规模推算；报完 plan 报自然结束（不是「几报就没了」）。
       ★★★ 2026-10-21 用户：「等震中最大峰值过后，就应该改成调查中的卡片了」
       ⇒ 最后一报之后，摇晃峰值过去了 → 切到【震度速报】卡片
         （标题「震度速报」+「最大震度」+「震源・規模 调查中」+「海啸 调查中」）。 */
    /* ══════ 2026-10-22 用户：「大地震确实可以 40 报+，但现实中 1 分钟左右就会发调查中，
       虽然发了调查中，速报还是会继续更新直到最后一报」
       ⇒ 把「震源情報 / 正式報」抽成两个函数，**速报循环继续跑**：
         · 60 秒定时器：进「调查中」（震源情報）—— 不动报文循环
         · 报文全部发完后：等摇晃峰值 → 进「各地震度情報（正式报）」 */
    /** ★★★ 2026-10-26 用户：「海啸情报太慢了！应该要在“地震情报”就有海啸的初步结果」
     *   → 追问后确认：「就是**震度速報**阶段」。
     *   —— 以前这个发布块写在 enterFinal（各地震度情報 = 第 4 阶段，120 秒之后），
     *      所以海啸要等两分多钟才出现。
     *   ⇒ 抽成 publishSimTsunami(flashMs, backView)：
     *      · 调查中（震度速報）入口就调（约 12 秒后发布）→ 初步结果 = 注意报档
     *      · 升级警报仍然在幕后按真实时间排队（约 6 分钟，按加速折算）
     *      · enterFinal 只做兼底（万一这场根本没进过调查中）
     *   @param flashMs  弹到海啸页停留多久（0 = 不弹）
     *   @param backView 弹完回哪一页（-1 = 用默认行为） */
    function publishSimTsunami(flashMs, backView) {
      if (!V._simTsuPlan || V._simTsuSent) return false;
      V._simTsuSent = 1;
      var pp = V._simTsuPlan; V._simTsuPlan = null;
      simAux.push(setTimeout(function () {
        if (!global.QData || !QData.simTsunami) return;
        var stages = [];
        try { stages = simTsuStages(pp.q) || []; } catch (eST) { stages = []; }
        var firstObj = stages.length ? stages[0].obj : null;
        /* ★★★ 2026-11-03 用户：「明明海啸发布结果还没出来，页面就已经自动跳到了海啸页面」
           —— 内陆震源 / 规模不够时一个区域都到不了发布标准（maxLv 也是 0），
              以前照样 `simTsunami()` + `flashView(2)` → 被弹到海啸页却写着「暂无海啸信息」。
           ⇒ 一个区域都没达到发布标准 = **不发布、不弹页、不响声**，只提示一句。 */
        var _nTsu = (firstObj && firstObj.items) ? firstObj.items.length : 0;
        if (!(_nTsu > 0) || !((firstObj.maxLv | 0) >= 1)) {
          QData.simTsunami(null);
          if (global.QVRedraw) QVRedraw();
          toast('本次地震无海啸威胁（模拟）：没有沿岸区域达到发布标准');
          return;
        }
        V._tsuSrcQ = pp.q;
        V._tsuShown = 1;
        V._tsuStages = stages;
        V._tsuStage = 0;
        QData.simTsunami(firstObj);
        if (global.QVHist && QVHist.setCurrent) QVHist.setCurrent(pp.q);
        if (global.QVRedraw) QVRedraw();
        tsuSfx(firstObj);
        if (flashMs > 0) {
          try { flashView(2, flashMs, backView); } catch (eFV) { }
        }
        toast('海啸 1/9：' + stages[0].name);
        /* ★★★ 2026-11-03 用户：「还有正式报的没出来为什么我按回车海啸也会一起动？」
           —— 以前这里会调 simTsuAutoNext()：海啸档位每 12 秒自己往后走一档，
              用户按回车推地震阶段时恰好撞上自动推进 → 看着就像「回车把海啸也推了」。
           ⇒ 模拟里 **海啸只跟着回车走**（__skipStage 里显式 simTsuNext），
              不排自动定时器。 */
      }, 6000));
      return true;
    }
    /** 海啸阶段自动推进（不必按回车也能看到全过程；用户跳阶段会提前接管） */
    function simTsuAutoNext() {
      /* ★ 单链：手动推进 / 自动推进都调这里，先清掉上一个定时器，避免两条链叠加 */
      if (V._tsuTmr) { clearTimeout(V._tsuTmr); V._tsuTmr = 0; }
      if (!V._tsuStages || (V._tsuStage | 0) >= V._tsuStages.length - 1) return;
      V._tsuTmr = setTimeout(function () {
        V._tsuTmr = 0;
        if (!V._tsuStages) return;
        simTsuNext(true);
      }, Math.max(12000, 45000 / Math.max(1, simSpd())));
      simAux.push(V._tsuTmr);
    }
    /** 推进一个海啸阶段（手动跳阶段 / 自动定时都用） */
    function simTsuNext(silent) {
      if (!V._tsuStages || !V._tsuStages.length) return false;
      var i = (V._tsuStage | 0) + 1;
      if (i >= V._tsuStages.length) return false;
      V._tsuStage = i;
      var st = V._tsuStages[i];
      var o = st && st.obj ? _tsuClone(st.obj) : null;
      if (!o) return false;
      o.atMs = simNowMs();
      if (!global.QData || !QData.simTsunami) return false;
      QData.simTsunami(o);
      if (global.QVRedraw) QVRedraw();
      /* 音效：级别变化/新报文/到达情报变化由 tsuSoundTick() 自动判，
         这里只补一句即时反馈，避免轮询那 1 秒的延迟感。 */
      tsuSfx(o);
      if (!silent) toast('海啸 ' + (i + 1) + '/9：' + st.name);
      /* ★★★ 2026-10-26 用户：「解除后其实一般都是直接跳回 Tab1」
         —— 全部解除（或这一档已经没有等级）之后不要把人留在海啸页看空列表，
            直接切回 Tab1（详细栏）。顺手清掉任何待执行的回退定时器。 */
      var _last = (i >= V._tsuStages.length - 1) || !(o.maxLv | 0) || !(o.items && o.items.length);
      if (_last) {
        try {
          if (V._flashTimer) { clearTimeout(V._flashTimer); V._flashTimer = 0; }
          V._flashBack = -1;
          setView(0);
        } catch (eV0) { }
      }
      if (i < V._tsuStages.length - 1) { /* 不再自动推进：只等回车 */ }
      return true;
    }

    function enterJishin() {
      /* ★ 调试面板「暂停」时不要推进阶段（延后重试，恢复后继续） */
      if (global.__SIM_PAUSE) { eewTimers.push(setTimeout(enterJishin, 500)); return false; }
      if (global.__TRACE_STAGE) console.log('[TR] enterJishin kind=' + (V.eew && V.eew.kind) +
        ' inq=' + !!(V.eew && V.eew.inq) + ' inqAt=' + (V.eew && V.eew.inqAt) +
        ' simT0age=' + Math.round((Date.now() - (+(V.eew && V.eew.simT0) || 0)) / 1000) + 's');
      /* 首报常见是 detect（扫摇检出）态，60 秒后也要能进调查中 */
      if (!V.eew || (V.eew.kind !== 'eew' && V.eew.kind !== 'detect')) return false;
      /* ★★★ 2026-10-25 深源小震（最大震度 < 3）：JMA **不发「震度速報」**，
         只发「各地の震度情報」（VXSE53）。
         样本《日本海北部 M5.6 深350km》就是：EEW 10 报 → 19:40:58 各地震度情报 #3
         最大震度1，中间没有「调查中 / 震度速報」这一步。
         ⇒ 直接跨到 final（正式报），不要走调查中。 */
      if (V.eew.deepSrc && !V.eew.inq && (+V.eew.lvT || 0) < 3) {
        V.eew.inq = false;
        V.eew.kind = 'final';
        V.eew.fillStage = 'final';
        V.eew.frozen = 1;
        V._simStage = 'final';
        V.simEtaMs = 0;                 /* 深源小震：直接到最终阶段，没有下一阶段 */
        /* ★ 停掉还没发完的 EEW 报文循环 —— 深源小震不会再有「第 N 报」了 */
        eewTimers.forEach(function (t) { clearTimeout(t); });
        eewTimers = [];
        try {
          rebuildAreas(V.eew, 99999);
        } catch (eDJ) { }
        try { autoFrame(V.eew, true); } catch (eAFj) { }
        if (global.QVRedraw) QVRedraw();
        if (global.QVSpeak && QVSpeak.infoSe) QVSpeak.infoSe('final');
        return true;
      }
      /* ★ 2026-10-26：必须幂等！step 循环和 waitPeak 两条路都会调它，
         重复进入会把 ipf.gi 重置成 0 → 地图等级梯子从头再来（实测：t=7.4s 已降到 6弱
         又跳回只画震度7）。 */
      if (V.eew.inq) return false;
      /* ★★★ 2026-10-25 用户：「调查中的卡片直接不见了吗？」
         —— 曾经试过「等报文循环结束（repDone）才进调查中」，结果心跳期的报文
            （20 报之后 13~21 秒一报）要再发一两分钟，这段时间调查中卡一直不出现，
            右上角还挂着「预计 0 秒后进入下一个阶段」= 看上去像坏了。
         ⇒ 阶段本身仍然按【90 秒真实时间 + 波前】开，不看 repDone；
           只有「切到 Tab1 后要不要回来」才看 repDone（见下面的视图块）。 */
      /* ★★★ 2026-10-28 用户：「人家 S 波刚刚上岸就开始调查了，
         人家地震中心都还没开始衰减震度，你就已经开始调查了」
         —— 以前这里是靠「报文发到 55%」和「固定 25 秒」硬切进来的，
            跟摇晃到底有没有过去完全无关。
         ⇒ 加一道**波前门槛**：波前（P 波公里数）必须已经扫过最远有声测站的 1.6 倍震源距
            （≈ S 波扫完全部测站 → 震中一带的峰值确实过去了），
            否则一律拒绝进入调查中；报文循环和定时器只是「候选时机」，
            真正的许可由波形推进决定。拿不到测站距离时（distMax=0）不拦，退回原来的行为。 */
      var _pk0 = (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0;
      var _dist0 = +V.eew.distMax || 0;
      /* ★★★ 2026-10-28 用户：「先把 S 波都没走完就进调查中修一下」
         —— 上面那句 `_pk0 < _dist0 * 1.6` 用的是 **P 波**公里数：
            P 波 1.6× 最远测站 ≈ S 波才走到 0.9× → **S 波根本没扫完**就进调查中了。
         ⇒ 改成直接算 **S 波**已经走到的震央距（JMA2001 的 S 走时表），
            要求 ≥ 最远有声测站的 1.05 倍（略微留一点余量）。
         拿不到秒数/距离时（真实电文没开波圈）退回原来的 P 波判断。 */
      var _sKm = 0;
      try {
        var _wsec = (global.QVMapCam && QVMapCam.waveSec) ? +QVMapCam.waveSec() : 0;
        /* ★ 2026-10-28：优先用波圈实际的 S 半径（它已经乘了区域系数 k），
           否则青藏/新疆这类慢地壳会出现「圈还没到，就进调查中」。 */
        if (global.QVMapCam && QVMapCam.waveS) _sKm = +QVMapCam.waveS() || 0;
        if (_sKm <= 0 && _wsec > 0 && global.QVMapCam && QVMapCam.jma2001Dist) {
          _sKm = +QVMapCam.jma2001Dist(_wsec, +V.eew.depth || 10, false) || 0;
        }
      } catch (eSK) { _sKm = 0; }
      if (_dist0 > 0 && _sKm > 0) {
        if (_sKm < _dist0 * 1.05) return false;      /* S 波还没扫完全部测站 */
      } else if (_dist0 > 0 && _pk0 > 0 && _pk0 < _dist0 * 1.6) {
        return false;                                 /* 兜底：只有 P 波数时按原来的判据 */
      }
      /* ★★★ 2026-10-28 用户：「你这个调查中来的也太快了吧！你再怎么说也要等个一分钟吧」
         —— 上面那道波前门槛在**加速模拟**下会被瞬间满足（10× 时 6 秒就满足），
            于是「调查中」6 秒就来了。官方从 EEW 首报到震度速報/IPF 至少要 1 分钟，
            所以这里再加一道**真实时间下限**（不受加速影响）。
         ★★★ 2026-10-25 三份样本实测：熊本 16:27:20 首报 → 16:28:49 震度速報(調査中) = **89 秒**；
            青森 23:15:22 → 23:16:51 = **89 秒**。两场几乎一模一样的 1 分半。
            ⇒ 从 60 秒改成 **90 秒**（首报时刻起算；simT0 已提前 6 秒，实际 84 秒）。 */
      var _st0 = +V.eew.simT0 || +V.eew.t0 || 0;
      /* ★★★ 2026-10-28 用户：「这个是深源才会明显的 bug，因为深源地震来的非常慢」
         —— 深源的 S 波要很久才铺到远处（異常震域甚至几千公里），
            而 `distMax` 只统计「P 波已经扫到」的那一小圈测站 → 门槛永远很小、
            90 秒真实时间一到就进调查中，S 波其实还没走完。
         ⇒ 深源单独算一道**物理下限**：S 波必须走完「所有有声测站里最远的那个」：
              需要时间 = travelSec(深度, 最远震央距, S波) × 1.1
            拿不到测站时退回 90 秒。 */
      var _minMs = 90000;
      try {
        if (isDeepSrc(V.eew.depth)) {
          var _depD = +V.eew.depth || 10, _far = 0;
          (V.eew.obs || []).forEach(function (o) {
            if ((+o.shindo || 0) < 1) return;
            var e = (o.epi != null) ? +o.epi : (+o.hyp || 0);
            if (isFinite(e) && e > _far) _far = e;
          });
          if (_far > 0) {
            var _tSd = travelSec(_depD, _far, false);
            if (isFinite(_tSd) && _tSd > 0) _minMs = Math.max(90000, Math.round(_tSd * 1000 * 1.1));
          }
        }
      } catch (eDmin) { }
      if (_st0 && Date.now() - _st0 < _minMs) return false;
      /* ★★★ 2026-10-26 用户澄清架构：「紧急地震速报的卡片还在发报，
         但另一张调查中的卡片却已经开始了，这时候这个弹窗逻辑就派上用场了」
         → 调查中和 EEW 是【并行】的两张卡，不是先后顺序。
         以前这里把 kind 改成 'jishin' = 直接把正在发报的 EEW 卡顶掉 → 用户看到「直接跳到震原速报」。
         现在只点亮独立标志 inq，kind 保持 'eew'，Tab2 继续发报。 */
      V.eew.inq = true;
      if (!V.eew.inqAt) V.eew.inqAt = Date.now();   /* ★ enterFinal 的 60 秒闸门从这一刻算 */
      V.eew.fillStage = 'jishin';
      /* ★★★ 2026-10-26 用户：「人家气象厅真的要抓动态数据，非常麻烦，所以计算非常慢，
         我们这玩意本地几毫秒搞定了」
         → 真实 IPF 要处理全国测站动态波形、反演震源，需要几十秒到几分钟，
           而 koneew 的 inferSource() 几毫秒就出结果 → 「调查中」这个状态在本底上不存在。
         所以这里人为把它铺开：分 5 批逐步释放行政区最大震度，
           每找到一批就刷新卡片并弹一下，直到 mag/depth “算完”。 */
      /* ★★★ 2026-10-28 用户：「你这个调查中来的也太快了吧！再怎么誊也要等个一分钟吧」
         ⇒ 保底 60 秒（真实秒）；加速时不跟着缩到看不清（之前 25× 时只剩 1.2 秒）。
         ★★★ 2026-10-25 用户：「VXSE51 后立马就 VXSE52，但 VXSE51 的阶段都没结束」
         —— 60 秒太短：等级梯子（最多 2 档 × 30 秒）和 5 批行政区刚好在 60 秒才铺完，
            等于「刚铺完就切走」，听感就是两声 VXSE51 紧接一声 VXSE52。
         ⇒ 按真实样本量级（熊本 179 秒、青森 14 分钟）提到 **120 秒**，
            并把梯子/批次压缩到前 105 秒内完成，留 15 秒稳定期。 */
      var _need = Math.max(120000, 120000 / Math.max(1, simSpd()));
      V.eew.inqNeed = _need;
      /* ★ 2026-10-25 下一阶段（震源速報）预计时刻 */
      V.simEtaMs = Date.now() + _need;
      /* ★★★ 2026-10-26 用户：「色块一个一个填，填了个寂実，一下子就填完了…
         最次也得搞个按等级吧，比如先填 7，再填 6」
         ⇒ 调查中的地图不再「一次填满 + 乱放几个区」，而是**按震度等级逐级放出**：
           70(7) → 65(6強) → 60(6弱) → 55(5強) → 50(5弱) → 45(4) → 40(3) → 30(2) → 20(1)
         每降一级：重算地图 + 播一次 VXSE51（refreshInqCard）——那几声提示音从此有意义。 */
      /* ★★★ 2026-10-28 用户：「代码逻辑应该写的是从 7 级到最低级，一级一级地响来播报，
         但是它并没有判断这次地震的最大震度是多少、最低震度是多少。
         就比如我们这次的地震，按理来说只会响两次，也就是 5+ 和 5-，但它响了很多遍」
         ⇒ **等级梯子必须按这场地震实际出现过的震度档来定**，不能写死 10 档。
           比如最大 5強、最低 5弱 → 梯子 = [55, 50] → 全程只响 2 下。 */
      /* ★★★ 2026-10-28 用户：「震度4 也响，3、2、1 不应该在调查中填入，
         应该在正式报一起写入」
         ⇒ 梯子里只保留 **≥震度4** 的档位（4 / 5弱 / 5強 / 6弱 / 6強 / 7）。
           震度 3・2・1 在调查中阶段既不铺色块也不出声，
           统一等 enterFinal（各地震度情報）那一次 rebuildAreas 全部写入。 */
      var _gset = {};
      /* ★ 2026-11-03：以前这里取 `V.eew.allAreas` —— 但这一段跑在 **rebuildAreas 之前**，
         那时 allAreas 还是 EEW 阶段的「波前扫到的那一小片」（只有 7/6強/6弱 三档），
         于是 M8.1 的梯子被截成 3 级。改成从**测站峰值**统计（obs[].shindo 就是峰值码），
         那才是整场地震真实的震度档分布；allAreas 只作兜底。 */
      (V.eew.obs || []).forEach(function (o) {
        var v = +o.shindo;
        if (isFinite(v) && v >= 4) _gset[v] = 1;
      });
      if (!Object.keys(_gset).length) {
        (V.eew.allAreas || []).forEach(function (a) {
          var v = +a.level; if (!isFinite(v) || v <= 0) v = +a.shindo;
          if (isFinite(v) && v >= 4) _gset[v] = 1;
        });
      }
      /* ★★★ 2026-10-26 用户：「调查中刚开始地图色块就两个东西，后面突然变成半个中国，
         这过渡很不自然的，中国区这么大」
         —— 日本的震度码是离散的（10/15/…/70），照「出现过的档」建梯子天然只有几级；
            而中国烈度是**连续小数**（appI 4.28 / 4.31 …）：
            ① 用「档」建梯子 → 上百个几乎相同的键，梯子失效；
            ② 用「整数度」建梯子 → 分布极其不均：≥10度只有 2 个市、≥4度一下 132 个市，
               于是 51 → 183 那一步还是「突变半屏」。
         ⇒ 中国烈度改成 **等频分档（按面积/区域数均匀）**：
            把所有区域按烈度从高到低排好，取第 n/10、2n/10 … 10n/10 个的值当门槛，
            每一档大约多铺出 10% 的区域。这样从调查中一开始就是
            「约 1/10 中国 → 2/10 → … → 全部」，一步一步涨，不会 2 个市跳到半个中国。
            ⚠️ 刻意从 **1/10** 起步（跳过第 0 个 = 只有最高那一个值的极端档），
              否则首帧还是只有「南澳+汕头」2 个色块。 */
      if (V.eew.metric === 'liedu') {
        try { rebuildAreas(V.eew, 99999); } catch (ePF) { }
        V.eew.inqRank = null;
        var _maxLie = 0;
        (V.eew.fillAreas || []).forEach(function (a) {
          var v = Math.round(+a.level || +a.shindo);
          if (isFinite(v) && v > _maxLie) _maxLie = v;
        });
        if (!_maxLie) {
          (V.eew.allAreas || []).forEach(function (a) {
            var v = Math.round(+a.level || +a.shindo);
            if (isFinite(v) && v > _maxLie) _maxLie = v;
          });
        }
        if (!_maxLie && V.eew.obs) {
          (V.eew.obs || []).forEach(function (o) {
            var v = Math.round(+o.shindo);
            if (isFinite(v) && v > _maxLie) _maxLie = v;
          });
        }
        if (!_maxLie && V.eew.imax) _maxLie = Math.round(+V.eew.imax);
        if (!_maxLie && V.eew.level) _maxLie = Math.round(+V.eew.level);
        if (!_maxLie) _maxLie = 8;

        /* ★★★ 2026-10-30 映射到中国 12 度烈度表（用户定案）：
           - 调查中（VXSE51 阶段）：专攻破坏性极震区（>=8 度，小震保底 >=6 度）；
             首报同时调查 11、10（门槛 10），然后再调查 9，然后再调查 8（如汶川 [10, 9, 8]）
           - 地震情报（VXSE52 阶段）：展示 7 ~ 5 度
           - 正式报（VXSE53 阶段）：展示 5 以下（4、3、2 度） */
        var _cGrades = [];
        if (_maxLie >= 8) {
          var _top = Math.min(_maxLie, 10);
          for (var _g = _top; _g >= 8; _g--) _cGrades.push(_g);
        } else if (_maxLie >= 6) {
          for (var _g = _maxLie; _g >= 6; _g--) _cGrades.push(_g);
        } else {
          _cGrades.push(Math.max(2, _maxLie));
        }
        _gset = {};
        _cGrades.forEach(function (g) { _gset[g] = 1; });
      }
      var INQ_GRADES = Object.keys(_gset).map(Number).sort(function (a, b) { return b - a; });
      if (!INQ_GRADES.length) INQ_GRADES = (V.eew.metric === 'liedu') ? [10, 9, 8] : [70, 65, 60, 55, 50, 45, 4];
      /* ★★★ 2026-11-03 用户：「为什么你固定死了 2 个？我记得这个不是固定的啊」
         ⇒ 删掉原来的 `slice(0, 2)`。梯子**完全按这场地震实际出现过的震度档**来定：
           比如 M8.1 东京 = [7, 6強, 6弱, 5強, 5弱, 4] → 调查中一级一级铺 6 次；
           最大 5強 / 最低 5弱的震 → 只有 [55, 50] 两级。
           震度 3・2・1 仍然留到「各地震度情報」一次性写入（用户 2026-10-28 定过）。 */
      /* ★ 2026-10-25：批次/梯子必须在 **下一阶段之前 15 秒**铺完，
         否则「刚铺完就切去震源速報」= 用户说的「VXSE51 的阶段都没结束」。 */
      var _fill = Math.max(8000, _need - 15000);
      /* ★ 2026-10-26：中国烈度的梯子有 9~11 级（10→2），每级太慢会铺不完、
         太快又看不出「一圈一圈涨」。地板抬到 2.5 秒，上限 12 秒。 */
      var _gstep = _fill / Math.max(1, INQ_GRADES.length);
      if (_gstep < 2500) _gstep = 2500;
      if (_gstep > 12000) _gstep = 12000;
      V.eew.ipf = { t0: Date.now(), batch: 1, maxBatch: 5, stepMs: _fill / 5,
        grades: INQ_GRADES, gi: 0, gstepMs: _gstep };
      growIpf();
      /* ★★★ 2026-10-25 用户：「跳过阶段那个同心圆没跳过啊」
         —— 进「调查中」时波早就扫过去了，P/S 同心圆不该继续留在画面上
            （官方那张图只有行政区色块）。Enter 跳过也是走这里 → 一步到位：
            清掉同心圆，并把波前推到「全部测站已到达」（后面的 rebuildAreas /
            obsMaxShindo / autoFrame 都按这个算）。 */
      if (global.QVMapCam && QVMapCam.finishWave) QVMapCam.finishWave();
      /* ★ 必须立刻重算一次：否则卡片第一帧还是上一轮（inq 启用前）的 E.areas，
         实测：8.4s 那一帧把「石狩地方中部/島根県西部/十勝地方北部/香川県西部/岡山県北部」
         这些离震源最远、震度 0 的地方全列了出来。 */
      rebuildAreas(V.eew, (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0);                            /* ★ 启动逐步收敛：每 stepMs 多放一个行政区 */
      V._inqSeenMs = 0; V._inqVisFrom = null;   /* ★ 重置「调查中卡可见时长」计时 */
      /* ★ 2026-10-28：进入调查中 → 相机从「速报铺开」收回到实际震度分布 */
      try { autoFrame(V.eew, true); } catch (eAF2) { }
      V.eew.jishinAt = Date.now();          /* ★ 调查中最早什么时候能进正式报（下面 enterFinal 用） */
      V._simStage = 'jishin';
      /* ★★★ 2026-10-26 用户：「调查中的卡片到底去哪了？…我连他的音效都没听过」
         VXSE51（调查中卡片弹出音）只在 step 循环的 kind='info' 分支里叫，
         但 60 秒定时器一到（加速 25× 时只有 2.4 秒）kind 已经是 'jishin'，
         step 走 if(kind==='jishin') 直接进正式报 → info 分支永远不进。
         实测也印证：9 次播放里没有 3.94 秒（VXSE51）。⇒ 改在进 jishin 这一刻播。 */
      playSokuhoSe();
      /* ★ 2026-10-25 预置签名：进调查中这一声已经响过了，
         紧接着 bumpEEW 还会调一次 refreshInqCard —— 不去重就会连响两声 VXSE51。
         （用户听到的「刚响完又响一声」就是这里。） */
      _inqSig = inqSigOf(V.eew);
      _inqShotAt = Date.now();
      /* ★★★ 2026-10-26 用户：「海啸情报太慢了！应该要在“地震情报”就有海啸的初步结果」
         → 确认「就是震度速報阶段」。
         ⇒ 在**调查中（震度速報）入口**就安排发布初步结果（约 12 秒后 = 6 秒延迟 + 6 秒）。
           那时调查中卡已经展示过一阵、第一条震度速報也发过了，弹过去看 8 秒就回 Tab1，
           不会把调查中卡整个抢走（上一次被吐槽的就是「只看了 3 秒就被海啸弹出」）。
           升级警报（注意报→警报）在那之后按真实时间排队。 */
      simAux.push(setTimeout(function () {
        if (!V.eew || (!V.eew.inq && V.eew.kind !== 'jishin')) return;
        try { publishSimTsunami(8000, 0); } catch (ePS0) { }
      }, 6000));
      if (global.QVHist && QVHist.setCurrent && V.eew.q) QVHist.setCurrent(V.eew.q);
      /* ★★★ 调查中卡片画在 Tab1（view 0）的 #inqbox 上（render3 的 INQ_ON）；
         Tab2（view 1）的 drawEEW 始终画「紧急地震速报」卡（inq 那里锁死为 false）。 */
      /* ★★★ 2026-10-28 用户：「为什么进入到调查中了，面板竟然还会切回来紧急地震速报，
         连最基本的 15 秒都没过」
         —— 原来这里是 `flashView(0, 6000, 1)`：弹去 Tab1 看调查中卡，**6 秒后自动回到 Tab2 的 EEW**。
            上一任实现者把这当「看完就回去」，但调查中本身就是一张要看的卡。
         ⇒ 不再带回退目标：直接停在 Tab1，直到后面真进下一个阶段才切。
         ★ 2026-10-25 用户：「阶段都没结束，结果莫名其妙自动跳到了 Tab1」
         ⇒ 但**用户刚手动点过 Tab 时不能抢**（与 flashView 同一条 MANUAL_HOLD 规则），
            并清掉任何待执行的回退定时器，避免又被弹回去。
         ★ 2026-10-25 用户第三次定案：「弹到 Tab1 就别回来了，一直看到震源速报」
           ⇒ 不再区分报文是否发完，进调查中就直接停 Tab1。 */
      if (!(V._manualAt && Date.now() - V._manualAt < MANUAL_HOLD)) {
        /* ★★★ 2026-10-25 用户定案：「弹到 Tab1 就别回来了，一直看到震源速报」
           ⇒ 进调查中就直接停在 Tab1 的调查中卡上，不再回 Tab2。
           （之前试过「等报文发完才进调查中」和「弹 15 秒再回去」，用户都不要。）
           报文发完后 step 里还会再对齐一次 Tab1（防止这里被 MANUAL_HOLD 拦下）。 */
        if (V._flashTimer) { clearTimeout(V._flashTimer); V._flashTimer = 0; }
        V._flashBack = -1;
        try { setView(0); } catch (eSV0) { }
      }
      /* ★★★ 2026-10-25 真实样本（熊本 M7.1 / 青森 M7.5）实测：
         震度速報(調査中) 会发 **2～3 次**，每次只是「音效 + 地图扩大」，不显示报号。
           熊本：16:28:49「离震中非常近 震度4以上」→ 16:29:04「离震中近一些 震度3以上」
           青森：16:51/17:06/17:19 三次都是震度3以上，范围 非常近 → 附近 → 多数
         ⇒ 依次 15s / 35s 各更新一次。范围扩大靠【波前增长】自然实现，
           门槛只在第二次降一档（4以上 → 3以上）。
         ★★★ 2026-10-25 用户：「VXSE51 后立马 VXSE52，但 VXSE51 阶段都没结束」
           —— 这两次是**调查中阶段内部**的震度速報更新，音效必须是 VXSE51
              （=「调查中」卡片的弹出/更新音），绝不是 VXSE52（震源速報）。
              以前这里写的是 `QVSpeak.infoSe('info')` = VXSE52，于是进调查中才 5 秒
              就响 VXSE52，用户听到的就是「VXSE51 刚响完立马 VXSE52」。
           —— 另外 25× 加速时 15s/35s 都被 `Math.max(5000, …)` 夹成同一个 5 秒
              → 两声 VXSE52 还会叠在一起。现在保底按**真实秒**（调查中本身就有
              120 秒真实下限，15s/35s 一定落在阶段内部），两个时刻也永远不重合。 */
      if (!V.eew.inq2) {
        [[15000, 'inq2'], [35000, 'inq3']].forEach(function (pair) {
          eewTimers.push(setTimeout(function () {
            if (!V.eew || !V.eew.inq) return;
            V.eew.inq2 = 1;
            V.eew.fillStage = pair[1];
            try {
              rebuildAreas(V.eew, (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0);
            } catch (eI2) { }
            if (global.QVRedraw) QVRedraw();
            /* ★ 2026-10-25 用户：「调查中会凭空响几下」
               —— 这里以前无条件播 VXSE51。但这两次「震度速報更新」大多时候
                  地图一个区都没变化（fillStage 还被 rebuildAreas 改写成 none/all）
                  → 声音有了、画面没动 = 凭空响。
               ⇒ 交给 refreshInqCard：它按「看得见的内容」签名去重，真变了才响。 */
            refreshInqCard(V.eew);
          }, Math.max(pair[0], pair[0] / simSpd())));
        });
      }
      if (global.QVRedraw) QVRedraw();
      return true;
    }
    function enterFinal() {
      /* ★ 调试面板「暂停」时不要推进阶段（延后重试，恢复后继续） */
      if (global.__SIM_PAUSE) { eewTimers.push(setTimeout(enterFinal, 500)); return; }
      if (global.__TRACE_STAGE) console.log('[TR] enterFinal kind=' + (V.eew && V.eew.kind) +
        ' inq=' + !!(V.eew && V.eew.inq) + ' inqAt=' + (V.eew && V.eew.inqAt) +
        ' inqNeed=' + (V.eew && V.eew.inqNeed) + ' jishinAt=' + (V.eew && V.eew.jishinAt) +
        ' repDone=' + (V.eew && V.eew.repDone) + ' rep=' + (V.eew && V.eew.report));
      /* ★ 调查中是并行标志，kind 仍是 'eew' → 不能只认 'jishin' */
      if (!V.eew || (V.eew.kind !== 'jishin' && V.eew.kind !== 'eew' && V.eew.kind !== 'detect')) return;
      /* ★★★ 2026-10-28 用户：「震源速报第一次报的卡片不见了，调查中就直接转正式报了」
         —— 原来 enterFinal 一刀切：调查中直接 kind='final'，中间「震源速報」那一步没出现。
         ⇒ 拆成两段：调查中 →(本函数第 1 段)→ 震源速報 →(JISHIN_MS 后)→ 正式報。
           已经在震源速報时，前面的「调查中保底时长 / 可见时长」检查全部跳过。 */
      var alreadyJishin = (V.eew.kind === 'jishin');
      /* ★★★ 2026-10-28：「调查中」有 60 秒真实时间下限（见 enterJishin），
         但 waitPeak / 定时器会在这之前就调 enterFinal → 会**直接跨过调查中**
         （用户最在意的就是这张卡不能漏）。这里补一道：还没进过调查中就重排，不往前推。 */
      if (!alreadyJishin && !V.eew.inq) {
        if (enterJishin()) { /* 刚进去 → 稍后再来 */ }
        if (!V.eew.inq) {
          eewTimers.push(setTimeout(enterFinal, Math.max(800, 2000 / simSpd())));
          return;
        }
      }
      /* ★★★ 2026-10-25 用户：「没有进入到调查中阶段就直接进入到震源速报了」
         —— 以前「报完 + 峰值过去」后只隔 8 秒就推正式报，调查中那张卡
            刚出来就被顶掉（用户：「一闪就过去了」）。
         官方调查中至少要挂 20~30 秒（震源・規模「調査中」要先让人看到）。 */
      var jAt = +V.eew.inqAt || +V.eew.jishinAt || 0;
      /* ★ 2026-10-25 调查中阶段的兜底时长必须与 enterJishin 里设的 inqNeed 一致（120 秒）。
         以前兜底只有 25 秒（加速时 1 秒）：一旦 inqNeed 因任何原因没写进去，
         就会出现用户报的「VXSE51 后立马 VXSE52，调查中阶段都没结束」。 */
      var NEED = (+V.eew.inqNeed) || Math.max(120000, 120000 / Math.max(1, simSpd()));
      if (!alreadyJishin && jAt && !V.eew._skipNext && Date.now() - jAt < NEED) {
        eewTimers.push(setTimeout(enterFinal, NEED - (Date.now() - jAt)));
        return;
      }
      /* ★★★ 硬性前置：调查中卡片实际可见不足 3 秒 → 不许进入下一阶段。
         ★★★ 2026-10-26 用户：「这个应该只会针对调查中的这一个卡片，
             但现在似乎被带到了其他卡片身上」
           —— 实测 bug：这条例原来是无条件执行的。如果这场地震**根本没有「调查中」阶段**
              （jAt = 0，比如报文很少 / 直接走到震源情报），`_inqSeenMs` 永远是 0
              → 这里永远判「没看够 3 秒」→ 反复 flashView(0) 拉回 + 每 3.5 秒重试
              → 正式报（各地震度信息）永远出不来，整场地震卡死。
           ⇒ 只有**真的进过调查中**（jAt > 0）才做这个校验；
             其它卡片（EEW / 震源情报 / 各地震度信息）不受这条规则约束。
           ⚠️ 同理，「有新报才跳」那条在 bumpEEW 里已经用 `E.inq` 限定了，不要挪出去。
         ★ 2026-10-25：再加 `V.eew.repDone` —— 报文还没发完时**不允许**为了
           「凑满 3 秒可见」把用户从 Tab2 拉回 Tab1（那就是用户报的
           「EEW 阶段都没结束就跳到 Tab1」）。报文发完后这条校验照旧生效。 */
      if (!alreadyJishin && jAt && V.eew.repDone) {
        var _seen = (V._inqSeenMs || 0) + (V._inqVisFrom ? (Date.now() - V._inqVisFrom) : 0);
        var MIN_SEEN = 3000;
        if (_seen < MIN_SEEN) {
          try { flashView(0, Math.max(3200, MIN_SEEN - _seen + 800), 0); } catch (e9) { }
          eewTimers.push(setTimeout(enterFinal, Math.max(600, MIN_SEEN - _seen + 500)));
          return;
        }
      }
      /* ───── 第 1 段：调查中 → 震源速報（只报震度 4 及以上） ───── */
      if (!alreadyJishin) {
        if (global.__TRACE_STAGE) console.log('[TR] SEG1 → jishin');
        V.eew._skipNext = 0;                 /* 一次性放行标记用完就清（进震源速報） */
        V.eew.inq = false;
        V.eew.kind = 'jishin';
        V.eew.fillStage = 'jishin';
        V._simStage = 'jishin';
        V.eew.jishinAt = Date.now();
        /* ★ 2026-10-26：震源速報 = 震度已定稿 → 長周期階級锁死到终值
           （否则爬坡动画会停在 lgT-1 / lgT-2，用户看到 M9.9 只有階級 2） */
        V.eew.lgLock = 1;
        if (+V.eew.lgT > 0) V.eew.maxLg = +V.eew.lgT;
        /* ★ 2026-10-26：右下角「地図の色」图例是按 E.level 选造型的（hnrN）。
           跳阶段时 E.level 还停在首报的「震度4」→ 图例只画 4/3/2/1，
           而地图已经铺到震度7（用户截图：卡片写7、图例最高才 6弱）。
           ⇒ 震度情报阶段用**实测最大震度**把 E.level 顶上去。 */
        try {
          var _lvlJ = obsMaxShindo(V.eew);
          if (_lvlJ > (+V.eew.level || 0)) V.eew.level = _lvlJ;
        } catch (eLvlJ) { }
        V._cardAt = Date.now();                /* 卡片换了内容 → 重置「无变化」计时 */
        try {
          rebuildAreas(V.eew, (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0);
        } catch (e2j) { }
        try { autoFrame(V.eew); } catch (e4a) { }
        if (global.QVRedraw) QVRedraw();
        if (global.QVSpeak && QVSpeak.infoSe) QVSpeak.infoSe('info');   /* VXSE52：震源速報 */
        flashView(0, 12000);
        var JISHIN_MS = Math.max(8000, 14000 / simSpd());
        V.eew.jishinMs = JISHIN_MS;            /* ★ 第 2 段的幂等闸门要用它 */
        V.simEtaMs = Date.now() + JISHIN_MS;   /* 下一阶段（正式报）预计时刻 */
        /* ★★★ 2026-10-25 真实样本：震度速報 会连发 **2～4 次**
           （青森 23:18:19 / 18:59 / 20:05 / 25:44），每次只是「音效 + 地图扩大」，
           卡片不显示报号。这里在本阶段内再补两次静默更新。 */
        [0.4, 0.75].forEach(function (f) {
          eewTimers.push(setTimeout(function () {
            if (!V.eew || V.eew.kind !== 'jishin') return;
            try {
              rebuildAreas(V.eew, (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0);
            } catch (eJs) { }
            if (global.QVRedraw) QVRedraw();
            /* ★ 2026-10-25：这里以前会再播一遍 VXSE52 音效 —— 地图其实没变，纯噪音，已删。 */
          }, Math.max(2000, JISHIN_MS * f)));
        });
        eewTimers.push(setTimeout(enterFinal, JISHIN_MS));
        return;
      }

      /* ───── 第 2 段：震源速報 → 正式報（把 3/2/1 补上收尾） ───── */
      /* ★★★ 2026-10-25 修：
         进入震源速報（第 1 段）之后，waitPeak 还在跑，它 2 秒后又会调一次 enterFinal；
         而第 2 段以前**没有闸门**（已 alreadyJishin 时直接往下走）→
         震源速報卡刚出来就被正式报顶掉（用户：「VXSE51 后立马就 VXSE52，阶段都没结束」）。
         ⇒ 必须等满 jishinMs（真实时长）才允许进正式报，否则重排。 */
      if (alreadyJishin) {
        var _jms = +V.eew.jishinMs || Math.max(8000, 14000 / simSpd());
        var _jAt = +V.eew.jishinAt || 0;
        if (_jAt && !V.eew._skipNext && Date.now() - _jAt < _jms) {
          eewTimers.push(setTimeout(enterFinal, _jms - (Date.now() - _jAt)));
          return;
        }
      }
      if (global.__TRACE_STAGE) console.log('[TR] SEG2 → final');
      V.eew._skipNext = 0;                     /* 一次性放行标记用完就清 */
      V.eew.inq = false;                       /* 脱离调查中 → 进第一次震源情报 */
      V.eew.kind = 'final';
      V.eew.fillStage = 'final';
      V._simStage = 'final';
      /* ★ 2026-10-26：正式报 = 确定值 → 長周期階級也必须锁死（同震源速報处的说明） */
      V.eew.lgLock = 1;
      if (+V.eew.lgT > 0) V.eew.maxLg = +V.eew.lgT;
      /* ★ 2026-10-26：正式报的 E.level 必须是实测最大震度（图例选 hnrN 用），
         否则跳阶段时它还停在首报的震度4 → 图例只有 4/3/2/1。 */
      try {
        var _lvlF = obsMaxShindo(V.eew);
        if (_lvlF > (+V.eew.level || 0)) V.eew.level = _lvlF;
      } catch (eLvlF) { }
      /* ★★★ 2026-10-28 用户：「跳动是正常的（EEW 阶段），我说的是最终正式报的时候」
         ⇒ 正式报 = **确定值**：M / 深度直接冻结在真值上，之后任何抖动逻辑都不再改它。
            （bumpEEW 里也有 E.frozen 判断，双保险。） */
      V.eew.frozen = 1;
      V.simEtaMs = 0;                          /* 正式报 = 最后一个阶段 */
      if (V.eew.magT != null && isFinite(V.eew.magT)) V.eew.mag = V.eew.magT;
      if (V.eew.depT != null && isFinite(V.eew.depT)) V.eew.depth = V.eew.depT;
      V._cardAt = Date.now();                  /* 卡片换了内容 → 重置「无变化」计时 */
      /* ★ 2026-10-26 用户：「震度 4 以下的限制被带到了所有界面」
         rebuildAreas 只在「来新报 / IPF 放行一批」时跑，进正式报时不跑
         → 地图上一直留着 EEW 阶段那种「只画 ≥4」的旧色块（震度 1~3 的区永远不出现）。
         这里补一次，让正式报立刻按「全等级」重画。 */
      try {
        rebuildAreas(V.eew, (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0);
      } catch (e2f) { }
      try { autoFrame(V.eew); } catch (e4b) { }
      if (global.QVRedraw) QVRedraw();
      if (V._flashTimer) { clearTimeout(V._flashTimer); V._flashTimer = 0; }
      V._flashBack = -1;
      setView(0);                              /* 正式报：直接切到「各地震度信息」（Tab1），不再回退到 EEW */
      /* ★ 模拟专用：正式报发布后，让 P/S 波前在一段宽限内把受灾范围画满，然后冻结
         （停在最大半径，不再继续外扩）—— 对应「发布最终报后波前不应继续走」。 */
      try {
        var _wg = Math.max(10000, 22000 / simSpd());
        eewTimers.push(setTimeout(function () {
          if (global.QVMapCam && QVMapCam.freezeSimWave) QVMapCam.freezeSimWave(0);
        }, _wg));
      } catch (eFs) { }
      /* ★★★ 2026-10-26 海啸发布已经**提前到震度速報（调查中）阶段**（见 publishSimTsunami）。
         这里只做兜底：万一这场地震根本没进过调查中（深源小震直跳正式报等），
         到正式报才补发一次，且只弹 12 秒不抢太久。 */
      try { publishSimTsunami(12000, -1); } catch (ePS1) { }
      if (global.QVSpeak && QVSpeak.infoSe) QVSpeak.infoSe('final'); /* VXSE53 */
      /* ★★★ 2026-10-25 用户澄清：「**震度速報** 和 **各地の震度情報** 的后续更新
         只会有【音效 + 地图更新】，不会有 #1、#2 这种报号。」
         ⇒ 不新增带编号的阶段；真实熊本的各地震度情報共 3 次
           （16:31:48、16:35:30 ×2），后两次就是这种「静默更新」。
           这里补两次：重画地图 + 播 VXSE53 音，不碰报号。 */
      (function () {
        [60000, 240000].forEach(function (ms) {
          eewTimers.push(setTimeout(function () {
            if (!V.eew || V.eew.kind !== 'final') return;
            try {
              rebuildAreas(V.eew, (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0);
            } catch (eUp) { }
            if (global.QVRedraw) QVRedraw();
            /* ★ 2026-10-25：这两次「静默更新」以前会再播两遍 VXSE53 —— 地图没变，已删音效。 */
          }, Math.max(8000, ms / simSpd())));
        });
      })();
    }
    /* ★★★ 2026-10-26 用户：「我手动跳过了部分阶段，但是海啸的时间没有被缩小」
       ⇒ 两件事：
         ① 跳阶段必须把**模拟时钟**一起往前推（`simAdvance`），否则「现在」没变，
            海啸的剩余时间自然一点也不会缩；
         ② 已经发布过的海啸表要按新的「现在」**重算一次**（`simTsuRefresh`）：
            绝对到达时刻 = 地震发生时刻 + 传播时间（不变），但「还差多久」变短，
            已经该到的区域自动改成「津波到達中と推測」。
       注意：只推进模拟时间，不改物理传播计算。 */
    function simAdvance(ms) {
      var E = V.eew;
      if (!E || !(ms > 0)) return;
      var spd = Math.max(1e-6, simSpd());
      /* 时钟 = E.timeMs + (Date.now() − simT0) × spd → 想让它前进 ms，就把 simT0 往前挪 ms/spd */
      E.simT0 = (+E.simT0 || Date.now()) - ms / spd;
    }
    function simTsuRefresh() {
      var q = V._tsuSrcQ;
      if (!q || !V._tsuShown) return;
      if (!global.QData || !QData.simTsunami) return;
      try {
        /* ★ 阶段化之后：重算整条阶段链，并把**当前阶段**重新发布一次
           （时间基准变了 → 到达予想/到達中要跟着变，但阶段内容不能倒退） */
        if (V._tsuStages && V._tsuStages.length) {
          var stg = simTsuStages(q);
          if (stg && stg.length) {
            V._tsuStages = stg;
            var i = Math.min(V._tsuStage | 0, stg.length - 1);
            var o2 = _tsuClone(stg[i].obj);
            if (o2) {
              o2.atMs = simNowMs();
              QData.simTsunami(o2);
              if (global.QVRedraw) QVRedraw();
            }
          }
          return;
        }
        var o = simMakeTsunami(q, { initial: V._tsuInitial });
        if (!o || !o.items || !o.items.length) return;
        QData.simTsunami(o);
        if (global.QVRedraw) QVRedraw();
      } catch (eTR) { }
    }
    /* ★★★ 2026-10-25 用户：「做一个快捷跳过的按钮阶段方式…模拟过程中按一下回车就跳一个阶段」
       —— 每按一次走一步：
            EEW / 检测态 → 立刻停报文循环并进「调查中」
            调查中       → 色块梯子再降一级（亮下一档）；降到最低档后再按 → 震源速報
            震源速報     → 各地震度情報
            各地震度情報 → 没有下一阶段了
       只能写在这里：enterJishin / enterFinal 是 setEEW 内部的闭包，外面拿不到。
       只在模拟中（V.simOn）生效；真实电文由 JMA 自己的报文推进，不给跳过。 */
    V.__skipStage = function skipStage() {
      var E = V.eew;
      if (!E || !V.simOn || E.kind === 'cancel') return false;
      var _wv = (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0;
      /* ★★★ 2026-10-28 实测：1.7 秒内连按 10 次回车 →
         调查中 / 震源速報 / 各地震度情報 全部在 1 秒内闪完（
         每按一次就多排一条 enterFinal 链，链子打架、互相伪造时间戳）。
         观感就是「中后期什么都没有」。
       ⇒ 节流：900ms 内只接受一次「跳一步」。 */
      var _nowSk = Date.now();
      if (_nowSk - (V._skipAt || 0) < 900) return false;
      V._skipAt = _nowSk;

      /* ① EEW / 检测态 → 结束报文循环，进调查中 */
      if ((E.kind === 'eew' || E.kind === 'detect') && !E.inq) {
        E.skipLoop = 1;                       /* step 的定时器看到就直接停，不再发报 */
        E.repDone = 1;
        E.simT0 = Date.now() - 100000;        /* 绕开「距首报 90 秒」门槛 */
        var _dm = +E.distMax || 0;
        E.distMax = 0;                        /* 绕开「波前必须扫过最远测站」门槛 */
        var ok1 = enterJishin();
        E.distMax = _dm;
        if (!ok1) return false;
        /* 正常流程里 enterFinal 是 waitPeak 排的；这里循环已经停了 → 自己接上 */
        eewTimers.push(setTimeout(enterFinal, 600));
        try { simTsuRefresh(); } catch (eTR1) { }
        return true;
      }

      /* ② 调查中：先把等级梯子一档一档铺完 */
      if (E.inq) {
        var gl = (E.ipf && E.ipf.grades) || [];
        var gi = (E.ipf && E.ipf.gi) || 0;
        if (gl.length && gi < gl.length - 1) {
          E.ipf.gi = gi + 1;
          E.ipf.batch = Math.min(E.ipf.maxBatch || 5, (E.ipf.batch || 1) + 1);
          /* 每档算「过了 gstepMs」→ 模拟时钟同步前进，海啸剩余时间跟着缩 */
          simAdvance(+E.ipf.gstepMs || 10000);
          try { rebuildAreas(E, _wv); } catch (eRS) { }
          if (global.QVRedraw) QVRedraw();
          refreshInqCard(E);                  /* 签名去重：真变了才响 VXSE51 */
          try { autoFrame(E, true); } catch (eAFs) { }
          try { simTsuRefresh(); } catch (eTR2) { }
          return true;
        }
        /* ③ 色块都铺完了 → 震源速報
           ★ 2026-10-28：以前这里把 inqAt / jishinAt 改成 `Date.now()−200000`（伪造「已经过了 200 秒」）
             来绕开 enterFinal 的 120 秒闸门。副作用：这两个时间戳被**永久改写**，
             之后所有链子的保险闸全部失效 → 阶段可以瞬间连跳。
           ⇒ 改成一次性放行标记 `_skipNext`，enterFinal 用完就清掉，保险闸保持不变。 */
        E._skipNext = 1;
        V._inqSeenMs = 99999;                 /* 绕开「调查中卡至少可见 3 秒」 */
        /* ★ 2026-10-26 用户选 B：「跟模拟时钟一起跳过」——
           跳过整个阶段 = 这一阶段本该占用的时间全部过去（调查中剩多少就过多少），
           于是海啸表里已经该到的沿岸区域会自动变成「津波到達中と推測」。 */
        try {
          var _ipf0 = E.ipf || {};
          var _el0 = Math.max(0, Date.now() - (+_ipf0.t0 || Date.now()));
          var _rem0 = Math.max(0, (+E.inqNeed || 120000) - _el0);
          if (_rem0 > 0) simAdvance(_rem0);
        } catch (eRem) { }
        try { simTsuRefresh(); } catch (eTR3) { }
        enterFinal();
        return true;
      }

      /* ④ 震源速報 → 各地震度情報 */
      if (E.kind === 'jishin') {
        E._skipNext = 1;                      /* 一次性放行 jishinMs 停留门槛 */
        simAdvance(+E.jishinMs || Math.max(8000, 14000 / Math.max(1, simSpd())));
        try { simTsuRefresh(); } catch (eTR4) { }
        enterFinal();
        return true;
      }

      /* ★★★ 2026-10-26 用户：「海啸你没做成阶段啊，我跳到正式报就提示完成了」
         ⇒ 海啸自己也有 9 个阶段（预警 → 追加 → 第1波 → 第2波 → 陆续到达 →
           解除部分×3 → 全部解除）。**地震阶段全部走完之后**，回车改为推进海啸阶段。
         ⚠️ 必须限定 `E.kind === 'final'`：海啸在调查中就会发布，
            否则在调查中按回车会被海啸抢走，地震阶段反而跳不动。 */
      if (E.kind === 'final' && V._tsuStages && (V._tsuStage | 0) < V._tsuStages.length - 1) {
        /* 每个海啸阶段按真实时间线推进模拟时钟（前面的到达类走几分钟，解除类走几十分钟） */
        var _stN = V._tsuStage | 0;
        simAdvance(_stN < 4 ? 180000 : 1800000);
        if (simTsuNext(true)) return true;      /* silent：回车跳阶段不出提示 */
      }

      return false;
    };

    /* ★ 官方：约 1 分钟后进调查中，速报继续更新（不打断 step 循环）
       ⚠️ 不能写成 `if (kind === 'eew')` —— 首报常常是 detect 态，那样定时器根本不会安排。 */
    /* ★★★ 2026-10-26 用户：「调查中的卡片根本没看到」「还是没有第三段音」
       → 原来是 60000/simSpd()：不开加速就要等整整 60 秒才进调查中，
         用户根本等不到就以为没实现。改 25 秒（仍在官方「约 1 分钟」量级），
         加速时保底 6 秒，避免 25× 下变成 1 秒。 */
    /* ★ 2026-10-28：定时器只是「候选时机」，enterJishin 内部还有波前门槛。
       被门槛拦下就每 1s 重试一次 —— 波前一扫过最远测站就立刻进调查中，
       不会因为「只安排了一次定时器」而错过。 */
    eewTimers.push(setTimeout(function retryInq() {
      if (enterJishin()) return;
      if (V.eew && (V.eew.kind === 'eew' || V.eew.kind === 'detect') && !V.eew.inq) {
        eewTimers.push(setTimeout(retryInq, Math.max(400, 1000 / simSpd())));
      }
    }, Math.max(6000, 25000 / simSpd())));

    /* ★★★ 2026-10-28 用户：「观测烈度的显示是不是有 bug，到一定程度就不更新了」
       —— 不是渲染坏了：观测列表只在**来新报**时（bumpEEW → rebuildAreas）重算，
          而报文进心跳期后是 13~21 秒一报，这期间波前一直在往外跑（P 波扫到新区），
          列表却一动不动 = 用户看到的「到一定程度就不更新」。
       ⇒ EEW / 检测阶段加一个 1 秒的轻量刷新：只重算观测列表 + 重绘，
          不动报号、不响音效判据（detSfxScan 自身有档位去重）。
          调查中之后由等级梯子驱动，这里直接不跑。 */
    if (V._obsTick) { clearInterval(V._obsTick); V._obsTick = 0; }
    V._obsTick = setInterval(function () {
      var E = V.eew;
      if (!E) { clearInterval(V._obsTick); V._obsTick = 0; return; }
      if (E.inq || (E.kind !== 'eew' && E.kind !== 'detect')) return;
      try {
        rebuildAreas(E, (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0);
      } catch (eOT) { }
      if (global.QVRedraw) QVRedraw();
    }, 1000);
    (function step(n) {
      /* ★★★ 2026-10-26 实测：加速 25× 时报文 8 秒全部发完（已到 #54）调查中才进入，
         之后再没有新报 → 「EEW 有更新」这个条件永远不成立 → Tab1/Tab2 不可能交替。
         用户原话：「调查中在报文发到中后期就要开始」。所以报文过半就进调查中，
         后半段报文会不断把视图弹回 Tab2。 */
      if (n >= Math.ceil(plan * 0.85) && V.eew && !V.eew.inq) enterJishin();
      if (n > plan) {
        /* ★★★ 2026-10-25 报文循环到此结束（这次 step 调用已经不再发报）。 */
        if (V.eew) V.eew.repDone = 1;
        /* ★ 2026-10-25 调查中已经在跑 → 报文发完了，再对齐一次 Tab1
           （进入调查中那一刻如果被 MANUAL_HOLD 拦下没切成，这里补上）。
           用户刚手动点过 Tab 时不抢（同一条 MANUAL_HOLD 规则）。 */
        if (V.eew && V.eew.inq && !(V._manualAt && Date.now() - V._manualAt < MANUAL_HOLD)) {
          if (V._flashTimer) { clearTimeout(V._flashTimer); V._flashTimer = 0; }
          V._flashBack = -1;
          try { setView(0); } catch (eRDi) { }
        }
        /* ★★★ 2026-10-21 用户：「等震中最大峰值过后，就应该改成调查中的卡片了」
           —— 以前是「最后一报 + 固定 8 秒」，不管震级大小一刀切，小震拖、大震早。
           现在按峰值判定（每 0.5s 看一次）：
             ① 波前（P 波公里数）跑到【最远有声测站的 1.8 倍震源距】
                ≈ S 波已扫完全部测站 → 震中峰值确实过去了；
             ② 拿不到测站距离 / 没开波圈时，退回「按规模算的兜底秒数」
                （plan×400ms，夹在 6~14 秒）。
           ⇒ 小震快、大震慢，跟「摇晃真的停了」对齐。 */
        V.eew.lastRepAt = Date.now();
        var waited = 0;
        var fallbackMs = Math.min(14000, Math.max(6000, (plan | 0) * 400));
        (function waitPeak() {
          eewTimers.push(setTimeout(function () {
            /* ★ 2026-10-22：已经进「调查中」（jishin）也要继续等峰值 →
               峰值过后才能推正式报；只有 info/final/cancel 才该在这里退出。 */
            if (!V.eew || (V.eew.kind !== 'eew' && V.eew.kind !== 'jishin')) return;
            /* ★★★ 2026-10-25 已进「震源速報」→ 后续推进交给第 1 段的 JISHIN_MS 定时器。
               waitPeak 以前在 jishin 阶段还会继续循环并再次调 enterFinal，
               导致第 2 段被提前执行（震源速報一闪而过）。 */
            if (V.eew.kind === 'jishin') return;
            /* ★ 2026-10-27 调试面板「暂停」：不要累加等待时间，也不能让这条链断掉
               （以前暂停期间 waited 照涨 → 恢复后瞬间越线 → 看起来「阶段乱跳/不跳」） */
            if (global.__SIM_PAUSE) return waitPeak();
            waited += 500 * simSpd();
            var pk = (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0;
            var distAll = +V.eew.distMax || 0;
            /* ★★★ 2026-10-28 用户：「先把 S 波都没走完就进调查中修一下」
               —— 这里原来用 P 波的 1.8 倍判「峰值过去了」，其实 S 波才走了 0.9 倍。
               ⇒ 有秒数时用 **S 波**走到的震央距 ≥ 最远测站；拿不到才退回 P 波判据。 */
            var byWave = false;
            try {
              var _ws2 = (global.QVMapCam && QVMapCam.waveSec) ? +QVMapCam.waveSec() : 0;
              var _s2 = (_ws2 > 0 && global.QVMapCam && QVMapCam.jma2001Dist)
                ? +QVMapCam.jma2001Dist(_ws2, +V.eew.depth || 10, false) || 0 : 0;
              if (distAll > 0 && _s2 > 0) byWave = (_s2 >= distAll);
            } catch (eBW) { byWave = false; }
            if (!byWave) byWave = (distAll > 0 && pk > 0 && pk >= distAll * 1.8);
            if (!byWave && waited < fallbackMs) return waitPeak();   /* 还没过去，继续等 */
            /* ★ 2026-10-22：60 秒定时器已经把卡片推进「调查中」→ 峰值过后直接出正式报，
               不要再退回 info（旧逻辑要求 kind==='eew'，会把这条链卡死在 jishin）。 */
            /* ★★★ 2026-10-26 用户：「收到测站数据到一定数量时」就开始调查中。
               报文发完 ≈ 测站数据收齐 → 这一刻立刻点亮调查中标志（并行，不顶 EEW 卡），
               不再等 60/25 秒那个固定定时器（那个只作兜底）。
               下面 kind='info' 那整段是旧的串行写法，现在走不到了（保留代码不删，避免括号错位）。 */
            if (true) {
              if (!V.eew.inq) enterJishin();
              eewTimers.push(setTimeout(enterFinal, 2000 / simSpd()));
              return;
            }
            V.eew.kind = 'info';
            V.eew.fillStage = 'all';
            playSokuhoSe();                       /* VXSE51：调查中 */
            if (global.QVRedraw) QVRedraw();
            /* ★★★ 2026-10-21 用户：「我的震度情报为什么会在 Tab 4 页？？？
               其实回到第一个页面的详细栏，基本上就不需要重新做卡片了，
               唯一的不同就是标题栏不同而已，其他都是一样的 1 页面那些卡片，我们早就做了」
               ⇒ Tab 编号 = view + 1（view0=Tab1 详细栏 / view1=Tab2 实时页 /
                 view2=Tab3 海啸 / view3=Tab4 设置）。之前我写的 setView(3) 其实是 Tab4，大错。
               ⇒ 震源情報 / 各地の震度情報 回【view 0】（Tab1 详细栏），
                 用 render3 早就画好的卡片，不再自己拼 paIbg172 那张。
                 下一轮只需在 render3 里把标题栏换成「ⓘ 震度速報」。 */
            eewTimers.push(setTimeout(function () {
              if (!V.eew || V.eew.kind !== 'info') return;
              /* ★ 用户：「不需要重新做卡片，唯一的不同就是标题栏不同，其他都是一样的
                 1 页面那些卡片我们早就做了」
                 ⇒ 不回 Tab4（view3），回 Tab1 详细栏（view0），由 render3 那张现成卡片接手；
                   V.eew 保留（kind='jishin'）——render3 靠它把标题换成「震度速報」，
                   实时页（view1）的 drawEEW 遇到 jishin 直接隐藏不画。 */
              V.eew.kind = 'jishin';
              V._simStage = 'jishin';
              if (global.QVSpeak && QVSpeak.infoSe) QVSpeak.infoSe('info');   /* VXSE52 */
              /* ★ 2026-10-22 用户：「实际地震在调查中的第一次震源情报就可能已经有海啸注意报了」
                 ⇒ 震源情報阶段先发一版【海啸注意报】初报（只取最近的沿岸区域）。 */
              if (V._simTsuPlan && !V._simTsuInit) {
                V._simTsuInit = 1;
                var pp0 = V._simTsuPlan;
                simAux.push(setTimeout(function () {
                  if (!global.QData || !QData.simTsunami) return;
                  var o0 = simMakeTsunami(pp0.q, { initial: true });
                  QData.simTsunami(o0);
                  if (global.QVRedraw) QVRedraw();
                  toast('海啸注意报（模拟·调查中）：' + o0.items.length + ' 个沿岸区域');
                }, 3000 / simSpd()));
              }
              /* ★ 关键：把这场地震顶成主卡。模拟地震是 inject 进 QData 的，
                 下一次 refresh 就会把它冲掉 → 不顶的话 Tab1 显示的是真实那条地震。 */
              if (global.QVHist && QVHist.setCurrent && V.eew.q) QVHist.setCurrent(V.eew.q);
              flashView(0, 12000);                       /* ← 跳到 Tab1 详细栏 12 秒后弹回原页 */
              if (global.QVRedraw) QVRedraw();
              eewTimers.push(setTimeout(function () {
                /* ★★ 2026-11-02 用户：「地震情报后的正式报标题出不来，也就是各地烈度信息」
                  以前这里只播 VXSE53 音效，kind 不变 → 卡片永远停在「震度速報」，
                  paItiChii / paBkgChii（各地の震度情報）定义了却从来没被用过。
                  ⇒ VXSE53 同时把 kind 推到 final，render3 换成「各地震度信息」标题，
                    地图填色也在这个阶段扩到【全部有震度的地区】（见 cnFill 的 stage 参数）。 */
                if (V.eew && V.eew.kind === 'jishin') {
                  V.eew.kind = 'final';
                  V.eew.fillStage = 'final';
                  V._simStage = 'final';
                  if (global.QVRedraw) QVRedraw();
                  /* ★★ 2026-10-22 用户：「海啸预警不应该是地震震完之后、调查出结果才会弹出来吗」
                     ⇒ 海啸情报挂在正式报（各地震度情報）之后 5 秒发布。 */
                  if (V._simTsuPlan && !V._simTsuSent) {
                    V._simTsuSent = 1;
                    var pp = V._simTsuPlan; V._simTsuPlan = null;
                    simAux.push(setTimeout(function () {
                      if (!global.QData || !QData.simTsunami) return;
                      var obj = simMakeTsunami(pp.q);
                      QData.simTsunami(obj);
                      if (global.QVHist && QVHist.setCurrent) QVHist.setCurrent(pp.q);
                      if (global.QVRedraw) QVRedraw();
                      toast('海啸' + (obj.maxLv >= 3 ? '警报' : '注意报') + '（模拟）：' +
                        obj.items.length + ' 个沿岸区域' +
                        (pp.terr.inLand ? (' · 距海岸 ' + Math.round(pp.terr.coastKm) + ' km') : ' · 震源在海域'));
                    }, 5000 / simSpd()));
                  }
                }
                if (global.QVSpeak && QVSpeak.infoSe) QVSpeak.infoSe('final'); /* VXSE53 */
              }, 8000 / simSpd()));
            }, 8000));
          }, 500));
        })();
        return;
      }
      eewTimers.push(setTimeout(function () {
        if (!V.eew) return;
        /* ★ 2026-10-25：Enter 跳过 EEW 时会把 skipLoop 置 1 → 报文循环立刻停 */
        if (V.eew.skipLoop) return;
        /* ★★★ 2026-10-28「不发报」档：用户实测 M8.0 仍然发了报 —— 因为以前这里
           还会先跑一次 bumpEEW，而 M8.0 第一报的观测震度直接过阈值 →
           检测态被升级成 EEW。⇒ 不发报档**连 bumpEEW 都不调**，
           只停在「检测到摇晃」，直接当报文已发完往下走。 */
        if (simRate === 0) { step(plan + 1); return; }
        bumpEEW(n);
        step(n + 1);
      }, reportGap(n, plan) / simSpd()));
    })(2);
  }
  /** ★★★ 2026-10-28 用户：「卡片上显示的震度，不是看模拟的那个测站吗，现实中也是，
   *   想要达到震度7的条件，就是两个测站达到7就算了」
   *   ⇒ 卡片最大震度 = **波前已扫过的测站里观测到的最大值**（不再按报文阶梯硬爬）。
   *      并且震度7 要求 **≥2 个测站** 达到 7，只有 1 个就按 6強 报。
   *   备注：真实付费电文（VXSE51/53）仍以官方值覆盖（applyMeasured）。 */
  var J7_NEED = 2;                      /* 震度7 所需的最少测站数 */
  function obsMaxShindo(E) {
    if (!E) return 0;
    var w = (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0;
    var list = E.obs || [], best = 0, n7 = 0;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      /* ★ 2026-10-25：波前（wavePkm）是**震央距**，这里必须比 epi —— 用 hyp 会让
         深源地震的所有测站一开始就被算作「波已到达」，卡片直接顶到最终震度。 */
      if (w > 0 && ((o.epi != null ? +o.epi : (+o.hyp || 0))) > w) continue;
      var v = +o.shindo || 0;
      if (v >= 70) n7++;
      if (v > best) best = v;
    }
    if (best >= 70 && n7 < J7_NEED) best = 65;        /* 1 个站 7 → 按 6強 */
    return best;
  }
  /** ★★★ 2026-10-28 用户：「我们什么时候将摄像机自动缩放？
   *   1. 紧急地震速报时，先聚焦
   *   2. 根据测站做缩小
   *   3. 根据地图填充时的色块作缩小」
   *   ⇒ 自动取景：把「震中 + 已点亮测站 + 已填色的行政区」的并集套进画面。
   *      QVMapCam.frame() 内部保证「只缩小不放大 + 用户手动动过就不抢」。
   */
  /** ★★★ 2026-10-27 相机「标本」表
   *  —— 用户在 ?camdebug=1 面板上对着官方录像调出来的值。
   *     用户原话：「我打的那个点，只是代表那一个阶段呈现的效果，
   *                而不是必须到我打的那个点才切，我哪有心思搞零误差」
   *  ⇒ **一个阶段一个固定倍率**，阶段内不动；只有阶段切换（或调查中色块铺开）才换。
   *     官方本来也是这样（EEW 全程一个倍率，换阶段才换）。
   *     要调：直接改下面这几个数字。
   *
   *      检测（揺れを検出）    1.60   ← 实测点 1.59
   *      紧急地震速报 EEW      1.08   ← 实测点 1.08
   *      調査中                 1.27   ← 实测点 1.27
   *      震源速報                 1.15   （没单独打点，取中间值）
   *      各地震度情報（正式報）   0.99   ← 实测点 0.99
   *
   *  ★ 2026-10-27 用户：「我打的那个点代表的是阶段，不是时间」
   *     → 调查中**不再**按色块数量在 1.60↔1.27 之间变，一档一个数，阶段内绝不变化。
   */
  var CAM_K = { detect: 1.60, eew: 1.08, inq: 1.27, jishin: 1.15, final: 0.99 };
  function frameTargetK(E, stage) {
    if (!E) return CAM_K.eew;
    /* 正式報 / 各地震度情報 */
    if (stage === 'final' || stage === 'info') return CAM_K.final;
    /* 调查中 / 震源速報 */
    if (E.inq) {
      if (E.kind === 'jishin' || E.kind === 'final') return CAM_K.jishin;
      return CAM_K.inq;
    }
    if (stage === 'detect') return CAM_K.detect;
    /* ★ 2026-10-27 autoFrame 传进来的 stage 把 detect 归一成了 'eew'，
       所以还要看 E.kind，否则检测态会被当成 EEW（k=1.08 而不是 1.60）。 */
    if (E.kind === 'detect') return CAM_K.detect;
    return CAM_K.eew;
  }
  /** ★ 2026-10-27 「目标 k + 震中居中」移动镜头。
   *  横屏时（地图铺满、左侧卡片浮在上面）中心要往左补半栏 —— 和 QVMapCam.frame()
   *  里那条中心补偿完全一致，否则定好的震中会偏到一边（用户：「为什么还是偏移了」）。 */
  function camMoveK(lat, lon, k) {
    if (!global.QVMapCam || !QVMapCam.requestMove) return false;
    var lon2 = +lon;
    try {
      var _vis = (QVMapCam.debug() || {}).vis;
      if (_vis && _vis.x0 < 1) lon2 = (+lon) - 122 / (100 * (+k || 1));
    } catch (e) { }
    return QVMapCam.requestMove(+lat, lon2, +k);
  }
  /** ★★★ 2026-10-25 用户：「只要有一个测站在响了，地图就会过去，然后根据这个测站的
   *   震度大小来显示不同颜色的红框」
   *   ⇒ 检测态专用取景：把镜头拉到【已摇晃测站】的包围圈，而不是死盯震中。
   *   · 只往外放（不来回缩），否则每报都会「缩放一下」
   *   · 500ms 节流，避免每帧重算
   *   · 单站时给 60km 半径，让那一个框在屏幕上明显可见 */
  function detFrame(E) {
    if (!E || !global.QVMapCam || !QVMapCam.fitCircle) return;
    /* 调试面板（js/cam-debug.js）锁定镜头时，自动取景全部让路 */
    if (global.__CAM_FREEZE) return;
    /* ★★★ 2026-10-25 用户：「地图缩放出问题了，在方框出现的时候我点击放大
       有概率到其他国家」
       ⇒ 真因：以前每 500ms 就 fitCircle 一次，跟你手动缩放抢镜头。
         改成【同一事件只自动取景一次】，之后镜头完全交给你。 */
    if (V._detFrmDone === E) return;
    var now = Date.now();
    if (now - (V._detFrmAt || 0) < 500) return;
    var wkm = QVMapCam.wavePkm ? QVMapCam.wavePkm() : 0;
    /* ★ 2026-10-25：镜头取景也跟着改用震央距；深源时 `dep+20` 的假波前会把整片关东
       都算成「已摇」，镜头一下拉得太远。只有真的没波前时才退回深度兜底。 */
    var lim = wkm > 0 ? wkm : ((+E.depth || 0) + 20);
    var src = (E.obs && E.obs.det) ? E.obs.det : [];
    var n = 0, sLat = 0, sLon = 0;
    var lat0 = 90, lat1 = -90, lon0 = 180, lon1 = -180;
    for (var i = 0; i < src.length; i++) {
      var o = src[i];
      if (((o.epi != null ? +o.epi : (+o.hyp || 0))) > lim) continue;
      if (!isFinite(o.lat) || !isFinite(o.lon)) continue;
      n++; sLat += +o.lat; sLon += +o.lon;
      if (+o.lat < lat0) lat0 = +o.lat; if (+o.lat > lat1) lat1 = +o.lat;
      if (+o.lon < lon0) lon0 = +o.lon; if (+o.lon > lon1) lon1 = +o.lon;
    }
    if (!n) return;
    V._detFrmAt = now;
    sLat /= n; sLon /= n;
    /* ★★★ 2026-10-27：不再按「测站包围圈」硬算半径（那样单站时 k=3.4，
       比官方近一倍多）。改用标本里的检测态目标 k≈1.60，中心仍然放在摇晃测站的重心上。 */
    var _kT = frameTargetK(E, 'detect');
    if (V._detFrmK && Math.abs(Math.log(_kT / V._detFrmK)) < 0.05) return;
    V._detFrmK = _kT;
    camMoveK(sLat, sLon, _kT);
  }
  /** ★★★ 2026-10-27 真实 EEW（`q.real`）的镜头适配。
   *   —— 以前**真实电报完全不碰相机**：`detFrame`/`autoFrame` 只挂在模拟的报文循环
   *      和 rebuildAreas 的检测分支上，而 `setEEW` 的 real 分支画完色块就 return 了。
   *      于是新地震来了，画面还停在上一条地震的位置，一直到正式报（applyMeasured
   *      → 进 jishin/final 阶段）才跟着动 —— 用户报的「摄像机没有移动到新地址」。
   *   取景口径：
   *     · 真实电报没有「波前」，只能用【规模估的有感半径】≈ 60 + (M−4)×55 km
   *     · 深源（≥150km）異常震域要拉远，按 2.2×深度
   *     · 新事件（eventId 变了）一定重新取景；同一事件只有震源明显挪动（>0.15°）
   *       才重取景，免得每一报都抖一下 / 跟用户手动缩放抢镜头
   */
  function realEewFrame(E) {
    if (!E || !global.QVMapCam || !QVMapCam.fitCircle) return;
    if (global.__CAM_FREEZE) return;
    var lat = +E.lat, lon = +E.lon;
    if (!isFinite(lat) || !isFinite(lon)) return;
    /* 用户关掉「自动移动镜头」就不再抢 */
    if (QVMapCam.opt && QVMapCam.opt('follow') === false) return;
    var ev = String((E.q && (E.q.eventId || E.q.id)) || '') || 'ev';
    /* ★ 2026-10-27 用户：「其他地震完全没生效」—— 真实电报以前用的是
       「按规模估有感半径 → fitCircle」那套老逻辑，和标本表完全不同。
       现在统一：倍率走 CAM_K 表，镜头对准震源。 */
    var _kT = frameTargetK(E, E.inq ? 'inq' : (E.kind === 'detect' ? 'detect' : 'eew'));
    var prev = String(V._realFrmKey || '').split('|');
    var sameEv = (prev[0] === ev);
    if (sameEv) {
      var pLat = (+prev[1] || 0) / 100, pLon = (+prev[2] || 0) / 100;
      var pK = (+prev[3] || 0) / 1000;
      /* 同一事件、震源没挪、倍率档也没变 → 不抢镜头 */
      if (Math.abs(lat - pLat) < 0.15 && Math.abs(lon - pLon) < 0.15 &&
        Math.abs(pK - _kT) < 0.02) return;
    }
    var now = Date.now();
    if (now - (V._realFrmAt || 0) < 250) return;
    V._realFrmKey = ev + '|' + Math.round(lat * 100) + '|' + Math.round(lon * 100) +
      '|' + Math.round(_kT * 1000);
    V._realFrmAt = now;
    camMoveK(lat, lon, _kT);
  }
  V.realEewFrame = realEewFrame;
  /** 中国地级市（adcode）→ 经纬度外接框 {lon0,lat0,lon1,lat1}
   *  ★★★ 2026-10-26 用户：「摄像机逻辑在中国要改一下，日本那几个小岛，摄像机全带偏了」
   *  —— autoFrame() 取景用的是 `QVShindo.areaBounds(code)`，那是 **JMA 188 个细分行政区**
   *     的多边形表；中国震源传进去的是 6 位 adcode（如 440500），表里根本没有
   *     → 返回 null → 所有色块都被跳过 → 取景框只剩「震中 + 1.6° 最小跨度」
   *     → 镜头死死贴住震中，填色明明铺到几个纬度外却看不见。
   *  ⇒ 中国改查 QV_CN_AREAS 的 bbox（DataV 地级市轮廓自带 b: [minx,miny,maxx,maxy]）。
   *     只影响「取景范围」，不动任何填色/边界绘制。 */
  var _cnBB = null;
  function cnAreaBounds(code) {
    if (!_cnBB) {
      _cnBB = {};
      var src = global.QV_CN_AREAS || [];
      for (var i = 0; i < src.length; i++) {
        var a = src[i], b = a && a.b;
        if (!a || !b) continue;
        _cnBB[+a.c] = { lon0: b[0], lat0: b[1], lon1: b[2], lat1: b[3] };
      }
    }
    return _cnBB[+String(code || '').replace(/^nc/, '')] || null;
  }
  /** 取景用：按当前刻度选表（中国=地级市 bbox，日本=JMA 细分区域 bbox） */
  function frameBoundsOf(code, metric) {
    if (metric === 'liedu') {
      var cn = cnAreaBounds(code);
      if (cn) return cn;
    }
    return (global.QVShindo && QVShindo.areaBounds) ? QVShindo.areaBounds(code) : null;
  }

  function autoFrame(E, reset) {
    if (!E || !global.QVMapCam || !QVMapCam.frame) return false;
    /* 调试面板（js/cam-debug.js）锁定镜头时，自动取景全部让路 */
    if (global.__CAM_FREEZE) return false;
    /* ★★★ 2026-10-28 用户：「测站视角出去调查中你还要缩回来的呀」
       ⇒ 取景来源按阶段分开：
          · EEW / 检测态：震中 + **已点亮测站**（震度3以上）→ 只往外铺
          · 调查中 / 震源速報 / 正式報：震中 + **已填色块** → 允许缩放回来
       并且阶段一变就 reset（允许放大），把速报阶段铺开的画面收回到实际震度分布。 */
    /* ★ 2026-10-25：检测 → 速报 不算「阶段变化」。
       以前 detect→eew 会触发 reset，绕过 0.3 秒节流和"只往外铺"，
       实测镜头从 k=2.26 一步跳到 0.68（用户眼里就是「猛地缩出去」）。 */
    var stage = E.inq ? 'inq' : ((E.kind === 'detect') ? 'eew' : (E.kind || 'eew'));
    /* ★★★ 2026-10-27 用户：「正式版的完美相机被搞坏了」
       —— 真因（不是取景公式）：阶段切换的 reset 标志在这里就被吃掉了。
          下面 0.7 秒节流一旦把「切阶段那一帧」挡掉，`V._frameStage` 已经写成新阶段
          → 之后帧的 reset 全是 false → 正式报的 bbox 取景（QVMapCam.frame）永远不执行，
            只能等用户手动拖。⇒ 只有真的走过节流才记阶段。 */
    var reset = (V._frameStage !== stage);
    /* ★★★ 2026-10-28 官方 自動カメラ呼び出し 两条硬规则：
       ① **0.3 秒节流** —— 不是每帧都动
       ② `地図表示モード = 1`（= EEW/紧急地震速报页）**默认不自动动相机**，
          除非是阶段切换/强制复位 */
    var _nowCam = Date.now();
    var isEewStage = (stage === 'eew' || stage === 'detect');
    /* ★★★ 2026-10-26 用户：「进入调查中地图开始出色块了，结果摄像机卡死一个地方不动，之后一直这样」
       —— 调查中在 Tab1（地図表示モード = 1），下面那条「EEW 页默认不自动动相机」的规则
          把它一并拦掉了；而 growIpf() 每降一级都会调 autoFrame 想重取景 → 全被拦 → 镜头死住。
       ⇒ 调查中也是「色块在长」的阶段，允许自动取景（它不在 EEW 页的静止规则里）。 */
    var autoOk = isEewStage || stage === 'inq';
    /* ★★★ 2026-10-26 用户：「摄像机可不可以加一个在正式报自己找完美镜头，就好像图片那种」
       —— 正式报（各地震度情報）是最后一个阶段，镜头应该一次定死在一张「官方那种」画面上。
         以前 final 阶段 autoFrame 只在阶段切换那一次被动跑了一下，而且取景数据源是错的
         （见下面 ③ 的说明）→ 画面被拉到整个东亚、右下角一大片空海。
       ⇒ 正式报也允许自动取景（只在阶段切换时 force 一次，之后用户手动拖过就不再抢）。 */
    var isFinalStage = (stage === 'final' || stage === 'info');
    /* ★★★ 2026-10-28 用户：「为什么调查中的摄像机坏了，你吧从调查中开始全部使用完美相机吧」
       ⇒ 调查中 / 震源速報 / 正式報 = 一律用 bbox 拟合的「完美相机」（QVMapCam.frame），
         不再用 CAM_K 固定倍率 + 震中居中那一套。
         （CAM_K 只留给 EEW / 检测阶段 —— 那两个阶段要稳定的固定镜头。） */
    var isPerfectStage = (stage === 'inq' || stage === 'jishin' || isFinalStage);
    if (isPerfectStage) autoOk = true;
    if (!reset && _nowCam - (V._camAt || 0) < 700) return false;
    /* ★ 2026-10-25：官方 `自動カメラ呼び出し` 的条件是 `(!動かなくてもいい || eew)`
       —— EEW / 检测阶段【允许】在 EEW 页继续自动动相机（渐进铺开），
       其它阶段才遵守「EEW 页默认不自动动」。 */
    if (!reset && mapModeOf(V.view) === 1 && !autoOk) return false;
    V._camAt = _nowCam;
    /* ★ 只有真正走到这里（没被上面两道闸门挡掉）才记下阶段 —— 见上面 reset 的说明 */
    V._frameStage = stage;
    var b = { n: -90, s: 90, e: -180, w: 180 }, has = false;
    function addPt(lat, lon) {
      lat = +lat; lon = +lon;
      if (!isFinite(lat) || !isFinite(lon)) return;
      has = true;
      if (lat > b.n) b.n = lat; if (lat < b.s) b.s = lat;
      if (lon > b.e) b.e = lon; if (lon < b.w) b.w = lon;
    }
    /* ① 震中永远在画面里 */
    addPt(E.lat, E.lon);
    /* ② 速报阶段：用【预测震度分布】取景，不要只盯已点亮测站
       ★★★ 2026-10-28 实测：只按「已点亮测站」取景时，刚开场只有震中附近几站，
           包围盒极小 → 直接怼到放大上限 3.4，之后再没变化（用户眼里就是「没动」）。
           官方取景用的是**予想震度分布**的主体范围，所以这里改成：
             预测行政区（震度 ≥4）∪ 已点亮测站（震度 ≥3）
           —— 分布从第一帧就完整，画面稳定，测站只用来补细节。 */
    if (isEewStage) {
      /* ★★★ 2026-10-25 用户：「一开始就缩得太远」。
         以前这里把整张「予想震度 ≥4 的行政区」全塞进取景框 → 第一报就已经是
         半个日本，一开场就是最远的那一帧。
         现在：**以震中为圆心，半径跟着 P 波前缘长大**
           rKM = max(起始半径, 波前 + 30km)
           起始半径按规模给（M4≈60km、每大 0.1 级 +3km、封顶 260km）
           —— 开场近，随波前一点点往外铺。
         再把「已点亮且震度 ≥3」的测站并进去，避免长条形破裂被切掉。 */
      var w = (global.QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0;
      var _Mg = +E.mag || 5;
      /* ★★★ 2026-10-27 用户：「在 EEW 之前（检测到摇晃）我们的摄像机比官方大太多」
         —— 检测态只应该框住「这一片在摇的地方」（行政区/县尺度，~100km），
            原来沿用 EEW 的 `100 + (M-4)*80`（M7.1 = 348km）→ 视野比官方大一倍。
            EEW 阶段保持原值不变。 */
      var _rMin;
      if (E.kind === 'detect') {
        _rMin = Math.max(45, Math.min(180, 45 + (_Mg - 4) * 20));   /* M7.1 → 107km */
      } else {
        _rMin = Math.max(100, Math.min(520, 100 + (_Mg - 4) * 80));
      }
      /* ★★★ 2026-10-26 用户：「现在摄像机整体放太大了，刚开始 EEW 的时候」
         —— 起始半径原来是 `60 + (M−4)·30`，M7.3 只有 159km：日本那样窄的列岛还行，
            放到中国（一个地级市就有 100km 宽）等于怼在震中脸上，四周全出画。
         ⇒ 起始半径抬到 `100 + (M−4)·80`（M5→180km / M6→260 / M7.3→364 / M8→420，封顶 520），
            保证一开场就能看见整个受波及的地级市群。后面仍由波前半径接管。
         ★ 2026-10-27：检测态改用上面那份更紧的 `_rMin`（见 if/else），EEW 阶段不变。 */
      var _rKm = Math.max(_rMin, w + 30);
      var _dLat = _rKm / 111;
      var _dLon = _rKm / (111 * Math.max(0.2, Math.cos((+E.lat || 35) * Math.PI / 180)));
      addPt(+E.lat + _dLat, +E.lon - _dLon);
      addPt(+E.lat - _dLat, +E.lon + _dLon);
      var obs = E.obs || [];
      for (var i = 0; i < obs.length; i++) {
        var o = obs[i];
        /* ★ 2026-10-25：取景半径是震央距（w），所以比 epi */
        if (w > 0 && ((o.epi != null ? +o.epi : (+o.hyp || 0))) > w) continue;
        if ((+o.shindo || 0) < 3) continue;
        addPt(o.lat, o.lon);
      }
    }
    /* ③ 已填色的行政区（所有阶段都参与）
       ★★★ 2026-10-28 官方（地図::カメラ範囲決定）是**按優先順位分档**套范围的：
           「先拿震度5弱以上的区」，档次不够才降档；绝不是把所有色块并成一个巨大包围盒。
           一上来并全集 → 包围盒永远很大 → 用户眼里「摄像机不动」。
       档位：① 震度 ≥5弱  ② 震度 = 4  ③ 其余（1~3） */
    try {
      /* ★★★ 2026-10-25 用户：「一开始就缩得太远」——**真正的元凶就在这里**。
         以前 EEW / 检测阶段也把「予想震度 ≥4 的整批行政区」并进取景框，
         第一报就把半个日本装进来 → 一开场就是最远的一帧。
         ⇒ 只有**调查中之后**才用色块 / 预测行政区取景（那时是「收回到实际分布」）；
           EEW / 检测阶段只用上面 ② 的「震中 + 波前半径」。 */
      var marks = null;
      if (!isEewStage) {
        /* ★★★ 2026-10-26 用户：「正式报自己找完美镜头，就好像图片那种」
           —— 以前这里固定拿 `V.eewAreas()` = `E.allAreas`：中国那张表是 **1800+ 个区县码**
              （440523/350624 …），`QV_CN_AREAS` 里只有地级市记录，查不到 bbox →
              82% 的色块被跳过，剩下的又叠加「震中对称展开」→ 画面硬生生拉到整个东亚。
           ⇒ 取「**真的画到地图上的那一批**」（setEEW 里存进 E.fillShown 的，带地级市码），
             那才是用户眼睛看到的色块范围；拿不到才退回 eewAreas。
           ★ 2026-10-27 修正：注释一直这么写，代码却正好写反了（先 eewAreas）。
             正式报时 eewAreas() 返回的是**整场预测表**（中国 1800+ 条），
             比实际填出来的色块大得多 → 完美相机一路缩到整个东亚。 */
        marks = ((E.fillShown && E.fillShown.length) ? E.fillShown : null) ||
          (V.eewAreas && V.eewAreas());
      }
      /* ★ 2026-10-26：不再强制要求 QVShindo（中国走 QV_CN_AREAS 的 bbox，
         QVShindo 只是日本那张表的提供者）。 */
      if (marks && marks.length) {
        /* ★★★ 2026-11-03 用户：「从 EEW 扩开摄像机后进入调查中，只填了几个色块，
           摄像机应该要放大；正式报色块多了很多，也没有缩小」
           —— 旧代码总是把 E.allAreas 里**所有预测 ≥4 的行政区**并进包围盒
              （下面那段 _all2 循环），预测范围 = 整场地震最大范围，
              于是调查中/正式报的包围盒完全一样 → 两个方向都不动。
           ⇒ 只认「此刻真的画在地图上的色块」：少就收进来，多就铺出去。 */
        for (var k = 0; k < marks.length; k++) {
          var _lv = +marks[k].level;
          if (!isFinite(_lv) || _lv <= 0) _lv = +marks[k].shindo;
          if (!(_lv > 0)) continue;                 /* 震度0：不填色，也不取景 */
          /* ★★★ 2026-10-27 用户：「正式版的完美相机被搞坏了」
             —— 取景不能把最外圈那层「烈度1 / 震度1」的边角料一起框进来：
                M6.5 在 800km 外还有 1 度（理论上是仪器能测），一框进去画面就横跨 27 个经度，
                震源反而成了一小点。官方 `地図::カメラ範囲決定` 也是**分档**取景
                （先 震度5弱以上 → 再 4 → 最后才 1~3），最外圈只负责填色、不负责取景。
             ⇒ 烈度1 / 震度1 的色块不参与包围盒。 */
          if (_lv <= 1) continue;
          /* ★ 2026-10-26：中国必须走地级市 bbox（JMA 表里没有 adcode → 以前整段被跳过） */
          var bb = frameBoundsOf(marks[k].area || marks[k].code, E.metric);
          if (bb) { addPt(bb.lat0, bb.lon0); addPt(bb.lat1, bb.lon1); }
          else if (isFinite(marks[k].lat) && isFinite(marks[k].lon)) addPt(marks[k].lat, marks[k].lon);
        }
        V._frameTiers = [marks.length];
      }
    } catch (e3) { }
    /* ④ 波圈（P/S 波那个逐渐扩大的圆）必须在画面里
       ★★★ 2026-10-28 用户：「你这摄像机假的吧，圈都出屏幕了，摄像机也不动」
       —— 取景只算了「震中 + 色块 + 测站」，波圈半径会长到几百上千公里，
          比这些范围都大，于是圈一出界就再也看不见了。
       ⇒ 把当前波前半径也并进包围盒：圈到哪儿，画面就跟到哪儿。
       ⚠️ 2026-10-28 修正：**只在 EEW / 检测阶段**并波圈。进入调查中/震源速報/正式報
          之后波前还会一直长到上千公里，再并进去就会把画面拉到 k=0.33（整个东亚），
          反而把「已填色块」挤成一小团（实测 tiers 已有 77 个区，画面却全是海）。 */
    var _wkm = (global.QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0;
    /* ★★★ 2026-10-28：加速模拟（100×）时波前每秒铺几百公里 → 半径上千公里，
       并进包围盒后 k 被拉到 0.03（整个地球）。波圈只需保证「震中周边看得见」，
       半径超过 600km 就不再扩（那时日本列岛也早就装不下了）。 */
    if (_wkm > 600) _wkm = 600;
    if (_wkm > 0 && isEewStage && isFinite(E.lat) && isFinite(E.lon)) {
      var _dLat = _wkm / 111;
      var _cosL = Math.max(0.15, Math.cos((+E.lat) * Math.PI / 180));
      var _dLon = _wkm / (111 * _cosL);
      addPt(+E.lat + _dLat, +E.lon - _dLon);
      addPt(+E.lat - _dLat, +E.lon + _dLon);
    }
    if (!has) return false;
    /* ★★★ 2026-10-26 用户：「摄像机加一个东西，现在老是把震中抛到屏幕角落」
       —— 包围盒是「震中 + 所有填色块 + 波前」并出来的；填色只要偏向一侧
          （中国地级市又大又不均匀，常见只往北东或沿海一带铺），盒心就跑到一边，
          震中自然被挤到画面上/右下角。
       ⇒ **以震中为中心对称展开**（各方向取最大半径），震中永远落在画面正中。
          代价是另一侧多留一点空白；比把震中甩出画外好得多。 */
    if (isFinite(+E.lat) && isFinite(+E.lon) && isFinalStage) {
      /* ★★★ 2026-10-26 用户：「正式报自己找完美镜头，就好像图片那种」
         —— 正式报时色块已经四面铺开、震中本来就落在高强度区里，
            再做「以震中对称展开」只会把另一侧拉出一大片空海（实测画面横跨 105~129°E，
            右下角全是太平洋）。⇒ 正式报**不做对称**，直接按色块范围 + 均匀留白取景。 */
      var _mgLat = Math.max(0.15, (b.n - b.s) * 0.12);
      var _mgLon = Math.max(0.15, (b.e - b.w) * 0.12);
      b.n += _mgLat; b.s -= _mgLat; b.e += _mgLon; b.w -= _mgLon;
    } else if (isFinite(+E.lat) && isFinite(+E.lon)) {
      var _dN = Math.max(b.n - (+E.lat), (+E.lat) - b.s);
      var _dE = Math.max(b.e - (+E.lon), (+E.lon) - b.w);
      b.n = (+E.lat) + _dN; b.s = (+E.lat) - _dN;
      b.e = (+E.lon) + _dE; b.w = (+E.lon) - _dE;
    }
    /* ★ 最小跨度：调查中刚开始可能只有 2~3 个色块，包围盒极小 → k 会被怼到放大上限
       （贴脸）。给 1.6°（≈180km）的底，既不贴脸、也仍然明显比 EEW 阶段近。
       ★ 2026-10-26 中国（烈度）用 3.0°（≈330km）：地级市本身就上百公里宽，
         只填两三个市就用 180km 的底 → 又是怼脸（用户：「整体放太大了」）。 */
    /* ★ 2026-10-27 用户：「调查中刚开始缩放得太小，二次更新后放得太大」
       —— 最小跨度以前 1.6°（≈180km），两三个色块就能贴脸，下次色块一多就猛退。
          抬到 2.4°（≈270km），初期不至于贴脸，两次更新之间的变化也小很多。 */
    /* ★★★ 2026-10-27 分两种取景方式：
       · 正式報（各地震度情報）→ **用回原来的「自己找完美镜头」**（bbox 拟合）
         用户：「正式版直接用我之前的完美相机吧」
       · 其它阶段 → 固定倍率（CAM_K 表），中心 = 震中
         并且补上 frame() 里那条「横屏时左侧卡片压住地图」的中心补偿，
         否则震中会偏到一边（用户：「为什么还是偏移了」）。 */
    var _kT = frameTargetK(E, stage);
    /* ★★★ 2026-10-28 用户：「从调查中开始全部使用完美相机」
       —— 正式报原来走的就是 bbox 拟合（QVMapCam.frame），现在把同一套用到
          调查中 / 震源速報：按「震中 + 真的画到地图上的色块」求包围盒再拟合，
          色块变多 → 画面自动往外铺；不再用 CAM_K 固定倍率。 */
    if (isPerfectStage) {
      /* ★ 最小跨度：调查中刚开可能只有 2~3 个色块，纯 bbox 拟合会把画面怼到
         k≈2.6（≈270km 视野，比官方调查中 1.27 近了 2 倍多）。
         官方调查中的镜头大约是「半个关东」量级 ⇒ 日本给 5.0°、中国（地级市大）给 6.0°，
         色块长出这个范围之后由 bbox 拟合自然接管（正式报不设底，纯拟合）。 */
      var _minSpan = isFinalStage ? 0 : ((E.metric === 'liedu') ? 6.0 : 5.0);
      var _pcLat = isFinite(+E.lat) ? +E.lat : (b.n + b.s) / 2;
      var _pcLon = isFinite(+E.lon) ? +E.lon : (b.e + b.w) / 2;
      if ((b.n - b.s) < _minSpan) { b.n = _pcLat + _minSpan / 2; b.s = _pcLat - _minSpan / 2; }
      if ((b.e - b.w) < _minSpan) { b.e = _pcLon + _minSpan / 2; b.w = _pcLon - _minSpan / 2; }
      return QVMapCam.frame(b, !!reset, !!reset);
    }
    var _cLat = +E.lat, _cLon = +E.lon;
    if (!isFinite(_cLat) || !isFinite(_cLon)) {
      _cLat = (b.n + b.s) / 2; _cLon = (b.e + b.w) / 2;
    }
    if (!isFinite(_cLat) || !isFinite(_cLon)) return false;
    /* 设置页关掉「自动移动镜头」→ 不抢（阶段切换仍然强制） */
    if (!reset && QVMapCam.opt && QVMapCam.opt('follow') === false) return false;
    if (!reset) {
      var _kNow = 0;
      try { _kNow = +QVMapCam.debug().k || 0; } catch (eD) { }
      /* 变化不到 6% 就不动（避免每报都抖一下） */
      if (_kNow > 0 && Math.abs(Math.log(_kT / _kNow)) < 0.06) return false;
    }
    return camMoveK(_cLat, _cLon, _kT);
  }
  function bumpEEW(n) {
    var E = V.eew;
    if (!E) return;
    /* ★ 调试面板「暂停」：报文循环不推进（画面完全静止，方便对录像调参数）。
       同时把 repBase 跟着 n 走 → 暂停期间报号不涨，恢复后从当前报继续（不跳号）。 */
    if (global.__SIM_PAUSE) { E.repBase = n - (E.report || 1); return; }
    /* ★ 2026-10-25：检测态升级到 EEW 时会把报文号重编，之后从「第1报」数起 */
    E.report = n - (E.repBase || 0);
    if (E.plan && E.report >= E.plan) E.isFinal = true;
    /* 收敛进度 p：0（第1报）→ 1（约 55% 报数之后稳定） */
    var p = Math.min(1, n / Math.max(3, E.plan * 0.55));
    var ease = 1 - Math.pow(1 - p, 2);
    /* ★★★ 2026-10-21 用户：「按照这个算法来讲，它的规模和深度跳动的应该是正负 1.0 那样子，
       刚开始站点少；你这个只是对我设定的模拟数值做正负零点几的变化」
       —— 真 IPF 是**从当前已观测的测站反推震源参数**，测站少 → 反推误差大 → 读数乱跳。
       这里用「已观测测站数」当精度尺子：
         nObs 很少（首报）→ 抖动 ±1.0 M / ±40% 深度
         nObs 充足（几百站）→ 抖动收敛到 ±0.1 M / ±5%
       再叠加原来的插值（mag0 → magT），观感就是「先乱跳、后稳定到真值」。 */
    var _nObs = 0;
    try {
      var _wNow = (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0;
      if (!(_wNow > 0)) _wNow = (E.depth || 10) + 20;
      var _ob = E.obs || [];
      for (var _i = 0; _i < _ob.length; _i++) {
        if ((+_ob[_i].shindo || 0) < 0.5) continue;
        /* ★ 2026-10-25：波前是震央距 → 比 epi，不能比 hyp（深源会多算一大片） */
        if (((_ob[_i].epi != null ? +_ob[_i].epi : (+_ob[_i].hyp || 0))) <= _wNow) _nObs++;
      }
    } catch (e2) { }
    var _jitM = Math.max(0.1, 1.0 * Math.exp(-_nObs / 90));      /* M 抖动幅度 */
    var _jitD = Math.max(0.05, 0.40 * Math.exp(-_nObs / 90));    /* 深度抖动比例 */
    var magBase = E.mag0 + (E.magT - E.mag0) * ease;
    var depBase = E.dep0 + (E.depT - E.dep0) * ease;
    /* ★ 2026-10-21 ②：测站够多就**真反推**（IPF 网格搜索），否则退回抖动。
       ≥8 个已观测测站时，用 inferSource() 从观测反解 M / 深度。 */
    var _inf = null;
    try {
      if (_nObs >= 8) {
        var _obsList = [];
        var _wNow2 = (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0;
        if (!(_wNow2 > 0)) _wNow2 = (E.depth || 10) + 20;
        for (var _j = 0; _j < (E.obs || []).length; _j++) {
          var _o = E.obs[_j];
          if ((+_o.shindo || 0) < 0.5) continue;
          if (((_o.epi != null ? +_o.epi : (+_o.hyp || 0))) > _wNow2) continue;
          _obsList.push(_o);
        }
        _obsList.sort(function (a, b) { return (+a.hyp || 0) - (+b.hyp || 0); });
        _inf = inferSource(_obsList);
      }
    } catch (eInf) { }
    if (_inf && !E.frozen) {
      /* 反推成功：M / 深度直接来自观测（早期测站少 → 解不唯一 → 自然乱跳） */
      /* ★★★ 2026-10-21 用户：「我们可以加梯度裁剪（Clipping）吗」
         可以，而且必须有 —— 这是**时间维裁剪**（相邻两报之间的最大位移）。
         网格搜索每报都是「暴力全局最优」：波前一扫过新的测站群，
         最优解可能从 M6.8/20 一步跳到 M9.3/160 —— 观感就是「读数炸了」。
         ⇒ 限制 |ΔM| ≤ 0.8、|Δdepth| ≤ 80km。收敛过程仍然是一报报爬，
           只是不会瞬移。（参数维的裁剪已在 inferSource 里：dep < 最近测站震源距。）
         ⚠️ 只在「真的走了反推」时裁；走抖动兜底（<8 站）不裁，
            保留用户要的「刚开始站点少，读数乱跳」。 */
      if (E._infPrev) {
        var DM_MAX = 0.8, DD_MAX = 80;
        _inf.mag = Math.max(E._infPrev.mag - DM_MAX, Math.min(E._infPrev.mag + DM_MAX, _inf.mag));
        _inf.depth = Math.max(0, Math.max(E._infPrev.depth - DD_MAX,
          Math.min(E._infPrev.depth + DD_MAX, _inf.depth)));
      }
      /* ★★★ 2026-10-28 用户：「我是在设置里调的最大释放能量就 M8.1，
         你是怎么样这个算法算出的 10M 0km 的」「还会自动帮我升级」
         —— 根因：`inferSource()` 拿**模拟出来的均匀场**去反推震源，
            方程是病态的，会解出 M10 / 深度 0 这种垃圾值；
            而这里又把反推结果**无条件**写进 E.mag/E.depth，
            于是显示出来的 M 一路爬到 8.5、甚至 10。
         ⇒ 模拟模式（有 magT/depT 真值）下，把反推结果硬夹在真值附近：
              M   ∈ [magT − 1.2 , magT]   ← **永远不超过用户设定**
              深度 ∈ [depT×0.4 , depT×1.6] 且 ≥1km
            收敛观感保留（从低往上爬），但再也不会跑到 10 / 0。 */
      if (E.magT != null && isFinite(E.magT)) {
        _inf.mag = Math.max(E.magT - 1.2, Math.min(E.magT, _inf.mag));
        /* ★ 2026-10-25：再用真实报文标定的收敛包络夹一层
           （5.0 → 6.3 → 6.6~6.9 抖 → 7.1），比「单调爬到真值」像得多。
           ★ 深源要传 E.depT：深源首报只退 0.3，不能套浅源那条 −1.8/−2.1。 */
        var _env = magEnv(E.report, E.magT, E.plan, E.depT);
        if (_env != null) {
          if (_env > E.magT - 0.6 && _env < E.magT - 1e-6) {
            /* 平台段：真实在 6.2〜6.9 上下抖（不是贴上限） */
            _inf.mag = _env + (Math.random() - 0.5) * 0.55;
          } else {
            _inf.mag = Math.max(_env - 0.05, Math.min(_env + 0.05, _inf.mag));
          }
        }
        var _dT = isFinite(E.depT) ? E.depT : 10;
        /* ★ 2026-10-28：深源地震（≥150km）的深度反演本来就很准（官方样本 350km 报 340）
           —— 以前夹在 [0.4×, 1.6×]，M6.8/160km 会落到下界显示成 **64km**。
           深源改成 [0.85×, 1.15×]，浅源维持原区间。 */
        var _loD = Math.max(1, _dT * (E.deepSrc ? 0.92 : 0.4));
        var _hiD = Math.max(2, _dT * (E.deepSrc ? 1.08 : 1.6));
        _inf.depth = Math.max(_loD, Math.min(_hiD, _inf.depth));
      }
      E._infPrev = { mag: _inf.mag, depth: _inf.depth };
      /* ★★ 行星模式：inferSource 拿【地球测站】反推的 M/深度是垃圾值且会抖
         （用户看到的「震级 8.6、深度 0km」就是这个），直接锁死成模拟面板的真值。 */
      if (global.QVPlanet && global.QVPlanet.isPlanet()) {
        E.mag = E.magT; E.depth = E.depT; E.level = E.lvT;
        E.mag0 = E.magT; E.dep0 = E.depT; E.ladI0 = E.ladIT;
        E.inferErr = 0;
      } else {
        E.mag = Math.round(_inf.mag * 10) / 10;
        E.depth = Math.max(0, Math.round(_inf.depth));
        E.inferErr = _inf.err;
      }
    } else if (!E.frozen) {
      /* 测站太少 → 用抖动兜底（观感等价于 IPF 的早期不收敛）
         ★★★ 2026-10-28 用户：「还会自动帮我升级」—— 这里原来没夹真值，
             `magBase ± 1.0` 会跑到 8.1+0.2=8.3（甚至 9.1）。
         现在同样夹在 [magT−1.2, **magT**]，深度夹在 [depT×0.4, depT×1.6]。 */
      var _mj = magBase + (Math.random() * 2 - 1) * _jitM;
      var _dj = depBase * (1 + (Math.random() * 2 - 1) * _jitD);
      if (E.magT != null && isFinite(E.magT)) {
        _mj = Math.max(E.magT - 1.2, Math.min(E.magT, _mj));
        /* ★ 2026-10-25：抖动兜底路径也要过一遍真实报文标定的收敛包络，
           否则测站少的早期会直接显示 7.0。深源同样传深度。 */
        var _env2 = magEnv(E.report, E.magT, E.plan, E.depT);
        if (_env2 != null) {
          if (_env2 > E.magT - 0.6 && _env2 < E.magT - 1e-6) {
            _mj = _env2 + (Math.random() - 0.5) * 0.55;
          } else {
            _mj = Math.max(_env2 - 0.05, Math.min(_env2 + 0.05, _mj));
          }
        }
        var _dT2 = isFinite(E.depT) ? E.depT : 10;
        _dj = Math.max(Math.max(1, _dT2 * (E.deepSrc ? 0.92 : 0.4)),
          Math.min(Math.max(2, _dT2 * (E.deepSrc ? 1.08 : 1.6)), _dj));
      }
      E.mag = Math.round(_mj * 10) / 10;
      E.depth = Math.max(0, Math.round(_dj));
    }
    E.obsN = _nObs;                       /* 调试用：当前已观测测站数 */
    /* ★★★ 2026-10-28 用户：「在紧急地震速报的时候，跳动是正常的，
       我说的是最终正式测报（震源速報 / 正式報）的时候」
       ⇒ 速报阶段的 M/深度抖动保留（那是 IPF 收敛的观感），
          一旦离开速报阶段就**锁死在真值**，不再跳。 */
    if (E.magT != null && isFinite(E.magT) && E.kind !== 'eew' && E.kind !== 'detect') {
      E.mag = E.magT;
      if (isFinite(E.depT)) E.depth = E.depT;
      E.inferErr = 0;
    }
    /* ★★★ 2026-10-28 用户：「卡片上显示的震度，不是看模拟的那个测站吗，现实中也是，
       想要达到震度7的条件，就是两个测站达到7就算了」
       ⇒ 最大震度取**已到达测站的实测最大值**（震度7 需 ≥2 站）；
          没测站到就先保留上一报的值，不再按报文阶梯硬爬。 */
    var LAD2 = ladOf(E.metric);
    /* ★★★ 2026-10-25 按熊本 M7.1 真实报文分段爬升：
         #1 4 → #2〜#4 6弱 → #5〜#10 6強 → #11 起 7 */
    /* ★ 自变量一律用 `E.report`（卡片上显示的报号）。
       以前用 `n - repBase`，但升级那一帧 `repBase` 还没更新 → 第一报被当成第 2 报，
       阶梯直接从 6弱 开始（实测 #1 显示 6弱而不是震度4）。 */
    var ci = ladAt(E.report, E.ladI0, E.ladIT, E.plan);
    var _ladLv = LAD2[Math.max(0, Math.min(LAD2.length - 1, ci))];
    var _obsLv = obsMaxShindo(E);
    /* ★ 早期（阶梯还没爬到顶）以阶梯为上限：
       真实 JMA 前几报只有极少数测站报了 リアルタイム震度，
       不可能第一报就是震度7；我们的模拟场一到达就是最终值，会直接顶满。
       到了阶梯顶端（#11 之后）就不再压，完全交给实测测站。 */
    if (_obsLv > 0 && ci < E.ladIT) {
      var _oi = -1;
      for (var _lk = 0; _lk < LAD2.length; _lk++) { if (+LAD2[_lk] === +_obsLv) { _oi = _lk; break; } }
      if (_oi > ci) _obsLv = LAD2[ci];
    }
    E.level = (_obsLv > 0) ? _obsLv : (E.level || _ladLv);
    E.ladLv = _ladLv;                     /* 保留阶梯值备用（行星模式等） */
    /* ★★★ 2026-10-25 长周期地震动階級：熊本 M7.1 真实报文是从
       **1 → 3 → 2 → 3 → 4** 一阶阶抖上去的，到第 12 报才到 4，第 22 报才定住。
       我们以前是 fireSim 一次性估个终值 → 一开场就显示 4，完全不对。 */
    if (E.lgT == null) E.lgT = (+E.maxLg > 0 ? +E.maxLg : -1);
    if (E.lgT > 0) {
      /* ★★★ 2026-10-26 用户：「M9.9 最大长周期地震动阶级只有 2」
         —— 真因就在这段爬坡：它按 **EEW 报号 E.report** 一阶阶往上走，
            而 `_settleLg = max(6, plan*0.72)`（plan=21 → 15 报）才收敛。
            模拟里一旦按 Enter 跳到震源速報/正式报，报号就停在 7~14，
            于是**最终卡片显示的仍是 lgT-1 / lgT-2**（实测 M6.2：lgT=2 却显示 1；
            M8.7：lgT=4 却显示 2）。真实 JMA 到「各地震度情報」时階級已经定稿。
         ⇒ 进震源速報/正式报时置 `E.lgLock=1`，锁死到终值，不再按报号抖动。 */
      if (E.lgLock) {
        E.maxLg = E.lgT;
      } else {
        var _nLg = E.report;
        var _settleLg = Math.max(6, Math.round((E.plan || 20) * 0.72));
        var _lg;
        if (_nLg <= 3) _lg = Math.max(1, E.lgT - 3);
        else if (_nLg <= 6) _lg = Math.max(1, E.lgT - 1);
        else if (_nLg <= 10) _lg = Math.max(1, E.lgT - (Math.random() < 0.5 ? 2 : 1));
        else if (_nLg < _settleLg) _lg = Math.max(1, E.lgT - (Math.random() < 0.4 ? 1 : 0));
        else _lg = E.lgT;
        E.maxLg = _lg;
      }
    }
    /* ★★★ 2026-10-20 用户：检测只是摇晃提示，不是紧急地震速报。
       · 检测态震度上升 → 播官方 NewIntN（不是 EEW 音）
       · 一旦爬到「紧急地震速报」阈值（震度 3 以上）→ **撤掉摇晃检出的框**，
         切回速报态（红叉 / P-S 波圆 / 速报音效）。 */
    if (E.kind === 'detect') {
      /* 用「P 波已到达」的测站重算当前观测最大震度 */
      var _w2 = (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0;
      var lvNow = 0, _bestKey = null, _bestObs = null;
      for (var oi2 = 0; oi2 < (E.obs || []).length; oi2++) {
        var ob2 = E.obs[oi2];
        /* ★ 2026-10-25：与波前（震央距）比 epi */
        if (_w2 > 0 && ((ob2.epi != null ? +ob2.epi : (ob2.hyp || 0))) > _w2) continue;
        if (ob2.shindo > lvNow) { lvNow = ob2.shindo; _bestKey = detGridKey(ob2.lon, ob2.lat); _bestObs = ob2; }
      }
      var dl = +lvNow;
      /* ★★★ 2026-10-25 对积木：音效等级用的不是全局最大震度，而是
         【该格 ±2 行 ±2 列 共 25 格】内的最大震度（改造版 `grid周囲最大値を調べて効果音`）。 */
      var _nbLv = _bestKey ? gridNbMax(E, _bestKey) : 0;
      if (_nbLv < dl) _nbLv = dl;                 /* detKeep 还没刷新时兜底 */
      /* ★★★ 2026-10-25 对积木：改造版 `震度上昇効果音` 的真身
         —— 声音按【等级去抖】，只有「新等级 > 上次已经报过的等级」才响，
            `効果音制御SE[2] < 多目的1` 才更新并播放；
            而且相邻档（它的 5→6 / 7→8）直接吞掉不响。
         我们以前是「只要最大震度变大就响一次」，同一个震度档里跳一下也会响。 */
      /* ★★★ 2026-10-27 改成官方「震度上昇効果音」口径：逐测站比较上上次值，
         上升才响/才画圆（不再只看全图最大震度 —— 那样 EEW 阶段只会响一两次）。 */
      detSfxScan(E, E.obs, _w2);
      E.detLv = dl;
      /* ★★ 2026-10-25：必须先满足「检测至少持续 detHold 秒」才升级。
         注意这里**不能 early-return** —— 一 return 就把本轮 rebuildAreas/autoFrame/
         卡片刷新全跳过了（检测态卡就不长了）。用闸门包住升级动作。 */
      var _simT = E.detWall ? ((Date.now() - E.detWall) / 1000 * simSpd()) : 99;
      /* ★★★ 2026-10-25 深源：永远到不了震度3（样本最大震度1），
         但官方照样发「深源地震震度不明」的 EEW → 只按 detHold 时间放行。 */
      /* ★★★ 2026-10-27 用户更正：
         「强震是画圆，不一定一定要发 EEW，我不是都说了跟着算法走吗，
           现实中可是有单个站点 6弱、实际最大震度 3 这种东西，要看其他测站的反应」
         ⇒ **不要**因为「有 5弱以上的测站」就提前发报，发不发 EEW 一律按原算法
           （波前内最大震度 ≥ 阈值 + detHold）。这里只负责「强震不画方框」，
           那件事在 rebuildAreas 的 detBoxes 里做（≥2 站 5弱以上 → 0 个框）。 */
      var _detCount = (E.obs && E.obs.det) ? E.obs.det.length : (E.obsN || 0);
      var _upOk = E.deepSrc
        ? (_simT >= (E.detHold || 0))
        : (dl >= eewThresh(E.metric) && _simT >= (E.detHold || 0) && (!E.obs || E.obs.length === 0 || _detCount >= 2));
      if (_upOk) {
        E.kind = 'eew';
        E.detLv = null;
        /* 报文号从 0 重数：下一报就是「第1报」（官方检测完才开始报 EEW） */
        E.repBase = n - 1;
        E.report = 1;
        /* ★ 2026-10-25：升级这一帧的 `E.report` 还是升级前的号（n−repBase），
           阶梯会直接从 6弱 起。真实第 1 报是「推定最大震度4」→ 这里按 i0 重算一次。 */
        try {
          var _LAD0 = ladOf(E.metric);
          var _i00 = Math.max(0, Math.min(_LAD0.length - 1, E.ladI0));
          E.level = _LAD0[_i00];
          E.ladLv = E.level;
          /* ★ 2026-10-26：lgT ≤ 0（深源不发階級）时不要写成 1 ——
             以前 `Math.max(1, (E.lgT || 1) - 3)` 对 -1 会算出 1，
             于是「官方没有階級」的地震会凭空多出一张階級1 的灰卡。 */
          E.maxLg = (E.lgT > 0) ? Math.max(1, E.lgT - 3) : -1;
        } catch (eLv0) { }
        /* ★ 升级时补 EEW 音效（以前只切了画面，没有声音） */
        try { playEewSound(1); } catch (eS) { }
        if (global.QVMapCam && QVMapCam.setBoxes) QVMapCam.setBoxes(null);
        if (global.QVMapCam && QVMapCam.setDetectMode) QVMapCam.setDetectMode(false);
        if (global.QVMapCam && QVMapCam.lockPin) QVMapCam.lockPin([{ lat: E.lat, lon: E.lon, kind: 'eew' }]);
        if (global.QVMapCam && QVMapCam.setPins) QVMapCam.setPins([{ lat: E.lat, lon: E.lon, kind: 'eew' }]);
        if (global.QVMapCam && QVMapCam.simWave) QVMapCam.simWave({
          lat: E.lat, lon: E.lon, t0: E.simT0, level: (E.lvT || 4), mag: E.magT,
          depth: E.depT, autoFit: false, deep: E.deepSrc ? 1 : 0 });
        /* ★ 2026-10-25：检测态用的是含震度0的测站集（gs.det），
           升级到 EEW 后要换回正常测站集，否则一堆震度0的点会留在图上。 */
        if (global.QVMapCam && QVMapCam.setStations && E.obs) {
          QVMapCam.setStations(E.obs,
            { t0: E.simT0, depth: E.depT, metric: E.metric });
        }
        /* ★★★ 2026-10-28 用户：「刚开始第一波调查的时候会闪一波全部图」
           —— 这里原来直接 `QVShindo.set(E.allAreas)`，**绕过了调查中的等级过滤**
              → 有一帧把全部行政区（实测 83 个）一起刷出来，下一秒又被等级梯子收回去
              = 肉眼看到「闪一下全图」。
           下面几行就会调 rebuildAreas()（带 fillable + ipf.grades 过滤），
           所以这里**不要再直接 set**，交给它统一处理。 */
      }
    }
    /* ★ 观测震度列表每报重算：已「收到」的测站随报数增加 → 列表逐步变长/变值，
       不再从第 1 报到最后一报都是同 9 条。 */
    /* 每报按「P 波当前走到的距离」重算 —— 波扫到哪儿，列表才长到哪儿 */
    rebuildAreas(E, (global.QVMapCam && QVMapCam.wavePkm) ? QVMapCam.wavePkm() : 0);
    /* ★ 2026-10-28：每报按「震中 + 已点亮测站 + 已填色块」重新取景（只缩小） */
    try { autoFrame(E); } catch (eAF) { }
    /* ★ 调查中阶段：行政区最大震度有更新 → 刷新卡片并弹一下 */
    if (E.inq) { advanceIpfBatch(E); refreshInqCard(E); }
    /* ★ 2026-10-25 用户：「调查中会凭空响几下…也没有什么情报」
       —— EEW 卡在 Tab2；调查中期间用户停在 Tab1 看调查中卡，
          这时的「报文更新音」在他眼里没有任何画面 → 不响（回到 Tab2 照旧）。 */
    /* ★★★ 2026-10-28 用户：「我就说后面怎么这么安静」
       —— 以前这里锁死 `V.view === 1`：只要用户在看 Tab1（详细栏/调查中卡），
          后台照常在发报、卡片在涨，但**一个提示音都没有**。
          官方不管你在看哪一页，来了新报文就响。
       ⇒ 去掉视图限制（去重已经由上面的报号签名负责，不会凭空多响）。 */
    if (E.kind === 'eew') playEewSound(n);
    /* ★★★ 2026-10-28 用户：「加一个，除非调查中，卡片连续 15 秒没反应，
       而且紧急地震速报在后台也是更新了，那才会跳出去，现在我感觉 3 秒就跳，太频繁了」

       旧逻辑（已废弃）：`E.inq && E.kind==='eew' && V.view===0` + 3 秒 →
           **专在调查中阶段**每来一报就弹去 Tab2 看 2.5 秒再弹回来 → 跳跃太频。
       新逻辑：
         ① **调查中一律不跳**（让人把调查中卡看完，“除非调查中”就是这条）
         ② 用户当前在看 Tab1（view 0）
         ③ 这张卡已经连续 ≥15 秒没换过内容（V._cardAt）
         ④ 这 15 秒里 EEW 在后台确实来过新报（V._eewBgAt，用户没在看 Tab2 时刷）
       四个都满足才跳一次，跳完重置，不会连着弹。 */
    if (V.view !== 1) V._eewBgAt = Date.now();          /* 后台（非 Tab2）收到新报 */
    if (!E.inq && E.kind === 'eew' && V.view === 0) {
      var JUMP_IDLE = 15000;
      var _cardAt = V._cardAt || V._inqTabAt || Date.now();
      if (Date.now() - _cardAt >= JUMP_IDLE && (V._eewBgAt || 0) > _cardAt) {
        V._inqTabAt = Date.now();
        V._cardAt = Date.now();
        flashView(1, 2500, 0);                /* 去看新报（2.5 秒），然后回到原卡 */
      }
    }
    if (global.QVRedraw) QVRedraw();
  }
  /** ★★★ 2026-10-21 按用户《音效对应.xlsx》重写的 EEW 音效：
       eew0   刚检测到（震度 1~2）｜eew3 = 震度 2→3 升级｜eew5 = 震度 3→4 升级
       koushin  报文更新（震度没变）｜koushinE = **最后一报**的更新音
     ⇒ 所以这里要把「上一报的震度」也传下去（存在 E._seLv） */
  function playEewSound(n) {
    var E = V.eew;
    if (!E) return;
    /* ★★★ 2026-10-28 用户：「只要地图没更新、没变化，就不应该响音效吧？为什么凭空响了这么多下？」
       —— 以前这里是「每报无条件播一次」，报文数量 10+ 就是连着响 10 多下，
          哪怕 M / 深度 / 震度档位一个都没变。
       ⇒ 按【看得见的内容】去重：卡面震度档位 + 震级(0.1) + 深度(1km)
          三项都不变就不出声。震度升级音（eew3/eew5）自然还成立 —— 档位变了 sig 就会变。 */
    /* ★★★ 2026-10-25 用户：「只要地图没更新、没变化，就不应该响音效」
       —— 卡面真正看得见的只有【震度档位】。M / 深度每报都会抖，
          拿它们做签名等于每报都响（实测一报一下）。
       ⇒ 签名只留档位：档位不变 = 画面不变 = 不出声；升级音（eew3/eew5）也因此更准。 */
    var grade = lvKeyOf(E.level, E.metric);
    /* ★ 2026-10-26 用户：「震度的卡片音效没有被完全的映射同步到烈度卡」
       签名带上 metric：烈度 5 和震度 5 不是一回事，光看数值会误以为「没变化」。 */
    /* ★★★ 2026-10-28 用户：「警报更新的音效，有时候它不会响，它只更新不响，有概率失效」
       —— 旧签名只有 metric + 震度档位：只要震度没跳档，后面每一条报文都被判成
          「画面没变化」直接 return → 卡片明明在更新（报号在涨），却一声不响。
          官方是**每收到一条新报文就响一次** koushin（最后一报 koushinE）。
       ⇒ 签名加进 **报号**：新报文（报号变）= 必须响；
          只有同一报号被重复调用（比如升级那一帧重算）才去重。 */
    var sig = (E.metric || 'shindo') + '|' + grade + '|' + (+E.report || 1);
    if (sig === E._seSig) return;
    E._seSig = sig;
    /* ★ 交给音效引擎前把烈度换成等价震度码（见 soundLv 的说明），
       否则 eewStep 里 30/40 两个阈值对烈度永远不可能命中。 */
    var slv = soundLv(E.level, E.metric);
    var prev = (E._seLv == null) ? null : E._seLv;   /* _seLv 存的已经是震度码 */
    if (global.QVSpeak && global.QVSpeak.eew) {
      global.QVSpeak.eew({ lv: slv, prevLv: prev, report: n, plan: E.plan });
    } else if (global.QVSpeak && global.QVSpeak.beep) {
      global.QVSpeak.beep('eew', n);
    }
    E._seLv = slv;
  }
  /** ★ 「揺れを検出」提示音 NewInt0..6
   *  按用户表：0=轻微摇晃（绿框）｜1=略强（黄框）｜2=震度1以上｜3=震度2以上
   *            ｜4=震度3以上｜5=单测站 5弱以上｜6=单测站 6弱以上
   *  level 是 koneew 震度码（0/10/20/30/40/45/50/55/60/65/70），不是 0..6。 */
  /* ★★★ 2026-10-25 对积木：改造版 `grid周囲最大値を調べて効果音` 的 5×5 邻域。
     改造版算术（行宽 23）：
       `多目的1 = 番号 + floor(i/5) - 2*23 + (i mod 5) - 2`，i = 0..24
       → 行 -2..+2、列 -2..+2 共 25 格；且夹 `0 < 格号 < 530`。
     我们的格号 = `floor(lon) + 23*floor(lat) - 651`（与改造版同一套编号），
     所以直接按 (i,j) 邻域查同一张 `E.detKeep` 表就是等价实现。 */
  var DET_G = { w: 1.0, h: 1.0, lon0: 0, lat0: 0 };   /* rebuildAreas 每次重建时同步 */
  function detGridKey(lon, lat) {
    return Math.floor((lon - DET_G.lon0) / DET_G.w) + ',' +
      Math.floor((lat - DET_G.lat0) / DET_G.h);
  }
  /** 5×5 邻域内「格最大震度」的最大值（= 改造版的 @1 検出グリッド最大震度キープ 口径） */
  function gridNbMax(E, key) {
    if (!E || !E.detKeep || !key) return 0;
    var p = String(key).split(','), ci = +p[0], cj = +p[1];
    if (!isFinite(ci) || !isFinite(cj)) return 0;
    var best = 0;
    for (var dj = -2; dj <= 2; dj++) {
      for (var di = -2; di <= 2; di++) {
        var g3 = E.detKeep[(ci + di) + ',' + (cj + dj)];
        if (!g3) continue;
        var lv3 = +g3.lv || 0;
        if (lv3 > best) best = lv3;
      }
    }
    return best;
  }
  function playDetectSound(level, metric) {
    /* ★ 2026-10-26：烈度值先换成等价震度码，否则 NewInt0..6 永远停在 0/1 */
    var v = soundLv(level, metric);
    var n = v >= 60 ? 6 : v >= 50 ? 5 : v >= 40 ? 4 : v >= 30 ? 3 : v >= 20 ? 2 : v >= 10 ? 1 : 0;
    if (global.QVSpeak && global.QVSpeak.detect) global.QVSpeak.detect(n);
  }
  /* ★★★ 2026-10-27 官方「検出円」= **测站上的短提示**
     用户澄清（别再做错）：
       「这个圆就是一个 0.5-1.2 秒的地图测站提示，并且是固定大小的，
         并不是 EEW 阶段出来前的 P/S 波替代品」
     ⇒ 不跟波前长大、也不画在震央上：
        · 位置 = 触发该档位的那个测站
        · 大小 = 屏幕固定（mapcam 的 DET_PULSE_R）
        · 寿命 = 0.9 秒后淡出
        · 颜色 = NewInt 档位（官方 検出円 黄/橙/红/紫） */
  function detIdxOfCode(v) {
    v = +v || 0;
    if (v >= 60) return 6;
    if (v >= 50) return 5;
    if (v >= 40) return 4;
    if (v >= 30) return 3;
    if (v >= 20) return 2;
    if (v >= 10) return 1;
    return 0;
  }
  /** 在某个测站上弹一次検出円（lv 用该测站的震度码；烈度卡先换算成等价震度码）
   *  ★ 2026-10-27 对齐官方：寿命固定 0.75 秒（GHOST 40→100 线性） */
  function detPulseAt(ob, lvCode, metric) {
    if (!ob || !global.QVMapCam || !QVMapCam.detPulse) return;
    if (!isFinite(ob.lat) || !isFinite(ob.lon)) return;
    QVMapCam.detPulse({ lat: +ob.lat, lon: +ob.lon,
      lv: soundLv(lvCode, metric), lifeMs: 750 });
  }
  /* ★★★ 2026-10-27 官方自定义积木「震度上昇効果音 元震度 新震度 点番号」原文（dev 反编译）：
       if (元震度 < 新震度):                                  ← 只在上昇时
         if (元震度 = -3 且 该网格已报过更高): stop             ← 网格去重
         if ((元震度 > -3 且 新震度 <= 0) 或 (5→6) 或 (7→8)): 不响
         else 多目的1 = 新震度>6 ? 6 : (新震度>4 ? 5 : 新震度)
              if (効果音制御SE[2] < 多目的1): SE[2]=多目的1; SE[5]=点番号; SE[31]=现在
     主循环：if (-3 < SE[2]) → 播 NewInt{SE[2]}，SE[6]=现在，SE[2]=-3
     地図：if ((now-SE[6])*86400 < 0.75) → 在 SE[5] 那个测站画検出円
     新震度 是 9 档编码：0..4 原样、5弱=5、5強=6、6弱=7、6強=8、7=9 */
  function shindo9(code) {
    var v = +code || 0;
    if (v >= 70) return 9;
    if (v >= 65) return 8;
    if (v >= 60) return 7;
    if (v >= 55) return 6;
    if (v >= 45) return 5;                    /* 5弱：45 / 50 都算 */
    if (v >= 40) return 4;                    /* 震度4（码 40） */
    if (v >= 30) return 3;                    /* 震度3（码 30） */
    if (v >= 20) return 2;                    /* 震度2（码 20） */
    if (v >= 10) return 1;                    /* 震度1（码 10） */
    /* ★ 2026-10-28：以前只有 >=50 起步，`soundLv()` 换出来的 10/20/30/40 会被
       原样 round 成 10~40 → target 直接冲到 6（NewInt6）。现在按档归一化。 */
    return Math.max(0, Math.min(4, Math.round(v)));   /* 真值 0~4 */
  }
  /** ★★★ 2026-10-27 官方**主路径**（`検出id1_全点へ適用`，反编译第 3178〜3189 行）是按
   *  「検出 id」发布等级，不是「每个测站各自响」：
   *    每次扫全部测站 → 取该源(id)当前的震度档 → 只有 «新档 > 该 id 上次已发布的档»
   *    才调 `震度上昇効果音(元, 新, 点)`；同一批里 5弱→5強 / 6弱→6強 吞掉不响。
   *  ⇒ 一场地震只响「几个关键档」，不是每站一下（用户：「现实中没这么多声音」）。
   *
   *  ★ 但我们的模拟数据是「P 波一到就是终值」：第一帧的最大档已经是 6強，
   *    老实的实现就只剩 1 声（EEW 阶段再无声）。所以这里按官方的**逐档爬升**节奏补间：
   *    目标档 = 已到达测站的最大档，每次最多 +1 档、间隔 1.2 秒，
   *    直到追平目标（最多 6 档：1→2→3→4→5→6），听起来就是官方那种「几声就停」。
   *  `E._pubLv` = 已播到第几档（0..6，-1 = 还没响过）；`E._wantLv` = 目标档。 */
  var DET_STEP_MS = 1200;
  function detSfxScan(E, list, lim) {
    if (!E || !list || !list.length) return;
    var best = null, max9 = 0;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || !isFinite(o.lat) || !isFinite(o.lon)) continue;
      if (lim > 0 && ((o.epi != null ? +o.epi : (o.hyp || 0))) > lim) continue;
      /* ★★★ 2026-10-28 用户：「烈度区这个音效上映射表了吗」
         —— 以前直接 `shindo9(o.shindo)`，而烈度区 o.shindo 是 **烈度 1~12**：
            烈度 5（= 震度4）会被当成 5弱、烈度 7（= 5弱）当成 6弱 → NewInt 档位偏快。
         ⇒ 先用 soundLv() 按对照表换成等价震度码再取档。 */
      var c9 = shindo9(soundLv(o.shindo, E.metric));
      if (c9 > max9) { max9 = c9; best = o; }
    }
    if (!best || max9 <= 0) return;                     /* 震度 0 不响 */
    var target = max9 > 6 ? 6 : (max9 > 4 ? 5 : max9);  /* 0..6（NewInt 档） */
    if (target > (E._wantLv == null ? -1 : E._wantLv)) E._wantLv = target;
    var pub = (E._pubLv == null) ? -1 : E._pubLv;
    if (E._wantLv <= pub) return;                       /* 没越过已发布的档 */
    var now = Date.now();
    /* 首声立刻响，之后每档间隔 1.2 秒（模拟数据一到位就是终值，靠这个还原"逐档上升"的听感） */
    if (pub >= 0 && now - (E._sndAt || 0) < DET_STEP_MS) return;
    var step = pub + 1;
    if (step < 1) step = 1;
    E._pubLv = step;
    E._sndAt = now;
    /* 同象限相邻档吞掉（官方 5弱→5強 / 6弱→6強 不响） */
    if (step === 6 && pub === 5) { E._pubLv = 6; return; }
    if (global.QVSpeak && QVSpeak.detect) QVSpeak.detect(step);
    /* 圆的颜色跟着这一档走（code：1/2/3、4=橙、50=红、60=紫） */
    var codeForPulse = step >= 6 ? 60 : (step === 5 ? 50 : step);
    detPulseAt(best, codeForPulse, 'shindo');
  }
  function hideDetCircle() {
    if (global.QVMapCam && QVMapCam.clearDetPulse) QVMapCam.clearDetPulse();
  }
  /** 在 #view1 内画 EEW 页（用官方 paEEW 面板底图） */
  var eewScroll = 0;   /* EEW panel vertical scroll (whole card moves) */
  /* ★★★ 2026-10-27 官方文言（paEm0..paEm9）的中文对照表
     —— 官方素材是整图、字烧死在 path 里，改不了字，所以 Chinese 版自己画。
        几何/字色 1:1 照官方：196×34、两行、白 #dbe9ff / 黄 #ffd253 / 红 #ff4b41。
        索引与官方造型号一一对应。 */
  var PAEM_CN = {
    0: ['紧急地震速报（预报）发布', '请注意摇晃', 'lit'],
    1: ['紧急地震速报（预报）发布', '请留意后续情报', 'lit'],
    2: ['紧急地震速报（警报）发布', '请警惕强烈摇晃', 'warn'],
    3: ['这是紧急地震速报特别警报', '请确保自身安全', 'emg'],
    4: ['可能发生海啸', '请立即离开海岸', 'warn'],
    5: ['使用的观测点较少', '震源精度可能偏低', 'lit'],
    6: ['该地区观测点较少', '震源精度可能偏低', 'lit'],
    7: ['因震源较深，远离震中处', '摇晃可能更强烈', 'lit'],
    8: ['检测到较大加速度', '按震度5弱假设发布', 'warn'],
    9: ['发布值为实时震度直接推算', '', 'warn']
  };
  function drawEEW() {
    if (!L1 || !L1.inner) return;
    if (L1.note) L1.note.style.display = V.eew ? 'none' : '';
    /* ★ 「表示するものはありません」= view1 的空状态造型 `nashi`（192×24 @24,348）。
       ★ 2026-10-21：这张官方图不画了，换成同位置的**中文**文字层（L1.nashi），
       所以这里改切中文层；有速报时收起它。 */
    if (L1.nashi) L1.nashi.style.display = V.eew ? 'none' : '';
    var host = L1.eew;
    /* ★ 2026-10-21 震度速報（jishin）阶段已交给 Tab1 详细栏（render3）的卡片显示，
       实时页这张速报卡不再画 —— 否则会盖着地图空跑。
       ★★★ 2026-10-29 用户：「日本地震 api 发紧急地震速报时，Tab2 里的卡变成了
          各地震度速报」—— 真实速报（E.q.isEew）走到 VXSE51（震度速報）阶段时，
          Tab2 这张【紧急地震速报】卡必须留着：用户就是在 Tab2 看速报的。
          只有「模拟地震」那条时间轴才让位给 Tab1 的「震度速報・調査中」卡。 */
    /* ★★★ 2026-10-30 用户：**「可能有摇晃的地区」只给真实电文用**。
       —— 模拟地震的 q（fireSim 里的 SIMQ）也带 `isEew: 1`，
          以前只判 `q.isEew` → 模拟卡片被当成真实速报：
          表头变成「可能有摇晃的地区」、列表还丢掉震度小图（用户报的就是这个）。
       ⇒ 判据 = realEew / mode==='real' /（isEew 且不是 sim）。 */
    var _realEew = !!(V.eew && (V.eew.realEew || V.eew.mode === 'real' ||
      (V.eew.q && V.eew.q.isEew && !V.eew.q.sim)));
    if (V.eew && V.eew.kind === 'jishin' && !_realEew) { if (host) host.style.display = 'none'; return; }
    if (!V.eew) { if (host) host.style.display = 'none'; return; }
    if (!host) {
      host = el('div', '', { id: 'eewpage' });
      L1.inner.appendChild(host);
      L1.eew = host;
    }
    var E = V.eew, red = eewRed(E.level, E.metric);
    /* ★★★ 2026-10-20 用户（图一）：震度没到预警程度时，官方不发紧急地震速报，
       而是「揺れを検出」——只有一列「检测到摇晃的地区」，没有震度卡 / 规模 / 深度。 */
    var det = (E.kind === 'detect');
    /* ★ 2026-10-21 eewC：紧急地震速报的【取消报】（误报/误检测被撤销）。
       数据侧 data.js 早就解析了 q.isCancel（srcEewOne 里），但 views 一直没用。
       cancel 态复用同一张 paEEW 底图，只把标题右侧改成「取消」，
       震度块/震源/规模/津波条全部收起，中间换成一句取消提示。 */
    var can = (E.kind === 'cancel');
    /* ★ 2026-10-23 长周期地震动階級副卡：只有拿到 maxLg 才画
       （wolfx EEW 不带这项 → 平时不出现；dmdata VXSE62 / VXSE53 到了才有） */
    /* ★ 2026-10-25：階級 0 = 没有长周期地震动 → 不画副卡。
       以前写 `>= 0` → maxLg=0 也画，而且 sndl 只有 1~4 → 数字被抬成 1，
       配色拿 paScl['0']（灰）→ 就是那张「灰色 1」的怪卡。 */
    var lgv = (E.maxLg != null && E.maxLg > 0) ? (E.maxLg | 0) : -1;
    /* ★★★ 2026-10-26 用户截图：「宮城県沖 + 最大震度 7 + 推定 最大长周期地震动阶级 3」这张缝合怪
       → inq 原来定义在下面三十多行（blkSrc 之前），而 var 只提升声明不提升赋值，
         所以这里的 `!inq` 恒为 true（!undefined）→ 调查中卡上硬塞了长周期副卡。
       现在提前到这里定义，调查中阶段 hasLc 必为 false。 */
    /* ★★★ 2026-10-26 用户：「调查中那个紧急地震速报卡片应该还在的呀，
       按理来说不应该反复切换的是这两个吗？」
       → 【两张卡分属两个页面】：
         Tab2 实时页（本函数 host = L1.eew）始终画【紧急地震速报】卡；
         Tab1 详细栏（render3.js）画【震度速報・計測中】卡。
       以前这里用 inq 原地把 EEW 卡换成调查中卡 → EEW 卡“消失”了，
         而且两张卡根本不在一个页面上，永远不可能互相切换。
       所以这里锁死 inq = false。 */
    var inq = false;
    var hasLc = !det && !can && !inq && lgv >= 0;
    /* ★ 2026-10-21 震源情報（VXSE52）：JMA 标准流程的一环，留在实时页。
       「各地の震度情報」（VXSE53）是正式报 → 按用户要求切到信息页，不在这里画。 */
    host.className = det ? 'detect' : (can ? 'cancel' : (inq ? 'info' : (red ? 'red' : '')));
    if (hasLc) host.className += ' haslc';
    var t = new Date(E.timeMs || Date.now());
    var hh = ('0' + t.getHours()).slice(-2), mm = ('0' + t.getMinutes()).slice(-2), ss = ('0' + t.getSeconds()).slice(-2);
    var date = t.getFullYear() + '/' + ('0' + (t.getMonth() + 1)).slice(-2) + '/' + ('0' + t.getDate()).slice(-2);
    var card = (global.QVShindo && QVShindo.colorOf) ? QVShindo.colorOf(E.level) : (red ? '#e10000' : '#f2d21a');
    var lvTxt = shindoText(E.level, E.metric);
    /* ★★★ 2026-10-25 深源地震：EEW 阶段官方**不发震度**
       （样本《2026 日本海北部 M5.6 深350km》全程「深源地震震度不明」，
        直到「各地震度情報」才给最大震度 1）。
       ⇒ 借用官方 `paSc-1`（灰底板）与 `snd-1`（「不明」数字）两个造型，
         不要自己编一个「灰色 0」。
       ⚠️ 只改显示：E.level 保持 GMPE 值，地图色块 / 海啸判定 / 音效分档都不受影响。 */
    var unkLv = !!(E.deepSrc && !E.measured && E.kind === 'eew');
    /* ★ 卡片直接复用主界面那套官方素材：paSc（色块 182×70）+ snd（大号数字 70×70） */
    var VV = global.QV_VAR || {};
    var suf = global.QV_SC_SUF ? global.QV_SC_SUF(unkLv ? -1 : E.level) : (unkLv ? '-1' : '1');
    /* ★ 2026-10-29: 只要是 unknown（深源不明或 level 缺失），都按 208×80 墨迹卡定位，防止拉伸溢出 */
    var isUnkCard = unkLv || (suf === '-1') || (E.level == null);
    var blk = (VV.paSc && (VV.paSc[suf] || VV.paSc['1'])) || '';
    var dig = (VV.snd && (VV.snd[suf] || VV.snd['1'])) || '';
    var darkNum = (E.metric !== 'liedu' && +E.level >= 2 && +E.level <= 4);
    var lab = E.metric === 'liedu' ? '最大烈度' : '最大震度';
    /* ★★★ 2026-10-21 用户：「你烈度卡没适配啊？？？」
       烈度卡是 1~12 度，而官方 paSc / snd / paSu 造型只有震度 0..9 十档
       （烈度 8 会被画成震度6强、烈度 12 画成震度7，标题还写着「最大震度」）。
       有 QV_LIEDU 时整块自己生成同尺寸的图：色块 248×120、白字 208×80、大号数字 80×80。 */
    var LIE = global.QV_LIEDU;
    var lieM = (E.metric === 'liedu') && !!LIE;
    /* ★ 2026-10-21 「震度速报」阶段（EEW 报完之后）：
       卡片标签用 paSs（「最大震度」，不带「推定」），与官方截图一致。 */
    /* ★★★ 2026-10-26 用户：「一闪就过去了，直接跳到震原速报，不是震原速报-调查中」
       = "调查中卡片只闪 0.8 秒"。
       根因：inq 只认 kind==='info'，但调查中阶段 kind 是 'jishin'；
         而 'info' 只在 step 循环里存在 800ms 就被改回 'jishin'
         → 调查中底图 paIdbg / 标题 paItiSokuho 只出现不到一秒。
       两个 kind 本来就是同一张卡（都叫「震度速報」），一起认。 */
    /* inq 已在上面（lgv 之后、为了 hasLc 能正确判断）提前定义，不要在此重复声明 */
    var blkSrc = lieM ? LIE.blockSrc(E.level) : ('assets/' + blk);
    var digSrc = lieM ? LIE.numeralSrc(E.level) : ('assets/' + dig);
    /* 官方标签图自己就写着「推定 最大震度」；实测后换成不写「推定」的 paSs 版
       ★ 深源：直接用官方 `sndhs`（「深発地震のため / 震度不明」整图 208×80），
         不再拼 paSu 标签 + snd-1 数字 —— 那两张叠起来不是官方图1 的样子。 */
    var labSrc = unkLv ? EEW_ART.sndhs
      : (lieM ? LIE.labelSrc(E.level) : ((inq || E.measured) ? EEW_ART.paSs : EEW_ART.paSu));
    /* 官方文言用**整图**（paEm*），不再手写中文两行
       ★ 深源地震用官方 paEm7（震源が深いため…），这也是官方素材。
       ★★★ 2026-10-27 补齐官方全部状态（选法优先级：深源 > 特别警报 >
           观测点少（震源精度低）> 警报 > 预报）：
         · 特别警报 = 震度6弱以上 / 烈度8以上（JMA 发布基准）
         · 观测点少 = 当前已收到的测站 < 20 个 */
    /* ★ 2026-10-28：按新对照表，「特别警报」= 震度6弱 那一档 ⇒ 烈度 9（以前写 8 = 5強，偏早） */
    var specWarn = (E.metric === 'liedu') ? (+E.level >= 9) : (+E.level >= 60);
    var obsN = (E.obs && E.obs.length) || 0;
    var obsFew = (!unkLv && obsN > 0 && obsN < 20);
    /* 选哪一条（索引 = 官方 paEm0..paEm9） */
    var msgKey = unkLv ? 7 : (specWarn ? 3 : (obsFew ? 6 : (red ? 2 : 0)));
    var MSG_IMG = { 0: EEW_ART.paemY, 2: EEW_ART.paemR, 3: EEW_ART.paemSpecial,
      6: EEW_ART.paemFew, 7: EEW_ART.paemDeep };
    var msgImg = MSG_IMG[msgKey] || EEW_ART.paemY;
    /* 中文版（烈度区用；日本震度区保持官方日文原图） */
    var msgHtml;
    if (lieM && PAEM_CN[msgKey]) {
      var _mc = PAEM_CN[msgKey];
      /* ★ 官方每条文言的字号是**自动缩放**的（画布宽 196、汉字/假名都是正方形）：
            paEm3（13 字）→ 15px；paEm5（17 字）→ 11.5px。
         所以这里按最长行的字数算字号，上限 15px，和官方一脉一样。 */
      var _nC = Math.max(_mc[0].length, (_mc[1] || '').length) || 1;
      var _fs = Math.min(15, Math.floor((196 / _nC) * 10) / 10);
      msgHtml = '<div class="paemtx ' + _mc[2] + '" style="font-size:' + _fs + 'px">' +
        '<i>' + _mc[0] + '</i>' + (_mc[1] ? ('<i>' + _mc[1] + '</i>') : '') + '</div>';
    } else {
      msgHtml = '<img src="' + msgImg + '">';
    }
    /* 官方色阶条配色（主界面同一套算法，QVRender.magColor/depColor 已导出） */
    var magC = '', depC = '';
    try {
      if (global.QVRender && QVRender.magColor) magC = QVRender.magColor(E.mag) || '#828282';
      if (global.QVRender && QVRender.depColor) depC = QVRender.depColor(E.depth) || '#828282';
    } catch (e) { }
    var repTxt = '第' + E.report + '报';
    /* ★ 2026-10-23：推定/实测由官方标签图区分（paSu=推定版 / paSs=非推定版），
       不再额外加中文徽标 —— 官方卡片本来就没这个。 */
    /* ★★★ 2026-10-21 「震度速报」阶段——inq 已移到上面定义（标签要用 paSs） */
    /* 地区列表：速报态带震度小图；検出态只有地名（官方 paDbg0 列表就是纯文字） */
    var areasHtml = '<ul class="areas">' + (function () {
      /* ★★ 2026-11-03 天体模式：列表数据源换成本天体的测站
         （用户：「不是让你搞了测站名字生成器吗，为什么没有观测点震度信息」） */
      if (global.QVPlanet && global.QVPlanet.isPlanet() && global.QVPlanet.stationRows) {
        var rs = global.QVPlanet.stationRows();
        if (rs && rs.length) {
          return rs.map(function (r) {
            /* 天体用的是中国烈度刻度 1~12，而 EEW_ART.sndm 只有震度 0~9 的图
               → 直接用烈度色块，否则全部回落到 sndm['0']（一片灰 0）。 */
            var im = (LIE && LIE.smallBadgeSrc) ? LIE.smallBadgeSrc(r.level)
              : (EEW_ART.sndm[String(r.level)] || EEW_ART.sndm['0']);
            return '<li><img src="' + im + '"><span>' + r.name + '</span></li>';
          }).join('');
        }
      }
      /* ★ 调查中阶段：气象厅还在算，行政区是一批一批放出来的
         → 只显示前 ipf.batch*5 个（每批 1~5 个），看得出“陆续进来”的感觉。 */
      var _al = (E.areas || []).filter(function (a) {
        if (!a) return false;
        /* ★ 2026-10-30：震度 <1 不显示**只属于真实电文**（JMA 予報区域）。
           模拟（含检测态）保持原样：震度0 / 摇晃格也要列出来。 */
        if (_realEew) {
          if (a.level != null && +a.level < 1) return false;
          if (a.shindo != null && +a.shindo < 1) return false;
        }
        return true;
      });
      if (_realEew && !inq) {
        _al = _al.slice().sort(function (a, b) {
          var la = (a && a.level != null) ? +a.level : 0;
          var lb = (b && b.level != null) ? +b.level : 0;
          return lb - la;
        });
      }
      if (inq && E.ipf && E.ipf.batch) {
        var _cap = E.ipf.batch * 5;
        if (_al.length > _cap) _al = _al.slice(0, _cap);
      }
      return _al.map(function (a) {
        var nm = (typeof a === 'string') ? a : a.name;
        if (det || _realEew) return '<li><span>' + nm + '</span></li>';
        if (typeof a === 'string') return '<li><img src="' + EEW_ART.sndm['1'] + '"><span>' + nm + '</span></li>';
        var s2 = (global.QV_SC_SUF ? String(QV_SC_SUF(a.level)) : String(Math.round(a.level)));
        var img = lieM ? LIE.smallBadgeSrc(a.level) : (EEW_ART.sndm[s2] || EEW_ART.sndm['0']);
        return '<li><img src="' + img + '"><span>' + nm + '</span></li>';
      }).join('');
    })() + '</ul>';
    host.innerHTML = det
      ? ('<div class="dbgw">' +
        '<img class="dbg" src="' + EEW_ART.dbg + '">' +
        /* ★ 2026-10-30 恢复：検出态（只有模拟会走到）表头就是「检测到摇晃」，
           「可能有摇晃的地区」是给真实电文（EEW 予報区域）用的，别混。 */
        '<div class="dbgh">检测到摇晃</div>' + areasHtml + '</div>')
      : (
      /* ★ 2026-10-23 有长周期階級 → 换官方高版底图 paEEW4/5（264×500），不是加一块 */
      '<img class="bg" src="' + (inq ? EEW_ART.paIdbg :
        (hasLc ? (red ? EEW_ART.paEEW5 : EEW_ART.paEEW4) : (red ? EEW_BG.r : EEW_BG.y))) + '">' +
      /* 「震度速報・调查中」和「震度速報・确定」用的是**同一个标题** paIti1（ⓘ 震度速報），
         用户给的官方截图里明确写着「震度速報」，不是 paIti3（各地の震度情報）。 */
      (inq ? '<img class="bandli" src="' + EEW_ART.paItiSokuho + '">' :
        ('<div class="bandl">紧急地震速报</div>' +
          '<div class="bandr">' + (can ? '取消' : (red ? '警报' : '预报') + (E.isFinal ? ' 最终' : ' #' + ('0' + E.report).slice(-2))) + '</div>' +
          '<img class="paet" src="' + EEW_ART.paet + '">' +
          '<div class="mag"><em>震级</em><b>' + (isFinite(E.mag) ? 'M' + E.mag.toFixed(1) : '—') + '</b></div>' +
          '<div class="bar m"' + (magC ? ' style="background:' + magC + '"' : '') + '></div>' +
          '<div class="dep"><em>深度</em><b>' + (isFinite(E.depth) && E.depth >= 0 ? Math.round(E.depth) + 'km' : '—') + '</b></div>' +
          /* ⚠️ 2026-10-21 修复：这一行原来少了结尾的 `>`（写成 `'</div>'`），
             innerHTML 把 `</div>` 当成了属性 → .bar.d 永远不闭合 →
             .paem / .place / .ptime / .lvcard / .tsuq 全被吞进 .bar.d 里，
             震度卡就"飞"到地图中间去了。必须是 `'></div>'`。 */
          '<div class="bar d"' + (depC ? ' style="background:' + depC + '"' : '') + '></div>' +
          '<div class="paem">' + msgHtml + '</div>')) +
      /* 取消报的遮罩提示（仅 .cancel 态显示）。
         官方原版是「模糊原数据 + 压字」：震度块/震级那段变暗，
         顶部的震源时刻和底部的深度仍清楚可见 —— 所以放在 lvcard 之后、dbgw 之前，
         靠 z-index 盖在震度块上面。 */
      '<div class="cncl"><b>取消</b><span>本次紧急地震速报<br>已取消</span></div>' +
      /* 震源地名（左）/ 発生時刻（下一行）；震度速报态震源未定 → 只留时间 */
      '<div class="place">' + E.place + '</div>' +
      '<div class="ptime">' + (t.getMonth() + 1) + '月' + t.getDate() + '日 ' + t.getHours() + ':' + ('0' + t.getMinutes()).slice(-2) + '左右</div>' +
      '<div class="lvcard' + (isUnkCard ? ' unk' : '') + '">' +
      '<img class="lvbg" src="' + blkSrc + '">' +
      /* ★★★ 2026-10-25 深源：官方就是两张 208×80 叠在一起 ——
         paSc-1（灰蓝圆角底板）+ sndhs（「深発地震のため / 震度不明」透明文字层）。
         用户图1 就是这个组合，**不再自己写文字、也不画 snd-1 数字**。 */
      '<img class="lvlab" src="' + labSrc + '"' + (darkNum ? ' style="filter:brightness(.11)"' : '') + '>' +
      (unkLv ? '' : ('<img class="lvnum" src="' + digSrc + '"' +
        (darkNum ? ' style="filter:brightness(.11)"' : '') + '>')) +
      '</div>' +
      /* 长周期副卡：
         ★ 2026-10-26 用户：「烈度区特供版：长周期震感 轻微，有感，明显，强烈」
           —— JMA 的「長周期地震動階級 1~4」在中国烈度区没有对应概念，
              硬搬就是「中国的卡写日本的等级」。
           ⇒ 烈度区：色块仍用官方 paScl（1..4 四档），文字改「长周期震感」+ 定性词；
              震度区：保持官方原样（推定 / 最大长周期地震动阶级 + sndl 数字）。
         ★★★ 2026-10-27 用户：「地震周期1级的字体为什么是白色的都看不清，应该是黑色」
           —— sndl1 素材本身是白色数字（fill #ffffff），paScl1 又是黄底 → 白字消失。
           ⇒ 階級 1（黄底）整块文字/数字转深色（数字用 brightness(.11)，与震度卡 darkNum 同法）。 */
      (hasLc ? ('<div class="lc' + ((lgv === 1) ? ' darknum' : '') + '">' +
        '<img class="lcbg" src="' + (EEW_ART.paScl[String(Math.min(4, lgv))] || EEW_ART.paScl['0']) + '">' +
        (lieM
          ? ('<div class="lclb lie"><b>长周期震感</b></div>' +
            /* ★ 2026-10-27 用户：「中国特供长地震周期卡片改成 1=有感 2=明显 3=强烈 4=剧烈」 */
            '<div class="lcword">' + ['', '有感', '明显', '强烈', '剧烈'][Math.min(4, Math.max(1, lgv))] + '</div>')
          : ('<div class="lclb">' + (E.measured ? '' : '<i>推定</i>') + '<b>最大长周期<br>地震动阶级</b></div>' +
            '<img class="lcnum" src="' + (EEW_ART.sndl[String(Math.min(4, Math.max(1, lgv)))] || EEW_ART.sndl['1']) + '">')) +
        '</div>') : '') +
      /* 震度速报态：「津波　調査中」灰底圆角条（官方 paTsuInq 228×60，卡下方独立一条） */
      '<img class="tsuq" src="' + EEW_ART.paTsuInq + '">' +
      '<div class="dbgw">' +
      '<img class="dbg" src="' + EEW_ART.dbg + '">' +
      '<div class="dbgh">' + (_realEew ? '可能有摇晃的地区' : (lieM ? '观测烈度' : '观测震度')) + '</div>' +
      areasHtml + '</div>');
    host.style.display = '';

    /* ★ 观测震度面板：高度铺到可见底（底色由 CSS .dbgw 自己管，不靠 art 层底板） */
    var gwEl = host.querySelector('.dbgw');
    if (gwEl) {
      /* 2026-10-20: 用【舞台实际高度】而不是 QVVisibleH()（后者被 720 夹住）。
         窗口比例不是 4:3 时 stage 会到 795 -> 720-366=354 被 356 顶住，
         面板在 722 就断了，下面露一条黑（用户截图那块缺的）。 */
      var stEl = document.getElementById('stage');
      var sh = 720;
      if (stEl) {
        /* ★ 同上：逻辑高 = rect.height / 真实缩放比（不是 rect.width/960） */
        var rr = stEl.getBoundingClientRect();
        var kk = stEl.offsetWidth ? (rr.width / stEl.offsetWidth) : 1;
        sh = Math.round(rr.height / (kk || 1));
      }
      /* 2026-10-20 (4th pass): growing the panel by row count made it overflow the
         stage (838 > 795) so the tail was off-screen AND scrolling never kicked in
         (panel height == content height). Pin the panel to the stage bottom instead;
         .areas then has max-height calc(100% - 48px) + hidden-scrollbar scrolling. */
      /* Whole-panel scrolling: the EEW card + list move together. Panel content is
         366 (top) + 48 (header) + rows*32 + 8 (pad). */
      var vrows = host.querySelectorAll('.areas li').length;
      /* 検出态面板从 y=8 起（CSS .detect）；震度速報 paIbg130 → 278；
         震源情報 paIbg138 → 284（⚠ 两处都必须跟 app.css 的 .dbgw top 对齐）；
         紧急地震速报 paEEW（388 高）→ 366 */
      var topOff = det ? 8 : (inq ? 278 : (hasLc ? 422 : 366));
      var contentH = topOff + 48 + vrows * 32 + 8;
      /* ★ 2026-10-21 用户（截图）：「底下留出黑色背景太多了」
         検出态只有几行时会走到 Math.max(200, …) 这个下限 → 面板到 y=208 就断了，
         下面全是页面黑底。以前 min=200 是怕面板太短难看，
         但官方这里是【一列到底】：面板直接铺到舞台可见底（高度 = sh - topOff），
         行数多的时候才靠整块滚动。 */
      var minH = (det || inq) ? Math.max(200, sh - topOff) : 356;
      gwEl.style.height = Math.max(minH, 48 + vrows * 32 + 8) + 'px';
      var maxS = Math.max(0, contentH - sh);
      if (eewScroll > maxS) eewScroll = maxS;
      if (eewScroll < 0) eewScroll = 0;
      host.style.transform = eewScroll ? 'translateY(' + (-eewScroll) + 'px)' : '';
      host.dataset.maxScroll = String(maxS);
      if (!host.dataset.wheelBound) {
        host.dataset.wheelBound = '1';
        host.addEventListener('wheel', function (ev) {
          var mx = +(host.dataset.maxScroll || 0);
          if (!mx) return;
          ev.preventDefault();
          ev.stopPropagation();
          eewScroll = Math.max(0, Math.min(mx, eewScroll + ev.deltaY));
          host.style.transform = eewScroll ? 'translateY(' + (-eewScroll) + 'px)' : '';
        }, { passive: false });
      }
    }

    /* ★★★ 数值 / 时刻 / 地名 一律走【官方字形层】（用户：「一看字体就知道没用官方的东西」）
       —— 官方 sj 字形（数字/·/:/k=km 连字/月m/日d）+ 官方 nm 地名零件。
       坐标（#eewpage 内部，100% 渲染；推导见 app.css 顶部）：
         地名 nm x5 y30   → 左缘 30.75，中心线 82
         时刻 dej x85 y32 → 右对齐到 224，中心线 88
         规模 SMAG x91 y112 → 中心线 225.75，右对齐到 198（官方色条在 202..218）
         深度 SDEP x91 y136 → 中心线 267.75 */
    var T = global.QVT;
    var prevGl = host.querySelector('.qvgl');
    if (prevGl) prevGl.parentNode.removeChild(prevGl);
    if (T && !det) {
      var gl = document.createElement('div');
      gl.className = 'qvgl';
      gl.style.cssText = 'position:absolute;left:0;top:0;width:232px;height:360px;pointer-events:none';
      host.appendChild(gl);
      /* ① 震源地名：卡片顶部第一行（CSS 中心 y≈64） */
      var pe = host.querySelector('.place');
      /* 地名：100→120（用户反馈偏小）；长地名仍按 2000/字数 自动缩 */
      if (T.place(gl, E.place, T.placeSize(E.place, 120), 18.3, 64, 'left') && pe) pe.style.display = 'none';
      /* ② 発生日時：第二行（CSS 中心 y≈91）；与第一页同格式「M月D日 H:MM左右」、同字号 */
      var pte = host.querySelector('.ptime');
      var md = (t.getMonth() + 1) + '月' + t.getDate() + '日 ' + t.getHours() + ':' + ('0' + t.getMinutes()).slice(-2) + '左右';
      if (T.num(gl, md, 46, 18.3, 91, 'left') && pte) pte.style.display = 'none';
      /* ③ 规模（右对齐到色阶槽左侧，中心 y≈232）
         ★ 调查中阶段不出数字（卡片上是「调查中」），官方字形层也要跳过 */
      var yShift = hasLc ? 56 : 0;      /* 官方高版底图把规模/深度行整体下移 56px */
      var bm = host.querySelector('.mag b');
      if (!inq) {
        if (T.num(gl, isFinite(E.mag) ? E.mag.toFixed(1) : '', 89, 188, 232 + yShift, 'right') && bm) bm.style.display = 'none';
      }
      /* ④ 深度（sjk = 「km」连字，所以只写 k；中心 y≈279） */
      var bd = host.querySelector('.dep b');
      var depTxt = (isFinite(E.depth) && E.depth >= 0) ? (Math.round(E.depth) + 'k') : '';
      if (!inq) {
        if (T.num(gl, depTxt, 79, 188, 279 + yShift, 'right') && bd) bd.style.display = 'none';
      }
    }
  }

  /* ⚠️ 2026-10-20：原来的 drawEEWNums()（官方 nm/sj 字形层）已删除。
     原因：EEW 页的地名/時刻/M/深度 现在全部走**中文层 + 官方几何坐标**
     （见 app.css 顶部那段推导），再叠一层 sj 字形只会互相覆盖、
     而且 dej/SMAG 的槽位一直没量准（交接文档 §26.9）。 */

  var SIM_AREA_DEMO = [
    '# 区域码,名称,等级1-4,预计高度,首波条件(可空),到达分钟偏移(可空)',
    '200,青森県太平洋沿岸,3,3m,津波到達中と推測,-20',
    '240,岩手県,3,3m,津波到達中と推測,-18',
    '101,北海道太平洋沿岸中部,3,3m,ただちに津波襲来と予想,',
    '102,北海道太平洋沿岸西部,2,1m,津波到達中と推測,-10',
    '100,北海道太平洋沿岸東部,2,1m,到達予想,35',
    '320,宮城県,2,1m,到達予想,35',
    '210,青森県日本海沿岸,2,1m,到達予想,40'
  ].join('\n');
  var SIM_H = ['', '<0.2', '1m', '3m', '5m', '10m', '10m<', '高い', '巨大'];
  var SIM_OPT_TLV = [['0', '无海啸'], ['1', '津波予報（若干の海面変動）'], ['2', '津波注意報'],
    ['3', '津波警報'], ['4', '大津波警報']];
  var SIM_OPT_COND = [['', '（无到达情报）'], ['到達予想', '到達予想 HH:mmごろ'],
    ['第１波の到達を確認', '第1波の到達を確認'], ['津波到達中と推測', '津波到達中と推測'],
    ['ただちに津波襲来と予想', 'ただちに津波襲来と予想']];
  function selOpts(list, cur) {
    return list.map(function (o) {
      return '<option value="' + o[0] + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
  }
  function simNum(id, def) {
    var e = sim.querySelector('#' + id), v = parseFloat(e && e.value);
    return isFinite(v) ? v : def;
  }
  function simVal(id, def) {
    var e = sim.querySelector('#' + id);
    return (e && e.value !== '') ? e.value : def;
  }
  /** ★★ 2026-11-03 天体模式的「摇晃时间」—— 只在本体非地球时显示。
   * 火星：M2.5 → 5 分；M3.5 → 30 分；M4.7（S1222a）→ 4.5 小时；夹顶 5 小时。
   * 月球：深源月震尾波极长，M5.5 → ≈ 52 分。
   * 超过该天体有记录以来的最强震级 → 条变红，提示「切换至科幻模式」。
   */
  function syncShakeBar() {
    if (!sim) return;
    var bar = sim.querySelector('#simShake');
    if (!bar) return;
    var P = global.QVPlanet;
    /* 时间加速下拉框：每次打开面板都跟当前值对齐（地球模式下也要同步） */
    var spdSel = sim.querySelector('#simSpeed');
    if (spdSel && P && P.speed) {
      var curSpd = P.speed();
      var has = false;
      for (var oi = 0; oi < spdSel.options.length; oi++) {
        if (+spdSel.options[oi].value === curSpd) { spdSel.value = spdSel.options[oi].value; has = true; }
      }
      if (!has) spdSel.value = '1';
    }
    if (!P || !P.isPlanet()) { bar.hidden = true; bar.textContent = ''; return; }
    var b = P.body();
    var mn = sim.querySelector('#simMag');
    /* ★ 天文模式下 M 的默认值要跟着天体走：火星上限 M5、月球 M5.5，
       而模拟面板的地球默认值是 6.5 → 一打开就是红字「已超越物理极限」。
       只在【换天体】时改一次，不覆盖用户手动输入的值。 */
    if (mn && sim._magBody !== b.key) {
      sim._magBody = b.key;
      var m0 = (b.key === 'mars') ? 4.7 : (b.key === 'moon' ? 5.0 : 6.5);
      mn.value = m0;
      var mr0 = sim.querySelector('#simMagR');
      if (mr0) mr0.value = Math.min(9.9, m0);
    }
    var m = parseFloat(mn && mn.value);
    if (!isFinite(m)) m = 6.5;
    var over = m > b.magMax + 1e-6;
    var sec = b.durSec(m);
    bar.hidden = false;
    bar.className = 'shakebar' + (over ? ' over' : '');
    if (over) {
      bar.innerHTML = '<b>已超越' + b.name + '真实物理极限（M' + b.magMax + '）</b>' +
        '<span>切换至科幻模式　·　摇晃时间 ' + P.fmtDur(sec) + '</span>';
    } else {
      bar.innerHTML = '<b>' + b.name + '特供：长尾震动</b>' +
        '<span>摇晃时间 ≈ ' + P.fmtDur(sec) + '　·　' +
        (b.key === 'mars'
          ? '典型 M2.5~3.5，S1222a M4.7 主震 4~5 小时、尾波可拖过 10 小时'
          : '浅源热震 M1~2，深源月震可到 M5 级，尾波极长') +
        '</span>';
    }
  }
  /* ══════════════════════════════════════════════════════════════
     震源地名自动填充（2026-10-26 用户：「地原名字在模拟地震中可以自动填充吗
     根据用户放的震中区域，我们现在不是有区划地名吗」）
     · 日本/琉球：QV_SHINDO_AREAS.areas[code].name（JMA 细分区域，如「青森県三八上北」）
     · 中国大陆：QV_CN_AREAS（地级市轮廓，如「雅安市」）
     · 海里：最近的那个区域/城市名 + 「沖」/「近海」（官方就是这么写的：宮城県沖）
     · 都不命中 → 返回空串，调用方保留原值
     ⚠️ 次序 = 先精确多边形、再近邻：
        ① QVShindo.areaOf(lon,lat)（JMA 多边形内）② 中国地级市多边形内
        ③ 日本近海 → 最近 JMA 区域 + 沖    ④ 中国近海 ≤50km → 城市 + 近海
     ══════════════════════════════════════════════════════════════ */
  /** 单个地级市：先看第 0 环（外轮廓）在不在里面，再看后面的环（洞）排不排掉 */
  function inCnAreaPoly(a, lon, lat) {
    var rings = a.p || [];
    for (var i = 0; i < rings.length; i++) {
      var parts = rings[i].split(' '), n = parts.length, inside = false;
      for (var j = 0, k = n - 1; j < n; k = j++) {
        var pj = parts[j].split(','), pk = parts[k].split(',');
        var xi = +pj[0], yi = +pj[1], xj = +pk[0], yj = +pk[1];
        if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
      }
      if (i === 0) { if (!inside) return false; }      /* 不在外轮廓里 → 不是它 */
      else if (inside) return false;                   /* 落在洞里 → 不是它 */
    }
    return rings.length > 0;
  }
  /** 中国：命中城市名；没命中则给出最近城市名 + 距离(km)（bbox 粗算，够用） */
  function cnAreaAt(lon, lat) {
    var src = global.QV_CN_AREAS || [];
    var bestD = 1e9, bestName = '';
    for (var i = 0; i < src.length; i++) {
      var a = src[i], b = a.b;
      if (!b) continue;
      var dx = Math.max(b[0] - lon, 0, lon - b[2]);
      var dy = Math.max(b[1] - lat, 0, lat - b[3]);
      var d2 = dx * dx + dy * dy;
      if (d2 === 0 && inCnAreaPoly(a, lon, lat)) return { inside: true, name: a.n, nearKm: 0 };
      if (d2 < bestD) { bestD = d2; bestName = a.n; }
    }
    if (!bestName || bestD >= 1e9) return null;
    return { inside: false, name: bestName, nearKm: Math.sqrt(bestD) * 111 };
  }
  function simPlaceFromLL(lat, lon) {
    if (!isFinite(lat) || !isFinite(lon)) return '';
    var A = (global.QV_SHINDO_AREAS && global.QV_SHINDO_AREAS.areas) || null;
    /* ① 落在 JMA 细分区域内 → 直接用区域名 */
    var code = (global.QVShindo && global.QVShindo.areaOf) ? global.QVShindo.areaOf(lon, lat) : 0;
    if (code && A && A[code] && A[code].name) return A[code].name;
    /* ② 落在中国地级市轮廓内 → 城市名 */
    var cn = cnAreaAt(lon, lat);
    if (cn && cn.inside) return cn.name;
    /* ③ 日本近海（多边形缝隙 / 离岸）：最近区域名 + 「沖」 */
    if (lat >= 20 && lat <= 48 && lon >= 122 && lon <= 150 && A) {
      var near = nearestAreaCode(lon, lat, true);
      if (near && A[near] && A[near].name) return A[near].name + '沖';
    }
    /* ④ 中国近海：50km 内最近城市 */
    if (cn && cn.nearKm <= 50) return cn.name + '近海';
    return '';
  }

  function openSim(ll) {
    if (ll) simLL = ll;
    if (!simLL) { startSimPick(); return; }    if (!sim) {
      sim = el('div', '', { id: 'qvsim' });
      /* ★ 数据源两张预览卡的素材（震度 6+ / 烈度 9）
         · 震度：官方造型族 QV_VAR.paSc / .snd 的「8」号 = 震度 6強
           （QV_SC_SUF(65) = 5 + (65-50)/5 = 8，见 variants.js）
         · 烈度：QV_LIEDU 自绘的同族色块/数字（248×120 色块 + 80×80 数字，几何与官方一致）
         取不到就退回官方列表小方块，至少不会空。 */
      var srcPic = (function () {
        var VV2 = global.QV_VAR, LIE2 = global.QV_LIEDU;
        var S_SUF = '8';
        var sBlk = (VV2 && VV2.paSc && VV2.paSc[S_SUF]) ? ('assets/' + VV2.paSc[S_SUF]) : '';
        var sNum = (VV2 && VV2.snd && VV2.snd[S_SUF]) ? ('assets/' + VV2.snd[S_SUF]) : '';
        if (!sBlk) sBlk = EEW_ART.sndm[S_SUF] || '';
        var lBlk = (LIE2 && LIE2.blockSrc) ? LIE2.blockSrc(9) : '';
        var lNum = (LIE2 && LIE2.numeralSrc) ? LIE2.numeralSrc(9) : '';
        return { shindoBlk: sBlk, shindoNum: sNum, lieduBlk: lBlk, lieduNum: lNum };
      })();
      sim.innerHTML =
        '<div class="box">' +
        '<div class="mhead">' +
        '<h3><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle>' +
        '<path d="M3 12h18"></path>' +
        '<path d="M12 3c3.1 3.4 3.1 14.6 0 18"></path>' +
        '<path d="M12 3c-3.1 3.4-3.1 14.6 0 18"></path></svg>地震与海啸模拟</h3>' +
        '<button id="simClose" class="x" title="关闭">&times;</button></div>' +
        '<div class="simbody">' +

        /* ══════════ 左栏：三步向导 / 海啸编辑器 ══════════ */
        '<div class="leftpane">' +

        /* ── 视图 1：向导 ── */
        '<div class="vlayer on" id="svMain">' +
        '<div class="sprogress"><i class="on" id="sbar0"></i><i id="sbar1"></i><i id="sbar2"></i></div>' +
        '<div class="sbody">' +

        /* ── 第 1 步：基础参数 ── */
        '<div class="spanel on" id="step-0">' +
        '<div class="ptitle">基础参数</div>' +
        /* ★★★ 2026-10-26 用户：「把这个页面的初始页面的架空页面和模板选择给加上」
           ⇒ 第 1 步顶部加「架空模拟 / 历史模板」二选一（设计稿 diui.html 的主入口）。
           架空 = 留在向导自己调参数；历史模板 = 打开模板库卡片列表。 */
        '<div class="modesw' + (SIM_HIST ? '' : ' solo') + '" id="simModeSw">' +
        '<div class="option-btn on" data-val="custom"><b>架空模拟</b>' +
        '<span>自己设定震源参数</span></div>' +
        (SIM_HIST ? '<div class="option-btn" data-val="hist"><b>历史模板</b>' +
          '<span>从历史强震目录载入</span></div>' : '') +
        '</div>' +
        /* 已载入模板的提示条（规模/震中一改就不再等于那一场 → 自动隐藏） */
        '<div class="histbanner" id="simHistBanner" hidden></div>' +
        '<div class="fld"><div class="flabel">规模</div><div class="slider-group">' +
        '<div class="range-wrap"><input type="range" id="simMagR" min="1" max="9.9" step="0.1" value="6.5"></div>' +
        '<div class="sval-wrap"><span class="unit pre">规模 M</span>' +
        '<input id="simMag" type="number" step="0.1" min="1" max="9.9" value="6.5"></div>' +
        '</div></div>' +
        '<div class="fld"><div class="flabel">深度</div><div class="slider-group">' +
        '<div class="range-wrap seg3"><input type="range" id="simDepR" min="0" max="300" step="1" value="20"></div>' +
        '<div class="sval-wrap"><span class="unit pre">深度</span>' +
        '<input id="simDep" type="number" step="1" min="0" max="700" value="10">' +
        '<span class="unit">km</span></div>' +
        '</div></div>' +
        /* ★★★ 2026-10-28 用户：「你在地震的开始页面加一个滑块，叫发报频率调节，
           默认，快速，密集」
           —— 只控模拟报文的间隔节奏，不动任何算法（默认档 = 原来的 13~21 秒心跳）。 */
        '<div class="fld"><div class="flabel">发报频率调节</div><div class="slider-group">' +
        '<div class="range-wrap seg4"><input type="range" id="simRateR" min="0" max="3" step="1" value="1"></div>' +
        '<div class="sval-wrap"><span class="unit pre">频率</span>' +
        '<span class="unit" id="simRateTxt">默认</span></div>' +
        '</div></div>' +
        /* ★★★ 2026-10-26 用户：「想能在模拟面板里手动选断层类型」
           auto = 按震源环境自动判（海域逆冲 / 沿岸逆断层 / 内陆走滑 / 深部正断层），
           手动选则直接覆盖。走滑/正断层没有抬升，海啸靠「海底滑坡」项。
           ⚠️ 值仍在隐藏 input#simFKind 里 —— simVal('simFKind') 的读法保持不变。 */
        '<div class="fld"><div class="flabel">断层类型</div>' +
        '<div class="btn-grid" id="simFKindGrid">' +
        '<div class="option-btn on" data-val="auto">自动判定</div>' +
        '<div class="option-btn" data-val="thrust">逆冲断层（俯冲带）</div>' +
        '<div class="option-btn" data-val="reverse">逆断层（盲断层）</div>' +
        '<div class="option-btn" data-val="normal">正断层</div>' +
        '<div class="option-btn" data-val="ss">走滑断层</div>' +
        '</div><input type="hidden" id="simFKind" value="auto"></div>' +
        '<div class="shakebar" id="simShake" hidden></div>' +
        '</div>' +

        /* ── 第 2 步：预警与数据源 ── */
        /* ★★ 2026-10-22 用户：「把经度和纬度的显示去掉，那两个位置改成
           触发海啸预警 和 误报取消 两个开关」。
           · 触发海啸预警 = 开始模拟时由系统自动判定（位置/规模/深度），满足条件就发海啸；
           · 误报取消 = 这一场做不做「取消报」，开始前就定好，不再给手动按钮。 */
        '<div class="spanel" id="step-1">' +
        '<div class="ptitle">预警与数据源</div>' +
        '<div class="switch-group">' +
        '<label class="switch-card on"><div class="switch-text">触发海啸预警</div>' +
        '<div class="switch"><input type="checkbox" id="simTsuAuto" checked>' +
        '<span class="slider-switch"></span></div></label>' +
        '<label class="switch-card"><div class="switch-text">误报取消</div>' +
        '<div class="switch"><input type="checkbox" id="simCancelAuto">' +
        '<span class="slider-switch"></span></div></label>' +
        '</div>' +
        /* 数据源 = 震度卡（JMA）/ 烈度卡（USGS）；值同样留在隐藏 input#simSrc。
           ★ 2026-10-26 用户：「一个改成 震度显示卡 + 一个震度7的卡片素材，
             和 烈度显示卡 + 一个烈度9的卡片素材」
           ⇒ 预览图直接拿官方/自有素材拼：色块 paSc/snd 后缀 9（= 震度7），
             烈度侧用 QV_LIEDU.blockSrc/numeralSrc(9)，两套几何同族（248×120 色块 + 80×80 数字）。 */
        '<div class="fld"><div class="flabel">数据源（震度卡 / 烈度卡）</div>' +
        '<div class="srcgrid" id="simSrcGrid">' +
        '<div class="option-btn srccard" data-val="JMA">' +
        '<div class="srcpic"><img class="blk" src="' + srcPic.shindoBlk + '" alt="">' +
        '<img class="num" src="' + srcPic.shindoNum + '" alt=""></div>' +
        '<div class="srctxt"><b>震度显示卡</b><span>日本气象厅 · 震度 6+</span></div>' +
        '</div>' +
        '<div class="option-btn srccard" data-val="USGS">' +
        '<div class="srcpic"><img class="blk" src="' + srcPic.lieduBlk + '" alt="">' +
        '<img class="num" src="' + srcPic.lieduNum + '" alt=""></div>' +
        '<div class="srctxt"><b>烈度显示卡</b><span>中国地震台网 · 烈度 9</span></div>' +
        '</div>' +
        /* ★★★ 2026-10-26 用户：「加一个智能识别，如果刚开始选的是烈度区就默认选烈度，
           震度区就默认选震度」⇒ 第三张整行卡，选中时按震中位置自动决定用哪张卡。 */
        '<div class="option-btn srccard wide on" data-val="auto">' +
        '<div class="srcpic duo"><img class="blk" src="' + srcPic.shindoBlk + '" alt="">' +
        '<img class="blk" src="' + srcPic.lieduBlk + '" alt=""></div>' +
        '<div class="srctxt"><b>智能识别</b>' +
        '<span>按震源所在区域自动选：日本 → 震度卡，中国/海外 → 烈度卡</span></div>' +
        '</div>' +
        '</div><input type="hidden" id="simSrc" value="auto"></div>' +
        '</div>' +

        /* ── 第 3 步：模拟环境 ── */
        '<div class="spanel" id="step-2">' +
        '<div class="ptitle">模拟环境</div>' +
        /* ★★★ 2026-10-26 用户：「我们还缺少中国的地震数据」
           → 内置中国（含台湾）历史破坏性地震目录（js/cn-quakes.js，公开目录参数），
             选中即把 震中/深度/规模/时间/地名 一次填好，方便复现真实事件。 */
        /* ★★★ 2026-10-26 用户：「我们现在那个模板全是下拉框，根本看不懂」
           ⇒ 下拉框换成入口卡：点开就是卡片式模板库（带年代/震级/海啸筛选）。
           数据还是 cn-quakes.js 的同一份目录，一项参数都没砍。 */
        /* ★ 2026-10-26 模板库入口：线上版不渲染（SIM_HIST 见文件顶部） */
        (SIM_HIST ? ('<div class="fld"><div class="flabel">历史模板</div>' +
          '<div class="libopen" id="simHistOpen"><b>打开历史模板库</b>' +
          '<span>' + libAll().length +
          ' 场全球强震 · 可按国家 / 地区、年代、震级、海啸筛选</span></div></div>') : '') +
        '<div class="fld"><div class="flabel">震源地名</div>' +
        '<input type="text" id="simPlace" value="模拟震源" placeholder="选填，默认为「模拟震源」"></div>' +
        /* ★★★ 2026-10-26 用户：「到模拟环境下面的倒计时和时间加速和地区名中间加一个选项框，
           把经度和纬度自定义给加回来，为了准确还原历史」
           ⇒ 手工改坐标 = 改震源：同步红叉、自动地名（未手改时）、地图重绘。 */
        '<div class="fld row2">' +
        '<div><div class="flabel">纬度（−90 ~ 90）</div>' +
        '<input id="simLat" type="number" step="0.001" min="-90" max="90" value="35.000"></div>' +
        '<div><div class="flabel">经度（−180 ~ 180）</div>' +
        '<input id="simLon" type="number" step="0.001" min="-180" max="180" value="139.000"></div>' +
        '</div>' +
        /* ★★★ 2026-10-26 用户：「加一个自定义时间，只要用户改了这个东西就直接清空掉历史的所有地震，
           并且模拟期间暂时不用新的数据进来，专注于模拟这个时间段，不限时间」
           格式：XXXX/XX/XX/XX:XX:XX 或直接 14 位数字 20260809060455 */
        '<div class="fld"><div class="flabel">自定义时间</div>' +
        '<input id="simTime" type="text" placeholder="2026/08/09/06:04:55 或 20260809060455（留空 = 实时）"></div>' +
        '<div class="fld row2">' +
        /* ⚠️ 倒计时 5 档、时间加速 10 档都是 koneew 原有的完整版（设计稿砍到 3 档，不照搬） */
        '<div><div class="flabel">倒计时</div><select id="simDelay">' +
        selOpts([['0', '立即开始'], ['3', '3 秒后'], ['5', '5 秒后'], ['10', '10 秒后'], ['30', '30 秒后']], 5) +
        '</select></div>' +
        /* ★★ 2026-11-03 用户：「不应该多一个选项栗 1-1000X 倍速模拟吗」 */
        '<div><div class="flabel">时间加速</div><select id="simSpeed">' +
        selOpts([['1', '1×（真实速度）'], ['2', '2×'], ['5', '5×'], ['10', '10×'], ['20', '20×'],
          ['50', '50×'], ['100', '100×'], ['200', '200×'], ['500', '500×'], ['1000', '1000×']], '1') +
        '</select></div>' +
        '</div>' +
        '</div>' +

        '</div>' +   /* sbody */
        '<div class="sfoot">' +
        '<button id="simPrev" class="btn-prev" disabled>上一步</button>' +
        '<button id="simNext" class="btn-next">下一步</button>' +
        '</div>' +
        '</div>' +   /* svMain */

        /* ── 视图 3：历史模板库（2026-10-26 用户设计稿：卡片列表；筛选在右栏） ── */
        '<div class="vlayer" id="svLib">' +
        '<div class="ehead"><div class="etitle">历史地震模板</div>' +
        '<div class="esub">筛选在右侧 · 点卡片直接到参数确认</div>' +
        '<div class="ecount" id="simLibCount">共 0 条</div></div>' +
        '<div class="ebody libbody" id="simLibList"></div>' +
        '<div class="sfoot">' +
        '<button id="simLibBack" class="btn-prev">返回向导</button>' +
        '</div>' +
        '</div>' +   /* svLib */

        /* ── 视图 4：历史参数确认（点卡片直达；确认完直接开始，不再走向导） ──
           控件只负责回写向导那几个 input，参数结构一点没变。 */
        '<div class="vlayer" id="svConfirm">' +
        '<div class="ehead"><div class="etitle">历史参数确认</div>' +
        '<div class="esub">改完直接开始，不用再走前面三步</div>' +
        '<div class="ecount" id="simConfName">--</div></div>' +
        '<div class="ebody">' +
        '<div class="histbanner" id="simConfBanner" hidden></div>' +
        '<div class="fld"><div class="flabel">规模</div><div class="slider-group">' +
        '<div class="range-wrap"><input type="range" id="simCMagR" min="1" max="9.9" step="0.1" value="6.5"></div>' +
        '<div class="sval-wrap"><span class="unit pre">规模 M</span>' +
        '<input id="simCMag" type="number" step="0.1" min="1" max="9.9" value="6.5"></div>' +
        '</div></div>' +
        '<div class="fld"><div class="flabel">深度</div><div class="slider-group">' +
        '<div class="range-wrap seg3"><input type="range" id="simCDepR" min="0" max="300" step="1" value="20"></div>' +
        '<div class="sval-wrap"><span class="unit pre">深度</span>' +
        '<input id="simCDep" type="number" step="1" min="0" max="700" value="10">' +
        '<span class="unit">km</span></div>' +
        '</div></div>' +
        '<div class="fld"><div class="flabel">断层类型</div>' +
        '<div class="btn-grid" id="simCFaultGrid">' +
        '<div class="option-btn on" data-val="auto">自动判定</div>' +
        '<div class="option-btn" data-val="thrust">逆冲断层（俯冲带）</div>' +
        '<div class="option-btn" data-val="reverse">逆断层（盲断层）</div>' +
        '<div class="option-btn" data-val="normal">正断层</div>' +
        '<div class="option-btn" data-val="ss">走滑断层</div>' +
        '</div></div>' +
        '<div class="fld"><div class="flabel">震源地名</div>' +
        '<input type="text" id="simCPlace" value="模拟震源"></div>' +
        '<div class="fld row2">' +
        '<div><div class="flabel">纬度</div>' +
        '<input id="simCLat" type="number" step="0.001" value="35.000"></div>' +
        '<div><div class="flabel">经度</div>' +
        '<input id="simCLon" type="number" step="0.001" value="139.000"></div>' +
        '</div>' +
        '</div>' +
        '<div class="sfoot">' +
        '<button id="simCBack" class="btn-prev">返回模板库</button>' +
        '<button id="simCGo" class="btn-next finish">直接开始模拟</button>' +
        '</div>' +
        '</div>' +   /* svConfirm */

        '</div>' +   /* leftpane */

        /* ── 视图 2：自定义海啸情报编辑器（覆盖整个主体，表格需要宽度） ── */
        '<div class="vlayer" id="svTsu">' +
        '<div class="ehead"><div class="etitle">自定义海啸情报</div>' +
        '<div class="esub">区域码 / 名称 / 级别 / 高度 / 首波条件 / 偏移(分)</div>' +
        '<div class="ecount" id="simAreaCount">共 0 个区域</div></div>' +
        '<div class="ebody">' +
        '<div class="row3">' +
        '<label class="mini"><span>海啸等级</span><select id="simTlv">' + selOpts(SIM_OPT_TLV, 3) + '</select></label>' +
        '<label class="mini"><span>预计高度</span><select id="simTh">' +
        selOpts(SIM_H.map(function (h) { return [h, h || '（无）']; }), '3m') + '</select></label>' +
        '<label class="mini"><span>震源名</span><input id="simTanm" type="text" value="模拟震源"></label>' +
        '</div>' +
        '<div class="tsulist" id="simAreaRows"></div>' +
        '<div class="tsubtns">' +
        '<button id="simAreaAdd" class="mini-btn">+ 添加区域</button>' +
        '<button id="simAreaPaste" class="mini-btn">批量粘贴</button>' +
        '<button id="simAreaClear" class="mini-btn">清空</button>' +
        '<span class="grow"></span>' +
        '<button id="simTclr" class="mini-btn warn">清除海啸</button>' +
        '<button id="simAllclr" class="mini-btn warn">清除全部模拟</button>' +
        '</div>' +
        '<div id="simPasteWrap" class="pastewrap">' +
        '<textarea id="simPasteBox" placeholder="每行：区域码,名称,等级1-4,预计高度,首波条件,到达分钟偏移"></textarea>' +
        '<div class="pbtns">' +
        '<button id="simPasteAppend" class="mini-btn pri">追加导入</button>' +
        '<button id="simPasteReplace" class="mini-btn">替换全部</button>' +
        '<button id="simPasteCancel" class="mini-btn">收起</button>' +
        '</div></div>' +
        '</div>' +
        '<div class="sfoot">' +
        '<button id="simTsuBack" class="btn-prev">返回</button>' +
        '<button id="simT" class="btn-next finish">注入这场海啸</button>' +
        '</div>' +
        '</div>' +   /* svTsu */

        /* ══════════ 右栏：实时摘要看板 ══════════ */
        '<div class="rightpane">' +
        /* 右栏第二层：历史模板筛选台（2026-10-26 用户：「筛选按钮不应该是在右侧
           那个小的页面吗」→ 进模板库时右栏从「实时摘要」切成筛选台） */
        '<div class="rlayer" id="simFilters">' +
        '<div class="fgrid">' +
        '<div class="search-wrap">' +
        '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle>' +
        '<line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
        '<input id="simLibQ" type="text" placeholder="搜索：唐山 / 1976 / 汶川">' +
        '<button class="search-clear" id="simLibQClear" title="清空输入">&times;</button>' +
        '</div>' +
        '<div class="filter-top"><span class="filter-top-title">筛选条件</span>' +
        '<button class="btn-reset-all" id="simLibReset">' +
        '<svg viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' +
        'm3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>重置全部</button></div>' +
        '<div id="simLibPills"></div>' +
        '</div>' +
        '<div class="rcount"><span>当前筛选结果</span><b id="simFilterCount">0</b></div>' +
        '</div>' +
        '<div class="rbody" id="simSum">' +
        '<div class="empty">尚无参数<br><span>请在左侧完成设置</span></div>' +
        '</div>' +
        '<div class="rfoot">' +
        '<button id="simReselect" class="ghost">重新选点</button>' +
        '<button id="simTsuOpen" class="tsu-btn">' +
        '<svg viewBox="0 0 24 24"><path d="M2 12h3l2-5 3 10 3-8 2 3h7v2h-8l-1.5-2.5L9 18 6 8 4.5 12H2z"/></svg>' +
        '自定义海啸情报</button>' +
        '<div class="rghint">模拟中按 <kbd>Enter</kbd> 跳过当前阶段</div>' +
        '</div>' +
        '</div>' +

        '</div>' +   /* simbody */
        '</div>';    /* box */
      /* ★★ 2026-11-02 挂 body：模拟弹窗以前挂在 #stage 里且有 transform: scale(k)，
         舞台逻辑宽高一旦超过 960×720（窗口一大就会），
         遮罩只盖左上角、弹窗也只居中于那一小块 → 用户看到的就是「偏左上 + 没变灰」。 */
      document.body.appendChild(sim);
      sim.addEventListener('click', function (e) { if (e.target === sim) cancelSim(); });
      sim.querySelector('#simClose').addEventListener('click', function () { cancelSim(); });
      /* 重新选点：回到「点地图」状态 */
      sim.querySelector('#simReselect').addEventListener('click', function () {
        if (sim) sim.className = '';
        startSimPick();
      });
      /* ★★★ 2026-10-28 用户：「给预测最大震度删掉，没意义的玩意」
         →「那个手动选择预测好的最终结果，震度是没用的，不然我搞那么多算法就没意义了。留那个自动的就行」
         所以 #simLv 手动下拉已整个移除；下面这段同步逻辑一并删掉，
         最大震度一律交给 QData.estimateRank()（震级 + 深度）算。 */
      /* 时间加速：1~1000×，立即生效（QVPlanet.setSpeed 会重发一次波源重置时钟） */
      var spdSel = sim.querySelector('#simSpeed');
      if (spdSel) {
        spdSel.addEventListener('change', function () {
          var P = global.QVPlanet;
          var k = P && P.setSpeed ? P.setSpeed(+spdSel.value) : 1;
          toast(k > 1 ? '模拟时间加速 ×' + k : '模拟时间：真实速度');
        });
      }
      /* M 的数字框 ↔ 滑块双向联动（设计稿要求） */
        var magR = sim.querySelector('#simMagR'), magN = sim.querySelector('#simMag');
      if (magR && magN) {
        magR.addEventListener('input', function () { magN.value = magR.value; });
        magN.addEventListener('input', function () {
          var mv = parseFloat(magN.value);
          if (isFinite(mv)) magR.value = Math.min(9.9, Math.max(1, mv));
        });
        /* ★ 2026-10-21 用户：「为什么我输 M999999 直接卡死了哈哈哈」
           HTML 的 min/max 只做表单校验，**拦不住手动输入** → 999999 一路进到公式：
             Math.pow(10, 0.5*M) = Infinity → logPGV = -Infinity
             → I0 = 2.68 + 1.72·lg(1e-6) + (M-7.5)·0.45 ≈ 449988
             → shift = -449980 → 所有测站被夹到 min(7.5, …) = 7.5
           ⇒ 全日本 1882 个测站全变「震度7」+ 188 个区域全涂满 + 60 报
              → 渲染直接跪（这就是"卡死"的真相）
           ⇒ 离开输入框时强制夹回 1.0~10.0 并回写。 */
        function clampMag() {
          var mv = parseFloat(magN.value);
          if (!isFinite(mv)) mv = 6.5;
          mv = Math.max(1, Math.min(10, mv));
          magN.value = mv;
          magR.value = Math.min(9.9, mv);
        }
        magN.addEventListener('change', clampMag);
        magN.addEventListener('blur', clampMag);
        /* ★ 天体模式：震级一变就重算「摇晃时间」（火星 M4.7 ≈ 4.5 小时） */
        magR.addEventListener('input', syncShakeBar);
        magN.addEventListener('input', syncShakeBar);
        magN.addEventListener('change', syncShakeBar);
      }
      /* ═══ 沿岸区域：表格行（2026-10-21 用户选「改成表格行（带批量粘贴）」）═══
         以前是一个 textarea 每行逗号分隔。现在每行一张卡，
         但保留「批量粘贴」入口 —— 一次粘一堆区域仍然是一步到位。
         解析格式和以前完全一致（区域码,名称,等级1-4,高度,首波条件,偏移分钟），
         所以旧的粘贴文本可以直接丢进「批量粘贴」。 */
      function escA(s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      }
      var AREA_GRADES = [
        [1, '1 津波予報'], [2, '2 津波注意報'], [3, '3 津波警報'], [4, '4 大津波警報']
      ];
      function areaRowEl(d) {
        d = d || {};
        var row = document.createElement('div');
        row.className = 'tsurow';
        row.innerHTML =
          '<input data-k="code" placeholder="区域码" value="' + escA(d.code) + '">' +
          '<input data-k="name" placeholder="区域名称" value="' + escA(d.name) + '">' +
          '<select data-k="grade">' + AREA_GRADES.map(function (g) {
            return '<option value="' + g[0] + '"' +
              (String(d.grade || 3) === String(g[0]) ? ' selected' : '') + '>' + g[1] + '</option>';
          }).join('') + '</select>' +
          '<input data-k="height" placeholder="高度" value="' + escA(d.height) + '">' +
          '<input data-k="cond" placeholder="首波条件" value="' + escA(d.cond) + '">' +
          '<input data-k="off" type="number" placeholder="偏移" value="' + escA(d.off) + '">' +
          '<button class="del" title="删除这行">&times;</button>';
        row.querySelector('.del').addEventListener('click', function () { row.remove(); });
        return row;
      }
      var rowsBox = sim.querySelector('#simAreaRows');
      function addAreaRow(d) { if (rowsBox) rowsBox.appendChild(areaRowEl(d)); }
      /** 把「每行逗号分隔」的文本解析成行数据（和以前 textarea 的格式完全一致） */
      function parseAreaText(txt) {
        var out = [];
        String(txt || '').split(/\r?\n/).forEach(function (line) {
          line = line.trim();
          if (!line || line.charAt(0) === '#') return;
          var p = line.split(/[,，\t]/).map(function (s) { return s.trim(); });
          if (!p[0]) return;
          out.push({
            code: p[0], name: p[1] || '', grade: parseInt(p[2], 10) || 3,
            height: p[3] || '', cond: p[4] || '', off: p[5] || ''
          });
        });
        return out;
      }
      /** 从表格行读回数据（注入海啸时用，字段名沿用原来的 p[0..5]） */
      function readAreaRows() {
        var out = [], rs = rowsBox ? rowsBox.querySelectorAll('.tsurow') : [];
        for (var i = 0; i < rs.length; i++) {
          var g = (function (r) {
            return function (k) { var e = r.querySelector('[data-k="' + k + '"]'); return e ? String(e.value || '').trim() : ''; };
          })(rs[i]);
          var code = g('code');
          if (!code) continue;
          out.push({
            code: code, name: g('name'), grade: parseInt(g('grade'), 10) || 3,
            height: g('height'), cond: g('cond'), off: g('off')
          });
        }
        return out;
      }
      /* 初始化：把原来的示例文本解析成表格行 */
      parseAreaText(SIM_AREA_DEMO).forEach(addAreaRow);
      sim.querySelector('#simAreaAdd').addEventListener('click', function () { addAreaRow({ grade: 3 }); });
      sim.querySelector('#simAreaClear').addEventListener('click', function () { if (rowsBox) rowsBox.innerHTML = ''; });
      var pasteWrap = sim.querySelector('#simPasteWrap');
      sim.querySelector('#simAreaPaste').addEventListener('click', function () {
        var on = pasteWrap.style.display === 'block';
        pasteWrap.style.display = on ? 'none' : 'block';
        if (!on) sim.querySelector('#simPasteBox').focus();
      });
      sim.querySelector('#simPasteCancel').addEventListener('click', function () { pasteWrap.style.display = 'none'; });
      sim.querySelector('#simPasteAppend').addEventListener('click', function () {
        parseAreaText(sim.querySelector('#simPasteBox').value).forEach(addAreaRow);
        sim.querySelector('#simPasteBox').value = '';
        pasteWrap.style.display = 'none';
      });
      sim.querySelector('#simPasteReplace').addEventListener('click', function () {
        if (rowsBox) rowsBox.innerHTML = '';
        parseAreaText(sim.querySelector('#simPasteBox').value).forEach(addAreaRow);
        sim.querySelector('#simPasteBox').value = '';
        pasteWrap.style.display = 'none';
      });
      /* 开始模拟：读规模/深度/倒计时 → 倒计时结束 fireSim()（走 QData.inject，和实时推送同一条路）
         ★ 2026-10-26 改成具名函数：向导第 3 步的「开始模拟」按钮和它共用一份逻辑。 */
      function simStartNow() {
        if (!simLL) {
          /* ★ 2026-11-03 天体模式兜底：行星上「点地图选震源」这条路一旦没接上，
             按开始模拟就只会反复弹提示、什么都不出（用户看到的「根本没反应」）。
             行星模式直接用当前视图中心当震源，保证一定能出结果。 */
          if (global.QVPlanet && global.QVPlanet.isPlanet() && global.QVMapCam && QVMapCam.latLonAt) {
            var mid = QVMapCam.latLonAt(600, 388);
            if (mid) { simLL = mid; toast('震源 = 当前视图中心'); }
          }
          if (!simLL) { toast('请先在地图上点选震源'); startSimPick(); return; }
        }
        /* ★ 2026-10-21 输入钳制（同 simMag 输入框那段的说明）：
           M 1.0~10.0（地壳地震物理上限）、深度 0~700km。 */
        var mag = Math.max(1, Math.min(10, simNum('simMag', 6.5)));
        var dep = Math.max(0, Math.min(700, simNum('simDep', 10)));
        var lv, lledu;
        var est = (global.QData && QData.estimateRank)
          ? QData.estimateRank(mag, dep, simLL ? simLL[0] : NaN, simLL ? simLL[1] : NaN)
          : { shindo: 5, liedu: 6 };
        /* ★★★ 2026-10-26 用户：「下面的小条说的竟然又是最大烈度 8，
           我虽然不理解为什么日本会用烈度」
           → 以前按「数据源选了 USGS 就变 liedu」，日本震源也被强改成烈度
             → 卡片写「最大烈度 8」（而日本震度根本没有 8 级，最高 7）。
           ⚙ metric 必须由【震源位置】定：日本/琉球 → 震度（shindo）；其他（中国等）→ 烈度（liedu）。 */
        var _isJPRgn = (simLL[0] >= 24 && simLL[0] <= 47 && simLL[1] >= 126 && simLL[1] <= 148);
        var MET2 = _isJPRgn ? 'shindo' : 'liedu';
        /* ★ 天体模式强制走烈度刻度（1~12）：震度码那套 5弱/6强 与行星地名不搭，
           而且 est.shindo 返回的是 0~7 数字、档位表用的是 70 这种码，
           indexOf 找不到 → 推定震度永远显示 0。 */
        if (global.QVPlanet && global.QVPlanet.isPlanet()) MET2 = 'liedu';
        /* ★ 2026-10-28：手动「预测震度」已移除 → 一律用算法估值（震级 + 深度）。
           ★★★ 2026-10-28 用户：「我都拉到 8 级了，一个七都没有，还没以前的准呢」
           —— 原来用 QData.estimateRank()（司・翠川 **点源** 公式，R=深度），
              M8 只算出 I≈5.68 → 6弱，根本没有 7。
              而 genStations() 里有**有限断层修正**（Lf=10^(0.5M-1.85)、Imax=4+(M-5)·1.2）。
              两边公式不一致 → 卡片 6弱、地图也只到 6弱。
           ⇒ 日本震度一律改用**和生成场同一个公式**算峰值：
                Imax = min(7.4, 4.0 + (M-5)·1.2)   →  M8=7.4(7) / M7.5=7.0(7) / M7=6.4(6強) / M6=5.2(5強)
              中国烈度仍用 estimateRank().liedu。 */
        var shindoCodeOfI = function (I) {
          if (!isFinite(I)) return 5;
          if (I >= 6.5) return 70; if (I >= 6.0) return 65;
          if (I >= 5.5) return 60; if (I >= 5.0) return 55;
          if (I >= 4.5) return 50; if (I >= 3.5) return 4;
          if (I >= 2.5) return 3; if (I >= 1.5) return 2;
          if (I >= 0.5) return 1; return 0;
        };
        if (MET2 === 'liedu') lv = (isFinite(est.liedu) && est.liedu >= 1) ? est.liedu : 5;
        else {
          var _Mm = Math.max(5, Math.min(10, +mag || 5));
          /* ★★★ 2026-10-25：改用 peakI(M, 深度) —— 深源时以「震源正上方地表的 GMPE 值」封顶。
             以前只看震级（M7 → 6.4 → 6強），470km 深的小笠原 M7.0 卡片直接写 6強，
             而 JMA 实测最大震度只有 3。 */
          lv = shindoCodeOfI(peakI(_Mm, dep));
        }
        lledu = (MET2 === 'liedu') ? lv : est.liedu;
        /* ★★★ 2026-10-26 用户：「汶川官方最高烈度是 11 度，为什么模拟就 10」
           用「历史地震」模板载入时，直接拿**目录里的官方极震区烈度**当锚定值：
           官方等震线评定的值 > 任何回归式（表 1 给汶川 10.4，官方是 XI）。
           仅当 震中/规模 都没被手动改过时才生效（改了就说明不是那场地震）。 */
        var _rec = (sim && sim._cnRec) || null;
        if (_rec && MET2 === 'liedu' &&
          Math.abs((+_rec.mag) - mag) < 0.05 && simLL &&
          Math.abs((+_rec.lat) - simLL[0]) < 0.01 && Math.abs((+_rec.lon) - simLL[1]) < 0.01) {
          var _imx = Math.max(1, Math.min(12, Math.round(+_rec.imax || 0)));
          if (_imx >= 1) { lv = _imx; lledu = _imx; }
        }
        /* ★ 2026-10-26 断层迹线（只参与计算，前端不画线）：
           目录里带 strike / off / len 的事件（如汶川「震中在破裂最西南端、破裂长 300km」）
           会让北川/青川这些远离震中但**就在破裂上**的地方也能拿到 XI 度。 */
        var _cf = null;
        if (_rec && isFinite(_rec.strike)) {
          _cf = { strike: +_rec.strike };
          if (isFinite(_rec.off)) _cf.off = +_rec.off;
          if (isFinite(_rec.len)) _cf.len = +_rec.len;
        }
        /* ★ 2026-10-26 官方等震线（目录里录了 iso 的事件）：直接钉死整张场，
           GMPE 与 boost 都不参与（见 cn-gmpe.intensityFromIso）。 */
        if (_cf && _rec.iso && _rec.iso.length) _cf.iso = _rec.iso;
        /* ★ 2026-10-26 逐事件偏移：官方极震区烈度 − 模型峰值（±1 度封顶）。
           汶川：模型 10.65 / 官方 XI → +0.35，于是北川·青川那条破裂带也到 11 度。 */
        if (_cf && lv >= 1 && global.QVCNGM) {
          var _pk = QVCNGM.peak(mag, dep, simLL[0], simLL[1]);
          if (isFinite(_pk)) _cf.boost = Math.max(-1, Math.min(1, lv - _pk));
        }
        var q = {
          id: 'SIMQ' + Date.now(), source: simSrcResolved(), isEew: 1,
          timeMs: simTimeMs || Date.now(),
          lat: simLL[0], lon: simLL[1], mag: mag, depthKm: dep,
          place: simVal('simPlace', '模拟震源'), maxShindo: lv, shindo: lv, liedu: lledu,
          metric: MET2,
          cnFault: _cf || undefined,     /* 断层迹线（非对称破裂）—— 只给计算层用 */
          tsunami: 0, detail: '', detailJson: '', alts: [], sim: 1,
          /* ★ 2026-10-22 两个预置开关（开始之前就定好）：
             simTsuAuto = 触发海啸预警（系统按位置/规模/深度自动判定）
             simCancel  = 这一场发「误报取消」 */
          /* ★ 2026-10-26 ：拿不到复选框时当成「开」（以前当成「关」→ M7.5 宫城县沖竟然“无海啸威胁”） */
          simTsuAuto: (function () {
            var el = sim && sim.querySelector ? sim.querySelector('#simTsuAuto') : null;
            return el ? !!el.checked : true;
          })(),
          /* ★ 2026-10-26：断层类型（auto = 按震源环境自动判，见 simFault） */
          simFKind: simVal('simFKind', 'auto') || 'auto',
          simCancel: !!(sim.querySelector('#simCancelAuto') && sim.querySelector('#simCancelAuto').checked)
        };
        var delay = simNum('simDelay', 5);
        /* ★★ 2026-11-03 天体模式：在【按下按钮这一瞬间】就把震源交给 planet.js，
           不等倒计时、不等 fireSim（那条链路上有一堆地球专属逻辑，
           行星坐标下任何一环出岔子都会让地图毫无反应）。 */
        try {
          if (global.QVPlanet && global.QVPlanet.isPlanet()) {
            global.QVPlanet.setQuake({ lat: q.lat, lon: q.lon, mag: q.mag, depthKm: q.depthKm }, true);
          }
        } catch (e) { }
        sim.className = '';
        /* ★ 2026-10-25：按钮保持焦点时，回车会被浏览器当成「再点一次开始模拟」
           → 弹窗关了以后按 Enter 会重新开一场。点完就失焦，回车只用于「跳过阶段」。 */
        try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (eB) { }
        if (delay <= 0) { fireSim(q); return; }
        var n = Math.round(delay);
        showCount(n);
        if (simTimer) clearInterval(simTimer);
        simTimer = setInterval(function () {
          n--;
          if (n <= 0) { clearInterval(simTimer); simTimer = 0; fireSim(q); return; }
          showCount(n);
        }, 1000);
      }
      /* 注入海啸：走 QData.simTsunami（data.js 的模拟钩子，refresh 不覆盖） */
      sim.querySelector('#simT').addEventListener('click', function () {
        var lv = parseInt(simVal('simTlv', '3'), 10) || 0;
        var h = simVal('simTh', '');
        /* ★ 2026-10-21：区域改成表格行后，从行里读（字段含义和以前 textarea 的 p[0..5] 一致） */
        var items = [];
        readAreaRows().forEach(function (r) {
          var g = (r.grade >= 1 && r.grade <= 4) ? r.grade : (lv || 1);
          var off = (r.off !== '' && isFinite(+r.off)) ? (+r.off) * 60000 : 0;
          var cond = r.cond || '';
          items.push({
            code: String(r.code), name: r.name || '', grade: g, gradeName: '', raw: '',
            height: r.height || h,
            firstCond: cond, firstAt: (cond && /到達予想/.test(cond)) ? new Date(simNowMs() + off).toISOString() : '',
            maxCond: '', maxAt: ''
          });
        });
        if (!items.length && !lv) { toast('没有区域、等级也是「无海啸」→ 什么都不会出现'); }
        var obj = items.length ? {
          maxLv: items.reduce(function (m, x) { return Math.max(m, x.grade); }, 0),
          height: h, atMs: simNowMs(), anm: simVal('simTanm', '模拟津波'), mag: simNum('simMag', 7.6),
          dep: simNum('simDep', 0) || NaN, items: items,
          head: '（模拟）津波予報を発表しました。'
        } : null;
        if (global.QData && QData.simTsunami) QData.simTsunami(obj);
        if (global.QVRedraw) QVRedraw();
        toast(obj ? ('已注入模拟海啸：' + items.length + ' 个区域 · 高度 ' + (h || '未定')) : '已清空模拟海啸');
      });
      sim.querySelector('#simTclr').addEventListener('click', function () {
        simAuxClear();
        if (global.QData && QData.simTsunami) QData.simTsunami(null);
        if (global.QVRedraw) QVRedraw();
        toast('已清除模拟海啸（回到真实数据）');
      });
      sim.querySelector('#simAllclr').addEventListener('click', function () {
        simAuxClear();
        /* ★ 2026-10-26 自定义时间一并解除冻结，否则清完了还是接不到真实数据 */
        try {
          var tEl2 = sim.querySelector('#simTime');
          if (tEl2) tEl2.value = '';
          if (simTimeMs && global.QData) {
            simTimeMs = 0;
            if (QData.freeze) QData.freeze(false);
            if (QData.refresh) QData.refresh();
          }
        } catch (eT2) { }
        if (global.QData && QData.simTsunami) QData.simTsunami(null);
        if (global.QData && QData.clearSim) QData.clearSim();
        if (global.QVMapCam && QVMapCam.lockPin) QVMapCam.lockPin(null);
        if (global.QVMapCam && QVMapCam.setBoxes) QVMapCam.setBoxes(null);
        if (global.QVMapCam && QVMapCam.stopSimWave) QVMapCam.stopSimWave();
        if (global.QVMapCam && QVMapCam.setPins) QVMapCam.setPins([]);
        if (global.QVMapCam && QVMapCam.clearStations) QVMapCam.clearStations();
        if (global.QVShindo && global.QVShindo.clearPoints) global.QVShindo.clearPoints();
        if (global.QVShindo && global.QVShindo.set) global.QVShindo.set([]);
        eewTimers.forEach(function (t) { clearTimeout(t); }); eewTimers = [];
        V.eew = null;
        hideDetCircle();
        if (global.QVRedraw) QVRedraw();
        toast('已清除全部模拟数据');
      });

      /* ══════════════════════════════════════════════════════════════
         2026-10-26 用户设计稿：三步向导 + 右侧实时摘要
         · 左栏向导：1 基础参数 / 2 预警与数据源 / 3 模拟环境；
           末步的「下一步」变成「开始模拟」（复用 simStartNow）。
         · 左栏第二视图 = 自定义海啸情报编辑器（右栏按钮进入，返回键回向导）。
         · 右栏看板：每进入一步就把那一步的参数做成卡片，改值即时刷新。
         ⚠️ 参数项和选项数量全部沿用 koneew 原版，设计稿只负责排版和配色。
         ══════════════════════════════════════════════════════════════ */
      var simStep = 0;
      var stepEls = [sim.querySelector('#step-0'), sim.querySelector('#step-1'), sim.querySelector('#step-2')];
      var barEls = [sim.querySelector('#sbar0'), sim.querySelector('#sbar1'), sim.querySelector('#sbar2')];
      var vMain = sim.querySelector('#svMain'), vTsu = sim.querySelector('#svTsu');
      var vLib = sim.querySelector('#svLib'), vConf = sim.querySelector('#svConfirm');
      var rFilters = sim.querySelector('#simFilters');
      var sumBox = sim.querySelector('#simSum');
      var sumGroups = {}, sumVals = {};
      var SIM_FAULT_TXT = {
        auto: '自动判定', thrust: '逆冲断层（俯冲带）',
        reverse: '逆断层（盲断层）', normal: '正断层', ss: '走滑断层'
      };
      var SIM_SRC_TXT = { auto: '智能识别', JMA: '日本气象厅', USGS: 'USGS' };
      /* ★ 2026-10-26 智能识别：按震中位置决定用哪张卡
         日本框（24~47N / 126~148E）→ JMA 震度；其余（中国 / 海外）→ 烈度。
         与 simStartNow() 里 MET2 的判据完全一致，两边不会打架。 */
      function simSrcAuto() {
        var ll = simLL;
        if (!ll) return 'USGS';
        return (ll[0] >= 24 && ll[0] <= 47 && ll[1] >= 126 && ll[1] <= 148) ? 'JMA' : 'USGS';
      }
      function simSrcResolved() {
        var v = simVal('simSrc', 'auto');
        return (v === 'auto' || !v) ? simSrcAuto() : v;
      }
      /* 摘要里的数据源文案：智能识别时把「最终选的哪张」也写出来 */
      function simSrcLabel() {
        var v = simVal('simSrc', 'auto');
        if (v === 'auto' || !v) {
          var r = simSrcAuto();
          return '智能识别 → ' + (r === 'JMA' ? '震度卡（日本气象厅）' : '烈度卡（中国地震台网）');
        }
        return SIM_SRC_TXT[v] || '日本气象厅';
      }
      var SIM_GROUP_ORDER = ['基础参数', '预警与数据源', '模拟环境', '海啸情报'];

      function sumGroup(name) {
        if (sumGroups[name]) return sumGroups[name];
        var d = document.createElement('div');
        d.className = 'sgroup';
        d.innerHTML = '<div class="sgtitle"></div>';
        d.querySelector('.sgtitle').textContent = name;
        /* 按固定顺序插：只往后找「已经建好的组」，找不到就追加到末尾 */
        var placed = false;
        for (var i = SIM_GROUP_ORDER.indexOf(name) + 1; i < SIM_GROUP_ORDER.length; i++) {
          if (sumGroups[SIM_GROUP_ORDER[i]]) {
            sumBox.insertBefore(d, sumGroups[SIM_GROUP_ORDER[i]]);
            placed = true; break;
          }
        }
        if (!placed) sumBox.appendChild(d);
        sumGroups[name] = d;
        var em = sumBox.querySelector('.empty');
        if (em) em.style.display = 'none';
        return d;
      }
      /* ★ 2026-10-26 动画逻辑**完全照搬设计稿**（不要自行加戏）：
         · 新卡片 → CSS .scard 的 scardPopIn（opacity 0 + translateY(5px) → 1/0，.3s ease-out forwards）
         · 已有卡片改值 → 先重写 className，再打 flash 类，300ms 后移除（稿子里 flash 没有定义样式）
         · 只有【新建卡片】时才把看板滚到底（setTimeout 50ms），改值不滚 */
      function sumSet(key, group, label, value, cls) {
        var g = sumGroup(group);
        var v = sumVals[key];
        if (!v) {
          var card = document.createElement('div');
          card.className = 'scard';
          card.innerHTML = '<span class="slabel"></span><span class="svalue"></span>';
          card.querySelector('.slabel').textContent = label;
          v = card.querySelector('.svalue');
          v.className = 'svalue ' + (cls || '');
          v.textContent = value;
          sumVals[key] = v;
          g.appendChild(card);
          setTimeout(function () { sumBox.scrollTop = sumBox.scrollHeight; }, 50);
        } else {
          v.textContent = value;
          v.className = 'svalue ' + (cls || '') + ' flash';
          setTimeout(function () { v.classList.remove('flash'); }, 300);
        }
      }
      function sumAreas() {
        var n = sim.querySelectorAll('#simAreaRows .tsurow').length;
        sumSet('area', '海啸情报', '沿岸区域', n + ' 个', n ? 'warn' : '');
        var cnt = sim.querySelector('#simAreaCount');
        if (cnt) cnt.textContent = '共 ' + n + ' 个区域';
        /* 设计稿里 updateTsunamiSummary 末尾会无条件滚到底（和 sumSet 相反） */
        setTimeout(function () { sumBox.scrollTop = sumBox.scrollHeight; }, 50);
      }
      function sumStep(n) {
        if (n === 0) {
          var m = simNum('simMag', 6.5);
          sumSet('mag', '基础参数', '模拟规模', 'M ' + m.toFixed(1), 'hl');
          sumSet('dep', '基础参数', '深度', simNum('simDep', 10) + ' km', '');
          sumSet('fault', '基础参数', '断层类型', SIM_FAULT_TXT[simVal('simFKind', 'auto')] || '自动判定', 'on');
        } else if (n === 1) {
          var a = sim.querySelector('#simTsuAuto'), b = sim.querySelector('#simCancelAuto');
          sumSet('tsu', '预警与数据源', '触发海啸预警', (a && a.checked) ? '开启' : '关闭', (a && a.checked) ? 'on' : '');
          sumSet('cancel', '预警与数据源', '误报取消', (b && b.checked) ? '开启' : '关闭', (b && b.checked) ? 'on' : '');
          sumSet('src', '预警与数据源', '数据源', simSrcLabel(), 'auto' === simVal('simSrc', 'auto') ? 'on' : '');
        } else {
          var pl = simVal('simPlace', '模拟震源');
          sumSet('place', '模拟环境', '震源地名', pl || '模拟震源', '');
          /* ★ 2026-10-26：自定义经纬度加回来后，摘要里同步显示震源坐标 */
          if (simLL) {
            sumSet('ll', '模拟环境', '震源坐标',
              (+simLL[0]).toFixed(3) + '°, ' + (+simLL[1]).toFixed(3) + '°', '');
          }
          /* ★ 2026-10-26 自定义时间：留空时写明「实时」 */
          sumSet('ctime', '模拟环境', '自定义时间', simTimeMs ? fmtSimTime(simTimeMs) : '实时',
            simTimeMs ? 'on' : '');
          var dsel = sim.querySelector('#simDelay'), ssel = sim.querySelector('#simSpeed');
          sumSet('delay', '模拟环境', '倒计时', dsel ? dsel.options[dsel.selectedIndex].text : '5 秒后', '');
          sumSet('speed', '模拟环境', '时间加速', ssel ? ssel.options[ssel.selectedIndex].text : '1×', '');
        }
      }
      function simGoto(n) {
        simStep = Math.max(0, Math.min(2, n));
        for (var i = 0; i < stepEls.length; i++) {
          if (stepEls[i]) stepEls[i].className = 'spanel' + (i === simStep ? ' on' : '');
          if (barEls[i]) barEls[i].className = (i <= simStep ? 'on' : '');
        }
        var pv = sim.querySelector('#simPrev'), nx = sim.querySelector('#simNext');
        if (pv) pv.disabled = (simStep === 0);
        if (nx) {
          nx.textContent = (simStep === 2) ? '开始模拟' : '下一步';
          nx.className = 'btn-next' + (simStep === 2 ? ' finish' : '');
        }
        sumStep(simStep);
      }
      function simView(which) {
        var tsu = (which === 'tsu'), lib = (which === 'lib'), conf = (which === 'confirm');
        var main = (!tsu && !lib && !conf);
        if (vMain) vMain.className = 'vlayer' + (main ? ' on' : '');
        if (vTsu) vTsu.className = 'vlayer' + (tsu ? ' on' : '');
        if (vLib) vLib.className = 'vlayer' + (lib ? ' on' : '');
        if (vConf) vConf.className = 'vlayer' + (conf ? ' on' : '');
        /* 右栏：只有「模板库」才切成筛选台；确认页/向导/海啸编辑器都回摘要看板 */
        if (rFilters) rFilters.className = 'rlayer' + (lib ? ' on' : '');
        if (tsu) sumAreas();
        if (lib) simBuildLib();
        /* 模式卡跟着当前视图走；回到向导时若还在「历史模板」有效期内就保持历史态 */
        if (lib || conf) simSyncMode('hist');
        else if (main) simSyncMode(histActive() ? 'hist' : 'custom');
      }
      function simSyncMode(val) {
        var box = sim.querySelector('#simModeSw');
        if (!box) return;
        Array.prototype.forEach.call(box.querySelectorAll('.option-btn'), function (b) {
          b.classList.toggle('on', b.getAttribute('data-val') === val);
        });
      }
      sim.querySelector('#simPrev').addEventListener('click', function () { simGoto(simStep - 1); });
      sim.querySelector('#simNext').addEventListener('click', function () {
        if (simStep < 2) { simGoto(simStep + 1); return; }
        simStartNow();
      });
      sim.querySelector('#simTsuOpen').addEventListener('click', function () { simView('tsu'); });
      sim.querySelector('#simTsuBack').addEventListener('click', function () { simView('main'); sumStep(simStep); });
      /* 断层类型 / 数据源：选项按钮 → 隐藏 input（保持 simVal() 的读法不变） */
      function setPick(gridId, hiddenId, val) {
        var g = sim.querySelector('#' + gridId), h = sim.querySelector('#' + hiddenId);
        if (!g || !h) return false;
        var hit = g.querySelector('.option-btn[data-val="' + val + '"]');
        if (!hit) return false;
        Array.prototype.forEach.call(g.querySelectorAll('.option-btn'), function (x) { x.classList.remove('on'); });
        hit.classList.add('on');
        h.value = val;
        return true;
      }
      function bindPickGrid(gridId, hiddenId) {
        var g = sim.querySelector('#' + gridId), h = sim.querySelector('#' + hiddenId);
        if (!g || !h) return;
        g.addEventListener('click', function (e) {
          var btn = e.target.closest ? e.target.closest('.option-btn') : null;
          if (!btn) return;
          setPick(gridId, hiddenId, btn.getAttribute('data-val'));
          sumStep(simStep);
        });
      }
      bindPickGrid('simFKindGrid', 'simFKind');
      bindPickGrid('simSrcGrid', 'simSrc');
      /* ★ 2026-10-26 自定义经纬度：改坐标 = 改震源（红叉 + 自动地名 + 地图重绘 + 摘要） */
      function simApplyLL() {
        var li = sim.querySelector('#simLat'), lo = sim.querySelector('#simLon');
        if (!li || !lo) return;
        var la = parseFloat(li.value), ln = parseFloat(lo.value);
        if (!isFinite(la) || !isFinite(ln)) return;
        la = Math.max(-90, Math.min(90, la));
        ln = Math.max(-180, Math.min(180, ln));
        simLL = [la, ln];
        var pi = sim.querySelector('#simPlace');
        if (pi) {
          var ap = '';
          try { ap = simPlaceFromLL(la, ln); } catch (eP) { ap = ''; }
          var cu = String(pi.value || '').trim();
          if (ap && (!cu || cu === '模拟震源' || cu === sim._autoPlace)) {
            pi.value = ap;
            sim._autoPlace = ap;
          }
        }
        if (global.QVMapCam && QVMapCam.lockPin) QVMapCam.lockPin([{ lat: la, lon: ln, kind: 'normal' }]);
        if (global.QVRedraw) QVRedraw();
        /* 坐标一改，「智能识别」的结论可能就变了（日本↔中国）→ 第 1 步那张数据源卡也要刷 */
        sumSet('src', '预警与数据源', '数据源', simSrcLabel(),
          ('auto' === simVal('simSrc', 'auto')) ? 'on' : '');
        sumStep(simStep);
      }
      ['#simLat', '#simLon'].forEach(function (sel) {
        var el = sim.querySelector(sel);
        if (!el) return;
        el.addEventListener('change', simApplyLL);
        el.addEventListener('blur', simApplyLL);
      });
      /* ★★★ 2026-10-26 历史模板：选中即回填整场事件
         （震中 / 深度 / 规模 / 地名 / 自定义时间 —— 时间一填就等于「只看这一场」）
         ⚠️ 只填参数，不绕过任何算法：烈度、测站、海啸依然全由 cn-gmpe.js 现算。
         2026-10-26 第二版：模板库合并了 world-quakes.js（境外事件）。
         · _histRec = 提示条 / 确认页要用的事件信息（中国+境外都有）
         · _cnRec   = **只对中国目录事件**设（官方极震区烈度锚定 / 断层迹线只对它成立），
                      境外事件设 null，避免用中国分区衰减式去套智利/日本。 */
      /* ★★★ 2026-10-26 用户：「地区名不应该是地区名吗，为什么是事件名」
         「震源地名」要的是地区名（XX冲 / XX县XX地方），不是「XX大地震」。
         优先级：模板自带的 place → 从事件名剥掉「大地震/地震/序列」→ 按坐标反推 → 兵底。 */
      function placeOf(k) {
        if (!k) return '模拟震源';
        if (k.place) return String(k.place);
        var nm = String(k.n || '')
          .replace(/（[^）]*）/g, '')
          .replace(/(大地震|地震|前震序列|序列|前震|深源)/g, '')
          .trim();
        if (nm) return nm;
        var ap = '';
        try { ap = simPlaceFromLL(+k.lat, +k.lon); } catch (eP2) { ap = ''; }
        return ap || '模拟震源';
      }

      function loadQuake(k, isWorld) {
        if (!k) return;
        var la = sim.querySelector('#simLat'), lo = sim.querySelector('#simLon');
        var mi = sim.querySelector('#simMag'), mr = sim.querySelector('#simMagR');
        var di = sim.querySelector('#simDep'), pi = sim.querySelector('#simPlace');
        if (la) la.value = (+k.lat).toFixed(3);
        if (lo) lo.value = (+k.lon).toFixed(3);
        if (mi) mi.value = (+k.mag).toFixed(1);
        if (mr) mr.value = Math.min(9.9, +k.mag);
        if (di) di.value = String(Math.round(+k.dep || 10));
        if (pi) { pi.value = placeOf(k); sim._autoPlace = ''; }
        sim._histRec = {
          n: k.n, t: k.t, mag: +k.mag, lat: +k.lat, lon: +k.lon,
          dep: +k.dep || 0, imax: k.imax, shindo: k.shindo,
          country: isWorld ? (k.country || '') : ''
        };
        sim._cnRec = isWorld ? null : k;
        simApplyLL();
        /* 深度滑块是「0~300 的位置」不是 km → 得跟着数字框重算一次，否则滑块原地不动 */
        var dr = sim.querySelector('#simDepR');
        if (dr) dr.value = String(depKmToPos(Math.max(0, Math.min(700, +k.dep || 10))));
        if (typeof paintRanges === 'function') paintRanges();
        /* 时间：1918/02/13 14:07 → 冻结数据源、专注这一场（和手填自定义时间同一套） */
        var mm = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(k.t || ''));
        var tEl3 = sim.querySelector('#simTime');
        if (mm && tEl3) {
          var ms = new Date(+mm[1], +mm[2] - 1, +mm[3], +(mm[4] || 0), +(mm[5] || 0), 0).getTime();
          tEl3.value = fmtSimTime(ms);
          simApplyTime();
        }
        syncHistBanner();
        sumStep(simStep);
        toast('已载入：' + k.n + '（M' + (+k.mag).toFixed(1) + ' / ' + (+k.dep || 0) + 'km）');
      }

      /* ═══ 模板库数据源：中国目录（cn-quakes.js）+ 世界目录（world-quakes.js）═══
         两边字段名一致（n/t/lat/lon/dep/mag/imax|shindo/tsu），这里合成一份，
         并补上 country：中国目录没有国家字段 → 按台湾本岛框判「中国台湾」，其余「中国」。
         ⚠️ __world = 1 的条目不参与 China GMPE 的烈度锚定（见 loadQuake）。 */
      var libCache = null;
      function libAll() {
        if (libCache) return libCache;
        var out = [], i, k, tw;
        var cn = global.QV_CN_QUAKES || [];
        for (i = 0; i < cn.length; i++) {
          k = cn[i];
          tw = (+k.lat >= 21.5 && +k.lat <= 25.5 && +k.lon >= 119.5 && +k.lon <= 122.3);
          out.push({
            __i: out.length, __world: 0, __k: k,
            n: k.n, t: k.t, lat: +k.lat, lon: +k.lon, dep: +k.dep || 0,
            mag: +k.mag, imax: k.imax, tsu: +k.tsu || 0,
            note: k.note || '', country: tw ? '中国台湾' : '中国'
          });
        }
        var w = global.QV_WORLD_QUAKES || [];
        for (i = 0; i < w.length; i++) {
          k = w[i];
          out.push({
            __i: out.length, __world: 1, __k: k,
            n: k.n, t: k.t, lat: +k.lat, lon: +k.lon, dep: +k.dep || 0,
            mag: +k.mag, imax: k.imax, shindo: k.shindo, tsu: +k.tsu || 0,
            note: k.note || '', country: k.country || '其他'
          });
        }
        libCache = out;
        return out;
      }
      /* 国家 / 地区选项：有哪国就出哪个（按条数降序），以后加数据不用改代码 */
      function libCountryOpts() {
        var all = libAll(), cnt = {}, order = [], i, c;
        for (i = 0; i < all.length; i++) {
          c = all[i].country;
          if (!cnt[c]) { cnt[c] = 0; order.push(c); }
          cnt[c]++;
        }
        order.sort(function (a, b) { return cnt[b] - cnt[a]; });
        var opts = [['all', '全部']];
        for (i = 0; i < order.length; i++) {
          opts.push([order[i], order[i] === '中国' ? '中国大陆' : order[i]]);
        }
        return opts;
      }
      function shortCountry(c) {
        return c === '中国台湾' ? '台湾' : (c === '中国' ? '中国' : c);
      }
      /* 经纬度带 N/S、E/W（南半球 / 西半球不能写死 °N） */
      function llText(k) {
        var la = Math.abs(+k.lat).toFixed(2) + '°' + (+k.lat >= 0 ? 'N' : 'S');
        var lo = Math.abs(+k.lon).toFixed(2) + '°' + (+k.lon >= 0 ? 'E' : 'W');
        return la + ' ' + lo;
      }
      /* 日本目录给的是「震度」，中国 / 境外给的是「极震区烈度」—— 两种尺度不能混写 */
      function maxiText(k) {
        if (k && k.shindo) return '最大震度 ' + k.shindo;
        if (k && k.imax) return '极震区 ' + k.imax + ' 度';
        return '';
      }

      /* ═══ 历史模板库（2026-10-26 diui.html 定稿版：右侧筛选台）═══
         结构完全照设计稿：搜索框（放大镜 + 清空）+「筛选条件 / 重置全部」+
         每组「标题 · 当前值 + 清空」+ 胶囊（带条数）+ 底部结果数。
         ⚠️ 定稿版砍掉了「区域」这一维（目录里没有省份字段）—— 这里也不做假的。 */
      var LIB = { q: '', country: 'all', era: 'all', mag: 'all', tsu: 'all' };
      var LIB_DIMS = [
        /* country 的 opts 在运行时由 libCountryOpts() 生成（数据里有哪国就出哪国） */
        { key: 'country', label: '国家 / 地区', opts: null },
        { key: 'era', label: '年代', opts: [['all', '全部'], ['old', '1900 前'], ['20c', '1900–1999'], ['21c', '2000 后']] },
        { key: 'mag', label: '震级', opts: [['all', '全部'], ['m6', '< 7.0'], ['m7', '7.0–7.9'], ['m8', '≥ 8.0']] },
        { key: 'tsu', label: '海啸', opts: [['all', '全部'], ['yes', '有海啸记录']] }
      ];

      function libYear(k) {
        var m = /^(\d{4})/.exec(String((k && k.t) || ''));
        return m ? +m[1] : 0;
      }
      function libDimOk(k, key, val) {
        if (val === 'all') return true;
        if (key === 'country') return k.country === val;
        if (key === 'era') {
          var y = libYear(k);
          if (val === 'old') return y > 0 && y < 1900;
          if (val === '20c') return y >= 1900 && y <= 1999;
          if (val === '21c') return y >= 2000;
          return true;
        }
        if (key === 'mag') {
          var mg = +k.mag || 0;
          if (val === 'm6') return mg < 7;
          if (val === 'm7') return mg >= 7 && mg < 8;
          if (val === 'm8') return mg >= 8;
          return true;
        }
        if (key === 'tsu') return val === 'yes' ? (+k.tsu > 0) : true;
        return true;
      }
      /* skipKey = 算该维各选项条数时跳过自己这一维（分面计数） */
      function libMatch(k, skipKey) {
        if (!k) return false;
        if (LIB.q) {
          var hay = String(k.n || '') + ' ' + String(k.t || '') + ' ' + String(k.note || '');
          if (hay.toLowerCase().indexOf(LIB.q) < 0) return false;
        }
        for (var i = 0; i < LIB_DIMS.length; i++) {
          var d = LIB_DIMS[i];
          if (d.key === skipKey) continue;
          if (!libDimOk(k, d.key, LIB[d.key])) return false;
        }
        return true;
      }
      function libDimCount(key, val) {
        var all = libAll(), n = 0;
        for (var i = 0; i < all.length; i++) {
          if (libMatch(all[i], key) && libDimOk(all[i], key, val)) n++;
        }
        return n;
      }
      function libPills() {
        var box = sim.querySelector('#simLibPills');
        if (!box) return;
        var out = '';
        for (var i = 0; i < LIB_DIMS.length; i++) {
          var d = LIB_DIMS[i], cur = LIB[d.key], curTxt = '', pills = '';
          var opts = (d.key === 'country') ? libCountryOpts() : d.opts;
          for (var j = 0; j < opts.length; j++) {
            var val = opts[j][0], lab = opts[j][1];
            if (val === cur) curTxt = lab;
            var c = libDimCount(d.key, val);
            pills += '<button class="pill' + (cur === val ? ' on' : '') + '" data-k="' + d.key +
              '" data-v="' + val + '"' + (c === 0 && val !== 'all' ? ' disabled' : '') + '>' +
              lab + '<em>' + c + '</em></button>';
          }
          out += '<div class="fgroup">' +
            '<div class="fhead"><div class="fhead-left">' +
            '<span>' + d.label + '</span><span class="cur-val">· ' + curTxt + '</span>' +
            '</div>' +
            (cur !== 'all' ? '<button class="btn-clear-dim" data-reset="' + d.key + '">清空</button>' : '') +
            '</div><div class="pills">' + pills + '</div></div>';
        }
        box.innerHTML = out;
        var qEl = sim.querySelector('#simLibQ'), qc = sim.querySelector('#simLibQClear');
        if (qEl && qEl.value.toLowerCase() !== LIB.q) qEl.value = LIB.q;
        if (qc) qc.classList.toggle('on', !!LIB.q);
      }
      function libRender() {
        var box = sim.querySelector('#simLibList');
        if (!box) return;
        var all = libAll();
        var html = '', n = 0;
        for (var i = 0; i < all.length; i++) {
          var k = all[i];
          if (!libMatch(k)) continue;
          n++;
          var meta = llText(k) + ' · 深 ' + k.dep + 'km';
          if (maxiText(k)) meta += ' · ' + maxiText(k);
          if (k.tsu > 0) meta += ' · 海啸 ' + k.tsu + 'm';
          html += '<div class="libcard" data-i="' + k.__i + '">' +
            '<div class="lc-main">' +
            '<div class="lc-name">' + escA(k.n) + '<span class="lc-time">' + escA(k.t) + '</span></div>' +
            '<div class="lc-meta">' + escA(meta) + '</div>' +
            '</div>' +
            '<div class="lc-right">' +
            '<div class="lc-mag">M ' + k.mag.toFixed(1) + '</div>' +
            '<div class="lc-tag">' + escA(shortCountry(k.country)) + '</div>' +
            '</div>' +
            '</div>';
        }
        var cnt = sim.querySelector('#simLibCount');
        if (cnt) cnt.textContent = '共 ' + n + ' / ' + all.length + ' 条';
        var cnt2 = sim.querySelector('#simFilterCount');
        if (cnt2) cnt2.textContent = String(n);
        box.innerHTML = html || '<div class="libempty">没有符合条件的模板，换个筛选试试</div>';
      }
      function simBuildLib() { libPills(); libRender(); }

      /* 「算不算载入了那一场」的判据 = simStartNow 里 _cnRec 生效的条件，
         所以提示条、模式卡、算法锚定三者不会互相打架。
         （提示条用 _histRec：境外事件没有 _cnRec，但也要显示名字） */
      function histActive() {
        var r = sim._histRec;
        var mi = parseFloat((sim.querySelector('#simMag') || {}).value);
        return !!r && !!simLL &&
          Math.abs((+r.mag) - mi) < 0.05 &&
          Math.abs((+r.lat) - simLL[0]) < 0.01 && Math.abs((+r.lon) - simLL[1]) < 0.01;
      }
      function syncHistBanner() {
        var b = sim.querySelector('#simHistBanner');
        if (!b) return;
        if (!histActive()) { b.hidden = true; b.innerHTML = ''; return; }
        var r = sim._histRec;
        b.hidden = false;
        b.innerHTML = '<span class="hb-tag">历史模板</span><b>' + escA(r.n) + '</b>' +
          '<span class="hb-meta">M' + (+r.mag).toFixed(1) + ' · ' + (+r.dep || 0) + 'km · ' +
          escA(r.t) + (maxiText(r) ? ' · ' + escA(maxiText(r)) : '') +
          (r.country ? ' · ' + escA(r.country) : '') + '</span>' +
          '<button class="mini-btn" id="simHistChange">换一个模板</button>';
      }

      /* 模式二选一：架空 = 留在向导；历史模板 = 打开模板库 */
      var modeSw = sim.querySelector('#simModeSw');
      if (modeSw) {
        modeSw.addEventListener('click', function (e) {
          var btn = e.target.closest ? e.target.closest('.option-btn') : null;
          if (!btn) return;
          if (btn.getAttribute('data-val') === 'hist') { simView('lib'); return; }
          /* 架空 = 不是复现某场历史地震 → 撤掉官方极震区烈度锚定（参数本身保留） */
          if (sim._histRec) {
            sim._histRec = null;
            sim._cnRec = null;
            syncHistBanner();
            toast('已切回架空模拟：参数保留，不再用历史极震区烈度锚定');
          }
          simView('main');
          sumStep(simStep);
        });
      }
      var histOpen = sim.querySelector('#simHistOpen');
      if (histOpen) histOpen.addEventListener('click', function () { simView('lib'); });
      var hbBox = sim.querySelector('#simHistBanner');
      if (hbBox) {
        hbBox.addEventListener('click', function (e) {
          var b2 = e.target.closest ? e.target.closest('#simHistChange') : null;
          if (b2) simView('lib');
        });
      }
      var libList = sim.querySelector('#simLibList');
      if (libList) {
        libList.addEventListener('click', function (e) {
          var card = e.target.closest ? e.target.closest('.libcard') : null;
          if (!card) return;
          var list = libAll();
          var k = list[parseInt(card.getAttribute('data-i'), 10)];
          if (!k) return;
          loadQuake(k.__k, k.__world);
          openConfirm();
        });
      }
      var libPillBox = sim.querySelector('#simLibPills');
      if (libPillBox) {
        libPillBox.addEventListener('click', function (e) {
          if (!e.target.closest) return;
          var clr = e.target.closest('.btn-clear-dim');
          if (clr) { LIB[clr.getAttribute('data-reset')] = 'all'; simBuildLib(); return; }
          var p = e.target.closest('.pill');
          if (!p || p.disabled) return;
          LIB[p.getAttribute('data-k')] = p.getAttribute('data-v');
          simBuildLib();
        });
      }
      var libQ = sim.querySelector('#simLibQ');
      if (libQ) {
        libQ.addEventListener('input', function () {
          LIB.q = String(libQ.value || '').trim().toLowerCase();
          simBuildLib();          /* 条数也跟着搜索词变 → 筛选项一起重画 */
        });
      }
      var libQClear = sim.querySelector('#simLibQClear');
      if (libQClear) {
        libQClear.addEventListener('click', function () {
          LIB.q = '';
          if (libQ) libQ.value = '';
          simBuildLib();
        });
      }
      var libReset = sim.querySelector('#simLibReset');
      if (libReset) {
        libReset.addEventListener('click', function () {
          LIB.q = ''; LIB.country = 'all'; LIB.era = 'all'; LIB.mag = 'all'; LIB.tsu = 'all';
          if (libQ) libQ.value = '';
          simBuildLib();
        });
      }
      var libBack = sim.querySelector('#simLibBack');
      if (libBack) libBack.addEventListener('click', function () { simView('main'); });

      /* ═══ 历史参数确认页（2026-10-26 用户：「人家向导做得很好，点一下就直接到确认、
         就开始模拟了」）—— 确认页控件全部回写到向导那几个 input，
         所以「直接开始模拟」走的还是原来那条 simStartNow()，算法链路一个字没动。 */
      var cMagR = sim.querySelector('#simCMagR'), cMag = sim.querySelector('#simCMag');
      var cDepR = sim.querySelector('#simCDepR'), cDep = sim.querySelector('#simCDep');
      var cPlace = sim.querySelector('#simCPlace');
      var cLat = sim.querySelector('#simCLat'), cLon = sim.querySelector('#simCLon');
      var cFault = sim.querySelector('#simCFaultGrid');

      function openConfirm() {
        var r = sim._histRec;
        var nm = sim.querySelector('#simConfName');
        if (nm) nm.textContent = r ? r.n : '手动参数';
        var bn = sim.querySelector('#simConfBanner');
        if (bn) {
          if (r) {
            bn.hidden = false;
            bn.innerHTML = '<span class="hb-tag">历史模板</span><b>' + escA(r.n) + '</b>' +
              '<span class="hb-meta">' + escA(r.t) +
              (maxiText(r) ? ' · ' + escA(maxiText(r)) : '') +
              (r.country ? ' · ' + escA(r.country) : '') + ' · 公开目录参数</span>';
          } else { bn.hidden = true; bn.innerHTML = ''; }
        }
        if (cMag) cMag.value = confNum('#simMag', 6.5).toFixed(1);
        if (cMagR) cMagR.value = String(confNum('#simMag', 6.5));
        if (cDep) cDep.value = String(Math.round(confNum('#simDep', 10)));
        if (cDepR) cDepR.value = String(depKmToPos(confNum('#simDep', 10)));
        if (cPlace) cPlace.value = confStr('#simPlace', '模拟震源');
        if (cLat) cLat.value = simLL ? (+simLL[0]).toFixed(3) : '35.000';
        if (cLon) cLon.value = simLL ? (+simLL[1]).toFixed(3) : '139.000';
        if (cFault) {
          var fk = simVal('simFKind', 'auto') || 'auto';
          Array.prototype.forEach.call(cFault.querySelectorAll('.option-btn'), function (b) {
            b.classList.toggle('on', b.getAttribute('data-val') === fk);
          });
        }
        if (cMagR) paintRange(cMagR);
        if (cDepR) paintRange(cDepR);
        simView('confirm');
      }
      function confNum(sel, def) {
        var el = sim.querySelector(sel);
        var v = parseFloat(el ? el.value : NaN);
        return isFinite(v) ? v : def;
      }
      function confStr(sel, def) {
        var el = sim.querySelector(sel);
        return (el && String(el.value || '').trim()) || def;
      }
      function cMagPush() {
        if (!cMag || !cMagR) return;
        var v = parseFloat(cMag.value);
        if (isFinite(v)) cMagR.value = String(Math.max(1, Math.min(9.9, v)));
        v = parseFloat(cMag.value);
        var wm = sim.querySelector('#simMag'), wr = sim.querySelector('#simMagR');
        if (isFinite(v)) {
          v = Math.max(1, Math.min(9.9, v));
          if (wm) wm.value = v.toFixed(1);
          if (wr) wr.value = String(v);
        }
        paintRange(cMagR); if (wr) paintRange(wr);
        syncHistBanner(); sumStep(simStep);
      }
      function cDepPush() {
        if (!cDep || !cDepR) return;
        var pos = parseFloat(cDepR.value);
        var km = parseFloat(cDep.value);
        if (isFinite(km)) cDepR.value = String(depKmToPos(Math.max(0, Math.min(700, km))));
        else if (isFinite(pos)) cDep.value = String(Math.round(depPosToKm(pos)));
        km = Math.max(0, Math.min(700, parseFloat(cDep.value) || 10));
        var wd = sim.querySelector('#simDep'), wdr = sim.querySelector('#simDepR');
        if (wd) wd.value = String(Math.round(km));
        if (wdr) wdr.value = String(depKmToPos(km));
        paintRange(cDepR); if (wdr) paintRange(wdr);
        sumStep(simStep);
      }
      if (cMagR) cMagR.addEventListener('input', cMagPush);
      if (cMag) cMag.addEventListener('input', cMagPush);
      if (cDepR) cDepR.addEventListener('input', cDepPush);
      if (cDep) cDep.addEventListener('input', cDepPush);
      if (cPlace) cPlace.addEventListener('input', function () {
        var wp = sim.querySelector('#simPlace');
        if (wp) { wp.value = cPlace.value; sim._autoPlace = ''; }
        sumStep(simStep);
      });
      if (cFault) {
        cFault.addEventListener('click', function (e) {
          var b = e.target.closest ? e.target.closest('.option-btn') : null;
          if (!b) return;
          setPick('simFKindGrid', 'simFKind', b.getAttribute('data-val'));
          Array.prototype.forEach.call(cFault.querySelectorAll('.option-btn'), function (x) {
            x.classList.toggle('on', x === b);
          });
          sumStep(simStep);
        });
      }
      /* 确认页改坐标 = 改震源（同步红叉 / 自动地名 / 地图重绘），走原来那套 */
      function cLLPush() {
        var wla = sim.querySelector('#simLat'), wlo = sim.querySelector('#simLon');
        var la = parseFloat(cLat ? cLat.value : ''), ln = parseFloat(cLon ? cLon.value : '');
        if (!isFinite(la) || !isFinite(ln) || !wla || !wlo) return;
        wla.value = Math.max(-90, Math.min(90, la)).toFixed(3);
        wlo.value = Math.max(-180, Math.min(180, ln)).toFixed(3);
        simApplyLL();
        syncHistBanner();
        sumStep(simStep);
      }
      if (cLat) { cLat.addEventListener('change', cLLPush); cLat.addEventListener('blur', cLLPush); }
      if (cLon) { cLon.addEventListener('change', cLLPush); cLon.addEventListener('blur', cLLPush); }
      var cBack = sim.querySelector('#simCBack');
      if (cBack) cBack.addEventListener('click', function () { simView('lib'); });
      var cGo = sim.querySelector('#simCGo');
      if (cGo) cGo.addEventListener('click', function () {
        /* 确认页上可能还有没 blur 的输入框，先把它们落到向导 input 上 */
        cMagPush(); cDepPush(); cLLPush();
        if (cPlace) { var wp2 = sim.querySelector('#simPlace'); if (wp2) wp2.value = cPlace.value; }
        simStartNow();
      });
      /* ★★★ 2026-10-26 自定义时间：填了就是「只看这一场」
         · 解析成功 → 清空全部历史地震（QData.clearAll）+ 冻结数据源
         · 留空 → 解冻并拉回真实数据 */
      function simApplyTime() {
        var el = sim.querySelector('#simTime');
        if (!el) return;
        var raw = String(el.value || '').trim();
        if (!raw) {
          var wasTime = !!simTimeMs;
          simTimeMs = 0;
          if (global.QData && QData.freeze) QData.freeze(false);
          /* 从「专注某一刻」切回实时：把真实数据拉回来 */
          if (wasTime && global.QData && QData.refresh) QData.refresh();
          el.classList.remove('bad');
          sumStep(simStep);
          return;
        }
        var ms = parseSimTime(raw);
        if (ms == null) {
          el.classList.add('bad');
          toast('时间格式：2026/08/09/06:04:55 或 20260809060455');
          return;
        }
        el.classList.remove('bad');
        el.value = fmtSimTime(ms);
        simTimeMs = ms;
        if (global.QData) {
          if (QData.freeze) QData.freeze(true);
          if (QData.clearAll) QData.clearAll();
        }
        toast('已清空历史地震，专注 ' + fmtSimTime(ms));
        sumStep(simStep);
      }
      var timeEl = sim.querySelector('#simTime');
      if (timeEl) {
        timeEl.addEventListener('change', simApplyTime);
        timeEl.addEventListener('blur', simApplyTime);
      }
      /* 两个开关：卡片描边 + 摘要 */
      ['#simTsuAuto', '#simCancelAuto'].forEach(function (sel) {
        var c = sim.querySelector(sel);
        if (!c) return;
        c.addEventListener('change', function () {
          var card = c.closest ? c.closest('.switch-card') : null;
          if (card) card.classList.toggle('on', !!c.checked);
          sumStep(simStep);
        });
      });
      /* ★★★ 2026-10-26 用户：「深度滑块范围应该分段：0-50 一个档 / 50-160 一个档 / 160-700 一个档」
         ⇒ 滑块本身是 0~300 的【位置】，三段各占 1/3 宽，再分段线性映射成深度：
             位置   0~100 → 深度   0~50   （每格 0.5 km，浅源最关键，给最细）
             位置 100~200 → 深度  50~160  （每格 1.1 km）
             位置 200~300 → 深度 160~700  （每格 5.4 km）
         数字框仍显示真实深度（0~700 km），对外读取仍是 simNum('simDep')。 */
      var DEP_POS_MAX = 300;
      function depPosToKm(p) {
        p = Math.max(0, Math.min(DEP_POS_MAX, isFinite(p) ? p : 0));
        if (p <= 100) return p * 0.5;
        if (p <= 200) return 50 + (p - 100) * 1.1;
        return 160 + (p - 200) * 5.4;
      }
      function depKmToPos(km) {
        km = Math.max(0, Math.min(700, isFinite(km) ? km : 10));
        if (km <= 50) return km / 0.5;
        if (km <= 160) return 100 + (km - 50) / 1.1;
        return 200 + (km - 160) / 5.4;
      }
      /* 深度：位置滑块 ↔ 真实深度（M 的那套联动在下面原样保留） */
      var depR = sim.querySelector('#simDepR'), depN = sim.querySelector('#simDep');
      if (depR && depN) {
        /* 初始位置跟着数字框走（默认 10 km → 位置 20） */
        depR.value = String(depKmToPos(parseFloat(depN.value) || 10));
        depR.addEventListener('input', function () {
          depN.value = String(Math.round(depPosToKm(parseFloat(depR.value))));
          sumStep(simStep);
        });
        depN.addEventListener('input', function () {
          var v = parseFloat(depN.value);
          if (isFinite(v)) depR.value = String(depKmToPos(Math.max(0, Math.min(700, v))));
        });
        depN.addEventListener('change', function () {
          var v = parseFloat(depN.value);
          if (!isFinite(v)) v = 10;
          v = Math.max(0, Math.min(700, v));
          depN.value = String(Math.round(v));
          depR.value = String(depKmToPos(v));
          sumStep(simStep);
        });
      }
      /* ★ 2026-10-26 SREV / Scratch 风格滑块：把「已选比例」写进 --p，
         轨道用 linear-gradient 填到旋钮位置（CSS 只负责画，比例只能由 JS 算）。 */
      function paintRange(el) {
        if (!el) return;
        var mn = parseFloat(el.min), mx = parseFloat(el.max), v = parseFloat(el.value);
        if (!isFinite(mn)) mn = 0;
        if (!isFinite(mx) || mx <= mn) mx = mn + 1;
        if (!isFinite(v)) v = mn;
        el.style.setProperty('--p', ((v - mn) / (mx - mn) * 100).toFixed(2) + '%');
      }
      function paintRanges() {
        paintRange(sim.querySelector('#simMagR'));
        paintRange(sim.querySelector('#simDepR'));
        paintRange(sim.querySelector('#simRateR'));
      }
      /* ★ 发报频率调节滑块：0 不发报 / 1 默认 / 2 快速 / 3 密集（只改续报，不改算法） */
      var rateR = sim.querySelector('#simRateR'), rateTxt = sim.querySelector('#simRateTxt');
      var RATE_TXT = ['不发报', '默认', '快速', '密集'];
      function syncRate() {
        var v = parseInt(rateR && rateR.value, 10);
        simRate = (v >= 0 && v <= 3) ? v : 1;
        if (rateTxt) rateTxt.textContent = RATE_TXT[simRate];
        paintRange(rateR);
      }
      if (rateR) {
        rateR.addEventListener('input', syncRate);
        rateR.addEventListener('change', syncRate);
        syncRate();
      }
      ['#simMagR', '#simDepR', '#simMag', '#simDep'].forEach(function (sel) {
        var el = sim.querySelector(sel);
        if (!el) return;
        el.addEventListener('input', paintRanges);
        el.addEventListener('change', paintRanges);
      });
      paintRanges();
      /* 任何改动都刷新当前步的摘要（只更新已建好的卡，不会乱长）
         + 历史模板提示条：规模/震中一改就不再是那一场，自动隐藏 */
      sim.addEventListener('input', function () { sumStep(simStep); syncHistBanner(); });
      sim.addEventListener('change', function () { sumStep(simStep); syncHistBanner(); });
      /* 沿岸区域增删 / 批量导入 / 注入后，右栏「沿岸区域」数量跟着变 */
      ['#simAreaAdd', '#simAreaClear', '#simPasteAppend', '#simPasteReplace', '#simT'].forEach(function (sel) {
        var b = sim.querySelector(sel);
        if (b) b.addEventListener('click', function () { setTimeout(sumAreas, 0); });
      });
      /* 每次打开都回到向导第 1 步（海啸行保留，不清空） */
      sim._wizard = function () { simView('main'); simGoto(0); syncHistBanner(); };
      sim._setPick = setPick;
    }
    sim.querySelector('#simLat') && (sim.querySelector('#simLat').value = simLL[0].toFixed(3));
    sim.querySelector('#simLon') && (sim.querySelector('#simLon').value = simLL[1].toFixed(3));
    /* ★ 2026-10-26 自定义时间：上次填过就回填（冻结状态也跟着保持） */
    var timeBox = sim.querySelector('#simTime');
    if (timeBox) timeBox.value = simTimeMs ? fmtSimTime(simTimeMs) : '';
    /* 预览红叉 = 刚点选的位置（官方红叉素材 epc30） */
    if (global.QVMapCam && QVMapCam.lockPin) QVMapCam.lockPin([{ lat: simLL[0], lon: simLL[1], kind: 'normal' }]);
    if (global.QVRedraw) QVRedraw();
    syncShakeBar();
    /* ★ 2026-10-26 震源地名自动填充：按点选的震中推「区划地名」。
       只在用户没自己改过时才覆盖（空 / 还是「模拟震源」/ 还是上次自动填的值）。 */
    var placeEl = sim.querySelector('#simPlace');
    if (placeEl) {
      var autoPlace = '';
      try { autoPlace = simPlaceFromLL(simLL[0], simLL[1]); } catch (eP) { autoPlace = ''; }
      var curPlace = String(placeEl.value || '').trim();
      if (autoPlace && (!curPlace || curPlace === '模拟震源' || curPlace === sim._autoPlace)) {
        placeEl.value = autoPlace;
        sim._autoPlace = autoPlace;
      }
    }
    /* ★ 2026-10-26 数据源默认 = 智能识别（按震源区域自动选卡）
       必须在 _wizard() 之前设，否则第 1 步摘要里还是旧值 */
    if (sim._setPick) sim._setPick('simSrcGrid', 'simSrc', 'auto');
    /* ★ 2026-10-26：每次打开都回到向导第 1 步，右栏摘要重画一遍 */
    if (sim._wizard) sim._wizard();
    sim.className = 'on';
  }
  V.openSim = openSim;
  V.cancelSim = cancelSim;
  V.startSimPick = startSimPick;
  V._simMakeTsunami = simMakeTsunami;   /* 调试：控制台直接看多等级生成结果 */
  V._simIsLand = simIsLand;
  V._simSeaPath = simSeaPath;
  V._simTsuAreas = simTsuAreas;      /* 调试：看海啸到底会给哪些沿岸区发布 */
  V._lgpmMaxRank = lgpmMaxRank;      /* 调试：長周期階級（LPGM 公式）直接算 */
  V._lgpmSv = lgpmSv;
  V._simFault = simFault;               /* 调试：看 Wells&Coppersmith 几何 + Okada η₀ */
  V._simPlaceFromLL = simPlaceFromLL;   /* 调试：震源坐标 → 区划地名 */
  V._okada = OKADA;                     /* 调试：Okada(1985) uz / etaPeak */
  /* ★ 2026-10-25 补的调试导出（排查「中国沿岸一个区都不发」） */
  V._simTsuAreas = simTsuAreas;
  V._simTsuHeight = simTsunamiHeight;
  V._simShelfDepth = simShelfDepth;     /* 调试：中国近海陆架水深（Green's law 用） */
  V._simShoal = simShoal;
  V._simRunup = simRunup;
  V._simMakeTsunami = simMakeTsunami;   /* 调试：直接生成一份模拟海啸情报（不注入） */
  V._simTsuClass = simTsuClass;

  /* 底部动作按钮（官方 paPut 行底板 + 我们的中文，见 gen-view3b 补的 auto 控件） */
  function actionFor(c) {
    var l = c.label || '';
    if (/导出/.test(l)) return openDialog;
    if (/保存/.test(l)) return saveToBrowser;
    if (/重置/.test(l)) return resetAll;
    if (/关于/.test(l)) return openAbout;
    if (/地震模拟|模拟设置/.test(l)) return startSimPick;
    return null;
  }

  /* ---------------- 对外 ---------------- */
  V.setView = setView;
  V.prepare = prepare;
  V.render = renderView;
  V.syncHits = function () { syncHits(); };
  /* ★ 当前正在显示的履历行（hovpill.js 用它做悬停命中） */
  V.getRows = function () { return (hits && hits.rows) || []; };
  V.opt = opt;
  V.applyOpts = applyOpts;
  V.toast = toast;
  V.viewScroll = function (dy) { if (V.view === 1 || V.view === 2 || V.view === 3) scroll3(dy); };
  /* ⚠️ 这里以前写 slice(0, 4) —— 但 render3 画的是 **9 行**，会让第 5~9 行没有命中数据
     （药丸用 QVViews.getRows() 做悬停命中）。改成 9，与 ROWSLOTS 一致。 */
  V.setRows = function (rows) { hits.rows = (rows || []).slice(0, 9); syncHits(); };
  V.viewDrag = dragTo;
  V.ctrlClick = ctrlClick;
  V.build3 = build3;
  V.openAbout = openAbout;
  V.infoFeeds = infoFeeds;
  V.infoVersion = infoVersion;
  V.state = function () { return { view: V.view, scroll: V.scroll, uiScale: 0.8 + V.opts.uiScale * 0.4, opts: V.opts }; };
  /* ★ 模拟地震时地图色块的数据源（render3.syncAreas 优先用它） */
  V.sndmArt = function () { return EEW_ART.sndm; };
  /* ★ 2026-11-02 供启动页预热：EEW 卡片会用到的全部造型 URL（递归收集）。
     这些图只在模拟/速报**第一次出现时**才 new 出来，不预热的话
     用户点开「地震模拟」看到的是一张半空白的卡。 */
  V.eewArtUrls = function () {
    var out = [];
    (function walk(o) {
      if (!o) return;
      if (typeof o === 'string') {
        if (/\.(svg|png|jpe?g|webp)(\?|$)/i.test(o)) out.push(o);
        return;
      }
      if (typeof o !== 'object') return;
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) walk(o[k]);
    })(EEW_ART);
    (function walk2(o) {
      if (!o) return;
      if (typeof o === 'string') { if (/\.(svg|png|jpe?g|webp)(\?|$)/i.test(o)) out.push(o); return; }
      if (typeof o !== 'object') return;
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) walk2(o[k]);
    })(EEW_BG);
    return out;
  };
  /* ================= 真实 EEW（wolfx 推送）→ Tab2 速报页 =================
   * 与模拟的区别：
   *   · q.real = true → setEEW 只画当前这一报，不排模拟报送循环
   *   · 精度门槛：1点/PLUM/レベル法的震源是假值 → 不做推定（但已发警報的不拦）
   *   · 地图色块是【推定】，VXSE51/53 到达后由 applyMeasured 覆盖成【实测】
   */
  var _realEewKey = '';
  /* ★★★ 2026-11-04 用户：「有些地震速报（isEew=true）已经过去很久了，怎么还会收到提示」
     真因：WOLF-X 的 jma_eew.json 会一直挂着**最后一条** EEW、P2P 的 556 history
     一次返回最近 20 条历史速报；realsrc 每 2 秒轮询，首轮启动把这些全当「新报」
     emit → app.js 对每条 isEew 直接调 onRealEew → 几小时前甚至几天前的速报
     照样弹 Tab2 卡片 / 响音效 / 亮红色横幅。
     ⇒ 通知链路统一加时效门槛：以「发报时刻 pubMs（缺省发震时刻 timeMs）」为准，
       超过 10 分钟（与 pumpEewFromList 一致）一律不接管画面、不响音效。
       后续第 N 报的 pubMs 是新的，仍会正常弹，不受影响。
     ⚠ 事件录制回放（record.js）把时刻平移到现在并打 __replay 标记 → 豁免。 */
  var REAL_EEW_MAX_AGE = 10 * 60000;
  function eewIsFresh(q) {
    var t = +q.pubMs || +q.timeMs || 0;
    if (!(t > 0)) return false;
    var age = Date.now() - t;
    if (age > REAL_EEW_MAX_AGE) return false;
    if (age < -2 * 60000) return false;   /* 时区/时钟异常导致的未来时刻 → 不弹 */
    return true;
  }
  function onRealEew(q) {
    if (!q || !q.isEew || q.isTraining) return false;
    /* ★ 2026-10-25：模拟进行中 → 真实电文一律不接管画面 */
    if (V.simOn) return false;
    /* ★ 2026-11-04：过期速报不再弹提示（回放豁免） */
    if (!q.__replay && !q.sim && !eewIsFresh(q)) return false;
    var key = (q.eventId || q.id || '') + '|' + (q.seq || 0) + '|' +
      (q.isCancel ? 'C' : '') + '|' + (q.isFinal ? 'F' : '');
    if (key === _realEewKey) return false;
    _realEewKey = key;

    var lv = (q.maxShindo >= 0 ? q.maxShindo : (q.shindo >= 0 ? q.shindo : -1));
    /* ★★★ 2026-10-30 用户：「真实速报如果来自中国，应该使用中国专用的预警卡片展示（或者仅记录进列表/走中国卡）」
       —— 中国真实速报走中国卡（Tab1），绝不进入日式 setEEW，绝不生成假测站！ */
    if (isCnEew(q)) {
      q.real = true;
      if (typeof V.setView === 'function') {
        try { V.setView(0); } catch (eTab) { }
      }
      if (global.QVRedraw) {
        try { global.QVRedraw(); } catch (eRdr) { }
      }
      if (global.QVMapCam && isFinite(q.lat) && isFinite(q.lon)) {
        try {
          if (QVMapCam.lockPin) QVMapCam.lockPin([{ lat: +q.lat, lon: +q.lon, kind: 'eew' }]);
          if (QVMapCam.setPins) QVMapCam.setPins([{ lat: +q.lat, lon: +q.lon, kind: 'eew' }]);
          if (QVMapCam.focus && (!QVMapCam.opt || QVMapCam.opt('follow'))) {
            QVMapCam.focus(q, true);
          }
        } catch (eCam) { }
      }
      try {
        if (global.QVSpeak && QVSpeak.eew) {
          var li0 = isFinite(+q.liedu) && +q.liedu >= 1 ? Math.min(12, Math.round(+q.liedu)) : 1;
          QVSpeak.eew(li0);
        }
      } catch (eSnd) { }
      return true;
    }
    /* ★★★ 2026-10-29 用户：「如果检测到最早的日本地震消息，就算没有具体位置，
       摄像机自动跳到日本全境，同时最早的地震消息也应该使用 Tab2 页面」
       —— 以前这里 `if (!isFinite(q.lat) || !isFinite(q.lon)) return false;`：
          日本速报的**首报**（P2P「震源調査中」/ wolfx PLUM 前几报）根本没有坐标，
          于是整条被丢掉 → Tab2 一次都不出现，用户永远只看到 Tab1 的卡片。
       ⇒ 日本源的首报一律放行（卡片写「震源調査中」，不跑 GMPE / 不画红叉，
          镜头退回日本全境）；其它源仍然要求坐标。 */
    var _hp = hasHypo(q);
    if (!_hp && !isJpEew(q)) return false;

    /* 取消报：走 setEEW 的 cancel 分支（不排报文循环，8 秒后自动收摊） */
    if (q.isCancel) {
      q.real = true;
      setEEW(q, lv);
      return true;
    }

    var acc = q.accuracy || {};
    var accTxt = String((acc && (acc.Epicenter || acc.epicenter)) || '');
    var lowAcc = !!q.isAssumption || /1点|1\s*点|PLUM|レベル法|仮定震源/i.test(accTxt);
    /* ★ 2026-10-29：低精度报只有在**带坐标**时才拦（那会把震源画到错的地方）；
       没有坐标的首报照常进 Tab2 —— 它只是「震源調査中」，不会误导地图。 */
    if (lowAcc && !q.isWarn && _hp) {
      try { console.log('[eew] skip low-accuracy report: ' + accTxt); } catch (e) { }
      return false;
    }

    q.real = true;
    q.lowAccuracy = lowAcc;
    q.noHypo = !_hp;
    /* 没有震源也没有震度 → 卡片直接写「不明」，不要拿估算值冒充实测 */
    if (!_hp && !(lv >= 1)) { setEEW(q, -1); return true; }
    if (!(lv >= 1)) {
      var est = (global.QData && QData.estimateRank) ? QData.estimateRank(q) : null;
      lv = (est && est.shindo >= 1) ? est.shindo : 1;
    }
    setEEW(q, lv);
    return true;
  }

  /** 付费电文（VXSE51/53/62）到达：用【实测】覆盖地图上的推定值 */
  function applyMeasured(m) {
    if (!m) return false;
    /* ★ 2026-10-29：VXSE62 可能只有長周期階級、没有经纬度 → 就算下面建不出 E，
       也要先把階級按事件号记下来（履历小卡片 paTml 靠它）。 */
    if (m.maxLg != null && m.maxLg > 0) {
      rememberMaxLg(m.eventId || (V.eew && V.eew.eventId), m.maxLg);
    }
    /* ★ 2026-10-25：模拟进行中 → 真实实测电文也不能改写模拟卡片 */
    if (V.simOn) return false;
    var E = V.eew;
    /* ★★★ 2026-10-29 用户：「日本地震 api 发紧急地震速报的时候，卡片直接套用了
       『各地震度速报』」—— 真因之一就在这里：以前**只比 20 分钟时间窗**，
       同一时段另一场地震的 VXSE51/53（震度速報 / 各地の震度情報）会被当成
       「这一场」的后续报 → 把正在发报的 EEW 状态改写成 jishin / inq
       （Tab2 的速报卡随之隐藏，Tab1 换成震度速报卡）。
       ⇒ 两边都带事件号时**必须一致**；不一致 = 另一场地震：
         · 当前 E 是真实紧急地震速报（E.q.isEew）→ 速报优先，只更新地图，不改状态机
         · 否则（历史/实测拼出来的 E）→ 旧 E 作废，按这条电报重建 */
    var _eidE = String((E && (E.eventId || (E.q && E.q.eventId))) || '');
    var _eidM = String(m.eventId || '');
    var _skipState = false;
    if (E && _eidE && _eidM && _eidE !== _eidM) {
      if (E.q && E.q.isEew) _skipState = true;
      else if ((+m.originMs || 0) > (+E.timeMs || 0)) { V.eew = null; E = null; }
    }
    var near = !!(_skipState ? false : (E && Math.abs((E.timeMs || 0) - (m.originMs || 0)) < 20 * 60000));
    /* ★★★ 2026-10-27 用户（线上截图）：「这场地震地图一块都不填 / 卡片还是普通版面」
       —— 真因：**这场地震没发过 EEW**（M2.7 震度1 这种小震 JMA 根本不做紧急地震速报），
          `V.eew` 一直是 null → 下面的 `near` 判断失败 → VXSE51/53 的实测数据
          **一处也没进状态机**（卡片阶段、区域数字、取景全都不动），
          表现出来就是「不填色」＋「卡片用错」。
       ⇒ 没有 EEW 时，用这条实测电报**造一条最小 E**（带经纬度），后面所有逻辑
         （阶段/卡片/填色/取景）就和有 EEW 的一场完全同构。
       ⚠️ 只造一次（E 存在就不再造），并且只在拿到合法经纬度时造。 */
    if (!E && isFinite(+m.lat) && isFinite(+m.lon)) {
      var _isFinal53 = (m.kind === 'VXSE53');
      E = V.eew = {
        kind: _isFinal53 ? 'final' : 'jishin',
        inq: !_isFinal53,
        level: (m.maxShindo >= 0) ? m.maxShindo : 0,
        inqLv: (m.maxShindo >= 0) ? m.maxShindo : 0,
        timeMs: m.originMs || Date.now(),
        lat: +m.lat, lon: +m.lon,
        mag: isFinite(m.mag) ? +m.mag : NaN,
        depth: isFinite(m.depthKm) ? +m.depthKm : 0,
        place: m.place || '',
        metric: 'shindo',
        mode: 'real', measured: true, noEEW: true,
        eventId: m.eventId || '',
        report: (+m.serial || 0), seq: (+m.serial || 0),
        obs: [], allAreas: [], fillAreas: null,
        fillStage: _isFinal53 ? 'final' : 'all'
      };
      near = true;
    }
    if (near) {
      E.mode = 'real';
      E.measured = true;
      /* ★ 2026-10-29：首报是「震源調査中」（没有坐标）的，实测电报带了坐标就补上，
         后面才能填色 / 取景 / 画红叉。 */
      if (E.noHypo && isFinite(+m.lat) && isFinite(+m.lon)) {
        E.lat = +m.lat; E.lon = +m.lon; E.noHypo = 0;
      }
      if (m.maxShindo >= 0) E.level = m.maxShindo;
      /* ★ 2026-10-25：長周期地震動階級 只有 1~4 有意义，0 不发 → 别把 0 当「有階級」 */
      if (m.maxLg != null && m.maxLg > 0) {
        E.maxLg = m.maxLg;
        rememberMaxLg(m.eventId || E.eventId, m.maxLg);
      }
      if (isFinite(m.mag)) E.mag = m.mag;
      if (isFinite(m.depthKm)) E.depth = m.depthKm;
      if (m.place) E.place = m.place;
      if (m.kind === 'VXSE53') {
        E.kind = 'final';
        if (typeof V.setView === 'function') {
          try {
            if (V._flashTimer) { clearTimeout(V._flashTimer); V._flashTimer = 0; }
            V._flashBack = -1;
            V.setView(0);
          } catch (e) { }
        }
      } else if (m.kind === 'VXSE51') E.kind = 'jishin';
      /* ★★★ 2026-10-27 用户（对比图一）：「新地震已经进入调查中，卡片却用的是
         『各地震度情報』那张卡，而不是模拟那套『震度速報・調査中』」
         —— VXSE51（震度速報）到达时只把 kind 设成 'jishin'，**没有把 inq 置真**，
            于是 render3 的 INQ_ON 一直是 false → 画的是普通/正式版面
            （各地震度信息 + 震级不明 + 深度 0km + 无海啸威胁）。
         官方这一阶段就是「震度速報・調査中」卡（标题 ⓘ 震度速報 + 震源・規模 調査中
         + 津波 調査中）。⇒ VXSE51 → inq = true；VXSE53（各地の震度情報）才收起来。 */
      if (m.kind === 'VXSE51') {
        if (!E.inq) {
          E.inq = true;
          if (!(E.inqLv >= 1) && m.maxShindo >= 1) E.inqLv = m.maxShindo;
        }
      } else if (m.kind === 'VXSE53') {
        E.inq = false;
      }
      if (m.serial) E.report = (+m.serial || E.report);
      E.fillStage = (m.kind === 'VXSE53') ? 'final' : 'all';
      /* ★ 实测区域震度写进 allAreas —— render3 的 eewAreas() / 地图区域数字都读它，
         以前只有「模拟推算」才填这个字段，真实电报的实测值挂不进来。 */
      if (m.areas && m.areas.length) {
        E.allAreas = m.areas.map(function (a) {
          var v = +a.shindo; if (!isFinite(v)) v = +a.level;
          return { code: a.code, level: v, shindo: v };
        });
        E.fillAreas = null;
      }
    }
    if (m.areas && m.areas.length && global.QVShindo && QVShindo.set) QVShindo.set(m.areas);
    /* ★★★ 2026-10-26 用户：「地图填色为什么全都被挡住了，模拟的时候都没被挡住」
       —— 真实电报以前把「圆形观测点徽章」和「区域数字」同时往上怼：
          圆徽章层 #mapstations 是 z=8，区域数字在 #mapoverlay 里面 z=7
          → 数字被整片压住（模拟那边 rebuildAreas 早就 clearStations 了，所以不挡）。
       ⇒ 震源速報 / 各地の震度：一区一标，圆形徽章收起；只有真的没有区域震度时才退回逐点。 */
    var finalLike = (m.kind === 'VXSE51' || m.kind === 'VXSE53');
    if (finalLike) {
      if (global.QVMapCam && QVMapCam.clearStations) QVMapCam.clearStations();
      if (global.QVShindo && QVShindo.setStations) QVShindo.setStations([]);
      if (m.areaMarks && m.areaMarks.length && global.QVShindo && QVShindo.setPoints) {
        QVShindo.setPoints(m.areaMarks);
      } else if (m.points && m.points.length && global.QVShindo && QVShindo.setStations) {
        QVShindo.setStations(m.points);
      }
    } else {
      if (m.points && m.points.length && global.QVShindo) {
        if (QVShindo.setStations) QVShindo.setStations(m.points);
      }
      if (m.areaMarks && m.areaMarks.length && global.QVShindo && QVShindo.setPoints) {
        QVShindo.setPoints(m.areaMarks);
      }
    }
    if (global.QVRedraw) QVRedraw();
    return true;
  }

  /* ★★★ 2026-10-28 用户：「刚开始第一波调查的时候会闪一波全部图」
     —— render3.js 的 syncAreas() 每帧都会拿这个返回值去 QVShindo.set()。
        以前无条件返回 allAreas（全部行政区），把调查中的**等级过滤**整段绕过：
        每一帧都「先被梯子收成 3 个区，紧接着又被这里刷回 83 个区」→ 闪一下全图。
     ⇒ 调查中阶段返回**已经按等级梯子过滤过**的列表，和地图永远一致。 */
  V.eewAreas = function () {
    if (!V.eew) return null;
    var E = V.eew;
    if (E.inq && E.ipf && E.ipf.grades && E.ipf.grades.length) {
      var gv = E.ipf.grades[Math.min(E.ipf.gi || 0, E.ipf.grades.length - 1)];
      return (E.allAreas || []).filter(function (a) {
        var v = +a.level; if (!isFinite(v) || v <= 0) v = +a.shindo;
        return isFinite(v) && v > 0 && v >= gv;
      });
    }
    /* ★★★ 2026-10-28 用户：「调查中直接转第一次速报真实报来播报四级及以上的，
       最后正式报来把 3/2/1 给收尾」
       ⇒ 震源速報（kind='jishin'）只给 **≥震度4**；正式報（final）才给全部等级。
         这里必须同步，否则 render3 每帧又把 3/2/1 刷回地图上（实测 jishin 阶段
         min=1、81 个区全部铺满，把「只报 4 级以上」整段绕过）。 */
    if (!E.inq && E.kind === 'jishin') {
      return (E.allAreas || []).filter(function (a) {
        var v = +a.level; if (!isFinite(v) || v <= 0) v = +a.shindo;
        return isFinite(v) && v > 0 && v >= 4;
      });
    }
    /* ★★★ 2026-11-03 用户：「正式报的震度3，2，1的地图填色区域全部变成了灰色的了」
       —— 正式报这条 return 以前把 E.allAreas **原样**交出去，里面混着大量
          震度0（震度なし）的远场行政区；render3.syncAreas() 每帧 set() 一次，
          colorOf(0) 就是震度0 的灰色 #686870 → 全日本一大片灰斑。
        ⇒ 震度0 一律不参与地图填色（官方也不填），和 fillable() 的规则对齐。 */
    return (E.allAreas || []).filter(function (a) {
      var v = +a.level; if (!isFinite(v) || v <= 0) v = +a.shindo;
      return isFinite(v) && v > 0;
    });
  };
  /* ★★★ 2026-10-27 用户（线上截图）：「刷新后卡片用错 / 地图不填色」
     —— 没有发过 EEW 的小震（M2.7 震度1 这种），`V.eew` 一直是 null，
        只有**实时电报到达**那一刻 applyMeasured 才能建 E。
        刷新页面后电报不会重推，只能从中转 REST `history.json` 补拉 →
        这里在 history 落地时，按「当前选中的这一场」也补一条最小 E。
     规则（对齐官方）：
       · 最大震度 ≥ 3 → 官方会发「震度速報」→ kind='jishin', inq=true
       · 否则只有「各地震度情報」（震源・震度情報 VXSE53）→ kind='final', inq=false
     ⚠️ 只在没有 E 时做；已有 E（EEW/实测）一律不覆盖。 */
  function ensureEFromHistory() {
    if (V.eew) return false;
    var d = (global.QData && QData.get) ? QData.get() : null;
    var q = d && d.list && d.list[0];
    if (!q || !isFinite(q.lat) || !isFinite(q.lon)) return false;
    /* ★★★ 2026-10-29 用户：「日本地震 api 发紧急地震速报的时候，卡片直接套用了
       『各地震度速报』」—— 真因之二：列表最上面那条如果**是紧急地震速报**，
       这里照样按「实测区域震度」给它拼一张 kind='jishin' / inq=true 的
       【震度速報】卡（Tab2 的速报卡同时被藏掉）。
       ⇒ 速报条目一律不在这里造 E，交给 pumpEewFromList() 走真实 EEW 链路
         （Tab2 专用速报卡 + 音效 + 取景）。 */
    if (q.isEew) return false;
    var dm = (global.QVDmAreas) ? global.QVDmAreas(q.timeMs, q.lat, q.lon) : null;
    if (!dm || !dm.areas || !dm.areas.length) return false;
    var mx = 0;
    for (var i = 0; i < dm.areas.length; i++) {
      var v = +dm.areas[i].shindo; if (!isFinite(v)) v = +dm.areas[i].level;
      if (isFinite(v) && v > mx) mx = v;
    }
    if (!(mx > 0)) return false;
    var isSokuho = (mx >= 3);
    V.eew = {
      kind: isSokuho ? 'jishin' : 'final',
      inq: isSokuho,
      level: mx, inqLv: mx,
      timeMs: +q.timeMs || Date.now(),
      lat: +q.lat, lon: +q.lon,
      mag: isFinite(q.mag) ? +q.mag : NaN,
      depth: isFinite(q.depthKm) ? +q.depthKm : 0,
      place: q.place || '',
      metric: (q.metric === 'liedu') ? 'liedu' : 'shindo',
      mode: 'real', measured: true, noEEW: true, fromHistory: true,
      obs: [], allAreas: [], fillAreas: null,
      fillStage: isSokuho ? 'all' : 'final'
    };
    V.eew.allAreas = dm.areas.map(function (a) {
      var v2 = +a.shindo; if (!isFinite(v2)) v2 = +a.level;
      return { code: a.code, level: v2, shindo: v2 };
    });
    if (global.QVRedraw) { try { QVRedraw(); } catch (e) { } }
    return true;
  }
  V.ensureEFromHistory = ensureEFromHistory;

  /* ═══════════════════════════════════════════════════════════════════════
     ★★★ 2026-10-29 用户：「日本地震 api 发紧急地震速报的时候，卡片直接套用了
     『各地震度速报』，应该跳到 EEW 页面（Tab2）使用专用的『紧急地震速报』」

     根因：EEW 只有两条路能进 Tab2 ——
       ① wolfx WebSocket（ws.js）
       ② P2PQuake 556 WebSocket（p2pquake.js）
     而实测（本机 / 国内网络）`wss://ws-api.wolfx.jp/jma_eew` 直接握手失败 **503**，
     P2P 的 WSS 也可能连不上 → 速报只剩 data.js 里 **60 秒一次的 REST 轮询**
     （api.wolfx.jp/jma_eew.json）。那条路只把条目塞进 QData 履历，
     从来不会调 onRealEew → 界面永远停在 Tab1，卡片是情报页那张。
     ⇒ 这里在每次数据刷新后扫一遍**合并后的列表**：只要有「新鲜的速报条目」，
       就喂给 onRealEew()（自带 eventId|seq 去重）→
       Tab2 专用速报卡 / 音效 / 地图取景 / 记录器里的 k='eew' 全部走真实链路。

     新鲜度门槛 10 分钟：wolfx 的 *_eew 接口会一直挂着**最后一条**速报
     （实测 6 小时前那场仍然返回），没有门槛的话每次开会话都会弹一遍旧速报。
     ═══════════════════════════════════════════════════════════════════════ */
  var _pumpKey = '';
  function pumpEewFromList(st) {
    if (!st || !st.list || !st.list.length) return false;
    if (V.simOn) return false;
    var now = Date.now(), pick = null;
    for (var i = 0; i < st.list.length && i < 40; i++) {
      var q = st.list[i];
      if (!q || !q.isEew) continue;
      if (q.isTraining || q.isAssumption) continue;
      /* ★ 2026-10-30：中国速报走中国卡（Tab1），不泵入日式 EEW Tab2 */
      if (isCnEew(q)) continue;
      /* ★ 2026-10-29 震源未定（震源調査中）的首报也放行 —— 用户要求
         「最早的地震消息也应该使用 Tab2 页面」。非日本源仍然要求坐标。 */
      if (!hasHypo(q) && !isJpEew(q)) continue;
      var t = +q.pubMs || +q.timeMs || 0;
      var age = now - t;
      if (!(age >= 0) || age > 10 * 60000) continue;
      pick = q;
      break;                                  /* 列表按 timeMs 倒序，命中即最新 */
    }
    if (!pick) return false;
    var k = String(pick.eventId || pick.id || '') + '|' + (+pick.seq || 0) + '|' + (+pick.pubMs || 0);
    if (k === _pumpKey) return false;
    _pumpKey = k;
    /* ⚠️ 必须走**导出的** V.onRealEew —— record.js 会在它外面包一层录制钩子，
       直接调内部 onRealEew 的话，轮询进来的日本速报不会被录进「事件录制・回放」。 */
    var fn = (typeof V.onRealEew === 'function') ? V.onRealEew : onRealEew;
    try { fn(pick); } catch (e) { return false; }
    return true;
  }
  V.pumpEew = pumpEewFromList;
  /** ★ 2026-10-30：检查是否有正式报（各地震度情報 / 震度速報 / 551 等）到达并覆盖当前 EEW。
   *  若有正式报到达：立刻收起 EEW、跳回 Tab1（各地震度信息 setView(0)）。 */
  function checkFormalReport(st) {
    if (!st || !st.list || !st.list.length) return false;
    if (V.simOn) return false;
    var E = V.eew;
    if (!E) return false;
    var isReal = !!(E.realEew || E.mode === 'real' || (E.q && E.q.isEew));
    if (!isReal) return false;

    var eewTime = +E.timeMs || 0;
    var eewEid = String(E.eventId || (E.q && E.q.eventId) || '').replace(/^EEW:[^:]*:/, '');
    var eewPlace = String(E.place || '').trim();

    var matched = false;
    for (var i = 0; i < st.list.length && i < 15; i++) {
      var q = st.list[i];
      if (!q || q.isEew) continue;
      var qTime = +q.timeMs || 0;
      if (!(qTime > 0)) continue;

      var qEid = String(q.eventId || q.id || '').replace(/^[A-Z]+:[^:]*:/, '');
      if (eewEid && qEid && (eewEid === qEid || qEid.indexOf(eewEid) >= 0 || eewEid.indexOf(qEid) >= 0)) {
        matched = true;
        break;
      }
      if (eewTime > 0 && Math.abs(qTime - eewTime) <= 8 * 60000) {
        var qPl = String(q.place || '').trim();
        if (eewPlace && qPl && !/^(震源調査中|調査中|不明|未解析)$/.test(eewPlace) && !/^(震源調査中|調査中|不明|未解析)$/.test(qPl)) {
          if (eewPlace === qPl || eewPlace.indexOf(qPl) >= 0 || qPl.indexOf(eewPlace) >= 0) {
            matched = true;
            break;
          }
        }
        if (isFinite(+q.lat) && isFinite(+q.lon) && isFinite(+E.lat) && isFinite(+E.lon)) {
          if (Math.abs(+q.lat - +E.lat) < 1.0 && Math.abs(+q.lon - +E.lon) < 1.0) {
            matched = true;
            break;
          }
        }
        if (E.noHypo && Math.abs(qTime - eewTime) <= 5 * 60000) {
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      var top0 = st.list[0];
      if (top0 && !top0.isEew && eewTime > 0) {
        var topAge = Date.now() - eewTime;
        if (topAge > 45000 && (+top0.timeMs >= eewTime - 60000)) {
          var hasOurEew = false;
          for (var k = 0; k < st.list.length; k++) {
            if (st.list[k] && st.list[k].isEew && (st.list[k].eventId === eewEid || Math.abs(st.list[k].timeMs - eewTime) < 60000)) {
              hasOurEew = true;
              break;
            }
          }
          if (!hasOurEew) matched = true;
        }
      }
    }

    if (matched) {
      V.eew = null;
      if (L1 && L1.eew) L1.eew.style.display = 'none';
      if (global.QVMapCam) {
        if (QVMapCam.lockPin) QVMapCam.lockPin(null);
        if (QVMapCam.setBoxes) QVMapCam.setBoxes(null);
      }
      if (V._flashTimer) { clearTimeout(V._flashTimer); V._flashTimer = 0; V._flashBack = -1; }
      if (V.view === 1) {
        setView(0, true);
      }
      return true;
    }
    return false;
  }
  V.checkFormalReport = checkFormalReport;

  /* ★ 2026-10-21 调试导出：中国区域烈度自算链路（GMPE + VS30 → 区县站 → 地级市聚合）
     便于在控制台核对「震中 → 各市烈度」到底算出了什么：
       QVViews.genStations(30.6,104.1,10,'liedu',15,6.8)  → [{lat,lon,shindo,cty,...}]
       QVViews.cnCityOf(30.6,104.1)                      → 地级市 adcode（0 = 不在任何轮廓内） */
  V.genStations = genStations;
  V.peakI = peakI;              /* 调试/标定用：peakI(M, 深度) → 峰值计测震度 */
  V.deepTerms = deepTerms;
  V.cnCityOf = cnCityOf;
  V.cnCityCount = function () { return cnAreaIndex().length; };
  /* ★ 2026-10-23 真实 EEW 入口（app.js 把 wolfx 推送的速报转进来） */
  V.onRealEew = onRealEew;
  /* ★ 2026-11-04 过期速报判据，供 app.js 在注入前统一过滤 */
  V.eewIsFresh = eewIsFresh;
  /* ★ 2026-10-23 付费电文实测覆盖（dmdata-ui.js 调） */
  V.applyMeasured = applyMeasured;
  /* ★★ 2026-10-23 官方素材表导出：正式报卡（render3.js）要用 paScl / sndl 画长周期阶級条 */
  V.eewArt = EEW_ART;
  /* ★ 调试导出：直接触发一场模拟（不用点 UI），排查 Tab2 没情报等问题时用 */
  V.__fireSim = fireSim;
  /* 履历小卡片（render3）按事件号查长周期階級 */
  V.maxLgOfEvent = maxLgOfEvent;
  V.__backfillJmaLg = backfillJmaLg;
  /* 启动后回填最近 24h 的 JMA VXSE62（不阻塞首屏） */
  setTimeout(backfillJmaLg, 1200);
  /** ★ 2026-10-27 调试面板：暂停后恢复时把模拟时间轴整体后移 ms（否则波前会一下跳很远） */
  V.__shiftSimClock = function (ms) {
    if (!(ms > 0)) return;
    V.simT0 = (V.simT0 || 0) + ms;
    /* ★ 2026-10-27 只把「波前时间轴」往后推（否则一恢复波前就跳很远）。
       E.simT0（进调查中的 90 秒闸门）/ detWall（检测时长）**不推** ——
       暂停的时间照算，否则暂停 1 分钟后还要再等 1.5 分钟才进调查中，
       用户会以为「按了继续就卡住不动了」。 */
    try { if (global.QVMapCam && QVMapCam.shiftWave) QVMapCam.shiftWave(ms); } catch (e) { }
  };
  /* ★ 2026-10-27 调试用：地址后面加 `?detdemo=1` → 每 1.4 秒在屏幕中心轮流弹
     黄 / 橙 / 红 / 紫 四档「検出円」，方便直接看造型、大小、时长。
     （不在正式逻辑里；不带这个参数就不会跑） */
  try {
    if (/[?&]detdemo=1/.test(String(location.search)) && global.QVMapCam) {
      var _ddLv = [1, 4, 50, 60], _ddI = 0;
      setInterval(function () {
        var c = (QVMapCam.center ? QVMapCam.center() : null);
        if (!c) return;
        QVMapCam.detPulse({ lat: c[0], lon: c[1], lv: _ddLv[_ddI++ % 4], lifeMs: 750 });
      }, 1400);
    }
  } catch (eDD) { }
  V.__infer = inferSource;
  /* ══ 模拟专用入口：直接弹出「地震与海啸模拟」设置框（可在框里自由填经纬度/规模/深度，
     也可点「在地图上选择震源」用鼠标定震中）。不要求先点地图。 ══ */
  V.openSimSettings = function () {
    try {
      if (simLL == null) simLL = [35.0, 139.0];   /* 默认日本本州，用户可直接改 */
      openSim(simLL);
    } catch (e) { }
  };
  /* ★ ZQuake 模拟器：启动即跑一场演示模拟。
     否则地图是空的 → 用户看不到涂色/测站/波前，也听不到音效，以为功能坏了。
     o = {lat, lon, mag, depthKm, place}；不给就用默认的日本近海 M7.0。 */
  V.startDemoSim = function (o) {
    try {
      o = o || {};
      var lat = (o.lat != null ? o.lat : 38.2), lon = (o.lon != null ? o.lon : 142.4);
      var mag = (o.mag != null ? o.mag : 7.0), dep = (o.depthKm != null ? o.depthKm : 30);
      simLL = [lat, lon];
      fireSim({
        lat: lat, lon: lon, mag: mag, depthKm: dep,
        place: o.place || '演示震源（房总近海）'
      });
    } catch (e) { if (window.console) console.warn('startDemoSim', e); }
  };
  global.QVViews = V;

  /* 包一层 R.draw：先记下行数据，最后重建命中层（render3 里还有中途 return 的分支） */
  if (R && R.draw) {
    var _draw = R.draw;
    R.draw = function (st) {
      /* ★ 履历行命中区必须和 render3 画的那一段【完全一致】
         （现在两边都是「剔除主卡那条后的前 9 条」；滚动由 app.js 的整列平移负责）*/
      hits.rows = ((st && st.list) || [])
        .filter(function (x) { return !(st.sel && x.id === st.sel.id); })
        .slice(0, 9);
      _draw(st);
      syncHits();
    };
  }
  R.view = 0;
  R.viewScroll = V.viewScroll;
  R.setView = setView;
  R.applySettings = applyOpts;      /* app.js 启动末尾会调（把已保存的设置真正用起来） */

  /* 底部三个动作按钮的接线已在 ctrlClick 里处理（kind === 'button'） */

  /* ★ Esc：取消「点地图选震源」/ 倒计时 / 模拟模态框 */
  addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    if (simPick || simTimer || (sim && sim.className === 'on')) cancelSim();
  });

  /* ★★★ 2026-10-25 用户：「模拟过程中，我只要按一下回车就能直接跳一个阶段」
     规则：
       · 只有模拟中（V.simOn）生效，真实电文不给跳
       · 光标在输入框 / 下拉框 / 文本域 / 按钮上时不管（否则会误触表单元件）
       · 带修饰键的 Enter（Ctrl/Alt/Shift/Meta）不管
     具体跳哪一步交给 V.__skipStage()（它在 setEEW 里定义，能拿到 enterJishin / enterFinal）。 */
  addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.keyCode !== 13) return;
    if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' || t.tagName === 'BUTTON' || t.isContentEditable)) return;
    if (!V.simOn) return;
    if (V.__skipStage && V.__skipStage()) e.preventDefault();
  });
})(window);
