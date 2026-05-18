import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { useHostedSession } from "~/components/views/AuthGate";

export const Route = createFileRoute("/plans")({
  component: HostedPlansPage,
});

const PLANS = [
  {
    name: "Hosted access",
    summary: "Browser Mission Control with Academy-managed login and billing.",
    features: [
      "Hosted projects and task history",
      "Account and entitlement state from Academy",
      "Support diagnostics without direct database access",
    ],
  },
  {
    name: "Remote runtime",
    summary: "Cloud-backed terminals and agent sessions for active plans.",
    features: [
      "Remote user terminals",
      "Claude Code, Codex, and Cursor agent sessions where enabled",
      "Plan-specific project, task, terminal, and compute limits",
    ],
  },
];

function HostedPlansPage() {
  const router = useRouter();
  const { session } = useHostedSession();
  const accountUrl = session?.academyAccountUrl || "/api/academy-auth/login";

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24 }} className="dot-grid-bg">
      <CardFrame style={{ maxWidth: 920, margin: "0 auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, letterSpacing: "-0.02em" }}>
              Hosted plans
            </h1>
            <p style={{ color: "var(--text-dim)", fontFamily: "var(--mono)", fontSize: 13, lineHeight: 1.6 }}>
              Academy is the source of truth for Mission Control hosted access,
              billing, invoices, and plan changes. Use this page to understand
              what Mission Control expects before opening Academy billing.
            </p>
          </div>
          <Btn variant="ghost" onClick={() => router.navigate({ to: "/" })}>
            Back
          </Btn>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                background: "var(--surface-1)",
                padding: 18,
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{plan.name}</div>
              <div style={{ color: "var(--text-dim)", fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
                {plan.summary}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-dim)", fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.7 }}>
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 22, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn
            variant="primary"
            icon="external-link"
            onClick={() => window.open(accountUrl, "_blank", "noopener,noreferrer")}
          >
            Open Academy billing
          </Btn>
          <Btn variant="ghost" onClick={() => router.navigate({ to: "/" })}>
            Return to projects
          </Btn>
        </div>
      </CardFrame>
    </div>
  );
}
