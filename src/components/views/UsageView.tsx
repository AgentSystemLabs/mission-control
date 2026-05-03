import type { UsageSummary } from "~/shared/token-usage";
import { ProjectIcon } from "~/components/ui/ProjectIcon";
import { Section } from "~/components/ui/Section";
import { EmptyState } from "~/components/ui/EmptyState";
import { formatN, HorizontalBar, TimeSeriesBars } from "./UsageCharts";

export function UsageView({ data }: { data: UsageSummary }) {
  const grandTotal =
    data.totals.inputTokens +
    data.totals.outputTokens +
    data.totals.cacheCreationTokens +
    data.totals.cacheReadTokens;

  if (grandTotal === 0) {
    return (
      <div style={{ padding: "32px 40px" }}>
        <PageHeader lastSyncedAt={data.lastSyncedAt} />
        <EmptyState
          title="No token usage yet"
          subtitle="Run a Claude Code task from a project, then come back to see usage here."
        />
      </div>
    );
  }

  const projectMax = data.perProject[0]
    ? totalOfRow(data.perProject[0])
    : 1;

  return (
    <div style={{ padding: "32px 40px", overflowY: "auto" }}>
      <PageHeader lastSyncedAt={data.lastSyncedAt} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 32,
        }}
      >
        <TotalCard label="Input" value={data.totals.inputTokens} />
        <TotalCard label="Output" value={data.totals.outputTokens} />
        <TotalCard label="Cache Write" value={data.totals.cacheCreationTokens} />
        <TotalCard label="Cache Read" value={data.totals.cacheReadTokens} />
      </div>

      <Section label="Per Day" count={data.perDay.length} icon="grid">
        <TimeSeriesBars data={data.perDay} />
      </Section>

      <Section label="Per Project" count={data.perProject.length} icon="folder">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {data.perProject.map((p) => {
            const total = totalOfRow(p);
            return (
              <div
                key={p.projectId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px 1fr auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <ProjectIcon project={{ icon: p.icon, iconColor: p.iconColor }} size={22} />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--text)",
                      marginBottom: 6,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.name}
                  </div>
                  <HorizontalBar value={total} max={projectMax} color={p.iconColor} />
                </div>
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--text-dim)",
                    minWidth: 80,
                    textAlign: "right",
                  }}
                  title={`${total.toLocaleString()} tokens`}
                >
                  {formatN(total)}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section label="Per Session" count={data.perSession.length} icon="terminal">
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <thead>
              <tr
                style={{
                  background: "var(--surface-2, rgba(255,255,255,0.03))",
                  color: "var(--text-faint)",
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                <Th align="left">Session</Th>
                <Th align="left">Project</Th>
                <Th>Input</Th>
                <Th>Output</Th>
                <Th>Cache W</Th>
                <Th>Cache R</Th>
                <Th>Total</Th>
              </tr>
            </thead>
            <tbody>
              {data.perSession.map((s) => {
                const total = totalOfRow(s);
                return (
                  <tr key={s.taskId} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td>
                      <span
                        style={{
                          color: "var(--text)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          display: "inline-block",
                          maxWidth: 320,
                        }}
                        title={s.title}
                      >
                        {s.title || "(untitled)"}
                      </span>
                    </Td>
                    <Td>
                      <span style={{ color: "var(--text-dim)" }}>{s.projectName}</span>
                    </Td>
                    <Td mono>{formatN(s.inputTokens)}</Td>
                    <Td mono>{formatN(s.outputTokens)}</Td>
                    <Td mono>{formatN(s.cacheCreationTokens)}</Td>
                    <Td mono>{formatN(s.cacheReadTokens)}</Td>
                    <Td mono strong>
                      {formatN(total)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function PageHeader({ lastSyncedAt }: { lastSyncedAt: number | null }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>
        Token Usage
      </h1>
      <div
        style={{
          marginTop: 4,
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--text-faint)",
        }}
      >
        {lastSyncedAt
          ? `Last synced ${formatRelative(lastSyncedAt)}`
          : "Reads usage from ~/.claude/projects when you open this page."}
      </div>
    </div>
  );
}

function TotalCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "14px 16px",
        background: "var(--surface-1, transparent)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--text-faint)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 22,
          fontWeight: 600,
          color: "var(--text)",
          fontVariantNumeric: "tabular-nums",
        }}
        title={value.toLocaleString()}
      >
        {formatN(value)}
      </div>
    </div>
  );
}

function Th({
  children,
  align = "right",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "8px 12px",
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  mono,
  strong,
}: {
  children: React.ReactNode;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <td
      style={{
        padding: "8px 12px",
        textAlign: mono ? "right" : "left",
        fontFamily: mono ? "var(--mono)" : undefined,
        fontVariantNumeric: mono ? "tabular-nums" : undefined,
        color: strong ? "var(--text)" : undefined,
        fontWeight: strong ? 600 : undefined,
      }}
    >
      {children}
    </td>
  );
}

function totalOfRow(t: {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}): number {
  return (
    t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens
  );
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleString();
}
