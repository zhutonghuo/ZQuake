/* mapcam.js — 地图相机（中心经纬度 + 缩放 + 手动缩放/拖动）
 *
 * 图块表 QV_MAPTILES 由 build/gen-official-maptiles.js 生成：
 *   ★ 用的是【官方原版】投影 + 【官方原版】摆位，零人工调参。
 *   官方自定义积木「座標変換：タイプ別」：
 *       地图X = 10*(mod(lon+44,360)-180)          （每度经度 10 单位）
 *       地图Y = MAPK*ln(tan(45°+lat/2)) - MAPY0   （墨卡托投影）
 *   官方「地図スタンプ:new」里 repeat 6 逐步盖章 "nb"+k，锚点取自
 *   列表 @2 d 地図オフセットlow（6 对）× (2.4, 1.8)，盖印大小 10%。
 *   图集像素 = (地图单位 - MINX/…)*A，A=10 恰为图块原生分辨率（不失真）。
 *
 * 相机：把「图集坐标」整体 translate+scale 到舞台：
 *       屏幕点 = T + k * 图集点      （#mapview 在 #stage 内，自动跟随舞台缩放）
 * 可视地图区：舞台 960x720 中，左侧被侧栏（约 244px）、右侧被控制条（约 34px）遮住，
 * 所以相机把目标点放到 x 244..926 / y 0..720 的中心（585,360）。
 *
 * 交互：
 *   · 滚轮/触摸板（**仅在地图区**，光标在左侧 UI 栏上时不抢）
 *       - 鼠标滚轮一格 / 触摸板拇合（ctrl+wheel）→ 缩放（以光标为锚点）
 *       - 触摸板两指滑动（小步长）→ 平移
 *   · 按住拖动平移
 *   · 官方 +/− 按钮（图形层 FlZom0，上半 + 下半 −）
 *   · 手动动过之后暂停「自动跟随选中地震」，直到选中项变化
 */
(function (global) {
  'use strict';
  var T = global.QV_MAPTILES || { MAPK: 572.9577951308232, MAPY0: 374.04780730560344, A: 10, MINX: -130.64, MAXX: 128.97, MINY: -126.24, MAXY: 138.91, W: 2596, H: 2651, tiles: [] };
  var SW = 960, SH = 720;
  /* 图集现在每度经度 100px（旧图集 68px）→ 同样的观感重要把 k 乘 0.68 */
  var KZ = 0.68;
  /* ★★ 相机缩放范围
     ⚠️ 用户报「印尼地震手动放大后，想看回周围却看不了」→ 两个真因：
        ① 下限太高（0.06）→ 世界图（1800 图集px = 360°）永远装不下，缩不出去
        ② 世界视图的夹紧框以前用「wlg 小块」（450px）→ 比视口还小时相机被钉死在中心，拖不动
     现：K_MIN 按视口动态算（见下），夹紧框统一用全世界框。 */
  /* ★ K_MIN（最小缩放）：屏幕上「一个世界环绕周期」= 36000×k 像素。
     · 它必须 ≥ 视口【宽】—— 否则一屏并排出现「两个日本」（环绕重复）；
     · 世界方块本身也只有 3600×3600 地图单位（墨卡托 ±85°，南北极没有内容）
       → 同一个 36000×k 也必须 ≥ 视口【高】，否则上下露出一条没图的底色
         （用户报的「缩小到一定程度后地图覆盖不全屏幕」）。
     ⇒ K_MIN 由 setStage() 按当前视口动态抬升（0.019 = 16:9 满屏时的下限）。 */
  var K_MIN = 0.019, K_MAX = 6.0 * KZ;

  /* ★ 设置页接线（views.js 调 setOpts） */
  var opts = { follow: true, anim: true, world: true, pinScale: 1, zoomRate: 1, autoHide: false, layerBtn: false, pinMode: 0,
    /* ★ 点了地图上的震中标记 → 回调（app.js 接：选中 + 移动相机） */
    onPinClick: null };
  var lastQ = null, idleT = 0, dragging = false;

  var VIS = { x0: 244, x1: 926, y0: 0, y1: 720 };
  VIS.cx = (VIS.x0 + VIS.x1) / 2;
  VIS.cy = (VIS.y0 + VIS.y1) / 2;

  /* ★★ 2026-10-14「铺满窗口」配套：舞台逻辑尺寸由 app.js 的 layout() 动态写宽高
     （窗口更宽 → 舞台逻辑宽变得 >960）。地图视口 VIS 必须跟着变，否则右边
     x>926 那块不会铺瓦片 → 看着还是空的（等于黑边没消掉）。
     · 左边界：非横屏时留出 UI 栏（244，官方面板 8..232 + 页签），横屏时贴 0；
     · 右边界 / 下边界：一直贴到舞台边缘，多出来的宽度**全部给地图**。 */
  function setStage(w, h, landscape) {
    VIS.x0 = landscape ? 0 : 244;
    VIS.x1 = Math.max(VIS.x0 + 1, w || 960);
    VIS.y0 = 0;
    VIS.y1 = Math.max(1, h || 720);
    VIS.cx = (VIS.x0 + VIS.x1) / 2;
    VIS.cy = (VIS.y0 + VIS.y1) / 2;
    /* ★★ 2026-10-15 修「缩小到一定程度后地图覆盖不全屏幕」：
       一个世界环绕周期（= 世界方块本身）在屏幕上是 36000×k 像素，
       视口哪一维比它大，那一维就会露出没图的底色（纵向最先出现：
       设计尺寸下方块 ≈ 684px 而视口高 720px → 上下各 18px）。
       ⇒ 最小缩放动态抬到「世界方块 ≥ 视口（宽/高取大者）」。
       窗口是 16:9 时正是 720/36000 = 0.02（旧值 0.019 就是差这一点点）。 */
    K_MIN = Math.max(0.019, Math.max(VIS.x1 - VIS.x0, VIS.y1 - VIS.y0) / 36000);
    /* 窗口变大把当前缩放甩到新下限之下 → 就地拉回下限（中心不动） */
    if (view && (cam.k < K_MIN || tgt.k < K_MIN)) {
      var llm = camCenter();
      apply(llm[0], llm[1], Math.max(cam.k, K_MIN), true);
    }
    /* 尺寸变了 → 主动重画一帧（否则要等到下次交互才生效） */
    if (view) { try { paint(); } catch (e) { } }
  }

  var D2R = Math.PI / 180;
  function mapXOf(lon) { return 10 * (((((lon + 44) % 360) + 360) % 360) - 180); }
  function mapYOf(lat) { return T.MAPK * Math.log(Math.tan((45 + lat / 2) * D2R)) - T.MAPY0; }
  function lonOfMap(mx) { return (mx / 10) + 136; }
  function latOfMap(my) { return 2 * (Math.atan(Math.exp(((my + T.MAPY0) / 10) * D2R)) / D2R - 45); }

  var B = {
    lonMin: lonOfMap(T.MINX), lonMax: lonOfMap(T.MAXX),
    latMin: latOfMap(T.MINY), latMax: latOfMap(T.MAXY)
  };

  var view = null, stage = null, pinhost = null;
  /* ★ 世界地图（官方「広域モード」）：与日本图【同一投影、同一地图单位】，
     只是图集比例换成 A2（=0.5）→ 相机变换要额外乘 (A / A2)。 */
  var W = global.QV_MAPWORLD || null;
  var WSC = (W && W.A2) ? (T.A / W.A2) : 20;
  var wview = null, oview = null, gview = null, cview = null, dview = null;
  /* ★★ #mapoverlay = 【我们自己】的地图叠加层（震度色块 / 观测点标记）。
     以前这两层是 #mapview（官方 nb 图层）的子节点 —— 于是「关掉官方地图」
     会把震度色块和观测点一起隐藏掉（2026-10-12 用户报的「地震色块位置不对」的真因）。
     现在它们挂在自己的层上，transform 与 #mapview 完全一致（同一套图集变换）。 */
  var ovlay = null;
  /* ★★ 官方 wld 海底地形（近景/广域档的海面，31px/°；allocean 只有 5px/°）
     —— 用户报「海洋和陆地一起模糊」的海洋那一半。 */
  var D = global.QV_WLDTILES || null;
  /* ★ 海岸线层（官方 nf*，原样）—— 与日本图同坐标系/同摆位，比县境粗（nf 1.5 : nb 1.0）
     ⚠️ 加粗海岸线只能动 nf 这一层；碰 nb 会把【都道府県境】一起加粗（日本变白网）。 */
  var C = global.QV_COASTTILES || null;
  /* ★ 世界图（官方「広域モード」常用档）= wlg00..wlg11 陆地，**自带日本**
     官方：wld（海底地形）+ wlg（陆地），覆盖 88°经 × 75°纬（以 136E/35N 为中心）。
     用这一层就不需要「outsvg 挖洞 + 叠 nb」，也就没有县境/海岸线粗细的问题。 */
  var G = global.QV_WLGTILES || null;
  /* wlg 的覆盖范围（官方 2×2 块，每块 440×377 地图单位，中心在 mapX=±220 / mapY=191.5|-185.5）
     ⇒ 经度 92E~180E 、纬度 0~60N（就是「日本周边广域」那一档） */
  var GB = G ? {
    lonMin: lonOfMap(G.BX0), lonMax: lonOfMap(G.BX1),
    latMin: latOfMap(G.BY0), latMax: latOfMap(G.BY1)
  } : null;
  var mode = 'jp';                       /* 'jp' | 'world' */
  var tier = 'jp';                       /* 'jp' | 'wlg' | 'outsvg' —— world 的两档素材 */
  /* ★★ 自建地图（kondz-map 瓦片）：官方 6 层素材（allocean / outsvg / wlg / wld /
     nb / nf）**彻底不要了**（用户 2026-10-12：「你这个为什么保留了官方的垃圾图？快点给我去掉」）。
     默认就是开着的；关掉只是留个调试退路。 */
  var ownMap = true;
  function officialLayers() { return [view, cview, oview, wview, gview, dview]; }
  function hideOfficial(h) {
    var a = officialLayers(), d = h ? 'none' : '';
    for (var i = 0; i < a.length; i++) if (a[i]) a[i].style.display = d;
  }
  /* ★ 震中标记（官方「震源スタンプ」/「震源スタンプEEW」）
       官方造型分两系（都是「外面一圈亮色 + 里面红叉」）：
         epc00 / epc01 / epc20 / epc21  → 描边【白 #ffffff】  —— 紧急地震速报（EEW）用
         epc30 / epc31                  → 描边【奶油黄 #fff1aa】—— 【普通地震（正式报）用】
       ⚠️ 以前用 epc01 画普通地震 → 白描边 + 半透明，与官方（奶油黄、不透明）完全不同。
       ★ 尺寸（实测官方运行中的 VM + 官方截图量比例，别再靠截图拍脑袋）：
         官方积木：普通 sprite.size = 画面設定系[6] × 20 × システム設定[17] % ；EEW 把 20 换成 18
         官方运行中读到的 size = 35%（⇒ 画面設定系[6] ≈ 1.75）
         造型画布 140×140，墨迹（含奶油描边）只占 ~94
         官方截图里量到：墨迹 46px / 舞台宽 814px = **5.65%**
         本应用舞台宽 960 ⇒ 墨迹应 ≈ 54px ⇒ 整张 SVG 显示尺寸 = 54 / 0.671 ≈ **83px**
         （旧值 97px 是照截图拍的 → 大到 6.8%，用户：「红叉叉有点太大了」）
         EEW = 18/20 × 83 ≈ 75px
       半透明：官方「震源スタンプ »透明»」= true 时才 GHOST 50（epc31，用于过去显示）
               实时选中地震是 false → epc30 不透明。 */
  var PINS = {
    eew: { src: 'assets/502638257cbcb1d38fdc97f33074d385.svg', op: 1, px: 52 },
    eewFinal: { src: 'assets/b4ce633ee3155478059d5c7d98e1d244.svg', op: 0.5, px: 52 },
    normal: { src: 'assets/932113362afb5a7c54f417e1379a7ca4.svg', op: 1, px: 56 }
  };
  var pinEls = [];          /* [{el, a}] 最多 2 个 */
  var legendEl = null;      /* ★ 2026-10-21 地图右下角震度图例（官方 hnr 造型） */
  var LEGEND_V = '20261025a';
  var wavehost = null, waveCtx = null, waveSrc = null;   /* ★ P/S 波圆（canvas 单层） */
  /* ★ 模拟测站（用户：官方那些点都是真实 API 测站；我们不接 API，但也要有测站） */
  var stationHost = null, stationEls = [], stations = [];
  /* ★ 2026-10-21：测站标记要用哪套刻度（震度 h0..h9 ／ 烈度 1..12）
     —— 烈度没有官方造型，用 QV_LIEDU.markSrc() 生成同尺寸圆标。 */
  var stMetric = 'shindo';
  /* ★ 2026-10-21 警戒区域阶段：地图上不显示任何震度点 */
  var stHidden = false;
  function setStationsHidden(on) {
    stHidden = !!on;
    if (stHidden) {
      for (var i = 0; i < stationEls.length; i++) stationEls[i].style.display = 'none';
    } else {
      tickStations();
    }
  }
  /* ★★★ 2026-10-20 用户（图一）：「震度没到 1 级、没到预警程度时，官方不报紧急地震速报，
     而是在地图上画一个「差不多一个县大小」的**绿色框 / 黄色框**」：
        绿 = 震度1未満（只是感知到摇晃）
        黄 = 震度1以上
        橙 = 震度2以上
     ⇒ 这一层就是那三块框。每块都是「某一档测站的经纬度包络框」，随相机每帧重算。 */
  var boxhost = null, boxEls = [], boxes = null, pinsOff = false;
  var stT0 = 0, stReveal = 0;      /* 观测点逐点显示：基准时刻 + 已点亮个数 */
  var waveSec = 0;                 /* 波形已经传播的秒数（测站衰减用） */
  /* ★ 2026-10-20：图标 URL 带版本号。assets/marks/*.svg 是动态赋给 <img>.src 的，
     index.html 里的 ?v= 管不到它 —— 用户浏览器就会一直用旧缓存（未裁切的 400x400），
     于是「换了圆图标但显示的还是老样子」。改图标时把这里也改一下。 */
  var MARK_V = '20261020a';
  var wavePKm = 0;                 /* 当前 P 波已经跑到的震央距离(km) —— 测站与圆用同一个值 */
  var waveSKm = 0;                 /* ★ 2026-10-28 同上，S 波已到达的震央距离（已含区域系数 k）*/
  var home = { lat: 37.6, lon: 137.4, k: 0.48 * KZ };
  /* cam = 【当前显示】的相机；tgt = 目标。中间由 rAF 补间插值。
     ★ 为什么不用 CSS transition：地图层走 transform（translate+scale），
       而震中标记走 left/top（线性插值）。两者在【缩放变化】时不同步
       → 运镜过程中标记会相对地图漂移（用户报的「震中跟着摄像机跑」）。
       改成逐帧写值后，每一帧标记都由当帧 cam 算出 → 永远钉在震中上。 */
  var cam = { tx: 0, ty: 0, k: home.k };
  var tgt = { tx: 0, ty: 0, k: home.k };
  var anim = null, rafId = 0;
  var DUR = 400;
  var lastKey = '', manual = false;
  /* ★★★ ZQuake：用户锁 —— 用户一旦手动拨动/缩放地图，**自动镜头彻底让位**
     （原版 manual 每次 requestMove 都会被清掉 → 用户拨了下又被自动镜头抢回去）。
     只有点右下角「自动操作地图」按钮才重新打开。 */
  var userCamLock = false;

  /* 官方观感用的缓动：cubic-bezier(.22,.61,.36,1)，预打表 + 线性插值 */
  var EASE = (function (x1, y1, x2, y2) {
    function bx(t) { return 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t; }
    function by(t) { return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t; }
    var tbl = new Float64Array(65), i, lo, hi, m, t;
    for (i = 0; i <= 64; i++) {
      var x = i / 64; lo = 0; hi = 1; t = x;
      for (var k = 0; k < 26; k++) { m = (lo + hi) / 2; if (bx(m) < x) lo = m; else hi = m; }
      tbl[i] = by((lo + hi) / 2);
    }
    return function (x) {
      if (!(x > 0)) return 0; if (x >= 1) return 1;
      var f = x * 64, i = Math.floor(f);
      return tbl[i] + (tbl[i + 1] - tbl[i]) * (f - i);
    };
  })(0.22, 0.61, 0.36, 1);

  /* ★ 经纬度 ⇄ 图集坐标：全站唯一一条公式（官方墨卡托） */
  function toAtlas(lat, lon) {
    return [(mapXOf(lon) - T.MINX) * T.A, (T.MAXY - mapYOf(lat)) * T.A];
  }
  function toLatLon(ax, ay) {
    return [latOfMap(T.MAXY - ay / T.A), lonOfMap(T.MINX + ax / T.A)];
  }
  function inAtlas(lat, lon) {
    return lon >= B.lonMin + 0.05 && lon <= B.lonMax - 0.05 && lat >= B.latMin + 0.05 && lat <= B.latMax - 0.05;
  }
  function zoomForMag(m) {
    if (!isFinite(m) || m <= 0) return 0.62 * KZ;
    if (m < 4.0) return 1.5 * KZ;
    if (m < 4.8) return 1.15 * KZ;
    if (m < 5.6) return 0.85 * KZ;
    if (m < 6.4) return 0.65 * KZ;
    if (m < 7.2) return 0.52 * KZ;
    return 0.44 * KZ;
  }
  /* ★ wlg 档的缩放：wlg 只覆盖 91E~181E / 0~60N（90°×61°）
       视野必须明显小于它，否则相机会被夹在边上（震中跑不到中心）
       → 视野定在 17°~30°（比日本视图宽、比全世界视图窄） */
  function zoomForMagG(m) {
    if (!isFinite(m) || m <= 0) return 0.30;
    if (m < 4.0) return 0.52;
    if (m < 4.8) return 0.42;
    if (m < 5.6) return 0.34;
    if (m < 6.4) return 0.27;
    if (m < 7.2) return 0.21;
    return 0.17;
  }
  /* ★ 海外/世界视图的缩放：世界图 3600 地图单位 = 360°，可视宽 682px
       → 显示 60° 需 k = 682 / (600 * 10) ≈ 0.114
     ★★ 2026-10-11（第十五轮）用户：「世界地图对比官方太模糊」——
       真凶：outsvg（全世界陆地）底图只有 5px/°（1800px/360°），
       而旧表把海外自动缩到 span 23~34°（k=0.30~0.20）→ 放大 6×/4× → 糊成一片。
       官方在 span ≈ 86° 以前根本不用 outsvg（走 wlg，10.4px/°）。
       ⇒ 海外档整体放宽：k ≤ 0.11（span ≥ 62°）→ 放大率 ≤ 2.2×，观感立刻清晰。 */
  function zoomForMagW(m) {
    /* ★ 2026-10-11 用户：「不管什么倍率全部用最精细的」——
       自动聚焦时不要把相机缩到超出精细素材覆盖（否则一屏里一半是粗图）。
       精细海覆盖高 = 44°（16~61N）→ 视野竖直 ≤ 44° → k = 7.2/44 ≈ 0.164；
       取 0.13~0.19 区间（竖直跨度 38~55°，落在精细区内；实测 0.135 即可完整装下）。 */
    if (!isFinite(m) || m <= 0) return 0.19;
    if (m < 4.0) return 0.22;      /* 约 31° */
    if (m < 5.0) return 0.19;      /* 36°   */
    if (m < 6.0) return 0.17;      /* 40°   */
    if (m < 7.0) return 0.15;      /* 46°   */
    return 0.135;                  /* 51°   */
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  /* 当前模式的图集参数 */
  function mS() { return (mode === 'world' && W) ? WSC : 1; }      /* 额外缩放系数 */
  function mW() { return (mode === 'world' && W) ? W.W : T.W; }
  function mH() { return (mode === 'world' && W) ? W.H : T.H; }
  /* ★ 内容框（图集坐标）：日本图是 [0,W]×[0,H]；
     世界图的图块落在【负坐标】区（x -1514.7..285.3）→ 夹紧必须用这个框，不然全被钳到边上；
     wlg 档的可用区比全世界小（只 88°×60°）→ 用 wlg 框，免得一拖就漂到没图的空白区 */
  function mBox() {
    /* ★★ 世界档的夹紧框 = 【整张全世界图】，不再用 wlg 的小框：
       wlg 只覆盖 90°×61°，比视口还小时 clampT 会把相机钉在中心 → 拖不动
       （就是用户报的「想看看周围，看不了」）。世界图下面的 allocean/outsvg 铺满全球，
       拖到 wlg 之外也不会露白。 */
    if (mode === 'world' && W) {
      if (W.BX0 != null) return { x0: W.BX0, x1: W.BX1, y0: W.BY0, y1: W.BY1 };
    }
    return { x0: 0, x1: T.W, y0: 0, y1: T.H };
  }
  /** 经纬度 → 世界图图集坐标（mapX 折进世界图覆盖的 3600 单位里） */
  function toAtlasW(lat, lon) {
    if (!W) return toAtlas(lat, lon);
    var mx = mapXOf(lon);
    while (mx > W.MAXX) mx -= 3600;
    while (mx < W.MINX) mx += 3600;
    return [(mx - T.MINX) * W.A2, (T.MAXY - mapYOf(lat)) * W.A2];
  }
  /** 是否在 wlg（日本周边广域图）的覆盖范围内 */
  function inWlg(lat, lon) {
    return !!(GB && lon >= GB.lonMin && lon <= GB.lonMax && lat >= GB.latMin && lat <= GB.latMax);
  }
  /* ★★ 可视经度跨度（度）：px/度 = k×A×10（三层图同一比例尺）= k×100
       → 跨度 = 可视宽 682px / (k×100) */
  function spanDeg(k) { return (VIS.x1 - VIS.x0) / (k * T.A * 10); }
  /** 官方的 地図表示モード：0(详细栏)=2 / 1(EEW页)=1 / 2(海啸)=3（与 views.js 的 mapModeOf 一致） */
  function curMapMode() {
    var v = (global.QVViews && global.QVViews.view) || 0;
    return (v === 1) ? 1 : (v === 2 ? 3 : 2);
  }
  /** ★★ 档位由【相机跨度 + 中心位置】共同决定（官方「地図拡大モード」也是看跨度，
   *     不是只看震中在哪）：
   *        跨度 ≤ 25° 且中心在日本图内   → jp   （nb 陆地+县境 / nf 海岸线，最精细）
   *        跨度 ≤ 70° 且中心在 wlg 范围内 → wlg  （官方广域图，自带日本）
   *        否则                         → outsvg（官方全世界图，日本是挖空的 → 靠 nb 补）
   *   ⇒ 用户用滚轮 / “−” 缩小到全世界时会真的切成世界图，而不是被日本图集框
   *     死死卡住（用户报的「世界地图只有日本」）。
   *   ⚠ 三层同投影、同比例尺（px/地图单位 都是 k×10）→ 切换档位时 tx/ty 不变、无跳变。 */
  function tierFor(lat, lon, k) {
    var span = spanDeg(k), jp = inAtlas(lat, lon);
    if (!opts.world) return 'jp';                     /* 设置页关掉「显示世界地图」→ 只画日本 */
    if (jp && span <= 25) return 'jp';
    /* ★★ 2026-10-11（第十五轮）：官方阈值换算：官方「下地地図描画」用
         カメラ系[3] < 設定系[3]/360（164.67/360 ≈ 0.457，对应视野 ≈ 85°）才切 outsvg；
         之前我们写 70° 切得太早 → 中等缩小就直接变成「挖空日本 + 低清世界图」。
         官方 wlg（广域陆地，自带日本、矢量清晰）一直用到 ≈ 85°。 */
    if (G) {
      if (inWlg(lat, lon) && span <= 85) return 'wlg';
      /* 日本区域但拉得很远：广域图也含日本，优先用它（世界图里日本是挖空的） */
      if (jp && span <= 85) return 'wlg';
    }
    return 'outsvg';
  }
  /** 应用档位（mode 与各图层可见性）；返回 true = 档位变了
   *  ⚠ 不动 lastKey：手动缩放导致的换档不能让 app 下一秒 focus() 把相机抢回去。 */
  function applyTier(t2) {
    var m2 = (t2 === 'jp') ? 'jp' : 'world';
    var changed = (t2 !== tier || m2 !== mode);
    tier = t2; mode = m2;
    /* ★★★ 2026-10-11（第十六轮）图层可见性分工（血的教训，别再混）：
       · allocean（全球海）/ nb（日本陆地）/ nf（海岸线）：永远显示，这里只管它们。
       · outsvg：只受「显示世界地图」开关（opts.world）控制。
       · **wld / wlg 的显隐【完全交给 syncSea()】**（按"跨度 ≤70° 且视野完全在素材覆盖内"判定）。
         ⚠️ 这里绝不能强制打开它们：panBy()/zoomAt() 的顺序是 snap()→paint(syncSea 算对)→
         syncTier()→applyTier —— 如果 applyTier 又写一次 display='' 就会【盖掉】syncSea 的隐藏
         → 一拖动/缩放就"变回原来的"（用户 2026-10-11 报的「一滑动就不正常」就是它）。
       结束时再同步一次，保证换档后立即可见性正确。 */
    if (oview) oview.style.display = '';
    if (view) view.style.display = '';                 /* nb：永远 */
    if (cview) cview.style.display = '';               /* nf：永远 */
    syncSea();                    /* wld/wlg/outsvg/allocean：全部唯一裁判 */
    return changed;
  }
  /** 当前相机中心的经纬度 */
  function camCenter() {
    var ke = cam.k * mS();
    var ax = (VIS.cx - cam.tx) / ke, ay = (VIS.cy - cam.ty) / ke;
    var ll;
    if (mode === 'world' && W) ll = [latOfMap(T.MAXY - ay / W.A2), lonOfMap(T.MINX + ax / W.A2)];
    else ll = toLatLon(ax, ay);
    /* ★★ 2026-10-12 修：lonOfMap() 是【不归一】的（mx/10+136），而 clampT 会把 tx 归一到
       [0, 一个世界周期) —— 两者一乘除就可能得到比真实值差 ±360° 整数倍的经度。
       经度本身是周期的，画图没问题；但 tierFor() / inAtlas() / inWlg() 都是拿裸经度做
       【范围比较】的 → 一步绕出去就会把「日本档」判成「outsvg 世界档」→
       相机突然跳到世界图（用户说的「定位不对了」就是这么来的）。 */
    ll[1] = normLon(ll[1]);
    return ll;
  }
  /** 把经度折回 (-180, 180] */
  function normLon(l) {
    l = l % 360;
    if (l > 180) l -= 360;
    if (l < -180) l += 360;
    return l;
  }
  /** 手动缩放/平移后按新跨度重选档位（中心与 k 不变，只换图层） */
  function syncTier() {
    if (!view) return;
    var ll = camCenter();
    if (applyTier(tierFor(ll[0], ll[1], cam.k))) apply(ll[0], ll[1], cam.k, true);
  }
  /** 夹紧平移量：让可视区尽量不越出图集【内容框】（内容比视口小时居中）
   *  tx 范围：内容左缘不得跑到 VIS.x0 右边、内容右缘不得跑到 VIS.x1 左边
   *    tx ≤ VIS.x0 - k*bx0 ， tx ≥ VIS.x1 - k*bx1 */
  function clampT(tx, ty, k, bx) {
    bx = bx || mBox();
    var vw = (VIS.x1 - VIS.x0) / k, vh = (VIS.y1 - VIS.y0) / k;
    var cw = bx.x1 - bx.x0, ch = bx.y1 - bx.y0;
    /* ★★★ 2026-10-11（第十六轮）横向环绕：世界在 x 上每 3600 地图单位（=360°）重复，
       屏幕周期 = 36000×k。六层都有 ±1 份克隆 → tx 对周期取模 = 无限左右滚
       （用户要的「像地图 App 一样一直滚、一直循环」），跨 180° 经线（白令海峡/汤加）不断图。
       纵向不绕（南北极没有环）→ 保留夹紧 + 半视口过卷。 */
    if (W) {
      /* ⚠️ 这里 k 是 caller 的 ke（世界档 = 日本缩放×WSC）→ 周期要换回日本缩放：
         P_screen = 36000 × (k / mS())，否则世界档周期大 20 倍 = 永远不环绕。 */
      var P = 36000 * k / mS();
      tx = ((tx % P) + P) % P;
    } else {
      var OVW = cw <= vw ? 0 : vw * 0.5;
      tx = (cw <= vw) ? VIS.cx - k * (bx.x0 + cw / 2)
                      : clamp(tx, VIS.x1 - k * bx.x1 - k * OVW, VIS.x0 - k * bx.x0 + k * OVW);
    }
    /* ★★ 2026-10-15 自建瓦片（ownMap）时纵向【不许过卷】：
       世界方块只有 3600×3600 地图单位（墨卡托 ±85°，南北极外没有素材），
       而「半视口过卷」允许把方块往上/下拖出半个视口 → 边缘立刻露出一条没图的底色
       （用户报的「一半屏幕都没了」：宽窗口时 K_MIN 由【宽度】决定、方块比视口高，
        相机再把方块上顶几十 px，顶上就空一条）。
       官方素材时代保留过卷（那时日本图只覆盖一小块，要看周围必须能拖出去）。 */
    var OVH = (ch <= vh) ? 0 : vh * (ownMap ? 0 : 0.5);
    ty = (ch <= vh) ? VIS.cy - k * (bx.y0 + ch / 2)
                    : clamp(ty, VIS.y1 - k * bx.y1 - k * OVH, VIS.y0 - k * bx.y0 + k * OVH);
    return [tx, ty];
  }
  /* ★★★ 2026-10-11（第十六轮）「按缩放重栅格化」—— 修「放大就糊」的根本手段
     浏览器对 <img> 里的 SVG 只按【布局尺寸】栅格化一次；layout 不变、只改 transform
     放大 = 把位图拉大 → 2~4× 就明显模糊（用户报的「海洋和陆地一起模糊」的陆地/海岸线）。
     修法：把缩放改到布局上（img 的宽高/位置 ×q），transform 只保留 平移 + (S/q)。
     · 矢量层（wlg/outsvg）→ q 最高到 4：任何倍率都按真实像素重画 = 锐利。
     · 位图层（wld）→ q 最高到 2（内嵌位图 2×，q≤2 都不会损清晰度）。
     q 用 1.25 步进量化 → 动画中不会每帧重排，静止时零开销。 */
  var RASTER_Q = Math.log(1.25), CAP_VEC = 4, CAP_BMP = 2;
  function reRaster(box, tiles, s, cap) {
    if (!box || !tiles) return Math.max(s, 0.001);
    var want = Math.max(0.05, Math.min(s, cap));
    var q = Math.exp(Math.round(Math.log(want) / RASTER_Q) * RASTER_Q);
    if (q > cap) q = cap;
    var old = parseFloat(box.dataset.rq || '0');
    if (old && Math.abs(old - q) / q < 0.01) return old;
    box.dataset.rq = q.toFixed(4);
    var im = box.children;
    var b = parseFloat(box.dataset.bleed || '0');
    for (var i = 0; i < im.length; i++) {
      var tt = tiles[i % tiles.length];
      var dx = parseFloat(im[i].dataset.dx || '0');
      im[i].style.left = ((tt.x + dx - b) * q).toFixed(2) + 'px';
      im[i].style.top = ((tt.y - b) * q).toFixed(2) + 'px';
      im[i].style.width = ((tt.w + b * 2) * q).toFixed(2) + 'px';
      im[i].style.height = ((tt.h + b * 2) * q).toFixed(2) + 'px';
    }
    return q;
  }
  /** 屏幕点 → 经纬度（与 state() 同一套公式，供视野包含检查用） */
  function s2ll(sx, sy) {
    var ke = cam.k * mS();
    var ax = (sx - cam.tx) / ke, ay = (sy - cam.ty) / ke;
    if (mode === 'world' && W) return [latOfMap(T.MAXY - ay / W.A2), lonOfMap(T.MINX + ax / W.A2)];
    return toLatLon(ax, ay);
  }
  /* wld 海底地形的覆盖范围备注（实测约 75E~200E / -15~62N、素材边界有重叠绘制）——
     现在不再用它做裁剪（改回官方纯缩放门槛，见 syncSea）。 */
  /** ★ 每帧同步（显隐唯一裁判，2026-10-11 用户定案）：
   *  · wld / wlg（精细层）：只要没关「显示世界地图」就【常显】（用户要求体验优先）。
   *  · outsvg（世界粗图，5px/°）：【只在精细层盖不到的地方才需要】——
   *    视野完全落在 wlg 精细覆盖内时藏掉（官方精细档也根本不画 outsvg）
   *    —— 否则它的粗海岸线会叠在精细地图上（用户：「既然都最大精细化了，
   *    官方那个粗线的话就不需要了呀」）。
   *  ⚠️ 位置比较必须先把素材框平移到视野中心所在的 360° 分支（lonOfMap 未归一化）。 */
  function syncSea() {
    /* ★★ 自建地图模式（kondz-map 瓦片）：官方 6 层**彻底不要了**
       （用户 2026-10-12：「你这个为什么保留了官方的垃圾图？快点给我去掉」）。
       不再做兜底 —— 瓦片没到时露的是 #map 的【海色底】（见 app.css），
       而不是官方的旧图，也不是黑。 */
    if (ownMap) { hideOfficial(true); return; }
    var on = opts.world ? '' : 'none';
    if (gview) gview.style.display = on;
    if (dview) dview.style.display = on;
    if (!wview && !oview) return;
    /* 两个覆盖框（实测渲染范围；比较前按 360° 分支归一） */
    var fineW = false, fineD = false;
    if (opts.world) {
      var l1 = s2ll(VIS.x0, VIS.y0), l2 = s2ll(VIS.x1, VIS.y1);
      var lonMin = Math.min(l1[1], l2[1]), lonMax = Math.max(l1[1], l2[1]);
      var latMin = Math.min(l1[0], l2[0]), latMax = Math.max(l1[0], l2[0]);
      var c0 = (lonMin + lonMax) / 2;
      var covers = function (b) {
        var kk = Math.round((c0 - (b.lonMin + b.lonMax) / 2) / 360);
        return lonMin >= b.lonMin + kk * 360 && lonMax <= b.lonMax + kk * 360 &&
          latMin >= b.latMin && latMax <= b.latMax;
      };
      /* ⚠️ 框要【比实测覆盖再收紧 1°】——因为这两个框现在决定的是「藏掉底层」，
         一旦框比实际覆盖宽，边缘就会出现没东西可画的黑条。
         wlg（陆地精细）实测 ≈ 104~194E / 12.8~66N；wld（海底地形）≈ 100.6~197.6E / 16.8~60.8N */
      fineW = covers({ lonMin: 105, lonMax: 193, latMin: 14, latMax: 65 });
      fineD = covers({ lonMin: 102, lonMax: 196, latMin: 18, latMax: 60 });
    }
    /* ★ 用户要求「既然都最大精细化了，粗的就不需要了」：
       精细层盖满视野时，把【粗图 outsvg】和【全球海 allocean】都藏掉 ——
       不留粗海岸线、也不留两种海面的色差方块。 */
    if (wview) wview.style.display = (opts.world && !fineW) ? '' : 'none';
    if (oview) oview.style.display = (opts.world && !fineD) ? '' : 'none';
  }
  /** 只负责把 cam 写进 DOM（地图变换 + 震中标记位置），不碰动画 */
  function paint() {
    syncSea();
    /* ★ 自建瓦片金字塔层（kondz-map）：屏幕空间图层，不参与图集 transform，
       每帧按当前 cam 选级别 + 摆瓦片。官方图层全关掉时它就是整张地图。 */
    if (global.QVTiles) global.QVTiles.update(cam, VIS);
    /* ★ 2026-11-03 用户：「海岸线可以加粗一点吗，现在的太细了」+「直接去看官方的多粗」
       —— 官方 nf 层规格（反编译素材里直接读出来的）：
            stroke-width = **1.5**（图集 px，1 单位 = 0.1°，随相机缩放）
            stroke = #dce3ff，stroke-opacity = 0.9
          自建底图是 PNG 瓦片，线宽烧死在像素里改不了 → 这里用 coast-geo 的全球
          Natural Earth 10m 海岸线按**官方同一规格**再描一遍，叠在震度色块之上。
          （只画视野内的段，见 coast-base.js） */
    /* ★ 预先计算世界副本偏移 cam.ox，供 coast-base、shindo 及 ovlay 共享，避免 getComputedStyle */
    var per = 36000 * cam.k;
    var ox = cam.tx;
    if (per > 1 && T && T.W) ox += Math.round((VIS.cx - (cam.tx + cam.k * T.W / 2)) / per) * per;
    cam.ox = ox;

    if (global.QVCoastBase) global.QVCoastBase.update(cam, VIS);
    /* ★★ 天体模式（月球/火星）：一张预先重投影成 Mercator 的全球图，
       摆位公式与瓦片完全一致（都是 mapX/mapY 的 3600×3600 世界方块）。
       它自带不透明底 + z-index 6，压在 #mapview(5) 之上、#mapoverlay(7) 之下。 */
    if (global.QVPlanet) global.QVPlanet.update(cam, VIS);
    /* ★★ 震度层（色块 + 标记）也要每帧跟相机：
       ① 标记尺寸按官方规则随 √k 变、只画视野内的点；
       ② init() 换图集时会新建 #mapoverlay → 旧层变孤儿节点（用户报的
          「滑动之后丢失震度的色块图层」），updateView 里会重新挂回去。 */
    /* ★★★ 2026-10-26 用户：「触发海啸后地图上的区划震度提示色块没有正常显示」
       以前这里传的是 `mode !== 'world'` —— 看海啸肯定要缩小，缩到世界档就把
       整个 #mapareas / #mappoints 设 display:none 了（海啸页一缩小就“色块全没了”）。
       但色块层用的 #mapoverlay 和世界档是**同一套图集变换**（同一个 cam），
       不存在投影不同的问题 → 只有真正的行星模式（月球/火星，完全另一套投影）才隐藏。 */
    if (global.QVShindo && global.QVShindo.updateView) global.QVShindo.updateView(cam, VIS, mode !== 'planet');
    /* ★ 2026-10-26 用户：「海啸页要隐藏色块数字、压暗填充」——
       必须挂在【每帧的 paint】上：切 tab 不一定会触发 prepare()（实测切到海啸页时
       prepare() 没跟着跑，样式就不生效）。setTsuMode 内部有值去重，重复调无开销。 */
    if (global.QVShindo && global.QVShindo.setTsuMode) {
      global.QVShindo.setTsuMode((global.QVViews && global.QVViews.view) === 2);
    }
    var t = 'translate(' + cam.tx.toFixed(2) + 'px,' + cam.ty.toFixed(2) + 'px) scale(';
    if (view) view.style.transform = t + cam.k.toFixed(4) + ')';
    if (cview) cview.style.transform = t + cam.k.toFixed(4) + ')';
    /* ★ 我们自己的叠加层：与官方图集同一套变换，但【不随官方图层一起隐藏】 */
    if (ovlay) {
      /* ★★ 2026-10-12 修「一缩放色块就跑到屏幕外 / 看着像黑屏」：
         世界在 x 上每 360°（=36000 图集 px，A=10px/单位）重复一次。
         官方六层每层都有 ±1 份克隆、QVTiles 自己算虚拟列，**唯独这一层只有一份**
         —— 而 clampT 会把 tx 折回 [0, P)，所以缩放/平移几次后
         这一层经常落在别的世界副本上 = 整层跑到屏幕外（地图上就只剩底图）。
         修法与震中标记一致：取【离视口中心最近的那一份】。 */
      ovlay.style.transform = 'translate(' + cam.ox.toFixed(2) + 'px,' + cam.ty.toFixed(2) +
        'px) scale(' + cam.k.toFixed(4) + ')';
    }
    if (oview) oview.style.transform = t + (cam.k * WSC).toFixed(5) + ')';
    /* ★ outsvg / wlg / wld 三层走「重栅格化」（见 reRaster）：布局缩放 q + 容器补 (S/q) */
    if (wview) {
      var w0 = global.QV_MAPWORLD;
      var s2 = cam.k * WSC, q2 = reRaster(wview, w0.tiles, s2, CAP_VEC);
      wview.style.transform = t + (s2 / q2).toFixed(5) + ')';
    }
    /* wlg 图有自己的比例尺（A=图集px/地图单位）→ 用自己的 scale 与偏移 */
    if (gview) {
      var g = global.QV_WLGTILES;
      var s1 = cam.k * g.K, q1 = reRaster(gview, g.tiles, s1, CAP_VEC);
      gview.style.transform = 'translate(' + (cam.tx + g.OX * cam.k).toFixed(2) + 'px,' +
        (cam.ty + g.OY * cam.k).toFixed(2) + 'px) scale(' + (s1 / q1).toFixed(5) + ')';
    }
    /* wld 海底地形层：与 wlg 同一套换算（自己的 K/OX/OY） */
    if (dview) {
      var d0 = global.QV_WLDTILES;
      var s3 = cam.k * d0.K, q3b = reRaster(dview, d0.tiles, s3, CAP_BMP);
      dview.style.transform = 'translate(' + (cam.tx + d0.OX * cam.k).toFixed(2) + 'px,' +
        (cam.ty + d0.OY * cam.k).toFixed(2) + 'px) scale(' + (s3 / q3b).toFixed(5) + ')';
    }
    for (var i = 0; i < pinEls.length; i++) {
      var p = pinEls[i];
      /* ★★ 图集坐标必须【在这里】算，不能在 setPins 里算一次就算完：
         a 依赖 `mode`（jp 图集 / wlg / 世界图是三套不同投影），而 mode 会随相机换档变
         —— focus() 里是【先 applyTier 再 apply】。
         以前 a 只在 setPins 里算 → 换档后 a 还是旧投影的坐标 → 红叉位置离谱、
         根本不在屏幕上，要等到下一次 render（≈1 秒）重新调 setPins 才回来。
         实测：相机 3575ms 到位，红叉 6029ms 才进屏幕（用户：「为什么红叉打开
         页面过几秒才加载出来」）。 */
      /* ★★ 2026-10-12 全部推倒（官方那套摆位补丁删掉）：
         把经纬度换成【地图单位】，再用与 js/qvtiles.js 瓦片完全相同的方式摆位 ——
         px = 10*k（各档位一致），横向上世界每 3600 地图单位重复一次，
         取【离视口中心最近的那一份】（旧代码是拿「官方图集周期 36000/1800」硬凑 ±1 份）。 */
      if (!p.ll || !isFinite(p.ll[0]) || !isFinite(p.ll[1])) { p.el.style.display = 'none'; continue; }
      p.el.style.display = '';
      /* ★ 官方 `震源スタンんプEEW` 的精灵尺寸 = 画面設定系[6]×18×图标大小 ——
         `画面設定系[6]` 就是**地图缩放系数**，所以红叉会随缩放动态变大变小
         （用户：「叉叉也是动态缩放的」）。这里用 √k 做温和的缩放，避免极端场合
         叉叉过小/过大。 */
      var zf = cam.k / 0.48;
      zf = zf < 0.7 ? 0.7 : (zf > 1.7 ? 1.7 : zf);
      var s2 = p.px * (opts.pinScale || 1) * zf;
      var pxu = T.A * cam.k;                       /* 屏幕像素 / 地图单位 */
      var ux = mapXOf(p.ll[1]), uy = mapYOf(p.ll[0]);
      var bx = cam.tx + pxu * (ux - T.MINX);
      var period = pxu * 3600;                     /* 世界周期（屏幕像素） */
      bx += Math.round((VIS.cx - bx) / period) * period;
      p.el.style.width = s2.toFixed(1) + 'px';
      p.el.style.height = s2.toFixed(1) + 'px';
      p.el.style.left = (bx - s2 / 2).toFixed(1) + 'px';
      p.el.style.top = (cam.ty + pxu * (T.MAXY - uy) - s2 / 2).toFixed(1) + 'px';
    }
    paintBoxes();
    paintAreas();
    paintZqBorders();      /* ZQuake：常驻区域分界线（压在填色层之下） */
    autoCamFollow();      /* ZQuake：波前外扩时地图慢慢放大 */
    paintIso();
    tickWaves();
    paintStations();
  }
  function tick() {
    rafId = 0;
    if (!anim) return;
    var p = (performance.now() - anim.t0) / anim.dur;
    if (p >= 1) p = 1;
    var e = EASE(p), f = anim.from;
    cam.tx = f.tx + (tgt.tx - f.tx) * e;
    cam.ty = f.ty + (tgt.ty - f.ty) * e;
    cam.k = f.k + (tgt.k - f.k) * e;
    paint();
    if (p < 1) rafId = requestAnimationFrame(tick); else anim = null;
  }
  function startAnim(dur) {
    anim = { t0: performance.now(), dur: dur || DUR,
      from: { tx: cam.tx, ty: cam.ty, k: cam.k } };
    if (!rafId) rafId = requestAnimationFrame(tick);
  }
  /** 立刻到位（拖拽/滚轮/初始化用） */
  function snap() {
    anim = null;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    cam.tx = tgt.tx; cam.ty = tgt.ty; cam.k = tgt.k;
    paint();
  }
  /** 把 (lat,lon) 放到可视区中心 */
  function apply(lat, lon, k, instant) {
    if (!view) return;
    k = clamp(k || home.k, K_MIN, K_MAX);
    var a = (mode === 'world' && W) ? toAtlasW(lat, lon) : toAtlas(lat, lon);
    var ke = k * mS();
    var t = clampT(VIS.cx - ke * a[0], VIS.cy - ke * a[1], ke);
    tgt.k = k;
    /* ★ 环绕：动画目标取「距当前中心最近的一份世界拷贝」（±P）。
       ★★★ 2026-11-03 用户：「为什么检测到摇晃要先绕全世界地球一圈，再定位到那个地方？」
       —— 病根：这里拿 `cam.tx` 当参考点，而 cam.tx 是【旧倍率】下对周期取模的结果。
          倍率一跨 10 倍（全球 k≈0.13 ↔ 市区 k≈2.4），周期从 4680px 变成 86400px，
          旧 tx 落进新周期里就被判成「差得很远」→ 目标被推到好几个世界周期之外
          → 动画期间整张世界地图横向飞过去（用户看到的就是「绕地球一圈」）。
       ⇒ 参考点必须换算到【新倍率】下：先把当前屏幕中心解出来，再按新 k 反算 tx。
         这样动画永远走地理上的最短路。 */
    if (W && !instant) {
      var P2 = 36000 * k;
      var ll0 = camCenter();
      var a0 = (mode === 'world' && W) ? toAtlasW(ll0[0], ll0[1]) : toAtlas(ll0[0], ll0[1]);
      var refX = VIS.cx - ke * a0[0];
      refX = ((refX % P2) + P2) % P2;
      while (t[0] - refX > P2 / 2) t[0] -= P2;
      while (refX - t[0] > P2 / 2) t[0] += P2;
      /* 仍然要跨 1.5 屏以上 → 说明是「换事件/跨半球」，别做飞行动画，直接到位
         （一次几百毫秒的横穿世界就是「绕地球一圈」的观感来源）。 */
      if (Math.abs(t[0] - cam.tx) > (VIS.x1 - VIS.x0) * 1.5) instant = true;
    }
    /* ★★★ 2026-10-27 用户：「镜头的跳转动画我们太卡了」
       —— 以前每报（0.3s）都调用一次 apply()：动画还在跑就被新目标从头重启，
          全程都是「加速→被刹车→再加速」，看起来就像卡顿。
       ⇒ 目标与当前动画目标几乎一样时（缩放差 <4% 且平移 <20px）不重启，让它平滑跑完。 */
    if (!instant && anim) {
      var _dk = Math.abs(Math.log(k / Math.max(1e-6, tgt.k || k)));
      var _dp = Math.abs(t[0] - (tgt.tx || 0)) + Math.abs(t[1] - (tgt.ty || 0));
      if (_dk < 0.04 && _dp < 20) return;
    }
    tgt.tx = t[0]; tgt.ty = t[1];
    if (instant || !opts.anim) snap(); else startAnim();
  }
  /** ★★★ 2026-10-20（用户：「地图选点偏移」）
   *  屏幕(client) → 舞台【逻辑】坐标的缩放比。
   *  病根：`#stage` 的**逻辑宽高由 app.js 的 layout() 动态写**（≥960x720，
   *  窗口比 16:9 宽时会被拉大，1920 窗口 ≈ 1330x720）；而 CSS 再整体 scale(s)。
   *  getBoundingClientRect() 给的是【视觉】尺寸 = 逻辑宽 × s × UI大小，
   *  所以真正的缩放比 = rect.width / **offsetWidth**（offsetWidth 不吃 transform）。
   *  旧代码写死 `rect.width / 960`：窗口越宽，算出的 s 越大 → 舞台坐标越小
   *  → 点地图选震心/滚轮锚点/拖拽全部往【左上】偏（1920 窗口偏 ~38%）。 */
  function stageK() {
    if (!stage || !stage.offsetWidth) return 1;
    var r = stage.getBoundingClientRect();
    return (r.width / stage.offsetWidth) || 1;
  }
  /** 舞台逻辑坐标（不是 960x720，是 layout() 写的实际逻辑尺寸） */
  function stagePt(e) {
    var r = stage.getBoundingClientRect(), s = stageK();
    return [(e.clientX - r.left) / s, (e.clientY - r.top) / s];
  }
  /** 以舞台点 (sx,sy) 为锚点缩放 factor 倍（手动操作 → 立即到位） */
  function zoomAt(factor, sx, sy) {
    if (!view) return;
    sx = sx == null ? VIS.cx : sx; sy = sy == null ? VIS.cy : sy;
    var k2 = clamp(cam.k * factor, K_MIN, K_MAX);
    if (k2 === cam.k) return;
    /* 锚点在图集中的位置保持不变： ax = (sx - tx)/k */
    var ke = cam.k * mS(), ke2 = k2 * mS();
    var ax = (sx - cam.tx) / ke, ay = (sy - cam.ty) / ke;
    var t = clampT(sx - ke2 * ax, sy - ke2 * ay, ke2);
    tgt.k = k2; tgt.tx = t[0]; tgt.ty = t[1];
    snap();
    syncTier();                     /* 缩小到超过阈值 → 自动换到广域/世界图 */
  }
  function panBy(dx, dy) {
    var t = clampT(cam.tx + dx, cam.ty + dy, cam.k * mS());
    tgt.tx = t[0]; tgt.ty = t[1]; tgt.k = cam.k;
    snap();
    syncTier();
  }

  /* ---------------- 交互 ---------------- */
  /** 地图是否响应鼠标。
   *  视图 0（情报）和 2（海啸）可以拖地图；视图 1/3 是长列表页，拖动仍然允许。
   *  ★ 但**滚轮**在 1/2/3 都必须留给列表：视图 2 现在是「海啸预报区域」长列表。 */
  function mapInteractive(isWheel) {
    /* ★ 2026-10-31 用户：「鼠标放哪焦点在哪」—— 滚轮也按光标位置分流，
       不再按视图卡死：
       · 光标在地图区（下方 stagePt()[0] >= UI_RIGHT）→ 任何视图都缩放/平移地图；
       · 光标在左栏 → 本函数还没轮到（mapcam 的 wheel 监听在 `p[0] < UI_RIGHT` 时已
         return，事件冒泡到 app.js 交给列表滚动）。
       ⇒ 滚轮是否生效只看「光标在不在地图上」，与当前是第几个视图无关。 */
    return true;
  }

  /* ★ 左侧 UI 栏右缘。信息/海啸/实时/设置四个视图的面板都是 x 8..232，
     再加页签列 240..280 → 从 290 起才是真正的「地图区」。 */
  var UI_RIGHT = 290;

  /* ★★ 2026-10-20：地图拖拽的「不该抢」名单。
     上一轮为了修「实时页拖不动」把 mapInteractive() 改成恒 true，结果
     stage 的 mousedown 对【任何位置】都 preventDefault →
     模拟弹窗里 `<summary>海啸模拟（可选）</summary>` 这种靠浏览器默认行为的
     元素直接点不开（用户：「这个东西坏了，点不了」）。
     ⇒ 真正的地图区 = 不属于任何浮层/控件的空白处，且 x ≥ UI_RIGHT。 */
  var NO_DRAG = '#qvsim, #chrome, #hoverpill, .qvpop, .box, details, summary,' +
    ' button, input, select, textarea, label, a, option, [data-nodrag]';
  function noDragTarget(t) {
    return !!(t && t.closest && t.closest(NO_DRAG));
  }

  function enableControls() {
    var lx = 0, ly = 0;
    var dragDx = 0, dragDy = 0, dragRaf = 0;
    function applyDrag() {
      dragRaf = 0;
      if (!dragging && !dragDx && !dragDy) return;
      var s = stageK();
      var dx = dragDx / s, dy = dragDy / s;
      dragDx = 0; dragDy = 0;
      if (dx || dy) {
        manual = true; userCamLock = true;
        panBy(dx, dy);
      }
    }

    var wheelDx = 0, wheelDy = 0, wheelZoomLog = 0, wheelAx = 0, wheelAy = 0, wheelRaf = 0;
    var wheelMode = '', wheelT = 0, wheelLn = Math.log(1.0018);
    function applyWheel() {
      wheelRaf = 0;
      var zl = wheelZoomLog, wdx = wheelDx, wdy = wheelDy;
      wheelZoomLog = 0; wheelDx = 0; wheelDy = 0;
      if (zl) zoomAt(Math.max(0.25, Math.min(4, Math.exp(zl))), wheelAx, wheelAy);
      else if (wdx || wdy) panBy(wdx, wdy);
    }

    stage.addEventListener('wheel', function (e) {
      if (!view) return;
      var p = stagePt(e);
      /* ★★ 2026-10-10 用户报「鼠标在信息栏上滚轮却在缩放地图」：
         根因 = 这个监听挂在 #stage 上，**只看当前视图、不看光标在哪**。
         正解：左侧 UI 栏（信息面板 / 页签列）上的滚轮不属于地图 →
         **直接 return 且不 preventDefault**，事件继续冒泡到 window，
         交给 app.js 的列表滚动处理（视图 1/2/3 的长列表）。 */
      if (window.QV_ZQ_FULLMAP) {
        if (e.target && e.target.closest && e.target.closest('#zq-ui')) return;
      } else if (p[0] < UI_RIGHT) return;
      if (!mapInteractive(true)) return;
      e.preventDefault();
      var unit = e.deltaMode === 1 ? 40 : (e.deltaMode === 2 ? (stage.clientHeight || 720) : 1);
      var dy = e.deltaY * unit, dx = e.deltaX * unit;
      var now = performance.now();
      if (e.ctrlKey) wheelMode = 'zoom';
      else if (!wheelMode || now - wheelT > 220) wheelMode = Math.abs(dy) >= 40 ? 'zoom' : 'pan';
      wheelT = now;
      manual = true; userCamLock = true;
      if (wheelMode === 'zoom') {
        wheelZoomLog += -wheelLn * (e.ctrlKey ? dy * 4 : dy);
        wheelAx = p[0]; wheelAy = p[1];
      } else {
        wheelDx += -dx; wheelDy += -dy;
      }
      if (!wheelRaf) wheelRaf = requestAnimationFrame(applyWheel);
    }, { passive: false });

    stage.addEventListener('mousedown', function (e) {
      if (!view || e.button !== 0) return;
      if (!mapInteractive()) return;
      /* ★ 面板 / 弹窗 / 控件上的按下不是拖地图（见 noDragTarget 注释） */
      if (noDragTarget(e.target)) return;
      if (window.QV_ZQ_FULLMAP) {
        if (e.target && e.target.closest && e.target.closest('#zq-ui')) return;
      } else if (stagePt(e)[0] < UI_RIGHT) return;
      dragging = true; lx = e.clientX; ly = e.clientY;
      dragDx = 0; dragDy = 0;
      stage.style.cursor = 'grabbing';
      e.preventDefault();
    });
    /* 双击地图 = 回到选中地震（永远有办法「看回来」）
       ★ 2026-10-20 用户报「点缩放会自动送回出生视角」：
          双击 +/− 按钮 → dblclick 冒泡到 #stage → 这里的 fit() 把相机抢走。
          z/f 的 mousedown 虽然 stopPropagation 了，但 dblclick 没拦。
          除了在按钮上自阻止，这里再加一道：落点在 #chrome（+ − 适配 等浮层按钮）就忽略。 */
    stage.addEventListener('dblclick', function (e) {
      if (e.target && e.target.closest && e.target.closest('#chrome')) return;
      if (noDragTarget(e.target)) return;
      if (!mapInteractive()) return;
      fit();
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      dragDx += (e.clientX - lx);
      dragDy += (e.clientY - ly);
      lx = e.clientX; ly = e.clientY;
      if (!dragRaf) dragRaf = requestAnimationFrame(applyDrag);
    });
    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false; stage.style.cursor = '';
      if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
      if (dragDx || dragDy) {
        var s = stageK();
        panBy(dragDx / s, dragDy / s);
        dragDx = 0; dragDy = 0;
      }
      if (global.QVCoastBase && global.QVCoastBase.update) {
        global.QVCoastBase.update(cam, VIS, true);
      }
    });

    /* 官方 +/− 按钮（FlZom0：40x76，上半 + 下半 −）与 适配按钮（FlFit0）
       ⚠️ 这两个现在在 #chrome 层（z-index 最高）—— 任何视图的面板都不会盖住它们 */
    var z = document.querySelector('#chrome img[data-cos="FlZom0"], #art img[data-cos="FlZom0"]');
    if (z) {
      z.style.pointerEvents = 'auto';
      z.style.cursor = 'pointer';
      z.style.transition = 'opacity .25s';
      z.addEventListener('mousedown', function (e) {
        var r = z.getBoundingClientRect();
        manual = true;
        zoomAt((e.clientY - r.top) < r.height / 2 ? 1.35 : 1 / 1.35, VIS.cx, VIS.cy);
        /* ★ 连点 +/−（<500ms）浏览器会把它当 dblclick → 冒泡到 stage → fit()。
           必须在这里吃掉，否则按键缩放会被“顺便回出生视角”。 */
        e.stopPropagation();
        e.preventDefault();
      });
      z.addEventListener('dblclick', function (e) { e.stopPropagation(); e.preventDefault(); });
    }
    var f = document.querySelector('#chrome img[data-cos="FlFit0"], #art img[data-cos="FlFit0"]');
    if (f) {
      f.style.pointerEvents = 'auto';
      f.style.cursor = 'pointer';
      f.style.transition = 'opacity .25s';
      f.title = '回到选中地震（开启「图层切换按钮」时改为循环图层）';
      f.addEventListener('mousedown', function (e) {
        e.stopPropagation(); e.preventDefault();
        if (opts.layerBtn) cycleTier(); else fit();
      });
      f.addEventListener('dblclick', function (e) { e.stopPropagation(); e.preventDefault(); });
    }
    /* 「自动隐藏按钮」由 app.js 的 QVSet.autoHide 统一处理（它同时管 pointerEvents） */
  }

  /** ★★★ 2026-10-28 用户：「我们什么时候将摄像机自动缩放？1. 紧急地震速报时先聚焦
   *   2. 根据测站做缩小 3. 根据地图填充时的色块做缩小」
   *   把相机套到一个经纬度包围盒上（渐进取景）。
   *   · **只缩小不放大** —— 数据只会越来越多，画面一步步往外拉，不会来回抖
   *   · 尊重设置页「自动移动镜头」；用户手动拖过/缩过（manual）就不抢
   *   b = { n, s, e, w }（北/南/东/西，单位：度） */
  function frame(b, force, allowIn) {
    if (!view) init();
    if (!view) return false;
    if (!opts.follow && !force) return false;
    /* ★★★ 2026-10-28：`force`（= 阶段切换 / 官方カメラリセット）时**把控制权收回来**。
       官方 カメラリセット 明确写了「自動カメラ移動許可 ← 1」，即一旦进入新阶段，
       自动取景重新生效。以前 manual 一旦变 true 就永久拦着 →
       用户点过地图选震源（或拖过一下）之后，整个 EEW 阶段相机一动不动
       （就是「你这摄像机假的吧，圈都出屏幕了，摄像机也不动」）。 */
    if (force) { manual = false; lastKey = ''; }
    /* ★★★ ZQuake：用户手动拨动/缩放过 → userCamLock=true → 自动镜头彻底让位。
       以前这里只在 force 时把 manual 清零、却【不检查 userCamLock】，
       ⇒ 用户拖动地图后，下一报（reset=force）照样把相机夺回包围盒中心，
       表现就是「滑了又自动飞回去」。现在 force 也要尊重 userCamLock：
       除非点右下角「自动操作地图」按钮重新打开（setAutoCam(true) → userCamLock=false），
       否则即使阶段切换也不抢相机。 */
    if (manual || userCamLock) return false;
    if (!b || !isFinite(b.n) || !isFinite(b.s) || !isFinite(b.e) || !isFinite(b.w)) return false;
    var latC = (b.n + b.s) / 2, lonC = (b.e + b.w) / 2;
    /* ★★★ 2026-10-28：以前这里 `if (!inAtlas(latC, lonC)) return false;` ——
       海外震源（西藏 / 瓦努阿图 …）直接**永远不取景**，k 卡在初始值不动。
       apply() 本身已按 mode 选投影（toAtlas / toAtlasW），clampT 也用世界框，
       tierFor 会自己选 outsvg/wlg → 海外完全可以走同一套取景。 */
    var cosLat = Math.max(0.2, Math.cos(latC * Math.PI / 180));
    var spanLat = Math.max(0.10, b.n - b.s);
    var spanLon = Math.max(0.10, (b.e - b.w) * cosLat);
    /* ★ 安全阀：包围盒偶尔会失控（加速模拟时波前铺得飞快 / 测站坐标异常），
       一路缩到 k=0.03（整个地球）。跨度封顶 60°，再大也没有意义。 */
    if (spanLat > 60) spanLat = 60;
    if (spanLon > 60) spanLon = 60;
    /* ★★★ 2026-10-28 官方反编译（地図::カメラ範囲決定）原文：
         倍率 = min( 2×(画面幅−(左+右)/2) ÷ ((x1−x2)+6)
                   , 2×(画面高−(上+下)/2) ÷ ((y1−y2)+6) )
       两个重点：
         ① 留白是「**+6 个地图单位**」（1 单位 = 0.1° ⇒ 0.6°），不是百分比
         ② 倍率按 min(宽, 高) 取，保证两个方向都装得下
       这里保留官方结构（同样 +6 单位、同样取 min），但分母用本项目的可视区尺寸
       （VIS.x0..x1 已经扣掉左侧信息栏），否则 1330 宽的假设会让画面被裁掉一半。 */
    var kX = (VIS.x1 - VIS.x0) / ((spanLon + 0.6) * T.A * 10);
    var kY = (VIS.y1 - VIS.y0) / ((spanLat + 0.6) * T.A * 10);
    var k = Math.min(kX, kY);
    k = clamp(k, K_MIN, K_MAX);
    /* ★★★ 官方按 地図表示モード 做倍率整形（原文数值照抄）：
         1(EEW页) 倍率 ×= 0.96 − 0.0035×倍率²（≥0.35），上限 6.5
         3(海啸)  倍率 ×= 0.8，上限 5.5
         2(详细栏) 上限 9.5（詳細拡大时 15）
       本项目 cam.k 与官方「倍率」的关系：官方 1 倍率 = 1px/0.1° = 100px/°，
       本项目 k 也是 100k px/° ⇒ **k == 倍率/10**，所以上限除以 10。 */
    var kOff = k * 10;
    var mode = curMapMode();
    if (mode === 1) {
      /* ★★★ 2026-10-25 实测：这段「EEW 页倍率整形」是个**硬地板**。
         我们要的 k≈1.85（关东一带）经过
           `_f = 0.96 - 0.0035*kOff²`（kOff=18.5 → -0.24，被夹到 0.35）
           `kOff *= 0.35 → 6.47`，再被 `>6.5 → 6.5` 封顶
         ⇒ 最后永远得到 k=0.65，**包围盒再紧也压不动**
           （用户连续两次说「还是太远」就是这个）。
         官方那段数值照抄时把「倍率」和本项目 cam.k 的换算搞错了 10 倍。
         现在只在**更宽**的方向上做保底（不允许比 k=0.65 更远），不阻止放大。 */
      if (kOff < 6.5) kOff = kOff;
      if (kOff > 6.5 && k < 0.65) kOff = 6.5;
    } else if (mode === 3) {
      kOff *= 0.8;
      if (kOff > 5.5) kOff = 5.5;
    } else {
      /* ★★★ 2026-11-03 用户：「调查中第二次填色块明明只是旁边多填了两个，
         结果缩放到了半个日本的比例尺」—— 真凶就是这里。
         官方这段「地図表示モード 2（詳細欄）」的整形是给**左侧小栏里的迷你地图**用的：
           倍率 ×= (1 − 0.01×(倍率−4.5))，并且 **上限 9.5**（k ≤ 0.95）。
         而本项目的「情报页」是**整屏地图**，调查中 / 震源速報 / 各地震度情報
         全都在这个页面上 → 自动取景一旦想要 k>0.95（放大到关东一带）就被硬顶回 0.95，
         于是「包围盒只大了一点点，画面却突然退到半个日本」（实测 3.34 → 0.95）。
         ⇒ 情报页不再套那段整形：和 EEW 页一样，直接用包围盒算出来的倍数，
           上限交给 K_MAX。这样 3.34 → 2.76 是平滑的一点点退，
           正式报色块铺满时才真的退到 0.5 左右。 */
    }
    k = clamp(kOff / 10, K_MIN, K_MAX);
    /* 中心补偿（官方：中心 = 范围中心 + (左−右)/2 ÷ 倍率）
       · 非横屏：VIS.x0 = 244 已经把左栏扣掉，可视区中心就是 VIS.cx → 无需再补
       · 横屏：VIS.x0 = 0（地图铺满、卡片浮在上面）→ 补半栏 */
    if (VIS.x0 < 1) {
      var _visW = Math.max(1, VIS.x1 - VIS.x0);
      var _degPerPx = spanDeg(k) / _visW;
      lonC -= (244 / 2) * _degPerPx;
    }
    /* ★★★ 官方应用闸门（原文照抄）：
         IF 強制 或 ( 10 < 100×|ln(旧倍率) − ln(新倍率)|
                          + 10×(√(Δx²+Δy²) ÷ 旧倍率) )  → 才真的动相机
       ⇒ 换算到本项目：|ln(k新/k旧)| > 0.1（约 10%）或 中心位移够远。
       以前这里用 0.6（那是官方另一处「候选档位比较」的阈值）→ k 要变 4 倍才肯动，
       实测直接锁死在 K_AUTO_MAX（用户：「摄像机假的吧，圈都出屏幕了也不动」）。 */
    var lat0 = camCenter()[0], lon0 = camCenter()[1];
    var dPanUnits = Math.sqrt(
      Math.pow((latC - lat0) * 10, 2) +
      Math.pow((lonC - lon0) * Math.cos(latC * Math.PI / 180) * 10, 2));
    var lgRatio = Math.abs(Math.log(Math.abs(k) / Math.max(1e-6, cam.k)));
    var score = 100 * lgRatio + 10 * (dPanUnits / Math.max(1e-6, cam.k));
    if (!force && score <= 10) return false;
    /* ★★★ 官方反缩放保护（原文）：
         IF 非強制 且 震度5弱以上の点数 = 0 且 最大震度 < 3 且 旧倍率×1.2 < 新倍率 → STOP
       ⇒ 还没有任何像样的震度数据时，不要把画面无意义地拉远。 */
    if (!force && b && b.lv5 === 0 && (b.maxShindo || 0) < 30 && k > cam.k * 1.2) return false;
    applyTier(tierFor(latC, lonC, k));
    apply(latC, lonC, k);
    return true;
  }

  /** 回归选中地震（= 官方画面适配按钮）；没有选中就回全日本 */
  function fit() {
    var q = lastQ;
    manual = false; lastKey = '';
    if (!hasLL(q)) {
      applyTier('jp'); apply(home.lat, home.lon, home.k); return;
    }
    var kk = inAtlas(q.lat, q.lon) ? zoomForMag(q.mag)
      : (inWlg(q.lat, q.lon) ? zoomForMagG(q.mag) : zoomForMagW(q.mag));
    applyTier(tierFor(q.lat, q.lon, kk));
    apply(q.lat, q.lon, kk);
  }
  /** 循环图层（「图层切换按钮」开启时，适配按钮改干这个） */
  function cycleTier() {
    var order = G ? ['jp', 'wlg', 'outsvg'] : ['jp', 'outsvg'];
    var i = order.indexOf(tier);
    var t2 = order[(i + 1) % order.length];
    var ll = camCenter();
    var span = spanDeg(cam.k);
    if (t2 === 'jp' && !inAtlas(ll[0], ll[1])) { ll = [home.lat, home.lon]; }
    applyTier(t2);
    apply(ll[0], ll[1], t2 === 'jp' ? Math.max(cam.k, 0.28) : cam.k, true);
  }

  /* ★★★ 2026-10-11（第十六轮）世界环绕：每个地图层在 x 方向克隆 ±1 份。
     1 个周期 = 3600 地图单位（= 360°）；在各层画布里的像素跨度：
       nb/nf（A=10px/单位）→ ±36000px；wlg（S=1）→ ±3600px；
       wld（S=0.8333）→ ±3000px；outsvg / allocean（A2=0.5）→ ±1800px。
     屏幕周期统一 = 36000×k → clampT 里把 tx 对周期取模即可【无限左右滚】，
     且跨越 180° 经线（白令海峡/汤加）不再断图。 */
  function addTiles(box, tiles, shiftPx, bleed) {
    var ds = shiftPx ? [-shiftPx, 0, shiftPx] : [0];
    var b = bleed || 0;
    if (b) box.dataset.bleed = b;
    for (var d = 0; d < ds.length; d++) {
      for (var i = 0; i < tiles.length; i++) {
        var t = tiles[i], im = new Image();
        im.src = t.src; im.draggable = false; im.dataset.tile = t.name;
        im.dataset.dx = ds[d];
        im.style.cssText = 'position:absolute;left:' + (t.x + ds[d] - b) + 'px;top:' + (t.y - b) +
          'px;width:' + (t.w + b * 2) + 'px;height:' + (t.h + b * 2) + 'px';
        box.appendChild(im);
      }
    }
  }

  function init() {
    if (view) return;
    stage = document.getElementById('stage');
    var host = document.getElementById('map');
    if (!host || !stage) return;
    host.innerHTML = '';
    view = document.createElement('div');
    view.id = 'mapview';
    /* 层次（z-index）全部交给 app.css：#mapocean 1 / #mapworld 2 / #mapview 3，
       且 #map 整体在 UI 层（#art/#zh/#txt）之下 —— 官方就是面板精灵盖住地図。
       ★ 官方 outsvg* 世界图把日本整块挖空了（实测 outsvg11 里东京/北海道/九州采样全透明），
         所以世界视图必须再把日本精细图叠回去；两张图同一投影同一比例尺，天然对齐。 */
    view.style.cssText = 'position:absolute;left:0;top:0;width:' + T.W + 'px;height:' + T.H +
      'px;transform-origin:0 0';
    /* ⚠️ 不要写 will-change:transform！nb 层和 outsvg 一样是超大图层（2596x2651），
       被提升成合成层后 Chrome 在很小缩放下会错误栅格化（整层不画）——
       世界档「日本消失」的真凶之一（2026-10-11 第十五轮）。 */
    addTiles(view, T.tiles, 36000);          /* nb：+±1 个世界周期 */
    host.appendChild(view);
    /* ★ 海洋轮廓层（allocean，官方世界模式的海底地形，不透明位图）
       官方画在 outsvg 陆地【下面】、100l 全屏海色填充【上面】 */
    if (W && W.ocean) {
      oview = document.createElement('div');
      oview.id = 'mapocean';
      /* ⚠️ 不要写 will-change:transform —— 海底层是 2x1800x1800（世界档 x1.2 达 4320x2160），
         被提升成超大合成层后 Chrome 会错误栅格化：缩到世界档时【陆地整块不画、只剩海面】，
         看起来就像「世界地图只有日本/一片海」。去掉 will-change 后正常。 */
      oview.style.cssText = 'position:absolute;left:0;top:0;width:' + W.W + 'px;height:' + W.H +
        'px;transform-origin:0 0;display:none';
      addTiles(oview, W.ocean, 1800);
      host.appendChild(oview);
    }
    /* ★ 世界地图层：与日本图同一坐标系，只是图集比例换成 A2 */
    if (W) {
      wview = document.createElement('div');
      wview.id = 'mapworld';
      /* ⚠️ 同海底层：超大合成层栅格化不可靠 → 不写 will-change */
      wview.style.cssText = 'position:absolute;left:0;top:0;width:' + W.W + 'px;height:' + W.H +
        'px;transform-origin:0 0;display:none';
      addTiles(wview, W.tiles, 1800);
      host.appendChild(wview);
    }
    /* ★ 海岸线层（官方 nf*）：与 nb 同摆位、【任何模式都显示】
       官方「地図スタンプ:new」不是「塗りつぶし」的那一支里：先 nb 再 nf，无条件画。 */
    if (C && C.tiles && C.tiles.length) {
      cview = document.createElement('div');
      cview.id = 'mapcoast';
      cview.style.cssText = 'position:absolute;left:0;top:0;width:' + T.W + 'px;height:' + T.H +
        'px;transform-origin:0 0';
      addTiles(cview, C.tiles, 36000);       /* nf */
      host.appendChild(cview);
    }
    /* ★ 世界图（官方「広域モード」常用档）：wlg00..wlg11，**自带日本**
       —— 解决「日本周边那圈地格格不入 / 海岸线风格不统一」的正解：
          官方在这一档压根不用 outsvg+nb 硬拼，而是用 wlg 这张广域图（日本就是普通陆地）。 */
    if (G && G.tiles && G.tiles.length) {
      gview = document.createElement('div');
      gview.id = 'mapwlg';
      /* ⚠️ 不写 will-change：本层现在用【布局缩放】重栅格化（见 reRaster），
         will-change 会把旧栅格缓存住导致放大发虚。 */
      gview.style.cssText = 'position:absolute;left:0;top:0;width:' + G.W + 'px;height:' + G.H +
        'px;transform-origin:0 0;display:none';
      addTiles(gview, G.tiles, 3600, 6);        /* wlg（+6px 出血盖住素材间发丝缝） */
      host.appendChild(gview);
    }
    /* ★★ 海底地形层（官方 wld00..wld12，近景/广域档）：垫在陆地层下面、alloocean 上面。
       官方同一分支：wld（海）+ wlg（陆）；「極度縮小」档才换成 allocean + outsvg。 */
    if (D && D.tiles && D.tiles.length) {
      dview = document.createElement('div');
      dview.id = 'mapsea';
      dview.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px;' +
        'transform-origin:0 0;display:none';
      addTiles(dview, D.tiles, 4320, 6);        /* wld（官方缩放 0.8333px/单位 → 周期 4320 画布px） */
      host.appendChild(dview);
    }
    /* ★★★ 2026-10-21 波圈层重做：**单个 canvas**（官方本来就是 pen 层 = 一整块画布）
       用户：「这卡得要命，把圆的动画搞成官方同款、60 帧丝滑」
       以前的写法 = 2 个 SVG + N 个 div（每个都是独立合成层，还要跟地图做 CSS 混合）
       + setInterval 250ms（每秒只动 4 次）→ 又跳又卡。
       现在 = 1 个 canvas 图层，rAF 每帧只画十几条圆弧（<1ms），
       bitmap 按「舞台缩放 K × devicePixelRatio」1:1 对齐屏幕，放大也不发虚。
       反编译依据（`地図` 脚本 bqM `円描画`）：
         · ps=0 → 外圈：半径 = P 波震央距離，细线、浅青 #baecef
         · ps=1 → 内圈：半径 = S 波震央距離，半透明填充 + 2.2× 粗描边
         · 颜色 = 官方 5 档波圈色（#34a7ef / #62ef34 / #fde700 / #ff5033 / #ed68ff）
         · 半径走官方 `JMA2001走時表`，不是固定速度 */
    wavehost = document.createElement('canvas');
    wavehost.id = 'mapwaves';
    /* ★★★ 2026-10-27 用户：「EEW 的 P 波 / S 波图层优先级小于测站，导致体验不佳」
       —— 以前 wavehost 是 z=8 且**先 append**，测站层也是 z=8 但后 append（DOM 顺序在后）
          → 波圈被测站圆标压住，S 波那条半透明填充带被一排排测站挡掉。
       ⇒ 波圈抬到 z=9：压在测站(8)/范围框(8) 之上，仍在震中标记(10) 之下。
         検出円层 dethost 也是 9 但后 append → 検出円仍然盖在波圈上面。 */
    wavehost.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:9';
    host.appendChild(wavehost);
    waveCtx = wavehost.getContext('2d');
    /* ★★★ 2026-10-27 官方「検出円」层（独立 div，z=9）
       —— 用官方 SVG 素材直接帖图（200px 平涂实心圆），不自己画渐变。 */
    dethost = document.createElement('div');
    dethost.id = 'mapdetcircle';
    dethost.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:9';
    host.appendChild(dethost);
    /* ★★★ 2026-10-20 用户：「我说的是这个白的」——那个 52×52 的白色检测方框不要了。
       我原来照「三段式动画第①段」加的 `#mapwavebox` 已从 DOM 里彻底删除（不是只隐藏）。
       官方现在只有：官方区域多边形（nc*）+ 观测点造型，没有任何自绘白框。 */
    /* ★★ 2026-10-21 用户（截图）：「右下角的这个消失了」= 官方「地図の色」震度色图例
       官方造型 UI/hnr1..hnr9 / hnr5e / hnre（90×260，每档一条）；
       已把素材拉到 assets/hnr*.svg，这里就按最大震度选一条贴在地图右下角。
       · 位置固定屏幕右下（不随相机缩放）
       · 没地震时隐藏 */
    legendEl = document.createElement('img');
    legendEl.id = 'maplegend';
    legendEl.draggable = false;
    legendEl.style.cssText = 'position:absolute;right:10px;bottom:10px;width:90px;height:260px;' +
      'pointer-events:none;display:none;z-index:9';
    host.appendChild(legendEl);
    /* 测站层：压在波圈上面、但在「揺れを検出」范围框(boxhost, 同样 z=8 但后 append)下面
       ★ 2026-10-25 用户：「测站的优先级图层好像大的离谱，地图正式报填色看不见数字提示标，
         就连检测摇晃的那个长方框也被测站覆盖住了」
       ⇒ 原来 z-index:9 > 框层 8 → 框全被测站盖住。降到 8，靠 DOM 顺序压在最上面一层的下面：
         wavehost(8,先) 、stationHost(8,中) 、boxhost(8,后) → 框在最上；
         同时仍高于地图色块层（#mapoverlay z=7 内的 areas/points）。
       ⚠️ 这层仍然要在波圈之上，否则 S 波填色圆一盖，点就看不见了。 */
    stationHost = document.createElement('div');
    stationHost.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:8';
    stationHost.id = 'mapstations';   /* ★ 天体模式靠这个 id 把地球测站整层藏掉 */
    host.appendChild(stationHost);
    /* ★「揺れを検出」范围框层：在震度色块之上、观测点之下（z-index 8） */
    boxhost = document.createElement('div');
    boxhost.id = 'mapboxes';
    boxhost.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:8';
    host.appendChild(boxhost);
    boxEls = [];
    /* ★★ 我们自己的叠加层（震度色块 / 观测点）：
       与日本图集同一坐标系 → 尺寸、transform 都跟 #mapview 一套，
       但**独立存在**，不会因为「关掉官方地图」而连坐消失。 */
    ovlay = document.getElementById('mapoverlay');
    if (!ovlay) {
      ovlay = document.createElement('div');
      ovlay.id = 'mapoverlay';
      ovlay.style.cssText = 'position:absolute;left:0;top:0;width:' + T.W + 'px;height:' + T.H +
        'px;transform-origin:0 0;pointer-events:none';
    }
    host.appendChild(ovlay);      /* ★ 已存在则只是搬到新 host：不新建 = 里面的震度层不会变孤儿 */
    /* 震中标记层（不跟着图集缩放 → 屏幕尺寸恒定，也不会被图层隐藏连坐）*/
    pinhost = document.createElement('div');    pinhost.id = 'mappins';
    /* z-index:9 —— 必须在「界线层」(maptilesline, z8) 和震度层之上，官方也是标记盖在最上面 */
    pinhost.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:10';
    host.appendChild(pinhost);
    ['normal', 'eew', 'eewFinal'].forEach(function (kind) {
      var im = new Image();
      im.src = PINS[kind].src;
      im.draggable = false;
      im.dataset.pin = kind;
      im.style.cssText = 'position:absolute;left:0;top:0;display:none;pointer-events:none;opacity:' + PINS[kind].op;
      pinhost.appendChild(im);
      pinEls.push({ el: im, a: null, ll: null, px: PINS[kind].px, baseOp: PINS[kind].op });
    });
    /* ★★ 2026-10-10 用户要求：点地图上的【震中标记】才把相机移过去。
       官方也是这个行为（它另有一个「回到选中地震」按钮 = 默认不会自己跑过去）。
       用户原话：「相机不会默认就已经反应完…我是要在那个鼠标那点它那个地图
                表示的那个提示，摄像机它就会自己移动到那个地震中心那里」。
       ⚠ 标记本身 pointer-events:none，所以这里在【地图层】上做命中测试 ——
         这样拖地图不会被标记挡住（标记直径不小，直接给它 pointer-events
         会导致那块区域拖不动）。 */
    /* ★ 2026-10-10 移除「点地图红叉 → 选中 + 移相机」：
       官方入口是 hover 履历行弹出的「地図に表示」药丸，不是点红叉。
       而且用户明确说「为什么我没点击就叉就过去了」——多点入口只会互相打架。
       药丸 → hovpill.js → QVMapCam.focus() + lockPin()。 */
    apply(home.lat, home.lon, home.k, true);
    paintBoxes();                    /* 图层重建后把已有的范围框补画回来 */
    if (oview && !ownMap) oview.style.display = '';   /* 海底层：所有档位都画 */
    /* ★ 自建瓦片层（kondz-map）：默认关，由 QVTiles.setEnabled / QVMapCam.setOwnMap 打开 */
    if (global.QVTiles) global.QVTiles.init(host);
    /* ★ 天体底图层（月球/火星）：默认隐藏，切到行星模式才显示 */
    if (global.QVPlanet) global.QVPlanet.init(host);
    enableControls();
    /* ★★★ 2026-10-21 用户：「这圆的动画要官方同款、60 帧丝滑」
       以前这里是 setInterval(tickWaves, 250) = 每秒只动 4 次 → 圆一圈一圈地「跳」。
       现在改成 requestAnimationFrame 驱动（每帧只写 transform / opacity，纯合成层，
       不碰布局），测站那 276 个 <img> 仍按 250ms 节流，别跟着 60fps 写。 */
    startWaveLoop();
  }

  /* ★★ 「地図に表示」锁定：药丸点过之后，红叉就钉在那场地震上，
     不让 render3 每帧的 setPins 把红叉拉回「当前选中项」。 
     传 null 解锁（取消按钮 / 切视图时用）。 */
  var pinLock = null;
  function lockPin(list) { pinLock = (list && list.length) ? list : null; }
  /** ★★★ 2026-10-29：`isFinite(null) === true` —— 报文里坐标缺失时是 null（不是 NaN），
   *  以前的 `isFinite(p.lat)` 会把「震源未定」的速报当成 (0,0) → 红叉/波圆画到几内亚湾。 */
  function hasLL(q) {
    if (!q) return false;
    var a = q.lat, o = q.lon;
    if (a == null || o == null || a === '' || o === '') return false;
    a = +a; o = +o;
    return isFinite(a) && isFinite(o) && Math.abs(a) <= 90 && Math.abs(o) <= 180;
  }

  /** 震中标记：list = [{lat,lon,kind:'eew'|'normal'}]，空则全部隐藏 */
  function setPins(list) {
    if (!view) init();
    if (!pinEls.length) return;
    if (pinLock) list = pinLock;            /* ★ 锁定期间由药丸说了算 */
    /* ★★★ 2026-10-20 用户（图一）：「出现这个方框的时候，不应该有红叉和 P/S 波圆，
       这只是表示这一个区域出现了摇晃」。→ 检测态（setDetectMode(true)）一律不画红叉，
       没红叉就没 waveSrc，tickWaves 自然也不会画圆。 */
    if (pinsOff) list = [];
    var map = {};
    (list || []).forEach(function (p) {
      if (!hasLL(p)) return;
      if (!map[p.kind]) map[p.kind] = [+p.lat, +p.lon];
    });
    for (var i = 0; i < pinEls.length; i++) {
      var kind = pinEls[i].el.dataset.pin;
      /* ★ 只记【经纬度】，图集坐标交给 paint() 每帧现算（模式 a 依赖 mode，见那里的说明） */
      pinEls[i].ll = map[kind] || null;
    }
    /* ★ P/S 波圆：以普通/速报震中为圆心（优先速报）
       ★★★ 2026-10-27：额外带上【発生時刻 / 深度 / 震度】。
       以前这里只有经纬度 → tickWaves 只能退回 `lastQ.timeMs`（= 当前选中的那条地震，
       真实 EEW 时往往还是上一条），于是波圆要么拿错起始时刻、要么直接超时消失。
       真实 EEW 由 views.js 的 setEEW 把电文里的 timeMs/depthKm 一起传进来。 */
    var org = map.eew || map.normal || null;
    var orgP = null;
    (list || []).forEach(function (p) {
      if (orgP || !p) return;
      if (p.kind === (map.eew ? 'eew' : 'normal')) orgP = p;
    });
    waveSrc = org ? {
      lat: org[0], lon: org[1],
      t0: (orgP && +orgP.t0) || 0,
      depth: (orgP && isFinite(orgP.depth)) ? +orgP.depth : null,
      lv: (orgP && orgP.lv != null && orgP.lv >= 0) ? +orgP.lv : -1
    } : null;
    if (!waveSrc && !simWave) { hideWaves(); }
    paint();
    tickWaves();
  }

  /* ★★ 模拟地震：独立的一条波圆来源（不要求打开设置里的 P/S 波圆） */
  var simWave = null;
  /** ① 检测方框的时长（ms）—— 官方「方框→小圆→带出红叉→扩散」的第一段 */
  var BOX_MS = 900;
  function hideWaves() {
    clearWaves();
  }
  /** ★ 涟漪：一圈接一圈从震央弹出去，老的（内圈）淡到 0 就回收
   *  RIP_INT  = 每隔多少秒弹一个新的
   *  RIP_LIFE = 单个环活多久（同时也是「内圈消失」的时长）
   *  ★ 半径 = 当前 S 波前 − 该环出生时的那一圈 ⇒ 环始终尾随真实波前向外跑，
   *    而不是自己按年龄算（那样会全部挤在震央几十像素内，看不出「一波波」）。 */
  /** ★★★ 2026-10-21 用户澄清（听写原话）：
   *   「它消失不是叠来叠去的，它是过了一殷时间之后没什么震感，中心点没什么震感，
   *    又过了一会之后，它中心点就会从黄色慢慢渐隐到地图原本的颜色就会消失，
   *    再画一个圆的，再慢慢渐隐出去」
   *   ⇒ 不是多环叠加，而是**一个实心圆盘**：
   *     ① 以震央为中心画一个按震度上色的实心盘（震度 4 = 黄）
   *     ② 中间先没震感 → 盘子的**内圈先变透明**，空洞由内向外扩大
   *     ③ 整盘褪干净（回到地图本身颜色）后，再画一个新盘、再褪一次
   *   canvas 的 radial-gradient 就是干这个的：中间 alpha=0 的空洞半径 = 本轮进度。 */
  var DISC_ALPHA = 0.20;      /* ★ 回到「改之前那个圆」：压暗的震度色 + 0.20 填充 */
  /** '#rrggbb' → 'r,g,b' */
  function hexRgb(hex) {
    var n = parseInt(String(hex).replace('#', ''), 16);
    if (!isFinite(n)) n = 0x34a7ef;
    return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
  }
  /** ★★★ 2026-10-25 用户定案（听写）：
   *   「这个不是跑出视图的问题…消失的动画是对应地震的能量开始慢慢从中心开始闲散的意思」
   *   ⇒ 不能靠「跑出视口」来淡出，也不能叠一堆环。
   *      正确做法：实心盘用 radial-gradient，**中心先透明**、
   *      透明洞 由内向外扩大 ⇒ 地面对应的是「这里已经不晃了」，
   *      波前一真跑出去、盘子全空，就自然没了。
   *   rOut = 外边界（S 波前）；rIn = 内边界（«缓和前»的波前 = 能量已经散掉的那一圈）
   *   a    = 这一轮的基础不透明度 */
  function drawFadeDisc(ctx, p, rOut, rIn, col, a) {
    if (!(rOut > 2) || !(a > 0.004)) return;
    var n = parseInt(String(col).replace('#', ''), 16);
    if (!isFinite(n)) n = 0x34a7ef;
    var cr = Math.round(((n >> 16) & 255) * 0.58);
    var cg = Math.round(((n >> 8) & 255) * 0.58);
    var cb = Math.round((n & 255) * 0.58);
    /* ★★★ 2026-10-25 修正：以前这里写死 `addColorStop(0, rgba(...,0))`
       → 不管 rIn 是多少，**第一帧就把中心挖空了**
       （用户：「你刚刚开始就消失了？」）。
       现在中心 alpha 由「空洞占比 hole」决定：
         hole = 0   （波还没走出 ringSec 秒）→ 中心 = 满亮，整盘实心
         hole = 0.8 → 中心彻底透明（能量散光）
       hole 就是 rIn/rOut，而 rIn = S 波前(sec - ringSec) → 波越往外，空洞越大。 */
    var hole = Math.max(0, Math.min(1, rIn / rOut));
    var a0 = a * Math.max(0, 1 - hole * 1.25);
    var r0 = Math.max(0, Math.min(rIn, rOut - 1));
    var g = ctx.createRadialGradient(p[0], p[1], r0, p[0], p[1], rOut);
    g.addColorStop(0, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + a0.toFixed(3) + ')');
    g.addColorStop(0.45, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (Math.max(a0, a * 0.9)).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + a.toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p[0], p[1], rOut, 0, 6.2831853);
    ctx.fill();
  }
  /** canvas 尺寸对齐舞台：bitmap = 逻辑尺寸 × 舞台缩放 K × DPR，1 物理像素 = 1 屏幕像素 */
  function syncWaveCanvas() {
    if (!wavehost || !waveCtx || !stage) return null;
    var W = stage.offsetWidth || 960, H = stage.offsetHeight || 720;
    var K = stageK() * Math.min(2, global.devicePixelRatio || 1);
    var pw = Math.max(1, Math.round(W * K)), ph = Math.max(1, Math.round(H * K));
    if (wavehost.width !== pw || wavehost.height !== ph) {
      wavehost.width = pw; wavehost.height = ph;
      wavehost.style.width = W + 'px';
      wavehost.style.height = H + 'px';
    }
    waveCtx.setTransform(K, 0, 0, K, 0, 0);
    return waveCtx;
  }
  /** 清掉波圈（canvas 复位）——只有上一帧真的画过东西才清，避免空跑全屏 clear */
  var waveDirty = false;
  function clearWaves() {
    if (!waveCtx || !wavehost || !waveDirty) return;
    waveCtx.setTransform(1, 0, 0, 1, 0, 0);
    waveCtx.clearRect(0, 0, wavehost.width, wavehost.height);
    waveDirty = false;
  }
  /** 画一个圆环：r 是逻辑像素，sw 是【屏幕】像素线宽 */
  function strokeRing(ctx, K, x, y, r, sw, color, alpha) {
    if (!(r > 0.5)) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.3, sw / K);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.2831853);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  /** 地图右下角「地図の色」震度图例（官方 hnr 造型）
   *  ★ 2026-10-21 实测官方每个造型的内容（每个 90×260，内容底对齐）：
   *      hnr1 = 震度1
   *      hnr2 = 震度2/1        hnr3 = 3/2/1       hnr4 = 4/3/2/1
   *      hnr5 = 5弱/4/3/2/1    hnr5e = 5弱…（同 hnr5，配色略异）
   *      hnr6 = 警报版：顶行「警報発表」+ 震度4/3/2/1  ← EEW 警报阶段专用（顶行不写震度）
   *      hnr7 = 5強/5弱/4/3/2/1
   *      hnr8 = 6弱/5強/5弱/4/3/2/1
   *      hnr9 = 6強/6弱/5強/5弱/4/3/2/1
   *   震度 7 没有单独造型 → 沿用 hnr9。传 null / 烈度时隐藏。 */
  var HNR_OF = { 1: '1', 2: '2', 3: '3', 4: '4', 50: '5', 55: '5e', 60: '7', 65: '8', 70: '9' };
  function setLegend(code, metric, warn) {
    if (!legendEl) return;
    if (code == null || metric === 'liedu') { legendEl.style.display = 'none'; return; }
    /* 警戒（警报）阶段：官方用 hnr6 —— 顶行是红色的「警報発表」 */
    var k = warn ? '6' : HNR_OF[+code];
    if (!k) { legendEl.style.display = 'none'; return; }
    var src = 'assets/hnr' + k + '.svg?v=' + LEGEND_V;
    if (legendEl.getAttribute('src') !== src) legendEl.setAttribute('src', src);
    legendEl.style.display = '';
  }
  /** 模拟时红叉的「带出」透明度：浅源直接 1，深源随小圆长大再淡入 */
  function setEewPinAlpha(a) {
    a = a == null ? 1 : Math.max(0, Math.min(1, a));
    for (var i = 0; i < pinEls.length; i++) {
      var p = pinEls[i];
      if (p.el.dataset.pin !== 'eew') continue;
      p.el.style.opacity = ((p.baseOp == null ? 1 : p.baseOp) * a).toFixed(2);
    }
  }
  /** 官方填充色 = 波圈色再压暗 40%（Scratch brightness -40） */
  function darken(hex, f) {
    var n = parseInt(String(hex).replace('#', ''), 16);
    if (!isFinite(n)) return hex;
    var r = Math.round(((n >> 16) & 255) * f),
      g = Math.round(((n >> 8) & 255) * f),
      b = Math.round((n & 255) * f);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  /** 震度 → 官方波圈颜色（反编译 EEW/检出圆用的 5 档 pen.color） */
  function waveColor(lv) {
    lv = +lv;
    if (!isFinite(lv) || lv < 0) lv = 0;
    if (lv === 7 || lv >= 60) return '#ed68ff';      /* 6弱/6强/7 */
    if (lv >= 5) return '#ff5033';                   /* 5弱/5强（50/55/5） */
    if (lv >= 4) return '#fde700';                   /* 4 */
    if (lv >= 3) return '#62ef34';                   /* 3 */
    return '#34a7ef';                                /* 0..2 */
  }
  /** ★ 官方 `JMA2001距離近似`：经过秒数 + 深度 → 震央距离(km)
   *  反编译（受信と検出 aFc）：
   *    走時距離 = Σ_{i=1..6} t^i * 表[i + round(深さ/10)*6 + 426*(S波)]
   *    震央距離 = 走時距離 * sin(acos(深さ / 走時距離))
   *  ⚠ 表只在 0~数百秒内有意义，调用方要限时。 */
  function jma2001Dist(sec, depthKm, pWave) {
    var tab = global.QV_JMA2001;
    if (!tab || !(sec > 0)) return 0;
    var dep = Math.max(0, +depthKm || 0);
    var band = Math.round(dep / 10);
    if (band < 0) band = 0;
    if (band > 70) band = 70;
    var base = (pWave ? 0 : 426) + band * 6;
    var d = 0, p = 1;
    for (var i = 0; i < 6; i++) {
      p *= sec;
      d += p * (tab[base + i] || 0);
    }
    if (!(d > dep)) return 0;
    return d * Math.sin(Math.acos(Math.min(1, dep / d)));
  }
  /** 经纬度 → 屏幕坐标（与 paint() 里震中标记完全同一套公式） */
  function llToScreen(lat, lon) {
    var pxu = T.A * cam.k;
    var ux = mapXOf(lon), uy = mapYOf(lat);
    var bx = cam.tx + pxu * (ux - T.MINX);
    var period = pxu * 3600;
    if (period > 1) bx += Math.round((VIS.cx - bx) / period) * period;
    return [bx, cam.ty + pxu * (T.MAXY - uy)];
  }
  /** 每帧更新 P/S 波圆（模拟优先；否则看设置开关 + 当前选中地震） */
  /* ★ 60fps 驱动（2026-10-21）
       · waveLoop  每帧跑 tickWaves（只写 transform/opacity，合成层，不重排）
       · bumpStations 把测站那部分（276 个 img 的 src/transform）压到 250ms 一次
       · 没有波源时 tickWaves 会立刻 return，rAF 基本不花钱 */
  var waveRAF = 0, waveLastTs = 0, stLastTs = 0;
  function waveLoop(ts) {
    waveRAF = requestAnimationFrame(waveLoop);
    waveLastTs = ts;
    if (waveCtx) tickWaves();
    drawDetCircle();      /* ★ 2026-10-27「検出円」与波圈同一条 rAF，互不阻塞 */
  }
  /* ══════════════════════════════════════════════════════════════
     ★★★ 2026-10-27 官方「検出円」（揺れを検出 / 緊急地震速報 阶段按档位弹）
     ⚠️ 用户澄清（重要，别再搞错）：
       「这个圆就是一个 0.5-1.2 秒的地图测站提示，并且是固定大小的，
         并不是 EEW 阶段出来前的 P/S 波替代品」
     ⇒ 它**不是**跟着波前长大的大圆，也**不是**画在震央上的：
       · 位置 = 触发该档位的测站（地图上的点）
       · 大小 = 屏幕固定（不随缩放/时间变化）
       · 寿命 = 0.5~1.2 秒，然后淡出消失
       · 颜色 = 官方素材 costumes `地図/検出円0..3` 的填色（不自己调色）：
           検出円0 #ffde00 黄（震度1~3）· 検出円1 #ff6f00 橙（震度4）
           検出円2 #ff0000 红（5弱~）  · 検出円3 #ff00a1 紫（6弱~）
     ══════════════════════════════════════════════════════════════ */
  var dethost = null, detPulses = [], detImgPool = [];
  /* ★ 官方素材原文件（costumes 里的 `地図/検出円0..3`，200×200 的**平涂实心圆**）
     —— 不要再自己画渐变/描边！用户：「这个圆都不是官方素材，或者太炫酷了」 */
  var DET_CIRCLE_SRC = [
    'assets/a712da8b5f952d1928d85af0b6db6f16.svg',   /* 検出円0 黄 #ffde00 震度1~3 */
    'assets/280ae2cd232c0d80fcd622e196b28ea1.svg',   /* 検出円1 橙 #ff6f00 震度4   */
    'assets/892e216fdded60cc6e84cd8851dadc28.svg',   /* 検出円2 红 #ff0000 5弱~   */
    'assets/544ec3951508cff7168138fff38364ed.svg'    /* 検出円3 紫 #ff00a1 6弱~   */
  ];
  /* set size to (30 * …)：200px 造型 30% = 60 星形单位；星形舞台 480×360 →
     我们的逻辑画布 960×720（2 倍）⇒ 直径 120 逻辑 px */
  var DET_PULSE_PX = 120;
  /* 官方寿命：GHOST = 40 + 80 × 经过秒数 → 100 全透 ⇒ 0.75 秒 */
  var DET_PULSE_LIFE = 750;
  /** 震度码（0/1/2/3/4/50/55/60/65/70）→ 官方四色档 0..3 */
  function detCircleIdx(lv) {
    var v = +lv || 0;
    if (v >= 60) return 3;     /* 6弱以上 → 紫 */
    if (v >= 50) return 2;     /* 5弱以上 → 红 */
    if (v >= 4) return 1;      /* 震度4   → 橙 */
    return 0;                  /* 震度1~3 → 黄 */
  }
  /** views 在「测站震度上昇」时调用：{ lat, lon, lv(震度码), lifeMs } */
  function detPulse(o) {
    if (!o || !isFinite(o.lat) || !isFinite(o.lon)) return;
    var life = Math.max(300, Math.min(1500, +o.lifeMs || DET_PULSE_LIFE));
    detPulses.push({ lat: +o.lat, lon: +o.lon, ci: detCircleIdx(o.lv),
      t0: Date.now(), life: life, el: null });
    while (detPulses.length > 12) {
      var old = detPulses.shift();
      if (old && old.el) { old.el.style.display = 'none'; detImgPool.push(old.el); }
    }
  }
  function clearDetPulse() {
    for (var i = 0; i < detPulses.length; i++) {
      var d = detPulses[i];
      if (d && d.el) { d.el.style.display = 'none'; detImgPool.push(d.el); }
    }
    detPulses.length = 0;
  }
  /** 每帧：官方素材直接贴图（不重绘），GHOST 40→100 = 不透明度 0.6 → 0 */
  function drawDetCircle() {
    if (!dethost || !detPulses.length) return;
    var now = Date.now(), i, d;
    for (i = detPulses.length - 1; i >= 0; i--) {
      d = detPulses[i];
      if ((now - d.t0) / d.life >= 1) {
        if (d.el) { d.el.style.display = 'none'; detImgPool.push(d.el); }
        detPulses.splice(i, 1);
      }
    }
    var half = DET_PULSE_PX / 2;
    for (i = 0; i < detPulses.length; i++) {
      d = detPulses[i];
      var k = (now - d.t0) / d.life;
      if (k < 0) k = 0;
      if (!d.el) {
        var el = detImgPool.pop();
        if (!el) {
          el = document.createElement('img');
          el.draggable = false;
          el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
          dethost.appendChild(el);
        }
        el.src = DET_CIRCLE_SRC[d.ci];
        el.style.width = DET_PULSE_PX + 'px';
        el.style.height = DET_PULSE_PX + 'px';
        el.style.display = '';
        d.el = el;
      }
      var p = llToScreen(d.lat, d.lon);
      d.el.style.transform = 'translate(' + (p[0] - half).toFixed(1) + 'px,' +
        (p[1] - half).toFixed(1) + 'px)';
      d.el.style.opacity = (0.6 * (1 - k)).toFixed(3);
    }
  }
  function startWaveLoop() {
    if (!waveRAF) waveRAF = requestAnimationFrame(waveLoop);
  }
  function bumpStations() {
    var t = Date.now();
    if (t - stLastTs < 240) return;
    stLastTs = t;
    tickStations();
  }
  /* ★★★ ZQuake：波前持续外扩时，地图**同时慢慢放大**（自动镜头）。
     · 震中为中心，约 +3.7%/秒缓慢放大，最多到初始的 3.5 倍
     · 用户手动拨动/缩放过 → userCamLock → 自动镜头彻底让位
     · 只有点右下角「自动操作地图」按钮才重新打开 */
  var autoK0 = 0, autoK = 0, autoT0 = 0;
  function autoCamFollow() {
    if (userCamLock) { autoK0 = 0; autoK = 0; autoT0 = 0; return; }
    if (!simWave || !isFinite(simWave.lat) || !isFinite(simWave.lon)) { autoK0 = 0; autoK = 0; autoT0 = 0; return; }
    if (!autoK0) { autoK0 = cam.k; autoK = cam.k; autoT0 = Date.now(); }
    /* ★ 按【经过时间】算，而不是每帧累乘 → 与帧率无关（高刷/无头都不会失控） */
    var el = (Date.now() - autoT0) / 1000;
    var want = autoK0 * Math.min(2.2, 1 + 0.010 * el);
    if (Math.abs(want - autoK) < autoK * 0.0004) return;
    autoK = want;
    try { apply(simWave.lat, simWave.lon, autoK, true); } catch (e) { }
  }
  function tickWaves() {
    if (!waveCtx) return;
    /* ★ 2026-10-27 调试面板「暂停」：波前/测站点全部冻住 */
    if (global.__SIM_PAUSE) return;
    var src = null, t0 = 0, level = -1, depth = 10, autoFit = false;
    if (simWave) {
      src = simWave; t0 = simWave.t0 || 0; level = simWave.level;
      depth = simWave.depth; autoFit = simWave.autoFit;
    } else {
      var on = global.QVViews && global.QVViews.psWave ? global.QVViews.psWave() : false;
      if (!on || !waveSrc) { hideWaves(); return; }
      /* ★ 2026-10-27：优先用「钉住的红叉」自带的发生时刻/深度（真实 EEW 走这条），
         没有才退回当前选中地震（点历史/浮标时的老行为）。 */
      src = waveSrc;
      t0 = (+waveSrc.t0) || (lastQ && lastQ.timeMs) || 0;
      if (!t0) { hideWaves(); return; }
      level = (waveSrc.lv != null && waveSrc.lv >= 0) ? waveSrc.lv
        : (lastQ ? (lastQ.maxShindo >= 0 ? lastQ.maxShindo : lastQ.shindo) : -1);
      depth = (waveSrc.depth != null && isFinite(waveSrc.depth)) ? waveSrc.depth
        : (lastQ ? lastQ.depthKm : 10);
    }
    if (!t0 || !src || !isFinite(src.lat) || !isFinite(src.lon)) { hideWaves(); return; }
    /* ★ 2026-11-03 天体模式加速：火星一场主震真实要 4~5 小时，实时播根本看不了。
       ⚠️ 只读 simWave.speed 是**假的** —— fireSim() 发的 simWave 根本没带这个字段，
          所以行星模式下要直接回落到 QVPlanet.speed() 的全局倍率。 */
    var spd = (simWave && +simWave.speed > 0) ? +simWave.speed
      : ((global.QVPlanet && global.QVPlanet.speed) ? +global.QVPlanet.speed() || 1 : 1);
    var sec = Math.max(0, (Date.now() - t0) / 1000) * spd;
    /* ★ 模拟专用：正式报发布后冻结波前（freezeSec 一旦设定，半径不再增长） */
    if (simWave && simWave.freezeSec != null && sec > simWave.freezeSec) sec = simWave.freezeSec;
    /* ★★★ 2026-10-28 区域走时修正（方案 B，数值见 js/travel-region.js）
       —— 测站的 tp/tv（views.statTp/statTv）乘了区域系数 k，
          这里波圈必须用**同一个 k**，否则圈和测站又会错位。
       定义：t_region = k × t_JMA2001 → 反解半径就是 jma2001Dist(sec / k)。
       因为 k 本身随距离变，用「上一帧半径」当初值迭代一次就够（k 变化很缓）。
       ⚠️ 日本/海外 k=1，走原公式，一个字节不变。 */
    var _kf = (global.QVTravelK && global.QVTravelK.factor) || null;
    function waveKmAt(t, isP) {
      var d0 = jma2001Dist(t, depth, isP);
      if (!_kf || !(d0 > 0)) return d0;
      var k = +_kf(src.lat, src.lon, d0, isP) || 1;
      if (Math.abs(k - 1) < 1e-4) return d0;
      return jma2001Dist(t / k, depth, isP);
    }
    /* ★★★ 2026-10-28 用户（定稿）：
       「加载动画就加载动画，为什么 P 波不见了？P 波那个动画本来就好好的是那样子。
         而且这个圆环的**样式和粗细本来就和你那个 S 波的圆一样**，我只是给你看运行效果。」
       ⇒ 深源只做两件事：
         ① 照常画 P/S 波圈（**一个字都不改**）
         ② S 波还没到时，额外叠一个「等待 S 波」的圆弧：
            样式/粗细/颜色全部套用 S 波圆那一套（col + Math.min(7, 1.4+r*0.008)），
            只是一开始没闭合，闭合 = S 波到达。
       ⚠️ 这里**不 return**，只算两个标记，最后统一画。 */
    var _deepWait = 0, _deepProg = 0;
    if (simWave && simWave.deep) {
      setEewPinAlpha(1);
      if (simWave.sSec == null) {
        var _sv = 0;
        for (var _t = 1; _t <= 600; _t++) {
          if (jma2001Dist(_t, depth, false) > 0.5) { _sv = _t; break; }
        }
        simWave.sSec = _sv;
        simWave.sec0 = sec;
        simWave.waitAt = Date.now();
      }
      if (simWave.sSec > 0 && sec < simWave.sSec) {
        _deepWait = 1;
        var _tot = Math.max(0.4, simWave.sSec - simWave.sec0);
        var _el = (Date.now() - simWave.waitAt) / 1000 * spd;
        _deepProg = Math.min(1, Math.max(0, _el / _tot));
      }
    }
    /** 深源「等待 S 波」的圆弧：样式/粗细/颜色与 S 波圆完全一致，只是没闭合 */
    function drawSwaitArc() {
      if (!(_deepWait > 0)) return;
      var c2 = syncWaveCanvas();
      if (!c2) return;
      var pp2 = llToScreen(src.lat, src.lon);
      var r2 = 40;                      /* 贴住红叉外沿（52px + 红光晕） */
      c2.beginPath();
      c2.arc(pp2[0], pp2[1], r2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * _deepProg);
      c2.lineWidth = 8;                                /* 用户：加载圈要**粗很多**，不然看不出来 */
      c2.lineCap = 'round';
      c2.strokeStyle = col;                            /* ← 与 S 波圆同一个颜色 */
      c2.globalAlpha = 0.9;
      c2.stroke();
      c2.globalAlpha = 1;
      waveDirty = true;
    }
    /* ★★★ 2026-10-20「揺れを検出」态：只要时钟，不要圆也不要红叉。
       测站逐点出现靠 waveSec（P 波到达才亮），所以时钟必须继续跑。 */
    if (simWave && simWave.rings === false) {
      wavePKm = waveKmAt(sec, true);
      waveSec = sec;
      hideWaves();
      bumpStations();
      return;
    }
    if (simWave) simWave.boxAge = (Date.now() - (simWave.boxUntil || 0)) / 1000;
    else setEewPinAlpha(1);
    if (sec > 600 * Math.max(1, spd)) { hideWaves(); if (simWave) simWave = null; return; }
    var p = llToScreen(src.lat, src.lon);    /* 1 图层单位 = 0.1° 经度 ≈ 11.1km × cos(lat)；px/度 = 100 × k */
    var pxPerKm = (10 / 11.1) * cam.k / Math.max(0.2, Math.cos(src.lat * Math.PI / 180));
    var col = waveColor(level);
    var rP = waveKmAt(sec, true) * pxPerKm;   /* 外圈：P 波（已套区域系数）*/
    var rS = waveKmAt(sec, false) * pxPerKm;  /* 内圈：S 波（已套区域系数）*/
    waveSKm = rS / pxPerKm;
    /* ★ 测站点亮用同一个「P 波公里数」，不用另外一套速度估算 */
    if (simWave) {
      wavePKm = waveKmAt(sec, true);
      waveSec = sec;
      /* ★★★ 2026-10-20 修「横波扫过北海道，一个测站都不亮」：
         tickStations() 以前【只在 setStations() 里调一次】，那时 wavePKm 还是 0 →
         第一个测站就 break 掉了，之后 wavePKm 一直长却再没人调它 →
         整场模拟一个点也不会亮。这里每帧（paint→tickWaves）推一次。 */
      bumpStations();
    }
    /* 红叉什么时候带出来：浅源（<30km）方框一消失就有；深源随小圆长大淡入 */
    if (simWave) {
      if (!(+depth >= 30)) setEewPinAlpha(1);
      else setEewPinAlpha(Math.min(1, Math.max(0, ((simWave.boxAge || 0) - 0.2) / 2.2)));
    }
    if (rP < 0.6) {
      /* ★ 2026-10-28：深源在等 S 波时 P 波半径还是 0 —— 只清图、但把「等待圆弧」画上 */
      hideWaves();
      if (_deepWait) drawSwaitArc();
      return;
    }
    /* ★★ 2026-10-20 用户报「摄像机自己缩放移动 / 选点后自动漂移 / 波圈和测站点错位」
       → 把官方那套「自動カメラ」（波圈快出屏时 fitCircle 缩出去）整段拔掉。
       波圈现在就老实跟着用户的相机走，长了就长出屏幕，不抢镜头。 */
    /* ═══ 一次性画到 canvas 上（每帧：1 次 clear + 十几条圆弧）═══ */
    var ctx = syncWaveCanvas();
    if (!ctx) return;
    var W = stage.offsetWidth || 960, H = stage.offsetHeight || 720;
    /* ★ 圆整个跑到视口外时（大震后期常见）→ 只在需要时清一次，别每帧白画 */
    var maxR = Math.max(rP, rS);
    if (!(p[0] + maxR > 0 && p[0] - maxR < W && p[1] + maxR > 0 && p[1] - maxR < H)) {
      clearWaves();
      return;
    }
    var KW = stageK();
    var DPR = Math.min(2, global.devicePixelRatio || 1);
    ctx.setTransform(KW * DPR, 0, 0, KW * DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    waveDirty = true;
    /* ★★★ 2026-10-25 用户：「消失的动画对应地震能量从中心开始慢慢散掉」
       ① 实心盘 = 环带 [rIn, rOut]：波前到达后只晃「«ringSec» 秒，
          超过的那一圈就没下文了 → 带宽固定、中心自然出现空洞并逐渐扩大。
       ② S / P 描边环：标示真实波前，不做「跑出视口才淡」那种假动画。 */
    /* ★★★ 2026-10-25 用户：「人家是震后才开始消失的，你完全不看地震等级？」
       ⇒ 老化时长 = 该点真实提振时长，跟震级走（裂破持续时间 T ≈ L/Vr，L = 10^(0.59M-2.44) km，Vr ≈ 2.5km/s）：
         M6 ≈ 8s   M7 ≈ 22s   M8 ≈ 40s   M9 ≈ 58s（封顶 70s）
       以前固定 6~30s 且 M 取不到时默认 6 → 小震大震一个样。 */
    var magV = (simWave && +simWave.mag) ? +simWave.mag : ((lastQ && +lastQ.mag) || 6);
    var Lk = Math.pow(10, 0.59 * magV - 2.44);          /* 断层长度 km */
    /* ★★★ 2026-10-25 用户：「这是不是开始的有点快了…人家是震后才开始消失的，
       你刚刚开始就消失了？你完全不看地震等级？」「前面 20 秒无论如何都不能消失！」
       ⇒ 单个点的摇晃时长 = 破裂持续时间（L / 2Vr，Vr≈2.5km/s，×1.35 覆盖抖动段）：
           M6 → 6.8s ｜ M7 → 24.8s ｜ M8 → 94.5s ｜ M9 → 356s
         但**下限钉死 20 秒**（谁也不能在前 20 秒就把中心清空）；
         ★ 上限 120 秒（用户：「180 就没必要了吧…120 差不多了」）。 */
    var ringSec = Math.max(20, Math.min(120, Lk / 2.5 * 1.35));
    var rIn = (sec > ringSec)
      ? Math.max(0, waveKmAt(sec - ringSec, false) * pxPerKm)
      : 0;
    /* ① 震度色实心盘（中心先透明） */
    drawFadeDisc(ctx, p, rS, rIn, col, DISC_ALPHA);
    /* ② S 波圆：震度色描边 */
    if (rS > 0.6) {
      strokeRing(ctx, KW, p[0], p[1], rS, Math.min(7, 1.4 + rS * 0.008), col, 0.9);
    }
    /* ③ P 波圆：浅青细线，跑得比 S 波快 */
    if (rP > 0.6) {
      strokeRing(ctx, KW, p[0], p[1], rP, Math.min(7, 1.4 + rP * 0.008), '#baecef', 1);
    }
    /* ④ ★ 2026-10-28 深源：S 波还没到 → 叠一个「等待 S 波」的圆弧
          （样式/粗细/颜色完全沿用上面 S 波那套：col + Math.min(7, 1.4+r*0.008)） */
    if (_deepWait) drawSwaitArc();
  }
  /** 测站小圆点：与震中标记同一套投影；每个点用 transform 摆位（不重排） */
  function placeStation(el, st) {
    var p = llToScreen(st.lat, st.lon);
    el.style.transform = 'translate(' + (p[0] - 10).toFixed(1) + 'px,' + (p[1] - 10).toFixed(1) + 'px)';
  }
  function paintStations() {
    if (!stationHost) return;
    for (var i = 0; i < stationEls.length; i++) {
      var el = stationEls[i], st = stations[i];
      /* ★★ 2026-10-20 修「一移动视角全场观测点就都冒出来 / 卡死」：
         这里原来用 `i >= stReveal` 判可见性，而 `tickStations()` 结尾
         无条件写 `stReveal = n` —— 于是第一帧之后 stReveal 就等于总数，
         而 paint() 又会在拖拽/缩放时被调 → 所有站点被 display='' 全亮。
         可见性【只能由 tickStations 单方面决定】（它才知道 sec 与 tv 的关系），
         本函数只负责搬动「当前已经可见」的那几个 —— 绝不再自己判一套。 */
      if (!st || el.style.display === 'none' || !isFinite(st.lat) || !isFinite(st.lon)) continue;
      placeStation(el, st);
    }
  }
  /** ★★ 逐点「点亮」：官方是 P 波到了那个测站才出现，不是一开始就把全场铺满
   *  （用户原话：「明明 P 波都没到，结果已经提前预判了 P 波和 S 波，这么牛逼的吗？外星科技」）
   *  stations 已按震源距升序排好 ⇒ 到达时刻单调，用一个指针往前推就行。 */
  /** 连续震度 0..7.5 -> JMA 档位码（0,1,2,3,4,50,55,60,65,70） */
  function shindoCodeOf(v) {
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
  function tickStations() {
    var n = stations.length;
    if (!n) return;
    /* ★★★ 2026-10-21 ① 警戒区域阶段：只涂红，一个震度点都不显示 */
    if (stHidden) {
      for (var hi = 0; hi < stationEls.length; hi++) stationEls[hi].style.display = 'none';
      return;
    }
    /* 2026-10-24 (user: "ours never weakens -- once touched it's shindo 7 forever"):
       each station now has a shake envelope:
         sec < tv            -> not arrived yet, hidden
         tv .. tv+S_RISE     -> ramping up to full
         after that          -> exponential decay, tau grows with magnitude
                                (big quakes glow longer, but still fade)
         f < 0.12           -> hidden again
       tv = S-wave arrival seconds (hyp/4, supplied by views.genStations). */
    var sec = waveSec;
    var M = (simWave && simWave.mag) ? +simWave.mag : 6;
    /* ★ 2026-10-20 用户：「8 级地震摇的时间太短，好快就又回到 0」。
       以前是「S 波到达 → 1 秒就到峰值 → 立刻 exp 衰减」，完全没有强震持续期，
       M8 也只摇十几秒。真实情况是：S 波到达后要一直摇到【断层破裂结束】，
       破裂持续时间约等于 破裂长度 / 破裂速度(≈3 km/s)，而破裂长度用宇津式：
         Lf = 10^(0.5M - 1.85)   → M6≈14km(4.7s)  M7≈45km(15s)
                                   M8≈141km(47s)  M9≈447km(149s，限幅 90s)
       之后才 exp 衰减。这样 M8 大约摇 70 秒，M6 十几秒。 */
    var Lf = Math.min(4000, Math.pow(10, 0.5 * M - 1.85));
    var hold = Math.min(90, Lf / 3);
    var tau = 4 + Math.max(0, M - 6) * 3;      /* 衰减尾巴：M6 -> 4s, M8 -> 10s */
    var S_RISE = 1.0;
    /* P 波阶段的震度比 S 波低多少：振幅 ~1/10 ⇒ ΔI ≈ 1.72*log10(10) ≈ 1.7~2.2 档 */
    var P_DROP = 2.2;
    for (var i = 0; i < n; i++) {
      var st = stations[i], el = stationEls[i];
      if (!el || !st) continue;
      var tv = (st.tv != null) ? +st.tv : (st.hyp || 0) / 4;
      var tp = (st.tp != null) ? +st.tp : (st.hyp || 0) / 6.5;
      if (!stT0 || sec < tp) {
        /* ★ 2026-11-04 性能：未到达波前的测站只在首次设一次灰点样式，
           之后每帧只跑 placeStation（改 transform，轻量），不再每帧重写
           src/opacity/display（之前 1535 个节点每帧重绘 → 卡顿）。 */
        if (!st._pre) {
          st._pre = 1;
          el.style.display = '';
          el.style.opacity = '0.28';
          el.src = (global.QVBadge && global.QVBadge.uri) ? global.QVBadge.uri(0, { size: 64, metric: stMetric, label: '' }) : el.src;
          el.setAttribute('data-su', 'pre0');
        }
        placeStation(el, st);
        continue;
      }
      if (st._pre) st._pre = 0;   /* 到达波前 → 下方动态分支重设强度色 */
      var peak = (st.intensity != null) ? +st.intensity : 6.5;
      var Ip = Math.max(-1, peak - P_DROP);       /* P 波阶段的震度（低 ~2 档） */
      var inst;
      if (sec < tv) {
        /* —— 只有 P 波：震度 0~3 那几档，h0~h3 造型就是给这一段的 —— */
        inst = Ip;
      } else if (sec < tv + hold) {
        /* —— S 波到达 → 1 秒内升到峰值，然后一直摇到断层破裂结束 —— */
        var a2 = sec - tv;
        inst = (a2 < S_RISE) ? (Ip + (peak - Ip) * (a2 / S_RISE)) : peak;
      } else {
        /* —— 破裂结束，尾巴 exp 衰减 —— */
        inst = peak * Math.exp(-(sec - tv - hold) / tau);
      }
      inst = Math.max(0, inst);
      /* ★★ 2026-10-20: 用【官方机制】取代自写的 exp 淡出。
         反编译 `受信と検出` 得到：
           · 列表 `ten:震度履歴` = 10 槽环形缓冲
           · 过程 `震度履歴移動 %s` = repeat 9 { replaceitemoflist } —— 整列右移一格
           · 过程 `周囲9grid最大震度or上昇` —— 【显示值 = 窗口内最大值】
           · 调用链 震度履歴移動 ← 点震度の処理 ← 震度復元 ← control_forever
         所以官方的观感是「上升立刻生效、下降要等窗口滑出」的**阶梯**，
         不是连续变淡。这里照做：每 SLOT_S 秒往窗口推一个瞬时值，显示取 max。
         ⇒ 峰值保持 WINDOW_N × SLOT_S = 5 秒，然后随包络一起掉下去。 */
      var SLOT_S = 0.5, WINDOW_N = 10;
      /* ★ 2026-10-21 用户：「模拟地震的 P 波划过测站，测站没有任何反应」
         病根：历史窗口是从 **tv（S 波到达）** 才开始推值的（st.hn = tv），
         而 P 波阶段（tp ≤ sec < tv）窗口里一条数据都没有 → cur 恒为 0 →
         被下面的 `cur < 0.2` 判成不可见 ⇒ P 波扫过一个测站都不亮。
         ⇒ 窗口从 **tp** 开始推，P 波到达就开始按「低 2 档」的震度显示。 */
      if (!st.hw) { st.hw = []; st.hn = tp; }
      var g2 = 0;
      while (sec >= st.hn && g2++ < 200) {
        st.hw.push(inst);
        if (st.hw.length > WINDOW_N) st.hw.shift();
        st.hn += SLOT_S;
      }
      var cur = 0;
      for (var wi = 0; wi < st.hw.length; wi++) if (st.hw[wi] > cur) cur = st.hw[wi];
      /* ★ 2026-10-20：检测榃0 的点也要显示（用户：「地图上显示的也应该是检测到震度的震点，也就是震度0」），
         把阀值从 0.4 降到 0.2（与 views.genStations 的 `I >= 0.2` 检测阀值一致）。 */
      if (cur < 0.2) { el.style.display = 'none'; continue; }
      var ccode = (stMetric === 'liedu' && global.QV_LIEDU && QV_LIEDU.codeOfI)
        ? QV_LIEDU.codeOfI(cur) : shindoCodeOf(cur);
      /* 2026-10-20: the official map DOES draw 震度0 -- costume `h0` is a grey
         radial-glow badge (#686870). Do not drop ccode === 0 here (that used to
         blank every station that only felt 震度0). Arrival is gated by `sec < tv`,
         expiry by the `cur < 0.4` test above. */
      el.style.display = '';
      /* 官方不改透明度、只换造型 ⇒ 这里也固定 1，避免和造型阶梯打架 */
      el.style.opacity = '1';
      /* 2026-10-24: swap the official hN costume as the intensity decays (h1..h9). */
      var su2 = (stMetric === 'liedu') ? ('L' + ccode)
        : ((global.QV_SC_SUF ? global.QV_SC_SUF(ccode) : String(ccode)));
      if (el.getAttribute('data-su') !== su2) {
        /* ★ 2026-11-02 用户：「怎么方的圆的都有」——
           官方 marks/hN.svg 本身是【圆角方块】，填色区域标识又是圆，两套叠在一起很乱。
           统一成同一套圆形徽章（js/badge.js），手上只有圆。 */
        /* ★★★ 2026-10-26 用户定的规则（别再反过来改）：
           「EEW 阶段测站只能是圆的，正式报地图填色只能是方的（这时测站该隐藏）」
           —— 中国地区用的是假数据测站，有些点既是重点测站又落在填色区，
              两边都画就会冷暖相遇（圆+方）→ 按【阶段】分工：
               · EEW / 检测态：只画圆形测站（这里）
               · 正式报：views.js 会 clearStations() 隐掉测站，
                         只留 QVShindo.setPoints() 的方形区域数字 */
        el.src = (global.QVBadge && global.QVBadge.uri)
          ? global.QVBadge.uri(ccode, { size: 64, metric: stMetric, label: String(ccode) })
          : ((stMetric === 'liedu' && global.QV_LIEDU && QV_LIEDU.markSrc)
            ? QV_LIEDU.markSrc(ccode)
            : ('assets/marks/h' + su2 + '.svg?v=' + MARK_V));
        el.setAttribute('data-su', su2);
      }
      placeStation(el, st);
    }
    /* ★ 2026-10-20：不再写 stReveal = n。stReveal 曾是「已点亮个数」的副本，
       但 paintStations() 用它判可见性 → 两边打架导致全场亮起。现已废弃。 */
  }
  function setStations(list, org) {
    if (!view) init();
    stMetric = (org && org.metric) || 'shindo';
    stations = (list || []).slice().sort(function (a, b) { return (a.hyp || 0) - (b.hyp || 0); });
    stT0 = (org && org.t0) || 0;
    stReveal = 0;
    var colorOf = (global.QVShindo && global.QVShindo.colorOf) ? global.QVShindo.colorOf : function () { return '#3098bd'; };
    while (stationEls.length < stations.length) {
      var d = document.createElement('img');
      d.draggable = false;
      /* 2026-10-20 user: stations vanish into the same-coloured shindo fill.
         1px white ring + 1px dark outer edge -> readable on any fill colour. */
      /* 2026-10-20 user asked "is that really 1px": it was 1px white PLUS a 2nd
         1px black ring -> 11px visual diameter. Now exactly one 1px white ring, 6px dot. */
      /* 2026-10-20: a 1px white *outline* (box-shadow) disappears on the bright red
         6+ fill. Use an INNER 1px white border instead -> the ring is always drawn
         inside the dot, so it stays visible on any fill colour and the dot stays small. */
      /* 2026-10-24: official map markers are the map sprite's h0..h9 costumes.
         2026-10-20: 原图是 400x400 画布但图形只占中间 200x200（实测 bbox
         = [100,100,200,200]），直接当 <img> 用就是个「小方块 + 大片空白」。
         已把 10 个 SVG 的 viewBox 裁成 100,100,200,200 → 现在填满整个框，
         所以显示尺寸从 26 收到 20（圆的直径就是 20px），偏移配 -10。 */
      d.style.cssText = 'position:absolute;left:0;top:0;width:20px;height:20px;' +
        'pointer-events:none;will-change:transform';
      stationHost.appendChild(d);
      stationEls.push(d);
    }
    /* ROLLED BACK 2026-10-24: the official map markers are ROUND, not the square
       sndm list badges. Keep the round CSS dots until the round art is identified. */
    for (var i = 0; i < stationEls.length; i++) {
      var el = stationEls[i], st = stations[i];
      el.style.display = 'none';
      el.style.opacity = '1';
      if (!st) continue;
      /* ★ 2026-10-21：烈度卡没有官方圆标（h0..h9 只到震度7）→ 用 QV_LIEDU.markSrc 生成 */
      var su = (stMetric === 'liedu') ? ('L' + (st.shindo | 0))
        : (global.QV_SC_SUF ? global.QV_SC_SUF(st.shindo) : String(st.shindo));
      /* ★ 同上：统一圆形徽章 */
      /* ★ 2026-10-26：EEW 阶段测站只用【圆】徽章（方形只给正式报的区域数字） */
      el.src = (global.QVBadge && global.QVBadge.uri)
        ? global.QVBadge.uri(st.shindo, { size: 64, metric: stMetric, label: String(st.shindo) })
        : ((stMetric === 'liedu' && global.QV_LIEDU && QV_LIEDU.markSrc)
          ? QV_LIEDU.markSrc(st.shindo)
          : ('assets/marks/h' + su + '.svg?v=' + MARK_V));
      el.setAttribute('data-su', su);
    }
    tickStations();
    paintStations();
  }
  function clearStations() {
    stations = [];
    stReveal = 0; stT0 = 0;
    for (var i = 0; i < stationEls.length; i++) stationEls[i].style.display = 'none';
  }
  /** ★ 让「半径 km 的圆」刚好装进可视区（官方自动镜头用的同一思路）
   *  frac = 半径占可视短边的比例。会同时换档（jp/wlg/outsvg）。 */
  function fitCircle(lat, lon, km, frac) {    if (!view || !(km > 0.5)) return;
    frac = frac || 0.44;
    var minDim = Math.min(VIS.x1 - VIS.x0, VIS.y1 - VIS.y0);
    var pxPerKmWant = (minDim * frac) / km;
    var k = pxPerKmWant * Math.cos(lat * Math.PI / 180) / (10 / 11.1);
    k = clamp(k, K_MIN, K_MAX);
    applyTier(tierFor(lat, lon, k));
    apply(lat, lon, k);
  }
  function setPin(lat, lon) { setPins(lat == null ? [] : [{ lat: lat, lon: lon, kind: 'normal' }]); }

  /** 经纬度 → 舞台逻辑像素（与红叉/瓦片同一套公式，含「取最近的世界副本」） */
  function llToScreen(lat, lon) {
    var pxu = T.A * cam.k;
    var ux = mapXOf(lon), uy = mapYOf(lat);
    var x = cam.tx + pxu * (ux - T.MINX);
    var period = pxu * 3600;
    if (period > 1) x += Math.round((VIS.cx - x) / period) * period;
    return [x, cam.ty + pxu * (T.MAXY - uy)];
  }
  /** ★★★ 「揺れを検出」检测态：压住红叉 / P/S 波圆，并画官方矩形范围框。
   *  list = [{color, lon0, lat0, lon1, lat1}]；`force=true` 即使暂时没框也不放红叉。 */
  function setDetectMode(on) {
    pinsOff = !!on;
    if (!view) init();
    if (pinsOff) {
      /* 检测态的 simWave 是「无圆时钟」（rings:false），别把它关了 */
      if (simWave && simWave.rings !== false) simWave = null;
      hideWaves();
      setPins([]);
    }
  }
  function setBoxes(list, force) {
    boxes = (list && list.length) ? list : null;
    pinsOff = !!force || !!boxes;
    if (!view) init();
    if (pinsOff) {
      if (simWave && simWave.rings !== false) simWave = null;
      hideWaves();
      setPins([]);                 /* → paint() → paintBoxes() */
    } else if (view) {
      paintBoxes();                /* 清掉旧框 */
    }
  }
  /** 官方 `枠描画` 同款：2px 彩线（官方先 4px 白打底，但那次递归参数顺序写错 → 屏幕上看不到白边）。 */
  function paintBoxes() {
    if (!boxhost) return;
    var need = boxes ? boxes.length : 0;
    while (boxEls.length < need) {
      var d = document.createElement('div');
      d.className = 'qvbox';
      d.style.cssText = 'position:absolute;left:0;top:0;box-sizing:border-box;border:2px solid #40bf4a;' +
        'background:none;pointer-events:none;display:none';
      boxhost.appendChild(d);
      boxEls.push(d);
    }
    /* ★★★ 2026-10-21 定稿（用户澄清）：
       「摄像机缩小 → 地图比例尺变大 → 框框尺寸不变的话，半个亚洲都进框了」
       ⇒ 框必须是【经纬度固定矩形】：屏幕尺寸 = 度数 × 当前比例尺，
          缩放地图时框跟着一起放大/缩小（缩小时一定跟着变小）。
       尺寸由 views.rebuildAreas 的自适应逻辑给出（跨度/2.2，夹 0.25~0.9°）。 */
    for (var i = 0; i < boxEls.length; i++) {
      var el = boxEls[i];
      if (i >= need) { el.style.display = 'none'; continue; }
      var b = boxes[i];
      if (b.lat0 == null || b.lon0 == null) { el.style.display = 'none'; continue; }
      var p1 = llToScreen(b.lat0, b.lon0), p2 = llToScreen(b.lat1, b.lon1);
      el.style.display = '';
      el.style.borderColor = b.color || '#40bf4a';
      el.style.left = Math.min(p1[0], p2[0]).toFixed(1) + 'px';
      el.style.top = Math.min(p1[1], p2[1]).toFixed(1) + 'px';
      el.style.width = Math.max(1, Math.abs(p2[0] - p1[0])).toFixed(1) + 'px';
      el.style.height = Math.max(1, Math.abs(p2[1] - p1[1])).toFixed(1) + 'px';
    }
  }

  /* ============ 中国烈度色块（地级市/省级轮廓填充）============
     ★ 2026-10-21 用户：「地图没有烈度色块」
       日本靠官方 `nc<区域码>` 造型填色；中国没有 JMA 细分多边形，
       所以自带一份轮廓（js/cn-areas.js，DataV GeoJSON 简化版）。
       list = [{code, level}]，code = 地级市 adcode（直辖市/特区是省级 adcode）。
       颜色走 QV_LIEDU 的 12 级色阶，和卡片/圆标同一套。 */
  var areaHost = null, areaSvg = null, areaList = null, areaParsed = null;
  var areaFillG = null, areaLineG = null, areaEls = [], lineEls = [];
  /* ★★★ 2026-11-02 用户：官方地图填色是【每个地区一个圆形震度徽章】
     （「珠海市 7，那是珠海市这一个地区单独填一个 7，官方原本就是圆的」）
     ⇒ 填色层之上再加一层 badgeG，每个区域 bbox 中心叠一个 QVBadge（js/badge.js）。
     屏幕尺寸恒定，不随地图缩放。 */
  var badgeG = null, badgeEls = [], badgeSeen = [];
  var BADGE_SIZE = 26;
  /* ★ 2026-10-26 用户定的规则：填色层的方形数字【只在正式报】显示，
     EEW / 检测阶段只留圆形测站（否则中国那种假数据测站会和填色方块撞在一起）。 */
  var badgeOn = true;
  /* ★★★ 2026-10-26 用户：「你这个地图海啸页面只做了震度卡，烈度卡你都没做
     在海啸页面降低地图填色亮度和隐藏数字提示」
     —— 海啸页只该看海岸线颜色，填色块要压暗、方形数字要收起来。
        日本走 QVShindo.setTsuMode()，**中国烈度走的是这里**（QVMapCam 的色块层）
        → 这两个开关就是烈度版的对应物。 */
  var tsuMode = false;
  function setTsuMode(on) {
    on = !!on;
    if (tsuMode === on) return;
    tsuMode = on;
    if (areaHost) areaHost.style.opacity = on ? '0.42' : '';
    paintAreas();
  }
  function setAreaBadge(on) {
    on = !!on;
    /* ★★★ 2026-10-26 用户：「调查中地图填色了，但填色之后的数字提示不见了」
       —— 以前这里只改标志位、**不重绘**：填色是在更早的 setAreaFill 里画的，
          那时 badgeOn 还是 false（阶段门禁）→ 数字层被早退藏掉；
          之后阶段变成调查中把 badgeOn 打开，但没人重新调 paintAreas
          → 数字一直不出现，直到下一次 setAreaFill（正式报）才补上。
       ⇒ 状态真的变了就立刻重绘一次。 */
    if (badgeOn === on) return;
    badgeOn = on;
    paintAreas();
  }
  function parseAreaPolys() {
    if (areaParsed) return areaParsed;
    var src = global.QV_CN_AREAS || [];
    areaParsed = src.map(function (a) {
      var rings = [];
      for (var i = 0; i < a.p.length; i++) {
        var parts = a.p[i].split(' ');
        var pts = new Float64Array(parts.length * 2);
        for (var j = 0; j < parts.length; j++) {
          var xy = parts[j].split(',');
          pts[j * 2] = +xy[0]; pts[j * 2 + 1] = +xy[1];
        }
        if (pts.length >= 6) rings.push(pts);
      }
      return { c: a.c, b: a.b, rings: rings };
    });
    return areaParsed;
  }
  /* ═══════ ZQuake 模拟器：常驻区域分界线层 ═══════
     原版只有「模拟出报后」才画中国色块 + 白线，平时地图一片空白 →
     用户看到的就是「地图连分界线都没有 / 涂色死哪去了」。
     这里常驻画一层细线：**中国地级市（QV_CN_AREAS）+ 日本震度区域（QV_SHINDO_AREAS）**，
     任何缩放/视图都在，且 z-index 在填色层之下（4 < 5），不会盖住官方色块。 */
  var zqHost = null, zqParsed = null, zqOn = true, zqStride = -1;
  function zqParse() {
    if (zqParsed) return zqParsed;
    var out = [];
    /* —— 中国：地级市 {c,n,b:[minLon,minLat,maxLon,maxLat],p:["lon,lat lon,lat …"]} —— */
    var CN = global.QV_CN_AREAS || [];
    for (var i = 0; i < CN.length; i++) {
      var a = CN[i], rings = [];
      var pr = a.p || [];
      for (var r = 0; r < pr.length; r++) {
        var parts = String(pr[r]).split(' '), pts = [];
        for (var j = 0; j < parts.length; j++) {
          var xy = parts[j].split(',');
          var px = +xy[0], py = +xy[1];
          if (isFinite(px) && isFinite(py)) pts.push(px, py);
        }
        if (pts.length >= 6) rings.push(pts);
      }
      if (rings.length) out.push({ b: a.b || null, rings: rings });
    }
    /* —— 日本：JMA 震度区域 {name,pref,p:[[lon,lat,…],…]} —— */
    var SA = global.QV_SHINDO_AREAS;
    if (SA && SA.areas) {
      for (var code in SA.areas) {
        if (!Object.prototype.hasOwnProperty.call(SA.areas, code)) continue;
        var ar = SA.areas[code], rs = [];
        var arp = ar.p || [];
        for (var r2 = 0; r2 < arp.length; r2++) {
          var rr = arp[r2], ps = [];
          for (var j2 = 0; j2 + 1 < rr.length; j2 += 2) {
            if (isFinite(rr[j2]) && isFinite(rr[j2 + 1])) ps.push(rr[j2], rr[j2 + 1]);
          }
          if (ps.length >= 6) rs.push(ps);
        }
        if (rs.length) {
          var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
          for (var k = 0; k < rs.length; k++) {
            var q = rs[k];
            for (var t = 0; t + 1 < q.length; t += 2) {
              if (q[t] < x0) x0 = q[t]; if (q[t] > x1) x1 = q[t];
              if (q[t + 1] < y0) y0 = q[t + 1]; if (q[t + 1] > y1) y1 = q[t + 1];
            }
          }
          out.push({ b: [x0, y0, x1, y1], rings: rs });
        }
      }
    }
    zqParsed = out;
    return out;
  }
  function paintZqBorders() {
    if (!zqHost) {
      var hn0 = document.getElementById('map');
      if (!hn0) return;
      zqHost = document.createElement('div');
      zqHost.id = 'zqborders';
      zqHost.style.cssText = 'position:absolute;left:0;top:0;width:' + T.W + 'px;height:' + T.H +
        'px;transform-origin:0 0;pointer-events:none;z-index:6';
      hn0.appendChild(zqHost);
      zqStride = -1;
    }
    if (!zqOn) { zqHost.style.display = 'none'; return; }
    zqHost.style.display = '';
    /* ★★ 性能关键：与官方 #mapoverlay 用**同一套图集变换** →
       平移/缩放只改一行 transform（GPU 合成），**完全不重算路径**。
       上一版是屏幕坐标 + 每次相机变化都重建 200KB+ 的 path d → 缩放时巨卡。 */
    zqHost.style.transform = 'translate(' + cam.ox.toFixed(2) + 'px,' + cam.ty.toFixed(2) +
      'px) scale(' + cam.k.toFixed(4) + ')';
    /* 只有「细节档位」跨档了才重建路径 */
    var st = zqStrideOf(cam.k);
    if (st !== zqStride) {
      zqStride = st;
      var d = zqBuildPath(st);
      zqHost.innerHTML = d ? ('<svg width="' + T.W + '" height="' + T.H +
        '" viewBox="0 0 ' + T.W + ' ' + T.H +
        '" style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none">' +
        '<path d="' + d + '" fill="none" stroke="rgba(186,203,236,0.40)" stroke-width="1.1" ' +
        'stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>') : '';
    }
  }
  /* 细节档位：缩放越小抽点越稀（省内存 + 省渲染） */
  function zqStrideOf(k) {
    return k < 0.9 ? 10 : (k < 1.6 ? 6 : (k < 3 ? 3 : (k < 6 ? 2 : 1)));
  }
  /* 生成图集坐标下的分界线路径（一次算好，跨档才重算） */
  function zqBuildPath(stride) {
    var arr = zqParse(), d = '';
    for (var i = 0; i < arr.length; i++) {
      var rings = arr[i].rings;
      for (var r = 0; r < rings.length; r++) {
        var pts = rings[r], step = 2 * stride;
        for (var j = 0; j + 1 < pts.length; j += step) {
          d += (j ? 'L' : 'M') + (T.A * (mapXOf(pts[j]) - T.MINX)).toFixed(1) + ' ' +
            (T.A * (T.MAXY - mapYOf(pts[j + 1]))).toFixed(1);
        }
        var li = pts.length - 2;
        if (li > 0 && li % step !== 0) {
          d += 'L' + (T.A * (mapXOf(pts[li]) - T.MINX)).toFixed(1) + ' ' +
            (T.A * (T.MAXY - mapYOf(pts[li + 1]))).toFixed(1);
        }
        d += 'Z';
      }
    }
    return d;
  }
  function ensureAreaLayer() {
    var hn = document.getElementById('map');
    if (!hn) return null;
    if (areaHost && areaHost.parentNode === hn) {
      /* ★ 2026-10-21：「清空过之后组没了」——`paintAreas` 以前用 `areaSvg.innerHTML=''`
         把 <g> 连带删掉，但 `areaFillG/areaLineG` 变量还在（或变成 null），
         下一次 appendChild 就抛异常/挂到已脱离文档的节点上 → 整层色块静默消失。 */
      if (!areaFillG || !areaLineG || areaFillG.parentNode !== areaSvg) {
        areaSvg.innerHTML = '';
        areaFillG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        areaLineG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        areaSvg.appendChild(areaFillG);
        areaSvg.appendChild(areaLineG);
        areaSvg.appendChild(badgeG);      /* 徽章永远压在白线之上 */
        areaEls = []; lineEls = []; badgeEls = []; badgeSeen = [];
      }
      return areaHost;
    }
    if (!areaHost) {
      areaHost = document.createElement('div');
      areaHost.id = 'mapcnareas';
      areaHost.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:5';
      areaSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      areaSvg.setAttribute('style', 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none');
      /* ★ 2026-10-21 用户：官方是「先填色，再在顶层画一层普通白线」把分界划出来。
         两个 <g>：先填色组，后白线组（DOM 顺序 → 白线永远压在填色之上）。 */
      areaFillG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      areaLineG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      areaSvg.appendChild(areaFillG);
      areaSvg.appendChild(areaLineG);
      areaSvg.appendChild(badgeG);
      areaHost.appendChild(areaSvg);
    }
    hn.appendChild(areaHost);
    return areaHost;
  }
  function setAreaFill(list) {
    areaList = (list && list.length) ? list : null;
    paintAreas();
  }
  function paintAreas() {
    if (!areaList) {
      /* ★ 只把 path 藏起来，**不要** areaSvg.innerHTML=''（会把两个 <g> 一起删掉，
         下一次 setAreaFill 就挂到已脱离文档的节点上 → 色块整层静默消失）。 */
      for (var h0 = 0; h0 < areaEls.length; h0++) areaEls[h0].setAttribute('display', 'none');
      for (var h1 = 0; h1 < lineEls.length; h1++) lineEls[h1].setAttribute('display', 'none');
      for (var h2 = 0; h2 < badgeEls.length; h2++) badgeEls[h2].setAttribute('display', 'none');
      return;
    }
    if (!ensureAreaLayer()) return;
    var i;
    var val = {};
    for (i = 0; i < areaList.length; i++) {
      val[areaList[i].code] = { lv: +areaList[i].level || 0, m: areaList[i].metric || 'liedu' };
    }
    /* 本帧屏幕投影（inline，避免每点建数组）
       ★★★ 2026-10-21 用户：「特定缩放比下左边不显示市级，右边显示」
         真因：以前 `sx()` 让**每个点各自**往「离视口中心最近的世界副本」吸，
         于是 ①包围盒的两个角可能吸到不同副本 → 明明在屏幕里的多边形被判成屏幕外（左边整片不画）；
              ②一个多边形的顶点跨副本 → 画出来是一块横贯屏幕的怪东西。
         改法：先按多边形 bbox 中心算一次副本偏移 `off`，**整块多边形统一加这个 off**。 */
    var pxu = T.A * cam.k, per = pxu * 3600;
    var cx = VIS.cx, tx = cam.tx, ty = cam.ty;
    function rawx(lon) { return tx + pxu * (mapXOf(lon) - T.MINX); }
    function sy(lat) { return ty + pxu * (T.MAXY - mapYOf(lat)); }
    var arr = parseAreaPolys();
    var pad = 80, x1 = cx * 2 + pad, y1 = VIS.cy * 2 + pad;
    var LIE = global.QV_LIEDU;
    var list = [];
    for (i = 0; i < arr.length; i++) {
      var a = arr[i], vv = val[a.c];
      if (!vv || !vv.lv) continue;
      /* 这一个多边形画到哪个世界副本：按 bbox 中心就近取一份，整块共用 */
      var off = 0;
      if (per > 1) off = Math.round((cx - rawx((a.b[0] + a.b[2]) / 2)) / per) * per;
      /* 包围盒粗筛：完全在视野外就不投影了（369 个 × 上百点，必须筛） */
      var bx0 = rawx(a.b[0]) + off, bx1 = rawx(a.b[2]) + off;
      if (Math.max(bx0, bx1) < -pad || Math.min(bx0, bx1) > x1) continue;
      var by0 = sy(a.b[3]), by1 = sy(a.b[1]);
      if (Math.max(by0, by1) < -pad || Math.min(by0, by1) > y1) continue;
      var d = '';
      /* ★ 2026-10-21 用户：「边缘锯齿多」→ 数据换成 tol=0.004° 的细轮廓；
         缩小到能看见整个中国时（k<4）按 stride 抽点，否则一帧要投影十几万个点。 */
      var stride = cam.k < 2 ? 2 : (cam.k < 3 ? 2 : 1);
      for (var r = 0; r < a.rings.length; r++) {
        var pts = a.rings[r], step = 2 * stride;
        for (var j = 0; j < pts.length; j += step) {
          d += (j ? 'L' : 'M') + (rawx(pts[j]) + off).toFixed(1) + ' ' + sy(pts[j + 1]).toFixed(1);
        }
        /* 抽点后要补回最后一点，否则闭合边会切角 */
        var li = pts.length - 2;
        if (li > 0 && li % step !== 0) {
          d += 'L' + (rawx(pts[li]) + off).toFixed(1) + ' ' + sy(pts[li + 1]).toFixed(1);
        }
        d += 'Z';
      }
      var col = (vv.m === 'liedu' && LIE) ? LIE.colorOf(vv.lv)
        : ((global.QVShindo && QVShindo.colorOf) ? QVShindo.colorOf(vv.lv) : '#3098bd');
      list.push({ d: d, c: col,
        bx: (bx0 + bx1) / 2, by: (by0 + by1) / 2, lv: vv.lv, m: vv.m });
    }
    while (areaEls.length < list.length) {
      /* 填色层：纯色块 + **同色描边 2px**
         ★ 2026-10-21 用户：「缩小一级就能看到一堆深色背景缝隙」
           病因：相邻市的共用边界被各自抽点简化后不再完全重合 → 中间漏出底色。
           同色描边让每块向外胖 1px，缝隙就被盖住了（白线层再压上去，看不出胖）。 */
      var el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('stroke-width', '2');
      el.setAttribute('stroke-linejoin', 'round');
      el.setAttribute('fill-opacity', '0.92');
      areaFillG.appendChild(el);
      areaEls.push(el);
      /* 分界线层：顶层再画一层普通白线（官方就是这么干的） */
      var ln = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      ln.setAttribute('fill', 'none');
      ln.setAttribute('stroke', 'rgba(255,255,255,0.66)');
      ln.setAttribute('stroke-width', '1.5');
      ln.setAttribute('stroke-linejoin', 'round');
      ln.setAttribute('stroke-linecap', 'round');
      areaLineG.appendChild(ln);
      lineEls.push(ln);
    }
    for (i = 0; i < areaEls.length; i++) {
      var pe = areaEls[i], le = lineEls[i];
      if (i >= list.length) {
        pe.setAttribute('display', 'none');
        if (le) le.setAttribute('display', 'none');
        continue;
      }
      pe.removeAttribute('display');
      pe.setAttribute('d', list[i].d);
      pe.setAttribute('fill', list[i].c);
      pe.setAttribute('stroke', list[i].c);
      /* ★ 2026-10-21：叠了等烈度线时把填色压淡（0.92 → 0.5），
         否则同色系的等值线压在同色块上完全看不见。 */
      var isoOn = !!(isoLines && isoLines.length);
      pe.setAttribute('fill-opacity', isoOn ? '0.5' : '0.92');
      if (le) {
        le.removeAttribute('display');
        le.setAttribute('d', list[i].d);
        /* 行政区界白线也要退到背景，否则会跟等烈度线的白边撞在一起分不清 */
        le.setAttribute('stroke', isoOn ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.66)');
      }
    }

    /* ── 每个填色区域中心叠一个【方形】震度/烈度数字 ──
       ★ 2026-10-26 用户：「EEW 阶段测站只能是圆的，正式报地图填色只能是方的
         （而且这个时候测站该隐藏了）」
       ⇒ 这一层只在【正式报】显示（badgeOn 由 views.js 按阶段开），
          EEW / 检测 / 调查中阶段直接早退，只留圆形测站。 */
    if (badgeG && global.QVBadge) {
      if (!badgeOn || tsuMode) {
        for (i = 0; i < badgeEls.length; i++) badgeEls[i].setAttribute('display', 'none');
        return;
      }
      while (badgeEls.length < list.length) {
        var be0 = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        be0.setAttribute('width', BADGE_SIZE);
        be0.setAttribute('height', BADGE_SIZE);
        be0.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        be0.setAttribute('x', 0); be0.setAttribute('y', 0);
        badgeG.appendChild(be0);
        badgeEls.push(be0);
        badgeSeen.push('');
      }
      for (i = 0; i < badgeEls.length; i++) {
        var be = badgeEls[i];
        if (i >= list.length) { be.setAttribute('display', 'none'); continue; }
        var bt = list[i];
        /* 中心点离屏幕太远就不画（缩放时能省一大半 DOM 操作） */
        if (bt.bx < -40 || bt.by < -40 || bt.bx > x1 + 40 || bt.by > y1 + 40) {
          be.setAttribute('display', 'none');
          continue;
        }
        var sig = bt.lv + '|' + bt.m;
        if (badgeSeen[i] !== sig) {
          badgeSeen[i] = sig;
          /* ★★★ 2026-10-26 用户：「EEW 阶段测站只能是圆的，正式报地图填色只能是方的」
             —— 这一层就是【正式报的填色数字】，以前用 QVBadge 的圆形，和官方（也和我们
                本来想要的方形）不符。
             ⇒ 方形：震度 = 官方 assets/marks/h*.svg（h0..h9）；
                     烈度 = QV_LIEDU.markBoxSrc(0..12)（同尺寸同构图）。 */
          var _hsu = (global.QV_SC_SUF ? String(QV_SC_SUF(bt.lv)) : String(Math.round(bt.lv)));
          be.setAttribute('href', (bt.m === 'liedu' && global.QV_LIEDU && global.QV_LIEDU.markBoxSrc)
            ? global.QV_LIEDU.markBoxSrc(bt.lv)
            : ('assets/marks/h' + _hsu + '.svg?v=' + MARK_V));
        }
        be.removeAttribute('display');
        be.setAttribute('x', (bt.bx - BADGE_SIZE / 2).toFixed(1));
        be.setAttribute('y', (bt.by - BADGE_SIZE / 2).toFixed(1));
      }
    }
  }

  /* ============ 等烈度线（等震线）：中国自算区域的叠加层 ============
     ★★★ 2026-10-21 用户选型：「地级市打底 + 等烈度线圈叠加」
       中国地震台网（CENC）的官方烈度图就是这个形态 —— 彩色色带 + 等震线圈。
       数据全部自己算（不依赖任何 API）：
         2791 个区县测站 → GMPE(司・翠川) + VS30 场地放大 → 连续烈度 I
         → 在 I 场上做 marching squares → 抽出 Ⅱ/Ⅲ/Ⅳ…各档等值线
     计算只在【数据变化】时跑一次（setIsoPoints），相机移动只重新投影（很便宜）。 */
  var isoHost = null, isoSvg = null, isoG = null, isoGWhite = null,
      isoPts = null, isoLines = null, isoEls = [];
  var ISO_STEP_MAX = 0.16;         /* 网格步长上限（度）≈ 18km */
  var ISO_N_MAX = 130;             /* 每方向最多 130 格 —— 72 格时内圈像八边形（用户看得见棱角） */

  /** pts = [{lon, lat, v}]   v = **连续烈度 I**（2.68+1.72·lgPGV 的原始输出，不是等级码） */
  function setIsoPoints(pts) {
    isoPts = (pts && pts.length >= 3) ? pts : null;
    isoLines = isoPts ? buildIso(isoPts) : null;
    paintIso();
  }

  function buildIso(pts) {
    var lonA = 1e9, lonB = -1e9, latA = 1e9, latB = -1e9, i;
    for (i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!isFinite(p.lon) || !isFinite(p.lat) || !isFinite(p.v)) continue;
      if (p.lon < lonA) lonA = p.lon;
      if (p.lon > lonB) lonB = p.lon;
      if (p.lat < latA) latA = p.lat;
      if (p.lat > latB) latB = p.lat;
    }
    if (!(lonB > lonA) || !(latB > latA)) return null;
    /* 外扩 0.6°：最外圈测站之外留余量，否则等值线被网格边界切断成开口 */
    lonA -= 0.6; lonB += 0.6; latA -= 0.6; latB += 0.6;
    var sx = lonB - lonA, sy0 = latB - latA;
    var step = Math.min(ISO_STEP_MAX, Math.max(sx, sy0) / ISO_N_MAX);
    if (!(step > 0)) return null;
    var nx = Math.min(ISO_N_MAX + 1, Math.ceil(sx / step) + 1);
    var ny = Math.min(ISO_N_MAX + 1, Math.ceil(sy0 / step) + 1);
    /* ---- IDW 填场（p=4）：近处点主导、远处迅速衰减，等值线不会被拉成大方块 ---- */
    var F = new Float32Array(nx * ny), NT = pts.length;
    for (var j = 0; j < ny; j++) {
      var la = latA + j * step;
      for (var ii = 0; ii < nx; ii++) {
        var lo = lonA + ii * step, sw = 0, sv = 0;
        for (var k = 0; k < NT; k++) {
          var dx = (pts[k].lon - lo) * 0.8, dy = pts[k].lat - la;
          var d2 = dx * dx + dy * dy + 0.0025;
          var w = 1 / (d2 * d2);
          sw += w; sv += w * pts[k].v;
        }
        F[j * nx + ii] = sw > 0 ? sv / sw : NaN;
      }
    }
    /* ---- 逐档 marching squares ---- */
    var EDGES = (global.QV_LIEDU && QV_LIEDU.EDGES) ||
      [0.96, 2.00, 2.60, 3.12, 3.62, 4.14, 4.65, 5.17, 5.70, 6.19, 6.71, 7.23];
    var vmax = -1e9;
    for (var q = 0; q < F.length; q++) if (F[q] > vmax) vmax = F[q];
    if (!isFinite(vmax)) return null;
    var out = [];
    /* ★ 从 2 度起画：1 度等震线的物理阀值只有 0.1 cm/s（几乎无感），
       但它的范围能铺满半个中国 —— 实际烈度图上从来没人画。 */
    for (var lv = 2; lv <= 12; lv++) {
      var thr = EDGES[lv - 1];
      if (!(vmax >= thr)) break;                    /* 峰值都够不到，更高档必然没有 */
      var segs = marchSquares(F, nx, ny, lonA, latA, step, thr);
      if (segs.length) out.push({ level: lv, segs: segs });
    }
    return out.length ? out : null;
  }

  /** 网格 F(nx×ny) 上阈值为 thr 的等值线 → [[lon1,lat1,lon2,lat2], …] */
  function marchSquares(F, nx, ny, lonA, latA, step, thr) {
    var segs = [];
    function V(i, j) { return F[j * nx + i]; }
    function it(a, b, va, vb) { return a + (b - a) * ((thr - va) / (vb - va)); }
    for (var j = 0; j < ny - 1; j++) {
      var y0 = latA + j * step, y1 = y0 + step;
      for (var i = 0; i < nx - 1; i++) {
        var v0 = V(i, j), v1 = V(i + 1, j), v2 = V(i + 1, j + 1), v3 = V(i, j + 1);
        if (!(isFinite(v0) && isFinite(v1) && isFinite(v2) && isFinite(v3))) continue;
        var code = (v0 >= thr ? 1 : 0) | (v1 >= thr ? 2 : 0) |
                   (v2 >= thr ? 4 : 0) | (v3 >= thr ? 8 : 0);
        if (code === 0 || code === 15) continue;
        var x0 = lonA + i * step, x1 = x0 + step;
        var bx = it(x0, x1, v0, v1), by = y0;          /* 下边 v0→v1 */
        var rx = x1, ry = it(y0, y1, v1, v2);          /* 右边 v1→v2 */
        var tx = it(x0, x1, v3, v2), ty = y1;          /* 上边 v3→v2 */
        var lx = x0, ly = it(y0, y1, v0, v3);          /* 左边 v0→v3 */
        if (code === 1 || code === 14) segs.push([lx, ly, bx, by]);
        else if (code === 2 || code === 13) segs.push([bx, by, rx, ry]);
        else if (code === 3 || code === 12) segs.push([lx, ly, rx, ry]);
        else if (code === 4 || code === 11) segs.push([rx, ry, tx, ty]);
        else if (code === 6 || code === 9) segs.push([bx, by, tx, ty]);
        else if (code === 7 || code === 8) segs.push([lx, ly, tx, ty]);
        else if (code === 5) { segs.push([lx, ly, bx, by]); segs.push([rx, ry, tx, ty]); }
        else if (code === 10) { segs.push([lx, ly, tx, ty]); segs.push([bx, by, rx, ry]); }
      }
    }
    return segs;
  }

  function ensureIsoLayer() {
    var hn = document.getElementById('map');
    if (!hn) return null;
    if (isoHost && isoHost.parentNode === hn) {
      if (!isoG || isoG.parentNode !== isoSvg || !isoGWhite || isoGWhite.parentNode !== isoSvg) {
        isoSvg.innerHTML = '';
        isoGWhite = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        isoG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        isoSvg.appendChild(isoGWhite);     /* 白底在下 */
        isoSvg.appendChild(isoG);         /* 彩线在上 */
        isoEls = [];
      }
      return isoHost;
    }
    if (!isoHost) {
      isoHost = document.createElement('div');
      isoHost.id = 'mapisoline';
      /* z-index 7：压在行政区填色(5) 之上、震中标记层之下 */
      isoHost.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:7';
      isoSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      isoSvg.setAttribute('style', 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none');
      isoGWhite = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      isoG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      isoSvg.appendChild(isoGWhite);
      isoSvg.appendChild(isoG);
      isoHost.appendChild(isoSvg);
    }
    hn.appendChild(isoHost);
    return isoHost;
  }

  function paintIso() {
    if (!isoLines || !isoLines.length) {
      for (var h = 0; h < isoEls.length; h++) {
        isoEls[h].w.setAttribute('display', 'none');
        isoEls[h].c.setAttribute('display', 'none');
      }
      return;
    }
    if (!ensureIsoLayer()) return;
    var pxu = T.A * cam.k;
    var tx = cam.tx, ty = cam.ty;
    function rawx(lon) { return tx + pxu * (mapXOf(lon) - T.MINX); }
    function sy(lat) { return ty + pxu * (T.MAXY - mapYOf(lat)); }
    var LIE = global.QV_LIEDU;
    var list = [];
    for (var i = 0; i < isoLines.length; i++) {
      var line = isoLines[i], d = '';
      for (var s = 0; s < line.segs.length; s++) {
        var g2 = line.segs[s];
        d += 'M' + rawx(g2[0]).toFixed(1) + ' ' + sy(g2[1]).toFixed(1) +
             'L' + rawx(g2[2]).toFixed(1) + ' ' + sy(g2[3]).toFixed(1);
      }
      if (!d) continue;
      list.push({ d: d, color: LIE ? LIE.colorOf(line.level) : '#3098bd' });
    }
    while (isoEls.length < list.length) {
      var wl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      wl.setAttribute('fill', 'none');
      wl.setAttribute('stroke', 'rgba(255,255,255,0.55)');
      wl.setAttribute('stroke-width', '3');
      wl.setAttribute('stroke-linecap', 'round');
      isoGWhite.appendChild(wl);
      var cl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      cl.setAttribute('fill', 'none');
      cl.setAttribute('stroke-width', '1.6');
      cl.setAttribute('stroke-linecap', 'round');
      isoG.appendChild(cl);
      isoEls.push({ w: wl, c: cl });
    }
    for (var k = 0; k < isoEls.length; k++) {
      var it2 = isoEls[k];
      if (k >= list.length) {
        it2.w.setAttribute('display', 'none');
        it2.c.setAttribute('display', 'none');
        continue;
      }
      it2.w.removeAttribute('display');
      it2.w.setAttribute('d', list[k].d);
      it2.c.removeAttribute('display');
      it2.c.setAttribute('d', list[k].d);
      it2.c.setAttribute('stroke', list[k].color);
    }
  }

  /** 跟随选中地震；手动动过之后不抢（除非选中项变了）
   *  ★ 2026-10-10：加了 `force` —— 用户【主动点震中标记】时要能无视「自动移动镜头」
   *     那个设置项把相机拉过去（否则关掉自动跟随就点不动了）。 */
  function focus(q, force) {
    if (!view) init();
    if (!view) return;
    lastQ = q || null;
    if (!opts.follow && !force) return;         /* 设置页关掉「自动移动镜头」→ 不抢相机 */
    /* ★ 超出日本图经纬度范围（海外）→ 切【世界地图】；官方也是这么分的（地図拡大モード） */
    /* ★ 2026-10-29：震源未定（坐标是 null）也不能当成 (0,0) —— hasLL 一律走全日本 */
    var ok = hasLL(q);
    var key = ok ? (q.id + '@' + q.lat + ',' + q.lon + ',' + q.mag) : 'none';
    if (key === lastKey) return;      /* 选中项没变 → 不抢相机（手动缩放/拖动后保持） */
    lastKey = key; manual = false;
    if (!ok) { applyTier('jp'); apply(home.lat, home.lon, home.k); return; }
    /* ★ 缩放值：日本区域用 zoomForMag；wlg 覆盖区用 zoomForMagG；其余用 zoomForMagW
         再乘设置页「切换时的缩放率」（默认 100%） */
    var zr = opts.zoomRate || 1;
    var kk = inAtlas(q.lat, q.lon) ? zoomForMag(q.mag) * zr
      : (inWlg(q.lat, q.lon) ? zoomForMagG(q.mag) * zr : zoomForMagW(q.mag) * zr);
    /* ★ 档位由「（震中、该缩放对应的跨度）」决定 —— 与手动缩放走同一套 tierFor
         下地：海底层 + 世界图（近广域 = wlg ／ 极缩 = outsvg）
         地図スタンプ：nb（日本陆地+县境）/ nf（海岸线）**两种模式都盖在最上面**
       ⇒ 世界图里日本被挖空了也不怕，日本由 nb 补上。 */
    applyTier(tierFor(q.lat, q.lon, kk));
    apply(q.lat, q.lon, kk);
  }

  /* ★★★ 2026-10-25 地图市级边界：**不再实时画**。
     用户：「方案不应该是缺瓦片就重新去渲染一个吗，实时渲染卡的要命的呀」
     静态瓦片 z5/z6/z7 里缺地级市边界的那 363 块已经离线重画好（写回同名 PNG，
     原图备份在 assets/kvtiles/_orig/），前端一行实时绘制都不需要。
     历史（别再踩）：
       · SVG 巨型 path（1.5MB）塞 #mapoverlay → 每帧重新栅格化，帧时间 158ms（will-change 更糟 823ms）
       · canvas + 预建 Path2D → 每帧 +8ms，仍然白花
     真正的病根是「瓦片精度不一致」，只能补瓦片。 */

  global.QVMapCam = {
    init: init, focus: focus, fit: fit, frame: frame,
    /* ★ 2026-11-03：强制重画一帧。天体模式切换后必须立刻重绘
       （paint 平时只在相机变化时被调，静态时不会自己跑）。 */
    refresh: function () { try { paint(); } catch (e) { } },
    setOpts: function (o) { for (var k in o) opts[k] = o[k]; },
    /** 调试：focus() 为什么没动？（排查「点药丸相机不动」时加的） */
    debug: function () {
      return { hasView: !!view, follow: opts.follow, manual: manual, lastKey: lastKey,
        lastQ: lastQ ? (lastQ.id || '?') : null, mode: mode, tier: tier,
        k: cam ? cam.k : null, tx: cam ? cam.tx : null, ty: cam ? cam.ty : null,
        vis: VIS, minx: T.MINX, maxy: T.MAXY, A: T.A, W: T.W, H: T.H };
    },
    setPin: setPin, setPins: setPins, lockPin: lockPin,
    /** ★ 检测态（揺れを検出）：压住红叉 / 波圆；并画官方矩形范围框 */
    setDetectMode: setDetectMode, setBoxes: setBoxes,
    /* ★ 2026-10-21 中国烈度色块（地级市轮廓填充） */
    setAreaFill: setAreaFill, parseAreaPolys: parseAreaPolys,
    /* ZQuake：常驻区域分界线开关 */
    setZqBorders: function (on) { zqOn = !!on; zqStride = -1; },
    /* ZQuake：自动镜头开关（用户手动拨动地图后自动关闭，点按钮可重新打开） */
    setAutoCam: function (on) {
      userCamLock = !on;
      if (!userCamLock) { manual = false; lastKey = ''; autoK0 = 0; autoK = 0; }
      return !userCamLock;
    },
    isAutoCam: function () { return !userCamLock; },
    /** ★ 2026-10-26：填色层方形数字的开关（只有正式报打开） */
    setAreaBadge: setAreaBadge,
    setTsuMode: setTsuMode,
    /* ★ 2026-10-21 等烈度线（等震线）：pts = [{lon,lat,v}]，v 是连续烈度 I */
    setIsoPoints: setIsoPoints,
    isoCount: function () { return isoLines ? isoLines.length : 0; },
    /** ★ 模拟地震用：舞台逻辑坐标 → 经纬度（点地图选震心） */
    latLonAt: function (sx, sy) {
      if (!view) init();
      var r = s2ll(sx, sy);
      if (!isFinite(r[0]) || !isFinite(r[1])) return null;
      /* 经度必须折回 (-180,180]：s2ll 走的是未归一化的 lonOfMap，
         否则点地图会得到 -188.4 这种“越界经度”（卡片/数据都难看） */
      return [Math.max(-85, Math.min(85, r[0])), normLon(r[1])];
    },
    /** ★ 模拟地震的 P/S 波圆：传对象开始，传 null 停止。
     *  o = { lat, lon, t0(毫秒), level(震度码), mag } */
    simWave: function (o) {
      if (!o) { simWave = null; hideWaves(); return; }
      simWave = { lat: +o.lat, lon: +o.lon, t0: +o.t0 || Date.now(),
        boxUntil: Date.now() + BOX_MS, boxAge: 0,
        level: (o.level == null ? -1 : o.level), mag: o.mag,
        depth: (isFinite(o.depth) ? +o.depth : 10),
        /* ★★★ 2026-10-20 修「检测态响一下整个画面就卡死」：
           检测态的 simWave 带 `rings:false`（只要时钟、不要 P/S 圆），
           但这个字段**以前没被复制** → simWave.rings 恒为 undefined
           → setBoxes()/setDetectMode() 里 `rings !== false` 成立
           → 每次重画范围框（每报都会 rebuildAreas→setBoxes）就把 simWave 清成 null
           → 模拟时钟 wavePKm / waveSec 从此不再前进
           → 测站不点亮、框不更新、只剩顶部时钟在走。 */
        rings: (o.rings === false) ? false : true,
        /* ★ 2026-10-28：深源地震（≥150km）的「加载动画」从 simWave 创建时刻开始计时 */
        deep: o.deep ? 1 : 0,
        spinAt: Date.now(),
        /* ★ 2026-10-20：autoFit 默认关（旧值 !false = true）→ 波形不再抢相机 */
        autoFit: o.autoFit === true };
      tickWaves();
    },
    stopSimWave: function () { simWave = null; hideWaves(); setEewPinAlpha(1); },
    /** ★ 模拟专用：正式报发布后冻结波前（停在已扩到的最大半径，不再继续外扩）。
        graceMs>0 表示「再宽容 graceMs 毫秒后才冻结」，让波前把受灾范围画满。 */
    freezeSimWave: function (graceMs) {
      if (!simWave) return;
      var spd = (+simWave.speed > 0) ? +simWave.speed : 1;
      var el = (Date.now() - (simWave.t0 || Date.now())) / 1000 * spd;
      simWave.freezeSec = el + (graceMs || 0) / 1000;
    },
    /** ★ 2026-10-27 调试面板暂停后恢复：把波源时间轴后移 ms（波前不跳） */
    shiftWave: function (ms) { if (simWave && simWave.t0 && ms > 0) simWave.t0 += ms; },
    /** ★★★ 2026-10-25 用户：「跳过阶段那个同心圆没跳过啊」
     *   —— P/S 同心圆是从 `simWave.t0` 按【真实时间】算半径的（sec = now - t0），
     *      所以 Enter 跳过阶段只换了卡片/色块，圆还在原地按原来速度慢慢长。
     *   ⇒ 「跳过」= 波已经扫完全部测站：清掉同心圆，并把 wavePKm / waveSec
     *      推到「已到达全部」，后面的 rebuildAreas / obsMaxShindo / autoFrame
     *      一律按「全部到达」算。
     *   （进入「调查中」时也调这个：官方那张图只有行政区色块，没有 P/S 圆。） */
    finishWave: function () {
      simWave = null;
      hideWaves();
      wavePKm = 999999;
      waveSec = 999999;
      setEewPinAlpha(1);
    },
    waveColor: waveColor,
    /** ★ 2026-10-27 官方「検出円」（摇晃检测 / 紧急地震速报 共用）
     *  o = { lat, lon, lv(震度码), rKm } ；传 null 立即清除。 */
    /** ★ 2026-10-27 官方「検出円」（测站上的短提示，0.5~1.2s 后自己消失）
     *  o = { lat, lon, lv(震度码), lifeMs } ；clearDetPulse() 可一键清掉 */
    detPulse: detPulse,
    clearDetPulse: clearDetPulse,
    detCircleIndex: detCircleIdx,
    /** 当前相机中心 [lat, lon]（views 的 ?detdemo=1 调试循环要用） */
    center: camCenter,
    /* 调试用：强制画一帧（rAF 被后台节流时，控制台里手动验证用） */
    drawDetCircle: drawDetCircle,
    /** ★ 2026-10-20 views.rebuildAreas 用：P 波已经走到的公里数。
     *  「P 波没到，数据先行」的修法就是按这个值过滤测站。 */
    wavePkm: function () { return wavePKm; },
    waveS: function () { return waveSKm; },
    /** ★ 2026-10-28：波前已经走过的秒数（views.enterJishin 算 S 波半径用） */
    waveSec: function () { return waveSec; },
    /** ★ 官方 `JMA2001距離近似`（views.js 算起始镜头用） */
    jma2001Dist: jma2001Dist,
    /** ★ 官方「自动镜头」：把半径 km 的同心圆装进可视区 */
    fitCircle: fitCircle,
    /** ★ 模拟测站（EEW 地图上的彩色点） */
    setStations: setStations,
    setStationsHidden: setStationsHidden, clearStations: clearStations,
    setLegend: setLegend,
    /** 设置页接线：follow/anim/world/pinScale/zoomRate/autoHide/layerBtn */
    setOpts: function (o) {
      if (!o) return;
      var worldWas = opts.world;
      for (var k in o) opts[k] = o[k];
      if (worldWas !== opts.world && !opts.world && view) { applyTier('jp'); apply(home.lat, home.lon, home.k, true); }
      if (o.pinScale != null) paint();
    },
    opt: function (k) { return opts[k]; },
    zoom: function (f2) { manual = true; userCamLock = true; zoomAt(f2, VIS.cx, VIS.cy); },
    pan: function (dx, dy) { manual = true; userCamLock = true; panBy(dx, dy); },
    uiRight: function () { return UI_RIGHT; },
    setStage: setStage,
    reset: function () {
      manual = false; lastKey = '';
      /* ★ 必须**先换档再 apply**：apply() 按 mode 选投影（toAtlas / toAtlasW）。
         以前只调 apply(home…) —— 从世界图取消回来时 mode 还是 'world'，
         于是「坐标回到日本、画的却是世界图」（日本那块又糊又错位）。 */
      applyTier(tierFor(home.lat, home.lon, home.k));
      apply(home.lat, home.lon, home.k);
    },
    setCenter: function (lat, lon, k2) { manual = true; userCamLock = true; apply(lat, lon, k2); },
    /** ★★★ 2026-10-28 官方 `カメラ自動移動要求(x, y, 倍)` 的等价物：
         「カメラ系[19]←1, [20]←x, [21]←y, [22]←now, [6]←倍」= 无视滞回、无视 manual，
         直接把镜头摆到指定位置（阶段切换 / 强制聚焦时用）。 */
    requestMove: function (lat, lon, k2) {
      if (!view) init();
      if (!view || !isFinite(lat) || !isFinite(lon)) return false;
      /* ★ ZQuake：用户手动拨动过地图 → 自动镜头不再抢（除非点「自动操作地图」）。 */
      if (userCamLock) return false;
      manual = false; lastKey = '';
      var kk = isFinite(k2) ? clamp(+k2, K_MIN, K_MAX) : cam.k;
      applyTier(tierFor(lat, lon, kk));
      apply(lat, lon, kk);
      return true;
    },
    /** ★ 自建地图开关（kondz-map 瓦片）：关掉官方 6 层素材，改用瓦片金字塔。
        只负责显隐与重绘，不碰相机（想保留视野就把当前中心原样传回去）。 */
    setOwnMap: function (on) {
      ownMap = !!on;
      if (view) {
        if (ownMap) hideOfficial(true);
        else { var ll = camCenter(); applyTier(tier); apply(ll[0], ll[1], cam.k, true); }
      }
      paint();
      return ownMap;
    },
    ownMap: function () { return ownMap; },
    isDragging: function () { return dragging; },
    at: toAtlas,
    /** 舞台逻辑像素 → **日本图集像素**（#mapoverlay 用的就是这套，scale 只乘 cam.k，
     *  世界档的 WSC 只影响官方世界图层，不作用于 overlay）；coast-base.js 算视野框用 */
    toAtlasXY: function (sx, sy) {
      var kk = cam.k || 1e-6;
      return [(sx - cam.tx) / kk, (sy - cam.ty) / kk];
    },
    bounds: B,
    state: function () {
      var ke = cam.k * mS();
      var ax = (VIS.cx - cam.tx) / ke, ay = (VIS.cy - cam.ty) / ke;
      var ll;
      if (mode === 'world' && W) {
        ll = [latOfMap(T.MAXY - ay / W.A2), lonOfMap(T.MINX + ax / W.A2)];
      } else {
        ll = toLatLon(ax, ay);
      }
      ll[1] = normLon(ll[1]);                      /* 同上：经度必须折回 (-180,180] */
      return { lat: ll[0], lon: ll[1], k: cam.k, mode: mode, tier: tier, manual: manual, atlas: { w: mW(), h: mH() } };
    }
  };
})(window);
