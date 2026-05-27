import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_WEB_PERMISSION,
  shouldAllowWebPermission,
} from "../notification-permissions";

describe("shouldAllowWebPermission", () => {
  it("allows notification permission requests", () => {
    expect(shouldAllowWebPermission(NOTIFICATION_WEB_PERMISSION)).toBe(true);
  });

  it("denies other web permission requests", () => {
    expect(shouldAllowWebPermission("media")).toBe(false);
    expect(shouldAllowWebPermission("geolocation")).toBe(false);
    expect(shouldAllowWebPermission("clipboard-read")).toBe(false);
  });
});
