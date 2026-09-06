import { useLayoutEffect, useState, type RefObject } from "react";

import { toCssPx } from "./store/appearance";

/** 右键菜单离视口边缘留多少。 */
export const MENU_EDGE = 8;

export type MenuPoint = { x: number; y: number };

/**
 * 纯函数：给「点击点 + 菜单的自然尺寸 + 视口」（全部 CSS 像素），算出该画在哪。
 *
 * 第二十六批批注 5：「接近页面底部时弹窗会改变方位」这件事两处都没做 -
 * 树菜单只夹了 x，y 完全没管；书架菜单夹 y 用的是写死的 150px，
 * 而菜单现在六项约 230px，照样出界。所以定位只留这一份。
 */
export function placeMenu(
  point: MenuPoint,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number; maxHeight: number } {
  const left = Math.min(
    Math.max(MENU_EDGE, point.x),
    Math.max(MENU_EDGE, viewport.width - size.width - MENU_EDGE),
  );
  let top = point.y;
  if (top + size.height + MENU_EDGE > viewport.height) {
    // 先试朝上翻（底边贴点击点）；上面也放不下就贴下沿，剩下的交给 maxHeight 内部滚动
    const flipped = point.y - size.height;
    top = flipped >= MENU_EDGE ? flipped : Math.max(MENU_EDGE, viewport.height - size.height - MENU_EDGE);
  }
  // 最后一道兜底：点击点本身在视口之外（键盘打开时是从卡片 rect 推算的，
  // 或列表滚到一半）也不许把菜单画到屏外。真机就撞到过一次 y=1191 / 视口 924。
  const room = Math.max(0, viewport.height - MENU_EDGE * 2);
  top = Math.min(Math.max(MENU_EDGE, top), MENU_EDGE + Math.max(0, room - Math.min(size.height, room)));
  return { left, top, maxHeight: Math.max(0, viewport.height - top - MENU_EDGE) };
}

/**
 * 菜单必须先按点击点挂上屏、量到**真实高度**再定位 - 高度取决于这一回有几项，
 * 写死任何常量都会在加一项的那天失效。
 */
export function useMenuPlacement(
  ref: RefObject<HTMLElement | null>,
  point: MenuPoint | null,
  width: number,
) {
  const [box, setBox] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !point) {
      setBox(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const placed = placeMenu(
      { x: toCssPx(point.x), y: toCssPx(point.y) },
      // 宽度用声明值（CSS 像素），高度用实测（getBoundingClientRect 是视觉像素，要换算）
      { width: toCssPx(rect.width) || width, height: toCssPx(rect.height) },
      { width: toCssPx(window.innerWidth), height: toCssPx(window.innerHeight) },
    );
    setBox((prev) =>
      prev && prev.left === placed.left && prev.top === placed.top && prev.maxHeight === placed.maxHeight
        ? prev
        : placed,
    );
  }, [ref, point?.x, point?.y, width]);
  return box;
}
