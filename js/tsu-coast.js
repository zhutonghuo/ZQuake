/* tsu-coast.js —— 海啸「海岸線の色」（把海岸线按海啸等级上色）
 *
 * ★★ 2026-10-25 第三版。用户：「既然我们是全球通 SREV，那为什么海岸线和其他数据
 *    一定要区分国家呢？」→ 海岸线**不再按国家分**：
 *
 *   · 几何 = Natural Earth 10m coastline（公开领域，全球真实海岸线，不含内陆湖）
 *     —— 不是从哪个国家的素材里抠的，全世界同一份。
 *   · 分区 = Natural Earth 10m admin-1 里靠海的省级单元（1840 个，全球统一）
 *     —— 代码里没有任何「日本一套 / 中国一套」的分支。
 *   · M = 「现有沿岸预警区码 → 省级单元 id」的映射（目前只有日本 JMA / 中国有这种数据，
 *     以后要给别的国家加预警区，只改数据、不改这里）。
 *
 * 配色 = 官方 project.json 的 `@2 津波警報色`：
 *   大津波警報 #c125ed ／ 津波警報 #ed291b ／ 津波注意報 #f1de2f ／ 若干の海面変動 #7cc3ff
 */
(function (g) {
  'use strict';

  var COL = { 4: '#c125ed', 3: '#ed291b', 2: '#f1de2f', 1: '#7cc3ff' };
  /* 线宽 = **屏幕像素**（path 带 vector-effect="non-scaling-stroke"，不随相机缩放）
     ★ 2026-11-03 用户：「海岸线可以加粗一点吗，现在的太细了」→ 全档 +35%~55%。
       底图的海岸线是 kondz-map 的 PNG 瓦片（烧进像素里，改不了线宽），
       能调的只有这一层「海啸 海岸線の色」，所以在这里加粗。 */
  var WID = { 4: 11, 3: 8.5, 2: 6.5, 1: 5 };
  var host = null, lastKey = '', lastHtml = '';
  var IDX = null;            /* admin-1 id -> [点串, ...] */

  function b36(s) {
    var neg = false, i = 0, v = 0;
    if (s.charAt(0) === '-') { neg = true; i = 1; }
    for (; i < s.length; i++) {
      var c = s.charCodeAt(i);
      var d = c <= 57 ? c - 48 : (c <= 90 ? c - 55 : c - 87);
      v = v * 36 + d;
    }
    return neg ? -v : v;
  }

  /* 只解需要的分区（全球数据 21 万点，全解要几百毫秒，没必要） */
  function index() {
    if (IDX) return IDX;
    IDX = {};
    var G = g.QV_COAST_GEO;
    if (!G || !G.L) return IDX;
    var chunks = G.L.split(';');
    for (var i = 0; i < chunks.length; i++) {
      var ch = chunks[i];
      if (!ch) continue;
      var p = ch.indexOf('~');
      if (p < 0) continue;
      var id = ch.slice(0, p) | 0;
      (IDX[id] || (IDX[id] = [])).push(ch.slice(p + 1));
    }
    return IDX;
  }

  function decode(toks) {
    var K = (g.QV_COAST_GEO && g.QV_COAST_GEO.K) || 4;
    var arr = toks.split(',');
    var d = '', px = 0, py = 0, n = 0, lastX = null;
    for (var j = 0; j < arr.length; j++) {
      var t = arr[j];
      if (!t) continue;
      var q = t.indexOf('.');
      if (q < 0) continue;
      px += b36(t.slice(0, q));
      py += b36(t.slice(q + 1));
      var x = px / K, y = py / K;
      /* ★ 2026-10-29: 跨越经度缝时用 M 重新起笔，杜绝横跨全球的假连线 */
      var isJump = (lastX !== null && Math.abs(x - lastX) > 5000);
      d += (n === 0 || isJump ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
      lastX = x;
      n++;
    }
    return n >= 2 ? d : '';
  }

  /* ★★★ 2026-11-03 用户：「明明有 5m 和 3m 的结果，地图上全是注意报」
     —— 两层原因：
       ① coast-geo.js 的分区粒度是 **admin-1（省级）**，中国近场沿岸区码 1320..1363
          在 M 里压根没有映射 → 那些区域一段海岸线都不画；
       ② 就算有（比如广东一整省就一个 id 367），汕尾 5m 和湛江 1m 只能取 max
          → 整省一个颜色。
     ⇒ coast-cn.js 里预先按预警区把海岸线切好了（每区一条或多条折线，0.1px 差分编码），
        这里直接按区码上色；被它覆盖的省级分区不再按 admin-1 整段涂。 */
  var CNK = 10;
  var cnReady = false;
  function decodeCN(str) {
    var arr = str.split(',');
    var d = '', px = 0, py = 0, n = 0;
    for (var i = 0; i + 1 < arr.length; i += 2) {
      px += (+arr[i]) || 0;
      py += (+arr[i + 1]) || 0;
      if (!isFinite(px) || !isFinite(py)) continue;
      d += (n === 0 ? 'M' : 'L') + (px / CNK).toFixed(1) + ' ' + (py / CNK).toFixed(1);
      n++;
    }
    return n >= 2 ? d : '';
  }

  function ensureHost() {
    if (host && host.parentNode) return host;
    /* 必须挂 #mapoverlay（图集像素空间，带相机 transform）。
       #mapview 在动态瓦片模式下是 display:none。 */
    var mv = document.getElementById('mapoverlay');
    if (!mv) return null;
    host = document.createElement('div');
    host.id = 'tsucoast';
    host.style.cssText = 'position:absolute;left:0;top:0;width:2596px;height:2651px;' +
      'pointer-events:none;z-index:6;overflow:visible';
    mv.appendChild(host);
    return host;
  }

  function clear() {
    lastKey = '';
    /* ★ 2026-11-03 修：以前只清 lastKey、没清 lastHtml →
       清空后再设【同一批区域】时，`if (html === lastHtml) return;` 直接早退，
       结果 DOM 是空的、地图上什么都不画（「海啸解除了再发一次就不显示」）。 */
    lastHtml = '';
    if (host) host.innerHTML = '';
  }

  /* ★★★ 2026-11-03 用户：「为什么分块了」的真正的第二个原因：
     #mapoverlay 是靠 CSS `transform: scale(k)` 缩放的，而
     `vector-effect="non-scaling-stroke"` **只补偿 SVG 内部坐标系变换，不补 CSS transform**
     → 写死的 stroke-width 11 在 k=3.3 时实际画出 36px，整条海岸线成了一大坨/一串块。
     ⇒ 线宽一律按「屏幕像素」算：stroke-width = WID / 当前相机 scale，
       相机一变就同步一次（prepare 每帧会调 syncWidth）。 */
  var lastScale = 0;
  function camScale() {
    var mv = document.getElementById('mapoverlay');
    if (!mv) return 1;
    var m = /scale\(\s*([-\d.]+)/.exec(mv.style.transform || '');
    var k = m ? parseFloat(m[1]) : 1;
    return (k > 0.05 && k < 200) ? k : 1;
  }
  function syncWidth() {
    var k = camScale();
    if (Math.abs(k - lastScale) < 0.002) return;
    lastScale = k;
    if (!host) return;
    var ps = host.querySelectorAll('path');
    for (var i = 0; i < ps.length; i++) {
      var g = ps[i].getAttribute('data-g') | 0;
      if (g && WID[g]) ps[i].setAttribute('stroke-width', (WID[g] / k).toFixed(2));
    }
  }

  /** list = [{ code, grade }]（code 是预警区码，grade 1..4）；传空数组 = 清掉 */
  function set(list) {
    var h = ensureHost();
    if (!h) return 0;
    if (!list || !list.length) { clear(); return 0; }
    /* 相机缩放变了 → 线宽重算（每帧调，但只在 scale 真变时写 DOM） */
    syncWidth();

    /* coast-cn.js 后到（动态加载）：到的那一瞬强制重算一次 */
    var _cn = g.QV_COAST_CN;
    if (_cn && !cnReady) { cnReady = true; lastKey = ''; }

    var key = list.map(function (x) { return x.code + ':' + x.grade; }).sort().join(',');
    if (key === lastKey) return 0;
    lastKey = key;

    var G = g.QV_COAST_GEO;
    if (!G) return 0;
    var M = G.M || {};
    var idx = index();

    /* 预警区码 → 省级单元 id → 最高等级 */
    var grade = {};
    list.forEach(function (x) {
      var ids = M[String(x.code)];
      if (!ids) return;
      var gd = x.grade | 0;
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        if (gd > (grade[id] || 0)) grade[id] = gd;
      }
    });

    var out = '', used = 0, maxGrade = 0;
    /* ★★★ 2026-11-03 用户：「为什么分块了」
       —— 以前是【每个区一条 path】，每条 path 两端是 round 圆头。
          相邻两条（甚至同色的相邻区）叠在一起，圆头互相凸出来
          → 一条海岸线看着像一串串香肠/一块一块的。
       ⇒ 同一个等级的折线全部拼进**一条** path（多个 M 子路径），
         端点改 butt（平头），交界点由数据端共享（gen-coast-cn.py 里保证），
         颜色换接处不会露缝。 */
    var byG = { 1: '', 2: '', 3: '', 4: '' };
    /* 被中国细分岸段覆盖的省级分区：不再按 admin-1 整段涂色 */
    var cnCovered = {};
    if (_cn && _cn.C) {
      for (var ci = 0; ci < _cn.C.length; ci++) cnCovered[_cn.C[ci]] = 1;
    }
    for (var id in grade) {
      if (cnCovered[id]) continue;
      var arr = idx[id];
      if (!arr || !arr.length) continue;
      var d = '';
      for (var i = 0; i < arr.length; i++) d += decode(arr[i]);
      if (!d) continue;
      var gd = grade[id] || 1;
      used++;
      if (gd > maxGrade) maxGrade = gd;
      byG[gd > 4 ? 1 : gd] += d;
    }
    /* 中国近场岸段：按预警区码上色（同一省内不同岸段可以不同颜色） */
    if (_cn && _cn.S) {
      for (var li = 0; li < list.length; li++) {
        var c2 = String(list[li].code), gd2 = list[li].grade | 0;
        var src = _cn.S[c2];
        if (!src || !(gd2 >= 1)) continue;
        var polys = src.split(';'), d2 = '';
        for (var pi = 0; pi < polys.length; pi++) d2 += decodeCN(polys[pi]);
        if (!d2) continue;
        used++;
        if (gd2 > maxGrade) maxGrade = gd2;
        byG[gd2 > 4 ? 1 : gd2] += d2;
      }
    }
    var k0 = camScale();
    for (var gg = 1; gg <= 4; gg++) {
      if (!byG[gg]) continue;
      /* ★★★ 2026-11-03 第五版（用户：「为什么分块了」）：
         线宽 11px 而海岸线点密（简化到 0.5px）→ 每个拐点都被 join 拼出凸起，
         整条线看起来就是一串香肠/一块一块。
         ⇒ join 改 bevel（斜切，不外凸）、miter-limit 压到 1.1、端点 butt；
           线宽按当前相机缩放换算（见 syncWidth 注释），保持屏幕像素恒定。 */
      out += '<path data-g="' + gg + '" d="' + byG[gg] + '" fill="none" stroke="' + COL[gg] +
        '" stroke-width="' + (WID[gg] / k0).toFixed(2) +
        '" stroke-linecap="butt" stroke-linejoin="bevel" stroke-miterlimit="1.1"/>';
    }

    /* 全球数据在图集里 x/y 都可能为负 → viewBox 四面扩展 */
    /* ★★★ 2026-11-03 用户：「为什么海岸线不会和官方一样一闪一闪」→「想要我们的也闪起来」
       官方那条【海啸上色】的海岸线是**点滅**的（用来抓注意力），我们以前一直是静态的。
       ⇒ 用 CSS keyframes 做：1.2 秒一个来回，最暗到 0.3（**不会全灭**，
         免得又变成「闪一下消失了」那种像是坏掉的观感）。
         · 只闪「有海啸等级的区域」，底图海岸线（coast-base.js）不闪。
         · 大津波警報/津波警報（grade≥3）闪得快一点（0.9s），注意報/海面变动 1.2s。 */
    var html = out ? (
      '<svg style="position:absolute;left:-3200px;top:-1200px;overflow:visible" ' +
      'width="6400" height="4200" viewBox="-3200 -1200 6400 4200">' +
      '<style>' +
      /* ★★★ 2026-11-03 第四版：用户拿秒表掐了官方（「0 开始消失 / 1.5 回来了 / 5.5 开始消失」）
         ⇒ 暗 **1.5 秒**，亮 **4.0 秒**，一个周期 **5.5 秒**，硬切（step-end）。
         关键帧百分比：1.5 ÷ 5.5 = 27.2727%。
         暗态就是**完全消失**（官方实测就是没了 1.5 秒）。 */
      '@keyframes qvTsuBlink{0%,27.27%{opacity:0}27.28%,100%{opacity:1}}' +
      '.qvtsu{animation:qvTsuBlink 5.5s linear infinite}' +
      '</style><g class="qvtsu" stroke-opacity="1">' +
      out + '</g></svg>') : '';
    /* ★★★ 2026-10-26 用户：「海啸的海岸线条会闪烁，大概 3~6 秒闪一次，一次消失 1~2 秒」
       prepare() 是**每帧**调的；只要 items 顺序/内容抖一下，key 就变 → 整块 innerHTML 重建
       → SVG 重新解析那几十条路径，中间几帧是空的 = 闪一下。
       ⇒ 决定性去重：生成出来的 HTML 字符串完全一样就不碰 DOM。
         这样哪怕 key 每帧在变，只要颜色/形状真没变，就不会重建。 */
    if (html === lastHtml) return used;
    lastHtml = html;
    lastScale = k0;
    h.innerHTML = html;
    return used;
  }

  g.QVTsunamiCoast = { set: set, clear: clear, _index: index, _decode: decode };
})(window);
