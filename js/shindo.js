/* shindo.js —— 地图「行政区震度分布」层（图层绝对坐标版） */
(function (g) {
  'use strict';
  var A = g.QV_SHINDO_AREAS || { W: 2596, H: 2651, areas: {} };
  var host = null;
  /* ★★ 2026-10-12 官方配色（反编译证据）：
     `地図` 精灵的列表变量 `d #震度配色(地図)` =
       ["686870","3098bd","4cd0a7","f6cb51","ff9939","e52a18","c31b1b","a30a6b","86046e","54068e",…]
     下标 = 官方造型后缀（与 paSc/snd/h 造型同一编号）：
       0=震度0 1=震度1 2=震度2 3=震度3 4=震度4 5=5弱 6=5強 7=6弱 8=6強 9=震度7
     官方区划色块 = `nc<码>` 造型先 特效BRIGHTNESS=100 漂白，再用这个列表上色（透明度 0）。
     ★ 取色一律走【App 自己的后缀映射】QV_SC_SUF（和主卡数字/履历徐章同一张表），
       这样编码（sParse 会给 7 / 50 / 55 / 60 / 65 / 70 几种写法）永远不会各取一套色。
     ★ 以前是另写一张小表、而且色块层带 opacity:.88（颜色发白）
       → 用户：「颜色完全不对，和官方的都不是一个东西」。 */
  var SUF_COLOR = {
    '0': '#686870', '1': '#3098bd', '2': '#4cd0a7', '3': '#f6cb51', '4': '#ff9939',
    '5': '#e52a18', '6': '#c31b1b', '7': '#a30a6b', '8': '#86046e', '9': '#54068e'
  };
  function sufOf(v) { return g.QV_SC_SUF ? String(g.QV_SC_SUF(v)) : String(Math.round(v)); }
  function colorOf(v) { return SUF_COLOR[sufOf(v)] || SUF_COLOR['0']; }
  /* 兼容旧写法（外部/调试可能按 50/55/60/65/7 传键）：同一批颜色的等价别名 */
  var COLORS = { '0': SUF_COLOR['0'], '1': SUF_COLOR['1'], '2': SUF_COLOR['2'], '3': SUF_COLOR['3'],
    '4': SUF_COLOR['4'], '50': SUF_COLOR['5'], '55': SUF_COLOR['6'], '60': SUF_COLOR['7'],
    '65': SUF_COLOR['8'], '7': SUF_COLOR['9'] };
  /* ★★ 2026-10-12：以前挂在 #mapview（官方 nb 图层）下 ——
     结果一关掉官方地图，震度色块也跟着消失了（用户报的「地震色块定位不对」真因）。
     现在挂我们自己的 #mapoverlay（mapcam 建，与图集同一套 transform）。 */
  function hostLayer() {
    return document.getElementById('mapoverlay') || document.getElementById('mapview');
  }
  function ensure() {
    var mv = hostLayer();
    if (!mv) return host && host.parentNode ? host : null;
    if (host && host.parentNode === mv) return host;
    if (!host) {
      host = document.createElement('div');
      host.id = 'mapareas';
      /* ★ 不加 opacity：官方区划色块是**不透明**的（透明度只在特殊模式才 0.5）。
        以前写 .88 → 颜色整体发白，也是「和官方不是一个东西」的一部分。 */
      host.style.cssText = 'position:absolute;left:0;top:0;width:' + A.W + 'px;height:' + A.H +
        'px;pointer-events:none;z-index:4';
    }
    mv.appendChild(host);          /* 首次创建 or 从 #mapview 迁移过来（appendChild 会搬） */
    return host;
  }
  /* ★★ 2026-10-12「油漆桶」版：区域形状 = 该区域名下所有市町村多边形的集合，
     数据是经纬度（我们自己地图参数），运行时投影成一条 SVG path 直接填色 ——
     不再有官方造型、不再有平移/缩放修正表。 */
  var MINX = A.MINX != null ? A.MINX : -130.638978;
  var MAXY = A.MAXY != null ? A.MAXY : 138.909650;
  var AA = A.A != null ? A.A : 10;
  function proj(lon, lat) {
    var mx = 10 * ((((lon + 44) % 360) + 360) % 360 - 180);
    var my = 572.9577951308232 * Math.log(Math.tan((45 + lat / 2) * Math.PI / 180)) - 374.04780730560344;
    return [(mx - MINX) * AA, (MAXY - my) * AA];
  }
  /* ============ 2026-10-20 测站 -> 区域 的几何归属 ============
     QV_TEN 没有可用的 JMA 区域码（col3/col4 都对不上），但 A.areas[code].p
     本身就是【经纬度多边形】 -> 直接做 point-in-polygon 就知道测站属于哪个区域。
     先按 bbox 粗筛（1748 x 123 只有 21 万次比较），命中才做详细判定。 */
  var AREA_IDX = null;
  function buildAreaIdx() {
    AREA_IDX = [];
    for (var code in A.areas) {
      var a = A.areas[code];
      if (!a || !a.p) continue;
      var minx = 999, maxx = -999, miny = 999, maxy = -999;
      for (var i = 0; i < a.p.length; i++) {
        var f = a.p[i];
        for (var j = 0; j < f.length; j += 2) {
          var lo = f[j], la = f[j + 1];
          if (lo < minx) minx = lo; if (lo > maxx) maxx = lo;
          if (la < miny) miny = la; if (la > maxy) maxy = la;
        }
      }
      AREA_IDX.push({ code: +code, minx: minx, maxx: maxx, miny: miny, maxy: maxy, p: a.p });
    }
  }
  function pipRing(ring, lon, lat) {
    var inside = false;
    for (var i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      var xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
      if ((yi > lat) !== (yj > lat) &&
          lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi) inside = !inside;
    }
    return inside;
  }
  function areaOf(lon, lat) {
    if (!AREA_IDX) buildAreaIdx();
    for (var k = 0; k < AREA_IDX.length; k++) {
      var b = AREA_IDX[k];
      if (lon < b.minx || lon > b.maxx || lat < b.miny || lat > b.maxy) continue;
      for (var i = 0; i < b.p.length; i++) if (pipRing(b.p[i], lon, lat)) return b.code;
    }
    return 0;
  }

  /* 每个区域的 path 串只算一次（188 个 × 上千个点，不能每帧重算） */
  var dCache = {};
  function areaPath(code) {
    if (dCache[code] !== undefined) return dCache[code];
    var a = A.areas[code], d = '';
    if (a && a.p) {
      for (var i = 0; i < a.p.length; i++) {
        var f = a.p[i];
        for (var j = 0; j < f.length; j += 2) {
          var q = proj(f[j], f[j + 1]);
          d += (j ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
        }
        d += 'Z';
      }
    }
    return (dCache[code] = d);
  }
  function set(list) {
    var h = ensure(); if (!h) return 0;
    var n = 0, seen = {}, out = '';
    (list || []).forEach(function (it) {
      var code = String(it.code || '').replace(/^nc/, '');
      if (seen[code]) return;
      /* ★★★ 2026-11-03 用户：「为什么正式报的震度3，2，1的地图填色区域全部变成了灰色的了」
         真因：**震度0（震度なし）的行政区也被填了色** —— colorOf(0) = SUF_COLOR['0']
         = #686870 灰。render3.syncAreas() 每帧直接拿 E.allAreas 来 set()，
         绕过了 rebuildAreas 里 `fillable()` 的「v > 0 才填」过滤，于是全日本远场
         一大片灰斑（实测 M8.1 模拟：113 个区里 44 个是 0，全变灰）。
         官方地图上 震度0 是**不上色**的（保持底图），这里统一兜底：
         没有有效震度 / 震度0 → 直接跳过，连白线也不画。 */
      var _sv = +it.shindo;
      if (!isFinite(_sv)) _sv = +it.level;
      if (!isFinite(_sv) || _sv <= 0) return;
      var d = areaPath(code);
      if (!d) return;
      seen[code] = 1;
      var c = colorOf(_sv);
      /* ★★★ 2026-10-21 用户（两次）：
           ① 「官方是顶层再画一层普通的白线，这样子分界清楚」
           ② 「日本又变成裂纹板块了，因为它把市级以下又显示出来了」
         真因：`A.areas[code].p` 不是「一个区的轮廓」，而是**这个区名下所有市町村的多边形**
         （实测 123 个区平均 22.7 个环），直接在最上面描边 = 每个市町村都被描一遍 = 裂纹。
         解法（不需要求多边形并集）：**每个区「先描白线、再填色」交错画**。
           · 自己那圈线先画，紧接着被自己的填色盖住 → 区内部的市町村线全部隐藏 ✅
           · 但后画的那个区，它的线叠在前一个区已经填好的色块上 → 交界处留下半条白线 ✅
         于是「区与区之间」一定有白线，「区内部」一根都没有。
         （中国那边是一个市一个环，没有这个问题，走 mapcam 的顶层白线层。） */
      out += '<path d="' + d + '" fill="none" stroke="#ffffff" stroke-opacity="0.62" ' +
        'stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>';
      out += '<path d="' + d + '" fill="' + c + '" stroke="' + c + '" stroke-width="1" ' +
        'stroke-linejoin="round" fill-rule="nonzero"/>';
      n++;
    });
    h.innerHTML = n ? '<svg width="' + A.W + '" height="' + A.H + '" viewBox="0 0 ' + A.W + ' ' + A.H +
      '" style="position:absolute;left:0;top:0">' + out + '</svg>' : '';
    return n;
  }
  function clear() { var h = ensure(); if (h) h.innerHTML = ''; }

  /* ★ 2026-10-20 「揺れを検出」范围框专用：官方细分区域多边形的经纬度外接框。
     只提供**数据**（不改任何填色逻辑）——矩形框由 mapcam 用官方 `枠描画` 同款画法画。
     框的大小 = 检出地区的官方区域范围（一个县/细分区域大小），不是测站小点范围。 */
  var bbCache = {};
  function areaBounds(code) {
    code = String(code || '').replace(/^nc/, '');
    if (bbCache[code] !== undefined) return bbCache[code];
    var a = A.areas[code];
    if (!a || !a.p) return (bbCache[code] = null);
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (var i = 0; i < a.p.length; i++) {
      var r = a.p[i];
      for (var j = 0; j + 1 < r.length; j += 2) {
        if (r[j] < x0) x0 = r[j];
        if (r[j] > x1) x1 = r[j];
        if (r[j + 1] < y0) y0 = r[j + 1];
        if (r[j + 1] > y1) y1 = r[j + 1];
      }
    }
    return (bbCache[code] = (x0 < x1 ? { lon0: x0, lat0: y0, lon1: x1, lat1: y1 } : null));
  }
  function setAll(shindo) {
    return set(Object.keys(A.areas).map(function (c) { return { code: c, shindo: shindo }; }));
  }
  /** ★★ 2026-10-25 区域代表点（经纬度）—— 给「色块上的震度数字」定位用。
   * ★★★ 2026-10-26 查到**真因**（数据实测）：
   *   `A.areas[code].p` **不是「一个区域一个多边形」，而是【市町村多边形的集合】**。
   *     · 兵庫県淡路島 = 112 个环，最大一块只占 6% 面积
   *     · 全表 123 个区，平均「最大环占比」仅 32%
   *   ⇒ 「取最大环的质心 / 最大环的内切圆心」等于落在**某一个市町村的中间**，
   *     站在整个细分区域看就是「贴着行政区划边缘」—— 用户实测「没两个是对的」。
   *
   *   官方口径（JMA 震度分布図）：一枚数字 = 一个行政单位，位置取该单位的代表点，
   *   一定在单位**内部**且尽量居中。我们这里的行政单位 = 细分区域（若干市町村的联合体），
   *   所以正确目标是：**在联合体内部，离整个联合体边界最远的点**（polylabel 的联合版）。
   *
   *   实作：联合体栅格化 → 掩膜 → 两遍 chamfer 距离变换 → 取最深的格心。
   *     · 栅格天然处理「多部件 / 飞地 / 孔洞 / 市町村共享边界」，不会被内部分界线骗
   *     · 经度按中纬度 cos 收缩，保证各向同性（否则高纬东西向被拉长）
   *     · 最深处并列时选**最靠近面积加权质心**的那个，避免贴到长条的一端
   */
  var ctCache = {};
  function areaCenter(code) {
    code = String(code || '').replace(/^nc/, '');
    if (ctCache[code] !== undefined) return ctCache[code];
    var a = A.areas[code];
    if (!a || !a.p || !a.p.length) return (ctCache[code] = null);
    var rings = a.p, i, j, n, r;

    /* ---------- ① 包围盒 + 面积加权质心（并列时的裁决基准） ---------- */
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    var csx = 0, csy = 0, carea = 0;
    for (i = 0; i < rings.length; i++) {
      r = rings[i]; n = r.length;
      if (n < 6) continue;
      var sa = 0, sx = 0, sy = 0;
      for (j = 0; j + 1 < n; j += 2) {
        var rx = r[j], ry = r[j + 1];
        var qx = r[(j + 2) % n], qy = r[(j + 3) % n];
        if (rx < x0) x0 = rx; if (rx > x1) x1 = rx;
        if (ry < y0) y0 = ry; if (ry > y1) y1 = ry;
        var f = rx * qy - qx * ry;
        sa += f; sx += (rx + qx) * f; sy += (ry + qy) * f;
      }
      if (Math.abs(sa) > 1e-12) { csx += sx / 6; csy += sy / 6; carea += sa / 2; }
    }
    if (!(x1 > x0) || !(y1 > y0)) return (ctCache[code] = null);
    var gc = (Math.abs(carea) > 1e-12) ? [csx / carea, csy / carea] : [(x0 + x1) / 2, (y0 + y1) / 2];

    /* ---------- ② 栅格化「联合体」（所有市町村环一起填） ----------
       ⚠️ x 轴用【缩放后】的经度：原点也必须是 sx0 = x0*cs，
          否则掩膜整体错位、代表点会掉到海里（2026-10-26 实测踩过）。 */
    var cs = Math.cos(((y0 + y1) / 2) * Math.PI / 180);
    if (!(cs > 0.05)) cs = 1;
    var sx0 = x0 * cs;
    var spanX = (x1 - x0) * cs, spanY = (y1 - y0);
    var cell = Math.max(spanX, spanY) / 140;         /* ≈ 每格 1/140 跨度 */
    if (!(cell > 0)) return (ctCache[code] = gc);
    var NX = Math.max(2, Math.ceil(spanX / cell) + 1);
    var NY = Math.max(2, Math.ceil(spanY / cell) + 1);
    var GW = NX * NY;
    var cw = spanX / NX, chh = spanY / NY;
    var mask = new Uint8Array(GW);
    for (i = 0; i < rings.length; i++) {
      r = rings[i]; n = r.length;
      if (n < 6) continue;
      var ry0 = 1e9, ry1 = -1e9;
      for (j = 1; j < n; j += 2) { if (r[j] < ry0) ry0 = r[j]; if (r[j] > ry1) ry1 = r[j]; }
      var gy0 = Math.max(0, Math.floor((ry0 - y0) / chh));
      var gy1 = Math.min(NY - 1, Math.ceil((ry1 - y0) / chh));
      for (var gy = gy0; gy <= gy1; gy++) {
        var yy = y0 + (gy + 0.5) * chh, xs = [];
        for (j = 0; j + 1 < n; j += 2) {
          var ax = r[j] * cs, ay = r[j + 1];
          var bx = r[(j + 2) % n] * cs, by = r[(j + 3) % n];
          if ((ay > yy) !== (by > yy)) xs.push(ax + (yy - ay) / (by - ay) * (bx - ax));
        }
        if (xs.length < 2) continue;
        xs.sort(function (p, q) { return p - q; });
        for (var s2 = 0; s2 + 1 < xs.length; s2 += 2) {
          var gx0 = Math.max(0, Math.ceil((xs[s2] - sx0) / cw - 0.5));
          var gx1 = Math.min(NX - 1, Math.floor((xs[s2 + 1] - sx0) / cw - 0.5));
          for (var gx = gx0; gx <= gx1; gx++) mask[gy * NX + gx] = 1;
        }
      }
    }

    /* ---------- ③ 距离变换：区内每格到「联合体边界」的距离 ---------- */
    var INF = 1e9, D1 = 1, D2 = 1.41421356;
    var dist = new Float32Array(GW);
    for (i = 0; i < GW; i++) dist[i] = mask[i] ? INF : 0;
    var qx2, qy2, id, v;
    for (qy2 = 0; qy2 < NY; qy2++) {
      for (qx2 = 0; qx2 < NX; qx2++) {
        id = qy2 * NX + qx2;
        if (!mask[id]) continue;
        v = dist[id];
        if (qx2 > 0 && dist[id - 1] + D1 < v) v = dist[id - 1] + D1;
        if (qy2 > 0) {
          if (dist[id - NX] + D1 < v) v = dist[id - NX] + D1;
          if (qx2 > 0 && dist[id - NX - 1] + D2 < v) v = dist[id - NX - 1] + D2;
          if (qx2 < NX - 1 && dist[id - NX + 1] + D2 < v) v = dist[id - NX + 1] + D2;
        }
        dist[id] = v;
      }
    }
    for (qy2 = NY - 1; qy2 >= 0; qy2--) {
      for (qx2 = NX - 1; qx2 >= 0; qx2--) {
        id = qy2 * NX + qx2;
        if (!mask[id]) continue;
        v = dist[id];
        if (qx2 < NX - 1 && dist[id + 1] + D1 < v) v = dist[id + 1] + D1;
        if (qy2 < NY - 1) {
          if (dist[id + NX] + D1 < v) v = dist[id + NX] + D1;
          if (qx2 > 0 && dist[id + NX - 1] + D2 < v) v = dist[id + NX - 1] + D2;
          if (qx2 < NX - 1 && dist[id + NX + 1] + D2 < v) v = dist[id + NX + 1] + D2;
        }
        dist[id] = v;
      }
    }

    /* ---------- ④ 取最深的格心（差 1 格内并列 → 取离质心最近） ---------- */
    var bestD = -1;
    for (i = 0; i < GW; i++) if (mask[i] && dist[i] > bestD) bestD = dist[i];
    if (!(bestD > 0)) return (ctCache[code] = gc);
    var gcx = (gc[0] * cs - sx0) / cw, gcy = (gc[1] - y0) / chh;
    var pick = -1, pickS = Infinity;
    for (i = 0; i < GW; i++) {
      if (!mask[i] || dist[i] < bestD - 1) continue;
      var px = i % NX, py = (i - px) / NX;
      var s3 = (px - gcx) * (px - gcx) + (py - gcy) * (py - gcy);
      if (s3 < pickS) { pickS = s3; pick = i; }
    }
    if (pick < 0) return (ctCache[code] = gc);
    var ppx = pick % NX, ppy = (pick - ppx) / NX;
    return (ctCache[code] = [(sx0 + (ppx + 0.5) * cw) / cs, y0 + (ppy + 0.5) * chh]);
  }

  /* ================= ★★ 観測点层（明细 JSON 的第 3 层）=================
   * 把色块从「188 个粗区域」填深到「上千个观测点」。
   * 数据自带 latlon → 用 QVMapCam.at() 换算成图集坐标，不需要任何边界图形。
   * 与色块层一样挂在 #mapview 下，跟着地图一起平移/缩放（GPU 合成，不重绘整屏）。
   * ⚠️ 只在地图用【日本图集】(mode='jp') 时有意义：世界图/广域图用的是另一套投影。*/
  var phost = null;
  /* ★★ 官方样式（diag/OFFICIAL-map.png 实测）：观测点不是光板色块，而是
     **小圆角方块 + 里面写着震度数字**（白字）。所以看着"范围大、气派"的其实是
     一整片带数字的标记，不是一张大色块。
     PS = 方块边长（图集坐标 px，图集 2596x2651）；数字用官方字形（QVT.num），
     与卡片同源，不是随便一个字体。 */
  /* ★★ 2026-10-12 官方缩放规则（反编译 `地図` 精灵 bGP / bIB 脚本得到的原文）：
     · 标记是【屏幕像素】尺寸、随缩放按 √相机倍率 增长：
         屏幕尺寸 = 1.92 × (設定17 × (1.3 × (画面設定系[6] × ((2.5+√k) × (1+0.2×(震度>5弱))))))
       我们取 1.92×1.2×1.3 = 3.0 当基准（設定17 默认≈1.2，画面設定系[6]=UI比例）。
     · 震度 5弱 以上再放大 20%。
     · **只画相机视野内的点**（官方判据 `abs(点-相机) < 屏幕半宽`）。
     · 候选点按【震度优先】排序、限量（官方 `表示範囲候補追加` 的优先级 + 200 上限）。
     · 近景铺开【逐观测点】标记，远景收成【一区一标】。
     ★ 以前固定 26 图集 px、一个不落全画 —— 就是用户报的
       「标签页没有遵循官方的那种缩放的规则」。 */
  /* ★★ 2026-10-13 官方真身（反编译 `地震情報スタンプ`：diag/decomp-sp.txt:467 / 499）
       区域标记（一区一标）：`sprite.size = 画面設定系[6] × (4 + √カメラ系[3]) × システム設定[17]` %
       逐观测点标记：  上面那条再 × 1.1
     造型用 **`y1..y9`**（不是 h*！）—— `y*` 才是地图上盖的那一套（带官方那圈柔光），
       h* 是别的地方用的。官方相机 カメラ系[3] 与我们的 k 是线性关系
       （默认全日本：官方 9.5 ↔ 我们 0.3264 → 比 ≈ 29，√ 项按 √29 ≈ 5.4 换算）。
     y* 画布 400×400、墨迹 160 → 墨迹占盒子的 0.4 ⇒ 盒子 = 墨迹/0.4。
     校准：京畿 k=1.275 → 盒子 55px → 墨迹 22px，与官方截图逐像素量到的一致。
     ⚠️ 旧版 `PS_BASE*(2.5+√k)` 只给到 11px 盒子 = 墨迹 4.4px → 小到看不见
       （用户：「图标也不好看」「根本没有缩放」）。 */
  var MARK_BOX = 5.5;               /* 盒子基准 px（400 画布） */
  var MARK_KF = 5.4;                /* √k 的换算系数（见上） */
  var MARK_MIN = 14, MARK_MAX = 96; /* 盒子上下限（markPx 内部换算成墨迹） */
  var MARK_INK_MIN = 15, MARK_INK_MAX = 62; /* ★ 墨迹（真正看到的盘子）上下限，屏幕 px */
  var ST_MIN_K = 1.6;               /* 相机倍率超过它 → 铺开逐观测点标记 */
  var ST_CAP = 260;                 /* 逐观测点标记上限 */
  /** 设置页「图标大小」（官方 `システム設定[17]`，与震中红叉共用同一个值） */
  function iconScale() {
    var f = 1;
    try { var o = g.QVMapCam && g.QVMapCam.opt('pinScale'); if (o) f = o; } catch (e) { }
    return f;
  }
  function markPx(v, k) {
    var box = MARK_BOX * (4 + MARK_KF * Math.sqrt(Math.max(0, k))) * iconScale();
    /* ★★★ 2026-10-26 尺寸标定（换官方 h*.svg 后反复调过两轮）
       ① 官方 `assets/marks/h*.svg` 的 viewBox **就是盘子本身**（墨迹 = 盒子），
          旧 `markers/y*.svg` 是 400 画布、盘子只占 130（≈32.5%）。
       ② 直接沿用旧盒子 → 用户「这数字大的有点离谱」；乘 0.325 又「太小了」。
       ③ 最终：墨迹取盒子的 0.55，并单独给墨迹上下限 ——
          k=1.73（京畿近景）≈ 34px，k=0.33（全日本）≈ 21px，k=6 ≈ 52px。
       ④ 震度 5弱 以上再 +12%（官方 `1+0.2×(震度>5弱)` 的加成）。 */
    var ink = box * 0.55 * (v >= 5 ? 1.12 : 1);
    return Math.max(MARK_INK_MIN, Math.min(MARK_INK_MAX, ink));
  }
  function ensureP() {
    var mv = hostLayer();
    if (!mv) return phost && phost.parentNode ? phost : null;
    if (phost && phost.parentNode === mv) return phost;
    if (!phost) {
      phost = document.createElement('div');
      phost.id = 'mappoints';
      phost.style.cssText = 'position:absolute;left:0;top:0;width:' + A.W + 'px;height:' + A.H +
        'px;pointer-events:none;z-index:7';      /* 7 = 压在界线层(6)之上、红叉(8)之下 */
    }
    mv.appendChild(phost);
    return phost;
  }
  /** 本项目震度编码 → 悬停提示里的短标签（5弱/5強/6弱/6強 用官方写法 5-/5+/6-/6+） */
  function digitOf(v) {
    var s = sufOf(v);
    return s === '5' ? '5-' : s === '6' ? '5+' : s === '7' ? '6-' : s === '8' ? '6+' : s;
  }
  /** ★★ 震度【序号】1~9：直接复用 App 自己的官方造型后缀映射，
   *  因为震度编码有 7 / 50 / 55 / 60 / 65 / 70 几种写法，数值大小和震度高低不一致
   *  （例如 7=震度7 而 65=6強，取最大时直接比数字会把震度7 吃掉）。 */
  function rankOf(v) {
    var n = parseInt(sufOf(v), 10);
    if (isFinite(n) && n >= 1 && n <= 9) return n;
    /* ★★★ 2026-10-25 修：震度码 10/20/30/40（震度1~4）`QV_SC_SUF` **没有映射**，
       parseInt 出来就是 10/20/30/40 → 去找 y10.svg / y20.svg（不存在）
       → 地图上一个数字标记都出不来（用户：「色块的数字标识没了」）。
       兜底：按震度码 / 10 还原成 1~4。 */
    var k = Math.round((+v || 0) / 10);
    return (k >= 1 && k <= 9) ? k : 0;
  }
  /** 震度值 → 官方标记编号 0~9（官方造型 h0…h9 = 震度0,1,2,3,4,5弱,5強,6弱,6強,7） */
  function hidxOf(v) { return rankOf(v); }
  /* ---------------- 标记层（官方缩放规则版） ----------------
   * 数据两条：① 一区一标（区域重心 + 区域最大震度）② 逐观测点（真经纬度）
   * 每帧由 mapcam.paint() 调 updateView(cam, VIS) 重排：位置按相机、尺寸按 √k、视野外隐藏。
   * ⚠️ 位置必须用【图集坐标】（父层 #mapoverlay 已经被 translate+scale(k)），
   *    所以屏幕 px 尺寸要 /k 换成图集 px；世界左右环绕按 ±36000 图集 px 取最近一份。 */
  var PTS = { area: [], station: [], mode: '', nodes: null, ver: 0, built: -1, ak: '', sk: '' };
  /** ★ 内容去重：rebuildAreas() 是**每帧**跑的，
   *  如果每次都 ver++ → buildMarks 每帧重建几十个 <img>（卡死）。 */
  function sigOf(list, withV) {
    var s = '';
    for (var i = 0; i < (list || []).length; i++) {
      var it = list[i];
      s += (it.area || it.code || '') + ':' + (withV ? it.v : it.shindo) + ',';
    }
    return s;
  }
  function setPoints(list, metric) {
    if (metric) setMetric(metric);
    var k = sigOf(list, true);
    if (k === PTS.ak) return PTS.area.length;
    PTS.ak = k; PTS.area = list || []; PTS.ver++;
    return PTS.area.length;
  }
  function setStations(list, metric) {
    if (metric) setMetric(metric);
    var k = sigOf(list, false);
    if (k === PTS.sk) return PTS.station.length;
    PTS.sk = k; PTS.station = list || []; PTS.ver++;
    return PTS.station.length;
  }
  /** ★ 2026-10-26：标记图层要区分震度/烈度 ——
   *  震度用官方 marks/h0..h9（圆角方块）
   *  → 烈度用 QV_LIEDU.markBoxSrc() 生成的同款方块（1~12 齐全）。 */
  var PMETRIC = 'shindo';
  function setMetric(m) { PMETRIC = (m === 'liedu') ? 'liedu' : 'shindo'; }
  /** ★★★ 2026-10-26 用户定的规则：
   *  「EEW 阶段测站只能是圆的，正式报地图填色只能是方的（这时测站该隐藏）」
   *  区域数字层（方形）只在【正式报】显示；EEW / 检测 / 调查中 / 震源速報 一律藏起来，
   *  免得和圆形测站标记同屏冷暖两套。 */
  var MARKS_HIDDEN = false;
  function setMarksHidden(h) {
    h = !!h;
    if (MARKS_HIDDEN === h) return;
    MARKS_HIDDEN = h;
    var host = ensureP();
    if (host) host.style.display = h ? 'none' : '';
    PTS.ver++;                     /* 恢复可见时强制重建 */
  }
  function clearPoints() {
    PTS.area = []; PTS.station = []; PTS.mode = ''; PTS.nodes = null;
    PTS.ver++; PTS.ak = '\u0000'; PTS.sk = '\u0000';
    var h = ensureP(); if (h) h.innerHTML = '';
  }
  function wantMode(k) { return (PTS.station.length && k >= ST_MIN_K) ? 'station' : 'area'; }
  /** 数据变了才重建 DOM（相机每帧变 → 只重排位置/尺寸） */
  function buildMarks(cam) {
    var h = ensureP(); if (!h) return;
    if (MARKS_HIDDEN) return;   /* ★ EEW 阶段只画圆形测站，方形区域数字藏起来 */
    var mode = wantMode(cam.k);
    /* ★★★ 2026-10-25 修：以前写的是 `if (PTS.mode === mode && PTS.nodes) return;`
       —— PTS.nodes 是**空数组也能通过**（truthy），于是一旦某一帧一个标记都没建成
       （比如 rankOf 查出 y10.svg 不存在），之后就再也不会重建，永远空白。
       改成用数据版本号 ver（setPoints / setStations 时 ++）。 */
    if (PTS.built === PTS.ver && PTS.mode === mode && PTS.nodes) return;
    PTS.built = PTS.ver; PTS.mode = mode; PTS.nodes = []; h.innerHTML = '';
    var src = (mode === 'station') ? PTS.station : PTS.area;
    if (!src || !src.length) return;
    var arr = src.slice();
    if (mode === 'station') {
      arr.sort(function (a, b) { return (b.v || -1) - (a.v || -1); });       /* 震度优先 */
      if (arr.length > ST_CAP) arr = arr.slice(0, ST_CAP);
    }
    var frag = document.createDocumentFragment();
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i];
      if (!isFinite(p.lat) || !isFinite(p.lon)) continue;
      /* ★ 造型 = 官方 `y<震度档位>`（1..9：震度1,2,3,4,5弱,5強,6弱,6強,7）
         ⚠️ 震度0 官方地图上不盖章 → 跳过（没有 y0 造型） */
      /* ⚠️ 两种列表的字段名不一样：区域标记是 `{v}`，观测点标记是 `{shindo}`
         （见 views.js 的 setStations 与 setPoints 调用处）—— 不兜这一下，
         烈度方块会拿到 undefined 全画成「烈度 1」、悬停提示变成「烈度 NaN」。 */
      var pv = (p.v != null && isFinite(p.v)) ? +p.v : +p.shindo;
      var hx = hidxOf(pv);
      var isLie = (PMETRIC === 'liedu');
      if (!isLie && !(hx >= 1)) continue;
      var im = document.createElement('img');
      /* ★★★ 2026-10-26 用户：「烈度卡现在没做专门的方形的烈度数字提示，
         现在是测站临时顶替的，做一套烈度的出来」
         —— 震度：官方 assets/marks/h1..h9（h1..h9 = 震度1,2,3,4,5弱,5強,6弱,6強,7）；
            烈度：QV_LIEDU.markBoxSrc(1..12)，同尺寸同构图的自制方块。
         之前烈度没分支 → 也去取 h<qv_sc_suf>：liedu 8 变震度6強、liedu 10 回落震度1。 */
      if (isLie && g.QV_LIEDU && g.QV_LIEDU.markBoxSrc) {
        im.src = g.QV_LIEDU.markBoxSrc(pv);
      } else {
        im.src = 'assets/marks/h' + hx + '.svg';
      }
      im.draggable = false;
      im.style.cssText = 'position:absolute;pointer-events:none;display:none';
      im.title = (p.name || p.areaName || p.area || '') +
        (isLie ? (' 烈度' + Math.round(pv)) : (' 震度' + digitOf(pv))) +
        (p.n > 1 ? '（' + p.n + ' 个观测点）' : '');
      frag.appendChild(im);
      /* ★★★ 2026-10-26 用户：「模拟地震算法引入了非常复杂的行政震度提示居中，
         为什么不应用到真实 API 里面？」
         —— 「一区一标」列表的定位以前**完全信任数据自带的经纬度**：
            模拟走 views.buildAreaMarks()（已经用 areaCenter 算过所以是对的），
            真实电报走 dmdata-ui.buildFromStations()（= 该区所有观测点坐标的算术平均，
            观测点全挤在海岸线上 → 数字贴着海边、互相叠在一起）。
         ⇒ 居中逻辑下沉到这一层：区域标记一律用 areaCenter()（联合体内部离边界最远的点），
           只有拿不到区域码 / 区域不在日本图集里（中国 adcode、海外）才回落到自带经纬度。
           snap 只对【区域标记】开，逐观测点模式必须保持每个点自己的位置。 */
      PTS.nodes.push({ el: im, p: p, snap: (mode !== 'station') });
    }
    h.appendChild(frag);
  }
  /** 每帧重排：视野剔除 + √k 尺寸
   *  ★★★ 2026-10-26 用户：「必须在每个行政规划区的中间」「缩放就自动消失」
   *   —— 实测：45 个区域标记**全部**被放到 left≈-34427px（屏幕外），所以地图上一个数字都没有；
   *      放大/缩小的时候数字还会整批跳走（看起来就是「缩放就自动消失」）。
   *   真因：这里原来做了「世界副本环绕」——用 cam.tx 算最近的 ±36000px 副本，
   *      但 ① 本图集是**日本专用**（2596×2651），根本没有世界副本；
   *          ② cam.tx 与 #mapoverlay 的 translate 不是同一套数，
   *             于是 k2 被判成 −1，整批标记被搬到 36000px 之外。
   *   ⇒ 直接弃掉环绕：位置 = 区域质心投影（proj），位移缩放全部交给 #mapoverlay 的 transform。 */
  function layMarks(cam, VIS) {
    if (!PTS.nodes) return 0;
    var m = 30, n = 0;
    for (var i = 0; i < PTS.nodes.length; i++) {
      var it = PTS.nodes[i], el = it.el, p = it.p, pr = null;
      /* ★ 区域标记：位置 = 行政区代表点（与模拟同一套 areaCenter），拿不到才用自带经纬度 */
      if (it.snap) {
        var ac = areaCenter(p.area || p.code);
        if (ac) pr = proj(ac[0], ac[1]);
      }
      if (!pr) pr = proj(p.lon, p.lat);
      /* 屏幕位置（用于视野剔除） */
      var sx = cam.tx + cam.k * pr[0];
      var sy = cam.ty + cam.k * pr[1];
      if (sx < VIS.x0 - m || sx > VIS.x1 + m || sy < VIS.y0 - m || sy > VIS.y1 + m) {
        el.style.display = 'none'; continue;
      }
      var ps = markPx(p.v, cam.k) / cam.k;      /* 屏幕 px → 图集 px（父层被 scale(k)） */
      el.style.display = '';
      el.style.left = (pr[0] - ps / 2).toFixed(1) + 'px';
      el.style.top = (pr[1] - ps / 2).toFixed(1) + 'px';
      el.style.width = ps.toFixed(2) + 'px';
      el.style.height = ps.toFixed(2) + 'px';
      n++;
    }
    return n;
  }
  /** ★ mapcam.paint() 每帧调用：顺带把可能变成孤儿节点的两层重新挂回 #mapoverlay
   *  （mapcam.init() 换图集时会新建 #mapoverlay，旧层会被摘掉 →
   *   用户报的「滑动之后丢失震度色块图层」就是这么来的）。
   *  ★ 2026-10-20：`jpMode=false`（世界/广域图）时整个叠加层隐藏 ——
   *    这里的 proj() 用的是【日本图集】坐标，而世界图的 cam 是另一套投影/比例尺，
   *    硬画会把日本区域标记搬到中国/韩国（用户截图「什么鬼」就是这个）。 */
  /* ★★★ 2026-10-26 用户：「在海啸页面的时候地图的色块数字提示会被隐藏，
     同时地图的填充色块会被压暗，现在我们没搞」
     ⇒ 海啸页（view 2）要：
        ① 区域震度数字（#mappoints，一区一标）**整层隐藏** —— 海啸页看的是海岸线颜色，
           数字叠在色块上会盖住海岸线；
        ② 震度填充（#mapareas）**压暗**到 0.42 —— 让「海岸线颜色」成为视觉主体。
       注意别用 display 去关填充层：那层还会被 set() 重写 innerHTML，用 opacity 最稳。 */
  var tsuMode = false, tsuApplied = null;
  function setTsuMode(on) {
    on = !!on;
    if (tsuApplied === on) return;      /* 每帧都会调，值没变就别碰 DOM */
    tsuApplied = on;
    tsuMode = on;
    var h = ensure();
    if (h) h.style.opacity = tsuMode ? '0.42' : '';
    var hp = ensureP();
    if (hp) hp.style.display = tsuMode ? 'none' : '';
  }

  function updateView(cam, VIS, jpMode) {
    if (!cam || !VIS) return;
    var h = ensure();
    if (h) h.style.display = (jpMode === false) ? 'none' : '';
    var hp = ensureP();
    if (hp) hp.style.display = (jpMode === false || tsuMode) ? 'none' : '';
    if (jpMode === false) return;
    /* ★★★ 2026-10-26：视野判定的基准必须是 **#mapoverlay 的真实 transform**。
       mapcam 写 overlay 时用的是做了 ±360° 环绕的 `ox`（见 mapcam.js: ox = cam.tx ± per），
       而 cam.tx 没环绕 → 两者差一个世界宽度时，这里把所有标记都判成「视野外」
       → 用户看到的「数字一会儿有一会儿没有 / 缩放就消失」。
       直接读矩阵（e/f/a）最稳，和自己画的色块永远一致。 */
    var kk = cam.k, ox = (cam.ox != null ? cam.ox : cam.tx), oy = cam.ty;
    if (cam.ox == null) {
      try {
        var ov = document.getElementById('mapoverlay');
        if (ov) {
          var m = new DOMMatrixReadOnly(getComputedStyle(ov).transform);
          if (m && isFinite(m.a) && m.a > 0) { kk = m.a; ox = m.e; oy = m.f; }
        }
      } catch (e2) { }
    }
    buildMarks(cam);
    layMarks({ k: kk, tx: ox, ty: oy }, VIS);
  }

  g.QVShindo = { set: set, clear: clear, setAll: setAll, colorOf: colorOf, COLORS: COLORS, areas: A.areas,
    /** ★ 区域多边形的经纬度外接框（检测态范围框用：官方「县大小」矩形） */
    areaBounds: areaBounds,
    /** ★ 区域质心（经纬度 [lon,lat]）：色块震度数字的定位点 */
    areaCenter: areaCenter,
    rankOf: rankOf,
    setPoints: setPoints, clearPoints: clearPoints, areaOf: areaOf,
    /** ★ 2026-10-26：标记图层用哪套刻度（'shindo' | 'liedu'）——烈度要用自制的方形徽章 */
    setMetric: setMetric,    /** ★ 2026-10-26：区域数字层（方形）只在正式报显示；EEW 阶段应当 setMarksHidden(true) */
    setMarksHidden: setMarksHidden,    /** ★ 逐观测点标记（真经纬度）：相机放大到 ST_MIN_K 以上时自动接管 */
    setStations: setStations,
    /** ★ mapcam.paint() 每帧调：重排标记 + 把孤儿层挂回 #mapoverlay */
    updateView: updateView,
    /** ★ 海啸页模式：数字层隐藏 + 填充色块压暗（见 setTsuMode 注释） */
    setTsuMode: setTsuMode,
    /** 调试：标记尺寸基准（盒子基准 px；见 markPx 的官方公式注释） */
    pointSize: function (v) { if (v != null) MARK_BOX = v; return MARK_BOX; },
    /** 调试：当前某个 k 下标记的墨迹（屏幕）尺寸 */
    markPx: function (k) { var ink = markPx(1, k); return { ink: +ink.toFixed(1) }; },
    /** 调试：当前标记模式与画出的点数 */
    markStat: function () { return { mode: PTS.mode, nodes: PTS.nodes ? PTS.nodes.length : 0,
      area: PTS.area.length, station: PTS.station.length }; } };
})(window);
