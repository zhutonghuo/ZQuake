/* texts.js — 文字层（中文版）
 *
 * ===== 官方排布规则（实测反推，已逐项验证；见 diag/verify-runs.html）=====
 *  1) Scratch 把造型的「旋转中心」对齐到精灵坐标：
 *       画布左 = 精灵x − rotationCenterX × size/100
 *       画布宽 = 造型宽 × size/100          ← 不是按画布宽居中（各零件 rx 不同）
 *  2) 一串数字的步进：step = (adv_i + adv_j)/2 × size/100 + 0.04 × size
 *       adv 取自官方宽度表；串左缘 = 串中心 − 总宽/2
 *  3) nm 地名零件：官方按「实测高度」缩放（实测 H/size = 0.200 恒定），
 *     故用 scale = 目标高 / 画布高 更稳
 * =======================================================================*/
(function (global) {
  'use strict';
  var SW = 960, SH = 720;
  var G = global.QV_GLYPH || {};
  var NM = global.QV_NM || {};
  var NAMES = global.QV_PLACE || {};
  var GAP = global.QV_GLYPH_GAP || 0.04;
  /* ★ 中文层字体：官方字形是 BIZ UDPGothic（日式哥特）→ 中文对应思源黑体 / Noto Sans SC。
     字体是 dev/make-font.py 子集出来的 app/assets/fonts/NotoSansSC-sub.woff2（@font-face 在 app.css）。 */
  var FONT = "'NotoSC','Noto Sans SC','Source Han Sans SC','Microsoft YaHei UI','Microsoft YaHei','PingFang SC',sans-serif";
  /* ★ 官方字形 SVG 里的笔画是【纯红 #ff0000】。
     把红刷白必须用 brightness(0) invert(1)：
       先 brightness(0) 压成黑（形状与 alpha 全保留）→ invert(1) 反相成白。
     ⚠️ 旧写法 brightness(100) 是「乘 100」：
        数字像素 (255,5,5) 溢出成纯白（所以看着一直是对的），
        但纯红像素 (255,0,0) ×100 仍是 (255,0,0) → 月(m)/日(d)/秒 这几个字形一直是红的。 */
  var WHITE = 'brightness(0) invert(1)';

  /* 官方字形表用的是 ASCII 别名（m=月 d=日 g=ごろ k=km s=ごく浅い l=最終），
     这里把汉字映射回去，让调用方可以直接写「10月8日」 */
  var ALIAS = { '月': 'm', '日': 'd' };
  var CJK = /[\u3000-\u9fff\uff01-\uff60]/;
  /* 官方「地名の長さ」计数：全宽字 = 2、窄字（・ 及 ASCII/半宽） = 1
     （实测官方表 `d 地名-コード全集` 第 8 个字段：
        '熊本県天草・芦北地方' = 19  ('・' 算 1)
        '新島・神津島近海'     = 15
        'カムチャツカ半島付近' = 20
        '東北地方'             = 8  ） */
  var NARROW = /[\u30FB\uFF65\uFF61-\uFF9F\u0020-\u007E]/;
  /** 官方地名缩放（反编译 UI 精灵「クローン再描画_p最新地震情報」的 nm 分支）：
   *      size% = min(标称值, 2000 / 计数)
   *  ⇒ 短地名放 120%；长地名自动缩小（熊本県天草・芦北地方 → 2000/19 = 105.26%），
   *    **长地名不会顶出信息栏**（官方实测：墨迹右缘固定在 ~222，我们以前写死 120% 会到 250）。
   *  履历行标称值是 85 → 2000/计数 恒 > 85 ⇒ 自动成为「不变」，与官方一致。 */
  function nmCount(name) {
    var s = String(name == null ? '' : name), n = 0;
    for (var i = 0; i < s.length; i++) n += NARROW.test(s[i]) ? 1 : 2;
    return n;
  }
  function placeSize(name, nominal) {
    var c = nmCount(name);
    return c ? Math.min(nominal, 2000 / c) : nominal;
  }
  function glyph(ch) { return G[ch] || G[ALIAS[ch]] || null; }
  function adv(ch) { var a = glyph(ch); if (a) return a[5]; return CJK.test(ch) ? 28 : 15; }
  function box(host, ax) {
    var d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:0;top:0;width:' + SW + 'px;height:' + SH +
      'px;pointer-events:none';
    /* ★ 记下「排布基准边」：app.js 的 applyScroll 靠它判断这段文字在不在左边的信息栏里。
       盒子本身永远是 left:0（字形在盒子内部）—— 直接看 left 会把【时钟】也一起滚走
       （实测：时钟盒子 left=0 → 满足 `left<264` → 被 translateY(-556) 推出屏幕）。 */
    if (ax != null && isFinite(ax)) d.dataset.ax = Math.round(ax);
    host.appendChild(d);
    return d;
  }

  /** 数字串：x = **排布基准边**（align='left' 为左缘，'right' 为右缘）；cy = 字形中心线
   *
   * ★ 官方字距公式（由官方运行时列表 `6-3連続文字位置集` 反推 + dump-live2.json 实测 0.000 误差）：
   *     圆心_0 = adv_0/2                                  （首字符中心）
   *     左缘_k = 左缘_{k-1} + adv_{k-1} + 4                  （左缘递推，4 = 0.04×100 字距）
   *     → 等价于 圆心_k = 圆心_{k-1} + (adv_{k-1}+adv_k)/2 + 4
   *   ⚠️ 曾经写成 centers.push(cur + a/2) → 相邻圆心距退化成 adv(next)+字距，沿串累积 → 「文字漂移」
   *   ⚠️ 槽位也曾存「首字符中心」→ 换内容就整体偏移；已改为基准边，与内容无关。
   *
   * pitch：可选「等宽步进」（设计单位）。仅时钟用（官方时钟等宽）。
   * filt ：可选滤镜，默认把纯红字形刷白；烈度深字用 'brightness(0) invert(.11)'（= #1c1c1c）
   */
  function num(host, text, size, x, cy, align, pitch, filt) {
    var s = String(text == null ? '' : text);
    if (!s) return null;
    var FLT = filt || WHITE;
    var b = box(host, x);
    var sc = size / 100;
    var a0 = adv(s[0]) * sc;
    var pc = pitch ? pitch * sc : 0;          /* 等宽模式下每步像素 */
    var centers = [], cur = 0, lastA = 0;
    for (var i = 0; i < s.length; i++) {
      var a = adv(s[i]) * sc;
      centers.push(pc ? a0 / 2 + i * pc : cur + a / 2);
      cur += a + GAP * size;                  /* 下一个字的左缘 */
      lastA = a;
    }
    var total = centers.length ? centers[centers.length - 1] + lastA / 2 : 0;
    var left0 = (align === 'left') ? x : (align === 'right') ? x - total : x - total / 2;
    var n = 0;
    for (var k = 0; k < s.length; k++) {
      var g = glyph(s[k]);
      var gx = left0 + centers[k];
      /* ★ 官方字形表里没有的字（如「年」）→ 就地用中文层补一个字：
         字宽 = adv 28（设计单位）≈ size*0.28，字高取 size*0.38 → 墨迹高与官方字形等高。
         ⚠️ 曾经整串「2026年10月8日 21:22」走中文层 → 字体、字距、字重全部不对。 */
      if (!g) {
        if (CJK.test(s[k])) {
          var fs2 = Math.round(size * 0.38);
          var el = document.createElement('div');
          el.textContent = s[k];
          el.style.cssText = 'position:absolute;white-space:nowrap;line-height:1;color:#fff;' +
            'font-family:' + FONT + ';font-size:' + fs2 + 'px;' +
            'left:' + (gx - adv(s[k]) * sc / 2) + 'px;' +
            'top:' + (cy - fs2 / 2) + 'px;filter:' + FLT;
          b.appendChild(el); n++;
        }
        continue;
      }
      var im = new Image();
      im.src = 'assets/' + g[0];
      im.style.cssText = 'position:absolute;' +
        'left:' + (gx - g[3] * size / 100) + 'px;' +
        'top:' + (cy - g[4] * size / 100) + 'px;' +
        'width:' + (g[1] * size / 100) + 'px;height:' + (g[2] * size / 100) + 'px;' +
        'filter:' + FLT;
      b.appendChild(im); n++;
    }
    return n ? b : null;
  }

  /** 地名（nm 零件）：Scratch 缩放 = size/100（★ 原写成 0.20*size/画布高，是错的启发式 → 地名整体偏小） */
  function place(host, name, size, x, cy, align) {
    var cos = matchPlace(name);
    if (!cos) return null;
    var m = NM[cos.replace(/^nm/, '')];
    if (!m) return null;
    var scale = size / 100;               /* 官方：画布高 32 → size=120 时显示 38.4px */
    var w = m[1] * scale, h = m[2] * scale;
    var left = (align === 'left') ? x : (align === 'right') ? x - w : x - w / 2;
    var im = new Image();
    im.src = 'assets/' + m[0];
    im.style.cssText = 'position:absolute;' +
      'left:' + left + 'px;top:' + (cy - m[4] * scale) + 'px;' +
      'width:' + w + 'px;height:' + h + 'px;filter:' + WHITE;
    host.appendChild(im);
    return im;
  }

  function matchPlace(name) {
    var s = String(name == null ? '' : name).trim();
    if (!s) return null;
    if (NAMES[s]) return NAMES[s];
    var ks = Object.keys(NAMES);
    for (var i = 0; i < ks.length; i++) {
      if (ks[i] && (s.indexOf(ks[i]) >= 0 || ks[i].indexOf(s) >= 0)) return NAMES[ks[i]];
    }
    return null;
  }

  /** 中文文案；o.maxW 可选（超宽时**先自动缩字号**，缩到 o.minSize（默认 12）仍放不下才省略号）
   *  ★ 以前直接 `text-overflow:ellipsis` 截断 → 美国地名变成「美国 加利福尼亚州 Fer...」，
   *    用户要看的正是地名，被吃掉就没意义了。官方做法也是「按长度等比缩小」。 */
  function zh(host, o) {
    if (o.text === '' || o.text == null) return null;
    var d = document.createElement('div');
    d.textContent = String(o.text);
    var size = o.size || 14;
    d.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;' +
      'font-family:' + FONT + ';font-size:' + size + 'px;line-height:1;' +
      'color:' + (o.color || '#fff') + ';font-weight:' + (o.weight || 400) + ';' +
      'letter-spacing:' + (o.ls || 0) + 'px;';
    host.appendChild(d);
    if (o.maxW) {
      var floor = o.minSize || 12;
      while (size > floor && (d.offsetWidth || 0) > o.maxW) { size -= 0.5; d.style.fontSize = size + 'px'; }
      if ((d.offsetWidth || 0) > o.maxW) {
        d.style.maxWidth = o.maxW + 'px';
        d.style.overflow = 'hidden';
        d.style.textOverflow = 'ellipsis';
      }
    }
    /* ⚠️ 必须用 offsetWidth：getBoundingClientRect() 会把 #stage 的 transform:scale() 算进去，
       窗口不是正好 960x720 时 scale≠1 → 居中/右对齐文案会横向漂移。 */
    var w = d.offsetWidth || 0;
    var x = o.x, y = o.y;
    if (o.align === 'center') x -= w / 2; else if (o.align === 'right') x -= w;
    d.style.left = Math.round(x) + 'px';
    d.style.top = Math.round(y) + 'px';
    return d;
  }

  function host(id) {
    var l = document.getElementById(id);
    if (!l) {
      l = document.createElement('div');
      l.id = id;
      l.style.cssText = 'position:absolute;left:0;top:0;width:' + SW + 'px;height:' + SH +
        'px;pointer-events:none';
      document.getElementById('stage').appendChild(l);
    }
    l.innerHTML = '';
    return l;
  }

  global.QVT = { num: num, place: place, placeSize: placeSize, zh: zh, host: host, matchPlace: matchPlace, adv: adv };
})(window);
