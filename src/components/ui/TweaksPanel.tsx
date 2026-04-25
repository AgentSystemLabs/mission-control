import { useState, useEffect } from "react";
import { Icon } from "./Icon";
import { useTweaks, type Tweaks } from "~/lib/use-tweaks";

export function TweaksLauncher() {
  const [open, setOpen] = useState(false);
  const { tweaks, setTweak, reset } = useTweaks();

  // Cmd/Ctrl + . toggles the panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Tweaks (⌘.)"
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 90,
          width: 36,
          height: 36,
          borderRadius: 18,
          background: "var(--surface-1)",
          border: "1px solid var(--border-strong)",
          color: "var(--text-dim)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 14px rgba(0,0,0,0.32)",
        }}
      >
        <Icon name="sparkles" size={14} />
      </button>
      {open && (
        <TweaksPanel tweaks={tweaks} setTweak={setTweak} reset={reset} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function TweaksPanel({
  tweaks,
  setTweak,
  reset,
  onClose,
}: {
  tweaks: Tweaks;
  setTweak: <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => void;
  reset: () => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 64,
        zIndex: 91,
        width: 280,
        maxHeight: "calc(100vh - 96px)",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-1)",
        border: "1px solid var(--border-strong)",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.03) inset",
        overflow: "hidden",
        animation: "fade-up 0.12s ease-out",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-0)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text)",
          }}
        >
          Tweaks
        </span>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: 0,
            color: "var(--text-faint)",
            cursor: "pointer",
            padding: 4,
            display: "flex",
          }}
        >
          <Icon name="x" size={12} />
        </button>
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
        <Section label="Appearance" />
        <Segmented
          label="Theme"
          value={tweaks.theme}
          options={["dark", "light"]}
          onChange={(v) => setTweak("theme", v as Tweaks["theme"])}
        />
        <ColorRow
          label="Accent"
          value={tweaks.accent}
          onChange={(v) => setTweak("accent", v)}
        />
        <Segmented
          label="Density"
          value={tweaks.density}
          options={["compact", "regular", "spacious"]}
          onChange={(v) => setTweak("density", v as Tweaks["density"])}
        />
        <Segmented
          label="Activity"
          value={tweaks.activity}
          options={["shimmer", "pulse", "none"]}
          onChange={(v) => setTweak("activity", v as Tweaks["activity"])}
        />
        <button
          onClick={reset}
          style={{
            marginTop: 8,
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text-dim)",
            padding: "6px 10px",
            borderRadius: 6,
            cursor: "pointer",
            fontFamily: "var(--mono)",
            fontSize: 11,
          }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

function Section({ label }: { label: string }) {
  return (
    <div
      style={{
        fontFamily: "var(--mono)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--text-faint)",
        marginTop: 2,
      }}
    >
      {label}
    </div>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontFamily: "var(--sans)",
          fontSize: 11.5,
          color: "var(--text-dim)",
        }}
      >
        {label}
      </span>
      <div
        style={{
          display: "flex",
          padding: 2,
          background: "var(--surface-0)",
          border: "1px solid var(--border)",
          borderRadius: 7,
        }}
      >
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={{
              flex: 1,
              padding: "5px 8px",
              border: 0,
              background: value === opt ? "var(--surface-3)" : "transparent",
              color: value === opt ? "var(--text)" : "var(--text-dim)",
              borderRadius: 5,
              cursor: "pointer",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 500,
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const swatches = ["#7ce58a", "#8ab4ff", "#c792ea", "#fbbf24", "#f472b6", "#34d399", "#fb923c", "#f87171"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: "var(--sans)",
            fontSize: 11.5,
            color: "var(--text-dim)",
          }}
        >
          {label}
        </span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 36,
            height: 22,
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: "transparent",
            cursor: "pointer",
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {swatches.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            title={c}
            style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              background: c,
              border: value.toLowerCase() === c.toLowerCase() ? "2px solid var(--text)" : "2px solid transparent",
              cursor: "pointer",
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}
