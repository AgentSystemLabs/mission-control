import { describe, expect, it } from "vitest";
import { classifyPetToolUse, petToolSentiment } from "../pet-tool-classify";

describe("classifyPetToolUse — Bash results", () => {
  const bash = (response: unknown, command = "") =>
    classifyPetToolUse("Bash", command ? { command } : {}, response);

  it("recognizes a landed git commit", () => {
    expect(
      bash("[feat/pet-hooks 3fa9c21] feat(pet): richer reactions\n 3 files changed, 120 insertions(+)"),
    ).toBe("commit");
  });

  it("recognizes a git push", () => {
    expect(
      bash("To github.com:ziadeh/mission-control.git\n   0c640a8..3fa9c21  feat/x -> feat/x"),
    ).toBe("push");
  });

  it("recognizes a merge conflict, even though the output also mentions failure", () => {
    expect(
      bash("Auto-merging src/app.ts\nCONFLICT (content): Merge conflict in src/app.ts\nAutomatic merge failed; fix conflicts and then commit the result."),
    ).toBe("merge-conflict");
  });

  it("recognizes failing tests by their non-zero count", () => {
    expect(bash("Tests: 2 failed, 30 passed, 32 total")).toBe("test-fail");
    expect(bash("3 tests failed")).toBe("test-fail");
  });

  it("does not read '0 failed' as a failure", () => {
    expect(bash("Tests: 0 failed, 32 passed, 32 total", "npx vitest run")).toBe("tests-pass");
  });

  it("recognizes a green suite only when the command looks like a test run", () => {
    expect(bash("Tests  1636 passed (1636)", "corepack pnpm test")).toBe("tests-pass");
    // "passed" in non-test output stays neutral.
    expect(bash("health check passed on 3 nodes", "curl status")).toBe("neutral");
  });

  it("recognizes type errors", () => {
    expect(bash("src/app.ts(4,3): error TS2345: Argument of type 'string'…")).toBe("type-error");
  });

  it("recognizes build failures", () => {
    expect(bash("ERROR in ./src/index.ts\nModule build failed")).toBe("build-fail");
    expect(bash("error[E0308]: mismatched types")).toBe("build-fail");
  });

  it("recognizes eslint's summary line", () => {
    expect(bash("✖ 3 problems (2 errors, 1 warning)")).toBe("lint-fail");
  });

  it("recognizes a deploy from the command", () => {
    expect(bash("Uploaded worker in 2s", "npx wrangler deploy")).toBe("deploy");
  });

  it("falls back to the generic error markers", () => {
    expect(bash("thread 'main' panicked at src/main.rs:4")).toBe("error");
  });

  it("honors a structured isError flag over clean-looking text", () => {
    expect(bash({ isError: true, stdout: "looks fine" })).toBe("error");
  });

  it("returns neutral for unremarkable output", () => {
    expect(bash("total 48\ndrwxr-xr-x  12 dev staff")).toBe("neutral");
  });
});

describe("classifyPetToolUse — Write/Edit file kinds", () => {
  const edit = (file_path: string) => classifyPetToolUse("Edit", { file_path }, {});

  it("classifies by file path", () => {
    expect(edit("src/lib/pet/pet-store.test.ts")).toBe("edit-test");
    expect(edit("src/components/__tests__/helpers.ts")).toBe("edit-test");
    expect(edit("src/styles.css")).toBe("edit-styles");
    expect(edit("docs/worktree-plan.md")).toBe("edit-docs");
    expect(edit("README")).toBe("edit-docs");
    expect(edit("package.json")).toBe("edit-config");
    expect(edit(".env.local")).toBe("edit-config");
    expect(edit("pnpm-lock.yaml")).toBe("edit-lockfile");
    expect(edit("drizzle/migrations/0004_add_pets.sql")).toBe("edit-migration");
    expect(edit("src/lib/pet/pet-store.ts")).toBe("neutral");
  });

  it("treats an errored Write as an error, not a file-kind", () => {
    expect(classifyPetToolUse("Write", { file_path: "src/styles.css" }, { isError: true })).toBe(
      "error",
    );
  });
});

describe("petToolSentiment", () => {
  it("rolls kinds up into the coarse sentiment", () => {
    expect(petToolSentiment("merge-conflict")).toBe("error");
    expect(petToolSentiment("test-fail")).toBe("error");
    expect(petToolSentiment("commit")).toBe("success");
    expect(petToolSentiment("tests-pass")).toBe("success");
    expect(petToolSentiment("edit-styles")).toBe("neutral");
    expect(petToolSentiment("neutral")).toBe("neutral");
  });
});
