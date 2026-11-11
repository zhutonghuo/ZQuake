/* liedu.js — 「最大烈度」色卡（中国地震烈度表 1–12 度）
 *
 * ★★ 官方色卡是【底色 + 字色】成对的，不是只有底色 ★★
 *   反编译 + 逐个造型取色（官方 UI 精灵）：
 *     震度0  #62626b / 白     震度1  #2b8eb2 / 白     震度2  #4cd0a7 / #1c1c1c
 *     震度3  #f6cb51 / #1c1c1c  震度4  #ff9939 / #1c1c1c
 *     震度5弱 #e52a18 / 白     5強 #c31b1b / 白      6弱 #a50c6b / 白
 *     6強 #930a7a / 白         震度7 #5f0ca2 / 白     不明 #31476d / 白
 *   ⇒ 规则：**底色亮 → 字用深色 #1c1c1c；底色暗 → 字用白色**
 *   本文件的 12 级配色沿用这个结构（浅 → 深），所以字色也跟着分级变化。
 *
 * ⚠️ 永远不要用 Unicode 罗马数字（Ⅰ–Ⅻ）画大号数字：实测 <img> 里的 SVG 会掉字形
 *    （渲染成方块）。现在用阿拉伯数字 <text>，任何字体都有，安全。
 *
 * 几何全部复用官方：
 *   · 主卡色块 = 官方 paSc1 的 path（画布 248x120，色块 208x80 圆角 10 @ (20,20)）
 *   · 大号数字槽 = 官方 snd 画布 80x80、数字中心 (40,40)、字高 46
 *   · 履历徽章 = 官方 paTm 画布 264x116、色块 (28,26) 48x62、
 *                「最大震度」白字 (36.07,34.15) 31.78x7.79、大数字 (46.85,50.95) 8.79x27.07
 */
(function (global) {
  'use strict';

  /* ---------- 12 级配色（烈度 1..12）——— 底色，按「浅 → 深」排 ----------
     ★ 2026-10-21：11 度原来是 #8a2be2（蓝紫），跑到官方色系外面去了 ——
       官方震度红→品红→深紫的收尾是 #a50c6b → #930a7a → #5f0ca2，
       所以 11 度改成 #930a7a，12 度沿用官方震度7 的 #5f0ca2，整条色阶才连得上。 */
  var LIEDU_COLORS = {
    1: '#b9d7ff', 2: '#7fc4ff', 3: '#4cd0a7', 4: '#7ed957',
    5: '#f6cb51', 6: '#ff9939', 7: '#ff6b35', 8: '#e52a18',
    9: '#c31b1b', 10: '#a50c6b', 11: '#930a7a', 12: '#5f0ca2'
  };
  var LIEDU_UNKNOWN = '#31476d';        /* 「不明」用官方同款深蓝 */
  var SHINDO_ZERO = '#62626b';          /* ★ 官方色卡第 1 档「震度0」的底色（灰） */
  var TEXT_DARK = '#1c1c1c';            /* 官方 paTm2/3/4 的深字色 */
  var TEXT_LIT = '#ffffff';

  /** 底色：0 = 官方「震度0」灰；1..12 = 烈度色阶；其余（含 -1 不明）= 不明深蓝
   *  ★ 用户要求：没有震度/烈度的地震不要把卡片留空 —— 走官方设置
   *    「显示震度 0 的图标」，画成震度0（灰底 + 大号 0）。 */
  function colorOf(v) {
    var n = Math.round(v);
    if (!isFinite(n)) return LIEDU_UNKNOWN;
    if (n === 0) return SHINDO_ZERO;
    if (n < 1) return LIEDU_UNKNOWN;
    return LIEDU_COLORS[n] || LIEDU_COLORS[12];
  }
  /** 底色 → 字色（官方规则：亮的用深字，暗的用白字）
   *  ★★★ 2026-10-27 用户：「最大烈度 7 的字体换成黑色的」
   *     —— 烈度7 底色 #ff6b35 的亮度 = 0.569，原来卡在 0.58 门槛下面 → 用了白字，
   *        橙底白字发虚。门槛降到 0.50：烈度7 转深字，烈度8（#e52a18，亮度 0.376）
   *        仍然是白字，不受影响。 */
  function textOf(v) {
    var c = colorOf(v);
    var r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum >= 0.50 ? TEXT_DARK : TEXT_LIT;
  }  /** ★ 大号数字改用【官方数字字形】排（render3 里用 QVT.num）——官方造型本体是纯红，
   *  刷成目标色的滤镜：brightness(0) 先压黑（形状与 alpha 全保留）→ invert(k) 提亮。
   *    k = 0x1c/255 ≈ 0.11 → #1c1c1c（官方深字色）；k = 1 → 白。
   *  ⚠️ 千万不要再用 `<text>` + 系统字体：官方数字是圆润细笔画，系统字体（连 font-weight:400）
   *     都明显更粗 —— 用户报的就是「烈度的数字是不是太粗了，原版都没这么粗」。 */
  function glyphFilter(v) {
    return textOf(v) === TEXT_DARK ? 'brightness(0) invert(.11)' : 'brightness(0) invert(1)';
  }
  /* ---------- 官方数字字形 0~9（取自 js/glyph-metrics.js 指向的官方字形文件） ----------
     ★★★ 2026-10-21 用户：「烈度到 10、11、12 后这个好丑啊，完全没有原版的样子」
       第一版用系统字体 <text> 画 —— 笔画粗细、字宽、收笔全是微软雅黑的，两位数一挤更明显。
       现在把官方 `QV_GLYPH` 那 10 个数字字形（时钟/震级用的那套，同一款字体）的 path 内联进来，
       两位数按**官方字距**（ink 宽 + 4 设计单位，见 texts.js `num()` 的官方公式）并排拼。
       字形画布 100×100，path 原始坐标带 translate(-190,-130)，墨迹 bbox 见下表。
       墨高基准 = '0' 的墨高 29.4（画布单位）→ scale = capH / 29.4。 */
  var NUMG = {
    '0': { d: 'M243.792,187.027v-13.8h3.64v13.8zM232.552,187.027v-13.8h3.64v13.8zM239.872,168.547v-3.12h0.24v3.12zM239.872,194.827v-3.16h0.24v3.16zM232.552,173.227c0,-1.52 0.32,-2.85333 0.96,-4c0.66667,-1.17333 1.54667,-2.09333 2.64,-2.76c1.12,-0.69333 2.38667,-1.04 3.8,-1.04v3.12c-1.17333,0 -2.09333,0.41333 -2.76,1.24c-0.66667,0.8 -1,1.94667 -1,3.44zM247.432,173.227h-3.64c0,-1.49333 -0.33333,-2.64 -1,-3.44c-0.64,-0.82667 -1.56,-1.24 -2.76,-1.24v-3.12c1.41333,0 2.66667,0.34667 3.76,1.04c1.12,0.66667 2,1.58667 2.64,2.76c0.66667,1.14667 1,2.48 1,4zM232.552,187.027h3.64c0,1.46667 0.33333,2.61333 1,3.44c0.66667,0.8 1.58667,1.2 2.76,1.2v3.16c-1.41333,0 -2.68,-0.33333 -3.8,-1c-1.09333,-0.69333 -1.97333,-1.62667 -2.64,-2.8c-0.64,-1.17333 -0.96,-2.50667 -0.96,-4zM247.432,187.027c0,1.49333 -0.33333,2.82667 -1,4c-0.64,1.17333 -1.52,2.10667 -2.64,2.8c-1.09333,0.66667 -2.34667,1 -3.76,1v-3.16c1.2,0 2.12,-0.4 2.76,-1.2c0.66667,-0.82667 1,-1.97333 1,-3.44z', bb: [42.55, 35.43, 57.43, 64.83] },
    '1': { d: 'M236.838,174.307l-2.2,-2.28l5.52,-6v4.64zM240.158,194.227v-28.2h3.64v28.2z', bb: [44.64, 36.03, 53.8, 64.23] },
    '2': { d: 'M233.585,190.987c0.02667,-1.78667 0.28,-3.32 0.76,-4.6c0.50667,-1.30667 1.14667,-2.42667 1.92,-3.36c0.8,-0.96 1.64,-1.82667 2.52,-2.6c0.88,-0.8 1.70667,-1.58667 2.48,-2.36c0.77333,-0.8 1.41333,-1.65333 1.92,-2.56c0.50667,-0.93333 0.76,-2.02667 0.76,-3.28c0,0 0.12,0 0.36,0c0.24,0 0.53333,0 0.88,0c0.37333,0 0.74667,0 1.12,0c0.37333,0 0.68,0 0.92,0c0.24,0 0.36,0 0.36,0c0,1.65333 -0.25333,3.06667 -0.76,4.24c-0.50667,1.14667 -1.16,2.16 -1.96,3.04c-0.77333,0.88 -1.61333,1.70667 -2.52,2.48c-0.88,0.74667 -1.72,1.53333 -2.52,2.36c-0.77333,0.82667 -1.41333,1.77333 -1.92,2.84c-0.50667,1.04 -0.77333,2.30667 -0.8,3.8zM233.585,194.227v-3.24h13.96v3.24zM236.385,171.747l-3.36,-0.68c0.16,-1.17333 0.56,-2.2 1.2,-3.08c0.66667,-0.90667 1.52,-1.61333 2.56,-2.12c1.04,-0.50667 2.17333,-0.76 3.4,-0.76v3.16c-0.96,0 -1.8,0.28 -2.52,0.84c-0.72,0.56 -1.14667,1.44 -1.28,2.64zM247.585,172.267h-3.64c0,-1.17333 -0.36,-2.13333 -1.08,-2.88c-0.72,-0.74667 -1.62667,-1.12 -2.72,-1.12v-3.16c1.41333,0 2.68,0.32 3.8,0.96c1.12,0.61333 2,1.46667 2.64,2.56c0.66667,1.06667 1,2.28 1,3.64z', bb: [43.02, 35.11, 57.59, 64.23] },
    '3': { d: 'M239.901,180.987v-3.16c1.01333,0 1.84,-0.44 2.48,-1.32c0.66667,-0.88 1,-2.01333 1,-3.4h3.64c0,1.52 -0.30667,2.88 -0.92,4.08c-0.58667,1.17333 -1.41333,2.10667 -2.48,2.8c-1.06667,0.66667 -2.30667,1 -3.72,1zM243.781,187.747v-2.8h3.64v2.8zM237.461,180.987v-3.16h2.48v3.16zM243.381,173.147c0,-1.33333 -0.33333,-2.42667 -1,-3.28c-0.64,-0.85333 -1.46667,-1.28 -2.48,-1.28v-3.16c1.41333,0 2.65333,0.33333 3.72,1c1.06667,0.64 1.89333,1.54667 2.48,2.72c0.61333,1.14667 0.92,2.48 0.92,4zM247.421,187.707c0,1.36 -0.32,2.58667 -0.96,3.68c-0.64,1.06667 -1.52,1.92 -2.64,2.56c-1.12,0.61333 -2.38667,0.92 -3.8,0.92v-3.16c1.09333,0 1.98667,-0.37333 2.68,-1.12c0.72,-0.77333 1.08,-1.73333 1.08,-2.88zM247.421,184.987h-3.64c0,-1.17333 -0.36,-2.13333 -1.08,-2.88c-0.69333,-0.74667 -1.58667,-1.12 -2.68,-1.12v-3.16c1.41333,0 2.68,0.30667 3.8,0.92c1.12,0.61333 2,1.46667 2.64,2.56c0.64,1.09333 0.96,2.32 0.96,3.68zM236.141,172.067l-3.36,-0.68c0.16,-1.17333 0.56,-2.2 1.2,-3.08c0.66667,-0.90667 1.52,-1.61333 2.56,-2.12c1.04,-0.50667 2.17333,-0.76 3.4,-0.76v3.16c-0.96,0 -1.8,0.28 -2.52,0.84c-0.72,0.56 -1.14667,1.44 -1.28,2.64zM236.261,188.227c0.13333,1.17333 0.54667,2.05333 1.24,2.64c0.72,0.56 1.57333,0.84 2.56,0.84v3.16c-1.25333,0 -2.4,-0.25333 -3.44,-0.76c-1.01333,-0.50667 -1.85333,-1.21333 -2.52,-2.12c-0.64,-0.90667 -1.04,-1.93333 -1.2,-3.08z', bb: [42.78, 35.43, 57.42, 64.87] },
    '4': { d: 'M231.673,185.067l7.28,-19.04h3.64l-7.28,19.04zM231.673,188.307v-3.24h16.48v3.24zM241.673,194.227v-15.96h3.4v15.96z', bb: [41.67, 36.03, 58.15, 64.23] },
    '5': { d: 'M233.152,182.307v-16.28h3.44v16.28zM243.632,187.067v-4.64h3.64v4.64zM233.152,169.267v-3.24h13.4v3.24zM243.632,182.427c0,-1.2 -0.36,-2.18667 -1.08,-2.96c-0.72,-0.77333 -1.62667,-1.16 -2.72,-1.16l0.48,-3c1.33333,0 2.52,0.30667 3.56,0.92c1.06667,0.61333 1.89333,1.46667 2.48,2.56c0.61333,1.06667 0.92,2.28 0.92,3.64zM234.272,182.307c0,-1.33333 0.25333,-2.52 0.76,-3.56c0.53333,-1.06667 1.26667,-1.90667 2.2,-2.52c0.93333,-0.61333 1.97333,-0.92 3.12,-0.92l-0.48,3c-0.93333,0 -1.72,0.37333 -2.36,1.12c-0.61333,0.74667 -0.92,1.70667 -0.92,2.88zM247.272,187.067c0,1.49333 -0.33333,2.82667 -1,4c-0.64,1.17333 -1.52,2.10667 -2.64,2.8c-1.09333,0.66667 -2.34667,1 -3.76,1v-3.16c1.2,0 2.12,-0.41333 2.76,-1.24c0.66667,-0.82667 1,-1.96 1,-3.4zM236.112,188.227c0.13333,1.17333 0.56,2.05333 1.28,2.64c0.72,0.56 1.56,0.84 2.52,0.84v3.16c-1.22667,0 -2.36,-0.25333 -3.4,-0.76c-1.04,-0.50667 -1.89333,-1.21333 -2.56,-2.12c-0.64,-0.90667 -1.04,-1.93333 -1.2,-3.08z', bb: [42.75, 36.03, 57.27, 64.87] },
    '6': { d: 'M232.908,184.107c0,-2.13333 0.21333,-4.13333 0.64,-6c0.45333,-1.86667 1.05333,-3.58667 1.8,-5.16c0.74667,-1.6 1.57333,-3.02667 2.48,-4.28c0.93333,-1.28 1.89333,-2.4 2.88,-3.36l2.72,1.96c-0.88,0.96 -1.73333,1.96 -2.56,3c-0.82667,1.01333 -1.56,2.16 -2.2,3.44c-0.64,1.25333 -1.16,2.72 -1.56,4.4c-0.37333,1.68 -0.56,3.68 -0.56,6zM232.908,187.027v-2.72h3.64v2.72zM244.028,187.027v-2.72h3.64v2.72zM247.668,187.027c0,1.49333 -0.33333,2.82667 -1,4c-0.64,1.17333 -1.52,2.10667 -2.64,2.8c-1.09333,0.66667 -2.34667,1 -3.76,1v-3.16c1.2,0 2.12,-0.4 2.76,-1.2c0.66667,-0.82667 1,-1.97333 1,-3.44zM232.908,187.027h3.64c0,1.46667 0.33333,2.61333 1,3.44c0.66667,0.8 1.58667,1.2 2.76,1.2v3.16c-1.41333,0 -2.68,-0.33333 -3.8,-1c-1.09333,-0.69333 -1.97333,-1.62667 -2.64,-2.8c-0.64,-1.17333 -0.96,-2.50667 -0.96,-4zM247.668,184.307h-3.64c0,-1.49333 -0.33333,-2.64 -1,-3.44c-0.64,-0.8 -1.56,-1.2 -2.76,-1.2v-3.16c1.41333,0 2.66667,0.34667 3.76,1.04c1.12,0.66667 2,1.58667 2.64,2.76c0.66667,1.17333 1,2.50667 1,4zM232.908,184.307c0,-1.49333 0.32,-2.82667 0.96,-4c0.66667,-1.17333 1.54667,-2.09333 2.64,-2.76c1.12,-0.69333 2.38667,-1.04 3.8,-1.04v3.16c-1.17333,0 -2.09333,0.4 -2.76,1.2c-0.66667,0.8 -1,1.94667 -1,3.44z', bb: [42.91, 35.31, 57.67, 64.83] },
    '7': { d: 'M235.208,194.227l8.64,-24.96h3.64l-8.64,24.96zM232.528,169.267v-3.24h14.96v3.24z', bb: [42.53, 36.03, 57.49, 64.23] },
    '8': { d: 'M243.837,185.307c0,-1.46667 -0.33333,-2.6 -1,-3.4c-0.66667,-0.8 -1.61333,-1.2 -2.84,-1.2v-2.76c2.34667,0 4.17333,0.65333 5.48,1.96c1.33333,1.30667 2,3.13333 2,5.48zM239.997,194.827c-2.34667,0 -4.18667,-0.66667 -5.52,-2c-1.30667,-1.36 -1.96,-3.25333 -1.96,-5.68l3.64,-0.08c0,0.96 0.14667,1.78667 0.44,2.48c0.32,0.69333 0.76,1.22667 1.32,1.6c0.58667,0.34667 1.28,0.52 2.08,0.52zM232.517,187.147v-1.76l3.64,-0.08v1.76zM239.997,194.827v-3.16c0.8,0 1.48,-0.17333 2.04,-0.52c0.58667,-0.37333 1.02667,-0.90667 1.32,-1.6c0.32,-0.69333 0.48,-1.52 0.48,-2.48l3.64,0.08c0,2.42667 -0.66667,4.32 -2,5.68c-1.30667,1.33333 -3.13333,2 -5.48,2zM232.517,185.387c0,-2.34667 0.65333,-4.17333 1.96,-5.48c1.33333,-1.30667 3.17333,-1.96 5.52,-1.96v2.76c-1.2,0 -2.14667,0.4 -2.84,1.2c-0.66667,0.8 -1,1.93333 -1,3.4zM243.837,187.067v-1.76l3.64,0.08v1.76zM239.997,180.707c-2.16,0 -3.89333,-0.64 -5.2,-1.92c-1.28,-1.28 -1.92,-2.97333 -1.92,-5.08l3.64,0.12c0,1.33333 0.29333,2.36 0.88,3.08c0.61333,0.69333 1.48,1.04 2.6,1.04zM232.877,173.707v-1.12l3.64,0.08v1.16zM239.997,180.707v-2.76c1.14667,0 2.01333,-0.34667 2.6,-1.04c0.58667,-0.72 0.88,-1.74667 0.88,-3.08l3.64,-0.12c0,2.10667 -0.64,3.8 -1.92,5.08c-1.28,1.28 -3.01333,1.92 -5.2,1.92zM232.877,172.587c0,-2.18667 0.64,-3.92 1.92,-5.2c1.30667,-1.30667 3.04,-1.96 5.2,-1.96v3.16c-0.74667,0 -1.38667,0.16 -1.92,0.48c-0.50667,0.29333 -0.89333,0.74667 -1.16,1.36c-0.26667,0.61333 -0.4,1.36 -0.4,2.24zM243.477,173.827v-1.16l3.64,-0.08v1.12zM243.477,172.667c0,-0.88 -0.13333,-1.62667 -0.4,-2.24c-0.26667,-0.61333 -0.65333,-1.06667 -1.16,-1.36c-0.50667,-0.32 -1.14667,-0.48 -1.92,-0.48v-3.16c2.18667,0 3.92,0.65333 5.2,1.96c1.28,1.28 1.92,3.01333 1.92,5.2z', bb: [42.52, 35.43, 57.48, 64.83] },
    '9': { d: 'M247.068,176.107c0,2.16 -0.22667,4.17333 -0.68,6.04c-0.42667,1.86667 -1.01333,3.6 -1.76,5.2c-0.74667,1.57333 -1.58667,3 -2.52,4.28c-0.90667,1.25333 -1.85333,2.34667 -2.84,3.28l-2.72,-1.96c0.88,-0.96 1.73333,-1.94667 2.56,-2.96c0.82667,-1.01333 1.56,-2.14667 2.2,-3.4c0.64,-1.28 1.14667,-2.76 1.52,-4.44c0.4,-1.70667 0.6,-3.72 0.6,-6.04zM247.068,173.227v2.72h-3.64v-2.72zM235.948,173.227v2.72h-3.64v-2.72zM232.308,173.227c0,-1.49333 0.32,-2.82667 0.96,-4c0.66667,-1.17333 1.54667,-2.09333 2.64,-2.76c1.12,-0.69333 2.38667,-1.04 3.8,-1.04v3.16c-1.17333,0 -2.09333,0.4 -2.76,1.2c-0.66667,0.8 -1,1.94667 -1,3.44zM247.068,173.227h-3.64c0,-1.49333 -0.33333,-2.64 -1,-3.44c-0.64,-0.8 -1.56,-1.2 -2.76,-1.2v-3.16c1.41333,0 2.66667,0.34667 3.76,1.04c1.12,0.66667 2,1.58667 2.64,2.76c0.66667,1.17333 1,2.50667 1,4zM232.308,175.947h3.64c0,1.46667 0.33333,2.61333 1,3.44c0.66667,0.8 1.58667,1.2 2.76,1.2v3.16c-1.41333,0 -2.68,-0.33333 -3.8,-1c-1.09333,-0.69333 -1.97333,-1.62667 -2.64,-2.8c-0.64,-1.2 -0.96,-2.53333 -0.96,-4zM247.068,175.947c0,1.46667 -0.33333,2.8 -1,4c-0.64,1.17333 -1.52,2.10667 -2.64,2.8c-1.09333,0.66667 -2.34667,1 -3.76,1v-3.16c1.2,0 2.12,-0.4 2.76,-1.2c0.66667,-0.82667 1,-1.97333 1,-3.44z', bb: [42.31, 35.43, 57.07, 64.91] }
  };
  var NUM_TX = -190, NUM_TY = -130;   /* 官方字形文件里的 <g transform> */
  var NUM_INK_H = 29.4;               /* '0' 的墨高（画布单位），用来换算 scale */
  var NUM_GAP = 4;                    /* 官方字距（设计单位，同 texts.js `num()`） */
  function numeralText(v) {
    var n = Math.round(v);
    if (!isFinite(n) || n < 0) return '';
    if (n === 0) return '0';                    /* 震度0（无震度数据时的官方图标） */
    if (n > 12) n = 12;
    return String(n);
  }
  function r(n) { return Math.round(n * 1000) / 1000; }
  /** 数字 SVG 片段：官方字形路径，按 cx/cy 居中、墨高 capH；超宽等比缩小；fill 指定颜色 */
  function digitsGroup(v, cx, cy, capH, maxW, fill) {
    var s0 = numeralText(v);
    if (!s0) return '';
    var i, g, n = s0.length, widths = [], total = 0;
    for (i = 0; i < n; i++) {
      g = NUMG[s0.charAt(i)];
      if (!g) return '';
      widths.push(g.bb[2] - g.bb[0]);
      total += g.bb[2] - g.bb[0];
    }
    total += NUM_GAP * (n - 1);
    var s = capH / NUM_INK_H;
    if (maxW && total * s > maxW) s = maxW / total;
    var W = total * s, bottom = cy + (capH) / 2;
    var x = cx - W / 2, out = '';
    for (i = 0; i < n; i++) {
      g = NUMG[s0.charAt(i)];
      var dx = x - g.bb[0] * s, dy = bottom - g.bb[3] * s;
      out += '<path d="' + g.d + '" fill="' + (fill || TEXT_LIT) + '" transform="translate(' +
        r(dx + NUM_TX * s) + ',' + r(dy + NUM_TY * s) + ') scale(' + r(s) + ')"/>';
      x += (widths[i] + NUM_GAP) * s;
    }
    return out;
  }

  function uri(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ---------- 主卡色块（官方 paSc 几何，只换底色） ---------- */
  var PA_SC =
    '<svg xmlns="http://www.w3.org/2000/svg" width="248" height="120" viewBox="0,0,248,120">' +
    '<g transform="translate(-116,-120)"><path d="M146,140h188c5.54,0 10,4.46 10,10v60c0,5.54 -4.46,10 -10,10' +
    'h-188c-5.54,0 -10,-4.46 -10,-10v-60c0,-5.54 4.46,-10 10,-10z" fill="@@C@@"/></g></svg>';

  function blockSrc(v) { return uri(PA_SC.replace(/@@C@@/g, colorOf(v))); }

  /* ---------- 主卡大号数字（官方 snd 画布 80×80，中心 (40,40)、字高 46） ---------- */
  function numeralSrc(v, capH, maxW) {
    return uri('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0,0,80,80">' +
      digitsGroup(v, 40, 40, capH || 46, maxW || 74, textOf(v)) + '</svg>');
  }

  /* ---------- 履历徽章（官方 paTm 画布 264x116 + 官方坐标） ----------
   * ★ 数字不再烘进这张 SVG：用 <text> 或自画 path 都只能“像”，而官方数字是圆润细笔画，
   *   系统字体一律偏粗（用户报过）。数字交给 render3 用【官方数字字形】叠在徽章之上。 */
  /* ★★ 2026-10-11 用户报「徽章下面那条黑色装饰条变成卡片蓝了」：
     官方履历徽章卡 `paTm*`（264x116）里除了色块/文字，还有一层**内嵌的灰色渐变 PNG**
     —— 它是徽章表面的立体感 + 徽章下方那一圈模糊暗影（逐像素量过：官方在徽章下沿
     有一条约 16px 的暗带 #192539→#192438）。
     我们走中国烈度模式时徽章是自己生成的 SVG，只有一块纯色圆角矩形 → 那条暗影整条没了。
     这里把官方**同一张 PNG 原样**贴回去（色块/文字照旧画在它上面，几何与官方一致）。 */
  var BADGE_CARD_PNG = 'data:image/png;base64,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';
  function badgeBgSrc(v, label) {
    var c = colorOf(v), tx = textOf(v);
    return uri('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"' +
      ' width="264" height="116" viewBox="0,0,264,116">' +
      '<image x="0" y="0" width="264" height="116" xlink:href="' + BADGE_CARD_PNG + '"/>' +
      '<rect x="28" y="26" width="48" height="62" rx="10" ry="10" fill="' + c + '"/>' +
      '<text x="51.96" y="38.05" text-anchor="middle" dominant-baseline="central" ' +
      'font-family="Microsoft YaHei UI, Microsoft YaHei, sans-serif" ' +
      'font-size="9.4" fill="' + tx + '">' + (label || '最大烈度') + '</text></svg>');
  }
  /* ⚠️ 2026-10-11：**应用的徽章走的是这个函数**（render3.badgeLiedu() → LIE.badgeSrc），
     `badgeBgSrc()` 只是自检页在用的旧路线。上一版我只把官方 PNG 贴进了 badgeBgSrc
     → 页面上一点变化都没有（用户原话「这有变化吗」）。两个都贴，免得再搞错。 */
  function badgeSrc(v, label) {
    var c = colorOf(v), tx = textOf(v);
    var g = digitsGroup(v, 51.2, 64.5, 27, 38, tx);
    return uri('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"' +
      ' width="264" height="116" viewBox="0,0,264,116">' +
      '<image x="0" y="0" width="264" height="116" xlink:href="' + BADGE_CARD_PNG + '"/>' +
      '<rect x="28" y="26" width="48" height="62" rx="10" ry="10" fill="' + c + '"/>' +
      '<text x="51.96" y="38.05" text-anchor="middle" dominant-baseline="central" ' +
      'font-family="Microsoft YaHei UI, Microsoft YaHei, sans-serif" ' +
      'font-size="9.4" fill="' + tx + '">' + (label || '最大烈度') + '</text>' +
      g + '</svg>');
  }

  /* ================= 2026-10-21 紧急地震速报（EEW）大卡 / 列表 / 地图标记 =================
     ★ 用户：「你烈度卡没适配啊？？？」
       以前 EEW 全屏卡、观测震度列表的小方块、地图测站标记全是**官方震度造型**
       （paSc / snd / h0..h9，只有 0..9 十档，10 以上根本不存在）
       → 中国烈度 8 会画成震度6强、烈度 12 画成震度7，卡上「推定最大震度」还是日文标题。
     这里补三件官方没有对应造型的东西（几何全部沿用官方尺寸）：
       · labelSrc()      208×80「推定 / 最大烈度」白字图（对应官方 paSu）
       · smallBadgeSrc() 32×30 列表小方块（对应官方 sndm0..9）
       · markSrc()       20×20 地图测站圆标（对应官方 marks/h0..9） */

  /** 连续震度 I → 中国烈度 1..12（0 = 没感觉到）
   *  与 data.js 的 QData.lieduFromI 同一张对应表的扩展版（加上 12 度档）。
   *
   * ★★★ 2026-10-21 用户：「API 没有区域震度的地图填色（中国大陆），我们都有这么多东西了」
   *   —— 自己算就必须算准。**旧版这张表整体偏高 2 度**：
   *        旧：I<0.5→0, I<1.5→3, I<2.5→4, I<3.5→5 …（等于「烈度 ≈ round(I)+2」）
   *        实测 M6.8/深15km：I=0.81（≈0.07 cm/s，人几乎无感）→ 旧判「烈度3」
   *        ⇒ 震感范围被放大 3~5 倍，这就是「一个小地震半个亚洲都有震感」的根因。
   *
   *   现在按 **GB/T 17742《中国地震烈度表》的 PGV 参考值** 反解本式（I = 2.68 + 1.72·lgPGV）：
   *     烈度   I    II   III   IV    V    VI   VII  VIII   IX    X    XI   XII
   *     PGV   0.1  0.4  0.9   1.8  3.5  7.1   14   28    57   110  220   440  (cm/s)
   *     → I   0.96 2.00 2.60 3.12 3.62 4.14 4.65 5.17 5.70 6.19 6.71 7.23
   *   即阈值**下密上疏**（低烈度档窄、高烈度档宽），不再是等间距 round()。 */
  function codeOfI(I) {
    if (!isFinite(I) || I < 0.96) return 0;
    if (I < 2.00) return 1;
    if (I < 2.60) return 2;
    if (I < 3.12) return 3;
    if (I < 3.62) return 4;
    if (I < 4.14) return 5;
    if (I < 4.65) return 6;
    if (I < 5.17) return 7;
    if (I < 5.70) return 8;
    if (I < 6.19) return 9;
    if (I < 6.71) return 10;
    if (I < 7.23) return 11;
    return 12;
  }
  /** 各烈度档的 I 下界（等值线用：给定量 I 画 Ⅱ/Ⅲ/Ⅳ… 级的闭合线） */
  var LIEDU_EDGES = [0.96, 2.00, 2.60, 3.12, 3.62, 4.14, 4.65, 5.17, 5.70, 6.19, 6.71, 7.23];


  /** 官方 paSu（208×80）同尺寸的「推定 / 最大烈度」文字图
   *  ★ 2026-10-21 用户：「推定最大烈度那个字体偏移了，和震度不是一个位置」
   *    拿官方 paSu 抠像素量过（canvas 扫 alpha）：
   *      · 「推定」  墨迹 x 32..91, y 13..41  → 字号 ≈ 29.5、基线 ≈ 38.8、左缘 32
   *      · 「最大震度」墨迹 x 26..97, y 48..65  → 字号 ≈ 17.9、基线 ≈ 63.7、左缘 26
   *    （官方「推定」比「最大震度」**大**，我第一版写反了 → 所以位置/大小都对不上） */
  function labelSrc(v) {
    var tx = textOf(v);
    return uri('<svg xmlns="http://www.w3.org/2000/svg" width="208" height="80" viewBox="0,0,208,80">' +
      '<text x="32" y="38.8" font-family="Microsoft YaHei UI, Microsoft YaHei, Noto Sans SC, sans-serif" ' +
      'font-size="29.5" font-weight="700" fill="' + tx + '">推定</text>' +
      '<text x="26" y="63.7" font-family="Microsoft YaHei UI, Microsoft YaHei, Noto Sans SC, sans-serif" ' +
      'font-size="17.9" font-weight="700" fill="' + tx + '">最大烈度</text>' +
      '</svg>');
  }

  /** 官方 sndm（32×30）同尺寸的列表小方块（数字用官方字形） */
  function smallBadgeSrc(v) {
    var n = Math.round(v);
    var c = colorOf(n), tx = textOf(n);
    return uri('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="30" viewBox="0,0,32,30">' +
      '<rect x="1" y="0.5" width="30" height="29" rx="4" ry="4" fill="' + c + '"/>' +
      digitsGroup(n, 16, 15.4, n >= 10 ? 17 : 18.6, 27, tx) + '</svg>');
  }

  /** 官方 marks/h*（20×20 圆标）同尺寸的地图测站标记（数字用官方字形） */
  function markSrc(v) {
    var n = Math.round(v);
    var c = colorOf(n), tx = textOf(n);
    return uri('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0,0,20,20">' +
      '<circle cx="10" cy="10" r="8.6" fill="' + c + '" stroke="#ffffff" stroke-width="1.4"/>' +
      digitsGroup(n, 10, 10, n >= 10 ? 10.2 : 11, 14.5, tx) + '</svg>');
  }

  /* ═══ 2026-10-26 用户：「烈度卡现在没做专门的方形的烈度数字提示，
     现在是测站临时顶替的，做一套烈度的出来」
     ⇒ 官方地图标记 markers/marks/h0..h9 是【200×200 圆角方块 + 亮色 13 描边 + 外发光 + 官方白字】，
        烈度这边一直没做，只能拿圆标 / 震度造型顶上（liedu 8 会变成震度6強、
        liedu 10 甚至回落成震度1）。
     这里按**官方 h*.svg 的几何逐项复刻**（画布 200×200、viewBox 100,100,200,200、
     方块 path 与 13 宽描边、外发光 0.12），数字用官方字形，颜色走烈度色阶。
     —— 1~12 全部生效。 */
  var MARK_BOX_PATH = 'M160,80h160c11.08,0 20,8.92 20,20v160c0,11.08 -8.92,20 -20,20h-160' +
    'c-11.08,0 -20,-8.92 -20,-20v-160c0,-11.08 8.92,-20 20,-20z';
  /** 底色 → 描边色（官方：5弱以下是「暗化版」、5弱以上是「亮化版」；
   *  烈度色阶全偏亮，统一用「混白 45%」的亮化版，与官方 h*.svg 观感一致） */
  function markStrokeOf(c) {
    var R = parseInt(c.slice(1, 3), 16), G = parseInt(c.slice(3, 5), 16), B = parseInt(c.slice(5, 7), 16);
    var k = 0.45;
    function mix(x) { return Math.round(x + (255 - x) * k).toString(16); }
    var s = function (h) { return (h.length < 2 ? '0' : '') + h; };
    return '#' + s(mix(R)) + s(mix(G)) + s(mix(B));
  }
  /** 方形烈度徽章（等同官方 marks/h*.svg 的尺寸与构图） */
  function markBoxSrc(v) {
    /* ⚠️ 允许 0（= 震度0/无感，官方 h0 是灰盘 + 「0」），不能夹到 1 ——
       否则「烈度 0」的测站会画成一个「1」的方块，和数据对不上。 */
    var n = Math.round(+v || 0);
    if (n < 0) n = 0; else if (n > 12) n = 12;
    var c = colorOf(n), tx = textOf(n), st = markStrokeOf(c);
    return uri('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="100,100,200,200">' +
      '<defs><radialGradient cx="240" cy="180" r="200" gradientUnits="userSpaceOnUse" id="g">' +
      '<stop offset="0" stop-color="' + c + '"/><stop offset="0.4" stop-color="' + c + '"/>' +
      '<stop offset="0.55" stop-color="' + c + '" stop-opacity="0.56078"/>' +
      '<stop offset="0.7" stop-color="' + c + '" stop-opacity="0.25098"/>' +
      '<stop offset="0.85" stop-color="' + c + '" stop-opacity="0.05882"/>' +
      '<stop offset="1" stop-color="' + c + '" stop-opacity="0"/></radialGradient></defs>' +
      '<g transform="translate(-40,20)">' +
      '<circle cx="240" cy="180" r="200" fill="url(#g)" opacity="0.12"/>' +
      '<path d="' + MARK_BOX_PATH + '" fill="' + c + '" stroke="' + st + '" stroke-width="13"/>' +
      digitsGroup(n, 240, 180, 104, 150, tx) +
      '</g></svg>');
  }

  global.QV_LIEDU = {
    COLORS: LIEDU_COLORS, UNKNOWN: LIEDU_UNKNOWN,
    TEXT_DARK: TEXT_DARK, TEXT_LIT: TEXT_LIT,
    colorOf: colorOf, textOf: textOf, numeralText: numeralText, glyphFilter: glyphFilter,
    blockSrc: blockSrc, numeralSrc: numeralSrc, badgeSrc: badgeSrc, badgeBgSrc: badgeBgSrc,
    codeOfI: codeOfI, EDGES: LIEDU_EDGES,
    labelSrc: labelSrc, smallBadgeSrc: smallBadgeSrc, markSrc: markSrc,
    markBoxSrc: markBoxSrc
  };
})(window);
