import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEV_SERVER_PORT,
  isValidTcpPort,
  nextTcpPort,
  productionRuntimePortStart,
  preferredProductionRuntimePort,
} from "../runtime-port";

describe("runtime port selection", () => {
  it("validates TCP ports", () => {
    expect(isValidTcpPort(1)).toBe(true);
    expect(isValidTcpPort(65535)).toBe(true);
    expect(isValidTcpPort(0)).toBe(false);
    expect(isValidTcpPort(65536)).toBe(false);
    expect(isValidTcpPort(1.5)).toBe(false);
    expect(isValidTcpPort(null)).toBe(false);
  });

  it("increments TCP ports within the valid range", () => {
    expect(nextTcpPort(5173)).toBe(5174);
    expect(nextTcpPort(65535)).toBeNull();
    expect(nextTcpPort(null)).toBeNull();
  });

  it("does not let production reuse the fixed dev server port", () => {
    expect(preferredProductionRuntimePort(DEFAULT_DEV_SERVER_PORT)).toBeNull();
    expect(
      preferredProductionRuntimePort(DEFAULT_DEV_SERVER_PORT, { devServerPort: 5174 }),
    ).toBeNull();
    expect(
      preferredProductionRuntimePort(4242, { devServerPort: 4242 }),
    ).toBeNull();
  });

  it("keeps a previous production runtime port when it is not the dev port", () => {
    expect(preferredProductionRuntimePort(49201)).toBe(49201);
    expect(preferredProductionRuntimePort(49201, { devServerPort: 5174 })).toBe(49201);
  });

  it("starts production one port above the dev server when there is no reusable previous port", () => {
    expect(productionRuntimePortStart(null)).toBe(DEFAULT_DEV_SERVER_PORT + 1);
    expect(productionRuntimePortStart(DEFAULT_DEV_SERVER_PORT)).toBe(DEFAULT_DEV_SERVER_PORT + 1);
    expect(productionRuntimePortStart(4242, { devServerPort: 4242 })).toBe(4243);
    expect(productionRuntimePortStart(null, { devServerPort: 5174 })).toBe(5175);
  });

  it("starts production from a reusable previous runtime port", () => {
    expect(productionRuntimePortStart(49201)).toBe(49201);
    expect(productionRuntimePortStart(49201, { devServerPort: 5174 })).toBe(49201);
  });
});
