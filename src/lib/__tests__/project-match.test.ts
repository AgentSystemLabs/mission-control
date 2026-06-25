import { describe, expect, it } from "vitest";
import { matchProjects } from "../project-match";

type P = { id: string; name: string };
const match = (q: string, projects: P[]) => matchProjects(q, projects, (p) => p.name);

describe("matchProjects", () => {
  it("matches an exact name confidently", () => {
    const r = match("agentic jumpstart", [
      { id: "1", name: "Agentic Jumpstart" },
      { id: "2", name: "Mission Control" },
    ]);
    expect(r.confident).toBe(true);
    expect(r.best?.item.id).toBe("1");
  });

  it("handles word-splitting (OwlTales → 'owl tales')", () => {
    const r = match("owl tales", [
      { id: "1", name: "OwlTales" },
      { id: "2", name: "Mission Control" },
    ]);
    expect(r.best?.item.id).toBe("1");
    expect(r.confident).toBe(true);
  });

  it("handles homophones via phonetics ('owl tails' → 'Owl Tales')", () => {
    const r = match("owl tails", [
      { id: "1", name: "Owl Tales" },
      { id: "2", name: "Budget Tracker" },
    ]);
    expect(r.best?.item.id).toBe("1");
    expect(r.confident).toBe(true);
  });

  it("matches a partial name", () => {
    const r = match("jumpstart", [
      { id: "1", name: "Agentic Jumpstart" },
      { id: "2", name: "Mission Control" },
    ]);
    expect(r.best?.item.id).toBe("1");
  });

  it("is NOT confident when two names are similarly close, and returns both", () => {
    const r = match("owl", [
      { id: "1", name: "Owl Tales" },
      { id: "2", name: "Owl Park" },
      { id: "3", name: "Budget Tracker" },
    ]);
    expect(r.confident).toBe(false);
    const ids = r.candidates.map((c) => c.item.id);
    expect(ids).toContain("1");
    expect(ids).toContain("2");
  });

  it("returns no match for an unrelated query", () => {
    const r = match("quarterly taxes", [
      { id: "1", name: "Owl Tales" },
      { id: "2", name: "Mission Control" },
    ]);
    expect(r.best).toBeNull();
    expect(r.candidates).toHaveLength(0);
  });

  it("returns empty for blank query or no projects", () => {
    expect(match("", [{ id: "1", name: "Owl Tales" }]).best).toBeNull();
    expect(match("owl", []).best).toBeNull();
  });
});
