/* boot-progress.js — 启动页总控（2026-11-02 按用户给的 Desktop/jzj.html 重做）
 *
 * 用户 2026-11-02：
 *   ① 「加载动画改成这样子的html」→ 布局照 jzj.html：
 *      左侧「大标题 + MB 进度 + 逐文件加载日志」，右侧「贪吃蛇」卡片（用户要求保留）
 *   ② 「打开网页必须一次性全部加载好，再把用户放进去。加载一点点东西就把我放进去，
 *      结果地图是反应好几秒的，卡片是点了没反应的，CSS 是缺失的」
 *      → 暴露 window.QVAssetsReady()：等所有 <img> load + decode、字体（@font-face
 *        NotoSansSC）就绪、连续两帧绘制完成才 resolve；js/app.js 的 showUI 用它
 *        决定何时撤 #boot。
 *
 * 进度数据源 = performance.getEntriesByType('resource')：
 *   · .js / .css / .woff2  → 逐条一行（tag / 文件名 / 大小 / 耗时）
 *   · assets/maptiles/*    → 聚合成一行（几十张，逐条会刷屏）
 *   · 百分比 = 脚本完成数/脚本总数 × 75% + 首屏图片完成数/总数 × 25%
 *
 * ⚠️ CSP 是 script-src 'self'：所有逻辑必须留在外部文件，不能用 <script> 内联。
 */
(function (g) {
  'use strict';
  var D = document;

  var bootEl = null, stageEl = null, logEl = null, nowEl = null, barEl = null;
  var pctEl = null, mbNowEl = null, mbTotalEl = null, statusEl = null, dotEl = null;

  var timer = 0, stopped = false, tickNo = 0;
  var seen = {};
  var skipResolve = null, skipRequested = false, abortLoad = false;
  var tileRow = null, tileN = 0, tileBytes = 0, tileMsSum = 0;
  var loadedBytes = 0, filesDone = 0, shownBytesTotal = 0;
  var expectCache = null;
  var lastFresh = '';

  var P = { sDone: 0, sTotal: 0, iDone: 0, iTotal: 0, phase: '正在载入资源', done: false };

  var FRAME = (g.requestAnimationFrame || function (f) { return g.setTimeout(f, 16); });

  function $(id) { return D.getElementById(id); }

  function pick() {
    if (bootEl) return;
    bootEl = $('boot');
    stageEl = $('bstage');
    logEl = $('bootlog');
    nowEl = $('bootNow');
    barEl = $('bootBar');
    pctEl = $('bootPct');
    mbNowEl = $('bootMbNow');
    mbTotalEl = $('bootMbTotal');
    statusEl = $('bootStatus');
    dotEl = $('bootDot');
  }

  /* ★★ 2026-11-02 用户：「100% 缩放都是不对了，只有在 80% 才是正常的」
     第一版是「1920×1080 固定舞台 + transform: scale(装下)」。1536×740 的窗口
     只剩 0.685 倍、左右各空 110px ⇒ 又小又留黑边。
     现在 CSS 用 grid 直接铺满视口（见 app.css 里 #boot .bstage 那段），
     这里**不再做任何缩放**，所以 fitStage 整个删掉。 */

  /* ───────── 小工具 ───────── */
  function bytesText(b) {
    if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
    if (b >= 1024) return Math.round(b / 1024) + ' KB';
    return Math.round(b) + ' B';
  }
  function mbText(b) { return (b / 1048576).toFixed(1); }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function tagOf(url) {
    var m = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(url);
    var ext = m ? m[1].toLowerCase() : '';
    if (ext === 'js' || ext === 'mjs') return ['JS', 'blue'];
    if (ext === 'css') return ['CSS', 'purple'];
    if (ext === 'json') return ['JSON', 'yellow'];
    if (ext === 'woff2' || ext === 'woff' || ext === 'ttf' || ext === 'otf') return ['FONT', 'pink'];
    if (ext === 'svg') return ['SVG', 'pink'];
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'gif') return ['IMG', 'pink'];
    if (ext === 'glsl' || ext === 'wgsl') return ['GLSL', 'violet'];
    if (ext === 'wasm') return ['WASM', 'teal'];
    return [ext ? ext.toUpperCase().slice(0, 4) : 'GET', 'gray'];
  }

  function baseName(url) {
    var n = String(url).split('?')[0].split('#')[0];
    return n.split('/').pop() || n;
  }

  /* ───────── 日志行 ───────── */
  function scrollLog() {
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }

  function addRow(tag, cls, name, sizeText, msText) {
    if (!logEl) return null;
    var li = D.createElement('li');
    li.className = 'blog-item';
    li.innerHTML =
      '<span class="tag t-' + cls + '">' + esc(tag) + '</span>' +
      '<span class="file">' + esc(name) + '</span>' +
      '<span class="size">' + esc(sizeText) + '</span>' +
      '<span class="ms">' + esc(msText) + '</span>';
    logEl.appendChild(li);
    while (logEl.children.length > 400) logEl.removeChild(logEl.firstChild);
    scrollLog();
    return li;
  }

  /* ───────── 进度 ───────── */
  function pctNow() {
    if (P.done) return 100;
    /* ★ 2026-11-02 用户：「进度条我看只有 6.6MB，地图都不止 50MB」——
       以前百分比是「已加载脚本数 / 总数」，MB 分母是瞎估的。
       现在有 assets/manifest.json（服务器实测生成，6193 个文件 / 75.2MB），
       直接用真实字节算。 */
    if (P.tBytes) return Math.max(1, Math.min(99, Math.round(P.dBytes / P.tBytes * 100)));
    var s = P.sTotal ? Math.min(1, P.sDone / P.sTotal) : 0;
    var i = P.iTotal ? Math.min(1, P.iDone / P.iTotal) : 0;
    var v = P.iTotal ? (s * 0.75 + i * 0.25) : (s * 0.75);
    return Math.max(1, Math.min(99, Math.round(v * 100)));
  }

  function paint() {
    var pct = pctNow();
    if (barEl) barEl.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct;

    if (P.tBytes) {
      /* 真实总量：分母来自 manifest，不再靠估 */
      if (mbNowEl) mbNowEl.textContent = mbText(P.dBytes);
      if (mbTotalEl) mbTotalEl.textContent = mbText(P.tBytes);
    } else {
      if (mbNowEl) mbNowEl.textContent = mbText(loadedBytes);
      /* 总量估算：已加载 + 剩余脚本数 × 已完成文件平均大小（只增不减，避免倒缩） */
      var est = loadedBytes;
      if (filesDone > 0) {
        var avg = loadedBytes / filesDone;
        if (avg < 40000) avg = 40000;
        est = loadedBytes + Math.max(0, P.sTotal - filesDone) * avg;
      }
      if (est > shownBytesTotal) shownBytesTotal = est;
      if (mbTotalEl) mbTotalEl.textContent = mbText(Math.max(shownBytesTotal, loadedBytes));
    }

    if (statusEl) statusEl.textContent = P.phase;

    if (nowEl) {
      if (P.tBytes) {
        nowEl.textContent = '资源 ' + P.dN + ' / ' + P.tN + ' 个' +
          (lastFresh ? '  ·  ' + lastFresh : '');
      } else if (P.iTotal && !P.iDone && lastFresh) nowEl.textContent = '正在解码 ' + lastFresh;
      else if (P.iTotal) nowEl.textContent = '素材解码 ' + P.iDone + ' / ' + P.iTotal;
      else if (lastFresh) nowEl.textContent = '正在载入 ' + lastFresh;
      else nowEl.textContent = '准备中';
    }
  }

  /* ───────── 资源清单（脚本 + 样式表） ───────── */
  function expectList() {
    var out = [], els;
    try { els = D.querySelectorAll('script[src], link[rel="stylesheet"]'); } catch (e) { els = []; }
    for (var i = 0; i < els.length; i++) {
      var u = els[i].src || els[i].href;
      if (u) out.push(u);
    }
    return out;
  }

  /* ───────── 主 tick（每 150ms） ───────── */
  function tick() {
    if (stopped) return;
    pick();
    if (!bootEl) return;
    tickNo++;

    var res = [];
    try { res = g.performance.getEntriesByType('resource') || []; } catch (e) { res = []; }

    if (!expectCache) expectCache = expectList();

    loadedBytes = 0;
    filesDone = 0;
    var freshNames = [];

    for (var i = 0; i < res.length; i++) {
      var r = res[i], url = r.name || '';
      if (!url) continue;
      var sz = r.transferSize || r.encodedBodySize || r.decodedBodySize || 0;
      loadedBytes += sz;

      /* 地图瓦片：几十上百张，聚合成一行 */
      if (url.indexOf('/assets/maptiles/') >= 0) {
        if (!seen[url]) {
          seen[url] = 1;
          tileN++;
          tileBytes += sz;
          tileMsSum += (r.duration || 0);
        }
        continue;
      }

      filesDone++;
      if (seen[url]) continue;
      seen[url] = 1;

      var tag = tagOf(url), nm = baseName(url);
      addRow(tag[0], tag[1], nm, bytesText(sz), Math.round(r.duration || 0) + 'ms');
      freshNames.push(nm);
    }

    /* 瓦片聚合行：永远贴在最后，内容实时累加 */
    if (tileN) {
      if (!tileRow && logEl) {
        tileRow = D.createElement('li');
        tileRow.className = 'blog-item';
        tileRow.innerHTML =
          '<span class="tag t-pink">IMG</span>' +
          '<span class="file"></span>' +
          '<span class="size"></span>' +
          '<span class="ms"></span>';
        logEl.appendChild(tileRow);
      }
      if (tileRow) {
        tileRow.querySelector('.file').textContent = 'assets/maptiles/*.svg  ×' + tileN;
        tileRow.querySelector('.size').textContent = bytesText(tileBytes);
        tileRow.querySelector('.ms').textContent = Math.round(tileMsSum) + 'ms';
        if (logEl && logEl.lastElementChild !== tileRow) logEl.appendChild(tileRow);
        scrollLog();
      }
    }

    if (freshNames.length) lastFresh = freshNames[freshNames.length - 1];

    /* 脚本完成度 */
    var done = 0;
    for (var e = 0; e < expectCache.length; e++) if (seen[expectCache[e]]) done++;
    P.sTotal = expectCache.length;
    P.sDone = done;

    /* ★ 2026-10-22：P.tBytes 有值 = 单包模式 或 清单模式，阶段文案由
       setPack() / preloadAll() 自己写，tick 别把它盖成「脚本就绪…」 */
    if (!P.iTotal && !P.tBytes) {
      if (done < P.sTotal) P.phase = '正在载入资源';
      else P.phase = '脚本就绪 · 等待首屏数据';
    }

    paint();
  }

  function start() {
    pick();
    if (!bootEl) return;
    expectCache = expectList();
    P.sTotal = expectCache.length;
    addRow('OK', 'green', 'boot  koneew core', '', '');
    lastFresh = '';
    tick();
    timer = g.setInterval(tick, 150);
    var sb = $('bootSkip');
    if (sb) sb.addEventListener('click', function () {
      if (g.QVBootProgress && QVBootProgress.skip) QVBootProgress.skip();
    });
    snakeInit();
  }

  function stop() {
    stopped = true;
    if (timer) { g.clearInterval(timer); timer = 0; }
  }

  /* ───────── 全部素材就绪（供 app.js 的 showUI 等待） ───────── */
  function raf2() {
    return new Promise(function (res) {
      var done = false;
      function fin() { if (done) return; done = true; res(); }
      FRAME(function () { FRAME(fin); });
      /* ★★ 2026-11-02 坑：requestAnimationFrame 在**后台标签页会完全暂停**，
         页面切到后面 / 最小化时闸门永远不 resolve → 加载页永不消失。
         线上实测卡在「素材解码 423/660」就是不揭幕的真因之一。
         加 400ms 定时器兜底，无论如何都会放行。 */
      g.setTimeout(fin, 400);
    });
  }

  function waitOne(im) {
    return new Promise(function (res) {
      var done = false;
      function fin() {
        if (done) return;
        done = true;
        P.iDone++;
        paint();
        res();
      }
      var src = im.getAttribute('src') || im.src;
      if (!src) { fin(); return; }
      if (im.complete) {
        if (im.decode) im.decode().then(fin, fin); else fin();
        return;
      }
      im.addEventListener('load', function () {
        if (im.decode) im.decode().then(fin, fin); else fin();
      }, { once: true });
      im.addEventListener('error', fin, { once: true });
    });
  }

  /* ★★★ 2026-11-02 用户：「我都说没有渲染完，加载完，不要放用户进来」——
     以前这里只抓 `document.images` 的**当下快照**，可是：
       · 地图瓦片是 mapcam 渲染时 new Image() 一张张塞进 #map 的
         （264 张，网络一慢就是「一块一块冒出来」）
       · EEW 卡片素材是模拟/速报**第一次出现时**才创建的 <img>
         （用户点开模拟 → 空白卡）
       · @font-face 的 NotoSC 只有真正排版到中文才会去下载
     快照抓不到后来才出现的资源。
     ⇒ 改成**轮询直到稳定**：数量连续 3 轮不变 + 全部 complete + 字体 loaded 才放行。
       25 秒硬超时兜底，绝不把人永久锁在黑幕里。 */
  var PRE = [];   /* prewarm() 丢进来的预热图片（不在 document.images 里） */
  var PRE_SEEN = {};
  function prewarm(urls) {
    if (!urls || !urls.length) return 0;
    var n = 0;
    for (var i = 0; i < urls.length; i++) {
      var u = urls[i];
      /* ⚠ 用 PRE_SEEN 而不是 seen：seen 是 tick() 打日志的去重表，
         污染它会让这些资源真正加载时不再出现在日志里 */
      if (!u || typeof u !== 'string' || PRE_SEEN[u]) continue;
      PRE_SEEN[u] = 1;
      var im = new Image();
      im.decoding = 'async';
      im.src = u;
      PRE.push(im);
      n++;
    }
    if (n) addRow('PRE', 'purple', '预热 EEW 卡片素材', n + ' 张', '');
    return n;
  }

  function collectImgs() {
    var out = [];
    try { out = [].slice.call(D.images || []); } catch (e) { out = []; }
    for (var i = 0; i < PRE.length; i++) out.push(PRE[i]);
    return out;
  }

  /* ★★★ 2026-11-02 用户拍板：「官方的首屏加载时间是 2~3 分钟、占内存 2G，
     我们这都算轻量了」→ 不做任何裁剪，**全部 75MB 下完才放人进来**。
     清单由服务器实测生成（assets/manifest.json，6193 个文件 / 75.2MB），
     用 fetch 逐个拉进 HTTP 缓存（不 new Image，省内存、也不占图片解码缓存），
     拉完再等 <img> 全部 complete + 字体 loaded + 首帧绘制。 */
  function fetchManifest() {
    /* ★ 2026-10-25：manifest.json 也要超时 —— 以前它一旦挂住，启动页就永远等下去 */
    return new Promise(function (res) {
      var ctl = g.AbortController ? new g.AbortController() : null;
      var to = g.setTimeout(function () { try { if (ctl) ctl.abort(); } catch (e) { } res(null); }, 10000);
      fetch('assets/manifest.json', { cache: 'no-cache', signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { g.clearTimeout(to); res(j); })
        .catch(function () { g.clearTimeout(to); res(null); });
    });
  }

  /* 单个请求 + 20s 超时（不然一张图挂住，整个队列永不推进） */
  function fget(url) {
    return new Promise(function (res) {
      var ctl = g.AbortController ? new g.AbortController() : null;
      var to = g.setTimeout(function () { try { if (ctl) ctl.abort(); } catch (e) { } res(null); }, 20000);
      fetch(url, { cache: 'force-cache', signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.arrayBuffer(); })
        .then(function (b) { g.clearTimeout(to); res(b); })
        .catch(function () { g.clearTimeout(to); res(null); });
    });
  }

  function preloadAll(man) {
    var list = man.files || [], n = list.length;
    P.tBytes = man.total || 0;
    P.tN = n;
    P.dBytes = 0;
    P.dN = 0;
    addRow('ALL', 'teal', '全量资源清单', mbText(P.tBytes) + 'MB / ' + n + ' 个', '');
    paint();
    if (!n) return Promise.resolve();
    return new Promise(function (resolve) {
      var i = 0, live = 0, doneN = 0, doneB = 0, CONC = 10;
      /* ★★★ 2026-10-25 用户：「网页版有时候加载有概率卡死」
         —— 弱网时 6660 个文件里总有几个会拖到 20 秒超时，串起来可以拖十几分钟，
            人就一直卡在启动页。⇒ 整段预载加 **45 秒总时长上限**，到点就放行，
            剩下的图由浏览器继续懒加载（页面已经能用，只是图会陆续出来）。 */
      var ended = false, capTimer = g.setTimeout(fin, 45000);
      function fin() {
        if (ended) return;
        ended = true;
        if (capTimer) { g.clearTimeout(capTimer); capTimer = 0; }
        paint();
        resolve();
      }
      function pump() {
        if (ended || abortLoad) return;
        while (live < CONC && i < n) {
          (function (item) {
            live++;
            fget(item[0]).then(function () {
              live--; doneN++; doneB += item[1];
              P.dN = doneN; P.dBytes = doneB;
              if ((doneN & 7) === 0) paint();
              if (doneN >= n) fin(); else pump();
            });
          })(list[i++]);
        }
      }
      pump();
    });
  }

  /* 等 <img> 全部 complete/decode + 字体 loaded（单包模式与逐文件模式共用） */
  function waitDecode() {
    return new Promise(function (resolve) {
      var t0 = Date.now(), stable = 0, lastN = -1;
      function step() {
        var imgs = collectImgs(), n = imgs.length, done = 0;
        for (var i = 0; i < n; i++) if (imgs[i].complete) done++;
        P.iTotal = n; P.iDone = done;
        if (P.tBytes) P.phase = '解码素材 ' + done + ' / ' + n + ' · 等待字体';
        var fontsOk = !D.fonts || !D.fonts.status || D.fonts.status === 'loaded';
        if (n === lastN && done === n && fontsOk) stable++;
        else stable = 0;
        lastN = n;
        paint();
        if (stable >= 3) { resolve(); return; }
        /* ★★★ 2026-10-25 用户：「加载有概率卡死」
           —— 这里原来是 **300 秒**（注释却写 25 秒）：只要有一张 <img> 没 complete
              或 document.fonts 一直是 loading，启动页就要挂满 5 分钟，看起来就是卡死。
           ⇒ 改成 20 秒硬上限，到点直接放人（未完成的图/字会继续在后台加载）。 */
        if (Date.now() - t0 > 20000) { resolve(); return; }
        g.setTimeout(step, 130);
      }
      step();
    });
  }

  /* 逐文件老路：拉 assets/manifest.json，再一个个 fetch 进 HTTP 缓存 */
  function legacyLoad() {
    return fetchManifest().then(function (man) {
      if (!man || !man.files || !man.files.length) return null;
      P.phase = '全量下载资源';
      paint();
      return preloadAll(man);
    }).then(waitDecode).then(function () {
      P.phase = '素材就绪 · 首帧绘制';
      paint();
      return raf2();
    });
  }

  function assetsReady() {
    pick();
    /* ★ 包一层 Promise 暴露 skipResolve：用户点「跳过」或看门狗放人时，
       直接 resolve → app.js 的 reveal() 立即揭幕，不至于卡在启动页。 */
    return new Promise(function (resolve) {
      skipResolve = resolve;
      if (skipRequested) { resolve(); return; }
      var gate = g.QVPackGate;
      if (!gate) {
        /* ★★★ 2026-10-31：单包脚本没加载（file:// 直接打开 / ?nosw=1 旁路）时，
           绝不再回退到「逐文件 preloadAll 714 请求」——那正是被 IDM 逐个拦截、
           卡死启动页的元凶。改为直接进界面，运行时按需加载即可
           （http 下由 pack-boot.js 接管全部 /assets/ 请求，IDM 碰不到）。 */
        P.phase = '资源包未启用 · 直接进入界面';
        paint();
        resolve();
        return;
      }
      P.phase = '等待资源包';
      paint();
      gate.then(function (ok) {
        if (!ok) {
          P.phase = '资源包稍后继续 · 先进入界面';
          paint();
          resolve();
          return;
        }
        waitDecode().then(function () {
          P.phase = '素材就绪 · 首帧绘制';
          paint();
          resolve();
        });
      });
    });
  }

  /* 单包下载进度 → 直接喂启动页的 MB 进度条（P.tBytes / P.dBytes） */
  function setPack(dBytes, tBytes, dN, tN, phase) {
    if (tBytes) { P.tBytes = tBytes; P.tN = tN || 0; }
    P.dBytes = dBytes || 0;
    P.dN = dN || 0;
    if (phase) P.phase = phase;
    paint();
  }

  function setPhase(txt) {
    if (!txt) return;
    P.phase = txt;
    paint();
  }

  function done() {
    P.done = true;
    if (barEl) barEl.style.width = '100%';
    if (pctEl) pctEl.textContent = '100';
    if (dotEl) dotEl.className = 'dot ok';
    if (statusEl) statusEl.textContent = '载入完成，正在进入';
    if (nowEl) nowEl.textContent = '全部素材就绪';
    paint();
    stop();
  }

  /* ★ 逃生按钮「跳过加载，直接进」：用户点它（或想绕过 IDM 拦截卡死）时，
     立即中止预载、resolve 外层 Promise → app.js 揭幕，绝不把人锁在启动页。 */
  function skip() {
    if (P.done) { if (skipResolve) skipResolve(); return; }
    skipRequested = true;
    abortLoad = true;                 /* 中止预载，不再发新请求（同时掐掉 IDM 拦截源） */
    P.phase = '已跳过 · 直接进入界面';
    paint();
    if (skipResolve) skipResolve();   /* 立即触发 app.js 的 reveal() */
    done();
  }

  /* ★★★ 2026-10-29 用户：「加载页面有时候会卡 75」
     —— 百分比是按 assets/manifest.json 的真实字节算的（75.2MB），
        卡在 75% 就是某个大文件（多半是地图瓦片）的请求挂了：
        本地并发偶发、线上 CDN 抖动都会，而且请求不 reject 就一直挂在那里。
        以前没有看门狗 → 人被挡在启动页，只能强刷。
     ⇒ 进度连续 12 秒不前进（且启动已超过 20 秒）→ 直接放人。
        Service Worker 会在后台继续下，下次进来就是秒开；
        缺的图片由浏览器按需补，不会白屏（这条路径和「闸门超时」那条完全一致）。 */
  var WD_STOP_MS = 12000, WD_MIN_MS = 20000;
  var _wdBoot0 = 0, _wdLastBytes = -1, _wdLastGrow = 0;
  setInterval(function () {
    if (P.done) return;
    /* 只在「有 manifest、按真实字节算进度」的模式下生效 ——
       没有清单时 P.dBytes 一直是 0，会误判成停滞。 */
    if (!P.tBytes) return;
    var now = Date.now();
    if (!_wdBoot0) _wdBoot0 = now;
    var cur = P.dBytes || 0;
    if (cur > _wdLastBytes) { _wdLastBytes = cur; _wdLastGrow = now; }
    if (!_wdLastGrow) _wdLastGrow = now;
    if (now - _wdBoot0 > WD_MIN_MS && now - _wdLastGrow > WD_STOP_MS) {
      try { console.log('[boot] 进度停滞 ' + Math.round((now - _wdLastGrow) / 1000) + 's @' +
        Math.round(cur / 1048576) + 'MB → 直接进界面'); } catch (e) { }
      P.phase = '素材稍后继续 · 先进入界面';
      paint();
      if (skipResolve) skipResolve();   /* ★ 看门狗放人时也要触发 app.js 揭幕，别只停 tick 不进界面 */
      done();
    }
  }, 2000);

  /* ═══════════════════════════════════════════════════════
     右侧：贪吃蛇（2026-10-26 换成用户 Desktop/tcs.html 的「暗黑像素」版）
     · 20×20 棋盘 / 110ms 起步 / 每吃一个 -4ms（下限 50ms）
     · 像素方块造型（全直角）+ 方波音效 + 最多缓冲 2 个转向
     · 载入即开局（tcs.html 原始行为）；撞墙或撞自己后
       点棋盘 / 按空格 / 点 RESTART 重开
     · 只在启动页可见时跑 RAF，黑幕撤掉就彻底停掉，不占 CPU
     ═══════════════════════════════════════════════════════ */
  function snakeInit() {
    var canvas = $('snBoard');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var COLS = 20, ROWS = 20;
    var CELL = 20, W = 400, H = 400;

    /* 棋盘跟着 board-wrap 的实际尺寸走（wrap 是 aspect-ratio:1/1，
       所以 canvas 一定是正方形；按 DPR 放大后再 setTransform 回逻辑坐标） */
    function setupCanvas() {
      var cw = canvas.clientWidth || 0;
      if (!cw) return;                   /* #boot 隐藏后 clientWidth=0，别把格子算成 0 */
      var dpr = Math.min(g.devicePixelRatio || 1, 2);
      W = cw; H = canvas.clientHeight || cw;
      CELL = Math.min(W / COLS, H / ROWS);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    }
    setupCanvas();
    if (g.ResizeObserver) {
      try { new g.ResizeObserver(setupCanvas).observe(canvas); } catch (e) { }
    } else {
      g.addEventListener('resize', setupCanvas);
    }

    var scoreEl = $('snScore'), bestEl = $('snBest');
    var restartBtn = $('snRestart'), wrap = $('snWrap');
    if (!restartBtn || !wrap) return;

    var snake, dir, inputQueue, food;
    var score = 0, best = 0, speed = 110, acc = 0, lastT = 0;
    /* waiting = 已就位但还没收到方向输入（启动页不自己撞墙死，看着才不懵） */
    var alive = true, waiting = true, rafId = 0;

    try { best = Number(g.localStorage.getItem('koneew_snake_best') || 0) || 0; } catch (e) { best = 0; }
    if (bestEl) bestEl.textContent = 'HI: ' + best;

    function isVis() { return !!(bootEl && !bootEl.hidden); }

    /* ── 音效：浏览器要求首次用户操作后才能出声，所以延迟到 initAudio() ── */
    var audioCtx = null;
    function initAudio() {
      try {
        var AC = g.AudioContext || g.webkitAudioContext;
        if (!AC) return;
        if (!audioCtx) audioCtx = new AC();
        if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
      } catch (e) { }
    }
    function beep(type, f0, f1, dur, vol) {
      if (!audioCtx) return;
      try {
        var t0 = audioCtx.currentTime;
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(f0, t0);
        if (f1) osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.01, t0 + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t0);
        osc.stop(t0 + dur);
      } catch (e) { }
    }
    function sEat() { beep('square', 440, 880, 0.1, 0.1); }
    function sDie() { beep('sawtooth', 200, 50, 0.3, 0.15); }
    function sClick() { beep('square', 800, 0, 0.05, 0.1); }

    function updateScore() { if (scoreEl) scoreEl.textContent = score; }
    function updateBest() { if (bestEl) bestEl.textContent = 'HI: ' + best; }

    function placeFood() {
      var empty = [];
      for (var y = 0; y < ROWS; y++) {
        for (var x = 0; x < COLS; x++) {
          var hit = false;
          for (var i = 0; i < snake.length; i++) {
            if (snake[i].x === x && snake[i].y === y) { hit = true; break; }
          }
          if (!hit) empty.push({ x: x, y: y });
        }
      }
      food = empty.length ? empty[Math.floor(Math.random() * empty.length)] : null;
    }

    function reset() {
      snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
      dir = { x: 1, y: 0 };
      inputQueue = [];
      score = 0;
      speed = 110;
      acc = 0;
      alive = true;
      waiting = true;
      updateScore();
      placeFood();
    }

    function startGame() {
      initAudio();
      sClick();
      reset();
      waiting = false;
      lastT = 0;
    }

    function die() {
      if (!alive) return;
      alive = false;
      sDie();
      if (score > best) {
        best = score;
        try { g.localStorage.setItem('koneew_snake_best', best); } catch (e) { }
        updateBest();
      }
    }

    function step() {
      if (inputQueue.length) {
        var nd = inputQueue.shift();
        if (nd.x !== -dir.x || nd.y !== -dir.y) dir = nd;
      }

      var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

      if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) { die(); return; }
      for (var i = 0; i < snake.length - 1; i++) {
        if (snake[i].x === head.x && snake[i].y === head.y) { die(); return; }
      }

      snake.unshift(head);
      if (food && head.x === food.x && head.y === food.y) {
        score++;
        updateScore();
        sEat();
        speed = Math.max(50, speed - 4);
        placeFood();
      } else {
        snake.pop();
      }
    }

    function changeDir(d) {
      if (!alive) return;
      initAudio();
      waiting = false;                 /* 首次转向 = 开局 */
      var lastD = inputQueue.length ? inputQueue[inputQueue.length - 1] : dir;
      /* 同向 / 掉头一律忽略；最多缓冲 2 个，防止手速快时失控 */
      if (d.x === lastD.x && d.y === lastD.y) return;
      if (d.x === -lastD.x && d.y === -lastD.y) return;
      if (inputQueue.length < 2) inputQueue.push(d);
    }

    function draw() {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);

      /* 网格：极暗的线，像素风里不要抢戏 */
      ctx.strokeStyle = '#141414';
      ctx.lineWidth = 1;
      for (var i = 1; i < COLS; i++) {
        ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(W, i * CELL); ctx.stroke();
      }

      /* 食物：红色方块 + 高光 + 绿色小茎 */
      if (food) {
        var fx = food.x * CELL, fy = food.y * CELL;
        var pad = Math.max(1, CELL * 0.1);
        ctx.fillStyle = '#ff073a';
        ctx.fillRect(fx + pad, fy + pad, CELL - pad * 2, CELL - pad * 2);
        ctx.fillStyle = '#ff8c9e';
        ctx.fillRect(fx + pad + 1, fy + pad + 1, Math.max(2, CELL * 0.2), Math.max(2, CELL * 0.2));
        ctx.fillStyle = '#39ff14';
        ctx.fillRect(fx + CELL / 2 - CELL * 0.1, fy - CELL * 0.1, CELL * 0.2, CELL * 0.25);
      }

      for (var k = 0; k < snake.length; k++) {
        var s = snake[k];
        var sx = s.x * CELL, sy = s.y * CELL;

        if (k === 0) {
          /* 蛇头：活着荧光绿 + 方向眼睛；死了变红 + 白色 X */
          ctx.fillStyle = alive ? '#39ff14' : '#ff073a';
          ctx.fillRect(sx, sy, CELL, CELL);

          if (alive) {
            var e = Math.max(2, CELL * 0.2);
            ctx.fillStyle = '#000000';
            if (dir.x === 1) {
              ctx.fillRect(sx + CELL * 0.6, sy + CELL * 0.2, e, e);
              ctx.fillRect(sx + CELL * 0.6, sy + CELL * 0.7, e, e);
            } else if (dir.x === -1) {
              ctx.fillRect(sx + CELL * 0.2, sy + CELL * 0.2, e, e);
              ctx.fillRect(sx + CELL * 0.2, sy + CELL * 0.7, e, e);
            } else if (dir.y === 1) {
              ctx.fillRect(sx + CELL * 0.2, sy + CELL * 0.6, e, e);
              ctx.fillRect(sx + CELL * 0.7, sy + CELL * 0.6, e, e);
            } else {
              ctx.fillRect(sx + CELL * 0.2, sy + CELL * 0.2, e, e);
              ctx.fillRect(sx + CELL * 0.7, sy + CELL * 0.2, e, e);
            }
          } else {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(2, CELL * 0.14);
            ctx.beginPath();
            ctx.moveTo(sx + CELL * 0.2, sy + CELL * 0.2);
            ctx.lineTo(sx + CELL * 0.8, sy + CELL * 0.8);
            ctx.moveTo(sx + CELL * 0.8, sy + CELL * 0.2);
            ctx.lineTo(sx + CELL * 0.2, sy + CELL * 0.8);
            ctx.stroke();
          }
        } else {
          ctx.fillStyle = '#1a8f00';
          ctx.fillRect(sx, sy, CELL, CELL);
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = Math.max(1, CELL * 0.1);
          ctx.strokeRect(sx + 1, sy + 1, CELL - 2, CELL - 2);
        }
      }
    }

    function loop(t) {
      /* 启动页一旦撤掉就彻底停掉，不占 CPU */
      if (!isVis()) { rafId = 0; return; }
      rafId = FRAME(loop);

      if (!lastT) lastT = t;
      var dt = t - lastT;
      lastT = t;
      if (dt > 100) dt = 100;

      if (alive && !waiting) {
        acc += dt;
        if (acc >= speed) {
          acc = 0;
          step();
        }
      }

      draw();
    }

    /* 点棋盘：还活着只是没开跑 → 开跑；死了 → 重开 */
    wrap.addEventListener('click', function () {
      if (!isVis()) return;
      initAudio();
      if (!alive) startGame();
      else waiting = false;
    });

    restartBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!isVis()) return;
      initAudio();
      startGame();
    });

    g.addEventListener('keydown', function (e) {
      if (!isVis()) return;
      var k = e.key;

      if (k === ' ' || k === 'Enter') {
        e.preventDefault();
        initAudio();
        if (!alive) startGame();
        return;
      }

      var d = null;
      if (k === 'ArrowUp' || k === 'w' || k === 'W') d = { x: 0, y: -1 };
      else if (k === 'ArrowDown' || k === 's' || k === 'S') d = { x: 0, y: 1 };
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') d = { x: -1, y: 0 };
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') d = { x: 1, y: 0 };

      if (d) { e.preventDefault(); changeDir(d); }
    });

    /* 触屏滑动 */
    var touchStartX = 0, touchStartY = 0;
    canvas.addEventListener('touchstart', function (e) {
      initAudio();
      var t = e.changedTouches[0];
      touchStartX = t.clientX;
      touchStartY = t.clientY;
    }, { passive: true });

    canvas.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0];
      var dx = t.clientX - touchStartX;
      var dy = t.clientY - touchStartY;
      if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
        if (!alive) startGame();
        else waiting = false;
        return;
      }
      if (Math.abs(dx) > Math.abs(dy)) changeDir({ x: dx > 0 ? 1 : -1, y: 0 });
      else changeDir({ x: 0, y: dy > 0 ? 1 : -1 });
    }, { passive: true });

    reset();
    rafId = FRAME(loop);
  }

  if (D.readyState === 'loading') {
    D.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  g.QVBootProgress = {
    stop: stop,
    tick: tick,
    done: done,
    skip: skip,
    setPhase: setPhase,
    setPack: setPack,
    prewarm: prewarm,
    assetsReady: assetsReady
  };
  g.QVAssetsReady = assetsReady;
})(window);
