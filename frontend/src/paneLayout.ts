/**
 * 工作台三栏的宽度事实：常量 + 纯算术。窗口宽度一律是**入参**。
 *
 * 为什么单独一个文件（候选 7，2026-09-07）：这些原先埋在 `WorkbenchPage.tsx` 里，而算术
 * 直接读 `window.innerWidth`——jsdom 给不了参数，于是「860px 的窗口不许把正文列压成
 * 114px」这种回归只能靠整页渲染 + 真拖分隔条来验；测试文件还只能自己重抄一份
 * `SIDEBAR_DEFAULT = 300`（第三主人，靠同时改对维持一致）。现在规则能拿数据直测，常量只有一份。
 */
export type PaneKey = "sidebar" | "chat";

// Defaults follow UI-DESIGN.md and the approved frames: 280 / 470 / rest.
// 帧 27: the tree lost its right of way to the rail, and the rows need the width
// they had. 260 is the narrowest a row like "0001  草稿" still fits.
export const SIDEBAR_MIN = 260;
export const SIDEBAR_MAX = 520;
export const SIDEBAR_DEFAULT = 300;
export const CHAT_MIN = 400;
/* Dragging a boundary past its pane puts that pane away - 第十五批批注 2.2, an ask
   that has sat on the list for several rounds. 90px is where a column stops being a
   column: the tree row, the chat composer and the editor toolbar all stop fitting,
   so continuing to drag is fighting a strip that cannot hold anything. */
export const CLOSE_AT = 90;
/* The prose column's own floor, and it is higher than CLOSE_AT on purpose: below
   this the toolbar stops fitting and the actions (机械校验 / AI 自检 / 通过终审 / 打回 /
   事实落库) get pushed past the right edge and eaten by overflow:hidden - measured at
   a 24px toolbar with every action reporting hit:false (第十五批批注 2.1). So the
   column is either at least this wide or it is away, never a clipped sliver. */
export const EDITOR_MIN = 160;
export const CHAT_DEFAULT_RATIO = 0.327; // 470 / 1440

/** 左边的图标导轨宽 44；两条可拖分隔条各 1px，合计 2。以前是算式里的裸数字。 */
export const RAIL_WIDTH = 44;
export const SEAM_WIDTH = 2;

/**
 * 正文列可以一路被挤到关闭阈值（第十五批批注 2.2），所以聊天列的上限只是窗口减去导轨、
 * 树、两条缝与正文地板之后剩下的那点。它以前固定预留 560px，结果正文列永远拖不合上。
 */
export function chatMaxAt(viewport: number, sidebar: number): number {
  // 0, not CHAT_MIN: a ceiling must not carry a floor of its own, or on a narrow
  // window the chat pane's minimum wins and the prose column is the one that pays.
  return Math.max(0, viewport - RAIL_WIDTH - sidebar - SEAM_WIDTH - EDITOR_MIN);
}

/**
 * 地板永远不许高过它自己的天花板。聊天列的下限曾盖过上限，于是 860px 的窗口得到 114px
 * 的正文列：聊天占 400，剩下的都归正文（第十五批批注 2.1 实测过工具条被 overflow 吃掉）。
 * 窄窗口现在由聊天列让位，而不是正文被压扁。
 */
export function clampPaneAt(
  pane: PaneKey,
  value: number,
  { sidebar = SIDEBAR_DEFAULT, viewport }: { sidebar?: number; viewport: number },
): number {
  const max = pane === "sidebar" ? SIDEBAR_MAX : chatMaxAt(viewport, sidebar);
  const min = Math.min(pane === "sidebar" ? SIDEBAR_MIN : CHAT_MIN, max);
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 默认两栏宽度（帧 27：280 / 470 / 其余给正文，比例按 1440 设计稿）。 */
export function defaultPanesAt(viewport: number) {
  return {
    sidebar: SIDEBAR_DEFAULT,
    chat: clampPaneAt("chat", Math.round(viewport * CHAT_DEFAULT_RATIO), {
      sidebar: SIDEBAR_DEFAULT,
      viewport,
    }),
  };
}
