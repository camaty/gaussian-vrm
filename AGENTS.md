# AGENTS.md

## Overview

- **gaussian-vrm** (npm: `@naruya/gaussian-vrm`) は、3D Gaussian Splatting (3DGS) のスプラット点群と VRM キャラクターモデルを組み合わせてリアルタイムアニメーション可能なアバターを生成する Web アプリケーション兼ライブラリです。
- `.gvrm` 形式（VRM + PLY + バインドメタデータを ZIP 圧縮したもの）を中心に、前処理（PLY → GVRM 変換）・ランタイムレンダリング・アニメーション再生の 3 フェーズで動作します。
- Tech stack: JavaScript (ES Modules), Three.js v0.170.0, @pixiv/three-vrm v2.1.0, Gaussian Splats 3D (内包), TensorFlow.js + BlazePose, JSZip, esbuild.
- 主な成果物: `lib/gaussian-vrm.min.js` (CDN 用), `lib/gaussian-vrm.bundled.js` (npm 用)。

## Why This Repo Is Structured This Way

- `gvrm-format/` はライブラリコアで、npm として配布される。依存は `three`, `@pixiv/three-vrm`, `jszip` のみで、アプリ固有のロジックを含まない。
- `apps/` はアプリ固有コード（前処理パイプライン、デモアプリ、ユーティリティ）を分離している。ライブラリ利用者は `apps/` に依存しない。
- `lib/` はビルド成果物。直接編集してはならない。
- `main.js` / `index.html` はメインデモアプリのエントリポイントで、`gvrm-format/` と `apps/` の統合ショーケースを兼ねる。

## File Structure

```text
gaussian-vrm/
|- gvrm-format/                  # ライブラリコア（npm 配布対象）
|  |- gvrm.js                    # GVRM クラス: ロード/保存/ランタイム更新/シェーダー注入
|  |- vrm.js                     # VRMCharacter: VRM ロード・FBX アニメーション・ミキサー
|  |- gs.js                      # GaussianSplatting: GS3D ビューアラッパー
|  |- ply.js                     # PLYParser: PLY ファイルパーサー
|  `- utils.js                   # PMC 可視化・ボーン操作・ポーズユーティリティ
|- apps/                         # アプリ固有コード（ライブラリに含まれない）
|  |- preprocess/                # PLY + VRM → GVRM 変換パイプライン
|  |  |- preprocess.js           # パイプライン制御 (Stage 0–3), CPU スプラット割当
|  |  |- preprocess_gl.js        # GPU 加速スプラット割当 (WebGL コンピュートシェーダー)
|  |  |- pose.js                 # TensorFlow.js BlazePose ラッパー
|  |  |- check.js                # アライメント検証（finalCheck）
|  |  `- utils_gl.js             # WebGL ユーティリティ
|  |- avatarworld/               # マルチアバターデモアプリ
|  |  |- main.js                 # エントリポイント
|  |  |- walker.js               # 自律歩行ウォーカー AI
|  |  |- scene.js                # 環境生成（空・床・建物）
|  |  `- index.html              # デモ HTML
|  |- fps.js                     # FPS カウンター
|  |- vr.js                      # WebRTC VR モードサポート
|  |- recorder.js                # 画面録画ユーティリティ
|  `- virtualController.js       # バーチャルコントローラー
|- lib/                          # ビルド成果物（直接編集禁止）
|  |- gaussian-vrm.min.js        # CDN 配布ビルド（GS3D 外部依存）
|  |- gaussian-vrm.bundled.js    # npm 配布ビルド（GS3D 同梱）
|  `- gaussian-splats-3d.module.js  # GS3D サードパーティライブラリ（同梱用）
|- assets/                       # サンプル GVRM・FBX アニメーション・default.json
|- examples/                     # simple-viewer.html（外部利用サンプル）
|- main.js                       # メインアプリエントリポイント
|- index.html                    # メインアプリ HTML
|- server.js                     # HTTPS 開発サーバー (localhost:8080)
|- build.js                      # esbuild ビルドスクリプト
|- error.js                      # エラーロギングユーティリティ
|- package.json                  # ライブラリパッケージ定義
`- CLAUDE.md                     # Claude Code 向けガイド（旧ガイド）
```

## Working Model

- ライブラリコアの変更は `gvrm-format/` 配下のファイルを編集する。
- 前処理パイプラインの変更は `apps/preprocess/` 配下を編集する。
- ランタイムアニメーション・シェーダー注入の変更は `gvrm-format/gvrm.js` の `gsCustomizeMaterial()` 前後を確認する。
- ライブラリに追加した機能は `examples/simple-viewer.html` での動作確認も行う。
- `lib/` のファイルは `npm run build` でのみ生成する。

## How To Verify Changes

```sh
npm install           # 依存関係インストール
npm run build         # esbuild でライブラリをビルド → lib/ に出力
node server.js        # HTTPS 開発サーバー起動 (https://localhost:8080)
# 手動確認: https://localhost:8080/ でメインアプリ動作確認
# 手動確認: https://localhost:8080/examples/simple-viewer.html でライブラリ動作確認
```

自動テストスイートはまだ未設定。変更後はブラウザでの手動確認が必要。

## バグ修正手順（TDD サイクル）

- バグ修正は可能な限り以下の 3 ステップで行う。

1. 🔴 再現確認: ブラウザでバグを再現する URL パラメータや操作手順を明確にする
2. 🟢 修正: ソースコードを修正し、ブラウザで再現しないことを確認する
3. ✅ 全体検証: `npm run build` が通り、既存の動作が壊れていないことを手動確認する

## Read These When Relevant

- `ARCHITECTURE.md` — コンポーネント構成・データフロー・前処理パイプライン詳細
- `CLAUDE.md` — 旧ガイド（開発コマンド・URL パラメータ・キーボード操作の詳細リファレンス）
- `gvrm-format/gvrm.js` — GVRM クラスの実装（シェーダー注入・ランタイム更新）
- `apps/preprocess/preprocess.js` — 前処理パイプライン実装

## Repo-Specific Constraints

- **`lib/` を直接編集してはならない** — `npm run build` で生成される出力ファイルである。
- **座標系**: VRM および 3DGS は Y-up 右手系。スプラットは PLY ファイルの座標系を継承する（通常は VRM と一致）。
- **VRM モデルは A-pose 必須** — 前処理パイプラインは腕を広げ足を揃えた A-pose を前提としている。
- **HTTPS 必須** — WebRTC や一部のブラウザ API のため開発サーバーは HTTPS で起動する。
- **シェーダー注入の副作用** — `gsCustomizeMaterial()` は GS3D の内部シェーダーを上書きする。GS3D のバージョンを更新した場合は必ずシェーダー注入の互換性を確認すること。
- **`skinnedMeshIndex`** — VRM モデルによって値が異なる (通常 1、メッシュが多い場合 2)。新しい VRM を追加する際は確認が必要。

## Clawable Workflow

すべてのエージェント作業は以下の 5 レーンを順に進める:

| Lane | Agent | Emits |
|------|-------|-------|
| explore | `@Explore` | `▶/✓ [LANE:explore]` |
| plan | `@Plan` | `▶/✓ [LANE:plan]` |
| implement | `@Implementer` | `▶/✓ [LANE:implement:step:{N}]` |
| verify | `@Verification` | `▶/✓ [LANE:verify:{command}]` |
| review | `@Reviewer` | `▶/✓ [LANE:review]` |

`@GVRM` を使えばパイプライン全体を自律実行できる。個別エージェントは特定作業に使う。

## Agents Available

| Agent | Purpose | Invoke |
|-------|---------|--------|
| `@GVRM` | 自律フルパイプライン (explore→plan→implement→verify→review) | 高レベルタスク |
| `@Plan` | 計画立案・ユーザー確認・Implementer へハンドオフ | 複雑な変更 |
| `@Explore` | 読み取り専用コードベース探索・Q&A | コードへの質問 |
| `@Implementer` | 承認済み計画の実装 | Plan 経由 |
| `@Reviewer` | セキュリティ・品質レビュー | 実装後 |
| `@Verification` | ビルド・手動確認確認 | スポットチェック |
