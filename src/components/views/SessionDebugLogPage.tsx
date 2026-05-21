import { useCallback, useEffect, useMemo, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { getElectron } from "~/lib/electron";
import type { SessionTerminalDebugLogEntry } from "~/shared/electron-contract";
import {
  Field,
  SettingsSection,
  formatTimestamp,
  useCopy,
} from "~/components/views/SettingsParts";

export function SessionDebugLogPage() {
  const [entries, setEntries] = useState<SessionTerminalDebugLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopy();
  const electron = getElectron();

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await electron?.debugLog.listSessionTerminalErrors();
      setEntries(next ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load session logs.");
    } finally {
      setLoading(false);
    }
  }, [electron]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const logJson = useMemo(() => JSON.stringify(entries, null, 2), [entries]);

  const clearEntries = async () => {
    if (!electron) return;
    await electron.debugLog.clearSessionTerminalErrors();
    await loadEntries();
  };

  if (!electron) {
    return (
      <SettingsSection
        title="Session Debug Log"
        subtitle="Terminal startup diagnostics are available in the desktop app."
        headingLevel="h1"
      >
        <EmptyDebugLog message="No desktop runtime is attached." />
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection
        title="Session Debug Log"
        subtitle="In-memory terminal startup diagnostics for agent session launches."
        headingLevel="h1"
      >
        <Field label="Session terminal startup">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "12px 14px",
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              borderRadius: 7,
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>
                {entries.length} entr{entries.length === 1 ? "y" : "ies"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}>
                Stored only until Mission Control quits or this log is cleared.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <Btn variant="ghost" size="sm" icon="refresh" onClick={() => void loadEntries()} disabled={loading}>
                Refresh
              </Btn>
              <Btn
                variant="ghost"
                size="sm"
                icon="copy"
                onClick={() => copy(logJson, "session-debug")}
                disabled={entries.length === 0}
              >
                {copied === "session-debug" ? "Copied" : "Copy JSON"}
              </Btn>
              <Btn
                variant="ghost"
                size="sm"
                icon="trash"
                onClick={() => void clearEntries()}
                disabled={entries.length === 0}
              >
                Clear
              </Btn>
            </div>
          </div>
          {error && (
            <div role="alert" style={{ marginTop: 8, color: "var(--status-failed)", fontSize: 12 }}>
              {error}
            </div>
          )}
        </Field>
      </SettingsSection>

      <SettingsSection title="Entries">
        {loading ? (
          <EmptyDebugLog message="Loading session startup diagnostics." />
        ) : entries.length === 0 ? (
          <EmptyDebugLog message="No session startup errors have been recorded." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {entries.map((entry) => (
              <SessionDebugLogEntryView key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </SettingsSection>
    </>
  );
}

function SessionDebugLogEntryView({ entry }: { entry: SessionTerminalDebugLogEntry }) {
  const details = entry.details ? JSON.stringify(entry.details, null, 2) : null;
  return (
    <article
      style={{
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        padding: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
              minWidth: 0,
            }}
          >
            <span
              style={{
                color: entry.level === "error" ? "var(--status-failed)" : "var(--status-needs)",
                fontFamily: "var(--mono)",
                fontSize: 11,
                textTransform: "uppercase",
              }}
            >
              {entry.level}
            </span>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text)",
                overflowWrap: "anywhere",
              }}
            >
              {entry.stage}
            </span>
          </div>
          <div style={{ color: "var(--text)", fontSize: 13, lineHeight: 1.45, overflowWrap: "anywhere" }}>
            {entry.message}
          </div>
        </div>
        <time
          dateTime={entry.createdAt}
          style={{ flexShrink: 0, fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-dim)" }}
        >
          {formatTimestamp(entry.createdAt)}
        </time>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 8,
          marginBottom: entry.outputTail || details ? 10 : 0,
        }}
      >
        <Meta label="Source" value={entry.source} />
        <Meta label="Agent" value={entry.agent} />
        <Meta label="Task" value={entry.taskId} />
        <Meta label="PTY" value={entry.ptyId} />
        <Meta label="Exit" value={formatExit(entry)} />
        <Meta label="Elapsed" value={entry.elapsedMs === undefined ? null : `${entry.elapsedMs}ms`} />
        <Meta label="CWD" value={entry.cwd} wide />
        <Meta label="Command" value={entry.command} wide />
      </div>

      {entry.outputTail && <LogBlock label="Output tail" value={entry.outputTail} />}
      {details && <LogBlock label="Details" value={details} />}
    </article>
  );
}

function Meta({ label, value, wide = false }: { label: string; value?: string | null; wide?: boolean }) {
  if (!value) return null;
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : undefined, minWidth: 0 }}>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: "var(--text-faint)",
          textTransform: "uppercase",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--text-dim)",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function LogBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: "var(--text-faint)",
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          maxHeight: 220,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontFamily: "var(--mono)",
          fontSize: 11,
          lineHeight: 1.45,
          color: "var(--text-dim)",
          background: "var(--surface-1)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 10,
        }}
      >
        {value}
      </pre>
    </div>
  );
}

function EmptyDebugLog({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: "20px 16px",
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        color: "var(--text-dim)",
        fontFamily: "var(--mono)",
        fontSize: 12,
      }}
    >
      {message}
    </div>
  );
}

function formatExit(entry: SessionTerminalDebugLogEntry): string | null {
  if (entry.exitCode === undefined && entry.signal === undefined) return null;
  const parts: string[] = [];
  if (entry.exitCode !== undefined) parts.push(`code ${entry.exitCode}`);
  if (entry.signal !== undefined) parts.push(`signal ${entry.signal}`);
  return parts.join(", ");
}
