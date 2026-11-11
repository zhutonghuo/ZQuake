/* planet.js — 天体模式（月球 / 火星）
 *
 * 为什么单独一层：底图是一张【预先重投影成 Mercator】的全球图
 * （`dev/planet-merc.py` 生成，4096×4096，对应 mapX/mapY 的 3600×3600 世界方块），
 * 所以它的摆位公式与 qvtiles 的瓦片完全一致，不需要另做投影：
 *     left = cam.tx + px * (W0 - MINX)
 *     top  = cam.ty + px * (MAXY - N0)
 *     size = px * 3600
 * 世界在经度方向每 360° 重复 → 屏幕横向要铺多份（和 qvtiles 的虚拟列同理）。
 *
 * ⚠️ 本层只负责「底图」和「天体参数」。它不动任何现有地球逻辑：
 *    日本瓦片 / 世界地图 / 海岸线 / 行政区色块，切回地球后原样恢复。
 */
(function (global) {
  'use strict';

  var A = 10, MINX = -130.638978, MAXY = 138.909650;
  var W0 = -3160, N0 = 1425.9522, SPAN0 = 3600;

  /* ─────────── 天体参数表 ───────────
   * 数值有出处，不是瞎编的（见每条注释）。
   * magMax = 该天体「有记录以来最强」的量级，超过它就该提示用户这是科幻模式。
   */
  var BODIES = {
    earth: {
      key: 'earth', name: '地球', quake: '地震', img: null, accent: '#4ea3ff',
      magMax: 9.9, title: '地球模式', radiusKm: 6371
    },
    moon: {
      key: 'moon', name: '月球', quake: '月震', img: 'assets/planet/moon-merc.jpg',
      accent: '#c9d4e4', title: '月球模式', radiusKm: 1737,
      /* 阿波罗被动地震台（1969-1977）：浅源热震 HFT 多为 M1~2；
         深源月震（约 800~1000km）可达 M5 以上，最强记录约 M5.5。
         月震尾波极长（干燥+高刚性岩石、散射强），一次可震几十分钟。 */
      magMax: 5.5,
      depthHint: '浅源 1~30km｜深月震 700~1000km',
      durSec: function (m) {
        return Math.max(60, Math.min(3600, 90 * Math.pow(2.23, Math.max(0, m - 1))));
      },
      durText: function (m) { return fmtDur(this.durSec(m)); }
    },
    mars: {
      key: 'mars', name: '火星', quake: '火震', img: 'assets/planet/mars-merc.jpg',
      accent: '#d98556', title: '火星模式', radiusKm: 3390,
      /* InSight（2018-2022）：绝大多数 Mw 2.5~3.5；
         最大 S1222a（2022-05-04）Mw 4.7 —— 能量约等于其余全部事件之和的 5 倍级。
         高频 HF 事件浅（数 km，波形「纺锤形」、震相不清、尾波数十分钟）；
         低频 LF 事件深（地壳下部~上地幔，P/S 清晰、缺面波）；
         S1222a 震源深度估计 18~28km，主震动 4~5 小时，长周期尾波 >10 小时。 */
      magMax: 5.0,
      depthHint: 'HF 数 km（浅）｜LF 地壳下部~上地幔｜S1222a 18~28km',
      durSec: function (m) {
        /* M2.5 → 5min；M3.5 → 30min；M4.7 → 4.5h；再往上夹到 5h */
        return Math.max(300, Math.min(18000, 300 * Math.pow(6.1, Math.max(0, m - 2.5))));
      },
      durText: function (m) { return fmtDur(this.durSec(m)); }
    }
  };

  function fmtDur(s) {
    s = Math.round(s);
    if (s < 60) return s + ' 秒';
    var m = s / 60;
    if (m < 60) return (m < 10 ? m.toFixed(1) : Math.round(m)) + ' 分';
    var h = Math.floor(m / 60), mm = Math.round(m % 60);
    return h + ' 时' + (mm ? ' ' + mm + ' 分' : '');
  }

  /* ═══════ 烈度场：与 views.js 的 predictIPgv 完全同一套 GMPE ═══════
   * 区别只在于：星球模式没有测站、没有行政区，所以直接把它当成
   * 一个「只依赖震中距」的场 → 等震环天然就是同心圆。
   *   I(d) = 2.68 + 1.72·lgPGV，PGV 走司・翠川式 + 断层长度饱和
   * 这跟地球模式的绝对水平一致，所以切星球不会突然变一套物理。 */
  var MAPK = 572.9577951308232, MAPY0 = 374.04780730560344;
  var R_EARTH = 6371;

  function pfI(d, dep, M) {
    var Lf = Math.min(1600, Math.pow(10, 0.5 * M - 1.85));
    var rf0 = Math.max(0, d - 0.45 * Lf);
    var Rf = Math.sqrt(rf0 * rf0 + 0.25) + 0.10 * d;
    var logPGV = 0.58 * M + 0.0038 * dep - 1.29
      - Math.log10(Rf + 0.0028 * Math.pow(10, 0.5 * M))
      - 0.002 * Rf;
    var I = 2.68 + 1.72 * logPGV;
    if (M > 7.5) I += (M - 7.5) * 0.45;
    return I;
  }
  /** 震中距（km）→ 该处烈度。行星半径按天体缩放（火星 3390km、月球 1737km），
   *  但 GMPE 用的是地球标定的距离衰减 —— 这里**只用天体半径做几何换算**，
   *  不假装火星有自己的衰减定律（那会是编的）。 */
  function bodyRadius() {
    var b = BODIES[cur];
    return (b && b.radiusKm) || R_EARTH;
  }
  /** 求「烈度 = thr」处的震中距；场里根本够不到 → -1 */
  function pfR(thr, dep, M) {
    if (pfI(0, dep, M) < thr) return -1;
    var lo = 0, hi = 3000;
    if (pfI(hi, dep, M) >= thr) return hi;
    for (var i = 0; i < 42; i++) {
      var mid = (lo + hi) / 2;
      if (pfI(mid, dep, M) >= thr) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  /** 以 (lat0,lon0) 为中心、半径 rKm 的闭合大圆环（经纬度点列） */
  function pfCircle(lat0, lon0, rKm, n) {
    var out = [], R = bodyRadius();
    var p1 = lat0 * Math.PI / 180, l1 = lon0 * Math.PI / 180, dr = Math.min(Math.PI, rKm / R);
    for (var i = 0; i < n; i++) {
      var brg = i / n * Math.PI * 2;
      var s1 = Math.sin(p1), c1 = Math.cos(p1), sd = Math.sin(dr), cd = Math.cos(dr);
      var p2 = Math.asin(s1 * cd + c1 * sd * Math.cos(brg));
      var l2 = l1 + Math.atan2(Math.sin(brg) * sd * c1, cd - s1 * Math.sin(p2));
      out.push([l2 * 180 / Math.PI, p2 * 180 / Math.PI]);
    }
    return out;
  }

  /* ─────────── 投影（与 qvtiles / mapcam 同一套 mapX/mapY） ─────────── */
  function pjX(cam, lon) {
    var m = ((lon + 44) % 360 + 360) % 360 - 180;
    return cam.tx + (A * cam.k) * (10 * m - MINX);
  }
  function pjY(cam, lat) {
    var la = Math.max(-85, Math.min(85, lat));
    var my = MAPK * Math.log(Math.tan((45 + la / 2) * Math.PI / 180)) - MAPY0;
    return cam.ty + (A * cam.k) * (MAXY - my);
  }

  /* ─────────── 底图层 ─────────── */
  var layer = null, cells = [], host = null;
  var cur = 'earth';                  /* 当前天体 key */
  var isoSvg = null, isoG = null, hexG = null, stG = null;
  var overlay = 'station';            /* 'station' 测站圆标（默认）｜'ring' 等震环｜'hex' 六边形 */
  var quake = null;                   /* { lat, lon, mag, depthKm } */
  var rings = null;                   /* [{ level, pts:[[lon,lat]…] }] */
  var ready = {};                     /* key → { ok, img } */

  function init(h) {
    host = h || host;
    if (!host || layer) return;
    layer = document.createElement('div');
    layer.id = 'planetlayer';
    /* 不透明底 + 铺满：既画星球图，也顺手把下面的官方素材层遮干净
       （z-index 4 压在 #mapview(3) 之上，又在 #mapoverlay(5)/#mappins(10) 之下） */
    layer.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;overflow:hidden;' +
      'pointer-events:none;z-index:6;display:none;background:#07090d';
    host.appendChild(layer);
    /* 烈度叠加层：直接放在 #planetlayer 内部 → 自动压在底图之上，
       不需要跟别层抢 z-index。 */
    var NS = 'http://www.w3.org/2000/svg';
    isoSvg = document.createElementNS(NS, 'svg');
    isoSvg.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;' +
      'overflow:visible;pointer-events:none');
    hexG = document.createElementNS(NS, 'g');
    isoG = document.createElementNS(NS, 'g');
    stG = document.createElementNS(NS, 'g');
    isoSvg.appendChild(hexG);      /* 网格在下 */
    isoSvg.appendChild(isoG);      /* 等震环在中 */
    isoSvg.appendChild(stG);       /* 测站在上 */
    layer.appendChild(isoSvg);
  }

  function ensureCells(n) {
    while (cells.length < n) {
      var im = document.createElement('img');
      im.draggable = false;
      im.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;display:none;' +
        'pointer-events:none;user-select:none;image-rendering:auto';
      /* ⚠️ 必须插到 SVG 之前：底图 img 是后创建的，直接 appendChild 会排在
         #planetlayer 的 SVG 后面 → 等震环/网格整层被底图盖住（实测完全看不见）。 */
      if (isoSvg && isoSvg.parentNode === layer) layer.insertBefore(im, isoSvg);
      else layer.appendChild(im);
      cells.push({ el: im });
    }
  }

  /** 每帧调用（mapcam.paint 里，紧跟 QVTiles.update） */
  function update(cam, vis) {
    if (!layer || cur === 'earth') return;
    var px = A * cam.k;
    if (!(px > 0)) return;
    var size = px * SPAN0;
    var left0 = cam.tx + px * (W0 - MINX);
    var top0 = cam.ty + px * (MAXY - N0);
    var iv0 = Math.floor((vis.x0 - left0) / size) - 1;
    var iv1 = Math.floor((vis.x1 - left0) / size) + 1;
    var need = Math.max(1, Math.min(8, iv1 - iv0 + 1));
    ensureCells(need);
    var src = BODIES[cur] && BODIES[cur].img;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i], el = c.el;
      if (i >= need) { if (el.style.display !== 'none') el.style.display = 'none'; continue; }
      if (c.src !== src) { c.src = src; el.src = src; }
      if (el.style.display === 'none') el.style.display = '';
      var l = left0 + (iv0 + i) * size;
      el.style.left = l.toFixed(2) + 'px';
      el.style.top = top0.toFixed(2) + 'px';
      el.style.width = (size + 1).toFixed(2) + 'px';
      el.style.height = (size + 1).toFixed(2) + 'px';
    }
    paintOverlay(cam, vis);
  }

  /* ═══════════ 烈度叠加（等震环 / 六边形网格） ═══════════ */
  var NS = 'http://www.w3.org/2000/svg';

  /** 用当前震源算各档等震环半径（只依赖震中距，所以是同心圆） */
  function buildRings(q) {
    if (!q) return null;
    var M = Math.max(1, Math.min(10, +q.mag || 0));
    var dep = Math.max(0.5, Math.min(700, isFinite(q.depthKm) ? +q.depthKm : 10));
    if (q.lat == null || q.lon == null || !isFinite(+q.lat) || !isFinite(+q.lon)) return null;
    var EDGES = (global.QV_LIEDU && QV_LIEDU.EDGES) ||
      [0.96, 2.00, 2.60, 3.12, 3.62, 4.14, 4.65, 5.17, 5.70, 6.19, 6.71, 7.23];
    var Imax = pfI(0, dep, M);
    var out = [];
    /* 从 2 度起：1 度对应 PGV 0.1 cm/s，人几乎无感，中国台网的官方烈度图也从不画到 1 度 */
    for (var lv = 2; lv <= 12; lv++) {
      var thr = EDGES[lv - 1];
      if (!(Imax >= thr)) break;
      var r = pfR(thr, dep, M);
      if (!(r > 0)) continue;
      out.push({ level: lv, r: r, pts: pfCircle(q.lat, q.lon, r, 96) });
    }
    return out.length ? out : null;
  }

  function lieColor(lv) {    var LIE = global.QV_LIEDU;
    if (LIE && LIE.colorOf) return LIE.colorOf(lv);
    return '#3098bd';
  }

  function paintOverlay(cam, vis) {
    if (!isoG || cur === 'earth') return;
    while (isoG.firstChild) isoG.removeChild(isoG.firstChild);
    while (hexG.firstChild) hexG.removeChild(hexG.firstChild);
    paintStations(cam, vis);
    if (!rings || !rings.length) return;
    /* 测站模式：圆标是 mapcam 自己的图层，这里只画震中十字 */
    if (overlay === 'station') { drawEpicenter(cam); return; }
    if (overlay === 'hex') drawHex(cam);
    else drawRings(cam);
    drawEpicenter(cam);
  }

  /** 等震环：从外圈往里画，高档自然盖在低档上面 */
  function drawRings(cam) {
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i], d = '';
      for (var j = 0; j < r.pts.length; j++) {
        d += (j ? 'L' : 'M') + pjX(cam, r.pts[j][0]).toFixed(1) + ' ' +
          pjY(cam, r.pts[j][1]).toFixed(1);
      }
      d += 'Z';
      var col = lieColor(r.level);
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', col);
      p.setAttribute('fill-opacity', '0.52');
      p.setAttribute('stroke', col);
      p.setAttribute('stroke-width', '1.6');
      p.setAttribute('stroke-opacity', '0.95');
      isoG.appendChild(p);
    }
  }

  /** 六边形网格：按到震中的距离逐格算烈度填色（更接近「场」的观感） */
  function drawHex(cam) {
    var maxKm = rings[0].r;
    if (!(maxKm > 0)) return;
    var R = bodyRadius();
    var degPerKm = 180 / (Math.PI * R);
    var maxDeg = maxKm * degPerKm;
    var hR = maxDeg / 7;                       /* 六边形外接圆半径（度） */
    if (!(hR > 1e-4)) return;
    var M = Math.max(1, Math.min(10, +quake.mag || 0));
    var dep = Math.max(0.5, Math.min(700, isFinite(quake.depthKm) ? +quake.depthKm : 10));
    var EDGES = (global.QV_LIEDU && QV_LIEDU.EDGES) || null;
    var colOf = function (I) {
      if (!(I >= 2)) return null;
      if (EDGES) {
        var lv = 2;
        for (var k = 1; k < EDGES.length; k++) if (I >= EDGES[k]) lv = k + 1;
        return lieColor(Math.min(12, lv));
      }
      return lieColor(Math.min(12, Math.round(I)));
    };
    var stepX = hR * 1.5, stepY = hR * Math.sqrt(3);
    var nx = Math.ceil(maxDeg / stepX) + 1, ny = Math.ceil(maxDeg / stepY) + 1;
    if (nx * ny > 900) return;                 /* 安全阀：格子太密就不铺 */
    var cosL = Math.cos(quake.lat * Math.PI / 180);
    for (var iy = -ny; iy <= ny; iy++) {
      var lat = quake.lat + iy * stepY;
      if (lat > 89 || lat < -89) continue;
      var offX = (Math.abs(iy) % 2) ? stepX / 2 : 0;
      for (var ix = -nx; ix <= nx; ix++) {
        var lon = quake.lon + ix * stepX + offX;
        var dy = (lat - quake.lat) * (Math.PI * R / 180);
        var dx = (lon - quake.lon) * cosL * (Math.PI * R / 180);
        var dKm = Math.sqrt(dx * dx + dy * dy);
        var I = pfI(dKm, dep, M);
        var col = colOf(I);
        if (!col) continue;
        var d = '';
        for (var k = 0; k < 6; k++) {
          var ang = Math.PI / 3 * k + Math.PI / 6;
          var hLat = lat + (hR * Math.sin(ang)) * 0.92;
          var hLon = lon + (hR * Math.cos(ang) * 0.92) / Math.max(0.2, cosL);
          d += (k ? 'L' : 'M') + pjX(cam, hLon).toFixed(1) + ' ' + pjY(cam, hLat).toFixed(1);
        }
        d += 'Z';
        var p = document.createElementNS(NS, 'polygon');
        p.setAttribute('points', d.replace(/[MLZ]/g, ' ').trim());
        p.setAttribute('fill', col);
        p.setAttribute('fill-opacity', '0.5');
        p.setAttribute('stroke', col);
        p.setAttribute('stroke-width', '0.8');
        p.setAttribute('stroke-opacity', '0.7');
        hexG.appendChild(p);
      }
    }
  }

  /** 震中标记：仿官方 epc30 的红叉（两笔交叉 + 白色外描边）
   *  ⚠️ 为什么不直接靠 QVMapCam 的 pin：星球模式下地图不动，
   *  `paint()` 很少被调用 → pin 的 left/top 可能还停在上一帧（或者被
   *  pinMode / showShindo0 判成空列表），实测月球模式下红叉根本不出现。
   *  画在 SVG 里就跟着每帧一起重投影，永远不会掉。 */
  function drawEpicenter(cam) {
    if (!quake) return;
    var x = pjX(cam, quake.lon), y = pjY(cam, quake.lat);
    if (!isFinite(x) || !isFinite(y)) return;
    var g = document.createElementNS(NS, 'g');
    var mk = function (tag, at) {
      var e = document.createElementNS(NS, tag);
      for (var k in at) e.setAttribute(k, at[k]);
      g.appendChild(e);
      return e;
    };
    var R = 11;
    /* 先画白色粗描边打底 → 再画红色本体：任何底图上都清晰 */
    [['#ffffff', 7.5], ['#e8342b', 3.6]].forEach(function (st) {
      mk('line', {
        x1: x - R, y1: y - R, x2: x + R, y2: y + R,
        stroke: st[0], 'stroke-width': st[1], 'stroke-linecap': 'round'
      });
      mk('line', {
        x1: x + R, y1: y - R, x2: x - R, y2: y + R,
        stroke: st[0], 'stroke-width': st[1], 'stroke-linecap': 'round'
      });
    });
    isoG.appendChild(g);
  }

  /** 设置当前震源。q = { lat, lon, mag, depthKm }
   *  ⭐ sim=true 表示「模拟震源」，享有优先权：
   *  views.cnFill() 每次重绘都会拿【实时选中的那场地震】调一次 setQuake，
   *  不加优先权的话，刚调好的 M9.9 下一帧就被 M4.8 覆盖了（实测就是这个）。 */
  function setQuake(q, sim) {
    if (sim) isSimQuake = true;
    else if (isSimQuake) return rings;        /* 模拟中：不吃实时数据 */
    var next = q ? {
      lat: +q.lat, lon: +q.lon,
      mag: isFinite(q.mag) ? +q.mag : 6.0,
      depthKm: isFinite(q.depthKm) ? +q.depthKm : (isFinite(q.depth) ? +q.depth : 10)
    } : null;
    /* ⚠️ cnFill 是「每次重绘都会调」的，这里必须去重 ——
       否则每一帧都会重建测站 + 把模拟时钟归零，测站永远亮不起来。 */
    var prev = quake;
    var same = (!prev && !next) || (prev && next &&
      prev.lat === next.lat && prev.lon === next.lon &&
      prev.mag === next.mag && prev.depthKm === next.depthKm);
    if (same) return rings;
    quake = next;
    rings = quake ? buildRings(quake) : null;
    /* 启一个「模拟时钟」：测站的逐个点亮完全靠 mapcam 的 waveSec 推进，
       不发 simWave 的话 tickStations 里 sec 恒为 0 → 一个点都不会亮。 */
    try {
      if (global.QVMapCam && QVMapCam.simWave) {
        if (quake && rings && rings.length) {
          QVMapCam.simWave({
            lat: quake.lat, lon: quake.lon, t0: Date.now(), speed: speed,
            level: rings[rings.length - 1].level,
            mag: quake.mag, depth: quake.depthKm
          });
        } else {
          QVMapCam.simWave(null);
        }
      }
    } catch (e) { }
    applyStations();
    startLoop();
    try { if (global.QVMapCam && QVMapCam.refresh) QVMapCam.refresh(); } catch (e) { }
    return rings;
  }
  /** 烈度表现方式：'station' 测站圆标（默认，跟地球观感一致）｜'ring' 等震环｜'hex' 六边形 */
  function setOverlay(k) {
    overlay = (k === 'hex' || k === 'ring') ? k : 'station';
    applyStations();
    try { if (global.QVMapCam && QVMapCam.refresh) QVMapCam.refresh(); } catch (e) { }
    return overlay;
  }

  /* ═══════════ 测站模式：全球铺满 + 随机地名 ═══════════
   * 用户 2026-11-03：「把整张星球上都铺满，而且要随机放」+「给每个测站随机搞个地名」
   * 固定种子伪随机全球撒点（球面均匀）→ 每点按 GMPE 算烈度 → 配一个天体地名。
   * 种子固定 ⇒ 同一个天体每次都是同一批站，不会闪烁。
   * ⚠️ 不走 QVMapCam.setStations：那套「P 波没到就隐藏 / 衰减到 0.2 就消失」
   *    会让远处测站一个个灭掉，铺不满。这里自己画 <circle>，位置每帧跟相机重投影。
   */
  var stEls = [], stList = null, stBuiltFor = '';
  var speed = 1;                      /* 模拟加速倍率（火星主震真实要 4~5 小时） */

  var PLACE = {
    moon: {
      a: ['静海', '雨海', '云海', '澄海', '危海', '酒海', '丰富海', '风暴洋', '汽海', '湿海',
        '第谷', '哥白尼', '开普勒', '柏拉图', '阿利斯塔克', '厄拉多塞', '阿基米德', '托勒密',
        '莫斯科海', '洪堡海', '史密斯海', '界海', '浪海', '死湖', '梦沼', '虹湾', '露湾', '热湾',
        '南极-艾特肯', '薛定谔', '阿波罗', '科罗廖夫', '赫茨普龙', '东方海', '南海'],
      b: null
    },
    mars: {
      a: ['奥林匹斯', '水手', '希腊', '埃律西昂', '乌托邦', '阿尔及尔', '阿西达利亚', '阿瑞斯',
        '塔尔西斯', '帕弗尼斯', '阿尔巴', '埃利西姆', '太阳湖', '克律塞', '伊西迪斯', '阿卡迪亚',
        '普罗米修斯', '第勒尼安', '亚马逊', '俄斐', '以色列', '尼罗斯', '欧罗巴', '尼罗',
        '卡西尼', '丹尼尔森', '加莱', '霍尔登', '耶泽罗', '盖尔'],
      b: ['山', '谷', '平原', '高原', '陨坑', '盆地', '台地', '沙丘', '海峡', '隆起']
    }
  };

  /** 行政区划后缀：模拟「珠海特别行政区（火星分政）」那种写法 */
  var ADMIN = ['特别行政区', '自治州', '直辖市', '特别市', '自治县', '特区',
    '直辖州', '垦区', '开发区', '观测区', '科考特区', '直辖县'];

  /** 地名 = 天体地物名 + 行政区划 + （天体分政）
   *  下標用互质步长错开，避免「每个前缀都配同一个后缀/同一个区划」。 */
  function placeName(bodyKey, i) {
    var P = PLACE[bodyKey];
    if (!P) return '';
    var a = P.a[i % P.a.length];
    var base = P.b ? a + P.b[(i * 7 + ((i / P.a.length) | 0) * 3) % P.b.length] : a;
    var adm = ADMIN[(i * 13 + ((i / 7) | 0) * 5) % ADMIN.length];
    var B = BODIES[bodyKey];
    return base + adm + '（' + (B ? B.name : '') + '分政）';
  }

  /** 固定种子 LCG —— 同一天体每次生成完全相同的一批测站 */
  function lcg(seed) {
    var s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function buildStations() {
    if (!rings || !rings.length || !quake) return [];
    var B = BODIES[cur];
    var M = Math.max(1, Math.min(10, +quake.mag || 0));
    var dep = Math.max(0.5, Math.min(700, isFinite(quake.depthKm) ? +quake.depthKm : 10));
    var R = bodyRadius(), kmPerDeg = Math.PI * R / 180;
    var cosQ = Math.cos(quake.lat * Math.PI / 180);
    var N = (B && B.stations) || 520;
    var rnd = lcg((B && B.seed) || 20261103);
    var EDGES = (global.QV_LIEDU && QV_LIEDU.EDGES) || null;
    var out = [];
    for (var i = 0; i < N; i++) {
      /* 球面均匀：先均匀取 cos(lat)，再均匀取经度 */
      var u = rnd() * 2 - 1;
      var lat = Math.asin(u) * 180 / Math.PI;
      var lon = rnd() * 360 - 180;
      var dy = (lat - quake.lat) * kmPerDeg;
      var dx = (((lon - quake.lon + 540) % 360) - 180) * cosQ * kmPerDeg;
      var dKm = Math.sqrt(dx * dx + dy * dy);
      var I = pfI(dKm, dep, M);
      /* 远处也显示（0 度），这样才「铺满整张星球」 */
      var lv = 0;
      if (EDGES) { for (var k = 1; k < EDGES.length; k++) if (I >= EDGES[k]) lv = k + 1; }
      else lv = Math.max(0, Math.round(I));
      out.push({
        lat: lat, lon: lon, level: Math.max(0, Math.min(12, lv)),
        name: placeName(cur, i), hyp: Math.round(dKm)
      });
    }
    return out;
  }

  /** 模拟速度倍率：1× / 10× / 60× / 300×。立即生效（重发一次波源重置时钟）。 */
  function setSpeed(k) {
    speed = Math.max(1, Math.min(3600, +k || 1));
    try {
      if (global.QVMapCam && QVMapCam.simWave && quake && rings && rings.length) {
        QVMapCam.simWave({
          lat: quake.lat, lon: quake.lon, t0: Date.now(), speed: speed,
          level: rings[rings.length - 1].level,
          mag: quake.mag, depth: quake.depthKm
        });
      }
    } catch (e) { }
    try { if (global.QVMapCam && QVMapCam.refresh) QVMapCam.refresh(); } catch (e) { }
    return speed;
  }

  /* ─────── 视野内动态铺站（2026-11-03）───────
   * 用户：「把整张星球上都铺满，而且要随机放」
   * 固定 520 个全球点在放大后视野里只剩 1 个（实测），根本铺不满。
   * ⇒ 改成【地理锚定网格 + 随机抖动】：网格步长按屏幕像素（≈64px）换算成经纬度，
   *   索引锚在【世界坐标】而不是视野起点 → 拖动/缩放时点不会整体漂移；
   *   抖动与地名都由 (i,j) 哈希决定 ⇒ 稳定不闪。
   */
  var stPool = [], stKey = '';
  var stT0 = 0, stTick = -1;      /* 模拟时钟：测站按 P/S 波到达时间逐个点亮 */
  var lastCam = null, lastVis = null;
  var isSimQuake = false;         /* 当前 quake 是模拟震源（不允许被实时数据覆盖） */

  function mapXToLon(mx) {
    var lon = (mx / 10 + 180) - 44;
    return ((lon + 180) % 360 + 360) % 360 - 180;
  }
  function mapYToLat(my) {
    var t = Math.exp((my + MAPY0) / MAPK);
    return Math.atan(t) * 2 * 180 / Math.PI - 90;
  }
  /** 稳定哈希 → [0,1) */
  function h2(i, j, s) {
    var x = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  function rebuildViewStations(cam, vis) {
    if (!stG) return;
    var px = A * cam.k;
    if (!(px > 0)) return;
    var STEP_PX = 64;
    var dMap = STEP_PX / px;
    var mx0 = MINX + (vis.x0 - cam.tx) / px - dMap;
    var mx1 = MINX + (vis.x1 - cam.tx) / px + dMap;
    var my1 = MAXY - (vis.y0 - cam.ty) / px + dMap;
    var my0 = MAXY - (vis.y1 - cam.ty) / px - dMap;
    var i0 = Math.floor((mx0 - W0) / dMap), i1 = Math.ceil((mx1 - W0) / dMap);
    var j0 = Math.floor((N0 - my1) / dMap), j1 = Math.ceil((N0 - my0) / dMap);
    var ni = i1 - i0 + 1, nj = j1 - j0 + 1;
    if (ni <= 0 || nj <= 0 || ni * nj > 900) return;

    var B = BODIES[cur], accent = (B && B.accent) || '#9fb3c8';
    var M = Math.max(1, Math.min(10, +quake.mag || 0));
    var dep = Math.max(0.5, Math.min(700, isFinite(quake.depthKm) ? +quake.depthKm : 10));
    var R = bodyRadius(), kmPerDeg = Math.PI * R / 180;
    var cosQ = Math.cos(quake.lat * Math.PI / 180);
    var EDGES = (global.QV_LIEDU && QV_LIEDU.EDGES) || null;
    var k = 0;

    for (var j = j0; j <= j1; j++) {
      for (var i = i0; i <= i1; i++) {
        var jx = (h2(i, j, 11) - 0.5) * 0.76;
        var jy = (h2(i, j, 29) - 0.5) * 0.76;
        var lon = mapXToLon(W0 + (i + jx) * dMap);
        var lat = mapYToLat(N0 - (j + jy) * dMap);
        if (!isFinite(lon) || !isFinite(lat) || lat > 84 || lat < -84) continue;
        var dy = (lat - quake.lat) * kmPerDeg;
        var dx = (((lon - quake.lon + 540) % 360) - 180) * cosQ * kmPerDeg;
        var dKm = Math.sqrt(dx * dx + dy * dy);
        var I = pfI(dKm, dep, M);
        var lv = 0;
        if (EDGES) { for (var e = 1; e < EDGES.length; e++) if (I >= EDGES[e]) lv = e + 1; }
        else lv = Math.max(0, Math.round(I));
        lv = Math.max(0, Math.min(12, lv));
        var hot = lv >= 2;
        var col = hot ? lieColor(lv) : accent;
        if (k >= stPool.length) {
          var g0 = document.createElementNS(NS, 'g');
          var c0 = document.createElementNS(NS, 'circle');
          var t0 = document.createElementNS(NS, 'title');
          g0.appendChild(c0); g0.appendChild(t0);
          stG.appendChild(g0);
          stPool.push({ g: g0, c: c0, t: t0 });
        }
        var el = stPool[k++];
        el.g.style.display = '';
        el.now = undefined;          /* 重铺时重置缓存档位，否则新位置不会点亮 */
        el.g.setAttribute('transform', 'translate(' +
          pjX(cam, lon).toFixed(1) + ',' + pjY(cam, lat).toFixed(1) + ')');
        el.d = dKm;                 /* 震中距 —— 算 P/S 波到达时间 */
        el.peak = lv;               /* 该点最终烈度 */
        el.name = placeName(cur, (i * 73 + j * 151) | 0);
        el.c.setAttribute('r', '2.6');
        el.c.setAttribute('fill', accent);
        el.c.setAttribute('stroke', 'rgba(0,0,0,.55)');
        el.c.setAttribute('stroke-width', '0.6');
        el.c.setAttribute('fill-opacity', '0.5');
        el.t.textContent = el.name + '　无感　震中距 ' + Math.round(dKm) + ' km';
      }
    }
    for (; k < stPool.length; k++) stPool[k].g.style.display = 'none';
  }

  /** 相机或震源变了才重铺，并且每秒推一次「点到亮」 */
  function paintStations(cam, vis) {
    if (!stG) return;
    lastCam = cam; lastVis = vis;
    if (!rings || cur === 'earth' || !quake) return;
    /* 测站圆标已经交给 QVMapCam.setStations 了（跟地球同一套），这里不再画 SVG 点 */
    if (overlay === 'station') return;
  }

  /** ★ 天体测站表：与地球 genStations 完全同构，只是坐标/地名来自本天体。
   *  返回 { lat, lon, shindo(烈度1~12), intensity(连续), hyp(震中距km), name }
   *  views.genStations 直接拿它替换地球测站表 → 观测值列表 / 地图圆标 / P-S 波
   *  全部沿用地球那套管线。 */
  function listStations(lat, lon, depthKm, mag, metric) {
    if (!stG || cur === 'earth' || !quake) return [];
    var cam = lastCam, vis = lastVis;
    /* 首次调用时 paint() 可能还没跑过 → lastCam 为 null → 返回空数组 →
       地图上一个圆标都没有。这里从 mapcam 直接取一次相机。 */
    if ((!cam || !vis) && global.QVMapCam && QVMapCam.debug) {
      var d = QVMapCam.debug();
      if (d && isFinite(d.k)) {
        cam = { k: d.k, tx: d.tx, ty: d.ty };
        vis = d.vis;
        lastCam = cam; lastVis = vis;
      }
    }
    if (!cam || !vis) return [];
    var px = A * cam.k;
    if (!(px > 0)) return [];
    var STEP_PX = 64;
    var dMap = STEP_PX / px;
    var mx0 = MINX + (vis.x0 - cam.tx) / px - dMap;
    var mx1 = MINX + (vis.x1 - cam.tx) / px + dMap;
    var my1 = MAXY - (vis.y0 - cam.ty) / px + dMap;
    var my0 = MAXY - (vis.y1 - cam.ty) / px - dMap;
    var i0 = Math.floor((mx0 - W0) / dMap), i1 = Math.ceil((mx1 - W0) / dMap);
    var j0 = Math.floor((N0 - my1) / dMap), j1 = Math.ceil((N0 - my0) / dMap);
    if (i1 - i0 > 60 || j1 - j0 > 60) return [];
    var M = Math.max(1, Math.min(10, +quake.mag || 0));
    var dep = Math.max(0.5, Math.min(700, isFinite(quake.depthKm) ? +quake.depthKm : 10));
    var R = bodyRadius(), kmPerDeg = Math.PI * R / 180;
    var cosQ = Math.cos(quake.lat * Math.PI / 180);
    var EDGES = (global.QV_LIEDU && QV_LIEDU.EDGES) || null;
    var out = [];
    for (var j = j0; j <= j1; j++) {
      for (var i = i0; i <= i1; i++) {
        var jx = (h2(i, j, 11) - 0.5) * 0.76;
        var jy = (h2(i, j, 29) - 0.5) * 0.76;
        var lo = mapXToLon(W0 + (i + jx) * dMap);
        var la = mapYToLat(N0 - (j + jy) * dMap);
        /* genStations 的输出用 lat/lon，这里反过来传 */
        if (!isFinite(lo) || !isFinite(la) || la > 84 || la < -84) continue;
        var dy = (la - quake.lat) * kmPerDeg;
        var dx = (((lo - quake.lon + 540) % 360) - 180) * cosQ * kmPerDeg;
        var dKm = Math.sqrt(dx * dx + dy * dy);
        var I = pfI(dKm, dep, M);
        var lv = 0;
        if (EDGES) { for (var e = 1; e < EDGES.length; e++) if (I >= EDGES[e]) lv = e + 1; }
        else lv = Math.max(0, Math.round(I));
        lv = Math.max(0, Math.min(12, lv));
        out.push({
          lat: la, lon: lo,
          shindo: lv, intensity: I, hyp: Math.round(dKm * 10) / 10,
          name: placeName(cur, (i * 73 + j * 151) | 0),
          cty: 0,
          /* ⚠️ tp/tv 必须显式给 0：tickStations 里 `if (!stT0 || sec < tp) 隐藏`，
             sec = waveSec 只能在 tickWaves 跑时推进，行星模式下它常年是 0 →
             所有测站被永久隐藏（实测「地图上一个点都没有」）。 */
          tp: 0, tv: 0
        });
      }
    }
    out.sort(function (a, b) { return a.hyp - b.hyp; });
    return out;
  }

  /** 逐点算当前烈度：P 波到达→低 2 档，S 波到达→峰值。
   *  只有「档位真的变了」才写 DOM（240 个点 × 60fps 不做优化会卡）。 */
  function tickStationIntensity(sec) {
    var B = BODIES[cur], accent = (B && B.accent) || '#9fb3c8';
    var P_V = 6.5, S_V = 3.9;
    for (var i = 0; i < stPool.length; i++) {
      var el = stPool[i];
      if (!el || !el.name) continue;
      if (el.g.style.display === 'none') continue;
      var d = el.d || 0, peak = (el.peak == null ? 0 : el.peak);
      var tp = d / P_V, tv = d / S_V;
      var now, phase;
      if (sec < tp) { now = -1; phase = '等待 P 波'; }
      else if (sec < tv) { now = Math.max(0, peak - 2); phase = 'P 波到达'; }
      else { now = peak; phase = 'S 波到达'; }
      if (el.now === now) continue;        /* 档位没变 → 不碰 DOM */
      el.now = now;
      var c = el.c, hot = now >= 2;
      c.setAttribute('r', hot ? '5.2' : '2.8');
      c.setAttribute('fill', now < 0 ? accent : (hot ? lieColor(now) : accent));
      c.setAttribute('stroke-width', hot ? '1.4' : '0.6');
      c.setAttribute('fill-opacity', now < 0 ? '0.28' : (hot ? '1' : '0.55'));
      el.t.textContent = el.name + '　' + phase +
        (now >= 2 ? '　烈度 ' + now : '') + '　震中距 ' + Math.round(d) + ' km';
    }
  }

  function applyStations() {
    stKey = '';
    stT0 = Date.now();               /* 模拟时钟从 0 开始 */
    stTick = -1;
    /* 地球测站层一律清空（避免「切了星球还看得见地球测站」） */
    if (global.QVMapCam && QVMapCam.clearStations) QVMapCam.clearStations();
    /* ⚠️ 不再调 QVMapCam.setStations —— 那套的 tickStations 有 stT0 / sec<tp /
       cur<0.2 三道地球专属门槛，混用永远会有一部分点不亮。
       星球模式完全用自己的 SVG 圆标 + 自己的 rAF 循环（见 startLoop）。 */
  }

  /* ═══════ 独立动画循环（2026-11-03）═══════
   * 用户：「换星球最次也是把地球那套全部复制一遍换成火星数据，不能混用的」
   * 关键：**不能挂在 mapcam.paint() 上** —— paint 只在相机变化时跑，
   * 相机一静止，测站就永远停在那一帧（用户说的「根本没动态动过」）。
   * 这里用独立的 requestAnimationFrame，与相机解耦。
   */
  var loopId = 0, stCamKey = '';

  function startLoop() {
    if (loopId) return;
    var step = function () {
      loopId = requestAnimationFrame(step);
      if (cur === 'earth' || !layer || !rings || !quake) return;
      if (overlay !== 'station') return;
      var cam = lastCam, vis = lastVis;
      if (!cam || !vis) return;
      var ck = cam.k.toFixed(4) + ',' + cam.tx.toFixed(0) + ',' + cam.ty.toFixed(0);
      if (ck !== stCamKey) { stCamKey = ck; rebuildViewStations(cam, vis); }
      var sec = stT0 ? ((Date.now() - stT0) / 1000) * speed : 0;
      tickStationIntensity(sec);
    };
    loopId = requestAnimationFrame(step);
  }
  function stopLoop() {
    if (loopId) { cancelAnimationFrame(loopId); loopId = 0; }
  }

  /** 切换天体：'earth' 复原地球，'moon'/'mars' 进入行星模式 */
  function setBody(key) {
    if (!BODIES[key]) return cur;
    if (key === cur) return cur;
    if (!layer) init(host);
    cur = key;
    var isPlanet = (key !== 'earth');
    if (!isPlanet) { quake = null; rings = null; }
    if (layer) {
      layer.style.display = isPlanet ? '' : 'none';
      if (isPlanet) { cells.forEach(function (c) { c.src = ''; }); }
    }
    applyStations();
    if (isPlanet) { startLoop(); } else { stopLoop(); }
    /* ═══ 图层互斥（2026-11-03 用户：「你不加图层检测的吗？切到火星结果还在地球这块填色」）
       地球那几层是**独立 DOM 层**，靠逻辑自己清是清不干净的（render3 每帧都可能重设）：
         #mapcnareas  z=5  中国地级市色块
         #mapisoline  z=7  等烈度线
         #mapoverlay  z=7  震度色块 / 观测点
       混在 #planetlayer(6) 的两侧 → 必须用 CSS 类硬性隐藏，不看逻辑脸色。 */
    var mapEl = document.getElementById('map');
    if (mapEl && mapEl.classList) mapEl.classList.toggle('planet-mode', isPlanet);
    if (isPlanet && global.QVMapCam) {
      try { if (QVMapCam.setAreaFill) QVMapCam.setAreaFill(null); } catch (e) { }
      try { if (QVMapCam.setIsoPoints) QVMapCam.setIsoPoints(null); } catch (e) { }
      try { if (QVMapCam.setBoxes) QVMapCam.setBoxes(null); } catch (e) { }
    }
    if (isPlanet && global.QVShindo) {
      try { if (QVShindo.set) QVShindo.set([]); } catch (e) { }
      try { if (QVShindo.clearPoints) QVShindo.clearPoints(); } catch (e) { }
    }
    /* 行星模式：关掉 kondz-map 瓦片层（被本层遮住了，留着只是白花流量） */
    if (global.QVTiles && global.QVTiles.setEnabled) {
      if (isPlanet) global.QVTiles.setEnabled(false);
      else global.QVTiles.setEnabled(true);
    }
    /* 立即重画一帧：paint 平时只在相机变化时才跑，静态时不会自己刷新 */
    try { if (global.QVMapCam && global.QVMapCam.refresh) global.QVMapCam.refresh(); } catch (e) { }
    try { if (global.QVRedraw) global.QVRedraw(); } catch (e) { }
    return cur;
  }

  function body(k) { return BODIES[k || cur] || BODIES.earth; }
  function isPlanet() { return cur !== 'earth'; }

  /** ★ 左侧「观测震度 / 观测烈度」列表的数据源（天体版）。
   *  只给「已经接到 S 波」且烈度 >= 1 的测站，按震度降序、距离升序，最多 40 条。
   *  这就是用户要的「测站名字生成器 + 震度」直接上列表。 */
  function stationRows() {
    if (cur === 'earth' || !quake) return [];
    var out = [];
    for (var i = 0; i < stPool.length; i++) {
      var el = stPool[i];
      if (!el || !el.name) continue;
      if (el.g.style.display === 'none') continue;
      var now = (el.now == null ? -1 : el.now);
      if (!(now >= 1)) continue;
      out.push({ name: el.name, level: Math.max(1, Math.min(12, Math.round(now))),
        hyp: el.d || 0 });
    }
    out.sort(function (a, b) {
      if (b.level !== a.level) return b.level - a.level;
      return a.hyp - b.hyp;
    });
    return out.slice(0, 40);
  }

  global.QVPlanet = {
    init: init, update: update, setBody: setBody, body: body, isPlanet: isPlanet,
    setQuake: setQuake, setOverlay: setOverlay, setSpeed: setSpeed,
    listStations: listStations, stationRows: stationRows,
    speed: function () { return speed; },
    BODIES: BODIES, fmtDur: fmtDur, pfI: pfI, pfR: pfR,
    rings: function () { return rings; },
    overlay: function () { return overlay; },
    _dbg: function () {
      return { cur: cur, overlay: overlay, rings: rings ? rings.length : 0,
        stList: stList ? stList.length : -1, stEls: stEls.length,
        hasStG: !!stG, quake: quake };
    },
    current: function () { return cur; }
  };
})(window);
