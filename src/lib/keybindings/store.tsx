import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "~/lib/api";
import { DEFAULT_BINDINGS } from "./defaults";
function mergeWithDefaults(b: BindingMap | undefined): BindingMap {
  return { ...DEFAULT_BINDINGS, ...(b ?? {}) };
}
import { formatBinding } from "./format";
import type { Binding, BindingMap, HotkeyAction } from "./types";

type Ctx = {
  bindings: BindingMap;
  setBinding: (action: HotkeyAction, b: Binding) => Promise<void>;
  resetBinding: (action: HotkeyAction) => Promise<void>;
  resetAll: () => Promise<void>;
  refresh: () => Promise<void>;
};

const KeybindingsContext = createContext<Ctx | null>(null);

export function KeybindingsProvider({ children }: { children: ReactNode }) {
  const [bindings, setBindings] = useState<BindingMap>(DEFAULT_BINDINGS);

  const refresh = useCallback(async () => {
    try {
      const r = await api.getKeybindings();
      setBindings(mergeWithDefaults(r.bindings));
    } catch {
      // Keep current bindings on transient failure.
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<Ctx>(
    () => ({
      bindings,
      refresh,
      async setBinding(action, b) {
        const r = await api.setKeybinding(action, b);
        setBindings(mergeWithDefaults(r.bindings));
      },
      async resetBinding(action) {
        const r = await api.resetKeybinding(action);
        setBindings(mergeWithDefaults(r.bindings));
      },
      async resetAll() {
        const r = await api.resetAllKeybindings();
        setBindings(mergeWithDefaults(r.bindings));
      },
    }),
    [bindings, refresh],
  );

  return <KeybindingsContext.Provider value={value}>{children}</KeybindingsContext.Provider>;
}

export function useKeybindings(): Ctx {
  const ctx = useContext(KeybindingsContext);
  if (!ctx) throw new Error("useKeybindings must be used within KeybindingsProvider");
  return ctx;
}

export function useBinding(action: HotkeyAction): Binding {
  return useKeybindings().bindings[action] ?? DEFAULT_BINDINGS[action];
}

export function useFormattedBinding(action: HotkeyAction): string {
  return formatBinding(useBinding(action));
}
