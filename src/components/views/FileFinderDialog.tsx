import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "~/components/ui/Modal";
import { Icon } from "~/components/ui/Icon";
import { Kbd } from "~/components/ui/Kbd";
import { rankFiles } from "~/lib/file-fuzzy";
import { getRuntime } from "~/lib/runtime";

const VISIBLE_LIMIT = 200;

export function FileFinderDialog({
  open,
  projectId,
  onClose,
  onPick,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onPick: (relPath: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Lazy: only fetch the file list when the dialog is opened.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["files:list", projectId],
    queryFn: async () => {
      const runtime = getRuntime();
      if (!runtime) throw new Error("Runtime unavailable");
      const r = await runtime.files.list(projectId);
      if (!r.ok) throw new Error(r.error);
      return r.files;
    },
    enabled: open && !!projectId,
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
    <Modal
      open={open}
      onClose={onClose}
      width={640}
      maxHeight="70vh"
      placement="top"
      zIndex={100}
      contentStyle={{ padding: 4 }}
      title={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
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
      }
      footer={
        <>
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
        </>
      }
      footerStyle={{
        justifyContent: "space-between",
        alignItems: "center",
        fontFamily: "var(--mono)",
        fontSize: 10.5,
        color: "var(--text-faint)",
      }}
    >
      <div style={{ flex: 1, overflowY: "auto" }} aria-busy={isLoading}>
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
    </Modal>
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
