// Host-port allocation for sandboxes. Because every enabled sandbox can run at
// once ("keep all running"), two sandboxes can't both bind host :3000 — so each
// declared container port is mapped to a free host port, persisted so it stays
// stable across restarts. Pure: the caller supplies `isFree` (a real bind probe
// combined with ports already claimed by other sandboxes). See docs/multi-sandbox-plan.md.

export type PortAllocation = {
  /** Host port mapped to the in-container agent WS (container 9333). */
  hostAgentPort: number;
  /** Declared container port → assigned host port. */
  portMap: Record<number, number>;
};

const DEFAULT_SEARCH_START = 10_000;
const DEFAULT_SEARCH_END = 65_535;

export type AllocateOptions = {
  /** Container ports the user wants reachable on the host (excludes agent port). */
  declaredPorts: number[];
  /** Previously-assigned mapping, reused when still free (restart stability). */
  prev?: { hostAgentPort?: number | null; portMap?: Record<number, number> | null } | null;
  /** True when `port` is bindable on the host AND not used by another sandbox. */
  isFree: (port: number) => boolean;
  searchStart?: number;
  searchEnd?: number;
};

/**
 * Allocate host ports for one sandbox. Preference order per declared port:
 *   1. its previously-assigned host port (stable across restarts),
 *   2. the container port itself (so the first sandbox gets localhost:3000→3000),
 *   3. the next free port scanning from `searchStart`.
 * The agent port reuses its previous host port if free, else scans.
 */
export function allocateSandboxPorts(opts: AllocateOptions): PortAllocation {
  const searchStart = opts.searchStart ?? DEFAULT_SEARCH_START;
  const searchEnd = opts.searchEnd ?? DEFAULT_SEARCH_END;
  const prevPortMap = opts.prev?.portMap ?? {};
  const claimed = new Set<number>();

  const available = (port: number): boolean =>
    Number.isInteger(port) && port > 0 && port <= 65_535 && !claimed.has(port) && opts.isFree(port);

  const scan = (): number => {
    for (let p = searchStart; p <= searchEnd; p++) {
      if (available(p)) {
        claimed.add(p);
        return p;
      }
    }
    throw new Error("no free host port available for sandbox");
  };

  const claim = (...preferred: Array<number | null | undefined>): number => {
    for (const p of preferred) {
      if (p != null && available(p)) {
        claimed.add(p);
        return p;
      }
    }
    return scan();
  };

  const hostAgentPort = claim(opts.prev?.hostAgentPort);

  const portMap: Record<number, number> = {};
  for (const containerPort of dedupePorts(opts.declaredPorts)) {
    portMap[containerPort] = claim(prevPortMap[containerPort], containerPort);
  }

  return { hostAgentPort, portMap };
}

function dedupePorts(ports: number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const p of ports) {
    if (!Number.isInteger(p) || p <= 0 || p > 65_535 || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}
