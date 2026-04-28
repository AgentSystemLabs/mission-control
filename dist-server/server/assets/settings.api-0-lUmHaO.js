import { jsxs, Fragment, jsx } from "react/jsx-runtime";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { r as useSettings, B as Btn, g as getElectron, c as api, q as queryKeys } from "./router-XpjizlSW.js";
import { u as useCopy, S as SettingsSection, F as Field, C as CodeBlock } from "./SettingsParts-BVRE1z9n.js";
import "@tanstack/react-router";
import "@tanstack/react-router-with-query";
function ApiSettingsPage() {
  const queryClient = useQueryClient();
  const {
    data: settings
  } = useSettings();
  const token = settings?.apiToken ?? null;
  const [port, setPort] = useState(null);
  const {
    copied,
    copy
  } = useCopy();
  useEffect(() => {
    const electron = getElectron();
    if (electron) {
      void electron.getRuntimePort().then(setPort);
    } else {
      setPort(Number(window.location.port) || null);
    }
  }, []);
  const regenerate = async () => {
    const r = await api.regenerateToken();
    queryClient.setQueryData(queryKeys.settings, {
      apiToken: r.apiToken
    });
  };
  const baseUrl = `http://127.0.0.1:${port ?? "PORT"}`;
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("h1", { style: {
      margin: "0 0 24px",
      fontSize: 24,
      fontWeight: 600,
      letterSpacing: "-0.015em"
    }, children: "External API" }),
    /* @__PURE__ */ jsxs(SettingsSection, { title: "External API", subtitle: "External CLIs (Claude Code / Codex / Cursor CLI) post status updates here.", children: [
      /* @__PURE__ */ jsx(Field, { label: "Endpoint", children: /* @__PURE__ */ jsx(CodeBlock, { value: baseUrl, onCopy: () => copy(baseUrl, "endpoint"), copied: copied === "endpoint" }) }),
      /* @__PURE__ */ jsxs(Field, { label: "API Token", children: [
        /* @__PURE__ */ jsx(CodeBlock, { value: token ?? "loading…", onCopy: () => token && copy(token, "token"), copied: copied === "token", monoSize: 11 }),
        /* @__PURE__ */ jsx("div", { style: {
          marginTop: 8,
          display: "flex",
          gap: 8
        }, children: /* @__PURE__ */ jsx(Btn, { variant: "ghost", icon: "refresh", onClick: regenerate, size: "sm", children: "Regenerate token" }) })
      ] }),
      /* @__PURE__ */ jsx(Field, { label: "Example: mark a task finished", children: /* @__PURE__ */ jsx(CodeBlock, { value: `curl -H "Authorization: Bearer $TOKEN" \\
  -X POST ${baseUrl}/api/tasks/$TASK_ID/status \\
  -d '{"status":"finished","preview":"All tests passing"}'`, onCopy: () => token && copy(`curl -H "Authorization: Bearer ${token}" -X POST ${baseUrl}/api/tasks/$TASK_ID/status -d '{"status":"finished","preview":"All tests passing"}'`, "curl"), copied: copied === "curl", monoSize: 11 }) })
    ] })
  ] });
}
export {
  ApiSettingsPage as component
};
