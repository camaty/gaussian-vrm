import { describe, expect, it } from "vitest";

import { quatFromMat3ColMajor } from "../helpers/pure-logic.js";
import { Quaternion } from "../helpers/three-mock.js";

function expectQuaternionEquivalent(actual, expected, digits = 6) {
  const dot =
    actual.x * expected.x +
    actual.y * expected.y +
    actual.z * expected.z +
    actual.w * expected.w;
  const sign = dot < 0 ? -1 : 1;

  expect(actual.x * sign).toBeCloseTo(expected.x, digits);
  expect(actual.y * sign).toBeCloseTo(expected.y, digits);
  expect(actual.z * sign).toBeCloseTo(expected.z, digits);
  expect(actual.w * sign).toBeCloseTo(expected.w, digits);
}

describe("UT-05: quatFromMat3ColMajor", () => {
  it("should return the identity quaternion for an identity matrix", () => {
    const actual = quatFromMat3ColMajor([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]);

    expectQuaternionEquivalent(actual, { x: 0, y: 0, z: 0, w: 1 });
  });

  it("should convert a 90-degree Y rotation matrix", () => {
    const s = Math.sqrt(0.5);
    const actual = quatFromMat3ColMajor([
      0, 0, -1,
      0, 1, 0,
      1, 0, 0,
    ]);

    expectQuaternionEquivalent(actual, { x: 0, y: s, z: 0, w: s });
  });

  it("should handle the negative-trace branch where X is dominant", () => {
    const actual = quatFromMat3ColMajor([
      1, 0, 0,
      0, -1, 0,
      0, 0, -1,
    ]);

    expectQuaternionEquivalent(actual, { x: 1, y: 0, z: 0, w: 0 });
  });

  it("should handle the negative-trace branch where Y is dominant", () => {
    const actual = quatFromMat3ColMajor([
      -1, 0, 0,
      0, 1, 0,
      0, 0, -1,
    ]);

    expectQuaternionEquivalent(actual, { x: 0, y: 1, z: 0, w: 0 });
  });

  it("should match the row-major quaternion conversion in three-mock", () => {
    const theta = Math.PI / 3;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const actual = quatFromMat3ColMajor([
      c, s, 0,
      -s, c, 0,
      0, 0, 1,
    ]);
    const expected = Quaternion.fromMat3RowMajor([
      c, -s, 0,
      s, c, 0,
      0, 0, 1,
    ]);

    expectQuaternionEquivalent(actual, expected);

    const length = Math.sqrt(
      actual.x * actual.x +
      actual.y * actual.y +
      actual.z * actual.z +
      actual.w * actual.w
    );
    expect(length).toBeCloseTo(1, 6);
  });
});