/* 注入清单的「层序」与「一份文件一行」的分组键。
 *
 * 第二十三批批注 3、4、5 是同一句话：**我看不出注入了哪些**。
 * 对话里的 chip 和调用详情的表用的是同一批数据，所以顺序表只许有一份 -
 * 两处各写一遍，就会出现「对话里 A 在前、详情里 D 在前」这种没人能解释的乱。
 */

/** 作者按四层规划想问题：A 全书蓝图 → B 目录 → C 剧情弧 → D 简报，
 *  然后是本章正文、设定类资料、附件。 */
export const LAYER_ORDER = ["A", "B", "C", "D", "正文", "设定", "附件"] as const;

export function layerRank(layer: string): number {
  const index = (LAYER_ORDER as readonly string[]).indexOf(layer);
  return index < 0 ? LAYER_ORDER.length : index;
}

const KIND_LAYERS: Array<{ short: string; kinds: string[] }> = [
  { short: "A", kinds: ["novel", "blueprint"] },
  { short: "B", kinds: ["toc"] },
  { short: "C", kinds: ["arc"] },
  { short: "D", kinds: ["brief"] },
  { short: "正文", kinds: ["chapter", "chapter_tail", "summary"] },
  { short: "设定", kinds: ["setting", "character", "foreshadow", "worldview", "feedback"] },
  { short: "附件", kinds: ["attachment"] },
];

export function layerOfKind(kind: string): string {
  return KIND_LAYERS.find((layer) => layer.kinds.includes(kind))?.short ?? "—";
}

/** chip 的文案形如「A 全书蓝图 · 主线」「正文 · 第 1 章 未命名」- 层就是第一个词。 */
export function layerOfLabel(label: string): string {
  const head = label.trim().split(/[ \u00b7\s]/)[0];
  return (LAYER_ORDER as readonly string[]).includes(head) ? head : layerOfKind(headToKind(head));
}

/** 认不出层的 chip 不许被丢到最前面去；按资料名猜一次，猜不到就排最后。 */
function headToKind(head: string): string {
  const map: Record<string, string> = {
    作品信息: "novel",
    全本蓝图: "blueprint",
    目录: "toc",
    剧情弧: "arc",
    简报: "brief",
    正文: "chapter",
    人物: "character",
    伏笔: "foreshadow",
    设定: "setting",
    附件: "attachment",
  };
  return map[head] ?? "";
}

/** 「一份文件多节」的 kind：blueprint.md 的主线、主题、核心冲突是同一份文档，
 *  清单里并成一行才是它本来的样子（批注 5：以后注入多了这份表会非常长）。
 *  其余 kind 是一条 ref 一份文件 - 三份 chapters/NNNN/brief.md 绝不能并成一行。 */
const ONE_FILE_PER_KIND = new Set(["blueprint", "toc", "arc", "foreshadow", "setting", "worldview"]);

export function groupKeyOf(block: { kind: string; ref: string }): string {
  return ONE_FILE_PER_KIND.has(block.kind) ? `kind:${block.kind}` : `ref:${block.ref}`;
}

/** 归并后那一行报的是文件名 - 他要的是「以文件的形式来呈现」。 */
const FILE_OF_KIND: Record<string, string> = {
  blueprint: "blueprint.md",
  toc: "toc.md",
  arc: "arcs.md",
  foreshadow: "settings/foreshadow.md",
  setting: "settings/（设定库）",
  worldview: "settings/worldview.md",
};

export function fileNameOfKind(kind: string): string | null {
  return FILE_OF_KIND[kind] ?? null;
}

/** 「A 全书蓝图 · 主线」-> 「主线」：一行里列小节名用。 */
export function sectionNameOf(label: string): string {
  const parts = label.split(" · ");
  return parts.length > 1 ? parts[parts.length - 1] : label;
}
