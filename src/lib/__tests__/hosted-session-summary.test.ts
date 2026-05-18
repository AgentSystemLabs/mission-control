import { describe, expect, it } from "vitest";
import { createElectronLocalSessionSummary } from "../hosted-session-summary";

describe("hosted session summary", () => {
  it("treats Electron as local and already authenticated", () => {
    expect(createElectronLocalSessionSummary()).toMatchObject({
      hostedEnabled: false,
      authenticated: true,
      user: null,
    });
  });
});
