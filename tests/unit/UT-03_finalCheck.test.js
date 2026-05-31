/**
 * UT-03: finalCheck 失敗判定ロジック
 *
 * 対応ソース: apps/preprocess/check.js L128, L141
 * 改善提案: docs/algorithm-improvements.md 改善 3
 * git log リスク: check.js は c878d11 から存在; 閾値の甘さは既知の問題
 */
import { describe, it, expect } from "vitest";
import { runFinalCheckPure, runFinalCheckImproved } from "../helpers/pure-logic.js";

// テスト用ユーティリティ: n 角度分の angleResults を作成
function makeAngleResults(nAngles, checksPerAngle, defaultDistance = 0.05) {
  return Array.from({ length: nAngles }, (_, i) => ({
    angle: -75 * Math.PI / 180 + i * 15 * Math.PI / 180,
    checks: Array.from({ length: checksPerAngle }, (_, j) => ({
      name: ["head", "left hand", "right hand", "left foot", "right foot"][j] ?? `check_${j}`,
      distance: defaultDistance,
    })),
  }));
}

describe("UT-03: runFinalCheckPure (現状アルゴリズム)", () => {
  it("should pass when all angles are within threshold", () => {
    const angleResults = makeAngleResults(11, 5, 0.05);
    const { passed, failedAngles } = runFinalCheckPure(angleResults, 0.15, 3);
    expect(passed).toBe(true);
    expect(failedAngles).toBe(0);
  });

  it("should fail when 3 or more angles exceed threshold", () => {
    const angleResults = makeAngleResults(11, 5, 0.05);
    // 3 角度の distance を閾値超えにする
    for (let i = 0; i < 3; i++) {
      angleResults[i].checks[0].distance = 0.99;
    }
    const { passed, failedAngles } = runFinalCheckPure(angleResults, 0.15, 3);
    expect(passed).toBe(false);
    expect(failedAngles).toBe(3);
  });

  it("should pass with exactly 2 failed angles (boundary condition)", () => {
    const angleResults = makeAngleResults(11, 5, 0.05);
    for (let i = 0; i < 2; i++) {
      angleResults[i].checks[0].distance = 0.99;
    }
    const { passed, failedAngles } = runFinalCheckPure(angleResults, 0.15, 3);
    expect(passed).toBe(true);  // 2 < 3 なので通過
    expect(failedAngles).toBe(2);
  });

  it("should fail an angle when any body part exceeds threshold", () => {
    const angleResults = makeAngleResults(11, 5, 0.05);
    // angle[0] の right_foot だけ閾値超え
    angleResults[0].checks[4].distance = 0.20;
    const { failedAngles } = runFinalCheckPure(angleResults, 0.15, 3);
    expect(failedAngles).toBe(1);
  });

  it("should fail an angle when any body part has null detection", () => {
    const angleResults = makeAngleResults(11, 5, 0.05);
    // angle[5] の head が検出失敗 (null)
    angleResults[5].checks[0].distance = null;
    const { failedAngles } = runFinalCheckPure(angleResults, 0.15, 3);
    expect(failedAngles).toBe(1);
  });

  it("should count correctly when multiple body parts fail in same angle", () => {
    const angleResults = makeAngleResults(11, 5, 0.05);
    // angle[0]: head と left_hand が両方失敗
    angleResults[0].checks[0].distance = 0.99;
    angleResults[0].checks[1].distance = 0.99;
    // 1 角度の失敗として計上される
    const { failedAngles } = runFinalCheckPure(angleResults, 0.15, 3);
    expect(failedAngles).toBe(1);
  });

  it("[LENIENCY] passes with up to 18% of views misaligned (known weakness)", () => {
    /**
     * 現状: 11 角度中 2 角度失敗（≈18%）まで許容する。
     * このテストは「許容範囲が広い」という既知の弱点を記録する。
     */
    const angleResults = makeAngleResults(11, 5, 0.05);
    for (let i = 0; i < 2; i++) {
      angleResults[i].checks.forEach(c => c.distance = 0.99); // 2 角度が全チェック失敗
    }
    const { passed } = runFinalCheckPure(angleResults, 0.15, 3);
    expect(passed).toBe(true);  // 現状は通過する (弱点)
  });
});

describe("UT-03: runFinalCheckImproved (改善版)", () => {
  it("should pass when all angles are within threshold", () => {
    const angleResults = makeAngleResults(11, 5, 0.05);
    const { passed } = runFinalCheckImproved(angleResults);
    expect(passed).toBe(true);
  });

  it("should fail with 2 or more failed angles (stricter than current)", () => {
    const angleResults = makeAngleResults(11, 5, 0.05);
    for (let i = 0; i < 2; i++) {
      angleResults[i].checks[0].distance = 0.99;
    }
    const { passed, failedAngles } = runFinalCheckImproved(angleResults);
    expect(passed).toBe(false);  // 改善版は 2 失敗で通らない
    expect(failedAngles).toBe(2);
  });

  it("should apply strict threshold to front-facing angles", () => {
    // 正面付近の angle index 3-7 は strictThresh=0.08 が適用される
    const angleResults = makeAngleResults(11, 5, 0.05);
    // angle[5] (0°正面): distance=0.09 は strictThresh(0.08)で失敗するが lenientThresh(0.15)では通る
    angleResults[5].checks[0].distance = 0.09;
    const { failedAngles } = runFinalCheckImproved(
      angleResults,
      new Set([3, 4, 5, 6, 7]),
      0.08,
      0.15,
      2
    );
    expect(failedAngles).toBe(1);
  });

  it("should apply lenient threshold to side-facing angles", () => {
    const angleResults = makeAngleResults(11, 5, 0.05);
    // angle[0] (±75°側面): distance=0.09 は lenientThresh(0.15)では通る
    angleResults[0].checks[0].distance = 0.09;
    const { failedAngles } = runFinalCheckImproved(
      angleResults,
      new Set([3, 4, 5, 6, 7]),
      0.08,
      0.15,
      2
    );
    expect(failedAngles).toBe(0);
  });

  it("should still handle null detections as failure", () => {
    const angleResults = makeAngleResults(11, 5, 0.05);
    angleResults[5].checks[0].distance = null;
    const { failedAngles } = runFinalCheckImproved(angleResults);
    expect(failedAngles).toBe(1);
  });
});
