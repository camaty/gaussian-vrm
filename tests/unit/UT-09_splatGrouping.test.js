import { describe, expect, it } from "vitest";

import {
  sortSplatsByBonesPure,
  updateExtraDataPure,
} from "../helpers/pure-logic.js";

describe("UT-09: sortSplatsByBonesPure", () => {
  it("should group splats by first-seen bone order", () => {
    const extraData = {
      splatBoneIndices: [7, 3, 7, 5, 3],
      splatVertexIndices: [70, 30, 71, 50, 31],
      splatRelativePoses: [
        0, 0, 0,
        1, 1, 1,
        2, 2, 2,
        3, 3, 3,
        4, 4, 4,
      ],
    };

    const { sceneSplatIndices, boneSceneMap } = sortSplatsByBonesPure(extraData);

    expect(sceneSplatIndices).toEqual({
      0: [0, 2],
      1: [1, 4],
      2: [3],
    });
    expect(boneSceneMap).toEqual({
      3: 1,
      5: 2,
      7: 0,
    });
  });

  it("should create a single scene when all splats share one bone", () => {
    const extraData = {
      splatBoneIndices: [9, 9, 9],
      splatVertexIndices: [0, 1, 2],
      splatRelativePoses: [0, 0, 0, 1, 1, 1, 2, 2, 2],
    };

    const { sceneSplatIndices, boneSceneMap } = sortSplatsByBonesPure(extraData);

    expect(sceneSplatIndices).toEqual({ 0: [0, 1, 2] });
    expect(boneSceneMap).toEqual({ 9: 0 });
  });
});

describe("UT-09: updateExtraDataPure", () => {
  it("should reorder all aligned arrays by scene order", () => {
    const extraData = {
      splatVertexIndices: [70, 30, 71, 50],
      splatBoneIndices: [7, 3, 7, 5],
      splatRelativePoses: [
        0, 0, 0,
        1, 1, 1,
        2, 2, 2,
        3, 3, 3,
      ],
    };

    updateExtraDataPure(extraData, {
      0: [1, 3],
      1: [0, 2],
    });

    expect(extraData.splatVertexIndices).toEqual([30, 50, 70, 71]);
    expect(extraData.splatBoneIndices).toEqual([3, 5, 7, 7]);
    expect(extraData.splatRelativePoses).toEqual([
      1, 1, 1,
      3, 3, 3,
      0, 0, 0,
      2, 2, 2,
    ]);
  });

  it("should clear arrays when no scene splat indices are provided", () => {
    const extraData = {
      splatVertexIndices: [1, 2],
      splatBoneIndices: [3, 4],
      splatRelativePoses: [0, 0, 0, 1, 1, 1],
    };

    updateExtraDataPure(extraData, {});

    expect(extraData.splatVertexIndices).toEqual([]);
    expect(extraData.splatBoneIndices).toEqual([]);
    expect(extraData.splatRelativePoses).toEqual([]);
  });
});