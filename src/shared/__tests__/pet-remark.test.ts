import { describe, expect, it } from "vitest";
import {
  extractPetRemark,
  renderPetRemarkInstruction,
  PET_REMARK_MAX_CHARS,
} from "../pet-remark";

describe("extractPetRemark", () => {
  it("pulls the cue out of a response", () => {
    expect(
      extractPetRemark("All done — tests are green.\n\n<!-- pet: green across the board! -->"),
    ).toBe("green across the board!");
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    expect(extractPetRemark("done <!--  PET:   we did it  -->")).toBe("we did it");
  });

  it("takes the last cue when several were emitted", () => {
    expect(
      extractPetRemark("<!-- pet: first --> middle text <!-- pet: second -->"),
    ).toBe("second");
  });

  it("collapses internal whitespace and caps the length", () => {
    expect(extractPetRemark("<!-- pet: two\n  lines -->")).toBe("two lines");
    const long = `<!-- pet: ${"a".repeat(400)} -->`;
    expect(extractPetRemark(long)!.length).toBe(PET_REMARK_MAX_CHARS);
  });

  it("returns null for ordinary comments and plain text", () => {
    expect(extractPetRemark("no comments here")).toBeNull();
    expect(extractPetRemark("<!-- buddy: wrong prefix -->")).toBeNull();
    expect(extractPetRemark("<!-- pet: -->")).toBeNull();
    expect(extractPetRemark("")).toBeNull();
  });
});

describe("renderPetRemarkInstruction", () => {
  it("mentions the pet's name and the cue format", () => {
    const withName = renderPetRemarkInstruction("Pixel");
    expect(withName).toContain("named Pixel");
    expect(withName).toContain("<!-- pet:");
    // Round-trip: an instruction-following example must parse.
    expect(extractPetRemark("<!-- pet: hello -->")).toBe("hello");
  });

  it("still reads naturally without a name", () => {
    const anon = renderPetRemarkInstruction(null);
    expect(anon).not.toContain("named");
    expect(anon).toContain("A tiny desktop pet lives");
  });
});
