import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-usage-controller-"));
process.env.MC_USER_DATA_DIR = tmpRoot;

// Control the sync's timing while keeping getUsageSummary reading the real
// (temp) DB, so we can exercise both budget branches deterministically.
const syncMock = vi.fn<() => Promise<number>>();
vi.mock("../../services/token-usage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/token-usage")>();
  return { ...actual, syncTokenUsage: () => syncMock() };
});

const usageController = await import("../usage.controller");
const { getDb } = await import("~/db/client");
const { tokenUsage } = await import("~/db/schema");

describe("usage controller", () => {
  beforeEach(() => {
    syncMock.mockReset();
    getDb().delete(tokenUsage).run();
  });

  it("waits for a fast sync and returns fresh data, not syncing", async () => {
    syncMock.mockResolvedValue(0);
    const res = await usageController.read(
      new URL("http://localhost/api/usage?days=30"),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ syncing: false });
    expect(body).toHaveProperty("totals");
    expect(body).toHaveProperty("perDay");
    expect(body).toHaveProperty("perProject");
    expect(body).toHaveProperty("perSession");
  });

  it("answers immediately when the sync exceeds the budget, then converges", async () => {
    // First call: the sync is still running (cold walk) — it doesn't resolve in
    // time, so the response comes back marked syncing.
    let resolveSlow!: () => void;
    syncMock.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        resolveSlow = () => resolve(0);
      }),
    );
    const slow = await usageController.read(
      new URL("http://localhost/api/usage?days=30"),
    );
    const slowBody = (await slow.json()) as Record<string, unknown>;
    expect(slowBody).toMatchObject({ syncing: true });
    expect(slowBody).toHaveProperty("perDay");

    // The background sync completes; the next poll finishes within budget and
    // reports fresh, non-syncing data.
    resolveSlow();
    syncMock.mockResolvedValueOnce(0);
    const converged = await usageController.read(
      new URL("http://localhost/api/usage?days=30"),
    );
    expect((await converged.json()) as Record<string, unknown>).toMatchObject({
      syncing: false,
    });
  });

  it("swallows a slow sync rejection landing after the budget (no unhandledRejection)", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on("unhandledRejection", onUnhandled);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // A cold sync that never resolves within the budget, then rejects — the
    // controller must have kept a rejection handler on it so the late failure
    // does not surface as an unhandledRejection.
    let rejectSlow!: (e: unknown) => void;
    syncMock.mockReturnValueOnce(
      new Promise<number>((_resolve, reject) => {
        rejectSlow = reject;
      }),
    );
    const res = await usageController.read(
      new URL("http://localhost/api/usage?days=30"),
    );
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      syncing: true,
    });
    rejectSlow(new Error("boom"));
    // Give the attached rejection handler a tick to run.
    await new Promise((r) => setTimeout(r, 0));
    process.off("unhandledRejection", onUnhandled);
    errSpy.mockRestore();
    expect(unhandled).toEqual([]);
  });

  it("does not sync when sync=0 and reports it is not syncing", async () => {
    const res = await usageController.read(
      new URL("http://localhost/api/usage?days=30&sync=0"),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(syncMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ syncing: false });
  });
});
