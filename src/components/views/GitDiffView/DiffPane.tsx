import { useMemo, useRef, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Icon } from "~/components/ui/Icon";
import type { GitDiff } from "~/server/services/git";

// Row height = fontSize (12) * lineHeight (1.5) = 18px for the monospace diff rows.
const DIFF_ROW_HEIGHT = 18;

export function DiffPane({
  diff,
  loading,
  error,
  filePath,
}: {
  diff: GitDiff | undefined;
  loading: boolean;
  error: string | null;
  filePath: string | null;
}) {
  if (!filePath) {
    return (
      <Centered>
        <Icon name="git-branch" size={32} style={{ color: "var(--text-faint)" }} />
        <div style={{ marginTop: 12, color: "var(--text-dim)", fontSize: 13 }}>
          Select a file to view its diff.
        </div>
      </Centered>
    );
  }
  if (loading && !diff) {
    return <Centered><Muted>Loading diff…</Muted></Centered>;
  }
  if (error) {
    return (
      <Centered>
        <div style={{ color: "var(--status-failed)", fontFamily: "var(--mono)", fontSize: 12 }}>
          {error}
        </div>
      </Centered>
    );
  }
  if (!diff) return null;
  if (diff.kind === "empty") {
    return <Centered><Muted>No changes for this file.</Muted></Centered>;
  }
  if (diff.kind === "binary") {
    return <Centered><Muted>Binary file — diff not shown.</Muted></Centered>;
  }
  if (diff.kind === "too-large") {
    return (
      <Centered>
        <Muted>
          Diff too large to display ({diff.lines.toLocaleString()} lines,{" "}
          {(diff.bytes / 1024).toFixed(0)} KB).
        </Muted>
      </Centered>
    );
  }
  return <DiffText patch={diff.patch} />;
}

function DiffText({ patch }: { patch: string }) {
  const lines = useMemo(() => patch.split("\n"), [patch]);
  const parentRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => DIFF_ROW_HEIGHT,
    overscan: 20,
  });

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={parentRef}
      style={{
        flex: 1,
        margin: 0,
        padding: 0,
        overflow: "auto",
        fontFamily: "var(--mono)",
        fontSize: 12,
        lineHeight: `${DIFF_ROW_HEIGHT}px`,
        background: "transparent",
        color: "var(--text)",
        tabSize: 2,
        contain: "strict",
      }}
    >
      <div style={{ height: totalSize, width: "100%", position: "relative" }}>
        {items.map((item) => {
          const line = lines[item.index] ?? "";
          const style = lineStyle(line);
          return (
            <div
              key={item.key}
              data-line-index={item.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${item.start}px)`,
                height: DIFF_ROW_HEIGHT,
                padding: "0 12px",
                whiteSpace: "pre",
                ...style,
              }}
            >
              {line || " "}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function lineStyle(line: string): CSSProperties {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return { color: "var(--text-dim)", fontWeight: 600 };
  }
  if (line.startsWith("@@")) {
    return {
      color: "var(--accent, #6cd07e)",
      background: "var(--surface-1)",
    };
  }
  if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("rename ") || line.startsWith("similarity ") || line.startsWith("Binary ")) {
    return { color: "var(--text-faint)" };
  }
  if (line.startsWith("+")) {
    return { background: "rgba(108, 208, 126, 0.12)", color: "var(--text)" };
  }
  if (line.startsWith("-")) {
    return { background: "rgba(224, 107, 107, 0.12)", color: "var(--text)" };
  }
  return {};
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        padding: 32,
      }}
    >
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "var(--text-dim)", fontFamily: "var(--mono)", fontSize: 12 }}>
      {children}
    </div>
  );
}
