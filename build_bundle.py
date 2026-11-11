# 生成 assets/bundle.pack —— 把 manifest 里全部资源拼成「单个二进制包」，
# 浏览器只需发 1 次请求即可拿到全部素材，彻底绕开 IDM 对 714 个独立请求的拦截。
# 格式（小端）：
#   magic "ZQPK" (4B) | version u8 | count u32
#   每条: nameLen u16 | name(utf8, 不含 assets/ 前缀) | mimeLen u8 | mime(utf8) | dataLen u32 | data
import os, json, struct, sys, re

ROOT = os.path.dirname(os.path.abspath(__file__))
MAN = os.path.join(ROOT, 'assets', 'manifest.json')
OUT = os.path.join(ROOT, 'assets', 'bundle.pack')

MIME = {
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css',
    '.ico': 'image/x-icon', '.xml': 'application/xml',
}

def main():
    man = json.load(open(MAN, 'r', encoding='utf-8'))
    files = man['files']  # [[path, size], ...]，path 形如 assets/xxx.svg
    out = bytearray()
    out += b'ZQPK'
    out += bytes([1])
    out += struct.pack('<I', len(files))
    n = 0
    for p, _sz in files:
        # 去掉 assets/ 前缀，作为包内查找 key（与 pack-boot.js 的 relKey 对应）
        key = p.replace('\\', '/')
        if key.startswith('assets/'):
            key = key[len('assets/'):]
        data = open(os.path.join(ROOT, p.replace('/', os.sep)), 'rb').read()
        ext = os.path.splitext(p)[1].lower()
        mime = MIME.get(ext, 'application/octet-stream')
        nb = key.encode('utf-8'); mb = mime.encode('utf-8'); db = data
        out += struct.pack('<H', len(nb)); out += nb
        out += bytes([len(mb)]); out += mb
        out += struct.pack('<I', len(db)); out += db
        n += 1
    open(OUT, 'wb').write(out)
    print('bundle.pack 生成完成: %d 个文件, %.2f MB' % (n, len(out) / 1048576.0))

    # 同步 js/pack-boot.js 里的包大小常量：服务器开 gzip 后，进度条分母不能用
    # 压缩后的 Content-Length，得用这个真实字节数。
    pb = os.path.join(ROOT, 'js', 'pack-boot.js')
    src = open(pb, 'rb').read().decode('utf-8')
    upd = re.sub(r'(var PACK_FALLBACK_SIZE = )\d+(;)', r'\g<1>%d\g<2>' % len(out), src)
    if upd != src:
        open(pb, 'wb').write(upd.encode('utf-8'))   # 二进制写，保持原有行尾
        print('pack-boot.js PACK_FALLBACK_SIZE -> %d' % len(out))

if __name__ == '__main__':
    main()
