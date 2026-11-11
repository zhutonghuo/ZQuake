/* pack-boot.js — ZQuake 单包加速层（2026-10-31 重写，本地/127.0.0.1 也能用）
 *
 * 解决的问题：原版在 localhost/127.0.0.1 下故意关闭单包 → 预热要发 714 个独立
 *   HTTP 请求（preloadAll 逐个 fetch），被 IDM 的浏览器集成逐个拦截 ⇒ 既狂弹窗又卡死。
 *
 * 现在的做法（不依赖 Service Worker / DecompressionStream，纯 blob 接管）：
 *   ① 把 assets/ 下全部 714 个资源打成一个 bundle.pack（见 build_bundle.py）；
 *   ② 浏览器只发【1 次】请求，用 <script> 标签加载专用路由 /_zqpack.js
 *      （server.js 把包 base64 包成 window.__ZQPK__ 赋值脚本；URL 以 .js 结尾、
 *       Content-Type 为 text/javascript ⇒ 下载器扩展绝不会拦截脚本加载，连「大二进制」
 *       这类激进规则都碰不到——比 fetch 更彻底的一招；见 server.js）；
 *   ③ 解析后给每个资源造一个 blob: URL，并**劫持** window.fetch 与 <img src>，
 *      凡是 /assets/ 路径一律改从内存里的 blob 取 ⇒ 再也碰不到 IDM、也不发 714 请求；
 *   ④ 暴露 window.QVPackGate：Promise<true>=包就绪，false=失败回退（由 boot 直接放人）。
 *
 * 旁路（出问题不用改代码）：
 *   · URL 加 ?nosw=1   · 控制台 localStorage.setItem('koneew_no_sw','1') 后刷新
 *
 * ⚠ CSP 是 script-src 'self'：逻辑只能留在这个外部文件里。
 */
(function (g) {
  'use strict';

  var loc = g.location || {};
  var doc = g.document || {};

  /* ───────── 旁路开关 ───────── */
  function bypass() {
    if (loc.protocol !== 'https:' && loc.protocol !== 'http:') return 'protocol:' + loc.protocol;
    if (/[?&]nosw=1(&|$)/.test(loc.search || '')) return 'nosw-param';
    try {
      if (g.localStorage && g.localStorage.getItem('koneew_no_sw') === '1') return 'nosw-localStorage';
    } catch (e) { }
    return null;
  }
  if (bypass()) {
    try { console.log('[pack] 旁路单包：' + bypass()); } catch (e) { }
    return;
  }

  /* ───────── 资源接管（同步安装，越早越好） ───────── */
  var packMap = null;                 /* key(不含 assets/) -> { url, mime, blob } */
  var packState = 'loading';          /* loading | ready | failed */
  var pendingImgs = [];               /* 包未就绪时暂存的 <img>：[el, origUrl] */
  var imgSrcDesc = null;              /* HTMLImageElement.prototype 原始 src 描述符 */
  var MIME = {
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif', woff: 'font/woff', woff2: 'font/woff2',
    ttf: 'font/ttf', otf: 'font/otf', mp3: 'audio/mpeg', wav: 'audio/wav',
    json: 'application/json', js: 'text/javascript', css: 'text/css', ico: 'image/x-icon'
  };
  function mimeOf(name) {
    var i = name.lastIndexOf('.');
    var ext = (i >= 0 ? name.slice(i + 1) : '').toLowerCase();
    return MIME[ext] || 'application/octet-stream';
  }
  /* 从任意 assets URL 里取出包内 key。
   * ★ 必须同时认：'assets/x.svg'（相对）、'./assets/x.svg'、'/assets/x.svg'、
   *   'http://host/assets/x.svg'（绝对）、'../assets/x.svg' —— 代码里绝大多数是相对路径，
   *   早期版本只找 '/assets/'（带前导斜杠）→ 相对路径全部匹配失败 → 劫持形同虚设，
   *   几百个图片请求照走网络被下载器逐个拦截。 */
  function relKey(url) {
    if (typeof url !== 'string') return null;
    var s = url.split('#')[0];
    var q = s.indexOf('?');
    if (q >= 0) s = s.slice(0, q);
    var m = /^[a-z][a-z0-9+.\-]*:\/\//i.exec(s);
    if (m) {                                   /* 绝对 URL → 取 pathname */
      var sl = s.indexOf('/', m[0].length);
      s = sl >= 0 ? s.slice(sl) : '/';
    }
    var parts = s.split('/'), out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p || p === '.') continue;
      if (p === '..') { out.pop(); continue; }
      out.push(p);
    }
    for (var j = 0; j < out.length; j++) {
      if (out[j] === 'assets') return out.slice(j + 1).join('/');
    }
    return null;
  }

  function blobResponse(item) {
    try {
      return new g.Response(item.blob, {
        status: 200,
        headers: { 'Content-Type': item.mime, 'Content-Length': String(item.blob.size) }
      });
    } catch (e) { return null; }
  }

  /* 包内不存在的资源 → 内存合成 404，绝不走网络。
     这才是根治点：包就绪后，任何 /assets/ 路径都不再产生网络请求，
     下载器扩展无从下手（连 404 空请求都没有）。 */
  var NOT_FOUND_BLOB = null;
  function notFoundResponse() {
    try {
      if (!NOT_FOUND_BLOB) {
        NOT_FOUND_BLOB = new g.Blob([''], { type: 'text/plain' });
      }
      return new g.Response(NOT_FOUND_BLOB, {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Content-Type': 'text/plain', 'Content-Length': '0' }
      });
    } catch (e) { return null; }
  }
  /* 空图（1×1 全透明 PNG）：让 <img> 走完 onerror 而不产生网络请求。
     ⚠ 必须是【真透明】的 PNG：之前随手写的那段 base64 实际是 R=0,G=255,B=0,A=127
     的半透明纯绿 → 被拉伸成瓦片尺寸后铺满整屏 = 「地图全变绿」。 */
  var BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';

  /* —— 劫持 fetch —— */
  var realFetch = g.fetch ? g.fetch.bind(g) : null;
  if (realFetch) {
    g.fetch = function (input, init) {
      var u = typeof input === 'string' ? input : (input && input.url) || '';
      var key = relKey(u);
      if (key) {
        if (packMap && packMap[key]) {
          var r = blobResponse(packMap[key]);
          if (r) return Promise.resolve(r);
        } else if (packState === 'loading') {
          /* 包还在下载 → 排队等闸门，绝不放行到网络 */
          return new Promise(function (res, rej) {
            var gate = g.QVPackGate;
            if (!gate) { realFetch(input, init).then(res, rej); return; }
            gate.then(function () {
              if (packMap && packMap[key]) {
                var r2 = blobResponse(packMap[key]);
                if (r2) { res(r2); return; }
              }
              if (packState === 'ready') {         /* 包内没有 → 内存 404 */
                var r3 = notFoundResponse();
                if (r3) { res(r3); return; }
              }
              realFetch(input, init).then(res, rej);
            }, function () { realFetch(input, init).then(res, rej); });
          });
        } else if (packState === 'ready') {
          var nf = notFoundResponse();
          if (nf) return Promise.resolve(nf);
        }
      }
      return realFetch(input, init);
    };
  }

  /* —— 劫持 <img src>（属性赋值 + setAttribute 两条路都拦） —— */
  var ImgProto = g.HTMLImageElement && g.HTMLImageElement.prototype;
  if (ImgProto) {
    var desc = Object.getOwnPropertyDescriptor(ImgProto, 'src');
    imgSrcDesc = desc;
    if (desc && desc.set) {
      Object.defineProperty(ImgProto, 'src', {
        configurable: true, enumerable: desc.enumerable,
        get: desc.get,
        set: function (v) {
          if (typeof v === 'string') {
            var key = relKey(v);
            if (key) {
              if (packMap && packMap[key]) { v = packMap[key].url; }
              else if (packState === 'loading') {
                /* 包未就绪：暂存，先不设 src → 不产生任何网络请求 */
                pendingImgs.push([this, v]);
                return;
              } else if (packState === 'ready') {
                v = BLANK_PNG;            /* 包内没有 → 空白图，不走网络 */
              }
            }
          }
          return desc.set.call(this, v);
        }
      });
    }
    var realSetAttr = ImgProto.setAttribute;
    ImgProto.setAttribute = function (name, val) {
      if ((name === 'src' || name === 'SRC') && typeof val === 'string') {
        var key = relKey(val);
        if (key) {
          if (packMap && packMap[key]) val = packMap[key].url;
          else if (packState === 'loading') {
            pendingImgs.push([this, val]);
            return;
          } else if (packState === 'ready') {
            val = BLANK_PNG;
          }
        }
      }
      return realSetAttr.call(this, name, val);
    };
  }

  /* ───────── 拦截 innerHTML 里的 <img src="assets/..."> ─────────
     ★ 重要盲区：代码里大量用字符串拼 HTML 再塞进去，例如
        '<img class="bg" src="' + EEW_BG.y + '">'        （views.js 的 EEW 卡片）
        innerHTML 走的是【HTML 解析器】，根本不经过 im.src setter / setAttribute
        ⇒ 上面那套 JS 钩子完全管不到 → 这些图照旧发真实网络请求。
     这里拦 Element.prototype.innerHTML 的 setter，把 HTML 文本里的
     src="assets/..." 预先换成包内 blob URL。 */
  var InnerProto = g.Element && g.Element.prototype;
  var RE_SRC = /(\ssrc\s*=\s*)(["'])([^"']*assets\/[^"']*)\2/gi;
  function rewriteHtml(v) {
    if (typeof v !== 'string' || !packMap) return v;
    return v.replace(RE_SRC, function (m, pre, q, url) {
      var key = relKey(url);
      if (key && packMap[key]) return pre + q + packMap[key].url + q;
      if (key && packState === 'ready') return pre + q + BLANK_PNG + q;
      return m;
    });
  }
  if (InnerProto) {
    var innerDesc = Object.getOwnPropertyDescriptor(InnerProto, 'innerHTML');
    if (innerDesc && innerDesc.set) {
      Object.defineProperty(InnerProto, 'innerHTML', {
        configurable: true, enumerable: innerDesc.enumerable,
        get: innerDesc.get,
        set: function (v) {
          return innerDesc.set.call(this, rewriteHtml(v));
        }
      });
    }
  }

  /* insertAdjacentHTML / outerHTML 走同一个 HTML 解析器 → 同样要改写 */
  if (InnerProto) {
    var realIA = InnerProto.insertAdjacentHTML;
    if (typeof realIA === 'function') {
      InnerProto.insertAdjacentHTML = function (pos, html) {
        return realIA.call(this, pos, rewriteHtml(html));
      };
    }
    var outDesc = Object.getOwnPropertyDescriptor(InnerProto, 'outerHTML');
    if (outDesc && outDesc.set) {
      Object.defineProperty(InnerProto, 'outerHTML', {
        configurable: true, enumerable: outDesc.enumerable,
        get: outDesc.get,
        set: function (v) { return outDesc.set.call(this, rewriteHtml(v)); }
      });
    }
  }

  /* 包就绪后统一给暂存的 <img> 补上 src */
  function flushPending() {
    if (!pendingImgs.length) return;
    var list = pendingImgs; pendingImgs = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i][0], url = list[i][1];
      try {
        if (!el) continue;
        var key = relKey(url);
        var target;
        if (key && packMap && packMap[key]) target = packMap[key].url;
        else if (packState === 'ready') target = BLANK_PNG;   /* 包内没有 → 空白图 */
        else target = url;
        if (imgSrcDesc && imgSrcDesc.set) imgSrcDesc.set.call(el, target);
        else el.setAttribute('src', target);
      } catch (e) { }
    }
  }

  /* 注入 @font-face 指向包内 blob —— CSS 的 url() 不走 fetch/<img>，是劫持盲区。
     css/app.css 里的 src 已改成空 data URI 占位（避免 CSS 解析瞬间就发真实请求），
     真正的字体在这里由 JS 从内存 blob 注入 ⇒ 字体零网络请求。 */
  function patchFontFace() {
    try {
      var key = 'fonts/NotoSansSC-sub.woff2';
      var item = packMap && packMap[key];
      if (!item) return;
      var st = doc.createElement('style');
      st.setAttribute('type', 'text/css');
      st.textContent = '@font-face{font-family:\'NotoSC\';src:url("' + item.url +
        '") format("woff2");font-weight:100 900;font-display:swap;}';
      (doc.head || doc.documentElement).appendChild(st);
    } catch (e) { }
  }

  /* ───────── 闸门 ───────── */
  var resolved = false, resolveGate = null;
  g.QVPackGate = new Promise(function (res) { resolveGate = res; });

  /* 包内 blob 同步取用（audio.js 用它从内存直接取音效，彻底绕开任何下载器对 fetch 的劫持）。
     key 不含 assets/ 前缀，例如 'sounds/eew0.mp3' */
  g.QVPackGet = function (key) {
    if (!key) return null;
    if (packMap && packMap[key]) return packMap[key].blob;
    return null;
  };
  function finish(ok, how) {
    if (resolved) return;
    resolved = true;
    packState = ok ? 'ready' : 'failed';
    g.QVPackOk = !!ok;
    try { console.log('[pack] 闸门: ' + (ok ? '单包就绪' : '回退') + (how ? ' · ' + how : '')); } catch (e) { }
    if (ok) {
      try { flushPending(); } catch (e) { }
      try { patchFontFace(); } catch (e) { }
    } else {
      /* 回退：把暂存的 <img> 放行到真实网络（走服务器按需补） */
      try { flushPending(); } catch (e) { }
    }
    resolveGate(!!ok);
  }

  function bp() { return g.QVBootProgress || null; }
  /* ★ 2026-11-08 线上修复「进度一直卡 0.0MB」：
     pack-boot.js 在 <head> 里同步执行，QVBootProgress 此刻常常还没挂上
     （boot-progress.js 的初始化要等 DOM）→ 早期 setPack 被静默丢弃，
     启动页就一直显示 0.0 / 0.0 直到响应头回来。
     ⇒ 未就绪时记住最后一次进度，并短轮询补发，就绪后立刻刷成真实分母。 */
  var packSnap = null, waiting = false;
  /* 直接写启动页 DOM：#boot 在 <body> 开头，浏览器解析到它就能访问，
     而 boot-progress.js 的 start() 要等 DOMContentLoaded（几十个 defer 脚本，
     慢网实测 ~25s）才 pick() 元素。只靠 QVBootProgress.setPack 会在这段空窗里
     完全刷不动界面 ⇒ 用户看到「进度一直卡 0.0MB」。 */
  function renderPack(done, total, phase) {
    try {
      var pctN = total ? Math.min(100, Math.round(done / total * 100)) : 0;
      var e = doc.getElementById('bootMbTotal'); if (e && total) e.textContent = (total / 1048576).toFixed(1);
      var n = doc.getElementById('bootMbNow'); if (n) n.textContent = (done / 1048576).toFixed(1);
      var s = doc.getElementById('bootStatus'); if (s && phase) s.textContent = phase;
      var b = doc.getElementById('bootBar'); if (b) b.style.width = pctN + '%';
      var p = doc.getElementById('bootPct'); if (p) p.textContent = pctN;
    } catch (x) { }
  }
  function setPack(done, total, files, phase) {
    packSnap = [done, total, files, phase];
    renderPack(done, total, phase);            /* 无条件：DOM 一存在就立刻可见 */
    var B = bp();
    if (B && B.setPack) { B.setPack(done, total, files, files, phase); return; }
    if (waiting) return;
    waiting = true;
    (function retry(n) {
      if (n <= 0) { waiting = false; return; }
      var s = packSnap;
      if (s) renderPack(s[0], s[1], s[3]);    /* 每次都刷，DOM 出现后立刻接上 */
      var b = bp();
      if (b && b.setPack && s) {
        b.setPack(s[0], s[1], s[2], s[2], s[3]);
        waiting = false;
        return;
      }
      /* 慢网下 QVBootProgress 要等 defer 脚本下完才挂载（实测 ~35s），
         续命窗口必须覆盖整个加载期，否则早期进度仍会被丢成 0.0 / 0.0。 */
      g.setTimeout(function () { retry(n - 1); }, 100);
    })(1800);
  }

  /* ───────── 取包 + 解析 ───────── */
  function parsePack(buf) {
    var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    var off = 0;
    /* ★ 用无原型普通对象，不是 Map —— 全程用 packMap[key] 方括号访问，
       若用 Map 则 packMap[key] 恒为 undefined → fetch/图片/音效/字体四路拦截全部静默失效，
       几百个资源照旧走网络被下载器逐个拦截。 */
    var map = Object.create(null);
    function u8() { var v = dv.getUint8(off); off += 1; return v; }
    function u16() { var v = dv.getUint16(off, true); off += 2; return v; }
    function u32() { var v = dv.getUint32(off, true); off += 4; return v; }
    var magic = String.fromCharCode(u8(), u8(), u8(), u8());
    if (magic !== 'ZQPK') throw new Error('bad magic: ' + magic);
    u8();                                       /* version */
    var count = u32();
    for (var k = 0; k < count; k++) {
      var nl = u16(); var name = '';
      for (var j = 0; j < nl; j++) name += String.fromCharCode(u8());
      var ml = u8(); var mime = '';
      for (var j2 = 0; j2 < ml; j2++) mime += String.fromCharCode(u8());
      var dl = u32();
      var data = buf.subarray(off, off + dl);
      off += dl;
      var blob = new g.Blob([data], { type: mime });
      map[name] = { url: g.URL.createObjectURL(blob), mime: mime, blob: blob };
    }
    map.__count = count;
    return map;
  }

  /* base64 → Uint8Array（解析 _zqpack.js 赋值进来的 window.__ZQPK__） */
  function b64ToBytes(b64) {
    var bin = g.atob(b64);
    var len = bin.length;
    var out = new Uint8Array(len);
    for (var i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ───────── 取包 + 解析 ─────────
     线上（IIS 等纯静态服务器）优先【流式拉二进制包】：
       · 20MB 二进制 比 27MB base64 脚本少 25% 流量，慢网下省约 15 秒；
       · response.body.getReader() 每收一块就喂进度条 ⇒ 不再「卡 0.0MB」。
     本机 / 装了下载器扩展的环境仍走原来的 <script> 通道（fetch 会被扩展劫持），
     二进制通道失败也会自动回退到脚本通道，行为与旧版一致。 */
  var PACK_URL = 'assets/bundle.pack';
  var SCRIPT_URL = '_zqpack.js?v=20261031c';
  /* bundle.pack 真实字节数（build_bundle.py 生成时自动同步）。
     用途：① 响应没有 Content-Length 时兜底；② 服务器开启静态 gzip 后，
     Content-Length 是压缩后大小而 reader 读到的是解压后字节，必须用真实
     大小当分母，否则进度会冲过 100%。 */
  var PACK_FALLBACK_SIZE = 20318278;
  var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(loc.hostname || '');

  var tLoad0 = Date.now(), lastTick = tLoad0, stallLimit = 25000, scriptFallback = false;

  function applyBytes(bytes, how, startedAt) {
    if (resolved) return;                 /* 看门狗已放人 → 不再重复结算 */
    try {
      var p0 = Date.now();
      var map = parsePack(bytes);
      packMap = map;
      setPack(bytes.length, bytes.length, map.__count, '素材就绪 · 首帧绘制');
      finish(true, how + ' ' + map.__count + ' 个 (' + (Date.now() - p0) + 'ms parse, ' + (Date.now() - startedAt) + 'ms total)');
    } catch (e) {
      try { console.warn('[pack] 解析失败:', e && e.message || e); } catch (x) { }
      if (!scriptFallback) { scriptFallback = true; loadScript(); return; }
      finish(false, 'parse-error');
    }
  }

  /* 兜底 / 本机通道：<script> 加载 base64 脚本，下载器扩展不会拦普通脚本 */
  function loadScript() {
    lastTick = Date.now();
    stallLimit = 100000;                 /* 27MB @400KB/s ≈ 68s，放宽到 100s */
    setPack(0, PACK_FALLBACK_SIZE, 1, '下载资源包 · 首次约需 1 分钟');
    var s = g.document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = function () {
      try {
        var b64 = g.__ZQPK__;
        if (!b64) throw new Error('window.__ZQPK__ 缺失');
        var bytes = b64ToBytes(b64);
        try { delete g.__ZQPK__; } catch (e) { g.__ZQPK__ = null; }
        applyBytes(bytes, 'script', tLoad0);
      } catch (e) {
        try { console.warn('[pack] 解析失败，回退:', e && e.message || e); } catch (x) { }
        finish(false, 'err:' + (e && e.message || e));
      }
    };
    s.onerror = function () {
      try { console.warn('[pack] 资源包脚本加载失败，回退'); } catch (x) { }
      finish(false, 'script-error');
    };
    g.document.head.appendChild(s);
  }

  /* 主通道：一次 fetch，边下边更新真实字节进度 */
  function loadBinary() {
    if (!realFetch) { scriptFallback = true; loadScript(); return; }
    var startedAt = Date.now();
    var ctl = g.AbortController ? new g.AbortController() : null;
    setPack(0, PACK_FALLBACK_SIZE, 1, '下载资源包 · 首次约需 1 分钟');
    realFetch(PACK_URL, { cache: 'force-cache', signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        /* IIS 静态压缩开启后 Content-Length 是【压缩后】字节数，而 fetch 的 body
           已被浏览器透明解压，reader 累计的是【原始】字节数。此时若拿 header 当
           分母，进度会冲过 100%；检测到 Content-Encoding 就改用真实包大小。 */
        var enc = (r.headers && r.headers.get('Content-Encoding')) || '';
        var hdrLen = parseInt(r.headers && r.headers.get('Content-Length'), 10) || 0;
        var compressed = !!enc && enc.toLowerCase().indexOf('identity') < 0;
        var total = compressed ? PACK_FALLBACK_SIZE : (hdrLen || PACK_FALLBACK_SIZE);
        setPack(0, total, 1, '下载资源包 · 首次约需 1 分钟');
        if (!r.body || !r.body.getReader) {
          return r.arrayBuffer().then(function (b) {
            lastTick = Date.now();
            setPack(b.byteLength, total, 1, '素材解析中');
            return new Uint8Array(b);
          });
        }
        var reader = r.body.getReader(), chunks = [], got = 0, sincePaint = 0;
        function pump() {
          return reader.read().then(function (o) {
            if (o.done) {
              var out = new Uint8Array(got), off = 0;
              for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].length; }
              setPack(got, total, 1, '素材解析中');
              return out;
            }
            chunks.push(o.value); got += o.value.length; sincePaint += o.value.length;
            lastTick = Date.now();
            if (sincePaint >= 262144) {
              sincePaint = 0;
              setPack(got, total, 1, '下载资源包 · 首次约需 1 分钟');
            }
            return pump();
          });
        }
        return pump();
      })
      .then(function (bytes) { applyBytes(bytes, 'binary', startedAt); })
      .catch(function (e) {
        try { console.warn('[pack] 二进制通道不可用，回退脚本通道:', e && e.message || e); } catch (x) { }
        if (ctl) { try { ctl.abort(); } catch (x) { } }
        if (!scriptFallback) { scriptFallback = true; loadScript(); }
        else finish(false, 'binary-error');
      });
  }

  function load() { if (isLocal) loadScript(); else loadBinary(); }
  load();

  /* 看门狗：有字节进展就一直续命；连续 25 秒零进展（脚本通道 100 秒）或
     总时长超 180 秒才放人进界面，避免慢网下把还在下载的包提前判死。 */
  (function watchdog() {
    if (resolved) return;
    var now = Date.now();
    if (now - lastTick > stallLimit || now - tLoad0 > 180000) {
      finish(false, 'no-progress-timeout');
      return;
    }
    g.setTimeout(watchdog, 2000);
  })();

  g.addEventListener('pagehide', function () { /* 保活引用，交给 GC */ packMap = packMap; });

})(window);
