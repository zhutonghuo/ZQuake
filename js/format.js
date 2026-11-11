/* format.js — 时间/数值格式化 */
(function (g) {
  'use strict';
  function pad(n, w) { var s = String(n); while (s.length < (w || 2)) s = '0' + s; return s; }
  function tzOff(tz, d) {
    var f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    var p = {}; f.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - d.getTime()) / 60000;
  }
  /** ⚠️ timeZone 必须【不传】才是「本机时区」：传 null 会被 ToString 成 "null"
   *  → `RangeError: Invalid time zone specified`（整个应用起不来，2026-10-10 踩过） */
  function parts(d, tz) {
    var o = { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit' };
    if (tz) o.timeZone = tz;
    var f = new Intl.DateTimeFormat('en-US', o);
    var p = {}; f.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
  }
  function parse(s, tz) {
    if (!s) return null;
    if (s instanceof Date) return s;
    var str = String(s).trim();
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(str)) { var d0 = new Date(str); return isNaN(d0) ? null : d0; }
    var m = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) { var d1 = new Date(str); return isNaN(d1) ? null : d1; }
    var Y = +m[1], Mo = +m[2], D = +m[3], H = +m[4], Mi = +m[5], S = +(m[6] || 0);
    if (!tz) return new Date(Y, Mo - 1, D, H, Mi, S);
    var guess = Date.UTC(Y, Mo - 1, D, H, Mi, S);
    return new Date(guess - tzOff(tz, new Date(guess)) * 60000);
  }
  function jst(ms) { if (!ms) return '—'; var p = parts(new Date(ms), 'Asia/Tokyo');
    return pad(p.mo) + '/' + pad(p.d) + ' ' + pad(p.h) + ':' + pad(p.mi); }
  function jstFull(ms) { if (!ms) return '—'; var p = parts(new Date(ms), 'Asia/Tokyo');
    return p.y + '/' + pad(p.mo) + '/' + pad(p.d) + ' ' + pad(p.h) + ':' + pad(p.mi) + ':' + pad(p.s); }
  function mag(m) { return (!isFinite(m) || m < 0) ? '不明' : m.toFixed(1); }
  function dep(d) { return (!isFinite(d) || d < 0) ? '不明' : (d === 0 ? 'ごく浅い' : Math.round(d) + 'km'); }
  function sTxt(v) {
    if (v == null || v < 0) return '—';
    if (v >= 45) { var n = Math.round(v / 5) * 5; if (n >= 70) return '7'; return (n % 10 === 5 ? Math.floor(n / 10) + '強' : Math.floor(n / 10) + '弱'); }
    return String(Math.round(v));
  }
  function sCol(v) {
    if (v < 0) return '#3b4238';
    if (v >= 60) return '#a30a6b'; if (v >= 55) return '#c31b1b'; if (v >= 50) return '#e52a18';
    if (v >= 4) return '#ff9939'; if (v >= 3) return '#f6cb51'; if (v >= 2) return '#4cd0a7';
    if (v >= 1) return '#3098bd'; return '#3b4238';
  }
  function sInk(v) { return (v >= 3 && v < 45) ? '#1c1c1c' : '#ffffff'; }
  g.Fmt = { pad: pad, parse: parse, parts: parts, jst: jst, jstFull: jstFull, mag: mag, dep: dep, sTxt: sTxt, sCol: sCol, sInk: sInk };
})(window);
