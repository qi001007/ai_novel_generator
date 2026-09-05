import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CharacterDocCard, { isCharacterDoc, parseCharacterDoc } from "./CharacterDocCard";
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

describe("parseCharacterDoc", () => {
  it("reads the structure lines and the four long fields", () => {
    const doc = parseCharacterDoc(DOC);
    expect(doc.name).toBe("沈砚舟");
    expect(doc.level).toBe("protagonist");
    expect(doc.start).toBe("1");
    expect(doc.end).toBe("12");
    expect(doc.sections.map((s) => s.label)).toEqual(["身份", "目标", "行为约束", "当前状态"]);
    expect(doc.sections[0].body).toBe("守碑人后裔，替家族抄录星图已七年。");
  });

  it("keeps a list inside a section as that section's prose", () => {
    // A bullet below the first heading is the author's writing, not a field: reading
    // it as structure would drop half of 目标 off the card.
    expect(parseCharacterDoc(DOC).sections[1].body).toContain("- 保住左眼最后一点视力。");
  });

  it("says which rendered view a path has, in one place", () => {
    expect(isCharacterDoc("settings/characters/6.md")).toBe(true);
    expect(isCharacterDoc("chapters/0001/draft.md")).toBe(false);
    expect(renderedViewLabel("settings/characters/6.md")).toBe("人物卡片");
    expect(renderedViewLabel("toc.md")).toBe("列表视图");
    expect(renderedViewLabel("chapters/0001/draft.md")).toBe("正文页");
  });
});

describe("CharacterDocCard", () => {
  it("shows the person, not the markdown", () => {
    render(<CharacterDocCard text={DOC} />);
    expect(screen.getByText("沈砚舟")).toBeTruthy();
    expect(screen.getByText("主角团")).toBeTruthy();
    expect(screen.getByText("1 - 12 章")).toBeTruthy();
    expect(screen.getByText("身份")).toBeTruthy();
    expect(screen.getByText("守碑人后裔，替家族抄录星图已七年。")).toBeTruthy();
    // the structural header must not leak onto the card
    expect(screen.queryByText(/文件名人物号即主键/)).toBeNull();
    expect(document.querySelector(".character-doc")).toBeTruthy();
  });
});
