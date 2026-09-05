import { useRef } from "react";
import type { ReactNode } from "react";
import { Pencil, X } from "lucide-react";

/**
 * The character card, in one piece.
 *
 * 第十六批批注 7: the owner pointed at the read-only copy the file pane had grown and
 * said the real one is already editable and already changes the photo - 「你没有必要在这里
 * 重新做一个，直接复用那个卡片，在这里呈现就可以了」. So the card the dialog used is now
 * shared with the rendered view of `settings/characters/N.md`, and there is one of it.
 *
 * The document <-> form pair lives here too: the file layer is the only writer of text
 * (DECISIONS D-15), so both hosts edit the same projection through the same functions.
 */

export type LongFieldKey = "identity" | "goals" | "behavior_constraints" | "current_status";

export type CharacterForm = {
  id: number | null;
  name: string;
  level: string;
  portrait: string;
  identity: string;
  goals: string;
  behavior_constraints: string;
  current_status: string;
  expected_start_chapter: number | null;
  expected_end_chapter: number | null;
};

export const emptyForm: CharacterForm = {
  id: null,
  name: "",
  level: "supporting",
  portrait: "",
  identity: "",
  goals: "",
  behavior_constraints: "",
  current_status: "",
  expected_start_chapter: null,
  expected_end_chapter: null,
};

export const LEVEL_LABELS: Record<string, string> = {
  protagonist: "主角团",
  supporting: "重要配角",
  boss: "小 Boss",
  extra: "龙套",
};

export const LONG_FIELDS: { key: LongFieldKey; label: string }[] = [
  { key: "identity", label: "身份" },
  { key: "goals", label: "目标" },
  { key: "behavior_constraints", label: "行为约束" },
  { key: "current_status", label: "当前状态" },
];

/** The one path a character document lives at (DECISIONS D-15). */
export const NEW_CHARACTER_PATH = "settings/characters/new.md";
export const characterDocPath = (id: number | null) =>
  id === null ? NEW_CHARACTER_PATH : `settings/characters/${id}.md`;
export const isCharacterDoc = (path: string) =>
  /^settings\/characters\/[0-9]{1,6}\.md$/.test(path);
export const characterDocId = (path: string) => {
  const m = /^settings\/characters\/([0-9]{1,6})\.md$/.exec(path);
  return m ? Number(m[1]) : null;
};

const BULLET = /^-\s+\*\*(.+?)\*\*\s*[：:]\s*(.*)$/;
const HEADING = /^##\s+(.*)$/;

/** Read the form back out of the document, so the card shows what the buffer holds -
 *  including words nobody has saved yet. A rendered view that hides the reader's own
 *  edits makes the toggle lie about what it switched. */
export function formFromCharacterDoc(text: string): CharacterForm {
  const fields: Record<string, string> = {};
  const sections: Record<string, string> = {};
  let current: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (current) sections[current] = lines.join("\n").trim();
    lines = [];
  };

  for (const line of text.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      current = heading[1].trim();
      continue;
    }
    if (line.startsWith("# ") || line.startsWith(">")) continue;
    const bullet = BULLET.exec(line);
    // Only the bullets above the first heading are structure: a list inside 目标 is
    // the author's own prose, and it belongs in the section it sits in.
    if (bullet && !current) {
      fields[bullet[1].trim()] = bullet[2].trim();
      continue;
    }
    if (current) lines.push(line);
  }
  flush();

  const num = (value: string | undefined) => {
    const digits = /^(-?[0-9]+)/.exec((value ?? "").trim());
    return digits ? Number(digits[1]) : null;
  };

  return {
    ...emptyForm,
    name: fields["姓名"] ?? "",
    level: fields["分级"] ?? emptyForm.level,
    expected_start_chapter: num(fields["起始章"]),
    expected_end_chapter: num(fields["结束章"]),
    identity: sections["身份"] ?? "",
    goals: sections["目标"] ?? "",
    behavior_constraints: sections["行为约束"] ?? "",
    current_status: sections["当前状态"] ?? "",
  };
}

function setBullet(text: string, label: string, value: string): string {
  const re = new RegExp("^- \\*\\*" + label + "\\*\\*：[^\\n]*", "m");
  return re.test(text) ? text.replace(re, "- **" + label + "**：" + value) : text;
}

/** The document is the projection the server renders, so the card edits that text in
 *  place instead of deriving a second format. Anything the writer does not recognise
 *  comes back as a structure error, which is the point.
 *  The four long sections are deliberately not written from here: a snapshot saved
 *  after someone edited the file would overwrite their work with stale text, so long
 *  fields belong to the source editor (帧 26). */
export function fillCharacterDoc(text: string, form: CharacterForm): string {
  let out = text;
  out = setBullet(out, "姓名", form.name.trim());
  out = setBullet(out, "分级", form.level);
  out = setBullet(out, "起始章", form.expected_start_chapter === null ? "—" : String(form.expected_start_chapter));
  out = setBullet(out, "结束章", form.expected_end_chapter === null ? "—" : String(form.expected_end_chapter));
  return out;
}

type Props = {
  value: CharacterForm;
  onChange: (next: CharacterForm) => void;
  onSave: () => void;
  onCancel?: () => void;
  /** Omitted when the host has no portrait to show yet (a new character). */
  onPickPortrait: (file: File) => void;
  onRemovePortrait: () => void;
  onEditLongField: (field: LongFieldKey) => void;
  busy?: boolean;
  error?: string | null;
  /** Dialog chrome only - the inline card has no title and no close box. */
  title?: string;
  onClose?: () => void;
  /** Anything the host wants beside the save button (the dialog's delete step). */
  extra?: ReactNode;
};

export default function CharacterFormCard({
  value,
  onChange,
  onSave,
  onCancel,
  onPickPortrait,
  onRemovePortrait,
  onEditLongField,
  busy = false,
  error = null,
  title,
  onClose,
  extra,
}: Props) {
  const portraitRef = useRef<HTMLInputElement>(null);
  const range = value.expected_start_chapter ?? value.expected_end_chapter;

  return (
    <div className="character-modal" role={onClose ? "dialog" : undefined} aria-modal={onClose ? true : undefined} aria-label={title ?? "人物卡片"}>
      {onClose ? (
        <header>
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
      ) : null}
      <div className="modal-grid">
        <div className="modal-profile">
          <div className="portrait-field">
            <span className="avatar large" aria-hidden="true">
              {value.portrait ? (
                <img src={value.portrait} alt={`${value.name || "新人物"} 照片`} />
              ) : (
                value.name.charAt(0) || "?"
              )}
            </span>
            <div className="portrait-actions">
              <button
                type="button"
                className="portrait-button"
                onClick={() => portraitRef.current?.click()}
              >
                {value.portrait ? "更换照片" : "贴照片"}
              </button>
              {value.portrait ? (
                <button type="button" className="ghost-danger" onClick={onRemovePortrait}>
                  移除
                </button>
              ) : null}
            </div>
            <input
              ref={portraitRef}
              type="file"
              accept="image/*"
              className="portrait-input"
              aria-label="上传人物照片"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onPickPortrait(file);
                event.target.value = "";
              }}
            />
            <p className="portrait-hint">方形照片效果最好，2MB 以内</p>
          </div>
          <label>
            姓名
            <input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} />
          </label>
          <label>
            分级
            <select value={value.level} onChange={(event) => onChange({ ...value, level: event.target.value })}>
              {Object.entries(LEVEL_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="number-pair">
            <label>
              起始章
              <input
                type="number"
                value={value.expected_start_chapter ?? ""}
                onChange={(event) =>
                  onChange({ ...value, expected_start_chapter: event.target.value ? Number(event.target.value) : null })
                }
              />
            </label>
            <label>
              结束章
              <input
                type="number"
                value={value.expected_end_chapter ?? ""}
                onChange={(event) =>
                  onChange({ ...value, expected_end_chapter: event.target.value ? Number(event.target.value) : null })
                }
              />
            </label>
          </div>
          {range === null && !value.expected_start_chapter ? <p className="portrait-hint">未填出场章号即常驻</p> : null}
        </div>
        <div className="modal-fields">
          <p className="long-field-hint">以下为长字段：卡片上只读预览，编辑回文件层</p>
          {LONG_FIELDS.map((item) => {
            const field = value[item.key];
            return (
              <div className="long-field" key={item.key}>
                <span className="long-field-label">{item.label}</span>
                <div className="long-field-box">
                  <p className={field ? "long-field-text" : "long-field-text blank"}>{field || "—"}</p>
                  <button
                    type="button"
                    className="long-field-edit"
                    aria-label={`在文件中编辑${item.label}`}
                    title={
                      value.id === null
                        ? "先保存人物，再在文件中编辑"
                        : `在源码里定位到「${item.label}」`
                    }
                    disabled={value.id === null}
                    onClick={() => onEditLongField(item.key)}
                  >
                    <Pencil size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <footer>
        {extra}
        <span className="spacer" />
        {onCancel ? <button type="button" onClick={onCancel}>取消</button> : null}
        <button type="button" className="primary" disabled={busy} onClick={onSave}>
          保存
        </button>
      </footer>
      {error ? <p className="status-error">{error}</p> : null}
    </div>
  );
}
