// "Did you mean…" picker shown when a spoken project name matched several
// candidates. Turns a silent mis-recognition into a one-key choice: press 1–N or
// click; Esc cancels. Auto-dismisses so a forgotten picker can't linger.

import { useEffect } from "react";
import type { VoiceProject } from "~/lib/voice-intent";

const AUTO_DISMISS_MS = 10_000;

export function VoiceDisambiguation({
  query,
  candidates,
  onSelect,
  onCancel,
}: {
  query: string;
  candidates: VoiceProject[];
  onSelect: (project: VoiceProject) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= candidates.length) {
        e.preventDefault();
        e.stopPropagation();
        onSelect(candidates[n - 1]);
      }
    };
    window.addEventListener("keydown", onKey, true);
    const timer = setTimeout(onCancel, AUTO_DISMISS_MS);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(timer);
    };
  }, [candidates, onSelect, onCancel]);

  return (
    <div
      role="dialog"
      aria-label="Which project did you mean?"
      style={{
        position: "fixed",
        bottom: 60,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2147483646,
        width: 320,
        maxWidth: "90vw",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 12,
        borderRadius: 12,
        background: "color-mix(in srgb, var(--surface-0) 96%, transparent)",
        border: "1px solid var(--border)",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(10px)",
        color: "var(--text)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text-dim)", padding: "2px 4px 6px" }}>
        Did you mean… <span style={{ fontStyle: "italic" }}>&ldquo;{query}&rdquo;</span>
      </div>
      {candidates.map((p, i) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 10px",
            background: "var(--surface-1, var(--surface-0))",
            border: "1px solid var(--border)",
            borderRadius: 8,
            cursor: "pointer",
            textAlign: "left",
            color: "var(--text)",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 20,
              height: 20,
              borderRadius: 6,
              background: "var(--accent-dim)",
              border: "1px solid var(--accent-border)",
              color: "var(--accent)",
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {i + 1}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
        </button>
      ))}
      <div style={{ fontSize: 11, color: "var(--text-faint)", padding: "4px 4px 0" }}>
        Press 1–{candidates.length} or Esc
      </div>
    </div>
  );
}
