# 改善提案ドキュメント — gaussian-vrm

> 本ドキュメントは以下の 3 カテゴリの改善候補をまとめたものです。
> 実装前にすべての対象関数に対してテスト（RED）を用意してから修正してください（TDD 原則）。
>
> - **A: アルゴリズム精度改善** — 前処理ロジックの正確性向上
> - **R: リファクタリング** — 保守性・テスト容易性の改善
> - **P: 性能改善** — 速度・メモリの改善
> - **Q: 人物表現品質** — アニメーション・見た目の改善

---

## 優先度マップ（全候補）

### A: アルゴリズム精度改善

| # | 領域 | ファイル:行 | 現状の問題 | 優先度 |
|---|------|------------|-----------|--------|
| A-1 | splat→bone fast mode | `preprocess.js:20` | 9/10 のスプラットが前の結果をコピー | 高 |
| A-2 | direction estimation | `preprocess.js:600-603` | wrist X 座標差分のみでスコア計算 | 高 |
| A-3 | finalCheck 失敗判定 | `check.js:141` | 3 角度失敗まで許容しすぎ | 中 |
| A-4 | splat→vertex one-hot | `preprocess.js:86-220` | bone 境界付近のスプラットが最適頂点を見逃す | 中 |
| A-5 | floor/height detection | `preprocess.js:257` | 固定 1cm ビン幅・magic ratio | 中 |
| A-6 | VRM tilt/A-pose | `preprocess.js:916-925` | 2 点重心のみで tilt 推定 | 低 |
| A-7 | runtime precision | `gvrm.js:689`, `preprocess_gl.js:702,720` | GPU 正規化精度・クォータニオン符号バグ | 低 |

### R: リファクタリング

| # | 領域 | ファイル:行 | 現状の問題 | 優先度 |
|---|------|------------|-----------|--------|
| R-1 | 二重ファクトリーパターン | `gvrm.js:360-379` | instance `load()` が 9 フィールドを手動コピー | 中 |
| R-2 | 自己代入ノーオプ | `preprocess.js:22` | `bestCi = bestCi` デッドコード | 低 |
| R-3 | マジックナンバー散在 | `gvrm.js:154-165` | bone index 57/21/19 がハードコード | 中 |
| R-4 | bone 名リスト重複 | `gvrm.js:200`, `utils.js:162` | `BONE_CONFIG` と同一リストが重複定義 | 中 |
| R-5 | デッドコード | `gvrm.js` 各所 | `updateByVertices`・`sortSplatsByVertices`・旧互換シム | 低 |
| R-6 | 400 行巨大関数 | `preprocess.js:221-575` | `cleanSplats()` に 5 つの内部関数がネスト | 中 |
| R-7 | O(n²) 配列結合 | `gvrm.js:435` | `concat` を毎ループ呼び出し | 低 |

### P: 性能改善

| # | 領域 | ファイル:行 | 現状の問題 | 優先度 |
|---|------|------------|-----------|--------|
| P-1 | GPU テクスチャ過剰確保 | `gvrm.js:479-487` | 64MB × 6 テクスチャ固定確保 (384MB) | 最高 |
| P-2 | 三重ループ内オブジェクト生成 | `preprocess.js:40-60` | 最大 7 億回の `new THREE.Vector3()` | 高 |
| P-3 | 骨変換の二重計算 | `preprocess.js:102, 207` | `applyBoneTransform` を 2 パスで重複実行 | 高 |
| P-4 | フレーム毎 `clone().invert()` | `gvrm.js:336` | 毎フレーム × 全ボーン分のアロケート | 高 |
| P-5 | DataView ループ | `ply.js:130` | typed array view で代替可能 | 中 |
| P-6 | 孤立セル検出 O(n²) | `preprocess.js:468` | 全グリッド走査 → BFS で O(n) 化 | 中 |
| P-7 | Blob URL 未解放 | `gvrm.js:112-119` | ロード後に `revokeObjectURL` なし | 低 |

### Q: 人物表現品質

| # | 領域 | ファイル:行 | 現状の問題 | 優先度 |
|---|------|------------|-----------|--------|
| Q-1 | 単一 bone 割当 | `preprocess.js:14-84` | 骨境界で裂け・段差が出る | 最高 |
| Q-2 | 最近傍頂点 bind | `preprocess.js:86-220` | 表面追従が粗く頂点単位でガタつく | 最高 |
| Q-3 | 距離のみの割当 | `preprocess.js:40-60` | 法線方向を無視し腕→胴体の誤割当発生 | 高 |
| Q-4 | bone index ベース cleanup | `gvrm.js:154-166` | VRM 依存の index で品質が不安定 | 高 |
| Q-5 | 単純な背景除去 | `preprocess.js:221-575` | 髪・スカート・袖・足先が欠ける | 高 |
| Q-6 | 手首 L-R 差分のみの正面推定 | `preprocess.js:600-647` | 手が隠れると正面が大きくずれる | 中 |
| Q-7 | pass/fail 判定のみの finalCheck | `check.js:10-152` | 誤差量を補正に使えていない | 中 |
| Q-8 | covariance 回転の hardcode | `gvrm.js:689` | `-tempQuat.y` は検証なしの暫定対処 | 中 |
| Q-9 | 全身共通の割当ロジック | `preprocess.js` 全体 | 顔・手・足が専用処理を持たない | 中 |
| Q-10 | 固定 preprocessing パラメータ | `preprocess.js` 各所 | スキャン品質によって最適値が変わる | 低 |

---

---

## A: アルゴリズム精度改善（詳細）

---

## A-1: splat→bone fast mode の精度低下

### 現状 (`apps/preprocess/preprocess.js:L14–L84`)

```js
function assignSplatsToBones(character, gs, capsules, capsuleBoneIndex, fast = false) {
  // ...
  for (let i = 0; i < gs.splatCount; i++) {
    if (fast && i % 10 !== 0) {          // L20: fast mode は 10 個に 1 個だけ計算
      gs.splatBoneIndices.push(gs.splatBoneIndices[i - 1]);  // L21: 前の結果を流用
      continue;
    }
    // ... capsule 距離計算 ...
  }
}
```

**問題**: 空間的に近いスプラットが必ずしも同じボーンに属するとは限らない。  
特に四肢のカプセル境界付近（腰/肩の接続部）で誤分類率が高くなる。

### 改善案

**空間グリッド（voxel hashing）+ k-NN ボーン探索**

1. 前処理でスプラット座標を `1cm` グリッドにハッシュ化
2. 同一グリッドセル内のスプラットは同一ボーンと仮定（fast と同等の速度）
3. グリッド境界跨ぎは近隣 26 セルまで探索して再評価

```
期待効果: fast=true 時の誤分類率を 30–50% 削減（境界付近の誤りが最も顕著）
計算コスト: ほぼ同等（ハッシュ O(1) vs 前値コピー O(1)）
```

**実装箇所**: `apps/preprocess/preprocess.js` `assignSplatsToBones()` 内部。  
テスト対象: `tests/unit/UT-01_assignSplatsToBones.test.js`

---

## A-2: 方向推定スコアのロバスト性

### 現状 (`apps/preprocess/preprocess.js:L595–L610`)

```js
if (keypoints && keypoints.length > 0) {
  const left = keypoints[15];   // left_wrist
  const right = keypoints[16];  // right_wrist
  if (left && right) {
    score = left.x - right.x;   // L603: wrist X 差分のみ
  }
}
```

**問題**:
- A-pose で前方を向いている場合、left_wrist.x > right_wrist.x となり正しく機能するが、  
  腕を下げているポーズでは差分が小さくなり判別力が落ちる
- スコアの正負の絶対値に意味がなく、スライディングウィンドウ平均との整合性が曖昧

### 改善案

**多キーポイント合成スコア**

```js
// 以下のキーポイントを合成してスコアを計算
//   left_wrist(15).x  - right_wrist(16).x   （腕）
//   left_elbow(13).x  - right_elbow(14).x   （肘）
//   left_hip(23).x    - right_hip(24).x      （腰、最も安定）
// 各スコアを confidence で重み付けして平均
const pairs = [
  [keypoints[15], keypoints[16], 1.0],  // wrist
  [keypoints[13], keypoints[14], 1.0],  // elbow
  [keypoints[23], keypoints[24], 2.0],  // hip (重みを2倍)
];
let totalWeight = 0;
let weightedScore = 0;
for (const [l, r, w] of pairs) {
  if (l && r && l.score > 0.3 && r.score > 0.3) {
    weightedScore += (l.x - r.x) * w;
    totalWeight += w;
  }
}
score = totalWeight > 0 ? weightedScore / totalWeight : -Infinity;
```

**実装箇所**: `findBestAngleInRange()` 内部の score 計算ループ。  
テスト対象: `tests/unit/UT-02_directionScore.test.js`

---

## A-3: finalCheck 失敗閾値の厳格化

### 現状 (`apps/preprocess/check.js:L128, L141`)

```js
if (distance > thresh) {   // L128: thresh=0.15 (画面高さの 15%)
  angleHasError = true;
  break;
}
// ...
if (failedAngles >= 3) {   // L141: 3 角度まで許容
  throw new Error(...);
}
```

**問題**:
- 11 角度のうち 2 角度失敗まで黙認（≈18%のビューで位置ずれを許容）
- `thresh=0.15` は 1080p 画面で約 162px のずれを許容（ハイトが 1080px の場合）  
  → ほぼ1体分のずれが残っても通過する可能性

### 改善案

**段階的 thresh + 許容角度数の調整**

```js
// 主要ビュー（0°, ±30°）は thresh=0.08 で厳しくチェック
// 側面ビュー（±45°, ±60°, ±75°）は thresh=0.15 のまま
// 失敗許容数を 2 → 1 に変更（11 角度の 9%）
const strictAngles = new Set([0, 1, 2, 3, 4, 5]);   // 0°を含む6角度
const strictThresh = 0.08;
const lenientThresh = thresh;   // 0.15

// ... check loop ...
const effectiveThresh = strictAngles.has(i) ? strictThresh : lenientThresh;
if (distance > effectiveThresh) { angleHasError = true; break; }

// ...
if (failedAngles >= 2) {  // 3 → 2 に変更
  throw new Error(...);
}
```

**実装箇所**: `apps/preprocess/check.js` `finalCheck()`.  
テスト対象: `tests/unit/UT-03_finalCheck.test.js`

---

## A-4: splat→vertex one-hot bone 分割の精度

### 現状 (`apps/preprocess/preprocess.js:L140, L164–165`)

```js
// VRM 頂点を最近傍カプセルで hard-assign
boneVertexIndices[capsuleBoneIndex[bestCi]].push(i);

// スプラットはそのボーンに属する頂点の中だけ探索
let boneIndex = gs.splatBoneIndices[i];
let vertexIndices = boneVertexIndices[boneIndex];  // L164
```

**問題**:
- ボーン境界付近にある VRM 頂点が異なるボーンに割り当てられた場合、  
  その境界付近のスプラットは最適な頂点を探索できない
- 例: 肩/上腕境界にあるスプラットが `upperArm` ボーンに属していても、  
  最近接頂点が `neck` のカプセルに assign された場合、その頂点を参照できない

### 改善案

**top-k ボーン候補 + 複合スコア**

```js
// 各 VRM 頂点について上位 2 ボーンを記録
// boneVertexIndices を {boneIndex → vertices} ではなく
// {boneIndex → [{vertexIndex, secondBoneIndex, ...}]} に拡張

// スプラットの探索時: 属するボーン + 隣接ボーンの頂点も候補に追加
const neighborBones = getBoneNeighbors(boneIndex, skeleton);
const candidateVertices = [
  ...boneVertexIndices[boneIndex],
  ...neighborBones.flatMap(b => boneVertexIndices[b] ?? [])
];
```

**実装箇所**: `assignSplatsToPoints()` 内の `boneVertexIndices` 構築部と探索部。  
テスト対象: `tests/unit/UT-04_assignSplatsToPoints.test.js`

---

## A-5: floor/height 検出の精度

### 現状 (`apps/preprocess/preprocess.js:L257, L343`)

```js
// L257: 固定 1cm ビン幅
const binKey = Math.round(-vertex.y * 100);

// L343: 固定 ratio でのフィルタ
if (y / 100 > floorY / 100 + 0.3 && frequency < radiusFilteredVertices.length * 0.00025)
```

**問題**:
- ビン幅が固定 1cm のため、低密度スキャン（スパース点群）ではヒストグラムが粗くなり  
  床位置検出が不安定
- `0.00025` ratio は被写体のスプラット密度に依存しており、  
  密度が高いシーンでは false positive が増える

### 改善案

**パーセンタイルベース床検出 + 適応的ビン幅**

```js
// スプラット数に応じてビン幅を動的調整
// N=1000 未満 → 2cm、1000–10000 → 1cm（現状）、10000 超 → 0.5cm
const binWidthCm = splatCount < 1000 ? 2 : splatCount < 10000 ? 1 : 0.5;

// 空白領域の検出: frequency が 1st percentile 以下のビンを「空白」とみなす
const freqValues = [...frequencyMap.values()].filter(f => f > 0);
freqValues.sort((a, b) => a - b);
const p1 = freqValues[Math.floor(freqValues.length * 0.01)];
const emptyThresh = Math.max(p1, 1);
```

**実装箇所**: `cleanSplats()` 内 `calculateHeights()`.  
テスト対象: `tests/unit/UT-05_calculateHeights.test.js`

---

## A-6: VRM tilt/A-pose 推定の多点化

### 現状 (`apps/preprocess/preprocess.js:L916–925`)

```js
const dx = circleHead.position.x - circle.position.x;
const dy = circleHead.position.y - circle.position.y;
const dz = circleHead.position.z - circle.position.z;
const angleRadians = Math.atan2(dy, dx);  // 2 点のみで tilt を推定
```

**問題**:
- 足重心と頭重心の 2 点だけで傾きを推定するため、  
  片方の重心が外れ値（靴・帽子など）の影響を受けやすい

### 改善案

**多パーセンタイルによる重心安定化**

```js
// 足: 高さ 5%～15% の点群（現状 10%～20%）を複数パーセンタイルで三角形分割
// 頭: 高さ 85%～100%（現状 90%～100%）
// それぞれの重心を 3 点算出し中央値を使用

function robustCentroid(vertices, ratioMin, ratioMax, heights) {
  const samples = [
    { rMin: ratioMin, rMax: ratioMin + (ratioMax - ratioMin) / 3 },
    { rMin: ratioMin + (ratioMax - ratioMin) / 3, rMax: ratioMin + 2 * (ratioMax - ratioMin) / 3 },
    { rMin: ratioMin + 2 * (ratioMax - ratioMin) / 3, rMax: ratioMax },
  ];
  const centroids = samples.map(({ rMin, rMax }) => calcCentroid(vertices, heights, rMin, rMax));
  // 中央値 centroid を返す
  return medianCentroid(centroids);
}
```

**実装箇所**: `calculateCentroidFeet()` および `calculateCentroidHead()`.  
テスト対象: `tests/unit/UT-06_centroidRobustness.test.js`

---

## A-7: ランタイム精度・GPU 正規化・クォータニオン符号バグ

### 現状

**7a. GPU vertex index 正規化 (`apps/preprocess/preprocess_gl.js:L702`)**
```glsl
float vertexIndex = floor(pixelValue * 65535.0 + 0.5);
```
→ 65536 頂点以上の VRM で index overflow

**7b. GPU 座標正規化 (`preprocess_gl.js:L720`)**
```glsl
// 正規化範囲が [-1, 1] に固定
pos = (x + 1.0) / 2.0;
```
→ VRM スケールが異なると精度が落ちる

**7c. クォータニオン符号ハック (`gvrm-format/gvrm.js:L689`)**
```glsl
tempQuat.y = -tempQuat.y;  // Hardcode, maybe bug in quatFromMat3?
```
→ `quatFromMat3` の符号が間違っているなら根本修正が必要

**7d. outlier cleanup の固定閾値 (`gvrm-format/gvrm.js:L155–L166`)**
```js
if (gvrm.gs.splatBoneIndices[i] !== 57 && distance > 0.2)  // 全ボーン共通 0.2m
```
→ 腕や胴体のような長いボーン vs 手首・足首のような短いボーンで同一閾値は不適切

### 改善案

**7a**: `RGBA32Float` テクスチャを使い float 精度で vertex index を格納する  
**7b**: GVRM 保存時に座標 AABB を記録し、シェーダーで動的 unpack する  
**7c**: `quatFromMat3` を単体テストで検証し、符号が正しいことを確認してから `-tempQuat.y` を削除する  
**7d**: ボーンの capsule 半径（`BONE_CONFIG.radius`）の 3 倍を動的閾値にする

**実装箇所**:
- 7a/7b: `apps/preprocess/preprocess_gl.js`
- 7c: `gvrm-format/gvrm.js` `gsCustomizeMaterial()` シェーダー内 `quatFromMat3`
- 7d: `gvrm-format/gvrm.js` `loadGVRM()` cleanup ループ

**テスト対象**: `tests/unit/UT-07_quatFromMat3.test.js`, `tests/unit/UT-08_outlierCleanup.test.js`

---

---

## R: リファクタリング（詳細）

---

## R-1: GVRM.load() 二重ファクトリーパターン

### 現状 (`gvrm-format/gvrm.js:L360-L379`)

```js
async load(url, scene, camera, renderer, fileName=null) {
  const _gvrm = await GVRM.load(url, scene, camera, renderer, fileName);
  // TODO: refactor
  this.character = _gvrm.character;
  this.gs = _gvrm.gs;
  this.modelScale = _gvrm.modelScale;
  // ...計9行の手動コピー
}
```

**問題**: static と instance の二重 load で、新しいフィールドを追加するたびに両方を修正しなければならない。

### 改善案

```js
async load(url, scene, camera, renderer, fileName = null) {
  const _gvrm = await GVRM.load(url, scene, camera, renderer, fileName);
  const copyFields = [
    'character', 'gs', 'modelScale', 'boneOperations',
    'boneSceneMap', 'vertexSceneMap', 'fileName',
    'vrmWorldPosition0', 'vrmWorldQuaternion0',
  ];
  for (const key of copyFields) this[key] = _gvrm[key];
  this.isReady = true;
}
```

**実装箇所**: `gvrm-format/gvrm.js` `GVRM.prototype.load()`.

---

## R-2: 自己代入ノーオプ

### 現状 (`apps/preprocess/preprocess.js:L22`)

```js
if (fast && i % 10 !== 0) {
  bestCi = bestCi;  // CHANGED — 何もしていない
  gs.splatBoneIndices.push(capsuleBoneIndex[bestCi]);
```

**改善案**: 行を削除。

---

## R-3: マジックナンバー散在

### 現状 (`gvrm-format/gvrm.js:L154-L165`)

```js
if (gvrm.gs.splatBoneIndices[i] !== 57 && distance > 0.2)  // exclude head
else if (gvrm.gs.splatBoneIndices[i] == 21 && distance > 0.1)  // left foot
else if (gvrm.gs.splatBoneIndices[i] == 19 && distance > 0.1)  // right foot
```

**問題**: 57/21/19 は VRM モデル依存の bone index。モデルが変わると壊れる。`BONE_CONFIG` 側で bone 名→index の逆引きを持つべき。

### 改善案

- `utils.js` の `BONE_CONFIG` に `thresholdDist` フィールドを追加
- cleanup ループで bone 名ベースに変更
- `pure-logic.js` の `OUTLIER_THRESHOLDS_CURRENT` と統合

---

## R-4: bone 名リストの重複

### 現状

`gvrm.js:L200` の `_traverseNodes()` 内に bone 名リストがハードコードされており、`utils.js:L162` の `BONE_CONFIG` と完全に重複している。

### 改善案

```js
// gvrm.js _traverseNodes() 内
import { BONE_CONFIG } from './utils.js';
const boneNameSet = new Set(Object.values(BONE_CONFIG).flatMap(c => c.names));
if (boneNameSet.has(childNode.name)) { /* ... */ }
```

---

## R-5: デッドコード除去

- `updateByVertices()` — `// deprecated` コメント付き、中身は空。削除可。
- `sortSplatsByVertices()` — 同上。削除可。
- `if (extraData.splatRelativePoses === undefined)` シム (`gvrm.js:L124`) — 旧形式ファイルが存在しなければ削除可。
- コメントアウトされた大量の `console.log` (`preprocess.js` 全体) — 削除推奨。

---

## R-6: cleanSplats() の分割

### 現状 (`apps/preprocess/preprocess.js:L221-L575`)

400 行の `cleanSplats()` に以下の内部関数がネスト:
- `calculateHeights()` (約 80 行)
- `calculateCentroidFeet()` (約 30 行)
- `calculateCentroidHead()` (約 30 行)
- `detectShoes()` (約 100 行)
- `createNewHeader()` (約 8 行)

### 改善案

各内部関数をモジュールスコープまたは別ファイル (`cleanSplats.js`) に移動。
`cleanSplats()` 自体は制御フローのみに専念させる。

---

## R-7: updateExtraData() の O(n²) 配列結合

### 現状 (`gvrm-format/gvrm.js:L435`)

```js
let splatIndices = [];
for (let i = 0; i < Object.keys(sceneSplatIndices).length; i++) {
  splatIndices = splatIndices.concat(sceneSplatIndices[i]);  // 毎回新配列
}
```

### 改善案

```js
const splatIndices = Object.values(sceneSplatIndices).flat();
```

---

## P: 性能改善（詳細）

---

## P-1: gsCustomizeMaterial() — GPU テクスチャ過剰確保

### 現状 (`gvrm-format/gvrm.js:L479-L487`)

```js
const meshPositionData    = new Float32Array(4096 * 1024 * 4);  // 64 MB
const meshNormalData      = new Float32Array(4096 * 1024 * 4);  // 64 MB
const meshSkinIndexData   = new Float32Array(4096 * 1024 * 4);  // 64 MB
const meshSkinWeightData  = new Float32Array(4096 * 1024 * 4);  // 64 MB
const gsMeshVertexIndexData = new Float32Array(4096 * 1024 * 4); // 64 MB
const gsMeshRelativePosData = new Float32Array(4096 * 1024 * 4); // 64 MB
// 合計 384 MB 固定確保
```

**問題**: 頂点数・スプラット数に関わらず 4096×1024 固定。GPU VRAM を浪費し初期化が遅い。

### 改善案

```js
// 必要なテクセル数から最小テクスチャサイズを算出
function calcTexSize(elementCount) {
  const width = 4096;
  const height = Math.ceil(elementCount / width);
  return { width, height };
}

const vtxSize = calcTexSize(meshVertexCount);
const gsSize  = calcTexSize(gs.splatCount);

const meshPositionData = new Float32Array(vtxSize.width * vtxSize.height * 4);
```

シェーダー側の UV 計算も動的サイズに対応する必要あり。

**実装箇所**: `gvrm-format/gvrm.js` `gsCustomizeMaterial()`.

---

## P-2: assignSplatsToBones() — 三重ループ内オブジェクト生成

### 現状 (`apps/preprocess/preprocess.js:L40-L60`)

```js
for (let i = 0; i < gs.splatCount; i++) {
  for (let ci = 0; ci < capsules.children.length; ci++) {
    for (let ii = 0; ii < index.count; ii += 3) {
      let a = new THREE.Vector3();   // 毎ループ生成
      let b = new THREE.Vector3();
      let c = new THREE.Vector3();
      let closestPoint = new THREE.Vector3();
```

50 万スプラット × 14 カプセル × 100 三角形 = 最大 **7 億回** のオブジェクト生成。

### 改善案

```js
// ループ外でプール
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _triangle = new THREE.Triangle();

// ループ内では .set() または .fromBufferAttribute() で使い回す
_a.fromBufferAttribute(position, index.getX(ii));
```

---

## P-3: assignSplatsToPoints() — 骨変換の二重計算

### 現状 (`apps/preprocess/preprocess.js:L102, L207`)

1 パス目（頂点→bone 割当）で `skinnedMesh.applyBoneTransform(i, vertex)` を全頂点に実行し、
2 パス目（`splatRelativePoses` 計算）でも同じ変換を再実行している。

### 改善案

```js
// 1パス目の結果を配列にキャッシュ
const skinnedVertexCache = new Float32Array(position.count * 3);
for (let i = 0; i < position.count; i++) {
  const sv = skinnedMesh.applyBoneTransform(i, ...);
  sv.applyMatrix4(...);
  skinnedVertexCache[i * 3 + 0] = sv.x;
  // ...
}
// 2パス目はキャッシュを参照
```

---

## P-4: updateByBones() — フレーム毎の clone()/invert()

### 現状 (`gvrm-format/gvrm.js:L336`)

```js
tempMat.extractRotation(
  childBone.matrixWorld.multiply(
    childBone.matrixWorld0.clone().invert()  // 毎フレーム全ボーン分
  )
);
```

### 改善案

```js
// コンストラクタ or updateByBones 先頭でプール
// ─ 既に tempMat/tempQuat 等はプール済みなので同様に
const _invMat0 = new THREE.Matrix4();

// ループ内
_invMat0.copy(childBone.matrixWorld0).invert();
tempMat.extractRotation(childBone.matrixWorld).multiply(_invMat0);
```

---

## P-5: PLYParser — DataView ループ

### 現状 (`gvrm-format/ply.js:L130`)

```js
for (let i = 0; i < this.vertexCount; i++) {
  value = data.getFloat32(offset + propertyOffset, true);  // DataView 毎アクセス
```

### 改善案

ボディが全 float32 の場合、typed array view で O(1) アクセスに変換:

```js
const floatView = new Float32Array(arrayBuffer, bodyOffset);
// floatView[i * propCount + j] で直接読む
```

---

## P-6: detectShoes() — 孤立セル検出 O(n²)

### 現状 (`apps/preprocess/preprocess.js:L468`)

103×103 グリッドを二重ループで全セル走査しながら隣接チェック。

### 改善案

BFS（幅優先探索）に変換することで O(cells) に改善:

```js
function floodFillKeep(frequencyMap, startKey) {
  const queue = [startKey];
  const visited = new Set();
  while (queue.length) {
    const key = queue.shift();
    if (visited.has(key)) continue;
    visited.add(key);
    const [x, z] = key.split(',').map(Number);
    for (const [dx, dz] of neighbors) {
      const nk = `${x+dx},${z+dz}`;
      if (frequencyMap.get(nk)?.keep) queue.push(nk);
    }
  }
  return visited;
}
```

---

## P-7: Blob URL 未解放

### 現状 (`gvrm-format/gvrm.js:L112-L119`)

```js
const vrmUrl = URL.createObjectURL(vrmBlob);
const plyUrl = URL.createObjectURL(plyBlob);
// ロード完了後に revokeObjectURL していない
```

### 改善案

```js
try {
  const character = await GVRM.initVRM(vrmUrl, ...);
  const gs = await GVRM.initGS(sceneUrls, ...);
} finally {
  URL.revokeObjectURL(vrmUrl);
  URL.revokeObjectURL(plyUrl);
  sceneUrls.forEach(u => URL.revokeObjectURL(u));
}
```

---

## Q: 人物表現品質（詳細）

---

## Q-1: single bone 割当 → weighted multi-bone

### 現状 (`apps/preprocess/preprocess.js:L14-L84`)

各 splat を最も近いカプセル **1 本だけ** に割り当てている。肩・股関節・首・手首などの骨境界で割当が急変し、アニメーション時に裂け・段差・硬い変形が生じる。

### 改善案

- 最近傍 1 bone ではなく top-k bone weights を保存
- 距離に応じた inverse distance weighting で weight を算出
- splat ごとに `{boneIndex, weight}[]` を複数保持
- shader 側で複数 bone の変形をブレンド（LBS: Linear Blend Skinning）

```js
// 前処理側（概念コード）
const TOP_K = 2;
const topBones = getSortedCapsuleDistances(targetPoint, capsules).slice(0, TOP_K);
const totalInvDist = topBones.reduce((s, b) => s + 1 / b.dist, 0);
gs.splatBoneWeights.push(...topBones.map(b => ({ index: b.ci, weight: (1 / b.dist) / totalInvDist })));
```

**効果**: 肩・脇・股関節・首まわりのアニメーション変形がかなり自然になる。

---

## Q-2: 最近傍頂点 bind → 三角形 barycentric bind

### 現状 (`apps/preprocess/preprocess.js:L155-L190`)

各 splat を最も近い VRM **頂点 1 点** に結びつけている。頂点密度が低い部位ではガタつきが出る。

### 改善案

- 最近傍頂点ではなく **最近傍三角形** を探す
- 三角形の 3 頂点 ID と barycentric weights を保存
- shader で 3 頂点の skinned position / normal を補間
- `splatRelativePoses` も三角形ローカル座標で持つ

```js
// 三角形探索
const tri = new THREE.Triangle();
tri.set(v0, v1, v2);
const bary = new THREE.Vector3();
tri.getBarycoord(targetPoint, bary);  // u, v, w

gs.splatVertexTriangles.push(idx0, idx1, idx2);
gs.splatBaryWeights.push(bary.x, bary.y, bary.z);
```

**効果**: 服・腕・胴体の表面追従が滑らかになり、頂点単位のガタつきが減る。品質改善としては最も効果が大きい。

---

## Q-3: 法線方向を使った splat 割当

### 現状

距離のみで割当を決めているため、腕が胴体に近い A-pose では腕の splat が胴体側の頂点に吸われやすい。

### 改善案

- VRM 頂点 normal と「候補頂点 → splat」の方向ベクトルのドット積を距離スコアに加算
- 裏面方向（dot < 0）の頂点はスコアを大幅に下げる
- 部位別に normal alignment の重みを調整

```js
const toSplat = new THREE.Vector3().subVectors(targetPoint, skinnedVertex).normalize();
const normalAlignment = normal.dot(toSplat);  // -1 〜 1
const score = distance - 0.1 * normalAlignment;  // 裏面は距離+0.1m 相当のペナルティ
```

**効果**: 腕と胴体、足と床、顔と後頭部の誤割当が減る。

---

## Q-4: outlier cleanup を bone index から bone 名ベースに変更

### 現状 (`gvrm-format/gvrm.js:L154-L166`)

```js
if (gvrm.gs.splatBoneIndices[i] !== 57 && distance > 0.2)  // 57 は head (VRM依存)
```

### 改善案

- `BONE_CONFIG` に `cleanupDist` フィールドを追加
- cleanup ループで humanoid bone 名で引く
- 距離だけでなく alpha falloff（急に切らず sigmoid で fade）に変える

```js
const BONE_CLEANUP_DIST = {
  default: 0.20,
  J_Bip_C_Head: 0.30,
  J_Bip_L_Foot: 0.10,
  J_Bip_R_Foot: 0.10,
  J_Bip_L_Hand: 0.10,
  J_Bip_R_Hand: 0.10,
};

// cleanup は bone 名で引く
const boneName = boneNameByIndex[boneIndex];  // skeleton.bones[i].name
const thresh = BONE_CLEANUP_DIST[boneName] ?? BONE_CLEANUP_DIST.default;
// sigmoid fade
const alpha = 1.0 / (1.0 + Math.exp((distance - thresh) * 30));
gs.colors[i * 4 + 3] *= alpha;
```

**効果**: VRM モデルが変わっても品質が安定する。頭・足・手先の消えすぎ/残りすぎを抑えられる。

---

## Q-5: cleanSplats() の人物セグメンテーション強化

### 現状 (`apps/preprocess/preprocess.js:L221-L575`)

高さ・半径・靴検出ベースの単純な背景除去。スカート・袖・髪・足先などの境界部に弱い。

### 改善案

- 円柱フィルタに加え 3D **connected component** を使う
- floor plane を RANSAC で推定し、垂直方向に対してフィルタ
- 背景除去を binary remove ではなく **confidence score 化** する
- 部位別閾値（頭・腕・足）を持つ
- `nobg` 時でも背景 splat に低 alpha を残す選択肢を追加

**効果**: 髪、服の裾、靴、指先が欠けにくくなる。スキャン品質のばらつきに対してロバストになる。

---

## Q-6: 正面推定を全身スコア化

### 現状 (`apps/preprocess/preprocess.js:L600-L647`)

```js
score = left.x - right.x;  // wrist の左右差分のみ
```

### 改善案（A-2 と同義。A-2 の実装で解決される）

肩・腰・膝・足首・鼻を含む全身スコアに変更することで、手が隠れる・腕が下がるケースでも正面推定が安定する。詳細は **A-2** を参照。

---

## Q-7: finalCheck を pass/fail から局所補正に活用

### 現状 (`apps/preprocess/check.js:L10-L152`)

11 角度で VRM capsule と検出 keypoint のずれを評価しているが、「通過」か「失敗 → エラー」の 2 択しかない。

### 改善案

- 頭・手・足の screen error から `boneOperations` を微調整するフィードバックループを追加
- 角度ごとの誤差を 3D 補正方向に逆投影
- 最大 3 イテレーション反復して収束させる
- `data.json` に alignment score を保存してデバッグに使う

**効果**: A-pose が少し崩れた入力でも VRM と splat の重なりが良くなる。

---

## Q-8: covariance 回転の hardcode を除去

### 現状 (`gvrm-format/gvrm.js:L689`)

```glsl
tempQuat.y = -tempQuat.y;  // Hardcode, maybe bug in quatFromMat3?
```

**問題**: `quatFromMat3` の実装が正しければ不要なはず。暫定のまま残っており、特定のアニメーションで splat の伸び方がおかしくなる原因になりうる。

### 改善案（A-7c と同義。A-7 の実装で解決される）

- `quatFromMat3` を CPU の `Quaternion.fromMat3RowMajor()` と比較する単体テストで検証
- 一致すれば `-tempQuat.y` を削除
- 不一致なら GLSL 実装を修正してから削除

詳細は **A-7c** を参照。

---

## Q-9: 顔・手・足の部位専用ロジック

### 現状

全身を同一ルールで割り当てている。人物表現で目立つのは顔・手・足だが、専用処理がない。

### 改善案

| 部位 | 問題 | 改善 |
|------|------|------|
| 顔 | head bone 近傍で距離閾値が厳しく消えやすい | cleanup 閾値を緩く (→ Q-4 で解決) |
| 手 | wrist/hand の capsule が細く誤割当しやすい | 手メッシュ頂点を優先した探索 |
| 足 | floor cleanup と足先 cleanup が混在 | 床除去と足底セグメンテーションを分離 |
| 髪 | head bone だけでなく chest 側に吸着 | normal alignment 追加 (→ Q-3 で解決) |

---

## Q-10: preprocessing profile の動的切替

### 現状

`distXZ`, `distY`, `thresh` 等が固定気味で、スキャン品質・服の広がり・髪型・背景ノイズによって最適値が変わる。

### 改善案

```js
// スキャン診断から profile を選択
const profile = selectProfile({
  splatCount: plyData.vertexCount,
  heightRange: heights.max - heights.min,
  outerRingRatio,
  poseConfidence: avgKeyPointScore,
});
// profile: 'tight' | 'normal' | 'loose'
const params = PREPROCESSING_PROFILES[profile];
```

`data.json` に診断結果と使用プロファイルを保存してデバッグに活用する。

---

## 実装順序（推奨）

**アルゴリズム精度（A 系）:**
1. **テストを先に書く（RED）** → `tests/unit/` 以下のすべてのテストを作成し、失敗することを確認
2. A-7c: `quatFromMat3` のバグを修正（リスク最小・効果最大）
3. A-2 / Q-6: direction score の多キーポイント化
4. A-3: finalCheck 閾値の厳格化
5. A-5: height detection 適応的ビン幅
6. A-1: splat→bone fast mode の空間グリッド化
7. A-4 / Q-2: splat→vertex の隣接ボーン探索と barycentric bind

**人物品質（Q 系）:**
8. Q-4: outlier cleanup を bone 名ベースに変更（A-7d と重複）
9. Q-3: 法線方向を割当スコアに加算
10. Q-1: multi-bone weighted skinning
11. Q-7: finalCheck を局所補正に活用

**リファクタリング / 性能（R 系 / P 系）:**
12. P-1: GPU テクスチャサイズの動的化（VRAM 節約・最重要）
13. P-2: 三重ループのオブジェクトプール化
14. P-4: updateByBones() の clone() 削減
15. R-4, R-5: bone 名重複・デッドコード除去
16. R-1, R-6: load() リファクタリング・cleanSplats() 分割
17. P-7: Blob URL リーク修正

---

## リスク管理

- `gvrm-format/gvrm.js` の shader 変更はブラウザでの手動確認が必要
- `preprocess_gl.js` の変更は GPU パスのみ影響、CPU パス (`preprocess.js`) は別途テスト
- Q-1 / Q-2 は `data.json` のスキーマが変わるため、既存 `.gvrm` ファイルとの後方互換に注意
- すべての改善は **対応するテストが GREEN になってから** コミットすること
