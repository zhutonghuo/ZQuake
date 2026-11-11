/* zh.js — 界面中文化
 *
 * 设计：
 *   1) 文案表（面板标题、字段名、状态词）全部中文
 *   2) 地名：优先查 QV_ZH_NAME（日文→中文），再退回逐字转换
 *   3) 数字/符号继续用官方字形零件拼（保持官方观感）
 *   4) 中文汉字没有官方零件 → 用系统字体绘制「中文标签层」
 */
(function (global) {
  'use strict';

  var NAME = global.QV_ZH_NAME || {};
  var CHAR = global.QV_ZH_CHAR || {};

  /* ---------------- 界面文案 ---------------- */
  var T = {
    title: 'ZQuake模拟器',
    /* 官方面板标题「各地の震度情報」→ 各地震度信息（速报态另用「震度速報」） */
    tabInfo: '各地震度信息',
    /* ★ 2026-10-21：烈度源（中国地震台网 / USGS …）走这套标题，别和震度混用 */
    tabInfoLiedu: '各地烈度信息',
    tabReal: '实时信息',
    tabTsu: '海啸信息',
    tabSet: '设置',
    maxShindo: '最大震度',
    maxLiedu: '最大烈度',
    originTime: '发生时间',
    place: '震源',
    magnitude: '震级',
    depth: '深度',
    tsunamiNone: '无海啸威胁',
    tsunamiWatch: '海啸注意报',
    tsunamiWarn: '海啸警报',
    tsunamiMajor: '大海啸警报',
    /* ★ 官方「津波の心配文」6 档里我们以前缺的 3 档（不明 / 調査中 / 若干の海面変動） */
    tsunamiUnknown: '海啸状况不明',
    tsunamiChecking: '海啸状况调查中',
    tsunamiSlight: '海面轻微变动',
    hist: '地震历史',
    updated: '更新',
    /* 官方放「で地震がありました」的位置（震源地下面那行小字） */
    quakeHappened: '发生了地震',
    unknown: '不明',
    veryShallow: '极浅',
    items: '条',
    eew: '紧急地震速报',
    eewLiedu: '中国地震预警',
    jma: '日本气象厅',
    cenc: '中国地震台网',
    cwa: '台湾中央气象署',
    usgs: '美国地质调查局',
    cancelled: '已取消',
    training: '训练',
    legendShindo: '震度',
    legendCoast: '海岸线',
    loading: '启动中…',
    error: '错误',
    /* 震度等级（中文习惯） */
    shindo0: '0', shindo1: '1', shindo2: '2', shindo3: '3', shindo4: '4',
    shindo5w: '5弱', shindo5s: '5强', shindo6w: '6弱', shindo6s: '6强', shindo7: '7',
    /* ★ 数据源没给官方等级时，我们用 司・翠川(1999) 估算 → 标「(推定)」 */
    estimatedSuffix: '(推定)',
    estimated: '推定',
    estimatedTag: '推定',
    /* ---- 海啸页（视图 2）：照官方「津波予報」版面 ---- */
    tsuForecast: '海啸预报',
    tsuAdvisory: '海啸注意报',
    tsuWarning: '海啸警报',
    tsuMajor: '大海啸警报',
    tsuNone: '无海啸',
    tsuSlight: '海面轻微变动',
    tsuMagnitude: '震级',
    tsuAreas: '预报区域',
    tsuNoInfo: '暂无海啸信息',
    tsuCoastLegend: '海岸线颜色',
    /* 视图 1（官方调试页 / 本版无本机传感器） */
    nothingToShow: '没有可显示的内容',
    /* 视图 3 */
    appInfo: '应用信息'
  };
  global.QV_ZH = T;

  /* ---------------- 地名中文化 ---------------- */
  function zhName(name) {
    var s = String(name == null ? '' : name).trim();
    if (!s) return '';
    if (NAME[s]) return NAME[s];
    /* 逐字转换兜底（日文汉字 → 简体） */
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (/[\u3041-\u309f\u30a0-\u30ff]/.test(ch)) continue;   /* 残留假名去掉 */
      out += CHAR[ch] || ch;
    }
    return out || s;
  }
  global.QVZhName = zhName;

  /* 数据源标签（中文） */
  function srcLabel(source) {
    var s = String(source || '');
    if (s === 'JMA') return T.jma;
    if (s === 'CENC') return T.cenc;
    if (s === 'USGS') return T.usgs;
    if (/^(TW|CWA)/.test(s)) return T.cwa;
    if (/-?JMA_EEW$/.test(s)) return T.jma;
    if (/_EEW$/.test(s)) return T.cenc;
    return s;
  }
  global.QVSrcLabel = srcLabel;

  /* 震度文案（中文） */
  function shindoText(v) {
    if (v == null || v < 0) return T.unknown;
    if (v >= 70) return T.shindo7;
    if (v >= 45) {
      var n = Math.round(v / 5) * 5;
      if (n >= 70) return T.shindo7;
      var base = Math.floor(n / 10);
      return base + (n % 10 === 5 ? '强' : '弱');
    }
    return String(Math.round(v));
  }
  global.QVShindoText = shindoText;
})(window);
