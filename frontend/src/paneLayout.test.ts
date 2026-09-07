/**
 * 三栏算术的直测：给窗口宽度，拿数字断言。**不 render、不拖分隔条**。
 * 候选 7 要的就是这个：以前验「窄窗口不许把正文列压扁」只能整页渲染 + 真拖（见
 * WorkbenchLayout.test.tsx 里那三段拖拽测试），而规则本身在组件里读 window.innerWidth。
 */
import { describe, expect, it } from "vitest";

import {
  CHAT_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  chatMaxAt,
  clampPaneAt,
  defaultPanesAt,
  chatRoomAt,
  dragValueAt,
  editorWidthAt,
} from "./paneLayout";

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

  it("拖动中的地板是 CLOSE_AT，不是静止下限（第十五批批注 2.2）", () => {
    // 树列静止下限 260，但拖动时要能一路收到 90 才看得见「收进边里」这个过程
    expect(dragValueAt("sidebar", 120, { sidebar: 300, viewport: 1440 })).toBe(120);
    expect(dragValueAt("sidebar", 40, { sidebar: 300, viewport: 1440 })).toBe(90);
    expect(clampPaneAt("sidebar", 40, { viewport: 1440 })).toBe(SIDEBAR_MIN);
    // 上限照样生效：拖过头不许把列拖出窗口
    expect(dragValueAt("sidebar", 9999, { sidebar: 300, viewport: 1440 })).toBe(SIDEBAR_MAX);
  });

  it("正文列的宽度由可见的那几列算出来，隐藏的不占位", () => {
    const base = { viewport: 1440, sidebar: 300, chat: 471 };
    expect(editorWidthAt({ ...base, sidebarHidden: false, chatHidden: false })).toBe(623);
    expect(editorWidthAt({ ...base, sidebarHidden: true, chatHidden: false })).toBe(924);
    expect(editorWidthAt({ ...base, sidebarHidden: false, chatHidden: true })).toBe(1095);
  });


  it("放开正文列时，聊天列让出的那点空间按可见的列算", () => {
    const base = { viewport: 1440, sidebar: 300 };
    // 两列都在：1440 - 44 导轨 - (300+1 缝) - (0 + 1 缝，聊天列的缝仍占位) - 160 正文地板
    expect(chatRoomAt({ ...base, sidebarHidden: false, chatHidden: false })).toBe(934);
    // 树列收起来了，那点宽度就还给聊天列
    expect(chatRoomAt({ ...base, sidebarHidden: true, chatHidden: false })).toBe(1235);
    // 聊天列本来就藏着：它的缝也不该算进去
    expect(chatRoomAt({ ...base, sidebarHidden: false, chatHidden: true })).toBe(935);
  });

});
