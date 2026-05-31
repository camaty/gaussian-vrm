import { describe, expect, it } from "vitest";

import {
  BufferAttribute,
  DataTexture,
  Matrix4,
  Quaternion,
  Vector2,
  Vector3,
} from "../helpers/three-mock.js";

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

describe("UT-10: three-mock Vector helpers", () => {
  it("should support Vector3 arithmetic and normalization", () => {
    const vector = new Vector3(1, 2, 3)
      .add(new Vector3(1, 1, 1))
      .sub(new Vector3(0, 2, 0));

    expect(vector.x).toBe(2);
    expect(vector.y).toBe(1);
    expect(vector.z).toBe(4);

    const normalized = vector.clone().normalize();
    expect(normalized.length()).toBeCloseTo(1, 6);
  });

  it("should compute Vector2 distances", () => {
    const a = new Vector2(1, 1);
    const b = new Vector2(4, 5);

    expect(a.distanceTo(b)).toBeCloseTo(5, 6);
  });
});

describe("UT-10: three-mock Matrix4 and Quaternion", () => {
  it("should apply rotation and translation with Matrix4", () => {
    const transform = new Matrix4().makeRotationY(Math.PI / 2).setPosition(3, 4, 5);
    const actual = new Vector3(1, 0, 0).applyMatrix4(transform);

    expect(actual.x).toBeCloseTo(3, 6);
    expect(actual.y).toBeCloseTo(4, 6);
    expect(actual.z).toBeCloseTo(6, 6);
  });

  it("should invert a rotation-translation matrix", () => {
    const transform = new Matrix4().makeRotationY(Math.PI / 2).setPosition(3, 4, 5);
    const inverse = transform.clone().invert();
    const point = new Vector3(1, 2, 3);
    const restored = point.clone().applyMatrix4(transform).applyMatrix4(inverse);

    expect(restored.x).toBeCloseTo(point.x, 6);
    expect(restored.y).toBeCloseTo(point.y, 6);
    expect(restored.z).toBeCloseTo(point.z, 6);
  });

  it("should derive a quaternion from a rotation matrix using the mock's Y-axis sign convention", () => {
    const rotation = new Matrix4().makeRotationY(Math.PI / 2);
    const actual = new Quaternion().setFromRotationMatrix(rotation);
    const s = Math.sqrt(0.5);

    expectQuaternionEquivalent(actual, { x: 0, y: -s, z: 0, w: s });
  });

  it("should convert a row-major Z rotation matrix to a quaternion", () => {
    const theta = Math.PI / 3;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const actual = Quaternion.fromMat3RowMajor([
      c, -s, 0,
      s, c, 0,
      0, 0, 1,
    ]);

    expectQuaternionEquivalent(actual, {
      x: 0,
      y: 0,
      z: 0.5,
      w: Math.sqrt(3) / 2,
    });
  });
});

describe("UT-10: three-mock data containers", () => {
  it("should expose BufferAttribute component getters", () => {
    const attribute = new BufferAttribute(
      new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]),
      4
    );

    expect(attribute.count).toBe(2);
    expect(attribute.getX(1)).toBe(5);
    expect(attribute.getY(1)).toBe(6);
    expect(attribute.getZ(1)).toBe(7);
    expect(attribute.getW(1)).toBe(8);
  });

  it("should build a DataTexture-like image wrapper", () => {
    const data = new Float32Array([1, 2, 3, 4]);
    const texture = new DataTexture(data, 2, 2);

    expect(texture.image.data).toBe(data);
    expect(texture.image.width).toBe(2);
    expect(texture.image.height).toBe(2);
    expect(texture.needsUpdate).toBe(false);
  });
});