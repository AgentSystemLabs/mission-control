import { describe, it, expect, beforeEach } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-sandboxes-svc-"));
process.env.MC_USER_DATA_DIR = tmpRoot;
const keypair = generateKeyPairSync("ed25519");
process.env.MC_LICENSE_PUBLIC_KEY = keypair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

const {
  createSandbox,
  getSandboxState,
  SandboxCapExceededError,
} = await import("../sandboxes");
const { getDb } = await import("~/db/client");
const { sandboxes, appSettings } = await import("~/db/schema");
const { setLicenseKey, clearLicense } = await import("../license-storage");
const { FREE_SANDBOX_CAP } = await import("~/shared/license");

function signedLicense(overrides: Record<string, unknown> = {}): string {
  const payload = Buffer.from(
    JSON.stringify({
      licenseId: "lic_test",
      customerId: "cus_test",
      product: "mission-control-pro",
      tier: "pro",
      expiresAt: null,
      maxMachines: 3,
      issuedAt: "2026-05-07T17:10:17.000Z",
      ...overrides,
    }),
    "utf8",
  );
  const signature = sign(null, payload, keypair.privateKey);
  return `MC-PRO-v1.${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

describe("sandboxes service", () => {
  beforeEach(() => {
    const db = getDb();
    db.delete(sandboxes).run();
    db.delete(appSettings).run();
    clearLicense();
  });

  describe("free-tier sandbox cap", () => {
    it(`allows creating up to ${FREE_SANDBOX_CAP} sandbox without a license`, () => {
      createSandbox({ name: "Docker One" });
      expect(getSandboxState().sandboxes).toHaveLength(FREE_SANDBOX_CAP);
    });

    it(`rejects creating beyond the cap of ${FREE_SANDBOX_CAP} when no license is set`, () => {
      createSandbox({ name: "Docker One" });
      expect(() => createSandbox({ name: "Docker Two" })).toThrow(SandboxCapExceededError);
    });

    it("allows unlimited sandboxes when an active license is on file", () => {
      setLicenseKey(signedLicense());
      createSandbox({ name: "One" });
      createSandbox({ name: "Two" });
      expect(getSandboxState().sandboxes).toHaveLength(2);
    });

    it("SandboxCapExceededError carries the limit and current count", () => {
      createSandbox({ name: "Only" });
      try {
        createSandbox({ name: "Over" });
        expect.fail("expected SandboxCapExceededError");
      } catch (e) {
        expect(e).toBeInstanceOf(SandboxCapExceededError);
        expect((e as InstanceType<typeof SandboxCapExceededError>).limit).toBe(FREE_SANDBOX_CAP);
        expect((e as InstanceType<typeof SandboxCapExceededError>).current).toBe(FREE_SANDBOX_CAP);
      }
    });
  });
});
