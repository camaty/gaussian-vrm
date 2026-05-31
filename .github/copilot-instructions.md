---
applyTo: "**"
---

# gaussian-vrm — Project Instructions

3DGS スプラット点群と VRM キャラクターを結合してリアルタイムアニメーション対応アバターを生成する Web アプリ兼ライブラリ。
詳細は [`AGENTS.md`](../AGENTS.md) および [`ARCHITECTURE.md`](../ARCHITECTURE.md) を参照。

## Non-negotiable constraints

- **`lib/` を直接編集してはならない** — `npm run build` で生成される出力ファイル。全ソース変更は `gvrm-format/`, `apps/`, `main.js`, `build.js` に対して行う。
- **シェーダー注入の互換性**: GS3D (`lib/gaussian-splats-3d.module.js`) のバージョンを変更した場合は `gsCustomizeMaterial()` のシェーダー変数名の互換性を必ず確認すること。
- **VRM は A-pose 必須** — 前処理パイプラインは A-pose を前提としている。
- **HTTPS 必須** — 開発サーバーは `node server.js` で HTTPS 起動する（WebRTC・一部ブラウザ API のため）。
- **`skinnedMeshIndex`** の値は VRM モデルによって異なる。新しい VRM を追加する際は `gvrm.js:initVRM()` の判定ロジックを確認すること。

## Source layout

- `gvrm-format/gvrm.js` — GVRM クラス本体: ロード・保存・ランタイム更新・シェーダー注入
- `gvrm-format/vrm.js` — VRMCharacter: VRM ロード・FBX アニメーション
- `gvrm-format/gs.js` — GaussianSplatting: GS3D ビューアラッパー
- `gvrm-format/ply.js` — PLYParser: PLY ファイルパーサー
- `gvrm-format/utils.js` — PMC 可視化・ボーン操作
- `apps/preprocess/preprocess.js` — 前処理パイプライン制御 (Stage 0–3)
- `apps/preprocess/preprocess_gl.js` — GPU 加速スプラット割当

## GVRM ファイル構造

`.gvrm` は ZIP アーカイブ: `model.vrm` + `model.ply` + `data.json`。
`data.json` に `splatVertexIndices`, `splatBoneIndices`, `splatRelativePoses`, `boneOperations`, `modelScale` を保持。

## Verification commands

```sh
npm run build   # esbuild で lib/ にバンドル生成
node server.js  # HTTPS 開発サーバー (https://localhost:8080)
```

自動テストスイートは未設定。変更後はブラウザでの手動確認が必要。
