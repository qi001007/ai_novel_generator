import { beforeEach, describe, expect, it } from "vitest";

import {
  APPEARANCE_DEFAULTS,
  applyAppearance,
  readAppearance,
  resolveTheme,
  useAppearance,
} from "./appearance";

/* 第十九批批注 3: appearance became a real set of switches. These four attributes are
 * the whole contract between the store and the stylesheet - whatever the cards show,
 * it is these the CSS switches on. */

beforeEach(() => {
  localStorage.clear();
  applyAppearance(APPEARANCE_DEFAULTS);
});

describe("appearance store", () => {
  it("resolves 系统 to one of the two looks the CSS knows", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    // an explicit pick is never second-guessed by the machine
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("carries an old light/dark choice across instead of dropping it", () => {
    localStorage.setItem("theme", "dark");
    expect(readAppearance().theme).toBe("dark");
    localStorage.setItem("theme", "light");
    expect(readAppearance().theme).toBe("light");
    // nobody ever chose: the new default follows the machine
    localStorage.clear();
    expect(readAppearance().theme).toBe("system");
  });

  it("falls back to the default for a value the app does not have", () => {
    localStorage.setItem("appearance", JSON.stringify({ accent: "chartreuse", theme: 7 }));
    const read = readAppearance();
    expect(read.accent).toBe(APPEARANCE_DEFAULTS.accent);
    expect(read.theme).toBe(APPEARANCE_DEFAULTS.theme);
    localStorage.setItem("appearance", "not json");
    expect(readAppearance()).toEqual(APPEARANCE_DEFAULTS);
  });

  it("writes exactly the four attributes the stylesheet switches on", () => {
    applyAppearance({ theme: "dark", accent: "blue", code: "graphite", prose: "sans" });
    const { dataset } = document.documentElement;
    expect(dataset.theme).toBe("dark");
    expect(dataset.accent).toBe("blue");
    expect(dataset.code).toBe("graphite");
    expect(dataset.prose).toBe("sans");
  });

  it("persists a pick and applies it in the same breath", () => {
    useAppearance.getState().pick({ accent: "blue" });
    expect(JSON.parse(localStorage.getItem("appearance") ?? "{}")).toMatchObject({ accent: "blue" });
    expect(document.documentElement.dataset.accent).toBe("blue");
    // and reading it back is what a reload does
    expect(readAppearance().accent).toBe("blue");
  });
});
