import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MarkdownText from "./MarkdownText";

/**
 * These are the shapes the model actually emits in replies. The reason this file
 * exists is the owner seeing `**代价感**` on screen, so every case asserts the
 * markup is gone, not only that something rendered.
 */
describe("MarkdownText", () => {
  it("turns bold and inline code into elements, with no asterisks left", () => {
    const { container } = render(<MarkdownText text="这样收束的**代价感**来自 `arc_3` 的锁定" />);
    expect(container.querySelector("strong")?.textContent).toBe("代价感");
    expect(container.querySelector("code")?.textContent).toBe("arc_3");
    expect(container.textContent).not.toMatch(/[*`]/);
  });

  it("keeps a plain sentence in one paragraph", () => {
    render(<MarkdownText text="司天监，官署名。" />);
    expect(screen.getByText("司天监，官署名。").tagName).toBe("P");
  });

  it("renders a fenced block as code and keeps its line breaks", () => {
    const { container } = render(<MarkdownText text={"```markdown\n## 剧情弧\n- 起始章: 1\n```"} />);
    const pre = container.querySelector("pre code");
    expect(pre?.textContent).toBe("## 剧情弧\n- 起始章: 1");
    // the fenced content must not be parsed again - it is quoted source
    expect(container.querySelector("pre h2")).toBeNull();
  });

  it("renders headings, both lists, and a rule", () => {
    const { container } = render(
      <MarkdownText text={"# 一级\n## 小节\n- 一\n- 二\n1. 甲\n2. 乙\n---"} />,
    );
    // one hash is an h2: the card never owns the page's h1
    expect(container.querySelector("h2")?.textContent).toBe("一级");
    expect(container.querySelector("h3")?.textContent).toBe("小节");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("hr")).toBeTruthy();
  });

  it("quotes a blockquote and only links http(s)/mailto", () => {
    const { container } = render(
      <MarkdownText text={"> 弧 N' 是主键\n看 [官方说明](https://example.com/a) 与 [坏](javascript:1)"} />,
    );
    expect(container.querySelector("blockquote")?.textContent).toContain("主键");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/a");
    expect(container.textContent).toContain("[坏](javascript:1)");
  });

  it("links a bare url the model typed out, not only [text](url)", () => {
    const { container } = render(<MarkdownText text="- 来源：https://zh.wikipedia.org?curid=1397" />);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://zh.wikipedia.org?curid=1397");
    expect(link?.textContent).toContain("wikipedia");
  });

  it("treats a line that is only bold as a sub-heading", () => {
    const { container } = render(<MarkdownText text={"**查证结果：**\n「司天监」是官署名。"} />);
    expect(container.querySelector("h4")?.textContent).toBe("查证结果");
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("appends the caret to the last line with words in it", () => {
    const { container } = render(<MarkdownText text={"第一段\n\n"} tail={<i data-testid="caret" />} />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].querySelector("[data-testid='caret']")).toBeTruthy();
  });

  // 批次 35.26，主人原话「看来你现在的对话页面并不支持列表的形式」。输入是他作品 7
  // 第 70 条回答里那段逐字表格——渲染器压根没有表格分支，每行都掉进 <p>。
  const OWNER_TABLE = [
    "| 层级 | 当前状态 | 建议 |",
    "|------|----------|------|",
    "| **B 目录** | 仅第42章 | 需要扩展，至少覆盖卷一10-60章的章节规划 |",
    '| **C 剧情弧** | 弧6"卷一"（第10-60章） | 需补充目标/冲突/收束的具体内容 |',
    "| **世界观** | 空 | 建议先设计星渊碑的基本设定（能量机制、来源） |",
    '| **人物** | 空 | 主角"探针"及三方势力代表需要人物卡 |',
  ].join("\n");

  it("renders the owner's pipe table as a table, not as six paragraphs", () => {
    const { container } = render(<MarkdownText text={OWNER_TABLE} />);
    expect(container.querySelectorAll("thead th")).toHaveLength(3);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(4);
    expect(container.querySelectorAll("tr")).toHaveLength(5);
    expect(container.querySelector("table")).toBeTruthy();
    // the markup that made it a table must not survive as text
    expect(container.textContent).not.toContain("|");
    expect(container.textContent).not.toContain("---");
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("still parses inline markup inside table cells", () => {
    const { container } = render(<MarkdownText text={OWNER_TABLE} />);
    const first = container.querySelector("tbody td");
    expect(first?.querySelector("strong")?.textContent).toBe("B 目录");
    expect(container.textContent).not.toContain("**");
  });

  it("keeps a sentence that merely contains a bar out of the table branch", () => {
    const { container } = render(<MarkdownText text={"可选 A | B 两种落点"} />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("可选 A | B 两种落点");
  });
});
