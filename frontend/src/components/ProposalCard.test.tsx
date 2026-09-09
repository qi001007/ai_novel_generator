import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ProposalCard from "./ProposalCard";
import type { FileProposal } from "../types";

/**
 * 2026-09-09 批注 1、2：卡片是提案唯一的读写门面，所以这两条钉在这里，而不是
 * 绕一圈走 ChatPane。
 * MAX_ROWS is 8 in the component; twelve rewritten lines make twenty-four rows,
 * which is the smallest fixture that can show the collapse control at all.
 */
const CHANGED = 12;
const baseLines = ["# 全书蓝图", "", "## 主线"].concat(
  Array.from({ length: CHANGED }, (_, index) => `旧 ${index + 1}`),
);
const offerLines = ["# 全书蓝图", "", "## 主线"].concat(
  Array.from({ length: CHANGED }, (_, index) => `新 ${index + 1}`),
);
const BASE_TEXT = baseLines.join("\n");
const OFFER_TEXT = offerLines.join("\n");
const TOTAL_ROWS = CHANGED * 2;

const proposal = (over: Partial<FileProposal> = {}): FileProposal => ({
  id: 1,
  path: "blueprint.md",
  text: OFFER_TEXT,
  valid: true,
  error: "",
  baseText: BASE_TEXT,
  baseRevision: "rev-1",
  ...over,
});

function renderCard(over: Partial<FileProposal> = {}) {
  const onApply = vi.fn();
  render(
    <ProposalCard
      proposal={proposal(over)}
      applying={false}
      onOpen={vi.fn()}
      onApply={onApply}
      onDiscard={vi.fn()}
    />,
  );
  return { onApply };
}

describe("ProposalCard", () => {
  it("opens the whole diff and closes it again", () => {
    renderCard();

    expect(document.querySelectorAll(".proposal-line")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: `展开全部 ${TOTAL_ROWS} 行改动` }));

    expect(document.querySelectorAll(".proposal-line")).toHaveLength(TOTAL_ROWS);
    const collapse = screen.getByRole("button", { name: "收起" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");

    // 批注 1: the control used to call setShowAll(true) and then disappear, so this
    // second click is the whole complaint - the card was stuck open.
    fireEvent.click(collapse);
    expect(document.querySelectorAll(".proposal-line")).toHaveLength(8);
    expect(screen.getByRole("button", { name: `展开全部 ${TOTAL_ROWS} 行改动` })).toBeTruthy();
  });

  it("keeps the same two-way control on a rejected proposal", () => {
    renderCard({ valid: false, error: "第 4 行缺少「章节号」" });

    expect(document.querySelector(".proposal-invalid-preview")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `展开全部 ${TOTAL_ROWS} 行改动` }));
    expect(document.querySelectorAll(".proposal-line")).toHaveLength(TOTAL_ROWS);
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(document.querySelectorAll(".proposal-line")).toHaveLength(8);
  });

  it("disables 应用 for an invalid proposal and says why", () => {
    const { onApply } = renderCard({ valid: false, error: "第 4 行缺少「章节号」" });

    const apply = screen.getByRole("button", { name: /^不可应用/ }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(apply.getAttribute("aria-label")).toContain("第 4 行缺少「章节号」");
    expect(apply.title).toContain("第 4 行缺少「章节号」");
    expect(document.querySelector(".proposal-error")?.textContent).toContain("第 4 行缺少「章节号」");

    // 批注 2: a click must not reach the writer, so no red line after the fact.
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("still offers 应用 for a proposal the server accepted", () => {
    const { onApply } = renderCard();

    const apply = screen.getByRole("button", { name: "应用提案" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});