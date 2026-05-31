---
name: shader-skinning
description: "GVRM のカスタムシェーダー注入とスケルタルアニメーション実装。VRM ボーン変換を Gaussian Splat の頂点シェーダーへ供給してリアルタイムアニメーションを実現する仕組みを扱う。Use when implementing or debugging skinned splat animation, modifying the shader injection in gsCustomizeMaterial(), adding new GPU textures, or understanding bone-to-splat transform pipelines. Triggers: shader, skinning, gsCustomizeMaterial, bone texture, splat animation, vertex shader, covariance rotation, uniform, onBeforeCompile, GPU texture, animation glitch."
argument-hint: "修正対象 (例: covariance rotation, bone texture update, new uniform)"
---

# GVRM シェーダー注入・スケルタルアニメーション

## When to Use

- `gsCustomizeMaterial()` のシェーダーロジック修正
- 新しい GPU テクスチャ・uniform の追加
- スプラットアニメーションのバグデバッグ（位置ずれ・回転不正・ちらつき）
- GS3D バージョンアップ後のシェーダー互換性確認

## アーキテクチャ概要

Gaussian Splat の頂点シェーダーを改変して VRM スケルタルアニメーションを実現する:

```
VRM SkinnedMesh (毎フレーム更新)
  └─ skeleton.boneTexture (4x4 ボーンマトリクス配列)
        ↓ uniform として渡す
カスタム頂点シェーダー
  ├─ vertexIndex → VRM メッシュ頂点インデックス
  ├─ vertexPositionTexture から VRM 頂点ワールド座標を参照
  ├─ skinWeightTexture からスキニング重みを参照
  ├─ boneTexture からボーン変換行列を参照
  ├─ splatRelativePoses から相対 offset を読み取る
  ├─ スプラット中心座標を計算
  └─ 共分散行列を回転に合わせて変換
```

## 主要実装箇所

### `gsCustomizeMaterial()` (gvrm.js:533–776)

シェーダー注入のエントリポイント。`material.onBeforeCompile` で GLSL コードを注入する。

**注入されるテクスチャ一覧:**

| uniform 名 | 型 | 内容 |
|---|---|---|
| `vertexPositionTexture` | `DataTexture` | VRM メッシュ頂点のワールド座標 (RGBA Float) |
| `vertexNormalTexture` | `DataTexture` | VRM メッシュ頂点の法線 (RGBA Float) |
| `skinWeightTexture` | `DataTexture` | スキニング重み・ボーンインデックス |
| `boneTexture` | `DataTexture` | ボーンマトリクス配列 (毎フレーム更新) |
| `bindMatrix` | `Matrix4` | バインドマトリクス |
| `bindMatrixInverse` | `Matrix4` | バインドマトリクスの逆行列 |

### `updateByBones()` (gvrm.js:315–353)

フレームごとにスプラットシーンのポジションをボーン中点で更新する:

```javascript
// 各ボーン i について
const boneWorldPos = bone.getWorldPosition(tempVec);
const parentWorldPos = bone.parent.getWorldPosition(tempVec2);
const midpoint = boneWorldPos.lerp(parentWorldPos, 0.5);
splatScenes[i].position.copy(midpoint);
// 注意: 回転はシェーダー内で処理 — ここでは位置のみ
```

**重要:** `updateByBones()` は **位置のみ** 更新。回転は頂点シェーダー内で共分散行列に適用される。

## シェーダー変更のパターン

### 新しい uniform を追加する

```javascript
// gsCustomizeMaterial() 内
material.onBeforeCompile = (shader) => {
  // 1. uniform を登録
  shader.uniforms.myNewTexture = { value: myDataTexture };

  // 2. 頂点シェーダーに宣言を追加
  shader.vertexShader = shader.vertexShader.replace(
    'void main() {',
    `
    uniform sampler2D myNewTexture;
    void main() {
    `
  );

  // 3. メイン関数内で使用
  shader.vertexShader = shader.vertexShader.replace(
    '// INSERT_POINT',
    `
    vec4 myData = texture2D(myNewTexture, vUv);
    // ... 使用ロジック
    `
  );
};
```

### 共分散行列の回転適用

スプラットの向きをボーン回転に合わせる場合:

```glsl
// 回転クォータニオンから回転行列を構築
mat3 rotMatrix = quatToMat3(boneQuaternion);
// 共分散行列に適用: C' = R * C * R^T
vec3 cov3D_row0 = rotMatrix * vec3(cov3D[0], cov3D[1], cov3D[2]);
vec3 cov3D_row1 = rotMatrix * vec3(cov3D[1], cov3D[3], cov3D[4]);
vec3 cov3D_row2 = rotMatrix * vec3(cov3D[2], cov3D[4], cov3D[5]);
```

## GS3D バージョン互換性チェック

GS3D (`lib/gaussian-splats-3d.module.js`) のバージョンを更新した場合:

1. `gsCustomizeMaterial()` 内の `shader.vertexShader.replace()` のターゲット文字列が存在するか確認
2. シェーダー変数名（特に `vPosition`, `vColor`, 共分散関連）が変わっていないか確認
3. `THREE.DataTexture` の format/type が変わっていないか確認
4. ブラウザコンソールで WebGL エラーを確認

**確認コマンド:**

```sh
# ビルドが通ることを確認
npm run build

# その後ブラウザで動作確認:
# https://localhost:8080/?gvrm=assets/sample.gvrm
# アニメーション再生時にスプラットがボーンに追従することを確認
```

## デバッグ手順

### スプラットがボーンに追従しない

1. `updateByBones()` が毎フレーム呼ばれているか確認 (`console.log` でデバッグ)
2. `boneTexture` が毎フレーム更新されているか確認 (`boneTexture.needsUpdate = true` が呼ばれているか)
3. シェーダーでのインデックスの範囲外アクセスをチェック

### 回転がおかしい

1. 共分散行列の回転ロジック（クォータニオン → 行列変換）を確認
2. `bindMatrix` / `bindMatrixInverse` が正しく渡されているか確認
3. VRM の `skeleton.boneTexture` が `computeBoneTexture()` 後に正しく初期化されているか確認

### テクスチャサイズ不一致

テクスチャ幅/高さは2の累乗に切り上げる:

```javascript
const size = Math.pow(2, Math.ceil(Math.log2(Math.sqrt(dataLength))));
const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
```
