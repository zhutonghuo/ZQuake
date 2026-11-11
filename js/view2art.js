/* 自动生成（build/gen-view2.js）：官方「津波予報」版面
 * 源：compare/dump-TSUSPRITES.json（官方运行时 960x720）· assets/project.json
 * 造型：assets/ui2c/<造型名>.svg    ⚠️ 勿手改，重跑 build/gen-view2.js 覆盖。
 */
/* ★★ 2026-10-22 手改记录（用户报「多等级海啸 UI 错乱」）：
 *   下面 `paNp1` / `list` 是【无深度】时的官方基准值（单行震源块 paNsb1）。
 *   当海啸数据带深度时，views.js 的 draw2 会动态改成：
 *     震源块 paNsb0（两行面板：震级 + 深さ）→ 组头顶 189 / 列表顶 253
 *   旧的错乱原因：一直用单行块 paNsb1（面板底 151）+ 深度行 156..174
 *   → 深度行悬在面板外、还被组头压住。
 */
window.QV_VIEW2 = {
  art: [["hnt1",769,446,270,260],["paNbg1",8,8,224,140],["paNp1",8,146,224,68],["paNsb1",8,46,224,156],["paNsmag",8,46,224,156],["paNst0",8,46,224,156]],
  list: {"x":8,"w":224,"h":68,"top":210,"pitch":64,"capTop":1106,"capH":68,"textX":46,"textTop":214.21,"textPitch":32,"textW":179.23,"textH":27.57,"rowsPerBlock":2},
  legend: {"cos":"hnt1","x":769,"y":446,"w":270,"h":260},
  rows: ["paNl","paNle","paNl1","paNl11","paNl112","paNl2","paNl21","paNl212","paNl3","paNl31","paNl312","paNl4","paNl41","paNl412"],
  bgs: ["paNbg0","paNbg1","paNbg2","paNbg3","paNbg4","paNbgb"],
  hnts: ["hnt1","hnt2","hnt21","hnt3","hnt31","hnt4","hnt41"],
  alerts: ["paNp1","paNp2","paNp3","paNp4","paNp5","paNp6","paNp7","paNp8","paNp9","paNp3t","paNp4t"],
  names: ["nt100","nt101","nt102","nt110","nt111","nt120","nt200","nt201","nt202","nt210","nt220","nt230","nt240","nt250","nt300","nt310","nt311","nt312","nt320","nt321","nt330","nt340","nt341","nt350","nt360","nt361","nt370","nt380","nt390","nt391","nt400","nt500","nt510","nt520","nt521","nt522","nt530","nt540","nt550","nt551","nt560","nt570","nt580","nt590","nt600","nt601","nt610","nt700","nt701","nt710","nt711","nt712","nt720","nt730","nt731","nt740","nt750","nt751","nt760","nt770","nt771","nt772","nt773","nt800","nt801","nt802"]
};
