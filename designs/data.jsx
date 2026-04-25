// data.jsx — seed data for prototype

const SEED_GROUPS = [
  { id: "g-agentsys", name: "AgentSystem", color: "#7ce58a" },
  { id: "g-personal", name: "Personal", color: "#a78bfa" },
  { id: "g-work", name: "Client Work", color: "#fbbf24" },
];

const SEED_PROJECTS = [
  {
    id: "p-1",
    name: "agent-core",
    icon: "AC",
    iconColor: "#7ce58a",
    path: "~/dev/agentsystem/agent-core",
    groupId: "g-agentsys",
    pinned: true,
    branch: "feat/tool-routing",
    tasks: [
      { id: "t-1-1", title: "Refactor tool dispatcher into a registry", agent: "claude-code", status: "running", branch: "feat/tool-routing", updated: "just now", lines: 124, preview: "Scanning src/tools/*.ts for handler signatures…" },
      { id: "t-1-2", title: "Add streaming support to SSE transport", agent: "codex", status: "running", branch: "feat/sse-stream", updated: "2m ago", lines: 81, preview: "Running pnpm test:integration …" },
      { id: "t-1-3", title: "Fix race condition in session cleanup", agent: "claude-code", status: "needs-input", branch: "bug/session-race", updated: "7m ago", lines: 34, preview: "Question: should we drop sessions older than 24h, or keep a configurable TTL?" },
      { id: "t-1-4", title: "Migrate logger to structured JSON", agent: "claude-code", status: "done", branch: "chore/json-logger", updated: "18m ago", lines: 210, preview: "All tests passing. Ready for review." },
      { id: "t-1-5", title: "Bump typescript 5.4 → 5.6", agent: "codex", status: "done", branch: "chore/ts-5.6", updated: "1h ago", lines: 12, preview: "No breaking changes detected." },
    ],
  },
  {
    id: "p-2",
    name: "agent-web",
    icon: "AW",
    iconColor: "#7ce58a",
    path: "~/dev/agentsystem/agent-web",
    groupId: "g-agentsys",
    pinned: true,
    branch: "main",
    tasks: [
      { id: "t-2-1", title: "Wire up new /projects endpoint on dashboard", agent: "claude-code", status: "running", branch: "feat/projects-api", updated: "just now", lines: 58, preview: "Editing src/pages/dashboard.tsx …" },
      { id: "t-2-2", title: "Dark mode polish for settings page", agent: "cursor-cli", status: "needs-input", branch: "ui/dark-settings", updated: "4m ago", lines: 22, preview: "Which border color should we use — #262626 or the new token?" },
      { id: "t-2-3", title: "Extract header into shared layout", agent: "claude-code", status: "done", branch: "refactor/layout", updated: "31m ago", lines: 156, preview: "Diff clean. No visual regressions." },
    ],
  },
  {
    id: "p-3",
    name: "agent-cli",
    icon: "AX",
    iconColor: "#7ce58a",
    path: "~/dev/agentsystem/agent-cli",
    groupId: "g-agentsys",
    pinned: false,
    branch: "main",
    tasks: [
      { id: "t-3-1", title: "Add `mc login` command", agent: "claude-code", status: "running", branch: "feat/auth-cli", updated: "1m ago", lines: 92, preview: "Generating OAuth device flow scaffold…" },
    ],
  },
  {
    id: "p-4",
    name: "agent-proto",
    icon: "AP",
    iconColor: "#7ce58a",
    path: "~/dev/agentsystem/agent-proto",
    groupId: "g-agentsys",
    pinned: false,
    branch: "main",
    tasks: [],
  },
  {
    id: "p-5",
    name: "agent-infra",
    icon: "AI",
    iconColor: "#7ce58a",
    path: "~/dev/agentsystem/agent-infra",
    groupId: "g-agentsys",
    pinned: false,
    branch: "main",
    tasks: [
      { id: "t-5-1", title: "Terraform: add staging RDS instance", agent: "codex", status: "done", branch: "infra/rds-staging", updated: "45m ago", lines: 78, preview: "Plan applied. Outputs in vars.tf." },
      { id: "t-5-2", title: "Grafana dashboards for new metrics", agent: "claude-code", status: "done", branch: "infra/grafana", updated: "2h ago", lines: 44, preview: "Dashboards committed to ops/." },
    ],
  },
  {
    id: "p-6",
    name: "notes-app",
    icon: "NO",
    iconColor: "#a78bfa",
    path: "~/dev/personal/notes-app",
    groupId: "g-personal",
    pinned: true,
    branch: "main",
    tasks: [
      { id: "t-6-1", title: "iCloud sync reliability", agent: "claude-code", status: "needs-input", branch: "fix/sync", updated: "11m ago", lines: 67, preview: "Two conflict strategies possible — pick one?" },
    ],
  },
  {
    id: "p-7",
    name: "dotfiles",
    icon: "DF",
    iconColor: "#a78bfa",
    path: "~/dev/personal/dotfiles",
    groupId: "g-personal",
    pinned: false,
    branch: "main",
    tasks: [],
  },
  {
    id: "p-8",
    name: "acme-commerce",
    icon: "AC",
    iconColor: "#fbbf24",
    path: "~/dev/clients/acme/commerce",
    groupId: "g-work",
    pinned: false,
    branch: "release/2026.04",
    tasks: [
      { id: "t-8-1", title: "Checkout: Apple Pay fallback flow", agent: "claude-code", status: "running", branch: "feat/apple-pay", updated: "just now", lines: 203, preview: "Implementing PaymentRequest fallback…" },
      { id: "t-8-2", title: "Write migration for product_variants", agent: "codex", status: "done", branch: "db/variants", updated: "22m ago", lines: 39, preview: "Migration tested against staging dump." },
    ],
  },
  {
    id: "p-9",
    name: "acme-admin",
    icon: "AA",
    iconColor: "#fbbf24",
    path: "~/dev/clients/acme/admin",
    groupId: "g-work",
    pinned: false,
    branch: "main",
    tasks: [],
  },
];

const AGENT_META = {
  "claude-code": { label: "Claude Code", color: "#d6a56b", glyph: "◆" },
  "codex":       { label: "Codex",       color: "#8ab4ff", glyph: "◇" },
  "cursor-cli":  { label: "Cursor CLI",  color: "#c792ea", glyph: "▲" },
};

const STATUS_META = {
  "running":     { label: "Running",     color: "var(--status-running)", dot: true, shimmer: true },
  "needs-input": { label: "Needs input", color: "var(--status-needs)",   dot: true, shimmer: false },
  "done":        { label: "Done",        color: "var(--status-done)",    dot: false, shimmer: false },
  "idle":        { label: "Idle",        color: "var(--status-idle)",    dot: false, shimmer: false },
};

Object.assign(window, { SEED_GROUPS, SEED_PROJECTS, AGENT_META, STATUS_META });
