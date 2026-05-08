import { createPublicKey, verify } from "node:crypto";
import {
  isLicensePayloadExpired,
  type LicensePayload,
} from "~/shared/license";

declare const __MC_LICENSE_PUBLIC_KEY__: string | undefined;

export const LICENSE_PREFIX = "MC-PRO-v1";
const BUILT_IN_PUBLIC_KEY =
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAJwCMznYZTYSLfDU3B76dIZ1OBwUhEn4CG+FrnxRGhS0=\n-----END PUBLIC KEY-----\n";

type VerifyResult<T> =
  | { ok: true; payload: T }
  | { ok: false; reason: "format" | "signature" | "payload" | "expired" };

function configuredPublicKey(): string | null {
  const runtime = process.env.MC_LICENSE_PUBLIC_KEY;
  if (runtime) return runtime.replace(/\\n/g, "\n");
  if (typeof __MC_LICENSE_PUBLIC_KEY__ !== "undefined" && __MC_LICENSE_PUBLIC_KEY__) {
    return __MC_LICENSE_PUBLIC_KEY__.replace(/\\n/g, "\n");
  }
  return BUILT_IN_PUBLIC_KEY;
}

function parseSignedBlob<T>(blob: string, prefix: string): VerifyResult<T> {
  const [actualPrefix, encodedPayload, encodedSignature, extra] = blob.trim().split(".");
  if (
    actualPrefix !== prefix ||
    !encodedPayload ||
    !encodedSignature ||
    extra !== undefined
  ) {
    return { ok: false, reason: "format" };
  }

  const publicKey = configuredPublicKey();
  if (!publicKey) return { ok: false, reason: "signature" };

  let payloadBytes: Buffer;
  let signature: Buffer;
  try {
    payloadBytes = Buffer.from(encodedPayload, "base64url");
    signature = Buffer.from(encodedSignature, "base64url");
  } catch {
    return { ok: false, reason: "format" };
  }

  try {
    const valid = verify(
      null,
      payloadBytes,
      createPublicKey(publicKey),
      signature,
    );
    if (!valid) return { ok: false, reason: "signature" };
  } catch {
    return { ok: false, reason: "signature" };
  }

  try {
    return { ok: true, payload: JSON.parse(payloadBytes.toString("utf8")) as T };
  } catch {
    return { ok: false, reason: "payload" };
  }
}

function isLicensePayload(value: unknown): value is LicensePayload {
  const payload = value as Partial<LicensePayload> | null;
  return (
    !!payload &&
    payload.product === "mission-control-pro" &&
    payload.tier === "pro" &&
    typeof payload.licenseId === "string" &&
    typeof payload.customerId === "string" &&
    (typeof payload.expiresAt === "string" || payload.expiresAt === null) &&
    typeof payload.maxMachines === "number" &&
    typeof payload.issuedAt === "string"
  );
}

export function verifySignedLicense(
  blob: string,
  now: Date = new Date(),
): VerifyResult<LicensePayload> {
  const result = parseSignedBlob<unknown>(blob, LICENSE_PREFIX);
  if (!result.ok) return result;
  if (!isLicensePayload(result.payload)) {
    return { ok: false, reason: "payload" };
  }
  if (isLicensePayloadExpired(result.payload, now)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload: result.payload };
}
