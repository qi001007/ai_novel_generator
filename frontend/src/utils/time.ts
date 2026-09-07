/** 时间显示的唯一一份：NaN 给破折号，其余按 zh-CN 24 小时制。 */
export function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("zh-CN", { hour12: false });
}
