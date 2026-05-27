import {
  createRouter as createTanStackRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { installShellQueryCache } from "~/lib/shell-query-cache";
import { routeTree } from "./routeTree.gen";

function AppErrorFallback({ reset }: ErrorComponentProps) {
  const reload = () => {
    reset?.();
    if (typeof window !== "undefined") window.location.reload();
  };
  const goHome = () => {
    reset?.();
    if (typeof window !== "undefined") window.location.assign("/");
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
          width: "min(460px, 100%)",
          border: "1px solid var(--border, rgba(255,255,255,0.14))",
          borderRadius: 14,
          padding: 20,
          background: "var(--surface-1, #15181d)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.42)",
        }}
      >
        <h1 style={{ margin: "0 0 8px", fontSize: 18 }}>Something went wrong</h1>
        <p style={{ margin: "0 0 18px", color: "var(--text-dim, #a1a1aa)", lineHeight: 1.5 }}>
          Mission Control hit a rendering issue. Reload the app and your projects and sessions should recover.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
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
