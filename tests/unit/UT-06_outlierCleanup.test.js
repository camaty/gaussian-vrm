import { describe, expect, it } from "vitest";

import {
  applyOutlierCleanup,
  isOutlierSplat,
} from "../helpers/pure-logic.js";

describe("UT-06: isOutlierSplat", () => {
  it("should use the default threshold for non-special bones", () => {
    expect(isOutlierSplat(10, 0.2)).toBe(false);
    expect(isOutlierSplat(10, 0.20001)).toBe(true);
  });

  it("should apply special thresholds for head and feet", () => {
    expect(isOutlierSplat(57, 0.29)).toBe(false);
    expect(isOutlierSplat(57, 0.31)).toBe(true);
    expect(isOutlierSplat(21, 0.1)).toBe(false);
    expect(isOutlierSplat(21, 0.11)).toBe(true);
    expect(isOutlierSplat(19, 0.09)).toBe(false);
    expect(isOutlierSplat(19, 0.11)).toBe(true);
  });

  it("should respect a custom threshold table", () => {
    const thresholds = {
      head: { boneIndex: 8, threshold: 0.4 },
      leftFoot: { boneIndex: 2, threshold: 0.05 },
      rightFoot: { boneIndex: 3, threshold: 0.05 },
      default: { threshold: 0.5 },
    };

    expect(isOutlierSplat(8, 0.35, thresholds)).toBe(false);
    expect(isOutlierSplat(8, 0.41, thresholds)).toBe(true);
    expect(isOutlierSplat(4, 0.49, thresholds)).toBe(false);
    expect(isOutlierSplat(4, 0.51, thresholds)).toBe(true);
  });
});

describe("UT-06: applyOutlierCleanup", () => {
  it("should zero alpha only for splats beyond each bone threshold", () => {
    const splatRelativePoses = new Float32Array([
      0.0, 0.0, 0.0,
      0.25, 0.0, 0.0,
      0.12, 0.0, 0.0,
      0.29, 0.0, 0.0,
    ]);
    const splatBoneIndices = [10, 10, 21, 57];
    const colors = new Float32Array([
      1, 2, 3, 0.8,
      4, 5, 6, 0.7,
      7, 8, 9, 0.6,
      10, 11, 12, 0.5,
    ]);

    const removed = applyOutlierCleanup(splatRelativePoses, splatBoneIndices, colors);

    expect(removed).toBe(2);
    expect(Array.from(colors)).toEqual([
      1, 2, 3, 0.800000011920929,
      4, 5, 6, 0,
      7, 8, 9, 0,
      10, 11, 12, 0.5,
    ]);
  });

  it("should honor custom thresholds across a batch", () => {
    const splatRelativePoses = new Float32Array([
      0.3, 0.0, 0.0,
      0.06, 0.0, 0.0,
    ]);
    const splatBoneIndices = [4, 2];
    const colors = new Float32Array([
      0, 0, 0, 1,
      0, 0, 0, 1,
    ]);
    const thresholds = {
      head: { boneIndex: 8, threshold: 0.1 },
      leftFoot: { boneIndex: 2, threshold: 0.07 },
      rightFoot: { boneIndex: 3, threshold: 0.07 },
      default: { threshold: 0.4 },
    };

    const removed = applyOutlierCleanup(
      splatRelativePoses,
      splatBoneIndices,
      colors,
      thresholds
    );

    expect(removed).toBe(0);
    expect(Array.from(colors)).toEqual([
      0, 0, 0, 1,
      0, 0, 0, 1,
    ]);
  });
});