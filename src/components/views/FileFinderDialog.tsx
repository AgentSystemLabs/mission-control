import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "~/components/ui/Icon";
import { Kbd } from "~/components/ui/Kbd";
import { rankFiles } from "~/lib/file-fuzzy";
import { useHotkey } from "~/lib/use-hotkey";

const VISIBLE_LIMIT = 200;

export function FileFinderDialog({
  open,
  projectRoot,
  onClose,
  onPick,
}: {
  open: boolean;
  projectRoot: string;
  onClose: () => void;
  onPick: (relPath: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Lazy: only fetch the file list when the dialog is opened.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["files:list", projectRoot],
    queryFn: async () => {
      if (!window.electronAPI) throw new Error("Not running in Electron");
      const r = await window.electronAPI.files.list(projectRoot);
      if (!r.ok) throw new Error(r.error);
      return r.files;
    },
    enabled: open && !!projectRoot,
    staleTime: 30_000,
  });

  const ranked = useMemo(() => {
    const files = data ?? [];
    return rankFiles(query.trim(), files, VISIBLE_LIMIT);
  }, [data, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // When query changes, refresh the file list in the background so renames/new files appear.
  useEffect(() => {
    if (!open) return;
    void refetch();
  }, [open, refetch]);

  useEffect(() => {
    if (highlight >= ranked.length) setHighlight(0);
  }, [ranked, highlight]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[highlight]?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  useHotkey(
    "escape",
    (e) => {
      if (!open) return;
      e.stopPropagation();
      onClose();
    },
    { enabled: open, preventDefault: false },
  );

  const choose = (p: string) => {
    onPick(p);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const n = ranked.length;
      if (n > 0) setHighlight((h) => (h + 1) % n);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const n = ranked.length;
      if (n > 0) setHighlight((h) => (h - 1 + n) % n);
      return;
    }
    if (e.key === "Enter") {
      const target = ranked[highlight];
      if (target) {
        e.preventDefault();
        choose(target.path);
      }
    }
  };

  if (!open) return null;

  return (
    <div
      data-modal-open
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        animation: "fade-up 0.12s ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxWidth: "92vw",
          maxHeight: "70vh",
          background: "var(--surface-1)",
          border: "1px solid var(--border-strong)",
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Icon name="search" size={13} style={{ color: "var(--text-faint)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search files in this project…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontFamily: "var(--mono)",
              fontSize: 13,
              color: "var(--text)",
            }}
          />
          <Kbd variant="inline">Esc</Kbd>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 4 }}>
          {error ? (
            <Status>Error: {String((error as Error).message)}</Status>
          ) : isLoading && !data ? (
            <Status>Indexing…</Status>
          ) : ranked.length === 0 ? (
            <Status>{(data?.length ?? 0) === 0 ? "No files found." : "No matches."}</Status>
          ) : (
            ranked.map((r, i) => {
              const slash = r.path.lastIndexOf("/");
              const dir = slash >= 0 ? r.path.slice(0, slash) : "";
              const base = slash >= 0 ? r.path.slice(slash + 1) : r.path;
              const highlighted = i === highlight;
              return (
                <button
                  key={r.path}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  onClick={() => choose(r.path)}
                  onMouseMove={() => setHighlight(i)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    padding: "6px 10px",
                    background: highlighted ? "var(--surface-2, var(--surface-1))" : "transparent",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    color: "var(--text)",
                    outline: highlighted ? "1px solid var(--border)" : "none",
                  }}
                >
                  <span style={{ flexShrink: 0, fontWeight: 600 }}>{base}</span>
                  {dir && (
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: "var(--text-faint)",
                        fontSize: 11,
                      }}
                    >
                      {dir}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 14px",
            borderTop: "1px solid var(--border)",
            background: "var(--surface-0)",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--text-faint)",
          }}
        >
          <span>
            {data ? `${ranked.length} / ${data.length}` : "—"}
          </span>
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span>
              <Kbd variant="inline">↑↓</Kbd> navigate
            </span>
            <span>
              <Kbd variant="inline">Enter</Kbd> open
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 14,
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
