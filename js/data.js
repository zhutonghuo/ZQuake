/* data.js — 公开地震数据源聚合（网络由 Electron 主进程代取） */
(function (g) {
  'use strict';
  var CORS = 'https://api.allorigins.win/raw?url=';   // 浏览器直开时的回退代理

  /* ★ fetch() 本身【没有】timeout 参数！
   *   Electron 分支的超时靠主进程的 https.get({timeout})，
   *   浏览器分支以前完全裸奔 → 实测 GDACS 单次挂到 33.5 s。
   *   而 refresh() 是 Promise.all 全等待，一个源卡住 = 整份列表 33 秒不更新。
   */
  function fetchTO(url, ms) {
    var ctl = ('AbortController' in g) ? new g.AbortController() : null;
    var tid = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 12000);
    var stop = function () { clearTimeout(tid); };
    return fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { stop(); return j; }, function (e) { stop(); throw e; });
  }

  function fetchJSON(url, timeout) {
    var ms = timeout || 12000;
    if (g.qv && g.qv.net && g.qv.net.json) return g.qv.net.json(url, ms);
    /* 浏览器回退：先直连；**只有被 CORS 挡住**（TypeError）才用公共代理重试一次。
       超时/网络错误不重试 —— 否则最坏等待时间直接翻倍。
       ⚠️ 代理重试**只给一半预算**（上限 6s）：它只是「捡回来」用的，
          代理本身也不通时最多拖 6s，不至于把一个源拖到 12s 卡住 Promise.all
          （实测踩过：cwa_eew 被 CORS 挡 → 代理 ERR_ABORTED 等了 12s）。 */
    return fetchTO(url, ms).catch(function (e) {
      if (!/^https?:/i.test(url) || !(e instanceof TypeError)) throw e;
      return fetchTO(CORS + encodeURIComponent(url), Math.min(ms, 6000)).catch(function () { throw e; });
    });
  }
  function pick(o) { for (var i = 1; i < arguments.length; i++) { var k = arguments[i]; if (o && o[k] != null && o[k] !== '') return o[k]; } return undefined; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : NaN; }
  function numU(v) { if (v == null || v === '') return NaN; if (typeof v === 'number') return v;
    var n = parseFloat(String(v).replace(/[^\d.\-+eE]/g, '')); return isFinite(n) ? n : NaN; }
  /** ★★★ 2026-10-29 JMA list.json 的 cod 同时存在两种坐标写法：
   *    `+35.7+140.7-50000/`      → 十进制度
   *    `+3543.3+14042.9-52000/`   → 度分（DDMM.M / DDDMM.M）
   *  以前一律 parseFloat → 3543.3 被当成 3543.3°，sameEvent 的距离检查直接判成两场，
   *  真实 10-29 千葉那场因此在履历里出现 P2P + JMA 两行。
   *  判据：纬度 >90 / 经度 >180 的一定是度分；转换后再做范围校验。 */
  function jmaCoord(v, isLon) {
    var n = num(v);
    if (!isFinite(n)) return NaN;
    var lim = isLon ? 180 : 90;
    if (Math.abs(n) <= lim) return n;              /* 已经是十进制度 */
    var sign = n < 0 ? -1 : 1, a = Math.abs(n);
    var deg = Math.floor(a / 100), min = a - deg * 100;
    if (!(min >= 0 && min < 60)) return NaN;
    var out = sign * (deg + min / 60);
    return (Math.abs(out) <= lim) ? out : NaN;
  }

  function sParse(s) {
    if (s == null || s === '') return -1;
    var t = String(s).trim(); if (!t || /不明|未知/.test(t)) return -1;
    if (/5\s*[-−ー–—]?\s*弱/.test(t)) return 50; if (/5\s*[+＋]?\s*[強强]/.test(t)) return 55;
    if (/6\s*[-−ー–—]?\s*弱/.test(t)) return 60; if (/6\s*[+＋]?\s*[強强]/.test(t)) return 65;
    /* ★★★ 2026-10-29：JMA list.json 的 maxi 是 `5-` / `5+` / `6-` / `6+`（没有「弱/強」二字），
       以前掉到下面的数字兜底 → 5+ 被当成 5（5弱）、6- / 6+ 被当成 6（5強）。
       DM 电文还可能出现 `!5-`（5弱以上未入电）。 */
    if (/^!?\s*5\s*[-−ー–—]$/.test(t)) return 50;
    if (/^!?\s*5\s*[+＋]$/.test(t)) return 55;
    if (/^!?\s*6\s*[-−ー–—]$/.test(t)) return 60;
    if (/^!?\s*6\s*[+＋]$/.test(t)) return 65;
    var m = t.match(/^-?\d+(\.\d+)?$/);
    /* ★ 归一化到全项目统一编码：1..4 / 5 / 6（=5弱/5強）/ 50/55/60/65，**震度7 = 70**
       （audio/format/render/variants/zh 全都是按 70 判震度7；以前这里返回 7，
        会被 QV_SC_SUF 当成后缀 "7" = 6弱造型 → 真发生震度7 也显示成「6-」） */
    if (m) {
      var n = parseFloat(t);
      if (n >= 70) return 70;
      if (n >= 45) return Math.max(50, Math.round(n / 5) * 5);
      if (n >= 0 && n <= 7) { var r7 = Math.round(n); return r7 === 7 ? 70 : r7; }
      return -1;
    }
    var m2 = t.match(/\d+(\.\d+)?/);
    if (m2) {
      var v = parseFloat(m2[0]);
      if (v >= 70) return 70;
      if (v >= 45) return Math.max(50, Math.round(v / 5) * 5);
      if (v <= 7) { var r8 = Math.round(v); return r8 === 7 ? 70 : r8; }
    }
    return -1;
  }
  function mk(id, src, feed) {
    return { id: id, source: src, feed: feed || '', isEew: false, timeMs: 0, pubMs: 0, lat: NaN, lon: NaN, depthKm: -1,
      mag: -1, place: '', shindo: -1, maxShindo: -1, liedu: -1, tsunami: 0, detail: '', detailJson: '',
      /* 速报专用（只有 *_eew / P2P 556 会填） */
      seq: 0, isFinal: false, isCancel: false, isTraining: false, isAssumption: false };
  }
  function eqArr(j) {
    if (!j) return [];
    if (Array.isArray(j)) return j;
    var out = [];
    for (var i = 1; i <= 200; i++) if (j['No' + i]) out.push(j['No' + i]);
    if (!out.length) Object.keys(j).forEach(function (k) { if (!/^md5$/i.test(k) && typeof j[k] === 'object') out.push(j[k]); });
    return out;
  }

  /* --- USGS（美国局）---
   * 注意：USGS 是全球台网，每天上千条小震，全量灌进来会把日本/中国的
   * 本地数据冲掉。按需求过滤 M4.5 以下（USGS_MIN_MAG）。 */
  var USGS_MIN_MAG = 4.5;

  /* --- USGS 英文地名 → 中文 ---
   * USGS 的 place 由固定模板生成，按中文语序重排：
   *   '92 km N of Ruteng, Indonesia' → '印度尼西亚 Ruteng 以北 92km'
   *   'South of the Fiji Islands'     → '斐济群岛以南'
   *   'Kermadec Islands region'       → '克马德克群岛 海域'
   * 专名（Ruteng 之类）没有本地词典，保留原文；硬译反而会错。 */
  var DIR_CN = { N: '北', S: '南', E: '东', W: '西', C: '中部',
    NE: '东北', NW: '西北', SE: '东南', SW: '西南',
    NNE: '北北东', ENE: '东北东', ESE: '东南东', SSE: '南南东',
    SSW: '南南西', WSW: '西南西', WNW: '西北西', NNW: '北北西' };
  var REGION_CN = {
    'Indonesia': '印度尼西亚', 'Japan': '日本', 'China': '中国', 'Philippines': '菲律宾',
    'Taiwan': '台湾', 'Taiwan region': '台湾地区', 'Papua New Guinea': '巴布亚新几内亚',
    'New Zealand': '新西兰', 'Russia': '俄罗斯', 'United States': '美国', 'Mexico': '墨西哥',
    'Chile': '智利', 'Peru': '秘鲁', 'Argentina': '阿根廷', 'Bolivia': '玻利维亚',
    'Alaska': '阿拉斯加', 'California': '加利福尼亚', 'Hawaii': '夏威夷', 'Nevada': '内华达',
    'Fiji': '斐济', 'Tonga': '汤加', 'Samoa': '萨摩亚', 'Vanuatu': '瓦努阿图',
    'Solomon Islands': '所罗门群岛', 'India': '印度', 'Nepal': '尼泊尔', 'Bhutan': '不丹',
    'Bangladesh': '孟加拉国', 'Myanmar': '缅甸', 'Thailand': '泰国', 'Vietnam': '越南',
    'Laos': '老挝', 'Cambodia': '柬埔寨', 'Malaysia': '马来西亚', 'Singapore': '新加坡',
    'Brunei': '文莱', 'Iran': '伊朗', 'Iraq': '伊拉克', 'Turkey': '土耳其', 'Greece': '希腊',
    'Italy': '意大利', 'Spain': '西班牙', 'Portugal': '葡萄牙', 'Iceland': '冰岛',
    'Norway': '挪威', 'Sweden': '瑞典', 'Finland': '芬兰', 'Korea': '韩国',
    'South Korea': '韩国', 'North Korea': '朝鲜', 'Mongolia': '蒙古',
    'Australia': '澳大利亚', 'Canada': '加拿大', 'Brazil': '巴西', 'Colombia': '哥伦比亚',
    'Ecuador': '厄瓜多尔', 'Venezuela': '委内瑞拉', 'Guatemala': '危地马拉',
    'Costa Rica': '哥斯达黎加', 'Panama': '巴拿马', 'Nicaragua': '尼加拉瓜',
    'El Salvador': '萨尔瓦多', 'Honduras': '洪都拉斯', 'Cuba': '古巴',
    'Haiti': '海地', 'Dominican Republic': '多米尼加', 'Jamaica': '牙买加',
    'Puerto Rico': '波多黎各', 'Trinidad and Tobago': '特立尼达和多巴哥',
    'Antarctica': '南极洲', 'South Georgia': '南乔治亚岛',
    'South Sandwich Islands': '南桑威奇群岛', 'South Shetland Islands': '南设得兰群岛',
    'Kermadec Islands': '克马德克群岛', 'Mariana Islands': '马里亚纳群岛', 'Guam': '关岛',
    'Ryukyu Islands': '琉球群岛', 'Kuril Islands': '千岛群岛', 'Kamchatka': '堪察加',
    'Aleutian Islands': '阿留申群岛', 'Bering Sea': '白令海', 'Sea of Okhotsk': '鄂霍次克海',
    'Sea of Japan': '日本海', 'Philippine Sea': '菲律宾海', 'Banda Sea': '班达海',
    'Celebes Sea': '西里伯斯海', 'Molucca Sea': '马鲁古海', 'Java Sea': '爪哇海',
    'Aegean Sea': '爱琴海', 'Mediterranean Sea': '地中海', 'Caribbean Sea': '加勒比海',
    'Atlantic Ocean': '大西洋', 'Pacific Ocean': '太平洋', 'Indian Ocean': '印度洋',
    'Arctic Ocean': '北冰洋', 'Southern Ocean': '南太平洋',
    'Mid-Atlantic Ridge': '大西洋中脊', 'Mid-Indian Ridge': '印度洋中脊',
    'East Pacific Rise': '东太平洋海隆', 'Scotia Sea': '斯科舍海',
    'Luzon': '吕宋', 'Mindanao': '棉兰老', 'Visayas': '米沙鄢', 'Sumatra': '苏门答腊',
    'Java': '爪哇', 'Sulawesi': '苏拉威西', 'Bali': '巴厘', 'Flores': '弗洛勒斯',
    'Timor': '帝汶', 'Sumbawa': '松巴哇', 'Halmahera': '哈马黑拉', 'Seram': '塞兰',
    'New Britain': '新不列颠', 'New Ireland': '新爱尔兰', 'New Caledonia': '新喀里多尼亚',
    'Hokkaido': '北海道', 'Honshu': '本州', 'Kyushu': '九州', 'Shikoku': '四国'
  };
  function regionCN(s) {
    s = String(s == null ? '' : s).trim();
    return s ? (REGION_CN[s] || s) : '';
  }
  function dirCN(s) {
    var k = String(s || '').toUpperCase();
    return DIR_CN[k] || k;
  }
  /** USGS 英文地名 → 中文（模板重排；专名保留） */
  function usgsPlaceCN(en) {
    var s = String(en == null ? '' : en).trim();
    if (!s) return '';
    var region = '', i = s.lastIndexOf(', ');
    if (i > 0) { region = s.slice(i + 2); s = s.slice(0, i); }
    var rc = regionCN(region), pre = rc ? rc + ' ' : '';
    var m = s.match(/^([\d.]+)\s*km\s+([NSEW]{1,3})\s+of\s+(.+)$/i);
    if (m) return pre + m[3] + ' 以' + dirCN(m[2]) + ' ' + m[1] + 'km';
    m = s.match(/^([NSEW]{1,3})\s+of\s+(.+)$/i);
    if (m) return pre + m[2] + ' 以' + dirCN(m[1]);
    m = s.match(/^off\s+the\s+coast\s+of\s+(.+)$/i);
    if (m) return pre + m[1] + ' 近海';
    m = s.match(/^near\s+the\s+coast\s+of\s+(.+)$/i);
    if (m) return pre + m[1] + ' 沿岸';
    /* EMSC 的 flynn_region 也用这套模板，而且大写：
       "NEAR N COAST OF NEW GUINEA, PNG" → 「新几内亚 以近海」（以前直接漏成截断的原文） */
    m = s.match(/^near\s+([NSEW]{1,3})\s+coast\s+of\s+(.+)$/i);
    if (m) return pre + m[2] + ' 以' + dirCN(m[1]) + '近海';
    m = s.match(/^([NSEW]{1,3})\s+coast\s+of\s+(.+)$/i);
    if (m) return pre + m[2] + ' ' + dirCN(m[1]) + '部沿岸';
    var rg = s.replace(/\s+region$/i, '');
    if (rg !== s) return pre + rg + ' 海域';
    return pre + s;
  }
  /** 中文地名规范化：方向词写法（南南西 → 西南偏南、东北东 → 东北偏东）
   *  —— 中国/台湾/日本源给的都是中文地名，但方向词是日语式写法，
   *     用户直接看到「智利 Colchane 以南南西 72km」。 */
  function cnPlace(s) {
    var t = String(s == null ? '' : s);
    /* ⚠️ 本文件的 IIFE 形参是 `g`，**没有** `global` 这个名字 ——
       写成 `global.QVPZ` 会抛 ReferenceError → 四个主列表源全挂、界面一条地震都没有
       （2026-10-10 实测：jma/jmaeq/cenc/usgs 全部 err="global is not defined"）。 */
    return (g.QVPZ && g.QVPZ.clean) ? g.QVPZ.clean(t) : t;
  }
  /* ★★ 2026-10-15 用户：「海啸预警为什么不会自动消失」——
     USGS 的 properties.tsunami 是【按震源条件】打的一次性标记（M/深度够就可能 = 1），
     它**不随海啸解除变回 0** → 卡片会永久挂着「海啸注意报」（还带着自动切到海啸页）。
     真正的海啸威胁只存在于震后几小时内：超过 USGS_TSU_TTL 就当没有。 */
  var USGS_TSU_TTL = 6 * 3600000;
  function usgsTsunaFlag(v, timeMs) {
    if (!(num(v) > 0)) return 0;
    return (Date.now() - (timeMs || 0) > USGS_TSU_TTL) ? 0 : 1;
  }
  function srcUsgs() {
    return fetchJSON('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson').then(function (j) {
      return (j.features || []).map(function (f) {
        var p = f.properties || {}, c = (f.geometry || {}).coordinates; if (!c || c.length < 2) return null;
        if (p.type && p.type !== 'earthquake') return null;
        var m = num(p.mag);
        if (!isFinite(m) || m < USGS_MIN_MAG) return null;      /* ← 过滤 M4.5 以下 */
        var q = mk('USGS:' + (f.id || p.code), 'USGS', 'usgs');
        q.timeMs = num(p.time) || 0; q.pubMs = num(p.updated) || 0;
        q.lon = num(c[0]); q.lat = num(c[1]);
        q.depthKm = c.length > 2 ? num(c[2]) : -1; q.mag = m;
        q.place = ((g.QVPZ && g.QVPZ.usgs) ? g.QVPZ.usgs(p.place) : usgsPlaceCN(p.place)) || (p.place || '');   /* ★ 英文模板 → 中文语序（⚠️ 用 g，别写 global） */
        q.tsunami = usgsTsunaFlag(p.tsunami, q.timeMs);   /* ★ 带 6h 有效期，不再永久挂着 */
        /* ★ USGS 的 mmi = 修正麦卡利烈度（1..12）→ 归到【烈度】刻度 */
        var mmi = num(p.mmi); if (isFinite(mmi) && mmi >= 1) q.liedu = mmi;
        return q.timeMs ? q : null;
      }).filter(Boolean);
    });
  }
  /* --- 気象庁 地震リスト --- */
  function srcJmaList() {
    return fetchJSON('https://www.jma.go.jp/bosai/quake/data/list.json').then(function (a) {
      var list = (a || []).map(function (e) {
        var q = mk('JMA:' + (e.eid || e.ct), 'JMA', 'jma');
        var d = Fmt.parse(e.at, 'Asia/Tokyo'); q.timeMs = d ? d.getTime() : 0;
        var rd = Fmt.parse(e.rdt, 'Asia/Tokyo'); q.pubMs = rd ? rd.getTime() : 0;   /* rdt = 发表时刻 */
        /* 地名优先用日文原名 anm（en_anm 是英文，绝不能优先取）*/
        q.place = cnPlace(e.anm || e.en_anm || ''); q.mag = num(e.mag); q.depthKm = numU(e.dep);
        q.detailJson = e.json || '';        /* ★ 明细文件名 → 按区域震度（地图色块） */
        /* ★★ cod 格式：`[±]緯度[±]経度[±]深さ(m)/`
         *    "+32.5+130.5-10000/" = 北纬 32.5 / 东经 130.5 / 深 10km
         *    "+32.2+130.4+0/"     = 深 0km；"+07.5-080.8/" = 深度整段缺失
         *  ⚠️ 两个老 bug（用户 2026-10-10 报「熊本 6 点那个深度显示不明，KonTP 正常」）：
         *    ① **list.json 根本没有 dep 字段**（实测 235/235 条都没有）
         *       → 老代码 `numU(e.dep)` 永远 NaN，深度恒为 -1 → 卡片「不明」
         *    ② `cod.split(' ')` —— 这串里**没有空格**，c[1]/c[2] 全是 undefined
         *       → 气象厅条目的【经纬度也是 NaN】，地图只能去别的源借坐标
         *  深度单位是**米**，且可能是 `+0`（0 合法，不能当“没有”丢掉）。 */
        var cm = String(e.cod || '').match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+)?/);
        if (cm) {
          q.lat = jmaCoord(cm[1], false); q.lon = jmaCoord(cm[2], true);
          if (cm[3] != null) { var dm = Math.abs(num(cm[3])); if (isFinite(dm)) q.depthKm = dm / 1000; }
        }
        /* 万一哪天 JMA 真的加了 dep 字段，这里兜一手（单位 km） */
        if (q.depthKm < 0) { var depFb = numU(e.dep); if (isFinite(depFb)) q.depthKm = depFb; }
        /* ★ maxi 是 `1`..`7` / `5-` / `5+` / `6-` / `6+`，必须走 sParse，不能 num() */
        var mx = sParse(e.maxi); if (mx >= 0) { q.maxShindo = mx; q.shindo = mx; }
        return q.timeMs ? q : null;
      }).filter(Boolean);
      /* ★★★ 2026-10-25 用户：「调查一下数据源中的不明是什么」
         实测 JMA list.json 对同一场地震会列 **好几条**（不同电文，eid 相同）：
           震源・震度情報    anm=小笠原諸島西方沖 mag=7.0 maxi=3   ← 完整
           震源に関する情報  anm=小笠原諸島西方沖 mag=7.0 maxi=""  ← 完整但没震度
           震度速報          anm=""               mag=""  maxi=3   ← **只有震度，没有震源**
         以前每条都变成一个列表条目（id 又都用 eid）→ 历史里凭空冒出
         「地名不明 / 深度不明 / M 不明」的行（全表实测：199 条里 28 条 eid 重复、
         15 条缺 anm+mag）。
         ⇒ 按 eid 合并：字段「有值优先」，最大震度取最大，明细取最全的那份。 */
      var byId = {}, order = [];
      list.forEach(function (q) {
        var k = String(q.id), cur = byId[k];
        if (!cur) { byId[k] = q; order.push(k); return; }
        if (!cur.place && q.place) cur.place = q.place;
        if (!isFinite(cur.mag) && isFinite(q.mag)) cur.mag = q.mag;
        var okD = function (v) { return isFinite(v) && v >= 0; };
        if (!okD(cur.depthKm) && okD(q.depthKm)) cur.depthKm = q.depthKm;
        /* ★ 坐标必须落在合法范围内才算“有值”——以前只要 isFinite 就保留，
           首条 DDMM.M 被误解析成 3543.3 后，后面的正确十进制坐标再也覆盖不进来。 */
        var okLL = function (la, lo) {
          return isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
        };
        if (!okLL(cur.lat, cur.lon) && okLL(q.lat, q.lon)) { cur.lat = q.lat; cur.lon = q.lon; }
        /* 震度编码是单调的（0<1<…<4<50<55<60<65<70）→ 直接取大 */
        var a1 = isFinite(cur.maxShindo) ? cur.maxShindo : -1;
        var b1 = isFinite(q.maxShindo) ? q.maxShindo : -1;
        var sh = Math.max(a1, b1);
        if (sh >= 0) { cur.maxShindo = sh; cur.shindo = sh; }
        if (isFinite(q.liedu) && !isFinite(cur.liedu)) cur.liedu = q.liedu;
        if (jmaDetailRank({ json: q.detailJson }) > jmaDetailRank({ json: cur.detailJson })) cur.detailJson = q.detailJson;
        if ((q.pubMs || 0) > (cur.pubMs || 0)) cur.pubMs = q.pubMs;
      });
      return order.map(function (k) { return byId[k]; });
    });
  }
  /* --- Wolfx: 気象庁 eqlist --- */
  function srcJmaEq() {
    return fetchJSON('https://api.wolfx.jp/jma_eqlist.json').then(function (j) {
      return eqArr(j).map(function (o) {
        var t = pick(o, 'time_full', 'time'); var q = mk('JMAW:' + (pick(o, 'EventID', 'ID') || t), 'JMA', 'jmaeq');
        var d = Fmt.parse(t, 'Asia/Tokyo'); q.timeMs = d ? d.getTime() : 0;
        q.place = cnPlace(pick(o, 'location', 'placeName')); q.mag = num(pick(o, 'magnitude', 'Magunitude'));
        q.depthKm = numU(pick(o, 'depth')); q.lat = num(pick(o, 'latitude')); q.lon = num(pick(o, 'longitude'));
        var s = sParse(pick(o, 'shindo', 'maxIntensity')); if (s >= 0) { q.shindo = s; q.maxShindo = s; }
        q.detail = String(pick(o, 'info') || '');
        return q.timeMs ? q : null;
      }).filter(Boolean);
    });
  }
  /* --- Wolfx: 中国地震台网 --- */
  function srcCenc() {
    return fetchJSON('https://api.wolfx.jp/cenc_eqlist.json').then(function (j) {
      return eqArr(j).map(function (o) {
        var t = pick(o, 'time', 'Time'); var q = mk('CENC:' + (pick(o, 'EventID', 'ID') || t), 'CENC', 'cenc');
        var d = Fmt.parse(t, 'Asia/Shanghai'); q.timeMs = d ? d.getTime() : 0;
        q.place = cnPlace(pick(o, 'placeName', 'location')); q.mag = num(pick(o, 'magnitude', 'Magunitude'));
        q.depthKm = numU(pick(o, 'depth')); q.lat = num(pick(o, 'latitude')); q.lon = num(pick(o, 'longitude'));
        var li = num(pick(o, 'intensity', 'MaxIntensity')); if (isFinite(li)) q.liedu = li;
        return q.timeMs ? q : null;
      }).filter(Boolean);
    });
  }
  /* --- 緊急地震速報（多地）
   * ★ 震度 vs 烈度（用户要求）：
   *   jma / cwa （日本气象厅 / 台湾中央气象署）→ MaxIntensity 是【震度】刻度 → q.shindo
   *   cenc / sc / fj / cq（中国大陆各地预警）→ MaxIntensity 是【烈度】刻度 → q.liedu */
  var EEW_URL = {
    jma: 'https://api.wolfx.jp/jma_eew.json', cwa: 'https://api.wolfx.jp/cwa_eew.json',
    cenc: 'https://api.wolfx.jp/cenc_eew.json', sc: 'https://api.wolfx.jp/sc_eew.json',
    fj: 'https://api.wolfx.jp/fj_eew.json'
  };
  /* ⚠️ cq（重庆）已从 EEW_URL 里移除：上游实测【503】，每 5 秒重连一次纯浪费。 */
  /** 单个 EEW 源（每个源单独成一个 SOURCE → 能单独报健康度、单独容错）
   *  ⚠ 各源字段不同（KonTP 实测，2026-09-01 在手机上踩过）：
   *     日本 jma/cwa ：Hypocenter / AnnouncedTime(JST) / MaxIntensity=【震度】
   *     大陆 cenc/sc/fj/cq：HypoCenter（大写 C）/ ReportTime|OriginTime(北京时) / MaxIntensity=【烈度】
   *     震级字段两者混用 Magunitude（wolfx 保留 JMA 拼写）/ Magnitude → 两个都要试
   *     旧代码一律按日本结构 + JST 解析 → 大陆速报时间恒偏 1 小时 */
  function srcEewOne(tag) {
    return fetchJSON(EEW_URL[tag], 10000).then(function (j) {
        if (!j || typeof j !== 'object') return [];
        var list = Array.isArray(j) ? j : [j];
        return list.map(function (o) {
          var isJp = (tag === 'jma' || tag === 'cwa');
          var tz = isJp ? 'Asia/Tokyo' : 'Asia/Shanghai';
          /* ★ timeMs = **発生時刻**（OriginTime）。以前优先取 AnnouncedTime/ReportTime
             → 卡片上「…左右」显示的是【发报时刻】，偏 30~60 秒。
             pubMs = 发报时刻（「谁先发布」的判定依据）。
             isFinal / isCancel / isTraining = 速报状态位（用户问的速报→正式报判定）。 */
          var at = pick(o, 'AnnouncedTime', 'ReportTime', 'time');
          var ot = pick(o, 'OriginTime') || at;
          var q = mk('EEW:' + tag + ':' + (pick(o, 'EventID', 'ID') || ot), tag.toUpperCase() + '_EEW', 'eew_' + tag);
          q.isEew = true;
          var d = Fmt.parse(ot, tz); q.timeMs = d ? d.getTime() : 0;
          var dp = Fmt.parse(at, tz); q.pubMs = dp ? dp.getTime() : 0;
          q.seq = num(pick(o, 'Serial', 'ReportNum')) || 0;
          q.isFinal = !!pick(o, 'isFinal');
          q.isCancel = !!pick(o, 'isCancel');
          q.isTraining = !!pick(o, 'isTraining');
          q.isAssumption = !!pick(o, 'isAssumption');
          /* ★ 2026-10-23：警報标志 / 警报区域 / 定位精度（真实 EEW → Tab2 的门槛） */
          q.eventId = String(pick(o, 'EventID', 'ID') || '');
          q.isWarn = !!pick(o, 'isWarn');
          q.warnArea = pick(o, 'WarnArea') || [];
          q.accuracy = pick(o, 'Accuracy') || null;
          q.codeType = String(pick(o, 'CodeType') || '');
          q.place = cnPlace(pick(o, 'Hypocenter', 'HypoCenter', 'location', 'placeName'));
          q.mag = num(pick(o, 'Magunitude', 'Magnitude')); q.depthKm = numU(pick(o, 'Depth', 'depth'));
          q.lat = num(pick(o, 'Latitude', 'latitude')); q.lon = num(pick(o, 'Longitude', 'longitude'));
          if (tag === 'jma' || tag === 'cwa') {
            var s = sParse(pick(o, 'MaxIntensity', 'shindo'));
            if (s >= 0) { q.shindo = s; q.maxShindo = s; }
          } else {
            var li = num(pick(o, 'MaxIntensity', 'intensity', 'shindo'));
            if (isFinite(li) && li >= 1) q.liedu = li;
          }
          q.detail = String(pick(o, 'Title', 'CodeType') || '');
          return q.timeMs ? q : null;
        }).filter(Boolean);
    }).catch(function () { return []; });
  }

  /* --- EMSC（欧洲地中海地震中心，SeismicPortal fdsnws）---
   * 免费无需 key，与 USGS 同一套 GeoJSON schema。它补的是【欧洲/地中海/中东/北非/南美】，
   * 这些地区原来全靠 USGS 一家。
   *  · properties.lastupdate = 该机构最后一次【更新】时刻（“最早发布”判定用）
   *  · properties.auth       = 原始报送机构（实测常见 GFZ / INGV / NOA …）
   *  ⚠ 实测碰过一次 CERT_HAS_EXPIRED → 失败就返回空，下次轮询自愈。
   */
  var EMSC_MIN_MAG = 4.5;
  function srcEmsc() {
    return fetchJSON('https://www.seismicportal.eu/fdsnws/event/1/query?format=json&orderby=time&limit=100&minmag=' + EMSC_MIN_MAG, 12000)
      .then(function (j) {
        return ((j || {}).features || []).map(function (f) {
          var p = f.properties || {}, c = (f.geometry || {}).coordinates;
          if (!c || c.length < 2) return null;
          var m = num(p.mag); if (!isFinite(m) || m < EMSC_MIN_MAG) return null;
          var q = mk('EMSC:' + (p.unid || f.id), 'EMSC', 'emsc');
          var d = Date.parse(p.time); q.timeMs = isFinite(d) ? d : 0;
          var u = Date.parse(p.lastupdate); q.pubMs = isFinite(u) ? u : 0;
          q.lon = num(p.lon != null ? p.lon : c[0]); q.lat = num(p.lat != null ? p.lat : c[1]);
          q.depthKm = num(p.depth); q.mag = m;
          var rg = p.flynn_region || '';
          q.place = ((g.QVPZ && g.QVPZ.usgs) ? g.QVPZ.usgs(rg) : usgsPlaceCN(rg)) || rg;
          q.detail = String(p.auth || '') + (p.magtype ? ' ' + p.magtype : '');
          return q.timeMs ? q : null;
        }).filter(Boolean);
      });
  }

  /* --- P2P地震情報 API v2（免费，气象厅官方 XML 的中继，4 秒级）---
   * ★★ 白捡的「各区域震度」第二来源：551 的 points[] 到【市町村】粒度：
   *      points[].{pref, addr, isArea, scale}
   *    以前这个只有 JMA 的 detail JSON 一家，它挂了地图就没颜色。
   * ★ scale 编码跟我们的震度编码**不一样**，必须转：
   *      P2P/JMA 速报： 10 20 30 40 45 50 55 60 70
   *      含义：        1  2  3  4  5弾 5强 6弾 6强 7
   *      我们的编码：   1  2  3  4  50 55 60 65 7
   *  · issue.time   = 发表时刻，issue.source = 气象厅 / 地方公共团体
   *  · issue.type   = DetailScale(详细震度) / ScalePrompt / Destination / Foreign …
   */
  var P2P_SCALE = { 10: 1, 20: 2, 30: 3, 40: 4, 45: 50, 50: 55, 55: 60, 60: 65, 70: 7 };
  /* ★★★ 2026-10-15 海啸状态 = 官方同一套「津波の心配文」（6 档）。
     数据来源：P2P 551（= JMA 地震情报）的 `earthquake.domesticTsunami` / `foreignTsunami`：
       None 心配なし 0 / Unknown 不明 1 / Checking 調査中 2 /
       NonEffective(=Nearby) 若干の海面変動 3 / Watch 津波注意報 4 / Warning・MajorWarning 津波警報 5
     ★ 关键：这是【逐报状态】—— JMA 解除后下一报就变回 None → 卡片自己就会取消。
       （USGS 的 tsunami 标记做不到这点，只能用 6h 有效期兜底，见 usgsTsunaFlag。
         这就是用户报的「海啸预警不会自动消失 / 没写取消报」。） */
  var TSU_KIND = {
    None: 0, NonEffective: 3, NonEffectiveNearby: 3,
    Unknown: 1, Checking: 2, Potential: 1,
    Watch: 4, Warning: 5, MajorWarning: 5,
    WarningNearby: 4, WarningPacific: 5, WarningPacificWide: 5,
    WarningIndian: 5, WarningIndianWide: 5
  };
  /** 取这一报的海啸状态关键词：国内状态优先（None 也算有效），否则看海外状态 */
  function p2pTsu(eq) {
    var d = String((eq || {}).domesticTsunami || ''), f = String((eq || {}).foreignTsunami || '');
    if (d && d !== 'Unknown') return d;
    if (f && f !== 'Unknown') return f;
    return (d === 'Unknown' || f === 'Unknown') ? 'Unknown' : '';
  }
  function srcP2p() {
    return fetchJSON('https://api.p2pquake.net/v2/history?codes=551&limit=100', 12000)
      .then(function (a) {
        return (a || []).map(function (o) {
          var eq = o.earthquake || {}, hp = eq.hypocenter || {}, iss = o.issue || {};
          if (!hp.name) return null;
          var d = Fmt.parse(eq.time, 'Asia/Tokyo');
          var q = mk('P2P:' + o.id, 'JMA', 'p2p');
          q.timeMs = d ? d.getTime() : 0;
          var di = Fmt.parse(iss.time, 'Asia/Tokyo'); q.pubMs = di ? di.getTime() : 0;
          q.place = cnPlace(hp.name);
          q.mag = num(hp.magnitude); q.depthKm = numU(hp.depth);
          q.lat = num(hp.latitude); q.lon = num(hp.longitude);
          var s = P2P_SCALE[eq.maxScale];
          if (s != null) { q.shindo = s; q.maxShindo = s; }
          /* ★★ 逐报海啸状态（见 TSU_KIND）。q.tsunami(0..3) 供旧分支/自动切页用，
             q.tsuKind(0..5) 给卡片选官方 paIts 造型用。 */
          var tsw = p2pTsu(eq);
          if (tsw && TSU_KIND[tsw] != null) {
            q.tsuRaw = tsw; q.tsuKind = TSU_KIND[tsw]; q.tsuMajor = (tsw === 'MajorWarning');
            q.tsunami = tsw === 'Watch' ? 1 : (TSU_KIND[tsw] === 5 ? (q.tsuMajor ? 3 : 2) : 0);
          }
          /* ★ 各区域震度（市町村粒度）——名字型，不带 JMA 区域码，
             所以只能给文字列表用，不能直接给地图色块 nc<code> 用。 */
          var pts = o.points || [];
          if (pts.length) {
            q.areas = pts.filter(function (p) { return P2P_SCALE[p.scale] != null; })
              .map(function (p) { return { pref: p.pref || '', addr: p.addr || '', isArea: !!p.isArea, shindo: P2P_SCALE[p.scale] }; });
          }
          q.detail = String(iss.source || '') + (iss.type ? ' ' + iss.type : '');
          return q.timeMs ? q : null;
        }).filter(Boolean);
      });
  }

  /* --- GDACS 全球灾害告警（多灾种平台，这里只取地震）---
   * ⚠️ 它**不是地震目录**：没有正规震源/震度，只有 alertlevel/severity。
   *    只当【灾害告警】用：EQ + M5.5 以上 + 48 小时内。
   *    depth 只能从 severitytext（"Magnitude 7.7M, Depth:12.647km"）里抠。
   */
  function srcGdacs() {
    /* ⚠️ GDACS 是唯一实测会挂到 33.5 s 的源 → 单独放宽超时到 40 s。
       它在 SOURCES 里标了 bg:true，不参与 refresh() 的等待，所以放宽超时不会拖慢首屏。 */
    return fetchJSON('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ&limit=100', 40000)
      .then(function (j) {
        var now = Date.now();
        return ((j || {}).features || []).map(function (f) {
          var p = f.properties || {}, c = (f.geometry || {}).coordinates;
          if (p.eventtype !== 'EQ') return null;
          var m = num(p.severitydata && p.severitydata.severity);
          if (!isFinite(m) || m < 5.5) return null;
          var d = Date.parse(String(p.fromdate).replace(' ', 'T') + 'Z');
          if (!isFinite(d) || (now - d) > 48 * 3600000) return null;
          if (!c || c.length < 2) return null;
          var q = mk('GDACS:' + p.eventid + ':' + p.episodeid, 'GDACS', 'gdacs');
          q.timeMs = d;
          var md = Date.parse(String(p.datemodified).replace(' ', 'T') + 'Z');
          q.pubMs = isFinite(md) ? md : 0;
          q.lon = num(c[0]); q.lat = num(c[1]); q.mag = m; q.depthKm = -1;
          var dm = String((p.severitydata || {}).severitytext || '').match(/Depth:\s*([\d.]+)/i);
          if (dm) q.depthKm = num(dm[1]);
          q.place = regionCN(p.country || '') || (p.country || '');
          q.detail = 'GDACS ' + (p.alertlevel || '') + (p.name ? ' · ' + p.name : '');
          return q;
        }).filter(Boolean);
      });
  }

  /* ================== 多数据源管理 ==================
   * 移植自安卓 KonTP（quake-alert/QuakeFetcher.kt + Quake.kt + Prefs 跨源去重）：
   *   ① 每个源单独注册、**并行**抓取、**独立容错** —— 只有全军覆没才算失败
   *   ② 每个源记健康度（成败 / 条数 / 耗时 / 错误）→ 供「应用信息」页显示
   *   ③ 同一个地震被多个源报到时【合并成一条】，按源优先级逐字段取最优值：
   *        官方震度（日/台）> 官方烈度（台网）> USGS mmi ；原生地名优先；有坐标的优先
   *   ⇒ 以前 JMA / JMAW / USGS 各占一条，同一个熊本的地震在列表里出现两三次。
   */
  /* 源元数据：pri 越大越权威（合并时用它的字段）；official = 它自带哪种官方值 */
  var FEED = {
    jma:      { cn: '日本气象厅 · 地震列表', pri: 60, official: 'shindo' },
    jmaeq:    { cn: '日本气象厅 · wolfx 转发', pri: 55, official: 'shindo' },
    cenc:     { cn: '中国地震台网 · 地震列表', pri: 50, official: 'liedu' },
    eew_jma:  { cn: '日本气象厅 · 紧急地震速报', pri: 70, official: 'shindo' },
    eew_p2p:  { cn: 'P2P地震情報 · 紧急地震速报', pri: 68, official: 'shindo' },
    eew_cwa:  { cn: '台湾中央气象署 · 速报', pri: 70, official: 'shindo' },
    eew_cenc: { cn: '中国地震台网 · 预警', pri: 65, official: 'liedu' },
    eew_sc:   { cn: '四川地震预警', pri: 65, official: 'liedu' },
    eew_fj:   { cn: '福建地震预警', pri: 65, official: 'liedu' },
    p2p:      { cn: 'P2P地震情報（气象厅中继）', pri: 58, official: 'shindo' },
    emsc:     { cn: '欧洲地中海地震中心', pri: 45, official: 'liedu' },
    usgs:     { cn: '美国地质调查局', pri: 30, official: 'mmi' },
    gdacs:    { cn: 'GDACS 全球灾害告警', pri: 20, official: '' }
  };
  function pri(q) { var m = FEED[(q && q.feed) || '']; return m ? m.pri : 10; }
  function distDeg(a, b) {
    var dLat = a.lat - b.lat, dLon = (a.lon - b.lon) * Math.cos(a.lat * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  }
  /* ================== 同震分组 + 主卡片裁定 ==================
   * ★★ 2026-10-10 用户第 2 次修正设计（**推翻**上一版的「字段级最新有值者胜」）：
   *   「你还要根据 API 分不同的混合信息啊，怎么可能？
   *     日本的紧急地震速报信息后面却是以中国的最新为准，反过来也是如此。
   *      ……非常简单，我们把这整个信息栏突然换一下，搞个小动画提示 XX 地震局的信息，
   *        然后用普通卡片显示他那个地震局的东西，显示 15 秒，
   *        然后再返回那个日本官方的主战场。」
   *
   * 所以：
   *   · **绝不跨机构混合字段** —— 卡片上每个数字都来自同一个机构的一条报文
   *   · 只做【同震分组】：判断哪几条报文说的是同一场地震
   *   · 组内主卡片 = **最早发布**的那一条（用户选的规则）
   *   · 其余报文原样挂成 q.alts（候补）→ 由界面做 15 秒整卡接管
   *   · 速报（isEew）**只按 id 去重**：既不接管别人，也不被接管
   */
  /* 字段「有没有值」——只用于分组判定与诊断，不再用于混合 */
  var FIELDS = ['timeMs', 'lat', 'lon', 'depthKm', 'mag', 'place',
    'shindo', 'maxShindo', 'liedu', 'tsunami', 'detail', 'detailJson'];
  function fieldHas(q, f) {
    var v = q[f];
    switch (f) {
      case 'timeMs': return isFinite(v) && v > 0;
      case 'lat': case 'lon': return isFinite(v);
      case 'depthKm': return isFinite(v) && v >= 0;
      case 'mag': return isFinite(v) && v > 0;
      case 'shindo': case 'maxShindo': return isFinite(v) && v >= 0;
      case 'liedu': return isFinite(v) && v >= 1;
      case 'tsunami': return (v | 0) > 0;
      default: return v != null && v !== '';
    }
  }
  /* ★ 哪些源给的是【震度】（日本/台湾刻度），哪些是【烈度】（中国/全球刻度）
     —— 卡片用哪套色卡完全跟【主卡片那个机构】走，不再看“谁的等级最新”。 */
  var SHINDO_FEED = /^(jma|jmaeq|jma_wolfx|p2p|eew_jma|eew_p2p|eew_cwa|cwa)$/;
  function metricOfFeed(feed) { return SHINDO_FEED.test(String(feed || '')) ? 'shindo' : 'liedu'; }
  /* ★★ 日本管辖范围（JMA 报震度的地盘）：
     位于这里的【日本地震】即使是 USGS 报的（JMA 没收录的远海小震等），
     卡片也走【震度】语义 —— 与官方一致（用户报：「日本宫古岛为啥用烈度而不是震度」）。

     ★★★ 2026-10-26 修（用户：「为什么辽宁的地震使用的是震度」）：
     旧判据是「lat 17~50 且 lon 123~152」一个**大矩形** —— 把中国东北整个框进去了
     （辽宁 123.4E / 吉林珲春 130.6E 都在框内），于是 CENC 报的「辽宁沈阳市浑南区」
     被判成日本地盘 → 卡片走震度语义、标签写「最大震度 1」（实测 q.metric='shindo'）。
     现在分三步：
       ① 地名里出现日本（或台湾，走 CWA 震度）行政区名 → 一定是震度
       ② **中国台网（cenc/sc/fj/cq/cea）报的** → 直接判否（中国一律用烈度）
          —— 这样吉林/黑龙江边境的地震也不会被误判
       ③ 其余（USGS/EMSC 等外国源）用**日本列岛三块箱体**代替大矩形：
            本州/四国/九州/北海道  lat 30~46.5 lon 129~147
            琉球列岛               lat 23~30   lon 122~131.5
            小笠原/父岛            lat 20~28   lon 136~144
          中国最东（黑龙江抚远 134.3E / 48.4N）在 46.5 以北 → 落不进箱体。 */
  var CN_FEED = /^(cenc|sc|fj|cq|cea)$/;
  var JP_PLACE = /日本|沖縄|冲绳|宫古|宮古|石垣|与那国|先島|北海道|本州|四国|九州|東京|大阪|台湾|臺灣/;
  function inJmaRegion(lat, lon, place, feed) {
    if (JP_PLACE.test(String(place || ''))) return true;
    if (CN_FEED.test(String(feed || ''))) return false;
    if (!isFinite(lat) || !isFinite(lon)) return false;
    if (lat >= 30 && lat <= 46.5 && lon >= 129 && lon <= 147) return true;
    if (lat >= 23 && lat < 30 && lon >= 122 && lon <= 131.5) return true;
    if (lat >= 20 && lat < 28 && lon >= 136 && lon <= 144) return true;
    return false;
  }
  /* 地名归一化 → 只用于【比对】：去掉数字/单位/方向词/空白，取“核心地名”
     '92 km N of Ruteng, Indonesia' → 'rutengindonesia'
     '熊本県天草・芦北地方'          → '熊本県天草・芦北地方' */
  function corePlace(s) {
    var t = String(s == null ? '' : s).toLowerCase()
      .replace(/[\d.]+/g, '').replace(/\s+/g, '')
      .replace(/km|公里|千米|キロ/g, '')
      .replace(/以[北南东西]|以北|以南|之[北南东西]|近海|沿岸|海域|付近|沖|近傍/g, '')
      .replace(/[,，、・·。.（）()]/g, '');
    return t;
  }
  /** 两个条目是不是【同一个地震】——判据故意保守，避免把连续小震误合
   *  ・速报与正式报分开显示（不互相吞）
   *  ・核心地名相同 → 15 分钟内算同一条（JMA / JMAW / EMSC / USGS 这种同源转发/互译）
   *  ・否则要求时间 + 距离都够近（速报定位粗 → 1.5°；正式报 0.5°）
   *  ・震级差 >1.5 一律不合并（不同的地震） */
  function sameEvent(a, b) {
    if (!a || !b) return false;
    if (!!a.isEew !== !!b.isEew) return false;
    var dt = Math.abs((a.timeMs || 0) - (b.timeMs || 0));
    /* ★ 震级差过大 → 一定是两场地震：**这一条必须放在地名快路径之前**，
       同地区的主震 + 余震地名完全一样（都是「熊本県熊本地方」），
       放过震级差会把 M6.2 主震和 M4.0 余震合并成一条。 */
    if (isFinite(a.mag) && isFinite(b.mag) && a.mag > 0 && b.mag > 0 &&
      Math.abs(a.mag - b.mag) > 1.5) return false;
    var ca = corePlace(a.place), cb = corePlace(b.place);
    /* ★ 包含判定：阈值从 4 放宽到 3，且允许【前缀包含】。
       实测：EMSC 给 flynn_region = "PANAMA" → 「巴拿马」，
             USGS 给 "104 km S of ..." → 「巴拿马 Río Grande」，
             两个是同一场地震，但旧规则要求双方都 ≥ 4 字符 → 归不了一组，
             列表里「巴拿马」就出现了三次。
       前缀包含安全，因为下面还有震级差 + 时间 + 距离三重夹子。 */
    var named = ca && cb && (ca === cb ||
      (Math.min(ca.length, cb.length) >= 3 &&
        (ca.indexOf(cb) >= 0 || cb.indexOf(ca) >= 0)));
    if (named) {
      if (dt > 15 * 60000) return false;
      /* 地名一样也别无限放行：「○○県沖」「○○地方」范围很大，
         坐标还差 2° 以上就不是一条。 */
      if (isFinite(a.lat) && isFinite(b.lat) && distDeg(a, b) > 2.0) return false;
      return true;
    }
    if (dt > 6 * 60000) return false;
    if (!isFinite(a.lat) || !isFinite(b.lat)) return false;
    /* ★ 时间窗 6 分钟（全球源发布常比 JMA 晚 1~3 分钟），
       距离容忍从 0.5° 放宽到 0.7~0.8° —— 各机构对同一个 M4.5~5 的定位
       本来就差几十公里，0.5°(≈55km) 太紧，会把同一条拆成两条。 */
    return distDeg(a, b) < (a.isEew ? 1.5 : (dt > 3 * 60000 ? 0.7 : 0.8));
  }

  /** ★★ 报文台账：`q.id → {rec, pubMs, firstSeen, seen}`，**跨 rebuild 持久**。
   *  存的是**完整原始报文**（rec），不是混合后的字段 —— 卡片必须整条来自一个机构，
   *  界面切卡时直接拿 rec 渲染，不存在“这个字段是 A 的、那个是 B 的”。
   *  · pubMs     = 该机构的【发布/更新时刻】（JMA rdt / USGS updated / EMSC lastupdate …）
   *  · firstSeen = 我们【第一次看到它】的时刻 —— wolfx eqlist / 台网 根本没给发布时刻，
   *                只能用这个兜底，否则「最早发布」无从谈起。
   */
  var CONTRIB = {};
  var CONTRIB_TTL = 3 * 3600000;
  function touchContrib(q, now) {
    var c = CONTRIB[q.id];
    if (!c) {
      c = CONTRIB[q.id] = { id: q.id, feed: q.feed || '', src: q.source || '',
        isEew: !!q.isEew, pubMs: q.pubMs || 0, firstSeen: now, seen: now, rec: q };
      return c;
    }
    c.seen = now;
    if (q.feed) c.feed = q.feed;
    if (q.source) c.src = q.source;
    if (q.isEew) c.isEew = true;
    if (q.pubMs) c.pubMs = q.pubMs;
    c.rec = q;                        /* 同一 id 的后报文总是覆盖前者（第 N 報） */
    return c;
  }
  /** 「谁先发布」的比较键。
   *  ★★ 有官方发布时刻的**一律**排在只有 firstSeen 的前面 —— firstSeen 是
   *     「我们什么时候轮询到它」，跟谁先发布毫无关系（冷启动时所有源 firstSeen
   *     都等于“现在”，等于没有信息）。不这么分档的话，一个没有发布时刻的源
   *     会凭空“抢”到主卡片。
   *  +1e15 是个安全偏移：真实时间戳约 1.8e12，加完约 1.02e15，
   *  仍远小于 Number.MAX_SAFE_INTEGER(9e15)，不会溢出。 */
  function pubKey(c) { return c.pubMs ? c.pubMs : ((c.firstSeen || 0) + 1e15); }
  function gcContrib(now) {
    for (var k in CONTRIB) if (now - CONTRIB[k].seen > CONTRIB_TTL) delete CONTRIB[k];
  }
  /** 组内某字段的值：优先主卡片，其次任一有值的报文。
   *  ⚠️ **只给分组判定用**（判断是不是同一条），**不参与任何显示**。 */
  function groupVal(g, f) {
    var m = mainOf(g);
    if (m && fieldHas(m.rec, f)) return m.rec[f];
    for (var i = 0; i < g.cs.length; i++) if (fieldHas(g.cs[i].rec, f)) return g.cs[i].rec[f];
    return undefined;
  }
  /** ★ 主卡片 = 组内【最早发布】的那一条；发布时刻相同 → 源权威度 pri 高者 */
  function mainOf(g) {
    var best = g.cs[0];
    for (var i = 1; i < g.cs.length; i++) {
      var c = g.cs[i], a = pubKey(c), b = pubKey(best);
      if (a < b || (a === b && pri({ feed: c.feed }) > pri({ feed: best.feed }))) best = c;
    }
    return best;
  }
  /** 分组视图（只给 sameEvent 用）
   *  ⚠ isEew **必须从各报文里推**：以前写成 `viewOf(ev, isEew)` 而调用处没传，
   *    结果速报的视图恒等于 isEew:false → 和正式报互营，且取决于数组顺序。 */
  /** ★ 只有 JMA 的 14 位事件 ID 才能当权威；其他源的 id 格式不一，不参与比较 */
  function jmaEventId(v) { var s = String(v == null ? '' : v); return /^\d{14}$/.test(s) ? s : ''; }
  function viewOf(g) {
    var o = { isEew: false }, i;
    for (i = 0; i < g.cs.length; i++) if (g.cs[i].isEew) { o.isEew = true; break; }
    ['timeMs', 'lat', 'lon', 'mag', 'place'].forEach(function (f) {
      var v = groupVal(g, f);
      o[f] = v === undefined ? (f === 'place' ? '' : NaN) : v;
    });
    var eid = groupVal(g, 'eventId');
    o.eventId = (eid === undefined || eid === null) ? '' : String(eid);
    return o;
  }
  /** 组 → 输出记录：**主卡片整条复制**，其余原样挂成 alts（候补）
   *  q          = 主卡片机构的那条报文（原样，没有任何字段被别的机构改过）
   *  q.alts     = 其他机构对同一场地震的报文，各存各的，按发布时刻新→旧
   *  q.altKey   = 候补集合的指纹（界面用它判断“有没有新机构要插播”） */
  function buildQ(g) {
    var m = mainOf(g);
    /* ★★★ 2026-10-29 速报组内主卡 = **信息最全的那一报**，不是「最早发布」的那一报。
       —— P2P 556 常常比 wolfx 早一两秒，但它早期报文的地名是「震源調査中」、
          M/深度/坐标全是空的；按「最早发布」选它当主卡，卡片就是
          「不明 / M 不明 / 深度不明」（用户：「深度自己编造了」「还是写着不明」）。
       排序键：信息完整度（坐标 4 / 真地名 2 / M 2 / 深度 1 / 震度 1）× 1000 + 报号。
       ⚠️ 只在**全组都是速报**时生效，正式报的「最早发布」铁律一个字都不动。 */
    var _allEew = g.cs.length > 0;
    for (var _i0 = 0; _i0 < g.cs.length; _i0++) if (!g.cs[_i0].isEew) { _allEew = false; break; }
    if (_allEew && g.cs.length > 1) {
      var _best = null, _bs = -1;
      for (var _i1 = 0; _i1 < g.cs.length; _i1++) {
        var _cc = g.cs[_i1], _rr = _cc.rec || {};
        var _sc = 0;
        if (isFinite(_rr.lat) && isFinite(_rr.lon)) _sc += 4;
        if (_rr.place && !EEW_PLACEHOLDER.test(String(_rr.place))) _sc += 2;
        if (isFinite(_rr.mag) && _rr.mag > 0) _sc += 2;
        if (isFinite(_rr.depthKm) && _rr.depthKm >= 0) _sc += 1;
        if (_rr.maxShindo != null && isFinite(+_rr.maxShindo) && +_rr.maxShindo >= 0) _sc += 1;
        _sc = _sc * 1000 + Math.min(999, Math.max(0, +_rr.seq || 0));
        if (_sc > _bs) { _bs = _sc; _best = _cc; }
      }
      if (_best) m = _best;
    }
    /* ★★ 2026-10-11 用户：「（日本海域的地震）正式信息应该全部用日本官方源」——
       组内若有 JMA 系报文（jma / jmaeq / p2p），且震中在日本管辖区域内，
       主卡就换成发布最新的那条 JMA 系报文（否则 USGS 发得早就把主卡抢走了）。 */
    var jpc = null, i0;
    for (i0 = 0; i0 < g.cs.length; i0++) {
      var f0 = String(g.cs[i0].feed || '');
      if (/^(jma|jmaeq|jma_wolfx|p2p)$/.test(f0) &&
        (!jpc || (g.cs[i0].pubMs || 0) > (jpc.pubMs || 0))) jpc = g.cs[i0];
    }
    if (jpc && inJmaRegion(m.rec.lat, m.rec.lon, m.rec.place, m.feed)) m = jpc;
    var q = cloneQ(m.rec);
    q.mainFeed = m.feed;
    q.mainSrc = m.src;
    q.pubMs = m.pubMs;
    q.firstSeen = m.firstSeen;
    q.metric = metricOfFeed(m.feed);
    /* ★★ 2026-10-15 海啸状态必须取【同一机构的最后一报】：
       主卡是「最早发布」那条（铁律），而 JMA 每次更新地震情报都会带上【当前】海啸状态
       （解除后变回 None）→ 直接拿主卡的状态就会永久停在旧值（用户报的「不会自动消失」）。
       ⚠️ 只在【同一 feed】内取值，绝不跨机构混合（铁律）。 */
    if (/^(jma|jmaeq|jma_wolfx|p2p)$/.test(String(m.feed || ''))) {
      var lastTsu = null;
      for (var it2 = 0; it2 < g.cs.length; it2++) {
        var cr = g.cs[it2];
        if (String(cr.feed || '') !== String(m.feed || '')) continue;
        if (!cr.rec || cr.rec.tsuKind == null) continue;
        if (!lastTsu || (cr.pubMs || cr.firstSeen || 0) > (lastTsu.pubMs || lastTsu.firstSeen || 0)) lastTsu = cr;
      }
      if (lastTsu) {
        q.tsuRaw = lastTsu.rec.tsuRaw; q.tsuKind = lastTsu.rec.tsuKind; q.tsuMajor = !!lastTsu.rec.tsuMajor;
        q.tsunami = lastTsu.rec.tsunami || 0;
      }
    }
    /* ★ 日本区域内的事件即使源是 USGS/EMSC → 也按【震度】语义显示（对齐官方）。
       没有 shindo 值时卡片会走「震度0 灰底」分支，标签 = 最大震度，与官方观感一致。
       ⚠️ 必须把主卡 feed 传进去：中国台网报的（辽宁/吉林…）一律不转成震度。 */
    if (q.metric === 'liedu' && inJmaRegion(q.lat, q.lon, q.place, m.feed)) q.metric = 'shindo';
    q.srcs = g.cs.map(function (c) { return c.feed; }).filter(Boolean);
    /* ★★ 候补按【机构】去重：实测 USGS 4.5_day 和 EMSC fdsnws 对同一场地震
       会同时给好几条解（不同 event id）→ 直接列出来就是
       alts:["emsc","usgs","emsc","emsc","usgs","emsc","usgs"]。
       接管动画是「一家机构一张卡」，所以这里同一机构只留**发布最新**的那条。 */
    var seenF = {};
    seenF[m.feed || m.id] = 1;          /* ★ 同一机构自己的另一条解【不算候补】
                                           —— 候补的语义是「另一家机构的信息」 */
    q.alts = g.cs.filter(function (c) { return c !== m; })
      .sort(function (x, y) { return (y.pubMs || y.firstSeen || 0) - (x.pubMs || x.firstSeen || 0); })
      .filter(function (c) {
        var key = c.feed || c.id;
        if (seenF[key]) return false;
        seenF[key] = 1;
        return true;
      })
      .map(function (c) {
        var a = cloneQ(c.rec);
        a.mainFeed = c.feed; a.pubMs = c.pubMs; a.firstSeen = c.firstSeen;
        a.metric = metricOfFeed(c.feed); a.alts = [];
        return a;
      });
    q.altKey = q.alts.map(function (a) { return a.id + '@' + a.pubMs; }).join('|');
    q.altMaxPub = q.alts.length ? (q.alts[0].pubMs || q.alts[0].firstSeen || 0) : 0;
    /* ★★ 中文台网地名优先（用户报「日本宫古岛有地震吗？这是台湾的地震」）——
       USGS/EMSC 是按「最近地名」起名再经我们的译名表转中文：同一场台湾东南海域的地震，
       USGS 取「宫古岛」（离得更近）→ 译成「日本 宫古岛」，与中文用户直觉/台网口径不符。
       ⇒ 主卡为国外源、而候补里有中国台网（cenc/sc/fj/cq）同场报告时，地名改用台网中文名。 */
    if (!/^(cenc|sc|fj|cq)$/.test(String(q.mainFeed || ''))) {
      for (var ai = 0; ai < q.alts.length; ai++) {
        var a2 = q.alts[ai];
        if (/^(cenc|sc|fj|cq)$/.test(String(a2.feed || '')) && a2.place) { q.place = a2.place; break; }
      }
    }
    return q;
  }
  function cloneQ(q) { var o = {}; for (var k in q) o[k] = q[k]; return o; }
  /* ★ 速报有效期：wolfx 的 *_eew 接口会【一直挂着最后一条】，官方那边速报过了就撤。
     不设期限的话，某天没有新速报时卡片会一直显示几周前的「紧急地震速报」。 */
  var EEW_TTL = 30 * 60000;
  /* ★★★ 2026-10-29 速报同震判定（用户：「一个地震直接分裂成了三个卡片」）
   *  以前速报只按 `q.id` 去重 —— 而同一场地震会被**多个源**各推一份
   *  （wolfx `jma_eew` 与 P2P 556，id 分别是 `EEW:jma:<EventID>` / `EEW:p2p:<id>`），
   *  早期报文还可能**没有 EventID**（id 退化成発生時刻字符串）→ 后续报文换了 id。
   *  结果：履历里同一场地震出现 2~3 行，各自带不同的 M/深度/震源名
   *  （用户看到「千葉県北東部 50km M5.8」+「震源調査中 深度不明」两行）。
   *  规则（JMA 同一时刻不会同时发两场 EEW）：
   *   · 时间差 ≤ 10 分钟；
   *   · 两边都有坐标时相距 ≤ 2°；
   *   · 两边都有震级且差 > 1.5 → 不同地震；
   *   · 两边都有「真地名」且完全不沾边 → 不同地震（`震源調査中`/`不明` 算占位名）。
   */
  var EEW_PLACEHOLDER = /^(震源調査中|調査中|不明|未解析|解析中|)$/;
  function eewSameEvent(a, b) {
    /* ★★★ 2026-10-29：JMA 的 14 位事件 ID 是权威 —— 两边都有且不同，一定是两场
       （主震 + 余震常在同一地名、2° 内、10 分钟内，只靠时间/距离会误合）。 */
    var ea = jmaEventId(a && a.eventId), eb = jmaEventId(b && b.eventId);
    if (ea && eb && ea !== eb) return false;
    var dt = Math.abs((a.timeMs || 0) - (b.timeMs || 0));
    if (!(dt <= 10 * 60000)) return false;
    var ha = isFinite(a.lat) && isFinite(a.lon), hb = isFinite(b.lat) && isFinite(b.lon);
    if (ha && hb && distDeg(a, b) > 2.0) return false;
    if (isFinite(a.mag) && isFinite(b.mag) && a.mag > 0 && b.mag > 0 &&
      Math.abs(a.mag - b.mag) > 1.5) return false;
    var ca = corePlace(a.place), cb = corePlace(b.place);
    if (ca && cb && !EEW_PLACEHOLDER.test(ca) && !EEW_PLACEHOLDER.test(cb) &&
      ca !== cb && ca.indexOf(cb) < 0 && cb.indexOf(ca) < 0) return false;
    return true;
  }
  /* ★ 速报退场：同一场地震的【正式报】出现后，速报卡片就不再单独占位。
     正式报 = jma / jmaeq / cenc 这些 eqlist 源（非 isEew）。
     判据：震源时刻差 ≤ 6 分钟，且（核心地名一致 或 震中相距 < 0.8°）。
     ★ 2026-10-29：时间窗 90 秒 → 6 分钟。EEW 的 OriginTime 会被中途修正
       （首报 00:07:52 → 正式报 00:07:00 这种分钟级取整），90 秒在跨分钟时会刚好卡掉；
       另外 P2P 那一份常常没有坐标 —— 以前 `isFinite(f.lat)` 为假就整条跳过，
       于是「震源調査中」那张速报卡永远撤不掉。
     　—— 这就是用户问的「如何判断这是速报还是速报过后的正式报」的落地。 */
  function formalCovers(g, formalViews) {
    var v = viewOf(g), cp = corePlace(v.place);
    var ge = jmaEventId(v.eventId);
    for (var i = 0; i < formalViews.length; i++) {
      var f = formalViews[i];
      var fe = jmaEventId(f.eventId);
      if (ge && fe && ge !== fe) continue;
      if (Math.abs((f.timeMs || 0) - (v.timeMs || 0)) > 6 * 60000) continue;
      var fp = corePlace(f.place);
      if (cp && fp && !EEW_PLACEHOLDER.test(cp) && !EEW_PLACEHOLDER.test(fp) &&
        (cp === fp || cp.indexOf(fp) >= 0 || fp.indexOf(cp) >= 0)) return true;
      if (isFinite(f.lat) && isFinite(f.lon) && isFinite(v.lat) && isFinite(v.lon) &&
        distDeg(f, v) < 0.8) return true;
    }
    return false;
  }
  function maxFormalMs(list) {
    var maxT = 0;
    if (!list) return 0;
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (item && !item.isEew && isFinite(item.timeMs) && item.timeMs > maxT) {
        maxT = item.timeMs;
      }
    }
    return maxT;
  }
  /** 整份列表 → 分组 → 主卡片 + 候补 */
  function mergeList(raw, now) {
    now = now || Date.now();
    var latestFormal = maxFormalMs(raw);
    var arr = raw.filter(function (q) {
      if (!q || !q.id || !isFinite(q.timeMs) || !(q.timeMs > 0)) return false;
      if (q.isEew) {
        if (q.isTraining || q.isAssumption) return false;      /* 训练报 / 假定震源 */
        /* ★★★ 2026-10-30 用户：「data.js 中 isEew 的过期时间应该要有在有更新的正式地震情报进榜且发震时间更晚时自动降权」
           有更新的正式地震情报进榜时，旧速报保活期降权到 3 分钟（速报时效过了自动退场） */
        var ttl = (latestFormal > 0 && q.timeMs < latestFormal) ? 3 * 60000 : EEW_TTL;
        if ((now - q.timeMs) > ttl) return false;
      }
      return true;
    }).slice().sort(function (a, b) { return b.timeMs - a.timeMs; });

    var evs = [], eewIdx = {};
    for (var i = 0; i < arr.length; i++) {
      var q = arr[i], c = touchContrib(q, now), g = null, j;
      if (q.isEew) {
        /* ★ 速报：同一 id 的后续报文 = 同一条电文的更新；
           ★★★ 2026-10-29 **不同源 / 早期没有 EventID 的同一场地震也必须归到一组**
           （以前只按 id 去重 → wolfx 与 P2P 各出一张卡，履历里同一场地震两三行） */
        g = eewIdx[q.id];
        if (!g) {
          var vq = { isEew: true, timeMs: q.timeMs, lat: +q.lat, lon: +q.lon,
            mag: (+q.mag) || NaN, place: q.place || '', eventId: q.eventId || '' };
          for (j = 0; j < evs.length; j++) {
            var gg = evs[j];
            if (!gg.cs.length || !gg.cs[0].isEew) continue;
            if (eewSameEvent(viewOf(gg), vq)) { g = gg; break; }
          }
        }
        if (!g) { g = { cs: [] }; evs.push(g); }
        eewIdx[q.id] = g;      /* 别名：同一 id 的后续报文直接命中这一组（含借来的组） */
      } else {
        for (j = 0; j < evs.length; j++) {
          if (sameEvent(viewOf(evs[j]), q)) { g = evs[j]; break; }
        }
        if (!g) { g = { cs: [] }; evs.push(g); }
      }
      if (g.cs.indexOf(c) < 0) g.cs.push(c);
    }
    /* 正式报先算出来，用来让速报卡片退场 */
    var formal = [];
    for (i = 0; i < evs.length; i++) if (!evs[i].cs[0].isEew) formal.push(viewOf(evs[i]));
    evs = evs.filter(function (g) { return !g.cs[0].isEew || !formalCovers(g, formal); });

    /* ★★★ 2026-10-30 自动降权：若有更新的正式地震且发震时间更晚，对旧速报进行降权 */
    var maxFormalTime = 0;
    for (i = 0; i < formal.length; i++) {
      if ((formal[i].timeMs || 0) > maxFormalTime) maxFormalTime = formal[i].timeMs;
    }
    if (maxFormalTime > 0) {
      for (i = 0; i < evs.length; i++) {
        var g0 = evs[i];
        if (g0.cs && g0.cs.length && g0.cs[0].isEew) {
          var v0 = viewOf(g0);
          if ((v0.timeMs || 0) < maxFormalTime && (now - (v0.timeMs || 0)) > 3 * 60000) {
            for (var csi = 0; csi < g0.cs.length; csi++) {
              g0.cs[csi].isEew = false;
              g0.cs[csi].wasEew = true;
              if (g0.cs[csi].rec) {
                g0.cs[csi].rec.isEew = false;
                g0.cs[csi].rec.wasEew = true;
              }
            }
          }
        }
      }
    }

    gcContrib(now);
    var out = evs.map(buildQ);
    out.sort(function (a, b) { return (b.timeMs || 0) - (a.timeMs || 0); });
    return out;
  }

  /* --- 気象庁 津波予報（官方海啸页的数据源，和官方用的是同一个 JSON）---
   *  list.json 给事件头（发表时刻/震源/震级/明细文件名），明细给每个「津波予報区」的等级。
   *  ★ 用户要求：**日本地区名原样显示，不翻译**（官方也是日文汉字）。 */
  var TSU_LIST = 'https://www.jma.go.jp/bosai/tsunami/data/list.json';
  var TSU_DETAIL = 'https://www.jma.go.jp/bosai/tsunami/data/';
  /* 等级码 → { lv, cn }；lv 越大越严重（0 = 无） */
  var TSU_GRADE = {
    '52': { lv: 4, cn: '大海啸警报' }, '53': { lv: 3, cn: '海啸警报' },
    '54': { lv: 2, cn: '海啸注意报' }, '71': { lv: 1, cn: '海啸预报（海面轻微变动）' },
    '72': { lv: 1, cn: '海啸预报（海面轻微变动）' }, '00': { lv: 0, cn: '无海啸' }
  };
  /** 予想の高さ文字列 → 順位（大 きいほど高い）。官方取值：
   *   '' ＜ '<0.2' ＜ '0.2m' ＜ '1m' ＜ '3m' ＜ '5m' ＜ '10m' ＜ '10m<' ＜ '高い' ＜ '巨大' */
  function heightRank(s) {
    s = String(s || '').replace(/\s/g, '');
    if (!s) return 0;
    if (/^[<＜]?0\.2m?$/.test(s)) return 1;
    if (/10m[<＜]|10m以上|10m超/.test(s)) return 70;
    var m = /^([\d.]+)m?$/.exec(s);
    if (m) return 2 + Math.min(60, parseFloat(m[1]));
    if (/高い/.test(s)) return 80;
    if (/巨大/.test(s)) return 90;
    return 2;
  }
  /* ---------------- ★★ 模拟数据钩子（设置页「模拟设置」用） ----------------
   * 自制一个模拟设置：注入假地震 / 假海啸来玩 + 测功能。
   *   · 假地震：直接走 inject()（和实时推送同一条路），打 sim:1 标记 → 一键清掉
   *   · 假海啸：这里存一份覆盖值，refresh 拉到的真实数据会被它盖住
   *     （不去改 st.tsunami，不然每 60 秒被冲掉一次）*/
  var SIM = { tsunami: null };
  /* ★★ 2026-10-15 过期口径（用户：「海啸预警为什么不会自动消失，你没写取消报」）：
     JMA 的 tsunami/list.json 是【历史列表】，最新一条会一直留着 ——
     实测（本日）最新一条还是 10-10 的「津波予報（若干の海面変動）」，ift 仍是「発表」。
     不判的话：海啸页永久显示、设置页「有海啸时自动切到海啸页」也永久触发。
     ① ift（InfoType）含 取消/解除 → 无海啸；
     ② 详情 Head/Control 标题或 Headline 含 取消/解除 → 同上；
     ③ 发表时刻超过 TSU_TTL[等级] → 旧报（兜底：JMA 对「若干の海面変動」不发取消报）。
     ★ TSU_TTL 是【显示口径】，不是 JMA 的物理有效期，要改只改这张表。 */
  var TSU_TTL = { 4: 24 * 3600000, 3: 24 * 3600000, 2: 12 * 3600000, 1: 6 * 3600000, 0: 6 * 3600000 };
  /** 空态（取消 / 过期）：
   *  ★ 返回 **null**（而不是一个「maxLv=0 的对象」）—— views.js 的空态分支是按
   *    `tsunami === null` 判的，给对象的话旧报的震源/时间头还会被画出来
   *    （实测：页上会留着「10月10日 1:56左右 中米」）。
   *  原因存 TSU_LAST，调试用 QData.tsuLast() 取。 */
  var TSU_LAST = null;
  function tsuNone(out, why) {
    out = out || {};
    TSU_LAST = { why: why || '', ttl: out.ttl || '', at: out.at || '', ift: out.ift || '', atMs: out.atMs || 0 };
    return null;
  }
  function srcTsunami() {
    return fetchJSON(TSU_LIST, 10000).then(function (arr) {
      if (!arr || !arr.length) return null;
      var it = arr[0] || {};
      var out = {
        ttl: it.ttl || '', ttlEn: it.en_ttl || '', ift: it.ift || '',
        at: it.at || '', anm: it.anm || '', anmEn: it.en_anm || '',
        mag: num(it.mag), cod: it.cod || '', lat: NaN, lon: NaN,
        atMs: (function () { var d = Fmt.parse(it.at, 'Asia/Tokyo'); return d ? d.getTime() : 0; })(),
        pubMs: (function () { var d = Fmt.parse(it.rdt || it.ctt || it.at, 'Asia/Tokyo'); return d ? d.getTime() : 0; })(),
        items: [], maxLv: 0, head: ''
      };
      /* ① 取消报（InfoType = 取消/解除）→ 直接没海啸，连长明细都不用拉 */
      if (/取消|解除|cancel/i.test(String(it.ift || ''))) return tsuNone(out, 'ift=' + it.ift);
      /* cod 形如 "+07.5-080.8/" → 纬度 7.5 / 经度 -80.8 */
      var cm = String(out.cod).match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
      if (cm) { out.lat = num(cm[1]); out.lon = num(cm[2]); }
      if (!it.json) return out;
      return fetchJSON(TSU_DETAIL + it.json, 10000).then(function (d) {
        var C = (d || {}).Control || {}, Hd = (d || {}).Head || {};
        var htxt = String(Hd.Title || '') + ' ' + String(C.Title || '') + ' ' +
          String(((Hd.Headline || {}).Text) || '') + ' ' + String(Hd.InfoType || C.InfoType || '');
        if (/取消|解除|cancel/i.test(htxt)) return tsuNone(out, 'detail-cancel');   /* ② 详情里的取消/解除 */
        var F = ((d || {}).Body || {}).Tsunami || {};
        F = F.Forecast || {};
        var list = F.Item || (F.Item ? [F.Item] : []);
        out.items = list.map(function (x) {
          var a = x.Area || {}, c = ((x.Category || {}).Kind) || {}, h = ((x.MaxHeight || {}).TsunamiHeight) || '';
          var g = TSU_GRADE[c.Code] || { lv: 1, cn: c.Name || '' };
          var fh = x.FirstHeight || {}, mh = x.MaxHeight || {};
          /* ★★ 2026-10-11：官方列表第二行的「到达情报胶囊」（paNt**）就靠这几个字段：
               FirstHeight / MaxHeight 各带 { ArrivalTime, Condition }
               Condition 官方取值：到達予想 / 第１波の到達を確認 / 津波到達中と推測 / ただちに津波襲来と予想
               高度 TsunamiHeight：<0.2 / 0.2m / 1m / 3m / 5m / 10m / 10m< / 高い / 巨大
             （样本 diag/JMA-tsunami-detail.json 只有 71 津波予報，所以只有 TsunamiHeight） */
          return {
            code: String(a.Code || ''), name: a.Name || '', grade: g.lv, gradeName: g.cn, raw: c.Name || '',
            height: String(h),
            firstCond: String(fh.Condition || ''), firstAt: String(fh.ArrivalTime || ''),
            maxCond: String(mh.Condition || ''), maxAt: String(mh.ArrivalTime || '')
          };
        });
        out.items.forEach(function (x) { if (x.grade > out.maxLv) out.maxLv = x.grade; });
        /* 页面级最大高度（预告高度最高的一条）→ 决定顶部警报表用哪个造型 */
        var best = '';
        out.items.forEach(function (x) {
          if (x.grade === out.maxLv && x.height && heightRank(x.height) > heightRank(best)) best = x.height;
        });
        out.height = best;
        /* 震源深度（「深さ」那一行；官方 tsunami 页也画 paNsdep 色条）
           ⚠️ 真实响应里 Body.Earthquake 是【数组】（海外地震走 PTWC 时
              Hypocenter 里根本没有 Depth）→ 当成对象取就永远是 NaN。*/
        var eq = (((d || {}).Body || {}).Earthquake) || {};
        if (Array.isArray(eq)) eq = eq[0] || {};
        var hp = eq.Hypocenter || {};
        var dep = num(hp.Depth);
        out.dep = (isFinite(dep) && dep > 0) ? dep : NaN;
        if (!isFinite(out.mag) || !(out.mag > 0)) out.mag = num(eq.Magnitude);
        out.head = (((d || {}).Head || {}).Headline || {}).Text || '';
        /* ③ 旧报兜底：JMA 对「若干の海面変動」不发取消报 → 按等级超时当无海啸 */
        var ageMs = Date.now() - (out.pubMs || out.atMs || 0);
        if (ageMs > (TSU_TTL[out.maxLv] || 6 * 3600000)) return tsuNone(out, 'expired');
        return out;
      });
    });
  }

  /* ---------- 官方值缺失时的等级估算 ----------
   * 为什么要有：KonTP（安卓版）在 USGS 没给 mmi 时也会估算 → 它每一条地震都有等级；
   * 我们以前直接返回 -1 → 除了日本/中国源，其余全是「0 / 不明」（用户：「怎么全是零？怎么全是不知道？」）。
   * ★ 按项目铁律，估算必须用【司・翠川(1999)】的 PGV 式，不许自编线性公式：
   *     log10(PGV) = 0.58·M + 0.0038·D − 1.29 − log10(R + 0.0028·10^(0.5M)) − 0.002·R
   *     I(計測震度) = 2.68 + 1.89·log10(PGV)
   *   R = √(D²+X²)；取震源正上方（X=0）⇒ 得到的就是【这场地震的最大等级】（卡片要的正是最大值）。
   */
  function estimateI(mag, depthKm, lat, lon) {
    var M = num(mag); if (!isFinite(M) || M <= 0) return NaN;
    if (M > 10) M = 10;
    var D = (isFinite(depthKm) && depthKm > 0) ? depthKm : 10;
    /* ★★★ 2026-10-26 中国境内：改用 **GB 18306-2015 表 1 分区烈度衰减关系**
       （js/cn-gmpe.js，俞言祥等）。以前一律用司・翠川(1999) 的点源式，
       中国区会系统性偏低：1918 南澳 M7.3/15km 的极震区是 X 度，
       司・翠川只给到 5.58（烈度 8）—— 卡片、地图、海啸全从这个值往下算，一步错步步错。
       ⚠️ 只传了震级/深度（没有经纬度）时保持旧行为，不影响任何既有调用方。 */
    if (g.QVCNGM && isFinite(lat) && isFinite(lon) && g.QVCNGM.inChina(lat, lon)) {
      var lie = g.QVCNGM.peak(M, D, lat, lon);
      return isFinite(lie) ? Math.min(7.4, g.QVCNGM.appI(lie)) : NaN;
    }
    var R = D;
    var lg = 0.58 * M + 0.0038 * D - 1.29
      - Math.log10(R + 0.0028 * Math.pow(10, 0.5 * M)) - 0.002 * R;
    var I = 2.68 + 1.89 * lg;
    return isFinite(I) ? Math.max(0, Math.min(7, I)) : NaN;
  }
  /** 計測震度 → 本项目震度编码（0..7；50=5弱 55=5强 60=6弱 65=6强） */
  function shindoFromI(I) {
    if (!isFinite(I)) return -1;
    if (I < 0.5) return 0; if (I < 1.5) return 1; if (I < 2.5) return 2; if (I < 3.5) return 3;
    if (I < 4.5) return 4; if (I < 5.0) return 50; if (I < 5.5) return 55;
    if (I < 6.0) return 60; if (I < 6.5) return 65; return 7;
  }
  /** 計測震度 → 中国地震烈度（1..12）
   *  ★★★ 2026-10-21：换用 **GB/T 17742 的 PGV 参考值**反解本式（I = 2.68 + 1.72·lgPGV）：
   *     烈度 1..12 的 PGV = 0.1 / 0.4 / 0.9 / 1.8 / 3.5 / 7.1 / 14 / 28 / 57 / 110 / 220 / 440 cm/s
   *     → I 阈值 0.96 / 2.00 / 2.60 / 3.12 / 3.62 / 4.14 / 4.65 / 5.17 / 5.70 / 6.19 / 6.71 / 7.23
   *   旧表（I<0.5→2, I<1.5→3, …）整体偏高 2 度，与 liedu.js 的 codeOfI 是同一张表的两份拷贝，
   *   必须同步改，否则卡片最大烈度和地图色块会对不上。
   *   ⚠️ 拿不到 I 时返回 -1（不是 2）—— 「不明」和「烈度2」不能混。 */
  function lieduFromI(I) {
    if (!isFinite(I)) return -1;
    if (I < 0.96) return 0;
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
  function estimateRank(mag, depthKm, lat, lon) {
    var I = estimateI(mag, depthKm, lat, lon);
    if (!isFinite(I)) return { I: NaN, shindo: -1, liedu: -1 };
    return { I: I, shindo: shindoFromI(I), liedu: lieduFromI(I) };
  }

  /* ---------- ★ 按区域震度（官方地图色块的数据来源）----------
   * 官方情报页地图上那一大片按行政区着色的色块 = `nc<区域码>` 造型 + JMA 分区震度。
   * 分区震度在 JMA 地震明细 JSON 里：
   *   Body.Intensity.Observation.Pref[].Area[].{Code, MaxInt}
   * 而 Area.Code（如 "743"）正好就是造型名 nc743 的编号 —— 完全对得上。
   * 明细文件名在列表条目的 `json` 字段里，按需拉取（带缓存）。 */
  var AREAS_CACHE = {};
  function parseMaxInt(s) {
    if (s == null) return -1;
    var t = String(s).trim();
    if (!t || t === '-' || /\u4e0d\u660e/.test(t)) return -1;
    if (/^5\s*[-\u2212\u30fc\u2013\u2014]$/.test(t)) return 50;
    if (/^5\s*[+\uff0b]$/.test(t)) return 55;
    if (/^6\s*[-\u2212\u30fc\u2013\u2014]$/.test(t)) return 60;
    if (/^6\s*[+\uff0b]$/.test(t)) return 65;
    var n = parseInt(t, 10);
    /* ★ 归一化：这套 UI 用官方造型后缀编码，震度7 = 70（QV_SC_SUF(70)='9'）。
       直接返回 7 会被当成 6弱造型（后缀 7）→ 卡片把震度7 画成「6-」。 */
    return isFinite(n) ? (n === 7 ? 70 : n) : -1;
  }

  /* ★★★ 2026-10-25 修「地图没有调色」的真因（不在调色层，在【喂进去的明细不够全】）：
     JMA 对同一场地震会依次发好几份电文，明细文件名不同：
       · VXSE51「震度速報」        —— 只含 **震度3以上** 的那几个区域
       · VXSE52「震源に関する情報」—— 没有区域震度
       · VXSE53 / VXSE5k「震源・震度情報」—— **完整分布**
     实测小笠原 M7.0 深470km（eid 20261025111028）：
       VXSE51_0 → 1 个区域 / 0 观测点（地图上就一小块，看着像「没有调色」）
       VXSE5k_1 → 33 个区域 / 412 观测点（= SREV 那一整片）
     而地震列表条目的 `json` 字段常常还指着最早那份（各数据源抓取时刻不同）
     → 地图永远只有那一小块。
     ⇒ 拉 JMA 官方 list.json（60s 缓存），按 eid 取同一场「最全」的那份文件。 */
  var JMA_LIST = { at: 0, p: null, byEid: null };
  function jmaDetailRank(x) {
    var ttl = String((x && x.ttl) || ''), js = String((x && x.json) || '');
    var r = 1;
    if (/震源・震度/.test(ttl)) r = 30;
    else if (/震源.*震度/.test(ttl)) r = 25;
    else if (/震源/.test(ttl)) r = 10;
    else if (/震度速報/.test(ttl)) r = 5;
    if (/VXSE53|VXSE5k/i.test(js)) r += 4;
    else if (/VXSE51/.test(js)) r -= 1;
    return r;
  }
  function jmaListByEid() {
    var now = Date.now();
    if (JMA_LIST.p && (now - JMA_LIST.at) < 60000) return JMA_LIST.p;
    JMA_LIST.at = now;
    JMA_LIST.p = fetchJSON('https://www.jma.go.jp/bosai/quake/data/list.json', 8000).then(function (d) {
      var by = {};
      (Array.isArray(d) ? d : []).forEach(function (x) {
        var eid = String((x && x.eid) || '');
        if (!eid || !x.json) return;
        var r = jmaDetailRank(x), cur = by[eid];
        if (!cur || r > cur.r) by[eid] = { json: String(x.json), r: r, ttl: String(x.ttl || '') };
      });
      JMA_LIST.byEid = by;
      return by;
    }, function () { return JMA_LIST.byEid; });
    return JMA_LIST.p;
  }
  /** 列表条目 → 该场地震【最全】的明细文件名（拿不到 / 没更全的就退回它自己的 json） */
  function jmaDetailOf(q) {
    var dj = (q && q.detailJson) ? String(q.detailJson) : '';
    if (!dj) return Promise.resolve('');
    /* ★★★ 2026-10-25 回放专用：这条电文就是「第 N 报」，不许被择优逻辑换掉。
       否则回放震度速報时会直接跳到最全的 VXSE5k，整个中间过程全被吞掉。 */
    if (q && q.noMerge) return Promise.resolve(dj);
    var m = dj.match(/_(\d{14})_/);
    if (!m) return Promise.resolve(dj);        /* 不是 JMA 明细文件名（hist: 等）→ 原样用 */
    return jmaListByEid().then(function (by) {
      var best = by && by[m[1]];
      if (!best || !best.json) return dj;
      return (jmaDetailRank({ ttl: best.ttl, json: best.json }) >= jmaDetailRank({ json: dj })) ? best.json : dj;
    }, function () { return dj; });
  }
  function loadAreas(q) {
    if (!q || !q.detailJson) return Promise.resolve(null);
    var key = q.detailJson;
    var c = AREAS_CACHE[key];
    /* ★ 以前只缓存「一次结果」：如果第一次抓到的还是 VXSE51（只有 1 个区域），
       后面 JMA 发了 VXSE53 也不会再来问 → 整场地震永远只有一块色块。
       ⇒ 区域数 ≤ 1 时 45 秒后允许重试（正常一场地震 2~3 分钟内就会补全）。 */
    if (c && !(c.n <= 1 && (Date.now() - c.at) > 45000)) return c.p;
    var rec = { at: Date.now(), n: -1, p: null };
    AREAS_CACHE[key] = rec;
    rec.p = jmaDetailOf(q).then(function (file) {
      if (!file) return [];
      return fetchJSON('https://www.jma.go.jp/bosai/quake/data/' + file, 10000);
    }).then(function (d) {
      var obs = ((((d || {}).Body || {}).Intensity) || {}).Observation || {};
      var pref = obs.Pref; if (!pref) return [];
      if (!Array.isArray(pref)) pref = [pref];
      var out = [];
      pref.forEach(function (pf) {
        var arr = pf.Area; if (!arr) return;
        if (!Array.isArray(arr)) arr = [arr];
        arr.forEach(function (a) {
          var v = parseMaxInt(a.MaxInt);
          if (v >= 0 && a.Code) out.push({ code: String(a.Code), shindo: v });
        });
      });
      return out;
    }).then(function (out) {
      rec.n = (out && out.length) || 0;
      rec.at = Date.now();
      return out;
    }).catch(function () { return null; });
    return rec.p;
  }

  /* ---------- ★★ 観測点（明细 JSON 的【第 3 层】）----------
   * JMA 明细 JSON 其实有【三层】，我们以前只用了第一层：
   *   Observation.Pref[].Area[]                      ← ① 細分区域  Code=743（188 个 nc 造型）✅ 已用
   *                        .City[]                    ← ② 市区町村  上天草市 4321200
   *                        .City[].IntensityStation[] ← ③ 観測点    上天草市松島町＊
   *                                                       Int:"1" latlon:{lat,lon}  ★ 带精确经纬度
   * ⇒ 第 3 层**不需要任何边界图形**就能直接画点（只需经纬度 → 图集坐标）。
   *   官方也画这层（反编译 `diag/proccodes.txt`：自定义积木「[地図] 観測点検出描画」
   *   + `d ten:x/y`、`l:ten:点用カメラ範囲`、`l:dtc:Xpix/Ypix`、`l:d ten:観測点所属区域`）。
   *   一场大震有 1000~2000 个观测点 —— 这就是「把色块填深」的正主。
   * ⚠️ 与 loadAreas 分开缓存：区域层只要几十个，观测点层上千个，
   *    没开这个功能时不该白拉。 */
  var STATION_CACHE = {};
  function loadStations(q) {
    if (!q || !q.detailJson) return Promise.resolve(null);
    var key = q.detailJson;
    var c = STATION_CACHE[key];
    /* ★ 同 loadAreas：观测点也必须是【最全那份电文】（VXSE51 一个点都没有），
       点数 ≤ 1 时 45 秒后允许重试。 */
    if (c && !(c.n <= 1 && (Date.now() - c.at) > 45000)) return c.p;
    var rec = { at: Date.now(), n: -1, p: null };
    STATION_CACHE[key] = rec;
    rec.p = jmaDetailOf(q).then(function (file) {
      if (!file) return [];
      return fetchJSON('https://www.jma.go.jp/bosai/quake/data/' + file, 10000);
    }).then(function (d) {
      var obs = ((((d || {}).Body || {}).Intensity) || {}).Observation || {};
      var pref = obs.Pref; if (!pref) return [];
      if (!Array.isArray(pref)) pref = [pref];
      var out = [];
      pref.forEach(function (pf) {
        var arr = pf.Area; if (!arr) return;
        if (!Array.isArray(arr)) arr = [arr];
        arr.forEach(function (a) {
          var cs = a.City; if (!cs) return;
          if (!Array.isArray(cs)) cs = [cs];
          cs.forEach(function (c) {
            var st = c.IntensityStation; if (!st) return;
            if (!Array.isArray(st)) st = [st];
            st.forEach(function (s) {
              var ll = s.latlon || {};
              var v = parseMaxInt(s.Int);
              if (v < 0) return;                                    /* 不明/无值不画 */
              if (!isFinite(ll.lat) || !isFinite(ll.lon)) return;
              /* ★ area/areaName/city 一定要带上：
                 ① 悬停提示能写清「哪个市町村的哪个观测点」；
                 ② **校准用**：每个区域自己的观测点重心，才是该区域形状应有的位置。
                    不带这个就只能拿整条地震比，多区域的样本会失真到没法用。 */
              out.push({ lat: ll.lat, lon: ll.lon, v: v, name: s.Name || '',
                area: String(a.Code || ''), areaName: a.Name || '', city: c.Name || '' });
            });
          });
        });
      });
      return out;
    }).then(function (out) {
      rec.n = (out && out.length) || 0;
      rec.at = Date.now();
      return out;
    }).catch(function () { return null; });
    return rec.p;
  }

  /* ---------- ★★ 中国地震台网「周边台站」（2026-10-22）----------
   * 来源：www.cenc.ac.cn 开放产品接口（无需登录），但**没有 CORS 头**
   *       → 走本站 /api/cenc.php 代理转一手。
   *   GET open/data/<事件ID>/surroundStation
   * 每条台站带：stID / stla / stlo / elevation / distance / network。
   * ⚠ 没有观测值（instrument/sensitiv/sampleRate 全是 null）
   *   ⇒ 能替换「测站在哪」，不能替换「震度是多少」：
   *    烈度仍由 genStations 的司・翠川(1999) GMPE 算，只是采样点
   *    从「区县中心」换成「真实台站」（位置真、震中距真、方位角分布真）。
   * 事件ID = 北京时间 YYYYMMDDHHMMSS（= 发震时刻，如 20261022223339）。
   * ⚠ 实测（2026-10-22）：intensity / waveform / shakemap / isoseismal 全部返回空
   *   ——目前官方只开放了台站清单。 */
  var CENC_STA = {};
  /* ★ 2026-10-22 实测：cenc.ac.cn 对**境外机房 IP 一律 403**（香港、美国服务器都试了）。
     所以走 /api/cenc.php 代理也只会拿到 502。浏览器本身能访问（住宅 IP 没被封），
     但直连又卡在 CORS → 目前这条路在国内中转服务器就位前是死的。
     ⇒ 失败一次就把整场会话的熔断开上，不再白发请求；代码保留，接上中转改一个常量就行。 */
  var CENC_DEAD = false;
  function cencEventId(q) {
    var t = q && +q.timeMs;
    if (!(t > 0)) return '';
    var d = new Date(t + 8 * 3600000);          /* 北京时间 = UTC+8 */
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return String(d.getUTCFullYear()) + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) +
      p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds());
  }
  /** 返回 [lon, lat, name, areaCode, 'cn'] 数组（与 QV_CN 同格式）；失败/无数据 → null */
  function loadCencStations(q) {
    if (CENC_DEAD) return Promise.resolve(null);
    var id = cencEventId(q);
    if (!id) return Promise.resolve(null);
    var now = Date.now();
    var hit = CENC_STA[id];
    if (hit && (now - hit.t) < 10 * 60000) return hit.p;
    var p = fetchJSON('api/cenc.php?ev=' + id + '&what=surroundStation', 12000).then(function (j) {
      var d = (j && j.data) || null;
      var arr = (d && d.data) || (Array.isArray(d) ? d : null);
      if (!arr || !arr.length) return null;
      var out = [], k = 0;
      for (var i = 0; i < arr.length; i++) {
        var s = arr[i] || {};
        var la = +s.stla, lo = +s.stlo;
        if (!isFinite(la) || !isFinite(lo)) continue;
        /* 区域码用 99xxxx 避开真实 adcode（9xxxxx 是 DataV 补齐值） */
        out.push([lo, la, s.stID || s.station || '', 990000 + (k++), 'cn']);
      }
      return out.length ? out : null;
    }).catch(function () { CENC_DEAD = true; return null; });
    CENC_STA[id] = { t: now, p: p };
    return p;
  }

  /* ---------- ★★ USGS ShakeMap（2026-10-23）----------
   * 官方级的「烈度场」数据（**不是图片**）：
   *   1) 按时间+位置反查 USGS 事件（我们的条目可能来自 CENC/EMSC，没有 usgs id）
   *   2) 取 products.shakemap[0].contents['download/cont_mi.json'] —— 9 条闭合等震线
   *   3) 解析成 [{value, rings:[[lon,lat,...]], bb}]，由视图层拿来做「地级市最大 MMI」
   * ⚠ USGS 自带 CORS（浏览器可直连），**不需要服务器代理**。
   * ⚠ ShakeMap 不是每场都有：小震/无台站区域没有产品 → 返回 null，调用方回落模型。
   */
  var SM_CACHE = {};
  function smIso(ms) { return new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z'); }
  function smFlat(cs) {
    var o = [];
    for (var i = 0; i < cs.length; i++) { o.push(+cs[i][0], +cs[i][1]); }
    return o;
  }
  function smParseCont(j) {
    var fs = (j && j.features) || [], out = [];
    for (var i = 0; i < fs.length; i++) {
      var f = fs[i] || {};
      var v = +(f.properties && f.properties.value);
      if (!(v > 0)) continue;
      var g = f.geometry || {}, cs = g.coordinates || [], rings = [];
      if (g.type === 'MultiLineString') { for (var k = 0; k < cs.length; k++) rings.push(smFlat(cs[k])); }
      else if (g.type === 'LineString') rings.push(smFlat(cs));
      if (!rings.length) continue;
      var minx = 999, miny = 999, maxx = -999, maxy = -999;
      for (var r = 0; r < rings.length; r++) {
        var p = rings[r];
        for (var q2 = 0; q2 + 1 < p.length; q2 += 2) {
          if (p[q2] < minx) minx = p[q2]; if (p[q2] > maxx) maxx = p[q2];
          if (p[q2 + 1] < miny) miny = p[q2 + 1]; if (p[q2 + 1] > maxy) maxy = p[q2 + 1];
        }
      }
      out.push({ value: v, rings: rings, bb: [minx, miny, maxx, maxy] });
    }
    if (!out.length) return null;
    out.sort(function (a, b) { return a.value - b.value; });   /* 从低到高，视图层从后往前试 */
    return { feats: out };
  }
  /** 返回 {feats, maxmi} 或 null；按事件缓存 10 分钟 */
  function loadShakemap(q) {
    if (!q || q.lat == null || q.lon == null || !isFinite(+q.lat) || !isFinite(+q.lon) || !(q.timeMs > 0)) return Promise.resolve(null);
    var key = (q.id || '') + ':' + q.timeMs;
    var now = Date.now();
    var hit = SM_CACHE[key];
    if (hit && (now - hit.t) < 10 * 60000) return hit.p;
    var t = +q.timeMs, win = 180000;      /* ±3 分钟，足够匹配同一事件 */
    var url = 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson'
      + '&starttime=' + smIso(t - win) + '&endtime=' + smIso(t + win)
      + '&latitude=' + (+q.lat).toFixed(2) + '&longitude=' + (+q.lon).toFixed(2)
      + '&maxradiuskm=250&minmagnitude=3.0&orderby=time&limit=8';
    var p = fetchJSON(url, 12000).then(function (j) {
      var fs = (j && j.features) || [], best = null, bd = 1e18;
      for (var i = 0; i < fs.length; i++) {
        var f = fs[i], ft = +(((f.properties || {}).time) || 0);
        var dd = Math.abs(ft - t);
        if (dd < bd) { bd = dd; best = f; }
      }
      if (!best || bd > win) return null;
      /* ⚠⚠ 关键坑：按「时间+位置」查 fdsnws 返回的是**精简产品集**，
         `products.shakemap` 根本不在里面（实测 2026-10-22 us6000u43g）。
         `includeallproducts=true` 这个参数 USGS 不认（直接 400）。
         ⇒ 必须再用 eventid 查一次，那次才带完整产品（含 shakemap）。 */
      return fetchJSON('https://earthquake.usgs.gov/fdsnws/event/1/query?eventid='
        + encodeURIComponent(best.id) + '&format=geojson', 12000).then(function (full) {
        /* ⚠ 按 eventid 查返回的是**单个 Feature**（`{type:"Feature",properties:{...}}`），
           不是 FeatureCollection（按 bbox 查才是集合）——按集合取会永远拿到 undefined。 */
        var f2 = full ? (full.features ? full.features[0] : (full.type === 'Feature' ? full : null)) : null;
        if (!f2) return null;
        var sm = ((f2.properties || {}).products || {}).shakemap;
        if (!sm || !sm.length) return null;
        var c = sm[0].contents || {};
        var cj = c['download/cont_mi.json'];
        if (!cj) return null;
        return fetchJSON(cj.url, 15000).then(function (cont) {
          var r = smParseCont(cont);
          if (!r) return null;
          r.maxmi = parseFloat(sm[0].properties && sm[0].properties.maxmmi);
          r.usgsId = best.id;
          return r;
        });
      });
    }).catch(function () { return null; });
    SM_CACHE[key] = { t: now, p: p };
    return p;
  }

  var SOURCES = [
    { id: 'jma', label: '日本气象厅', fn: srcJmaList },
    { id: 'jmaeq', label: '日本气象厅(wolfx)', fn: srcJmaEq },
    { id: 'p2p', label: 'P2P地震情報', fn: srcP2p },
    { id: 'cenc', label: '中国地震台网', fn: srcCenc },
    { id: 'emsc', label: '欧洲地中海地震中心', fn: srcEmsc },
    { id: 'usgs', label: '美国地质调查局', fn: srcUsgs },
    /* ★ bg:true = 后台源：不阻塞 refresh()（实测它会挂 33 s，pri 最低，缺一轮无所谓） */
    { id: 'gdacs', label: 'GDACS', fn: srcGdacs, bg: true },
    { id: 'tsunami', label: '日本气象厅 · 海啸', fn: srcTsunami }
  ];
  Object.keys(EEW_URL).forEach(function (tag) {
    SOURCES.push({ id: 'eew_' + tag, label: (FEED['eew_' + tag] || {}).cn || ('速报 ' + tag), fn: function () { return srcEewOne(tag); } });
  });

  var st = { list: [], bySource: {}, health: {}, errors: {}, lastAt: 0, inflight: false,
    pushed: [], tsunami: null, stats: { raw: 0, shown: 0, mergedAway: 0 } };
  var ls = [];
  /* ★★★ 2026-10-26 用户：「在模拟期间暂时不用新的数据进来，专注于模拟这个时间段」
     → 自定义时间模拟开启后 FREEZE=true：轮询直接短路、真实推送不落地，
        只让模拟那一场（q.sim = 1）走 setEEW。清空输入 / 取消模拟时解除。 */
  var FREEZE = false;

  /** 重新合并（轮询结果 + 推送缓存）→ st.list */
  function rebuild() {
    var raw = [], k;
    for (k in st.bySource) raw = raw.concat(st.bySource[k] || []);
    raw = raw.concat(st.pushed);
    st.stats.raw = raw.length;
    st.list = mergeList(raw, Date.now());
    st.stats.shown = st.list.length;
    st.stats.mergedAway = Math.max(0, raw.length - st.list.length);
    st.lastAt = Date.now();
  }
  function emit() { ls.forEach(function (f) { try { f(st); } catch (e) { } }); }

  /** 单源抓取：**永不 reject**（失败记进 health 并返回空数组，不影响别的源） */
  function fetchOne(s) {
    if (s.running) return Promise.resolve([]);   /* 后台源可能上一轮还没完 */
    var t0 = Date.now();
    s.running = true;
    return Promise.resolve().then(s.fn).then(function (r) {
      /* ★ 海啸源返回的是【一个对象】不是地震数组 → 单独存，别混进 mergeList */
      if (s.id === 'tsunami') {
        st.tsunami = r || null;
        var n = (st.tsunami && st.tsunami.items) ? st.tsunami.items.length : 0;
        st.health[s.id] = { id: s.id, cn: s.label, ok: true, count: n, ms: Date.now() - t0, at: Date.now(), err: '' };
        return [];
      }
      r = r || [];
      st.bySource[s.id] = r; delete st.errors[s.id];
      st.health[s.id] = { id: s.id, cn: (FEED[s.id] || {}).cn || s.label, ok: true,
        count: r.length, ms: Date.now() - t0, at: Date.now(), err: '' };
      return r;
    }).catch(function (e) {
      var msg = String(e && e.message || e);
      st.errors[s.id] = msg;
      if (!st.bySource[s.id]) st.bySource[s.id] = [];
      st.health[s.id] = { id: s.id, cn: (FEED[s.id] || {}).cn || s.label, ok: false,
        count: st.bySource[s.id].length, ms: Date.now() - t0, at: Date.now(), err: msg };
      return [];
    }).then(function (r) { s.running = false; return r; });
  }

  function refresh() {
    /* ★ 自定义时间模拟期间：不去拉任何源，历史列表保持清空状态 */
    if (FREEZE) return Promise.resolve(st);
    if (st.inflight) return Promise.resolve(st);
    st.inflight = true;
    /* ★ 慢源（bg:true）单独跑，**不进 Promise.all**：
       GDACS 实测 33.5 s，以前它一个人能把整份列表拖 33 秒不更新。
       现在先出快源的结果，它回来了再补刷一次。 */
    SOURCES.forEach(function (s) {
      if (!s.bg) return;
      fetchOne(s).then(function () { rebuild(); emit(); });
    });
    var quick = SOURCES.filter(function (s) { return !s.bg; });
    return Promise.all(quick.map(fetchOne)).then(function () {
      rebuild();
      st.inflight = false;
      emit();
      return st;
    });
  }
  /* ★★ 2026-10-23 dmdata 付费电报（VTSE41/51/52）优先于 JMA 轮询与模拟 */
  var DM = { tsunami: null };
  function emitAll() { ls.forEach(function (f) { try { f(st); } catch (e) { } }); }
  g.QData = {
    refresh: refresh,
    get: function () { return st; },
    on: function (f) { ls.push(f); },
    parseShindo: sParse,
    USGS_MIN_MAG: USGS_MIN_MAG,
    /* 中文来源名 */
    srcLabel: function (s) {
      s = String(s || '');
      if (/^(TW|CWA)/.test(s)) return '台湾中央气象署';
      if (/JMA_EEW$/.test(s)) return '日本气象厅';
      if (/_EEW$/.test(s)) return '中国地震台网';
      if (s === 'JMA') return '日本气象厅';
      if (s === 'CENC') return '中国地震台网';
      if (s === 'USGS') return '美国地质调查局';
      return s;
    },
    /** ★ 各源健康度（应用信息页/调试用）：[{id,cn,ok,count,ms,at,err}] */
    health: function () {
      return SOURCES.map(function (s) { return st.health[s.id] || { id: s.id, cn: (FEED[s.id] || {}).cn || s.label, ok: null, count: 0, ms: 0, at: 0, err: '' }; });
    },
    stats: function () { return st.stats; },
    feeds: FEED,
    /** ★ 官方海啸（JMA 津波予報，与官方站同一份 JSON）；无海啸时为 null 或 maxLv=0
     *  ★★ 模拟值优先：设了模拟就展示模拟的那份 */
    tsunami: function () {
      /* dmdata 实时海啸优先，但超过 24 小时视为过期（防止取消报漏收时永久挂着） */
      var dm = DM.tsunami;
      if (dm && dm.pubMs && Date.now() - dm.pubMs > 24 * 3600000) dm = null;
      return dm || SIM.tsunami || st.tsunami;
    },
    /** ★ dmdata 实时海啸（VTSE41/51/52）；传 null 清除 */
    setDmTsunami: function (t) { DM.tsunami = t || null; emitAll(); return DM.tsunami; },
    tsuLast: function () { return TSU_LAST; },   /* ★ 最近一次「被判为无海啸」的原因（调试用） */
    /** ★★ 设置页「模拟设置」用：注入 / 清除假海啸（t 传 null 即清除） */
    simTsunami: function (t) {
      SIM.tsunami = t || null;
      ls.forEach(function (f) { try { f(st); } catch (e) { } });
      return SIM.tsunami;
    },
    /** ★★ 一键清掉所有模拟数据（假地震标了 sim:1，直接从推送缓存里剔掉） */
    clearSim: function () {
      SIM.tsunami = null;
      st.pushed = (st.pushed || []).filter(function (x) { return !(x && x.sim); });
      rebuild();
      ls.forEach(function (f) { try { f(st); } catch (e) { } });
      return st;
    },
    /** ★★★ 2026-10-26 自定义时间模拟：清空【全部】真实地震（不是只清模拟）
        → 轮询结果、推送缓存、海啸、健康度全清，Tab1 换成空列表 */
    clearAll: function () {
      st.bySource = {}; st.pushed = []; st.tsunami = null; st.errors = {}; st.health = {};
      SIM.tsunami = null;
      rebuild();
      ls.forEach(function (f) { try { f(st); } catch (e) { } });
      return st;
    },
    /** ★ 冻结开关：true = 不再接入任何新数据（自定义时间模拟专用） */
    freeze: function (on) { FREEZE = !!on; return FREEZE; },
    frozen: function () { return FREEZE; },
    tsunamiGrade: TSU_GRADE,
    heightRank: heightRank,
    estimateRank: estimateRank,
    estimateI: estimateI,
    /** ★ 按区域震度（官方地图色块的来源）；无明细返回 null */
    loadAreas: loadAreas,
    /** ★★ 観測点（第 3 层，带经纬度）→ [{lat,lon,v,name}]；官方也画这层 */
    loadStations: loadStations,
    /** ★★ 中国地震台网周边台站（真实经纬度，无观测值）→ [[lon,lat,name,code,'cn']] */
    loadCencStations: loadCencStations,
    cencEventId: cencEventId,
    /** ★★ USGS ShakeMap 等震线（官方烈度场，浏览器可直连）→ {feats,maxmi} | null */
    loadShakemap: loadShakemap,
    parseMaxInt: parseMaxInt,
    /** 推送层注入：WebSocket 单条事件 → 进推送缓存 → 重新合并（去重/置顶/更新同 id） */
    inject: function (q) {
      if (!q || !q.id) return;
      /* ★★★ 2026-10-21 用户：「开始模拟的时候不应该在第一个 Tab 页面显示模拟地震的信息吧，
         主要来源不还是 Tab 页 2 吗」
         ⇒ 模拟地震（q.sim）**不进 st.pushed**（那是 Tab1 情报/履历列表的数据源），
           只通知监听者刷新。Tab2 的紧急地震速报卡片由 setEEW() 独立驱动，不依赖这里。 */
      if (q.sim) {
        ls.forEach(function (f) { try { f(st); } catch (e) { } });
        return st;
      }
      /* ★ 自定义时间模拟期间：真实推送一律不采纳，保证「只看这一场」 */
      if (FREEZE) return st;
      var now = Date.now();
      /* ★ 清理过期：速报 30 分钟（若有更晚正式地震则 3 分钟降权）、普通地震 6 小时（以前推送缓存只增不减 → 界面会留死数据） */
      var maxPushedFormal = maxFormalMs(st.pushed);
      if (q && !q.isEew && isFinite(q.timeMs) && q.timeMs > maxPushedFormal) maxPushedFormal = q.timeMs;
      st.pushed = st.pushed.filter(function (x) {
        if (x.id === q.id) return false;
        var ttl = x.isEew
          ? ((maxPushedFormal > 0 && (x.timeMs || 0) < maxPushedFormal) ? 3 * 60000 : 30 * 60000)
          : 6 * 3600000;
        return (now - (x.timeMs || 0)) < ttl;
      });
      st.pushed.push(q);
      if (st.pushed.length > 400) st.pushed = st.pushed.slice(-400);
      rebuild();
      ls.forEach(function (f) { try { f(st); } catch (e) { } });
      return st;
    },
    /** ★ 2026-11-04：批量注入（realsrc 首轮会一次性 emit 两百多条历史，
     *  逐条 inject 会触发两百多次 rebuild + render → 进去时明显卡顿）。
     *  攒成一批：只做一次清理 / 一次 rebuild / 一次通知，语义与逐条一致。 */
    injectBatch: function (list) {
      if (!list || !list.length || FREEZE) return st;
      var now = Date.now();
      var ids = {}, maxPushedFormal = maxFormalMs(st.pushed), i, q;
      for (i = 0; i < list.length; i++) {
        q = list[i];
        if (!q || !q.id || q.sim) continue;
        ids[q.id] = 1;
        if (!q.isEew && isFinite(q.timeMs) && q.timeMs > maxPushedFormal) maxPushedFormal = q.timeMs;
      }
      st.pushed = st.pushed.filter(function (x) {
        if (ids[x.id]) return false;
        var ttl = x.isEew
          ? ((maxPushedFormal > 0 && (x.timeMs || 0) < maxPushedFormal) ? 3 * 60000 : 30 * 60000)
          : 6 * 3600000;
        return (now - (x.timeMs || 0)) < ttl;
      });
      /* 同一 id 在一批里出现多次（双端合并/后续报）→ 只留最后一条，避免重复进列表 */
      var keep = [], seen = {};
      for (i = list.length - 1; i >= 0; i--) {
        q = list[i];
        if (!q || !q.id || q.sim || seen[q.id]) continue;
        seen[q.id] = 1;
        keep.unshift(q);
      }
      for (i = 0; i < keep.length; i++) st.pushed.push(keep[i]);
      if (st.pushed.length > 400) st.pushed = st.pushed.slice(-400);
      rebuild();
      ls.forEach(function (f) { try { f(st); } catch (e) { } });
      return st;
    },
    SOURCES: SOURCES,
    FEED: FEED,
    /** ★ 离线自测钩子（仅 build/test-merge.js 用，界面不引用） */
    __t: {
      mk: mk,
      merge: function (raw, now) { return mergeList(raw, now); },
      reset: function () { for (var k in CONTRIB) delete CONTRIB[k]; },
      contrib: function () { return CONTRIB; },
      sameEvent: sameEvent,
      corePlace: corePlace
    }
  };
})(window);
