import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireSpawnSlot,
  setSpawnConcurrencyForTests,
  spawnConcurrencyFor,
} from "../pty-spawn-queue";

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("pty spawn queue", () => {
  // Pin the cap so the queueing assertions don't depend on the CI machine's
  // core count (the real cap scales with hardwareConcurrency).
  let prevCap: number;
  beforeEach(() => {
    prevCap = setSpawnConcurrencyForTests(2);
  });
  afterEach(() => {
    setSpawnConcurrencyForTests(prevCap);
  });

  it("caps concurrent holders and admits waiters as slots free up", async () => {
    const releaseA = await acquireSpawnSlot();
    const releaseB = await acquireSpawnSlot();

    let cAdmitted = false;
    const pendingC = acquireSpawnSlot().then((release) => {
      cAdmitted = true;
      return release;
    });
    await settled();
    expect(cAdmitted).toBe(false);

    releaseA();
    const releaseC = await pendingC;
    expect(cAdmitted).toBe(true);

    releaseB();
    releaseC();
  });

  it("treats repeat release calls as no-ops so a slot can't be double-freed", async () => {
    const releaseA = await acquireSpawnSlot();
    const releaseB = await acquireSpawnSlot();
    releaseA();
    releaseA(); // must not free B's slot too

    let dAdmitted = false;
    let eAdmitted = false;
    const pendingD = acquireSpawnSlot().then((release) => {
      dAdmitted = true;
      return release;
    });
    const pendingE = acquireSpawnSlot().then((release) => {
      eAdmitted = true;
      return release;
    });
    await settled();
    // One slot free (A's) → D admitted; E must wait until B releases.
    expect(dAdmitted).toBe(true);
    expect(eAdmitted).toBe(false);

    releaseB();
    const releaseE = await pendingE;
    (await pendingD)();
    releaseE();
  });
});

describe("spawnConcurrencyFor", () => {
  it("scales to half the cores, clamped between 2 and 6", () => {
    expect(spawnConcurrencyFor(4)).toBe(2);
    expect(spawnConcurrencyFor(8)).toBe(4);
    expect(spawnConcurrencyFor(10)).toBe(5);
    expect(spawnConcurrencyFor(12)).toBe(6);
    expect(spawnConcurrencyFor(32)).toBe(6);
  });

  it("falls back to the floor when the core count is unknown or bogus", () => {
    expect(spawnConcurrencyFor(undefined)).toBe(2);
    expect(spawnConcurrencyFor(0)).toBe(2);
    expect(spawnConcurrencyFor(1)).toBe(2);
    expect(spawnConcurrencyFor(Number.NaN)).toBe(2);
  });
});
