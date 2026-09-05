import { useEffect, useState } from "react";

import { api } from "../api";
import { useFiles } from "../store/files";
import { useWorkbench } from "../store/workbench";
import CharacterFormCard from "./CharacterFormCard";
import { characterDocId, fillCharacterDoc, formFromCharacterDoc } from "./CharacterFormCard";
import type { CharacterForm } from "./CharacterFormCard";

/**
 * The rendered view of `settings/characters/N.md` (第十六批批注 7).
 *
 * The owner pointed at the read-only copy this used to be and asked for the card the
 * dialog already has - the one you can edit and change the photo on. So this is not a
 * second card: it is CharacterFormCard, the same component, wired to the file buffer
 * instead of to a modal snapshot.
 *
 * Text still goes through the one file writer (D-01 / D-15). A portrait is a base64
 * asset rather than prose, so it keeps its own narrow endpoint, exactly as the dialog
 * does. Long fields stay in the source editor (帧 26); the pencil jumps there.
 */
export default function CharacterDocForm({ path }: { path: string }) {
  const novelId = useWorkbench((state) => state.selectedNovelId);
  const entry = useFiles((state) => state.entries[path]);
  const setDraft = useFiles((state) => state.setDraft);
  const saveFile = useFiles((state) => state.save);
  const setView = useFiles((state) => state.setView);
  const openFile = useFiles((state) => state.open);
  const [savedPortrait, setSavedPortrait] = useState("");
  const [portraitDraft, setPortraitDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = characterDocId(path);
  const portrait = portraitDraft ?? savedPortrait;

  useEffect(() => {
    if (!novelId || id === null) return;
    let live = true;
    setPortraitDraft(null);
    // The portrait is the one part of a character that is not in the projection, so it
    // is read from the record. A failed read shows the initial, never a wrong photo.
    void api
      .get<{ id: number; portrait?: string }[]>(`/api/novels/${novelId}/characters`)
      .then((rows) => {
        if (live) setSavedPortrait(rows.find((row) => row.id === id)?.portrait ?? "");
      })
      .catch(() => {
        if (live) setSavedPortrait("");
      });
    return () => {
      live = false;
    };
  }, [novelId, id]);

  if (!entry?.doc) return null;
  const form: CharacterForm = { ...formFromCharacterDoc(entry.draft), id, portrait };

  function change(next: CharacterForm) {
    // Edit the projection in place: whatever the card does not own (the long sections,
    // every structure line) keeps its bytes exactly as they are.
    setDraft(path, fillCharacterDoc(entry!.draft, next));
    if (next.portrait !== portrait) setPortraitDraft(next.portrait);
  }

  async function save() {
    if (!novelId || id === null) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await saveFile(path);
      if (!ok) {
        setError(useFiles.getState().entries[path]?.error ?? "写入失败");
        return;
      }
      if (portraitDraft !== null && portraitDraft !== savedPortrait) {
        await api.put(`/api/novels/${novelId}/characters/${id}/portrait`, { portrait: portraitDraft });
        setSavedPortrait(portraitDraft);
        setPortraitDraft(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  function pickPortrait(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      setError("照片请控制在 2MB 以内");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setPortraitDraft(typeof reader.result === "string" ? reader.result : portraitDraft);
    reader.onerror = () => setError("读取照片失败，请换一张");
    reader.readAsDataURL(file);
  }

  return (
    <CharacterFormCard
      value={form}
      onChange={change}
      onSave={() => void save()}
      onPickPortrait={pickPortrait}
      onRemovePortrait={() => setPortraitDraft("")}
      onEditLongField={(field) => {
        // The card previews long fields; the source editor owns them. Same gesture the
        // dialog uses, one click closer here because the file is already open.
        setView(path, true);
        void openFile(path, { field });
      }}
      busy={busy}
      error={error}
    />
  );
}
