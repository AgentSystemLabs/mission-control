import type { Binding, BindingMap } from "./types";

export function makeBinding(partial: Partial<Binding> & { key: string }): Binding {
  return { mod: false, shift: false, alt: false, ...partial };
}

export const DEFAULT_BINDINGS: BindingMap = {
  "agent.new": makeBinding({ mod: true, key: "n" }),
  "project.add": makeBinding({ mod: true, key: "o" }),
  "project.edit": makeBinding({ mod: true, key: "e" }),
  "project.picker": makeBinding({ mod: true, key: "u" }),
  "project.pinnedSlot": makeBinding({ mod: true, key: "1" }),
  "nav.toggle": makeBinding({ mod: true, key: "m" }),
  "search.focus": makeBinding({ mod: true, key: "/" }),
  "terminal.toggle": makeBinding({ mod: true, key: "`" }),
  "terminal.close": makeBinding({ mod: true, key: "l" }),
  "terminal.expandToggle": makeBinding({ mod: true, key: "k" }),
  "terminal.newTab": makeBinding({ mod: true, key: "t" }),
  "terminal.cycleNext": makeBinding({ mod: true, key: "]" }),
  "terminal.cyclePrev": makeBinding({ mod: true, key: "[" }),
  "session.closeWindow": makeBinding({ mod: true, key: "w" }),
  "session.clone": makeBinding({ mod: true, key: "d" }),
  "session.newRow": makeBinding({ mod: true, shift: true, key: "d" }),
  "session.cycleNext": makeBinding({ mod: true, shift: true, key: "]" }),
  "session.cyclePrev": makeBinding({ mod: true, shift: true, key: "[" }),
  "session.gridNavigate": makeBinding({ mod: true, shift: true, key: "g" }),
  // Shift+L on top of terminal.close's mod+L: "L for layout", and the chord is
  // free — mod+shift+R would collide with Chromium's hard reload in dev.
  "session.gridLayout": makeBinding({ mod: true, shift: true, key: "l" }),
  "session.gridView": makeBinding({ mod: true, shift: true, key: "a" }),
  "session.focusMode": makeBinding({ mod: true, shift: true, key: "f" }),
  "dialog.submit": makeBinding({ mod: true, key: "Enter" }),
  "file.finder": makeBinding({ mod: true, key: "p" }),
  "file.save": makeBinding({ mod: true, key: "s" }),
  "git.diff": makeBinding({ mod: true, key: "g" }),
  "project.runToggle": makeBinding({ mod: true, key: "." }),
  "voice.pushToTalk": makeBinding({ mod: true, shift: true, key: "v" }),
  "prompt.search": makeBinding({ mod: true, shift: true, key: "p" }),
  // "J for jot" — mod+J is one of the few free single-modifier chords left.
  "scratch.toggle": makeBinding({ mod: true, key: "j" }),
  "screenshot.capture": makeBinding({ mod: true, shift: true, key: "s" }),
  // Alt variants of the terminal (mod) and session (mod+shift) cycle chords —
  // same ]/[ mnemonic, third modifier tier for the group context.
  "group.next": makeBinding({ mod: true, alt: true, key: "]" }),
  "group.prev": makeBinding({ mod: true, alt: true, key: "[" }),
};

