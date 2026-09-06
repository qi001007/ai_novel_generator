import { describe, expect, it } from "vitest";

import { MENU_EDGE, placeMenu } from "./menuPlacement";

const VIEW = { width: 1280, height: 800 };
const MENU = { width: 232, height: 230 };

describe("placeMenu（第二十六批批注 5：两处菜单共用的一套定位）", () => {
  it("屏前放得下就照点击点画", () => {
    expect(placeMenu({ x: 300, y: 200 }, MENU, VIEW)).toEqual({ left: 300, top: 200, maxHeight: 592 });
  });

  it("接近底部时朝上翻：底边贴点击点，不再被裁", () => {
    const box = placeMenu({ x: 300, y: 700 }, MENU, VIEW);
    expect(box.top).toBe(700 - MENU.height);
    expect(box.top + MENU.height + MENU_EDGE).toBeLessThanOrEqual(VIEW.height);
  });

  it("上下都放不下时贴下沿并交出 maxHeight（内部滚动，而不是消失）", () => {
    const tall = { width: 232, height: 900 };
    const box = placeMenu({ x: 300, y: 780 }, tall, VIEW);
    expect(box.top).toBe(MENU_EDGE);
    expect(box.maxHeight).toBe(VIEW.height - MENU_EDGE * 2);
  });

  it("点击点本身在视口外（键盘打开、或列表滚到一半）也不许画到屏外", () => {
    const box = placeMenu({ x: 80, y: 1191 }, MENU, VIEW);
    expect(box.top).toBeGreaterThanOrEqual(MENU_EDGE);
    expect(box.top + Math.min(MENU.height, box.maxHeight)).toBeLessThanOrEqual(VIEW.height);
  });

  it("菜单比整屏还高时贴顶并交出 maxHeight（内部滚动，不是消失）", () => {
    const box = placeMenu({ x: 80, y: 400 }, { width: 232, height: 1400 }, VIEW);
    expect(box.top).toBe(MENU_EDGE);
    expect(box.maxHeight).toBe(VIEW.height - MENU_EDGE * 2);
  });

  it("右侧越界时夹回来，菜单永远整块在视口里", () => {
    const box = placeMenu({ x: 1270, y: 100 }, MENU, VIEW);
    expect(box.left + MENU.width + MENU_EDGE).toBeLessThanOrEqual(VIEW.width);
  });
});
