import { Btn } from "~/components/ui/Btn";
import { HotkeyTooltip } from "~/components/ui/Tooltip";
import { usePromptSearchPalette } from "~/lib/prompt-search-store";

/** TopBar entry point for the prompt-search palette. */
export function PromptSearchButton() {
  const { open } = usePromptSearchPalette();
  return (
    <HotkeyTooltip action="prompt.search" label="Search prompt history">
      <Btn
        variant="ghost"
        icon="message-search"
        onClick={open}
        aria-label="Search prompt history"
      />
    </HotkeyTooltip>
  );
}
