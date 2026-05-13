import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { StaticHotkeyTooltip } from "~/components/ui/Tooltip";
import { useHotkey } from "~/lib/use-hotkey";
import {
  fetchLatestSkillsManifest,
  runInstallSkills,
} from "~/lib/install-skills-client";
import type { LatestSkillsManifest } from "~/shared/electron-contract";

type Phase = "idle" | "downloading" | "extracting" | "done";

export function InstallSkillsModal({
  open,
  onClose,
  projectPath,
}: {
  open: boolean;
  onClose: () => void;
  projectPath: string;
}) {
  const queryClient = useQueryClient();
  const [installClaude, setInstallClaude] = useState(true);
  const [installCodex, setInstallCodex] = useState(true);
  const [manifest, setManifest] = useState<LatestSkillsManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [manifestAttempt, setManifestAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    setInstallClaude(true);
    setInstallCodex(true);
    setManifest(null);
    setManifestError(null);
    setPhase("idle");
    setError(null);
    setNotice(null);
    setManifestAttempt(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setManifestError(null);
    fetchLatestSkillsManifest()
      .then((m) => {
        if (!controller.signal.aborted) setManifest(m);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setManifestError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      controller.abort();
    };
  }, [open, manifestAttempt]);

  const retryManifest = useCallback(() => {
    setManifest(null);
    setManifestError(null);
    setManifestAttempt((n) => n + 1);
  }, []);

  const isWorking = phase === "downloading" || phase === "extracting";
  const harnessSelected = installClaude || installCodex;
  const canInstall = open && !isWorking && harnessSelected && !!projectPath;

  const submit = async () => {
    if (!canInstall) return;
    setError(null);
    setNotice(null);
    setPhase("downloading");
    try {
      // The main process does fetch-then-extract in one IPC; simulate the
      // two-state UX by flipping to "extracting" after a brief delay so
      // users see motion. Real progress events would require streaming IPC.
      const extractTimer = setTimeout(() => setPhase("extracting"), 600);
      const result = await runInstallSkills({
        projectPath,
        harnesses: { claude: installClaude, codex: installCodex },
      });
      clearTimeout(extractTimer);
      // Refresh the freshness check so the InstallSkillsButton can hide /
      // relabel itself immediately after a successful install.
      void queryClient.invalidateQueries({ queryKey: ["skills-installed", projectPath] });
      void queryClient.invalidateQueries({ queryKey: ["skills-latest"] });
      setPhase("done");
      setNotice(
        `Installed ${result.skillCount} skill${result.skillCount === 1 ? "" : "s"} (v${result.version})`,
      );
      // close after a short beat so success message reads
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useHotkey(
    "mod+enter",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      void submit();
    },
    { enabled: canInstall },
  );

  const phaseLabel =
    phase === "downloading"
      ? "Downloading…"
      : phase === "extracting"
        ? "Extracting…"
        : phase === "done"
          ? "Done"
          : null;

  return (
    <Modal
      open={open}
      onClose={isWorking ? () => {} : onClose}
      title="Install Skills"
      width={460}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={isWorking}>
            Cancel
          </Btn>
          <StaticHotkeyTooltip hotkey="⌘ Enter" disabled={!canInstall}>
            <Btn
              variant="primary"
              onClick={() => void submit()}
              disabled={!canInstall}
              title={
                !harnessSelected
                  ? "Select at least one harness"
                  : !projectPath
                    ? "No project selected"
                    : undefined
              }
            >
              {isWorking ? phaseLabel ?? "Installing…" : "Install"}
            </Btn>
          </StaticHotkeyTooltip>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
          Install the AgentSystem skills bundle into this project. Existing skills
          shipped by the bundle are overwritten cleanly; your custom skills are
          left untouched.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <CheckRow
            label="Claude Code"
            sub=".claude/skills/"
            checked={installClaude}
            onChange={setInstallClaude}
            disabled={isWorking}
          />
          <CheckRow
            label="Codex"
            sub=".codex/skills/"
            checked={installCodex}
            onChange={setInstallCodex}
            disabled={isWorking}
          />
        </div>

        <div
          style={{
            fontSize: 11.5,
            color: "var(--text-faint)",
            fontFamily: "var(--mono)",
            minHeight: 16,
          }}
        >
          {manifest
            ? `Latest: v${manifest.version}`
            : manifestError
              ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span>Could not reach academy: {manifestError}</span>
                    <Btn
                      variant="ghost"
                      size="sm"
                      icon="refresh"
                      onClick={retryManifest}
                      disabled={isWorking}
                    >
                      Retry
                    </Btn>
                  </span>
                )
              : "Checking latest version…"}
        </div>

        {phaseLabel && phase !== "done" && (
          <div
            role="status"
            style={{
              fontSize: 12.5,
              color: "var(--text-dim)",
              padding: "8px 10px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface-1)",
            }}
          >
            {phaseLabel}
          </div>
        )}
        {notice && (
          <div
            role="status"
            style={{
              fontSize: 12.5,
              color: "var(--text)",
              padding: "8px 10px",
              border: "1px solid var(--accent-border, var(--border))",
              borderRadius: 6,
              background: "var(--accent-dim, var(--surface-1))",
            }}
          >
            {notice}
          </div>
        )}
        {error && (
          <div
            role="alert"
            style={{
              fontSize: 12.5,
              color: "var(--status-failed)",
              padding: "8px 10px",
              border: "1px solid rgba(239, 68, 68, 0.45)",
              borderRadius: 6,
              background: "rgba(239, 68, 68, 0.08)",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function CheckRow({
  label,
  sub,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  sub: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 11px",
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--surface-0)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--accent)", width: 14, height: 14 }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13, color: "var(--text)" }}>{label}</span>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-faint)",
            fontFamily: "var(--mono)",
          }}
        >
          {sub}
        </span>
      </span>
    </label>
  );
}
