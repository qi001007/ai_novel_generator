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
  const invalidReason = proposal.error || "提案未通过后端校验";
  /* 批注 2 (2026-09-09): an invalid proposal has nothing to write. The PUT came back
     red and the markdown stayed as it was, so pressing 应用 again only re-prints that
     red line. The mark is disabled and the server's own words become its tooltip.
     The backend stays the final structure gate - this only stops the card from asking
     for an action that gate has already refused. */
  const applyLabel = !proposal.valid
    ? `不可应用：${invalidReason}`
    : applying
      ? "正在写入"
      : "应用提案";

  /* One list, drawn by both branches. 批注 1: the more-button used to call
     setShowAll(true) and then hide itself, so a long diff could be opened but never
     closed again; this node now carries both directions and says which it offers.
     批注 35.3: it sits in the head, not under the rows. Opening a 50-row diff grew the
     card to 1403px and left the control 673px below the bottom of the chat viewport —
     the owner could read the whole diff and had nothing in sight to close it with.
     Above the rows is the one place that cannot move when the rows grow. */
  const fold =
    hidden > 0 ? (
      <button
        type="button"
        className="proposal-more"
        aria-expanded={showAll}
        onClick={() => setShowAll((value) => !value)}
      >
        {showAll ? "收起" : `展开全部 ${rows.length} 行改动`}
      </button>
    ) : null;

  const changeRows = (
    <>
      {visible.map((row, index) => (
        <p key={`${row.type}-${row.line}-${index}`} className={`proposal-line ${row.type}`}>
          <span aria-hidden="true">{row.type === "minus" ? "−" : "+"}</span>
          {row.text.trim() || " "}
        </p>
      ))}
    </>
  );

  return (
    <div className={`proposal ${proposal.valid ? "" : "invalid"}`}>
      <div className="proposal-head">
        <span className="proposal-file">{proposal.path}</span>
        <span className="proposal-meta">
          AI 提案 · +{diff.added} −{diff.removed}
          {diff.firstChange ? ` · 第 ${diff.firstChange} 行` : ""}
        </span>
        {fold}
      </div>

      {proposal.valid ? (
        <div className="proposal-diff">{changeRows}</div>
      ) : (
        <>
          <p className="proposal-error">{invalidReason}</p>
          <div className="proposal-diff proposal-invalid-preview">{changeRows}</div>
        </>
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
            aria-label={applyLabel}
            title={applyLabel}
            disabled={applying || !proposal.valid}
            onClick={onApply}
          >
            {applying ? <i className="spinner" aria-hidden="true" /> : <Check size={15} />}
          </button>
        </span>
      </div>
    </div>
  );
}
