---
description: "Use when writing or editing source files in gvrm-format/ or apps/. Covers naming conventions, import ordering, coding style, and gaussian-vrm-specific code patterns."
applyTo: "{gvrm-format,apps}/**/*.js"
---

# Source Code Conventions (`gvrm-format/**/*.js`, `apps/**/*.js`)

## Naming

- **Files**: クラスファイルは PascalCase 対応の意味のある名前 (`gvrm.js`, `vrm.js`)。ユーティリティは小文字 + ハイフンまたは `_gl` サフィックス (`utils_gl.js`, `loader-utils.js`)
- **Classes**: PascalCase (`GVRM`, `VRMCharacter`, `GaussianSplatting`, `PLYParser`)
- **Variables / Functions**: camelCase
- **Constants**: UPPER_SNAKE_CASE または camelCase (既存コードに合わせる)
- 単一文字ループインデックス `i`, `j`, `k` は許容

## Import Style

- ES Modules (`import` / `export`)
- インポート順: 外部ライブラリ (`three`, `@pixiv/three-vrm`, `jszip`) → プロジェクト内部 (`./`, `../`)
- ブラウザ環境では `importmap` 経由で CDN URL を解決する（`index.html` 参照）
- 未使用インポートは削除する

## Formatting

- 2-space indent
- セミコロン: 付ける
- 引用符: 編集対象ファイルの既存スタイルに合わせる（既存コードは `'` と `"` が混在）
- 行末: LF

## Key Rules

- `null` は許容 — Three.js / WebGL グラフィクスコードでは `null` を頻繁に使う
- `undefined` と `null` の使い分けは既存コードのパターンに従う
- コンソールログ (`console.log`) はデバッグ用途で許容。本番コードに残す場合は意図的であること

## Architecture Patterns

### Never edit `lib/` directly

全ての変更は `gvrm-format/`, `apps/`, `main.js`, `build.js` に対して行う。`lib/` は `npm run build` でのみ生成される。

### GVRM ライブラリ境界

`gvrm-format/` はライブラリコアであり npm で配布される。以下を含めてはならない:
- アプリ固有のロジック (`apps/` に属するもの)
- `main.js` や `index.html` 固有の DOM 操作
- 前処理パイプライン (`apps/preprocess/`) の実装詳細

### Shader injection (gvrm.js)

`gsCustomizeMaterial()` でシェーダーを変更する場合:

```javascript
// 正しいパターン: onBeforeCompile フックで文字列置換
material.onBeforeCompile = (shader) => {
  // uniform を追加
  shader.uniforms.myTexture = { value: myDataTexture };
  // 頂点シェーダーに変数宣言を挿入
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    `
    uniform sampler2D myTexture;
    #include <begin_vertex>
    `
  );
};
```

- GS3D の内部 `#include` タグを置換ターゲットにする
- GS3D のバージョンが変わった場合は置換ターゲットが消えていないか確認すること

### Bone operations format

ボーン操作を追加・修正する場合は `assets/default.json` を編集し、`GVRMUtils.applyBoneOperations()` / `GVRMUtils.setPose()` で適用する:

```json
{
  "boneName": "leftUpperArm",
  "position": { "x": -0.04, "y": 0, "z": 0 },
  "rotation": { "x": 0, "y": 0, "z": 60 }
}
```

### GPU vs CPU preprocessing

スプラット割当は 2 実装を維持する:
- CPU: `preprocess.js:assignSplatsToBones()` / `assignSplatsToPoints()`
- GPU: `preprocess_gl.js:assignSplatsToBonesGL()` / `assignSplatsToPointsGL()`

アルゴリズムを変更する場合は両方を更新すること。
