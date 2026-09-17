import type { MouseEvent as ReactMouseEvent } from "react";
import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { usePromptSearchPalette } from "~/lib/prompt-search-store";

/** TopBar entry point for the prompt-search palette. */
export function PromptSearchButton({
  onContextMenu,
}: {
  /** Right-click → Hide, supplied by the header's hideable-elements menu. */
  onContextMenu?: (e: ReactMouseEvent) => void;
}) {
  const { open } = usePromptSearchPalette();
  return (
    <HotkeyTooltip action="prompt.search" label="Search prompt history">
      <Btn
        variant="ghost"
        icon="message-search"
        onClick={open}
        onContextMenu={onContextMenu}
        aria-label="Search prompt history"
      />
    </HotkeyTooltip>
  );
}
