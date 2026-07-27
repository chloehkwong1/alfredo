import { describe, it, expect } from "vitest";
import { computeDiscovery } from "./useWorktreeDiscovery";

describe("computeDiscovery", () => {
  it("baseline tick (no known set) adopts nothing and records all ids", () => {
    const d = computeDiscovery({ known: undefined, freshIds: ["a", "b"] });
    expect(d.adoptIds).toEqual([]);
    expect([...d.nextKnown].sort()).toEqual(["a", "b"]);
  });

  it("adopts only ids missing from the baseline", () => {
    const d = computeDiscovery({ known: new Set(["a"]), freshIds: ["a", "b"] });
    expect(d.adoptIds).toEqual(["b"]);
    expect([...d.nextKnown].sort()).toEqual(["a", "b"]);
  });

  it("an empty baseline set still adopts (distinct from undefined)", () => {
    const d = computeDiscovery({ known: new Set(), freshIds: ["a"] });
    expect(d.adoptIds).toEqual(["a"]);
  });

  it("drops vanished ids from the next baseline so a recreate re-adopts", () => {
    const gone = computeDiscovery({ known: new Set(["a", "b"]), freshIds: ["a"] });
    expect(gone.adoptIds).toEqual([]);
    expect([...gone.nextKnown]).toEqual(["a"]);
    const back = computeDiscovery({ known: gone.nextKnown, freshIds: ["a", "b"] });
    expect(back.adoptIds).toEqual(["b"]);
  });
});
