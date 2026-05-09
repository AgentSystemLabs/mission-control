import type { Binding, BindingMap } from "./types";

export function makeBinding(partial: Partial<Binding> & { key: string }): Binding {
  return { mod: false, shift: false, alt: false, ...partial };
}

export const DEFAULT_BINDINGS: BindingMap = {
  "agent.new": makeBinding({ mod: true, key: "n" }),
  "project.add": makeBinding({ mod: true, key: "o" }),
  "project.edit": makeBinding({ mod: true, key: "e" }),
  "project.picker": makeBinding({ mod: true, key: "u" }),
  "nav.toggle": makeBinding({ mod: true, key: "m" }),
  "search.focus": makeBinding({ mod: true, key: "/" }),
  "terminal.toggle": makeBinding({ mod: true, key: "`" }),
  "terminal.close": makeBinding({ mod: true, key: "l" }),
  "terminal.expandToggle": makeBinding({ mod: true, key: "k" }),
  "dialog.submit": makeBinding({ mod: true, key: "Enter" }),
  "file.finder": makeBinding({ mod: true, key: "p" }),
  "file.save": makeBinding({ mod: true, key: "s" }),
  "git.diff": makeBinding({ mod: true, key: "g" }),
  "project.runToggle": makeBinding({ mod: true, key: "." }),
};
