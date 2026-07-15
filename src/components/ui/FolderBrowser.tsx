import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { Icon } from "~/components/ui/Icon";
import { Kbd } from "~/components/ui/Kbd";
import { Btn } from "~/components/ui/Btn";
import { getElectron } from "~/lib/electron";
import type { ListFoldersResult } from "~/shared/electron-contract";

type Listing = Extract<ListFoldersResult, { ok: true }>;

/** Last segment of a filesystem path, ignoring trailing separators. */
function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() || "";
}

/** Parent of an absolute path, computed client-side only to seed the first load. */
function naiveDirname(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return (p.startsWith("/") ? "/" : "") + parts.join("/");
}

/** `path` with the home prefix shown as ~, for breadcrumbs and hints. */
function tildify(p: string, home: string): string {
  return p === home ? "~" : p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
}

const headerIconBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  flex: "0 0 auto",
  background: "none",
  border: 0,
  borderRadius: 6,
  color: "var(--text-dim)",
  cursor: "pointer",
  padding: 0,
};

const chipStyle = (active: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontFamily: "var(--mono)",
  fontSize: 11,
  color: active ? "var(--accent)" : "var(--text-dim)",
  background: active ? "var(--accent-faint)" : "var(--surface-1)",
  border: `1px solid ${active ? "var(--accent-border)" : "var(--border)"}`,
  borderRadius: 999,
  padding: "3px 10px",
  cursor: "pointer",
  flex: "0 0 auto",
  whiteSpace: "nowrap",
});

/**
 * Inline, keyboard-first directory picker: the in-app replacement for the OS
 * "browse folder" dialog in the Add/Edit-project flow. Moving the highlight
 * previews (onPreview fires with the would-be path); Enter or the footer
 * button commits; Esc cancels back to whatever the caller had.
 *
 * Keys: ↑/↓ move · →/⏎-on-leaf drill/commit · ←/⌫ up · type to filter · Esc.
 */
export function FolderBrowser({
  initialPath,
  autoFocus,
  onPreview,
  onCommit,
  onCancel,
}: {
  /** Currently committed path — the browser opens at its parent with it highlighted. */
  initialPath: string | null;
  autoFocus?: boolean;
  onPreview: (path: string) => void;
  onCommit: (path: string) => void;
  onCancel: () => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const requestSeq = useRef(0);
  // Highlight the just-committed folder on the first listing only.
  const seedHighlightRef = useRef(initialPath ? basename(initialPath) : null);

  // Mirrors `listing` for the async load closure, which would otherwise read
  // a stale snapshot when deciding whether a failed load leaves us stranded.
  const listingRef = useRef<Listing | null>(null);
  listingRef.current = listing;

  const load = async (dir: string | null) => {
    const electron = getElectron();
    if (!electron) return;
    const seq = ++requestSeq.current;
    const result = await electron.listFolders(dir);
    if (seq !== requestSeq.current) return; // a newer navigation superseded this one
    if (!result.ok) {
      // Stay on the last good listing so ←/breadcrumbs still work — but a
      // failed FIRST load (e.g. a hand-typed bogus path) has nothing to stay
      // on, so fall back to home instead of a dead panel.
      setError(result.error);
      seedHighlightRef.current = null;
      if (!listingRef.current && dir !== null) void load(null);
      return;
    }
    setError(null);
    setFilter("");
    let nextHi = 0;
    if (seedHighlightRef.current) {
      const idx = result.entries.findIndex((e) => e.name === seedHighlightRef.current);
      seedHighlightRef.current = null;
      nextHi = Math.max(0, idx);
    }
    setListing(result);
    setHi(nextHi);
  };

  // Load once on mount; navigation drives subsequent loads imperatively.
  useEffect(() => {
    void load(initialPath ? naiveDirname(initialPath) : null);
  }, []);

  // Deferred so it lands after Modal's own panel-focus effect regardless of
  // mount order — a plain autoFocus attribute can lose that race.
  useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => filterRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [autoFocus]);

  const entries = useMemo(() => {
    if (!listing) return [];
    const q = filter.trim().toLowerCase();
    return q ? listing.entries.filter((e) => e.name.toLowerCase().includes(q)) : listing.entries;
  }, [listing, filter]);

  // Filter-as-create: typed text that names no existing folder becomes a
  // "＋ Create folder" row after the matches (same pattern as the Group field).
  // Names the main process would reject (separators, hidden, reserved) don't
  // offer the row at all.
  const createName = useMemo(() => {
    const typed = filter.trim();
    if (!typed || !listing) return null;
    if (typed === ".." || typed.startsWith(".") || /[\\/:*?"<>|]/.test(typed)) return null;
    const exists = listing.entries.some((e) => e.name.toLowerCase() === typed.toLowerCase());
    return exists ? null : typed;
  }, [filter, listing]);

  // The create row sits at index `entries.length`, participating in ↑/↓.
  const rowCount = entries.length + (createName ? 1 : 0);
  const clampedHi = rowCount ? Math.min(hi, rowCount - 1) : 0;
  const onCreateRow = !!createName && clampedHi === entries.length;
  const highlighted = !onCreateRow && entries.length ? entries[clampedHi] : null;
  const previewPath = listing
    ? highlighted
      ? `${listing.path === "/" ? "" : listing.path}/${highlighted.name}`
      : listing.path
    : null;

  // Live preview: every highlight/navigation change is reflected in the
  // dialog's path field (and, via the caller, the auto-filled name) — but only
  // once the user has actually touched the panel. The browser is open by
  // default in the create flow, and previewing on mount would fill the path
  // field (and dirty the form) before the user has chosen anything.
  const interactedRef = useRef(false);
  // The first ↑/↓ press "activates" the already-highlighted row (previews it)
  // instead of moving past it — the row the user sees highlighted is the one
  // they expect that first keypress to pick up.
  const activatedRef = useRef(false);
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;
  useEffect(() => {
    if (!interactedRef.current || !previewPath) return;
    // A filter with zero matches falls back to the current directory — don't
    // preview that into the form (commit refuses it too); the genuine
    // empty-folder fallback ("press ⏎ to use this folder") still previews.
    if (filter.trim() && !highlighted) return;
    onPreviewRef.current(previewPath);
  }, [previewPath, filter, highlighted]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-hi="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [hi, entries]);

  const drillIn = () => {
    if (!listing || !highlighted) return;
    activatedRef.current = true;
    void load(`${listing.path === "/" ? "" : listing.path}/${highlighted.name}`);
  };
  const goUp = () => {
    if (!listing?.parent) return;
    activatedRef.current = true;
    seedHighlightRef.current = basename(listing.path);
    void load(listing.parent);
  };
  const creatingRef = useRef(false);
  const createFolder = async () => {
    if (!listing || !createName || creatingRef.current) return;
    const electron = getElectron();
    if (!electron) return;
    creatingRef.current = true;
    try {
      const result = await electron.createFolder(listing.path, createName);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      activatedRef.current = true;
      // Reload the listing with the new folder highlighted — Enter then
      // commits it, → drills into it; creation deliberately doesn't
      // auto-commit.
      seedHighlightRef.current = createName;
      await load(listing.path);
    } finally {
      creatingRef.current = false;
    }
  };

  const commit = () => {
    // The ＋ row shares the commit gesture set (Enter / button / click).
    if (onCreateRow) {
      void createFolder();
      return;
    }
    if (!previewPath || !listing) return;
    // Never commit a bare home/root by accident — require a real pick below it.
    if (!highlighted && previewPath === listing.home) return;
    // A filter with zero matches has nothing to pick — Enter shouldn't fall
    // through to "use the current folder".
    if (!highlighted && filter.trim()) return;
    onCommit(previewPath);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const inFilter = e.target === filterRef.current;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        if (!rowCount) break;
        if (!activatedRef.current) {
          activatedRef.current = true;
          if (highlighted && previewPath) onPreviewRef.current(previewPath);
          break;
        }
        setHi((clampedHi + 1) % rowCount);
        break;
      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        if (!rowCount) break;
        if (!activatedRef.current) {
          activatedRef.current = true;
          if (highlighted && previewPath) onPreviewRef.current(previewPath);
          break;
        }
        setHi((clampedHi - 1 + rowCount) % rowCount);
        break;
      case "ArrowRight": {
        // With filter text, → only moves the caret while it has somewhere to
        // go; at the end of the text (where you are right after typing) it
        // opens the highlighted folder — so type-to-narrow → drill flows.
        const input = filterRef.current;
        if (
          inFilter &&
          filter &&
          input &&
          !(input.selectionStart === input.selectionEnd && input.selectionEnd === filter.length)
        ) {
          return; // editing the filter text
        }
        e.preventDefault();
        e.stopPropagation();
        drillIn();
        break;
      }
      case "ArrowLeft": {
        // Mirror of →: caret at the very start means ← means "go up".
        const input = filterRef.current;
        if (
          inFilter &&
          filter &&
          input &&
          !(input.selectionStart === input.selectionEnd && input.selectionStart === 0)
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        goUp();
        break;
      }
      case "Backspace":
        if (inFilter && filter) return; // deleting filter text
        e.preventDefault();
        e.stopPropagation();
        goUp();
        break;
      case "Enter":
        // A focused button (crumb, chip, back, ✕) keeps its native Enter=click;
        // only the dialog-wide Enter-submits hotkey is blocked.
        if (e.target instanceof HTMLElement && e.target.tagName === "BUTTON") {
          e.stopPropagation();
          break;
        }
        // Swallowed here so the dialog-wide Enter-submits hotkey can't fire
        // while the user is still picking a folder. No activation gate: the
        // highlight is always visible, so Enter is exact parity with the
        // "Use this folder" button (same home/no-match guards inside commit).
        e.preventDefault();
        e.stopPropagation();
        commit();
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // keep the dialog itself open
        if (filter) {
          setFilter("");
          setHi(0);
        } else {
          onCancel();
        }
        break;
      default:
        // Loose typing anywhere in the panel routes into the filter box.
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && !inFilter) {
          filterRef.current?.focus();
        }
    }
  };

  const home = listing?.home ?? "";
  const crumbs = useMemo(() => {
    if (!listing) return [];
    if (listing.path === "/") return [{ label: "/", path: "/" }];
    const display = tildify(listing.path, home);
    const segs = display.split("/").filter(Boolean);
    const isAbs = display.startsWith("/");
    return segs.map((seg, i) => ({
      label: seg,
      path: (() => {
        const partial = segs.slice(0, i + 1).join("/");
        const p = isAbs ? "/" + partial : partial;
        return p.startsWith("~") ? home + p.slice(1) : p;
      })(),
    }));
  }, [listing, home]);
  // Long paths: keep the first crumb (~) and the last two, elide the middle.
  const crumbHead = crumbs.length > 4 ? crumbs.slice(0, 1) : [];
  const crumbTail = crumbs.length > 4 ? crumbs.slice(-2) : crumbs;

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      onKeyDownCapture={() => {
        interactedRef.current = true;
      }}
      onMouseDownCapture={(e) => {
        interactedRef.current = true;
        // Clicks must not move focus around the panel: rows aren't focusable
        // (focus would fall to <body> and keyboard nav dies), and chips /
        // crumbs / back are momentary controls that would otherwise keep a
        // focus ring after the click. Keys keep flowing through the filter
        // box; Tab still reaches every button for keyboard users. The filter
        // input keeps its default so caret placement works, and scrollbars
        // (neither li nor button) stay draggable.
        if (
          e.target instanceof HTMLElement &&
          !e.target.closest("input") &&
          e.target.closest("li,button")
        ) {
          e.preventDefault();
        }
      }}
      onClickCapture={() => {
        // Any click in the panel's dead zones (header gaps, footer hints, a
        // row while focus was in the name field) must leave focus somewhere
        // inside the panel, or the keyboard model goes dark.
        if (!rootRef.current?.contains(document.activeElement)) {
          filterRef.current?.focus();
        }
      }}
      style={{
        background: "var(--surface-0)",
        border: "1px solid var(--border-strong)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-1)",
        }}
      >
        <button
          type="button"
          onClick={goUp}
          disabled={!listing?.parent}
          aria-label="Back to parent folder"
          title="Back (← or ⌫)"
          style={{
            ...headerIconBtnStyle,
            opacity: listing?.parent ? 1 : 0.35,
            cursor: listing?.parent ? "pointer" : "default",
          }}
        >
          <Icon name="chevron-left" size={14} />
        </button>
        <nav
          aria-label="Current folder path"
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 2,
            fontFamily: "var(--mono)",
            fontSize: 11,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {[...crumbHead, ...(crumbs.length > 4 ? [null] : []), ...crumbTail].map((crumb, i, arr) =>
            crumb === null ? (
              <span key="ellipsis" style={{ color: "var(--text-faint)", padding: "0 2px" }}>
                / … /
              </span>
            ) : (
              <span
                key={crumb.path}
                style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
              >
                {i > 0 && arr[i - 1] !== null && (
                  <span style={{ color: "var(--text-faint)", opacity: 0.6 }}>/</span>
                )}
                <button
                  type="button"
                  onClick={() => void load(crumb.path)}
                  className="mc-folder-crumb"
                  style={{
                    background: "none",
                    border: 0,
                    cursor: "pointer",
                    font: "inherit",
                    padding: "2px 5px",
                    borderRadius: 5,
                    color: i === arr.length - 1 ? "var(--text)" : "var(--text-faint)",
                    fontWeight: i === arr.length - 1 ? 600 : 400,
                  }}
                >
                  {crumb.label}
                </button>
              </span>
            ),
          )}
        </nav>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close folder browser"
          title="Close (esc)"
          style={headerIconBtnStyle}
        >
          <Icon name="x" size={13} />
        </button>
      </div>

      {listing && listing.roots.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "8px 10px",
            borderBottom: "1px solid var(--border)",
            overflowX: "auto",
          }}
        >
          {listing.roots.map((root) => (
            <button
              key={root.path}
              type="button"
              onClick={() => void load(root.path)}
              style={chipStyle(listing.path === root.path)}
            >
              <Icon name="folder" size={11} />
              {root.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: "8px 10px 0" }}>
        <div style={{ position: "relative" }}>
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 9,
              top: "50%",
              translate: "0 -50%",
              color: "var(--text-faint)",
              display: "flex",
            }}
          >
            <Icon name="search" size={12} />
          </span>
          <input
            ref={filterRef}
            value={filter}
            onChange={(e) => {
              activatedRef.current = true;
              setFilter(e.target.value);
              setHi(0);
            }}
            placeholder="Type to filter — or name a new folder…"
            aria-label="Filter folders"
            style={{
              width: "100%",
              height: 30,
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              color: "var(--text)",
              fontFamily: "var(--mono)",
              fontSize: 12,
              padding: "0 10px 0 28px",
              outline: "none",
            }}
          />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            margin: "8px 10px 0",
            padding: "6px 10px",
            borderRadius: 7,
            background: "var(--status-needs-bg)",
            color: "var(--status-needs)",
            fontFamily: "var(--mono)",
            fontSize: 11,
          }}
        >
          {error}
        </div>
      )}

      <ul
        ref={listRef}
        role="listbox"
        aria-label="Subfolders"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 6,
          maxHeight: 218,
          overflowY: "auto",
        }}
      >
        {!listing && !error && (
          <li
            style={{
              padding: "24px 12px",
              textAlign: "center",
              color: "var(--text-faint)",
              fontFamily: "var(--mono)",
              fontSize: 11,
            }}
          >
            loading folders…
          </li>
        )}
        {listing && entries.length === 0 && !createName && (
          <li
            style={{
              padding: "24px 12px",
              textAlign: "center",
              color: "var(--text-faint)",
              fontFamily: "var(--mono)",
              fontSize: 11,
            }}
          >
            {filter
              ? `no folders matching “${filter.trim()}”`
              : "no subfolders — press ⏎ to use this folder"}
          </li>
        )}
        {entries.map((entry, i) => {
          const isHi = i === clampedHi && !onCreateRow;
          return (
            <li
              key={entry.name}
              role="option"
              aria-selected={isHi}
              data-hi={isHi || undefined}
              onClick={() => {
                activatedRef.current = true;
                setHi(i);
                // Re-clicking the highlighted row still counts as a pick.
                if (isHi && previewPath) onPreviewRef.current(previewPath);
              }}
              onDoubleClick={() => {
                setHi(i);
                if (entry.childCount > 0) drillIn();
                else commit();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 10px",
                borderRadius: 7,
                cursor: "pointer",
                userSelect: "none",
                border: `1px solid ${isHi ? "var(--accent-border)" : "transparent"}`,
                background: isHi ? "var(--accent-dim)" : undefined,
              }}
            >
              <span
                aria-hidden
                style={{
                  color: isHi ? "var(--accent)" : "var(--text-faint)",
                  display: "flex",
                  flex: "0 0 auto",
                }}
              >
                <Icon name="folder" size={14} />
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 13,
                  fontWeight: isHi ? 600 : 400,
                  color: "var(--text)",
                }}
              >
                {entry.name}
              </span>
              {entry.childCount > 0 && (
                <>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10,
                      color: "var(--text-faint)",
                      flex: "0 0 auto",
                    }}
                  >
                    {entry.childCount}
                  </span>
                  <span
                    aria-hidden
                    style={{ color: "var(--text-faint)", display: "flex", flex: "0 0 auto" }}
                  >
                    <Icon name="chevron-right" size={12} />
                  </span>
                </>
              )}
            </li>
          );
        })}
        {listing?.truncated && (
          <li
            style={{
              padding: "8px 12px",
              color: "var(--text-faint)",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
            }}
          >
            showing the first {listing.entries.length} folders — type to narrow down
          </li>
        )}
      </ul>

      {/* Create action, pinned below the scroll area: appears when the filter
          names a folder that doesn't exist here (the placeholder teaches the
          gesture), and joins the ↑/↓ cycle at index entries.length. */}
      {listing && createName && (
        <div style={{ padding: "0 6px 6px" }}>
          <button
            type="button"
            onClick={() => {
              activatedRef.current = true;
              setHi(entries.length);
              void createFolder();
            }}
            data-hi={onCreateRow || undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "6px 10px",
              borderRadius: 7,
              cursor: "pointer",
              userSelect: "none",
              font: "inherit",
              textAlign: "left",
              border: `1px dashed ${onCreateRow ? "var(--accent-border)" : "var(--border-strong)"}`,
              background: onCreateRow ? "var(--accent-dim)" : "transparent",
            }}
          >
            <span
              aria-hidden
              style={{
                color: onCreateRow ? "var(--accent)" : "var(--text-faint)",
                display: "flex",
                flex: "0 0 auto",
              }}
            >
              <Icon name="plus" size={14} />
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 13,
                fontWeight: onCreateRow ? 600 : 400,
                color: "var(--text)",
              }}
            >
              Create folder “{createName}” here
            </span>
            <Kbd variant="inline">⏎</Kbd>
          </button>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "8px 10px",
          borderTop: "1px solid var(--border)",
          background: "var(--surface-1)",
        }}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-faint)" }}>
            <Kbd variant="inline">↑</Kbd>
            <Kbd variant="inline">↓</Kbd> move
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-faint)" }}>
            <Kbd variant="inline">→</Kbd> open
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-faint)" }}>
            <Kbd variant="inline">←</Kbd> back
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-faint)" }}>
            <Kbd variant="inline">esc</Kbd> cancel
          </span>
        </div>
        <Btn
          variant="primary"
          onClick={commit}
          disabled={!onCreateRow && !highlighted && (previewPath === home || !!filter.trim())}
        >
          {onCreateRow ? "Create folder" : "Use this folder"}
        </Btn>
      </div>
    </div>
  );
}
