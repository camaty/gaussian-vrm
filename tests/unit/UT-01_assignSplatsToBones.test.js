/**
 * UT-01: assignSplatsBonesPure — fast mode の精度テスト
 *
 * 対応ソース: apps/preprocess/preprocess.js L14-L84 (assignSplatsToBones)
 * 改善提案: docs/algorithm-improvements.md 改善 1
 * git log リスク: fast mode は初期 commit から存在し、複数回 "Fix" が入った (c878d11)
 */
import { describe, it, expect } from "vitest";
import { assignSplatsBonesPure } from "../helpers/pure-logic.js";

// テスト用ユーティリティ: 各スプラットとカプセルの距離を計算するモック
function makeDistanceFn(splatPositions, capsulePositions) {
  return (splatIdx, capsuleIdx) => {
    const s = splatPositions[splatIdx];
    const c = capsulePositions[capsuleIdx];
    return Math.sqrt((s[0]-c[0])**2 + (s[1]-c[1])**2 + (s[2]-c[2])**2);
  };
}

describe("UT-01: assignSplatsBonesPure", () => {

  describe("fast=false (全スプラット計算)", () => {
    it("should assign each splat to the nearest capsule bone", () => {
      // 3 splats, 2 capsules
      // splat0 は capsule0 に近い, splat1/2 は capsule1 に近い
      const splatPos = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.1, 0.0, 0.0]];
      const capsulePos = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]];
      const capsuleBoneIndex = [10, 20];
      const getDist = makeDistanceFn(splatPos, capsulePos);

      const result = assignSplatsBonesPure(3, getDist, 2, capsuleBoneIndex, false);
      expect(result).toEqual([10, 20, 20]);
    });

    it("should handle single capsule (all splats get same bone)", () => {
      const splatPos = [[0,0,0],[10,0,0],[20,0,0]];
      const capsulePos = [[5,0,0]];
      const capsuleBoneIndex = [42];
      const getDist = makeDistanceFn(splatPos, capsulePos);

      const result = assignSplatsBonesPure(3, getDist, 1, capsuleBoneIndex, false);
      expect(result).toEqual([42, 42, 42]);
    });

    it("should return empty array for 0 splats", () => {
      const getDist = () => 0;
      const result = assignSplatsBonesPure(0, getDist, 1, [5], false);
      expect(result).toEqual([]);
    });

    it("should assign correct bone when capsules are equidistant (first wins)", () => {
      const splatPos = [[0.5, 0, 0]];
      const capsulePos = [[0, 0, 0], [1, 0, 0]];
      const getDist = makeDistanceFn(splatPos, capsulePos);
      const result = assignSplatsBonesPure(1, getDist, 2, [0, 1], false);
      // 両方同じ距離 0.5 → 最初のカプセル (index 0) が選ばれる
      expect(result).toEqual([0]);
    });
  });

  describe("fast=true (10 個に 1 個だけ計算)", () => {
    it("should copy previous bone for indices i % 10 !== 0", () => {
      // 11 splats: index 0, 10 だけ計算, それ以外は前値コピー
      // splat0 → bone 10, splat10 → bone 20 (異なるボーン位置)
      const capsuleBoneIndex = [10, 20];

      const splatPositions = Array.from({ length: 11 }, (_, i) => {
        // i=0-9: capsule0(bone10)に近い, i=10: capsule1(bone20)に近い
        return i < 10 ? [0, 0, 0] : [10, 0, 0];
      });
      const capsulePositions = [[0, 0, 0], [10, 0, 0]];
      const getDist = makeDistanceFn(splatPositions, capsulePositions);

      const result = assignSplatsBonesPure(11, getDist, 2, capsuleBoneIndex, true);

      // i=0 → bone 10 (計算)
      expect(result[0]).toBe(10);
      // i=1-9 → 前値コピー → bone 10
      for (let i = 1; i <= 9; i++) {
        expect(result[i]).toBe(10);
      }
      // i=10 → bone 20 (計算)
      expect(result[10]).toBe(20);
    });

    it("[PRECISION BUG] fast mode misassigns splats near bone boundaries", () => {
      /**
       * 精度バグの記録テスト:
       * splat 1-9 が capsule1(bone20) の近くにあっても, fast mode では
       * i=0 のコピーで bone10 が割り当てられてしまう。
       * このテストは現状の動作（バグあり）を記録する。
       * 改善 1 実装後に正しい動作に変更する予定。
       */
      const capsuleBoneIndex = [10, 20];
      const splatPositions = [
        [0, 0, 0],   // i=0: bone10 に近い (計算される)
        [10, 0, 0],  // i=1: bone20 に近いが fast=true でスキップ
        [10, 0, 0],  // i=2: bone20 に近いが fast=true でスキップ
      ];
      const capsulePositions = [[0, 0, 0], [10, 0, 0]];
      const getDist = makeDistanceFn(splatPositions, capsulePositions);

      const result = assignSplatsBonesPure(3, getDist, 2, capsuleBoneIndex, true);

      // fast=true では i=1,2 がスキップされ i=0 の bone10 がコピーされる
      // 本来は bone20 が正しいが現状は bone10 になる (バグ)
      expect(result[1]).toBe(10); // 現状の動作: 誤り (本来 20 が正しい)
      expect(result[2]).toBe(10); // 現状の動作: 誤り (本来 20 が正しい)
    });
  });

  describe("capsuleBoneIndex マッピング", () => {
    it("should correctly map capsule indices to bone indices", () => {
      const splatPos = [[0,0,0],[1,0,0],[2,0,0]];
      const capsulePos = [[0,0,0],[1,0,0],[2,0,0]];
      // capsule 0→bone 100, 1→bone 200, 2→bone 300
      const capsuleBoneIndex = [100, 200, 300];
      const getDist = makeDistanceFn(splatPos, capsulePos);

      const result = assignSplatsBonesPure(3, getDist, 3, capsuleBoneIndex, false);
      expect(result).toEqual([100, 200, 300]);
    });
  });
});
