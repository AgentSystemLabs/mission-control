import { describe, expect, it } from "vitest";

// @ts-expect-error The setup CLI is a Node .mjs script; tests exercise exported helpers.
const fetchWhisper = await import("../../scripts/fetch-whisper.mjs");

const { inspectMacBundleLinkage, isMacBundledLibraryRef, parseOtoolLibraries, parseOtoolRpaths } = fetchWhisper;

describe("fetch-whisper macOS linkage helpers", () => {
  const linkedLibrariesOutput = `resources/whisper/whisper-server:
\t@rpath/libwhisper.1.dylib (compatibility version 1.0.0, current version 1.9.1)
\t@rpath/libggml.0.dylib (compatibility version 0.0.0, current version 0.15.2)
\t@rpath/libggml-cpu.0.dylib (compatibility version 0.0.0, current version 0.15.2)
\t@rpath/libggml-blas.0.dylib (compatibility version 0.0.0, current version 0.15.2)
\t@rpath/libggml-metal.0.dylib (compatibility version 0.0.0, current version 0.15.2)
\t@rpath/libggml-base.0.dylib (compatibility version 0.0.0, current version 0.15.2)
\t/usr/lib/libc++.1.dylib (compatibility version 1.0.0, current version 2100.43.0)
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1356.0.0)`;

  const rpathOutput = `Load command 22
          cmd LC_RPATH
      cmdsize 104
         path /private/var/folders/mn/T/whisper-build-hAjJSL/build/bin (offset 12)`;

  it("classifies whisper.cpp dylibs as bundled dependencies", () => {
    expect(isMacBundledLibraryRef("@rpath/libwhisper.1.dylib")).toBe(true);
    expect(isMacBundledLibraryRef("@loader_path/libggml.0.dylib")).toBe(true);
    expect(isMacBundledLibraryRef("/usr/lib/libc++.1.dylib")).toBe(false);
    expect(isMacBundledLibraryRef("/System/Library/Frameworks/CoreML.framework/CoreML")).toBe(false);
    expect(isMacBundledLibraryRef("@rpath/libggml.so")).toBe(false);
  });

  it("detects the release artifact shape that cannot load outside the temp build directory", () => {
    const status = inspectMacBundleLinkage(
      parseOtoolLibraries(linkedLibrariesOutput),
      parseOtoolRpaths(rpathOutput),
      new Set(["whisper-server", "ggml-base.en.bin"]),
    );

    expect(status.missingLibraries).toEqual([
      "libwhisper.1.dylib",
      "libggml.0.dylib",
      "libggml-cpu.0.dylib",
      "libggml-blas.0.dylib",
      "libggml-metal.0.dylib",
      "libggml-base.0.dylib",
    ]);
    expect(status.needsRpathRepair).toBe(true);
  });

  it("accepts a bundle with all dylibs present and a local loader rpath", () => {
    const libraries = parseOtoolLibraries(linkedLibrariesOutput);
    const status = inspectMacBundleLinkage(
      libraries,
      ["@loader_path"],
      new Set(["whisper-server", "ggml-base.en.bin", ...libraries.map((ref: string) => ref.split("/").at(-1))]),
    );

    expect(status.missingLibraries).toEqual([]);
    expect(status.needsRpathRepair).toBe(false);
  });
});
