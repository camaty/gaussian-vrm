import { describe, expect, it } from "vitest";

import { addChannels } from "../helpers/pure-logic.js";

describe("UT-08: addChannels", () => {
  it("should copy RGBA input unchanged when N=0", () => {
    const fromArray = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const toArray = new Float32Array(4);

    addChannels(fromArray, toArray, 1, 0);

    expect(Array.from(toArray)).toEqual([
      0.10000000149011612,
      0.20000000298023224,
      0.30000001192092896,
      0.4000000059604645,
    ]);
  });

  it("should append alpha=1 when converting RGB to RGBA", () => {
    const fromArray = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const toArray = new Float32Array(8);

    addChannels(fromArray, toArray, 2, 1);

    expect(Array.from(toArray)).toEqual([
      0.10000000149011612,
      0.20000000298023224,
      0.30000001192092896,
      1,
      0.4000000059604645,
      0.5,
      0.6000000238418579,
      1,
    ]);
  });

  it("should append B and A channels when converting RG to RGBA", () => {
    const fromArray = new Float32Array([0.25, 0.75, 0.4, 0.6]);
    const toArray = new Float32Array(8);

    addChannels(fromArray, toArray, 2, 2);

    expect(Array.from(toArray)).toEqual([
      0.25,
      0.75,
      1,
      1,
      0.4000000059604645,
      0.6000000238418579,
      1,
      1,
    ]);
  });

  it("should fill the last three channels with 1 when converting a single channel", () => {
    const fromArray = new Float32Array([0.2, 0.8]);
    const toArray = new Float32Array(8);

    addChannels(fromArray, toArray, 2, 3);

    expect(Array.from(toArray)).toEqual([
      0.20000000298023224,
      1,
      1,
      1,
      0.800000011920929,
      1,
      1,
      1,
    ]);
  });

  it("should fill all channels with 1 when N is greater than 3", () => {
    const toArray = new Float32Array(8);

    addChannels(new Float32Array(0), toArray, 2, 4);

    expect(Array.from(toArray)).toEqual([
      1, 1, 1, 1,
      1, 1, 1, 1,
    ]);
  });

  it("should leave the destination untouched when count is 0", () => {
    const toArray = new Float32Array([9, 8, 7, 6]);

    addChannels(new Float32Array(0), toArray, 0, 1);

    expect(Array.from(toArray)).toEqual([9, 8, 7, 6]);
  });
});