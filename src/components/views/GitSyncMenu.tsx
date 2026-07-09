import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { DropdownMenuItem, DropdownMenuSeparator } from "~/components/ui/DropdownMenuItem";
import { Spinner } from "~/components/ui/Spinner";
import { Tooltip } from "~/components/ui/Tooltip";
import { ApiError } from "~/lib/api";
import { Z_INDEX } from "~/lib/z-index";
import { useGitFetch, useGitPull } from "~/queries/git";

type PullMode = "ff-only" | "rebase" | "merge";

function syncErrorDetail(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body;
    if (body && typeof body === "object") {
      // Prefer the friendly server message over raw git stderr (which often
      // includes fetch noise + long "hint:" blocks for diverging branches).
      const msg = (body as { error?: unknown }).error;
      if (typeof msg === "string" && msg.trim()) return msg.trim();
      const stderr = (body as { stderr?: unknown }).stderr;
      if (typeof stderr === "string" && stderr.trim()) {
        const firstFatal = stderr
          .split("\n")
          .map((line) => line.trim())
          .find((line) => /^fatal:/i.test(line) || /^error:/i.test(line));
        return firstFatal?.replace(/^(fatal|error):\s*/i, "") || stderr.trim();
      }
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * Header gear next to the branch control. Offers Fetch (update remotes only)
 * and Pull variants for the active worktree.
 */
export function GitSyncMenu({
  projectId,
  worktreeId,
  disabled = false,
  disabledReason,
  /** Drop the left frame edge so this can fuse with a leading branch control. */
  attachedLeading = false,
}: {
  projectId: string;
  worktreeId?: string | null;
  disabled?: boolean;
  disabledReason?: string;
  attachedLeading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; right: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLElement>(null);
  const fetch = useGitFetch(projectId, worktreeId);
  const pull = useGitPull(projectId, worktreeId);
  const busy = fetch.isPending || pull.isPending;

  const updateMenuRect = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setMenuRect({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuRect(null);
      return;
    }
    updateMenuRect();
    window.addEventListener("resize", updateMenuRect);
    window.addEventListener("scroll", updateMenuRect, true);
    return () => {
      window.removeEventListener("resize", updateMenuRect);
      window.removeEventListener("scroll", updateMenuRect, true);
    };
  }, [open, updateMenuRect]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const runFetch = () => {
    setOpen(false);
    fetch.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(result.output.trim() ? "Fetched latest from remote" : "Fetch complete");
      },
      onError: (error) => {
        toast.error(syncErrorDetail(error));
      },
    });
  };

  const runPull = (mode: PullMode) => {
    setOpen(false);
    pull.mutate(mode, {
      onSuccess: (result) => {
        if (result.kind === "already-up-to-date") {
          toast.success("Already up to date");
          return;
        }
        toast.success(
          mode === "rebase"
            ? "Pulled with rebase"
            : mode === "merge"
              ? "Pulled with merge"
              : "Pulled latest changes",
        );
      },
      onError: (error) => {
        toast.error(syncErrorDetail(error));
      },
    });
  };

  const tip = disabled
    ? disabledReason || "Unavailable until the project folder is valid"
    : busy
      ? fetch.isPending
        ? "Fetching…"
        : "Pulling…"
      : "Fetch or pull latest changes";

  return (
    <div ref={anchorRef} style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
      <Tooltip content={tip}>
        <Btn
          variant="ghost"
          size="md"
          icon={busy ? undefined : "settings"}
          onClick={() => setOpen((v) => !v)}
          disabled={disabled || busy}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Git sync options"
          title={tip}
          className={attachedLeading ? "mc-btn-attached-left" : undefined}
          style={{ minWidth: 32, paddingInline: 6 }}
        >
          {busy ? <Spinner size={12} /> : null}
        </Btn>
      </Tooltip>
      {open &&
        menuRect &&
        createPortal(
          <CardFrame
            ref={menuRef}
            role="menu"
            aria-label="Git sync"
            solid
            className="mc-project-actions-menu"
            style={{
              position: "fixed",
              top: menuRect.top,
              right: menuRect.right,
              minWidth: 220,
              boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
              zIndex: Z_INDEX.popover,
            }}
          >
            <DropdownMenuItem icon="download" onClick={runFetch} disabled={busy}>
              Fetch
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon="refresh" onClick={() => runPull("ff-only")} disabled={busy}>
              Pull latest
            </DropdownMenuItem>
            <DropdownMenuItem icon="refresh" onClick={() => runPull("rebase")} disabled={busy}>
              Pull with rebase
            </DropdownMenuItem>
            <DropdownMenuItem icon="git-branch" onClick={() => runPull("merge")} disabled={busy}>
              Pull with merge
            </DropdownMenuItem>
          </CardFrame>,
          document.body,
        )}
    </div>
  );
}
