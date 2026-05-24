import { useEffect, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { Textarea } from "~/components/ui/Textarea";
import { HotkeyTooltip, StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import {
  OPEN_SETTINGS_EVENT,
  type OpenSettingsEventDetail,
} from "~/lib/design-meta";
import { COMMIT_CLI_LABEL, type CommitCli } from "~/shared/commit-cli";

export type ShipFailedDialogState = {
  open: boolean;
  /** Which CLI was tried when generation failed (when known). */
  cli: CommitCli | null;
  /** Human-readable error from the server (already includes the CLI name). */
  message: string;
  /** Raw stderr from the spawned CLI, if any — shown inside a collapsible block. */
  stderr?: string;
  /** Distinguishes "CLI generated bad output" from "no CLI installed at all". */
  kind: "commit-generation-failed" | "no-commit-cli" | "other";
};

export const SHIP_FAILED_INITIAL: ShipFailedDialogState = {
  open: false,
  cli: null,
  message: "",
  kind: "other",
};

export function ShipFailedDialog({
  state,
  onClose,
  onManualCommit,
  busy,
  shipPhase = "committing",
}: {
  state: ShipFailedDialogState;
  onClose: () => void;
  /** Called with the typed commit message — parent commits + pushes. */
  onManualCommit: (message: string) => Promise<void> | void;
  busy: boolean;
  shipPhase?: "committing" | "pushing" | null;
}) {
  const [draft, setDraft] = useState("");

  // Reset the textarea every time the dialog opens so a previous failure's
  // draft doesn't leak into a fresh one.
  useEffect(() => {
    if (state.open) setDraft("");
  }, [state.open]);

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  const submit = () => {
    if (!canSubmit) return;
    void onManualCommit(trimmed);
  };

  useHotkey(
    "mod+enter",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      submit();
    },
    { enabled: state.open && canSubmit },
  );

  const openCommitCliSettings = () => {
    const detail: OpenSettingsEventDetail = { panel: "defaults" };
    window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail }));
    onClose();
  };

  const cliLabel = state.cli ? COMMIT_CLI_LABEL[state.cli] : null;
  const title =
    state.kind === "no-commit-cli"
      ? "No commit CLI installed"
      : state.kind === "other"
        ? "Commit failed"
        : "Couldn't generate commit message";
  const alertHeading =
    state.kind === "no-commit-cli"
      ? "None of the supported CLI tools were found on your PATH."
      : state.kind === "other"
        ? "The commit attempt failed."
        : `Ship tried to use ${cliLabel ?? "the configured CLI"} to write a commit message and it failed.`;

  return (
    <Modal
      open={state.open}
      // Guard against backdrop/Esc dismiss while the manual commit is mid-flight —
      // a silent close would orphan an in-progress git commit.
      onClose={busy ? () => {} : onClose}
      title={title}
      width={560}
      footer={
        <>
          <StaticHotkeyTooltip hotkey="Esc">
            <Btn variant="ghost" onClick={onClose} disabled={busy}>
              Dismiss
            </Btn>
          </StaticHotkeyTooltip>
          <Btn variant="ghost" icon="settings" onClick={openCommitCliSettings} disabled={busy}>
            Open Settings
          </Btn>
          <HotkeyTooltip action="dialog.submit">
            <Btn
              variant="primary"
              icon="upload"
              onClick={submit}
              disabled={!canSubmit}
            >
              {busy
                ? shipPhase === "pushing"
                  ? "Pushing…"
                  : "Committing…"
                : "Commit with this message"}
            </Btn>
          </HotkeyTooltip>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          role="alert"
          style={{
            padding: "10px 12px",
            borderRadius: 7,
            background: "color-mix(in srgb, var(--status-failed) 12%, transparent)",
            border:
              "1px solid color-mix(in srgb, var(--status-failed) 40%, transparent)",
            color: "var(--text)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{alertHeading}</div>
          <div style={{ color: "var(--text-dim)" }}>
            {state.message}
          </div>
          {state.stderr && (
            <details style={{ marginTop: 8 }}>
              <summary
                style={{
                  cursor: "pointer",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                show CLI stderr
              </summary>
              <pre
                style={{
                  marginTop: 6,
                  padding: 10,
                  background: "var(--surface-0)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--text-dim)",
                  whiteSpace: "pre-wrap",
                  maxHeight: 160,
                  overflow: "auto",
                }}
              >
                {state.stderr}
              </pre>
            </details>
          )}
        </div>

        <Textarea
          label="Manual commit message"
          value={draft}
          onChange={setDraft}
          rows={5}
          mono
          placeholder={"chore: write your commit message here\n\nThis bypasses the AI step and runs `git commit -m` directly."}
          hint="Tip: change the default CLI in Settings → Defaults so the next ship doesn't hit the same wall."
        />
      </div>
    </Modal>
  );
}
