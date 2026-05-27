export type PinnedOrderable = {
  id: string;
  pinned: boolean;
  pinnedOrder: number | null;
  createdAt: number;
};

function comparePinnedProjects<T extends PinnedOrderable>(left: T, right: T): number {
  const leftOrder = left.pinnedOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.pinnedOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return left.createdAt - right.createdAt;
}

export function getPinnedProjects<T extends PinnedOrderable>(
  projects: readonly T[],
): T[] {
  return projects.filter((project) => project.pinned).slice().sort(comparePinnedProjects);
}

export function nextPinnedOrder(projects: readonly PinnedOrderable[]): number {
  let max = -1;
  for (const project of projects) {
    if (!project.pinned || project.pinnedOrder == null) continue;
    if (project.pinnedOrder > max) max = project.pinnedOrder;
  }
  return max + 1;
}

export function reorderPinnedIds(currentOrder: readonly string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex === toIndex) return [...currentOrder];
  const next = [...currentOrder];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved!);
  return next;
}

export function validatePinnedReorder(
  order: readonly string[],
  pinnedProjects: readonly PinnedOrderable[],
): void {
  const pinnedIds = new Set(pinnedProjects.map((project) => project.id));
  if (order.length !== pinnedIds.size) {
    throw new Error("order must include every pinned project exactly once");
  }
  const seen = new Set<string>();
  for (const id of order) {
    if (!pinnedIds.has(id)) throw new Error(`project ${id} is not pinned`);
    if (seen.has(id)) throw new Error("duplicate project id in order");
    seen.add(id);
  }
}
