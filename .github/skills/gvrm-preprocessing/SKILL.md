---
name: gvrm-preprocessing
description: "GVRM 前処理パイプラインの実装・デバッグ。PLY スキャンデータと VRM モデルを組み合わせて .gvrm ファイルを生成する処理全体を扱う。Use when implementing or debugging the preprocessing pipeline, modifying splat assignment algorithms, tuning pose detection, or adding support for new VRM models. Triggers: preprocess, cleanSplats, pose detection, splat assignment, bone assignment, vertex assignment, GPU preprocess, A-pose, finalCheck, stage parameter, gvrm save."
argument-hint: "対象の処理ステップまたはエラー ID (例: cleanSplats, assignSplatsToBones, ErrorID 3)"
---

# GVRM 前処理パイプライン

## When to Use

- 前処理パイプラインの新機能追加または既存ロジックの修正
- スプラット割当アルゴリズムの変更（CPU/GPU）
- 新しい VRM モデルへの対応（A-pose 検証のチューニング）
- `[ErrorID N]` エラーのデバッグ
- 前処理 Stage パラメータの変更

## パイプライン構成

```
入力: PLY ファイル + VRM ファイル
         ↓
[Stage 0] cleanSplats()              ← 背景除去
         ↓
[Stage 0] BlazePose 姿勢検出          ← findBestAngleInRange()
         ↓
[Stage 0] VRM 自動アライメント         ← 身長・姿勢合わせ
         ↓
[Stage 0/2] A-pose ボーン操作算出
         ↓
[Stage 0/2] finalCheck()             ← 11 アングル検証
         ↓
[Stage 0/2/3] スプラット割当          ← CPU または GPU (?gpu)
         ↓
.gvrm ファイル保存 (JSZip)
```

Stage パラメータ (`?stage=N`) で早期ステップをスキップできる:
- `?stage=1`: `cleanSplats()` をスキップ（清浄済み PLY 使用）
- `?stage=2`: `cleanSplats()` + 姿勢検出をスキップ
- `?stage=3`: 全自動検出をスキップ（手動パラメータ使用）

## 主要関数リファレンス

### `cleanSplats()` (preprocess.js:221)

背景スプラットを除去する:
- キャラクター周囲の円形探索領域で高さ・半径を検出
- 閾値以外のスプラットをフィルタリング
- `?nobg` URL パラメータで完全除去も可能

### `findBestAngleInRange()` (preprocess.js:577)

最適カメラ角度を探索する:
- 指定角度範囲でカメラを回転させながらポーズ検出
- BlazePose のスコアが最も高い角度を選択
- 失敗時は `[ErrorID 1]` または `[ErrorID 2]` を記録

### `assignSplatsToBones()` (preprocess.js:14) — CPU

CPU でスプラットを最近傍ボーンカプセルに割り当てる:
- 各スプラットに対してすべてのボーンカプセルとの距離を計算
- 最近傍ボーンのインデックスを `splatBoneIndices` に格納

### `assignSplatsToPoints()` (preprocess.js:86) — CPU

CPU でスプラットを最近傍 VRM メッシュ頂点に割り当てる:
- 各スプラットに対してすべての VRM 頂点との距離を計算
- 最近傍頂点のインデックスを `splatVertexIndices` に格納

### `assignSplatsToBonesGL()` / `assignSplatsToPointsGL()` (preprocess_gl.js) — GPU

WebGL コンピュートシェーダー版（`?gpu` URL パラメータで有効化）:
- テクスチャにデータをパックして GPU でパラレル計算
- スプラット数が多い場合 (100K+) に大幅に高速

### `finalCheck()` (preprocess.js:1115)

アライメントを 11 カメラ角度 (-75° ~ +75°) で検証:
- VRM カプセルのスクリーン座標と BlazePose のキーポイントを比較
- 頭・手・足のアライメントを検証
- 3 アングル以上が閾値 (0.15) を超えると失敗

## エラー ID 対処法

| ErrorID | 原因 | 対処 |
|---|---|---|
| 1 | 特定角度でのポーズ検出失敗 | `?stage=2` で検出スキップ、手動でアングル調整 |
| 2 | キャラクター向き検出失敗 | PLY ファイルのキャラクター向きを確認 |
| 3 | 地面検出失敗 | `?stage=2` + 手動高さパラメータ指定 |
| 4 | A-pose 検証失敗（手が内側） | `boneOperations` の肘・肩の回転を調整 |
| 5 | 重心計算での頂点未検出 | VRM モデルのメッシュ構造を確認 |
| 6 | 高さ計算でのターゲット検出失敗 | スキャンデータの品質を確認 |

エラーログは自動的にファイルに保存される（リトライ後も失敗した場合）。

## 新しい VRM モデルへの対応

1. `gvrm.js:initVRM()` で `skinnedMeshIndex` を確認する:
   - `vrm.scene.children.length > 4` → `skinnedMeshIndex = 2`, `faceIndex = 1`
   - それ以外 → `skinnedMeshIndex = 1`, `faceIndex = undefined`
2. A-pose が正しくない場合は `assets/default.json` の `boneOperations` を調整する
3. `finalCheck()` の閾値調整が必要な場合は `check.js` の定数を変更する

## デバッグ手順

1. URL: `https://localhost:8080/?gs=<path>&stage=3` で全自動検出をスキップ
2. `V` キーで PMC Capsules を表示してボーン可視化を確認
3. `C` キーでスプラット色をボーン割当表示モードに切り替え
4. ブラウザコンソールで `splatBoneIndices` / `splatVertexIndices` 配列を確認
5. `?saveply` パラメータで処理済み PLY を保存して確認
