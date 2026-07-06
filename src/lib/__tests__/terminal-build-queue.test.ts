import { describe, expect, it } from "vitest";
import { acquireSurfaceBuildTurn } from "../terminal-build-queue";

describe("terminal build queue", () => {
  it("runs builds one at a time, in FIFO order", async () => {
    const order: string[] = [];

    const releaseA = await acquireSurfaceBuildTurn();
    order.push("a");

    const pendingB = acquireSurfaceBuildTurn().then((release) => {
      order.push("b");
      return release;
    });
    const pendingC = acquireSurfaceBuildTurn().then((release) => {
      order.push("c");
      return release;
    });

    // Give queued acquirers a real chance to (incorrectly) run early — the
    // paint yield is timer-based, so flushing microtasks alone isn't enough.
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual(["a"]);

    releaseA();
    const releaseB = await pendingB;
    expect(order).toEqual(["a", "b"]);

    releaseB();
    const releaseC = await pendingC;
    expect(order).toEqual(["a", "b", "c"]);
    releaseC();
  });

  it("treats repeat release calls as no-ops so a turn can't be double-freed", async () => {
    const releaseA = await acquireSurfaceBuildTurn();

    let bRan = false;
    let cRan = false;
    const pendingB = acquireSurfaceBuildTurn().then((release) => {
      bRan = true;
      return release;
    });
    const pendingC = acquireSurfaceBuildTurn().then((release) => {
      cRan = true;
      return release;
    });

    releaseA();
    releaseA(); // must not also hand C a turn while B holds it
    const releaseB = await pendingB;
    expect(bRan).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(cRan).toBe(false);

    releaseB();
    (await pendingC)();
  });
});
