import { describe, expect, it } from "vitest";
import { acquireSpawnSlot } from "../pty-spawn-queue";

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("pty spawn queue", () => {
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
