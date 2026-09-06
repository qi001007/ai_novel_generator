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
import characterFormCard from "./components/CharacterFormCard.tsx?raw";
import characterDocForm from "./components/CharacterDocForm.tsx?raw";
import proposalCard from "./components/ProposalCard.tsx?raw";
import chatTypes from "./types.ts?raw";
import tocList from "./components/TocListView.tsx?raw";
import viewToggle from "./components/ViewToggle.tsx?raw";
import characterLibrary from "./components/CharacterLibrary.tsx?raw";
import foreshadowWall from "./components/ForeshadowWall.tsx?raw";
import worldMapPanel from "./components/WorldMapPanel.tsx?raw";
import runDetailPage from "./pages/GenerationRunDetailPage.tsx?raw";
import preferences from "./pages/PreferencesPage.tsx?raw";
import appearanceStore from "./store/appearance.ts?raw";
import appSource from "./App.tsx?raw";
import hScrollThumb from "./components/HScrollThumb.tsx?raw";
import workPage from "./pages/WorkbenchPage.tsx?raw";
import bookshelf from "./pages/BookshelfPage.tsx?raw";

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

  it("a character file renders as THE card - the editable one (第十五批批注 3.1 + 第十六批批注 7)", () => {
    // 3.1 said "not typeset markdown"; the owner then pointed out that what I shipped
    // was a second, read-only card: 「你没有必要在这里重新做一个，直接复用那个卡片」. So the
    // rendered view is the dialog's own card, and there is exactly one of it.
    expect(fileEditor).toContain("character-doc-overlay");
    expect(fileEditor).toContain("<CharacterDocForm");
    expect(fileEditor).toContain("isCharacterDoc");
    expect(characterDocForm).toContain("<CharacterFormCard");
    // the card really is the editable one: fields as controls, and the photo control
    expect(characterFormCard).toContain('label>\n            姓名');
    expect(characterFormCard).toContain("更换照片");
    expect(characterFormCard).toContain("贴照片");
    // and it writes the projection in place, through the one file writer
    expect(characterFormCard).toContain("export function fillCharacterDoc");
    expect(characterDocForm).toContain("saveFile(path)");
    // the read-only copy must not come back alongside it
    expect(fileEditor).not.toContain("CharacterDocCard");
    expect(css).not.toMatch(/\.character-doc \{/);
    expect(css).not.toMatch(/\.character-doc-fields/);
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
    // 第十六批批注 8 retired the generic overlay: a document whose "rendered" side is
    // the same characters with bold applied is not a second view. The decision these
    // lines pinned - an overlay covers its own body, never a magic offset - is now
    // carried by the two overlays that remain, asserted below and in the 批注 1 block.
    expect(fileEditor).not.toContain("file-rendered");
    expect(css).not.toContain(".file-rendered");
    expect(css).toMatch(/\.toc-list-overlay \{[\s\S]*?inset: 0;/);
    expect(css).toMatch(/\.character-doc-overlay \{[\s\S]*?inset: 0;/);
    // 批注 3.3: there is one draft buffer, the draft.md file entry, so a second
    // private copy in the workbench store is exactly what must never come back.
    expect(treePane).toContain("useFiles");
    expect(treePane).toContain("draftPath");
    expect(workbenchStore).not.toContain("chapterDrafts");
    expect(workbenchStore).not.toContain("draftSaved");
    expect(editorPane).toContain("chapterDraftPath");
    expect(treePane).toContain("未保存");
  });

  it("thinking and tooling are two separate folds, and an empty one is never shown (第十六批批注 1)", () => {
    // The owner asked for 「思考过程」 and it had been missing for four rounds, because the
    // only fold in the thread was called that while listing tool calls. Two names, two
    // icons, two open states - and no entry at all when the model gave no reasoning.
    expect(chatPane).toContain('className="chat-trace chat-thinking"');
    expect(chatPane).toContain("<Brain size={11} />");
    expect(chatPane).toContain("<Wrench size={11} />");
    expect(chatPane).toContain("<span>思考过程</span>");
    expect(chatPane).toContain("工具轨迹 ·");
    expect(chatPane).toContain("const [thinkingOpen, setThinkingOpen]");
    expect(chatPane).toContain("{reasoning.length ? (");
    // the field has to exist on both sides of the wire or the fold dies on reload
    expect(chatTypes).toContain("reasoning: string;");
    // 第十七批批注 1: thinking is prose, so it gets no box and no monospace block -
    // the bordered `.chat-trace-body` belongs to the tool trace alone
    expect(chatPane).toContain('className="chat-thinking-body"');
    expect(chatPane).not.toMatch(/chat-thinking[\s\S]{0,400}chat-trace-body/);
    expect(css).toMatch(/\.chat-thinking-body \{[^}]*color: var\(--text-2\);/);
    expect(rule(".chat-thinking-body")).not.toMatch(/border|background|font-family/);
    /* 第十八批批注 1: the type has to be distinguished from the answer, and the rule must
       out-specify `.chat-card p` (0,1,1) - a tie is settled by source order, and this
       block sits above it, so writing 12.5px on the container changed nothing at all. */
    const thinkingP = rule(".chat-card .chat-thinking-body p");
    expect(thinkingP).toContain("font-size: 12px");
    expect(thinkingP).toContain("font-style: italic");
    expect(thinkingP).toContain("color: var(--text-2)");
    // and the answer it has to read against stays 13px / --text-1
    expect(rule(".chat-card p")).toContain("font-size: 13px");
    expect(rule(".chat-trace-body")).toContain("border: 1px solid var(--border)");
    /* 第十八批批注 1 的后半：命令用条目，方框只留给「读不懂的那一行」兜底。 */
    expect(chatPane).toContain('className="chat-trace-list"');
    expect(chatPane).toContain("traceActions(trace)");
    expect(chatPane).toContain("ACTION_LABELS[action.name] ?? action.name");
    expect(rule(".chat-trace-list")).not.toMatch(/border|background/);
    expect(rule(".chat-trace-row")).toContain("font-size: 12px");
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

  it("a panel-level empty state is icon + words, never words alone (第十七批批注 3)", () => {
    // §0.6 has said "lucide 图标 + 一句话" since it was written, and two of these blocks
    // had no icon at all - which is also why the editor column's empty state read as a
    // stray heading rather than a placeholder. The owner named one; the class is checked.
    const PANEL_EMPTIES: [string, string][] = [
      ["editor-empty", editorPane],
      ["file-empty", fileEditor],
      ["library-empty", characterLibrary],
      ["page-panel-empty", foreshadowWall],
      ["page-panel-empty", worldMapPanel],
      ["run-detail-empty", runDetailPage],
    ];
    const missing: string[] = [];
    for (const [cls, source] of PANEL_EMPTIES) {
      const at = source.indexOf(`className="${cls}"`);
      if (at < 0) { missing.push(cls + " (block not found)"); continue; }
      // the icon is the first thing inside the block, before the heading
      const head = source.slice(at, at + 420);
      if (!/[A-Z][A-Za-z0-9]* size=\{\d+\} aria-hidden="true"/.test(head)) missing.push(cls);
    }
    expect(missing, missing.join(", ")).toEqual([]);
    // the one the owner asked for is the reading glyph, matching the toggle's meaning
    expect(editorPane).toContain("<BookOpen size={22} aria-hidden=\"true\" />");
  });

  it("anything centred in the editor column subtracts the minimap gutter (第十七批批注 2)", () => {
    // 「我老是感觉你下面的这行小字的中心，跟上面那个章节编辑的中心不在同一条线上」.
    // Measured, the two lines agreed with each other and disagreed with the page: every
    // block that fills the editor column centres on the full pane, while the text lives
    // in (pane - 56px minimap) - a constant 28px error in four places. One token now,
    // and the gutter cannot drift away from the insets that reference it.
    expect(css).toMatch(/--minimap-w: 56px;/);
    expect(rule(".minimap")).toContain("width: var(--minimap-w)");
    expect(rule(".editor-empty")).toContain("padding-right: var(--minimap-w)");
    expect(rule(".toc-list-overlay")).toContain("padding-right: var(--minimap-w)");
    expect(rule(".character-doc-overlay")).toContain("var(--minimap-w)");
    // a second literal 56px for the gutter is how this drifts back
    expect(css.split("width: 56px;").length - 1).toBe(0);
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
    // 第十六批批注 8: but only for a document that HAS a rendering. Three kinds do -
    // the directory table, the character card, draft.md's prose page. For everything
    // else the strip shows no button, because a click that changes nothing is a dead
    // control, and §0.7 条一 says don't park one in the interface.
    expect(filesStore).toContain("export const hasRenderedView");
    expect(filesStore).toMatch(
      /hasRenderedView = \(path: string\) =>\s*\n?\s*path === TOC_PATH \|\| CHARACTER_PATH\.test\(path\) \|\| draftChapter\(path\) !== null/,
    );
    expect(fileEditor).toContain("hasRenderedView(active!)");
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

/**
 * Every component source, as text. import.meta.glob goes through the same Vite
 * pipeline as the ?raw imports above, so a guard that has to see the whole tree does
 * not need 30 import lines or a node filesystem.
 */
const componentSources = import.meta.glob("./**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

  it("providers are a list and every task routes to one of them (第十九批批注 2)", () => {
    // 「我现在可能会同时保存不同的供应商…正文/审稿/章摘要用不同供应商的不同模型」.
    // Before this the data model could not express it: one gateway, one model name per
    // task. The guard is that the page still offers one flat provider (the legacy shape)
    // AND a list, and that no task is missing from the routing table.
    expect(preferences).toContain("prefs-provider-row");
    expect(preferences).toContain("prefs-routes");
    expect(preferences).toContain('routes,');
    expect(preferences).toContain("nextProviderId");
    for (const task of ["draft", "review", "summary", "chat", "image"]) {
      expect(preferences).toContain(`["${task}",`);
    }
    // the reserved slot says so instead of pretending to work
    expect(preferences).toContain('["image", "生图（未启用）"]');
    expect(preferences).toContain('placeholder={key === "image" ? "未启用" : ""}');
    // a secret is never echoed into a value, only into a placeholder as a mask
    expect(preferences).toContain("api_key: item.api_key,");
    expect(preferences).toMatch(/type="password"[\s\S]{0,200}prefs-provider-key/);
  });

  it("the paperclip is a working control with a removable chip (第十九批批注 1)", () => {
    // It was disabled once, on purpose, because the old picker threw the selection away.
    // Disabled was the honest stop-loss; staying disabled after the owner asked for the
    // feature is not. These assertions keep it wired: pick -> chip -> send -> cleared.
    expect(chatPane).toContain('aria-label="上传附件"');
    expect(chatPane).not.toMatch(/aria-label="上传附件"[\s\S]{0,160}disabled/);
    expect(chatPane).toContain('className="chat-attachments"');
    expect(chatPane).toContain("chat-attachment-drop");
    expect(chatPane).toContain("readAsText(file)");
    expect(chatPane).toContain("if (replaceId === undefined && files.length) setAttachments([]);");
    expect(chatPane).toContain("attachments: files.length ? files : undefined");
    // the chip's remove target stays a real target, and the picker stays reachable
    expect(rule(".chat-attachment-drop")).toContain("width: 24px");
    expect(rule(".chat-attachment-drop")).toContain("height: 24px");
    expect(rule(".chat-attach-input")).toContain("clip-path: inset(50%)");
    expect(rule(".chat-attach-input")).not.toMatch(/display: none|visibility: hidden/);
  });

  it("the four bars step down in one order, and the two tab strips are one height (前几轮遗留)", () => {
    // 「四条 bar 收窄并统一」. Measured live after the change: topbar 48 on both pages,
    // .editor-tabs 38 = .file-tabs 38, .editor-toolbar 33. The toolbar used to be 44 -
    // taller than the strip above it - because the one framed button kept the global
    // 32px floor plus 6px padding and stood 7px proud of its 28px row.
    expect(rule(".file-tabs")).toContain("height: 38px");
    expect(rule(".editor-toolbar")).toContain("padding: 2px 12px");
    expect(rule(".editor-actions button.primary")).toContain("height: 28px");
    expect(rule(".editor-actions button.primary")).toContain("min-height: 0");
    // the framed primary keeps its frame - §0.6 allows exactly one per view
    expect(rule(".editor-actions button:not(.primary)")).toContain("border: 0");
  });

  it("a chapter tab says which chapter it is at a glance (第十六批批注 3)", () => {
    // 「打开的页面太多，你就只能看到『第什么什么』」- every tab began with the same
    // three glyphs and the strip stopped being a locator. The number is what the tree
    // already shows, so the tab shows that; the words move to the accessible name and
    // the tooltip, they do not disappear (§0.8 条二).
    expect(editorPane).toContain("{chapterNumberLabel(item.chapter_number)}");
    expect(editorPane).not.toMatch(/<span>\s*\n?\s*第 \{item\.chapter_number\} 章/);
    expect(editorPane).toContain('aria-label={`第 ${item.chapter_number} 章 ${item.title || "未命名"}`}');
    expect(editorPane).toContain('title={`第 ${item.chapter_number} 章 ${item.title || "未命名"}`}');
    // one source for the digits: the tree row, the tab and the search all read it
    expect(filesStore).toContain("export const chapterNumberLabel");
    expect(treePane).toContain("chapterNumberLabel(chapter.chapter_number)");
  });

  it("interface hints do not end with a full stop (第十六批批注 5、6)", () => {
    // 「你这种语句里面就不要加标点符号，因为它本来就是一个提示词」- a sentence-ending dot
    // turns a locator into a line of prose. The owner pointed at two of them; there were
    // 17 across the app, so this is the whole class and a guard, not another fix.
    //
    // What is allowed to keep its punctuation: prose the agent itself writes, and text
    // that is a prompt to the model rather than interface copy. Each is named, not
    // pattern-matched, so a new hint cannot hide behind an existing exemption.
    const ALLOWED = [
      "我是这本书的写作 Agent", // the agent's opening answer - prose in a chat bubble
      "用 @ 可以点名某份资料", // the second line of that same answer
      "请盘点", // sent to the model, never rendered as UI copy
      "请用 web_search", // ditto
      "中国水墨风格", // an image prompt for the painting panel
    ];
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(componentSources)) {
      if (file.includes(".test.")) continue;
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const raw of stripped.split("\n")) {
        const line = raw.trim();
        if (!line.includes("\u3002") || ALLOWED.some((a) => line.includes(a))) continue;
        // a full stop that closes a run of user-visible text: end of a string literal,
        // end of a JSX text node, or end of an interpolated expression
        if (/[\u3002]["'`)]/.test(line) || /[\u3002]\s*<\//.test(line) || /[\u3002]\s*\}/.test(line)) {
          offenders.push(file + " | " + line.slice(0, 72));
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
    // The two lines the owner actually pointed at, pinned by name as well - a class
    // guard that silently stops seeing one file should not be the only thing holding.
    expect(editorPane).toContain("<p>左侧选择或新建一章开始写作</p>");
    expect(editorPane).not.toContain("开始写作。</p>");
    expect(fileEditor).toContain("你确认后才写入</p>");
    expect(fileEditor).not.toContain("才写入。</p>");
  });

  it("the dark theme stays at the owner's measured grey (第十轮批注1)", () => {
    expect(css).toMatch(/\[data-theme="dark"\][\s\S]*?--surface-alt: #191a1b;/);
    expect(css).toMatch(/--surface: #1f2023;/);
  });

  /* 第十九批批注 3：外观第一次成为「可切换的偏好」。这一类东西最容易在半年后
     被改回硬编码，所以钉的是结构，不是某个色值。 */
  it("an appearance switch repaints tokens, and no preview copies a colour", () => {
    // 浅色那套必须挂在属性能声明到任意元素上，预览卡才画得出「另一个主题长什么样」，
    // 而不是把 token 抄第二遍（抄了就开始了说谎的预览）。
    expect(css).toMatch(/:root,\s*\n\[data-theme="light"\] \{/);
    // 复合选择器是这件事的全部机关：[data-accent="blue"] 与 [data-theme="dark"] 同为
    // (0,1,0)，靠源码先后决胜，深色 + 蓝就会拿浅色的值去刷深色界面。写成
    // :root[data-accent=...] 是同一个病的另一种写法——第十五批 4.2 与第十八批 18.1
    // 两次都栽在「特异性优先于源码顺序」上。
    expect(css).toMatch(/\[data-theme="dark"\]\[data-accent="blue"\] \{/);
    expect(css).toMatch(/\[data-theme="dark"\]\[data-code="graphite"\] \{/);
    expect(css).not.toMatch(/:root\[data-accent/);
    expect(css).not.toMatch(/:root\[data-code/);
    // 一个色值一个出处：换色系换的是 --accent 这三行别名，不是散在文件里的 74 处引用
    expect(rule('[data-accent="blue"]')).toContain("--accent: var(--blue);");
    expect(rule('[data-theme="dark"]')).toContain("--accent: var(--vermilion-dark);");
    // 预览卡只声明属性，颜色一律回读 token
    const previewRules = (css.match(/\.pv-[a-z.-]* \{[\s\S]*?\}/g) ?? []).join("\n");
    expect(previewRules.length).toBeGreaterThan(200);
    expect(previewRules).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(previewRules).toContain("background: var(--accent)");
    // 正文字体只有一个出处，canvas 读它，不在组件里再写一份
    expect(rule(".editor-body textarea")).toContain("font-family: var(--prose)");
    expect(editorPane).toContain('tokenValue("--prose")');
    expect(css).not.toMatch(/font-family: "Noto Serif SC", "Source Han Serif SC", serif;/);
    // data-theme 只有一个写者（workbench 曾经也写它）
    expect(workbenchStore).not.toMatch(/dataset\.theme/);
    expect(appearanceStore).toContain("root.dataset.theme = resolveTheme(next.theme);");
  });

  /* 前几轮点名项（书卡右键菜单）定下来的三件事：卡面动作是图标不是句子、
     右键菜单复用树那一套、没有通路的条目老实写「未开放」。 */
  /* 第二十批批注 3：一本小说可改哪几个字段，只许有一张表；写回只许有一条口。 */
  it("the editable fields of a book are listed exactly once", () => {
    expect(bookshelf).toContain("const BOOK_FIELDS: BookFieldDef[]");
    // 新建向导与「编辑信息」弹窗都渲染这张表；谁再手写一遍输入框，这里就红
    expect(bookshelf.match(/BOOK_FIELDS\.(filter|map)/g)?.length).toBe(2);
    expect(bookshelf).not.toMatch(/placeholder="书名"/);
    expect(bookshelf).not.toMatch(/value=\{description\}/);
    // D-01：弹窗自己不许开第二条写通路
    expect(bookshelf).not.toMatch(/method:\s*"PUT"/);
    expect(bookshelf).toContain("updateNovel(infoId, {");
    // 空名与重名在发请求之前就拦住
    expect(bookshelf).toContain('"书名不能为空"');
    expect(bookshelf).toContain('"已经有同一部作品叫这个名字"');
  });

  /* D-22②：顶栏的图标钮是记号不是方框（§0.7 条一）。全站只剩的两处例外已收掉，
     不许再长回来 - 工作台同一位置的控件是裸图标，两套语言会让人觉得这两个页面
     不是同一个应用。 */
  it("topbar icon buttons are borderless marks, not boxes", () => {
    for (const source of [bookshelf, preferences, layout]) {
      const bare = source.match(/<button\s+type="button"\s+aria-label="[^"]+"[^>]*>\s*\n\s*<(Settings|ArrowLeft)/g) ?? [];
      expect(bare, source.slice(0, 40)).toEqual([]);
    }
    expect(bookshelf).toMatch(/className="icon-button"\s*\n\s*aria-label="设置"/);
    expect(preferences).toMatch(/className="icon-button"\s*\n\s*aria-label="返回上一页"/);
  });

  /* D-22①：压在饱和色块上的字必须是 token。深色主题的语义色都是提亮的浅色调，
     白字压上去只有 2.6~3.4 - 九条规则各写一遍 #fff 就是这次的病根。 */
  it("ink on a saturated fill is a token, not a hard-coded white", () => {
    const offenders =
      css.match(/background: var\(--(accent|accent-strong|danger|chip)\);[\s\S]{0,40}?color: #fff/g) ?? [];
    expect(offenders).toEqual([]);
    expect(css).toContain("--on-accent: #fff;");
    expect(css).toContain("--on-accent: #1c1b1a;");
    expect(css).toContain("--on-danger: #1c1b1a;");
    // 三枚淡底是量出来的：主色文字压上去分别到 4.58 / 4.81 / 4.69
    expect(css).toContain("--vermilion-soft: #fdf6f3;");
    expect(css).toContain("--vermilion-soft-dark: #2c1f1b;");
    expect(css).toContain("--blue-soft-dark: #182431;");
    // 禁用态主按钮 4.00 -> 5.08
    expect(css).toContain("--control-disabled-accent-fg: #b09a94;");
  });

  /* 第二十一批批注 1：离开再回来，不许换面。这条断言钉的是「谁优先」，
     因为这一轮真机量出来的两个反例都是优先级错了，不是没写代码。 */
  it("the workbench comes back to the face it was left on", () => {
    expect(layout).toContain("readStage(Number(novelIdParam))?.view");
    expect(layout).toContain("readStage(Number(novelIdParam))?.rail");
    expect(layout).toContain("writeStage(novelId, { view: rightView, rail: railPage, file: activeFile })");
    // 显式 URL 大于历史状态（?chapter= 也算，第一版漏了它就被测试抓到）
    expect(layout).toMatch(/searchParams\.get\("file"\) \|\| searchParams\.get\("chapter"\)/);
    // 恢复排在写入之前：否则第一次写入会赶在读到记录前把 file 冲成 null
    expect(layout.indexOf("restoredNovel.current = novelId")).toBeLessThan(
      // 比的是**调用点**，不是函数定义 - 定义在文件更靠前的位置，
      // 拿 "writeStage(novelId" 去比会永远输给定义行（第一次就红在这里）
      layout.indexOf("writeStage(novelId, {"),
    );
    // 等这本书的文件层挂上再恢复：open() 在 novelId 为 null 时直接返回
    expect(layout).toContain("if (filesNovelId !== novelId) return;");
    // 只有离开时确实是文件栏才重开文档：open() 会把 draft.md 钉在源码面上
    expect(layout).toMatch(/stored\?\.view !== "files"/);
  });

  /* 第二十批批注 1、2：同一处根因，修的是整类。 */
  it("a bare button centres its icon without shoving row text around", () => {
    // 剥掉注释再查：这条规则里就写着「不写 justify-content」这句话，
    // 让散文去触发断言，等于闸门自己骗自己（第十五批 4.2 同一课）。
    const r = rule("button").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(r).toContain("display: inline-flex");
    expect(r).toContain("align-items: center");
    // justify-content: center 是我想当然加的第一版：它把 .tree-label 那类
    // 占满一行的按钮文字右移了 75px（改前后各拍一次全站按钮快照对比出来的）。
    expect(r).not.toContain("justify-content");
  });

  /* 前几轮点名项（封面色调色盘）：色板末尾那枚是系统取色器，不是我又画的假色轮；
     挑的颜色必须当场在预览上看得见，不能等保存回书架才知道选了什么。 */
  it("the cover palette ends in a real picker that paints the preview", () => {
    expect(bookshelf).toContain('type="color"');
    expect(bookshelf).toContain('aria-label="自定义封面颜色"');
    expect(bookshelf).toContain('className="cover-palette-row"');
    expect(bookshelf).toMatch(/style=\{\{ "--book-accent": coverColor \|\| tokenValue\("--accent"\)/);
    expect(rule(".cover-preview span")).toContain("var(--book-accent, var(--accent))");
    // 命中区与预设同尺寸（审计的地板线是 24）
    expect(rule(".cover-swatch-picker input")).toContain("width: 26px");
    expect(rule(".cover-swatch-picker input")).toContain("height: 26px");
    // 形状必须与预设不同：两枚一模一样的圆，只有 tooltip 知道哪枚是取色器
    expect(rule(".cover-swatch-picker")).toContain("border-radius: 7px");
    expect(rule(".cover-palette .swatch")).toContain("border-radius: 50%");
  });

  it("a book card's action is an icon and its menu is the tree's menu", () => {
    expect(bookshelf).toMatch(/className="icon-button cover-change-btn"[\s\S]{0,400}<ImagePlus/);
    expect(bookshelf).not.toMatch(/更换封面\s*<\/button>/);
    // 32, not 28: the card's 3D lean costs a 28px button 4px of hit width
    expect(rule(".cover-change-btn")).toContain("width: 32px");
    // 一套菜单语言：树用的那三个类，不另起一份
    expect(bookshelf).toContain('className="tree-menu"');
    expect(bookshelf).toContain('className="tree-menu-item primary"');
    expect(bookshelf).toContain('className="tree-menu-sep"');
    // 全局 button.primary / button.danger 会把这些行刷成实心色条（字也是同色＝看不见），
    // 菜单项必须自己声明无底。第二十三批批注 1：我记下 T-19 之后的第二个提交里
    // 又给 .danger 踩了同一条坑，所以这里改成扫整类，不再一条一条点名。
    for (const variant of [".primary", ".danger"]) {
      expect(rule(`.tree-menu-item${variant}`)).toContain("background: none");
    }
    // 批注 2：树菜单里不许同时出现两条「新建…章节/简报」
    expect(treePane).toContain("新建下一章简报");
    expect(treePane).not.toContain("在其后新建章节");
    // D-22③ 推翻了「删除一律未开放」：书与人物现在有真端点，
    // 而树里的「重命名 / 删除」仍然 disabled（章号是主键，D-13 未决）。
    expect(bookshelf).toContain("删除作品…");
    expect(bookshelf).toContain("confirmTitle !== deleteTarget.title");
    expect(treePane).toMatch(/disabled[^>]*title="重命名与删除尚未开放"/);
    // 鼠标与键盘两扇门
    expect(bookshelf).toContain("onContextMenu={(event) => openBookMenu(event, novel)}");
    expect(bookshelf).toContain('event.key === "ContextMenu"');
    expect(bookshelf).toContain('aria-haspopup="menu"');
  });

  /* 第二十批批注 5：卡片只留给需要看图的那一组，其余一行一项；
     字号与字体各只有一个出处。 */
  it("only the theme picker is cards, and sizes and fonts have one source each", () => {
    expect(preferences).toContain('label="主题"');
    expect(preferences).toContain('value: "system"');
    for (const label of ["强调色", "代码配色", "界面字号", "正文字号", "界面字体", "正文字体", "代码字体"]) {
      expect(preferences).toContain(label);
    }
    expect(preferences).toContain('className="pref-rows"');
    expect(preferences).toContain('type="range"');
    // 字体栈只许待在 styles.css：组件里出现第二份，切换就会有一半地方不生效
    expect(preferences).not.toMatch(/Noto Serif|Georgia|Consolas|font-family/);
    expect(editorPane).not.toMatch(/Noto Serif/);
    expect(fileEditor).not.toMatch(/Noto Sans SC/);
    // 字号：界面走 #root 的 zoom，正文走 --prose-size，两个都由 store 独家写
    expect(css).toMatch(/#root \{\s*\n\s*zoom: var\(--ui-zoom, 1\);/);
    expect(rule(".editor-body textarea")).toContain("font-size: var(--prose-size)");
    expect(appearanceStore).toContain('root.style.setProperty("--ui-zoom"');
    expect(appearanceStore).toContain('root.style.setProperty("--prose-size"');
    // 指针是视觉像素、style 是 CSS 像素：两者之间只许有一道换算
    expect(appearanceStore).toContain("export function toCssPx");
    expect(hScrollThumb).toContain("toCssPx(");
    expect(workPage).toContain("toCssPx(");
    expect(treePane).toContain("uiZoom()");
    // 「系统」仍然是活的
    expect(appSource).toContain('matchMedia("(prefers-color-scheme: dark)")');
    expect(appSource).toContain("followSystem()");
  });
});
