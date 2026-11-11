/* cn-gmpe.js — 中国分区地震烈度衰减关系（GB 18306-2015 表 1）
 *
 * ★★★ 2026-10-26 用户：「中国区的模拟严重缺失优化 … 我们还缺少中国的地震数据和中国专用算法」
 *
 * 为什么必须换掉日本的司・翠川(1999)：
 *   司・翠川是**日本地壳地震**的 PGV 式（+0.0038D 的深度项、-0.002R 的路径项都在日本标定），
 *   直接套到中国会出现两头都错：
 *     · 近场偏低：M7.3 浅源在华南沿海，中国官方烈度图是 X 度（1918 南澳），
 *       我们算出来只有 VIII 度；
 *     · 远场偏低：香港离南澳 330km，历史上烈度 VI–VII 度，
 *       我们算出来只有 II 度（差 4 个烈度档）。
 *   根因不是"参数没调好"，而是**衰减规律本身不是同一套**：
 *   华南沿海是薄地壳 + 低 Q 的滨太平洋构造域，长周期面波衰减慢，
 *   远场烈度比日本海沟型地壳地震衰减得慢得多。
 *
 * 采用的关系式（中国官方、公开、可引用）：
 *   GB 18306-2015《中国地震动参数区划图》表 1「地震烈度衰减关系系数」
 *   （俞言祥、汪素云等；共 377 次 4 级以上地震、973 条等震线回归）
 *   模型：I = A + B·M − C·lg(R + R0)   —— 椭圆长、短轴联合衰减
 *
 *     分区        轴    A        B        C        R0    σ
 *     东部强震区  长  5.7123   1.3626   4.2903   25   0.5826
 *                 短  3.6588   1.3626   3.5406   13
 *     中强地震区  长  5.8410   1.0710   3.6570   15   0.5200
 *                 短  3.9440   1.0710   2.8450    7
 *     新疆区      长  5.6018   1.4347   4.4899   25   0.5924
 *                 短  3.6113   1.4347   3.8477   13
 *     青藏区      长  6.4580   1.2746   4.4709   25   0.6636
 *                 短  3.3682   1.2746   3.3119    9
 *   （长/短轴在 R=0 处相等 —— 这是原模型的约束，所以峰值不会因方向跳变）
 *
 * 本文件额外做的三件事（都有依据，不是拍脑袋）：
 *   ① **震源距 / 断层距**：模型里的 R 是震中距，但深源地震（如东北深震 400~600km）
 *      用震中距会算出震中正上方 10 度 —— 改用
 *        R = √( max(0, R_震中 − 0.5·L)² + max(0, h − 60)² )
 *      L = 断层长度（Wells & Coppersmith 1994: lgL = 0.59M − 2.44）
 *      浅源（≤60km）时与官方原式完全一致（南澳 M7.3/15km 的峰值仍是 X 度）。
 *   ② **方向性**：长短轴按区域断层走向合成 —— 沿走向取长轴、垂直走向取短轴
 *      I = I_短 + (I_长 − I_短)·|cos(方位 − 走向)|^1.2
 *      华南沿海/台湾 NE-SW、青藏 WNW-ESE、新疆 NW-SE —— 与实际等震线长轴一致。
 *   ③ **场地放大**：GB/T 17742 的场地调整 + 实测盆地效应
 *        · 珠江三角洲/港澳（厚层海相软土，30~50m）：+1.0 度 → **2026-10-27 起 ×0.5 = +0.5**
 *          —— 依据：1918 南澳 M7.3，香港天文台记录烈度 VI–VII（距震中 330km）
 *          ⚠ 那 1.0 度是按**远场**软土慢衰减标定的，直接全额套到近场会虚高（见下）
 *        · 台北盆地：+0.8 度（1986 花莲、1999 集集、2024 花莲均显著放大）
 *        · 台湾西部平原：+0.4 度 ｜ 长江三角洲：+0.7 度 ｜ 河套·汾渭：+0.5 度
 *        · 另外仍叠一层 USGS Global Vs30（vs30.js）→ ΔI = 3.44·lg(放大系数)
 *
 * ⚠️ 与项目统一刻度（appI）的换算：
 *   本项目全链路用的是 I = 2.68 + 1.72·lgPGV 这个连续刻度，
 *   QV_LIEDU/codeOfI 用 EDGES = [0.96, 2.00, 2.60, …] 把 appI 切成 1..12 度。
 *   中国关系式直接给「度」（连续值），所以本模块负责把「度」换回 appI：
 *     appI = lieduToI(度 + 0.5)
 *   +0.5 是关键：EDGES 是**每档下界**，直接用 lieduToI(度) 会把 9.7 度压成 9 度
 *   （南澳震中实测就是这个问题：9.66 度被画成 IX）。+0.5 = 按「四舍五入到最近档」。
 */
(function (global) {
  'use strict';

  /* ───────── 一、官方系数（GB 18306-2015 表 1） ─────────
   * [A, B, C, R0]，I = A + B·M − C·lg(R + R0) */
  var REGIONS = {
    east: { n: '东部强震区', lo: [5.7123, 1.3626, 4.2903, 25], sh: [3.6588, 1.3626, 3.5406, 13] },
    mid: { n: '中强地震区', lo: [5.8410, 1.0710, 3.6570, 15], sh: [3.9440, 1.0710, 2.8450, 7] },
    xj: { n: '新疆区', lo: [5.6018, 1.4347, 4.4899, 25], sh: [3.6113, 1.4347, 3.8477, 13] },
    qz: { n: '青藏区', lo: [6.4580, 1.2746, 4.4709, 25], sh: [3.3682, 1.2746, 3.3119, 9] }
  };

  /* ───────── 二、分区（近似矩形，只用于选哪一套系数） ─────────
   * ⚠️ 官方分区是「地震区/地震带」多边形；这里用矩形近似，
   *    对华南/东南沿海/台湾（= 东部强震区）与青藏、新疆的边界够用。
   *    唯一后果是边界附近可能选错一档系数（峰值差 ≤0.5 度）。 */
  function regionOf(lat, lon) {
    /* 新疆：73~96.5E，36.5~49.5N */
    if (lon >= 73 && lon <= 96.5 && lat >= 36.5 && lat <= 49.5) return 'xj';
    /* 青藏：西藏 + 青海 + 川西 + 滇西 + 甘南 */
    if (lon >= 73 && lon <= 105 && lat >= 26 && lat < 36.5) return 'qz';
    if (lon > 96.5 && lon <= 104 && lat >= 32 && lat <= 40) return 'qz';
    /* 东北（中强地震区主体） */
    if (lon >= 118 && lat >= 40) return 'mid';
    /* 其余（华北强震区 + 东南沿海 + 台湾 + 华南）→ 东部强震区 */
    return 'east';
  }

  /** 该坐标是否属于「中国关系式」适用范围（中国大陆 + 台湾 + 港澳） */
  function inChina(lat, lon) {
    if (!isFinite(lat) || !isFinite(lon)) return false;
    if (lon < 73 || lon > 135.5 || lat < 18 || lat > 54) return false;
    /* 剔除日本：本州/四国/九州/琉球 */
    if (lon >= 129 && lat >= 30 && lat <= 46) return false;
    if (lon >= 122 && lat >= 24 && lat < 31 && lon >= 129) return false;
    if (lon >= 141 && lat > 24 && lat < 46) return false;      /* 小笠原/伊豆 */
    /* 剔除琉球/先岛群岛（与那国 123E / 冲縄 127.7E）—— 台湾本岛只到 122.1E */
    if (lon >= 123 && lat >= 23 && lat < 31) return false;
    return true;
  }

  /* ───────── 三、区域断层走向（度，北=0 顺时针） ─────────
   * 依据中国活动地块边界的主要断裂走向：
   *   华南沿海/台湾：滨海断裂带、长乐—诏安断裂、台湾纵谷 —— NE-SW (~40°)
   *   华北：郯庐、太行山前、张家口—渤海 —— NNE (~30°)
   *   东北：依兰—伊通、敦化—密山 —— NE (~40°)
   *   青藏：东昆仑、鲜水河、海原 —— WNW-ESE (~105°)
   *   新疆：天山、阿尔金 —— NW-SE (~300°) */
  function strikeOf(lat, lon) {
    var r = regionOf(lat, lon);
    if (r === 'qz') {
      /* 青藏区内部走向差得很远，不能一律 WNW（会把汶川的等震线画成东西向）：
         · 云南（滇西/滇南）：曲江、红河、小江断裂 —— NW-SE ≈ 150°
         · 川西—龙门山—鲜水河—安宁河：NE-SW ≈ 40°（汶川/芦山/泸定都在这条带上）
         · 东昆仑 / 海原 / 祁连：WNW-ESE ≈ 105° */
      if (lat < 27 && lon < 104.5) return 150;
      if (lat >= 26 && lat <= 34.5 && lon >= 99 && lon <= 106.5) return 40;
      return 105;
    }
    if (r === 'xj') return 300;
    if (r === 'mid') return 40;
    /* 华北（35~41N / 106~122E）与华南沿海分开 */
    if (lat >= 35 && lat <= 41 && lon >= 106 && lon <= 122) return 30;
    if (lon >= 119 && lat <= 26) return 40;                    /* 台湾 + 闽台 */
    return 40;
  }

  /* ───────── 四、场地/盆地放大（度） ───────── */
  var SITES = [
    /* 珠江三角洲 + 港澳：厚层海相软土 ~30~50m，长周期面波共振 */
    { n: '珠江三角洲', b: [112.4, 21.8, 114.6, 23.4], d: 1.0 },
    /* 台北盆地 */
    { n: '台北盆地', b: [121.3, 24.9, 121.7, 25.3], d: 0.8 },
    /* 台湾西部平原（嘉南/彰云） */
    { n: '台湾西部平原', b: [120.0, 22.4, 121.4, 24.9], d: 0.4 },
    /* 长江三角洲（上海/苏州/嘉兴/南通/宁波） */
    { n: '长江三角洲', b: [120.0, 30.6, 122.2, 32.2], d: 0.7 },
    /* 河套·汾渭盆地（银川/西安/太原一线） */
    { n: '河套·汾渭', b: [106.0, 34.0, 113.0, 41.0], d: 0.5 },
    /* 雷州半岛/海口（琼北火山岩台地上的厚风化层） */
    { n: '琼北', b: [110.1, 19.8, 110.8, 20.2], d: 0.5 }
  ];
  /* ★★★ 2026-10-27 用户：「地图模拟的测站不准确，全都预估高了 2 个烈度单位；
     M6.5 / 10km / 江门市 烈度居然有 10」
  —— 表 1 本体是准的（M6.5 震中 8.57 度 = IX，与 2014 鲁甸 M6.5 IX 一致），
     多出来的 1~2 度全部来自**场地项被重复计了三次**：
       ① 区域盆地表（珠三角 +1.0）② 地质构造区（四川盆地 +0.6…）
       ③ 逐格 USGS Vs30（同一片软土又抬一次，权重还被调到 4.3）
     三者描述的是同一件事（软土/盆地放大），相加 = 同一块钱花三遍。
     实测江门震中：8.57 +1.0(珠三角) +0.28(Vs30) = 9.85 → 显示烈度 10。
  ⇒ 本版三条修正：
     ① SITE_SCALE：区域表幅度统一 ×0.5（它当初是按**远场**（南澳→香港 330km）
        的软土慢衰减标定的，直接全额套到近场就是虚高）；
     ② 区域项与 Vs30 **取绝对值大者**，不再相加（同一物理量只算一次）；
     ③ Vs30 权重回到 3.44（ΔI = 3.44·lg amp 的推导值），总修正封顶 ±1.0 度。 */
  var SITE_SCALE = 0.5;
  function siteDelta(lat, lon) {
    for (var i = 0; i < SITES.length; i++) {
      var s = SITES[i], b = s.b;
      if (lat >= b[1] && lat <= b[3] && lon >= b[0] && lon <= b[2]) return s.d * SITE_SCALE;
    }
    return 0;
  }
  function siteName(lat, lon) {
    for (var i = 0; i < SITES.length; i++) {
      var s = SITES[i], b = s.b;
      if (lat >= b[1] && lat <= b[3] && lon >= b[0] && lon <= b[2]) return s.n;
    }
    return '';
  }

  /* ───────── 四·2、地质构造区（沉积盆地 / 山系）调整 ─────────
   * ★★★ 2026-10-26 用户：「想让烈度分布跟着断层/地形变形」
   *   只靠单一场地修正（Vs30）仍然是光滑的同心椭圆。真实的烈度图是**不规则的**：
   *   · 厚层沉积盆地：长周期放大、衰减慢（四川盆地、华北平原、汾渭地堑、黄土高原）
   *   · 硬岩山系：高频衰减快、地形遮挡（川西高原、横断山、云贵高原）
   *   依据：GB 18306 场地分类 + 已发表的盆地放大观测
   *     （岷江/龙门山：成都平原 VI–VII、川西高山 VI；积石山 2023 黄土场地放大与砂涌）。
   *   ⚠️ 分区用矩形近似，値域控制在 ±0.6 度（不改变量级，只打破“正圆”）。 */
  var GEO = [
    { n: '四川盆地', b: [103.5, 28.5, 108.5, 32.6], d: 0.6 },
    { n: '黄土高原', b: [104.0, 34.0, 112.5, 40.5], d: 0.4 },
    { n: '华北平原', b: [113.5, 32.0, 120.5, 40.5], d: 0.5 },
    { n: '江汉—洞庭平原', b: [111.0, 28.5, 115.5, 31.5], d: 0.4 },
    { n: '汾渭地墅', b: [106.5, 34.0, 112.0, 39.0], d: 0.5 },
    { n: '河套平原', b: [106.0, 39.0, 111.5, 41.5], d: 0.4 },
    { n: '柴达木盆地', b: [92.0, 36.0, 99.0, 38.6], d: 0.2 },
    { n: '塔里木周缘', b: [76.0, 37.0, 88.0, 41.5], d: 0.2 },
    { n: '天山北麓', b: [82.0, 43.0, 90.0, 45.0], d: 0.2 },
    { n: '川西高原·横断山', b: [96.5, 26.0, 103.0, 34.0], d: -0.5 },
    { n: '云贵高原', b: [100.0, 22.0, 107.0, 27.0], d: -0.3 },
    { n: '青藏高原主体', b: [80.0, 30.0, 95.0, 36.0], d: -0.4 },
    { n: '秦巴山地', b: [105.0, 32.0, 111.0, 34.5], d: -0.3 },
    { n: '福建山区', b: [116.5, 24.0, 119.0, 28.0], d: -0.2 }
  ];
  function geoDelta(lat, lon) {
    for (var i = 0; i < GEO.length; i++) {
      var s = GEO[i], b = s.b;
      if (lat >= b[1] && lat <= b[3] && lon >= b[0] && lon <= b[2]) return s.d * SITE_SCALE;
    }
    return 0;
  }
  function geoName(lat, lon) {
    for (var i = 0; i < GEO.length; i++) {
      var s = GEO[i], b = s.b;
      if (lat >= b[1] && lat <= b[3] && lon >= b[0] && lon <= b[2]) return s.n;
    }
    return '';
  }

  /* ───────── 五、几何 ───────── */
  function kmBetween(lat1, lon1, lat2, lon2) {
    var dy = (lat2 - lat1) * 111.0;
    var dx = (lon2 - lon1) * 111.0 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function bearing(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    var dl = (lon2 - lon1) * Math.PI / 180;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  }
  function faultLen(M) {
    /* Wells & Coppersmith (1994) 地表破裂长度，与本项目海啸模块同一式 */
    return Math.min(1600, Math.max(1, Math.pow(10, 0.59 * M - 2.44)));
  }

  /** 有效距离：**断层距（Joyner–Boore）** + 深源项
   *  ★★★ 2026-10-26 用户：「烈度 5 以下就变成画圆模拟器了…想让烈度分布跟着断层/地形变形」
   *
   *  以前用「震中距 − 0.5L」：只能把圆心不变地整体缩一点，等震线还是同心圆/同心椭圆。
   *  现在改成**到断层线段的距离**（断层沿走向 φ 长 L，震中在中点）：
   *     s = 沿走向投影（km）｜n = 垂直走向投影（km）
   *     R_JB = √( max(0, |s| − L/2)² + n² )
   *  ⇒ 沿走向 50km 的地方 R_JB = 0（在破裂面上，烈度≈峰值），
   *     垂直走向 50km 的地方 R_JB = 50 —— 等震线自然沿断层拉长，
   *     而且拉长程度随震级（断层长度）变化：M5 几乎正圆（L≈10km），M7.8 拉成 100km 的长条。
   *  ⚠️ 远场（≫L）R_JB ≈ 震中距，形状仍趋于圆形 ——
   *     这是 GB 模型本身的设计（「远场发震构造影响消失，等震线成圆形」），不是 bug。
   */
  function jbDist(rEpi, brgDeg, M, strikeDeg, off, len) {
    var L = (len > 0) ? len : faultLen(M);
    if (M < 6.0 || !(L > 1)) return rEpi;
    /* ★★★ 2026-10-26 用户：「汶川官方最高烈度是 11 度（青川、北川），但破裂是往北东延伸 300km」
       —— 以前断层以震中为**中心对称**，所以 90~200km 外的北川/青川落在断层外，
          烈度掉到 9.3 / 7.5。现在支持「震中在破裂段上的位置」：
            off = −0.5（震中在最西南端，破裂全往北东）… +0.5（震中在最北东端）… 0（居中）
            len = 实际地表破裂长度（km），不传就用 Wells & Coppersmith 的 10^(0.59M−2.44)
       ⚠️ 这个几何**只参与计算**，前端不画断层线（用户明确要求）。
       汶川：strike 40°、len 300、off −0.45 → 映秀→青川整条破裂都在 11 度圈里。 */
    var c = (off || 0) * L;
    var th = (brgDeg - strikeDeg) * Math.PI / 180;
    var s = rEpi * Math.cos(th), n = rEpi * Math.sin(th);
    var ds = Math.max(0, Math.abs(s - c) - L / 2);
    return Math.sqrt(ds * ds + n * n);
  }
  function effR(rEpi, dep, M, brg, strike, off, len) {
    var r = jbDist(rEpi, brg, M, (strike == null) ? 40 : strike, off, len);
    var h = Math.max(0, (+dep || 10) - 60);
    return Math.sqrt(r * r + h * h);
  }

  function axisI(co, M, R) {
    return co[0] + co[1] * M - co[2] * Math.log(R + co[3]) / Math.LN10;
  }
  /* ───────────────── 大震近场饱和（M ≥ 7.4） ─────────────────
   * ★★★ 2026-10-26 用户：「汶川地震的官方最高烈度是 11 度（青川、北川等地），为什么模拟就 10」
   *   GB 18306 表 1 是 4.0~8.x 混合回归，**巨震的极震区偏低约 0.5~0.7 度**，
   *   用 4 场官方极震区（已公布等震线）标定：
   *     汶川 2008 M8.0 → XI（表 1 给 10.4）｜唐山 1976 M7.8 → XI（10.3）
   *     海原 1920 M8.5 → XII（11.3）｜郯城 1668 M8.5 → XII（11.3）
   *   ⇒ 取线性 +0.55·(M−7.4)，封顶 +0.7。M ≤ 7.4 不生效（南澳 M7.3 / 花莲 M7.3 不受影响）。
   *   ⚠️ 这是「断层尺度 ≫ 波长后近场不再随 M 线性增长」的经典饱和修正的反向补充：
   *      表 1 在大 M 段样本稀 → 峰值被拉低；官方等震线才是真正的标尺。 */
  function bigBoost(M) {
    if (!(M > 7.4)) return 0;
    return Math.min(0.7, 0.55 * (M - 7.4));
  }

  /* ══════ 官方等震线插值（逐事件钉死） ══════
   * iso = [[度, 长半轴 km, 短半轴 km], …]，度降序；椭圆中心可沿走向偏移（off·len）。
   * 每一级椭圆**各自**的长短半轴（XI 带窄而长、VI 区扁而宽）→ 先求该方向上的边界半径，
   * 再按 ln(r) 在相邻两级之间线性插值。最外一级之外按「半径每翻倍掉 1.5 度」外推。 */
  function intensityFromIso(lat0, lon0, lat, lon, iso, strike, off, len, M) {
    var d2r = Math.PI / 180;
    var rEpi = kmBetween(lat0, lon0, lat, lon);
    var th = (bearing(lat0, lon0, lat, lon) - strike) * d2r;
    var s = rEpi * Math.cos(th), n = Math.abs(rEpi * Math.sin(th));
    var L = (len > 0) ? len : faultLen(M || 6);
    s = Math.abs(s - (off || 0) * L);
    var r = Math.sqrt(s * s + n * n);
    if (!(r > 0.5)) return iso[0][0];
    var ang = Math.atan2(n, s), ca = Math.cos(ang), sa = Math.sin(ang);
    var rs = [], i;
    for (i = 0; i < iso.length; i++) {
      var e = iso[i], a = Math.max(1, e[1]), b = Math.max(1, e[2]);
      rs.push(1 / Math.sqrt((ca / a) * (ca / a) + (sa / b) * (sa / b)));
    }
    if (r <= rs[0]) return iso[0][0];
    for (i = 1; i < iso.length; i++) {
      if (r <= rs[i]) {
        var t = (Math.log(r) - Math.log(rs[i - 1])) /
          Math.max(1e-6, Math.log(rs[i]) - Math.log(rs[i - 1]));
        return iso[i - 1][0] + (iso[i][0] - iso[i - 1][0]) * Math.max(0, Math.min(1, t));
      }
    }
    var k = iso.length - 1;
    return Math.max(0, iso[k][0] - 1.5 * Math.log(r / Math.max(1, rs[k])) / Math.LN2);
  }

  /** 某点的连续烈度（度，含断层距 / 场地 / 地质分区）
   *  opt = { strike: 断层走向(度) } —— 不传就用区域默认走向 */
  function intensity(lat0, lon0, M, dep, lat, lon, opt) {
    if (!isFinite(lat0) || !isFinite(lon0) || !isFinite(lat) || !isFinite(lon)) return 0;
    /* ★★★ 2026-10-26 用户选型：「用官方等震线半径钉死」
       目录里带 `iso`（官方烈度图量出来的长/短半轴）时，**直接按等震线插值**，
       GMPE 完全不参与 —— 这是唯一能让汶川的 XI 带落在北川/青川、
       同时让成都回到 VI–VII 的办法（表 1 的回归式巨震远场偏高 2 度）。
       iso 格式：[[度, 长半轴 km, 短半轴 km], …] 按度**降序**；
       椭圆中心 = 破裂段中心（用 off/len 算），所以沿断层长条自然成型。 */
    var _iso = (opt && (opt.iso || (opt.fault && opt.fault.iso))) || null;
    if (_iso && _iso.length) {
      var _f0 = (opt && opt.fault) || null;
      var _st = (_f0 && isFinite(_f0.strike)) ? +_f0.strike
        : (isFinite(opt.strike) ? +opt.strike : strikeOf(lat0, lon0));
      return intensityFromIso(lat0, lon0, lat, lon, _iso, _st, _f0 && _f0.off, _f0 && _f0.len, M);
    }
    M = Math.max(1, Math.min(10, +M || 0));
    var R = REGIONS[regionOf(lat0, lon0)];
    var _f = (opt && opt.fault) || null;
    var strike = (opt && isFinite(opt.strike)) ? +opt.strike
      : (_f && isFinite(_f.strike)) ? +_f.strike : strikeOf(lat0, lon0);
    var rEpi = kmBetween(lat0, lon0, lat, lon);
    var brg = bearing(lat0, lon0, lat, lon);
    var Re = effR(rEpi, dep, M, brg, strike, _f && _f.off, _f && _f.len);
    var Ilo = axisI(R.lo, M, Re), Ish = axisI(R.sh, M, Re);
    var th = brg - strike;
    var k = Math.abs(Math.cos(th * Math.PI / 180));
    var I = Ish + (Ilo - Ish) * Math.pow(k, 1.2);
    I += bigBoost(M);          /* 巨震极震区饱和修正（见 bigBoost 注释） */
    /* ★ 2026-10-26 逐事件标定偏移：目录里给了官方极震区烈度时，
       把「官方 − 模型峰值」当作整场偏移量（±1 度封顶）。
       例：汶川模型峰值 10.65、官方 XI → +0.35，让北川/青川这条破裂带也到 11。 */
    if (opt && isFinite(opt.boost)) I += Math.max(-1, Math.min(1, +opt.boost));
    /* 场地（区域盆地表 + 地质构造区）与 USGS Vs30
       ΔI = 3.44·lg(amp)（= PGV 刻度的 1.72·lg 换算到「度」）
       ★★★ 2026-10-27 用户：「地图测站全都预估高了 2 个烈度单位」
         —— 区域场地区划和逐格 Vs30 说的是同一件事，以前**相加**，
            江门震中因此多出 +1.28 度（珠三角 +1.0 + Vs30 +0.28）。
         ⇒ 取【绝对值较大者】，同一物理量只计一次；总修正封顶 ±1.0 度。 */
    var _reg = siteDelta(lat, lon) + geoDelta(lat, lon);
    var _vs = 0;
    try {
      if (global.QVVS30At) {
        var amp = global.QVVS30At(lat, lon) || 1;
        if (amp !== 1) _vs = 3.44 * Math.log(amp) / Math.LN10;
      }
    } catch (e) { }
    var _d = (Math.abs(_vs) > Math.abs(_reg)) ? _vs : _reg;
    if (_d > 1.0) _d = 1.0; else if (_d < -1.0) _d = -1.0;
    I += _d;
    /* ── 远场收敛（2026-10-27 新增）──────────────────────────────
     * 表 1 是「4 级以上、以等震线长/短半轴为样本」的回归式，外推到**有感边界以外**
     * 衰减过慢：M6.5 在 1200km 外还算出 0.73 度（→ 显示「烈度1」），
     * 于是上海/南京/太原/北京全被刷上 1 度色块，正式报的取景包围盒被撑到 27 个经度
     * （用户：「正式版的完美相机被搞坏了」）。
     * 实测对照（中国地震台网历史等震线）：M6.5 的 IV 度约 220km、III 度约 330km、
     * II 度约 440km、有感边界约 500km，800km 外无感。
     * ⇒ R 超过 Rk 之后乘 (Rk/R)^1.7；Rk = 118·10^(0.25(M−5))
     *    M5→118km / M6.5→280km / M7.3→444km / M7.8→591km。近场完全不受影响
     *    （南澳 M7.3→香港 330km 还在 Rk 之内，VI–VII 的标定不变）。
     *    复核（M6.5 江门）：0km=Ⅸ / 56=Ⅶ / 111=Ⅵ / 222=Ⅳ / 333=Ⅲ / 444≈Ⅰ /
     *                       800km 以下 = 0（上海、南京、北京不再被刷 1 度）。 */
    var _Rk = 118 * Math.pow(10, 0.25 * Math.max(0, M - 5));
    if (Re > _Rk) I *= Math.pow(_Rk / Re, 1.7);
    return Math.max(0, Math.min(12, I));
  }

  /** 震中（R=0）的烈度 —— 卡片「最大烈度」用它 */
  function peak(M, dep, lat0, lon0) {
    M = Math.max(1, Math.min(10, +M || 0));
    var R = REGIONS[regionOf(lat0, lon0)];
    var Re = Math.max(0, (+dep || 10) - 60);      /* 震中处 R_JB = 0，只剩深源项 */
    var I = axisI(R.lo, M, Re) + bigBoost(M);   /* R=0 时长轴 = 短轴（原模型约束） */
    if (isFinite(lat0) && isFinite(lon0)) {
      var _d = siteDelta(lat0, lon0) + geoDelta(lat0, lon0);
      I += Math.max(-1.0, Math.min(1.0, _d));
    }
    return Math.max(0, Math.min(12, I));
  }

  /* ───────── 六、度 ↔ 项目统一刻度（appI） ───────── */
  var FALLBACK_EDGES = [0.96, 2.00, 2.60, 3.12, 3.62, 4.14, 4.65, 5.17, 5.70, 6.19, 6.71, 7.23];
  function edges() {
    var L = global.QV_LIEDU;
    return (L && L.EDGES && L.EDGES.length === 12) ? L.EDGES : FALLBACK_EDGES;
  }
  /** 连续烈度（度）→ appI（1..12 档下界之间线性插值） */
  function lieduToI(L) {
    var E = edges();
    if (!isFinite(L) || L <= 1) return Math.max(0, (L || 0) * E[0]);
    if (L >= 12.9) return E[11] + 0.5;
    var d = Math.floor(L);                     /* 1..12 */
    var lo = E[d - 1], hi = (d < 12) ? E[d] : lo + 0.5;
    return lo + (L - d) * (hi - lo);
  }
  /** 度 → appI（四舍五入到最近一档，见文件头说明） */
  function appI(L) { return lieduToI(Math.max(0, Math.min(12.4, (+L || 0) + 0.5))); }
  /** appI → 连续烈度（度），给需要反查的地方用 */
  function lieOfI(I) {
    var E = edges(), d = 1;
    for (var i = 11; i >= 0; i--) if (I >= E[i]) { d = i + 1; break; }
    var lo = E[d - 1], hi = (d < 12) ? E[d] : lo + 0.5;
    return d + Math.max(0, Math.min(1, (I - lo) / (hi - lo || 1)));
  }

  /* ════════ 七、长周期地震动（LPGM）—— 用 GB 18306-2015 表 5 的 vE 关系 ════════
   * ★★★ 2026-10-26 用户选型：「长周期地震动按中国分区重算」
   *   日本那套（views.js lgpmSv）是拿熊本/東北/小笠原四场标定的经验式；
   *   中国有自己的**官方**长周期参数：
   *     GB 18306-2015 表 5「中国分区 vE 衰减关系参数」
   *       lg vE = A + B·M + C·lg(R + D·e^(E·M))      （M<6.5 / M≥6.5 两段系数）
   *     vE = 有效峰值速度（cm/s，**本身就是 1.6~7.5s 平台谱速度的量级**）。
   ★ 2026-10-27 修正：以前再乘 2.5（当成「已除以 2.5 的平台值」）→ 长周期一按就满级，
     现在直接用 v·amp（见下方 lgpmSv 里的标定说明）。
   *   Sv 正好就是 JMA 長周期地震動階級的判据（周期 1.6~7.5s、阻尼 5% 的绝对速度响应）：
   *     階級1: 5~15 ｜ 2: 15~50 ｜ 3: 50~100 ｜ 4: ≥100 cm/s
   *   ⚠️ 表 5 是**基岩**场地；沉积盆地的长周期放大另乘 basinAmp（厚层软土共振）。
   */
  var VCOEF = {
    east: {
      lo: { a1: -0.363, b1: 0.791, a2: 1.437, b2: 0.513, C: -2.103, D: 2.088, E: 0.399 },
      sh: { a1: -1.147, b1: 0.788, a2: 0.712, b2: 0.502, C: -1.825, D: 0.944, E: 0.447 }
    },
    mid: {
      lo: { a1: 0.093, b1: 0.621, a2: 1.640, b2: 0.382, C: -1.889, D: 2.802, E: 0.295 },
      sh: { a1: -0.589, b1: 0.601, a2: 0.671, b2: 0.407, C: -1.559, D: 1.295, E: 0.331 }
    },
    xj: {
      lo: { a1: -0.547, b1: 0.840, a2: 1.310, b2: 0.554, C: -2.181, D: 1.772, E: 0.424 },
      sh: { a1: -1.351, b1: 0.843, a2: 0.569, b2: 0.549, C: -1.945, D: 0.825, E: 0.465 }
    },
    qz: {
      lo: { a1: -0.064, b1: 0.766, a2: 1.714, b2: 0.491, C: -2.205, D: 2.647, E: 0.366 },
      sh: { a1: -1.301, b1: 0.741, a2: 0.443, b2: 0.474, C: -1.696, D: 0.612, E: 0.457 }
    }
  };
  function velE(co, M, R) {
    var A = (M < 6.5) ? co.a1 : co.a2, B = (M < 6.5) ? co.b1 : co.b2;
    var x = Math.max(1, R + co.D * Math.exp(co.E * M));
    return Math.pow(10, A + B * M + co.C * Math.log(x) / Math.LN10);
  }
  /** 长周期（1.6~7.5s）绝对速度响应 Sv（cm/s），含断层距 / 盆地放大 */
  function lgpmSv(lat0, lon0, M, dep, lat, lon, opt) {
    if (!isFinite(lat0) || !isFinite(lon0) || !isFinite(lat) || !isFinite(lon)) return 0;
    M = Math.max(1, Math.min(10, +M || 0));
    var V = VCOEF[regionOf(lat0, lon0)];
    var _f2 = (opt && opt.fault) || null;
    var strike = (opt && isFinite(opt.strike)) ? +opt.strike
      : (_f2 && isFinite(_f2.strike)) ? +_f2.strike : strikeOf(lat0, lon0);
    var rEpi = kmBetween(lat0, lon0, lat, lon);
    var brg = bearing(lat0, lon0, lat, lon);
    var R = effR(rEpi, dep, M, brg, strike, _f2 && _f2.off, _f2 && _f2.len);
    var vlo = velE(V.lo, M, R), vsh = velE(V.sh, M, R);
    var k = Math.abs(Math.cos((brg - strike) * Math.PI / 180));
    var v = vsh + (vlo - vsh) * Math.pow(k, 1.2);
    /* 沉积盆地长周期放大（厚层软土共振，1.6~7.5s 最敏感）：
       四川盆地/华北平原/珠三角/长三角/台北盆地 等；山区不放大
       ★★★ 2026-10-27 用户：「M6.5/10km/江门 长地震周期直接拉满了」
         —— 原来三道放大叠在一起：2.5·vE（表 5 的平台换算）× 最高 2.2（盆地）× 全区 +1.0 场地。
            江门震中算出 Sv = 293 cm/s（階級4 上限是 100），难怪一按就满。
         ⇒ ① 不再乘 2.5：表 5 的 vE 本身就是**有效峰值速度**，与 1.6~7.5s 平台谱速度同量级，
              再乘 2.5 属于重复放大（用熊本 M7.1 ≈100 cm/s = 階級4 这场实测反标，
              乘 2.5 会得到 165，乘 1 得 66，与日本那套已验证的式子同量级）；
            ② 盆地放大系数 2.2 → 最高 1.35（1 + 0.35·min(1, g/0.6)）。
        现在：江门 M6.5 → 53.7 × 1.29 ≈ 69 cm/s = 阶級3（强烈）；
              M7.0 ≈ 86（仍然 3）、M7.8 ≈ 113（才到 4）。 */
    var g = Math.max(0, siteDelta(lat, lon) + geoDelta(lat, lon));
    var amp = 1 + 0.35 * Math.min(1, g / 0.6);
    return v * amp;
  }

  global.QVCNGM = {
    REGIONS: REGIONS,
    regionOf: regionOf,
    regionName: function (lat, lon) { return REGIONS[regionOf(lat, lon)].n; },
    inChina: inChina,
    strikeOf: strikeOf,
    siteDelta: siteDelta,
    siteName: siteName,
    geoDelta: geoDelta,
    geoName: geoName,
    jbDist: jbDist,
    effR: effR,
    lgpmSv: lgpmSv,
    VCOEF: VCOEF,
    bigBoost: bigBoost,
    intensityFromIso: intensityFromIso,
    faultLen: faultLen,
    intensity: intensity,
    peak: peak,
    appI: appI,
    lieOfI: lieOfI,
    lieduToI: lieduToI,
    kmBetween: kmBetween,
    version: '2026-10-27 GB18306-2015 表1 + 表5（场地/远场/长周期重标定）'
  };
})(window);
