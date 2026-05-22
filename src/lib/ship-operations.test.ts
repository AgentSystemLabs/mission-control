import { describe, expect, it, afterEach } from "vitest";
import {
  beginShipOperation,
  endShipOperation,
  getProjectShipPhase,
  isProjectShipping,
  resetShipOperationsForTests,
  setShipPhase,
} from "./ship-operations";

describe("ship-operations", () => {
  afterEach(() => {
    resetShipOperationsForTests();
  });

  it("tracks shipping independently per project", () => {
    beginShipOperation("project-a");
    expect(isProjectShipping("project-a")).toBe(true);
    expect(isProjectShipping("project-b")).toBe(false);
    expect(getProjectShipPhase("project-a")).toBe("committing");

    beginShipOperation("project-b");
    expect(isProjectShipping("project-a")).toBe(true);
    expect(isProjectShipping("project-b")).toBe(true);

    endShipOperation("project-a");
    expect(isProjectShipping("project-a")).toBe(false);
    expect(isProjectShipping("project-b")).toBe(true);

    endShipOperation("project-b");
    expect(isProjectShipping("project-b")).toBe(false);
  });

  it("updates phase per project without affecting others", () => {
    beginShipOperation("project-a");
    beginShipOperation("project-b");

    setShipPhase("project-a", null, "pushing");
    expect(getProjectShipPhase("project-a")).toBe("pushing");
    expect(getProjectShipPhase("project-b")).toBe("committing");
  });
});
