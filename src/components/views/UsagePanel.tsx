import { useUsage } from "~/queries";
import { UsageView } from "~/components/views/UsageView";
import { Btn } from "~/components/ui/Btn";
import { Icon } from "~/components/ui/Icon";
import { Kbd } from "~/components/ui/Kbd";
import { useHotkey } from "~/lib/use-hotkey";

export function UsagePanel({ onBack }: { onBack: () => void }) {
  const { data, isLoading, error } = useUsage(30);

  useHotkey("escape", onBack, { preventDefault: false });

  return (
    <div
      data-navigation-swipe-blocker
      style={{
        position: "fixed",
        top: "var(--mc-workspace-top, 0px)",
        left: "var(--mc-workspace-left, 0px)",
        right: 0,
        bottom: 0,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--surface-0)",
        boxShadow: "0 0 0 1px var(--border-strong)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-1)",
        }}
      >
        <Btn
          variant="ghost"
          size="sm"
          icon="chevron-left"
          onClick={onBack}
          title="Back"
          aria-label="Back"
        >
          Back <Kbd variant="inline">Esc</Kbd>
        </Btn>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "var(--text-dim)",
            fontFamily: "var(--mono)",
            fontSize: 12,
            minWidth: 0,
          }}
        >
          <Icon name="chart" size={12} />
          <span>Token Usage</span>
        </div>
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {error ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--status-failed)",
              fontFamily: "var(--mono)",
              fontSize: 12,
              padding: 24,
              textAlign: "center",
            }}
          >
            Failed to load token usage: {(error as Error).message}
          </div>
        ) : !data ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "var(--text-dim)",
            }}
          >
            {isLoading ? "loading…" : ""}
          </div>
        ) : (
          <div style={{ flex: 1, overflow: "auto" }}>
            <UsageView data={data} />
          </div>
        )}
      </div>
    </div>
  );
}
