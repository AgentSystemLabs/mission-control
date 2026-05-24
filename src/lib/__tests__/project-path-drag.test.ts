import { describe, expect, it } from "vitest";
import {
  PROJECT_PATH_DRAG_MIME,
  formatPathForTerminalPaste,
  isProjectPathDrag,
  readProjectPathFromDragEvent,
  setProjectPathDragData,
} from "../project-path-drag";

describe("formatPathForTerminalPaste", () => {
  it("leaves simple paths unquoted", () => {
    expect(formatPathForTerminalPaste("/Users/dev/project")).toBe("/Users/dev/project");
  });

  it("quotes paths with spaces and escapes embedded quotes", () => {
    expect(formatPathForTerminalPaste('/Users/dev/my "app"')).toBe(
      '"/Users/dev/my \\"app\\""'
    );
  });
});

describe("project path drag payload", () => {
  it("sets custom and plain-text mime types", () => {
    const data = new Map<string, string>();
    const dataTransfer = {
      setData(type: string, value: string) {
        data.set(type, value);
      },
      getData(type: string) {
        return data.get(type) ?? "";
      },
      types: [] as string[],
      effectAllowed: "",
    } as DataTransfer;

    setProjectPathDragData(dataTransfer, "/Users/dev/project");
    expect(data.get(PROJECT_PATH_DRAG_MIME)).toBe("/Users/dev/project");
    expect(data.get("text/plain")).toBe("/Users/dev/project");
    expect(dataTransfer.effectAllowed).toBe("copy");
  });

  it("detects and reads project path drags", () => {
    const event = {
      dataTransfer: {
        types: [PROJECT_PATH_DRAG_MIME],
        getData(type: string) {
          if (type === PROJECT_PATH_DRAG_MIME) return "/Users/dev/project";
          return "";
        },
      },
    } as DragEvent;

    expect(isProjectPathDrag(event)).toBe(true);
    expect(readProjectPathFromDragEvent(event)).toBe("/Users/dev/project");
  });
});
