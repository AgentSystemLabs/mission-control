import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-license-test-"));
process.env.MC_USER_DATA_DIR = tmpRoot;
const keypair = generateKeyPairSync("ed25519");
process.env.MC_LICENSE_PUBLIC_KEY = keypair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

const { readLicenseState, validateLicense } = await import("../license");
const { getDb } = await import("~/db/client");
const { appSettings } = await import("~/db/schema");
const { setLicenseKey, setLicensePayload, setLicenseValidationResult } =
  await import("~/db/settings");

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

describe("license service", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getDb().delete(appSettings).run();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError?.mockRestore();
    vi.unstubAllGlobals();
  });

  it("activates a locally signed license without contacting academy", async () => {
    const key = signedLicense();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const license = await validateLicense(key);

    expect(fetch).not.toHaveBeenCalled();
    expect(license.status).toBe("active");
    expect(license.plan).toBe("pro");
    expect(license.payload?.licenseId).toBe("lic_test");
  });

  it("does not let an unsigned key inherit the previous key's local entitlement", async () => {
    setLicenseKey(signedLicense({ licenseId: "lic_old" }));
    setLicenseValidationResult("active", "pro", new Date("2026-05-07T17:10:17.000Z"));

    const license = await validateLicense("mc_live_NEW");

    expect(license.hasKey).toBe(false);
    expect(license.maskedKey).toBeNull();
    expect(license.status).toBe("invalid");
    expect(license.plan).toBeNull();
  });

  it("rejects a tampered signed license without contacting academy", async () => {
    const key = signedLicense();
    const tampered = key.replace(/.$/, key.endsWith("A") ? "B" : "A");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const license = await validateLicense(tampered);

    expect(fetch).not.toHaveBeenCalled();
    expect(license.status).toBe("invalid");
    expect(license.hasKey).toBe(false);
  });

  it("treats an expired signed license as invalid on read", () => {
    const payload = {
      licenseId: "lic_expired",
      customerId: "cus_test",
      product: "mission-control-pro" as const,
      tier: "pro" as const,
      expiresAt: "2020-01-01T00:00:00.000Z",
      maxMachines: 3,
      issuedAt: "2019-01-01T00:00:00.000Z",
    };
    setLicenseKey(signedLicense(payload));
    setLicensePayload(payload);
    setLicenseValidationResult("active", "pro");

    const license = readLicenseState();

    expect(license.hasKey).toBe(false);
    expect(license.status).toBe("invalid");
  });
});
