/**
 * UT-11 — gvrm-format/utils.js 直接インポートテスト
 *
 * `three` エイリアスで three-mock.js を差し替えることで
 * ソースファイルを直接インポートし、実際の v8 カバレッジを計上する。
 * テスト対象: colors, BONE_CONFIG, addChannels, createDataTexture
 */

import { describe, it, expect } from "vitest";
import {
  colors,
  BONE_CONFIG,
  addChannels,
  createDataTexture,
} from "@gvrm/utils.js";

// ---------------------------------------------------------------------------
// colors
// ---------------------------------------------------------------------------

describe("colors (source)", () => {
  it("exports exactly 14 colors", () => {
    expect(colors).toHaveLength(14);
  });

  it("first color is [255, 222, 62] (yellow)", () => {
    expect(colors[0]).toEqual([255, 222, 62]);
  });

  it("each entry is an [R, G, B] triple with values 0–255", () => {
    for (const [r, g, b] of colors) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(255);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(255);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    }
  });

  it("all 14 colors are distinct (no duplicates)", () => {
    const keys = colors.map((c) => c.join(","));
    const unique = new Set(keys);
    expect(unique.size).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// BONE_CONFIG
// ---------------------------------------------------------------------------

describe("BONE_CONFIG (source)", () => {
  it("has exactly 5 bone groups: arm, leg, torso, headTop, head", () => {
    expect(Object.keys(BONE_CONFIG).sort()).toEqual([
      "arm",
      "head",
      "headTop",
      "leg",
      "torso",
    ]);
  });

  it("arm group contains all 4 VRM arm bone names", () => {
    expect(BONE_CONFIG.arm.names).toHaveLength(4);
    expect(BONE_CONFIG.arm.names).toContain("J_Bip_L_Hand");
    expect(BONE_CONFIG.arm.names).toContain("J_Bip_R_Hand");
    expect(BONE_CONFIG.arm.names).toContain("J_Bip_L_LowerArm");
    expect(BONE_CONFIG.arm.names).toContain("J_Bip_R_LowerArm");
  });

  it("each group has a positive numeric radius", () => {
    for (const [key, config] of Object.entries(BONE_CONFIG)) {
      expect(typeof config.radius, key).toBe("number");
      expect(config.radius, key).toBeGreaterThan(0);
    }
  });

  it("each group has numeric scale.x and scale.z", () => {
    for (const [key, config] of Object.entries(BONE_CONFIG)) {
      expect(typeof config.scale.x, key).toBe("number");
      expect(typeof config.scale.z, key).toBe("number");
    }
  });

  it("torso has larger scale.x than arm (torso is wider)", () => {
    expect(BONE_CONFIG.torso.scale.x).toBeGreaterThan(BONE_CONFIG.arm.scale.x);
  });
});

// ---------------------------------------------------------------------------
// addChannels  (same logic as UT-08, but imported from source)
// ---------------------------------------------------------------------------

describe("addChannels (source import)", () => {
  it("N=0: RGBA→RGBA passthrough — all four channels copied", () => {
    const from = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const to = new Float32Array(4);
    addChannels(from, to, 1, 0);
    expect(to[0]).toBeCloseTo(0.1);
    expect(to[1]).toBeCloseTo(0.2);
    expect(to[2]).toBeCloseTo(0.3);
    expect(to[3]).toBeCloseTo(0.4);
  });

  it("N=1: RGB→RGBA — first 3 channels copied, alpha forced to 1", () => {
    const from = new Float32Array([0.1, 0.2, 0.3]);
    const to = new Float32Array(4);
    addChannels(from, to, 1, 1);
    expect(to[0]).toBeCloseTo(0.1);
    expect(to[1]).toBeCloseTo(0.2);
    expect(to[2]).toBeCloseTo(0.3);
    expect(to[3]).toBeCloseTo(1.0);
  });

  it("N=4: all channels forced to 1", () => {
    const from = new Float32Array([0.5]);
    const to = new Float32Array(4);
    addChannels(from, to, 1, 4);
    expect(Array.from(to)).toEqual([1.0, 1.0, 1.0, 1.0]);
  });

  it("count=0: no-op, destination unchanged", () => {
    const from = new Float32Array([0.9, 0.8, 0.7, 0.6]);
    const to = new Float32Array([0.0, 0.0, 0.0, 0.0]);
    addChannels(from, to, 0, 0);
    expect(Array.from(to)).toEqual([0.0, 0.0, 0.0, 0.0]);
  });
});

// ---------------------------------------------------------------------------
// createDataTexture
// ---------------------------------------------------------------------------

describe("createDataTexture (source import)", () => {
  it("sets needsUpdate=true on the returned DataTexture", () => {
    const tex = createDataTexture(new Float32Array(4), 1, 1);
    expect(tex.needsUpdate).toBe(true);
  });

  it("image dimensions match the arguments", () => {
    const data = new Float32Array(16);
    const tex = createDataTexture(data, 4, 1);
    expect(tex.image.width).toBe(4);
    expect(tex.image.height).toBe(1);
  });

  it("image.data is the same reference passed in", () => {
    const data = new Float32Array([1, 2, 3, 4]);
    const tex = createDataTexture(data, 2, 1);
    expect(tex.image.data).toBe(data);
  });
});
