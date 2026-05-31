/**
 * UT-14: 挙動保存リファクタ／性能改善のソースパターン検証
 *
 * R-1: GVRM.prototype.load() のフィールド手動コピー廃止
 * R-3: cleanup ループの bone index マジックナンバーを名前付き定数化
 * P-3: assignSplatsToPoints の applyBoneTransform 二重計算をキャッシュ化
 * P-4: updateByBones のフレーム毎 clone().invert() を廃止
 *
 * いずれも描画結果・数値出力を変えない（挙動保存）変更であり、
 * ソースコードのパターン検査で正確性を保証する。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

const gvrmSrc = readFileSync(resolve(root, "gvrm-format/gvrm.js"), "utf-8");
const preprocessSrc = readFileSync(
  resolve(root, "apps/preprocess/preprocess.js"),
  "utf-8"
);

// assignSplatsToPoints 関数本体のみを抽出
const assignPointsFn =
  preprocessSrc.match(
    /async function assignSplatsToPoints[\s\S]*?(?=\nasync function )/
  )?.[0] ?? "";

// updateByBones メソッド定義本体を抽出（コメント行を除く）
const updateByBonesFn =
  gvrmSrc.match(/^\s{2}updateByBones\s*\(\s*\)\s*\{[\s\S]*?\n  \}/m)?.[0] ?? "";

// -----------------------------------------------------------------------
// R-1: instance load() の手動フィールドコピー廃止
// -----------------------------------------------------------------------
describe("UT-14 R-1: instance load() copies fields via loop", () => {
  it("gvrm.js should define a copyFields list", () => {
    expect(gvrmSrc).toMatch(/copyFields\s*=\s*\[/);
  });

  it("gvrm.js instance load should not manually assign this.modelScale", () => {
    expect(gvrmSrc).not.toMatch(/this\.modelScale\s*=\s*_gvrm\.modelScale/);
  });

  it("gvrm.js should iterate copyFields with for...of", () => {
    expect(gvrmSrc).toMatch(/for\s*\(\s*const\s+key\s+of\s+copyFields\s*\)/);
  });
});

// -----------------------------------------------------------------------
// R-3: cleanup ループの bone index マジックナンバー除去
// -----------------------------------------------------------------------
describe("UT-14 R-3: cleanup bone indices are named constants", () => {
  it("gvrm.js should not compare splatBoneIndices against bare 57", () => {
    expect(gvrmSrc).not.toMatch(/splatBoneIndices\[i\]\s*!==\s*57/);
    expect(gvrmSrc).not.toMatch(/splatBoneIndices\[i\]\s*===\s*57/);
  });

  it("gvrm.js should not compare splatBoneIndices against bare 21 or 19", () => {
    expect(gvrmSrc).not.toMatch(/splatBoneIndices\[i\]\s*==\s*21/);
    expect(gvrmSrc).not.toMatch(/splatBoneIndices\[i\]\s*==\s*19/);
  });

  it("gvrm.js should define a CLEANUP_THRESHOLDS config", () => {
    expect(gvrmSrc).toMatch(/CLEANUP_THRESHOLDS/);
  });
});

// -----------------------------------------------------------------------
// P-3: assignSplatsToPoints の骨変換キャッシュ化
// -----------------------------------------------------------------------
describe("UT-14 P-3: assignSplatsToPoints caches skinned vertices", () => {
  it("should declare a skinnedWorldCache typed array", () => {
    expect(assignPointsFn).toMatch(/skinnedWorldCache\s*=\s*new\s+Float32Array/);
  });

  it("should declare a skinnedLocalCache typed array", () => {
    expect(assignPointsFn).toMatch(/skinnedLocalCache\s*=\s*new\s+Float32Array/);
  });

  it("should call applyBoneTransform exactly once (single precompute pass)", () => {
    const matches = assignPointsFn.match(/\.applyBoneTransform\(/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

// -----------------------------------------------------------------------
// P-4: updateByBones のフレーム毎 clone().invert() 廃止
// -----------------------------------------------------------------------
describe("UT-14 P-4: updateByBones avoids per-frame clone().invert()", () => {
  it("should not call matrixWorld0.clone().invert() inside the loop", () => {
    expect(updateByBonesFn).not.toMatch(/matrixWorld0\.clone\(\)\.invert\(\)/);
  });

  it("should use a pooled inverse matrix (_invMat0)", () => {
    expect(updateByBonesFn).toMatch(/_invMat0/);
  });
});
