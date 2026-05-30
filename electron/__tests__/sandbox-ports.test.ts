import { describe, it, expect } from "vitest";
import { allocateSandboxPorts } from "../sandbox-ports";

const allFree = () => true;

describe("allocateSandboxPorts", () => {
  it("maps a declared port to itself when the host port is free (first sandbox)", () => {
    const a = allocateSandboxPorts({ declaredPorts: [3000, 5173], isFree: allFree, searchStart: 20000 });
    expect(a.portMap).toEqual({ 3000: 3000, 5173: 5173 });
    expect(a.hostAgentPort).toBeGreaterThanOrEqual(20000); // agent has no natural host port → scanned
  });

  it("remaps to a free host port when the preferred one is taken (second sandbox)", () => {
    const taken = new Set([3000, 9333]);
    const a = allocateSandboxPorts({
      declaredPorts: [3000],
      isFree: (p) => !taken.has(p),
      searchStart: 13000,
    });
    expect(a.portMap[3000]).not.toBe(3000); // 3000 is taken → remapped
    expect(a.portMap[3000]).toBeGreaterThanOrEqual(13000); // from the search range
    expect(a.portMap[3000]).not.toBe(a.hostAgentPort); // never collides with the agent port
  });

  it("reuses the previously-assigned host ports when still free (restart stability)", () => {
    const a = allocateSandboxPorts({
      declaredPorts: [3000],
      prev: { hostAgentPort: 41000, portMap: { 3000: 13000 } },
      isFree: allFree,
      searchStart: 20000,
    });
    expect(a.hostAgentPort).toBe(41000);
    expect(a.portMap[3000]).toBe(13000); // kept stable, not re-picked to 3000
  });

  it("never assigns the same host port twice within one allocation", () => {
    // Force collisions: only a tiny range is free.
    const a = allocateSandboxPorts({
      declaredPorts: [3000, 3001, 3002],
      isFree: (p) => p === 3000 || (p >= 50000 && p <= 50010),
      searchStart: 50000,
    });
    const hosts = [a.hostAgentPort, ...Object.values(a.portMap)];
    expect(new Set(hosts).size).toBe(hosts.length);
    expect(a.portMap[3000]).toBe(3000); // container-match still preferred when free
  });

  it("dedupes declared ports", () => {
    const a = allocateSandboxPorts({ declaredPorts: [3000, 3000], isFree: allFree, searchStart: 20000 });
    expect(Object.keys(a.portMap)).toEqual(["3000"]);
  });

  it("throws when no host port is free", () => {
    expect(() =>
      allocateSandboxPorts({ declaredPorts: [3000], isFree: () => false, searchStart: 20000, searchEnd: 20005 }),
    ).toThrow(/no free host port/);
  });
});
