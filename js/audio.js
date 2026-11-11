/* audio.js —— 声音与朗读（让设置页那些「音效 / 朗读」开关真的做事）
 *
 * 为什么加：用户原话「这些按钮全是废物，没有用的」——
 * 以前所有「音效」「朗读」行点一下只弹「本版无声音・朗读」，等于假按钮。
 * 桌面版完全能做到：
 *   · 朗读 → Web Speech API（speechSynthesis），Electron 里可用系统语音
 *   · 音效 → WebAudio 合成，不需要任何音频素材（官方音效是 OtoLogic 的，不能随包分发）
 *
 * 对外：QVSpeak.say(text) / QVSpeak.beep(kind) / QVSpeak.setEnabled(o) / QVSpeak.announce(q, o)
 */
(function (g) {
  'use strict';
  /* ★ ZQuake 模拟器：音效与朗读**默认开启**（原版默认全关 → 用户以为音效坏了）。
     朗读用 Web Speech API 且 lang='zh-CN'（中文报文），系统缺中文语音时 speak 会静默失败，
     不影响音效。 */
  var enabled = { voice: 1, sound: 1 };
  var ac = null;
  var lastKey = '';

  function ctx() {
    if (ac) return ac;
    try { ac = new (g.AudioContext || g.webkitAudioContext)(); } catch (e) { ac = null; }
    return ac;
  }

  /** 合成一声提示音：kind = 'info' | 'alert' | 'eew' | 'tick'
   *  ★ 'eew' 支持第二参数 n = 第几报：官方续报会换音（用户：「音效也不会随着第几报变换」） */
  function beep(kind, n) {
    var a = ctx(); if (!a) return false;
    try { if (a.state === 'suspended') a.resume(); } catch (e) { }
    var seq;
    if (kind === 'eew') {
      var rep = Math.max(1, Math.min(9, n || 1));
      if (rep === 1) seq = [[880, .16], [0, .05], [1180, .16], [0, .05], [1480, .22], [0, .18],
        [880, .16], [0, .05], [1180, .16], [0, .05], [1480, .22]];
      else if (rep === 2) seq = [[1180, .14], [0, .05], [1480, .18], [0, .12], [1180, .14], [0, .05], [1480, .18]];
      else seq = [[1480, .18], [0, .08], [1480, .18]];
    } else seq = kind === 'alert' ? [[740, .14], [0, .05], [990, .2]]
      : [[660, .08]];
    var t = a.currentTime;
    seq.forEach(function (s) {
      if (!s[0]) { t += s[1]; return; }
      var o = a.createOscillator(), gn = a.createGain();
      o.type = 'sine'; o.frequency.value = s[0];
      gn.gain.setValueAtTime(0, t);
      gn.gain.linearRampToValueAtTime(0.18, t + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.001, t + s[1]);
      o.connect(gn); gn.connect(a.destination);
      o.start(t); o.stop(t + s[1] + 0.02);
      t += s[1];
    });
    return true;
  }

  /* ★★ 2026-10-10 用户要求：**不要用 Windows 自带的东西**
   *     「能不能不要用 Windows 自带的东西？你先不要加这玩意，等一下我去给你找一个，
   *       东方的那个配音的」
   *  ⇒ 系统 TTS（speechSynthesis）整个停用，但【接口全部保留】：
   *     调用方依旧 QVSpeak.say(text)，等东方音声包到了，只要在 speakCustom()
   *     里按文本选文件播即可，上层一行都不用改。
   *  ⚠️ 不要直接删 say()：announce()/设置页开关都挂在上面。 */
  var USE_SYSTEM_TTS = false;

  /** 自制配音（待接入：用户提供的东方音声）
   *  现在返回 false = “没播”且不报错；接上之后返回 true 即可，其它逻辑全不用动。 */
  function speakCustom(text) { return false; }

  /** 朗读一段中文（系统语音；没可用语音就静默失败） */
  function say(text) {
    if (!text) return false;
    if (!USE_SYSTEM_TTS) return speakCustom(String(text));
    if (!g.speechSynthesis) return false;
    try {
      g.speechSynthesis.cancel();
      var u = new g.SpeechSynthesisUtterance(String(text));
      u.lang = 'zh-CN'; u.rate = 1.05; u.pitch = 1;
      var vs = g.speechSynthesis.getVoices() || [];
      var zh = null;
      for (var i = 0; i < vs.length; i++) if (/^zh/i.test(vs[i].lang)) { zh = vs[i]; break; }
      if (zh) u.voice = zh;
      g.speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }

  function setEnabled(o) { enabled.voice = o && o.voice ? 1 : 0; enabled.sound = o && o.sound ? 1 : 0; }

  /* ★★ 官方音效（直接从官方素材包取过来的 mp3，不是自己合成的）：
       eew0.mp3     = 第一报 EEW
       eew5.mp3     = 警報用 EEW
       koushin.mp3  = 续报（予報）
       koushinE.mp3 = 续报（警報） */
  /* ★★★ 2026-10-26 实测（playwright hook HTMLMediaElement.play）：
     一场 M7.5 模拟（加速 25×）里 playFile 被调了 39 次。
     前 34 次 ok，后面 VXSE52 / VXSE53 / tsa12 全部
     `NotSupportedError: Failed to load because no supported source was found`
     —— 每次都 new Audio + cloneNode，一口气建了三十多个实例同时加载，
     file:// 并发请求上限一到，后面的就全挂。
     ⇒ ① 同一个音效 700ms 内不重播（否则加速时 koushin 一秒响几十次）
       ② 改成固定 3 个实例的播放池，复用已加载好的对象，不再 cloneNode */
  var sndCache = {};
  var sndPool = {};
  var sndLast = {};
  var SND_THROTTLE = 700;
  /* 官方音效包里只有 Pop 是 wav，其余全部是 mp3（详见 dev/音效对照表.md） */
  var SND_EXT = { Pop: 'wav' };
  /* ★★★ 2026-10-26 终极定位：**HTMLAudioElement 根本播不了这几个文件**，不是文件坏。
     实测三连（同一个 VXSE52.mp3）：
       fetch()            → ok 87258 bytes          字节完整
       逐帧扫描 MP3       → 209 帧连续到 EOF，5.46s，0 垃圾
       new Audio()        → err=4 MEDIA_ERR_SRC_NOT_SUPPORTED + net::ERR_ABORTED
       复制成新文件名   → 一样 err=4（所以不是路径/缓存/文件名问题）
       decodeAudioData()  → **OK dur=5.40 / ch=2 / sr=48000**
     ⇒ 坏的是 Chromium 的 `<audio>` 媒体管线，不是资源。
     所以 playFile 彻底改走 Web Audio：
       ① fetch + decodeAudioData 解码一次 → AudioBuffer 缓存，之后播放 0 延迟
       ② 每次播都新建 BufferSource（重叠混音完全不冲突，不再有实例上限）
       ③ 同一音效 700ms 内不重播（25× 加速时 koushin 一秒响几十次就是噪音）
       ④ fetch 不了就退回旧的 <audio> 写法（保底） */
  var abuf = {};
  var aload = {};
  var didPre = 0;
  function fireBuf(b, vol) {
    var a = ctx(); if (!a || !b) return false;
    try { if (a.state === 'suspended') a.resume(); } catch (e) { }
    try {
      var srcn = a.createBufferSource();
      srcn.buffer = b;
      var gn = a.createGain();
      gn.gain.value = (vol == null ? 0.9 : vol);
      srcn.connect(gn); gn.connect(a.destination);
      srcn.start(0);
      return true;
    } catch (e) { return false; }
  }
  /* ★★★ 2026-10-28 用户：「警报更新的音效有时候不响，有概率失效」
     —— 旧实现里 `if (aload[name]) return true;` 把**正在加载期间的后续请求全部吞掉**：
        第一条 koushin 触发 fetch/decode，紧接着的几条（此时 aload=1）直接 return，
        回调根本没登记 → 那几条报文永远不会有声音 = 「有概率失效」。
     ⇒ 用一个等待队列：加载中来一个登记一个，解码完逐个播。 */
  var awaiters = {};
  function flushBuf(name, b) {
    var q = awaiters[name] || [];
    awaiters[name] = [];
    for (var i = 0; i < q.length; i++) { try { q[i](b); } catch (e) { } }
  }
  /* ★ ZQuake：解码一段 ArrayBuffer → AudioBuffer 缓存 */
  function decodeTo(b, name) {
    var a = ctx(); if (!a) { aload[name] = 0; awaiters[name] = []; sndFail[name] = 1; return; }
    function ok(d) { abuf[name] = d; aload[name] = 0; flushBuf(name, d); }
    function bad() { aload[name] = 0; awaiters[name] = []; sndFail[name] = 1; }
    try {
      var pr = a.decodeAudioData(b, ok, bad);
      if (pr && pr.then) pr.then(ok, bad);
    } catch (e) { bad(); }
  }
  /* 包未就绪 / 无包时：退回裸 fetch（file:// 或下载器杀不掉时的兜底） */
  function fetchLoad(name, fname) {
    var src = './assets/sounds/' + fname;
    try {
      fetch(src).then(function (r) { return r.arrayBuffer(); })
        .then(function (b) { decodeTo(b, name); })
        .catch(function () { aload[name] = 0; awaiters[name] = []; sndFail[name] = 1; });
    } catch (e) { aload[name] = 0; awaiters[name] = []; sndFail[name] = 1; }
  }
  /* 从内存 blob 直接解（不经过 fetch → 任何下载器都截不到） */
  function serveBlob(blob, name) {
    try {
      blob.arrayBuffer().then(function (b) { decodeTo(b, name); })
        .catch(function () { fetchLoad(name, name + '.' + (SND_EXT[name] || 'mp3')); });
    } catch (e) { fetchLoad(name, name + '.' + (SND_EXT[name] || 'mp3')); }
  }
  function loadBuf(name, cb) {
    var a = ctx(); if (!a) return false;
    if (abuf[name]) { if (cb) cb(abuf[name]); return true; }
    if (cb) (awaiters[name] = awaiters[name] || []).push(cb);
    if (aload[name]) return true;
    aload[name] = 1;
    var fname = name + '.' + (SND_EXT[name] || 'mp3');
    var key = 'sounds/' + fname;
    /* ① 优先：资源包已在内存 → 直接读 blob（不走网络，下载器完全碰不到） */
    var blob = (g.QVPackGet ? g.QVPackGet(key) : null);
    if (blob) { serveBlob(blob, name); return true; }
    /* ② 包还在下载/解析 → 等闸门放下再试一次 */
    if (g.QVPackGate) {
      var done = false;
      g.QVPackGate.then(function () {
        if (done) return; done = true;
        var b2 = (g.QVPackGet ? g.QVPackGet(key) : null);
        if (b2) serveBlob(b2, name); else fetchLoad(name, fname);
      });
      return true;
    }
    /* ③ 无单包（如 file:// 直接打开）→ 裸 fetch 兜底 */
    fetchLoad(name, fname);
    return true;
  }
  function playFile(name, vol, gap) {
    try {
      var now = Date.now();
      var G = (gap == null ? SND_THROTTLE : gap);
      if (sndLast[name] && now - sndLast[name] < G) return false;
      sndLast[name] = now;
      /* 首次播放时惰性把整套音效解码好，后面全部 0 延迟 */
      if (!didPre) { didPre = 1; setTimeout(function () { try { preload(); } catch (e) { } }, 0); }
      if (abuf[name]) return fireBuf(abuf[name], vol);
      loadBuf(name, function (b) { fireBuf(b, vol); });
      /* ★★★ ZQuake：官方 mp3 走 fetch()，**file:// 下会被浏览器 CORS 直接拦掉**
         （fetch 本地文件失败 → 一个声音都没有）。⇒ 加载不出来时用 WebAudio 合成提示音兜底，
         不依赖任何文件，file:// 与 http 都一定有声音。 */
      setTimeout(function () {
        if (!abuf[name] && sndFail[name]) beepFallback(name);
      }, 150);
      return true;
    } catch (e) { return false; }
  }
  /* 合成降级：音效名 → beep 音型 */
  var BEEP_MAP = {
    eew0: ['eew', 1], eew3: ['eew', 1], eew5: ['eew', 2], eewC: ['eew', 3],
    koushin: ['eew', 3], koushinE: ['eew', 4],
    VXSE51: ['info', 0], VXSE52: ['info', 0], VXSE53: ['alert', 0], VXSE5C: ['alert', 0],
    VTSE5: ['alert', 0], tsa0: ['alert', 0], p1024: ['info', 0], Pop: ['tick', 0]
  };
  var sndFail = {};
  function beepFallback(name) {
    var m = BEEP_MAP[name];
    if (!m) { try { beep('info', 0); } catch (e) { } return; }
    try { beep(m[0], m[1]); } catch (e) { }
  }
  /* 浏览器自动播放策略：没有用户手势时 AudioContext 是 suspended → 首次交互即恢复 */
  var resumeOnGesture = function () {
    try { var a = ctx(); if (a && a.state === 'suspended') a.resume(); } catch (e) { }
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
      window.removeEventListener(ev, resumeOnGesture, true);
    });
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, resumeOnGesture, true);
  });
  /** 预解码：上层在地震开始时把整套音效热一热，避免第一报卡顿 */
  function preload(names) {
    (names || ['eew0', 'eew3', 'eew5', 'koushin', 'koushinE',
      'NewInt0', 'NewInt1', 'NewInt2', 'NewInt3', 'NewInt4', 'NewInt5', 'NewInt6',
      'VXSE51', 'VXSE52', 'VXSE53', 'VXSE5C',
      'tsa01', 'tsa02', 'tsa03', 'tsa04', 'tsa12', 'tsa13', 'tsa22', 'tsa23', 'tsa24',
      'tsa32', 'tsa33', 'VTSE5', 'p1024', 'Pop']).forEach(function (n) { loadBuf(n, null); });
    return true;
  }

  /** ★★★ 2026-10-28 用户（音效表）：「
   *    eew3 → 属于人体有感的升级范围，一般从震度2升级为震度3使用，或者3升级到4使用
   *    eew5 → 一般与震度3升级到震度4使用，或者4升级到5-使用」
   *    并指出「这二个音效从来没被使用过」。
   *
   *    真因：代码里比较的是**原始数值** `lv >= 30 / >= 40`，但 koneew 的震度是
   *    **混合编码**：震度 0~4 是「真值 0/1/2/3/4」，5弱以上才是 45/50/…/70。
   *      · 震度3 = 3（不是 30）→ `lv>=30` 永远不成立 → **eew3 一次都不会响**；
   *      · 升级检测 `prev<30 && lv>=30` 只会在「4 → 5弱(45)」那一跳成立，
   *        而那时 eewLevelSound(45) 已经是 eew5 → 看起来 eew5 也很少听见。
   *    ⇒ 先归一化成「档位序号」0~9（0/1/2/3/4、5=5弱、6=5強、7=6弱、8=6強、9=震度7），
   *      再按上面那张表选音：
   *        升到 震度3 / 震度4  → eew3
   *        升到 5弱 / 5強      → eew5
   *        再往上（6弱…）      → koushin（没有专属音，避免每报都放最强音）
   */
  function sndOrd(lv) {
    var v = +lv || 0;
    if (v >= 70) return 9;        /* 震度7 */
    if (v >= 65) return 8;        /* 6強 */
    if (v >= 60) return 7;        /* 6弱 */
    if (v >= 55) return 6;        /* 5強 */
    if (v >= 45) return 5;        /* 5弱（45/50 都算） */
    if (v >= 40) return 4;        /* 震度4（码 40） */
    if (v >= 30) return 3;        /* 震度3（码 30） */
    if (v >= 20) return 2;        /* 震度2（码 20） */
    if (v >= 10) return 1;        /* 震度1（码 10） */
    return Math.max(0, Math.min(4, Math.round(v)));   /* 真值 0~4 */
  }
  function eewLevelSound(lv) {
    var o = sndOrd(lv);
    if (o >= 5) return 'eew5';    /* 5弱以上 */
    if (o >= 3) return 'eew3';    /* 震度3~4 */
    return 'eew0';                /* 震度2以下 */
  }
  /** 一报 EEW。s = { lv, prevLv, report, plan } */
  function eewStep(s) {
    s = s || {};
    var lv = +s.lv || 0;
    var prev = (s.prevLv == null ? null : +s.prevLv);
    var n = Math.max(1, +s.report || 1);
    var plan = +s.plan || 0;
    /* ★★★ 2026-10-28 用户：「警报更新的音效有时候不响，有概率失效」
       —— 下面这些调用原来用默认的 700ms 同名节流，而密集期的报文间隔是
          250~950ms（reportGap 带随机）→ **间隔一小于 700ms 就被静默丢掉**，
          所以是「有概率」不响。报文音的最小间隔放到 150ms（仍防重复触发），
          保证每一条报文都真的有声音。 */
    var GAP = 150;
    var o = sndOrd(lv);
    var po = (prev == null) ? null : sndOrd(prev);
    /* 首报：按当前档位选音（震度3~4 → eew3；5弱以上 → eew5；以下 → eew0） */
    if (po == null) return playFile(eewLevelSound(lv), o >= 4 ? 1.0 : 0.9, GAP);
    /* 升级：按用户表 —— 震度2→3 / 3→4 用 eew3；震度3→4 / 4→5弱 用 eew5 */
    if (o > po) {
      if (o === 5 || o === 6) return playFile('eew5', 1.0, GAP);   /* 升到 5弱 / 5強 */
      if (o === 3 || o === 4) return playFile('eew3', 0.9, GAP);   /* 升到 震度3 / 4 */
    }
    if (plan > 0 && n >= plan) return playFile('koushinE', 0.6, GAP);
    return playFile('koushin', 0.45, GAP);
  }

  /** ★ 「揺れを検出」提示音 NewInt0..6（官方另一套，不是 EEW）
   *  n = 0..6，由 views.js 按当前观测震度档位换算好再传进来。
   *  ★ 2026-10-27 官方是「每个测站震度上昇就响一声」（快报时连续响），
   *    所以这里的重复间隔从 700ms 放到 180ms，否则连着两个站上升只能听到一个。 */
  function detect(n) {
    n = Math.max(0, Math.min(6, Math.round(+n || 0)));
    return playFile('NewInt' + n, 1.0, 180);
  }

  /** ★ 地震情报阶段音效（官方 VXSE5x）
   *    checking = 「调查中」卡片弹出/更新   → VXSE51
   *    info     = 调查完成后更新「地震情报」 → VXSE52
   *    final    = 「地震正式报」提示         → VXSE53
   *  koneew 目前只有 checking 这个阶段，后两个先留接口。 */
  function infoSe(phase) {
    if (phase === 'final') return playFile('VXSE53', 0.9);
    if (phase === 'info') return playFile('VXSE52', 0.9);
    return playFile('VXSE51', 0.9);
  }

  /** ★★★ 2026-10-26 用户：「音效今天必须接完」。按《音效对应.xlsx》把剩下的全接上。
   *  海啸情报音效（官方 tsa*）：
   *    发布  tsa01 若干の海面変動 / tsa02 注意報 / tsa03 警報 / tsa04 大津波警報
   *    更新  tsa12 / tsa13 / tsa14（同等级再次发布）
   *    解除  tsa21 有効期間終了 / tsa22 津波解除 / tsa23 警報解除 / tsa24 大津波警報解除
   *    切换  tsa32 切到注意報 / tsa33 切到警報
   *  prevLv / newLv：0=没有，1=若干の海面変動，2=注意報，3=警報，4=大津波警報 */
  function tsunami(prevLv, newLv) {
    var p0 = +prevLv || 0, n = +newLv || 0;
    if (!n) {
      if (!p0) return false;
      return playFile(p0 >= 4 ? 'tsa24' : (p0 >= 3 ? 'tsa23' : 'tsa22'), 0.9);
    }
    if (!p0) return playFile('tsa0' + Math.min(4, n), 0.95);
    if (n !== p0) return playFile(n <= 2 ? 'tsa32' : 'tsa33', 0.9);
    /* ★ 2026-10-26 用户：「语音重复了两次叠加」
       一场模拟里海啸会发两次（调查中的初报 + 正式报），等级没变时
       以前会再播一次 tsa1X（“注意報が更新されました”），听起来就像重复。
       同一等级不重播；真实数据逐次更新才用 QVSpeak.tsuUpdate()。 */
  }
  /** 海啸情报更新音（VTSE5：“津波到达某区 XX 米”） */
  function tsuUpdate() { return playFile('VTSE5', 0.8); }
  /** EEW 误报取消（官方 eewC） */
  function eewCancel() { return playFile('eewC', 0.9); }
  /** 5m 以上海啸消失 / 解除（官方 VXSE5C） */
  function tsuGone() { return playFile('VXSE5C', 0.9); }
  /** 点击声（官方 Pop.wav） */
  function pop() { return playFile('Pop', 0.5); }

  /** 震度/烈度中文读法 */
  function rankText(v, isShindo) {
    if (!(v >= 0)) return '不明';
    if (!isShindo) return '烈度 ' + Math.round(v) + ' 度';
    if (v >= 70) return '震度 7';
    if (v >= 45) { var n = Math.round(v / 5) * 5; return '震度 ' + Math.floor(n / 10) + (n % 10 === 5 ? '强' : '弱'); }
    return '震度 ' + Math.round(v);
  }

  /** 有新地震时播报（自带去重，同一条只播一次） */
  function announce(q, o) {
    if (!q) return '';
    o = o || {};
    var key = q.id || (q.timeMs + '|' + q.place);
    if (key === lastKey) return '';
    if (!enabled.voice && !enabled.sound) { lastKey = key; return ''; }
    lastKey = key;
    var isShindo = (q.metric === 'shindo' || q.metric === 'liedu')
      ? (q.metric === 'shindo')
      : /^(JMA|TW|CWA)/.test(String(q.source || ''));
    var v = isShindo ? (q.maxShindo >= 0 ? q.maxShindo : q.shindo) : (q.liedu >= 1 ? q.liedu : -1);
    /* ★ 2026-10-10：去掉语音里的「（推定）」（用户不想让我们自己加东西） */
    var tail = rankText(v, isShindo);
    var mag = isFinite(q.mag) && q.mag > 0 ? ('规模 ' + q.mag.toFixed(1)) : '';
    var txt = (q.place || '') + ' ' + tail + (mag ? ' ' + mag : '');
    /* ★★★ 2026-10-26 用户：「有地方还是在使用我们自己的垃圾音效」
       这里以前是 `beep(q.isEew ? 'eew' : 'alert')` —— beep() 是 WebAudio 合成的啐啐声，
       和官方 mp3 完全不一样（用户听一下就能分辨）。
       现在官方音效已经分工明确：
         eewStep （eew0/eew3/eew5/koushin/koushinE）、detect（NewInt0..6）、
         infoSe（VXSE51/52/53）、tsuSfx（tsa01..04）、eewC（误报取消）
       ⇒ announce() 只负责「读什么」，不再自己发声。 */
    /* if (enabled.sound) beep(q.isEew ? 'eew' : 'alert'); */
    if (enabled.voice) say(txt);
    return txt;
  }

  g.QVSpeak = { say: say, beep: beep, setEnabled: setEnabled, announce: announce,
    eew: eewStep, infoSe: infoSe, detect: detect, playFile: playFile,
    preload: preload,
    tsunami: tsunami, tsuUpdate: tsuUpdate, eewCancel: eewCancel,
    tsuGone: tsuGone, pop: pop,
    enabled: function () { return enabled; },
    reset: function () { lastKey = ''; } };
})(window);
