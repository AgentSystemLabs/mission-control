import { useEffect, useRef } from "react";
import { Icon } from "~/components/ui/Icon";
import { sandboxProvisioningStatusCopy } from "~/lib/use-remote-vm-deploy-for-sandbox";
import type { RemoteVmDeployJobSnapshot } from "~/shared/electron-contract";

export function SandboxProvisioningState({
  name,
  deployJob,
  deployLogText,
  remoteStatus,
}: {
  name: string;
  deployJob: RemoteVmDeployJobSnapshot | null;
  deployLogText: string;
  remoteStatus: string | null;
}) {
  const logRef = useRef<HTMLPreElement>(null);
  const statusCopy = sandboxProvisioningStatusCopy(remoteStatus, deployJob);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [deployLogText]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Provisioning ${name}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px 20px 40px",
        gap: 18,
        maxWidth: 720,
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          color: "var(--accent)",
          animation: "spin 0.8s linear infinite",
        }}
      >
        <Icon name="refresh" size={30} />
      </span>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
          Provisioning {name}…
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text-dim)",
            fontFamily: "var(--mono)",
            lineHeight: 1.5,
          }}
        >
          {statusCopy}. Sessions will appear here once the cloud sandbox is ready.
        </div>
      </div>

      <div
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "var(--text-dim)",
          }}
        >
          AWS deploy logs
        </div>
        <pre
          ref={logRef}
          role="log"
          aria-label="AWS deploy logs"
          aria-relevant="additions text"
          tabIndex={0}
          style={{
            margin: 0,
            width: "100%",
            minHeight: 180,
            maxHeight: 320,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            color: "var(--text-dim)",
            fontFamily: "var(--mono)",
            fontSize: 11,
            lineHeight: 1.45,
            boxSizing: "border-box",
          }}
        >
          {deployLogText ||
            "Waiting for deploy output…\n\nMission Control will stream AWS provisioning steps here as they run."}
        </pre>
      </div>
    </div>
  );
}
