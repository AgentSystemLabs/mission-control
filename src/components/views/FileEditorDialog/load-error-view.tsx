import { Btn } from "~/components/ui/Btn";
import type { FileReadError } from "~/shared/electron-contract";

export type LoadError = FileReadError | string;

export function Status({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 24,
        fontFamily: "var(--mono)",
        fontSize: 12,
        color: "var(--text-faint)",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

export function LoadErrorView({
  kind,
  lineCount,
  onClose,
}: {
  kind: LoadError;
  lineCount?: number;
  onClose: () => void;
}) {
  let title = "Could not open file";
  let body = String(kind);
  if (kind === "too-large") {
    title = "File too large to open";
    body =
      lineCount && lineCount > 0
        ? `This file has ${lineCount.toLocaleString()} lines (limit is 1,000). If this is production code, consider splitting it up and decomposing it into smaller modules.`
        : "This file exceeds the 1,000-line / 5 MB limit. If this is production code, consider splitting it up and decomposing it into smaller modules.";
  } else if (kind === "binary") {
    title = "Binary file";
    body = "This file appears to be binary and cannot be edited as text.";
  } else if (kind === "not-found") {
    title = "File not found";
    body = "The file no longer exists on disk.";
  } else if (kind === "invalid-path") {
    title = "Invalid file path";
    body = "This path is outside the project or cannot be opened safely.";
  }
  return (
    <div
      style={{
        padding: 32,
        fontFamily: "var(--mono)",
        fontSize: 13,
        color: "var(--text)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5 }}>{body}</div>
      <Btn variant="ghost" onClick={onClose}>
        Close
      </Btn>
    </div>
  );
}
