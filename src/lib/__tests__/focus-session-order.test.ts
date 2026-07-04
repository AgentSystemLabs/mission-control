import { describe, it, expect } from "vitest";
import {
  activeFirst,
  emptyFocusOrderState,
  orderSessions,
  reconcileFocusOrder,
  type FocusOrderState,
  type SessionSnapshot,
} from "~/lib/focus-session-order";

const snap = (entries: Array<[string, string]>): SessionSnapshot[] =>
  entries.map(([taskId, status]) => ({ taskId, status }));

describe("reconcileFocusOrder", () => {
  it("baselines the first fold to incoming order with nothing unread", () => {
    const next = reconcileFocusOrder(
      emptyFocusOrderState,
      snap([
        ["a", "running"],
        ["b", "ready"],
        ["c", "finished"],
      ]),
      "a",
    );
    expect(next.order).toEqual(["a", "b", "c"]);
    expect(next.unread).toEqual([]);
    expect(next.status).toEqual({ a: "running", b: "ready", c: "finished" });
  });

  it("moves a session whose status changed to the front", () => {
    const base = reconcileFocusOrder(
      emptyFocusOrderState,
      snap([
        ["a", "running"],
        ["b", "ready"],
        ["c", "ready"],
      ]),
      "a",
    );
    // c transitions ready -> finished
    const next = reconcileFocusOrder(
      base,
      snap([
        ["a", "running"],
        ["b", "ready"],
        ["c", "finished"],
      ]),
      "a",
    );
    expect(next.order).toEqual(["c", "a", "b"]);
  });

  it("marks a background transition unread but never the active tab", () => {
    const base = reconcileFocusOrder(
      emptyFocusOrderState,
      snap([
        ["a", "running"],
        ["b", "running"],
      ]),
      "a",
    );
    // both a (active) and b (background) finish
    const next = reconcileFocusOrder(
      base,
      snap([
        ["a", "finished"],
        ["b", "finished"],
      ]),
      "a",
    );
    expect(next.unread).toEqual(["b"]);
  });

  it("clears unread once a session becomes active, even with no status change", () => {
    const base = reconcileFocusOrder(
      emptyFocusOrderState,
      snap([
        ["a", "running"],
        ["b", "running"],
      ]),
      "a",
    );
    const withUnread = reconcileFocusOrder(
      base,
      snap([
        ["a", "running"],
        ["b", "finished"],
      ]),
      "a",
    );
    expect(withUnread.unread).toEqual(["b"]);
    // user switches to b; same statuses, active flips to b
    const cleared = reconcileFocusOrder(
      withUnread,
      snap([
        ["a", "running"],
        ["b", "finished"],
      ]),
      "b",
    );
    expect(cleared.unread).toEqual([]);
  });

  it("drops removed sessions from order, status and unread", () => {
    let state: FocusOrderState = reconcileFocusOrder(
      emptyFocusOrderState,
      snap([
        ["a", "running"],
        ["b", "running"],
      ]),
      "a",
    );
    state = reconcileFocusOrder(
      state,
      snap([
        ["a", "running"],
        ["b", "finished"],
      ]),
      "a",
    );
    expect(state.unread).toEqual(["b"]);
    // b closes
    state = reconcileFocusOrder(state, snap([["a", "running"]]), "a");
    expect(state.order).toEqual(["a"]);
    expect(state.unread).toEqual([]);
    expect(state.status).toEqual({ a: "running" });
  });

  it("adds a brand-new session at the front and marks it unread when inactive", () => {
    const base = reconcileFocusOrder(
      emptyFocusOrderState,
      snap([["a", "running"]]),
      "a",
    );
    const next = reconcileFocusOrder(
      base,
      snap([
        ["a", "running"],
        ["b", "ready"],
      ]),
      "a",
    );
    expect(next.order).toEqual(["b", "a"]);
    expect(next.unread).toEqual(["b"]);
  });

  it("does not reorder on a pure active-tab switch", () => {
    const base = reconcileFocusOrder(
      emptyFocusOrderState,
      snap([
        ["a", "running"],
        ["b", "running"],
        ["c", "running"],
      ]),
      "a",
    );
    const next = reconcileFocusOrder(
      base,
      snap([
        ["a", "running"],
        ["b", "running"],
        ["c", "running"],
      ]),
      "c",
    );
    expect(next.order).toEqual(["a", "b", "c"]);
  });
});

describe("orderSessions", () => {
  it("projects order onto the live list", () => {
    const sessions = [{ taskId: "a" }, { taskId: "b" }, { taskId: "c" }];
    expect(orderSessions(sessions, ["c", "a", "b"]).map((s) => s.taskId)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("appends sessions missing from the order (e.g. a just-added one)", () => {
    const sessions = [{ taskId: "a" }, { taskId: "b" }];
    expect(orderSessions(sessions, ["a"]).map((s) => s.taskId)).toEqual(["a", "b"]);
  });

  it("ignores stale ids in the order", () => {
    const sessions = [{ taskId: "a" }];
    expect(orderSessions(sessions, ["gone", "a"]).map((s) => s.taskId)).toEqual(["a"]);
  });
});

describe("activeFirst", () => {
  it("pins the active session to the front, keeping the rest in order", () => {
    const sessions = [{ taskId: "a" }, { taskId: "b" }, { taskId: "c" }];
    expect(activeFirst(sessions, "c").map((s) => s.taskId)).toEqual(["c", "a", "b"]);
  });

  it("is a no-op when the active session is already first", () => {
    const sessions = [{ taskId: "a" }, { taskId: "b" }];
    expect(activeFirst(sessions, "a")).toBe(sessions);
  });

  it("is a no-op when there is no active session or it is absent", () => {
    const sessions = [{ taskId: "a" }, { taskId: "b" }];
    expect(activeFirst(sessions, null)).toBe(sessions);
    expect(activeFirst(sessions, "gone")).toBe(sessions);
  });
});
