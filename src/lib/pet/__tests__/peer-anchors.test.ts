import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetPeerAnchorsForTests,
  getPeerAnchorX,
  setPeerAnchorX,
} from "../peer-anchors";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  // Vitest's default env is node — stub the browser storage the module uses.
  (
    globalThis as unknown as {
      window: {
        localStorage: {
          getItem: (k: string) => string | null;
          setItem: (k: string, v: string) => void;
          removeItem: (k: string) => void;
        };
      };
    }
  ).window = {
    localStorage: {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => {
        memory.set(k, v);
      },
      removeItem: (k) => {
        memory.delete(k);
      },
    },
  };
  __resetPeerAnchorsForTests();
});

afterEach(() => {
  __resetPeerAnchorsForTests();
});

describe("peer-anchors", () => {
  it("returns undefined for an unknown peer", () => {
    expect(getPeerAnchorX("nobody")).toBeUndefined();
  });

  it("round-trips a drop position through memory and localStorage", () => {
    setPeerAnchorX("peer-a", 420.7);
    expect(getPeerAnchorX("peer-a")).toBe(421);

    const raw = window.localStorage.getItem("mc-remote-pet-anchors");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as Record<string, { x: number; at: number }>;
    expect(parsed["peer-a"]?.x).toBe(421);
  });

  it("survives a cache reload from localStorage", () => {
    setPeerAnchorX("peer-c", 250);
    const raw = window.localStorage.getItem("mc-remote-pet-anchors");
    __resetPeerAnchorsForTests();
    // Reset clears storage — restore the snapshot so the next get rehydrates.
    window.localStorage.setItem("mc-remote-pet-anchors", raw!);
    expect(getPeerAnchorX("peer-c")).toBe(250);
  });

  it("ignores malformed storage instead of throwing", () => {
    window.localStorage.setItem("mc-remote-pet-anchors", "{not-json");
    expect(getPeerAnchorX("peer-x")).toBeUndefined();
    setPeerAnchorX("peer-x", 12);
    expect(getPeerAnchorX("peer-x")).toBe(12);
  });

  it("prunes oldest entries when over the cap", () => {
    for (let i = 0; i < 205; i++) {
      setPeerAnchorX(`peer-${i}`, i);
    }
    expect(getPeerAnchorX("peer-0")).toBeUndefined();
    expect(getPeerAnchorX("peer-204")).toBe(204);
  });
});
