import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Z_INDEX } from "~/lib/z-index";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "~/lib/api";
import { Icon } from "~/components/ui/Icon";
import { Modal } from "~/components/ui/Modal";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import {
  gitBranchesQueryOptions,
  useGitBranches,
  useGitCheckout,
} from "~/queries/git";
import { useTerminals } from "~/lib/terminal-store";
import { useUserTerminals } from "~/lib/user-terminal-store";
import {
  describeLiveWorktreeActivity,
  getLiveWorktreeActivity,
  hasLiveWorktreeActivity,
} from "~/lib/worktree-live-activity";
import { useTasks } from "~/queries";
import {
  isOptimisticWorktree,
  worktreeScopeKey,
  type WorktreeInfo,
} from "~/shared/worktrees";
import { getPinnedProjectStatusDots } from "~/components/views/project-bar-status-dots";
import { TASK_STATUS_META } from "~/shared/domain";
import type { GitBranch } from "~/lib/api";

type BranchCheckoutError = {
  title: string;
  message: string;
  stderr?: string;
};

type MenuRect = {
  top: number;
  left: number;
  width: number;
};

function parseCheckoutError(error: unknown): BranchCheckoutError {
  if (error instanceof ApiError) {
    const body =
      error.body && typeof error.body === "object"
        ? (error.body as { error?: unknown; stderr?: unknown })
        : null;
    const message =
      typeof body?.error === "string" && body.error.trim()
        ? body.error.trim()
        : error.message;
    const stderr = typeof body?.stderr === "string" ? body.stderr.trim() : undefined;
    return {
      title: "Could not switch branch",
      message,
      stderr: stderr && stderr !== message ? stderr : undefined,
    };
  }
  return {
    title: "Could not switch branch",
    message: error instanceof Error ? error.message : String(error),
  };
}

function branchLoadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body =
      error.body && typeof error.body === "object"
        ? (error.body as { error?: unknown })
        : null;
    if (typeof body?.error === "string" && body.error.trim()) return body.error.trim();
    return error.message;
  }
  return error instanceof Error ? error.message : "Could not load branches.";
}

function branchMatchesQuery(branch: GitBranch, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (branch.name.toLowerCase().includes(needle)) return true;
  if (branch.remoteRef?.toLowerCase().includes(needle)) return true;
  return false;
}

const sectionLabelStyle: React.CSSProperties = {
  padding: "4px 9px",
  color: "var(--text-faint)",
  fontFamily: "var(--mono)",
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

function worktreeLabel(worktree: WorktreeInfo): string {
  return worktree.isMain ? "main" : worktree.name;
}

function worktreeMatchesQuery(worktree: WorktreeInfo, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (worktreeLabel(worktree).toLowerCase().includes(needle)) return true;
  if (worktree.branch?.toLowerCase().includes(needle)) return true;
  return false;
}

export function BranchTypeahead({
  projectId,
  worktreeId,
  branch,
  disabled = false,
  worktreePath,
  selected = false,
  /** Drop the right frame edge so this can fuse with a trailing sync control. */
  attachedTrailing = false,
  /** When provided, the dropdown gains a "New worktree" action in its footer. */
  onCreateWorktree,
  createWorktreeDisabled = false,
  createWorktreeTitle,
  /**
   * When 2+ worktrees are open, the dropdown grows a "Worktrees" section above
   * the branch list so this one control switches worktree *or* checks out a
   * branch — folding the old worktree pill strip into the branch dropdown.
   */
  worktrees = [],
  selectedWorktreeId,
  onSelectWorktree,
  onDeleteWorktree,
  runningKeys,
}: {
  projectId: string;
  worktreeId?: string | null;
  branch: string | null | undefined;
  disabled?: boolean;
  worktreePath?: string;
  selected?: boolean;
  attachedTrailing?: boolean;
  onCreateWorktree?: () => void;
  createWorktreeDisabled?: boolean;
  createWorktreeTitle?: string;
  worktrees?: WorktreeInfo[];
  selectedWorktreeId?: string;
  onSelectWorktree?: (id: string) => void;
  onDeleteWorktree?: (worktree: WorktreeInfo) => void;
  runningKeys?: ReadonlySet<string>;
}) {
  const branchLabel = branch?.trim() || "…";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuRect, setMenuRect] = useState<MenuRect | null>(null);
  const [checkoutError, setCheckoutError] = useState<BranchCheckoutError | null>(null);
  const [pendingCheckout, setPendingCheckout] = useState<{ branch: string; create?: boolean } | null>(
    null,
  );
  const anchorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const checkout = useGitCheckout(projectId, worktreeId);
  const branchesQuery = useGitBranches(projectId, worktreeId, {
    enabled: !disabled,
  });
  const { sessions: agentSessions } = useTerminals();
  const { sessionsByScope } = useUserTerminals();
  const { data: tasks } = useTasks(projectId, worktreeId);
  const scopeKey = worktreeScopeKey(projectId, worktreeId ?? null);
  const liveActivity = useMemo(() => {
    const taskById = new Map((tasks ?? []).map((task) => [task.id, task]));
    const scopedAgentSessions = agentSessions.map((session) => {
      const task = taskById.get(session.taskId) ?? session.task;
      return {
        ptyId: session.ptyId,
        project: session.project,
        task,
      };
    });
    return getLiveWorktreeActivity(
      scopeKey,
      scopedAgentSessions,
      sessionsByScope[scopeKey] ?? [],
    );
  }, [agentSessions, scopeKey, sessionsByScope, tasks]);
  const hasActiveSession = hasLiveWorktreeActivity(liveActivity);
  const activeSessionSummary = useMemo(
    () => describeLiveWorktreeActivity(liveActivity),
    [liveActivity],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const branches = branchesQuery.data?.branches ?? [];
  const filteredBranches = useMemo(
    () => branches.filter((item) => branchMatchesQuery(item, query)),
    [branches, query],
  );
  // Only fold worktrees into the dropdown once there's more than one to switch
  // between — a solo-main project keeps the plain branch typeahead it had.
  const showWorktreeSection = worktrees.length > 1 && !!onSelectWorktree;
  const filteredWorktrees = useMemo(
    () =>
      showWorktreeSection
        ? worktrees.filter((item) => worktreeMatchesQuery(item, query))
        : [],
    [showWorktreeSection, worktrees, query],
  );
  // Branch checkout can be disabled (e.g. project path blocked) while worktree
  // switching should still work — so the dropdown stays openable when there are
  // worktrees to switch between, even though branch actions are gated off.
  const triggerDisabled = checkout.isPending || (disabled && !showWorktreeSection);
  const trimmedQuery = query.trim();
  const exactMatch = branches.some(
    (item) => item.name === trimmedQuery || item.remoteRef === trimmedQuery,
  );
  const canCreateBranch =
    !!trimmedQuery &&
    trimmedQuery !== branchLabel &&
    !exactMatch &&
    !trimmedQuery.includes("..") &&
    !trimmedQuery.startsWith("-") &&
    !trimmedQuery.endsWith("/") &&
    !trimmedQuery.includes(" ");

  const updateMenuRect = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setMenuRect({
      top: rect.bottom + 8,
      left: rect.left,
      width: Math.max(rect.width, 320),
    });
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
  }, [
    open,
    updateMenuRect,
    filteredBranches.length,
    filteredWorktrees.length,
    branchesQuery.isLoading,
    branchesQuery.isFetching,
  ]);

  const closeTypeahead = () => {
    setOpen(false);
    setQuery("");
  };

  const refreshBranches = () =>
    queryClient.fetchQuery(gitBranchesQueryOptions(projectId, worktreeId, { enabled: !disabled }));

  const toggleOpen = () => {
    if (triggerDisabled) return;
    setOpen((current) => {
      const next = !current;
      // Only pull branches when checkout is actually available — when opened
      // purely to switch worktrees (branch actions disabled) we skip the fetch.
      if (next && !disabled) void refreshBranches();
      return next;
    });
  };

  const performCheckout = async (target: string, create?: boolean) => {
    const next = target.trim();
    if (!next || disabled || checkout.isPending) return;
    if (next === branchLabel && !create) {
      closeTypeahead();
      return;
    }
    try {
      await checkout.mutateAsync({ branch: next, create });
      closeTypeahead();
    } catch (error) {
      setCheckoutError(parseCheckoutError(error));
      closeTypeahead();
    }
  };

  const requestCheckout = (target: string, create?: boolean) => {
    const next = target.trim();
    if (!next || disabled || checkout.isPending) return;
    if (next === branchLabel && !create) {
      closeTypeahead();
      return;
    }
    if (hasActiveSession) {
      setPendingCheckout({ branch: next, create });
      closeTypeahead();
      return;
    }
    void performCheckout(next, create);
  };

  const confirmPendingCheckout = async () => {
    if (!pendingCheckout) return;
    const next = pendingCheckout;
    setPendingCheckout(null);
    await performCheckout(next.branch, next.create);
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeTypeahead();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (filteredBranches.length === 1) {
        requestCheckout(filteredBranches[0]!.name);
        return;
      }
      if (canCreateBranch) {
        requestCheckout(trimmedQuery, true);
        return;
      }
      if (exactMatch) {
        requestCheckout(trimmedQuery);
      }
    }
  };

  const loadError =
    branchesQuery.isError && branchesQuery.error
      ? branchLoadErrorMessage(branchesQuery.error)
      : null;

  const dropdown =
    open && menuRect
      ? createPortal(
          <CardFrame
            ref={dropdownRef}
            id="branch-typeahead-options"
            role="listbox"
            aria-label="Git branches"
            glow
            solid
            style={{
              position: "fixed",
              top: menuRect.top,
              left: menuRect.left,
              width: menuRect.width,
              zIndex: Z_INDEX.popover,
              maxHeight: 360,
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 14px 36px rgba(0, 0, 0, 0.32)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder={
                  showWorktreeSection
                    ? "Search worktrees & branches…"
                    : "Search branches or type a new name…"
                }
                aria-label={showWorktreeSection ? "Search worktrees and branches" : "Search branches"}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  color: "var(--text)",
                  padding: "8px 6px",
                }}
              />
            </div>
            <div style={{ overflowY: "auto", padding: 6, minHeight: 0 }}>
              {(branchesQuery.isLoading || branchesQuery.isFetching) && branches.length === 0 && (
                <div
                  style={{
                    padding: "8px 10px",
                    color: "var(--text-dim)",
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                  }}
                >
                  Loading branches…
                </div>
              )}
              {loadError && (
                <div style={{ display: "grid", gap: 8, padding: "4px 4px 8px" }}>
                  <div
                    style={{
                      padding: "8px 10px",
                      color: "var(--danger, #f87171)",
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      lineHeight: 1.45,
                    }}
                  >
                    {loadError}
                  </div>
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon="refresh"
                    onClick={() => void refreshBranches()}
                    style={{ justifyContent: "flex-start" }}
                  >
                    Retry
                  </Btn>
                </div>
              )}
              {!loadError && showWorktreeSection && filteredWorktrees.length > 0 && (
                <>
                  <div style={sectionLabelStyle}>Worktrees</div>
                  {filteredWorktrees.map((item) => {
                    const optimistic = isOptimisticWorktree(item);
                    const isSelected = item.id === selectedWorktreeId;
                    const label = worktreeLabel(item);
                    const scope = worktreeScopeKey(projectId, item.isMain ? null : item.id);
                    const running = runningKeys
                      ? [...runningKeys].some(
                          (key) => key === scope || key.startsWith(`${scope}:`),
                        )
                      : false;
                    const statusDots = item.taskCounts
                      ? getPinnedProjectStatusDots(item.taskCounts)
                      : [];
                    const canDelete =
                      isSelected && !item.isMain && !optimistic && !!onDeleteWorktree;
                    return (
                      <div
                        key={item.id}
                        style={{ display: "flex", alignItems: "stretch", gap: 2 }}
                      >
                        <button
                          type="button"
                          role="option"
                          className="mc-branch-menu-item"
                          aria-selected={isSelected}
                          disabled={optimistic}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            if (optimistic) return;
                            closeTypeahead();
                            if (!isSelected) onSelectWorktree?.(item.id);
                          }}
                          title={
                            optimistic
                              ? "Creating worktree…"
                              : `${item.path}${item.branch ? ` · branch ${item.branch}` : ""}`
                          }
                          style={{
                            flex: 1,
                            minWidth: 0,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minHeight: 32,
                            border: 0,
                            borderRadius: 6,
                            background: isSelected ? "var(--accent-dim)" : undefined,
                            color: isSelected ? "var(--accent)" : "var(--text)",
                            cursor: optimistic ? "default" : "pointer",
                            padding: "7px 9px",
                            textAlign: "left",
                            fontFamily: "var(--mono)",
                            fontSize: 11.5,
                            opacity: optimistic ? 0.65 : 1,
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 9,
                              height: 9,
                              flexShrink: 0,
                              borderRadius: "50%",
                              background: isSelected ? "var(--accent)" : "transparent",
                              border: isSelected
                                ? "none"
                                : "1.5px solid var(--text-faint)",
                              boxShadow: isSelected ? "0 0 6px var(--accent-glow)" : "none",
                            }}
                          />
                          <span
                            style={{
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              flex: 1,
                            }}
                          >
                            {label}
                          </span>
                          {optimistic && (
                            <span style={{ color: "var(--text-faint)", fontSize: 10, flexShrink: 0 }}>
                              creating…
                            </span>
                          )}
                          <span
                            aria-hidden
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                              flexShrink: 0,
                            }}
                          >
                            {running && (
                              <span
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: "50%",
                                  background: "var(--accent)",
                                  boxShadow: "0 0 6px var(--accent-glow)",
                                }}
                              />
                            )}
                            {statusDots.map((status, dot) => (
                              <span
                                key={`${status}-${dot}`}
                                style={{
                                  width: 5,
                                  height: 5,
                                  borderRadius: "50%",
                                  background:
                                    status === "running"
                                      ? "var(--accent)"
                                      : TASK_STATUS_META[status].color,
                                  boxShadow:
                                    status === "running" ? "0 0 5px var(--accent-glow)" : "none",
                                }}
                              />
                            ))}
                          </span>
                        </button>
                        {canDelete && (
                          <button
                            type="button"
                            className="mc-branch-menu-item"
                            aria-label={`Delete worktree ${item.name}`}
                            title={`Delete worktree ${item.name}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              closeTypeahead();
                              onDeleteWorktree?.(item);
                            }}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 30,
                              flexShrink: 0,
                              border: 0,
                              borderRadius: 6,
                              background: "transparent",
                              color: "var(--text-faint)",
                              cursor: "pointer",
                            }}
                          >
                            <Icon name="trash" size={11} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {filteredBranches.length > 0 && (
                    <div style={{ ...sectionLabelStyle, marginTop: 4 }}>Branches</div>
                  )}
                </>
              )}
              {!loadError &&
                filteredBranches.map((item) => (
                  <button
                    key={`${item.local ? "local" : "remote"}:${item.name}:${item.remoteRef ?? ""}`}
                    type="button"
                    role="option"
                    className="mc-branch-menu-item"
                    aria-selected={item.name === branchLabel}
                    disabled={checkout.isPending}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => requestCheckout(item.name)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minHeight: 32,
                      border: 0,
                      borderRadius: 6,
                      background: item.name === branchLabel ? "var(--accent-dim)" : undefined,
                      color: item.name === branchLabel ? "var(--accent)" : "var(--text)",
                      cursor: checkout.isPending ? "default" : "pointer",
                      padding: "7px 9px",
                      textAlign: "left",
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      opacity: checkout.isPending ? 0.65 : 1,
                    }}
                  >
                    <Icon name="git-branch" size={12} />
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                    >
                      {item.name}
                    </span>
                    {!item.local && item.remoteRef && (
                      <span style={{ color: "var(--text-faint)", fontSize: 10, flexShrink: 0 }}>
                        remote
                      </span>
                    )}
                  </button>
                ))}
              {!loadError && !disabled && canCreateBranch && (
                <button
                  type="button"
                  role="option"
                  className="mc-branch-menu-item"
                  aria-selected={false}
                  disabled={checkout.isPending}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => requestCheckout(trimmedQuery, true)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 32,
                    border: 0,
                    borderRadius: 6,
                    color: "var(--accent)",
                    cursor: checkout.isPending ? "default" : "pointer",
                    padding: "7px 9px",
                    textAlign: "left",
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    opacity: checkout.isPending ? 0.65 : 1,
                  }}
                >
                  <Icon name="plus" size={12} />
                  {checkout.isPending ? "Creating branch…" : `Create "${trimmedQuery}"`}
                </button>
              )}
              {disabled ? (
                // Opened purely to switch worktrees — branch checkout is off, so
                // don't dangle a misleading "no branches" line under the list.
                showWorktreeSection && (
                  <div style={{ ...sectionLabelStyle, marginTop: 4 }}>
                    Branch checkout unavailable here
                  </div>
                )
              ) : (
                !loadError &&
                !branchesQuery.isLoading &&
                filteredBranches.length === 0 &&
                !canCreateBranch && (
                  <div
                    style={{
                      padding: "8px 10px",
                      color: "var(--text-dim)",
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                    }}
                  >
                    No matching branches.
                  </div>
                )
              )}
            </div>
            {onCreateWorktree && (
              <div style={{ borderTop: "1px solid var(--border)", padding: 6 }}>
                <button
                  type="button"
                  className="mc-branch-menu-item"
                  disabled={createWorktreeDisabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    closeTypeahead();
                    onCreateWorktree();
                  }}
                  title={createWorktreeTitle}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 32,
                    border: 0,
                    borderRadius: 6,
                    color: createWorktreeDisabled ? "var(--text-faint)" : "var(--text-dim)",
                    cursor: createWorktreeDisabled ? "default" : "pointer",
                    padding: "7px 9px",
                    textAlign: "left",
                    fontFamily: "var(--mono)",
                    fontSize: 11.5,
                    opacity: createWorktreeDisabled ? 0.6 : 1,
                  }}
                >
                  <Icon name="git-branch" size={12} />
                  New worktree
                </button>
              </div>
            )}
          </CardFrame>,
          document.body,
        )
      : null;

  return (
    <>
      <div
        ref={anchorRef}
        style={{
          display: "inline-flex",
          alignItems: "center",
          minWidth: 0,
        }}
      >
        <Btn
          variant="ghost"
          icon="git-branch"
          disabled={triggerDisabled}
          onClick={toggleOpen}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls="branch-typeahead-options"
          className={attachedTrailing ? "mc-btn-attached-right" : undefined}
          title={
            worktreePath
              ? `${worktreePath}${branch ? ` · branch ${branch}` : ""}`
              : branch
              ? `Switch branch (${branch})`
              : "Switch branch"
          }
          style={{
            fontFamily: "var(--mono)",
            maxWidth: "min(36ch, 42vw)",
            ...(selected
              ? {
                  color: "var(--accent)",
                  filter: "drop-shadow(0 0 8px var(--accent-glow))",
                }
              : null),
          }}
        >
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {branchLabel}
          </span>
          <Icon
            name="chevron-down"
            size={11}
            style={{
              color: "var(--text-faint)",
              flexShrink: 0,
              transform: open ? "rotate(180deg)" : undefined,
              transition: "transform 120ms ease",
            }}
          />
        </Btn>
      </div>
      {dropdown}
      <ConfirmDialog
        open={!!pendingCheckout}
        onClose={() => setPendingCheckout(null)}
        onConfirm={confirmPendingCheckout}
        title="Switch branch with session running?"
        confirmLabel="Switch anyway"
        cancelLabel="Cancel"
        variant="primary"
        icon="git-branch"
        loading={checkout.isPending}
        width={520}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.5, fontSize: 13 }}>
            {activeSessionSummary.charAt(0).toUpperCase() + activeSessionSummary.slice(1)} in this
            worktree. Switching to{" "}
            <span style={{ fontFamily: "var(--mono)", color: "var(--accent)" }}>
              {pendingCheckout?.branch}
            </span>{" "}
            now could leave agents writing to the wrong files or produce broken output.
          </p>
          <p style={{ margin: 0, color: "var(--text-dim)", lineHeight: 1.5, fontSize: 12 }}>
            Stop or finish active sessions first if you want a clean switch.
          </p>
        </div>
      </ConfirmDialog>
      <Modal
        open={!!checkoutError}
        onClose={() => setCheckoutError(null)}
        title={checkoutError?.title ?? "Could not switch branch"}
        width={520}
        footer={
          <Btn variant="ghost" onClick={() => setCheckoutError(null)}>
            Close
          </Btn>
        }
      >
        <div style={{ display: "grid", gap: 12 }}>
          <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.5 }}>
            {checkoutError?.message}
          </p>
          {checkoutError?.stderr && (
            <pre
              style={{
                margin: 0,
                padding: 12,
                borderRadius: 8,
                background: "var(--surface-0)",
                border: "1px solid var(--border)",
                color: "var(--text-dim)",
                fontFamily: "var(--mono)",
                fontSize: 11,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 220,
                overflow: "auto",
              }}
            >
              {checkoutError.stderr}
            </pre>
          )}
        </div>
      </Modal>
    </>
  );
}
