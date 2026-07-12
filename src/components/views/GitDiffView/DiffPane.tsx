import { useMemo, type CSSProperties } from "react";
import { Icon } from "~/components/ui/Icon";
import type { GitDiff } from "~/server/services/git";

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

// Render the diff in fixed-size chunks, each an off-screen-skippable box via
// content-visibility. This keeps mount cost and style-recalc flat on huge diffs
// without virtualization: skipped chunks reserve HEIGHT through
// contain-intrinsic-height (line count × row height) instead of laying out their
// rows. Only the height axis is constrained — the shorthand contain-intrinsic-size
// with a single `auto <length>` pair applies that length to BOTH axes, which
// pins offscreen chunks to a fixed WIDTH and forces a spurious horizontal
// scrollbar / scroll-range jitter on long-but-narrow diffs. The longhand leaves
// width free so it still resolves from content. width:max-content + minWidth:100%
// is load-bearing — under the paint containment content-visibility applies, a
// plain block would clip long lines to the container width, so we let each chunk
// grow to its widest line while still filling the pane. Native text selection and
// copy span all chunks because the rows remain real DOM inside a single <pre>.
const DIFF_CHUNK_SIZE = 100;
const DIFF_LINE_HEIGHT = 18;

function DiffText({ patch }: { patch: string }) {
  const chunks = useMemo(() => {
    const lines = patch.split("\n");
    const result: string[][] = [];
    for (let i = 0; i < lines.length; i += DIFF_CHUNK_SIZE) {
      result.push(lines.slice(i, i + DIFF_CHUNK_SIZE));
    }
    return result;
  }, [patch]);
  return (
    <pre
      style={{
        flex: 1,
        margin: 0,
        padding: 0,
        overflow: "auto",
        fontFamily: "var(--mono)",
        fontSize: 12,
        lineHeight: 1.5,
        background: "transparent",
        color: "var(--text)",
        whiteSpace: "pre",
        tabSize: 2,
      }}
    >
      {chunks.map((chunk, chunkIndex) => (
        <div
          key={chunkIndex}
          style={{
            contentVisibility: "auto",
            containIntrinsicHeight: `auto ${chunk.length * DIFF_LINE_HEIGHT}px`,
            width: "max-content",
            minWidth: "100%",
          }}
        >
          {chunk.map((line, i) => {
            const style = lineStyle(line);
            return (
              <div
                key={i}
                style={{
                  display: "block",
                  padding: "0 12px",
                  ...style,
                }}
              >
                {line || " "}
              </div>
            );
          })}
        </div>
      ))}
    </pre>
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
