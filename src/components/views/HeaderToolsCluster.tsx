import { useState } from "react";
import { Btn } from "~/components/ui/Btn";
import { PromptSearchButton } from "~/components/views/PromptSearchButton";
import { ScratchPadButton } from "~/components/views/ScratchPadButton";
import { VoicePushToTalkButton } from "~/components/views/VoicePushToTalkButton";

const STORAGE_KEY = "mc.headerToolsExpanded";

/**
 * Collapsible tray for the low-frequency header tools (scratch pads, prompt
 * search, voice push-to-talk). Collapsed to a single "…" button by default so
 * the top bar stays quiet; expanding is an explicit, persisted choice — an
 * inline toggle rather than a transient popover, because the tools own their
 * own portaled dropdowns (a popover wrapper would close under them). Every
 * tool keeps its global hotkey while hidden.
 */
export function HeaderToolsCluster() {
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggle = () =>
    setExpanded((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore quota / privacy-mode errors
      }
      return next;
    });

  return (
    <>
      {expanded && (
        <>
          <ScratchPadButton />
          <PromptSearchButton />
          <VoicePushToTalkButton />
        </>
      )}
      <Btn
        variant="ghost"
        icon="more"
        onClick={toggle}
        aria-expanded={expanded}
        aria-label={expanded ? "Hide tools" : "Show tools"}
        title={expanded ? "Hide tools" : "Tools — scratch pads, prompt search, voice"}
        style={
          expanded
            ? { background: "var(--surface-2)", color: "var(--text)" }
            : undefined
        }
      />
    </>
  );
}
