import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    expect(within(card).getByText("还没有简介，去蓝图里写一句")).toBeTruthy();
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
  it("saves the spine colour picked from the palette", async () => {
    const user = userEvent.setup();
    const puts: Record<string, unknown>[] = [];
    const ok = (data: unknown) =>
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method ?? "GET");
        if (url.endsWith("/api/novels/4") && method === "PUT") {
          puts.push(JSON.parse(String(init?.body)));
          return Promise.resolve(ok({ ...shelf[0], cover_color: "#2f6b57" }));
        }
        return Promise.resolve(ok(shelf));
      }),
    );

    const { container } = renderShelf();
    const card = container.querySelector('.book-card[data-novel-id="4"]') as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "更换「演示测试」封面" }));
    await user.click(screen.getByRole("radio", { name: "青碧" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]).toEqual({ cover_color: "#2f6b57" });
  });

  /* 前几轮点名项：书卡右键菜单。两条纪律一起钉 - 菜单里不许有会 405 的假按钮，
     卡面那枚动作钮不许再带文字（「按钮能用图标就用图标」）。 */
  /* 第二十四批：菜单从四扇门变六扇 - 多的两扇是导出全书。 */
  it("opens a context menu on the book card with the six doors that actually work", async () => {
    const user = userEvent.setup();
    const { container } = renderShelf();
    const card = container.querySelector(`.book-card[data-novel-id="4"]`) as HTMLElement;

    expect(within(card).getByRole("button", { name: "更换「演示测试」封面" }).textContent).toBe("");

    fireEvent.contextMenu(card);
    const menu = await screen.findByRole("menu", { name: "《演示测试》的操作" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "打开作品Enter",
      "更换封面…悬停图标",
      "编辑信息…书名 简介 章数",
      "导出全书…纯文本",
      "导出全书 Markdown.md",
      "删除作品…不可恢复",
    ]);

    // 点菜单项只开弹窗，不许顺带把读者送进工作台
    await user.click(within(menu).getByRole("menuitem", { name: /更换封面/ }));
    expect(await screen.findByRole("dialog", { name: "封面编辑" })).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(container.querySelector(".book-card")).toBeTruthy();
  });

  /* 第二十批批注 3：这本书写多少章、叫什么、简介是什么，建完就该还能改。
     字段清单只有一份（BOOK_FIELDS），这里钉的是「改了能存、取消不写、空名拦住」。 */
  function stubBookApi(puts: Record<string, unknown>[]) {
    const ok = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method ?? "GET");
        if (method === "PUT" && url.endsWith("/api/novels/4")) {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          puts.push(body);
          return Promise.resolve(ok({ ...shelf[0], ...body }));
        }
        if (url.endsWith("/api/novels/4")) return Promise.resolve(ok(shelf[0]));
        return Promise.resolve(ok(shelf));
      }),
    );
  }

  it("edits the title, the blurb and the chapter target from the menu", async () => {
    const user = userEvent.setup();
    const puts: Record<string, unknown>[] = [];
    stubBookApi(puts);
    const { container } = renderShelf();
    const card = container.querySelector(`.book-card[data-novel-id="4"]`) as HTMLElement;

    fireEvent.contextMenu(card);
    const menu = await screen.findByRole("menu", { name: "《演示测试》的操作" });
    await user.click(within(menu).getByRole("menuitem", { name: /编辑信息/ }));

    const dialog = await screen.findByRole("dialog", { name: "编辑作品信息" });
    // 初值是从服务器读回来的那一份，不是本地缓存的旧值
    expect((within(dialog).getByLabelText("书名") as HTMLInputElement).value).toBe("演示测试");
    expect((within(dialog).getByLabelText("目标章数上限") as HTMLInputElement).value).toBe("286");

    await user.clear(within(dialog).getByLabelText("书名"));
    await user.type(within(dialog).getByLabelText("书名"), "演示测试改名");
    await user.clear(within(dialog).getByLabelText("一句话简介"));
    await user.type(within(dialog).getByLabelText("一句话简介"), "改过的简介");
    await user.clear(within(dialog).getByLabelText("目标章数上限"));
    await user.type(within(dialog).getByLabelText("目标章数上限"), "400");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]).toEqual({
      title: "演示测试改名",
      description: "改过的简介",
      target_chapters: 400,
      style_constraints: "",
    });
    // 卡面与菜单的可访问名一起跟上
    await waitFor(() =>
      expect(container.querySelector(`.book-card[data-novel-id="4"] h3`)?.textContent).toBe("演示测试改名"),
    );
    fireEvent.contextMenu(container.querySelector(`.book-card[data-novel-id="4"]`) as HTMLElement);
    expect(await screen.findByRole("menu", { name: "《演示测试改名》的操作" })).toBeTruthy();
  });

  it("cancelling the info dialog writes nothing, and an empty title is blocked before the request", async () => {
    const user = userEvent.setup();
    const puts: Record<string, unknown>[] = [];
    stubBookApi(puts);
    const { container } = renderShelf();
    const card = container.querySelector(`.book-card[data-novel-id="4"]`) as HTMLElement;

    fireEvent.contextMenu(card);
    await user.click(
      within(await screen.findByRole("menu", { name: "《演示测试》的操作" })).getByRole("menuitem", { name: /编辑信息/ }),
    );
    const dialog = await screen.findByRole("dialog", { name: "编辑作品信息" });
    await user.clear(within(dialog).getByLabelText("书名"));
    await user.type(within(dialog).getByLabelText("书名"), "   ");

    // 空书名当场拦住，并且说清为什么 - 不发一个注定把书改成没名字的请求
    const save = within(dialog).getByRole("button", { name: "保存" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(within(dialog).getByText("书名不能为空")).toBeTruthy();

    await user.clear(within(dialog).getByLabelText("书名"));
    await user.type(within(dialog).getByLabelText("书名"), "日向家的叛忍");
    expect(save.disabled).toBe(true);
    expect(within(dialog).getByText("已经有同一部作品叫这个名字")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "编辑作品信息" })).toBeNull();
    expect(puts).toHaveLength(0);
  });

  it("closes the book menu with Escape and gives the focus back to the card", async () => {
    const user = userEvent.setup();
    const { container } = renderShelf();
    const card = container.querySelector(`.book-card[data-novel-id="2"]`) as HTMLElement;

    fireEvent.contextMenu(card);
    expect(await screen.findByRole("menu", { name: "《日向家的叛忍》的操作" })).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(card);

    // 点外面同样算关
    fireEvent.contextMenu(card);
    await screen.findByRole("menu");
    await user.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  /* 第二十四批批注 1：主人去掉了「把书名打一遍」——右键哪本点删除，指的就是那本。
     确认过程保留（一次点击 + 一条退路），但门槛不再靠打字；焦点在「取消」，
     回车关掉的是弹窗不是这本书。删除仍然只走那一条 DELETE（D-23）。 */
  it("confirms a delete with one click and no typing, and sends nothing on cancel", async () => {
    const user = userEvent.setup();
    const deletes: string[] = [];
    const ok = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method ?? "GET");
        if (method === "DELETE") {
          deletes.push(url);
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(ok(url.endsWith("/api/novels") ? shelf : shelf[0]));
      }),
    );
    const { container } = renderShelf();
    const openDelete = async () => {
      fireEvent.contextMenu(container.querySelector(`.book-card[data-novel-id="4"]`) as HTMLElement);
      await user.click(
        within(await screen.findByRole("menu", { name: "《演示测试》的操作" })).getByRole("menuitem", { name: /删除作品/ }),
      );
      return screen.findByRole("dialog", { name: "删除作品" });
    };

    const dialog = await openDelete();
    expect(dialog.querySelector("input")).toBeNull();
    expect(within(dialog).getByText("删除后无法恢复")).not.toBeNull();
    expect((within(dialog).getByRole("button", { name: "删除" }) as HTMLButtonElement).disabled).toBe(false);
    expect(deletes).toHaveLength(0);

    // 焦点落在取消上：回车关弹窗，不发请求
    expect((document.activeElement as HTMLElement).textContent).toBe("取消");
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "删除作品" })).toBeNull();
    expect(deletes).toHaveLength(0);

    // 取消也是同样
    const second = await openDelete();
    await user.click(within(second).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "删除作品" })).toBeNull();
    expect(deletes).toHaveLength(0);

    // 一次点击就删，删完那张卡从书架上消失
    const third = await openDelete();
    await user.click(within(third).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(deletes).toEqual(["/api/novels/4"]));
    await waitFor(() => expect(container.querySelector(`.book-card[data-novel-id="4"]`)).toBeNull());
  });

  /* 第二十四批新功能：导出是读。这里钉两件事 -
     打开的是后端说的那个文件名（不是前端自己编的），以及失败的时候
     把理由说出口，而不是给一个 0 字节的「导出成功」。 */
  it("downloads the whole book under the name the backend chose, and reports a refusal", async () => {
    const user = userEvent.setup();
    const urls: string[] = [];
    const ok = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    let failNext = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/export")) {
          urls.push(url);
          if (failNext) {
            return Promise.resolve(
              new Response(JSON.stringify({ detail: "这本书还没有任何正文" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
              }),
            );
          }
          const format = new URLSearchParams(url.split("?")[1]).get("format");
          return Promise.resolve(
            new Response("第1章\n\n雪。", {
              status: 200,
              headers: {
                "Content-Type": "text/plain; charset=utf-8",
                // 文件名是后端给的，前端只照抄 - 两边各编一份就会对不上
                "Content-Disposition":
                  `attachment; filename="book.${format}"; filename*=UTF-8\'\'` +
                  encodeURIComponent(`演示测试_全书.${format}`),
              },
            }),
          );
        }
        return Promise.resolve(ok(url.endsWith("/api/novels") ? shelf : shelf[0]));
      }),
    );
    // jsdom 没有 createObjectURL，下载这一步要自己造；点击也不能真导航
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    const { container } = renderShelf();
    fireEvent.contextMenu(container.querySelector(`.book-card[data-novel-id="4"]`) as HTMLElement);
    const menu = await screen.findByRole("menu", { name: "《演示测试》的操作" });
    await user.click(within(menu).getByRole("menuitem", { name: /导出全书 Markdown/ }));

    await waitFor(() =>
      expect(urls).toEqual(["/api/novels/4/export?scope=book&format=md"]),
    );
    expect(downloads).toEqual(["演示测试_全书.md"]);

    // 失败要说原因，不许静静地什么都没发生
    failNext = true;
    fireEvent.contextMenu(container.querySelector(`.book-card[data-novel-id="4"]`) as HTMLElement);
    const again = await screen.findByRole("menu", { name: "《演示测试》的操作" });
    await user.click(within(again).getByRole("menuitem", { name: /导出全书…/ }));
    expect(await screen.findByText("这本书还没有任何正文")).not.toBeNull();
    expect(downloads).toEqual(["演示测试_全书.md"]);
  });

  /* 前几轮点名项：预设八枚之外要有一枚真·调色盘，而且挑完当场看得见。 */
  it("offers a real colour picker after the presets and paints the preview with it", async () => {
    const user = userEvent.setup();
    const puts: Record<string, unknown>[] = [];
    const ok = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method ?? "GET");
        if (url.endsWith("/api/novels/4") && method === "PUT") {
          puts.push(JSON.parse(String(init?.body)));
          return Promise.resolve(ok({ ...shelf[0], cover_color: "#123456" }));
        }
        return Promise.resolve(ok(shelf));
      }),
    );
    const { container } = renderShelf();
    const card = container.querySelector(`.book-card[data-novel-id="4"]`) as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "更换「演示测试」封面" }));

    const group = screen.getByRole("radiogroup", { name: "封面颜色" });
    const picker = screen.getByLabelText("自定义封面颜色") as HTMLInputElement;
    expect(picker.type).toBe("color");
    // 取色器不是 radio，所以不许住在 radiogroup 里（那一组的子项必须全是 radio）
    expect(group.contains(picker)).toBe(false);
    expect(within(group).getAllByRole("radio")).toHaveLength(9);

    // 挑一个不在预设里的颜色：预览当场跟着变，选中态归这枚
    fireEvent.input(picker, { target: { value: "#123456" } });
    expect(document.querySelector(".cover-preview")?.getAttribute("style")).toContain("#123456");
    expect(document.querySelector(".cover-swatch-picker.on")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]).toEqual({ cover_color: "#123456" });

    // 保存会关窗；重开之后这个颜色是从服务器回来的，仍然认得出「不在预设里」
    await user.click(within(card).getByRole("button", { name: "更换「演示测试」封面" }));
    const group2 = screen.getByRole("radiogroup", { name: "封面颜色" });
    expect(document.querySelector(".cover-preview")?.getAttribute("style")).toContain("#123456");
    expect(document.querySelector(".cover-swatch-picker.on")).toBeTruthy();

    // 回到预设之一，描边环还给那一枚；「默认」仍然能把值清回空
    await user.click(within(group2).getByRole("radio", { name: "青碧" }));
    expect(document.querySelector(".cover-swatch-picker.on")).toBeNull();
    expect(within(group2).getByRole("radio", { name: "青碧" }).getAttribute("aria-checked")).toBe("true");
    await user.click(within(group2).getByRole("radio", { name: "默认（跟随工作台主色）" }));
    expect(within(group2).getByRole("radio", { name: "默认（跟随工作台主色）" }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(puts.length).toBe(2));
    expect(puts[1]).toEqual({ cover_color: "" });
  });

  it("opens the same menu from the keyboard, without a mouse", async () => {
    const user = userEvent.setup();
    const { container } = renderShelf();
    const card = container.querySelector(`.book-card[data-novel-id="4"]`) as HTMLElement;
    card.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(await screen.findByRole("menu", { name: "《演示测试》的操作" })).toBeTruthy();
  });

});