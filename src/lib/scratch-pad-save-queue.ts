// Per-project scratch-pad save serialization, held at MODULE scope so it
// survives modal remounts. The editor remounts per target (see
// scratch-pad-store), and an unmounting instance's final flush must finish —
// and land in the query cache — before the next instance resolves which pad
// it is editing; a per-instance chain can't guarantee that, which is how
// close→reopen races duplicated pads or resurrected stale content.

type SaveJob = () => Promise<void>;

const chains = new Map<string, Promise<void>>();

/** Append a save job to the project's chain. Jobs must handle their own errors. */
export function enqueueScratchPadSave(projectId: string, job: SaveJob): Promise<void> {
  const prev = chains.get(projectId) ?? Promise.resolve();
  // Jobs are written to never reject; `catch` here is a belt-and-braces so one
  // faulty job can never wedge the project's whole chain.
  const next = prev.then(job).catch(() => {});
  chains.set(projectId, next);
  return next;
}

/** Resolves once every save enqueued so far for the project has settled. */
export function scratchPadSavesSettled(projectId: string): Promise<void> {
  return chains.get(projectId) ?? Promise.resolve();
}
