import { useCallback, useEffect, useMemo, useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { Field, SettingsSection } from "~/components/views/SettingsParts";
import { useServerEvents, type ServerEvent } from "~/lib/use-events";
import { queryKeys, useLogs } from "~/queries";
import { useQueryClient } from "@tanstack/react-query";
import type { AppLogEntry, AppLogLevel } from "~/shared/logging";

const LEVEL_META: Record<
  AppLogLevel,
  { label: string; color: string; background: string }
> = {
  event: {
    label: "Event",
    color: "var(--accent)",
    background: "var(--accent-faint)",
  },
  info: {
    label: "Info",
    color: "var(--status-ready)",
    background: "color-mix(in srgb, var(--status-ready) 12%, transparent)",
  },
  success: {
    label: "Success",
    color: "var(--status-done)",
    background: "color-mix(in srgb, var(--status-done) 12%, transparent)",
  },
  warn: {
    label: "Warn",
    color: "var(--status-interrupted)",
    background: "color-mix(in srgb, var(--status-interrupted) 12%, transparent)",
  },
  error: {
    label: "Error",
    color: "var(--status-failed)",
    background: "color-mix(in srgb, var(--status-failed) 12%, transparent)",
  },
};

const CATEGORY_LABEL: Record<AppLogEntry["category"], string> = {
  api: "API",
  session: "Session",
  system: "System",
};

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function LogsSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useLogs();
  const [logs, setLogs] = useState<AppLogEntry[]>([]);

  useEffect(() => {
    if (data) setLogs(sortLogs(data));
  }, [data]);

  const onServerEvent = useCallback((event: ServerEvent) => {
    const entry = event.entry;
    if (event.type !== "log:created" || !isLogEntry(entry)) return;
    setLogs((prev) => mergeLog(prev, entry));
    queryClient.setQueryData<AppLogEntry[]>(queryKeys.logs, (prev) =>
      mergeLog(prev ?? [], entry),
    );
  }, [queryClient]);

  useServerEvents(onServerEvent);

  const counts = useMemo(() => {
    return logs.reduce(
      (acc, log) => {
        acc[log.level] += 1;
        return acc;
      },
      { event: 0, info: 0, success: 0, warn: 0, error: 0 } as Record<
        AppLogLevel,
        number
      >,
    );
  }, [logs]);

  return (
    <SettingsSection
      title="Logs"
      subtitle="Live in-memory events from sessions and API activity."
      headingLevel="h1"
    >
      <Field label="Activity">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              minWidth: 0,
            }}
          >
            <LiveBadge />
            <CountPill label="All" value={logs.length} color="var(--text-dim)" />
            <CountPill label="Warn" value={counts.warn} color={LEVEL_META.warn.color} />
            <CountPill label="Error" value={counts.error} color={LEVEL_META.error.color} />
          </div>
          <Btn
            type="button"
            variant="ghost"
            size="sm"
            icon="refresh"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? "Refreshing" : "Refresh"}
          </Btn>
        </div>
        {isLoading ? (
          <LogState label="Loading logs" />
        ) : isError ? (
          <LogState label="Could not load logs" tone="error" />
        ) : logs.length === 0 ? (
          <LogState label="No logs yet" />
        ) : (
          <div
            aria-live="polite"
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            {logs.map((log) => (
              <LogRow key={log.id} log={log} />
            ))}
          </div>
        )}
      </Field>
    </SettingsSection>
  );
}

function LogRow({ log }: { log: AppLogEntry }) {
  const meta = LEVEL_META[log.level];
  const metadata = Object.entries(log.metadata ?? {});

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(130px, 170px) minmax(0, 1fr)",
        gap: 12,
        alignItems: "start",
        padding: "10px 12px",
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        borderRadius: 7,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 7,
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--text-dim)",
            whiteSpace: "nowrap",
          }}
        >
          {formatLogTime(log)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 7px",
              borderRadius: 999,
              border: `1px solid ${meta.color}`,
              background: meta.background,
              color: meta.color,
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: meta.color,
                boxShadow: `0 0 8px ${meta.color}`,
              }}
            />
            {meta.label}
          </span>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--text-faint)",
            }}
          >
            {CATEGORY_LABEL[log.category]}
          </span>
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: "var(--text)",
            lineHeight: 1.45,
            overflowWrap: "anywhere",
          }}
        >
          {log.message}
        </div>
        {metadata.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginTop: 8,
            }}
          >
            {metadata.map(([key, value]) => (
              <span
                key={key}
                style={{
                  maxWidth: "100%",
                  padding: "3px 6px",
                  borderRadius: 5,
                  background: "var(--surface-1)",
                  border: "1px solid var(--border)",
                  color: "var(--text-dim)",
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  overflowWrap: "anywhere",
                }}
              >
                {key}={String(value)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LiveBadge() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        borderRadius: 999,
        background: "var(--accent-faint)",
        border: "1px solid var(--accent-border)",
        color: "var(--accent)",
        fontFamily: "var(--mono)",
        fontSize: 10.5,
        fontWeight: 600,
      }}
    >
      <Icon name="terminal" size={11} />
      Live
    </span>
  );
}

function CountPill({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 8px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: "var(--surface-0)",
        color,
        fontFamily: "var(--mono)",
        fontSize: 10.5,
      }}
    >
      {label}
      <span style={{ color: "var(--text)" }}>{value}</span>
    </span>
  );
}

function LogState({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "muted" | "error";
}) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: 82,
        padding: "14px",
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        color: tone === "error" ? "var(--status-failed)" : "var(--text-dim)",
        fontSize: 12,
      }}
    >
      <Icon name="list" size={13} />
      {label}
    </div>
  );
}

function isLogEntry(value: unknown): value is AppLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<AppLogEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.at === "string" &&
    typeof entry.timestamp === "number" &&
    typeof entry.message === "string" &&
    (entry.level === "event" ||
      entry.level === "info" ||
      entry.level === "success" ||
      entry.level === "warn" ||
      entry.level === "error") &&
    (entry.category === "api" ||
      entry.category === "session" ||
      entry.category === "system")
  );
}

function mergeLog(logs: AppLogEntry[], entry: AppLogEntry): AppLogEntry[] {
  return sortLogs([entry, ...logs.filter((log) => log.id !== entry.id)]).slice(0, 1_000);
}

function sortLogs(logs: AppLogEntry[]): AppLogEntry[] {
  return [...logs].sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
}

function formatLogTime(log: AppLogEntry): string {
  const date = new Date(log.timestamp);
  if (Number.isNaN(date.getTime())) return log.at;
  const millis = String(date.getMilliseconds()).padStart(3, "0");
  return `${timeFormatter.format(date)}.${millis}`;
}
