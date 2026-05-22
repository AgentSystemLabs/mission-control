import { MAIN_WORKTREE_ID } from "~/shared/worktrees";

export type ShipPhase = "committing" | "pushing";

type ActiveShipOperation = {
  count: number;
  phase: ShipPhase;
};

const activeShipOperations = new Map<string, ActiveShipOperation>();
const shipOperationListeners = new Set<() => void>();

export function shipKey(projectId: string, worktreeId?: string | null) {
  return `${projectId}:${worktreeId || MAIN_WORKTREE_ID}`;
}

function getShipOperation(projectId: string, worktreeId?: string | null) {
  return activeShipOperations.get(shipKey(projectId, worktreeId));
}

export function isProjectShipping(projectId: string, worktreeId?: string | null) {
  return (getShipOperation(projectId, worktreeId)?.count ?? 0) > 0;
}

export function getProjectShipPhase(
  projectId: string,
  worktreeId?: string | null,
): ShipPhase | null {
  const op = getShipOperation(projectId, worktreeId);
  if (!op || op.count <= 0) return null;
  return op.phase;
}

function notifyShipOperationListeners() {
  for (const listener of shipOperationListeners) listener();
}

export function beginShipOperation(projectId: string, worktreeId?: string | null) {
  const key = shipKey(projectId, worktreeId);
  const prev = activeShipOperations.get(key);
  activeShipOperations.set(key, {
    count: (prev?.count ?? 0) + 1,
    phase: "committing",
  });
  notifyShipOperationListeners();
}

export function setShipPhase(
  projectId: string,
  worktreeId: string | null | undefined,
  phase: ShipPhase,
) {
  const key = shipKey(projectId, worktreeId);
  const op = activeShipOperations.get(key);
  if (!op || op.count <= 0) return;
  activeShipOperations.set(key, { ...op, phase });
  notifyShipOperationListeners();
}

export function endShipOperation(projectId: string, worktreeId?: string | null) {
  const key = shipKey(projectId, worktreeId);
  const prev = activeShipOperations.get(key);
  const next = Math.max(0, (prev?.count ?? 0) - 1);
  if (next === 0) activeShipOperations.delete(key);
  else if (prev) activeShipOperations.set(key, { ...prev, count: next });
  notifyShipOperationListeners();
}

export function subscribeShipOperations(listener: () => void) {
  shipOperationListeners.add(listener);
  return () => {
    shipOperationListeners.delete(listener);
  };
}

/** Test-only: reset global ship state between cases. */
export function resetShipOperationsForTests() {
  activeShipOperations.clear();
  notifyShipOperationListeners();
}
