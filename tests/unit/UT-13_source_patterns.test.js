/**
 * UT-13: ソースコードパターン検証テスト
 *
 * ブラウザ/WebGL 依存コードのリファクタリング正確性を
 * ファイル内容の検査で保証します。各テストは「悪いパターン」が
 * 存在しないこと、または「良いパターン」が存在することを検証します。
 *
 * TDD サイクル:
 *   RED  → 悪いパターンがまだソースにある状態で FAIL
 *   GREEN → リファクタリング後に PASS
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

const gvrmSrc = readFileSync(resolve(root, "gvrm-format/gvrm.js"), "utf-8");
const preprocessSrc = readFileSync(
  resolve(root, "apps/preprocess/preprocess.js"),
  "utf-8"
);
const plySrc = readFileSync(resolve(root, "gvrm-format/ply.js"), "utf-8");

// -----------------------------------------------------------------------
// R-2: bestCi = bestCi 自己代入ノーオプ
// -----------------------------------------------------------------------
describe("UT-13 R-2: no-op self-assignment removed", () => {
  it("preprocess.js should not contain 'bestCi = bestCi'", () => {
    expect(preprocessSrc).not.toMatch(/bestCi\s*=\s*bestCi/);
  });
});

// -----------------------------------------------------------------------
// R-4: _traverseNodes が BONE_CONFIG を使い骨名をハードコードしない
// -----------------------------------------------------------------------
describe("UT-13 R-4: _traverseNodes uses BONE_CONFIG, not hardcoded bone names", () => {
  it("gvrm.js should not contain hardcoded 'J_Bip_L_Hand' in a types array literal", () => {
    // hardcoded types 配列 ["J_Bip_L_Hand", ...] が存在しないこと
    // BONE_CONFIG 由来に置き換えたことを検証
    expect(gvrmSrc).not.toMatch(
      /const\s+types\s*=\s*\[\s*["']J_Bip_L_Hand["']/
    );
  });

  it("gvrm.js should reference BONE_CONFIG near _traverseNodes", () => {
    // _boneNameSet が BONE_CONFIG から構築され、_traverseNodes 近傍に存在すること
    // (boneNameSet は関数宣言の直前で定義される)
    expect(gvrmSrc).toMatch(/_boneNameSet\s*=\s*new\s+Set/);
    expect(gvrmSrc).toMatch(/BONE_CONFIG.*flatMap/);
  });
});

// -----------------------------------------------------------------------
// R-5: デッドコード削除
// -----------------------------------------------------------------------
describe("UT-13 R-5: deprecated dead code removed", () => {
  it("gvrm.js should not contain commented-out sortSplatsByVertices", () => {
    expect(gvrmSrc).not.toMatch(/\/\/\s*static\s+sortSplatsByVertices/);
  });

  it("gvrm.js should not contain commented-out updateByVertices", () => {
    expect(gvrmSrc).not.toMatch(/\/\/\s*updateByVertices\s*\(\s*\)/);
  });

  it("gvrm.js should not contain the legacy relativePoses shim", () => {
    // if (extraData.splatRelativePoses === undefined) ... TODO: remove
    expect(gvrmSrc).not.toMatch(/splatRelativePoses\s*===\s*undefined/);
  });

  it("gvrm.js should not contain commented-out sortSplatsByVertices call", () => {
    // // const { sceneSplatIndices, vertexSceneMap } = GVRM.sortSplatsByVertices(...)
    expect(gvrmSrc).not.toMatch(/\/\/\s*const\s*\{.*vertexSceneMap.*\}\s*=\s*GVRM\.sortSplatsByVertices/);
  });
});

// -----------------------------------------------------------------------
// R-7: O(n²) splatIndices.concat → flat()
// -----------------------------------------------------------------------
describe("UT-13 R-7: O(n²) concat replaced with flat()", () => {
  it("gvrm.js updateExtraData should not use splatIndices.concat", () => {
    expect(gvrmSrc).not.toMatch(/splatIndices\s*=\s*splatIndices\.concat\s*\(/);
  });

  it("gvrm.js updateExtraData unused splatIndices variable removed", () => {
    // 未使用の splatIndices 変数宣言 (concat ループ) が存在しないこと
    // splatIndices は updateExtraData の下流で使われておらず、ループごと除去した
    expect(gvrmSrc).not.toMatch(/let\s+splatIndices\s*=\s*\[\s*\]/);
  });
});

// -----------------------------------------------------------------------
// P-7: Blob URL リーク — GVRM.load() で revokeObjectURL すること
// -----------------------------------------------------------------------
describe("UT-13 P-7: Blob URLs revoked in GVRM.load()", () => {
  it("gvrm.js GVRM.load should call URL.revokeObjectURL for vrmUrl", () => {
    // load 関数ブロック内に revokeObjectURL(vrmUrl) が存在すること
    const loadBlock = gvrmSrc.match(
      /static\s+async\s+load\s*\([\s\S]*?\n\s{2}\}/
    );
    expect(loadBlock).not.toBeNull();
    expect(loadBlock[0]).toMatch(/URL\.revokeObjectURL\s*\(\s*vrmUrl\s*\)/);
  });

  it("gvrm.js GVRM.load should call URL.revokeObjectURL for plyUrl", () => {
    const loadBlock = gvrmSrc.match(
      /static\s+async\s+load\s*\([\s\S]*?\n\s{2}\}/
    );
    expect(loadBlock).not.toBeNull();
    expect(loadBlock[0]).toMatch(/URL\.revokeObjectURL\s*\(\s*plyUrl\s*\)/);
  });
});

// -----------------------------------------------------------------------
// P-2: assignSplatsToBones の三重ループ内 Vector3 生成
// -----------------------------------------------------------------------
describe("UT-13 P-2: Vector3 allocations moved outside inner loop", () => {
  // assignSplatsToBones 関数のみを検査対象とする
  const fnMatch = preprocessSrc.match(
    /async function assignSplatsToBones[\s\S]*?(?=\nasync function )/
  );
  const assignFnSrc = fnMatch ? fnMatch[0] : "";

  it("assignSplatsToBones should pre-allocate _a, _b, _c with const before the outer loop", () => {
    expect(assignFnSrc).toMatch(/const\s+_a\s*=\s*new\s+THREE\.Vector3/);
    expect(assignFnSrc).toMatch(/const\s+_b\s*=\s*new\s+THREE\.Vector3/);
    expect(assignFnSrc).toMatch(/const\s+_c\s*=\s*new\s+THREE\.Vector3/);
  });

  it("assignSplatsToBones should not use 'let a = new THREE.Vector3()' inside loop body", () => {
    expect(assignFnSrc).not.toMatch(/let\s+a\s*=\s*new\s+THREE\.Vector3/);
    expect(assignFnSrc).not.toMatch(/let\s+b\s*=\s*new\s+THREE\.Vector3/);
    expect(assignFnSrc).not.toMatch(/let\s+c\s*=\s*new\s+THREE\.Vector3/);
  });

  it("assignSplatsToBones should not allocate Triangle inside the ci loop body", () => {
    expect(assignFnSrc).not.toMatch(/const\s+triangle\s*=\s*new\s+THREE\.Triangle/);
  });
});

// -----------------------------------------------------------------------
// P-5: PLY float-only ボディ解析を Float32Array ビューで最適化
// -----------------------------------------------------------------------
describe("UT-13 P-5: PLY float-only body uses Float32Array path", () => {
  it("ply.js should check if all properties are float (allFloat flag)", () => {
    // 全プロパティが float かどうかを判定するコードがあること
    expect(plySrc).toMatch(/every\s*\(\s*p\s*=>/);
  });

  it("ply.js should use Float32Array for float-only body parsing", () => {
    // float-only の場合に Float32Array を使うコードがあること
    expect(plySrc).toMatch(/new\s+Float32Array\s*\(\s*body(Buffer|)\s*\)/);
  });
});
