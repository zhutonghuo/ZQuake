/* hovpill.js — 官方「地震履歴ホバー」药丸 + 履历拖动滚动
 *
 * ★★ 全部反编译 assets/project.json 得到，不是猜的：
 *   UI 精灵里有自定义积木「クローン動作_地震履歴ホバー」和「ホバー最も近い」，
 *   造型 paTth0 / paTth1 / paTth2（画布 224x76、旋转中心 112,38）：
 *     paTth0 = 「地図に表示 ▶」   正常态 → 点它把这行地震显示到地图上
 *     paTth1 = 「やめる ◀」       已经是它 → 点它取消
 *     paTth2 = 「受信待機中」     没有可用数据（禁用）
 *     paTthb = 纯 #475a74 底      禁用底色
 *   药丸实际墨迹（扫 alpha 像素实测）= x98 y23 w118 h32，即 118x32；
 *   配色 = #7d97b4 外圈 + #31476d 底 + #fff 字/箭头。
 *   位置跟鼠标（积木里读 sensing_mousex / sensing_mousey）。
 *
 * 我们：药丸底用官方素材 assets/uihov/hbBg.svg（paTth0 去日文文字后裁到 118x32），
 *       文案换成中文、箭头自己画三角（官方那个三角烘在字形路径里，取不出来）。
 *       与项目里其它地方一致：官方图形 + 中文文字层。
 */
(function (g) {
  'use strict';
  /* 与 views.js 的 ROW_HIT 保持一致 */
  var ROW = { x: 8, y: 414, w: 240, h: 76, step: 76 };
  var BASE = 'assets/uihov/';
  var WHITE = '#ffffff';
  var el, bg, lab, arw, mask, curRow = null, curState = null, curIndex = -1, shownId = null;
  /** 面板当前的整列滚动量（官方变量 UIスクロール） */
  function SC() { var s = g.QVState ? g.QVState() : {}; return s.scroll || 0; }
  /** ★★ 2026-10-26 用户：「地震历史…那个切换按钮在漂移」
     —— 履历整列会按 QVCardExtra() 平移（调查中 −101 / 正式报 +63，见 render3.js），
        而药丸和行遮罩只减了 scroll、没加这个偏移 → 按钮和它那行对不上（实测差 63px）。
        命中判定（rowAt）同样要减掉，否则悬停到的是相邻那行。 */
  function EXTRA() {
    var v = (g.QVCardExtra && g.QVCardExtra()) || 0;
    return v;
  }

  function stageEl() { return document.getElementById('stage'); }
  function inRows(p) {
    return p[0] >= ROW.x && p[0] <= ROW.x + ROW.w && p[1] >= ROW.y + EXTRA();
  }
  /** 客户端坐标 → 舞台坐标
   *  ⚠️⚠️ 自适应后舞台逻辑宽 = gw（≥960）⇒ `rect.width / 960` 不再是缩放比，
   *     必须用 app.js 的 QVStageK（= rect.width / 舞台逻辑宽）。 */
  function stagePt(e) {
    if (g.QVStagePt) return g.QVStagePt(e.clientX, e.clientY);
    var s = stageEl(); if (!s) return [0, 0];
    var r = s.getBoundingClientRect();
    var k = (s.offsetWidth ? (r.width / s.offsetWidth) : 1) || 1;
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k];
  }
  function rows() {
    return (g.QVViews && g.QVViews.getRows) ? (g.QVViews.getRows() || []) : [];
  }
  function rowOff() { return 0; }   /* 列表开窗已废，保留占位以免外部引用报错 */
  /** 鼠标下的履历行索引（舞台坐标，要加回滚动量） */
  function rowAt(p) {
    var y = p[1] + SC() - EXTRA();          /* ★ 减掉整列布局偏移（调查中/正式报） */
    if (p[0] < ROW.x || p[0] > ROW.x + ROW.w || y < ROW.y) return -1;
    var i = Math.floor((y - ROW.y) / ROW.step);
    return (i >= 0 && i < rows().length) ? i : -1;
  }

  /* ---------- 药丸 DOM ---------- */
  function build() {
    if (el) return;
    var host0 = document.getElementById('stage') || document.body;
    /* ★★ 整行覆盖层 = 官方 `paTthb`：一张 224×76 的纯色 #475a74 矩形，
       以 GHOST 50（opacity .5）盖在被悬停的那一行上。
       用户原话：「不是他选中那个卡片的话，他就会有那个阴影，还有整个卡片」
       —— 就是这个。药丸(paTth0/1/2) 再叠在它上面。 */
    mask = document.createElement('img');
    mask.id = 'hovmask';
    mask.src = BASE + 'hbMask.svg';
    mask.draggable = false;
    mask.style.cssText = 'position:absolute;width:224px;height:76px;display:none;' +
      'pointer-events:none;z-index:29;opacity:.5';
    host0.appendChild(mask);

    el = document.createElement('div');
    el.id = 'hovpill';
    el.style.cssText = 'position:absolute;left:0;top:0;width:118px;height:32px;display:none;' +
      'cursor:pointer;z-index:30;pointer-events:auto;user-select:none';
    bg = document.createElement('img');
    bg.src = BASE + 'hbBg.svg';
    bg.draggable = false;
    bg.style.cssText = 'position:absolute;left:0;top:0;width:118px;height:32px;pointer-events:none';
    lab = document.createElement('div');
    lab.style.cssText = 'position:absolute;left:0;top:0;width:118px;height:32px;line-height:32px;' +
      'text-align:center;font:13px/32px "Microsoft YaHei","PingFang SC",sans-serif;color:' + WHITE +
      ';white-space:nowrap;pointer-events:none;text-shadow:0 1px 1px rgba(0,0,0,.35)';
    /* 箭头：官方那个三角烘在字形里取不出来 → 用同色自画一个 8x10 小三角 */
    arw = document.createElement('div');
    arw.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
    el.appendChild(bg); el.appendChild(lab); el.appendChild(arw);
    var host = document.getElementById('stage') || document.body;
    host.appendChild(el);
    el.addEventListener('click', onClick);
    el.addEventListener('mouseleave', function () { hide(); });
    /* ★★ 保险：把 mousedown / mouseup 也吃掉。
       真实鼠标点击如果压在药丸边缘、或按下与抬起之间鼠标动了一点，
       浏览器的 click 会派到「按下/抬起目标的最近公共祖先」上 —— 那样会漏到外面去。 */
    el.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    /* ⚠️ 必须同时调 onUp()：这里 stopPropagation 会让 window 上的 onUp 收不到。
       如果此刻正处在「面板拖动」中（mousedown 落在行上、松手落在药丸上），
       drag 就永远清不掉 → 之后【不按任何键】移动鼠标也会一直滚面板。 */
    el.addEventListener('mouseup', function (e) { e.stopPropagation(); onUp(); });
  }

  function paint(dir) {
    /* ⚠️ 先全部清零：不然上一个方向的三角会残留 →
       实测出现过「◀ 取消 ▶」两个箭头同时挂在药丸上。 */
    arw.style.borderTop = arw.style.borderBottom = arw.style.borderLeft = arw.style.borderRight = '0';
    arw.style.left = '0'; arw.style.top = '0';
    if (dir > 0) {
      arw.style.left = '100px';
      arw.style.top = '10px';
      arw.style.borderTop = '6px solid transparent';
      arw.style.borderBottom = '6px solid transparent';
      arw.style.borderLeft = '9px solid ' + WHITE;
    } else if (dir < 0) {
      arw.style.left = '10px';
      arw.style.top = '10px';
      arw.style.borderTop = '6px solid transparent';
      arw.style.borderBottom = '6px solid transparent';
      arw.style.borderRight = '9px solid ' + WHITE;
    }
    bg.src = BASE + (curState && curState.dis ? 'hbDim.svg' : 'hbBg.svg');
    lab.textContent = curState ? curState.t : '';
    lab.style.opacity = (curState && curState.dis) ? '.72' : '1';
  }

  /** 药丸 / 遮罩的**固定**位置：贴在履历行上，再减去整列滚动量。
   *  官方造型 paTth* 的画布就是 224x76（正好一个履历行），药丸画在画布内 x98..216 / y23..55
   *  ⇒ 换算到行内绝对位置 = 行左上 + (98, 23)，宽度 118、高 32（hbBg.svg 已裁到这个框）。
   *  ⚠️ 之前我跟着积木里的 sensing_mousex 写成「跟鼠标」→ 用户：
   *     「这个药丸不是固定的吗，为什么跟随我的鼠标啊」。 */
  function place(i) {
    var sc = SC(), ex = EXTRA();
    if (mask) {
      mask.style.left = ROW.x + 'px';
      mask.style.top = (ROW.y + i * ROW.step + ex - sc) + 'px';
      mask.style.display = '';
    }
    el.style.left = (ROW.x + 98) + 'px';
    el.style.top = (ROW.y + i * ROW.step + 23 + ex - sc) + 'px';
  }
  function show(i, q, st) {
    build();
    curRow = q; curState = st; curIndex = i;
    paint(st.dir);
    place(i);
    el.style.display = '';
  }
  function hide() {
    if (el) el.style.display = 'none';
    if (mask) mask.style.display = 'none';
    curRow = null; curState = null; curIndex = -1;
  }

  function lblFor(q) {
    if (!q) return null;
    if (q.lat == null || q.lon == null || !isFinite(+q.lat) || !isFinite(+q.lon)) return { t: '等待接收', dis: true, dir: 0 };
    if (shownId && shownId === q.id) return { t: '取消', dis: false, dir: -1 };
    return { t: '在地图上显示', dis: false, dir: 1 };
  }

  /** 点药丸 = 官方的「地図に表示」：**只把地图相机移过去 + 把红叉钉在这条**。
   *  ★ 这是履历列表的**唯一**交互（2026-10-10 用户选 A）：
   *    履历行本身不响应点击，「点行 → 换主卡片」已删除 —— 官方积木里没有那个分支。
   *    所以主卡片永远 = 最新那条，与官方一致。 */
  function onClick(e) {
    e.stopPropagation();
    if (!curRow || !curState || curState.dis) return;
    var q = curRow;
    var cancel = !!(shownId && shownId === q.id);
    if (cancel) {
      shownId = null;
      if (g.QVMapCam && g.QVMapCam.lockPin) g.QVMapCam.lockPin(null);   /* 解锁 → 红叉回到选中项 */
      /* ★ 回「默认视野」＝ 跟随开时对准【最新那条】、跟随关时回全日本。
         以前直接调 QVMapCam.reset() → 永远回全日本 → 「预览完取消」掉到日本，
         而开机明明是最新那条
         （用户：「再点回来，默认视图中不是最新的，竟然我又回到日本旅游了」）。 */
      if (g.QVDefaultView) g.QVDefaultView();
      else if (g.QVMapCam && g.QVMapCam.reset) g.QVMapCam.reset();
    } else {
      shownId = q.id;
      if (g.QVMapCam && g.QVMapCam.lockPin) {
        g.QVMapCam.lockPin([{ lat: q.lat, lon: q.lon, kind: q.isEew ? 'eew' : 'normal' }]);
      }
      if (g.QVMapCam && g.QVMapCam.focus) g.QVMapCam.focus(q, true);
    }
    hide();
    if (g.QVRedraw) g.QVRedraw();
  }

  /* ---------- 鼠标跟踪 ---------- */
  /** ★★ 履历行只存在于**情报页（视图 0）**。
   *  2026-10-11 用户报「设置页面滑动竟然还能看到信息页面那个地图查看小卡片」：
   *  根因 = mousemove 监听挂在 #stage 上，**只看坐标、不看当前视图**，
   *  而设置页 / 海啸页的 x8..248 × y>414 区域正好落在「履历行」的坐标范围里
   *  → 鼠标一滑过就弹出「在地图上显示 ▶」药丸 + 行高亮遮罩（= 用户说的那个小卡片）。
   *  行数据是情报页的（QVViews.getRows），挂在别的页面上毫无意义。 */
  function infoView() {
    if (!g.QVViews || g.QVViews.view == null) return true;
    return g.QVViews.view === 0;
  }
  function onMove(e) {
    if (!infoView()) { hide(); return; }
    var p = stagePt(e);
    var i = rowAt(p);
    if (i < 0) { hide(); return; }
    var q = rows()[i];
    var st = lblFor(q);
    if (!st) { hide(); return; }
    /* 同一行且状态没变 → 位置也不会变（药丸是贴行的，不是跟鼠标的） */
    if (curRow === q && curState && curState.t === st.t) { place(i); return; }
    show(i, q, st);
  }

  /* ---------- 面板“拖”滚动（官方是整列滚动，不是列表开窗） ---------- */
  var drag = null;
  function inPanel(p) { return p[0] < 290; }   /* 左边面板区（右边给地图） */
  function onDown(e) {
    /* ★ 模态框开着时，里面的鼠标按下不属于「拖列表」 */
    if (document.querySelector && document.querySelector('#qvsim.on, #qvdialog.on, #qvabout.on')) { drag = null; return; }
    /* ★ 落在设置页控件（含滑杆）上的按下不属于「拖列表」：
       否则拖「UI 大小」滑杆会同时把设置列表也滑走（2026-10-11 修）。 */
    if (e.target && e.target.dataset && e.target.dataset.vc != null) { drag = null; return; }
    var p = stagePt(e);
    if (!inPanel(p)) { drag = null; return; }
    drag = { y: e.clientY };
  }
  function onDrag(e) {
    if (!drag) return;
    /* ⚠️ 自适应后 clientY 是**物理像素**，滚动量必须是**设计单位** → 要除回去。
       （以前直接拿 clientY 差当设计单位 → 缩放≠1 时拖列表速度不对） */
    var dy = (e.clientY - drag.y) / (g.QVStageK ? g.QVStageK() : 1);
    drag.y = e.clientY;
    if (!dy) return;
    /* 情报页拖的是整列滚动量（app.js 的 S.scroll） */
    if (infoView()) { if (g.QVScrollPanel) g.QVScrollPanel(-dy); return; }
    /* ★ 1/3 是各自的长列表 → 必须走 views.js 的 scroll3，
       以前一律调 QVScrollPanel → 只改情报页的 S.scroll，设置页纹丝不动，
       却把情报页的滚动量悄悄改了（切回去位置是歪的）。
       视图 2 的拖动留给地图拖拽（mapcam.js 允许海啸页拖地图）。 */
    var v = (g.QVViews && g.QVViews.view) | 0;
    if ((v === 1 || v === 3) && g.QVRender && g.QVRender.viewScroll) g.QVRender.viewScroll(-dy);
  }
  function onUp() { drag = null; }

  function init() {
    build();
    var s = stageEl(); if (!s) return;
    s.addEventListener('mousemove', function (e) { onMove(e); onDrag(e); });
    s.addEventListener('mouseleave', hide);
    s.addEventListener('mousedown', onDown);
    addEventListener('mousemove', onDrag);
    addEventListener('mouseup', onUp);
    /* 切视图 / 换页就收起来，免得留在屏幕上 */
    if (g.QVViews && g.QVViews.onChange) g.QVViews.onChange(hide);
  }

  g.QVHovPill = { init: init, hide: hide,
    state: function () { return { row: curRow && curRow.id, idx: curIndex, st: curState, shown: shownId }; } };
})(window);
