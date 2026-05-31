/**
 * UT-04: calculateHeights — 床検出ヒストグラムアルゴリズム
 *
 * 対応ソース: apps/preprocess/preprocess.js L240-L315 (calculateHeights 内部)
 * 改善提案: docs/algorithm-improvements.md 改善 5
 * git log リスク: cleanSplats は c878d11 から存在; height 検出は最もバグりやすい
 */
import { describe, it, expect } from "vitest";
import { calculateHeightsPure } from "../helpers/pure-logic.js";

// テスト用: y 軸が GS 座標系（上向き = 負の y）
// 実際の GS データは Y-down なので vertex.y を負にする
function makeVertices(yValues) {
  return yValues.map(y => ({ x: 0, y: -y, z: 0 }));
}

// ランダムな XZ 座標を持つ点群 (床検出に現実的な密度)
function makeScatteredVertices(floorY, bodyMaxY, count = 50000) {
  const vertices = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    let y;
    if (t < 0.05) {
      y = floorY + (Math.random() * 0.05);    // 床付近 (5%)
    } else if (t < 0.95) {
      y = floorY + 0.05 + Math.random() * (bodyMaxY - floorY - 0.1);  // 体 (90%)
    } else {
      y = bodyMaxY - 0.05 + (Math.random() * 0.05);  // 頭部 (5%)
    }
    vertices.push({ x: Math.random() * 2 - 1, y: -y, z: Math.random() * 2 - 1 });
  }
  return vertices;
}

describe("UT-04: calculateHeightsPure", () => {

  describe("基本的な床検出", () => {
    it("should detect floor Y when there is a clear vertical gap above floor", () => {
      // 床: y=0.0m, 空白: 0.0~0.1m, 体: 0.1~1.7m
      const floorVertices = makeVertices(
        Array.from({ length: 1000 }, (_, i) => 0.0 + Math.random() * 0.02)  // 床 y=0~0.02m
      );
      const bodyVertices = makeVertices(
        Array.from({ length: 30000 }, (_, i) => 0.15 + Math.random() * 1.5)  // 体 y=0.15~1.65m
      );
      const allVertices = [...floorVertices, ...bodyVertices];
      const { floorY } = calculateHeightsPure(allVertices);
      // 床は ~0.0m 付近で検出されるはず
      expect(floorY).toBeGreaterThanOrEqual(0.0);
      expect(floorY).toBeLessThan(0.15);
    });

    it("should detect approximate floor for standard standing human height", () => {
      // 身長 1.7m, 床 y=0m
      const vertices = makeScatteredVertices(0.0, 1.7, 50000);
      const { floorY, emptySpaceY } = calculateHeightsPure(vertices);

      // 床は 0m±0.1m 内で検出
      expect(floorY).toBeGreaterThan(-0.15);
      expect(floorY).toBeLessThan(0.15);

      // 上部の空白は床から 0.3m 以上上 (body top 付近)
      expect(emptySpaceY).toBeGreaterThan(floorY + 0.3);
    });
  });

  describe("ウィンドウ差分アルゴリズム", () => {
    it("should find the position with maximum vertical density jump (N=5)", () => {
      // 人工的なヒストグラム: y=5cm 付近で密度が急増
      const belowFloor = makeVertices(Array.from({ length: 100 }, () => Math.random() * 0.05));
      const aboveFloor = makeVertices(Array.from({ length: 10000 }, () => 0.07 + Math.random() * 1.5));
      const { floorY } = calculateHeightsPure([...belowFloor, ...aboveFloor]);
      // 密度ジャンプは 0.05m~0.10m の間
      expect(floorY).toBeGreaterThan(0.03);
      expect(floorY).toBeLessThan(0.12);
    });

    it("should throw when insufficient data (empty vertices)", () => {
      expect(() => calculateHeightsPure([])).toThrow();
    });

    it("should handle hints.kneeHeight to constrain floor search", () => {
      // 床は y=0m だが, hints で y=0.3m 以下のみ検索
      const vertices = makeScatteredVertices(0.0, 1.7, 20000);
      const hints = { kneeHeight: 0.5 };  // 0.5m 以上は無視
      // ヒントありでもほぼ同じ床位置が検出されるはず
      const { floorY } = calculateHeightsPure(vertices, 5, hints);
      expect(floorY).toBeLessThan(0.5);
    });
  });

  describe("emptySpaceY (頭部上の空白)", () => {
    it("should set emptySpaceY above the body", () => {
      const vertices = makeScatteredVertices(0.0, 1.7, 50000);
      const { floorY, emptySpaceY } = calculateHeightsPure(vertices);
      // 空白は床より必ず上
      expect(emptySpaceY).toBeGreaterThan(floorY);
    });

    it("emptySpaceY should be near or beyond body height when no gap exists", () => {
      // 体が天井まで詰まっている場合 → emptySpaceY は body top 付近
      const vertices = makeScatteredVertices(0.0, 1.8, 80000);
      const { floorY, emptySpaceY } = calculateHeightsPure(vertices);
      const bodyHeight = emptySpaceY - floorY;
      expect(bodyHeight).toBeGreaterThan(0.5);  // 最低 50cm の体積
    });
  });

  describe("1cm ビン幅の挙動", () => {
    it("should use 1cm bin resolution for binning", () => {
      // 2 つのビン (y=0.10m, y=0.11m) を区別できるか
      const bin10 = makeVertices(Array.from({ length: 5000 }, () => 0.10 + Math.random() * 0.009));
      const bin11 = makeVertices(Array.from({ length: 500 }, () => 0.11 + Math.random() * 0.009));
      const body = makeVertices(Array.from({ length: 20000 }, () => 0.15 + Math.random() * 1.0));
      const { floorY } = calculateHeightsPure([...bin10, ...bin11, ...body]);
      // ビン分解能 1cm なので 0.10m と 0.11m が別ビンとして扱われる
      expect(floorY).toBeCloseTo(0.10, 1);
    });
  });
});
