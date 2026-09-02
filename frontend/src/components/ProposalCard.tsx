import { useState } from "react";

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

      <div className="proposal-foot">
        <span className="proposal-note">键名与主键锁定 · AI 只改值</span>
        <span className="proposal-acts">
          <button type="button" className="proposal-btn" onClick={onOpen}>
            在编辑器中打开
          </button>
          <button type="button" className="proposal-btn" onClick={onDiscard}>
            丢弃
          </button>
          <button
            type="button"
            className="proposal-btn apply"
            disabled={!proposal.valid || applying}
            onClick={onApply}
          >
            {applying ? "写入中" : "应用"}
          </button>
        </span>
      </div>
    </div>
  );
}