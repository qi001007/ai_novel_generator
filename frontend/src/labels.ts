/**
 * `kind` / `task` 的界面词只有这一份（候选 5，2026-09-07）。
 *
 * 搬前有三把：`EditorPane` 与 `GenerationRunDetailPage` 各存一份逐字相同的 `TASK_LABELS`，
 * `PreferencesPage` 再来一份口径不同的（同一个 review 那儿叫「审稿」），
 * `KIND_LABELS` 又和后端 `documents.py` 的 label、`contextLayers.ts` 的反查表各说各话。
 *
 * 命名裁定：A 层叫**全书蓝图**（见 `docs/DECISIONS.md` D-34）。理由：后端投影 label、
 * `ARCHITECTURE`/`PRD`、`contextLayers.ts` 自己的注释都写「全书蓝图」，树里那一处是孤立写法。
 */
export const TASK_LABELS: Record<string, string> = {
  draft: "正文生成",
  review: "AI 审稿",
  summary: "章摘要",
  fact_extract: "事实提取",
  chat: "对话",
  image: "生图",
};

export const KIND_LABELS: Record<string, string> = {
  novel: "作品信息",
  blueprint: "全书蓝图",
  toc: "目录",
  arc: "剧情弧",
  brief: "章简报",
  setting: "设定",
  character: "人物",
  foreshadow: "伏笔",
  summary: "章摘要",
  chapter: "正文",
  chapter_tail: "上章结尾",
  feedback: "审稿意见",
};

/** 供应商路由表按这个顺序列任务；`image` 是留的槽位，没接通前明写未启用。 */
export const PROVIDER_TASKS: Array<readonly [string, string]> = [
  ["draft", TASK_LABELS.draft],
  ["review", TASK_LABELS.review],
  ["summary", TASK_LABELS.summary],
  ["chat", TASK_LABELS.chat],
  ["image", `${TASK_LABELS.image}（未启用）`],
];

export const taskLabel = (task: string): string => TASK_LABELS[task] ?? task;
export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind;
