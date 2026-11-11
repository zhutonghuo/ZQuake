/* coast-base.js —— 底图海岸线（按【官方 nf 层】的规格自己描一遍）
 *
 * 2026-11-03 用户：「海岸线可以加粗一点吗，现在的太细了」→「直接去看官方的多粗得了」
 *
 * 官方原始值（assets/maptiles/coast/5324ba….svg 里直接读出来的，不是猜的）：
 *   <svg width="957.28" height="580.905" viewBox="0,0,957.28,580.905">
 *   <g fill="none" stroke="#dce3ff" stroke-opacity="0.9"
 *      stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
 *   ⇒ 线宽 1.5 = **图集 px**（1 图集单位 = 0.1°），随相机缩放：
 *        屏幕上 = 1.5 × k  px   （k=0.47 全国 ≈ 0.7px ／ k=2.4 关东 ≈ 3.6px）
 *
 * 为什么不用官方 nf 那 18 张 SVG：
 *   · 自建底图（kondz-map PNG 瓦片）已经把官方 6 层全关了，官方 nf 的位置对不上；
 *   · 而且 nf 的 stroke-width 写死在 SVG 里，CSS 改不动（只能重做素材）。
 *   ⇒ 用 js/coast-geo.js 里现成的全球 Natural Earth 10m 海岸线（与震度色块同一套
 *     图集投影，tsu-coast 已经验证过贴合），按官方规格重新描一遍。
 *
 * 性能：全球 21.7 万点、path 3.3MB，整张一次性插进去实测 +6ms/帧（60→44fps）。
 *   ⇒ 只画【视野内】的段（按省域 bbox 粗筛），相机停下 250ms 后重建一次。
 *     视野外的段根本不进 DOM，正常缩放/拖动都是几十~几百段。
 */
(function (g) {
  'use strict';

  var COL = '#dce3ff';     /* 官方 nf 描边色 */
  var OP = 0.9;            /* 官方 stroke-opacity */
  var WID = 1.5;           /* 官方 stroke-width（图集 px，随 k 缩放） */

  var host = null;
  var SEG = null;          /* [{d, b:[x0,y0,x1,y1]}] —— 懒解码，只解一次 */
  var lastHtml = '';
  var lastAt = 0;
  var lastBox = null;
  var building = false;

  /** 21.7 万点解码约 190ms → 丢到 idle 里做一次，别卡首帧 */
  function ensureSeg() {
    if (SEG) return true;
    if (building) return false;
    building = true;
    var run = function () {
      SEG = build();
      building = false;
      lastBox = null;
      if (g.QVRedraw) { try { g.QVRedraw(); } catch (e) { } }
    };
    if (g.requestIdleCallback) g.requestIdleCallback(run, { timeout: 2500 });
    else setTimeout(run, 800);
    return false;
  }

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

  /** 解码全球海岸线 → [{d, b}]（约 190ms，只做一次） */
  function build() {
    var G = g.QV_COAST_GEO;
    if (!G || !G.L) return [];
    var K = G.K || 4;
    var parts = String(G.L).split(';');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var ch = parts[i];
      if (!ch) continue;
      var p = ch.indexOf('~');
      if (p < 0) continue;
      var arr = ch.slice(p + 1).split(',');
      var px = 0, py = 0;
      var curD = '', curPts = [];
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      var nSeg = 0, lastX = null;

      function flush() {
        if (nSeg >= 2) {
          out.push({ d: curD, b: [x0, y0, x1, y1], pts: curPts });
        }
        curD = ''; curPts = [];
        x0 = 1e9; y0 = 1e9; x1 = -1e9; y1 = -1e9;
        nSeg = 0; lastX = null;
      }

      for (var j = 0; j < arr.length; j++) {
        var t = arr[j];
        if (!t) continue;
        var q = t.indexOf('.');
        if (q < 0) continue;
        px += b36(t.slice(0, q));
        py += b36(t.slice(q + 1));
        var x = px / K, y = py / K;
        /* ★ 2026-10-29: 跨越经度缝（~36000px 大跳跃）时切断为独立线段，杜绝横贯世界的异常白线 */
        if (lastX !== null && Math.abs(x - lastX) > 5000) {
          flush();
        }
        curD += (nSeg === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
        curPts.push(x, y);
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        nSeg++;
        lastX = x;
      }
      flush();
    }
    return out;
  }

  function ensureHost() {
    if (host && host.parentNode) return host;
    var mv = document.getElementById('mapoverlay');
    if (!mv) return null;
    host = document.createElement('div');
    host.id = 'basecoast';
    /* z=5：官方顺序是 nb(陆) → 震度色块 → nf(海岸线)，
       所以海岸线要压在 #mapareas(z=4) 之上、#tsucoast(z=6) 之下。 */
    host.style.cssText = 'position:absolute;left:0;top:0;width:2596px;height:2651px;' +
      'pointer-events:none;z-index:5;overflow:visible';
    mv.appendChild(host);
    return host;
  }

  /** 视野（图集像素坐标）+ 留一圈余量 —— 拖动时不用每帧重建 */
  function viewBox(VIS) {
    var M = g.QVMapCam;
    if (!M || !M.toAtlasXY) return null;
    var a = M.toAtlasXY(VIS.x0, VIS.y0);
    var b = M.toAtlasXY(VIS.x1, VIS.y1);
    var x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
    var y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    var mx = (x1 - x0) * 0.6, my = (y1 - y0) * 0.6;
    return [x0 - mx, y0 - my, x1 + mx, y1 + my];
  }

  function render(box) {
    var h = ensureHost();
    if (!h) return;
    if (!ensureSeg()) return;
    if (!SEG.length) return;
    var out = '';
    /* ★ 世界在 x 上每 3600 图集单位重复一次（与 clampT 的周期一致）→ 三个相位都画 */
    for (var ph = -1; ph <= 1; ph++) {
      var dx = ph * 36000;    /* 图集 px 周期 = 3600 单位 × A(10) */
      for (var i = 0; i < SEG.length; i++) {
        var s = SEG[i], bb = s.b;
        if (bb[2] + dx < box[0] || bb[0] + dx > box[2]) continue;
        if (bb[3] < box[1] || bb[1] > box[3]) continue;
        out += (dx ? '<g transform="translate(' + dx + ',0)">' : '<g>') +
          '<path d="' + s.d + '" fill="none"/></g>';
      }
    }
    if (out === lastHtml) return;
    lastHtml = out;
    h.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;left:-3600px;' +
      'top:-1200px;overflow:visible" width="7200" height="4200" viewBox="-3600 -1200 7200 4200">' +
      '<g fill="none" stroke="' + COL + '" stroke-opacity="' + OP + '" stroke-width="' + WID +
      '" stroke-linecap="round" stroke-linejoin="round">' + out + '</g></svg>';
  }

  /**
   * 每帧由 mapcam.paint() 调用：相机停了 250ms 才重建一次；
   * 缩放到跨档（k 变 1.6 倍以上）或视野移出上次范围才真的重建。
   */
  function update(cam, VIS, force) {
    if (!g.QV_COAST_GEO) return;
    if (!cam || !VIS || !(cam.k > 0)) return;
    if (!force && g.QVMapCam && g.QVMapCam.isDragging && g.QVMapCam.isDragging()) return;
    var now = Date.now();
    if (!force && now - lastAt < 250 && lastBox) return;
    var box = viewBox(VIS);
    if (!box) return;
    if (!force && lastBox) {
      var same = Math.abs(box[0] - lastBox[0]) < 1 && Math.abs(box[1] - lastBox[1]) < 1 &&
        Math.abs(box[2] - lastBox[2]) < 1 && Math.abs(box[3] - lastBox[3]) < 1;
      if (same) return;
    }
    lastAt = now;
    lastBox = box;
    render(box);
  }

  /* ══════════════════════════════════════════════════════════════
   * 视线阻挡（Line of Sight / raycasting）—— 海啸「穿墙」的正解
   *
   * 用户 2026-11-03 给了三条路，选这条：几何我们已经有了（coast-geo 的
   * 全球 Natural Earth 10m 海岸线，21.6 万点），不用引 Turf.js、不用造网格。
   *
   * 判据：从震源到目标沿岸点连一条直线，数它**穿过海岸线几次**。
   *   · 0 次 → 全程开阔海面 → 海啸能直接到
   *   · ≥2 次（进陆 + 出陆）→ 中间翻过陆地 → 挡掉
   * 这比旧的「沿直线撒点、陆地占比 ≤12% 就算通」严格得多：
   *   旧法会被窄地峡 / 半岛尖端骗过去（东京湾 → 上海横穿整个本州只撒到几个陆地点）。
   * 而且天然覆盖朝鲜半岛、台湾、菲律宾这些旧法按「海」处理的地方。
   * ══════════════════════════════════════════════════════════════ */
  /** 线段 AB 与 CD 求交，返回交点在 AB 上的参数 t∈[0,1]；不相交返回 -1 */
  function segT(ax, ay, bx, by, cx, cy, dx, dy) {
    var rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
    var den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return -1;
    var t = ((cx - ax) * sy - (cy - ay) * sx) / den;
    var u = ((cx - ax) * ry - (cy - ay) * rx) / den;
    if (t < -1e-9 || t > 1 + 1e-9) return -1;
    if (u < -1e-9 || u > 1 + 1e-9) return -1;
    return t;
  }

  /* ── 球面几何（坑 1：墨卡托上画直线，几百公里以上就错得离谱） ── */
  var D2R = Math.PI / 180, R_EARTH = 6371.0088;
  function gcKm(aLat, aLon, bLat, bLon) {
    var dLat = (bLat - aLat) * D2R, dLon = (bLon - aLon) * D2R;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(aLat * D2R) * Math.cos(bLat * D2R) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /** 大圆（正交航线）插值：f=0 → 起点，f=1 → 终点 */
  function gcPoint(aLat, aLon, bLat, bLon, f) {
    var d = gcKm(aLat, aLon, bLat, bLon) / R_EARTH;
    if (!(d > 1e-9)) return [aLat, aLon];
    var la1 = aLat * D2R, lo1 = aLon * D2R, la2 = bLat * D2R, lo2 = bLon * D2R;
    var sd = Math.sin(d), A = Math.sin((1 - f) * d) / sd, B = Math.sin(f * d) / sd;
    var x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    var y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    var z = A * Math.sin(la1) + B * Math.sin(la2);
    var lat = Math.atan2(z, Math.sqrt(x * x + y * y)) / D2R;
    var lon = Math.atan2(y, x) / D2R;
    return [lat, lon];
  }

  /**
   * 震源 → 目标 的【海路】情况。
   *   · 路径 = **大圆**（不是墨卡托上的一条直线），每 ~100km 取一点，
   *     每小段都在图集坐标里做「与海岸线求交」——小段只有 100km，投影误差可忽略。
   *   · 返回 { n: 穿越次数, landKm: 最长一段连续陆地, ok: 海路是否通 }
   *     返回 -1 = 几何还没准备好（调用方退回旧算法）。
   *
   * ⚠️ 只数次数不行（实测）：东京湾→上海 34 次 ／ 三陸沖→上海 12 次 ／ 三陸沖→仙台 3 次。
   *   ⇒ 真正该判的是「中间有没有**一整段长陆地**」：横穿本州 ≈ 300km，琉球小岛只有几公里。
   */
  function pathInfo(aLat, aLon, bLat, bLon) {
    var M = g.QVMapCam;
    if (!M || !M.at) return -1;
    if (!SEG && !ensureSeg()) return -1;
    if (!SEG || !SEG.length) return -1;

    var totalKm = gcKm(aLat, aLon, bLat, bLon);
    if (!(totalKm > 1)) return { n: 0, landKm: 0, ok: true };
    var N = Math.max(1, Math.min(220, Math.round(totalKm / 100)));

    /* ① 大圆采样 + 转图集坐标（顺带解经度环绕，保证 x 连续） */
    var P = [], i;
    for (i = 0; i <= N; i++) {
      var ll = gcPoint(aLat, aLon, bLat, bLon, i / N);
      var q = M.at(ll[0], ll[1]);
      if (!q || !isFinite(q[0])) return -1;
      if (P.length) {
        var pe = P[P.length - 1];
        while (q[0] - pe[0] > 18000) q[0] -= 36000;
        while (pe[0] - q[0] > 18000) q[0] += 36000;
      }
      P.push(q);
    }
    /* ② 整体包围盒 → 一次粗筛出候选海岸线段 */
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (i = 0; i < P.length; i++) {
      if (P[i][0] < x0) x0 = P[i][0]; if (P[i][0] > x1) x1 = P[i][0];
      if (P[i][1] < y0) y0 = P[i][1]; if (P[i][1] > y1) y1 = P[i][1];
    }
    var cand = [];
    for (i = 0; i < SEG.length; i++) {
      var bb = SEG[i].b;
      if (bb[2] < x0 || bb[0] > x1 || bb[3] < y0 || bb[1] > y1) continue;
      cand.push(SEG[i]);
    }
    /* ③ 逐小段求交，交点换算成「沿路径的公里数」 */
    var stepKm = totalKm / N;
    var hits = [];
    for (i = 0; i < N; i++) {
      var A = P[i], B = P[i + 1];
      var sx0 = Math.min(A[0], B[0]), sx1 = Math.max(A[0], B[0]);
      var sy0 = Math.min(A[1], B[1]), sy1 = Math.max(A[1], B[1]);
      for (var c = 0; c < cand.length; c++) {
        var s = cand[c], sb = s.b;
        if (sb[2] < sx0 || sb[0] > sx1 || sb[3] < sy0 || sb[1] > sy1) continue;
        var p = s.pts;
        for (var j = 0; j + 3 < p.length; j += 2) {
          var t = segT(A[0], A[1], B[0], B[1], p[j], p[j + 1], p[j + 2], p[j + 3]);
          if (t >= 0) hits.push((i + t) * stepKm);
        }
      }
    }
    if (!hits.length) return { n: 0, landKm: 0, ok: true };
    hits.sort(function (a, b) { return a - b; });
    /* 省界共享端点 / 同一处海岸线多点 → 50km 内算同一次穿越 */
    var uniq = [hits[0]];
    for (i = 1; i < hits.length; i++) if (hits[i] - uniq[uniq.length - 1] > 50) uniq.push(hits[i]);
    /* 起点在海上 → 陆段 = [h(2k), h(2k+1)] */
    var maxLand = 0;
    for (i = 0; i + 1 < uniq.length; i += 2) {
      var run = uniq[i + 1] - uniq[i];
      if (run > maxLand) maxLand = run;
    }
    return { n: uniq.length, landKm: maxLand, ok: !(maxLand > 150) };
  }

  /** 兼容旧调用点：只问「通不通」 */
  function crossings(aLat, aLon, bLat, bLon) {
    var r = pathInfo(aLat, aLon, bLat, bLon);
    return (r === -1) ? -1 : r;
  }

  g.QVCoastBase = { update: update, pathInfo: pathInfo, crossings: crossings,
    gcKm: gcKm, color: COL, width: WID,
    _ready: function () { return !!SEG; }, _warm: function () { return ensureSeg(); } };
})(window);
