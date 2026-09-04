import { useState } from "react";
import { ArrowRight, Check, Trash2 } from "lucide-react";

import type { FileProposal } from "../types";
import { diffFile } from "../utils/lineDiff";

type ProposalCardProps = {
  proposal: FileProposal;
  applying: boolean;
  onOpen: () => void;
  onApply: () => void;
  onDiscard: () => void;
};

const MAX_ROWS = 8;

/**
 * What the agent offered, never what it wrote: the diff is computed here against
 * the buffer the proposal was born from, and only "应用" sends a PUT (actor=ai).
 */
export default function ProposalCard({
  proposal,
  applying,
  onOpen,
  onApply,
  onDiscard,
}: ProposalCardProps) {
  const [showAll, setShowAll] = useState(false);
  const diff = diffFile(proposal.baseText, proposal.text);
  const rows = diff.lines.filter((row) => row.type !== "same");
  const hidden = Math.max(0, rows.length - MAX_ROWS);
  const visible = showAll ? rows : rows.slice(0, MAX_ROWS);

  return (
    <div className={`proposal ${proposal.valid ? "" : "invalid"}`}>
      <div className="proposal-head">
        <span className="proposal-file">{proposal.path}</span>
        <span className="proposal-meta">
          AI 提案 · +{diff.added} −{diff.removed}
          {diff.firstChange ? ` · 第 ${diff.firstChange} 行` : ""}
        </span>
      </div>

      {proposal.valid ? (
        <div className="proposal-diff">
          {visible.map((row, index) => (
            <p key={`${row.type}-${row.line}-${index}`} className={`proposal-line ${row.type}`}>
              <span aria-hidden="true">{row.type === "minus" ? "−" : "+"}</span>
              {row.text.trim() || " "}
            </p>
          ))}
          {hidden > 0 && !showAll ? (
            <button type="button" className="proposal-more" onClick={() => setShowAll(true)}>
              展开全部 {rows.length} 行改动
            </button>
          ) : null}
        </div>
      ) : (
        <p className="proposal-error">{proposal.error || "提案未通过后端校验"}</p>
      )}

      {/* 批注 3, 4, 5, 6: the three words were three sentences standing where three
          marks belong. Icons now, with the words kept where they do no damage - the
          accessible name and the tooltip. The note line was deleted outright: the
          lock it described is a property of the diff above, not a caption for it. */}
      <div className="proposal-foot">
        <span className="proposal-acts">
          <button
            type="button"
            className="proposal-btn"
            aria-label="在编辑器中打开"
            title="在编辑器中打开"
            onClick={onOpen}
          >
            <ArrowRight size={14} />
          </button>
          <button
            type="button"
            className="proposal-btn"
            aria-label="丢弃提案"
            title="丢弃提案"
            onClick={onDiscard}
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            className="proposal-btn apply"
            aria-label={applying ? "正在写入" : "应用提案"}
            title={applying ? "正在写入" : "应用提案"}
            disabled={!proposal.valid || applying}
            onClick={onApply}
          >
            {applying ? <i className="spinner" aria-hidden="true" /> : <Check size={15} />}
          </button>
        </span>
      </div>
    </div>
  );
}