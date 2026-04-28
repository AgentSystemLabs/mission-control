import { jsxs, Fragment, jsx } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { u as useCopy, S as SettingsSection, F as Field, C as CodeBlock } from "./SettingsParts-BVRE1z9n.js";
import { g as getElectron } from "./router-XpjizlSW.js";
import "@tanstack/react-router";
import "@tanstack/react-router-with-query";
import "@tanstack/react-query";
function StorageSettingsPage() {
  const [userData, setUserData] = useState(null);
  const [ready, setReady] = useState(false);
  const {
    copied,
    copy
  } = useCopy();
  useEffect(() => {
    const electron = getElectron();
    if (!electron) {
      setReady(true);
      return;
    }
    void electron.getUserDataDir().then((dir) => {
      setUserData(dir);
      setReady(true);
    });
  }, []);
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("h1", { style: {
      margin: "0 0 24px",
      fontSize: 24,
      fontWeight: 600,
      letterSpacing: "-0.015em"
    }, children: "Storage" }),
    !ready ? /* @__PURE__ */ jsx("div", { style: {
      fontFamily: "var(--mono)",
      fontSize: 12,
      color: "var(--text-dim)"
    }, children: "loading…" }) : userData ? /* @__PURE__ */ jsx(SettingsSection, { title: "Storage", children: /* @__PURE__ */ jsx(Field, { label: "Data directory", children: /* @__PURE__ */ jsx(CodeBlock, { value: userData, onCopy: () => copy(userData, "data"), copied: copied === "data" }) }) }) : /* @__PURE__ */ jsx("div", { style: {
      fontFamily: "var(--mono)",
      fontSize: 12,
      color: "var(--text-dim)"
    }, children: "Storage details are only available in the desktop app." })
  ] });
}
export {
  StorageSettingsPage as component
};
