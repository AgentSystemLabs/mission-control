import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "@tanstack/react-router";
import { Modal } from "~/components/ui/Modal";
import { Icon } from "~/components/ui/Icon";
import { SessionIcon } from "~/components/ui/SessionIcon";
import { AgentGlyph } from "~/components/ui/AgentGlyph";
import { Kbd } from "~/components/ui/Kbd";
import { usePromptSearch } from "~/queries";
import { requestSessionOpenById } from "~/lib/session-notification-store";
import type { PromptSearchResult } from "~/shared/prompts";

const DEBOUNCE_MS = 150;

// Compact relative time for a result's timestamp.
function formatWhen(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

// Single-line preview: collapse whitespace so multi-line prompts read cleanly.
function previewText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Wrap case-insensitive matches of `query` in the preview so the hit is visible.
function highlight(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const at = lower.indexOf(needle, i);
    if (at === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (at > i) parts.push(text.slice(i, at));
    parts.push(
      <mark
        key={key++}
        style={{ background: "transparent", color: "var(--accent)", fontWeight: 600 }}
      >
        {text.slice(at, at + q.length)}
      </mark>,
    );
    i = at + q.length;
  }
  return parts;
}

export function PromptSearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Stable "now" per open so relative times don't churn between renders
  // (refreshed in the open effect below).
  const nowRef = useRef(Date.now());

  const { data, isLoading } = usePromptSearch(debounced, open);
  const results = useMemo<PromptSearchResult[]>(() => data ?? [], [data]);

  // Reset on open; focus the input.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setDebounced("");
    setHighlightIdx(0);
    nowRef.current = Date.now();
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Debounce the query feeding the server search.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Keep the highlight in range as the result set changes.
  useEffect(() => {
    setHighlightIdx((h) => (results.length === 0 ? 0 : Math.min(h, results.length - 1)));
  }, [results]);

  // Scroll the highlighted row into view.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[highlightIdx]?.scrollIntoView({ block: "nearest" });
  }, [open, highlightIdx]);

  const select = (row: PromptSearchResult) => {
    onClose();
    // Enqueue BEFORE navigating so the destination route picks it up on mount
    // (and via the event if it's already mounted). See routes/projects.$id.tsx
    // → openRequestedSession, which switches scope/worktree and focuses the cell.
    requestSessionOpenById({
      projectId: row.projectId,
      worktreeId: row.worktreeId,
      scopeId: row.scopeId,
      taskId: row.taskId,
    });
    void router.navigate({ to: "/projects/$id", params: { id: row.projectId } });
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const n = results.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (n > 0) setHighlightIdx((h) => (h + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (n > 0) setHighlightIdx((h) => (h - 1 + n) % n);
    } else if (e.key === "Enter") {
      const row = results[highlightIdx];
      if (row) {
        e.preventDefault();
        select(row);
      }
    }
  };

  const title = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
      <Icon name="search" size={13} style={{ color: "var(--text-faint)", flexShrink: 0 }} />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder="Search your prompts…"
        aria-label="Search prompt history"
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          fontFamily: "var(--mono)",
          fontSize: 13,
          fontWeight: 400,
          color: "var(--text)",
        }}
      />
    </div>
  );

  const footer = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: "var(--mono)",
        fontSize: 10,
        color: "var(--text-faint)",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
        navigate
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Kbd>↵</Kbd>
        open session
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Kbd>esc</Kbd>
        close
      </span>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={640}
      maxHeight="70vh"
      placement="top"
      contentStyle={{ padding: 4 }}
      footer={footer}
    >
      {isLoading && results.length === 0 ? (
        <div style={emptyStyle}>Searching…</div>
      ) : results.length === 0 ? (
        <div style={emptyStyle}>{debounced.trim() ? "No matching prompts." : "No prompts yet."}</div>
      ) : (
        <div>
          {results.map((row, i) => {
            const highlighted = i === highlightIdx;
            return (
              <button
                key={row.promptId}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                onClick={() => select(row)}
                onMouseMove={() => setHighlightIdx(i)}
                style={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: "8px 10px",
                  background: highlighted ? "var(--surface-2, var(--surface-1))" : "transparent",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  textAlign: "left",
                  outline: highlighted ? "1px solid var(--border)" : "none",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12.5,
                    lineHeight: 1.45,
                    color: "var(--text)",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {highlight(previewText(row.text), debounced)}
                </span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    color: "var(--text-faint)",
                    minWidth: 0,
                  }}
                >
                  <SessionIcon
                    name={row.taskIcon}
                    size={12}
                    color="var(--text-faint)"
                    style={{ flexShrink: 0 }}
                  />
                  <span
                    style={{
                      color: "var(--text-dim)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 220,
                    }}
                  >
                    {row.taskTitle}
                  </span>
                  <span aria-hidden>·</span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 160,
                    }}
                  >
                    {row.projectName}
                  </span>
                  <AgentGlyph agent={row.agent} size={10} />
                  <span style={{ marginLeft: "auto", flexShrink: 0, paddingLeft: 8 }}>
                    {formatWhen(row.ts, nowRef.current)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

const emptyStyle = {
  padding: 20,
  fontFamily: "var(--mono)",
  fontSize: 12,
  color: "var(--text-faint)",
  textAlign: "center" as const,
};
