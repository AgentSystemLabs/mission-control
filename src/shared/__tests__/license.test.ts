import { describe, expect, it } from "vitest";
import { isAcademyTier, isProTier, maskLicenseKey } from "../license";

describe("maskLicenseKey", () => {
  it("masks long keys with a compact fixed-width prefix", () => {
    expect(maskLicenseKey("mc_live_AAAABBBBCCCCDDDD")).toBe(
      "••••••••••••DDDD",
    );
  });

  it("masks short keys entirely", () => {
    expect(maskLicenseKey("abcd")).toBe("••••");
    expect(maskLicenseKey("ab")).toBe("••");
  });

  it("returns empty for empty input", () => {
    expect(maskLicenseKey("")).toBe("");
  });

  it("trims surrounding whitespace before masking", () => {
    expect(maskLicenseKey("  mc_live_XYZW1234  ")).toBe("••••••••••••1234");
  });
});

describe("isProTier", () => {
  it("requires a locally active signed license", () => {
    expect(isProTier({ hasKey: true, status: "active" })).toBe(true);
  });

  it("returns false when no key is on file", () => {
    expect(isProTier({ hasKey: false, status: null })).toBe(false);
  });

  it("returns false when status is invalid", () => {
    expect(isProTier({ hasKey: true, status: "invalid" })).toBe(false);
  });
});

describe("isAcademyTier", () => {
  it("accepts active academy and full system payloads", () => {
    expect(
      isAcademyTier({
        hasKey: true,
        status: "active",
        payload: {
          licenseId: "lic_1",
          customerId: "cus_1",
          product: "mission-control-pro",
          tier: "academy",
          expiresAt: null,
          maxMachines: 3,
          issuedAt: "2026-05-07T00:00:00.000Z",
        },
      }),
    ).toBe(true);
    expect(
      isAcademyTier({
        hasKey: true,
        status: "active",
        payload: {
          licenseId: "lic_2",
          customerId: "cus_2",
          product: "mission-control-pro",
          tier: "full_system",
          expiresAt: null,
          maxMachines: 3,
          issuedAt: "2026-05-07T00:00:00.000Z",
        },
      }),
    ).toBe(true);
  });

  it("rejects active pro payloads", () => {
    expect(
      isAcademyTier({
        hasKey: true,
        status: "active",
        payload: {
          licenseId: "lic_3",
          customerId: "cus_3",
          product: "mission-control-pro",
          tier: "pro",
          expiresAt: null,
          maxMachines: 3,
          issuedAt: "2026-05-07T00:00:00.000Z",
        },
      }),
    ).toBe(false);
  });
});
