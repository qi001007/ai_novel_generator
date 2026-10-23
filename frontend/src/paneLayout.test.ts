/**
 * 三栏算术的直测：给窗口宽度，拿数字断言。**不 render、不拖分隔条**。
 * 候选 7 要的就是这个：以前验「窄窗口不许把正文列压扁」只能整页渲染 + 真拖（见
 * WorkbenchLayout.test.tsx 里那三段拖拽测试），而规则本身在组件里读 window.innerWidth。
 */
import { describe, expect, it } from "vitest";

import {
  CHAT_MIN,
  EDITOR_MIN,
  EDITOR_USABLE,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  chatMaxAt,
  clampPaneAt,
  defaultPanesAt,
  chatRoomAt,
  dragValueAt,
  editorWidthAt,
  fitHiddenAt,
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
    const clamped = dragValueAt("sidebar", 9999, { sidebar: 300, viewport: 1680 });
    expect(editorWidthAt({
      viewport: 1680,
      sidebar: clamped,
      chat: 400,
      sidebarHidden: false,
      chatHidden: false,
    })).toBeGreaterThanOrEqual(EDITOR_MIN);
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

  /* U-06：821px 时聊天列占 315，正文只剩 160；620px 时只剩更窄的一条。自动布局
     只在窗口尺寸变化时收起栏，先聊天、后树，正文列留在台上。 */
  it("窄窗先让聊天列出去，正文列保住 320px", () => {
    expect(EDITOR_USABLE).toBe(320);
    const hidden = { sidebar: false, chat: false, editor: false };
    expect(fitHiddenAt({ viewport: 821, sidebar: 300, chat: 315, hidden })).toEqual({
      sidebar: false,
      chat: true,
      editor: false,
    });
    expect(editorWidthAt({
      viewport: 821,
      sidebar: 300,
      chat: 315,
      sidebarHidden: false,
      chatHidden: true,
    })).toBe(476);
  });

  it("620px 时聊天列还不够，树列也收起来；正文列不藏", () => {
    const hidden = { sidebar: false, chat: false, editor: false };
    expect(fitHiddenAt({ viewport: 620, sidebar: 300, chat: 114, hidden })).toEqual({
      sidebar: true,
      chat: true,
      editor: false,
    });
    expect(editorWidthAt({
      viewport: 620,
      sidebar: 300,
      chat: 114,
      sidebarHidden: true,
      chatHidden: true,
    })).toBe(576);
  });

  it("宽窗不擅自打开已经收起的栏，已经让位的编辑栏也不再折叠别的栏", () => {
    const wide = { viewport: 1440, sidebar: 300, chat: 471 };
    expect(fitHiddenAt({ ...wide, hidden: { sidebar: false, chat: false, editor: false } }))
      .toEqual({ sidebar: false, chat: false, editor: false });
    expect(fitHiddenAt({ ...wide, hidden: { sidebar: true, chat: true, editor: false } }))
      .toEqual({ sidebar: true, chat: true, editor: false });
    expect(fitHiddenAt({
      viewport: 500,
      sidebar: 300,
      chat: 114,
      hidden: { sidebar: true, chat: true, editor: true },
    })).toEqual({ sidebar: true, chat: true, editor: true });
    // 窗口窄到放不下 320 时也至少留一栏字：编辑栏不因为「不够宽」被自动藏掉
    expect(fitHiddenAt({
      viewport: 300,
      sidebar: 300,
      chat: 0,
      hidden: { sidebar: false, chat: false, editor: false },
    }).editor).toBe(false);
  });

});
