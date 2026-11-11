(function () {
  var g = window;
  var SHINDO = [
    ['7', 70, '#a30a6b'], ['6強', 65, '#86046e'], ['6弱', 60, '#c31b1b'],
    ['5強', 55, '#e52a18'], ['5弱', 50, '#ff9939'], ['4', 40, '#f6cb51'],
    ['3', 30, '#4cd0a7'], ['2', 20, '#3098bd'], ['1', 10, '#686870'], ['0', 0, '#555555']
  ];
  var ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  var LIEDU_FALLBACK = ['#555555', '#4c8ab0', '#2f9fbd', '#4cd0a7', '#a8d85a', '#f6cb51', '#ff9a35', '#f2682a', '#e1352a', '#c01542', '#8e0a6b', '#5e0761', '#3d0346'];
  var ICON = {
    fit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><circle cx="12" cy="12" r="2.2"/></svg>',
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/></svg>',
    cfg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="#08111b"/><circle cx="15" cy="12" r="2" fill="#08111b"/><circle cx="8" cy="17" r="2" fill="#08111b"/></svg>',
    src: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/><path d="M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/></svg>',
    sim: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13h3l2-6 3.2 11 3.1-9 2.4 4H22"/><circle cx="12" cy="12" r="10" opacity=".35"/></svg>'
  };
  var root = null, card = null, cardBody = null, cardFoot = null, badge = null;
  var scaleEl = null, scaleRow = null, scaleLabel = null, logEl = null;
  var timeEl = null, dateEl = null, ledSim = null, ledCustom = null, tip = null;
  var srcMask = null, fmtMask = null, srcStatusEl = null;
  var lastSig = '', lastScaleMetric = '', logs = [];
  var bootTimer = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clockText(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function dateText(d) { return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '  UTC+8'; }
  function eventTime(ms) {
    if (!ms || !isFinite(ms)) return '--:--:--';
    var d = new Date(ms);
    return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + clockText(d);
  }
  function num(v, n) {
    var x = +v;
    return isFinite(x) ? x.toFixed(n == null ? 1 : n) : '--';
  }
  function metricOf(E) { return E && E.metric === 'liedu' ? 'liedu' : 'shindo'; }
  /* 引擎内部的震度码是 0/1/2/3/4/50/55/60/65/70，标尺用 0/10/20/30/40/…
     两套写法在这里统一到标尺度量（1→10、4→40），自定义源与真实源都不会显示成「0」。 */
  function normLv(v, metric) {
    var n = +v;
    if (!isFinite(n) || n < 0) return n;
    if (metric === 'liedu') return Math.round(n);
    if (n >= 50) return n;
    if (n >= 1 && n <= 4) return n * 10;
    return Math.round(n);
  }
  function lvText(lv, metric) {
    if (lv == null || lv === '') return '--';
    if (metric === 'liedu') {
      var n = Math.max(0, Math.min(12, Math.round(+lv || 0)));
      return ROMAN[n] || String(n);
    }
    var v = normLv(lv, 'shindo');
    if (!isFinite(v)) return '--';
    var map = { 0: '0', 10: '1', 20: '2', 30: '3', 40: '4', 50: '5弱', 55: '5強', 60: '6弱', 65: '6強', 70: '7' };
    if (map[v] != null) return map[v];
    var keys = [0, 10, 20, 30, 40, 50, 55, 60, 65, 70], best = 0, gap = Infinity;
    for (var i = 0; i < keys.length; i++) {
      var d = Math.abs(keys[i] - v);
      if (d < gap) { gap = d; best = keys[i]; }
    }
    return map[best];
  }
  function lvColor(lv, metric) {
    try {
      if (metric === 'liedu' && g.QV_LIEDU && g.QV_LIEDU.colorOf) return g.QV_LIEDU.colorOf(+lv);
      if (g.QVShindo && g.QVShindo.colorOf) return g.QVShindo.colorOf(+lv);
    } catch (e) { }
    if (metric === 'liedu') return LIEDU_FALLBACK[Math.max(0, Math.min(12, Math.round(+lv || 0)))] || '#555';
    var n = normLv(lv, 'shindo');
    for (var i = 0; i < SHINDO.length; i++) if (SHINDO[i][1] === +n) return SHINDO[i][2];
    return '#555';
  }
  function stepsFor(metric) {
    if (metric === 'liedu') {
      var a = [];
      for (var n = 12; n >= 1; n--) a.push([ROMAN[n], n, lvColor(n, 'liedu')]);
      return a;
    }
    return SHINDO.map(function (s) { return [s[0], s[1], lvColor(s[1], 'shindo')]; });
  }
  function brandSvg() {
    return '<svg class="zq-mark" viewBox="0 0 40 40" fill="none">' +
      '<path d="M20 3L37 20 20 37 3 20Z" stroke="currentColor" stroke-width="1.2" opacity=".55"/>' +
      '<path d="M4 20h6l3-7 4 14 4-11 3 4h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="20" cy="20" r="2.1" fill="currentColor"/></svg>';
  }
  function waveSvg() {
    return '<svg viewBox="0 0 108 44" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M0 22h16l5-10 7 20 7-15 6 9 5-4h16l5-8 7 16 7-12 6 4h21" opacity=".9"/>' +
      '<circle cx="54" cy="22" r="17" opacity=".18"/>' +
      '<circle cx="54" cy="22" r="10" opacity=".25"/></svg>';
  }
  function build() {
    root = document.createElement('div');
    root.id = 'zq-ui';
    root.innerHTML =
      '<div class="zq-grid"></div>' +
      '<div class="zq-frame"><span class="zq-cn1"></span><span class="zq-cn2"></span></div>' +
      '<div class="zq-top">' +
        '<div class="zq-brand">' + brandSvg() +
          '<div class="zq-brand-txt"><b>ZQUAKE</b><span>SEISMIC OBSERVATORY · 地震观测台</span></div>' +
        '</div>' +
        '<div class="zq-top-mid">' +
          '<span class="zq-led on"><i></i>WOLFX</span>' +
          '<span class="zq-led on"><i></i>P2P / 556</span>' +
          '<span class="zq-led" id="zqLedSim"><i></i>SIM</span>' +
          '<span class="zq-led" id="zqLedCustom"><i></i>CUSTOM</span>' +
          '<span class="zq-led on"><i></i>OBS 1165</span>' +
        '</div>' +
        '<div class="zq-top-right"><div class="zq-time" id="zqTime">--:--:--</div>' +
          '<div class="zq-date" id="zqDate">----/--/--  UTC+8</div></div>' +
      '</div>' +
      '<div class="zq-card" id="zqCard">' +
        '<div class="zq-card-head"><span>EVENT MONITOR / 震情监视</span><span class="zq-badge" id="zqBadge">STANDBY</span></div>' +
        '<div class="zq-card-body" id="zqCardBody"></div>' +
        '<div class="zq-card-foot" id="zqCardFoot"><span>MODE <b>SIMULATION</b></span><span>OBSERVATORY <b>2.0</b></span></div>' +
      '</div>' +
      '<div class="zq-feed"><div class="zq-feed-h"><span>TELEGRAM LOG / 报文流</span><i></i></div>' +
        '<div class="zq-log" id="zqLog"></div></div>' +
      '<div class="zq-scale" id="zqScale">' +
        '<div class="zq-scale-h"><span>INTENSITY SCALE / 震度标尺</span><span id="zqScaleLabel">JMA SHINDO</span></div>' +
        '<div class="zq-scale-row" id="zqScaleRow"></div>' +
        '<div class="zq-scale-axis"><span>LOW</span><span>MODERATE</span><span>SEVERE</span><span>EXTREME</span></div>' +
      '</div>' +
      '<div class="zq-dock">' +
        '<button type="button" data-zq="fit" data-tip="全图复位 / RESET VIEW">' + ICON.fit + '</button>' +
        '<button type="button" data-zq="auto" data-tip="自动镜头 / AUTO CAM">' + ICON.auto + '</button>' +
        '<button type="button" data-zq="cfg" data-tip="参数设置 / CONFIG">' + ICON.cfg + '</button>' +
        '<button type="button" data-zq="src" data-tip="自定义数据源 / CUSTOM FEED">' + ICON.src + '</button>' +
        '<button type="button" data-zq="sim" data-tip="发起模拟地震 / SIMULATE">' + ICON.sim + '</button>' +
      '</div>';
    document.body.appendChild(root);
    tip = document.createElement('div');
    tip.className = 'zq-tip';
    document.body.appendChild(tip);
    card = root.querySelector('#zqCard');
    cardBody = root.querySelector('#zqCardBody');
    cardFoot = root.querySelector('#zqCardFoot');
    badge = root.querySelector('#zqBadge');
    scaleEl = root.querySelector('#zqScale');
    scaleRow = root.querySelector('#zqScaleRow');
    scaleLabel = root.querySelector('#zqScaleLabel');
    logEl = root.querySelector('#zqLog');
    timeEl = root.querySelector('#zqTime');
    dateEl = root.querySelector('#zqDate');
    ledSim = root.querySelector('#zqLedSim');
    ledCustom = root.querySelector('#zqLedCustom');
  }
  function renderScale(metric, level) {
    if (metric !== lastScaleMetric) {
      var st = stepsFor(metric), html = '';
      for (var i = 0; i < st.length; i++) {
        html += '<div class="zq-step" data-lv="' + st[i][1] + '" style="background:' + st[i][2] + '">' + esc(st[i][0]) + '</div>';
      }
      scaleRow.innerHTML = html;
      scaleLabel.textContent = metric === 'liedu' ? 'CSIS / 中国烈度' : 'JMA SHINDO / 日本震度';
      lastScaleMetric = metric;
    }
    var kids = scaleRow.children, target = level == null ? null : normLv(level, metric);
    for (var j = 0; j < kids.length; j++) {
      var on = target != null && +kids[j].dataset.lv === +target;
      if (on) kids[j].classList.add('on'); else kids[j].classList.remove('on');
    }
  }
  function pushLog(text) {
    var d = new Date();
    logs.unshift({ t: clockText(d), m: text });
    if (logs.length > 7) logs.length = 7;
    var html = '';
    for (var i = 0; i < logs.length; i++) {
      html += '<div><span class="t">' + esc(logs[i].t) + '</span><span class="m">' + esc(logs[i].m) + '</span></div>';
    }
    logEl.innerHTML = html;
  }
  /* 轻量模式：签名比对，数据没变就不重建卡片 DOM */
  var lastCardKey = '', lastDateTxt = '', autoBtn = null, bootEl = null;
  function renderIdle() {
    if (lastCardKey === 'IDLE') return;
    lastCardKey = 'IDLE';
    card.className = 'zq-card';
    badge.textContent = 'STANDBY';
    var obs = 1165;
    try { if (g.QVMapCam && g.QVMapCam.setStations) obs = 1165; } catch (e) { }
    cardBody.innerHTML =
      '<div class="zq-idle">' + waveSvg() +
        '<div class="zq-idle-t">台网监听中 · 暂无速报</div>' +
        '<div class="zq-idle-s">MONITORING / NO ACTIVE EVENT</div>' +
        '<div class="zq-idle-st"><span>测站阵列 <b>' + obs + '</b></span><span>链路 <b>ONLINE</b></span></div>' +
      '</div>';
    cardFoot.innerHTML = '<span>MODE <b>SIMULATION</b></span><span>OBSERVATORY <b>2.0</b></span>';
  }
  function renderEvent(E) {
    var metric = metricOf(E);
    var warn = !!E.warnPhase || +E.level >= 55;
    var alert = !warn && +E.level >= 40;
    var lv = E.level == null ? null : +E.level;
    var col = lv == null ? '#ffbf61' : lvColor(lv, metric);
    var areas = Array.isArray(E.areas) ? E.areas.slice(0, 6) : [];
    var rep = +E.report || 0, plan = +E.plan || 0;
    var feed = E.q && E.q.__custom ? 'CUSTOM' : (E.q && E.q.sim ? 'SIM' : 'LIVE');
    var areaSig = '';
    for (var z = 0; z < areas.length; z++) {
      var aa = areas[z] || {};
      areaSig += (aa.name || aa.code || '') + ':' + (aa.level == null ? lv : aa.level) + '|';
    }
    /* 只有数据真正变化才重建整块卡片；此前每轮 tick 无条件 innerHTML，是主要卡顿源 */
    var key = ['E', E.eventId || '', rep, plan, E.mag, lv, metric, E.place || '', E.depth,
      E.timeMs, E.lat, E.lon, E.obsN, E.isFinal ? 1 : 0, E.kind || '', warn ? 1 : 0,
      alert ? 1 : 0, feed, areaSig,
      E.allAreas ? E.allAreas.length : (E.fillShown ? E.fillShown.length : 0)].join('|');
    if (key !== lastCardKey) {
      lastCardKey = key;
      card.className = 'zq-card' + (warn ? ' warn' : (alert ? ' alert' : ''));
      badge.textContent = E.isFinal ? 'FINAL' : (warn ? 'WARNING' : (E.kind === 'cancel' ? 'CANCEL' : (E.kind === 'info' ? 'INFO' : 'ALERT')));
      var areaHtml = '';
      if (areas.length) {
        for (var i = 0; i < areas.length; i++) {
          var a = areas[i] || {};
          areaHtml += '<div class="zq-area" style="border-left-color:' + lvColor(a.level == null ? lv : a.level, metric) + '">' +
            '<span>' + esc(a.name || a.code || ('区域 ' + (i + 1))) + '</span>' +
            '<b>' + esc(lvText(a.level == null ? lv : a.level, metric)) + '</b></div>';
        }
      } else {
        areaHtml = '<div class="zq-area" style="border-left-color:' + col + '"><span>推定区域计算中</span><b>--</b></div>';
      }
      var pct = plan ? Math.max(0, Math.min(100, rep / plan * 100)) : 0;
      cardBody.innerHTML =
        '<div class="zq-hero">' +
          '<div class="zq-mag"><div class="lb">MAGNITUDE / 规模</div>' +
            '<div class="vl">M<small></small>' + num(E.mag, 1) + '</div></div>' +
          '<div class="zq-lvbox"><div class="lb">MAX ' + (metric === 'liedu' ? 'LIEDU' : 'SHINDO') + '</div>' +
            '<div class="vl" style="color:' + col + '">' + esc(lvText(lv, metric)) + '</div>' +
            '<div class="sb">' + (E.isFinal ? '最终报' : '推定最大') + '</div></div>' +
        '</div>' +
        '<div class="zq-place">' + esc(E.place || '震源位置解析中') + '</div>' +
        '<div class="zq-kv">' +
          '<div><div class="k">DEPTH / 深度</div><div class="v">' + num(E.depth, 0) + ' km</div></div>' +
          '<div><div class="k">ORIGIN / 发震</div><div class="v">' + esc(eventTime(E.timeMs)) + '</div></div>' +
          '<div><div class="k">EPICENTER / 震中</div><div class="v">' + num(E.lat, 1) + ' , ' + num(E.lon, 1) + '</div></div>' +
          '<div><div class="k">STATIONS / 检出</div><div class="v">' + (E.obsN == null ? '--' : E.obsN) + ' 站</div></div>' +
        '</div>' +
        '<div class="zq-rep"><div class="zq-rep-h"><span>REPORT SEQUENCE / 报序</span>' +
          '<b>' + (rep || '--') + (plan ? ' / ' + plan : '') + '</b></div>' +
          '<div class="zq-rep-track"><div class="zq-rep-fill" style="width:' + pct.toFixed(1) + '%"></div></div></div>' +
        '<div class="zq-sub">AFFECTED AREAS / 影响区域</div>' +
        '<div class="zq-areas">' + areaHtml + '</div>';
      cardFoot.innerHTML = '<span>FEED <b>' + feed + '</b></span>' +
        '<span>AREAS <b>' + (E.allAreas ? E.allAreas.length : (E.fillShown ? E.fillShown.length : 0)) + '</b></span>';
      renderScale(metric, lv);
      if (ledSim) ledSim.classList.toggle('on', !!(E.q && E.q.sim));
    }
    var sig = (E.eventId || '') + '|' + rep + '|' + num(E.mag, 1) + '|' + lv + '|' + (E.isFinal ? 1 : 0);
    if (sig !== lastSig) {
      pushLog('第' + (rep || 1) + '报 · M' + num(E.mag, 1) + ' · ' + lvText(lv, metric) + (E.isFinal ? ' · 最终' : ''));
      lastSig = sig;
    }
  }
  function tick() {
    if (!root) return;
    var d = new Date(), ct = clockText(d);
    if (timeEl && timeEl.textContent !== ct) timeEl.textContent = ct;
    if (dateEl) {
      var dt = dateText(d);
      if (dt !== lastDateTxt) { lastDateTxt = dt; dateEl.textContent = dt; }
    }
    var E = null;
    try { E = g.QVViews && g.QVViews.eew; } catch (e) { }
    /* 自定义源兜底：官方链路没接管画面（中国卡 / 纯情报条目）时，左卡仍显示最新事件 */
    if (!E) { try { E = g.QVCustomSrc && g.QVCustomSrc.display(); } catch (e) { } }
    if (!E) {
      if (lastSig !== '') { lastSig = ''; pushLog('事件结束 · 返回监听'); }
      var wasEvent = lastCardKey !== 'IDLE';
      renderIdle();
      if (wasEvent) renderScale(metricOf(null), null);
      if (ledSim && ledSim.classList.contains('on')) ledSim.classList.remove('on');
      if (ledCustom && ledCustom.classList.contains('on')) ledCustom.classList.remove('on');
    } else {
      renderEvent(E);
    }
    if (ledCustom) {
      var cOn = false;
      try { cOn = !!(g.QVCustomSrc && g.QVCustomSrc.status().on); } catch (e) { }
      if (ledCustom.classList.contains('on') !== cOn) ledCustom.classList.toggle('on', cOn);
    }
    if (!autoBtn) autoBtn = root.querySelector('[data-zq="auto"]');
    if (autoBtn) {
      var on = true;
      try { on = g.QVMapCam && g.QVMapCam.isAutoCam ? !!g.QVMapCam.isAutoCam() : true; } catch (e) { }
      if (autoBtn.classList.contains('act') !== on) autoBtn.classList.toggle('act', on);
      var tipTxt = on ? '自动镜头：开 / AUTO ON' : '自动镜头：关 / AUTO OFF';
      if (autoBtn.dataset.tip !== tipTxt) autoBtn.dataset.tip = tipTxt;
    }
    if (!bootEl) bootEl = document.getElementById('boot');
    if ((!bootEl || bootEl.hidden) && !root.classList.contains('ready')) root.classList.add('ready');
  }
  function openCfg() {
    var dlg = document.getElementById('qvdialog');
    if (dlg) { dlg.className = 'on'; return; }
    try { if (g.QVViews && g.QVViews.openAbout) g.QVViews.openAbout(); } catch (e) { }
  }
  function openSim() {
    try {
      if (g.QVViews && g.QVViews.openSimSettings) { g.QVViews.openSimSettings(); return; }
    } catch (e) { }
    var b = document.getElementById('simLaunchBtn');
    if (b) b.click();
  }
  function toggleAuto() {
    try {
      var c = g.QVMapCam;
      if (!c || !c.setAutoCam) return;
      var on = c.isAutoCam ? !!c.isAutoCam() : true;
      c.setAutoCam(!on);
    } catch (e) { }
    var b = document.getElementById('autoCamBtn');
    if (b && !g.QVMapCam) b.click();
  }
  function fit() {
    try {
      var c = g.QVMapCam;
      if (c && c.fit) c.fit();
      else if (c && c.focus) c.focus();
    } catch (e) { }
  }
  /* ==================== 自定义数据源面板 / JSON 格式说明 ==================== */
  var FMT_ROWS = [
    ['id', 'string', '推荐', '事件唯一标识。同一 id + seq + pubMs 视为同一报，轮询时不会重复弹提示；省略会自动生成。'],
    ['isEew', 'bool', '关键', 'true = 紧急地震速报（触发速报卡 / 音效 / 取景）；false = 普通情报（只进履历与报文流）。也识别 isEEW、is_eew、eew。'],
    ['timeMs', 'number', '必填', '发震时刻，毫秒 Unix 时间戳。也接受 10 位秒级时间戳、ISO 字符串、"YYYY/MM/DD HH:mm:ss"；缺省取当前时间。'],
    ['pubMs', 'number', '可选', '发报时刻。「10 分钟时效」按此字段判断；缺省 = timeMs。'],
    ['place', 'string', '可选', '震源地名，如「宫城县冲」。'],
    ['mag', 'number', '可选', '震级，如 6.3。'],
    ['depthKm', 'number', '可选', '震源深度（km），也接受 "20km" 这类带单位文本。'],
    ['lat / lon', 'number', 'EEW 必填', '震中纬度 / 经度。自定义速报若没有坐标会被跳过（标注 jma / p2p 来源的首报除外）。'],
    ['shindo', 'number', '可选', '最大震度，项目内部编码：0 / 1 / 2 / 3 / 4 / 50(5弱) / 55(5強) / 60(6弱) / 65(6強) / 70(震度7)，-1 = 不明。'],
    ['maxShindo', 'number', '可选', '同上，卡片优先取它。兼容 10/20/30/40 写法与 "5弱" "5+" "6-" "7" 等文本。'],
    ['liedu', 'number', '可选', '中国地震烈度 1~12，-1 = 不明。'],
    ['metric', 'string', '可选', '"liedu" = 中国烈度卡；其它值按 JMA 震度卡。'],
    ['seq', 'number', '可选', '报序（第几报）。同一 eventId 递增 seq 即为后续报。'],
    ['eventId', 'string', '可选', '事件号；同一场地震的多报请保持一致。'],
    ['isFinal / isCancel / isTraining / isWarn', 'bool', '可选', '最终报 / 取消报 / 训练报（不弹提示）/ 已发警报。'],
    ['source / feed', 'string', '可选', '来源标识。含 cenc 或坐标在中国境内 → 走中国卡；含 jma、p2p → 允许「震源調査中」无坐标首报。'],
    ['eewAreas', 'array', '可选', '区域明细 [{pref, name, from, to, arrivalMs}]；也接受 P2P 的 scaleFrom / scaleTo / arrivalTime。']
  ];
  function fmtDocHtml() {
    var i, h = '';
    h += '<div class="zq-fmt-sec"><h4>01 / 顶层结构（任选其一）</h4>' +
      '<ul><li><code>[ {…}, {…} ]</code> —— 事件数组（推荐）</li>' +
      '<li><code>{ … }</code> —— 单条事件</li>' +
      '<li><code>{ "list": [ … ] }</code> —— 带包裹，也认 data / events / quakes / results / items</li>' +
      '<li>WOLF-X <code>jma_eqlist.json</code> 那种「事件号为键」的大对象</li></ul></div>';
    h += '<div class="zq-fmt-sec"><h4>02 / 字段表（沿用项目现有归一化事件对象 q）</h4>' +
      '<div class="zq-fmt-table"><table><thead><tr><th>字段</th><th>类型</th><th>必填</th><th>说明</th></tr></thead><tbody>';
    for (i = 0; i < FMT_ROWS.length; i++) {
      h += '<tr><td><code>' + esc(FMT_ROWS[i][0]) + '</code></td><td>' + esc(FMT_ROWS[i][1]) +
        '</td><td>' + esc(FMT_ROWS[i][2]) + '</td><td>' + esc(FMT_ROWS[i][3]) + '</td></tr>';
    }
    h += '</tbody></table></div></div>';
    h += '<div class="zq-fmt-sec"><h4>03 / 完整示例（点下方按钮可一键填入 / 直接载入）</h4>' +
      '<pre id="zqFmtExample">' + esc(g.QVCustomSrc ? g.QVCustomSrc.EXAMPLE(false) : '[]') + '</pre></div>';
    h += '<div class="zq-fmt-sec"><h4>04 / 也直接吃这些「现有」原始格式</h4><ul>' +
      '<li>WOLF-X <code>jma_eew.json</code>：OriginTime / Hypocenter / Magunitude / MaxIntensity / Serial…</li>' +
      '<li>WOLF-X <code>jma_eqlist.json</code>：time_full / location / magnitude / latitude / longitude…</li>' +
      '<li>P2PQuake v2 <code>history</code> 数组：code 551（震源列表）/ 556（紧急地震速报），含 earthquake、issue、areas</li>' +
      '</ul><p class="zq-fmt-tip">也就是说，把任一现有数据源的响应原文粘进来即可，无需自己转换字段。</p></div>';
    h += '<div class="zq-fmt-sec"><h4>05 / 运行规则与注意</h4><ul>' +
      '<li>默认过滤 <b>10 分钟以前</b>的速报（与内置 wolfx / P2P 一致）。要回放历史事件请勾选「允许历史数据」。</li>' +
      '<li>同一 <code>id + seq + pubMs</code> 只注入一次；想让同一条重新触发，改 seq / pubMs 或点「清空缓存」。</li>' +
      '<li>示例里的 <code>timeMs / pubMs</code> 在打开页面时按当前时刻生成，复制出去后可直接使用；换成固定历史时间戳时请勾选「允许历史数据」。</li>' +
      '<li>URL 方式每 N 秒拉一次，并附加 <code>_zq=时间戳</code> 防缓存。跨域地址需服务端返回 <code>Access-Control-Allow-Origin</code>；若无 CORS 请改用「粘贴 JSON」或「本地文件」。</li>' +
      '<li>正在模拟地震时真实数据不接管画面，模拟结束后自动恢复接入。</li>' +
      '<li>仅用于演示与教学，不构成真实地震预警。</li></ul></div>';
    return h;
  }
  function buildPanels() {
    srcMask = document.createElement('div');
    srcMask.id = 'zqSrcMask';
    srcMask.className = 'zq-mask';
    srcMask.innerHTML =
      '<div class="zq-panel zq-src-panel" role="dialog" aria-modal="true" aria-label="自定义数据源">' +
        '<div class="zq-panel-h">' +
          '<div class="zq-panel-ttl"><b>CUSTOM FEED</b><span>自定义数据源</span></div>' +
          '<div class="zq-panel-acts">' +
            '<button type="button" class="zq-btn zq-btn-fmt" id="zqSrcFmtBtn">? JSON 格式说明</button>' +
            '<button type="button" class="zq-x" id="zqSrcClose" aria-label="关闭">×</button>' +
          '</div>' +
        '</div>' +
        '<div class="zq-panel-body">' +
          '<div class="zq-seg" id="zqSrcMode">' +
            '<button type="button" class="on" data-mode="url">URL 轮询</button>' +
            '<button type="button" data-mode="paste">粘贴 JSON</button>' +
            '<button type="button" data-mode="file">本地文件</button>' +
          '</div>' +
          '<div class="zq-pane on" data-pane="url">' +
            '<label class="zq-lb" for="zqSrcUrl">JSON 地址 / URL</label>' +
            '<input type="text" class="zq-in" id="zqSrcUrl" spellcheck="false" placeholder="https://example.com/quakes.json">' +
            '<div class="zq-row2"><div><label class="zq-lb" for="zqSrcInterval">轮询间隔（秒）</label>' +
              '<input type="number" class="zq-in" id="zqSrcInterval" min="2" max="3600" step="1" value="10"></div>' +
              '<div class="zq-note">每轮自动附加时间戳参数防缓存。跨域地址需服务端允许 CORS；不生效时请改用粘贴 / 文件方式。</div></div>' +
          '</div>' +
          '<div class="zq-pane" data-pane="paste">' +
            '<div class="zq-lb">JSON 内容 <button type="button" class="zq-link" id="zqSrcFill">填入示例</button>' +
              '<button type="button" class="zq-link" id="zqSrcPretty">格式化校验</button>' +
              '<button type="button" class="zq-link" id="zqSrcFmtBtn2">? 格式说明</button></div>' +
            '<textarea class="zq-ta" id="zqSrcJson" spellcheck="false" placeholder=\'[ { "id": "demo-1", "isEew": true, "timeMs": 1762887600000, "mag": 6.3, "lat": 38.2, "lon": 142.4 } ]\'></textarea>' +
          '</div>' +
          '<div class="zq-pane" data-pane="file">' +
            '<label class="zq-lb" for="zqSrcFile">选择本地 .json 文件</label>' +
            '<input type="file" class="zq-file" id="zqSrcFile" accept=".json,.txt,application/json,text/plain">' +
            '<div class="zq-note" id="zqSrcFileName">尚未选择文件 · 选好后点「保存并启用」或「立即拉取一次」</div>' +
          '</div>' +
          '<div class="zq-opts"><label class="zq-chk"><input type="checkbox" id="zqSrcAllowOld" checked>' +
            '<span>允许历史数据（跳过 10 分钟时效门槛，用于回放 / 演练）</span></label></div>' +
          '<div class="zq-src-status" id="zqSrcStatus">状态：未启用</div>' +
        '</div>' +
        '<div class="zq-panel-f">' +
          '<button type="button" class="zq-btn primary" id="zqSrcSave">保存并启用</button>' +
          '<button type="button" class="zq-btn" id="zqSrcRun">立即拉取一次</button>' +
          '<button type="button" class="zq-btn" id="zqSrcStop">停用</button>' +
          '<button type="button" class="zq-btn ghost" id="zqSrcClear">清空缓存</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(srcMask);

    fmtMask = document.createElement('div');
    fmtMask.id = 'zqFmtMask';
    fmtMask.className = 'zq-mask';
    fmtMask.innerHTML =
      '<div class="zq-panel zq-fmt-panel" role="dialog" aria-modal="true" aria-label="JSON 格式说明">' +
        '<div class="zq-panel-h">' +
          '<div class="zq-panel-ttl"><b>JSON FORMAT</b><span>自定义数据源 · 具体格式说明</span></div>' +
          '<button type="button" class="zq-x" id="zqFmtClose" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="zq-panel-body zq-fmt-body">' + fmtDocHtml() + '</div>' +
        '<div class="zq-panel-f">' +
          '<button type="button" class="zq-btn primary" id="zqFmtCopy">复制示例</button>' +
          '<button type="button" class="zq-btn" id="zqFmtFill">填入编辑框并关闭</button>' +
          '<button type="button" class="zq-btn" id="zqFmtLoad">直接载入示例</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(fmtMask);
    srcStatusEl = srcMask.querySelector('#zqSrcStatus');
    bindPanels();
  }
  function $(id) { return document.getElementById(id); }
  function showMask(m) { if (m) m.classList.add('on'); }
  function hideMask(m) { if (m) m.classList.remove('on'); }
  function switchMode(mode) {
    if (!srcMask) return;
    srcMask.querySelectorAll('#zqSrcMode button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.mode === mode);
    });
    srcMask.querySelectorAll('.zq-pane').forEach(function (p) {
      p.classList.toggle('on', p.dataset.pane === mode);
    });
  }
  function readForm() {
    var on = srcMask.querySelector('#zqSrcMode button.on');
    return {
      mode: on ? on.dataset.mode : 'url',
      url: $('zqSrcUrl') ? $('zqSrcUrl').value.trim() : '',
      interval: $('zqSrcInterval') ? $('zqSrcInterval').value : 10,
      json: $('zqSrcJson') ? $('zqSrcJson').value : '',
      allowOld: $('zqSrcAllowOld') ? $('zqSrcAllowOld').checked : true
    };
  }
  function writeForm(c) {
    switchMode(c.mode);
    if ($('zqSrcUrl')) $('zqSrcUrl').value = c.url || '';
    if ($('zqSrcInterval')) $('zqSrcInterval').value = c.interval || 10;
    if ($('zqSrcJson')) $('zqSrcJson').value = c.json || '';
    if ($('zqSrcAllowOld')) $('zqSrcAllowOld').checked = !!c.allowOld;
  }
  function refreshSrcStatus(st, text) {
    if (!srcStatusEl) return;
    st = st || (g.QVCustomSrc && g.QVCustomSrc.status()) || {};
    var at = st.lastAt ? new Date(st.lastAt) : null;
    srcStatusEl.innerHTML =
      '<div class="zq-st-row"><span class="zq-st-dot' + (st.on ? ' on' : '') + '"></span>' +
        '<b>' + esc(st.status || '未启用') + '</b></div>' +
      '<div class="zq-st-meta">轮次 ' + (st.round || 0) + ' · 累计 ' + (st.total || 0) + ' 条 · 本轮 ' + (st.lastCount || 0) + ' 条' +
        (at ? ' · 最近 ' + esc(clockText(at)) : '') + '</div>' +
      (st.lastErr ? '<div class="zq-st-err">' + esc(st.lastErr) + '</div>' : '') +
      (text ? '<div class="zq-st-msg">' + esc(text) + '</div>' : '');
  }
  function copyText(t, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { }
      document.body.removeChild(ta);
      pushLog(okMsg || '示例已复制');
      if (srcStatusEl) refreshSrcStatus(null, okMsg || '示例已复制');
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(fallback, fallback);
      } else fallback();
    } catch (e) { fallback(); }
  }
  function bindPanels() {
    srcMask.querySelectorAll('#zqSrcMode button').forEach(function (b) {
      b.addEventListener('click', function () { switchMode(b.dataset.mode); });
    });
    $('zqSrcClose').addEventListener('click', function () { hideMask(srcMask); });
    srcMask.addEventListener('click', function (e) { if (e.target === srcMask) hideMask(srcMask); });
    fmtMask.addEventListener('click', function (e) { if (e.target === fmtMask) hideMask(fmtMask); });
    $('zqFmtClose').addEventListener('click', function () { hideMask(fmtMask); });
    $('zqSrcFmtBtn').addEventListener('click', function () { showMask(fmtMask); });
    $('zqSrcFmtBtn2').addEventListener('click', function () { showMask(fmtMask); });
    $('zqSrcFill').addEventListener('click', function () {
      if (g.QVCustomSrc) $('zqSrcJson').value = g.QVCustomSrc.EXAMPLE(true);
      switchMode('paste');
      pushLog('已填入示例 JSON（时间戳为当前时刻）');
    });
    $('zqSrcPretty').addEventListener('click', function () {
      try {
        $('zqSrcJson').value = JSON.stringify(JSON.parse($('zqSrcJson').value), null, 2);
        refreshSrcStatus(null, 'JSON 校验通过');
      } catch (e) {
        refreshSrcStatus(null, 'JSON 解析失败：' + (e && e.message || e));
      }
    });
    $('zqSrcFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var txt = String(rd.result || '');
        if (g.QVCustomSrc) g.QVCustomSrc.setConfig({ memoryText: txt, mode: 'file' });
        $('zqSrcFileName').textContent = '已读取：' + f.name + '（' + (txt.length / 1024).toFixed(1) + ' KB）';
        switchMode('file');
        refreshSrcStatus(null, '文件已读取，点「保存并启用」或「立即拉取一次」');
      };
      rd.onerror = function () { $('zqSrcFileName').textContent = '文件读取失败'; };
      rd.readAsText(f, 'utf-8');
    });
    $('zqSrcSave').addEventListener('click', function () {
      var f = readForm();
      if (g.QVCustomSrc) { g.QVCustomSrc.setConfig(f); g.QVCustomSrc.start(); }
      pushLog('自定义数据源已启用 · ' + (f.mode === 'url' ? f.url || '(空地址)' : f.mode === 'file' ? '本地文件' : '粘贴 JSON'));
    });
    $('zqSrcRun').addEventListener('click', function () {
      var f = readForm();
      if (g.QVCustomSrc) { g.QVCustomSrc.setConfig(f); g.QVCustomSrc.once('手动拉取', true); }
    });
    $('zqSrcStop').addEventListener('click', function () {
      if (g.QVCustomSrc) g.QVCustomSrc.stop();
      pushLog('自定义数据源已停用');
    });
    $('zqSrcClear').addEventListener('click', function () {
      if (g.QVCustomSrc) g.QVCustomSrc.reset();
    });
    $('zqFmtCopy').addEventListener('click', function () {
      copyText(g.QVCustomSrc ? g.QVCustomSrc.EXAMPLE(true) : '[]', '示例 JSON 已复制');
    });
    $('zqFmtFill').addEventListener('click', function () {
      if (g.QVCustomSrc) $('zqSrcJson').value = g.QVCustomSrc.EXAMPLE(true);
      switchMode('paste');
      hideMask(fmtMask);
      pushLog('示例已填入 JSON 编辑框');
    });
    $('zqFmtLoad').addEventListener('click', function () {
      if (g.QVCustomSrc) {
        g.QVCustomSrc.setConfig({ mode: 'paste', json: g.QVCustomSrc.EXAMPLE(true), allowOld: true });
        g.QVCustomSrc.start();
      }
      writeForm(g.QVCustomSrc ? g.QVCustomSrc.config() : {});
      hideMask(fmtMask); hideMask(srcMask);
      pushLog('示例事件已载入 · 自定义源已启用');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { hideMask(fmtMask); hideMask(srcMask); }
    });
    if (g.QVCustomSrc) {
      g.QVCustomSrc.on(function (o) {
        if (o && o.kind === 'data') pushLog(o.text || '自定义源数据已接入');
        else if (o && o.kind === 'error') pushLog('自定义源错误 · ' + (o.text || ''));
        else if (o && o.kind === 'warn') pushLog(o.text || '自定义源暂缓接入');
        else if (o && o.kind === 'status' && o.text) pushLog(o.text);
        refreshSrcStatus(o && o.state, o && o.text);
      });
    }
  }
  function openSrc() {
    if (!srcMask) return;
    writeForm(g.QVCustomSrc ? g.QVCustomSrc.config() : {});
    refreshSrcStatus();
    showMask(srcMask);
  }
  function bind() {
    root.querySelectorAll('.zq-dock button').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.zq;
        if (k === 'fit') fit();
        else if (k === 'auto') toggleAuto();
        else if (k === 'cfg') openCfg();
        else if (k === 'src') openSrc();
        else if (k === 'sim') openSim();
      });
      b.addEventListener('mouseenter', function (e) {
        tip.textContent = b.dataset.tip || '';
        var r = b.getBoundingClientRect();
        tip.style.left = Math.max(8, r.left + r.width / 2 - 60) + 'px';
        tip.style.top = (r.top - 32) + 'px';
        tip.classList.add('on');
      });
      b.addEventListener('mouseleave', function () { tip.classList.remove('on'); });
    });
    window.addEventListener('resize', function () { tip.classList.remove('on'); });
  }
  function init() {
    g.QV_ZQ_FULLMAP = true;
    build();
    buildPanels();
    bind();
    renderIdle();
    renderScale('shindo', null);
    pushLog('台网就绪 · 监听已启动');
    /* 自定义数据源：等全部 defer 脚本就位后再按上次保存的配置恢复 */
    try { if (g.QVCustomSrc) g.QVCustomSrc.boot(); } catch (e) { }
    refreshSrcStatus();
    tick();
    setInterval(tick, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
