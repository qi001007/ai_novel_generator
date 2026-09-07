/**
 * 三栏算术的直测：给窗口宽度，拿数字断言。**不 render、不拖分隔条**。
 * 候选 7 要的就是这个：以前验「窄窗口不许把正文列压扁」只能整页渲染 + 真拖（见
 * WorkbenchLayout.test.tsx 里那三段拖拽测试），而规则本身在组件里读 window.innerWidth。
 */
import { describe, expect, it } from "vitest";

import { CHAT_MIN, SIDEBAR_MAX, SIDEBAR_MIN, chatMaxAt, clampPaneAt, defaultPanesAt } from "./paneLayout";

describe("paneLayout", () => {
  it("设计稿宽度下：正文列还剩 934px，聊天列默认 471px（帧 27 的 470）", () => {
    expect(chatMaxAt(1440, 300)).toBe(934);
    expect(defaultPanesAt(1440)).toEqual({ sidebar: 300, chat: 471 });
  });

  it("860px 窗口：聊天列让出 6px，正文列保住 160px 的地板（第十五批批注 2.1 的那次实测）", () => {
    expect(chatMaxAt(860, 260)).toBe(394);
    // 地板不许高过天花板：以前这里会返回 CHAT_MIN=400，正文列被压成 114px
    expect(clampPaneAt("chat", 400, { sidebar: 260, viewport: 860 })).toBe(394);
    expect(394).toBeLessThan(CHAT_MIN);
  });

  it("窄到 500px：聊天列上限是 34 而不是 400，且永不为负", () => {
    expect(clampPaneAt("chat", 400, { sidebar: 260, viewport: 500 })).toBe(34);
    expect(chatMaxAt(400, 260)).toBe(0);
  });

  it("树列夹在自己的区间里，并四舍五入", () => {
    expect(clampPaneAt("sidebar", 999, { viewport: 1440 })).toBe(SIDEBAR_MAX);
    expect(clampPaneAt("sidebar", 10, { viewport: 1440 })).toBe(SIDEBAR_MIN);
    expect(clampPaneAt("sidebar", 300.6, { viewport: 1440 })).toBe(301);
  });
});
