const LABELS: Record<string, { label: string; tone: string }> = {
  draft: { label: "草稿", tone: "" },
  generated: { label: "已生成", tone: "" },
  ai_reviewed: { label: "已审", tone: "warning" },
  missing: { label: "未建", tone: "" },
  final: { label: "定稿", tone: "filled" },
};

export default function StatusBadge({ status }: { status: string }) {
  const meta = LABELS[status] ?? { label: status, tone: "" };
  return <span className={`badge ${meta.tone}`}>{meta.label}</span>;
}
