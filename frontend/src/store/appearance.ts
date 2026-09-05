import { create } from "zustand";

/* 外观（第十九批批注 19.3）。
 *
 * 这是**这台机器的偏好**，不是这本书的配置：存 localStorage，不进 app_config。
 * 理由是 D-16 反过来用 - 服务端配置是「这本书要怎么生成」，换一台机器应当跟着走；
 * 而主题、色系、字体是「这个人要用什么眼睛看」，跟着人走、不跟着书走，
 * 也不该为一组卡片开一条读写口。裁定记在 DECISIONS D-21。
 *
 * 一个事实一个写者：html 上那四个 data-* 属性只由 applyAppearance() 写。
 * workbench 的 init() 以前也写 data-theme，那正是第十五批 3.3 那一类两个写者互相
 * 覆盖的病，所以这一轮把 theme 从 workbench 整个搬走了。
 */

export type ThemeChoice = "system" | "light" | "dark";
export type AccentChoice = "vermilion" | "blue";
export type CodeChoice = "default" | "graphite";
export type ProseChoice = "serif" | "sans";

export type Appearance = {
  theme: ThemeChoice;
  accent: AccentChoice;
  code: CodeChoice;
  prose: ProseChoice;
};

export const APPEARANCE_DEFAULTS: Appearance = {
  theme: "system",
  accent: "vermilion",
  code: "default",
  prose: "serif",
};

const KEY = "appearance";
/** What this app stored when light and dark were the only two options: a bare
 *  "light" / "dark" string under its own key. A returning reader keeps their pick. */
const LEGACY_THEME_KEY = "theme";

const THEMES = ["system", "light", "dark"] as const;
const ACCENTS = ["vermilion", "blue"] as const;
const CODES = ["default", "graphite"] as const;
const PROSES = ["serif", "sans"] as const;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** The machine's own ask. Guarded because jsdom has matchMedia but not always a
 *  MediaQueryList that can report a change. */
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
  return {
    theme: oneOf(
      raw.theme,
      THEMES,
      oneOf(legacy, ["light", "dark"] as const, APPEARANCE_DEFAULTS.theme),
    ),
    accent: oneOf(raw.accent, ACCENTS, APPEARANCE_DEFAULTS.accent),
    code: oneOf(raw.code, CODES, APPEARANCE_DEFAULTS.code),
    prose: oneOf(raw.prose, PROSES, APPEARANCE_DEFAULTS.prose),
  };
}

export function writeAppearance(next: Appearance): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* A private window that refuses storage still gets the choice for this visit. */
  }
}

/** The only writer for the four attributes the stylesheet switches on. */
export function applyAppearance(next: Appearance): void {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(next.theme);
  root.dataset.accent = next.accent;
  root.dataset.code = next.code;
  root.dataset.prose = next.prose;
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
      prose: current.prose,
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
