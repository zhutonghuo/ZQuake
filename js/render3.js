/* render3.js — 最终渲染（中文 UI + 官方造型变体 + 官方精确定位）
 *
 * ============ 官方机制（本次彻底搞清）============
 * 1) 大号震度数字、履历徽章**不是画出来的**，而是 **换造型**：
 *      paSc0..paSc9 / paSc-1  = 主卡大色块 + 数字（已含）
 *      paTm1..paTm9 / paTm0 / paTm-1 = 履历行徽章
 *    位置固定，只换 <img src>。
 * 2) 文字位置：Scratch 把造型「旋转中心」对齐精灵坐标 →
 *      canvas_L = 480 + sprite_x − rx×size/100
 *    sj 字形画布 100×100 且 rx=ry=50 → **精灵 x 就是该字画布中心**。
 *    故一串字只需「首字符精灵 x = X0」+ size + y，按步进公式排布即逐像素同位：
 *      步进 = (adv_i + adv_j)/2 × size/100 + 0.04 × size
 *    （adv 取自官方宽度表）
 * ============ 实测槽位（X0 / y / size）============
 *   时钟  X0=-174.86  y=330  size=60
 *   発生時刻 X0=-442.7 y=208  size=45
 *   震源地 nm X0=-458  y=180  size=120
 *   震级值  X0=-323.55 y=116 size=110
 *   深度值  X0=-340.75 y=72  size=70
 *   履历(行距 76，i 从 0):
 *     徽章 paTm 与行同 y（见 ROW）
 *     地名 nm  X0=-408  y=-72-76i  size=85
 *     时刻     X0=-395.25 y=-92-76i size=37.5
 *     震级     X0=-287.9  y=-111-76i size=60
 *     深度     X0=-369    y=-114-76i size=40
 */
(function (global) {
  'use strict';
  var SW = 960, SH = 720;
  var R = { SW: SW, SH: SH };
  function two(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------------- 槽位（来自官方实测） ---------------- */
  var S = {
    /* 官方时钟是【等宽】的：实测 19 个字形相邻步进全部恰好 = 10.2857px @size60
       （换成其他秒数字后依旧均匀，且 ':' '/' 与数字同距 → 不可能是字宽公式）
       → 折算设计单位 10.2857/0.6 = 120/7 = 17.142857，恒定。 */
    clockPitch: 120 / 7,
    /* ---------------------------------------------------------------
     * ★ 槽位语义（2026-10-07 用官方 960x720 dump 逐项校准）
     *   X0 = 「文本排布基准边」：align 'left' 是左缘，'right' 是右缘。
     *   ❌ 不再是「首字符中心」——那个值随首字符宽度变，换个内容就整体漂。
     *   官方实测依据（compare/dump-live2.json，stage=960x720，规格化的）：
     *     发生时刻  左缘 -458.0  （同时 = 震源地 nm 画布左缘 -458 → 文本区左界）
     *     震级/深度 右缘 -290.0  （"3.5"→-290.0、"60k"→-290.0，右对齐确证）
     *     履历行 时刻/地名 左缘 -408；震级右缘 -272.0；深度右缘 -340.0
     * --------------------------------------------------------------- */
    clock: { X0: -179.357, y: 330, size: 60 },   /* 等宽：首字中心 = X0 + adv/2 */
    /* ★ 官方运行时精灵坐标（vm.runtime.targets 直读，舞台 960x720）：
         时钟 sj*     y=330 size=60  （画布中心 = 30，与 SK/2-y 一致）
         日期 sj㋉…   y=208 size=45  → 画布 130..175，墨迹中心 152.5
         地名 nm      y=180 size=120 → 画布 161..199，中心 180
         で地震 deji  y=152 size=100 → 画布 196..220，墨迹中心 209
       ❗ y 是精灵纵坐标，画布中心 = SH/2 − y。三者原值都是对的。 */
    originTime: { X0: -458.0, y: 208, size: 45 },
    place: { X0: -458, y: 180, size: 120 },      /* nm：画布左缘 = x */
    magVal: { X0: -290.0, y: 116, size: 110, align: 'right' },
    depVal: { X0: -290.0, y: 72, size: 70, align: 'right' },
    rowStep: 76,
    row: {
      place: { X0: -408, y: -72, size: 85 },
      time: { X0: -408.0, y: -92, size: 37.5 },
      mag: { X0: -272.0, y: -111, size: 60, align: 'right' },
      dep: { X0: -340.0, y: -114, size: 40, align: 'right' },
      badge: { X0: -360, y: -92, size: 100 }     /* paTm 徽章（画布 264x116） */
    },
    /* 大号震度色块：官方 paSc 内联在 paSc1 的槽位 */
    scBlock: { X0: -360, y: 264, size: 100 }
  };
  R.SLOT = S;

  /* ---------------- 中文标签槽位 = 官方原日文标签的「墨迹框」（绝对值 960x720） ----------------
   * 取得方式：把「未清洗」的官方素材按官方实测坐标摆回舞台（diag/officart.html），
   *            再用 getBoundingClientRect() 量出每条「被清洗掉的日文 path」的墨迹框。
   * 语义：x = 左缘；cx = 中心（居中时用）；cy = **垂直中心**（不是 top）。 */
  var L = {
    title:     { x: 75.1,   cy: 24.1,  size: 16 },    /* paIti3   「各地の震度情報」7字 111.9x15.7 */
    maxShindo: { x: 39.4,   cy: 97.7,  size: 22 },    /* paSs     「最大震度」4字，字宽 23.1 */
    mag:       { x: 22.8,   cy: 244.0, size: 13 },    /* 与震级数值同行（值 y=116 → 画布中心 244） */
    dep:       { x: 24.0,   cy: 286.0, size: 15 },    /* paIbg180 「深さ」，与深度值同行 */
    tsunami:   { cx: 119.75,cy: 336.0, size: 20 },    /* paIts0 「津波の心配なし」51.6..187.9
                                                          ★ 2026-10-26：官方胶囊 paIts0/paIts41 逐字 getBBox 实测
                                                             advance ≈ 20.4px、墨迹 19.2×19.1 ⇒ 原 19 偏小，统一 20 */
    hist:      { x: 88.0,   cy: 393.1, size: 16 },    /* paTbg0   「地震履歴」4字 63.7x15.6 */
    rowDep:    { x: 72.2,   cy: 474.0, size: 11.5 },  /* paTmjs   「深さ」 */
    rowMag:    { x: 163.3,  cy: 473.5, size: 13 },    /* paTmjs   「M」 */
    rowMax:    { x: 24.1,   cy: 431.9, size: 8 }      /* paTm1    「最大震度」31.8x7.8 */
  };
  R.LABEL = L;
  /** 标签放置：t = QVT 引擎，zh = 中文层，l = L.<name>，dy = 行偏移 */
  function lab(t, zh, l, text, o) {
    o = o || {};
    var size = o.size || l.size;
    var dy = o.dy || 0;
    return t.zh(zh, {
      text: text, size: size,
      align: l.cx != null ? 'center' : 'left',
      x: l.cx != null ? l.cx : l.x,
      y: Math.round(l.cy + dy - size / 2),
      color: o.color || '#fff', weight: o.weight || 400
    });
  }

  /* ══════════════ 2026-10-23 正式报「各地の震度情報」专用卡片 ══════════════
   * ★★★ 底板 = **paIbg208**（assets/7a143c0c241ea0c25c5e13d845431b4e.svg，264×456）
   *   依据：用户官方实拍截图（384×678）逐像素反推，三处独立特征全部对齐：
   *     · 卡片主体高 587px ÷ 1.52 = 386 = paIbg208 的 body 高（canvas 50..436）
   *     · 右侧两条色槽：截图 x317..339 / y442..478、y510..555
   *       = canvas 214..230 / 294..330、339..369 ✓
   *     · 烤死的「深さ」：截图 y522..550 = canvas 298..313 ✓
   *   （paIbg172=376 高、paIbg200=440 高都对不上；paIbgC* 是 224 宽的**取消报**卡）
   * 内容行位（**统一换算**：stageX = 8 + (shotX−19)/1.531，stageY = 8 + (shotY−21)/1.531，
   *   1.531 = 咔图卡宽 343px ÷ 官方 224）：
   *   标题 8..40 ｜ 震度块 (16,56) 208×80 ｜ 长周期阶級 (16,145) 208×48
   *   时刻 cy207 ｜ 地名 cy236 ｜ 「で地震がありました」cy264
   *   「マグニチュード」cy300 ｜「深さ」cy344 ｜ 津波胶囊 373..411
   * 卡片变高（456 图 = 底边 444，普通卡 394 = 385）→ 下方地震履历整体下移 FIN.hshift(59)。
   * ---------------------------------------------------------------------- */
  var FIN = {
    /* ★★ 下移量 = 74（按用户给的官方对比图反推）：
         官方「地震履歴」标题中心在 y≈467 = 393 + 74
         履历底板 paTbg0 顶 = 358 + 74 = 432，比卡片墨迹底（424）低 8px
         ⇒ 卡片底与底板之间露出 **8px 黑色间隙 + 底板自己的圆角**（官方就是这个样子）。
       之前用 39（底板顶 397，被卡片吃掉圆角）→ 露出一段直边，看着像“重叠”。 */
    /* ★★ 下移量 = 63：实测下黑边 = hshift − 55
         （卡片墨迹底 431；履历底板 paTbg0 可见顶 = 358 + hshift + 14）
         hshift 63 → 下黑边 4px；上黑边另由宿主 top:4px 与 bg.y=−12 给出 = 8px（用户指定）。
       ★ 2026-10-26 用户：「大卡片底部黑边要少一像素」→ hshift **63 → 62**（下黑边 4 → 3px）。
         只动这一个数：它只平移履历/底板/滚动上限，卡片自身（宿主 top:4px + bg.y=−12）不动，
         所以上方那 8px 黑边不受影响。 */
    host: null, on: false, hshift: 62,
    /* 正式报卡显示时要收起的普通卡精灵（底板/震度块/标签/数字/色条/津波胶囊） */
    sprites: ['paIbg180', 'paIbgm', 'paSc1', 'paSs', 'snd1', 'paImag', 'paIdep', 'paIts0', 'paIts1',
      'paIts2', 'paIts30', 'paIts31', 'paIts40', 'paIts41', 'paIts42']
  };
  /* ★★★ 2026-10-27 用户两句话把这事说透了：
     「报文都没有长地震周期的消息，你使用长地震周期的卡片干嘛」
     「这不就是之前的 bug 版本吗，正常的应该是这样的」（图 = 264×394 的**普通主卡**）
     ⇒ 结论：
       · 报文**真的带**長周期地震動階級（E.maxLg ≥ 0）→ 才用 overlay 大卡
         （paIbg208 264×456，比普通卡多一条长周期带）
       · 没有 → **一根手指都不碰**，让普通主卡 paIbg180（264×394）自己显示
         （标题/震度块/时刻/震源名/发生了地震/震级+条/深度+条/津波胶囊它全有）
     以前是无条件画 overlay 卡 → 没长周期时就多出一条空白带 + 整张卡比官方高 80px。
     ⚠️ 曾试过 paIbg172（264×376，震源情報的卡）—— 仍然是一张自造 overlay 卡，
        用户认定那是 bug 版本（卡片不是普通主卡、文案也不一致），已废弃。 */
  var FIN_GEO_456 = {
    bg: { x: -12, y: -12, w: 264, h: 456 },
    blk: { x: 16, y: 56, w: 208, h: 80 },
    num: { x: 134, y: 56, w: 80, h: 80 },
    lp: { x: 16, y: 145, w: 208, h: 48 },
    lpNum: { x: 154, y: 140.5, w: 56, h: 56 },
    timeCy: 208, placeCy: 236, dejiCy: 264, magCy: 300, depCy: 345,
    rowX: 22, valRight: 190,
    barMag: { x: 8, y: 80, w: 224, h: 344 },
    barDep: { x: 8, y: 80, w: 224, h: 344 },
    tsu: { x: 6, y: 362, w: 228, h: 60 },
    hshift: 62
  };
  var FIN_BG_456 = 'assets/7a143c0c241ea0c25c5e13d845431b4e.svg';   /* paIbg208 264×456 */
  var FIN_BG_376 = 'assets/79663611b166d1cf1ea497e4f74f1d4c.svg';   /* paIbg172 264×376（已废弃） */
  var FCL = FIN_GEO_456;
  var FIN_BG = FIN_BG_456;
  /* 官方 paSc-1（clean/cb45d2d2…）的 208×80 圆角底板路径 —— 官方就是用 Scratch 的
     COLOR 效果把这块 #31476d 底板染成震度色的，这里直接换 fill（造型完全一致） */
  var FIN_BLK_PATH = 'M10 0h188c5.54 0 10 4.46 10 10v60c0 5.54-4.46 10-10 10H10' +
    'c-5.54 0-10-4.46-10-10V10C0 4.46 4.46 0 10 0z';
  function finBlkSrc(color) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="208" height="80" viewBox="0 0 208 80">' +
      '<path fill="' + color + '" fill-rule="evenodd" d="' + FIN_BLK_PATH + '"/></svg>');
  }
  /** ★ 2026-10-26 终报卡的「最大烈度」标签（208×80）
   *  官方 paSs 是**烧死日文「最大震度」**的整图，烈度卡照用就会出现「震度 8 / 震度 9」
   *  （中国烈度根本没有 8 级以上这种震度）。
   *  几何按 paSs 实测墨迹框：左缘 x23、垂直中心 41.5、墨迹高 24（4 字≨95 宽）→ 字号 24。 */
  function finLabLiedu() {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="208" height="80" viewBox="0 0 208 80">' +
      '<text x="23" y="40.5" dominant-baseline="central" ' +
      'font-family="Microsoft YaHei UI, Microsoft YaHei, Noto Sans SC, sans-serif" ' +
      'font-size="24" font-weight="700" fill="#ffffff">最大烈度</text></svg>');
  }
  function finHost() {
    if (FIN.host && FIN.host.parentNode) return FIN.host;
    FIN.host = null;
    var st = document.getElementById('stage') || document.body;
    var d = document.createElement('div');
    d.id = 'qvfinalcard';
    /* ⚠️ z-index 必须高于 #art（官方素材层 z=6）：设 3 时被 bgsq（648×728 暗底）
       压在下面 → 震度块/色条/津波胶囊都看不见（实测 elementFromPoint = IMG[cos=bgsq]）。 */
    d.style.cssText = 'position:absolute;left:0;top:4px;width:960px;height:720px;' +
      'pointer-events:none;display:none;z-index:20';
    st.appendChild(d);
    FIN.host = d;
    return d;
  }
  /** 正式报卡显示/隐藏时，把普通卡里会重叠的官方精灵收起（恢复时还原）
   *  ⚠️ 履历的平移**不在**这里做：app.js 的 applyScroll() 每帧会把 #art img 的
   *     transform 重写为滚动位移，这里设了会被它覆盖。履历下移统一由
   *     window.QVCardExtra()（下方定义）告诉 app.js，由它一并算进 transform。 */
  function finSprites(show) {
    FIN.sprites.forEach(function (cos) {
      var a = document.querySelectorAll('#art img[data-cos="' + cos + '"]');
      for (var i = 0; i < a.length; i++) {
        var el = a[i];
        if (show) {
          /* 只恢复【因正式报卡被藏掉】的那些，别把本来就该隐藏的（如无数值时的色条）点亮 */
          if (el.dataset.finHidden) { delete el.dataset.finHidden; el.style.display = ''; }
        } else {
          el.dataset.finHidden = '1';
          el.style.display = 'none';
        }
      }
    });
  }
  /** 正式报卡比普通情报卡高出的量（px）—— app.js 用它平移履历/底板/滚动上限 */
  var FIN_ON = false;
  /* ★★★ 2026-10-26 用户：「调查中卡片之前是改好的，他私自改了卡片内容」
     → 调查中（Tab1）卡面 100% 由 views.js 的 #inqbox 用官方 paIbg130 拼，
       底层普通卡必须收起：
         · paIbg130 画布顶上 21px 是**透明**的，不收底层 → 露出普通卡的红色标题条；
         · 调查中卡只到画布 y281（stage 331），不收底层 → 底下露出「津波の心配なし」胶囊。
       收起方式和正式报卡一致（finSprites），只藏官方精灵，不改任何内容。 */
  var INQ_ON = false;
  /* ★ 2026-10-26 用户选「把地震历史整块上移到卡下面」，定了空隙值：
     「空隙我记得是4px」→ 看完后又改：「缝隙多加2px那个调查中」 ⇒ **6px**
     ⇒ 空隙按**可见边**算，不是按 SVG 画布边：
       ① 调查中卡（paIbg130）卡面底 = 画布 281 → 舞台 **269**（容器原点 0，.bg top −12）
       ② 履历底板 paTbg0 画布顶上有 **18px 全透明**（实测 elementFromPoint 逐像素扫：
          y0..17 无命中，可见 #31476d 蓝带从 y18 才开始）
       ③ 目标：可见顶 = 269 + 6 = **275** ⇒ 画布顶 = 275 − 18 = **257**
       ④ paTbg0 基准位置 = 舞台 **358**（= layout 的 inline top，实测无额外组偏移）
       ⇒ 位移 = 257 − 358 = **−101**
     app.js 的 cardExtra() 会把这个值加到履历行 / 底板 / 滚动上限 / 文字层上
     （正式报卡用的是 +63，方向相反）。
     ⚠️ 别再用「inline top + 63」去推 —— 那个 63 是正式报卡的 hshift，不是组偏移。 */
  var INQ_UP = -101;
  window.QVCardExtra = function () {
    if (INQ_ON) return INQ_UP;
    return FIN_ON ? FIN.hshift : 0;
  };
  function finBox(host, css, parent) {
    var d = document.createElement('div');
    d.style.cssText = 'position:absolute;' + css;
    (parent || host).appendChild(d);
    return d;
  }
  function finImg(host, src, css) {
    var im = new Image();
    im.src = src;
    im.draggable = false;
    im.style.cssText = 'position:absolute;' + css;
    host.appendChild(im);
    return im;
  }
  /** 正式报卡本体（只在 V.eew.kind === 'final' 时调用） */
  function drawFinalCard(T, zh, q, E) {
    var host = finHost();
    host.innerHTML = '';
    host.style.display = '';
    var Z = global.QV_ZH || {};
    var aria = global.QVViews && global.QVViews.eewArt ? global.QVViews.eewArt : {};
    var metric = metricOf(q);
    var lv = (metric === 'shindo') ? shindoVal(q) : metricVal(q, 'liedu');
    var LIE = global.QV_LIEDU;

    /* ⓿ 底板：官方 paIbg208（264×456，比普通卡多一条長周期地震動階級带） */
    finImg(host, FIN_BG, 'left:' + FCL.bg.x + 'px;top:' + FCL.bg.y + 'px;width:' + FCL.bg.w +
      'px;height:' + FCL.bg.h + 'px');
    /* ⓿b 标题：官方 paIti3（ⓘ 图标 + 空标题条，224×32 @8,8）+ 中文标题
        ⚠️ 必须画在 overlay 里 —— 它盖住了 #art/#zh，否则顶部只剩一条空蓝条（用户图一）。
        ⚠️⚠️ 只能用 **clean/** 那份（layout.js 里 paIti3 = clean/d1f3e6e…）。
           非 clean 的原始 SVG 里「各地の震度情報」是**烧进 path 的日文**，
           叠在中文标题上就成了「各地震震情報」重影（2026-10-23 实测踩过）。 */
    finImg(host, 'assets/clean/d1f3e6e993602ac52320c89b3188e54e.svg',
      'left:8px;top:8px;width:224px;height:32px');
    /* ★ 2026-10-26 用户：「各地震度信息的图标中间的 i 不见了」
       clean 版 paIti3 里 ⓘ 只剩圆环（环内 "i" 太小，清洗时被当碎片删了）；
       #art 层那边有 buildInfoIcon() 补画，但这张终报卡的标题条是我们自己贴的 <img>
       （没有 data-cos）→ 补画不会命中它。这里用完全相同的几何再画一个。 */
    (function () {
      var NS = 'http://www.w3.org/2000/svg';
      var ic = document.createElementNS(NS, 'svg');
      ic.setAttribute('viewBox', '0 0 224 32');
      ic.setAttribute('style', 'position:absolute;left:8px;top:8px;width:224px;height:32px;pointer-events:none');
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', 53); c.setAttribute('cy', 12.9); c.setAttribute('r', 1.1);
      c.setAttribute('fill', '#fff');
      var b = document.createElementNS(NS, 'rect');
      b.setAttribute('x', 51.95); b.setAttribute('y', 15); b.setAttribute('width', 2.1);
      b.setAttribute('height', 5.2); b.setAttribute('rx', 1.05); b.setAttribute('fill', '#fff');
      ic.appendChild(c); ic.appendChild(b);
      host.appendChild(ic);
    })();
    T.zh(host, {
      text: (metricOf(q) === 'liedu') ? (Z.tabInfoLiedu || '各地烈度信息') : (Z.tabInfo || '各地震度信息'),
      size: L.title.size, align: 'center',
      /* ★ 2026-10-26：与普通卡同一套 —— 以标题条中心 120 居中（原来写 84.8 左对齐，6 字会偏右 13px） */
      x: 120, y: Math.round(L.title.cy - L.title.size / 2), color: '#fff', weight: 500
    });

    /* ① 震度块：官方 208×80 圆角底板（paSc-1 造型）染色
       ★ 2026-10-26 用户：「烈度卡……卡片的色块也是小了一大圈」
         —— 烈度以前走 LIE.blockSrc()，那是 **248×120 画布里的 208×80 墨迹**（墨迹在 20,20），
            直接塞进 208×80 的槽 → 视觉上只剩 157×53、还偏左上。
         ⇒ 两种刻度统一用 finBlkSrc()（官方那条 208×80 底板路径），只换 fill 色。 */
    var col = (metric === 'liedu' && LIE && LIE.colorOf)
      ? LIE.colorOf(lv)
      : ((global.QVShindo && QVShindo.colorOf) ? QVShindo.colorOf(lv) : '#7a7a7a');
    finImg(host, finBlkSrc(col), 'left:' + FCL.blk.x + 'px;top:' + FCL.blk.y + 'px;width:' +
      FCL.blk.w + 'px;height:' + FCL.blk.h + 'px');
    /* 「最大震度」标签：日/中同形用官方 paSs；**烈度必须写「最大烈度」**
       ★ 2026-10-26 用户：「为什么正式版卡片变成了 震度8，震度9 什么的」
         —— paSs 是烧死「最大震度」的整图，烈度 8/9 就变成了不存在的震度 8/9。 */
    var labDark = (metric !== 'liedu' && shindoTextColor(lv) === '#1c1c1c');
    finImg(host, (metric === 'liedu') ? finLabLiedu() : 'assets/5c2247d18f3a419fadb9c1121eff15fb.svg',
      'left:' + FCL.blk.x + 'px;top:' + FCL.blk.y + 'px;width:' + FCL.blk.w + 'px;height:' +
      FCL.blk.h + 'px' + (labDark ? ';filter:brightness(.11)' : ''));
    /* 大号数字：沿用官方 snd 造型（setShindo/setLiedu 已经把正确的图换好了）
       ★ 2026-10-26 用户：「为什么最大震度4它的字体不应该是黑色的吗」
         —— 官方 snd 造型是白字，震度 2/3/4（浅绿/浅黄/橙底）要另外刷深，
            主卡那边由 setShindo() 加 brightness(.11)，这张 overlay 卡以前漏了数字
            （只有「最大震度」标签被刷深，数字还是白的）。⇒ 同一个 labDark 一起刷。 */
    var srcEl = document.querySelector('#art img[data-cos="snd1"]');
    var numSrc = (metric === 'liedu' && LIE && LIE.numeralSrc)
      ? LIE.numeralSrc(lv) : (srcEl ? srcEl.getAttribute('src') : '');
    if (numSrc) {
      finImg(host, numSrc, 'left:' + FCL.num.x + 'px;top:' + FCL.num.y + 'px;width:' +
        FCL.num.w + 'px;height:' + FCL.num.h + 'px' + (labDark ? ';filter:brightness(.11)' : ''));
    }

    /* ② 长周期：JMA「最大長周期地震動階級 1~4」／烈度区特供「长周期震感 1 有感 2 明显 3 强烈 4 剧烈」
       ★★★ 2026-10-27 用户：「中国特供长地震周期卡片改成 1=有感 2=明显 3=强烈 4=剧烈」
       —— 「長周期地震動階級」是 JMA 独有分级（1~4 级 + 官方 sndl 数字），
          中国烈度区没有这套概念，硬搬过去就是「中国的卡上写日本的等级」。
       ⇒ 颜色仍用官方 paScl 色块（1..4 四档），数字位置改成写这四个定性词。 */
    var LGW = ['', '有感', '明显', '强烈', '剧烈'];
    var lgv = (E && E.maxLg != null && E.maxLg >= 0) ? (E.maxLg | 0) : -1;
    /* ★ 2026-10-27 用户：「地震周期 1 级的字体为什么是白色的都看不清，应该是黑色」
       —— paScl1 是黄底、sndl1 是白字素材 → 階級1 整条转深色（数字用 brightness(.11)） */
    var _lgDark = (lgv === 1);
    if (lgv >= 0 && aria.paScl) {
      var key = String(Math.min(4, lgv));
      finImg(host, aria.paScl[key] || aria.paScl['0'], 'left:' + FCL.lp.x + 'px;top:' + FCL.lp.y +
        'px;width:' + FCL.lp.w + 'px;height:' + FCL.lp.h + 'px');
      var nk = String(Math.min(4, Math.max(1, lgv)));
      if (metric === 'liedu') {
        /* 照抄官方卡：右侧数字位换成 2 字中文定性词，23px、粗。
           ★ 居中：官方标签 24..135 / 数字 155..185（左右边距均 24）；
             两字比一位数字宽，词中心压回色块内的 161，右缘才是 184。 */
        var wEl = T.zh(host, {
          text: LGW[Math.min(4, Math.max(1, lgv))], size: 23, align: 'center',
          x: FCL.lp.x + 160,
          y: Math.round(FCL.lpNum.y + FCL.lpNum.h / 2 - 11.5),
          color: _lgDark ? '#1c1c1c' : '#fff', weight: 800, ls: 0.2
        });
        if (wEl) { wEl.style.whiteSpace = 'nowrap'; wEl.style.textShadow = _lgDark ? 'none' : '0 1px 2px rgba(0,0,0,.22)'; }
      } else if (aria.sndl && aria.sndl[nk]) {
        finImg(host, aria.sndl[nk], 'left:' + FCL.lpNum.x + 'px;top:' + FCL.lpNum.y +
          'px;width:' + FCL.lpNum.w + 'px;height:' + FCL.lpNum.h + 'px' +
          (_lgDark ? ';filter:brightness(.11)' : ''));
      }
      /* 左侧说明：烈度区写「长周期震感」（字少 ⇒ 放大到 22px，横向长度对齐官方 9 字），
         JMA 写官方那串 */
      T.zh(host, {
        text: (metric === 'liedu') ? '长周期震感'
          : (Z.maxLongPeriod || '最大长周期地震动阶级'),
        size: (metric === 'liedu') ? 20 : 12, align: 'left',
        x: FCL.lp.x + ((metric === 'liedu') ? 17 : 12),
        y: Math.round(FCL.lp.y + FCL.lp.h / 2 - ((metric === 'liedu') ? 11 : 6)),
        color: _lgDark ? '#1c1c1c' : '#fff', weight: (metric === 'liedu') ? 600 : 600,
        ls: (metric === 'liedu') ? 0.22 : 0, maxW: 122, minSize: 12
      });
    }

    /* ③ 発生時刻（官方 sj 字形）
       ★ 时间兵底：模拟地震的 q 可能没 timeMs（已从 fireSim 入口补齐，这里再兵一层） */
    T.num(host, mdTime((q && q.timeMs) || (E && E.timeMs) || 0), S.originTime.size, SW / 2 + S.originTime.X0,
      FCL.timeCy, 'left');
    /* ④ 震源地名 */
    if (!T.place(host, q.place, T.placeSize(q.place, 96), FCL.rowX, FCL.placeCy, 'left')) {
      T.zh(host, {
        text: q.place || (Z.unknown || '不明'), size: 18, color: '#fff', align: 'left',
        x: FCL.rowX, y: Math.round(FCL.placeCy - 9), maxW: 200, minSize: 12
      });
    }
    /* ⑤ 「发生了地震」—— ★ 2026-10-27 用户：「正常的应该是这样的」（中文）
       ⚠️ 这里原来写的是 `Z.quakeHappenedJa || 'で地震がありました'`，
          但语言包（zh.js）里**只有** `quakeHappened: '发生了地震'`、根本没有 quakeHappenedJa
          → 这个 fallback 是日文，正式报卡就永远冒一行日文，和普通主卡不一致。 */
    T.zh(host, {
      text: Z.quakeHappened || '发生了地震', size: 17, color: '#fff',
      align: 'left', x: FCL.rowX, y: Math.round(FCL.dejiCy - 8.5)
    });

    /* ⑥ マグニチュード / 深さ（中文标签 + 官方数字字形 + **官方色阶条模板**） */
    var mc = magColor(q.mag), dc = depColor(q.depthKm);
    T.zh(host, { text: Z.magnitude || '震级', size: L.mag.size, color: '#c2c9d4', align: 'left',
      x: L.mag.x, y: Math.round(FCL.magCy - L.mag.size / 2) });
    T.num(host, (isFinite(q.mag) && q.mag > 0) ? q.mag.toFixed(1) : '',
      S.magVal.size, FCL.valRight, FCL.magCy, 'right');
    if (mc && barSrc('paImag', mc)) {
      finImg(host, barSrc('paImag', mc), 'left:' + FCL.barMag.x + 'px;top:' + FCL.barMag.y +
        'px;width:' + FCL.barMag.w + 'px;height:' + FCL.barMag.h + 'px');
    }

    /* ★ 376 底板（paIbg172）把日文「深さ」烤在图上了；但它已废弃（用户认定那是 bug 版本），
       现在 overlay 卡只用 paIbg208，这块遮罩用不到 → 中文「深度」直接画。 */
    T.zh(host, { text: Z.depth || '深度', size: L.dep.size, color: '#c2c9d4', align: 'left',
      x: L.dep.x, y: Math.round(FCL.depCy - L.dep.size / 2) });
    /* ★★★ 2026-10-27 深度 0km = ごく浅い → 「极浅」（同 draw() 里的 statDep） */
    if (isFinite(q.depthKm) && q.depthKm >= 0 && q.depthKm < 1) {
      T.zh(host, { text: Z.veryShallow || '极浅', size: Math.max(13, Math.round(S.depVal.size * 0.4)),
        color: '#fff', align: 'right', x: FCL.valRight,
        y: Math.round(FCL.depCy - Math.max(13, Math.round(S.depVal.size * 0.4)) / 2
          - Math.max(13, Math.round(S.depVal.size * 0.4)) * 0.12) });
    } else {
      T.num(host, (isFinite(q.depthKm) && q.depthKm >= 1) ? Math.round(q.depthKm) + 'k' : '',
        S.depVal.size, FCL.valRight, FCL.depCy, 'right');
    }
    if (dc && barSrc('paIdep', dc)) {
      finImg(host, barSrc('paIdep', dc), 'left:' + FCL.barDep.x + 'px;top:' + FCL.barDep.y +
        'px;width:' + FCL.barDep.w + 'px;height:' + FCL.barDep.h + 'px');
    }

    /* ⑦ 津波胶囊（官方卡在这一版里是一条 200×40 的扁条，标语「津波警報・注意報」）
       —— 颜色按等级：无 #31476d / 不明·调查中 #63636e / 注意报 #e4e600 / 警报 #e10000 */
    var _TSU = (global.QData && global.QData.tsunami) ? global.QData.tsunami() : null;
    if (q && q.sim) {
      if (_TSU && _TSU.items && _TSU.items.length) {
        var _tlv = _TSU.maxLv | 0;
        q.tsuKind = _tlv >= 3 ? 5 : 4;
        q.tsunami = _tlv >= 4 ? 3 : (_tlv === 3 ? 2 : 1);
        q.tsuMajor = _tlv >= 4;
      } else if (q.tsuKind != null) {
        q.tsuKind = 0; q.tsunami = 0; q.tsuMajor = false;
      }
    }
    var tSuf, tTxt;
    if (q.tsuKind != null && q.tsuKind >= 0) {
      var k6 = Math.min(5, q.tsuKind | 0);
      tSuf = ['0', '1', '2', '30', '41', '42'][k6];
      tTxt = k6 === 5 ? ((q.tsuMajor ? Z.tsunamiMajor : Z.tsunamiWarn) || '海啸警报')
        : k6 === 4 ? (Z.tsunamiWatch || '海啸注意报')
          : k6 === 3 ? (Z.tsunamiSlight || '海面轻微变动')
            : k6 === 2 ? (Z.tsunamiChecking || '海啸状况调查中')
              : k6 === 1 ? (Z.tsunamiUnknown || '海啸状况不明')
                : (Z.tsunamiNone || '无海啸威胁');
    } else {
      tSuf = q.tsunami >= 2 ? '42' : q.tsunami === 1 ? '41' : '0';
      tTxt = q.tsunami >= 3 ? (Z.tsunamiMajor || '大海啸警报')
        : q.tsunami === 2 ? (Z.tsunamiWarn || '海啸警报')
          : q.tsunami === 1 ? (Z.tsunamiWatch || '海啸注意报')
            : (Z.tsunamiNone || '无海啸威胁');
    }
    var tBg = (tSuf === '41') ? '#e4e600' : (tSuf === '42') ? '#e10000'
      : (tSuf === '0' || tSuf === '30') ? '#31476d' : '#63636e';
    var tFg = (tSuf === '41') ? '#1d1f24' : '#ffffff';
    /* 胶囊本体 = 官方 paIts（228×60，clean 无日文）→ 中文文字层叠在上面（同主卡做法） */
    var itsArt = (global.QV_VAR || {}).paIts || {};
    var itsSrc = itsArt[tSuf];
    if (itsSrc) {
      finImg(host, 'assets/' + itsSrc, 'left:' + FCL.tsu.x + 'px;top:' + FCL.tsu.y +
        'px;width:' + FCL.tsu.w + 'px;height:' + FCL.tsu.h + 'px');
      T.zh(host, {
        /* ★ 2026-10-26 用户：「大卡片的海啸注意报的字体小了」
           官方胶囊 paIts0 / paIts41（都是 228×60）里烘焙的日文实测：
             每字 advance ≈ 20.4px、墨迹 19.2×19.1（getBBox 逐字量）
           ⇒ 字号应该是 **20**，原来写 16（比官方小 20%）→ 改 20，
             垂直中心仍取胶囊中线 392（362+30），top = 392 − 10。 */
        text: tTxt, size: 20, align: 'center', x: FCL.tsu.x + 114, y: Math.round(FCL.tsu.y + 30 - 10),
        color: tFg, maxW: 196, weight: 500
      });
    }
    return host;
  }
  function hideFinalCard() {
    if (FIN.host) { FIN.host.innerHTML = ''; FIN.host.style.display = 'none'; }
  }
  /* 导出：view ≠ 0（type2/3/4）时由 views.js 的 setView() 调用，收起这张 overlay 卡 */
  global.QVFinalCardHide = hideFinalCard;

  /* ---------------- 色阶条上色（★ 官方原算法，2026-10-08 从 project.json 反编译确证） ----------------
   * 官方自定义积木「色にする (深さt %b , 値 %s , ペンに %b ) UI」：
   *
   *   震级：  pos = round(M × 10) / 100
   *   深度：  t = (d < 9.25) ? 6.5 : 11.634 − 1.621 × ln(d + 14.5)
   *           pos = round(t × 10) / 100
   *   颜色：  dc #M色キャッシュ[ 3×round(値×10) + 1..3 ]
   *           该缓存 = 对 d #マグニチュード色 按 pos=0.00..0.99 逐百分点插值（色キャッシュ生成）
   *           → 等价于「在渐变的 pos 处取色」
   *   （值 = "f"/"h"/"" 时是灰色 #828282，即数据不明）
   *
   * 旧代码 t=0.1+0.8×(M/11)、t=0.7×(1−d/180) 是错的 → 就是「色卡的色号不对」。
   * 实测校验（官方运行时逐像素）：M2.1/2.8/3.0/3.6/3.8 与 深度 10/30/40/ごく浅い
   *                            共 8 个样本 RGB 全部完全一致。
   * ------------------------------------------------------------------ */
  var MG_STOPS = [
    [0.1, 0x29, 0x2b, 0xe5], [0.324, 0x32, 0xe0, 0xf3], [0.396, 0x92, 0xed, 0x75],
    [0.5, 0xf8, 0xdd, 0x31], [0.652, 0xf6, 0x3c, 0x1a], [0.748, 0xd3, 0x45, 0xd3],
    [0.9, 0x65, 0x28, 0xe9]
  ];
  function rgbHex(r, g, b) { return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1); }
  function grad(t) {
    var first = MG_STOPS[0], last = MG_STOPS[MG_STOPS.length - 1];
    if (!(t > first[0])) return rgbHex(first[1], first[2], first[3]);
    if (t >= last[0]) return rgbHex(last[1], last[2], last[3]);
    for (var i = 1; i < MG_STOPS.length; i++) {
      var a = MG_STOPS[i - 1], b = MG_STOPS[i];
      if (t <= b[0]) {
        var k = (t - a[0]) / (b[0] - a[0]);
        return rgbHex(Math.round(a[1] + (b[1] - a[1]) * k),
          Math.round(a[2] + (b[2] - a[2]) * k), Math.round(a[3] + (b[3] - a[3]) * k));
      }
    }
    return rgbHex(last[1], last[2], last[3]);
  }
  function c01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  /** 震级 → 色阶位置（官方：round(M*10)/100） */
  function magPos(m) { return Math.round(m * 10) / 100; }
  /** 深度 → 色阶位置（官方：先取对数刻度 t，再 round(t*10)/100） */
  function depPos(d) {
    var t = (d < 9.25) ? 6.5 : 11.634 - 1.621 * Math.log(d + 14.5);
    return Math.round(t * 10) / 100;
  }
  /** 震级 → 色阶条颜色 */
  function magColor(m) {
    if (!isFinite(m) || m <= 0) return null;
    return grad(c01(magPos(m)));
  }
  /** 深度 → 色阶条颜色 */
  function depColor(d) {
    if (!isFinite(d) || d < 0) return null;
    return grad(c01(depPos(d)));
  }
  /** 把条 SVG 模板里的 @@C@@ 换成目标色，返回 data URI */
  function barSrc(cos, color) {
    var t = (global.QV_BARSVG || {})[cos];
    if (!t) return null;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(t.replace(/@@C@@/g, color));
  }
  /** 给同族第 idx 个色阶条上色；color 为 null 则隐藏该条 */
  function setBar(cos, idx, color) {
    var a = document.querySelectorAll('#art img[data-cos="' + cos + '"]');
    var im = a[idx]; if (!im) return;
    if (!color) { im.style.display = 'none'; return; }
    im.style.display = '';
    var s = barSrc(cos, color);
    if (s) im.src = s;
  }

  /** ★★ 主卡海啸条换造型：官方 `paIts<后缀>`（后缀与含义见主绘制处的表）
   *  官方积木就一句：`穿造型("paIts"⊕6-2タブ表示内容[9])`（diag/decomp-bar.txt）
   *  ⚠️ 用 `^=` 找元素：换过造型后 data-cos 已经不是 paIts0 了。 */
  function setTsuBar(suf) {
    var im = document.querySelector('#art img[data-cos^="paIts"]');
    if (!im) return;
    var f = ((global.QV_VAR || {}).paIts || {})[suf];
    if (!f) return;
    if (im.getAttribute('data-cos') === 'paIts' + suf) return;
    im.setAttribute('data-cos', 'paIts' + suf);
    im.src = 'assets/' + f;
  }

  /* ---------------- 布局缩放 ---------------- */
  R.layout = function () {
    var w = innerWidth, h = innerHeight, s = Math.min(w / SW, h / SH);
    document.getElementById('stage').style.transform =
      'translate(' + Math.round((w - SW * s) / 2) + 'px,' +
      Math.round((h - SH * s) / 2) + 'px) scale(' + s + ')';
  };

  /* ---------------- 图形层 ---------------- */
  /* layout.js 是官方运行时「某一时刻」的快照，里面混进了**随数据变化的元素**。
   * 履历徽章 paTm* 是快照时刻烘死的数据 → 由 badge() 按当前数据动态画，在此屏蔽
   * （否则新旧两套叠在一起，行数一变就露出来）。
   * ⚠️ 色阶条 paImag/paIdep/paTdep/paTmag **不能屏蔽**：setBar() 要靠它们（几何取自
   *    layout.js）当占位元素再换 src 上色。之前误屏蔽 → setBar 找不到元素 → 一根都不上色，
   *    画面上看到的白条其实是面板素材 paIbgm / paTmjs 里烘死的静态条。 */
  var ART_SKIP = {
    /* 100l/100u = 一块海色(#252f43)方形「地图图块」，位置随相机变；
       官方相机在奄美时它落在海上→看不见，我们的静态底图上会糊在本州中间 → 屏蔽 */
    '100l': 1, '100u': 1,
    paTm0: 1, paTm1: 1, paTm2: 1, paTm3: 1, paTm4: 1, paTm5: 1,
    paTm6: 1, paTm7: 1, paTm8: 1, paTm9: 1, 'paTm-1': 1
  };
  R.buildArt = function () {
    var layer = document.getElementById('art');
    layer.innerHTML = '';
    var art = global.QV_ART || [], frag = document.createDocumentFragment(), n = 0;
    for (var i = 0; i < art.length; i++) {
      var A = art[i];
      if (A[0] === 'blk') continue;
      /* 履历徽章（paTm1/paTm2/paTm-1…）是快照时刻烘死的数据，
         改由 badge() 按当前数据动态画 → 跳过，避免新旧两套叠在一起 */
      if (/^paTm(-1|\d)$/.test(A[0])) continue;
      if (ART_SKIP[A[0]]) continue;
      var im = new Image();
      im.src = 'assets/' + A[1];
      im.dataset.cos = A[0];
      im.style.cssText = 'position:absolute;left:' + A[2] + 'px;top:' + A[3] +
        'px;width:' + A[4] + 'px;height:' + A[5] + 'px';
      frag.appendChild(im); n++;
    }
    layer.appendChild(frag);
    n += R.buildInfoIcon();
    return n;
  };

  /* ---------------- 标题栏 ⓘ 图标（自己画，不靠素材） ----------------
   * 官方 paIti3 里 ⓘ = 圆环(path) + 环内 "i"(path)；清洗面板内烘焙日文时，
   * "i" 因体积小被当成碎片删掉了 → 只剩一个空环。
   * 图标太简单，不再从 1400+ 素材里捞，直接内联 SVG 画一个（禁用 emoji）。
   * 几何取自官方原始素材（画布 224x32，与 paIti3 同坐标系）：
   *   环   圆心 (53,16)、外 r8.5 / 内 r6.5（官方原有，保留不动）
   *   "i"  官方墨迹框 (51.91,11.81) 2.19 x 8.38
   *        → 圆点 r1.1 @(53,12.9) + 圆角竖笔 x51.95..54.05 / y15..20.2
   */
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  R.buildInfoIcon = function () {
    var layer = document.getElementById('art'), n = 0;
    var bars = layer.querySelectorAll('img[data-cos^="paIti"]');
    for (var i = 0; i < bars.length; i++) {
      var host = bars[i];
      var ic = svgEl('svg', { viewBox: '0 0 224 32' });
      /* 与标题栏素材同位同尺寸 → 画布坐标 1:1，无需换算 */
      ic.style.cssText = 'position:absolute;left:' + host.style.left + ';top:' + host.style.top +
        ';width:' + host.style.width + ';height:' + host.style.height + ';pointer-events:none';
      ic.appendChild(svgEl('circle', { cx: 53, cy: 12.9, r: 1.1, fill: '#fff' }));
      ic.appendChild(svgEl('rect', { x: 51.95, y: 15, width: 2.1, height: 5.2, rx: 1.05, fill: '#fff' }));
      layer.appendChild(ic); n++;
    }
    return n;
  };

  /* ---------------- 造型变体切换 ---------------- */
  /** 把某个造型的 <img> 换成同族另一变体（保持位置尺寸不变） */
  function swapVariant(cosName, newFile) {
    var im = document.querySelector('#art img[data-cos="' + cosName + '"]');
    if (!im) return null;
    im.src = 'assets/' + newFile;
    im.style.display = '';
    return im;
  }
  /** 把某个造型的 <img> 换成任意 src（data URI 也行），位置尺寸不变 */
  function swapSrc(cosName, src) {
    var im = document.querySelector('#art img[data-cos="' + cosName + '"]');
    if (!im || !src) return null;
    im.src = src;
    im.style.display = '';
    return im;
  }
  function hideEl(cosName) {
    var im = document.querySelector('#art img[data-cos="' + cosName + '"]');
    if (im) im.style.display = 'none';
  }
  /** 按震度换主卡造型：paSc（纯色块）与 snd（大号白数字）必须【同步】换。
   *  官方积木依据：snd 用 set BRIGHTNESS to 100 刷白 + switch costume to sndN。
   *  只换 paSc 会得到「绿块配白1」——颜色与数字对不上，正是用户报的「色块颜色不对」。 */
  /** ★★ 大号震度数字的「字色」—— 官方 snd 造型本体是【纯白】，颜色靠 Scratch BRIGHTNESS 调：
   *     `特效 BRIGHTNESS = (255 − 0x<d #震度配色(文字)[档位]>) × (−100/255)`
   *  用的是与「最大震度」那行【同一张颜色表】（实测列表 [ff,ff,1c,1c,1c,ff,…]）
   *     ⇒ 震度 2 / 3 / 4 的深字同样要刷成 #1c1c1c。
   *  ❗ 旧代码只 swapVariant('snd1', …) 换造型、不上色 → 数字恒为白色
   *     （用户：“你只改了静态的那个最大震度，数字没改”）。
   *  白 255 × 0.11 ≈ 28 = #1c1c1c，等价于官方那支 BRIGHTNESS 效果。 */
  function setSndTint(v) {
    var im = document.querySelector('#art img[data-cos="snd1"]');
    if (!im) return;
    im.style.filter = (v != null && v >= 0 && shindoTextColor(v) === '#1c1c1c') ? 'brightness(0.11)' : '';
  }
  function setShindo(v) {
    var V = global.QV_VAR || {};
    if (!(v >= 0)) { setUnknown(); return; }        /* 不明 → 官方不明造型 */
    var suf = global.QV_SC_SUF ? global.QV_SC_SUF(v) : String(Math.round(v));
    var blk = V.paSc; if (blk) { var f = blk[suf] || blk['-1']; if (f) swapVariant('paSc1', f); }
    var dig = V.snd; if (dig) { var g = dig[suf] || dig['-1']; if (g) swapVariant('snd1', g); }
    setSndTint(v);                                 /* 震度 2/3/4 → 数字也要深字 */
  }
  /** 是否「没有震度/烈度时显示震度0的图标」—— 官方设置项「震度0のアイコンを表示」。
   *  ★ 用户点名要求：「加个最大震度0的那个图标」「加个0的数字也好啊」「你他妈空白的几个意思」。
   *    开关在设置页「实时页」分组里，默认开；关掉则退回官方「不明」底板。 */
  function showShindo0() {
    return !!(global.QVViews && global.QVViews.showShindo0 && global.QVViews.showShindo0());
  }
  /** ★★ 官方「不明」（震度未知）真的画什么？—— 反编译 UI 精灵确证：
       if 克隆[1]="paSc": 穿造型(paSc-1) 再穿 paSc+档位      ← paSc-1 是【底板】
       if 克隆[1]="snd" : 内容[3]<"0" → 【隐藏】            ← 不明时大号数字不画！
     ⚠️ 旧代码把 paSc1 的 src 换成官方的 paSc-1 —— 它的画布是 208x80，
        而我们那个 <img> 的框是 248x120 → SVG 被**非均匀拉伸**成一个“突出的大卡片”
        （用户：“没数据的卡片完全不管”、“突出了原版UI框架”）。
     正解：用与 paSc1 **同画布**(248x120)的色块（@31476d），并把 snd1 隐藏。
    ★ 现在分两种情况（用户原话：「虽然有地震，但没有震度烈度的东西…加个 0 的数字也好啊」）：
      ① 有地震、只是没有震度/烈度 → 设置「显示震度 0 的图标」开（默认）→ 画官方震度0（灰底 + 大 0）
      ② 一条数据都没有（刚启动 / 全部源失败）→ 永远是「不明」底板，别拿 0 冒充数据
     forceUnknown = true 时强制走 ②。 */
  function setUnknown(forceUnknown) {
    var LIE = global.QV_LIEDU;
    if (!forceUnknown && showShindo0() && LIE) {
      swapSrc('paSc1', LIE.blockSrc(0));            /* 官方色卡第 1 档：震度0 灰底 */
      swapSrc('snd1', LIE.numeralSrc(0));           /* 大号 0（官方数字字形几何） */
      setSndTint(-1);                               /* 字色已烘在 numeralSrc 里 */
      return;
    }
    if (LIE) swapSrc('paSc1', LIE.blockSrc(-1));
    hideEl('snd1');
    setSndTint(-1);                                 /* 清掉可能残留的调色 */
  }
  /** ★ 主卡「不明」大字：官方不明底板（setUnknown 已换好）之上，
   *  在【原大号数字的位置】写「不明」——否则整块卡片就是空的（用户报的「空白」）。
   *  位置尺寸直接读官方 snd1 的框，不写死坐标。 */
  function drawUnknownBig(zh) {
    var el = document.querySelector('#art img[data-cos="snd1"]');
    if (!el || !zh) return;
    var x = parseFloat(el.style.left) || 0, y = parseFloat(el.style.top) || 0;
    var w = parseFloat(el.style.width) || 80, h = parseFloat(el.style.height) || 80;
    var Z = global.QV_ZH || {};
    var size = Math.max(14, Math.round(h * 0.40));
    global.QVT.zh(zh, {
      text: Z.unknown || '不明', x: Math.round(x + w / 2), y: Math.round(y + (h - size) / 2),
      size: size, color: '#e8eefc', align: 'center', weight: 600
    });
  }
  /** 履历行徽章：把 paTm 变体放到指定行（用 <img> 动态插入，不用 art 层） */
  function badgeBox(host, dy) {
    var s = S.row.badge;
    var box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:0;top:0;width:' + SW + 'px;height:' + SH + 'px;pointer-events:none';
    var im = new Image();
    /* paTm 画布 264x116、rx=132/58 → 画布左 = 480+X0-132, 上 = 360-y-58 */
    im.style.cssText = 'position:absolute;left:' + (SW / 2 + s.X0 - 132 * s.size / 100) + 'px;' +
      'top:' + (SH / 2 - s.y - 58 * s.size / 100 + dy) + 'px;' +
      'width:' + (264 * s.size / 100) + 'px;height:' + (116 * s.size / 100) + 'px';
    box.appendChild(im);
    host.appendChild(box);
    return im;
  }
  /** 履历小卡片徽章：默认 paTm（最大震度）；有长周期階級时换成官方 paTml
   *  官方 UI 的 `タブ表示内容個別`：有長周期字段时把值前缀 `l`，
   *  `switch costume to (paTm join ...)` 就会变成 `paTml1..9`。
   *  paTml 的造型画布同样是 264×116，只是数字更小（階級 1~4），位置一致。 */
  function badge(host, v, dy, lg) {
    var V = global.QV_VAR || {};
    var useLg = (lg != null && isFinite(+lg) && +lg >= 1);
    var fam = useLg && V.paTml ? V.paTml : V.paTm;
    if (!fam) return null;
    /* ★ paTml 的造型号是【最大震度】的造型后缀（0..9 / 5弱=5…），
       不是长周期階級；长周期階級只在下面的 paTl 黄条上用。 */
    var shSuf = global.QV_TM_SUF ? global.QV_TM_SUF(v) : '1';
    var f = fam[shSuf];
    /* 最大震度不明（-1）时 paTml-1 不存在 → 退回官方 paTm-1 红块；
       长周期黄条仍然要单独叠上去。 */
    if (!f && useLg && V.paTm) f = V.paTm[shSuf];
    if (!f) f = fam['1'] || (V.paTm && V.paTm['1']);
    if (!f) return null;
    var im = badgeBox(host, dy);
    /* ★ 2026-10-29：long-period 行用素材库原件（含官方「最大震度」字形），
       不再用 clean/ 版 + 自画中文标签。 */
    var origTml = (useLg && /^[1-9]$/.test(shSuf)) ? ('assets/patml/paTml' + shSuf + '.svg') : '';
    im.src = origTml || ('assets/' + f);
    im.onerror = function () {
      if (origTml) im.src = 'assets/' + f;
    };
    /* ★ 2026-10-29 用户对照官方素材：小卡片是 **paTml（震度）+ paTl（長周期階級）拼在一起**。
       官方 `paTl` 克隆与 `paTm` 同位置、同 264×116 画布，黄色「階級 N」小条
       自己落在画布下半部；没有長周期字段时官方直接 hide。 */
    if (useLg && V.paTl) {
      var lgSuf = String(Math.min(4, Math.max(1, Math.round(+lg))));
      /* ★ 2026-10-29：官方 paTl1..4 的「階級 N」文字是烧进 path 的，但 app 里的
         clean/ 版被清洗成只剩黄条 → 用户看到「黄条没字」。这里用素材库原件
         （assets/patl/paTl1..4.svg，含官方階級字样），失败再退回 clean 版。 */
      var pill = 'assets/patl/paTl' + lgSuf + '.svg';
      var im2 = new Image();
      im2.draggable = false;
      im2.style.cssText = im.style.cssText;
      im2.src = pill;
      im2.onerror = function () {
        if (V.paTl[lgSuf]) im2.src = 'assets/' + V.paTl[lgSuf];
      };
      /* 后追加 → 盖在 max shindo 徽章上面（官方也是 paTl 在 paTm 之后克隆） */
      if (im.parentNode) im.parentNode.appendChild(im2);
    }
    return im;
  }
  /** 烈度徽章：整块 SVG 已含【最大烈度】+ 阿拉伯数字 → 行内不再另写标签 */
  function badgeLiedu(host, v, dy, label) {
    var LIE = global.QV_LIEDU; if (!LIE) return null;
    var im = badgeBox(host, dy);
    im.src = LIE.badgeSrc(v, label);      /* 无值时：灰块 + 「最大烈度」，不画数字 */
    return im;
  }

  /* ---------------- 文案 ---------------- */
  /* ★★ 显示时区 = 本机时区（不传 tz 给 Intl）。
     原来这里写死 'Asia/Tokyo' —— 对一个中国用户来说**顶栏时钟比系统时间快 1 小时**
     （2026-10-10 实测：系统 01:36，界面显示 02:36，用户会以为时钟坏了）。
     官方原版是日本应用所以显示 JST；我们是中国复刻版，时钟必须显示本机时间。
     ⚠️ 「発生時刻」必须与顶栏时钟用**同一个时区**：否则刚发生的地震会显示成 1 小时后。
     ⚠️ 数据解析（data.js / ws.js）里的 Asia/Tokyo / Asia/Shanghai 是【源时区】，
        用来把不带时区的字符串还原成正确的时间戳，**不要动**。 */
  var TZ_VIEW;                           /* undefined = 本机时区（⚠️ 不能写 null） */
  function clockText(ms) {
    var p = Fmt.parts(new Date(ms), TZ_VIEW);
    return p.y + '/' + two(p.mo) + '/' + two(p.d) + ' ' + two(p.h) + ':' + two(p.mi) + ':' + two(p.s);
  }
  /* ★ 発生時刻 / 履历时刻 = 官方原版格式：`10月7日 16:03ごろ`（不带年份、小时不补零）
     → 中文同构：`10月7日 16:03左右`
     官方例子（diag/OFFICIAL-live-960.png）：主卡 `10月7日 16:03ごろ`、履历 `10月7日 9:22ごろ`
     ⚠️ 旧版写成 `2026年10月8日 21:22`（用户要求改回原版）。 */
  function mdTime(ms) {
    if (!ms) return '';
    var p = Fmt.parts(new Date(ms), TZ_VIEW);
    return p.mo + '月' + p.d + '日 ' + p.h + ':' + two(p.mi) + '左右';
  }
  /* ★ 震度 / 烈度 分流（用户要求）
       日本气象厅（JMA / JMA_EEW）+ 台湾中央气象署（TW / CWA）→ 【震度】（官方原版色卡，保留不动）
       其余（中国地震台网 / 各地预警 / USGS）→ 【烈度】（中国地震烈度表 Ⅰ–Ⅻ 色卡） */
  var SHINDO_SRC = /^(JMA|TW|CWA)/;
  function metricOf(q) {
    /* 设置页「使用实时烈度」关掉 → 全部按烈度卡显示（可见效果） */
    var VV = global.QVViews;
    if (VV && VV.metricAllLiedu && VV.metricAllLiedu()) return 'liedu';
    /* ★ 混合数据源后：等级可能来自任意一个源，按**等级的归属源**判色卡
       （data.js buildQ 已经算好 q.metric） */
    if (q && (q.metric === 'shindo' || q.metric === 'liedu')) return q.metric;
    return (q && SHINDO_SRC.test(String(q.source || ''))) ? 'shindo' : 'liedu';
  }
  /* ★★ 等级取值：**官方值优先，缺失就用 司・翠川(1999) 估算** ——
     KonTP（安卓版）就是这么兜底的，所以它每条地震都有等级；
     我们以前直接 -1 → 除日/中来源外全是「0 / 不明」（用户：「怎么全是零？怎么全是不知道？」）。
     估算值会被标上「推定」，不会被当成官方值。 */
  function estOf(q) {
    if (!q) return { I: NaN, shindo: -1, liedu: -1 };
    return (global.QData && global.QData.estimateRank)
      ? global.QData.estimateRank(q.mag, q.depthKm) : { I: NaN, shindo: -1, liedu: -1 };
  }
  /** 该地震的等级是不是「估算」出来的 */
  function isEst(q, m) {
    if (!q) return false;
    if (m === 'shindo') return !((q.maxShindo >= 0 ? q.maxShindo : q.shindo) >= 0);
    return !(isFinite(q.liedu) && q.liedu >= 1);
  }
  /** 该地震要显示的等级值：震度 0..70；烈度 1..12；无值 -1 */
  function metricVal(q, m) {
    if (!q) return -1;
    if (m === 'shindo') return shindoVal(q);
    if (isFinite(q.liedu) && q.liedu >= 1) return Math.round(q.liedu);
    var e = estOf(q).liedu;
    return e >= 1 ? e : -1;
  }
  /** 烈度：换主卡色块 + 大号阿拉伯数字（不动官方 paSc/paTm 素材本体） */
  function setLiedu(v) {
    var LIE = global.QV_LIEDU; if (!LIE) return;
    /* 不明 → 官方「不明」造型（#31476d 同画布底板 + 隐藏大号数字） */
    if (!(v >= 1)) { setUnknown(); return; }
    swapSrc('paSc1', LIE.blockSrc(v));
    swapSrc('snd1', LIE.numeralSrc(v));
    setSndTint(-1);        /* 烈度的字色已烘在 numeralSrc 里 → 清掉震度残留的 brightness */
  }
  /* ★ 官方色卡是【底色 + 字色】成对的，不是只有底色。
     逐个造型取色（官方 UI 精灵）得到震度的字色：
       震度0/1/5弱/5强/6弱/6强/7/不明 → #ffffff
       震度2/3/4（浅绿/浅黄/橙）      → #1c1c1c（官方 paTm2/3/4 就是深字）
     ⇒ 主卡大号数字由官方 snd* 造型自带（自动对）；但【主卡上那行「最大震度」】
       与【履历行小标签】是我们自己写的，必须自己按档给颜色。 */
  function shindoTextColor(v) {
    if (v == null || v < 0) return '#ffffff';
    var n = Math.round(v);
    return (n >= 2 && n <= 4) ? '#1c1c1c' : '#ffffff';
  }
  /* ⚠️ 官方字形表里【没有】年/月/日（只有 ㋀..㋋ 那种月份合体字），
     所以中文日期必须走中文层 #zh，不能再用 T.num（缺字会被跳过 → 变成 2026108）。 */
  var DT = { main: 17, row: 14 };
  function shindoVal(q) {
    if (!q) return -1;
    var v = (q.maxShindo >= 0 ? q.maxShindo : q.shindo);
    if (v >= 0) return v;
    var s = estOf(q).shindo;        /* 官方没给 → 估算（司・翠川 1999） */
    return s >= 0 ? s : -1;
  }

  /** ★★ 地图「行政区震度分布」（官方情报页地图上那一大片色块）
   *  数据：JMA 地震明细 JSON 的 Body.Intensity.Observation.Pref[].Area[].{Code,MaxInt}
   *  造型：官方 nc<区域码>（app/js/shindo-areas.js 已内联 188 个）
   *  按选中地震的明细文件缓存，避免每帧重拉。 */
  var lastAreaKey = '';
  var cnMode = false;             /* 当前地图色块是不是「中国自算」那一套 */
  /** ★★★ 2026-10-25：**色块当前到底是谁给的**（右上角提示用）
   *   · 'DM-D.S.S'    dmdata 付费电文（实测，只有连上中转且收到同场电报时才有）
   *   · '日本气象厅'  JMA 明细 JSON（VXSE5k / VXSE53 里那一份）
   *   · '本地推算'    模拟地震 / 中国 GMPE 自算
   *   卡片（地震信息）的来源不一定是它 —— 用户要的就是把两者并列显示。 */
  var lastAreaSrc = '';
  /** ★★★ 2026-10-25：**当前真正在用的那一场地震**（地图色块 / 数据源提示 / 明细都看它）
   *   ① 历史地震浏览（detailJson = 'hist:*'）→ 就是它自己
   *   ② 点过履历行的「在地图上显示」→ 那一条（QVHovPill.state().shown）
   *   ③ 否则主卡 q                                                            */
  function currentQuake(q) {
    if (!q) return q;
    if (String(q.detailJson || '').indexOf('hist:') === 0) return q;
    try {
      var shown = (global.QVHovPill && global.QVHovPill.state) ? QVHovPill.state().shown : null;
      if (shown) {
        var LL = (global.QData && global.QData.get ? (global.QData.get().list || []) : []);
        for (var li = 0; li < LL.length; li++) {
          if (String(LL[li].id) === String(shown)) return LL[li];
        }
      }
    } catch (e) { }
    return q;
  }
  /** feed → 简短的中文来源名（右上角提示用）
   *  ★★★ 2026-10-29 用户：「Wolfx 就 Wolfx，装什么 JMA」→ 再定：「改成 Wolfx+地区名」
   *    `eew_*` / `jmaeq` 全部是 **Wolfx 转发**的（api.wolfx.jp + ws-api.wolfx.jp），
   *    我们并没有直连気象庁的电文通道 —— 以前右上角写「日本气象厅 EEW」是装。
   *    现在统一「Wolfx·<频道地区>」，既能看出是哪个中转、又不会冒充官方。
   *    只有 `jma`（www.jma.go.jp/bosai/quake/data/list.json）是真·直连气象厅，保留原名。
   */
  function feedShort(q) {
    if (!q) return '';
    var f = String(q.mainFeed || q.feed || '');
    var M = {
      jma: '日本气象厅', jmaeq: 'Wolfx·日本', p2p: 'P2P 地震情報',
      cenc: '中国地震台网', usgs: 'USGS', emsc: 'EMSC', gdacs: 'GDACS',
      eew_jma: 'Wolfx·日本', eew_cwa: 'Wolfx·台湾', eew_cenc: 'Wolfx·中国',
      eew_sc: 'Wolfx·四川', eew_fj: 'Wolfx·福建', dmdata: 'DM-D.S.S'
    };
    if (M[f]) return M[f];
    var F = (global.QData && global.QData.feeds) ? global.QData.feeds[f] : null;
    if (F && F.cn) return String(F.cn).split('·')[0].trim();
    return String(q.mainSrc || f || '');
  }
  var _syncView = -1;
  function syncAreas(q) {
    if (!global.QVShindo || !global.QData || !global.QData.loadAreas) return;
    /* ★★★ 2026-10-29 用户：「地图不填色」
       —— 切页时地图图层会被重建（views.prepare / 各页 owner 切换），
          而下面的 lastAreaKey 去重会让「同一份色块」不再重铺 → 切过去就是空白地图。
          ⇒ 视图号一变就作废一次 cache，强制重铺。 */
    var _vNow = (global.QVViews && global.QVViews.view != null) ? global.QVViews.view : -1;
    if (_vNow !== _syncView) { _syncView = _vNow; lastAreaKey = ''; }
    /* ★★★ 2026-10-20 模拟地震优先：views.setEEW 会把 188 个区域的 GMPE 结果
       存到 V.eew.allAreas（含大片震度 7）。用户：「9 级以上陆地地震，
       一整个珠三角面积应该都是 7，你这玩意就两个测站」—— 以前这里只认真实明细 JSON，
       模拟地震没有明细 → 色块要么空、要么是上一场真实地震的，跟卡片完全不符。 */
    var simA = (global.QVViews && global.QVViews.eewAreas) ? global.QVViews.eewAreas() : null;
    /* ★★★ 2026-10-25 用户：「你完全没做地图色块随着地震的选择而刷新吗？
       怎么可能 4.8 级和 7.0 级的震度范围是一样的」
       —— 以前这里会**扫整个列表**（最多 8 条）去凑一个「带明细的」，
          于是不管你在看哪一场，地图永远画【列表里最新的那场日本地震】的色块
          （实测：主卡是 M4.8，地图却是 26 分钟前 M7.0 的 33 个区域）。
       ⇒ 色块只认「你正在看的那一场」，下面所有数据层（dmdata / 中国自算 / JMA 明细）统一用它：
          ① 历史地震浏览（detailJson = 'hist:*'）→ 就是它自己
          ② 点过履历行的「在地图上显示」→ 用那一条（QVHovPill.state().shown）
          ③ 否则用主卡 q
       这一场没有区域震度（海外 / 深源未满1 / 明细还没发）→ **清空**，
       宁可空着也不画别人的分布。 */
    var focusQ = q;
    if (q && String(q.detailJson || '').indexOf('hist:') === 0) {
      focusQ = q;                       /* 历史地震浏览：永远用它自己 */
    } else {
      try {
        var shown = (global.QVHovPill && global.QVHovPill.state) ? global.QVHovPill.state().shown : null;
        if (shown) {
          var LL = global.QData.get().list || [];
          for (var li = 0; li < LL.length; li++) {
            if (String(LL[li].id) === String(shown)) { focusQ = LL[li]; break; }
          }
        }
      } catch (e) { }
    }
    /* ★★★ 2026-10-25 官方实测优先（真实数据源地区震度的第一原则）：
       DM-D.S.S 的 VXSE51（震度速報）/ VXSE53（震源・震度）里的区域震度是
       **JMA 已观测的权威值**，必须压过本地 GMPE 推算。
       以前这里 simA 无条件 return —— 真实地震收到实测后，下一帧又被本地推算
       刷回去，于是「地图色块和官方电报对不上」。
       ⇒ 只有【这场地震没有实测覆盖】时才用本地推算（EEW 预测阶段本来就是推定值）。
       ⚠️ 必须先算 focusQ 再调 QVDmAreas —— 用未赋值的 focusQ 会永远判成「没实测」。 */
    var dmqEarly = (global.QVDmAreas)
      ? global.QVDmAreas(focusQ && focusQ.timeMs, focusQ && focusQ.lat, focusQ && focusQ.lon) : null;
    var hasRealAreas = !!(dmqEarly && dmqEarly.areas && dmqEarly.areas.length);
    if (simA && simA.length && !hasRealAreas) {
      lastAreaSrc = '本地推算';
      if (lastAreaKey !== ('sim:' + simA.length + ':' + simA[0].code + simA[0].shindo)) {
        lastAreaKey = 'sim:' + simA.length + ':' + simA[0].code + simA[0].shindo;
        global.QVShindo.set(simA);
      }
      return;
    }
    /* ★★ 2026-10-23 dmdata 付费电报（VXSE51/53）实测优先：
       刚收到的实测如果就是当前选中的这一场（±15 分钟），直接用它上色，
       不去拉 JMA 明细（那份要 3~5 分钟才更新，会把实时值盖回旧数据）。
       ★ 2026-10-25：dmqEarly 在 simA 之前已经取过（用来判断「实测是否已到位」），
         这里直接复用，避免每帧调两次。 */
    var dmq = dmqEarly;
    if (dmq && dmq.areas && dmq.areas.length) {
      var dk = 'dm:' + dmq.key;
      if (dk !== lastAreaKey) {
        lastAreaKey = dk;
        lastAreaSrc = 'DM-D.S.S';
        global.QVShindo.set(dmq.areas);
        /* ★★★ 2026-10-26 用户：「地图填色为什么全都被挡住了，模拟的时候都没被挡住」
           —— 这里以前无条件把「圆形观测点徽章」也塞进去（#mapstations z=8），
              它整片压在 #mapoverlay 的区域数字（z=7）之上 → 数字全被挡住。
              模拟那边 views.rebuildAreas 的正式报分支会先 clearStations()，
              所以模拟看得见、真实看不见。⇒ 真实电报走同一条规则：
                有区域标记（一区一标）→ 收起圆形徽章；没有才退回逐点。 */
        if (dmq.marks && dmq.marks.length) {
          if (global.QVMapCam && global.QVMapCam.clearStations) global.QVMapCam.clearStations();
          if (global.QVShindo.setStations) global.QVShindo.setStations([]);
          if (global.QVShindo.setPoints) global.QVShindo.setPoints(dmq.marks);
        } else if (dmq.points && dmq.points.length && global.QVShindo.setStations) {
          global.QVShindo.setStations(dmq.points);
        }
      }
      cnMode = false;
      return;
    }
    /* ★★★ 2026-10-21 中国大陆：JMA 明细 JSON 只有日本地震才有
       （CENC / USGS / EMSC 的 detailJson 恒为空）→ 中国地震永远走不到下面，
       Tab1 详情页零色块、零测站。用户原话：
         「api 没有区域震度的地图填色（中国大陆），我们都有这么多东西了」
       ⇒ 自己算：2791 个区县测站 → 司・翠川 GMPE + VS30 场地放大 → 连续烈度 I
                → 按**地级市**取最大值 → cn-areas.js 那 369 块轮廓填色。
       不再依赖任何远端数据，离线也能出图。
       ⚠️ 粒度只到地级市（用户：「我不要区的，市级别就这样吧」），不画区县边界。 */
    var _kindNow = (global.QVViews && global.QVViews.eew && global.QVViews.eew.kind) || '';
    var cn = (global.QVViews && global.QVViews.cnFill)
      ? global.QVViews.cnFill(focusQ, _kindNow) : null;
    if (cn && cn.areas && cn.areas.length) {
      var cnKey = 'cn:' + (cn.src || '') + ':' + ((focusQ && focusQ.id) || '') + ':' + (focusQ && focusQ.mag) + ':' + (focusQ && focusQ.depthKm) + ':' + (focusQ && focusQ.liedu) + ':' + (focusQ && focusQ.maxShindo);
      if (cnKey !== lastAreaKey) {
        lastAreaKey = cnKey;
        lastAreaSrc = '本地推算';
        if (global.QVMapCam && global.QVMapCam.setAreaFill) global.QVMapCam.setAreaFill(cn.areas);
        /* 等烈度线保持关闭（用户：「太丑了」）：mapcam 的 IDW 轮廓在网格外会拉出乱线。
           形状变形改在模型层做（断层距 JB + 地质分区 + Vs30）。 */
        if (global.QVMapCam && global.QVMapCam.setIsoPoints) global.QVMapCam.setIsoPoints(null);
        global.QVShindo.clear();
        if (global.QVShindo.clearPoints) global.QVShindo.clearPoints();
      }
      cnMode = true;
      return;
    }
    /* 切到非中国地震 → 把上一层中国自算的色块撤掉（只撤一次，逐帧清太浪费） */
    if (cnMode) {
      cnMode = false;
      if (global.QVMapCam) {
        if (global.QVMapCam.setAreaFill) global.QVMapCam.setAreaFill(null);
        if (global.QVMapCam.setIsoPoints) global.QVMapCam.setIsoPoints(null);
      }
    }
    /* ★★ 选中的那一项【不一定】带明细。我们的数据源是全球的 → 最新一条经常是海外地震
       （USGS/EMSC，没有 detailJson）→ 日本地图就永远上不了色
       （用户：「色块直接消失不见了」；实测不干预时 `#mapareas` 根本不存在）。
       官方没有这个问题：它只有日本数据，「最新」永远是日本地震。
       ⇒ 选中项没明细时，**回退到列表里最新的一条【带明细】的地震**（一般是最近的日本地震）。
       ★★ 2026-10-13 再修一层：主卡常常是【第三方源】赢下来的（P2P 震度2 vs JMA 同震），
       而「各区域震度明细」**只有 JMA 有** → 主卡自己没 detailJson、回退又扫到几天前那条
       → 今天 11:27 的熊本 M3.5 地图上一个色块都没有（实测 `#mapareas` = 0）。
       修法：先在同震候补 `q.alts`（里面就有 JMA 那条）里找带明细的成员，
            只把【明细文件】借给地图上色，卡片数字仍是主卡那一条（不跨机构混字段）。 */
    /* ★★★ 2026-10-25 用户：「你完全没做地图色块随着地震的选择而刷新吗？
       怎么可能 4.8 级和 7.0 级的震度范围是一样的」
       —— 以前这里会**扫整个列表**（最多 8 条）去凑一个「带明细的」，
          于是不管你在看哪一场，地图永远画【列表里最新的那场日本地震】的色块
          （实测：主卡是 M4.8，地图却是 26 分钟前 M7.0 的 33 个区域）。
       ⇒ 色块只认「你正在看的那一场」：
          ① 历史地震浏览（detailJson = 'hist:*'）→ 就是它自己
          ② 点过履历行的「在地图上显示」→ 用那一条（QVHovPill.state().shown）
          ③ 否则用主卡 q
          候补只取它【自己的同震同源条目】(alts)，绝不跨到别的地震。
       这一场没有区域震度（海外 / 深源未满1 / 明细还没发）→ **清空**，
       宁可空着也不画别人的分布。 */
    var cands = [], seenDj = {};
    function pushDj(x) { if (x && x.detailJson && !seenDj[x.detailJson]) { seenDj[x.detailJson] = 1; cands.push(x); } }
    /* ⚠️ 词条自己没明细时，它的同震候补（alts）里可能有一条 JMA 的 —— 一起收进来。
       （主卡常常是第三方源赢的：熊本 M3.5 主卡 = P2P，明细只在 alts 的 JMA 那条上。） */
    function pushItem(x) {
      pushDj(x);
      if (x && x.alts) for (var i = 0; i < x.alts.length; i++) pushDj(x.alts[i]);
    }
    /* ★★★ 2026-10-25：同一场地震在列表里常被拆成两条 —— 例「小笠原 M7.0」：
         · P2P 那条 **有坐标/震级**（履历行的「在地图上显示」点得到）
         · JMA 那条 **没有坐标**（药丸显示「等待接收」，点不了），但**只有它带明细**
       聚类判定要坐标/震级，缺一个就归不到同组 → alts 里也拿不到它
       → 点 P2P 那条时一个色块都画不出来。
       ⇒ 补一层「同场」匹配：时间 ±3 分钟（都有震级时再核 ≤1.2，都有坐标时再核 ≤150km）。 */
    function sameQuake(a, b) {
      if (!a || !b || a === b) return false;
      var ta = +a.timeMs || 0, tb = +b.timeMs || 0;
      if (!ta || !tb || Math.abs(ta - tb) > 3 * 60000) return false;
      var ma = +a.mag, mb = +b.mag;
      if (isFinite(ma) && isFinite(mb) && Math.abs(ma - mb) > 1.2) return false;
      if (isFinite(a.lat) && isFinite(a.lon) && isFinite(b.lat) && isFinite(b.lon)) {
        var dy = (a.lat - b.lat) * 111;
        var dx = (a.lon - b.lon) * 111 * Math.cos(a.lat * Math.PI / 180);
        if (Math.sqrt(dx * dx + dy * dy) > 150) return false;
      }
      return true;
    }
    pushItem(focusQ);
    (function sameEvent() {
      if (!focusQ) return;
      var LS = global.QData.get().list || [];
      for (var s = 0; s < LS.length && s < 60; s++) {
        if (sameQuake(focusQ, LS[s])) pushDj(LS[s]);
      }
    })();
    var key = cands.map(function (c) { return c.detailJson; }).join('|') || 'none';
    if (key === lastAreaKey) return;
    lastAreaKey = key;
    if (!cands.length) {
      /* ★★★ 2026-10-27 用户：「为什么直接不填色了」
         （实测：広島県南西部 M2.7 深20km 震度1，SREV 有一块蓝色，我们全空）
         这一场三个数据源全缺：
           ① 没有 EEW → V.eew = null（eewAreas 空）
           ② 没有 DM-D.S.S 实测 → QVDmAreas 空
           ③ P2P 与 wolfx-jmaeq 两条的 detailJson **都是空串** → 没有 JMA 区域明细
         ⇒ 以前这里直接 clear()：地图一块颜色都没有，只剩一个红叉。
         ⇒ 兜底：用【震中落在哪个 JMA 细分区域】+ 最大震度，至少把震中那一块涂上。
            有明细 / 有实测时根本走不到这里，大震的完整分布不受影响。
            （观测点名没有坐标、P2P 551 也不带区域码，所以只能以震中反推区域。） */
      var _epi = 0;
      try {
        _epi = (global.QVShindo.areaOf && focusQ && isFinite(focusQ.lat) && isFinite(focusQ.lon))
          ? QVShindo.areaOf(focusQ.lon, focusQ.lat) : 0;
      } catch (eEp) { _epi = 0; }
      var _ev = (+focusQ.maxShindo >= 1) ? +focusQ.maxShindo
        : ((+focusQ.shindo >= 1) ? +focusQ.shindo : 0);
      if (_epi && _ev >= 1 && metricOf(focusQ) === 'shindo') {
        lastAreaSrc = '震中区域';
        global.QVShindo.set([{ code: _epi, shindo: _ev }]);
        if (global.QVShindo.clearPoints) global.QVShindo.clearPoints();
        return;
      }
      lastAreaSrc = '';
      global.QVShindo.clear();
      if (global.QVShindo.clearPoints) global.QVShindo.clearPoints();
      return;
    }
    /* ★★ 観測点层（明细 JSON 第 3 层）：把色块从 188 个粗区域【填深】到上千个观测点。
       官方也画这层（自定义积木「[地図] 観測点検出描画」）。
       数据自带 latlon → 不需要边界图形，直接用 QVMapCam.at() 换成图集坐标。 */
    function drawPoints(src) {
      if (!global.QVShindo.setPoints || !global.QData.loadStations) return;
      global.QData.loadStations(src).then(function (pts) {
        if (key !== lastAreaKey) return;            /* 期间又切换了就别画 */
        /* ★ 2026-10-26：告诉标记图层当前是震度还是烈度（烈度要用自制方形徽章） */
        if (global.QVShindo.setMetric) global.QVShindo.setMetric(metricOf(focusQ));
        global.QVShindo.setPoints(areaMarks(pts));
        /* ★ 逐观测点那层也存进去：官方规则是「近景铺开逐点、远景收成一区一标」，
           由 shindo.js 按相机倍率自己选（见 updateView / wantMode）。 */
        if (global.QVShindo.setStations) global.QVShindo.setStations(pts);
      });
    }
    (function tryAt(i) {
      if (i >= cands.length) {                      /* 全试完都没有区域 → 才清空 */
        if (key === lastAreaKey) {
          lastAreaSrc = '';
          global.QVShindo.clear();
          if (global.QVShindo.clearPoints) global.QVShindo.clearPoints();
        }
        return;
      }
      global.QData.loadAreas(cands[i]).then(function (list) {
        if (key !== lastAreaKey) return;            /* 期间又切换了就别画 */
        if (!list || !list.length) return tryAt(i + 1);
        lastAreaSrc = '日本气象厅';
        global.QVShindo.set(list);
        drawPoints(cands[i]);
        /* ★ 明细里补回了震源坐标（条目本来没坐标）→ 重绘一次，红叉才会出现 */
        if (cands[i].hypFixed) setTimeout(function () { if (global.QVRedraw) global.QVRedraw(); }, 0);
      }).catch(function () { if (key === lastAreaKey) tryAt(i + 1); });
    })(0);
  }

  /** ★★ 观测点 → 【每个行政区一个】震度标
   *  用户要求（2026-10-11）：「人家每一个区域的震度都有小震度标来标识」
   *  「你这个切来切去的，一点都不整齐」→ 一个观测站一个标太碎，一屏上千个。
   *  做法：按 `p.area`（細分区域码）分组 → 标记放在该区域所有观测点的**重心**
   *        （重心一定落在陆地上，比形状框中心靠谱），强度取该区域最大值。
   *  反编译参考：官方 `d ten:*` 其实是 **1748 个观测站**（名字是「尾西」「小牧」「津島」…市町村名），
   *  颜色取自 `map:表示する震度[d ten:観測点所属区域[i]]`（198 个細分区域）→
   *  同一个区域的所有点颜色相同，所以看上去就是「一个区域一个震度」。
   *  我们直接收敛成「一区一标」，视觉更整齐，信息量等价。 */
  function areaMarks(pts) {
    var g = {}, out = [];
    (pts || []).forEach(function (p) {
      if (!p.area) return;
      (g[p.area] = g[p.area] || []).push(p);
    });
    for (var code in g) {
      var a = g[code], la = 0, lo = 0, v = -1, nm = '';
      for (var i = 0; i < a.length; i++) {
        la += a[i].lat; lo += a[i].lon;
        /* ★ 按【震度序号】比，不能比数值：本项目编码里 7(震度7) < 65(6強)，
           直接比数字会把震度7 丢掉、画成 6強 的标记。 */
        var rk = global.QVShindo.rankOf ? global.QVShindo.rankOf(a[i].v) : a[i].v;
        if (rk > (global.QVShindo.rankOf ? global.QVShindo.rankOf(v) : v)) {
          v = a[i].v; nm = a[i].areaName || a[i].name || '';
        }
      }
      out.push({ lat: la / a.length, lon: lo / a.length, v: v, area: code, n: a.length, name: nm });
    }
    return out;
  }

  /** 图形层里是 5 行快照：把超出实际行数的行底板/色条藏掉，
   *  否则会出现「有底板、无文字」的空行。
   *  ★★ 必须在 `if (!q)` 提前 return 之前也跑一次：layout.js 里 paTmag/paTdep 烘的是
   *     **纯红色占位**（靠 setBar 现场上色），没数据时不清理就会在履历区留下 5 组刺眼红条
   *     （审计实测：`手动 draw({list:[]})` 后仍是 block ×5）。 */
  function clearRows(n) {
    var bands = document.querySelectorAll('#art img[data-cos="paTmjs"]');
    for (var b = 0; b < bands.length; b++) bands[b].style.display = (b < n) ? '' : 'none';
    /* ★ 2026-10-11 修正：行卡（paTm 徽章）不在这里处理 —— 它们由 badge() 每次重绘
       动态建到 #txt 层。这里只把 [n, 槽位数) 的色条清干净（以前写死 6 → 第 7~9 行
       会残留上一场的彩色条）。 */
    for (var e = n; e < bands.length; e++) { setBar('paTmag', e, null); setBar('paTdep', e, null); }
  }

  /** 「推定」小标：贴在主卡色块的**左下角**（位置直接读官方 paSc1 的框，不写死坐标）
   *  ⚠️ 2026-10-10 起**不再调用**（用户：「我们自己私自加了『推定』两个字」）。
   *     保留函数本体，以后数据源补齐、要不要恢复再定。 */
  function drawEstTag(zh) {
    var el = document.querySelector('#art img[data-cos="paSc1"]');
    if (!el || !zh) return;
    var x = parseFloat(el.style.left) || 0, y = parseFloat(el.style.top) || 0;
    var h = parseFloat(el.style.height) || 120;
    var Z = global.QV_ZH || {};
    global.QVT.zh(zh, {
      text: Z.estimatedTag || '推定', x: Math.round(x + 14), y: Math.round(y + h - 17),
      size: 12, color: '#c2c9d4', align: 'left', weight: 500
    });
  }

  /** ★★★ 2026-10-29：真实 EEW / 正式报激活时，主卡优先使用 QData 里【同一场】的真实条目。
   *  不合成假 q（用户明确说：不要用模拟地震以外的插入方式显示地震素材）。
   *  背景：QData 列表会被更晚的地震顶到最前（回放的 EEW 还可能超过 30 分钟 TTL 被过滤），
   *  st.sel 就不是这场了 → 主卡/终报卡会拿别的地震去画 E，震度块空白。
   *  优先取非 EEW 的正式报行（maxShindo 已是终值）；没有才用同场 EEW 行；
   *  用户手动点过履历（QVHovPill.shown）时尊重用户选择。 */
  function activeCardQuake(st) {
    var VV = global.QVViews;
    var E = VV && VV.eew;
    var sel = st && st.sel;
    if (!E || !(E.mode === 'real' || E.measured) || E.fromHistory) return sel;
    var shown = null;
    try { shown = (global.QVHovPill && QVHovPill.state) ? QVHovPill.state().shown : null; } catch (eShQ) { }
    if (shown && sel && String(sel.id) === String(shown)) return sel;
    var list = (global.QData && QData.get) ? (QData.get().list || []) : [];
    var eid = String(E.eventId || (E.q && E.q.eventId) || '');
    var eew = null;
    for (var i = 0; i < list.length; i++) {
      var x = list[i]; if (!x) continue;
      var hit = false;
      if (eid && (String(x.eventId || '') === eid || String(x.id || '').indexOf(eid) >= 0)) hit = true;
      else if (E.timeMs && x.timeMs && Math.abs((x.timeMs || 0) - E.timeMs) <= 10 * 60000) {
        var ep = String(E.place || ''), xp = String(x.place || '');
        if (!ep || !xp || ep === xp || ep.indexOf(xp) >= 0 || xp.indexOf(ep) >= 0) hit = true;
      }
      if (!hit) continue;
      if (!x.isEew) return x;          /* 正式报行优先，震度是终值 */
      if (!eew) eew = x;
    }
    return eew || sel;
  }

  /* ---------------- 主绘制 ---------------- */
  R.draw = function (st) {
    var T = global.QVT, Z = global.QV_ZH || {};
    if (!T) return;
    var txt = T.host('txt'), zh = T.host('zh');
    var q = activeCardQuake(st), now = st.now || Date.now();

    /** 数值串；缺失时画「不明」——否则那一行的下半部看起来像「字不见了」
     *  ok=str 有效；align 语义与 T.num 一致（left/right 指基准边） */
    function stat(ok, str, size, X0, yy, align, dy) {
      dy = dy || 0;
      if (ok) return T.num(txt, str, size, SW / 2 + X0, SH / 2 - yy + dy, align);
      var s = Math.max(12, Math.round(size * 0.2));
      return T.zh(zh, { text: Z.unknown || '不明', size: s, color: '#c2c9d4',
        align: align === 'right' ? 'right' : 'left',
        x: SW / 2 + X0, y: Math.round(SH / 2 - yy + dy - s / 2) });
    }
    /** ★★★ 2026-10-27 用户（图二）：「官方显示的是极浅地震，我们写了个假的 0km」
     *  JMA 的 0km **不是**「深度 0 公里」，而是「ごく浅い」＝ 浅到无法定值（经验上 < 10km）。
     *  ⇒ 0 → 数字位改画中文「极浅」；真的没有深度 → 留空（不明），绝不拿 0 冒充。
     *  其余照旧：数字 + 'k'（官方 sjk 造型本身就是 "km" 连字）。 */
    function statDep(d, size, X0, yy, align, dy) {
      dy = dy || 0;
      if (isFinite(d) && d >= 0 && d < 1) {
        var s2 = Math.max(13, Math.round(size * 0.4));
        /* ★ 2026-10-27 用户微调：上移 0.15 → 往下 0.03 ⇒ -0.12 */
        return T.zh(zh, { text: Z.veryShallow || '极浅', size: s2, color: '#fff',
          align: align === 'right' ? 'right' : 'left',
          x: SW / 2 + X0, y: Math.round(SH / 2 - yy + dy - s2 / 2 - s2 * 0.12) });
      }
      return stat(isFinite(d) && d >= 0, (isFinite(d) && d >= 1) ? (Math.round(d) + 'k') : '',
        size, X0, yy, align, dy);
    }

    /* 顶部时刻（等宽步进，对齐官方） */
    if (!global.ZQ_NO_OFFICIAL_CLOCK) {
    var c = S.clock;
    /* ★ 2026-10-26 自定义时间模拟：时钟跟着自定义时刻走（基准 + 已过时间） */
    var clockMs = now;
    if (global.QVViews && global.QVViews.simTimeBase) {
      clockMs = global.QVViews.simTimeBase +
        Math.max(0, now - (global.QVViews.simTimeStart || now));
    }
    T.num(txt, clockText(clockMs), c.size, SW / 2 + c.X0, SH / 2 - c.y, 'left', S.clockPitch);
    /* 时钟右侧「更新」二字 —— 官方原始素材 timebg0 里**烘焙着这两个字形**，
       清洗面板日文时被当文字删掉 → 自己画。位置直接量自原始素材：
         timebg0 画布 252x38 @ 舞台 (290,11)
         「更」lx 213.45 ty 14.78 13.13x12.82 ；「新」lx 227.11 ty 14.20 13.49x13.44
       → 舞台：左缘 503.45、字高 ≈13.4、墨迹垂直中心 ≈31.9
       （旧代码写 size19 / y=20.5 → 又大又偏上 4.6px，就是用户看到的「偏离」） */
    T.zh(zh, { text: Z.updated || '更新', x: 503.45, y: 31.9 - (Z.updatedSize || 13.5) / 2,
      size: (Z.updatedSize || 13.5), color: '#c6d0de', align: 'left' });
    }

    /* ★★ 主视图路由（views.js）：0 地震信息 / 1 调试 / 2 海啸 / 3 设置
       ⚠️ 非情报视图【不隐藏地图】（用户要求：切换四个视图时地图不应该变化），
          只隐藏侧栏那套面板；顶栏图标/地图按钮在 #chrome 里，永不被遮。 */
    if (global.QVViews) {
      global.QVViews.prepare(st);
      if (global.QVViews.view !== 0) {
        /* ★★★ 2026-10-29 用户：「地图不填色」
           —— 实时页（Tab2）以前在这里直接 return：`syncAreas()` 只在情报页（view 0）跑，
              于是 Tab2 的地图**永远没有区域填色**，只剩测站圆点和震中红叉。
              实测（千葉県北東部 M5.8 终报）：`QVViews.eewAreas()` 返回 47 个区域，
              但 `#mapareas` 子节点数 = 0，地图一片空白。
           ⇒ 非情报页也同步一次色块（函数内部有 lastAreaKey 去重，每帧无开销）。 */
        /* syncAreas 内部靠 lastAreaKey 去重（每帧 set 会重排 DOM）。
           但切页时 views.prepare() 会把 #mapareas 清空 → key 没变就不会重铺
           → 实时页地图永远空白。这里发现图层是空的就作废 cache，强制重铺一次。 */
        var _ma2 = null;
        try { _ma2 = document.getElementById('mapareas'); } catch (eMA) { }
        if (_ma2 && !_ma2.children.length) lastAreaKey = '';
        try { syncAreas(q); } catch (eSA) { }
        /* ★★★ 2026-10-29 兜底：实时页的色块必须真的画出来。
           `syncAreas` 内部有多层分支与缓存（DM 实测 / JMA 明细 / 中国自算），
           实测在 Tab2 会卡成「eewAreas 有 51 个区域、#mapareas 里只有 1 个」的僵局。
           ⇒ 直接对照 DOM 里的 path 数（每区 = 白线 + 填色 两条），缺了就用 eewAreas 重铺。 */
        try {
          var _ea2 = (global.QVViews && QVViews.eewAreas) ? QVViews.eewAreas() : null;
          var _hm2 = document.getElementById('mapareas');
          var _sv2 = _hm2 ? _hm2.querySelector('svg') : null;
          var _np2 = _sv2 ? _sv2.querySelectorAll('path').length : 0;
          if (_ea2 && _ea2.length && _np2 < _ea2.length * 2) {
            /* ★ 2026-10-29：区域码缺失时 path 数永远到不了 2×区域数（实测 18 区只有 26 条），
               以前每帧都 set 一次。把实际 path 数也放进指纹，只重铺一次。 */
            var _fbKey = 'tab2:' + _ea2.length + ':' + _ea2[0].code + ':' + _ea2[0].shindo + ':' + _np2;
            if (lastAreaKey !== _fbKey) {
              global.QVShindo.set(_ea2);
              lastAreaKey = _fbKey;
            }
          }
        } catch (eFB) { }
        try { drawSourceTag(); } catch (eST) { }
        global.QVViews.render(txt, zh, st);
        return;
      }
    }
    drawSourceTag();
    /* ★★★ 2026-10-25 用户：画面右上角显示**当前两个数据源的名称**（不带前后缀），
       字号与顶部时钟那串时间数字一致、同一行基线，仍然靠右。
       · 第一段 = 大卡片（地震信息）的来源
       · 第二段 = 地图色块的来源（DM-D.S.S / 日本气象厅 / 本地推算），重复则省略
       例：`P2P 地震情報 + DM-D.S.S` */
    /* ★★★ 2026-10-25 用户：画面右上角显示**当前两个数据源的名称**（不带前后缀），
       字号与顶部时钟那串时间数字一致、同一行基线，仍然靠右。
       · 第一段 = 大卡片（地震信息）的来源
       · 第二段 = 地图色块的来源（DM-D.S.S / 日本气象厅 / 本地推算），重复则省略
       例：`P2P 地震情報 + DM-D.S.S`
       ★ 模拟中 → 整行换成「模拟数据」+ 下一行「预计 X 秒后进入下一个阶段」。 */
    function drawSourceTag() {
      var VV = global.QVViews;
      var isSim = !!(VV && VV.simOn);
      var parts = [];
      if (isSim) {
        /* ★★★ 2026-10-25 用户：「平常那里显示的是数据源，模拟地震的时候
           就把数据源换成『模拟数据』四个字就行了」—— 不再额外挂「模拟画面」徽标。 */
        parts.push('模拟数据');
      } else {
        /* 右上角数据源跟“当前真正在画的那张卡”走，而不是 st.sel（列表可能已被别的地震顶掉） */
        var fq = activeCardQuake(st);
        var card = feedShort(fq);
        if (card) parts.push(card);
        if (lastAreaSrc && lastAreaSrc !== card && parts.indexOf(lastAreaSrc) < 0) parts.push(lastAreaSrc);
      }
      if (!parts.length) return;
      /* 时钟：T.num(clockText, size=60, cy = SH/2 - 330 → 30)。官方字形墨迹高 ≈ 时钟 size 的 1/3
         ⇒ 中文用 18px 视觉高度最接近（13.5 明显偏小，用户：「改成和时间数字一样大」）。
         右边距 = 顶部留白（文字顶部 21px），用户：「右侧空隙要和上面的空隙一样大」。 */
      var TSIZE = 18, TCY = SH / 2 - 330;              /* = 30 */
      var TGAP = Math.round(TCY - TSIZE / 2);           /* = 21：顶部留白，同时用作右边距 */
      /* ★★★ 2026-10-25 用户：「右上角的文字都不是自适应位置的，我换个比例就废了，跑中间了」
         —— 舞台逻辑宽会被 app.js 的 layout() 拉大到 ≥960（比如 1600×720 的窗口 → 1600），
            而这里一直写死 `SW - TGAP`（= 939）→ 宽屏下右对齐的文字就落在**画面中间**。
         ⇒ 用 #stage 的真实逻辑宽（offsetWidth 不吃 transform），每次画的时候现量。 */
      var _stEl = null;
      try { _stEl = document.getElementById('stage'); } catch (eStg) { }
      var SWv = (_stEl && _stEl.offsetWidth) || SW;
      T.zh(zh, { text: parts.join(' + '), x: SWv - TGAP, y: TGAP,
        size: TSIZE, color: '#c6d0de', align: 'right' });
      /* ★★★ 2026-10-25 用户：「模拟数据加多一个文本，就叫『预计 X 秒后进入下一个阶段』」
         —— 模拟全程都在倒计时；到最后一个阶段（或已取消）时 simEtaMs = 0 → 不画。 */
      if (isSim) {
        var eta = +VV.simEtaMs || 0;
        var left = eta ? Math.max(0, Math.ceil((eta - Date.now()) / 1000)) : -1;
        if (left > 0) {
          T.zh(zh, { text: '预计 ' + left + ' 秒后进入下一个阶段', x: SWv - TGAP,
            y: TGAP + TSIZE + 6, size: 13.5, color: '#8ea3b8', align: 'right' });
        } else if (left === 0) {
          /* ★★★ 2026-10-25 用户：「什么叫预计 0 秒后进入下一阶段」
             —— 到点后真正的许可还要等波前门槛 / 报文循环，可能再挂几十秒，
                显示「预计 0 秒」看上去像卡死。⇒ 到点后改说「即将进入下一个阶段」。 */
          T.zh(zh, { text: '即将进入下一个阶段', x: SWv - TGAP,
            y: TGAP + TSIZE + 6, size: 13.5, color: '#8ea3b8', align: 'right' });
        }
      }
    }

    /* 面板标题（中文）——官方 paIti3 标题文字墨迹框：x75.1 起、垂直中心 24.1
       ★ 2026-10-21：烈度源（中国/美国…）不能还写「各地震度信息」—— 两套刻度不同名
       ★ 2026-10-21 用户：「唯一的不同就是标题栏不同而已」
         紧急地震速报走完「震度速報·調査中」后会进 jishin 阶段（V.eew.kind === 'jishin'），
         这时卡片本体完全不变，**只把标题换成「震度速報」**。 */
    var _eV = (global.QVViews && global.QVViews.eew) ? global.QVViews.eew : null;
    var titleTxt = (_eV && (_eV.inq || _eV.kind === 'jishin' || _eV.kind === 'info')) ? '震度速報'
      /* ★ 2026-11-02 正式报（VXSE53 之后）：标题要换成「各地震度信息 / 各地烈度信息」。
         ⚠ 必须放在 q.isEew 前面 —— final 阶段 q.isEew 仍然是 true，
         否则会掉到下面的分支变成「紧急地震速报」（用户看到的「标题出不来」）。 */
      : ((_eV && _eV.kind === 'final')
        ? ((q && metricOf(q) === 'liedu') ? (Z.tabInfoLiedu || '各地烈度信息') : (Z.tabInfo || '各地震度信息'))
        : ((q && q.isEew) ? ((metricOf(q) === 'liedu') ? (Z.eewLiedu || '中国地震预警') : (Z.eew || '紧急地震速报'))
          : ((q && metricOf(q) === 'liedu') ? (Z.tabInfoLiedu || '各地烈度信息') : (Z.tabInfo || '各地震度信息'))));
    /* ★ 正式报卡（overlay 里重画）时**不再**在 #zh 层画标题，
       否则会与新卡标题重叠成两段字（用户指出的「标题重叠了两段文字」）。
       ★★★ 2026-10-27：只有报文**真带**長周期地震動階級时才切 overlay 大卡（E.maxLg ≥ 0）；
       否则 _fin = false → 普通主卡 paIbg180（264×394）完整显示
       （标题/震度块/时刻/震源名/发生了地震/震级+条/深度+条/津波胶囊它本来就全有）。 */
    var _hasLg = !!(_eV && _eV.maxLg != null && _eV.maxLg >= 0);
    var _fin = !!(_eV && _eV.kind === 'final' && _hasLg);
    /* ★ 2026-10-26 用户：「震源速报的卡片的标题不居中」
       L.title.x = 75.1 是**官方 7 字日文（各地の震度情報）的墨迹左缘**；
       我们的标题只有 4 字（「震度速報」= 4×16 = 64px），左对齐到 75.1
       → 整组比标题条中心（120）偏左 13px。
       ⇒ 改成【以标题条中心 120 居中】，4 字 / 6 字 / 7 字都自动居中。 */
    if (!_fin) {
      T.zh(zh, {
        text: titleTxt, size: L.title.size, align: 'center', x: 120,
        y: Math.round(L.title.cy - L.title.size / 2), color: '#fff', weight: 500
      });
    }

    /* ★★ 2026-10-23 正式报（VXSE53 之后）：换成官方「各地の震度情報」专用卡
       （震度块缩小 + 多一条长周期阶級 + 其余上移，见 drawFinalCard 的实测表）
       ⚠️ 隐藏普通卡精灵的活必须放到【draw 结尾】—— setShindo()/setBar() 中途会把
          display 改回 ''，在开头藏了没用（踩过：大色块和两根旧色条压在新卡上）。 */
    var _fin = !!(_eV && _eV.kind === 'final' && _hasLg);
    /* ★★ 正式报卡只在 view 0（地震情报页）显示：
       type2/3/4 页面或新模拟地震（kind != final）时必须收起，
       否则这张 overlay 卡会盖在其它页面上（用户：“type2/3/4 为什么还有这张卡”）。 */
    FIN_ON = _fin && (global.QVRender ? QVRender.view === 0 : true);
    /* ★★★ 2026-10-26 用户定的规则：「正式报地图填色只能是方的，这时候测站该隐藏了」
       —— 以前只靠 rebuildAreas 的某个分支去 clearStations，模拟/切页时偶尔漏掉
          → 地图上圆形测站和方形区域数字同屏。这里在【进入正式报的那一下】强制收一次。 */
    if (FIN_ON && !FIN._wasOn) {
      if (global.QVMapCam && QVMapCam.clearStations) QVMapCam.clearStations();
      if (global.QVShindo && global.QVShindo.setMarksHidden) global.QVShindo.setMarksHidden(false);
    }
    FIN._wasOn = FIN_ON;
    if (!FIN_ON) hideFinalCard();
    /* 调查中（Tab1）：底层普通卡精灵收起，交给 #inqbox 的官方 paIbg130 卡 */
    INQ_ON = !!(_eV && _eV.inq && (global.QVRender ? QVRender.view === 0 : true));

    /* 一条数据都没有 → 官方「不明」底板 + 「不明」大字（不要拿 0 冒充数据）
       ⚠️ 这里必须先把履历区的快照行清理掉再 return（否则留下 5 组纯红色条）
       ⚠️ 主卡的两根色阶条也要藏（否则「不明」卡片上飘着上一场的绿/红色条）——
         实测空态截图：卡右中位置残留一根黄绿 + 一根红色小条。 */
    if (!q) {
      setUnknown(true); drawUnknownBig(zh); clearRows(0);
      setBar('paImag', 0, null); setBar('paIdep', 0, null);
      hideFinalCard();
      return;
    }

    /* ★ 震中标记：官方分两种（「震源スタンプEEW」）
         速报(EEW)预想震源 = epc00 实心红叉
         正式报震源        = epc01 半透明红叉（GHOST 50）
       速报之后同一事件又出了正式报时，两个位置【同时】标出来。 */
    if (global.QVMapCam && global.QVMapCam.setPins) {
      /* ★★ 2026-10-11（第十五轮）用户：「默认打开竟然不显示最新的那个红叉」——
         JMA 的 xml 源没有经纬度（lat/lon = NaN），红叉不能直接用 q 的坐标；
         相机走的是 mapTarget（借孪生条目的坐标）→ 红叉也必须用同一坐标源，
         否则相机飞到了、红叉却在 setPins 里被 isFinite 检查丢弃。 */
      var tg = (q.lat != null && q.lon != null && isFinite(+q.lat) && isFinite(+q.lon)) ? q
        : (global.QVMapTarget ? global.QVMapTarget(q, st.list || []) : q);
      var pins = [{ lat: tg.lat, lon: tg.lon, kind: q.isEew ? 'eew' : 'normal' }];
      if (q.isEew) {
        var L2 = st.list || [];
        for (var pi = 0; pi < L2.length; pi++) {
          var o = L2[pi];
          if (!o || o.isEew || o.lat == null || o.lon == null || !isFinite(+o.lat) || !isFinite(+o.lon)) continue;
          if (Math.abs(o.timeMs - q.timeMs) <= 20 * 60000 &&
            Math.abs(o.lat - q.lat) < 3 && Math.abs(o.lon - q.lon) < 3) {
            pins.push({ lat: o.lat, lon: o.lon, kind: 'eewFinal' });
            break;
          }
        }
      }
      var pm = (global.QVViews && global.QVViews.pinMode) ? global.QVViews.pinMode() : 0;
      if (pm === 3) pins = [];
      else if (pm === 1) pins = pins.filter(function (p) { return p.kind !== 'normal'; });
      else if (pm === 2) pins = pins.filter(function (p) { return p.kind !== 'eew'; });
      if (global.QVViews && global.QVViews.showShindo0 && !global.QVViews.showShindo0()
        && shindoVal(q) === 0) pins = [];
      global.QVMapCam.setPins(pins);
    }

    /* ★ 震度 or 烈度（按数据源）：日本气象厅 / 台湾中央气象署 = 震度；其余 = 烈度
       ⚠️⚠️ 标签必须**永远跟着 metric 走**，任何设置项都不许改它。
          以前这里被「震度等级换算」覆盖过：烈度卡的**值和色卡**仍是烈度，
          但标签被换成「最大震度」→ 同一张卡片上两个不同概念混用。
          user: 「明明是烈度的地震有时候显示的是震度，这是完全不同的概念来的啊！！！」 */
    var metric = metricOf(q);
    var mLab = (metric === 'liedu') ? (Z.maxLiedu || '最大烈度') : (Z.maxShindo || '最大震度');

    /* 大号等级：换造型 —— 震度走官方 paSc/snd 变体；烈度换成本档色块 + 阿拉伯数字 */
    var mV = (metric === 'shindo') ? shindoVal(q) : metricVal(q, 'liedu');
    /* ★ 2026-10-10 用户要求：**把「推定」两个字去掉** —— 官方没有这个东西，
       是我们自己加的小标签。估算本身留着（否则 USGS/CENC 条目又变回「全是 0 / 不明」，
       用户早就骂过），只是不再往卡片上写字。drawEstTag 函数保留备用（以后源齐了再定）。
       user: 「我们自己私自加了『推定』两个字」 */
    if (metric === 'shindo') setShindo(mV); else setLiedu(mV);
    /* ★★ 没有任何震度/烈度（USGS / CENC 大多数条目）时：
       ① 设置「显示震度 0 的图标」= 开（默认）→ 画官方震度0（灰底 + 大号 0），不留空；
       ② 关 → 官方原样是「不明」底板 + **大号数字位不画**（一块空白，用户骂过）
             → 这里在原「大号数字」的位置写「不明」，尺寸/位置直接读官方 snd1 的框。 */
    if ((metric === 'shindo' ? !(mV >= 0) : !(mV >= 1)) && !showShindo0()) drawUnknownBig(zh);
    /* 主卡两根色阶条：按数值上色（官方色阶） */
    setBar('paImag', 0, magColor(q.mag));
    setBar('paIdep', 0, depColor(q.depthKm));
    /* 「最大震度 / 最大烈度」小标（中文）—— 官方 paSs 墨迹框：x39.4 起、4字 23.1/字、中心 y97.7
       ★★ 官方色卡是【底色 + 字色】成对的：官方积木用 Scratch BRIGHTNESS 把烘焙的白字
          调成 `d #震度配色(文字)[档位]`（实测 = [ff,ff,1c,1c,1c,ff,…] → 震度 2/3/4 是深字）。
          以前主卡这行写死 '#fff' → 震度 2（亮绿底）上白字看不清、与原版不符
          （用户：“最新的大卡片的黑色字体没搞”）。
       ⚠️ 正式报卡自己按官方位置重画（drawFinalCard），这里跳过。
       ★ 2026-10-26 用户：「在这个卡片的背景里面多了个『最大震度』的文字」
         —— 调查中（INQ_ON）时履历整块上提 −103，这个标签原本在 y87 会被顶到 y−16，
            露出下半截在舞台顶端（卡面上方）→ 这个阶段整条不画（卡里 paSs 自带的才是官方的）。 */
    if (!_fin && !INQ_ON) {
      lab(T, zh, L.maxShindo, mLab,
        {
          color: metric === 'liedu'
            ? (global.QV_LIEDU ? global.QV_LIEDU.textOf(metricVal(q, 'liedu')) : '#fff')
            : shindoTextColor(shindoVal(q))
        });
    }

    /* 発生時刻：官方原版格式「10月7日 16:03左右」
       用官方字形拼（月=m / 日=d 官方都有），「左右」走中文层补字（见 texts.js num */
    if (!_fin) {
      T.num(txt, mdTime(q.timeMs), S.originTime.size, SW / 2 + S.originTime.X0, SH / 2 - S.originTime.y, 'left');
    }

    /* 震源地（官方 nm 零件；不翻译）
       ★ 尺寸走官方公式 min(120, 2000/计数)：地名越长缩得越小 → 右缘固定在面板内
         （官方实测 熊本県天草・芦北地方 = 105.26%）；以前写死 120% → 长地名顶到边框外。 */
    if (!_fin) {
    if (!T.place(txt, q.place, T.placeSize(q.place, S.place.size), SW / 2 + S.place.X0, SH / 2 - S.place.y, 'left')) {
      T.zh(zh, { text: q.place || (Z.unknown || '不明'), x: 24, y: 172, size: 19,
        color: '#fff', align: 'left', weight: 500, maxW: 212, minSize: 13 });
    }
    }

    /* ★ 「发生了地震」那一行 —— 官方实测（vm.runtime.targets @960x720 + 官方截图逐像素）：
         deji 造型画布 256x24、rotationCenter 居中(128)，墨迹在画布 x128.8..246
         ⇒ 精灵 x 就是【文字墨迹的左缘】；官方把这个精灵 x 对到地名画布左缘（-458）
         ⇒ 舞台 x ≈ 22（和地名的左缘齐），**不是右对齐**。
       实例：`diag/OFFICIAL-live-960.png` 里「で地震がありました」= 19.2..141.6，
             与地名「奄美大島北東沖」完全同一个左缘。
       旧代码按“右缘固定 150”右对齐 → 短的中文被推到 65..150，看着像居中缩进。 */
    if (!_fin) {
      T.zh(zh, { text: Z.quakeHappened || '发生了地震', size: 17, color: '#fff',
        align: 'left', x: SW / 2 + S.place.X0, y: Math.round(208 - 17 / 2) });
    }

    /* 震级 / 深度：中文标签 + 官方数字（官方这两个字段是【右对齐】，右缘 -290）
       ⚠️ 正式报卡自画，这里整段跳过
       ⚠️ 调查中（INQ_ON）也整段跳过：paIbg130 卡面只到 stage y269，而「深度」标签在
          y279..294 → 会从卡下面露出来（实测截图：卡下方飘着「深度 40km」）。 */
    if (!_fin && !INQ_ON) {
      lab(T, zh, L.mag, Z.magnitude || '震级', { color: '#c2c9d4' });
      stat(isFinite(q.mag) && q.mag > 0, (isFinite(q.mag) && q.mag > 0) ? q.mag.toFixed(1) : '',
        S.magVal.size, S.magVal.X0, S.magVal.y, S.magVal.align);
      lab(T, zh, L.dep, Z.depth || '深度', { color: '#c2c9d4' });
      /* ⚠️ 深度单位用 'k'：官方造型 sjk 本身就是 "km" 连字（实测截图确认），
         写 'km' 会变成 "km"+sj m(=月) → 渲染成 "60km月" */
      statDep(q.depthKm, S.depVal.size, S.depVal.X0, S.depVal.y, S.depVal.align);
    } else {
      /* 正式报（各地の震度情報）：按官方实拍图重画整张卡
         ⚠️ 只在 FIN_ON（view 0）时画 —— drawFinalCard 会把 host display 置回 ''，
            非情报页如果照画又会把卡露出来（用户：「type2/3/4 为什么还有这张卡」）。 */
      if (FIN_ON) drawFinalCard(T, zh, q, _eV);
    }

    /* ★★ 海啸条 = 官方「津波警報・注意報」胶囊（paIts* 一共 8 种，逐色逐版）
     * 官方真身（2026-10-12 把【未清洗原版】素材放大逐张读出来的，不是猜的）：
     *   0  津波の心配なし      深蓝 #31476d
     *   1  津波 不明           灰   #63636e
     *   2  津波 調査中         灰   #63636e
     *   30 若干の海面変動      深蓝
     *   31 若干の海面変動      亮蓝 #458eb2
     *   40 津波警報・注意報    深蓝
     *   41 津波警報・注意報    黄   #e4e600（这一版官方字色是【深色】）
     *   42 津波警報・注意報    红   #e10000
     * 官方积木：`穿造型("paIts"⊕6-2タブ表示内容[9])`（diag/decomp-bar.txt:691）。
     * 我们这边 q.tsunami 0/1/2/3 = 无 / 注意报 / 警报 / 大津波警报
     *   → 对上 0 / 41 / 42 / 42（官方素材里【没有】紫版「大津波」胶囊，
     *     卡片这一行官方统一是「津波警報・注意報」，靠颜色分等级 → 警报以上用红）
     * ⚠️ 素材里日文是烘死的位图 → 中文照旧走中文层叠上去，别删文字层。 */
    /* ★★ 2026-10-15 用官方「津波の心配文」6 档（JMA/P2P 系报文带 q.tsuKind）——
       0 心配なし / 1 不明 / 2 調査中 / 3 若干の海面変動 / 4 津波注意報 / 5 津波警報
       ⚠️ 这是【逐报状态】：JMA 解除后下一报就变回 None → 卡片自己回到「无海啸威胁」
          （旧版只看 q.tsunami，USGS 打上 1 就永久挂着注意报）。 */
    /* ★★★ 2026-10-22 用户：「这个卡片没改过（还是无海啸威胁）」——
       主卡海啸条原来只读【这场地震自己】的 q.tsuKind / q.tsunami，
       而模拟海啸走的是 QData.simTsunami()（只更新了海啸页那一套），
       → 海啸页已经有多报，主卡还停在「无海啸威胁」。
       ⇒ 模拟地震（q.sim）且当前有海啸情报时，按最高等级把海啸条同步到卡片上。 */
    var _TSU = (global.QData && global.QData.tsunami) ? global.QData.tsunami() : null;
    if (q && q.sim) {
      if (_TSU && _TSU.items && _TSU.items.length) {
        var _tlv = _TSU.maxLv | 0;
        q.tsuKind = _tlv >= 3 ? 5 : 4;                 /* 5=津波警報 / 4=津波注意報 */
        q.tsunami = _tlv >= 4 ? 3 : (_tlv === 3 ? 2 : 1);
        q.tsuMajor = _tlv >= 4;
      } else if (q.tsuKind != null) {
        /* 海啸被撤掉（清除模拟 / 误报）→ 卡片要降回去，不能一直挂着上一场的警报 */
        q.tsuKind = 0; q.tsunami = 0; q.tsuMajor = false;
      }
    }
    var ts, tsuSuf;
    if (q.tsuKind != null && q.tsuKind >= 0) {
      var k6 = Math.min(5, q.tsuKind | 0);
      tsuSuf = ['0', '1', '2', '30', '41', '42'][k6];
      ts = k6 === 5 ? ((q.tsuMajor ? Z.tsunamiMajor : Z.tsunamiWarn) || '海啸警报')
        : k6 === 4 ? (Z.tsunamiWatch || '海啸注意报')
          : k6 === 3 ? (Z.tsunamiSlight || '海面轻微变动')
            : k6 === 2 ? (Z.tsunamiChecking || '海啸状况调查中')
              : k6 === 1 ? (Z.tsunamiUnknown || '海啸状况不明')
                : (Z.tsunamiNone || '无海啸威胁');
    } else {
      tsuSuf = q.tsunami >= 2 ? '42' : q.tsunami === 1 ? '41' : '0';
      ts = q.tsunami >= 3 ? (Z.tsunamiMajor || '大海啸警报')
        : q.tsunami === 2 ? (Z.tsunamiWarn || '海啸警报')
          : q.tsunami === 1 ? (Z.tsunamiWatch || '海啸注意报')
            : (Z.tsunamiNone || '无海啸威胁');
    }
    setTsuBar(tsuSuf);
    /* 黄底胶囊（41）上用深色字 —— 同官方「底色↔字色成对」规则（震度 2/3/4 也是深字）
       ⚠️ 正式报卡自己画胶囊（位置不同），这里跳过
       ⚠️⚠️ 2026-10-23 回退：曾给「震度速報・調査中」阶段加过「胶囊上提」，
          用户明确说那张卡以前是好的 → 这里恢复原样，任何阶段都不动胶囊位置。 */
    /* ★ 2026-10-26 调查中（Tab1）：底层普通卡的精灵已收起，
       它那条海啸标签（L.tsunami cy=336）正好落在 paIbg130 卡面下缘（画布 y281）之外，
       会在调查中卡下方露出一行「无海啸威胁」→ 这个阶段不画（官方卡自带「津波 調査中」）。 */
    if (!_fin && !INQ_ON) lab(T, zh, L.tsunami, ts, { color: tsuSuf === '41' ? '#1d1f24' : '#fff' });

    /* 履历标题（官方 paTbg0「地震履歴」墨迹框：x88 起、中心 y393.1）
       ⚠️ 官方【没有】「N 条」这种计数 → 不要自己加（用户：「原版都没这东西」）
       ⚠️⚠️ 这里**不能**再加 FIN.hshift —— #zh 的文字已经被 app.js 的 applyScroll()
          按 cardExtra() 整体平移过一次，再加一次就是双重下移（实测标题跑到 533，
          底板顶才 432 → 履历整体“沉”到很下面，看着像接缝没对齐）。 */
    /* ★★★ 2026-10-26 用户（截图）：「底下的黑色背景出来了，因为地震历史都被 ban 了」
       —— 履历被清空（自定义时间模拟 / 历史地震模板）时，标题还写着「地震历史」
          下面却是空的 → 连标题一起不画（底板由 app.js fitBg 同步收掉）。 */
    var _histN = 0;
    (st.list || []).forEach(function (x) { if (!q || x.id !== q.id) _histN++; });
    if (_histN > 0) lab(T, zh, L.hist, Z.hist || '地震历史', { weight: 500 });

    /* ★ 地图行政区震度分布（跟着选中的地震，按需拉 JMA 明细） */
    syncAreas(q);

    /* ★ 声音・朗读：选中地震变化时播报一次（audio.js 自带去重） */
    if (global.QVSpeak && global.QVSpeak.announce) global.QVSpeak.announce(q, null);

    /* 履历行数
     * ★★ 2026-10-10 实测官方 VM（不是猜的）：
     *    `5地震情報リスト` 600 = 10 场地震 × 60 字段
     *    `5-2ID付き地震情報` 150 = **10 × 15** ⇒ 官方保存 10 条
     *    `paTmjs` / `paTmag` / `paTdep` 各 **9 个克隆**，y 间距 76 ⇒ 可视 9 行
     *  ★ 滚动不再在这里开窗：官方是**整列滚动**（app.js 的 QVScrollPanel 平移整个面板），
     *    所以这里固定把前 9 条填进 9 个槽位，开窗交给 scroll 平移。 */
    var ROWSLOTS = document.querySelectorAll('#art img[data-cos="paTmjs"]').length || 4;
    /* ★★ 2026-10-11 用户报：「大卡片就是显示最新的，不会在下面小卡片显示一个和大卡片相同的」
       → 官方主卡与履历**不重复**：履历里把主卡正在显示的那一条剔掉。
       （主卡 = pick(list)：有速报就是速报，否则最新那条，见 app.js） */
    var selId = q && q.id;
    var list = (st.list || []).filter(function (x) { return !selId || x.id !== selId; })
      .slice(0, Math.min(ROWSLOTS, 9));
    var RW = S.row;
    for (var i = 0; i < list.length; i++) {
      /* ★ 同履历标题：dy 只算行距，正式报卡的额外下移交给 applyScroll() 统一做 */
      var it = list[i], dy = i * S.rowStep;

      /* 徽章（震度 = 官方 paTm 换造型；烈度 = 自画 SVG，已含「最大烈度」+ 阿拉伯数字）
       * ★ 行内按【这一行自己的数据源】判定：履历里可能日、中、美混排
       * ★ 与主卡同一条规则：没有烈度时，开了「显示震度 0 的图标」就写 0（别留空徽章） */
      var im2 = metricOf(it);
      if (im2 === 'liedu') {
        var lv = metricVal(it, 'liedu');
        badgeLiedu(txt, (lv < 0 && showShindo0()) ? 0 : lv, dy, Z.maxLiedu || '最大烈度');
      } else {
        /* ★ 2026-10-29：小卡片的长周期階級 —— 官方有長周期时 paTm 造型会换成 paTmlN。
           ① QData 行自己带 maxLg（DM 注入）→ 用；
           ② 否则按事件号查 QVViews.maxLgByEvent（VXSE62 来过后持久保留，
              模拟/下一场换掉 V.eew 也不会丢）；
           ③ 再退回当前 E（同 eventId/同场）。 */
        var _lgRow = (it.maxLg != null && isFinite(+it.maxLg) && +it.maxLg >= 1) ? +it.maxLg : -1;
        var _eidRaw = String(it.eventId || it.id || '');
        var _eid14 = (String(it.eventId || '').match(/\d{14}/) || String(it.id || '').match(/\d{14}/) || [''])[0];
        if (_lgRow < 0 && global.QVViews && QVViews.maxLgOfEvent && (_eid14 || _eidRaw)) {
          var _lgMap = +QVViews.maxLgOfEvent(_eid14 || _eidRaw);
          if (_lgMap >= 1) _lgRow = _lgMap;
        }
        if (_lgRow < 0 && global.QVViews && QVViews.eew) {
          var _Erow = QVViews.eew;
          var _eidR = String(_Erow.eventId || (_Erow.q && _Erow.q.eventId) || '');
          var _eidR14 = (_eidR.match(/\d{14}/) || [''])[0];
          if (_Erow.maxLg >= 1 && _eidR &&
            ((_eid14 && _eidR14 && _eid14 === _eidR14) || _eidRaw === _eidR)) {
            _lgRow = +_Erow.maxLg;
          }
          /* 老数据/回放没有 eventId 时，用「同时间 + 同地名」认同一场，别把
             别的场次的长周期階級套上去。任一方缺事件号才允许这样认。 */
          if (_lgRow < 0 && _Erow.maxLg >= 1 && (!_eid14 || !_eidR14)) {
            var _dtLg = Math.abs((+it.timeMs || 0) - (+_Erow.timeMs || 0));
            var _plA = String(it.place || ''), _plB = String(_Erow.place || '');
            var _samePl = _plA && _plB && (_plA === _plB || _plA.indexOf(_plB) >= 0 || _plB.indexOf(_plA) >= 0);
            if (_dtLg < 120000 && _samePl) _lgRow = +_Erow.maxLg;
          }
        }
        badge(txt, (it.maxShindo >= 0 ? it.maxShindo : it.shindo), dy, _lgRow);
      }

      /* 地名 */
      if (!T.place(txt, it.place, T.placeSize(it.place, RW.place.size), SW / 2 + RW.place.X0, SH / 2 - RW.place.y + dy, 'left')) {
        T.zh(zh, { text: it.place || (Z.unknown || '不明'), x: 74, y: SH / 2 - RW.place.y + dy - 8,
          size: 13, color: '#fff', align: 'left', maxW: 154, minSize: 11 });
      }
      /* 时刻（左缘 -408，官方字形拼） */
      stat(true, mdTime(it.timeMs), RW.time.size, RW.time.X0, RW.time.y, 'left', dy);
      /* 行内两根色阶条：按数值上色 */
      setBar('paTmag', i, magColor(it.mag));
      setBar('paTdep', i, depColor(it.depthKm));
      /* 震级（右缘 -272） */
      stat(isFinite(it.mag) && it.mag > 0,
        (isFinite(it.mag) && it.mag > 0) ? it.mag.toFixed(1) : '',
        RW.mag.size, RW.mag.X0, RW.mag.y, RW.mag.align, dy);
      /* 深度（右缘 -340；单位用 'k' = 官方 "km" 连字） */
      statDep(it.depthKm, RW.dep.size, RW.dep.X0, RW.dep.y, RW.dep.align, dy);

      /* 行内小标签（官方 paTmjs「深さ」「M」/ paTm1「最大震度」墨迹框）
       * ⚠️「最大震度」必须画在徽章【之上】：官方把它烘在徽章色块**内部**
       *    （paTm1 画布 264x116：色块 (28,26) 48x62；「最大震度」白字 (36.07,34.15) 31.78x7.79
       *      ；大号数字 (46.85,50.95) 8.79x27.07）。徽章本体画在 #txt 层，
       *    而 #txt 在 #zh 之上 → 写进 #zh 会被色块盖住（曾因此「小卡片看不到最大震度」）。
       *    故这两个行内标签统一写进 #txt（badge() 之后追加 → 天然在徽章之上）。 */
      lab(T, txt, L.rowDep, Z.depth || '深度', { dy: dy });
      lab(T, txt, L.rowMag, 'M', { dy: dy });
      /* 烈度徽章是整块 SVG，里面已经画了「最大烈度」→ 不要重复写；
         震度的「最大震度」按官方 paTm 的字色规则跟着底色走（2/3/4 档是深字）
         ★ 长周期行用素材库原件 paTml（已含官方「最大震度」字形）→ 不再叠自画文字。 */
      if (im2 !== 'liedu' && !(_lgRow >= 1)) {
        lab(T, txt, L.rowMax, Z.maxShindo || '最大震度',
          { dy: dy, color: shindoTextColor(metricVal(it, 'shindo')) });
      }
    }

    /* 图形层里是 5 行快照；比实际行数多的那条要藏掉，
       否则会出现「有底板、无文字」的空行 */
    clearRows(list.length);

    /* ★★ 2026-10-23 收尾：正式报卡阶段先把普通卡的精灵与履历搬到官方位置。
       ⚠️ 必须放在最后：setShindo()/setBar()/clearRows() 都会重写 display，
          在 draw 开头做会被它们覆盖（旧色块/旧色条会留在新卡上）。
       ⚠️ 用 FIN_ON（含 view===0 判断）：非情报页要恢复正常商品精灵。
       ★ 调查中（INQ_ON）同理：Tab1 那张卡是 #inqbox 画的官方 paIbg130，
         底层普通卡必须一起收起，否则红色标题条/津波胶囊会从上下两头露出来。
       ★ 卡自己的标题条素材 paIti3 不在 FIN.sprites 里，而履历上移会把所有
         #art 精灵一起平移（含 paIti3）→ 它会飘到舞台外。这里单独收起来。 */
    finSprites(!FIN_ON && !INQ_ON);
    var _ti3 = document.querySelectorAll('#art img[data-cos="paIti3"]');
    for (var _q = 0; _q < _ti3.length; _q++) {
      var _el3 = _ti3[_q];
      if (INQ_ON) { _el3.dataset.inqHidden = '1'; _el3.style.display = 'none'; }
      else if (_el3.dataset.inqHidden) { delete _el3.dataset.inqHidden; _el3.style.display = ''; }
    }
  };

  global.QVRender = R;
  /* 色阶取色导出给海啸页用（震级小卡的色条要跟信息页同色） */
  R.magColor = magColor; R.depColor = depColor;
})(window);
