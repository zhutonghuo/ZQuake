/* app.js — 主逻辑
 *  · 布局：960x720 基准，按窗口等比缩放
 *  · 渲染：图形层（官方素材）+ 文字层（官方字形零件）
 *  · 数据：轮询（公开源）+ WebSocket 推送（wolfx，低延迟）
 */
(function () {
  'use strict';
  var SW = 960, SH = 720;
  var $ = function (id) { return document.getElementById(id); };

  /* ★ 2026-10-10：删掉 frozenSel ——「点履历行冻结主卡片」是我们自己加的，
     官方没有这个行为（反编译证据见 views.js hitLayer 的注释）。
     主卡片永远 = pick(list)：有速报就是速报，否则最新那条。 */
  var S = { sel: null, lastKey: '', camKey: '' };
  var QVUI_SCALE = 1;            /* 设置页「UI 大小」 */

  /* ------------------------------------------------------------ 布局缩放 */
  /* ★★ 2026-10-14「官方同款铺满窗口」重做（用户报：左右有黑边，希望铺满）：
     ★ 病根：CSS 里 #stage 写的是「逻辑尺寸 = ceil(窗口/k)，由 layout() 实时写入」，
       但 layout() **从来只写 transform、没写过 width/height** → 舞台永远是 960×720。
       窗口比 16:9 宽时，等比缩放后左右各空一截 → 露 #12151a 底 = 黑边。
     ★ 官方（TurboWarp dynamic-resize）实测：`rt.stageWidth/stageHeight` = **窗口**，
       页面底 bgsq 被拉到整个舞台高（960x720→728 / 1280x640→645 / 1440x900→908）
       ⇒ 官方是【把舞台拉大到窗口】，不是【等比缩进 + 居中信箱】。
     ★ 修法：s 仍按「装得下」定（竖向一定完整，避免滚到底露黑）；
       然后把舞台逻辑尺寸补到 w/s × h/s（≥ 设计尺寸）→ #map(inset:0) 自动铺满多出来的部分。
       多出来的宽度全部给地图（左栏 240px 不动），这就是官方那套。 */
  function layout() {
    /* ★ 2026-10-28 自绘标题栏占 40px：可用高度要减掉它，
       否则舞台会把顶部一段推到标题栏底下去（UI 最上面那一行被遮）。 */
    var TB = document.body.classList.contains('shell') ? 40 : 0;
    var w = innerWidth, h = innerHeight - TB, base = Math.min(w / SW, h / SH);
    var s = Math.min(base * QVUI_SCALE, h / SH);
    var LW = Math.max(SW, Math.ceil(w / s));      /* 舞台逻辑宽：窗口更宽时变大 */
    var LH = Math.max(SH, Math.ceil(h / s));      /* 舞台逻辑高：窗口更高时变大 */
    var st = $('stage');
    st.style.width = LW + 'px';
    st.style.height = LH + 'px';
    st.style.top = TB + 'px';
    /* 铺满时原点钉左上（不再居中留边）；只有「UI 大小 >100% 且窗口装不下」才可能溢出 */
    st.style.transform = 'translate(0px,0px) scale(' + s + ')';
    /* 地图视口（VIS）跟着舞台走 → 瓦片/相机按新尺寸铺满，右侧不留空 */
    if (window.QVMapCam && window.QVMapCam.setStage) window.QVMapCam.setStage(LW, LH);
  }
  window.QVLayout = layout;

  /* ★★★ 2026-10-20 全站唯一的「屏幕 → 舞台逻辑坐标」换算（用户：「地图选点偏移」）
     layout() 会把 #stage 的**逻辑宽高**写到 ≥960x720（窗口比 16:9 宽/高就变 1330x720、
     1152x720 之类），再用 CSS scale(s) 缩到窗口里。
     ⇒ getBoundingClientRect() 返回的是【视觉】尺寸 = 逻辑宽 × s × UI大小，
        真正的缩放比 = rect.width / **offsetWidth**（offsetWidth 不受 transform 影响）。
     ⚠ 以前各个文件都写 `rect.width / 960`：960 只是设计尺寸，窗口一宽就错，
       而且错得跟离原点的距离成正比 —— 点地图选震心、拖地图、拖旋钮全往左上飘。
     ★ hovpill.js 早就在调 QVStageK / QVStagePt，但从来没定义过（它自己 fallback 成 1）
       → 列表拖动速度也一直是错的。这里补齐。 */
  function stageK() {
    var st = $('stage');
    if (!st || !st.offsetWidth) return 1;
    var r = st.getBoundingClientRect();
    return (r.width / st.offsetWidth) || 1;
  }
  function stagePt(cx, cy) {
    var st = $('stage');
    if (!st) return [cx, cy];
    var r = st.getBoundingClientRect(), k = stageK();
    return [(cx - r.left) / k, (cy - r.top) / k];
  }
  window.QVStageK = stageK;
  window.QVStagePt = stagePt;

  /* ------------------------------------------------------------ 渲染 */
  function pick(list) {
    if (!list || !list.length) return null;
    /* ★★★ 2026-10-30 用户：「有更新的正式地震情报进榜且发震时间更晚时自动降权」
       —— 如果第一条（最新发震）是正式地震，并且发震时间晚于速报，或者同震正式报已到达，
          说明旧速报已被正式情报替代或超越，不能再霸屏主卡片！ */
    var activeEew = null;
    var latestFormal = null;
    for (var j = 0; j < list.length; j++) {
      if (!list[j].isEew) { latestFormal = list[j]; break; }
    }
    for (var i = 0; i < list.length; i++) {
      if (list[i].isEew) {
        if (latestFormal) {
          var fTime = +latestFormal.timeMs || 0, eTime = +list[i].timeMs || 0;
          if (fTime > eTime) continue;                           /* 降权：有更新的正式地震发生，旧速报不抢主卡 */
          var sameTime = Math.abs(fTime - eTime) <= 6 * 60000;
          var samePlace = latestFormal.place && list[i].place && (latestFormal.place === list[i].place || latestFormal.place.indexOf(list[i].place) >= 0 || list[i].place.indexOf(latestFormal.place) >= 0);
          var samePos = isFinite(+latestFormal.lat) && isFinite(+list[i].lat) && Math.abs(+latestFormal.lat - +list[i].lat) < 1.0 && Math.abs(+latestFormal.lon - +list[i].lon) < 1.0;
          if (sameTime && (samePlace || samePos)) continue;      /* 同震正式报已到，速报退让 */
        }
        activeEew = list[i];
        break;
      }
    }
    if (activeEew) return activeEew;
    return list[0] || null;
  }

  /** ★ 地图定位用的条目：JMA 的 xml 源**没有经纬度**（lat/lon = NaN），
   *  而同一事件往往还有一条带坐标的孪生条目（JMAW / USGS / CENC，地名相同、时间相近）
   *  ⇒ 以前直接 focus(选中项) → ok=false → 兑底回「全日本」视图，
   *    海外地震也永远只看到日本（用户报的「世界地图只有日本」）。 */
  function mapTarget(q, list) {
    if (!q) return q;
    /* ★ 2026-10-29：`isFinite(null) === true` —— 坐标缺失的速报（震源調査中）
       会被当有坐标直接返回，镜头飞到几内亚湾。这里换成 null 安全判断。 */
    if (q.lat != null && q.lon != null && isFinite(+q.lat) && isFinite(+q.lon)) return q;
    /* ★ 混合数据源后：其他机构的报文就挂在 q.alts 上，直接借它的坐标
       （只借坐标，卡片上的数字仍然只用主卡片那条报文，绝不混） */
    var alts = q.alts || [];
    for (var i = 0; i < alts.length; i++) {
      if (alts[i].lat != null && alts[i].lon != null && isFinite(+alts[i].lat) && isFinite(+alts[i].lon)) {
        return { id: q.id, lat: alts[i].lat, lon: alts[i].lon, mag: q.mag };
      }
    }
    for (var j = 0; j < list.length; j++) {
      var c = list[j];
      if (c === q || c.lat == null || c.lon == null || !isFinite(+c.lat) || !isFinite(+c.lon)) continue;
      if (c.place !== q.place) continue;
      if (Math.abs((c.timeMs || 0) - (q.timeMs || 0)) > 10 * 60000) continue;
      return { id: q.id, lat: c.lat, lon: c.lon, mag: q.mag };   /* 只借坐标，面板数据仍用 q */
    }
    return q;
  }
  /* ★ 暴露给 render3（震中红叉兜底）：JMA xml 源没有坐标时，红叉也用借来的坐标，
     否则「开机默认不显示最新那场的红叉」（相机飞过去、红叉被 setPins 丢弃）。 */
  window.QVMapTarget = mapTarget;

  function render(force) {
    var d = QData.get();
    var list = d.list.slice(0, 12);
    var q = pick(list);
    S.sel = q;
    /* ★★ 2026-10-10 用户要求：**相机不再跟着选中地震自动跑**。
       官方本身也不是自动的（它另有一个「回到选中地震」按钮 = 默认不会自己过去）。
       用户原话：「相机不会默认就已经反应完，就是那个正中海趴在那，但是我不点它你在那，
                我是要在那个鼠标那点它那个地图表示的那个提示，摄像机它就会自己移动到
                那个地震中心那里。同时红叉也会换地方。」
       ⇒ 这里只把「该往哪看」记在 S.mapTarget 里，真正移动由【点地图震中标记】触发
         （见 boot() 里 QVMapCam.setOpts 的 onPinClick）。 */
    S.mapTarget = mapTarget(q, d.list);

    /* ★★★ 2026-10-27 用户（对比图一）：严重 bug ——「无人值守时相机一直停在上一场地震上」
       以前只有【开机一次】取景（bootFit）和【点魔历行→地図に表示】才动相机：
       新地震进来后，「选中项」换了但相机不动（而且旧的那场可能还在 growIpf 里
       不停地 autoFrame → 相机被“锁”在旧震源附近），结果就是**新地震已经在调查中，
       镜头还在旧地震那片海**。
       ⇒ 规则（无人值守友好）：
         · 选中项（= 最新那场 / 速报优先）的 id+坐标 变了 → 强制重新取景（focus force）
         · 同一场的后续报文（M/震度/时刻修正）→ **不抢**，只让 autoFrame 往外铺
         · 用户手动拖/缩过（cam.manual）→ 同场不抢，但**新地震来了仍然收回来**
           （新事件 = 新的注意目标，与官方「新报 → カメラリセット」一致）
         · 设置页「自动移动镜头」关掉 → 一律不抢 */
    var _t = S.mapTarget;
    var _tKey = (_t && isFinite(_t.lat) && isFinite(_t.lon))
      ? (String(_t.id || '') + '@' + (+_t.lat).toFixed(3) + ',' + (+_t.lon).toFixed(3))
      : '';
    /* ★★★ 2026-10-27 用户：「其他地震完全没生效 / 调查中什么其他的都没搞」
       —— 真因就在这里：调查中/震度速報 阶段「选中项」会换（事件 id 变了），
          S.camKey 变化 → 这里调 focus(x, true) 强行把相机拉回「整个日本」（k≈0.44），
          把 views.js 里按阶段定好的倍率（1.60 / 1.27 / 0.99）整个覆盖掉。
       ⇒ 当前有进行中的 EEW，且它的震源就是这个选中项 → 镜头归 autoFrame 管，这里不抢。 */
    var _E0 = window.QVViews && QVViews.eew;
    var _eewOwns = !!(_E0 && !_E0.cancel && isFinite(+_E0.lat) && isFinite(+_E0.lon) &&
      _t && Math.abs(+_t.lat - +_E0.lat) < 0.4 && Math.abs(+_t.lon - +_E0.lon) < 0.4);
    if (_tKey && _tKey !== S.camKey && !_eewOwns) {
      S.camKey = _tKey;
      if (window.QVMapCam && QVMapCam.focus && (!QVMapCam.opt || QVMapCam.opt('follow'))) {
        try { QVMapCam.focus(_t, true); } catch (eCam) { }
      }
    } else if (_tKey && _eewOwns) {
      S.camKey = _tKey;          /* 记下来，但不动相机 */
    }

    var key = (q ? q.id + ':' + q.timeMs + ':' + (q.maxShindo >= 0 ? q.maxShindo : q.shindo) + ':' + q.mag : 'none') +
      '|' + list.slice(0, 4).map(function (x) { return x.id; }).join(',');
    if (!force && key === S.lastKey) return;
    S.lastKey = key;
    QVRender.draw({ list: list, sel: q, now: Date.now() });
    applyScroll();          /* ★ 每次重绘后重新贴上滚动位移（文字层会被重建） */
  }

  /* ------------------------------------------------------------ ★★ 情报页【整列滚动】
   * 官方实测（反编译 + 运行时）：情报页是**整列一起滚**的，
   *   变量 `UIスクロール`，上限 `6-1-3タブスクロール最大値[tab0] = 556`。
   *   滚的时候**主卡片也一起走**。
   * 用户原话：「还有滚动逻辑，他是带着整个页面往下滚的，你这个页面动都不动一下」。
   * ⇒ 之前那套「主卡片钉住 + 履历列表 10 条开个窗口」是错的，已换成整列平移。
   *
   * 平移哪些：面板里的内容全部 translateY(-scroll)。
   * 不动哪些：暗底 `bgsq`、顶栏 `timebg0`、左侧竖条 `tab*`、右下两个悬浮按钮。
   *
   * ★★ 2026-10-10 用户报 3 个滚动问题后重新划边界：
   *   ① 「时间被滑下去」→ `T.num` 的盒子永远 left:0，`left<264` 把【时钟】也推走了
   *      （已改为看盒子上的 dataset.ax = 排布基准边）
   *   ② 「大卡片被撕裂」→ **主卡片底板 `paIbg180` 必须跟内容一起滚**：以前把它排除了，
   *      结果卡片内容滚走、底板留在原地，两层错开 = 撕裂
   *   ③ 「背景底下变黑」→ 履历底板不够，缺 `paTbg2`（见 layout.js）
   */
  /* ★★ 滚动上限 = 【按内容算】，不是常数。
     官方 `6-1-3タブスクロール最大値` 是「每个标签一格」的列表 —— 实测 tab0：
         数据满时 = 556，没数据时 = 0       （diag/OFF-vars.txt vs diag/allvars.txt）
     它是随内容重算的。我们以前硬编码 556 → 履历只有两三条时还能一直往下滑，
     滑进一片空白（用户：「官方滑到底就结束了，你怎么还可以下滑」）。
     算法：最后一条履历的底边 + 底板留白 − 一屏高。 */
  var SCROLL_MAX_HARD = 556;            /* 官方 tab0 满内容时的上界，兜底用 */
  /* ★★ 2026-10-11 用户报「滑不到底」：这里原来写 ROW_TOP = 414，
     而官方履历首行的**真实** y 是 **432**（render3.js 的 SLOT.row.place.y = -72
     ⇔ SH/2 − (−72) = 432；行内「深さ」cy = 474 也印证了）。
     差 18px ⇒ 滚动上限少了 18px ⇒ 最后一行的「深さ / M」小字被屏幕底边切掉一截。
     现在直接从 render3 的槽位表取，不再写死。 */
  var ROW_TOP = 432, ROW_STEP = 76, ROW_SLOTS = 9;
  /* ★★ 2026-10-23 正式报卡（各地の震度情報，paIbg208 264×456）比普通情报卡高：
     普通卡墨迹底 385、正式报卡 424，差 = 38。下方地震履历 / 底板 / 滚动上限
     全部要跟着下移，否则会「压到卡片上 + 底部黑色背景没了」。
     ⇒ 统一从这里取：render3.js 暴露 QVCardExtra()。 */
  function cardExtra() {
    return (window.QVCardExtra && window.QVCardExtra()) || 0;
  }
  /* ★★ 2026-10-11（第十五轮）：官方滚到底时，最后一行卡片下方会露出约 40px 黑带
     （履历底色板自然末端 = 1122，卡片底 = 1138，滚动上限还允许再往下一点）。
     我们以前 SCROLL_PAD = 24 → 滚到底刚好把蓝色铺满，永远看不到那条黑带
     （用户：「下面背景…应该是官方的黑色」）。60 ≈ 官方那截可见黑带的量。 */
  var SCROLL_PAD = 60;                  /* 底边留白：让最后一行小字全露 + 官方同款黑带 */
  function rowGeom() {
    var G = window.QVRender && QVRender.SLOT;
    var off = cardExtra();
    if (G && G.row && G.row.place && isFinite(G.row.place.y)) {
      return { top: SH / 2 - G.row.place.y + off, step: (G.rowStep || ROW_STEP) };
    }
    return { top: ROW_TOP + off, step: ROW_STEP };
  }
  function scrollMax() {
    var n = (window.QVViews && QVViews.getRows) ? (QVViews.getRows() || []).length : 0;
    n = Math.max(0, Math.min(ROW_SLOTS, n));
    if (!n) return 0;
    var G = rowGeom();
    return Math.max(0, Math.min(SCROLL_MAX_HARD, G.top + n * G.step + SCROLL_PAD - visibleH()));
  }
  /* ★★ 2026-10-11 用户报「滑不到底 / 看不到复活节岛的地震消息」：
     窗口比舞台矮的时候（比如 671x503 的窗口里跑 960x720 的舞台），
     窗口里其实**只露出 662 个逻辑像素**，而这里一直按 720（SH）算 →
     滚到底时履历最后一行还是被窗口底边切掉一截（实测最后一行 602..678，
     而窗口只到 662）。⇒ 凡「一屏多高」都用【窗口实际可见的逻辑高】。 */
  function visibleH() {
    var st = document.getElementById('stage');
    if (!st) return SH;
    var k = stageK();
    /* ★ 2026-10-21 用户：「可以滑的太底部了，导致黑色背景在底部太多」
       以前这里把上限夹在 SH(720)，但舞台**实际逻辑高可能更高**（窗口比例不是 4:3 时
       是 776 之类）→ 滚到底时按 720 算，会多滚出 56px 的空白（黑底）。
       改成用舞台真实逻辑高当上限。 */
    var hReal = st.offsetHeight || SH;
    return Math.max(200, Math.min(hReal, innerHeight / k));
  }
  window.QVVisibleH = visibleH;
  var NO_SCROLL_COS = /^(bgsq|timebg0|tabB|tabBb|tabBs|tabBn|100l|deji0)/;
  /* ★★ 2026-10-11 用户报「底部多了背景，和官方的不一样」：
     履历底板 paTbg1 / paTbg2 是**固定高度**的官方素材（610..870 / 846..1122），
     而官方是按【实际行数】决定底板高度的（津波页那边官方就是 narea(行数*32-25)）。
     行数少的时候，我们会在最后一行下面多出一大段空底板 ⇒ 按需裁剪 / 隐藏。
     ⚠️ 必须每帧都调（applyScroll 在 render 之后跑）：视图切换时 prepare() 会把
        display 复原，这里再夹回去。 */
  function fitBg() {
    var n = (window.QVViews && QVViews.getRows) ? (QVViews.getRows() || []).length : 0;
    /* ★★ 2026-10-20 用户截图问「面板下半那块灰色图层是干什么的，官方没有」：
       paTbg0/1/2 是【情报页·地震履历长列表】的底板（layout.js y 358/610/846）。
       实时页（view 1）官方只有纯黑底 + 一句「表示するものはありません」，
       结果 paTbg1 从 y610 披到 870，被舞台底边切成一截蓝灰色块 —— 就是那块灰。
       ⇒ 非情报页统一收掉这三块。
       view 0 = 情报（履历长列表）/ 1 = 实时 / 2 = 海啸 / 3 = 设置 */
    var vNow = (window.QVViews && QVViews.view != null) ? QVViews.view : 0;
    /* ★★★ 2026-10-26 用户（截图）：「底下的黑色背景出来了，因为地震历史都被 ban 了」
       —— 自定义时间模拟 / 用「历史地震」模板时 QData.clearAll() 会把履历清空，
          行数 = 0，但 paTbg0（「地震履历」标题底板）仍然铺在那里，
          于是上半截是空标题条、下半截直接露黑底。
       ⇒ 行数为 0 时连 paTbg0 一起收掉（有数据了下一帧自动回来）。 */
    var _rowN = (window.QVViews && QVViews.getRows) ? (QVViews.getRows() || []).length : 0;
    if (vNow !== 0 || _rowN === 0) {
      ['paTbg0', 'paTbg1', 'paTbg2'].forEach(function (c) {
        var e = document.querySelector('#art img[data-cos="' + c + '"]');
        if (e) e.style.display = 'none';
      });
      return;
    }
    var G = rowGeom();
    /* ★★ 2026-10-11（第十五轮）用户：「信息卡片背景…应该是官方的黑色」
       —— 官方滚到底时，最后一行卡片下方**露出一条黑带**（履历底色板的自然末端；
       实测官方 paTbg2 = 846..1122，而其最后一行卡片底 = 1138）。
       我们以前把 need 一直算到「最后一行+24」，再把底板裁到 need → 蓝色铺满到底，
       永远看不到那条黑带。⇒ 这里给 need 封顶到官方底板的自然末端 1122。 */
    var OFFICIAL_BG_END = 1122;                      /* paTbg2: 846 + 276 */
    var off = cardExtra();
    var need = Math.min(G.top + n * G.step + SCROLL_PAD, OFFICIAL_BG_END + off);
    [['paTbg1', 610], ['paTbg2', 846]].forEach(function (p) {
      var el = document.querySelector('#art img[data-cos="' + p[0] + '"]');
      if (!el) return;
      if (el.dataset.h == null) {
        el.dataset.h = String(parseFloat(el.style.height) || 0);
        /* ⚠️⚠️ 关键：这是 <img> 里的 SVG，**改 height 会被等比缩放 + 居中**
           （SVG 默认 preserveAspectRatio="xMidYMid meet"）→ 内容变小、左右空出**黑色**
           （用户看到的「背景黑了一块」就是这个）。
           ⇒ object-fit:none + 左上对齐 = 原尺寸摆放，再裁高度就只是**裁掉下面**。 */
        el.style.objectFit = 'none';
        el.style.objectPosition = '0 0';
      }
      var top = p[1] + off, h = +el.dataset.h;
      if (!h) return;
      if (top >= need - 1) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.style.height = Math.min(h, Math.round(need - top)) + 'px';
    });
  }
  function applyScroll() {
    /* ★ 内容变少后（刷新后条数减少）旧 scroll 可能超过新上限 → 先夹回去 */
    var mx = scrollMax();
    if ((S.scroll || 0) > mx) S.scroll = mx;
    fitBg();
    /* ★ 只有情报页（view 0）才有这层滚动。切到设置页时 S.scroll 还留着旧值，
       不挡住的话整个设置列表会被整块平移。 */
    var s = (window.QVRender && QVRender.view === 0) ? (S.scroll || 0) : 0;
    /* ★★ 2026-10-23：正式报卡把履历顶下去 —— 平移量 = -scroll + cardExtra() */
    var off = (window.QVRender && QVRender.view === 0) ? cardExtra() : 0;
    var dyTot = -s + off;
    var tf = dyTot ? ('translateY(' + dyTot + 'px)') : '';
    var els = document.querySelectorAll('#art img[data-cos]');
    for (var i = 0; i < els.length; i++) {
      if (NO_SCROLL_COS.test(els[i].dataset.cos || '')) continue;
      els[i].style.transform = tf;
    }
    /* ★★ 2026-10-23 正式报卡的 overlay 也要跟着整列滚（官方：整页下滚，大卡片一起走）
       —— 不处理的话卡片钉在原地、履历往下跑，看着就是“页面固定了”。
       ★★★ 同时【每帧兜底收起】：draw() 不一定会跑（切阶段 / 来新地震 / 切页），
           overlay 一旦残留就会盖住「震度速報」那张卡的文字（用户：「新模拟不刷新卡片，
           我被你的『各地震度信息』给挡住了」）。QVCardExtra() 只在正式报阶段 > 0。 */
    var fcEl = document.getElementById('qvfinalcard');
    if (fcEl) {
      /* ★★★ 2026-10-27 踩过：这里原来写 `QVCardExtra() > 0` 当开关。
         换成 376 版底板后 hshift = −6（卡变矮 80px，履历要跟着上移），
         于是 `> 0` 为假 → 每帧都把 overlay 卡 **清空 + 隐藏**，
         drawFinalCard 明明画了 18 个节点却永远看不见。
         ⇒ 判「非 0」而不是「> 0」（QVCardExtra 关闭时返回的是精确的 0）。 */
      var fcOn = !!(window.QVCardExtra && window.QVCardExtra() !== 0) &&
        !!(window.QVRender && QVRender.view === 0);
      if (!fcOn) {
        if (fcEl.style.display !== 'none') { fcEl.innerHTML = ''; fcEl.style.display = 'none'; }
      }
      fcEl.style.transform = (fcOn && s) ? ('translateY(' + (-s) + 'px)') : '';
    }
    /* ★★ 2026-10-26 用户：「卡片不跟随 Tab 页面滚动固定死在这里了」
       调查中卡 #inqbox 挂在 #stage 上、不属于 #art 精灵，滚动时没人给它位移。
       官方是整页一起滚 → 这里手动跟 −s。
       ⚠️ 只能加 −s，**不能再加 off**：卡片的布局位置（−103 那套）已经算在它自己的
          子元素坐标里了，再加一次会双重位移。 */
    var iqEl = document.getElementById('inqbox');
    if (iqEl) iqEl.style.transform = s ? ('translateY(' + (-s) + 'px)') : '';
    /* 文字层：面板在左半边（x<264）
       ★★ 不能直接看 `left` —— `T.num` 的盒子永远是 left:0（字形在盒子内部），
          于是时钟（字形在 x≈305）也被推走了。盒子现在记了 dataset.ax → 优先用它。 */
    ['zh', 'txt'].forEach(function (id) {
      var host = document.getElementById(id);
      if (!host) return;
      var kids = host.children;
      for (var k = 0; k < kids.length; k++) {
        var e = kids[k];
        if (!e.style) continue;
        var x = (e.dataset && e.dataset.ax != null) ? parseFloat(e.dataset.ax) : parseFloat(e.style.left);
        e.style.transform = (isFinite(x) && x < 264) ? tf : '';
      }
    });
    /* ★ 命中层【已不再有】履历行 div —— 行不响应点击（见 views.js hitLayer）。 */
  }
  var scrollRaf = 0;
  function scheduleApplyScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = 0;
      applyScroll();
    });
  }
  window.QVScrollPanel = function (dy) {
    var s = Math.max(0, Math.min(scrollMax(), (S.scroll || 0) + dy));
    if (s === (S.scroll || 0)) return;
    S.scroll = s;
    scheduleApplyScroll();
  };
  window.QVScrollReset = function () {
    S.scroll = 0;
    if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
    applyScroll();
  };

  /* ------------------------------------------------------------ ★ 履历行槽位补齐
   * 官方 `paTmjs` / `paTdep` / `paTmag` 各有 **9 个**克隆（间距 76），而我们的
   * 槽位表 `slots-final.js` 是【当初截图那一刻】从官方 dump 的，只抓到 5 个 →
   * 一屏比官方少 4 行。这里按官方实测的间距（76）补到 9 个：直接克隆官方素材，
   * 不自己画。
   */
  function extendRowSlots() {
    var art = document.getElementById('art');
    if (!art) return;
    if (art.dataset.rows9) return;                 /* 幂等：只跑一次 */
    ['paTmjs', 'paTdep', 'paTmag'].forEach(function (c) {
      var base = [].slice.call(art.querySelectorAll('img[data-cos="' + c + '"]'));
      if (!base.length) return;
      var top0 = parseFloat(base[0].style.top);
      if (!isFinite(top0)) return;
      for (var k = base.length; k < 9; k++) {
        var cp = base[0].cloneNode(false);
        cp.style.top = (top0 + 76 * k) + 'px';
        art.appendChild(cp);
      }
    });
    /* ★ 注：行卡（paTm1/2）**不要**在这里克隆！—— 官方行的「卡片+徽章」是同一个
       paTm<震度> 造型（264x116），由 render3.js 的 badge() 按当前数据动态画到 #txt 层；
       layout.js 里的那 5 张是快照残留，buildArt 刻意跳过（否则新旧两套涂在一起）。 */
    art.dataset.rows9 = '1';
  }

  /* ------------------------------------------------------------ 供界面层回调（render3 里挂的交互）
   * QVRedraw ：切页后重绘
   * ★ `QVSelect` 已删除（2026-10-10，用户选 A）：那是我们加的「点履历行 → 换主卡片」，
     官方根本没有这个行为（反编译 `クローン動作_地震履歴ホバー`，里面唯一的点击动作是
     药丸，设的是 `地図過去表示モード`；没有任何「点行」分支）。
     主卡片永远 = pick(list)。 */
  /* ★ hovpill.js 要读的状态：当前选中项 + 履历滚动偏移 */
  window.QVState = function () {
    return { selId: (S.sel && S.sel.id) || null, rowOff: 0, scroll: S.scroll || 0 };
  };
  window.QVRedraw = function () { render(true); };

  /* ------------------------------------------------------------ 地震履历滚动
   * ★★ 2026-10-10 用户：「原版的话，列表可以默认保存 10 条的地震信息，我们这玩意根本滚动不了」
   *  实测官方 VM（不是猜的）：
   *    `5地震情報リスト` 600 = 10 场 × 60 字段；`5-2ID付き地震情報` 150 = **10 × 15**
   *    ⇒ 官方保存【10 条】；`paTmjs` 槽位间距 76，可视行数比 10 少 → 所以它确实要滚
   *  我们布局里只有 5 个可见槽位（官方把多余的做成克隆滚），
   *  所以滚动 = 在 10 条里滑一个窗口，而不是去加图层。
   */
  /* QVScrollRows（列表开窗）已被 QVScrollPanel（整列滚动）取代，已删除。 */
  /** 鼠标是不是在【左边面板区】（x < 290；右边是地图） */
  function inPanelArea(e) {
    /* ★ ZQuake：左右分区用地图层的同一个边界值（原来写死 290，两边容易不一致） */
    var w = 290;
    try { if (window.QVMapCam && QVMapCam.uiRight) w = QVMapCam.uiRight(); } catch (e2) { }
    return stagePt(e.clientX, e.clientY)[0] < w;
  }

  /* ------------------------------------------------------------ 设置页接线（render3 调用）
   * 「UI 大小」「计算频率限制」「自动隐藏按钮」三项在设置页里能真的改东西。 */
  var tickMs = 1000, tickId = 0;
  function schedule() {
    if (tickId) clearInterval(tickId);
    tickId = setInterval(function () { render(true); }, tickMs);
  }
  var hidOn = false, hidEls = null, hidTimer = 0;
  function hidInit() {
    hidEls = [];
    ['FlZom0', 'FlFit0'].forEach(function (c) {
      /* ⚠️ 这两个按钮在 #chrome 层（z-index 最高），不在 #art */
      var e = document.querySelector('#chrome img[data-cos="' + c + '"], #art img[data-cos="' + c + '"]');
      if (e) { e.style.transition = 'opacity .35s'; hidEls.push(e); }
    });
  }
  function hidShow(on) {
    if (!hidEls) hidInit();
    hidEls.forEach(function (e) { e.style.opacity = on ? '1' : '0'; e.style.pointerEvents = on ? 'auto' : 'none'; });
  }
  window.QVSet = {
    uiScale: function (s) { QVUI_SCALE = Math.max(0.5, Math.min(1.6, +s || 1)); layout(); },
    interval: function (ms) { tickMs = Math.max(200, Math.min(10000, ms | 0)); schedule(); },
    autoHide: function (on) {
      hidOn = !!on; hidShow(!hidOn);
      if (hidTimer) { clearTimeout(hidTimer); hidTimer = 0; }
    },
    applyAll: function () { if (window.QVRender && QVRender.applySettings) QVRender.applySettings(); }
  };

  /** ★★ 开机取景：官方【一打开就自动对准最新那一条地震】，不是停在「全日本」默认视图。
   *  证据：
   *    ① 官方启动画面（diag/OFFICIAL-960.png）相机就是奄美大島北東沖 的特写；
   *    ② 实测 dump 里 `1カメラ系` = [-61.75, -64.2, …]（南美某场地震），不是 home；
   *    ③ 官方有运行时标志「自動カメラ移動許可」+ 设置项「自动移动镜头」（默认开）。
   *
   *  ⚠ 这是**一次性**取景：之后**不再**跟着选中项跑。
   *     用户明确说过：「相机不会默认就已经反应完…我是要在那个鼠标那点它那个地图表示的
   *     那个提示，摄像机它就会自己移动到那个地震中心那里」
   *     ⇒ 之后的移动只由【hover 履历行 →「地図に表示」药丸】触发（hovpill.js）。
   *  ⚠ 「自动移动镜头」关掉时 focus() 自己会 return → 保持 home（全日本）。
   *  ⚠ 海外地震由 focus() 内部自动切 world/wlg 图（否则又变成「世界地图只有日本」）。 */
  function bootFit() { applyDefaultView(); }

  /** 把相机恢复到「默认视野」：
   *   · 「自动移动镜头」开（默认）→ 对准【最新那一条地震】= 开机取景的位置
   *   · 关 → 回 home（全日本）
   *  ★ 履历药丸的「取消」也走这里。以前它直接调 `QVMapCam.reset()`（永远回全日本），
   *    于是「预览一条履历 → 取消」会掉到日本，而开机明明是最新那条
   *    （用户：「再点回来，默认视图中不是最新的，竟然我又回到日本旅游了」）。
   *  ⚠ 必须传 force：否则「自动移动镜头」关着的时候 focus() 会提前 return，
   *    取消预览就变成没反应（相机还停在刚预览的那条上）。 */
  function applyDefaultView() {
    if (!window.QVMapCam) return;
    if (S.mapTarget && (!QVMapCam.opt || QVMapCam.opt('follow'))) QVMapCam.focus(S.mapTarget, true);
    else if (QVMapCam.reset) QVMapCam.reset();
  }
  window.QVDefaultView = applyDefaultView;

  /* ------------------------------------------------------------ 启动 */
  function boot() {
    /* ══ 模拟专用构建（eew.konwk.com 源码 fork）：禁用一切真实数据源，仅保留本地模拟 ══
       · QData.refresh 改成空操作（解析空数组）→ 不再拉 JMA/USGS/CENC 等实时目录
       · 下方 QVWs / QVP2P 的 .start() 被 QV_SIM_ONLY 拦截 → 不连 WebSocket
       · 模拟走 QData.inject(q)，与数据源独立，照常驱动主卡/履历/地图 */
    var QV_SIM_ONLY = true;
    if (window.QData && QData.refresh) {
      QData.refresh = function () { return Promise.resolve([]); };
    }
    var n = QVRender.buildArt();
    extendRowSlots();                       /* ★ 履历行槽位 5 → 9（官方是 9） */
    /* ★★★ 2026-10-25 用户：浏览器标签页标题 =「KonEEW - ε=ε=(ノ≧∇≦)ノ」
       （以前会把「官方素材 N 层」拼在标题里，现在统一成品牌串） */
    document.title = 'ZQuake模拟器';
    if (window.QVMapCam) QVMapCam.init();
    /* ★ 2026-10-10：去掉「点地图红叉就选中+移相机」——官方的入口是
       hover 履历行弹出的「地図に表示」药丸（见 hovpill.js），
       点红叉也能跳会跟行点击、药丸点击撞车，且用户明确说“没点它就过去了”。 */
    layout();
    addEventListener('resize', layout);

    /* ★★★ 2026-10-29 用户：「日本地震 api 发紧急地震速报的时候，卡片直接套用了
       『各地震度速报』，应该跳到 EEW 页面（Tab2）使用专用的『紧急地震速报』」
       —— EEW 的 WebSocket（wolfx / P2P）在部分网络下握手失败（实测 503），
          速报只能从 data.js 的 60 秒轮询进来。那条路只更新 QData 履历，
          不会调 onRealEew → 永远停在 Tab1。
       ⇒ 每次数据刷新先让 views 扫一遍列表，把**新鲜的速报条目**按真实 EEW 链路
          喂进去（Tab2 专用速报卡 + 音效 + 取景 + 记录器）。去重由 onRealEew 自己管。 */
    QData.on(function (st) {
      try { if (window.QVViews && QVViews.pumpEew) QVViews.pumpEew(st); } catch (e) { }
      try { if (window.QVViews && QVViews.checkFormalReport) QVViews.checkFormalReport(st); } catch (e) { }
      render(false);
    });

    if (!QV_SIM_ONLY && window.QVWs) {
      QVWs.on(function (ev, q) {
        if (ev !== 'quake' || !q) return;
        QData.inject(q);
        /* ★ 2026-10-23 真实紧急地震速报（wolfx）→ Tab2 速报页 + 音效。
           · 推定阶段（区域震度是 GMPE 算的）
           · 精度不够（1点/PLUM）且未发警報的报不推，只记录
           · 取消报也走这里，内部按 EventID+Serial 去重 */
        if (q.isEew && window.QVViews && QVViews.onRealEew) {
          try { QVViews.onRealEew(q); } catch (e) { }
        }
      });
      try { QVWs.start(); } catch (e) { }
    }

    /* ★★★ 2026-10-28 P2PQuake v2 紧急地震速报（免费、无 key）
       —— 与 wolfx 并行，两者互为兜底；同一条 JMA 电文进来时
          QData 的 sameEvent 分组和 onRealEew 的 eventId|seq 去重会拦掉重复。
       额外带的 q.eewAreas（逐区域到达时刻）wolfx 没有，留给详情页用。 */
    if (!QV_SIM_ONLY && window.QVP2P) {
      QVP2P.on(function (ev, q) {
        if (ev !== 'quake' || !q) return;
        QData.inject(q);
        if (q.isEew && window.QVViews && QVViews.onRealEew) {
          try { QVViews.onRealEew(q); } catch (e) { }
        }
      });
      try { QVP2P.start(); } catch (e) { }
    }

    /* ★★★ 2026-10-31 用户：「加上真数据源 wolfx 和 P2P，双端同步去重，每两秒拉一次数据」
       —— js/realsrc.js：只盯 WOLF-X + P2P 两端的 4 个端点，2 秒一轮。
       · 为什么不直接用 QData.refresh()：它会把 USGS/GDACS/EMSC/JMA list/海啸 等
         十来个源一起拉，2 秒一轮会把这些源打爆（GDACS 实测单次就 33 秒）。
       · 双端去重在 realsrc 内部做（sameEvent：事件ID + 时间 + 距离 + 震级 + 地名），
         同一场地震两端各来一份 → 合成一条，字段互补（WOLF-X 有 Hypocenter/MaxIntensity，
         P2P 有 areas[].arrivalTime 预计到达时刻）。
       · 再交给 QData.inject → mergeList 的跨源分组做第二道去重。
       ⚠ 模拟进行中（q.sim / 视图 V.simOn）时真实源照常拉，但 onRealEew 内部会忽略，
         不会把模拟画面顶掉。 */
    /* ★ 2026-11-04 批量注入队列：realsrc 首轮会把 200+ 条历史一次性 emit，
       逐条 QData.inject 会触发 200+ 次 rebuild + render → 进去时明显卡顿。
       攒成一批（80ms 内的同一轮）只做一次 rebuild / 一次通知。 */
    var _injQ = [], _injT = 0;
    function queueInject(q) {
      _injQ.push(q);
      if (_injT) return;
      _injT = setTimeout(function () {
        _injT = 0;
        var batch = _injQ.splice(0);
        if (!batch.length) return;
        try {
          if (window.QData && QData.injectBatch) QData.injectBatch(batch);
          else batch.forEach(function (x) { QData.inject(x); });
        } catch (e) { }
      }, 80);
    }
    if (window.QVRealSrc) {
      QVRealSrc.on(function (ev, q) {
        if (ev !== 'quake' || !q) return;
        /* ★ 2026-10-31：模拟进行中（V.simOn）真实源不注入 ——
           ① 不把真实地震混进模拟界面；
           ② 避免 QData.inject 的 rebuild() 每 2 秒和模拟渲染抢 CPU（模拟时周期性卡顿的主因之一）。
           onRealEew 内部本就按 V.simOn 忽略，这里只拦 list 注入即可；
           模拟结束后下一轮轮询有变化会自动重新注入，不会丢数据。 */
        if (window.QVViews && QVViews.simOn) return;
        /* ★★★ 2026-11-04 用户：「有些地震速报（isEew=true）已经过去很久了，怎么还会收到提示」
           WOLF-X 的 jma_eew.json 一直挂着最后一条 EEW、P2P 的 556 history 返回最近
           20 条历史速报；首轮启动全被当成「新报」emit → 旧速报也弹卡片/音效/红横幅。
           ⇒ 过期速报既不进列表、也不弹提示（判据与 QVViews.eewIsFresh 同源：10 分钟）。 */
        if (q.isEew && !q.sim && window.QVViews && QVViews.eewIsFresh &&
            !QVViews.eewIsFresh(q)) return;
        queueInject(q);
        if (q.isEew && window.QVViews && QVViews.onRealEew) {
          try { QVViews.onRealEew(q); } catch (e) { }
        }
      });
      try { QVRealSrc.start(); } catch (e) { }
    }

    if (!QV_SIM_ONLY) setInterval(function () { QData.refresh(); }, 60000);
    schedule();                                        /* 时钟：间隔由设置页可调 */

    /* ★★★ 2026-10-27 用户：「音效反应慢半拍」
       —— playFile 以前是「第一次播某个音时才 fetch + decodeAudioData」，
          那一声必然晚 100~300ms（而且会连带解码整个包，更晚）。
       ⇒ 启动后空闲时把整套音效预解码进内存，之后都是 0 延迟。 */
    setTimeout(function () {
      try { if (window.QVSpeak && QVSpeak.preload) QVSpeak.preload(); } catch (e) { }
    }, 1500);

    /* ★ 官方「地震履歴ホバー」药丸（hover 履历行 → 鼠标旁弹「在地图上显示 ▶」） */
    if (window.QVHovPill) { try { QVHovPill.init(); } catch (e) { } }

    /* 设置页「自动隐藏按钮」：鼠标不动就把 ± / 适配 按钮淡出 */
    addEventListener('mousemove', function () {
      if (!hidOn) return;
      hidShow(true);
      if (hidTimer) clearTimeout(hidTimer);
      hidTimer = setTimeout(function () { hidShow(false); }, 2500);
    });

    /* 视图 1（调试）/ 2（海啸）/ 3（设置）都是纵向长列表 → 滚轮滚动
       ★ 视图 0（情报页）：官方是**整列滚动**（UIスクロール 0..556），
         鼠标在左边面板区就整列滚，在右边地图区就缩放地图。
       ★★ 2026-10-11 用户报「海啸页面竟然是滚不动的，看其他地区列表」：
          这里漏了**视图 2**。mapcam.js 的 stage 滚轮处理又规定
          「只有情报页的滚轮才缩放地图」（视图 2 直接 return、且**不** preventDefault），
          ⇒ 事件一路冒泡到 window 后没人接管 → 海啸预报区域列表整块卡死。 */
    addEventListener('wheel', function (e) {
      /* ★★ 模态框（导出・导入 / 关于・素材授权 / 模拟设置）打开时，滚轮必须留给框内滚动：
         以前这里无脑给设置列表 preventDefault → 模态框内容比一屏高时**滲不动**
         （用户：「他妈的还划不动」）。 */
      if (document.querySelector('#qvsim.on, #qvdialog.on, #qvabout.on')) return;
      /* ★★ 2026-10-24 user: "滑不动!" -- the observation-intensity list inside the EEW
         panel has its own scroll area, but this window-level handler swallowed the wheel
         with preventDefault() for view 1/2/3. Let it scroll natively. */
      if (e.target && e.target.closest && e.target.closest('#eewpage .areas')) return;
      if (window.QVRender && QVRender.view === 0 && inPanelArea(e)) {
        var dy = e.deltaY;
        if (e.deltaMode === 1) dy = e.deltaY * 36;
        else if (Math.abs(dy) >= 100) dy = (dy > 0 ? 1 : -1) * 48;
        QVScrollPanel(dy);
        e.preventDefault();
        return;
      }
      if (window.QVRender && (QVRender.view === 1 || QVRender.view === 2 || QVRender.view === 3)) {
        /* ★★★ ZQuake：滑动地图与滑动左边栏**彻底分开** —— 鼠标放哪边哪边动。
           原来在视图 1/2/3 时，鼠标在地图上滚轮也会滚动左侧列表（两边同时动）。 */
        if (!inPanelArea(e)) return;
        QVRender.viewScroll(e.deltaY);
        e.preventDefault();
      }
    }, { passive: false });

    render(true);

    /* ★★ 2026-10-11 用户报「整个页面跟之前一模一样，像没更新」：
       网络有源挂掉（wolfx 503 / gdacs 超时）时 refresh() 一直不 resolve
       → 界面永远卡在「起動中…」的黑底启动页 → 用户看到的永远是同一张图。
       ⇒ 加**兜底**：最多 9 秒，不管成没成都要把界面亮出来
         （有数据画数据，没数据画空态/占位，绝不把人卡在启动页）。 */
    var uiShown = false, uiRevealed = false;

    /* ★★ 2026-11-02 用户：「打开网页必须一次性全部加载好，再把用户放进去。
       加载一点点东西就把我放进去了，结果地图是反应好几秒的，卡片是点了没反应的，
       CSS 是缺失的」
       ⇒ 先把 #stage 在**黑幕下面**排好版并渲染一遍（所有 <img>、官方素材、地图瓦片、
         @font-face 的 NotoSansSC 字体都在这一刻开始下载），等它们全部 load + decode
         完成、字体就绪、连续两帧绘制结束，才真正撤掉 #boot。
         闸门 = window.QVAssetsReady()（js/boot-progress.js，自带 25s 硬超时，
         绝不因为某一张图永久挂住而把人锁死在启动页）。 */
    function showUI() {
      if (uiShown) return;
      uiShown = true;

      var st = $('stage');
      st.hidden = false;
      st.style.visibility = 'hidden';        /* 排版正常、像素不可见：黑幕还盖着 */
      layout(); S.lastKey = ''; render(true);
      if (window.QVSet && QVSet.applyAll) QVSet.applyAll();
      bootFit();

      /* ★★ 2026-11-02 用户：「没有渲染完、加载完，不要放用户进来」——
         ① 先预热 EEW 卡片素材：它们是模拟/速报**第一次出现时**才 new 出来的 SVG，
            不预热的话点开「地震模拟」就是一张半空白的卡；
         ② 再排一次版，让 mapcam 把当前视口的瓦片全部建出来（它们才会开始下载）；
         ③ 最后交给 assetsReady() 轮询到「图片数量稳定 + 全部 complete + 字体 loaded」。 */
      if (window.QVBootProgress && QVBootProgress.prewarm && window.QVViews && QVViews.eewArtUrls) {
        try { QVBootProgress.prewarm(QVViews.eewArtUrls()); } catch (e) { }
      }
      /* ★★ 2026-11-02 地图瓦片不再单独预热：assets/manifest.json 已经把
         assets/ 下全部 6193 个文件（含 kvtiles z3~z8 共 3724 块）列进去，
         闸门那边全量下完才放人，这里不再重复。 */
      layout(); S.lastKey = ''; render(true); bootFit();

      if (window.QVBootProgress && QVBootProgress.setPhase) {
        QVBootProgress.setPhase('首屏已渲染 · 等待素材解码');
      }

      var w0 = innerWidth, h0 = innerHeight;
      var gate = window.QVAssetsReady ? window.QVAssetsReady() : null;
      if (gate && gate.then) gate.then(reveal, reveal);
      else reveal();

      function reveal() {
        if (uiRevealed) return;
        uiRevealed = true;
        st.style.visibility = '';
        /* ══ 模拟专用：始终可用的「模拟地震」入口（自由设置震中/规模/深度/发报频率） ══ */
        (function () {
          if (window.__simLaunchReady) return;
          window.__simLaunchReady = 1;
          var b = document.createElement('button');
          b.id = 'simLaunchBtn';
          b.textContent = '🎯 模拟地震（自由设震中）';
          b.setAttribute('style', 'position:fixed;left:12px;bottom:12px;z-index:99999;padding:10px 14px;background:#1b6ef3;color:#fff;border:none;border-radius:8px;font:14px/1.3 "Microsoft YaHei",sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.45)');
          b.onclick = function () { try { if (window.QVViews && QVViews.openSimSettings) QVViews.openSimSettings(); } catch (e) { } };
          document.body.appendChild(b);
          /* ★ ZQuake：右下角「自动操作地图」按钮（与原版深色风格一致）。
             用户手动拨动地图后 → 自动镜头让位；点这个按钮重新打开。 */
          var ab = document.createElement('button');
          ab.id = 'autoCamBtn';
          ab.title = '用户手动拨动地图后自动镜头会停用，点此恢复';
          function paintAutoBtn() {
            var cam = window.QVMapCam;
            var autoOn = (cam && cam.isAutoCam) ? cam.isAutoCam() : true;
            ab.textContent = autoOn ? '自动操作地图：开' : '自动操作地图：关';
            ab.setAttribute('style', 'position:fixed;right:12px;bottom:12px;z-index:99999;padding:8px 13px;' +
              'background:' + (autoOn ? '#1a2230' : '#1b6ef3') + ';color:' + (autoOn ? '#c8d6e8' : '#ffffff') + ';' +
              'border:1px solid ' + (autoOn ? '#3b4a5c' : '#3f83f7') + ';border-radius:6px;' +
              'font:13px/1.2 "Microsoft YaHei",sans-serif;cursor:pointer;' +
              'box-shadow:0 2px 10px rgba(0,0,0,.45)');
          }
          /* ★ 点这个按钮 = **重新开启**自动操作地图（用户手动拨动过之后） */
          ab.onclick = function () {
            try {
              var cam = window.QVMapCam;
              if (cam && cam.setAutoCam) cam.setAutoCam(true);
            } catch (e) { }
            paintAutoBtn();
          };
          document.body.appendChild(ab);
          paintAutoBtn();
          setInterval(paintAutoBtn, 600);
          /* ★ ZQuake：**默认不再自动跑演示地震**（打开就是干净的地图 + 按钮）。
             需要看效果时：
               · 点左下角「🎯 模拟地震」自己设定震中/规模/深度后开始
               · 或在网址后加 ?demo=japan / ?demo=china / ?demo=tokai 直接放一段演示
             （最终报后波前会冻结，随波地图会缓慢放大） */
          var _dm = (/[?&]demo=([a-z]+)/.exec(location.search) || [])[1];
          if (_dm) {
            setTimeout(function () {
              try {
                if (window.QVViews && QVViews.startDemoSim) {
                  var SC = {
                    japan: { lat: 38.2, lon: 142.4, mag: 7.0, depthKm: 30, place: '演示震源（日本·房总近海）' },
                    china: { lat: 31.0, lon: 103.4, mag: 7.0, depthKm: 12, place: '演示震源（中国·四川）' },
                    tokai: { lat: 34.0, lon: 137.2, mag: 7.4, depthKm: 25, place: '演示震源（日本·东海）' }
                  };
                  QVViews.startDemoSim(SC[_dm] || SC.japan);
                }
              } catch (e) { }
            }, 800);
          }
        })();
        /* 等待期间窗口被改过大小 → 才需要重排（此时新建的瓦片不算首屏了） */
        if (innerWidth !== w0 || innerHeight !== h0) {
          layout(); S.lastKey = ''; render(true); bootFit();
        }
        $('boot').hidden = true;
        if (window.QVBootProgress && QVBootProgress.done) QVBootProgress.done();
      }
    }
    setTimeout(showUI, 9000);

    QData.refresh().then(function () {
      showUI();
      /* ★★ 历史地震入口（JMA 震度データベース，见 js/hist.js）：
         `?hist=<事件ID>` 直接展示那场地震 —— 例如 311：
           http://127.0.0.1:8892/index.html?hist=20110311144618
         官方实时 list.json 只留 1 个月，历史大地震只能走震度数据库拿。
         放到 refresh 之后：先让实时数据落位，再把历史那场顶到主卡片。 */
      var m = /[?&]hist=(\d{8,20})/.exec(location.search);
      if (m && window.QVHist) {
        try { window.QVHist.show(m[1]); } catch (e) { if (window.console) console.warn('QVHist.show 失败', e); }
      }
    }).catch(function (e) {
      showUI();
      if (!QData.get().list.length) {
        $('err').hidden = false;
        $('errmsg').textContent = String(e && e.stack || e);
      }
    });
  }

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
  else boot();
})();
