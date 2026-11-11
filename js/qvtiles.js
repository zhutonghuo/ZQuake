/* qvtiles.js — 自建瓦片金字塔图层（kondz-map）
 *
 * 为什么要有这一层：官方那 6 张素材图是「整张位图 / 整张 SVG」，
 * 全世界只有 5px/°（1800px/360°）、广域档才 ~10px/° —— 一放大就糊，
 * 而且没法再提高（整张图放大会炸内存）。改成【按需取瓦片】就没有上限。
 *
 * 投影与地图单位跟官方完全一致（同一套 mapX/mapY 公式），所以这一层能直接
 * 叠在官方图层上面，零调参、不错位：
 *     mapX = 10*(mod(lon+44,360)-180)
 *     mapY = MAPK*ln(tan(45+lat/2)) - MAPY0
 *   屏幕点 = cam.t + (10*cam.k) * (地图单位 - 原点)      ← 与 mapcam 的 atlas 变换等价
 *
 * 瓦片：z 级 → 2^z × 2^z 块，每块 512px，覆盖 span = 3600/2^z 个地图单位。
 *   选层：z = ceil(log2(3600*(10k)/512)) = ceil(log2(70.3125*k))
 *   ⇒ 瓦片在屏幕上的边长落在 (256, 512] px —— 【只缩小不放大】＝ 永远不糊。
 *   上限 z8（364px/°）；z9 与 z8 肉眼看不出差别，已删。
 *
 * 本层是【屏幕空间】图层（和 #mappins 一样），不走 transform，
 * 所以不需要官方那套 reRaster 重栅格化，放大时直接换更高级别的瓦片。
 */
(function (global) {
  'use strict';

  /* 官方图集常量（与 mapcam.js 的 T 一致） */
  var A = 10, MINX = -130.638978, MAXY = 138.909650;
  /* 瓦片世界方块：mapX ∈ [W0, W0+3600]，mapY 上边缘 = N0 */
  var W0 = -3160, N0 = 1425.9522, SPAN0 = 3600;
  var TILE = 512;
  var ZMIN = 3, ZMAX = 8;

  /* ★★ 2026-10-13：改成「先内置静态瓦片、缺块才回退按需服务」。
     以前 http 开发页直接指向 `127.0.0.1:8891` —— 那个服务没起/半死/慢，
     整张地图就是空的（用户：「地图都是半坏的」「空白」「概率显示」）。
     现在 `app/assets/kvtiles/` 里预存了 z3..z8 共 897 块（世界 + 日本），
     静态目录里没有的那块才去问按需服务（本机开发时才有，打包版没有也不影响）。 */

  /* ★★★ 2026-10-15 用户重定的「地图级别切换」表（视野跨度 → 最高层级）。
     读法：视野【大于】该度数时使用这一行的 maxZ；最后一行 span=0 是兜底
           （比它更近的档全部用它）。
     度量 = 可视经度跨度 span(°)（从世界逐级放大）：
       世界/亚洲（2.8 千公里宽 / 中国一半）→ 中国（1.3 千公里宽 / 一个省）
       → 省 / 广东（668 公里宽）→ 市 / 珠三角（278 公里宽）→ 区 / 街道（最深）。
     ⚠️ 这张表只管【封顶】：真正用哪一级还要与 levelFor 里
        「瓦片在屏幕上的边长落在 256~512px」那条取小的那个（表格负责别越界）。
     要调整/加档只改这张表（阈值从上到下递减，最后一条是兜底）。 */
  var SPAN_CAP = [
    { span: 25, maxZ: 5, name: '世界 / 亚洲' },      /* 2.8 千公里宽 / 中国一半 */
    { span: 12, maxZ: 6, name: '中国' },             /* 1.3 千公里宽 / 一个省（广东东西约 800km） */
    { span: 6, maxZ: 6, name: '省（广东）' },         /* 668 公里宽 / 半个省 / 日本关东 */
    { span: 2.5, maxZ: 7, name: '市（珠三角）' },      /* 278 公里宽 / 一个大城市圈（北京六环约 200km） */
    { span: 0, maxZ: 7, name: '区 / 街道（最深）' },   /* 兜底（比原来再高一级） */
  ];
  function capFor(span) {
    for (var i = 0; i < SPAN_CAP.length; i++) if (span > SPAN_CAP[i].span) return SPAN_CAP[i].maxZ;
    return SPAN_CAP[SPAN_CAP.length - 1].maxZ;
  }
  function capName(span) {
    for (var i = 0; i < SPAN_CAP.length; i++) if (span > SPAN_CAP[i].span) return SPAN_CAP[i].name;
    return SPAN_CAP[SPAN_CAP.length - 1].name;
  }

  /* ★★ 2026-10-15 瓦片 URL 带版本号：nginx 给 PNG 是 `max-age=2592000`（**30 天**强缓存），
     而瓦片被重渲染过（海深/陆地/配色都改过）→ 用户浏览器里会【新旧瓦片混着显示】
     → 屏上突然出现一个“实心暗色方块”（旧瓦片）或黑洞（旧瓦片是空的）。
     ⚠️ 每批瓦片重渲染后把 TILE_V 改一下（改成日期即可）。 */
  var TILE_V = '20261025a';
  var STATIC = 'assets/kvtiles/z{z}/{x}_{y}.png?v=' + TILE_V;   /* ⚠️ 目录名带 z 前缀（与 kondz-map 的缓存一致） */
  var CONF = {
    url: (global.QV_TILE_URL || STATIC),
    /* ★★ 2026-10-13：按需瓦片服务**只有本机开着**（127.0.0.1:8891）。
       部署到 https://blog.konwk.com/eew/ 之后，如果还回退到 http://127.0.0.1:8891，
       那是【访客自己的机器】✗ → 一堆失败请求 + https 页面里发 http 的混合内容告警。
       ⇒ 只有 hostname 是 localhost/127.0.0.1 时才启用这个回退。 */
    /* ★ 2026-10-20 用户报「地图有时候会被切块乱」：
       静态瓦片里缺的那些块会回退到 http://127.0.0.1:8891（按需瓦片服务），
       但那个服务平时根本没起 → 每块都是 CONNECTION_REFUSED，
       要等 RETRY_MS 冷却、最多重试 4 次才放弃 → 期间那些块就是**空的**，
       一屏里有的块有图、有的块没图 = 看到一格一格的色块拼接。
       关掉回退：缺块当场认输（只显示底色），不再刷几十条失败请求。
       真要补地形，应该补 assets/kvtiles/ 里的静态块，而不是靠这个本地服务。 */
    fallback: '',
    on: true,            /* ★ 默认开：官方 6 层素材已经全部被它取代 */
    /* ★★ 2026-10-15：池子从 96 提到 176 —— 最小缩放时一屏要同时摆
       「世界方块 + 相邻副本」约 130 个位置（z3 瓦片屏上只有 85px 边长），
       池子不够就会出现「一屏里一块一块缺」= 用户报的「覆盖不全屏幕」。 */
    pool: 176,
    debug: false,
    budget: 10,          /* 每帧最多新发几个瓦片请求（狂拖时防请求风暴） */
    keep: 0.92,          /* ★ 新档铺到 92% 才让旧档淡出（以前 0.6 → 一半就抽走，闪） */
    fade: 300,           /* 淡入/淡出时长 ms（无缝换图的关键） */
    prefetch: true,      /* 本档铺满后悄悄预取「放大一档」中心几块 → 下次放大秒出 */
    readyAt: 0.4         /* 已显示 / 需要 ≥ 这个比例 → 认为这一屏有图 */
  };

  var host = null, layer = null;
  var cells = [];          /* {el,key,z,ix,iy,iv,gen,want,loaded,shown} */
  /* ★★ 2026-10-13：普通瓦片加载失败不再【永久拉黑】。
     旧写法一次 onerror 就 `broken[key]=1` 永不再发 →
       瓦片服务刚起/抖一下/被中断一次，那块就永远是空的（除非刷新页面）。
       用户报的「地图都是半坏的 / 空白 / 概率显示」就是这个。
     现在：记录次数与时间，冷却 RETRY_MS 后再试，最多 MAX_TRY 次；
           连续失败到上限才真正放弃（真·404）。 */
  var RETRY_MS = 5000, MAX_TRY = 4;
  var broken = {};         /* key → { n: 失败次数, t: 时间戳 } */
  function badNow(key) {
    var f = broken[key];
    if (!f) return false;
    if (f.n >= MAX_TRY) return true;                 /* 真拿不到，放弃 */
    if (Date.now() < f.t + RETRY_MS) return true;    /* 冷却中，本轮先不重发 */
    delete broken[key]; return false;                /* 冷却结束 → 允许再试 */
  }
  function markFail(key) {
    if (!key) return;
    broken[key] = { n: (broken[key] ? broken[key].n : 0) + 1, t: Date.now() };
    stat.miss++;
  }
  var curZ = -1, curGen = 1;
  /* ★★ 2026-10-15：预算（每帧最多 10 块）用完后自己排帧继续铺用的状态 */
  var lastCam = null, lastVis = null, rafPend = 0, budgetRuns = 0;
  var preKeys = {}, preImgs = [];      /* 预取去重表 + 保活用的 <img>（被 GC 会把请求一起取消） */
  var stat = { z: 0, want: 0, have: 0, miss: 0, gen: 1, newReq: 0, pending: 0, capSpan: 0, capZ: 0, capName: '' };

  function mkCell() {
    var im = document.createElement('img');
    im.draggable = false;
    im.decoding = 'async';
    /* ★★ 2026-10-13 无缝换档：瓦片不再是「弹出来」，而是 opacity 0→1 淡入。
       配合旧一代继续显示（缩放放大 = 糊）→ 视觉上就是「模糊 → 渐变清晰」。 */
    im.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;display:none;' +
      'pointer-events:none;user-select:none;opacity:0;' +
      'transition:opacity ' + (CONF.fade / 1000) + 's linear';
    var c = { el: im, key: '', pos: '', z: 0, ix: 0, iy: 0, iv: 0, gen: 0, want: false, loaded: false, shown: false, alt: 0, retiring: 0, _p: 0, fb: 0 };
    im.onload = function () {
      c.loaded = true;
      if (c.key && broken[c.key]) delete broken[c.key];     /* 好了就销掉失败记录 */
      /* 只要还属于当前代或当前帧需要 → 上屏（跨档保留也靠这一句）+ 淡入；
         ★ fb=1（上一层兜底的图）也要上屏，否则缺块永远空着 */
      if (c.want || c.gen === curGen || c.fb) {
        c.shown = true;
        im.style.display = '';
        im.style.opacity = '1';
        /* ★★★ 2026-10-21 「块乱摆」真因二：
           图是异步到的，onload 时【必须用最新相机重新摆位】。
           以前只在 update() 里统一摆，而相机一停就不再调 update()
           → 晚到货的瓦片就一直用「发请求那一帧」的 left/top/width（旧缩放），
             屏幕上就是「一块大、一块小、还錯位」。 */
        if (lastCam && lastVis) placeCell(c, lastCam, lastVis, A * lastCam.k);
      }
    };
    im.onerror = function () {
      /* ① 静态目录里没这块 → 换按需渲染服务再试一次（本机开发时有） */
      if (CONF.fallback && c.key && !c.alt) {
        c.alt = 1;
        im.src = CONF.fallback.replace(/\{z\}/g, c.z).replace(/\{x\}/g, c.ix).replace(/\{y\}/g, c.iy);
        return;
      }
      /* ★★★ 2026-10-21 「块乱码」的真正修法：
         我们只渲过日本周边，所以某个别的这块 404 时，**退回上一级的同一位置**：
           z7(113,50) 没图 → 用 z6(56,25) 铺到 z7 那块的两倍大小位置上；
           再没图 → 继续退到 z5/z4/z3（z3 全球齐）。
         ⇒ 缺块时看到的是「更粗但位置、范围完全对的图」，不会是黑方块，
           也不会出现「下一个层级的图乱摆到别的位置」（上一级格子的索引就是 /2） */
      if (c.z > ZMIN) {
        if (c.key) markFail(c.key);               /* 这一级的这块以后别再反复要 */
        var pz = c.z - 1, pn = 1 << pz;
        var piv = Math.floor(c.iv / 2), piy = Math.floor(c.iy / 2);
        var pix = ((piv % pn) + pn) % pn;
        c.z = pz; c.iv = piv; c.iy = piy; c.ix = pix;
        c.key = pz + '/' + pix + '_' + piy;
        c.fb = 1;                                 /* 标记：这一格是「上一层兜底」的 */
        c.alt = 0; c.loaded = false; c.shown = false;
        /* ★★★ 2026-10-21 真正的「块乱摆」元凶：
           以前这里只把 loaded 置 false 就换 src，**元素却还显示着上一张图**，
           而摆位循环开头就是 `if (!c.loaded || !c.shown) continue;`
           → 这张旧图【永远不会再被重新定位】，就死死钉在上一帧的位置上，
             尺寸还是上一次缩放时的大小（屏幕上就是「一块大、一块小、还错位」）。
           修法：先立即隐藏 + 清掉旧几何，等新图 onload 再上屏。 */
        im.style.display = 'none';
        im.style.left = '0px'; im.style.top = '0px';
        im.style.width = '0px'; im.style.height = '0px';
        im.src = tileUrl(pz, pix, piy);
        return;
      }
      /* ③ 连最粗一级都没有 → 只能藏起来 */
      markFail(c.key);
      c.alt = 0;
      c.loaded = false; c.shown = false; c.want = false;
      im.style.display = 'none'; im.removeAttribute('src');
    };
    im._c = c;
    return c;
  }

  function init(mapHost) {
    if (layer) return;
    host = mapHost || document.getElementById('map');
    if (!host) return;
    layer = document.createElement('div');
    layer.id = 'maptiles';
    /* 屏幕空间：不参与 #stage 的图集缩放，逐帧写 left/top/宽高；
       铺满 #map，靠 overflow:hidden 裁掉屏幕外的瓦片 */
    layer.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;' +
      'overflow:hidden;pointer-events:none';
    for (var i = 0; i < CONF.pool; i++) {
      var c = mkCell();
      cells.push(c);
      layer.appendChild(c.el);
    }
    host.appendChild(layer);
    apply2();
  }

  /* 显隐 */
  function apply2() {
    if (!layer) return;
    layer.style.display = CONF.on ? '' : 'none';
  }
  function setEnabled(v) { CONF.on = !!v; apply2(); return CONF.on; }
  function isOn() { return CONF.on; }
  function setUrl(u) { if (u) CONF.url = u; broken = {}; curZ = -1; }
  function setDebug(v) { CONF.debug = !!v; }
  function stats() { return stat; }
  function tileUrl(z, x, y) {
    return CONF.url.replace(/\{z\}/g, z).replace(/\{x\}/g, x).replace(/\{y\}/g, y);
  }

  /**
   * 选层：按「够用即止」的缩放推 z，再用【地区跨度上限】封顶。
   * @param px    每地图单位多少屏幕像素
   * @param cur   当前层（用于死区滞回）
   * @param span  可视经度跨度（度）—— 决定这一片最多用哪一级
   */
  function levelFor(px, cur, span) {
    /* px = 每地图单位多少屏幕像素；瓦片原生 512px/块 → 取「够用即止」的那一级 */
    var z = Math.ceil(Math.log2(SPAN0 * px / TILE));
    z = z < ZMIN ? ZMIN : (z > ZMAX ? ZMAX : z);
    /* ★★ 2026-10-14 地区上限：用户要求「放大到某个级别就不要往上叠加了」。
       表格见 SPAN_CAP（世界/亚洲 z3、中国 z4、广东 z6、珠三角·珠海 z7）。
       超出上限时就算相机再放大，也只放大同一级瓦片（变糊一点点），不再换更细的层。 */
    var cap = (span > 0) ? capFor(span) : ZMAX;
    if (z > cap) z = cap;
    /* ★★ 2026-10-13 死区（滞回）：缓慢滚动缩放时，瓦片边长在 256/512 边界附近来回穿越
       → z 反复跳变 → 一代接一代地重建，看着就是「一直闪、一直加载」。
       现在：当前档的边长只要还在 220~760px 之间就不换档。 */
    if (cur >= ZMIN && cur <= ZMAX && cur <= cap) {
      var twCur = px * (SPAN0 / (1 << cur));
      if (twCur > 220 && twCur < 760) return cur;
    }
    return z;
  }

  /** 这一屏「有没有我们的图」—— mapcam 用它决定要不要让官方素材兜底 */
  function ready() {
    if (!CONF.on) return false;
    return stat.have >= Math.max(3, Math.ceil(stat.want * CONF.readyAt));
  }

  /** 把一个瓦片按【指定相机】摆到位；返回是否在屏内。
   *  ★★★ 2026-10-21「块乱摆」真因：以前只有 update() 里统一摆位，
   *  而图是**异步到货**的 —— 相机停下后不会再有 update()，
   *  于是晚到的那几张就永远停在「发请求那一帧」的 left/top/width 上
   *  （缩放变过 → 尺寸还是旧的）＝ 屏幕上「一块大一块小、还错位」。
   *  现在 onload 里也调这个函数，用最新相机重摆一次。 */
  function placeCell(c, cam, vis, px) {
    var sp = SPAN0 / (1 << c.z);
    var l2 = cam.tx + px * (W0 + c.iv * sp - MINX);
    var t3 = cam.ty + px * (MAXY - (N0 - c.iy * sp));
    var w2 = px * sp;
    if (l2 > vis.x1 + w2 || l2 + w2 < vis.x0 || t3 > vis.y1 + w2 || t3 + w2 < vis.y0) {
      c.el.style.display = 'none';                       /* 出屏就藏（旧代尤其要） */
      return false;
    }
    c.el.style.display = '';
    /* 兜底图（上一级）永远压在真瓦片下面 */
    c.el.style.zIndex = c.fb ? '1' : '2';
    /* ★ 多铺 1.5px：left/top 是浮点，取整后可能留出亚像素缝（看着像一条竖线）。
       只往右/下多画一点，不动 left/top → 地图不会相对震中标记偏 1px。 */
    c.el.style.left = l2.toFixed(2) + 'px';
    c.el.style.top = t3.toFixed(2) + 'px';
    c.el.style.width = (w2 + 1.5).toFixed(2) + 'px';
    c.el.style.height = (w2 + 1.5).toFixed(2) + 'px';
    return true;
  }

  /**
   * 每帧调用（mapcam.paint 里）。
   * @param cam  {tx,ty,k}   —— 舞台坐标（960x720 基准）
   * @param vis  {x0,x1,y0,y1} 可视区（地图真正露出来的那块）
   */
  function update(cam, vis) {
    if (!layer || !CONF.on) return;
    var px = A * cam.k;                    /* 屏幕像素 / 地图单位（各档位都一样） */
    if (!(px > 0)) return;
    /* 补帧要用最新相机（cam / vis 都是同一个对象，被 mapcam 就地改写） */
    lastCam = cam; lastVis = vis;
    /* ★ 可视经度跨度（度）：地图单位 10 个/度 → 跨单位数 / 10。
       用它查 SPAN_CAP 决定「这一片最多画到哪一级」（世界/亚洲/中国/广东/珠三角…） */
    var spanDeg = ((vis.x1 - vis.x0) / px) / 10;
    stat.capSpan = Math.round(spanDeg);
    stat.capName = capName(spanDeg);
    stat.capZ = capFor(spanDeg);
    var z = levelFor(px, curZ, spanDeg), n = 1 << z, span = SPAN0 / n;
    var tw = px * span;                    /* 瓦片在屏幕上的边长（256~512）*/

    /* ① 换档：开新的一代，旧一代先留着继续显示（★ 这就是「一缩放就黑」的修复） */
    if (z !== curZ) { curZ = z; curGen++; }

    /* ② 可视区反算地图单位范围 */
    var mx0 = MINX + (vis.x0 - cam.tx) / px, mx1 = MINX + (vis.x1 - cam.tx) / px;
    var myTop = MAXY - (vis.y0 - cam.ty) / px, myBot = MAXY - (vis.y1 - cam.ty) / px;

    /* 纵向：地图不绕（南北极没有环），直接夹到网格里 */
    var iy0 = Math.max(0, Math.floor((N0 - myTop) / span) - 1);
    var iy1 = Math.min(n - 1, Math.floor((N0 - myBot) / span) + 1);
    /* 横向：世界每 3600 单位重复一次 → 用【展开的虚拟列号】iv 走一遍，
       再取模得到真实瓦片号 ix，这样跨 180° 经线也不会断。 */
    var iv0 = Math.floor((mx0 - W0) / span) - 1;
    var iv1 = Math.floor((mx1 - W0) / span) + 1;
    if (iv1 - iv0 > 24) iv1 = iv0 + 24;    /* 安全阀 */

    var cx = (vis.x0 + vis.x1) / 2, cy = (vis.y0 + vis.y1) / 2;
    var need = [], i, c;
    for (var iv = iv0; iv <= iv1; iv++) {
      var ix = ((iv % n) + n) % n;
      for (var iy = iy0; iy <= iy1; iy++) {
        var key = z + '/' + ix + '_' + iy;
        if (badNow(key)) continue;                   /* 真拿不到的瓦片不再反复要 */
        var l = cam.tx + px * (W0 + iv * span - MINX), t = cam.ty + px * (MAXY - (N0 - iy * span));
        /* ★★ 2026-10-15 修「缩小到一定程度地图覆盖不全屏幕」：
           以前这里按 key 去重（seen），只留「虚拟列号最小」的那一份 —— 而世界每
           36000k 屏幕像素环绕一次，最小缩放时这个周期 ≈ 视口宽（684 vs 682）
           ⇒ 同一张瓦片【必须在屏上并排出现两份】，被去重丢掉的那一份正好是
             落在视口里的 → 右侧一条竖带没图。
           现在：每个位置（z/iv_iy，iv = 展开的虚拟列号，跨 180° 经线不断图）
           各占一个元素，同一 key 允许多个元素（URL 相同 = 浏览器缓存，不重复下载）。 */
        need.push({ key: key, pos: z + '/' + iv + '_' + iy, z: z, ix: ix, iy: iy, iv: iv,
          d: Math.abs(l + tw / 2 - cx) + Math.abs(t + tw / 2 - cy) });
      }
    }
    need.sort(function (a, b) { return a.d - b.d; });   /* 先要屏幕中心的 */

    /* ③ 认领元素：按 key 分组复用，一个 key 可以被【多个位置】同时认领
       （低倍率并排两个世界副本时），不够就再开一个元素。
       先统计每个 key 这一帧要几个位置 → 把已在池里的同 key 元素【保护】起来，
       免得 alloc() 把它们抢去当别的瓦片（会出现「张冠李戴」：错图摆在错位置）。 */
    var needCnt = {};
    for (i = 0; i < need.length; i++) needCnt[need[i].key] = (needCnt[need[i].key] || 0) + 1;

    var byKey = {};
    for (i = 0; i < cells.length; i++) {
      var kk = cells[i].key;
      if (kk) (byKey[kk] || (byKey[kk] = [])).push(cells[i]);
    }
    for (i = 0; i < cells.length; i++) { cells[i].want = false; cells[i]._p = 0; }
    for (var bk in byKey) {
      var lstP = byKey[bk], ncP = Math.min(needCnt[bk] || 0, lstP.length);
      for (i = 0; i < ncP; i++) lstP[i]._p = 1;
    }

    var claimed = {}, newReq = 0, pending = 0;
    for (i = 0; i < need.length; i++) {
      var t2 = need[i];
      var lst = byKey[t2.key] || [], ci = claimed[t2.key] || 0;
      if (ci < lst.length && lst[ci].key === t2.key) {
        c = lst[ci];                                     /* 已有同瓦片的元素 → 换到新位置 */
      } else {
        if (newReq >= CONF.budget) { pending++; continue; }   /* 本帧配额用完，下一帧再说 */
        c = alloc();
        if (!c) { pending++; continue; }                 /* 池子暂时给不出 → 也要补帧 */
        c.key = t2.key; c.z = t2.z; c.ix = t2.ix; c.iy = t2.iy;
        c.gen = curGen; c.loaded = false; c.shown = false; c.alt = 0; c.fb = 0;
        c.el.style.display = 'none';
        c.el.src = tileUrl(c.z, c.ix, c.iy);
        newReq++;
      }
      claimed[t2.key] = ci + 1;
      c.pos = t2.pos; c.iv = t2.iv; c.want = true;
      need[i].cell = c;
    }
    stat.newReq = newReq;
    stat.pending = pending;

    /* ④ 新档铺够比例 → 旧一代【淡出】退役（淡完才回收）
       ⚠️ 一个元素可能被多个位置共用 → 按元素去重再算比例（否则分母虚高、提前退役） */
    var genN = 0, genL = 0;
    for (i = 0; i < cells.length; i++) cells[i]._f = 0;
    for (i = 0; i < need.length; i++) {
      c = need[i].cell;
      if (!c || c._f) continue;
      c._f = 1; genN++; if (c.loaded) genL++;
    }
    if (genL >= Math.max(1, Math.ceil(genN * CONF.keep))) {
      for (i = 0; i < cells.length; i++) {
        c = cells[i];
        if (c.gen !== curGen && !c.want) retire(c);
      }
    }

    /* ⑤ 摆位：本代 + 还留着的旧代全部按当前相机重算 —— 旧瓦片会自己放大 → 画面连续 */
    var have = 0;
    for (i = 0; i < cells.length; i++) {
      c = cells[i];
      /* ★ 没加载完却还显示着的元素 = 上一轮的残影（它不会被重新定位）→ 必须藏起来 */
      if (!c.loaded || !c.shown) {
        if (!c.loaded && c.el.style.display !== 'none') c.el.style.display = 'none';
        continue;
      }
      if (placeCell(c, cam, vis, px)) have++;
    }
    stat.have = have;
    stat.want = need.length;
    /* ★★ 预取「放大一档」：本档基本铺满后，把 z+1 中心 3×3 的 URL 悄悄拉进浏览器缓存。
       用户原话：「他不应该是你放大的时候重新渲染，不应该是无缝换图吗」——
       预取之后再放大就直接命中缓存 + 淡入，不再一格一格等。
       ★ 2026-10-14：预取也必须遵守【地区封顶】——否则在「珠海」档会预取 z8（超封顶、白下载）。 */
    if (CONF.prefetch && z < ZMAX && z < capFor(spanDeg) && have >= Math.max(3, Math.ceil(need.length * 0.9))) {
      var zn = z + 1, nn = 1 << zn, spn = SPAN0 / nn;
      var mx2 = MINX + (cx - cam.tx) / px, my2 = MAXY - (cy - cam.ty) / px;
      var bxn = Math.floor((mx2 - W0) / spn), byn = Math.floor((N0 - my2) / spn);
      for (var qx = -1; qx <= 1; qx++) {
        for (var qy = -1; qy <= 1; qy++) {
          var kx2 = (((bxn + qx) % nn) + nn) % nn;
          var ky2 = Math.max(0, Math.min(nn - 1, byn + qy));
          var pk = zn + '/' + kx2 + '_' + ky2;
          if (preKeys[pk]) continue;
          preKeys[pk] = 1;
          var pim = new Image();
          pim.decoding = 'async';
          pim.onerror = (function (im2) {
            return function () {
              if (CONF.fallback && !im2.dataset.alt) {
                im2.dataset.alt = '1';
                im2.src = CONF.fallback.replace(/\{z\}/g, zn).replace(/\{x\}/g, kx2).replace(/\{y\}/g, ky2);
              }
            };
          })(pim);
          pim.src = tileUrl(zn, kx2, ky2);
          preImgs.push(pim);
          while (preImgs.length > 48) preImgs.shift();
        }
      }
      if (Object.keys(preKeys).length > 600) preKeys = {};
    }
    /* ★★ 2026-10-15：预算用完后自己再排帧继续铺 —— 以前一帧只发 budget(10) 块，
       而 paint() 在相机停下后不再被调用 → 剩下的瓦片永远不加载（屏上一块一块缺）。 */
    if (pending > 0 && newReq > 0 && budgetRuns < 40) {
      budgetRuns++;
      if (!rafPend && typeof requestAnimationFrame === 'function') {
        rafPend = requestAnimationFrame(function () {
          rafPend = 0;
          if (lastCam && lastVis) update(lastCam, lastVis);
        });
      }
    } else budgetRuns = 0;

    stat.z = z; stat.gen = curGen;
    if (CONF.debug && stat._lastZ !== z) {
      stat._lastZ = z;
      console.log('[qvtiles] z' + z + ' 屏上边长=' + tw.toFixed(1) + 'px 需要=' + need.length + ' 已显示=' + have);
    }
  }

  /** 找一个能用的元素：① 没用过 ② 屏幕外的旧一代 ③ 屏幕外的本代 ④ 不得已才抢屏上的
   *  ⚠️ 先抢【屏幕外】的：以前不分青红皁白抢可见的旧瓦片去加载新瓦片 →
   *     屏上的图一块一块被抽走再补 = 用户说的「一滑就一堆小方块闪两下」。 */
  function offscreen(c) { return c.el.style.display === 'none'; }
  function alloc() {
    var i, c;
    /* ⚠️ _p = 本帧还要用的同 key 元素（见 update ③）→ 绝对不能被抢走 */
    for (i = 0; i < cells.length; i++) { c = cells[i]; if (!c.key && !c.loaded && !c._p) return c; }
    for (i = 0; i < cells.length; i++) { c = cells[i]; if (!c.want && !c._p && c.gen !== curGen && offscreen(c)) { free(c); return c; } }
    for (i = 0; i < cells.length; i++) { c = cells[i]; if (!c.want && !c._p && c.gen === curGen && offscreen(c)) { free(c); return c; } }
    for (i = 0; i < cells.length; i++) { c = cells[i]; if (!c.want && !c._p && c.gen !== curGen) { free(c); return c; } }
    for (i = 0; i < cells.length; i++) { c = cells[i]; if (!c.want && !c._p) { free(c); return c; } }
    return null;
  }

  function free(c) {
    if (c.el.style.display !== 'none') c.el.style.display = 'none';
    c.el.style.opacity = '0';              /* 下次复用重新淡入 */
    c.retiring = 0;
    c.key = ''; c.pos = ''; c.want = false; c.loaded = false; c.shown = false; c.gen = 0;
    c.el.removeAttribute('src');
  }
  /** 旧一代退役：先淡出，再回收（期间若又被需要就留下）
   *  ★ 2026-11-02 用户：「刚进来直接把地图拉到世界范围，结果黑了一大块」——
   *    拉远时从 z7 直接切到 z3，新瓦片一张都还没下来，而这里 300ms 就把
   *    旧瓦片 free() 掉（还会被 alloc() 抢去加载新图）→ 大片黑。
   *    延到 1.8s：新档真下来之前，屏幕上先看到的是【放大的旧瓦片】（糊但不黑）。
   *    真正的根治是启动页把 z3 全部预加载，见 app.js 的 QVTiles.urlsOf(3)。 */
  function retire(c) {
    if (c.retiring) return;
    c.retiring = 1;
    c.el.style.opacity = '0';
    setTimeout(function () {
      c.retiring = 0;
      if (c.want || c.gen === curGen) { c.el.style.opacity = '1'; return; }
      free(c);
    }, Math.max(CONF.fade, 1800));
  }

  /** 某一级的全部瓦片 URL（z3 = 8×8 = 64 块，覆整个世界）——给启动页闸门预热用 */
  function urlsOf(z) {
    var n = 1 << z, out = [];
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) out.push(tileUrl(z, x, y));
    return out;
  }

  global.QVTiles = {
    init: init, update: update, setEnabled: setEnabled, isOn: isOn, ready: ready,
    setUrl: setUrl, setDebug: setDebug, stats: stats, CONF: CONF, urlsOf: urlsOf
  };
})(window);
