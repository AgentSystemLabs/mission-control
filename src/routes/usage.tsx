import { createFileRoute } from "@tanstack/react-router";
import { useUsage, usageQueryOptions } from "~/queries";
import { UsageView } from "~/components/views/UsageView";

export const Route = createFileRoute("/usage")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(usageQueryOptions(30)),
  component: UsagePage,
});

function UsagePage() {
  const { data, isLoading, error } = useUsage(30);
  if (error) {
    return (
      <div
        style={{
          padding: 40,
          fontFamily: "var(--mono)",
          fontSize: 12,
          color: "var(--text-dim)",
        }}
      >
        Failed to load token usage: {(error as Error).message}
      </div>
    );
  }
  if (!data) {
    return (
      <div
        style={{
          padding: 40,
          fontFamily: "var(--mono)",
          fontSize: 12,
          color: "var(--text-dim)",
        }}
      >
        {isLoading ? "loading…" : ""}
      </div>
    );
  }
  return <UsageView data={data} />;
}
