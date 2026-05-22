import { describe, expect, it } from "vitest";
import { buildMermaidInitConfig } from "../mermaid-theme";

describe("buildMermaidInitConfig", () => {
  it("uses the base theme with darkMode for dark scheme", () => {
    const config = buildMermaidInitConfig("dark");
    expect(config.theme).toBe("base");
    expect(config.themeVariables.darkMode).toBe(true);
    expect(config.themeVariables.background).toBe("transparent");
    expect(config.themeVariables.actorBkg).toBe("#1a1d22");
    expect(config.themeVariables.lineColor).toBe("rgba(232, 230, 223, 0.6)");
  });

  it("uses light palette values for light scheme", () => {
    const config = buildMermaidInitConfig("light");
    expect(config.themeVariables.darkMode).toBe(false);
    expect(config.themeVariables.actorBkg).toBe("#f1f0eb");
    expect(config.themeVariables.primaryTextColor).toBe("#1a1a1a");
  });

  it("includes sequence diagram variables for contrast", () => {
    const config = buildMermaidInitConfig("dark");
    expect(config.themeVariables.actorBorder).toBeTruthy();
    expect(config.themeVariables.signalColor).toBeTruthy();
    expect(config.themeVariables.activationBkgColor).toBeTruthy();
  });
});
