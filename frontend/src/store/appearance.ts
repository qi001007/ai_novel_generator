import { create } from "zustand";

/* 外观（第十九批 19.3 立项，第二十批 20.4 加字号与字体）。
 *
 * 这是**这台机器的偏好**，不是这本书的配置：存 localStorage，不进 app_config。
 * 理由见 D-21。一个事实一个写者：html 上那几个属性与两个尺寸变量只由
 * applyAppearance() 写。
 *
 * 字体栈一概不在这里 - 它们在 styles.css 的 [data-*-font=...] 块里。
 * 这里只存 key。组件里再抄一份栈，切换就会有一半的地方不生效。
 */

export type ThemeChoice = "system" | "light" | "dark";
export type AccentChoice = "vermilion" | "blue";
export type CodeChoice = "default" | "graphite";

export type FontOption<T extends string = string> = { key: T; label: string };

export const UI_FONTS = [
  { key: "default", label: "默认（思源黑体）" },
  { key: "system", label: "跟随系统（英文优先）" },
  { key: "inter", label: "Inter" },
  { key: "arial", label: "Arial" },
  { key: "hei", label: "微软雅黑" },
] as const;

export const PROSE_FONTS = [
  { key: "default", label: "默认（思源宋体）" },
  { key: "georgia", label: "Georgia（英文衬线优先）" },
  { key: "times", label: "Times New Roman" },
  { key: "simsun", label: "宋体 SimSun" },
  { key: "hei", label: "黑体（无衬线）" },
] as const;

export const CODE_FONTS = [
  { key: "default", label: "默认（JetBrains Mono）" },
  { key: "system", label: "系统等宽" },
  { key: "cascadia", label: "Cascadia Code" },
  { key: "consolas", label: "Consolas" },
] as const;

export type UiFontChoice = (typeof UI_FONTS)[number]["key"];
export type ProseFontChoice = (typeof PROSE_FONTS)[number]["key"];
export type CodeFontChoice = (typeof CODE_FONTS)[number]["key"];

/* 校验读的是 key 清单，不是那两张带标签的表 - 表会为了界面措辞而改，
   key 不会。 */
const UI_FONT_KEYS = UI_FONTS.map((font) => font.key) as readonly UiFontChoice[];
const PROSE_FONT_KEYS = PROSE_FONTS.map((font) => font.key) as readonly ProseFontChoice[];
const CODE_FONT_KEYS = CODE_FONTS.map((font) => font.key) as readonly CodeFontChoice[];

/* 界面字号不是一条 font-size，而是 #root 的 zoom 因子：全站几百条字号是写死的，
   逐条改 em 不现实。默认 14 就是它自己 - 滑杆上写 px，落到 CSS 是倍数。 */
export const UI_SIZE_DEFAULT = 14;
/* 下限不是凑的：缩到 12 时命中区审计量出三处 23px（章标签的关闭钮、两处「详情」），
   低于 §0.4 的 24px 地板线；13 那一档只剩一条本来就靠拖拽线豁免的细线。 */
export const UI_SIZE = { min: 13, max: 17, step: 1 };
export const PROSE_SIZE = { min: 15, max: 21, step: 1 };

export type Appearance = {
  theme: ThemeChoice;
  accent: AccentChoice;
  code: CodeChoice;
  uiFont: UiFontChoice;
  proseFont: ProseFontChoice;
  codeFont: CodeFontChoice;
  uiSize: number;
  proseSize: number;
};

export const APPEARANCE_DEFAULTS: Appearance = {
  theme: "system",
  accent: "vermilion",
  code: "default",
  uiFont: "default",
  proseFont: "default",
  codeFont: "default",
  uiSize: UI_SIZE_DEFAULT,
  proseSize: 17,
};

const KEY = "appearance";
/** What this app stored when light and dark were the only two options: a bare
 *  "light" / "dark" string under its own key. A returning reader keeps their pick. */
const LEGACY_THEME_KEY = "theme";

const THEMES = ["system", "light", "dark"] as const;
const ACCENTS = ["vermilion", "blue"] as const;
const CODES = ["default", "graphite"] as const;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function oneSize(value: unknown, fallback: number, range: { min: number; max: number }): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(n)));
}

export function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** What a theme choice paints right now. 系统 is not a third look: it is whichever
 *  of the two the machine is asking for, so everything downstream still sees light
 *  or dark and no CSS rule has to know about the third option. */
export function resolveTheme(theme: ThemeChoice, dark = prefersDark()): "light" | "dark" {
  return theme === "system" ? (dark ? "dark" : "light") : theme;
}

export function readAppearance(): Appearance {
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    stored = null;
  }
  const raw = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const legacy = localStorage.getItem(LEGACY_THEME_KEY);
  // 19.3 stored the prose face as prose: "serif" | "sans"; 20.4 turned it into a key
  // into PROSE_FONTS. Same decision, new name - a returning reader must not lose it.
  const legacyProse = raw.prose === "sans" ? "hei" : raw.prose === "serif" ? "default" : undefined;
  return {
    theme: oneOf(
      raw.theme,
      THEMES,
      oneOf(legacy, ["light", "dark"] as const, APPEARANCE_DEFAULTS.theme),
    ),
    accent: oneOf(raw.accent, ACCENTS, APPEARANCE_DEFAULTS.accent),
    code: oneOf(raw.code, CODES, APPEARANCE_DEFAULTS.code),
    uiFont: oneOf(raw.uiFont, UI_FONT_KEYS, APPEARANCE_DEFAULTS.uiFont),
    proseFont: oneOf(
      raw.proseFont ?? legacyProse,
      PROSE_FONT_KEYS,
      APPEARANCE_DEFAULTS.proseFont,
    ),
    codeFont: oneOf(raw.codeFont, CODE_FONT_KEYS, APPEARANCE_DEFAULTS.codeFont),
    uiSize: oneSize(raw.uiSize, UI_SIZE_DEFAULT, UI_SIZE),
    proseSize: oneSize(raw.proseSize, APPEARANCE_DEFAULTS.proseSize, PROSE_SIZE),
  };
}

export function writeAppearance(next: Appearance): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* A private window that refuses storage still gets the choice for this visit. */
  }
}

/** The only writer for the attributes and the two size variables the stylesheet
 *  switches on. Canvas takes no var(), so whoever paints one reads them back. */
export function applyAppearance(next: Appearance): void {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(next.theme);
  root.dataset.accent = next.accent;
  root.dataset.code = next.code;
  root.dataset.uiFont = next.uiFont;
  root.dataset.proseFont = next.proseFont;
  root.dataset.codeFont = next.codeFont;
  root.style.setProperty("--ui-zoom", String(next.uiSize / UI_SIZE_DEFAULT));
  root.style.setProperty("--prose-size", next.proseSize + "px");
}

/** How many visual pixels one CSS pixel is worth right now. The zoom sits on #root,
 *  so getBoundingClientRect, clientX/clientY and elementFromPoint all speak visual
 *  pixels while everything a component writes into style or keeps in state is CSS
 *  pixels. Measured: at 1.25 the 48px topbar reports a rect height of 60. */
export function uiZoom(next?: Appearance): number {
  const size = (next ?? useAppearance.getState()).uiSize;
  return size / UI_SIZE_DEFAULT;
}

/** The one conversion every pointer coordinate and pointer delta has to go through.
 *  Skip it and a 100px drag moves a pane 80px at 1.25. */
export function toCssPx(visualPx: number, zoom = uiZoom()): number {
  return visualPx / zoom;
}

const initial = readAppearance();
// Before the first paint, so a reload does not flash the wrong theme first.
applyAppearance(initial);

type AppearanceState = Appearance & {
  pick: (patch: Partial<Appearance>) => void;
  /** Re-apply when the machine changes its own light/dark setting. */
  followSystem: () => void;
};

export const useAppearance = create<AppearanceState>((set, get) => ({
  ...initial,
  pick(patch) {
    const current = get();
    const next: Appearance = {
      theme: current.theme,
      accent: current.accent,
      code: current.code,
      uiFont: current.uiFont,
      proseFont: current.proseFont,
      codeFont: current.codeFont,
      uiSize: current.uiSize,
      proseSize: current.proseSize,
      ...patch,
    };
    writeAppearance(next);
    applyAppearance(next);
    set(next);
  },
  followSystem() {
    applyAppearance(get());
  },
}));

/** Canvas takes no var(): whoever paints the minimap asks the stylesheet instead. */
export function tokenValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
