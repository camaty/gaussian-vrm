# Architecture Reference Document — gaussian-vrm

## 概要

gaussian-vrm は、3D Gaussian Splatting (3DGS) のスプラット点群と VRM キャラクターモデルを組み合わせ、スケルタルアニメーション対応のフォトリアリスティックアバターを生成・表示する Web アプリ兼ライブラリです。

システムは大きく 3 フェーズで構成されます:

1. **前処理フェーズ** — PLY スキャンデータと VRM モデルを入力とし、バインドメタデータを生成して `.gvrm` ファイルを出力する
2. **ローディングフェーズ** — `.gvrm` ファイルを解凍・デシリアライズし、GPU テクスチャ + シェーダーを準備する
3. **ランタイムフェーズ** — フレームごとにボーン変換をシェーダーへ供給し、スプラットを骨格に追従させてレンダリングする

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
        Clean["cleanSplats()\n背景除去"]
        Pose["BlazePose 姿勢検出\n(TensorFlow.js)"]
        Align["VRM アライメント\n自動ポーズ調整"]
        Assign["スプラット割当\nCPU / GPU"]
        Check["finalCheck()\nマルチアングル検証"]
    end

    subgraph Format["GVRM フォーマット層 (gvrm-format/)"]
        GVRM["GVRM クラス\ngvrm.js"]
        VRMChar["VRMCharacter\nvrm.js"]
        GS["GaussianSplatting\ngs.js"]
        PLYParser["PLYParser\nply.js"]
        Utils["GVRMUtils\nutils.js"]
    end

    subgraph Runtime["ランタイム層"]
        Shader["カスタムシェーダー\ngsCustomizeMaterial()"]
        BoneTex["ボーンマトリクス\nテクスチャ"]
        SplatScenes["スプラットシーン群\n(ボーン別分割)"]
        Renderer["Three.js WebGL\nレンダラー"]
    end

    subgraph Output["成果物"]
        GVRMFile[".gvrm ファイル\n(ZIP: VRM + PLY + metadata)"]
        LibMin["gaussian-vrm.min.js\n(CDN 配布)"]
        LibBundled["gaussian-vrm.bundled.js\n(npm 配布)"]
    end

    PLYFile --> Clean
    VRMFile --> Align
    Clean --> Pose
    Pose --> Align
    Align --> Assign
    Assign --> Check
    Check --> GVRMFile

    GVRMFile --> GVRM
    VRMFile --> VRMChar
    GVRM --> GS
    GVRM --> VRMChar
    GVRM --> PLYParser
    GVRM --> Utils

    VRMChar --> BoneTex
    BoneTex --> Shader
    GS --> SplatScenes
    Shader --> SplatScenes
    SplatScenes --> Renderer

    FBXFile --> VRMChar

    GVRM --> LibMin
    GVRM --> LibBundled
```

---

## 2. GVRM ファイルフォーマット

`.gvrm` は ZIP アーカイブで、以下の 3 ファイルを含む:

```
model.gvrm (ZIP)
├── model.vrm    — VRM 1.0 キャラクターモデル
├── model.ply    — Gaussian Splat 点群 (位置・色・共分散データ)
└── data.json    — バインドメタデータ
```

**`data.json` の主要フィールド:**

| フィールド | 型 | 説明 |
|---|---|---|
| `splatVertexIndices` | `number[]` | 各スプラットが最近傍の VRM メッシュ頂点のインデックス |
| `splatBoneIndices` | `number[]` | 各スプラットが割り当てられたボーンのインデックス |
| `splatRelativePoses` | `number[]` | 各スプラットのバインド頂点からの相対位置 |
| `boneOperations` | `Object[]` | VRM スケルトンに適用するポーズ調整 (`boneName`, `position`, `rotation`) |
| `modelScale` | `number` | VRM モデルスケール係数 |

---

## 3. 前処理パイプライン

PLY スキャンデータを GVRM に変換する処理フロー (`apps/preprocess/`):

```mermaid
flowchart TD
    Start["開始: PLY + VRM"]

    subgraph Stage0["Stage 0 (デフォルト)"]
        S0A["cleanSplats()\n高さ・半径検出で\n背景スプラットを除去"]
        S0B["BlazePose\n最適角度探索\nfindBestAngleInRange()"]
        S0C["VRM 自動アライメント\n(身長・姿勢合わせ)"]
        S0D["A-pose ボーン操作\n算出・検証"]
        S0E["finalCheck()\n11 アングルで\nアライメント検証"]
        S0F["スプラット割当"]
    end

    subgraph Stage1["Stage 1 (清浄済み PLY 使用)"]
        S1["cleanSplats をスキップ"]
    end

    subgraph Stage2["Stage 2 (ポーズ検出もスキップ)"]
        S2["cleanSplats + 姿勢検出をスキップ"]
    end

    subgraph Stage3["Stage 3 (手動パラメータ)"]
        S3["自動検出を全スキップ\n手動パラメータ使用"]
    end

    subgraph Assign["スプラット割当 (CPU / GPU)"]
        CPU_B["assignSplatsToBones()\nCPU: 最近傍ボーンカプセル"]
        CPU_V["assignSplatsToPoints()\nCPU: 最近傍 VRM 頂点"]
        GPU_B["assignSplatsToBonesGL()\nGPU: WebGL コンピュートシェーダー"]
        GPU_V["assignSplatsToPointsGL()\nGPU: WebGL コンピュートシェーダー"]
    end

    Save[".gvrm ファイル保存\n(JSZip でパッケージ化)"]

    Start --> Stage0
    S0A --> S0B --> S0C --> S0D --> S0E --> S0F
    S0F --> CPU_B
    S0F --> CPU_V
    S0F --> GPU_B
    S0F --> GPU_V

    Start -->|"?stage=1"| Stage1 --> S0B
    Start -->|"?stage=2"| Stage2 --> S0D
    Start -->|"?stage=3"| Stage3 --> S0F

    CPU_B & CPU_V & GPU_B & GPU_V --> Save

    style GPU_B fill:#ffeaa7
    style GPU_V fill:#ffeaa7
```

**エラー ID 一覧** (`[ErrorID N]` で検索可能):

| ID | 発生箇所 | 原因 |
|----|---|---|
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
        +t: number
        +static initVRM(vrmPath, scene, camera, renderer, modelScale, boneOperations): VRMCharacter
        +static initGS(gsPath, scene, camera, renderer, character, data): GaussianSplatting
        +static loadGVRM(gvrmPath, scene, camera, renderer): GVRM
        +update(delta)
        +updateByBones()
        +static saveGVRM(character, gs, data, filename)
    }

    class VRMCharacter {
        +currentVrm: VRM
        +currentMixer: AnimationMixer
        +currentAction: AnimationAction
        +scale: number
        +skinnedMeshIndex: number
        +faceIndex: number|undefined
        +loadVRM(modelUrl, animationUrl, scale)
        +loadFBX(animationUrl)
        +update(delta)
    }

    class GaussianSplatting {
        +viewer: GaussianSplats3D.Viewer
        +splatScenes: THREE.Group[]
        +update()
    }

    class GVRMUtils {
        <<static>>
        +applyBoneOperations(character, ops)
        +setPose(character, ops)
        +visualizeVRM(character, visible)
        +initPMC(character): PMC
    }

    GVRM --> VRMCharacter : owns
    GVRM --> GaussianSplatting : owns
    GVRM ..> GVRMUtils : uses
```

---

## 5. ランタイム: カスタムシェーダー注入

`gsCustomizeMaterial()` (`gvrm-format/gvrm.js:533-776`) は Gaussian Splats 3D の内部 WebGL シェーダーを改変してスケルタルアニメーションを実現する:

```mermaid
flowchart LR
    subgraph Textures["GPU テクスチャ (シェーダーへ注入)"]
        T1["vertexPositionTexture\nVRM メッシュ頂点座標"]
        T2["vertexNormalTexture\nVRM メッシュ頂点法線"]
        T3["skinWeightTexture\nスキニング重み"]
        T4["boneTexture\nボーンマトリクス (VRM から毎フレーム更新)"]
    end

    subgraph VertexShader["頂点シェーダー (改変箇所)"]
        V1["vertexIndex → 対応する VRM 頂点を参照"]
        V2["スキニング計算\n(ボーン変換適用)"]
        V3["相対ポーズ offset を加算"]
        V4["共分散行列の回転更新"]
    end

    T1 & T2 & T3 & T4 --> V1
    V1 --> V2 --> V3 --> V4
```

**シェーダー注入の制約:**
- GS3D (`gaussian-splats-3d.module.js`) のバージョンを変更した場合、シェーダー変数名の互換性を必ず確認すること
- `updateByBones()` はボーン中点の **位置** のみ更新。**回転** はシェーダー内で処理される

---

## 6. フレームループ

```mermaid
sequenceDiagram
    participant App as main.js
    participant GVRM as GVRM.update()
    participant VRMChar as VRMCharacter.update()
    participant Shader as カスタムシェーダー
    participant Renderer as THREE.WebGLRenderer

    loop requestAnimationFrame
        App->>GVRM: update(delta)
        GVRM->>VRMChar: update(delta)
        Note over VRMChar: AnimationMixer.update()\nVRM ヒューマノイドボーン更新
        VRMChar-->>GVRM: ボーンマトリクス更新済み
        GVRM->>GVRM: updateByBones()
        Note over GVRM: 各ボーンの midpoint 座標で\nスプラットシーンを移動
        GVRM->>Shader: boneTexture (毎フレーム更新)
        Note over Shader: 頂点シェーダーで\nスプラット位置・共分散を再計算
        GVRM->>Renderer: THREE.WebGLRenderer.render()
    end
```

---

## 7. ビルドパイプライン

```mermaid
flowchart LR
    Src["gvrm-format/gvrm.js\n(エントリポイント)"]

    subgraph Build["npm run build (node build.js / esbuild)"]
        CDN["CDN ビルド\nexternal: three, @pixiv/three-vrm,\njszip, gaussian-splats-3d"]
        NPM["npm ビルド\nexternal: three, @pixiv/three-vrm, jszip\nalias: gaussian-splats-3d → lib/gaussian-splats-3d.module.js"]
    end

    Src --> CDN --> LibMin["lib/gaussian-vrm.min.js"]
    Src --> NPM --> LibBundled["lib/gaussian-vrm.bundled.js"]
```

| 成果物 | 用途 | GS3D 依存 |
|---|---|---|
| `lib/gaussian-vrm.min.js` | CDN 経由での利用 | 外部依存（ユーザー側で読み込み） |
| `lib/gaussian-vrm.bundled.js` | npm パッケージ | 同梱済み |

---

## 8. PMC (Points/Mesh/Capsules) デバッグシステム

前処理・開発時のスプラット割当デバッグ用の可視化システム:

| 要素 | 説明 | 表示切替 |
|---|---|---|
| **Points** | VRM メッシュ頂点のワールド座標 | `V` キー |
| **Mesh** | VRM メッシュワイヤーフレーム | `V` キー |
| **Capsules** | ボーン可視化（ボーン色でスプラット割当を確認） | `V` キー |

スプラット色モード切替: `C` キー (empty → assign → original)

---

## 9. 座標系・スケール

- **VRM**: Y-up 右手系
- **3DGS (PLY)**: VRM に合わせた Y-up 右手系（一般的）
- **スクリーン空間**: ポーズ検出の検証に使用（高さで正規化）
- **VRM スケール**: PLY スキャンの高さから自動計算される（`modelScale` フィールドに保存）
