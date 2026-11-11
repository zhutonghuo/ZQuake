window.ZQ_NO_OFFICIAL_CLOCK = true;
(function () {
  function buildLegend() {
    var host = document.getElementById('qv-legend');
    if (!host) return;
    var metric = (window.QVViews && QVViews.eew && QVViews.eew.metric) || 'shindo';
    var rows = [], title = '震度';
    if (metric === 'liedu') {
      title = '烈度';
      var ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
      for (var lv = 12; lv >= 1; lv--) {
        var col = (window.QV_LIEDU && QV_LIEDU.colorOf) ? QV_LIEDU.colorOf(lv) : '#888';
        rows.push({ rn: ROMAN[lv], col: col, lb: String(lv) });
      }
    } else {
      var steps = [
        ['7', '#a30a6b', 70], ['6強', '#86046e', 65], ['6弱', '#c31b1b', 60],
        ['5強', '#e52a18', 55], ['5弱', '#ff9939', 50], ['4', '#f6cb51', 40],
        ['3', '#4cd0a7', 30], ['2', '#3098bd', 20], ['1', '#686870', 10], ['0', '#555', 0]
      ];
      for (var i = 0; i < steps.length; i++) {
        var c2 = (window.QVShindo && QVShindo.colorOf) ? QVShindo.colorOf(steps[i][2]) : steps[i][1];
        rows.push({ rn: '', col: c2, lb: steps[i][0] });
      }
    }
    var html = '<div class="qv-lt">' + title + '</div>';
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      html += '<div class="qv-row"><span class="qv-rn">' + r.rn + '</span>' +
        '<span class="qv-sw" style="background:' + r.col + '"></span>' +
        '<span class="qv-lb">' + r.lb + '</span></div>';
    }
    host.innerHTML = html;
  }

  function startClock() {
    var el = document.getElementById('qv-clock');
    if (!el) return;
    function tick() {
      var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
      el.textContent = d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' +
        p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }
    tick();
    setInterval(tick, 1000);
  }

  function setupBanner() {
    var banner = document.getElementById('qv-banner');
    if (!banner) return;
    function attach() {
      var ep = document.getElementById('eewpage');
      if (!ep) return false;
      function upd() {
        var cls = ep.className || '';
        var active = /(^|\s)(red|info)(\s|$)/.test(cls);
        if (!active) { banner.className = ''; return; }
        var E = (window.QVViews && QVViews.eew) || null;
        var warn = /(^|\s)red(\s|$)/.test(cls);
        var mag = (E && E.mag != null) ? ('M' + (+E.mag).toFixed(1)) : '';
        var rep = (E && E.report != null) ? ('第' + E.report + '报') : '';
        banner.innerHTML = '<span>' + (warn ? '地震警报' : '地震预警') + '</span>' +
          (mag ? '<span class="qn">' + mag + (rep ? (' · ' + rep) : '') + '</span>' : '');
        banner.className = 'on';
      }
      new MutationObserver(upd).observe(ep, { attributes: true, attributeFilter: ['class'] });
      upd();
      return true;
    }
    /* #eewpage 由 views.js 异步创建，可能晚于本脚本 init；轮询等待它出现再挂观察器 */
    if (!attach()) {
      var n = 0;
      var iv = setInterval(function () {
        if (attach() || ++n > 200) { clearInterval(iv); }
      }, 50);
    }
  }

  function setupNav() {
    var home = document.getElementById('qv-home');
    var set = document.getElementById('qv-set');
    if (home) home.onclick = function () {
      try {
        var c = window.QVMapCam;
        if (c && c.focus) c.focus();
        else if (window.QVViews && QVViews.focusHome) QVViews.focusHome();
      } catch (e) { }
    };
    if (set) set.onclick = function () {
      try { if (window.QVViews && QVViews.setView) QVViews.setView(3); } catch (e) { }
    };
  }

  function setupStatus() {
    var s = document.getElementById('qv-status');
    if (!s) return;
    var v = '1.0';
    try { if (window.ZQ_VERSION) v = window.ZQ_VERSION; } catch (e) { }
    s.innerHTML = '<b>ZQuake</b> 地震查看器 v' + v + '<br>WOLFX · P2P 在线';
  }

  function init() {
    buildLegend(); startClock(); setupBanner(); setupNav(); setupStatus();
    var ep = document.getElementById('eewpage');
    if (ep) new MutationObserver(function () { buildLegend(); })
      .observe(ep, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState !== 'loading') init();
  else window.addEventListener('DOMContentLoaded', init);
})();
