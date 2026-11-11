/* ZQuake模拟器 · 极简静态服务器
 * 存在的唯一理由：用 http:// 打开才能让官方 mp3 音效通过 fetch() 正常加载
 * （file:// 下浏览器会拦截 fetch 本地文件 → 音效只能降级成合成音）。
 * 仅监听 127.0.0.1，不对外网开放。
 *
 * 性能要点（解决「启动预热卡在 2.x MB」）：
 *  · 本地 loopback 带宽不是瓶颈，CPU 压缩才是。原来用 zlib.gzipSync 同步压缩，
 *    遇到 planet(6MB)/maptiles(4MB) 等大 SVG 会阻塞事件循环，
 *    导致 preloadAll 的并发请求排队、进度条停滞。
 *  · 大文件(>1MB)与已压缩类型(png/mp3/wav/woff2/ico…)直接「流式」发送，不做 gzip；
 *  · 小文本(js/css/svg/json…)用「异步」zlib.gzip，不阻塞事件循环；
 *  · 静态资源给 1 天缓存 → 二次打开命中浏览器缓存，preloadAll 几乎瞬间完成；
 *    index.html / manifest.json 不缓存，保证改完立即可见。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};
const COMPRESSIBLE = {
  '.html': 1, '.js': 1, '.css': 1, '.svg': 1, '.json': 1,
  '.xml': 1, '.txt': 1, '.map': 1, '.ts': 1
};
/* 已压缩或二进制：gzip 几乎无收益，反而浪费 CPU */
const NO_GZIP_EXT = {
  '.png': 1, '.jpg': 1, '.jpeg': 1, '.gif': 1, '.webp': 1,
  '.mp3': 1, '.wav': 1, '.woff': 1, '.woff2': 1, '.ico': 1
};
const MAX_GZIP = 1048576; /* 1MB 以上不 gzip（本地 loopback 带宽足够，省 CPU） */
const port = parseInt(process.argv[2] || '8788', 10);
var _zqPackCache = null;  /* 资源包 base64 JS 缓存：仅在 bundle.pack 变化(mtime)时重算 */

http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (process.env.ZQ_LOG === '1') {
    try { console.log('[req] ' + req.method + ' ' + req.url); } catch (e) { }
  }
  if (p === '/') p = '/index.html';
  const fp = path.resolve(root, '.' + path.normalize('/' + p).replace(/\\/g, '/'));
  if (fp !== root && !fp.startsWith(root + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403');
    return;
  }

  /* ★ 资源包专用「不可被下载器拦截」路由（v2 · 最稳）：
   *   下载器扩展（FDM / AI 批量下载器 / IDM 等）靠 URL 扩展名 + Content-Type
   *   （如 .mp3/.zip + application/octet-stream，或「大体积二进制」）来判定「这是下载」并弹窗。
   *   这里把二进制包 base64 包裹成一个 .js 脚本：URL 以 .js 结尾、Content-Type 为
   *   text/javascript，浏览器把它当普通脚本执行（赋值 window.__ZQPK__）。
   *   下载器扩展绝不会拦截脚本加载（否则所有网站都崩），连「大二进制」这类激进规则都碰不到。
   *   pack-boot.js 用 <script> 注入它，完全绕开 fetch 下载通道。 */
  if (p === '/_zqpack.js') {
    const packPath = path.resolve(root, 'assets', 'bundle.pack');
    fs.stat(packPath, (e, st) => {
      if (e || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 No pack');
        return;
      }
      /* 仅在包文件变化时才重新 base64（按 mtime 判断），避免每次请求都编码 20MB */
      if (!_zqPackCache || _zqPackCache.mtime !== st.mtimeMs) {
        const raw = fs.readFileSync(packPath);
        _zqPackCache = {
          mtime: st.mtimeMs,
          js: 'window.__ZQPK__="' + raw.toString('base64') + '";'
        };
      }
      const buf = Buffer.from(_zqPackCache.js, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',  /* 脚本类型：下载器不视为下载 */
        'Cache-Control': 'no-cache',                         /* 重打 bundle 后下一次必取新包 */
        'Content-Length': buf.length,
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(buf);
    });
    return;
  }

  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(fp).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const ae = req.headers['accept-encoding'] || '';
    const isSmallText = COMPRESSIBLE[ext] && !NO_GZIP_EXT[ext] && st.size <= MAX_GZIP;
    const canGzip = isSmallText && /gzip/.test(ae);
    const cache = (p === '/index.html' || p.endsWith('/manifest.json')) ? 'no-cache' : 'public, max-age=86400';
    const headers = { 'Content-Type': type, 'Cache-Control': cache };

    if (!canGzip) {
      /* 大文件 / 已压缩 / 不支持 gzip → 流式直发，绝不阻塞事件循环 */
      headers['Content-Length'] = st.size;
      res.writeHead(200, headers);            /* ★ 必须显式写头，否则 Node 会用 chunked 且丢失 Content-Type */
      const s = fs.createReadStream(fp);
      s.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
      s.pipe(res);
      return;
    }
    /* 小文本 → 异步 gzip（不阻塞） */
    fs.readFile(fp, (e, buf) => {
      if (e) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('500'); return; }
      zlib.gzip(buf, (e2, gz) => {
        if (e2) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('500'); return; }
        headers['Content-Encoding'] = 'gzip';
        headers['Content-Length'] = gz.length;
        res.writeHead(200, headers);
        res.end(gz);
      });
    });
  });
}).listen(port, '127.0.0.1', () => {
  console.log('ZQuake模拟器 → http://127.0.0.1:' + port + '/');
  console.log('资源包路由: /_zqpack.js (script+base64 · 防下载器拦截)');
  console.log('关闭本窗口即停止服务。');
});
