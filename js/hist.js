/* hist.js —— 历史地震（日本气象厅 震度データベース）
 *
 * 为什么需要它：JMA 的实时 `bosai/quake/data/list.json` 只保留约 1 个月明细，
 *   所以「2011-03-11 東北地方太平洋沖地震（311）」这类历史大地震在实时源里根本找不到，
 *   以前只能靠【手写假数据】演示 —— 用户否掉了：「都不至于搞个模拟地震加个测试的环境」。
 *
 * 官方确实有历史数据：気象庁「震度データベース検索」（1919-01-01 至今，含 311）。
 *   接口：POST https://www.data.jma.go.jp/eqdb/data/shindo/api/
 *         FormData: mode=event & id=<YYYYMMDDhhmmss><シリアル>
 *   返回：{ res:{ hyp:[{name,lat,lon,dep,mag,maxI,ot}],
 *                int:[{name,lat,lon,code,char,mark,int}] }, str:"..." }
 *   ★★ int[] 的每一项就是【一个观测点】，自带 lat/lon —— 这是关键：
 *      不需要任何「区域名 ↔ 市区町村名」的对应表，直接拿观测点坐标对
 *      QV_SHINDO_AREAS 的多边形做点在多边形内判定，就能得出
 *      「細分区域 → 该区域内观测到的最大震度」。
 *   ★ 跨域实测：data.jma.go.jp 对 /eqdb/data/shindo/* 回了 CORS 头，
 *      所以页面可以直接 fetch（不需要代理、不需要后端）。
 *
 * 用法：
 *   QVHist.show('20110311144618')   // 拉数据 → 顶上主卡片 → 地图色块 + 官方震度标
 *   QVHist.clear()                  // 撤销，回到实时数据
 *   QVHist.probe()                  // 调试：区域覆盖率 / 未命中的观测点
 */
(function (g) {
  'use strict';
  var EQDB = 'https://www.data.jma.go.jp/eqdb/data/shindo/api/';

  /* JMA 震度数据ベース的 char 码 → 本项目震度编码
     ★ 后面全用 QV_SC_SUF（官方造型后缀）取色/取标记，所以这里只要落在同一套里就行：
       A=5弱→50、B=5強→55、C=6弱→60、D=6強→65、7=震度7→70
       （震度7 是 70 不是 7：QV_SC_SUF(70)="9"=震度7 造型，而 7 会被当成 6弱） */
  var CH2V = { '1': 1, '2': 2, '3': 3, '4': 4, 'A': 50, 'B': 55, 'C': 60, 'D': 65, '7': 70 };

  var A = g.QV_SHINDO_AREAS || { areas: {} };
  var AREAS = A.areas || {};

  /* ---------------- 区域多边形：bbox 预筛 + 射线法 ---------------- */
  var bbox = null, ctr = null;
  function buildIndex() {
    if (bbox) return;
    bbox = {}; ctr = {};
    for (var c in AREAS) {
      var polys = AREAS[c].p || [], b = null;
      for (var i = 0; i < polys.length; i++) {
        var f = polys[i];
        for (var j = 0; j < f.length; j += 2) {
          var x = f[j], y = f[j + 1];
          if (!b) b = [x, y, x, y];
          else {
            if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
            if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
          }
        }
      }
      if (b) { bbox[c] = b; ctr[c] = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }
    }
  }
  /** 射线法（ring = [lon,lat,lon,lat,...]，首尾不必闭合） */
  function inRing(x, y, f) {
    var inside = false, n = f.length;
    for (var i = 0, j = n - 2; i < n; j = i, i += 2) {
      var xi = f[i], yi = f[i + 1], xj = f[j], yj = f[j + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function areaOf(lon, lat) {
    buildIndex();
    for (var c in bbox) {
      var b = bbox[c];
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      var polys = AREAS[c].p;
      for (var i = 0; i < polys.length; i++) if (inRing(lon, lat, polys[i])) return c;
    }
    return null;
  }
  /** 兜底：多边形没命中时，取最近区域中心（限距，避免把外海/未建模区域乱并进来） */
  function nearArea(lon, lat, maxDeg) {
    buildIndex();
    var best = null, bd = maxDeg * maxDeg;
    for (var c in ctr) {
      var dx = ctr[c][0] - lon, dy = ctr[c][1] - lat, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /* ---------------- 311 的海啸（官方 2011/03/11 14:49 発表・15:30 更新） ----------------
   * JMA 的实时海啸 list.json 只保留【最近一次】→ 历史事件必须自己把当时那份带过来。
   * 官方当时：岩手・宮城・福島 = 大津波警報（lv4），北海道〜千葉・伊豆〜沖縄一片警报/注意报。
   * 走 QData.simTsunami 这个「覆盖真值」的钩子（它本来就是干这个的），clear() 时还原。
   * 用户原话：「M9.0 24KM 没有海啸预警，开玩笑」—— 这条就是为了它。 */
  var TSU311 = (function () {
    var CN = { 4: '大海啸警报', 3: '海啸警报', 2: '海啸注意报' };
    function it(name, lv, h) {
      return { code: '', name: name, grade: lv, gradeName: CN[lv], raw: CN[lv], height: h,
        firstCond: 'ただちに津波襲来と予想', firstAt: '2011/03/11 14:49',
        maxCond: '津波到達中と推測', maxAt: '2011/03/11 15:30' };
    }
    return {
      ttl: '津波警報（大津波）', ttlEn: 'Major Tsunami Warning', ift: '',
      at: '2011/03/11 14:49', anm: '三陸沖', anmEn: 'SANRIKU OKI', mag: 9.0,
      cod: '+38.1+142.9/', lat: 38.103, lon: 142.86, atMs: Date.parse('2011-03-11T14:49:00+09:00'),
      maxLv: 4, height: '10m<',
      head: '岩手県 宮城県 福島県に大津波警報（予想される津波の高さ 10m以上）',
      items: [it('岩手県', 4, '10m<'), it('宮城県', 4, '10m<'), it('福島県', 4, '10m<'),
        it('茨城県', 3, '10m'), it('千葉県九十九里・外房', 3, '10m'), it('北海道太平洋沿岸中部', 3, '3m'),
        it('青森県太平洋沿岸', 3, '3m'), it('静岡県', 3, '3m'), it('高知県', 3, '3m'),
        it('東京湾内湾', 2, '0.2m')]
    };
  })();

  /* ---------------- 拉历史地震 ---------------- */
  function fetchEvent(id) {
    var fd = new FormData();
    fd.append('mode', 'event');
    fd.append('id', String(id));
    return fetch(EQDB, { method: 'POST', body: fd, cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('eqdb HTTP ' + r.status); return r.json(); });
  }

  /** JMA 震度DB 的一条 → 本项目条目 + 区域震度 + 观测点
   *  ★ 同时算两种：{code,shindo} 给色块层，observations 给观测点层。 */
  function parse(id, d) {
    var res = (d && d.res) || {};
    var hyp = (res.hyp || [])[0] || {};
    var sts = res.int || [];
    var maxByArea = {}, obs = [], miss = 0, hits = 0;
    for (var i = 0; i < sts.length; i++) {
      var s = sts[i];
      var v = CH2V[String(s.char || '').trim()];
      var lat = parseFloat(s.lat), lon = parseFloat(s.lon);
      if (!isFinite(lat) || !isFinite(lon)) continue;
      var code = areaOf(lon, lat);
      if (!code) { code = nearArea(lon, lat, 0.35); if (code) hits++; else { miss++; continue; } }
      else hits++;
      if (v == null) continue;                        /* 震度不明/1未満：不画，但仍参与区域归属统计 */
      var cur = maxByArea[code];
      if (cur === undefined || v === 7 || (cur !== 7 && v > cur)) maxByArea[code] = v;
      obs.push({ lat: lat, lon: lon, v: v, name: s.name || '', code: String(s.code || ''),
        area: code, areaName: (AREAS[code] && AREAS[code].name) || '', city: '' });
    }
    var areas = [];
    for (var c in maxByArea) areas.push({ code: c, shindo: maxByArea[c] });
    /* 震源时间：ot 形如 "2011/03/11 14:46:18.1"（JST） */
    var ms = 0, m = /^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(hyp.ot || ''));
    if (m) ms = Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + '+09:00');
    var q = {
      id: 'JMA:hist:' + id, src: 'JMA', feed: 'jma', hist: 1,
      /* ★★ metric：JMA 震度数据库给的是【震度】，不是烈度。
         不写这一条会被 metricOf() 当成外国机构报的烈度 → 主卡显示「最大烈度 10」。
         （用户：「为什么用的竟然是烈度，这不是日本吗？」） */
      metric: 'shindo',
      timeMs: ms, pubMs: ms,
      place: hyp.name || '', mag: parseFloat(hyp.mag), depthKm: parseFloat(hyp.dep),
      lat: parseFloat(hyp.lat), lon: parseFloat(hyp.lon),
      detailJson: 'hist:' + id, detail: '', alts: []
    };
    /* 震源的最大震度：hyp.maxI 是 "震度７" 这种汉字串 → 换成 char 再取值 */
    var HAN = { '震度７': '7', '震度６強': 'D', '震度６弱': 'C', '震度５強': 'B', '震度５弱': 'A',
      '震度４': '4', '震度３': '3', '震度２': '2', '震度１': '1' };
    var histMax = CH2V[HAN[hyp.maxI] || ''];
    /* ⚠️ 取最大震度必须按【序号】比：本项目编码 7=震度7 但数值比 65(6強) 小，
       直接 Math.max 会把 311 的震度7 吃掉、显示成 6強。 */
    function rk(v) {
      return (g.QVShindo && g.QVShindo.rankOf) ? g.QVShindo.rankOf(v) : (v === 7 ? 9 : (v >= 65 ? 8 : (v >= 60 ? 7 : (v >= 55 ? 6 : (v >= 50 ? 5 : (v >= 0 ? v : 0))))));
    }
    var mx = -1;
    for (var k in maxByArea) if (rk(maxByArea[k]) > rk(mx)) mx = maxByArea[k];
    var histMax2 = (rk(histMax) > rk(mx)) ? histMax : mx;
    q.maxShindo = (histMax2 >= 0 ? histMax2 : -1); q.shindo = q.maxShindo;
    /* 主卡「海啸」条读的是【地震对象自己的 tsunami 字段】（render3 L708）：
       0=无、1=注意报、>=2=警报。311 官方是大津波警报 → 3。
       （用户：「M9.0 24KM 没有海啸预警，开玩笑」） */
    q.tsunami = (id === '20110311144618') ? 3 : 0;
    return { q: q, areas: areas, stations: obs,
      tsunami: (id === '20110311144618') ? TSU311 : null,
      stat: { total: sts.length, hit: hits, miss: miss, areas: areas.length } };
  }

  /* ---------------- 接入 App（不改造现有渲染链路） ----------------
   * render3.syncAreas(q) 只认 q.detailJson 这一把钥匙：
   *   → 我们把历史地震的 detailJson 设成 'hist:<id>'，再包一层 QData.loadAreas/loadStations，
   *     命中 hist: 就直接返回本地算好的数组，其余照旧走 JMA 明细 JSON。
   * 主卡片：把 QData.get() 的 list 前面插一条历史条目（用原型继承，不动原对象）。
   *   ⇒ 官方那套「色块 + 观测点 + 主卡片」全部原样复用，一行渲染代码都不用改。 */
  var CACHE = {};          /* 'hist:<id>' → {areas, stations} */
  var CUR = null;          /* 当前展示的历史条目 */
  var seq = 0;             /* ★ 每次 show() 自增：迫使 render3 的 lastAreaKey 变化 */
  var patched = false;
  function cacheOf(k) {
    if (!k || k.lastIndexOf('hist:', 0) !== 0) return null;
    var mm = /^hist:([^#]+)/.exec(k);
    return mm ? CACHE['hist:' + mm[1]] : null;
  }
  function patch() {
    if (patched || !g.QData) return;
    patched = true;
    var _la = g.QData.loadAreas, _ls = g.QData.loadStations, _get = g.QData.get;
    g.QData.loadAreas = function (q) {
      var c = cacheOf(q && q.detailJson);
      return c ? Promise.resolve(c.areas) : _la.apply(g.QData, arguments);
    };
    g.QData.loadStations = function (q) {
      var c = cacheOf(q && q.detailJson);
      return c ? Promise.resolve(c.stations) : _ls.apply(g.QData, arguments);
    };
    g.QData.get = function () {
      var s = _get.call(g.QData);
      if (!CUR) return s;
      var o = Object.create(s);          /* 继承全部字段，只覆盖 list */
      o.list = [CUR].concat(s.list || []);
      return o;
    };
  }

  function show(id) {
    patch();
    return load(id).then(function (r) {
      /* ★★ 每次 show 给 detailJson 挂个自增后缀：
         render3.syncAreas 是按 `q.detailJson` 缓存（lastAreaKey）的，键不变就整层不重画
         → 第二次 show 会只剩底图（色块/标记都不刷）。
         加载器已改成按 `hist:` 前缀匹配缓存，所以加后缀不会影响取数。 */
      r.q.detailJson = 'hist:' + id + '#' + (++seq);
      CUR = r.q;
      CACHE['hist:' + id] = { areas: r.areas, stations: r.stations };
      /* 历史事件自带海啸（311 = 大津波警报）；不需要就传 null */
      if (g.QData && g.QData.simTsunami) g.QData.simTsunami(r.tsunami || null);
      if (g.QVShindo) g.QVShindo.clear();
      /* ★ 2026-10-27：用户手动挑历史地震 → 释放真实 EEW 钉住的震源红叉，
         否则红叉会一直停在上一场速报的震源上（lockPin 优先级高于 render3）。 */
      if (g.QVMapCam && g.QVMapCam.lockPin) { try { g.QVMapCam.lockPin(null); } catch (eLk) { } }
      if (g.QVMapCam && g.QVMapCam.focus) { try { g.QVMapCam.focus(r.q, true); } catch (e) { } }
      if (g.QVRedraw) g.QVRedraw();
      /* ★ 兜底自愈：启动过程中（boot 的首次 render / bootFit）偶尔会把这一帧的重绘吃掉，
         出现「卡片对了但色块层还空着」。这里 1.2s 后检查一次，空就再顶一次键重绘。 */
      setTimeout(function () {
        if (CUR !== r.q) return;
        var h = document.getElementById('mapareas');
        if (h && !h.querySelector('path')) {
          r.q.detailJson = 'hist:' + id + '#' + (++seq);
          if (g.QVRedraw) g.QVRedraw();
        }
      }, 1200);
      return r;
    });
  }
  function clear() {
    CUR = null;
    if (g.QData && g.QData.simTsunami) g.QData.simTsunami(null);
    if (g.QVShindo) { g.QVShindo.clear(); if (g.QVShindo.clearPoints) g.QVShindo.clearPoints(); }
    if (g.QVRedraw) g.QVRedraw();
  }
  /** ★★★ 2026-10-21 用户：「模拟地震震度速报和正式报在 Tab1 页面被真的覆盖了，
     导致看不出来，就有个声音」
     —— 模拟地震是 QData.inject() 塞进 list 的，下一次 refresh() 就把它冲掉了，
        所以 Tab1 的主体变成了真实那条地震，模拟结果看不见。
     ⇒ 把模拟地震直接顶成 CUR：patch() 会让 QData.get() 把它插到 list 最前，
       pick() 自然就选它。传 null 可解除（新地震来时由 setEEW 负责解）。 */
  function setCurrent(q) {
    if (!q) { CUR = null; if (g.QVRedraw) g.QVRedraw(); return; }
    patch();
    CUR = q;
    if (g.QVRedraw) g.QVRedraw();
  }
  function load(id) {
    if (CACHE['hist:' + id] && CACHE['hist:' + id].parsed) return Promise.resolve(CACHE['hist:' + id].parsed);
    return fetchEvent(id).then(function (d) {
      var r = parse(id, d);
      CACHE['hist:' + id] = { areas: r.areas, stations: r.stations, parsed: r };
      return r;
    });
  }

  g.QVHist = { show: show, clear: clear, setCurrent: setCurrent, load: load, parse: parse, areaOf: areaOf,
    /** 调试：当前区域覆盖率（哪些观测点没落进任何区域多边形） */
    probe: function (id) {
      return load(id).then(function (r) {
        var un = [];
        for (var i = 0; i < r.stations.length; i++) if (!r.stations[i].area) un.push(r.stations[i].name);
        return { stat: r.stat, areas: r.areas.length, q: r.q, unassigned: un.slice(0, 20) };
      });
    } };
})(window);
