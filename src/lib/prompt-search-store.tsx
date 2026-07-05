import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { PromptSearchPalette } from "~/components/views/PromptSearchPalette";
import { useHotkey } from "~/lib/use-hotkey";

type Ctx = {
  open: () => void;
  close: () => void;
  isOpen: boolean;
};

const PromptSearchContext = createContext<Ctx | null>(null);

/**
 * Owns the prompt-search palette's open state so the global hotkey, the toolbar
 * button, and the palette itself stay in sync. Mirrors AddProjectProvider.
 */
export function PromptSearchProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Capture phase so the shortcut still fires when a session terminal (xterm)
  // has focus and would otherwise swallow the keydown.
  useHotkey("prompt.search", () => setIsOpen((o) => !o), { capture: true });

  const value = useMemo<Ctx>(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <PromptSearchContext.Provider value={value}>
      {children}
      <PromptSearchPalette open={isOpen} onClose={close} />
    </PromptSearchContext.Provider>
  );
}

export function usePromptSearchPalette(): Ctx {
  const ctx = useContext(PromptSearchContext);
  if (!ctx) {
    throw new Error("usePromptSearchPalette must be used within PromptSearchProvider");
  }
  return ctx;
}
