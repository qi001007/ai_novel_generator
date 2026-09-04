const LABELS: Record<string, { label: string; tone: string }> = {
  draft: { label: "草稿", tone: "" },
  generated: { label: "已生成", tone: "" },
  ai_reviewed: { label: "已审", tone: "warning" },
  missing: { label: "未建", tone: "" },
  final: { label: "定稿", tone: "filled" },
};

export default function StatusBadge({
  status,
  dot,
  scope,
}: {
  status: string;
  dot?: boolean;
  /** Qualifies the accessible name when two dots on one screen describe the same
   *  value for different things - several chapter rows sit side by side in the
   *  tree, and identical names make them unaddressable. */
  scope?: string;
}) {
  const meta = LABELS[status] ?? { label: status, tone: "" };
  if (dot) {
    // The word still exists - for the pointer (title) and for a screen reader -
    // it just no longer occupies the screen.
    return (
      <i
        className={`status-dot ${meta.tone}`}
        title={`${scope ? scope + " " : ""}${meta.label}`}
        aria-label={`${scope ? scope + " " : ""}状态：${meta.label}`}
        data-status={status}
      />
    );
  }
  return <span className={`badge ${meta.tone}`}>{meta.label}</span>;
}
