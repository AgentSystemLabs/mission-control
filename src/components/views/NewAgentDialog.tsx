import { useEffect, useState } from "react";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { TextField } from "~/components/ui/TextField";
import { Icon } from "~/components/ui/Icon";
import { Kbd, hotkeyLabel } from "~/components/ui/Kbd";
import { isEditableTarget, useHotkey } from "~/lib/use-hotkey";
import { AGENT_META } from "~/lib/design-meta";
import { getElectron } from "~/lib/electron";
import type { Project, TaskAgent } from "~/db/schema";

export function NewAgentDialog({
  open,
  project,
  onClose,
  onStart,
}: {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onStart: (data: { agent: TaskAgent; title: string; branch: string }) => Promise<void> | void;
}) {
  const [agent, setAgent] = useState<TaskAgent>("claude-code");
  const [title, setTitle] = useState("");
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setAgent("claude-code");
      setTitle("");
      setBranch("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const agents: { id: TaskAgent; label: string; desc: string; cmd: string }[] = [
    {
      id: "claude-code",
      label: "Claude Code",
      desc: "Anthropic's agentic coder. Best for multi-file refactors and reasoning.",
      cmd: "claude",
    },
    {
      id: "codex",
      label: "Codex",
      desc: "OpenAI's terminal coder. Best for test-driven, narrow tasks.",
      cmd: "codex",
    },
    {
      id: "cursor-cli",
      label: "Cursor CLI",
      desc: "Cursor's background agent. Best for quick inline edits.",
      cmd: "cursor-agent",
    },
    {
      id: "shell",
      label: "Shell",
      desc: "Plain interactive shell in this project's directory.",
      cmd: "$SHELL",
    },
  ];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      const ids = agents.map((a) => a.id);
      const idx = ids.indexOf(agent);
      const next = e.key === "ArrowDown"
        ? Math.min(ids.length - 1, idx + 1)
        : Math.max(0, idx - 1);
      if (next !== idx) setAgent(ids[next]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, agent, agents]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    if (agent !== "shell") {
      const electron = getElectron();
      if (electron) {
        const cmd = AGENT_META[agent].cmd;
        const probe = await electron.cliCheck(cmd);
        if (!probe.ok) {
          setError(
            `\`${cmd}\` was not found on your PATH. Install ${AGENT_META[agent].label} or pick a different agent.`
          );
          setSubmitting(false);
          return;
        }
      }
    }
    try {
      await onStart({
        agent,
        title: title.trim() || "Untitled task",
        branch: branch.trim() || project?.branch || "main",
      });
    } catch (e: any) {
      setError(e?.message || "Failed to start agent");
    } finally {
      setSubmitting(false);
    }
  };

  useHotkey("mod+enter", () => void submit(), { enabled: open });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start a new agent"
      width={540}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" icon="play" onClick={submit} disabled={submitting}>
            Start agent
            <Kbd variant="onPrimary">{hotkeyLabel("mod+enter")}</Kbd>
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            background: "var(--surface-0)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            color: "var(--text-dim)",
          }}
        >
          <Icon name="folder" size={12} style={{ color: "var(--text-faint)" }} />
          <span>cd</span>
          <span style={{ color: "var(--text)" }}>{project?.path}</span>
        </div>

        <div>
          <label
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 500,
              color: "var(--text-dim)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              display: "block",
              marginBottom: 8,
            }}
          >
            Agent
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {agents.map((a) => {
              const meta = AGENT_META[a.id];
              const selected = agent === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setAgent(a.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    textAlign: "left",
                    padding: "12px 14px",
                    background: selected ? "var(--surface-2)" : "var(--surface-0)",
                    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    color: "var(--text)",
                    boxShadow: selected ? "0 0 0 1px var(--accent)" : "none",
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      background: `${meta.color}22`,
                      border: `1px solid ${meta.color}44`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: meta.color,
                      fontSize: 15,
                      fontFamily: "var(--mono)",
                    }}
                  >
                    {meta.glyph}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{a.label}</div>
                    <div
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: "var(--text-dim)",
                        lineHeight: 1.4,
                      }}
                    >
                      {a.desc}
                    </div>
                  </div>
                  <code
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      color: "var(--text-faint)",
                      background: "var(--surface-0)",
                      padding: "3px 7px",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                    }}
                  >
                    ${a.cmd}
                  </code>
                </button>
              );
            })}
          </div>
        </div>

        <TextField
          label="Task title"
          value={title}
          onChange={setTitle}
          placeholder="Add streaming support to SSE transport"
        />
        <TextField
          label="Git branch"
          mono
          value={branch}
          onChange={setBranch}
          placeholder={project?.branch || "main"}
        />

        {error && (
          <div
            style={{
              padding: "8px 12px",
              border: "1px solid var(--status-failed)",
              background: "color-mix(in oklch, var(--status-failed) 12%, transparent)",
              borderRadius: 7,
              color: "var(--status-failed)",
              fontFamily: "var(--mono)",
              fontSize: 11.5,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
