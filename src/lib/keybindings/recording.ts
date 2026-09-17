// The Keybindings settings recorder listens for raw keydowns on `window`
// (capture phase) to turn the next chord into a new binding. Rebindable app
// hotkeys that opt into firing while the settings overlay is open
// (`allowWhenSettingsOpen`, e.g. `settings.open`) listen on that same target
// and phase, and were registered first — so they win the race and would run
// their action on the very chord being recorded (closing Settings mid-record).
// The recorder can't stop them, so `useHotkey` reads this flag synchronously
// and stands down instead. Same shape as the overlay flag in
// `settings-navigation.ts`.
let recording = false;

export function setKeybindingRecording(active: boolean) {
  recording = active;
}

export function isKeybindingRecording() {
  return recording;
}
