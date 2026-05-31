# 人物 PLY → ボーン推定 → Splat 対応付けアルゴリズム解説

このパイプラインは「人物の 3D ガウシアンスキャン（PLY）」と「A ポーズの VRM モデル」を入力に取り、  
**①VRM のボーンをスキャンの人物に合わせ込む（ボーン推定／アライメント）**、  
**②各 Splat をどのボーンに追従させるかを決める（対応付け）**  
という 2 段階で動きます。中核は `apps/preprocess/preprocess.js` と `gvrm-format/utils.js` です。

---

## 全体の発想

ポイントクラウド（PLY）からボーンを「ゼロから生成」するのではなく、**既存の A ポーズ VRM スケルトンを、スキャン人物のシルエットに合うように位置・スケール・姿勢を補正する**方式です。  
補正の手がかりには、レンダリング画像に対する **BlazePose（TensorFlow.js の 2D 姿勢推定）** のキーポイントを使います。  
3D 直接ではなく「複数アングルでレンダリング → 各画像で 2D 姿勢推定 → 角度を組み合わせて 3D 回転を逆算」するのが特徴です。

---

## データフロー概要

```
PLY + VRM(A-pose)
  │
  ├ cleanSplats            … 背景除去・身長/床/中心の推定
  ├ findBestAngleInRange   … 複数アングルのBlazePoseで正面方向を推定
  ├ スケール/位置/傾き合わせ  … VRMをスキャンにフィット
  ├ boneOperations          … 正面+側面のキーポイントから腕/脚回転を逆算(A-pose微調整)
  ├ finalCheck              … 11アングルでカプセル↔キーポイント整合性検証
  │       ← ここまでが「ボーン推定／アライメント」
  │
  ├ getPointsMeshCapsules   … ボーンをカプセル化, capsuleBoneIndex作成
  ├ assignSplatsToBones     … Splat→最近傍カプセル→splatBoneIndices
  └ assignSplatsToPoints    … Splat→ボーン内最近傍頂点→splatVertexIndices + splatRelativePoses
          ← ここが「Splatの対応付け」
  ↓
.gvrm 保存（VRM + PLY + splatBoneIndices/splatVertexIndices/splatRelativePoses/boneOperations）
```

---

## パート 1：PLY からのボーン推定（VRM アライメント）

`preprocess()` が全体を統括 ([preprocess.js L696〜](../apps/preprocess/preprocess.js))。

### Step 1. 背景除去 — `cleanSplats()` ([L221](../apps/preprocess/preprocess.js))

- 人物周囲の円形探索領域で、**高さヒストグラム解析**（`calculateHeights` L233）により床面と人物の上下端を検出。
- 足元の重心 `calculateCentroidFeet` (L360) と頭の重心 `calculateCentroidHead` (L394) を計算。
- 人物 Splat と背景 Splat を分離（前景／背景の 2 つの PLY を出力）。
- この段階で人物の **身長・床の高さ・XZ 中心** が得られます。

### Step 2. スケール合わせ ([L776〜](../apps/preprocess/preprocess.js))

VRM のバウンディング高さとスキャン人物の高さの比からスケールを算出し、VRM を再ロード。PLY と VRM の原点（床・中心）を一致させます。

```
vrmScale = (heights.max - heights.min) / (-character.ground * 2 + 0.05)
```

### Step 3. 向きの推定 — `findBestAngleInRange()` ([L577](../apps/preprocess/preprocess.js))

カメラを人物の周囲に回しながら各角度でレンダリング画像を BlazePose に通します。

| アングル | 内容 |
|---------|------|
| **粗探索** | 360° × 12 ステップ |
| **微探索** | ベスト角度の ±18° × 12 ステップ |

スコア関数：

```
score(angle) = leftWrist.x − rightWrist.x
```

正面を向くと左右の手首が対称になりスコアが最大になります（キーポイント 15/16）。  
失敗時は `[ErrorID 1]` / `[ErrorID 2]`。

### Step 4. 傾き補正

頭重心と足重心の 3D ベクトルから前後左右の傾きを求め、VRM シーンの `rotation.x/z` を補正します。

```
character.scene.rotation.x = atan2(dz, dy)          // 前後傾き
character.scene.rotation.z = π/2 - atan2(dy, dx)   // 左右傾き
```

### Step 5. 地面検証

膝キーポイント（25/26）の高さが地面円の高さより上であることを確認。  
下なら地面検出が誤っている → `[ErrorID 3]`。

### Step 6. A ポーズの微調整 — `boneOperations` ([L932〜](../apps/preprocess/preprocess.js))

`assets/default.json` のデフォルト `boneOperations` を基点に、2D キーポイントから 3D ボーン回転を逆算します。

**正面ビュー（angle = 0）で Z 軸回転を推定:**

| 対象 | キーポイント | 計算式 |
|------|------------|--------|
| 左腕 | 肩(11) → 手首(15) | `rotation.z = -atan2(Δy, Δx)` |
| 右腕 | 肩(12) → 手首(16) | `rotation.z = -180° - atan2(Δy, Δx)` |
| 左脚 | 股関節(23) → 足首(27) | `rotation.z = -90° - atan2(Δy, Δx)` |
| 右脚 | 股関節(24) → 足首(28) | `rotation.z = +90° - atan2(Δy, Δx)` |

手が内側に折れていれば A ポーズ違反 → `[ErrorID 4]`。

**側面ビュー（angle = ±π/2）で X 軸回転を推定:**

正面では取れない奥行き方向の角度を横アングルで補完します。  
`GVRMUtils.resetPose()` でスケルトンに適用。

### Step 7. 整合性検証 — `finalCheck()` ([check.js](../apps/preprocess/check.js))

```
11 アングル（-75° 〜 +75°）でレンダリング
  ↓
VRM ボーンカプセルのスクリーン投影座標 と BlazePose キーポイント（頭・手・足）の距離を比較
  ↓
3 アングル以上で閾値（0.15）を超えたら失敗
```

この時点で「VRM のスケルトンがスキャン人物の姿勢にフィット」した状態になります。

---

## パート 2：ボーンへの Splat 対応付け

ボーンを「カプセル形状」で近似し、各 Splat を最近傍カプセル → ボーンに割り当てます。

### A. ボーンカプセルの生成 — `getPointsMeshCapsules()` ([utils.js L188](../gvrm-format/utils.js))

VRM スケルトンを `_traverseNodes` (L245) で再帰的に辿り、**親ボーン → 子ボーンを結ぶ線分にカプセルを生成**します。

| 部位 | 半径 | スケール(XZ) | 備考 |
|------|------|-------------|------|
| arm | 0.06 m | 1.0 × 1.0 | 細い円柱 |
| leg | 0.08 m | 1.0 × 1.0 | |
| torso | 0.03 m | 6.0 × 4.0 | 体幹を覆う楕円 |
| head | 0.03 m | 2.0 × 2.0 | |
| headTop | 0.06 m | 1.5 × 2.0 | |

カプセルは中点に配置し、`setFromUnitVectors([0,1,0], 方向)` でボーン方向に回転。  
**`capsuleBoneIndex[ci] = スケルトン内のボーン index`** がカプセル ↔ ボーンの橋渡しです。

### B. Splat → ボーン割り当て — `assignSplatsToBones()` ([L15](../apps/preprocess/preprocess.js))

各 Splat の中心をワールド座標に変換し、**全カプセルの三角形メッシュに対して `triangle.closestPointToPoint` で最短距離を計算**、最も近いカプセルを選びます。

```
splatBoneIndices[i] = capsuleBoneIndex[bestCi]
```

- `fast` モードでは 10 個に 1 個だけ厳密計算し残りは前の結果を流用。
- 可視化用に Splat の色をボーン色に塗る（`C` キーで確認可能）。

**計算量:** O(splatCount × capsuleCount × trianglesPerCapsule)

### C. Splat → 頂点割り当て — `assignSplatsToPoints()` ([L86](../apps/preprocess/preprocess.js))

ボーン単位だけだと粗いので、さらに**最近傍の VRM メッシュ頂点**に紐付けて滑らかなスキニングを実現します。

**Phase A — 頂点→ボーン分類（`boneVertexIndices` 構築）**

```
for each VRM vertex vi:
  applyBoneTransform(vi) → world position  ← P-3 最適化: Pass 1 で全頂点をキャッシュ
  → 最近傍カプセル → boneVertexIndices[boneIndex].push(vi)
```

**Phase B — Splat → 最近傍頂点**

```
for each Splat i:
  boneIndex = splatBoneIndices[i]           // B で決めたボーン
  for vi in boneVertexIndices[boneIndex]:   // 同一ボーン内の頂点のみ
    dist = skinnedWorldCache[vi] .distanceTo( splat.center )
  splatVertexIndices[i] = argmin(dist)
```

探索範囲をボーン内に絞ることで高速化 & 誤割り当て防止。

**Phase C — 相対位置ベクトル算出**

```
splatRelativePoses[i] = splat.center0 − skinnedLocalCache[splatVertexIndices[i]]
```

ランタイムでは、この頂点がボーンで動くと相対位置を保ったまま Splat も動く（= スキニング）。

### D. GPU 版 ([preprocess_gl.js](../apps/preprocess/preprocess_gl.js))

`assignSplatsToBonesGL` / `assignSplatsToPointsGL` は同じ計算をテクスチャにパックして  
**WebGL フラグメントシェーダーで並列化**したもの（`?gpu` で有効化、10 万 Splat 超で高速）。

| 手法 | スループット | 備考 |
|------|------------|------|
| CPU | 〜10万 Splat/分 | デフォルト |
| GPU (WebGL) | 〜100万 Splat/分 | `?gpu` パラメータ |

---

## 設計上のポイント

### 2D → 3D の逆算

単一画像では奥行きが取れないため、**正面と側面の複数アングルの 2D 姿勢**を組み合わせて 3D のボーン回転（`rotation.x/z`）を推定しています。

| ビュー | 取得できる情報 |
|--------|--------------|
| 正面（angle = 0） | Z 軸回転（腕/脚の上下角） |
| 側面（angle = ±π/2） | X 軸回転（腕の前後角・深度方向） |

### カプセル＋頂点の二段階割り当て

まずカプセルで「どのボーンか」を粗く決め、次にそのボーン内の頂点で「どこに張り付くか」を細かく決めます。探索をボーン内に限定するので速くて破綻しにくい構造です。

### A ポーズ前提

VRM が A ポーズであることが必須（`boneOperations` の補正量がこれを基準にしています）。手が内側に折れていると `[ErrorID 4]`。

### `capsuleBoneIndex` がカプセル ↔ ボーンの橋渡し

最終的に Splat はボーン番号・頂点番号・頂点からの相対位置で記録され、ランタイムのシェーダースキニングで動かされます。

---

## エラー ID 一覧

| ID | 発生箇所 | 原因 |
|----|---------|------|
| 1 | pose.js | 特定角度でのポーズ検出失敗 |
| 2 | preprocess.js | キャラクター向き検出失敗 |
| 3 | preprocess.js | 地面検出失敗（膝が地面より下） |
| 4 | preprocess.js | A-pose 検証失敗（手が内側に曲がっている） |
| 5 | preprocess.js | 重心計算での頂点未検出 |
| 6 | preprocess.js | 高さ計算でのターゲット検出失敗 |

---

## 関連ファイル

| ファイル | 役割 |
|---------|------|
| [apps/preprocess/preprocess.js](../apps/preprocess/preprocess.js) | メインパイプライン（Stage 0〜3） |
| [apps/preprocess/preprocess_gl.js](../apps/preprocess/preprocess_gl.js) | GPU 版スプラット割当 |
| [apps/preprocess/pose.js](../apps/preprocess/pose.js) | TensorFlow.js BlazePose ラッパー |
| [apps/preprocess/check.js](../apps/preprocess/check.js) | finalCheck（整合性検証） |
| [gvrm-format/utils.js](../gvrm-format/utils.js) | ボーンカプセル生成・ボーン操作 |
| [gvrm-format/gvrm.js](../gvrm-format/gvrm.js) | GVRM クラス（ロード・保存・シェーダー注入） |
| [docs/algorithm-overview.js](./algorithm-overview.js) | 疑似コードによる詳細アルゴリズム解説 |
