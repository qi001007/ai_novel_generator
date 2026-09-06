/* 注入清单的层序、分组与压缩。
 *
 * 两份 fixture 都是**真机数据**，不是编的：
 *   RUN_31_REFS  = novel 5 的 chat_message id=31 的 29 条 context_refs
 *   RUN_15_BLOCKS = generation_run id=15 的 input_summary.blocks，18 条
 * 从 backend/novel_generator.db 里原样读出来贴进来的。判据里的数字全部由它们算出。
 */
import { describe, expect, it } from "vitest";
import { compressRefs, groupKeyOf, layerRank, layerOfLabel } from "./contextLayers";

type Ref = { kind: string; ref: string; label: string };

const RUN_31_REFS: Ref[] = [
  {
    "kind": "toc",
    "ref": "toc:6",
    "label": "B 目录 · 第 1 章 雪夜碑鸣改"
  },
  {
    "kind": "brief",
    "ref": "brief:7",
    "label": "D 简报 · 第 1 章"
  },
  {
    "kind": "chapter",
    "ref": "chapter:5",
    "label": "正文 · 第 1 章 未命名"
  },
  {
    "kind": "blueprint",
    "ref": "blueprint:3",
    "label": "A 全书蓝图 · 主线"
  },
  {
    "kind": "blueprint",
    "ref": "blueprint:3",
    "label": "A 全书蓝图 · 主题"
  },
  {
    "kind": "blueprint",
    "ref": "blueprint:3",
    "label": "A 全书蓝图 · 核心冲突"
  },
  {
    "kind": "blueprint",
    "ref": "blueprint:3",
    "label": "A 全书蓝图 · 约束"
  },
  {
    "kind": "blueprint",
    "ref": "blueprint:3",
    "label": "A 全书蓝图 · 终局"
  },
  {
    "kind": "novel",
    "ref": "novel",
    "label": "作品信息"
  },
  {
    "kind": "toc",
    "ref": "toc:7",
    "label": "B 目录 · 第 2 章 缺名的那个人"
  },
  {
    "kind": "toc",
    "ref": "toc:8",
    "label": "B 目录 · 第 3 章 旧道脚印"
  },
  {
    "kind": "toc",
    "ref": "toc:9",
    "label": "B 目录 · 第 4 章 未命名"
  },
  {
    "kind": "toc",
    "ref": "toc:10",
    "label": "B 目录 · 第 5 章 未命名"
  },
  {
    "kind": "toc",
    "ref": "toc:11",
    "label": "B 目录 · 第 6 章 未命名"
  },
  {
    "kind": "toc",
    "ref": "toc:12",
    "label": "B 目录 · 第 7 章 未命名"
  },
  {
    "kind": "toc",
    "ref": "toc:13",
    "label": "B 目录 · 第 8 章 未命名"
  },
  {
    "kind": "toc",
    "ref": "toc:14",
    "label": "B 目录 · 第 9 章 未命名"
  },
  {
    "kind": "brief",
    "ref": "brief:8",
    "label": "D 简报 · 第 2 章"
  },
  {
    "kind": "brief",
    "ref": "brief:9",
    "label": "D 简报 · 第 3 章"
  },
  {
    "kind": "brief",
    "ref": "brief:10",
    "label": "D 简报 · 第 4 章"
  },
  {
    "kind": "brief",
    "ref": "brief:11",
    "label": "D 简报 · 第 5 章"
  },
  {
    "kind": "brief",
    "ref": "brief:12",
    "label": "D 简报 · 第 6 章"
  },
  {
    "kind": "brief",
    "ref": "brief:13",
    "label": "D 简报 · 第 7 章"
  },
  {
    "kind": "brief",
    "ref": "brief:14",
    "label": "D 简报 · 第 8 章"
  },
  {
    "kind": "brief",
    "ref": "brief:15",
    "label": "D 简报 · 第 9 章"
  },
  {
    "kind": "arc",
    "ref": "arc:3",
    "label": "C 剧情弧 · 碑鸣（1-3）"
  },
  {
    "kind": "foreshadow",
    "ref": "foreshadow:2",
    "label": "伏笔 · 守碑人的脚印"
  },
  {
    "kind": "foreshadow",
    "ref": "foreshadow:1",
    "label": "伏笔 · 碑上缺名"
  },
  {
    "kind": "附件",
    "ref": "attachment:附件样本.md",
    "label": "附件 · 附件样本.md"
  }
];

const RUN_15_BLOCKS: Ref[] = [
  {
    "kind": "novel",
    "ref": "novel",
    "label": "作品信息"
  },
  {
    "kind": "blueprint",
    "ref": "blueprint:3",
    "label": "A 全书蓝图 · 主线"
  },
  {
    "kind": "blueprint",
    "ref": "blueprint:3",
    "label": "A 全书蓝图 · 主题"
  },
  {
    "kind": "blueprint",
    "ref": "blueprint:3",
    "label": "A 全书蓝图 · 核心冲突"
  },
  {
    "kind": "blueprint",
    "ref": "blueprint:3",
    "label": "A 全书蓝图 · 约束"
  },
  {
    "kind": "blueprint",
    "ref": "blueprint:3",
    "label": "A 全书蓝图 · 终局"
  },
  {
    "kind": "brief",
    "ref": "brief:7",
    "label": "D 简报 · 第 1 章"
  },
  {
    "kind": "arc",
    "ref": "arc:3",
    "label": "C 剧情弧 · 碑鸣（1-3）"
  },
  {
    "kind": "character",
    "ref": "character:6",
    "label": "人物 · 沈砚舟"
  },
  {
    "kind": "foreshadow",
    "ref": "foreshadow:2",
    "label": "伏笔 · 守碑人的脚印"
  },
  {
    "kind": "foreshadow",
    "ref": "foreshadow:1",
    "label": "伏笔 · 碑上缺名"
  },
  {
    "kind": "brief",
    "ref": "brief:8",
    "label": "D 简报 · 第 2 章"
  },
  {
    "kind": "brief",
    "ref": "brief:9",
    "label": "D 简报 · 第 3 章"
  },
  {
    "kind": "toc",
    "ref": "toc:6",
    "label": "B 目录 · 第 1 章 雪夜碑鸣"
  },
  {
    "kind": "toc",
    "ref": "toc:7",
    "label": "B 目录 · 第 2 章 缺名的那个人"
  },
  {
    "kind": "toc",
    "ref": "toc:8",
    "label": "B 目录 · 第 3 章 旧道脚印"
  },
  {
    "kind": "setting",
    "ref": "setting:3",
    "label": "设定 · 制度/观星阁阁律"
  },
  {
    "kind": "setting",
    "ref": "setting:2",
    "label": "设定 · 地点/星渊碑"
  }
];

function ranksOf(labels: string[]): number[] {
  return labels.map((label) => layerRank(layerOfLabel(label)));
}

describe("compressRefs（第二十四批批注 3：写到一百章不许贴一百个框）", () => {
  it("真机那 29 条压成 8 枚，一枚不多", () => {
    const chips = compressRefs(RUN_31_REFS);
    expect(chips).toHaveLength(8);
    expect(chips.map((chip) => chip.label)).toEqual([
      "A 全书蓝图 · 5 节",
      "作品信息",
      "B 目录 · 第1–9章",
      "C 剧情弧 · 碑鸣（1-3）",
      "D 简报 · 第1–9章",
      "正文 · 第 1 章 未命名",
      "伏笔 · 2 节",
      "附件 · 附件样本.md",
    ]);
  });

  it("层序仍是 A→B→C→D→正文→设定→附件（第二十三批批注 3 不回退）", () => {
    const ranks = ranksOf(compressRefs(RUN_31_REFS).map((chip) => chip.label));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("压缩不许丢信息：每一枚的 detail 仍是它盖掉的那些原文", () => {
    const chips = compressRefs(RUN_31_REFS);
    const blueprint = chips.find((chip) => chip.label.startsWith("A 全书蓝图"))!;
    expect(blueprint.detail).toEqual([
      "A 全书蓝图 · 主线",
      "A 全书蓝图 · 主题",
      "A 全书蓝图 · 核心冲突",
      "A 全书蓝图 · 约束",
      "A 全书蓝图 · 终局",
    ]);
    expect(chips.flatMap((chip) => chip.detail)).toHaveLength(RUN_31_REFS.length);
  });

  it("断号写成 1–3、7–9 章，不是一律首尾", () => {
    const sparse: Ref[] = [1, 2, 3, 7, 8, 9].map((n) => ({
      kind: "brief",
      ref: `brief:${n}`,
      label: `D 简报 · 第 ${n} 章`,
    }));
    expect(compressRefs(sparse).map((chip) => chip.label)).toEqual(["D 简报 · 第1–3、7–9章"]);
  });

  it("只有一条的资料原文照抄，不加「1 节」这种噪声", () => {
    const single: Ref[] = [{ kind: "novel", ref: "novel", label: "作品信息" }];
    expect(compressRefs(single).map((chip) => chip.label)).toEqual(["作品信息"]);
  });

  it("主判据：100 章时枚数不随章数增长", () => {
    const build = (count: number): Ref[] => {
      const list: Ref[] = [{ kind: "novel", ref: "novel", label: "作品信息" }];
      for (let n = 1; n <= count; n += 1) {
        list.push({ kind: "toc", ref: `toc:${n}`, label: `B 目录 · 第 ${n} 章 未命名` });
        list.push({ kind: "brief", ref: `brief:${n}`, label: `D 简报 · 第 ${n} 章` });
      }
      return list;
    };
    const nine = compressRefs(build(9));
    const hundred = compressRefs(build(100));
    expect(nine).toHaveLength(3);
    expect(hundred).toHaveLength(3);
    expect(hundred.map((chip) => chip.label)).toEqual([
      "作品信息",
      "B 目录 · 第1–100章",
      "D 简报 · 第1–100章",
    ]);
  });
});

describe("groupKeyOf（调用详情那张表：一行 = 一份文件，第二十三批批注 5）", () => {
  it("run 15 的 18 块收敛成 10 行，三份 brief.md 仍是三行", () => {
    const keys = RUN_15_BLOCKS.map((block) => groupKeyOf(block));
    expect(RUN_15_BLOCKS).toHaveLength(18);
    expect(new Set(keys).size).toBe(10);
    expect(keys.filter((key) => key.startsWith("ref:brief:"))).toHaveLength(3);
    // 一份文件多节的那几类才许并：blueprint 5 块 -> 1 行
    expect(keys.filter((key) => key === "kind:blueprint")).toHaveLength(5);
    expect(keys.filter((key) => key === "kind:toc")).toHaveLength(3);
  });
});
