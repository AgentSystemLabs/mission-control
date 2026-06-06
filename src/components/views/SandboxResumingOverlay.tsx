import { Icon } from "~/components/ui/Icon";

/**
 * Full-cover overlay shown over the route content while the active sandbox's
 * remote VM is resuming. Replaces the dashboard with a centered spinner and
 * captures all pointer events so none of the (not-yet-usable) dashboard controls
 * underneath can be clicked until the instance is back up. Mount inside a
 * `position: relative` container so `inset: 0` covers exactly the route area.
 */
export function SandboxResumingOverlay({ name }: { name: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Resuming ${name}`}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        textAlign: "center",
        background: "var(--surface-0)",
        // Capture every click/scroll so the dashboard underneath stays inert.
        pointerEvents: "auto",
      }}
    >
      <span
        aria-hidden
        style={{ display: "inline-flex", color: "var(--accent)", animation: "spin 0.8s linear infinite" }}
      >
        <Icon name="refresh" size={30} />
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 360 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Resuming {name}…</p>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
          Starting the cloud instance and reconnecting the agent. The workspace will be ready in a few seconds.
        </p>
      </div>
    </div>
  );
}
