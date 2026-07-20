import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "~/components/ui/Modal";
import { api, ApiError } from "~/lib/api";
import type { ScratchPadTarget } from "~/lib/scratch-pad-store";
import { enqueueScratchPadSave, scratchPadSavesSettled } from "~/lib/scratch-pad-save-queue";
import { queryKeys, useScratchPads } from "~/queries";
import { SCRATCH_PAD_CONTENT_MAX, type ScratchPadView } from "~/shared/scratch-pads";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const SAVE_DEBOUNCE_MS = 500;

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  dirty: "Unsaved…",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — retrying on next edit",
};

// Crash net: the buffer mirrors to localStorage while dirty and clears on a
// successful save, so an app crash or a failed final flush can't silently drop
// pasted text — the next open of this project's pad restores the draft.
type Draft = { padId: string | null; content: string; ts: number };

function draftKey(projectId: string): string {
  return `mc-scratch-pad-draft:${projectId}`;
}

function readDraft(projectId: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    return typeof parsed?.content === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function writeDraft(projectId: string, draft: Draft): void {
  try {
    localStorage.setItem(draftKey(projectId), JSON.stringify(draft));
  } catch {
    // Quota/private-mode failures just lose the crash net, not the save path.
  }
}

function clearDraft(projectId: string): void {
  try {
    localStorage.removeItem(draftKey(projectId));
  } catch {
    // ignore
  }
}

/**
 * The scratch-pad editor: one textarea over a per-project pad row. Pads are
 * created lazily — nothing is written until the buffer has content — and edits
 * autosave debounced through the module-level per-project save queue, with a
 * final flush on close/unmount, so there is no explicit save button and no
 * empty rows accumulate from idle toggles.
 */
export function ScratchPadModal({
  projectId,
  target,
  onClose,
}: {
  projectId: string;
  target: ScratchPadTarget;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: pads, isError: loadFailed } = useScratchPads(projectId);

  const [ready, setReady] = useState(false);
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // The previous instance's final flush must land (and update the cache)
  // before this instance decides which pad it is editing.
  const [priorSavesSettled, setPriorSavesSettled] = useState(false);

  const padIdRef = useRef<string | null>(null);
  const lastSavedRef = useRef<string>("");
  const readyRef = useRef(false);
  const contentRef = useRef("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  contentRef.current = content;

  useEffect(() => {
    let cancelled = false;
    void scratchPadSavesSettled(projectId).then(() => {
      if (!cancelled) setPriorSavesSettled(true);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Resolve the target pad once prior saves settled and the list is available.
  // If the list can't load, fall back to a fresh buffer so pasting still works.
  useEffect(() => {
    if (ready || !priorSavesSettled) return;
    const failed = loadFailed && target.type !== "new";
    if (!failed && target.type !== "new" && !pads) return;

    const row = failed
      ? undefined
      : target.type === "pad"
        ? pads?.find((p) => p.id === target.padId)
        : target.type === "latest"
          ? pads?.[0]
          : undefined;
    padIdRef.current = row?.id ?? null;
    lastSavedRef.current = row?.content ?? "";
    let text = row?.content ?? "";

    // Restore a crashed/unflushed draft when it's newer than what the server
    // has and belongs to this buffer. An explicit "new" pad stays blank.
    const draft = target.type === "new" ? null : readDraft(projectId);
    const draftMatchesTarget =
      draft !== null && (target.type === "latest" || draft.padId === padIdRef.current);
    if (
      draft &&
      draftMatchesTarget &&
      draft.content !== text &&
      draft.ts > (row?.updatedAt ?? 0)
    ) {
      if (draft.padId && draft.padId !== padIdRef.current) {
        padIdRef.current = draft.padId;
        lastSavedRef.current = "";
      }
      text = draft.content;
    }

    setContent(text);
    setSaveState(text === lastSavedRef.current ? "idle" : "dirty");
    setReady(true);
    readyRef.current = true;
  }, [ready, priorSavesSettled, target, pads, loadFailed, projectId]);

  useEffect(() => {
    if (ready) textareaRef.current?.focus();
  }, [ready]);

  const flush = useCallback(
    (text: string) => {
      void enqueueScratchPadSave(projectId, async () => {
        if (lastSavedRef.current === text && padIdRef.current) return;
        const save = async (): Promise<ScratchPadView | null> => {
          if (!padIdRef.current) {
            if (!text) return null;
            const { scratchPad } = await api.createScratchPad(projectId, { content: text });
            padIdRef.current = scratchPad.id;
            return scratchPad;
          }
          const { scratchPad } = await api.updateScratchPad(projectId, padIdRef.current, {
            content: text,
          });
          return scratchPad;
        };
        try {
          setSaveState("saving");
          let saved: ScratchPadView | null;
          try {
            saved = await save();
          } catch (e) {
            // Pad deleted elsewhere (second window): recreate it from the
            // buffer instead of error-looping PATCHes against a dead id.
            if (e instanceof ApiError && e.status === 404 && padIdRef.current) {
              padIdRef.current = null;
              saved = await save();
            } else {
              throw e;
            }
          }
          lastSavedRef.current = text;
          if (saved) {
            queryClient.setQueryData<ScratchPadView[]>(
              queryKeys.scratchPads(projectId),
              (old) => [saved, ...(old ?? []).filter((p) => p.id !== saved.id)],
            );
          }
          if (contentRef.current === text || !readyRef.current) {
            clearDraft(projectId);
            setSaveState("saved");
          } else {
            setSaveState("dirty");
          }
        } catch {
          setSaveState("error");
        }
      });
    },
    [projectId, queryClient],
  );

  // Debounced autosave while typing, mirroring the buffer to the draft stash.
  useEffect(() => {
    if (!ready) return;
    if (content === lastSavedRef.current) return;
    setSaveState("dirty");
    writeDraft(projectId, { padId: padIdRef.current, content, ts: Date.now() });
    const timer = setTimeout(() => flush(content), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [ready, content, flush, projectId]);

  // Final flush when the modal closes or the target switches (remount). The
  // ready gate keeps a mount-abort (e.g. StrictMode-style double-invoke) from
  // flushing a buffer that was never initialized.
  useEffect(() => {
    return () => {
      if (readyRef.current) flush(contentRef.current);
    };
  }, [flush]);

  return (
    <Modal
      open
      onClose={onClose}
      title="Scratch pad"
      width={640}
      height="70vh"
      contentStyle={{ display: "flex", flexDirection: "column" }}
      footer={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: saveState === "error" ? "var(--danger, #e5484d)" : "var(--text-faint)",
          }}
        >
          <span>
            {loadFailed
              ? "Couldn't load existing pads — this buffer will save as a new pad"
              : "Scoped to this project · autosaves as you type"}
          </span>
          <span aria-live="polite">{SAVE_LABEL[saveState]}</span>
        </div>
      }
    >
      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          background: "var(--surface-0)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          overflow: "hidden",
        }}
      >
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, SCRATCH_PAD_CONTENT_MAX))}
          placeholder={ready ? "Paste or type anything — it's saved for this project." : "Loading…"}
          disabled={!ready}
          aria-label="Scratch pad content"
          style={{
            flex: 1,
            resize: "none",
            background: "transparent",
            border: 0,
            outline: 0,
            color: "var(--text)",
            padding: "10px 12px",
            fontFamily: "var(--mono)",
            fontSize: 12.5,
            lineHeight: 1.55,
          }}
        />
      </div>
    </Modal>
  );
}
