import { useState } from "react";
import { CommitPushButton } from "~/components/views/CommitPushButton";

export function CommitBar({ projectId }: { projectId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        padding: 12,
        background: "var(--surface-1)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {error && (
        <div
          style={{
            color: "var(--status-failed)",
            fontFamily: "var(--mono)",
            fontSize: 11,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {error}
        </div>
      )}
      {notice && !error && (
        <div
          style={{
            color: "var(--text-dim)",
            fontFamily: "var(--mono)",
            fontSize: 11,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {notice}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1 }} />
        <CommitPushButton
          projectId={projectId}
          onError={(m) => {
            setError(m);
            setNotice(null);
          }}
          onNotice={(m) => {
            setNotice(m);
            setError(null);
          }}
        />
      </div>
    </div>
  );
}
