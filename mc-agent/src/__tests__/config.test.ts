import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_PORT, loadConfig } from "../config";

describe("loadConfig", () => {
  it("uses MC_AGENT_API_KEY before the local Docker pairing token", () => {
    const config = loadConfig({
      MC_AGENT_API_KEY: "remote-key",
      MC_PAIRING_TOKEN: "local-token",
    });

    expect(config.pairingToken).toBe("remote-key");
  });

  it("uses Railway PORT when MC_AGENT_PORT is not set", () => {
    expect(loadConfig({ PORT: "4567" }).port).toBe(4567);
    expect(loadConfig({ PORT: "4567", MC_AGENT_PORT: "9334" }).port).toBe(9334);
  });

  it("falls back to safe defaults for invalid ports and bind host", () => {
    const config = loadConfig({ PORT: "not-a-port" });

    expect(config.port).toBe(DEFAULT_AGENT_PORT);
    expect(config.bindHost).toBe("0.0.0.0");
  });
});
