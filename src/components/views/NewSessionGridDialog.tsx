import { useEffect, useState } from "react";
import { AgentLogo } from "~/components/ui/AgentLogo";
import { Btn } from "~/components/ui/Btn";
import { Modal } from "~/components/ui/Modal";
import { agentCanLaunch, type CliAvailabilityMap } from "~/lib/cli-availability";
import { AGENT_REGISTRY, UI_AGENTS } from "~/shared/agents";
import type { TaskAgent } from "~/shared/domain";

// Bounds of the shape picker. 4×3 (12 sessions) is deliberately the ceiling —
// every cell is a live PTY, and a grid past that stops being readable.
const MAX_COLS = 4;
const MAX_ROWS = 3;

/**
 * Batch session launcher for grid view: sweep the rows×columns matrix to pick
 * a shape (like a table-insert control — hover previews, click commits), pick
 * the agent, and every session in the shape starts at once. The chosen column
 * count becomes the scope's sessions-per-row lock so the batch actually lands
 * in that shape (and later sessions keep following it).
 */
export function NewSessionGridDialog({
  open,
  onClose,
  cliAvailability,
  defaultAgent,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  cliAvailability: CliAvailabilityMap;
  /** Pre-selected agent (the project's remembered one), when launchable. */
  defaultAgent?: TaskAgent | null;
  onCreate: (opts: { agent: TaskAgent; rows: number; cols: number }) => void;
}) {
  const [shape, setShape] = useState<{ rows: number; cols: number }>({ rows: 2, cols: 2 });
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null);
  const [agent, setAgent] = useState<TaskAgent>("claude-code");

  // Re-seed the picker each time it opens: default 2×2, and the remembered
  // agent when it can actually launch (else the first launchable one).
  useEffect(() => {
    if (!open) return;
    setShape({ rows: 2, cols: 2 });
    setHover(null);
    const preferred =
      defaultAgent && agentCanLaunch(cliAvailability, defaultAgent)
        ? defaultAgent
        : UI_AGENTS.find((a) => agentCanLaunch(cliAvailability, a));
    setAgent(preferred ?? "claude-code");
  }, [open, defaultAgent, cliAvailability]);

  const active = hover ?? shape;
  const count = active.rows * active.cols;
  const agentLaunchable = agentCanLaunch(cliAvailability, agent);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New session grid"
      width={400}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            variant="primary"
            icon="plus"
            disabled={!agentLaunchable}
            onClick={() => {
              onClose();
              onCreate({ agent, rows: shape.rows, cols: shape.cols });
            }}
          >
            {`Start ${shape.rows * shape.cols} session${shape.rows * shape.cols === 1 ? "" : "s"}`}
          </Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: 13, color: "var(--text)" }}>Shape</span>
            <span
              aria-live="polite"
              style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-dim)" }}
            >
              {active.cols} × {active.rows} — {count} session{count === 1 ? "" : "s"}
            </span>
          </div>
          <div
            role="grid"
            aria-label="Grid shape"
            onMouseLeave={() => setHover(null)}
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${MAX_COLS}, 44px)`,
              gap: 6,
              justifyContent: "start",
            }}
          >
            {Array.from({ length: MAX_ROWS }).flatMap((_, r) =>
              Array.from({ length: MAX_COLS }).map((_, c) => {
                const inActive = r < active.rows && c < active.cols;
                const inSelected = r < shape.rows && c < shape.cols;
                return (
                  <button
                    key={`${r}-${c}`}
                    type="button"
                    aria-label={`${c + 1} by ${r + 1} — ${(c + 1) * (r + 1)} sessions`}
                    aria-pressed={shape.rows === r + 1 && shape.cols === c + 1}
                    onMouseEnter={() => setHover({ rows: r + 1, cols: c + 1 })}
                    onFocus={() => setHover({ rows: r + 1, cols: c + 1 })}
                    onBlur={() => setHover(null)}
                    onClick={() => setShape({ rows: r + 1, cols: c + 1 })}
                    style={{
                      height: 34,
                      borderRadius: 7,
                      cursor: "pointer",
                      border: inActive
                        ? "1px solid var(--accent)"
                        : "1px solid var(--border)",
                      background: inActive
                        ? "color-mix(in srgb, var(--accent) 18%, transparent)"
                        : "var(--surface-1)",
                      // The committed shape keeps a fill while previewing a
                      // different one, so the click target stays readable.
                      opacity: !inActive && inSelected ? 0.75 : 1,
                      transition: "background 80ms ease, border-color 80ms ease",
                    }}
                  />
                );
              }),
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--text)" }}>Agent</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {UI_AGENTS.map((a) => {
              const selected = agent === a;
              const canLaunch = agentCanLaunch(cliAvailability, a);
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => canLaunch && setAgent(a)}
                  disabled={!canLaunch}
                  aria-pressed={selected}
                  title={
                    canLaunch
                      ? AGENT_REGISTRY[a].label
                      : `${AGENT_REGISTRY[a].label} is not installed`
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 10px",
                    borderRadius: 8,
                    fontSize: 12,
                    cursor: canLaunch ? "pointer" : "not-allowed",
                    border: selected
                      ? "1px solid var(--accent)"
                      : "1px solid var(--border)",
                    background: selected
                      ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                      : "var(--surface-1)",
                    color: selected ? "var(--text)" : "var(--text-dim)",
                    opacity: canLaunch ? 1 : 0.45,
                  }}
                >
                  <AgentLogo agent={a} size={16} title={AGENT_REGISTRY[a].label} />
                  {AGENT_REGISTRY[a].label}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
          Sessions start on the project&rsquo;s current branch and the grid locks to{" "}
          {shape.cols} per row — new sessions keep filling rows of {shape.cols}.
        </div>
      </div>
    </Modal>
  );
}
