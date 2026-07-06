import {
  createRouter as createTanStackRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties } from "react";
import { getElectron } from "~/lib/electron";
import { CURRENT_MC_VERSION } from "~/queries/mission-control-version";
import { installShellQueryCache } from "~/lib/shell-query-cache";
import { sandboxesQueryOptions } from "~/queries";
import { routeTree } from "./routeTree.gen";

/** Pull the useful bits out of whatever the error boundary caught. The value is
 *  typed `Error` but at runtime a route can throw anything (strings, plain
 *  objects), so normalize defensively. */
function describeError(error: unknown): { name: string; message: string; stack: string } {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || String(error),
      stack: error.stack || "",
    };
  }
  if (typeof error === "string") return { name: "Error", message: error, stack: "" };
  try {
    return { name: "Error", message: JSON.stringify(error), stack: "" };
  } catch {
    return { name: "Error", message: String(error), stack: "" };
  }
}

/** A copy-pasteable report the user can send back for debugging. Includes the
 *  app version and environment so a screenshot or paste is self-contained. */
function buildErrorReport(error: unknown, componentStack: string | undefined): string {
  const { name, message, stack } = describeError(error);
  const lines = [
    "Mission Control error report",
    `Version: ${CURRENT_MC_VERSION}`,
  ];
  if (typeof window !== "undefined") lines.push(`URL: ${window.location.href}`);
  if (typeof navigator !== "undefined") lines.push(`User agent: ${navigator.userAgent}`);
  lines.push("", `Error: ${name}: ${message}`);
  if (stack) lines.push("", "Stack:", stack);
  if (componentStack) lines.push("", "Component stack:", componentStack.trim());
  return lines.join("\n");
}

function AppErrorFallback({ error, info, reset }: ErrorComponentProps) {
  const { name, message, stack } = describeError(error);
  const componentStack = info?.componentStack;
  const report = buildErrorReport(error, componentStack);
  const [copied, setCopied] = useState(false);

  // Surface the real error to the console/logs regardless of build mode — the
  // router swallows it otherwise, leaving nothing to grep after the fact.
  useEffect(() => {
    console.error("[mission-control] render error boundary caught:", error, componentStack);
  }, [error, componentStack]);

  const reload = () => {
    reset?.();
    if (typeof window !== "undefined") window.location.reload();
  };
  const goHome = () => {
    reset?.();
    if (typeof window !== "undefined") window.location.assign("/");
  };
  const copyReport = () => {
    const electron = getElectron();
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    };
    if (electron) {
      void electron.clipboard.writeText(report).then(done).catch(() => undefined);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(report).then(done).catch(() => undefined);
    }
  };

  return (
    <div
      role="alert"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--surface-0, #0d0f12)",
        color: "var(--text, #f4f4f5)",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          border: "1px solid var(--border, rgba(255,255,255,0.14))",
          borderRadius: 14,
          padding: 20,
          background: "var(--surface-1, #15181d)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.42)",
        }}
      >
        <h1 style={{ margin: "0 0 8px", fontSize: 18 }}>Something went wrong</h1>
        <p style={{ margin: "0 0 14px", color: "var(--text-dim, #a1a1aa)", lineHeight: 1.5 }}>
          Mission Control hit a rendering issue. Reload the app and your projects and sessions should recover.
        </p>
        <div
          style={{
            margin: "0 0 14px",
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--border, rgba(255,255,255,0.14))",
            background: "var(--surface-0, #0d0f12)",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--text, #f4f4f5)",
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
          }}
        >
          <strong style={{ color: "var(--danger, #f87171)" }}>{name}:</strong> {message}
        </div>
        {(componentStack || stack) && (
          <details style={{ margin: "0 0 14px" }}>
            <summary
              style={{
                cursor: "pointer",
                fontSize: 12,
                color: "var(--text-dim, #a1a1aa)",
                userSelect: "none",
              }}
            >
              Technical details
            </summary>
            <pre
              style={{
                margin: "8px 0 0",
                padding: "10px 12px",
                maxHeight: 200,
                overflow: "auto",
                borderRadius: 8,
                border: "1px solid var(--border, rgba(255,255,255,0.14))",
                background: "var(--surface-0, #0d0f12)",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
                fontSize: 11,
                lineHeight: 1.5,
                color: "var(--text-dim, #a1a1aa)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {report}
            </pre>
          </details>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={copyReport} style={fallbackButtonStyle}>
            {copied ? "Copied!" : "Copy report"}
          </button>
          <button type="button" onClick={goHome} style={fallbackButtonStyle}>
            Back to projects
          </button>
          <button
            type="button"
            onClick={reload}
            style={{
              ...fallbackButtonStyle,
              background: "var(--accent, #8b5cf6)",
              color: "#fff",
              borderColor: "var(--accent, #8b5cf6)",
            }}
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}

const fallbackButtonStyle: CSSProperties = {
  height: 32,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid var(--border, rgba(255,255,255,0.14))",
  background: "var(--surface-2, #20242b)",
  color: "var(--text, #f4f4f5)",
  cursor: "pointer",
  font: "inherit",
  fontSize: 13,
};

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
      },
    },
  });
  installShellQueryCache(queryClient);
  void queryClient.prefetchQuery(sandboxesQueryOptions());
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultErrorComponent: AppErrorFallback,
    context: { queryClient },
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return routerWithQueryClient(router, queryClient);
}
