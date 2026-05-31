# アルゴリズム改善提案

> 本ドキュメントは ML を用いず**アルゴリズム上の精度改善**が見込まれる箇所を記録したものです。
> 実装前にすべての対象関数に対してテスト（RED）を用意してから修正してください（TDD 原則）。

---

## 優先度マップ

| # | 領域 | ファイル:行 | 現状の問題 | 優先度 |
|---|------|------------|-----------|--------|
| 1 | splat→bone fast mode | `preprocess.js:20` | 9/10 のスプラットが前の結果をコピー | 高 |
| 2 | direction estimation | `preprocess.js:600-603` | wrist X 座標差分のみでスコア計算 | 高 |
| 3 | finalCheck 失敗判定 | `check.js:141` | 3 角度失敗まで許容しすぎ | 中 |
| 4 | splat→vertex one-hot | `preprocess.js:86-220` | bone 境界付近のスプラットが最適頂点を見逃す | 中 |
| 5 | floor/height detection | `preprocess.js:257` | 固定 1cm ビン幅・magic ratio | 中 |
| 6 | VRM tilt/A-pose | `preprocess.js:916-925, 961, 995` | 2 点重心のみで tilt 推定 | 低 |
| 7 | runtime precision | `gvrm.js:689`, `preprocess_gl.js:702,720,745` | GPU 正規化精度・クォータニオン符号バグ | 低 |

---

## 改善 1: splat→bone fast mode の精度低下

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

## 改善 2: 方向推定スコアのロバスト性

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

## 改善 3: finalCheck 失敗閾値の厳格化

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

## 改善 4: splat→vertex one-hot bone 分割の精度

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

## 改善 5: floor/height 検出の精度

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

## 改善 6: VRM tilt/A-pose 推定の多点化

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

## 改善 7: ランタイム精度・GPU 正規化・クォータニオン符号バグ

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

## 実装順序（推奨）

1. **テストを先に書く（RED）** → `tests/unit/` 以下のすべてのテストを作成し、失敗することを確認
2. 改善 7c: `quatFromMat3` のバグを修正（リスク最小・効果最大）
3. 改善 2: direction score の多キーポイント化（前処理の方向精度向上）
4. 改善 3: finalCheck 閾値の厳格化（品質ゲートの改善）
5. 改善 5: height detection 適応的ビン幅（床検出安定化）
6. 改善 1: splat→bone fast mode の空間グリッド化
7. 改善 4: splat→vertex の隣接ボーン探索
8. 改善 6: 重心安定化（最リスクが小さく単体テストしやすい）
9. 改善 7a/7b/7d: GPU 精度・outlier 閾値（GPU は手動ブラウザ確認必須）

---

## リスク管理

- `gvrm-format/gvrm.js` の shader 変更はブラウザでの手動確認が必要
- `preprocess_gl.js` の変更は GPU パスのみ影響、CPU パス (`preprocess.js`) は別途テスト
- すべての改善は **対応するテストが GREEN になってから** コミットすること
