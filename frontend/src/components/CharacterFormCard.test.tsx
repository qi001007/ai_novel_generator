import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CharacterFormCard, {
  characterDocId,
  fillCharacterDoc,
  formFromCharacterDoc,
  isCharacterDoc,
} from "./CharacterFormCard";
import { renderedViewLabel } from "../store/files";

/* The bytes the server actually renders for novel 5's character 6 - pinned here so a
   codec change cannot quietly break the card. */
const DOC = [
  "# 沈砚舟（设定库 · 人物）",
  "",
  "> 文件名人物号即主键：改名不换路径。小节标题与字段名是结构标识，不可增删改名。",
  "",
  "- **姓名**：沈砚舟",
  "- **分级**：protagonist",
  "- **起始章**：1",
  "- **结束章**：12",
  "",
  "## 身份",
  "守碑人后裔，替家族抄录星图已七年。",
  "",
  "## 目标",
  "- 查清父亲在碑下失踪的真相。",
  "- 保住左眼最后一点视力。",
  "",
  "## 行为约束",
  "不主动伤人；凡守碑人之约必践。",
  "",
  "## 当前状态",
  "左眼渐盲，仍每日登阁。",
  "",
].join("\n");

describe("the character document <-> form pair", () => {
  it("reads the structure lines and the four long fields", () => {
    const form = formFromCharacterDoc(DOC);
    expect(form.name).toBe("沈砚舟");
    expect(form.level).toBe("protagonist");
    expect(form.expected_start_chapter).toBe(1);
    expect(form.expected_end_chapter).toBe(12);
    expect(form.identity).toBe("守碑人后裔，替家族抄录星图已七年。");
    expect(form.current_status).toBe("左眼渐盲，仍每日登阁。");
  });

  it("keeps a list inside a section as that section's prose", () => {
    // A bullet below the first heading is the author's writing, not a field: reading it
    // as structure would lose half of 目标.
    expect(formFromCharacterDoc(DOC).goals).toContain("- 保住左眼最后一点视力。");
  });

  it("writes back only the four bullets and leaves every other byte alone", () => {
    const form = { ...formFromCharacterDoc(DOC), name: "沈砚舟", level: "boss", expected_end_chapter: 30 };
    const written = fillCharacterDoc(DOC, form);
    expect(written).toContain("- **分级**：boss");
    expect(written).toContain("- **结束章**：30");
    // the header, the note line and the sections are untouched
    expect(written.split("\n")[0]).toBe(DOC.split("\n")[0]);
    expect(written.split("\n")[2]).toBe(DOC.split("\n")[2]);
    expect(written).toContain("- 查清父亲在碑下失踪的真相。");
    expect(written).toContain("## 行为约束");
  });

  it("round-trips a value through read and write", () => {
    const form = { ...formFromCharacterDoc(DOC), expected_start_chapter: 7 };
    expect(formFromCharacterDoc(fillCharacterDoc(DOC, form)).expected_start_chapter).toBe(7);
  });

  it("says which rendered view a path has, and which id it carries", () => {
    expect(isCharacterDoc("settings/characters/6.md")).toBe(true);
    expect(isCharacterDoc("chapters/0001/draft.md")).toBe(false);
    expect(characterDocId("settings/characters/6.md")).toBe(6);
    expect(renderedViewLabel("settings/characters/6.md")).toBe("人物卡片");
    expect(renderedViewLabel("toc.md")).toBe("列表视图");
    expect(renderedViewLabel("chapters/0001/draft.md")).toBe("正文页");
  });
});

describe("CharacterFormCard", () => {
  function card() {
    const onChange = vi.fn();
    render(
      <CharacterFormCard
        value={{ ...formFromCharacterDoc(DOC), id: 6 }}
        onChange={onChange}
        onSave={vi.fn()}
        onPickPortrait={vi.fn()}
        onRemovePortrait={vi.fn()}
        onEditLongField={vi.fn()}
      />,
    );
    return onChange;
  }

  it("shows the person and lets the reader edit the card fields", () => {
    card();
    // The fields are controls holding the buffer's values, not labels printed under the
    // name - that is the whole point of 批注 7: this card can be edited.
    expect((screen.getByLabelText("姓名") as HTMLInputElement).value).toBe("沈砚舟");
    // the level is stored as the document's own token, shown with the shared label table
    expect((screen.getByLabelText("分级") as HTMLSelectElement).value).toBe("protagonist");
    expect(screen.getByRole("option", { name: "主角团" })).toBeTruthy();
    expect((screen.getByLabelText("起始章") as HTMLInputElement).value).toBe("1");
    expect((screen.getByLabelText("结束章") as HTMLInputElement).value).toBe("12");
    // the structural note never belongs on a card
    expect(screen.queryByText(/文件名人物号即主键/)).toBeNull();
    expect(screen.getByRole("button", { name: "贴照片" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
  });

  it("has nowhere to jump to before a character has been saved", () => {
    render(
      <CharacterFormCard
        value={{ ...formFromCharacterDoc(DOC), id: null }}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onPickPortrait={vi.fn()}
        onRemovePortrait={vi.fn()}
        onEditLongField={vi.fn()}
      />,
    );
    const pencil = screen.getByRole("button", { name: "在文件中编辑目标" });
    expect(pencil.hasAttribute("disabled")).toBe(true);
    expect(pencil.getAttribute("title")).toBe("先保存人物，再在文件中编辑");
  });

  it("previews the long fields and offers the jump that edits them", () => {
    card();
    expect(screen.getByText("守碑人后裔，替家族抄录星图已七年。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "在文件中编辑目标" })).toBeTruthy();
  });
});
