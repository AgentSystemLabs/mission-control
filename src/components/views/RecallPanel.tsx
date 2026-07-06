import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { api } from "~/lib/api";
import { useDebouncedCallback } from "~/lib/use-debounced-callback";
import { useServerEvents, type ServerEvent } from "~/lib/use-events";
import {
  queryKeys,
  useArchivedMemory,
  useCodeGraphStatus,
  useCodeGraphSummary,
  useMemorySearch,
  useProjectMemory,
} from "~/queries";
import type {
  GraphIndexPhase,
  GraphIndexProgress,
  GraphStatus,
  GraphSummaryNode,
} from "~/shared/code-graph";
import {
  MEMORY_CONFIDENCES,
  MEMORY_TYPES,
  MEMORY_TYPE_LABELS,
  MEMORY_TITLE_MAX,
  isMemoryStale,
  type MemoryConfidence,
  type MemorySource,
  type MemoryType,
  type MemoryView,
} from "~/shared/project-memory";

// Provenance shown on a row. Manual writes are the norm and get no badge.
const SOURCE_LABEL: Record<MemorySource, string> = {
  manual: "",
  voice: "voice",
  agent: "agent",
  "auto-distill": "auto",
  import: "imported",
};

// Confidence is surfaced as a small colored chip so the user (and the ranker)
// weight facts correctly — confirmed reads calm, ambiguous reads cautionary.
const CONFIDENCE_COLOR: Record<MemoryConfidence, string> = {
  confirmed: "var(--status-success, #3ba55d)",
  inferred: "var(--text-faint)",
  ambiguous: "var(--status-warning, #d9a441)",
};

const CARD: CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "10px 12px",
};

const INPUT: CSSProperties = {
  width: "100%",
  background: "var(--surface-0)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  outline: 0,
  color: "var(--text)",
  padding: "6px 9px",
  fontFamily: "var(--mono)",
  fontSize: 12,
};

const TYPE_BADGE: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-dim)",
  background: "var(--surface-2)",
  borderRadius: 4,
  padding: "1px 6px",
  whiteSpace: "nowrap",
};

function TypeSelect({
  value,
  onChange,
}: {
  value: MemoryType;
  onChange: (t: MemoryType) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as MemoryType)}
      aria-label="Memory type"
      style={{ ...INPUT, width: "auto", cursor: "pointer" }}
    >
      {MEMORY_TYPES.map((t) => (
        <option key={t} value={t}>
          {MEMORY_TYPE_LABELS[t]}
        </option>
      ))}
    </select>
  );
}

function ConfidenceSelect({
  value,
  onChange,
}: {
  value: MemoryConfidence;
  onChange: (c: MemoryConfidence) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as MemoryConfidence)}
      aria-label="Confidence"
      title="How sure are we this is correct?"
      style={{ ...INPUT, width: "auto", cursor: "pointer" }}
    >
      {MEMORY_CONFIDENCES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function AddMemoryForm({
  projectId,
  onAdded,
  onCancel,
}: {
  projectId: string;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<MemoryType>("discovery");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    try {
      await api.createMemory(projectId, { type, title: t, body: body.trim() || undefined });
      setTitle("");
      setBody("");
      onAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save memory");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ ...CARD, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <TypeSelect value={type} onChange={setType} />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) void submit();
          }}
          placeholder="What should the AI remember? (one line)"
          maxLength={MEMORY_TITLE_MAX}
          aria-label="Memory title"
          autoFocus
          style={{ ...INPUT, flex: 1 }}
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Optional detail — the why / where / how"
        aria-label="Memory detail"
        rows={2}
        style={{ ...INPUT, resize: "vertical", fontFamily: "var(--mono)" }}
      />
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <Btn variant="ghost" onClick={onCancel} disabled={saving}>
          Close
        </Btn>
        <Btn variant="primary" icon="plus" onClick={() => void submit()} disabled={!title.trim() || saving}>
          Remember this
        </Btn>
      </div>
    </div>
  );
}

function MemoryRow({
  memory,
  onChanged,
}: {
  memory: MemoryView;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<MemoryType>(memory.type);
  const [title, setTitle] = useState(memory.title);
  const [body, setBody] = useState(memory.body);
  const [confidence, setConfidence] = useState<MemoryConfidence>(memory.confidence);
  const [busy, setBusy] = useState(false);
  const stale = isMemoryStale(memory, Date.now());

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = () =>
    run(async () => {
      const t = title.trim();
      if (!t) return;
      await api.updateMemory(memory.id, { type, title: t, body: body.trim(), confidence });
      setEditing(false);
    });

  // Verify against code shows its verdict as a toast; onChanged() refreshes the
  // row (confidence/staleness may have moved, or a correction superseded it).
  const verify = async () => {
    setBusy(true);
    try {
      const { verdict } = await api.verifyMemory(memory.id);
      if (verdict === "verified") toast.success("Verified against the current code");
      else if (verdict === "contradicted")
        toast.warning("Code contradicts this — replaced with a correction");
      else if (verdict === "stale") toast.warning("Could not confirm this — flagged as ambiguous");
      else toast.info("Verification skipped (engine off or not a local project)");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verify failed");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div style={{ ...CARD, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <TypeSelect value={type} onChange={setType} />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MEMORY_TITLE_MAX}
            aria-label="Edit title"
            style={{ ...INPUT, flex: 1 }}
          />
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          aria-label="Edit detail"
          style={{ ...INPUT, resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-faint)", marginRight: "auto" }}>
            Confidence
          </span>
          <ConfidenceSelect value={confidence} onChange={setConfidence} />
          <Btn variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="primary" icon="check" onClick={() => void saveEdit()} disabled={busy || !title.trim()}>
            Save
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...CARD, display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 3 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={TYPE_BADGE}>{MEMORY_TYPE_LABELS[memory.type]}</span>
          {memory.pinned && <Icon name="pin-fill" size={11} style={{ color: "var(--accent)" }} />}
          {SOURCE_LABEL[memory.source] && (
            <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
              {SOURCE_LABEL[memory.source]}
            </span>
          )}
          <span
            title={`Confidence: ${memory.confidence}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--text-faint)" }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: CONFIDENCE_COLOR[memory.confidence],
              }}
            />
            {memory.confidence}
          </span>
          {stale && (
            <span
              title="Not verified recently — verify against code to refresh it"
              style={{
                fontSize: 10,
                color: "var(--status-warning, #d9a441)",
                border: "1px solid var(--status-warning, #d9a441)",
                borderRadius: 4,
                padding: "0 5px",
              }}
            >
              stale
            </span>
          )}
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", wordBreak: "break-word" }}>
          {memory.title}
        </div>
        {memory.body && (
          <div style={{ fontSize: 11.5, color: "var(--text-dim)", wordBreak: "break-word" }}>
            {memory.body}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
        <IconBtn
          icon={memory.pinned ? "pin-fill" : "pin"}
          title={memory.pinned ? "Unpin" : "Pin (always in the brief)"}
          active={memory.pinned}
          disabled={busy}
          onClick={() => void run(() => api.updateMemory(memory.id, { pinned: !memory.pinned }))}
        />
        <IconBtn
          icon="shield"
          title="Verify against the current code"
          active={stale}
          disabled={busy}
          onClick={() => void verify()}
        />
        <IconBtn icon="pencil" title="Edit" disabled={busy} onClick={() => setEditing(true)} />
        <IconBtn
          icon="trash"
          title="Delete (archive)"
          disabled={busy}
          onClick={() => void run(() => api.deleteMemory(memory.id))}
        />
      </div>
    </div>
  );
}

function IconBtn({
  icon,
  title,
  onClick,
  active,
  disabled,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "transparent",
        border: 0,
        borderRadius: 5,
        padding: 5,
        cursor: disabled ? "not-allowed" : "pointer",
        color: active ? "var(--accent)" : "var(--text-dim)",
        display: "flex",
      }}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

export type RecallFilter = "all" | "recent" | "archived";

/** Auto-captured memories the user may want to review (auto-distill / agent writes). */
function isRecentlyLearned(m: MemoryView): boolean {
  return m.source === "auto-distill" || m.source === "agent";
}

/** A soft-deleted / superseded memory, shown read-only in the Archived history view. */
function ArchivedRow({ memory, onChanged }: { memory: MemoryView; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const superseded = memory.supersededById !== null;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ ...CARD, display: "flex", gap: 10, alignItems: "flex-start", opacity: 0.75 }}>
      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 3 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={TYPE_BADGE}>{MEMORY_TYPE_LABELS[memory.type]}</span>
          <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
            {superseded ? "superseded" : "archived"}
          </span>
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-dim)", wordBreak: "break-word" }}>
          {memory.title}
        </div>
      </div>
      <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
        {!superseded && (
          <IconBtn
            icon="refresh"
            title="Restore to active"
            disabled={busy}
            onClick={() => void run(() => api.updateMemory(memory.id, { status: "active" }))}
          />
        )}
        <IconBtn
          icon="trash"
          title="Delete permanently"
          disabled={busy}
          onClick={() => void run(() => api.deleteMemory(memory.id, { hard: true }))}
        />
      </div>
    </div>
  );
}

// --- Paged list ---

// Rows rendered per page. Long memory lists render incrementally so the modal
// stays fast — remount (via key) when the underlying list context changes.
const PAGE_SIZE = 25;

function PagedList({
  items,
  render,
}: {
  items: MemoryView[];
  render: (m: MemoryView) => React.ReactNode;
}) {
  const [count, setCount] = useState(PAGE_SIZE);
  const remaining = items.length - count;
  return (
    <>
      {items.slice(0, count).map(render)}
      {remaining > 0 && (
        <div style={{ display: "flex", justifyContent: "center", padding: "2px 0" }}>
          <Btn
            variant="ghost"
            size="sm"
            icon="chevron-down"
            onClick={() => setCount((c) => c + PAGE_SIZE)}
          >
            Show {Math.min(PAGE_SIZE, remaining)} more ({remaining} remaining)
          </Btn>
        </div>
      )}
    </>
  );
}

// --- Session brief tab ---

function BriefSection({ projectId, active }: { projectId: string; active: boolean }) {
  const [brief, setBrief] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { brief: md } = await api.getProjectBrief(projectId);
      setBrief(md || "(no memories yet — a new session gets no brief)");
    } catch {
      setBrief("(could not load brief)");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Fetch lazily on first activation, not on modal open.
  useEffect(() => {
    if (active && brief === null && !loading) void load();
  }, [active, brief, loading, load]);

  return (
    <>
      <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
        The exact markdown handed to each new agent session — assembled from the most relevant
        memories, pinned facts first.
      </p>
      <pre
        style={{
          ...CARD,
          margin: 0,
          maxHeight: 380,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--text-dim)",
        }}
      >
        {loading && brief === null ? "Loading…" : brief ?? ""}
      </pre>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Btn variant="ghost" size="sm" icon="refresh" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Btn>
      </div>
    </>
  );
}

// --- Code Graph section ---

const PHASE_LABEL: Record<GraphIndexPhase, string> = {
  enumerating: "Enumerating files",
  parsing: "Parsing",
  resolving: "Resolving edges",
  writing: "Resolving & writing",
  ranking: "Ranking",
  done: "Done",
  canceled: "Canceled",
  error: "Failed",
};

const CONFIDENCE_CHIP: Record<string, string> = {
  extracted: "var(--status-success, #3ba55d)",
  inferred: "var(--text-faint)",
  ambiguous: "var(--status-warning, #d9a441)",
};

const TERMINAL_PHASES: readonly GraphIndexPhase[] = ["done", "canceled", "error"];

function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

function GraphStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: "grid", gap: 1 }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", fontFamily: "var(--mono)" }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      <span style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-faint)" }}>
        {label}
      </span>
    </div>
  );
}

function GraphBuildingView({
  progress,
  onCancel,
  canceling,
}: {
  progress: GraphIndexProgress;
  onCancel: () => void;
  canceling: boolean;
}) {
  const pct =
    progress.filesTotal > 0 ? Math.min(100, Math.round((progress.filesDone / progress.filesTotal) * 100)) : 0;
  const elapsedMs = Math.max(0, Date.now() - progress.startedAt);
  const rate = elapsedMs > 400 ? progress.filesDone / (elapsedMs / 1000) : 0;
  const remaining = Math.max(0, progress.filesTotal - progress.filesDone);
  const etaMs = rate > 0 ? (remaining / rate) * 1000 : null;
  return (
    <div style={{ ...CARD, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
          {PHASE_LABEL[progress.phase]}
          {progress.filesTotal > 0 ? ` · ${progress.filesDone.toLocaleString()} / ${progress.filesTotal.toLocaleString()} files` : ""}
        </span>
        <Btn variant="ghost" size="sm" icon="stop" onClick={onCancel} disabled={canceling}>
          {canceling ? "Canceling…" : "Cancel"}
        </Btn>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "var(--accent, #6ea8fe)",
            transition: "width 0.2s ease",
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <GraphStat label="nodes" value={progress.nodes} />
        <GraphStat label="edges" value={progress.edges} />
        <GraphStat label="skipped" value={progress.skipped} />
        <GraphStat label="rate" value={rate ? `${rate.toFixed(0)}/s` : "—"} />
        <GraphStat label="elapsed" value={formatDuration(elapsedMs)} />
        <GraphStat label="eta" value={etaMs != null ? `~${formatDuration(etaMs)}` : "—"} />
      </div>
      {progress.currentFile && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--text-faint)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={progress.currentFile}
        >
          {progress.currentFile}
        </div>
      )}
    </div>
  );
}

function GodNodeRow({ node }: { node: GraphSummaryNode }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 11.5 }}>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: "var(--text-faint)",
          minWidth: 26,
          textAlign: "right",
        }}
        title="incident edges (degree)"
      >
        {node.degree}
      </span>
      <span style={{ color: "var(--text)", fontWeight: 600, wordBreak: "break-word" }}>{node.name}</span>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: "var(--text-faint)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={`${node.filePath}:${node.startLine}`}
      >
        {node.filePath}:{node.startLine}
      </span>
    </div>
  );
}

function GraphIndexedView({
  projectId,
  status,
  onRebuild,
  onRefresh,
  busy,
}: {
  projectId: string;
  status: GraphStatus;
  onRebuild: () => void;
  onRefresh: () => void;
  busy: boolean;
}) {
  const summary = useCodeGraphSummary(projectId, true);
  const cb = status.confidenceBreakdown;
  const lastIndexed = status.lastIndexedAt
    ? new Date(status.lastIndexedAt).toLocaleString()
    : "—";
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ ...CARD, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <GraphStat label="files" value={status.fileCount} />
          <GraphStat label="nodes" value={status.nodeCount} />
          <GraphStat label="edges" value={status.edgeCount} />
          <GraphStat label="built in" value={formatDuration(status.durationMs)} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {(["extracted", "inferred", "ambiguous"] as const).map((k) => (
            <span
              key={k}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--text-dim)" }}
              title={`${k} edges`}
            >
              <span style={{ width: 7, height: 7, borderRadius: 999, background: CONFIDENCE_CHIP[k] }} />
              {cb[k].toLocaleString()} {k}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-faint)" }}>Last indexed {lastIndexed}</div>
      </div>

      <div style={{ ...CARD, display: "grid", gap: 7 }}>
        <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-faint)" }}>
          Most connected
        </div>
        {summary.data && summary.data.godNodes.length > 0 ? (
          summary.data.godNodes.map((n) => <GodNodeRow key={n.id} node={n} />)
        ) : (
          <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
            {summary.isLoading ? "Loading…" : "No symbols ranked yet."}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <Btn variant="ghost" size="sm" icon="refresh" onClick={onRefresh} disabled={busy}>
          Refresh changed
        </Btn>
        <Btn variant="ghost" size="sm" icon="git-branch" onClick={onRebuild} disabled={busy}>
          Rebuild
        </Btn>
      </div>
    </div>
  );
}

// Graph status + live SSE progress, hoisted to the panel so the tab bar can show
// a "building" indicator while the user is on another tab.
function useGraphIndexing(projectId: string) {
  const queryClient = useQueryClient();
  const { data: status } = useCodeGraphStatus(projectId);
  const [live, setLive] = useState<GraphIndexProgress | null>(null);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.graphStatus(projectId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.graphSummary(projectId) });
  }, [queryClient, projectId]);

  useServerEvents(
    useCallback(
      (e: ServerEvent) => {
        if (e.projectId !== projectId) return;
        if (e.type === "graph:index-progress") {
          setLive(e.progress as GraphIndexProgress);
        } else if (e.type === "graph:indexed") {
          setLive(null);
          invalidate();
        }
      },
      [projectId, invalidate],
    ),
  );

  // Freshest of the SSE stream and the status snapshot (reconnect after reopen).
  const progress = live ?? status?.indexing ?? null;
  const building = progress != null && !TERMINAL_PHASES.includes(progress.phase);
  return { status, progress, building, setLive, invalidate };
}

function CodeGraphSection({
  projectId,
  graph,
}: {
  projectId: string;
  graph: ReturnType<typeof useGraphIndexing>;
}) {
  const { status, progress, building, setLive, invalidate } = graph;
  const [busy, setBusy] = useState(false);
  const indexed = (status?.indexed ?? false) && !building;

  const start = useCallback(
    async (mode: "full" | "incremental") => {
      setBusy(true);
      try {
        const { status: next } = await api.buildGraph(projectId, mode);
        if (next.indexing) setLive(next.indexing);
        invalidate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not start indexing");
      } finally {
        setBusy(false);
      }
    },
    [projectId, setLive, invalidate],
  );

  const cancel = useCallback(async () => {
    setBusy(true);
    try {
      await api.cancelGraphBuild(projectId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel");
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  return (
    <>
      <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
        A structural map of this project's symbols and how they connect (imports, calls, defines).
        Agents query it on demand to answer what grep can't — “what calls X”, “what breaks if I change Y”.
      </p>

      {building && progress ? (
        <GraphBuildingView progress={progress} onCancel={() => void cancel()} canceling={busy} />
      ) : indexed && status ? (
        <GraphIndexedView
          projectId={projectId}
          status={status}
          onRebuild={() => void start("full")}
          onRefresh={() => void start("incremental")}
          busy={busy}
        />
      ) : (
        <div style={{ ...CARD, display: "grid", gap: 10, textAlign: "center", padding: "16px 12px" }}>
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            This project isn't indexed yet. Build the graph so sessions start already understanding the
            architecture.
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Btn variant="accent" size="sm" icon="git-branch" onClick={() => void start("full")} disabled={busy}>
              {busy ? "Starting…" : "Build code graph"}
            </Btn>
          </div>
        </div>
      )}
    </>
  );
}

// --- Tabs ---

type RecallTab = "memories" | "graph" | "brief";

function RecallTabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: RecallTab; label: string; badge?: number; busy?: boolean }[];
  active: RecallTab;
  onChange: (tab: RecallTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Recall sections"
      style={{
        display: "flex",
        gap: 2,
        padding: 3,
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--surface-0)",
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`recall-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`recall-panel-${tab.id}`}
            title={tab.busy ? `${tab.label} — building…` : undefined}
            onClick={() => onChange(tab.id)}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "7px 10px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--mono)",
              fontSize: 11,
              fontWeight: selected ? 600 : 500,
              letterSpacing: "0.02em",
              color: selected ? "var(--text)" : "var(--text-dim)",
              background: selected ? "var(--accent-dim)" : "transparent",
              boxShadow: selected ? "inset 0 0 0 1px var(--accent-border)" : "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tab.label}</span>
            {tab.badge != null && tab.badge > 0 && (
              <span
                aria-hidden
                style={{
                  fontSize: 10,
                  fontVariantNumeric: "tabular-nums",
                  color: selected ? "var(--accent)" : "var(--text-faint)",
                }}
              >
                {tab.badge}
              </span>
            )}
            {tab.busy && (
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: "var(--accent, #6ea8fe)",
                  flexShrink: 0,
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// Panels stay mounted and hide via display so tab switches keep state (search,
// pagination, live graph progress) and don't refetch.
function TabPanel({
  id,
  active,
  children,
}: {
  id: RecallTab;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`recall-panel-${id}`}
      aria-labelledby={`recall-tab-${id}`}
      style={{ display: active ? "grid" : "none", gap: 12, alignContent: "start" }}
    >
      {children}
    </div>
  );
}

export function RecallPanel({
  projectId,
  initialFilter = "all",
}: {
  projectId: string;
  initialFilter?: RecallFilter;
}) {
  const queryClient = useQueryClient();
  const { data: memories, isLoading } = useProjectMemory(projectId);
  const [tab, setTab] = useState<RecallTab>("memories");
  const [filter, setFilter] = useState<RecallFilter>(initialFilter);
  const [adding, setAdding] = useState(false);
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const commitQuery = useDebouncedCallback((q: string) => setQuery(q), 200);
  const onQueryChange = (q: string) => {
    setRawQuery(q);
    commitQuery(q);
  };
  const searchQuery = query.trim();
  const searching = searchQuery.length > 0;
  const search = useMemorySearch(projectId, searchQuery);
  const archived = useArchivedMemory(projectId, filter === "archived" && !searching);
  const graph = useGraphIndexing(projectId);

  const refresh = useCallback(() => {
    // The projectMemory prefix key also covers the archived + search sub-keys.
    void queryClient.invalidateQueries({ queryKey: queryKeys.projectMemory(projectId) });
  }, [queryClient, projectId]);

  const learnedCount = useMemo(
    () => (memories ?? []).filter(isRecentlyLearned).length,
    [memories],
  );

  // Pinned first, then by the canonical type order (matches the brief). The
  // "recent" view instead leads with the newest captures for fast review.
  const ordered = useMemo(() => {
    const list = (memories ?? []).filter((m) => (filter === "recent" ? isRecentlyLearned(m) : true));
    const typeRank = new Map(MEMORY_TYPES.map((t, i) => [t, i]));
    return [...list].sort((a, b) => {
      if (filter === "recent") return b.createdAt - a.createdAt;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const ta = typeRank.get(a.type) ?? 99;
      const tb = typeRank.get(b.type) ?? 99;
      if (ta !== tb) return ta - tb;
      return b.updatedAt - a.updatedAt;
    });
  }, [memories, filter]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <RecallTabBar
        tabs={[
          { id: "memories", label: "Memories", badge: memories?.length },
          { id: "graph", label: "Code graph", busy: graph.building },
          { id: "brief", label: "Session brief" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <TabPanel id="memories" active={tab === "memories"}>
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
          Curated facts about this project. Mission Control assembles the most relevant into a{" "}
          <strong style={{ color: "var(--text)" }}>Session Brief</strong> and hands it to each new agent
          session, so agents don't rediscover the project from scratch.
        </p>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center", flex: 1 }}>
            <Icon
              name="search"
              size={13}
              style={{ position: "absolute", left: 9, color: "var(--text-faint)" }}
            />
            <input
              value={rawQuery}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search memories…"
              aria-label="Search memories"
              style={{ ...INPUT, paddingLeft: 28, paddingRight: rawQuery ? 28 : 9 }}
            />
            {rawQuery && (
              <button
                type="button"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => onQueryChange("")}
                style={{
                  position: "absolute",
                  right: 6,
                  background: "transparent",
                  border: 0,
                  cursor: "pointer",
                  color: "var(--text-dim)",
                  display: "flex",
                  padding: 2,
                }}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          {!adding && (
            <Btn variant="ghost" size="sm" icon="plus" onClick={() => setAdding(true)}>
              Add memory
            </Btn>
          )}
        </div>

        {adding && (
          <AddMemoryForm projectId={projectId} onAdded={refresh} onCancel={() => setAdding(false)} />
        )}

        {!searching && (
          <div style={{ display: "flex", gap: 6 }}>
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
              All{memories ? ` (${memories.length})` : ""}
            </FilterChip>
            <FilterChip
              active={filter === "recent"}
              onClick={() => setFilter("recent")}
              disabled={learnedCount === 0}
            >
              Recently learned{learnedCount ? ` (${learnedCount})` : ""}
            </FilterChip>
            <FilterChip active={filter === "archived"} onClick={() => setFilter("archived")}>
              Archived
            </FilterChip>
          </div>
        )}

        <div style={{ display: "grid", gap: 8 }}>
          {searching ? (
            search.isLoading ? (
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Searching…</div>
            ) : (search.data ?? []).length === 0 ? (
              <EmptyCard>No memories match “{searchQuery}”.</EmptyCard>
            ) : (
              <PagedList
                key={`search:${searchQuery}`}
                items={search.data ?? []}
                render={(m) => <MemoryRow key={m.id} memory={m} onChanged={refresh} />}
              />
            )
          ) : filter === "archived" ? (
            archived.isLoading ? (
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading archived…</div>
            ) : (archived.data ?? []).length === 0 ? (
              <EmptyCard>Nothing archived. Deleted and superseded memories land here.</EmptyCard>
            ) : (
              <PagedList
                key="archived"
                items={archived.data ?? []}
                render={(m) => <ArchivedRow key={m.id} memory={m} onChanged={refresh} />}
              />
            )
          ) : isLoading ? (
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading memories…</div>
          ) : ordered.length === 0 ? (
            <EmptyCard>
              {filter === "recent"
                ? "Nothing auto-captured yet. Finished sessions land here for review."
                : "No memories yet. Add one above, or let sessions capture them automatically."}
            </EmptyCard>
          ) : (
            <PagedList
              key={`active:${filter}`}
              items={ordered}
              render={(m) => <MemoryRow key={m.id} memory={m} onChanged={refresh} />}
            />
          )}
        </div>
      </TabPanel>

      <TabPanel id="graph" active={tab === "graph"}>
        <CodeGraphSection projectId={projectId} graph={graph} />
      </TabPanel>

      <TabPanel id="brief" active={tab === "brief"}>
        <BriefSection projectId={projectId} active={tab === "brief"} />
      </TabPanel>
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        ...CARD,
        textAlign: "center",
        color: "var(--text-dim)",
        fontSize: 12,
        padding: "18px 12px",
      }}
    >
      {children}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      style={{
        fontFamily: "var(--mono)",
        fontSize: 11,
        padding: "4px 10px",
        borderRadius: 999,
        cursor: disabled ? "not-allowed" : "pointer",
        color: active ? "var(--text)" : "var(--text-dim)",
        background: active ? "var(--accent-dim)" : "transparent",
        border: `1px solid ${active ? "var(--accent-border)" : "var(--border)"}`,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
