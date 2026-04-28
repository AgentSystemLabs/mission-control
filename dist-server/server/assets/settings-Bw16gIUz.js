import { jsxs, jsx } from "react/jsx-runtime";
import { Outlet, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { g as getElectron, I as Icon } from "./router-XpjizlSW.js";
import "@tanstack/react-router-with-query";
import "@tanstack/react-query";
function SettingsLayout() {
  const [isElectron, setIsElectron] = useState(false);
  useEffect(() => {
    setIsElectron(!!getElectron());
  }, []);
  const items = [{
    to: "/settings/api",
    label: "External API",
    icon: "terminal"
  }, {
    to: "/settings/keybindings",
    label: "Keybindings",
    icon: "settings"
  }, ...isElectron ? [{
    to: "/settings/storage",
    label: "Storage",
    icon: "folder"
  }] : []];
  return /* @__PURE__ */ jsxs("div", { style: {
    flex: 1,
    display: "flex",
    overflow: "hidden"
  }, className: "dot-grid-bg", children: [
    /* @__PURE__ */ jsxs("aside", { style: {
      width: 220,
      flexShrink: 0,
      borderRight: "1px solid var(--border)",
      padding: "28px 12px",
      background: "var(--surface-0)",
      overflow: "auto"
    }, children: [
      /* @__PURE__ */ jsx("div", { style: {
        fontFamily: "var(--mono)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--text-dim)",
        padding: "0 10px 12px"
      }, children: "Settings" }),
      /* @__PURE__ */ jsx("nav", { style: {
        display: "flex",
        flexDirection: "column",
        gap: 2
      }, children: items.map((item) => /* @__PURE__ */ jsx(SettingsNavLink, { ...item }, item.to)) })
    ] }),
    /* @__PURE__ */ jsx("div", { style: {
      flex: 1,
      overflow: "auto",
      padding: "28px 32px 80px"
    }, children: /* @__PURE__ */ jsx("div", { style: {
      maxWidth: 720,
      margin: "0 auto"
    }, children: /* @__PURE__ */ jsx(Outlet, {}) }) })
  ] });
}
function SettingsNavLink({
  to,
  label,
  icon
}) {
  return /* @__PURE__ */ jsxs(Link, { to, style: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 7,
    fontFamily: "var(--mono)",
    fontSize: 12,
    textDecoration: "none",
    color: "var(--text-dim)",
    border: "1px solid transparent"
  }, activeProps: {
    style: {
      color: "var(--text)",
      background: "var(--surface-1)",
      border: "1px solid var(--border)"
    }
  }, children: [
    /* @__PURE__ */ jsx(Icon, { name: icon, size: 13 }),
    label
  ] });
}
export {
  SettingsLayout as component
};
