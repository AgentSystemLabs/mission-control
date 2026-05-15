/**
 * Vocabulary of icons the title generator may pick to represent a session.
 * Each id is the lucide-react icon name in kebab-case (the filename in
 * lucide-react/dist/esm/icons). The `hint` is read by the LLM to disambiguate
 * which icon best fits a prompt. Keep the list generous but each entry's hint
 * should be specific enough that two icons don't compete for the same prompt.
 */
export type SessionIconOption = {
  id: string;
  hint: string;
};

export const SESSION_ICON_OPTIONS: readonly SessionIconOption[] = [
  // Code & files
  { id: "file", hint: "generic file edit" },
  { id: "file-code", hint: "source code file" },
  { id: "file-pen", hint: "edit a single file in place" },
  { id: "file-search", hint: "hunt through a file or grep" },
  { id: "file-text", hint: "docs, markdown, plain text" },
  { id: "file-stack", hint: "many files at once" },
  { id: "folder", hint: "directory or module" },
  { id: "folder-open", hint: "browse a tree" },
  { id: "folder-tree", hint: "restructure a directory" },
  { id: "folder-code", hint: "code module / package folder" },
  { id: "code", hint: "general coding work" },
  { id: "code-2", hint: "implementation work, write code" },
  { id: "code-xml", hint: "markup, HTML, JSX, XML" },
  { id: "terminal", hint: "shell session, CLI commands" },
  { id: "square-terminal", hint: "terminal task, scripts" },

  // Git / version control
  { id: "git-branch", hint: "branch, switch, create branch" },
  { id: "git-commit-horizontal", hint: "commit work, history rewrite" },
  { id: "git-merge", hint: "merge branches" },
  { id: "git-pull-request", hint: "open or review a PR" },
  { id: "git-pull-request-arrow", hint: "draft PR, integration request" },
  { id: "git-fork", hint: "fork, divergent branches" },

  // Search / research / inspect
  { id: "search", hint: "search the codebase or web" },
  { id: "search-code", hint: "find code, ripgrep, look up symbol" },
  { id: "search-check", hint: "audit, verify, code review" },
  { id: "scan-text", hint: "read through logs or text" },
  { id: "telescope", hint: "explore, investigate broadly" },
  { id: "microscope", hint: "deep dive, root cause" },

  // UI / design
  { id: "layout-dashboard", hint: "dashboard, admin UI" },
  { id: "layout-grid", hint: "grid layout, card list" },
  { id: "palette", hint: "theming, colors" },
  { id: "paintbrush", hint: "visual polish, restyle" },
  { id: "pen-tool", hint: "design work, vector edit" },
  { id: "type", hint: "typography, copy edit" },
  { id: "image", hint: "images, assets, media" },
  { id: "frame", hint: "page frame, modal, layout" },
  { id: "mouse-pointer", hint: "click handler, interaction" },

  // Lists / tasks
  { id: "list", hint: "list rendering" },
  { id: "list-checks", hint: "checklist, todo, QA" },
  { id: "list-todo", hint: "todo, planning" },
  { id: "square-check", hint: "completion, validation" },

  // Build / deploy / ship
  { id: "hammer", hint: "build process, compile" },
  { id: "wrench", hint: "fix or repair something" },
  { id: "package", hint: "package, dependency, bundle" },
  { id: "container", hint: "docker, container work" },
  { id: "ship", hint: "release, ship to prod" },
  { id: "rocket", hint: "launch, deploy, big feature" },
  { id: "send", hint: "send, push, dispatch" },
  { id: "workflow", hint: "pipeline, automation flow" },

  // Tests / debug
  { id: "test-tube", hint: "unit tests" },
  { id: "flask-conical", hint: "experimental, prototype" },
  { id: "bug", hint: "bug fix, defect" },
  { id: "bug-play", hint: "reproduce a bug, debugger" },

  // Cloud / data / storage
  { id: "cloud", hint: "cloud service, SaaS" },
  { id: "cloud-upload", hint: "upload to cloud, deploy artifact" },
  { id: "server", hint: "server, backend, infra" },
  { id: "database", hint: "database, SQL, schema" },
  { id: "table", hint: "table data, spreadsheet" },
  { id: "columns-3", hint: "columns, layout structure" },
  { id: "box", hint: "object, model, entity" },
  { id: "boxes", hint: "collection, inventory" },

  // Network / integration
  { id: "globe", hint: "web, internet, public surface" },
  { id: "network", hint: "networking, topology" },
  { id: "satellite", hint: "external API, telemetry" },
  { id: "plug-zap", hint: "connect, integration, plugin" },
  { id: "webhook", hint: "webhook handler" },
  { id: "link", hint: "URL, hyperlink" },
  { id: "share-2", hint: "share, broadcast" },

  // Security / auth
  { id: "shield", hint: "security generic" },
  { id: "shield-check", hint: "auth check, permission" },
  { id: "shield-alert", hint: "security vulnerability" },
  { id: "lock", hint: "locked resource, encryption" },
  { id: "lock-keyhole", hint: "auth gate, login" },
  { id: "key", hint: "API key, secret, token" },

  // Performance / metrics / AI
  { id: "gauge", hint: "performance, speed test" },
  { id: "activity", hint: "live activity, monitoring" },
  { id: "bar-chart-3", hint: "metrics, analytics chart" },
  { id: "line-chart", hint: "trend, timeseries" },
  { id: "pie-chart", hint: "breakdown, distribution" },
  { id: "trending-up", hint: "growth, improvement metric" },
  { id: "sparkles", hint: "polish, magic improvement, AI feature" },
  { id: "wand-sparkles", hint: "AI generation, magic action" },
  { id: "zap", hint: "fast, lightning, optimization" },
  { id: "brain", hint: "AI model, reasoning, ML" },
  { id: "bot", hint: "agent, chatbot, automation" },
  { id: "cpu", hint: "low-level perf, hardware" },

  // Errors / cleanup
  { id: "triangle-alert", hint: "warning, caution" },
  { id: "alert-circle", hint: "error, failure" },
  { id: "octagon-alert", hint: "stop, dangerous condition" },
  { id: "trash", hint: "delete, remove" },
  { id: "trash-2", hint: "cleanup, purge" },
  { id: "eraser", hint: "undo, clear, reset" },
  { id: "ban", hint: "disable, deprecate" },

  // Time / scheduling
  { id: "clock", hint: "time-related, duration" },
  { id: "calendar", hint: "scheduling, dates" },
  { id: "calendar-clock", hint: "deadline, scheduled job" },
  { id: "hourglass", hint: "long-running, waiting" },
  { id: "timer", hint: "timeout, stopwatch" },

  // Communication / notifications
  { id: "message-square", hint: "chat, conversation" },
  { id: "mail", hint: "email, notifications" },
  { id: "bell", hint: "alerts, notifications system" },
  { id: "megaphone", hint: "announcement, broadcast" },
  { id: "info", hint: "informational copy, help" },

  // Migration / refactor / sync
  { id: "arrow-right-left", hint: "swap, replace, migrate" },
  { id: "replace", hint: "find-and-replace, rename" },
  { id: "shuffle", hint: "rearrange, reorder" },
  { id: "refresh-cw", hint: "sync, reload, rerun" },
  { id: "history", hint: "history, audit log, revert" },
  { id: "save", hint: "save, persist, write to disk" },
  { id: "archive", hint: "archive, snapshot" },

  // Docs / notes
  { id: "book", hint: "documentation, reference" },
  { id: "book-open", hint: "read docs, open guide" },
  { id: "notebook-pen", hint: "notes, scratch pad" },
  { id: "sticky-note", hint: "TODO note, comment" },
  { id: "pencil", hint: "small edit, rewrite" },
  { id: "square-pen", hint: "compose, draft" },

  // Settings / config
  { id: "settings", hint: "configuration, preferences" },
  { id: "settings-2", hint: "advanced settings" },
  { id: "sliders", hint: "tuning, parameters" },
  { id: "command", hint: "keyboard shortcut, command palette" },

  // Generic actions
  { id: "play", hint: "run, start, execute" },
  { id: "plus", hint: "add, create" },
  { id: "check", hint: "approve, done" },
  { id: "upload", hint: "push, send up" },
  { id: "download", hint: "pull, fetch" },
  { id: "copy", hint: "duplicate, clone" },
  { id: "clipboard-check", hint: "verified copy, validation step" },
  { id: "eye", hint: "view, preview, inspect" },
];

export const SESSION_ICONS: readonly string[] = SESSION_ICON_OPTIONS.map((o) => o.id);

export const DEFAULT_SESSION_ICON = "terminal";

const SESSION_ICON_SET = new Set(SESSION_ICONS);

export function isSessionIcon(value: unknown): value is string {
  return typeof value === "string" && SESSION_ICON_SET.has(value);
}
