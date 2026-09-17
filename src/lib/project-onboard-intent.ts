// Hands a one-shot "just created, get me working" intent from the Add-project
// flow (add-project-store) to the project page (projects.$id) across a
// router.navigate. A module-level map — rather than a route search param —
// keeps the URL clean and avoids threading a search schema through the route.
// The intent is consumed exactly once, on the project page's first render for
// that id, then discarded so navigating back never re-triggers a launch.

export type ProjectOnboardIntent = {
  /** Launch the project's saved agent as soon as the working directory is ready. */
  autoStart: boolean;
  /** Open the project in the layout chosen at create time (true = grid). */
  gridView: boolean;
};

const pending = new Map<string, ProjectOnboardIntent>();

export function markProjectOnboardIntent(id: string, intent: ProjectOnboardIntent): void {
  pending.set(id, intent);
}

export function consumeProjectOnboardIntent(id: string): ProjectOnboardIntent | null {
  const intent = pending.get(id) ?? null;
  if (intent) pending.delete(id);
  return intent;
}
