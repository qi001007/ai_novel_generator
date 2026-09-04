import { BookMarked, ListTree, MessagesSquare } from "lucide-react";

export type RailPage = "plan" | "library" | "chat";

const PAGES: { key: RailPage; label: string; icon: typeof ListTree }[] = [
  { key: "plan", label: "规划与章节", icon: ListTree },
  { key: "library", label: "设定库", icon: BookMarked },
  { key: "chat", label: "对话", icon: MessagesSquare },
];

/**
 * 帧 27: the sidebar holds three pages and only one is ever on screen, so the
 * picker lives outside it as a 44px rail. Deliberately not inside `.sidebar` -
 * the rail survives collapsing the panel it switches, which is the whole point.
 *
 * The active page is carried by the icon's own colour and a fill matching the
 * panel, never by a bar down one edge: four edges that agree is what makes the
 * mark read as quiet.
 */
export default function ActivityRail({
  page,
  onSelect,
}: {
  page: RailPage;
  onSelect: (page: RailPage) => void;
}) {
  return (
    <nav className="activity-rail" aria-label="侧栏页面">
      {PAGES.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          className={`activity-rail-item ${page === key ? "active" : ""}`}
          aria-label={label}
          title={label}
          aria-current={page === key ? "page" : undefined}
          onClick={() => onSelect(key)}
        >
          <Icon size={18} strokeWidth={1.6} />
        </button>
      ))}
    </nav>
  );
}
