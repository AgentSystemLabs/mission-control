import { jsxs, jsx } from "react/jsx-runtime";
import { useState } from "react";
import { I as Icon } from "./router-XpjizlSW.js";
function SettingsSection({
  title,
  subtitle,
  children
}) {
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        marginBottom: 24,
        padding: 20,
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 12
      },
      children: [
        /* @__PURE__ */ jsxs("div", { style: { marginBottom: 16 }, children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                fontFamily: "var(--mono)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--text)",
                marginBottom: 4
              },
              children: title
            }
          ),
          subtitle && /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                color: "var(--text-dim)",
                lineHeight: 1.5
              },
              children: subtitle
            }
          )
        ] }),
        /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", gap: 14 }, children })
      ]
    }
  );
}
function Field({ label, children }) {
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          fontWeight: 500,
          color: "var(--text-dim)",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          marginBottom: 6
        },
        children: label
      }
    ),
    children
  ] });
}
function CodeBlock({
  value,
  onCopy,
  copied,
  monoSize = 12
}) {
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        padding: "10px 12px",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12
      },
      children: [
        /* @__PURE__ */ jsx(
          "pre",
          {
            style: {
              margin: 0,
              fontFamily: "var(--mono)",
              fontSize: monoSize,
              color: "var(--text)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              flex: 1
            },
            children: value
          }
        ),
        onCopy && /* @__PURE__ */ jsxs(
          "button",
          {
            onClick: onCopy,
            style: {
              background: copied ? "var(--accent-dim)" : "transparent",
              border: "1px solid var(--border)",
              color: copied ? "var(--accent)" : "var(--text-dim)",
              padding: "4px 8px",
              borderRadius: 5,
              cursor: "pointer",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0
            },
            children: [
              /* @__PURE__ */ jsx(Icon, { name: copied ? "check" : "copy", size: 11 }),
              copied ? "copied" : "copy"
            ]
          }
        )
      ]
    }
  );
}
function useCopy() {
  const [copied, setCopied] = useState(null);
  const copy = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  };
  return { copied, copy };
}
export {
  CodeBlock as C,
  Field as F,
  SettingsSection as S,
  useCopy as u
};
