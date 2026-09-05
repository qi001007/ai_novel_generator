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
import workbenchStore from "./store/workbench.ts?raw";
import fileEditor from "./components/FileEditorPane.tsx?raw";
import layout from "./pages/WorkbenchPage.tsx?raw";
import filesStore from "./store/files.ts?raw";
import cardView from "./components/CharacterDocCard.tsx?raw";
import proposalCard from "./components/ProposalCard.tsx?raw";
import tocList from "./components/TocListView.tsx?raw";
import viewToggle from "./components/ViewToggle.tsx?raw";

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

  it("a character file renders as the card, not as typeset markdown (第十五批批注 3.1)", () => {
    // The owner named the path: opening settings/characters/6.md and pressing the
    // button has to show the card. A .file-rendered overlay of the same bytes is
    // what it used to be, and that is still "a file", not the thing the file is for.
    expect(cardView).toContain("character-doc");
    expect(fileEditor).toContain("character-doc-overlay");
    expect(fileEditor).toContain("isCharacterDoc");
    // one label function decides what the button offers, for every kind
    expect(filesStore).toContain('return "人物卡片"');
    // and the card covers its own body the way the directory list does - inset: 0,
    // never a guessed pixel offset that leaves a seam
    expect(rule(".character-doc-overlay")).toContain("inset: 0");
    expect(css).not.toMatch(/\.character-doc-overlay \{[^}]*inset: [0-9]+px/);
  });

  it("no resizable column may paint over its neighbour, and the toolbar wraps (第十五批批注 2.1)", () => {
    // Every pane inside a dragged column has to be bounded, or a grid item's
    // content-sized minimum spills into the next column. Measured: the thread was
    // 328px wide in a 214px column and covered two editor actions, which then
    // answered elementFromPoint as div.chat-messages - a control that is there but
    // cannot be clicked is worse than a missing one.
    for (const sel of [".editor-pane", ".chat-pane", ".chat-messages", ".chat-dock", ".file-editor"]) {
      expect(rule(sel), sel + " must stay in its own track").toContain("min-width: 0");
    }
    // The prose column's own floor lives in the layout, not in a hopeful CSS value:
    // below it the column is closed rather than clipped.
    expect(layout).toContain("const EDITOR_MIN = 160");
    expect(layout).toContain("min(pane === \"sidebar\" ? SIDEBAR_MIN : CHAT_MIN, max)");
    // and the actions stay reachable by wrapping instead of being pushed out
    expect(rule(".editor-toolbar")).toContain("flex-wrap: wrap");
    expect(rule(".editor-actions")).toContain("flex-wrap: wrap");
  });

  it("the two tab strips shrink and stop at the same two numbers (第十五批批注 1.1、1.2)", () => {
    // The floor and the ceiling are what decide when a strip overflows, and the
    // owner asked for the chapter strip to behave like the file strip - not for a
    // second thumb on a strip that can never overflow.
    for (const sel of [".editor-tab", ".file-tab"]) {
      expect(rule(sel), sel + " floor").toMatch(/min-width: 5\.5rem/);
      expect(rule(sel), sel + " ceiling").toMatch(/max-width: 15rem/);
      expect(rule(sel), sel + " shrink").toMatch(/flex: 0 1 auto/);
    }
    // And the real cause of "the wheel does nothing": the editor pane is a grid
    // item, so without a bounded column the strip grew to 938px inside a 768px
    // column and its scroller never had anything to scroll.
    expect(rule(".editor-pane")).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(rule(".editor-pane")).toContain("min-width: 0");
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
    // not 70px, and not the 112px that a media query used to bring back either
    expect(css).not.toMatch(/\.toc-list-overlay \{[^}]*inset: [0-9]+px/);
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
    // 第十四批批注 2: the toggle is for every document, and its state is one map
    expect(fileEditor).not.toContain("RENDERED_PATHS");
    expect(fileEditor).toContain("file-rendered");
    expect(css).toMatch(/\.file-rendered \{[\s\S]*?inset: 0;/);
    // 批注 3.3: there is one draft buffer, the draft.md file entry, so a second
    // private copy in the workbench store is exactly what must never come back.
    expect(treePane).toContain("useFiles");
    expect(treePane).toContain("draftPath");
    expect(workbenchStore).not.toContain("chapterDrafts");
    expect(workbenchStore).not.toContain("draftSaved");
    expect(editorPane).toContain("chapterDraftPath");
    expect(treePane).toContain("未保存");
  });

  it("focus paints no frame anywhere - the whole class (第六轮批注16 / 第十一批批注2 / 第十四批批注5 / 第十五批批注4.2)", () => {
    // Raised four times, and the last three because one element got fixed while the
    // class stayed. So the gate reads the class: any rule that reacts to focus may not
    //   (a) draw an outline (only none / 0),
    //   (b) paint a `0 0 0 Npx` halo, whatever colour,
    //   (c) use the brand colour for a frame, ring, fill or text,
    //   (d) lift a border to anything except --border-strong.
    // The one brand colour left is the text caret - it is the writing cursor, not a
    // border, and it is what the owner asked to keep when he asked for the rest to go.
    // Comments are stripped first: a note that mentions :focus must not be read as the
    // selector of the rule sitting under it.
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const offenders: string[] = [];
    for (const match of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = match[1].trim().replace(/\s+/g, " ");
      if (!sel.includes("focus")) continue;
      for (const raw of match[2].split(";")) {
        const d = raw.trim();
        if (!d.includes(":")) continue;
        const prop = d.slice(0, d.indexOf(":")).trim();
        const value = d.slice(d.indexOf(":") + 1).trim();
        if (prop === "outline") {
          if (value !== "none" && value !== "0") offenders.push(sel + " -> " + d);
        } else if (prop === "box-shadow") {
          if (value.includes("0 0 0")) offenders.push(sel + " -> " + d);
        } else if (prop === "border-color") {
          if (value !== "transparent" && !value.includes("var(--border-strong)"))
            offenders.push(sel + " -> " + d);
        } else if (prop === "border" || prop === "background" || prop === "color") {
          if (value.includes("var(--accent")) offenders.push(sel + " -> " + d);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
    // A ring can also arrive from a dependency's own stylesheet. CodeMirror's base
    // theme paints `.cm-focused { outline: 1px dotted #212121 }`, which this file has
    // to out-specify; if that override is ever dropped the ring comes back silently.
    expect(css).toMatch(/\.file-cm \.cm-editor\.cm-focused\s*\{\s*outline: 0;/);
  });

  it("the prose page says focus with a caret and nothing else (第十五批批注4.1)", () => {
    // The owner asked for the frame around the writing surface to go. Round fourteen I
    // recoloured it from accent to --text-2 and called that fixed - the same frame in
    // a different grey. So the container rule must not come back at all, and the
    // surface keeps its see-through 1px border the same before and after the click.
    expect(css).not.toMatch(/\.editor-body:focus-within\s+\.editor-scroll/);
    expect(css).toMatch(/\.editor-scroll\s*\{[^}]*border: 1px solid transparent;/);
    const body = rule(".editor-body textarea:focus-visible");
    expect(body).toContain("outline: 0");
    expect(body).toContain("caret-color: var(--accent)");
    expect(body).not.toMatch(/border|box-shadow/);
  });

  it("one document, one toggle, on every strip that holds it (第十五批批注 1.3、1.4、3.4)", () => {
    // The chapter strip used to have no button at all, so the prose page was a dead
    // end; and a private useState in either pane would put the pair back to two.
    expect(editorPane).toContain("editor-tabs-actions");
    // 第十六批批注 2 moved the button into one shared component; the decision it pins
    // is unchanged - both strips show it, neither owns a copy of the state.
    expect(editorPane).toContain("<ViewToggle");
    expect(fileEditor).toContain("<ViewToggle");
    expect(viewToggle).toContain("toggleViewLabel");
    expect(viewToggle).toContain("isSourceView");
    // and neither side hardcodes the words, or the two strips describe one action
    // in two vocabularies (the file strip used to say 渲染视图, the owner asked 正文)
    // (the minimap keeps a `view` state of its own - that is a scroll ratio, not a
    // second opinion about which side of the pair is showing, so match by name)
    expect(editorPane).not.toMatch(/const \[(source|raw|render|markdown)View, set/);
    expect(fileEditor).not.toMatch(/const \[(source|raw|render|markdown)View, set/);
    expect(fileEditor).not.toContain('"切到渲染视图"');
    expect(fileEditor).not.toContain('"切到列表视图"');
    // the map, not a per-component copy, is the state
    expect(filesStore).toContain("views: Record<string, boolean>");
    expect(filesStore).toContain("export const isSourceView");
  });

  it("the toggle is one component, and its icon names the surface you are on (第十六批批注 2)", () => {
    // The owner accepted the switching but said the button was 反过来: the book is the
    // reading surface, so the book belongs on the reading surface - not on the strip
    // that is about to leave it. Two strips drawing the same pair by hand is also how
    // they drifted once already, so the button is now one component both of them use.
    expect(editorPane).toContain("<ViewToggle");
    expect(fileEditor).toContain("<ViewToggle");
    expect(viewToggle).toContain("{source ? <FileCode2 size={14} /> : <BookOpen size={14} />}");
    // the label still names the destination, or "切到源码视图" would describe the past
    expect(viewToggle).toContain("toggleViewLabel(path, views)");
    expect(viewToggle).toContain("aria-pressed={source}");
    // and neither strip may grow its own copy of the icon decision again
    expect(editorPane).not.toMatch(/sourceShown \? <BookOpen/);
    expect(fileEditor).not.toMatch(/sourceView \? <BookOpen/);
  });

  it("the dark theme stays at the owner's measured grey (第十轮批注1)", () => {
    expect(css).toMatch(/\[data-theme="dark"\][\s\S]*?--surface-alt: #191a1b;/);
    expect(css).toMatch(/--surface: #1f2023;/);
  });
});
