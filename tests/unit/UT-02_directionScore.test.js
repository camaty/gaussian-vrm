/**
 * UT-02: direction score 計算 — 現状 vs 改善版
 *
 * 対応ソース: apps/preprocess/preprocess.js L595-L610 (findBestAngleInRange)
 * 改善提案: docs/algorithm-improvements.md 改善 2
 * git log リスク: preprocess.js は c878d11 から存在; 方向検出は最初から脆弱
 */
import { describe, it, expect } from "vitest";
import {
  computeDirectionScoreCurrent,
  computeDirectionScoreImproved,
} from "../helpers/pure-logic.js";

// テスト用 keypoints ファクトリ
function makeKeypoints(overrides = {}) {
  // BlazePose の 33 キーポイント (デフォルト: すべて null)
  const kps = Array(33).fill(null);
  for (const [idx, val] of Object.entries(overrides)) {
    kps[Number(idx)] = { x: val.x, y: val.y, score: val.score ?? 0.9 };
  }
  return kps;
}

describe("UT-02: computeDirectionScoreCurrent (現状アルゴリズム)", () => {
  it("should return positive score when facing forward (left_wrist.x > right_wrist.x)", () => {
    const kps = makeKeypoints({ 15: { x: 0.7, y: 0.5 }, 16: { x: 0.3, y: 0.5 } });
    expect(computeDirectionScoreCurrent(kps)).toBeGreaterThan(0);
  });

  it("should return negative score when facing backward", () => {
    const kps = makeKeypoints({ 15: { x: 0.3, y: 0.5 }, 16: { x: 0.7, y: 0.5 } });
    expect(computeDirectionScoreCurrent(kps)).toBeLessThan(0);
  });

  it("should return -Infinity when both wrists are missing", () => {
    const kps = makeKeypoints();
    expect(computeDirectionScoreCurrent(kps)).toBe(-Infinity);
  });

  it("should return -Infinity for empty keypoints", () => {
    expect(computeDirectionScoreCurrent([])).toBe(-Infinity);
    expect(computeDirectionScoreCurrent(null)).toBe(-Infinity);
  });

  it("should return -Infinity when only one wrist is detected", () => {
    const kps = makeKeypoints({ 15: { x: 0.7, y: 0.5 } });
    expect(computeDirectionScoreCurrent(kps)).toBe(-Infinity);
  });

  it("[WEAKNESS] score collapses to 0 when wrists are vertically aligned (arms down)", () => {
    /**
     * 腕を下げているポーズ: 左右 wrist が x=0.5 に近く, 差分が ~0 になる。
     * このテストは現状アルゴリズムの弱点を記録する。
     */
    const kps = makeKeypoints({
      15: { x: 0.52, y: 0.85 },  // left_wrist (腕を下げると x がほぼ中央)
      16: { x: 0.48, y: 0.85 },  // right_wrist
    });
    const score = computeDirectionScoreCurrent(kps);
    // スコアは 0.04 しかなく方向判別に弱い
    expect(Math.abs(score)).toBeLessThan(0.1);  // 弱点の記録
  });
});

describe("UT-02: computeDirectionScoreImproved (改善版)", () => {
  it("should return positive score when all keypoints indicate forward facing", () => {
    const kps = makeKeypoints({
      15: { x: 0.7, y: 0.5 },  // left_wrist
      16: { x: 0.3, y: 0.5 },  // right_wrist
      13: { x: 0.65, y: 0.45 }, // left_elbow
      14: { x: 0.35, y: 0.45 }, // right_elbow
      23: { x: 0.55, y: 0.6 },  // left_hip
      24: { x: 0.45, y: 0.6 },  // right_hip
    });
    expect(computeDirectionScoreImproved(kps)).toBeGreaterThan(0);
  });

  it("should still work with only hip keypoints when wrists are missing", () => {
    const kps = makeKeypoints({
      23: { x: 0.6, y: 0.6 },
      24: { x: 0.4, y: 0.6 },
    });
    const score = computeDirectionScoreImproved(kps);
    expect(score).toBeGreaterThan(0);  // hip で補完できる
  });

  it("should return -Infinity when all keypoints are missing", () => {
    expect(computeDirectionScoreImproved([])).toBe(-Infinity);
    expect(computeDirectionScoreImproved(null)).toBe(-Infinity);
  });

  it("should filter out low-confidence keypoints", () => {
    const kps = makeKeypoints({
      15: { x: 0.7, y: 0.5, score: 0.1 },  // 低 confidence
      16: { x: 0.3, y: 0.5, score: 0.1 },  // 低 confidence
      23: { x: 0.6, y: 0.6, score: 0.9 },  // high confidence
      24: { x: 0.4, y: 0.6, score: 0.9 },
    });
    const score = computeDirectionScoreImproved(kps, 0.3);
    // wrist が除外されて hip のみでスコア計算
    expect(score).toBeCloseTo((0.6 - 0.4) * 2 / 2, 5);  // (0.2 * weight2) / weight2 = 0.2
  });

  it("should give higher weight to hip than wrist", () => {
    // wrist は 正面を示すが弱く (差分0.1), hip は背面を示す (差分-0.5)
    // hip の重みが 2x なので背面スコアが勝つはず
    const kps = makeKeypoints({
      15: { x: 0.55, y: 0.5 },
      16: { x: 0.45, y: 0.5 },
      23: { x: 0.3, y: 0.6 },   // hip: 背面 (left.x < right.x)
      24: { x: 0.7, y: 0.6 },
    });
    // wrist: (0.55-0.45)*1.0 = 0.10
    // hip:   (0.3 -0.7)*2.0  = -0.80
    // total: (0.10 - 0.80) / (1.0 + 2.0) = -0.70/3 ≈ -0.233
    const score = computeDirectionScoreImproved(kps);
    expect(score).toBeLessThan(0);
    expect(score).toBeCloseTo(-0.233, 2);
  });

  it("improved score is more robust than current when wrists are down", () => {
    // 腕を下げているが hip は明確な方向を示す
    const kps = makeKeypoints({
      15: { x: 0.52, y: 0.85 },
      16: { x: 0.48, y: 0.85 },
      23: { x: 0.6, y: 0.6 },
      24: { x: 0.4, y: 0.6 },
    });
    const currentScore = computeDirectionScoreCurrent(kps);
    const improvedScore = computeDirectionScoreImproved(kps);
    // 改善版は現状より大きな絶対値（より強い方向信号）
    expect(Math.abs(improvedScore)).toBeGreaterThan(Math.abs(currentScore));
  });
});
