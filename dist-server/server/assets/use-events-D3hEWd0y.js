import { jsxs, jsx } from "react/jsx-runtime";
import { I as Icon } from "./router-YiALtSFa.js";
import { useEffect } from "react";
function EmptyState({
  title,
  subtitle,
  action,
  icon = "sparkles"
}) {
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "60px 20px",
        gap: 14,
        border: "1px dashed var(--border-strong)",
        borderRadius: 12,
        background: "var(--surface-0)"
      },
      children: [
        /* @__PURE__ */ jsx(
          "div",
          {
            style: {
              width: 44,
              height: 44,
              borderRadius: 10,
              background: "var(--surface-2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-dim)"
            },
            children: /* @__PURE__ */ jsx(Icon, { name: icon, size: 20 })
          }
        ),
        /* @__PURE__ */ jsxs("div", { style: { textAlign: "center" }, children: [
          /* @__PURE__ */ jsx("div", { style: { fontSize: 15, fontWeight: 600, marginBottom: 4 }, children: title }),
          /* @__PURE__ */ jsx("div", { style: { fontSize: 13, color: "var(--text-dim)", fontFamily: "var(--mono)" }, children: subtitle })
        ] }),
        action
      ]
    }
  );
}
function useServerEvents(onEvent) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let stopped = false;
    let es = null;
    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/events");
      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          onEvent(data);
        } catch {
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (!stopped) setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [onEvent]);
}
export {
  EmptyState as E,
  useServerEvents as u
};
