import { describe, expect, it } from "vitest";

/**
 * 不可回退闸门。
 *
 * 2026-09-05 凌晨，主人在浏览器里指出四处「你改回去了」：标签条的滚动条又占布局把
 * tab 压矮、关闭按钮到右边界的距离随文件名长短在 1 / 19 / 38px 之间跳、面包屑那一行
 * 比正文亮一档、目录页脚还挂着「共 6 章」。每一条都是他**以前点名定过**的。
 *
 * 文字规则拦不住遗忘——项目自己的 AGENTS.md 已经承认这点。所以这里把已定稿的界面
 * 决定写成断言：谁再把它改回去，`npm run test` 直接红，改不动也推不掉。
 *
 * 每条都注明是哪一轮批注定的，方便判「是主人改主意了」还是「助手忘了」。
 */
// Vite's ?raw imports, so the guard reads the same bytes the build ships and needs
// neither node APIs nor a working directory.
// A stylesheet cannot be read as a module here - vitest stubs both ?raw and ?inline
// for CSS - so the guard reads the file itself. Declared locally instead of pulling
// @types/node into a browser project for two lines.
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles.css", "utf8");
import treePane from "./components/TreePane.tsx?raw";
import chatPane from "./components/ChatPane.tsx?raw";
import editorPane from "./components/EditorPane.tsx?raw";
import fileEditor from "./components/FileEditorPane.tsx?raw";
import proposalCard from "./components/ProposalCard.tsx?raw";
import tocList from "./components/TocListView.tsx?raw";

/**
 * Every declaration block for a top-level selector, joined. A selector can appear
 * twice - .chat-messages has one rule for the grid row and one for the scroll
 * behaviour - and a guard that only reads the first of them passes by accident.
 */
function rule(sel: string): string {
  const needle = "\n" + sel + " {";
  let from = 0;
  let out = "";
  for (;;) {
    const at = css.indexOf(needle, from);
    if (at < 0) return out;
    out += css.slice(at, css.indexOf("}", at) + 1) + "\n";
    from = at + needle.length;
  }
}

describe("settled UI decisions must not regress", () => {
  it("the two tab strips never show a scrollbar that costs layout (第十轮批注6 / 第十二批批注3)", () => {
    // 第十四批: the strip is now the frame and the scroller is inside it, so the
    // no-bar rule lives on the scroller. Checked there rather than dropped.
    expect(rule(".file-tabs-scroll")).toContain("scrollbar-width: none");
    expect(rule(".editor-tabs-scroll")).toContain("scrollbar-width: none");
    // and the toggle must sit outside the scroller, or it scrolls out of sight
    expect(fileEditor).toMatch(/className="file-tabs"\>[\s\S]*file-tabs-scroll[\s\S]*<\/div>\s*\{\/\*|[\s\S]*file-tabs-actions/);
    // A reserved horizontal track is what shrank the 40px strip's tabs to 30px.
    expect(css).not.toMatch(/\.file-tabs::-webkit-scrollbar/);
    expect(css).toMatch(/\.h-scroll \{[\s\S]*?position: absolute/);
    expect(css).not.toMatch(/\.editor-tabs::-webkit-scrollbar/);
    expect(css).not.toMatch(/\.file-tabs:hover \{[^}]*scrollbar-width/);
  });

  it("the thread's bar fades without moving the page (第十二批批注2.1)", () => {
    expect(rule(".chat-messages")).toContain("scrollbar-gutter: stable both-edges");
    expect(css).toMatch(/\.chat-messages:hover::-webkit-scrollbar-thumb/);
  });

  it("a tab's close button keeps ONE distance from the right edge (第十二批批注3)", () => {
    // The label has to take the slack, or the gap tracks the length of the name.
    expect(css).toMatch(
      /\.file-tab > button:not\(\.file-tab-close\) \{[\s\S]*?flex: 1 1 auto;/,
    );
  });

  it("every editor surface is the prose's black (第十批批注6 / 第十二批批注2)", () => {
    for (const sel of [".file-editor", ".file-code", ".file-bar", ".editor-toolbar", ".editor-body", ".minimap"]) {
      expect(rule(sel), sel + " colour").toContain("background: var(--bg)");
    }
  });

  it("the rendered directory covers its body exactly (第十二批批注1)", () => {
    expect(rule(".toc-list-overlay")).toContain("inset: 0");
    expect(css).not.toMatch(/inset: 70px/);
    expect(rule(".file-body")).toContain("position: relative");
    // and it lives inside .file-body, not beside it
    expect(fileEditor.indexOf("toc-list-overlay")).toBeGreaterThan(fileEditor.indexOf('className="file-body"'));
  });

  it("no page prints a count of things nobody asked to count (第十轮批注2 / 第十二批批注4)", () => {
    expect(treePane).not.toContain("tree-page-count");
    expect(css).not.toContain(".tree-page-count");
    expect(tocList).not.toMatch(/共 \$\{/);
    expect(tocList).not.toContain("toc-foot");
    expect(css).not.toContain(".toc-foot");
    // 42 is 42: no lock glyph in the chapter-number cell
    expect(tocList).not.toContain("toc-lock");
    expect(tocList).not.toMatch(/<Lock/);
  });

  it("the file bar says nothing except a failed write (第十二批批注2)", () => {
    expect(fileEditor).not.toContain("保存已锁定");
    expect(fileEditor).not.toContain("处提案待应用 ·");
    expect(css).not.toContain(".file-foot");
  });

  it("the answer has no box, no avatar and no header row (第十轮批注3、4)", () => {
    expect(rule(".chat-card.agent")).toContain("border: 0");
    expect(rule(".chat-card.agent")).toContain("background: none");
    expect(chatPane).not.toContain("chat-avatar");
    expect(chatPane).not.toContain("chat-card-head");
    expect(css).not.toMatch(/^\.chat-avatar \{/m);
  });

  it("the trace folds, and every answer ends with the same quiet row (主请求 / 第十轮批注5)", () => {
    expect(chatPane).toContain("chat-trace");
    expect(chatPane).toContain("splitTrace");
    expect(chatPane).toContain("chat-actions");
  });

  it("actions are marks, not sentences (第十一轮批注4、5、6)", () => {
    expect(proposalCard).not.toContain("proposal-note");
    for (const name of ["在编辑器中打开", "丢弃提案", "应用提案"]) {
      expect(proposalCard, name).toContain(name);
    }
    // and the owner asked twice for no orange block on apply
    expect(rule(".proposal-btn.apply")).not.toContain("background: var(--accent)");
    expect(rule(".proposal-btn.apply")).not.toContain("border: 1px solid var(--accent)");
  });

  it("the chapter tab carries one dot, not two (第十二批批注1)", () => {
    expect(editorPane).not.toContain("StatusBadge");
  });

  it("turns are separated by more than twice the old gap (第十三批批注5、7)", () => {
    expect(css).toMatch(/\.chat-row\.user \+ \.chat-row\.assistant,[\s\S]*?margin-top: 40px/);
  });

  it("unsaved is one filled dot, said the same way in the tree and the tab (第十四批批注6)", () => {
    // It used to be a ring, and the tree never showed it at all.
    expect(rule(".dirty-dot")).toContain("background: var(--accent)");
    expect(rule(".dirty-dot")).not.toMatch(/border: .*var\(--accent\)/);
    // the tree reads the same buffer the tab reads, and subscribes to it
    expect(treePane).toContain("chapterDrafts");
    expect(treePane).toContain("未保存");
  });

  it("focus never paints the brand colour on a control (第六轮批注16 / 第十一批批注2 / 第十四批批注5)", () => {
    // Three times raised, because each time one element was fixed instead of the
    // class. The rule is now mechanical: any rule that reacts to :focus may not use
    // --accent for a frame, a ring or a fill. The text caret is the one allowed
    // exception - it is the writing cursor, not a border, and it is 2px wide.
    const offenders: string[] = [];
    for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const sel = match[1].trim();
      const body = match[2];
      if (!sel.includes("focus")) continue;
      const painted = body
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d.startsWith("outline") || d.startsWith("border-color") || d.startsWith("box-shadow") || d.startsWith("background"))
        .filter((d) => d.includes("var(--accent"));
      if (painted.length) offenders.push(sel.replace(/\s+/g, " ") + " -> " + painted.join(" / "));
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the dark theme stays at the owner's measured grey (第十轮批注1)", () => {
    expect(css).toMatch(/\[data-theme="dark"\][\s\S]*?--surface-alt: #191a1b;/);
    expect(css).toMatch(/--surface: #1f2023;/);
  });
});
