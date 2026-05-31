import { describe, expect, it } from "vitest";

import { pruneIsolatedGridCells } from "../helpers/pure-logic.js";

function makeCell(keep = true) {
  return { sum: 1, count: 1, mean: 0.02, keep };
}

function cloneFrequencyMap(entries) {
  return new Map(
    Array.from(entries, ([key, value]) => [key, { ...value }])
  );
}

function makeDenseCenterMap() {
  const map = new Map();
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      map.set(`${x},${z}`, makeCell(true));
    }
  }
  return map;
}

function makeThresholdBoundaryMap() {
  const map = new Map();

  for (let x = -3; x <= 3; x++) {
    for (let z = -3; z <= 3; z++) {
      map.set(`${x},${z}`, makeCell(true));
    }
  }

  map.get("-1,-1").keep = false;
  map.get("-1,1").keep = false;
  map.get("1,-1").keep = false;
  map.get("1,1").keep = false;

  return map;
}

describe("UT-07: pruneIsolatedGridCells", () => {
  it("should prune an isolated keep cell", () => {
    const frequencyMap = new Map([["0,0", makeCell(true)]]);

    pruneIsolatedGridCells(frequencyMap);

    expect(frequencyMap.get("0,0").keep).toBe(false);
  });

  it("should keep the center of a dense 3x3 cluster", () => {
    const frequencyMap = makeDenseCenterMap();

    pruneIsolatedGridCells(frequencyMap);

    expect(frequencyMap.get("0,0").keep).toBe(true);
  });

  it("should leave already-pruned cells unchanged", () => {
    const frequencyMap = new Map([["0,0", makeCell(false)]]);

    pruneIsolatedGridCells(frequencyMap);

    expect(frequencyMap.get("0,0").keep).toBe(false);
  });

  it("should respect a stricter custom isolation threshold", () => {
    const original = makeThresholdBoundaryMap();
    const defaultThreshold = cloneFrequencyMap(original);
    const stricterThreshold = cloneFrequencyMap(original);

    pruneIsolatedGridCells(defaultThreshold);
    pruneIsolatedGridCells(stricterThreshold, 4);

    expect(defaultThreshold.get("0,0").keep).toBe(true);
    expect(stricterThreshold.get("0,0").keep).toBe(false);
  });
});