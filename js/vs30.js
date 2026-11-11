/* vs30.js — 场地放大系数（网页版，0.25° 网格，约 81 万格）
 *
 * 数据：app/js/vs30-grid.js（由 dev/vs30-to-grid.py 从 USGS Global Vs30 聚合生成）
 *      没有那个文件 / 加载失败时，QVVS30At() 恒返回 1 → 等于「无场地效应」，
 *      现有行为完全不受影响。
 *      0.25° 时 base64 约 1.05MB，首次调用会同步 atob 解码（约 20~40ms，仅一次）。
 *
 * 用法：
 *   var amp = QVVS30At(lat, lon);       // 放大系数，1.0 = Vs30 760 的基准
 *   // 软土 Vs30=180 → 1.48｜基准 760 → 1.00｜硬岩 1500 → 0.79
 *
 * 公式：Borcherdt 简化式  amp = (760 / Vs30) ^ 0.35
 */
(function (g) {
  var buf = null, tried = false;
  var NEAR = null;                 /* 高精度档（0.1°/0.05°）的元信息 */
  var BUILTIN = null;              /* 内置 0.25° 的原样备份 */
  var TIER = 'builtin';            /* 当前精度档 */
  var AMPC = null;                 /* 预热缓存："lat,lon" → 放大系数（1km 档专用）*/

  function keyOf(lat, lon) { return (Math.round(lat * 1e4) / 1e4) + ',' + (Math.round(lon * 1e4) / 1e4); }

  function decode() {
    if (tried) return buf;
    tried = true;
    var G = g.QV_VS30_GRID;
    if (!G || !G.b64) return (buf = null);    try {
      var s = (g.atob ? g.atob(G.b64) : '');
      if (!s) return (buf = null);
      var n = s.length;
      buf = new Uint8Array(n);
      for (var i = 0; i < n; i++) buf[i] = s.charCodeAt(i);
    } catch (e) {
      buf = null;
    }
    return buf;
  }

  /** 返回该坐标的**放大系数**；无数据时返回 1（不改变任何数值） */
  g.QVVS30At = function (lat, lon) {
    /* ★ 2026-10-28 优先查预热缓存：1km 全量档（692MB）靠这个工作，不整表加载 */
    if (AMPC) {
      var a = AMPC.get(keyOf(lat, lon));
      if (a != null) return a;
    }
    var B = decode(), G = g.QV_VS30_GRID;
    if (!B || !G || !isFinite(lat) || !isFinite(lon)) return 1;
    var step = G.step || 1;
    var r = Math.floor((lat - G.lat0) / step);
    var c = Math.floor((lon - G.lon0) / step);
    if (!(r >= 0 && r < G.rows)) return 1;          /* 纬度越界（极区/南半球高纬） */
    c = ((c % G.cols) + G.cols) % G.cols;            /* 经度回绕 */
    var vs30 = B[r * G.cols + c] * (G.div || 10);
    if (!(vs30 > 0)) return 1;
    if (vs30 < 100) vs30 = 100;
    if (vs30 > 2200) vs30 = 2200;
    return Math.pow(760 / vs30, 0.35);
  };

  /** 调试用：直接返回查到的 Vs30（m/s），查不到返回 null */
  g.QVVS30Value = function (lat, lon) {
    var B = decode(), G = g.QV_VS30_GRID;
    if (!B || !G) return null;
    var step = G.step || 1;
    var r = Math.floor((lat - G.lat0) / step);
    var c = Math.floor((lon - G.lon0) / step);
    if (!(r >= 0 && r < G.rows)) return null;
    c = ((c % G.cols) + G.cols) % G.cols;
    return B[r * G.cols + c] * (G.div || 10);
  };

  /* ══════════════════════════════════════════════════════════════════
     ★★★ 2026-10-28 精度档位切换（向导 / 设置里选完调这里）
        builtin → 回到随包的 0.25°（= 网页版同款）
        d01/d005 → 向主进程要整张网格（0.1° 约 5MB / 0.05° 约 20MB，base64 传过来）
        full（1km，692MB）→ 太大，**不能**整表加载；只能走 amps() 逐点查，
                             目前没有接入渲染层的同步查询，故保持当前档并提示。
     ══════════════════════════════════════════════════════════════════ */
  if (!BUILTIN && g.QV_VS30_GRID) BUILTIN = g.QV_VS30_GRID;

  function applyGrid(obj) {
    g.QV_VS30_GRID = obj;
    buf = null; tried = false;
  }

  g.QVVs30SetTier = function (tier) {
    TIER = tier || 'builtin';
    AMPC = null;
    if (TIER === 'builtin') { if (BUILTIN) applyGrid(BUILTIN); NEAR = null; return Promise.resolve('builtin'); }
    var S = g.qv && g.qv.vs30;
    if (!S || typeof S.grid !== 'function') return Promise.resolve(null);
    if (TIER === 'full') {
      /* 1km：692MB 不可能整表进渲染进程 → 不拉网格，交给 QVVs30Prime 批量预热 */
      NEAR = null;
      return Promise.resolve('full');
    }
    return S.grid(TIER).then(function (r) {
      if (!r) return null;
      applyGrid({
        lat0: r.lat0, lon0: r.lon0, lat1: 84, lon1: 180,
        step: r.step, rows: r.rows, cols: r.cols, div: r.div || 10, b64: r.bytes
      });
      NEAR = r;
      return TIER;
    }, function (e) {
      try { console.warn('[vs30] 该档无法整表加载：' + (e && e.message || e)); } catch (e2) { }
      return null;
    });
  };

  /**
   * 批量预热放大系数（任意档位都行，包括 1km）
   * —— 主进程按行窗口读文件，内存占用极小；结果进 AMPC，之后 QVVS30At 同步命中。
   * @param {Array<[number,number]>} coords [lat, lon] 列表
   */
  g.QVVs30Prime = function (coords) {
    var S = g.qv && g.qv.vs30;
    if (!S || typeof S.amps !== 'function' || !coords || !coords.length) return Promise.resolve(0);
    if (TIER === 'builtin') return Promise.resolve(0);
    var uniq = [], seen = {};
    for (var i = 0; i < coords.length; i++) {
      var la = +coords[i][0], lo = +coords[i][1];
      if (!isFinite(la) || !isFinite(lo)) continue;
      var k = keyOf(la, lo);
      if (seen[k]) continue;
      seen[k] = 1; uniq.push({ k: k, p: [la, lo] });
    }
    if (!uniq.length) return Promise.resolve(0);
    var out = new Map();
    var CHUNK = 3000, idx = 0;
    function step() {
      if (idx >= uniq.length) { AMPC = out; return uniq.length; }
      var part = uniq.slice(idx, idx + CHUNK); idx += CHUNK;
      return S.amps(TIER, part.map(function (u) { return u.p; })).then(function (arr) {
        if (arr && arr.length === part.length) {
          for (var j = 0; j < part.length; j++) if (arr[j] != null) out.set(part[j].k, arr[j]);
        }
        return step();
      });
    }
    return Promise.resolve().then(step);
  };

  g.QVVs30Tier = function () { return TIER; };
})(window);
