import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BookshelfPage from "./BookshelfPage";
import { useWorkbench } from "../store/workbench";
import type { Novel } from "../types";

const shelf: Novel[] = [
  {
    id: 4,
    title: "演示测试",
    description: "东方玄幻 · 少年在星渊碑前重启沉睡的血脉。",
    target_chapters: 286,
    style_constraints: "",
    cover_image: "",
    chapter_count: 12,
    done_count: 3,
    total_words: 312450,
    last_edited_at: "2026-09-03T03:27:20",
  },
  {
    id: 2,
    title: "日向家的叛忍",
    description: "",
    target_chapters: 120,
    style_constraints: "",
    cover_image: "",
  },
];

function renderShelf() {
  return render(
    <MemoryRouter>
      <BookshelfPage />
    </MemoryRouter>,
  );
}

describe("BookshelfPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    useWorkbench.setState({ novels: shelf });
  });

  it("shows the totals the backend actually computed", () => {
    const { container } = renderShelf();
    const card = container.querySelector('.book-card[data-novel-id="4"]') as HTMLElement;
    expect(card).toBeTruthy();
    const stats = within(card).getByText("12 / 286 章");
    expect(stats).toBeTruthy();
    expect(within(card).getByText("31.2 万字")).toBeTruthy();
    expect(within(card).getByText("东方玄幻 · 少年在星渊碑前重启沉睡的血脉。")).toBeTruthy();
  });

  it("renders an em dash instead of inventing a number", () => {
    const { container } = renderShelf();
    const card = container.querySelector('.book-card[data-novel-id="2"]') as HTMLElement;
    // the figures are split across child spans, so match the row as a whole
    const stats = card.querySelector(".book-stats") as HTMLElement;
    expect(stats.textContent).toBe("—·—");
    expect((card.querySelector(".book-updated") as HTMLElement).textContent).toBe("最近编辑 —");
    expect(within(card).getByText("还没有简介，去蓝图里写一句。")).toBeTruthy();
  });

  it("drives the progress rail from done / target, never past 100%", () => {
    const { container } = renderShelf();
    const rail = container.querySelector('.book-card[data-novel-id="4"] .book-progress > span') as HTMLElement;
    expect(rail.style.width).toBe("1%");
    useWorkbench.setState({ novels: [{ ...shelf[0], done_count: 900 }] });
    const again = renderShelf();
    const clamped = again.container.querySelector(".book-progress > span") as HTMLElement;
    expect(clamped.style.width).toBe("100%");
  });

  it("ends the grid with a dashed create card and offers settings from the top bar", () => {
    const { container } = renderShelf();
    const cards = container.querySelectorAll(".book-card");
    expect(cards.length).toBe(3);
    expect(cards[cards.length - 1].className).toContain("book-new-card");
    expect(screen.getByRole("button", { name: "设置" })).toBeTruthy();
  });
});
