import { beforeEach, describe, expect, it } from "vitest";
import { appLogger, clearLogs, listLogs } from "../logger";

describe("app logger", () => {
  beforeEach(() => {
    clearLogs();
  });

  it("keeps logs in newest-first order", () => {
    const first = appLogger.info("system", "First");
    const second = appLogger.error("api", "Second");

    expect(listLogs().map((log) => log.id)).toEqual([second.id, first.id]);
  });

  it("respects list limits", () => {
    appLogger.info("system", "First");
    appLogger.info("system", "Second");

    expect(listLogs(1)).toHaveLength(1);
  });
});
