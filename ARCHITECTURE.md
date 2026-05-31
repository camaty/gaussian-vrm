# Architecture Reference Document — gaussian-vrm

## 概要

gaussian-vrm は、3D Gaussian Splatting (3DGS) のスプラット点群と VRM キャラクターモデルを組み合わせ、スケルタルアニメーション対応のフォトリアリスティックアバターを生成・表示する Web アプリ兼ライブラリです。

システムは大きく 3 フェーズで構成されます。

| フェーズ | 内容 | 担当コード |
|---------|------|----------|
| **前処理** | PLY スキャン + VRM → `.gvrm` ファイルを生成 | `apps/preprocess/` |
| **ローディング** | `.gvrm` を解凍・デシリアライズし GPU テクスチャ + シェーダーを準備 | `gvrm-format/gvrm.js` |
| **ランタイム** | フレームごとにボーン変換をシェーダーへ供給し Splat を骨格に追従させてレンダリング | `gvrm-format/gvrm.js`, `main.js` |

---

## 1. 全体コンポーネント構成

```mermaid
flowchart TD
    subgraph Input["入力"]
        PLYFile["PLY ファイル\n(3DGS スキャン)"]
        VRMFile["VRM ファイル\n(キャラクターモデル)"]
        FBXFile["FBX アニメーション"]
    end

    subgraph Preprocess["前処理層 (apps/preprocess/)"]
        Clean["cleanSplats()\n背景除去・身長/重心検出"]
        Pose["BlazePose 姿勢検出\n(TensorFlow.js)"]
        Align["VRM アライメント\nスケール/位置/傾き合わせ"]
        BoneOps["boneOperations 算出\n腕/脚回転を2D→3D逆算"]
        CheckStep["finalCheck()\n11アングル整合性検証"]
        Assign["スプラット割当\nCPU / GPU"]
    end

    subgraph Format["GVRM フォーマット層 (gvrm-format/)"]
        GVRMClass["GVRM クラス\ngvrm.js"]
        VRMChar["VRMCharacter\nvrm.js"]
        GSClass["GaussianSplatting\ngs.js"]
        PLYParser["PLYParser\nply.js"]
        GVRMUtils["GVRMUtils\nutils.js"]
    end

    subgraph Runtime["ランタイム層"]
        ShaderInject["gsCustomizeMaterial()\nシェーダー注入"]
        BoneTex["boneTexture\nボーンマトリクス (毎フレーム更新)"]
        SplatScenes["スプラットシーン群\n(ボーン別 THREE.Group)"]
        Renderer["THREE.WebGLRenderer\n+ GaussianSplats3D"]
    end

    subgraph Output["成果物"]
        GVRMFile[".gvrm ファイル\n(ZIP: VRM + PLY + metadata)"]
        LibMin["lib/gaussian-vrm.min.js\n(CDN 配布)"]
        LibBundled["lib/gaussian-vrm.bundled.js\n(npm 配布)"]
    end

    PLYFile --> Clean
    VRMFile --> Align
    Clean --> Pose
    Pose --> Align
    Align --> BoneOps
    BoneOps --> CheckStep
    CheckStep --> Assign
    Assign --> GVRMFile

    GVRMFile --> GVRMClass
    VRMFile --> VRMChar
    GVRMClass --> GSClass
    GVRMClass --> VRMChar
    GVRMClass --> PLYParser
    GVRMClass --> GVRMUtils

    VRMChar --> BoneTex
    BoneTex --> ShaderInject
    GSClass --> SplatScenes
    ShaderInject --> SplatScenes
    SplatScenes --> Renderer

    FBXFile --> VRMChar

    GVRMClass --> LibMin
    GVRMClass --> LibBundled
```

---

## 2. GVRM ファイルフォーマット

`.gvrm` は ZIP アーカイブで、以下の 3 ファイルを含みます。

```
model.gvrm (ZIP)
├── model.vrm    — VRM 1.0 キャラクターモデル
├── model.ply    — Gaussian Splat 点群 (位置・色・共分散データ)
└── data.json    — バインドメタデータ
```

**`data.json` の主要フィールド:**

| フィールド | 型 | 説明 |
|---|---|---|
| `splatVertexIndices` | `number[]` | 各スプラットが追従する VRM メッシュ頂点のインデックス |
| `splatBoneIndices` | `number[]` | 各スプラットが割り当てられたボーンのインデックス |
| `splatRelativePoses` | `number[]` | 各スプラットのバインド頂点からの相対位置ベクトル |
| `boneOperations` | `Object[]` | VRM スケルトンに適用するポーズ調整（`boneName`, `position`, `rotation`） |
| `modelScale` | `number` | VRM モデルスケール係数（PLY スキャンの身長から自動算出） |

---

## 3. 前処理パイプライン

PLY スキャンデータを GVRM に変換する処理フロー（`apps/preprocess/`）。  
アルゴリズムの詳細は [docs/algorithm-overview.md](./algorithm-overview.md) を参照。

```mermaid
flowchart TD
    Start["開始: PLY + VRM"]

    subgraph Stage0["Stage 0 (デフォルト)"]
        S0A["cleanSplats()\n高さヒストグラムで背景除去\n身長・床・中心を推定"]
        S0B["findBestAngleInRange()\nBlazePose 両手首スコアで\n正面方向を探索"]
        S0C["スケール/位置/傾き合わせ\nVRM をスキャン人物にフィット"]
        S0D["boneOperations 算出\n正面+側面キーポイントから\n腕/脚の3D回転を逆算"]
        S0E["finalCheck()\n11アングルでカプセル↔\nキーポイント整合性検証"]
        S0A --> S0B --> S0C --> S0D --> S0E
    end

    subgraph Assign["スプラット割当"]
        CPU_B["assignSplatsToBones()\nCPU: 最近傍カプセル三角形"]
        CPU_V["assignSplatsToPoints()\nCPU: ボーン内最近傍VRM頂点"]
        GPU_B["assignSplatsToBonesGL()\nGPU: WebGLフラグメントシェーダー"]
        GPU_V["assignSplatsToPointsGL()\nGPU: WebGLフラグメントシェーダー"]
    end

    Save[".gvrm 保存\n(JSZip でパッケージ化)"]

    Start --> Stage0
    Stage0 --> Assign
    Start -->|"?stage=1"| S0B
    Start -->|"?stage=2"| S0D
    Start -->|"?stage=3"| Assign

    CPU_B & CPU_V --> Save
    GPU_B & GPU_V --> Save

    style GPU_B fill:#ffeaa7
    style GPU_V fill:#ffeaa7
```

**ステージパラメータ（`?stage=N`）:**

| stage | スキップされる処理 | ユースケース |
|-------|-----------------|------------|
| 0 (デフォルト) | なし | 完全自動処理 |
| 1 | cleanSplats | 清浄済み PLY を再利用 |
| 2 | cleanSplats + 姿勢検出 | アライメント検証済みの場合 |
| 3 | 自動検出を全スキップ | 手動パラメータ指定 |

**エラー ID 一覧:**

| ID | 発生箇所 | 原因 |
|----|---------|------|
| 1 | pose.js | 特定角度でのポーズ検出失敗 |
| 2 | preprocess.js | キャラクター向き検出失敗 |
| 3 | preprocess.js | 地面検出失敗（膝が地面より下） |
| 4 | preprocess.js | A-pose 検証失敗（手が内側に曲がっている） |
| 5 | preprocess.js | 重心計算での頂点未検出 |
| 6 | preprocess.js | 高さ計算でのターゲット検出失敗 |

---

## 4. ランタイム: クラス構成

```mermaid
classDiagram
    class GVRM {
        <<THREE.Group>>
        +character: VRMCharacter
        +gs: GaussianSplatting
        +isReady: boolean
        +fileName: string | null
        +modelScale: number
        +boneOperations: Object[]
        +boneSceneMap: Object
        +vrmWorldPosition0: THREE.Vector3
        +vrmWorldQuaternion0: THREE.Quaternion
        +static load(url, scene, camera, renderer, fileName): GVRM
        +load(url, scene, camera, renderer, fileName)
        +update(delta)
        +updateByBones()
        +static save(character, gs, data, filename)
    }

    class VRMCharacter {
        +currentVrm: VRM
        +currentMixer: AnimationMixer
        +currentAction: AnimationAction
        +scale: number
        +skinnedMeshIndex: number
        +faceIndex: number | undefined
        +loadVRM(modelUrl, animationUrl, scale)
        +loadFBX(animationUrl)
        +update(delta)
    }

    class GaussianSplatting {
        +viewer: GaussianSplats3D.Viewer
        +splatScenes: THREE.Group[]
        +centers0: Float32Array
        +colors: Uint8Array
        +splatCount: number
        +splatBoneIndices: number[]
        +splatVertexIndices: number[]
        +splatRelativePoses: number[][]
        +update()
    }

    class GVRMUtils {
        <<static>>
        +BONE_CONFIG: Object
        +applyBoneOperations(character, ops)
        +resetPose(character, ops)
        +getPointsMeshCapsules(character): PMC
        +visualizeVRM(character, visible)
        +initPMC(character): PMC
    }

    class PLYParser {
        +parse(buffer): SplatData
    }

    GVRM --> VRMCharacter : character
    GVRM --> GaussianSplatting : gs
    GVRM ..> GVRMUtils : static calls
    GVRM ..> PLYParser : loading
```

**`skinnedMeshIndex` について:**  
VRM モデルによってスキニングメッシュの位置が異なります。通常は `1`、メッシュ数の多いモデルでは `2` になる場合があります。新しい VRM モデルを追加する際は `gvrm.js:initVRM()` の判定ロジックを確認してください。

---

## 5. ロードシーケンス

```mermaid
sequenceDiagram
    participant App as main.js / 外部アプリ
    participant GVRM as GVRM クラス
    participant JSZip as JSZip
    participant VRMChar as VRMCharacter
    participant GS as GaussianSplatting
    participant Shader as gsCustomizeMaterial()

    App->>GVRM: new GVRM()
    App->>GVRM: instance.load(url, scene, camera, renderer)
    GVRM->>JSZip: ZIP 解凍 (model.vrm, model.ply, data.json)
    JSZip-->>GVRM: Blob URLs

    GVRM->>VRMChar: initVRM(vrmBlobUrl, null, scale, boneOperations)
    VRMChar-->>GVRM: VRMCharacter (スケルトン準備済み)

    GVRM->>GS: initGS(plyBlobUrl, scene, camera, renderer, character, data)
    Note over GS: GaussianSplats3D.Viewer で PLY をロード<br>スプラットをボーン別にシーン分割

    GS-->>GVRM: GaussianSplatting (シーン分割済み)

    GVRM->>Shader: gsCustomizeMaterial(character, gs, data)
    Note over Shader: VRM スキニングデータをテクスチャ化<br>頂点シェーダーにボーン変換を注入

    GVRM-->>App: isReady = true
```

---

## 6. カスタムシェーダー注入 (`gsCustomizeMaterial()`)

`gvrm-format/gvrm.js` の `gsCustomizeMaterial()` (L533–L776) は GaussianSplats3D の内部 WebGL シェーダーを改変してスケルタルアニメーションを実現します。

```mermaid
flowchart LR
    subgraph Textures["GPU テクスチャ (ビルド時に一度だけ作成)"]
        T1["vertexPositionTexture\nVRM メッシュ頂点座標\n(RGBA32F)"]
        T2["vertexNormalTexture\nVRM メッシュ頂点法線"]
        T3["skinWeightTexture\nスキニング重み (4 bone)"]
        T4["boneTexture\nボーンマトリクス\n(THREE.Skeleton.boneTexture)\n← 毎フレーム更新"]
    end

    subgraph VertexShader["頂点シェーダー (改変箇所)"]
        V1["vertexIndex → テクスチャから\n対応する VRM 頂点を参照"]
        V2["boneTexture + skinWeights\nでスキニング計算\n(ボーン変換適用)"]
        V3["splatRelativePose offset\nを加算して最終位置を決定"]
        V4["回転クォータニオンから\n共分散行列の回転を更新"]
    end

    T1 & T2 & T3 & T4 --> V1
    V1 --> V2 --> V3 --> V4
```

**シェーダー変数の対応:**

| GPU テクスチャ / uniform | 用途 |
|---|---|
| `vertexPositionTexture` | バインドポーズ時の VRM メッシュ頂点座標 |
| `boneTexture` | VRM Skeleton から毎フレーム転送されるボーンマトリクス |
| `skinWeightTexture` | 各頂点の 4 ボーンスキニング重み |
| `splatRelativePose` | バインド時の頂点→スプラット相対ベクトル（`data.json` より） |

**制約:**
- GS3D (`lib/gaussian-splats-3d.module.js`) のバージョンを変更した場合、シェーダー変数名の互換性を必ず確認すること
- `updateByBones()` はボーン中点の **位置** のみ更新。**回転** はシェーダー内で処理される

---

## 7. フレームループ

```mermaid
sequenceDiagram
    participant App as main.js
    participant GVRM as GVRM.update()
    participant VRMChar as VRMCharacter.update()
    participant Shader as 頂点シェーダー
    participant Renderer as THREE.WebGLRenderer

    loop requestAnimationFrame
        App->>GVRM: update(delta)
        GVRM->>VRMChar: update(delta)
        Note over VRMChar: AnimationMixer.update(delta)<br>VRM ヒューマノイドボーン行列を更新
        VRMChar-->>GVRM: ボーン行列更新済み
        GVRM->>GVRM: updateByBones()
        Note over GVRM: 各ボーン中点座標でスプラットシーンを移動<br>pooled matrix で clone().invert() を回避 (P-4)
        GVRM->>Shader: Skeleton.boneTexture (THREE.js が自動転送)
        Note over Shader: 頂点シェーダーで per-splat のスキニング計算<br>中心位置・共分散行列を更新
        GVRM->>Renderer: GaussianSplats3D 内部で sort + render
    end
```

`updateByBones()` の内部処理 (`gvrm.js` L314〜):

```
for each ボーン in skeleton.bones:
  if 子ボーンなし: skip
  for each 子ボーン:
    midPoint = (bone.matrixWorld + childBone.matrixWorld) / 2
    midPoint.applyMatrix4(gsViewerMatrixWorldInverse)       ← GS ビューア局所座標へ変換
    _invMat0.copy(childBone.matrixWorld0).invert()          ← バインドポーズの逆行列 (pooled)
    _relMat.multiplyMatrices(childBone.matrixWorld, _invMat0) ← 相対回転
    tempQuat.setFromRotationMatrix(_relMat)
    splatScene.position = midPoint
    splatScene.quaternion = tempQuat × gsViewerWorldQuatInverse
```

---

## 8. スプラットシーン分割方式

GaussianSplats3D は通常 1 つのシーンでスプラットを管理しますが、gaussian-vrm は**ボーンごとに `THREE.Group` シーンを分割**してボーン追従を実現します。

```mermaid
flowchart LR
    SplatBuffer["PLY スプラット群\n(全 N 個)"] --> Split{"boneSceneMap\nでシーン分割"}
    Split --> S1["Scene[0]\n頭部ボーンの Splat"]
    Split --> S2["Scene[1]\n右腕ボーンの Splat"]
    Split --> S3["Scene[2]\n左腕ボーンの Splat"]
    Split --> SN["Scene[K]\n体幹ボーンの Splat"]
    BoneTransform["updateByBones()\n毎フレームのボーン変換"] --> S1 & S2 & S3 & SN
    S1 & S2 & S3 & SN --> GS3D["GaussianSplats3D.Viewer\n各シーンを個別にレンダリング"]
```

---

## 9. ビルドパイプライン

```mermaid
flowchart LR
    Src["gvrm-format/gvrm.js\n(エントリポイント)"]

    subgraph Build["npm run build (node build.js / esbuild)"]
        CDN["CDN ビルド\nexternal: three, @pixiv/three-vrm,\njszip, gaussian-splats-3d"]
        NPM["npm ビルド\nexternal: three, @pixiv/three-vrm, jszip\nalias: gaussian-splats-3d →\nlib/gaussian-splats-3d.module.js"]
    end

    Src --> CDN --> LibMin["lib/gaussian-vrm.min.js"]
    Src --> NPM --> LibBundled["lib/gaussian-vrm.bundled.js"]
```

| 成果物 | 用途 | GS3D 依存 |
|---|---|---|
| `lib/gaussian-vrm.min.js` | CDN 経由（`examples/simple-viewer.html` など） | ユーザー側で読み込み |
| `lib/gaussian-vrm.bundled.js` | npm パッケージ（`@naruya/gaussian-vrm`） | 同梱済み |

---

## 10. PMC (Points / Mesh / Capsules) デバッグシステム

前処理・開発時のスプラット割当デバッグ用可視化システム。

| 要素 | 説明 |
|------|------|
| **Points** | VRM メッシュ頂点のワールド座標（点群表示） |
| **Mesh** | VRM メッシュワイヤーフレーム |
| **Capsules** | ボーン形状カプセル（ボーン色でスプラット割当を確認） |

**キーボード操作:**

| キー | 操作 |
|------|------|
| `V` | PMC 表示切替 |
| `C` | スプラット色モード切替（empty → assign → original） |
| `X` | VRM メッシュ表示切替 |
| `Space` | アニメーション再生/一時停止 |

---

## 11. 座標系・スケール

| 空間 | 座標系 | 備考 |
|------|--------|------|
| VRM | Y-up 右手系 | Three.js 標準 |
| 3DGS (PLY) | Y-up 右手系 | VRM と一致させる |
| スクリーン空間 | 正規化（高さで除算） | finalCheck の比較に使用 |

VRM スケール自動算出:

```
vrmScale = (heights.max - heights.min) / (-character.ground * 2 + 0.05)
```

スキャン人物の身長と VRM のバウンディング高さの比から決定し、`data.json` の `modelScale` に保存されます。

---

## 12. ファイル構成

```text
gaussian-vrm/
├── gvrm-format/                  ライブラリコア（npm 配布対象）
│   ├── gvrm.js                   GVRM クラス: ロード/保存/ランタイム更新/シェーダー注入
│   ├── vrm.js                    VRMCharacter: VRM ロード・FBX アニメーション
│   ├── gs.js                     GaussianSplatting: GS3D ビューアラッパー
│   ├── ply.js                    PLYParser: PLY ファイルパーサー
│   └── utils.js                  GVRMUtils: ボーンカプセル生成・ボーン操作・PMC
├── apps/                         アプリ固有コード（ライブラリに含まれない）
│   ├── preprocess/               前処理パイプライン
│   │   ├── preprocess.js         メインパイプライン (Stage 0–3)・CPU Splat 割当
│   │   ├── preprocess_gl.js      GPU 加速 Splat 割当 (WebGL コンピュートシェーダー)
│   │   ├── pose.js               TensorFlow.js BlazePose ラッパー
│   │   ├── check.js              finalCheck（マルチアングル整合性検証）
│   │   └── utils_gl.js           WebGL ユーティリティ
│   └── avatarworld/              マルチアバターデモアプリ
│       ├── main.js               エントリポイント
│       ├── walker.js             自律歩行 AI
│       └── scene.js              環境生成（空・床・建物）
├── lib/                          ビルド成果物（直接編集禁止）
│   ├── gaussian-vrm.min.js       CDN 配布ビルド
│   ├── gaussian-vrm.bundled.js   npm 配布ビルド
│   └── gaussian-splats-3d.module.js  GS3D サードパーティライブラリ
├── assets/                       サンプル GVRM・FBX アニメーション・default.json
├── examples/                     simple-viewer.html（外部利用サンプル）
├── tests/                        vitest 単体テスト
│   └── unit/                     UT-13（ソースパターン）・UT-14（リファクタ/パフォーマンス）
├── docs/
│   ├── algorithm-overview.md     アルゴリズム詳解（本ドキュメント補足）
│   └── algorithm-overview.js     疑似コードによるアルゴリズム解説
├── main.js                       メインアプリエントリポイント
├── index.html                    メインアプリ HTML
├── server.js                     HTTPS 開発サーバー (localhost:8080)
└── build.js                      esbuild ビルドスクリプト
```

---

## 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [docs/algorithm-overview.md](./algorithm-overview.md) | 前処理アルゴリズムの詳細解説（ボーン推定・Splat 対応付け） |
| [docs/algorithm-overview.js](./algorithm-overview.js) | 疑似コードによるアルゴリズム詳解 |
| [AGENTS.md](../AGENTS.md) | エージェント定義・non-negotiable 制約 |
| [CLAUDE.md](../CLAUDE.md) | 開発コマンド・URL パラメータ・キーボード操作リファレンス |
| [docs/algorithm-improvements.md](./algorithm-improvements.md) | アルゴリズム改善候補一覧 |
