/**
 * UT-15: 挙動保存リファクタのソースパターン検証
 *
 * R-9:  updateByBones の noSortBoneList をモジュール定数 NO_SORT_BONE_NAMES (Set) に昇格
 * R-15: gsCustomizeMaterial() シェーダー文字列内の死コードコメント削除
 * R-16: gs.js loadGS() の Promise 誤用修正（dead args 削除 + 例外伝播）
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
const gsSrc = readFileSync(resolve(root, "gvrm-format/gs.js"), "utf-8");

// updateByBones メソッド定義本体を抽出（コメント行を除く）
const updateByBonesFn =
  gvrmSrc.match(/^\s{2}updateByBones\s*\(\s*\)\s*\{[\s\S]*?\n  \}/m)?.[0] ?? "";

// gsCustomizeMaterial 関数本体を抽出
const gsCustomizeFn =
  gvrmSrc.match(/static gsCustomizeMaterial[\s\S]*?\n  \}\n/)?.[0] ?? "";

// -----------------------------------------------------------------------
// R-9: noSortBoneList のモジュール定数化
// -----------------------------------------------------------------------
describe("UT-15 R-9: noSortBoneList → NO_SORT_BONE_NAMES モジュール定数", () => {
  it("gvrm.js モジュールスコープに NO_SORT_BONE_NAMES が Set として定義されている", () => {
    expect(gvrmSrc).toMatch(/const\s+NO_SORT_BONE_NAMES\s*=\s*new\s+Set\s*\(/);
  });

  it("NO_SORT_BONE_NAMES は BONE_CONFIG から派生している", () => {
    expect(gvrmSrc).toMatch(/BONE_CONFIG\.torso\.names/);
    expect(gvrmSrc).toMatch(/BONE_CONFIG\.headTop\.names/);
    expect(gvrmSrc).toMatch(/BONE_CONFIG\.head\.names/);
  });

  it("updateByBones 内に noSortBoneList のローカル配列定義が存在しない", () => {
    expect(updateByBonesFn).not.toMatch(/const\s+noSortBoneList\s*=/);
  });

  it("updateByBones 内で NO_SORT_BONE_NAMES.has() を使用している", () => {
    expect(updateByBonesFn).toMatch(/NO_SORT_BONE_NAMES\.has\(/);
  });

  it("updateByBones 内で .includes() を使ったボーン名チェックが存在しない", () => {
    // noSortBoneList.includes(...) の旧パターンが残っていないこと
    expect(updateByBonesFn).not.toMatch(/noSortBoneList\.includes\(/);
  });
});

// -----------------------------------------------------------------------
// R-15: gsCustomizeMaterial シェーダー死コード削除
// -----------------------------------------------------------------------
describe("UT-15 R-15: gsCustomizeMaterial シェーダー死コード削除", () => {
  it("splatCenter 候補コメントが削除されている", () => {
    // 旧: // vec3 splatCenter = ( vec4(transformed, 1.0) ).xyz;
    expect(gsCustomizeFn).not.toMatch(/\/\/\s*vec3 splatCenter\s*=\s*\(\s*vec4\(transformed,\s*1\.0\)/);
  });

  it("'// GOOD' コメント行が削除されている", () => {
    expect(gsCustomizeFn).not.toMatch(/\/\/\s*GOOD/);
  });

  it("for debug コメントブロックが削除されている", () => {
    expect(gsCustomizeFn).not.toMatch(/\/\/\s*for debug/);
    expect(gsCustomizeFn).not.toMatch(/\/\/\s*Vrk\[0\]\[0\]\s*\*=\s*25\.0/);
  });

  it("TODO: via mat コメントブロックが削除されている", () => {
    expect(gsCustomizeFn).not.toMatch(/\/\/\s*TODO:\s*via mat/);
  });

  it("via quat の実装コードは残っている", () => {
    expect(gsCustomizeFn).toMatch(/\/\/\s*via quat/);
    expect(gsCustomizeFn).toMatch(/quatFromMat3\(/);
    expect(gsCustomizeFn).toMatch(/mat3FromQuat\(/);
  });
});

// -----------------------------------------------------------------------
// R-16: gs.js Promise 誤用修正
// -----------------------------------------------------------------------
describe("UT-15 R-16: gs.js loadGS Promise 誤用修正", () => {
  it("new Promise の executor に第2・第3引数（dead args）が存在しない", () => {
    // 旧: new Promise(async (resolve, reject) => { ... }, undefined, function ...)
    expect(gsSrc).not.toMatch(/new\s+Promise\s*\(.*?,\s*undefined/s);
    expect(gsSrc).not.toMatch(/new\s+Promise\s*\([^)]+,\s*function\s*\(/);
  });

  it("async executor パターン（new Promise(async ...)）が使われていない", () => {
    expect(gsSrc).not.toMatch(/new\s+Promise\s*\(\s*async\s*\(/);
  });

  it("reject(e) による例外伝播が実装されている", () => {
    expect(gsSrc).toMatch(/reject\s*\(\s*e\s*\)/);
  });

  it("try...catch で await を保護している", () => {
    expect(gsSrc).toMatch(/try\s*\{[\s\S]*?await\s+viewer\.addSplatScenes/);
    expect(gsSrc).toMatch(/catch\s*\(\s*e\s*\)\s*\{/);
  });

  it("loadingPromise が正常系で this を resolve している", () => {
    expect(gsSrc).toMatch(/resolve\s*\(\s*this\s*\)/);
  });
});
