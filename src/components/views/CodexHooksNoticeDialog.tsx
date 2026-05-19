import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";

export const CODEX_HOOKS_NOTICE_STORAGE_KEY = "mc.codexHooksNoticeSeen";

export function hasSeenCodexHooksNotice(): boolean {
  try {
    return window.localStorage.getItem(CODEX_HOOKS_NOTICE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markCodexHooksNoticeSeen(): void {
  try {
    window.localStorage.setItem(CODEX_HOOKS_NOTICE_STORAGE_KEY, "1");
  } catch {
    /* localStorage unavailable */
  }
}

export function CodexHooksNoticeDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useHotkey("dialog.submit", () => onClose(), { enabled: open });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Approve Codex hooks"
      width={520}
      footer={
        <HotkeyTooltip action="dialog.submit">
          <Btn variant="primary" icon="check" onClick={onClose}>
            Got it
          </Btn>
        </HotkeyTooltip>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text)" }}>
          MissionControl wires Codex hooks so it can keep this session’s status
          in sync (running, waiting, stopped).
        </div>
        <div
          style={{
            padding: "10px 12px",
            background: "var(--surface-0)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            color: "var(--text-dim)",
            lineHeight: 1.5,
          }}
        >
          The first time Codex launches, it will ask you to{" "}
          <span style={{ color: "var(--text)" }}>
            manually approve these hooks
          </span>{" "}
          inside the Codex TUI. If you decline, session status updates in
          MissionControl will not work.
        </div>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--text-faint)",
            lineHeight: 1.5,
          }}
        >
          This message only shows once.
        </div>
      </div>
    </Modal>
  );
}
