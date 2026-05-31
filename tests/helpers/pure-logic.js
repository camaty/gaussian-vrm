/**
 * preprocess.js から DOM・WebGL・async I/O に依存しない純粋ロジックを抽出します。
 * テスト専用モジュール — 本番コードからはインポートしないでください。
 *
 * 各関数は元のコードと完全に同一のアルゴリズムです。
 * テストが GREEN になってから本体に反映してください。
 */

// -----------------------------------------------------------------------
// 改善 1 テスト対象: assignSplatsToBones fast mode
// preprocess.js:L14-L84 のアルゴリズムコア
// -----------------------------------------------------------------------

/**
 * 各スプラットに最近接カプセルのボーンインデックスを割り当てる
 * (DOM/Three.js なし版: capsuleDistance 関数を注入)
 *
 * @param {number} splatCount
 * @param {number[]} splatBoneSeeds - 初期ボーンインデックス (長さ splatCount, -1 で未割当)
 * @param {function(i: number): number} getCapsuleDistance - (splatIndex, capsuleIndex) => distance
 * @param {number} capsuleCount
 * @param {number[]} capsuleBoneIndex - capsule index → bone index のマップ
 * @param {boolean} fast
 * @returns {number[]} splatBoneIndices
 */
export function assignSplatsBonesPure(
  splatCount, getCapsuleDistance, capsuleCount, capsuleBoneIndex, fast = false
) {
  const result = [];
  for (let i = 0; i < splatCount; i++) {
    if (fast && i % 10 !== 0) {
      result.push(result[i - 1]);
      continue;
    }

    let minDistance = Infinity;
    let bestCi = 0;
    for (let ci = 0; ci < capsuleCount; ci++) {
      const d = getCapsuleDistance(i, ci);
      if (d < minDistance) { minDistance = d; bestCi = ci; }
    }
    result.push(capsuleBoneIndex[bestCi]);
  }
  return result;
}

// -----------------------------------------------------------------------
// 改善 2 テスト対象: direction score 計算
// preprocess.js:L595-L610 のスコア計算コア
// -----------------------------------------------------------------------

/**
 * 1 カメラ角度での「正面向きスコア」を計算します。
 * keypoints[15] = left_wrist, keypoints[16] = right_wrist
 *
 * @param {Array<{x: number, y: number, score: number}|null>} keypoints
 * @returns {number} score (正面向きほど大 → left.x > right.x)
 */
export function computeDirectionScoreCurrent(keypoints) {
  if (!keypoints || keypoints.length === 0) return -Infinity;
  const left = keypoints[15];
  const right = keypoints[16];
  if (left && right) return left.x - right.x;
  return -Infinity;
}

/**
 * 改善版: 複数キーポイント（wrist/elbow/hip）を合成した方向スコア。
 * confidence が低いキーポイントは自動除外します。
 *
 * @param {Array<{x: number, y: number, score: number}|null>} keypoints
 * @param {number} minConfidence
 * @returns {number} score
 */
export function computeDirectionScoreImproved(keypoints, minConfidence = 0.3) {
  if (!keypoints || keypoints.length === 0) return -Infinity;
  const pairs = [
    [15, 16, 1.0],   // wrist
    [13, 14, 1.0],   // elbow
    [23, 24, 2.0],   // hip (最も安定)
  ];
  let totalWeight = 0;
  let weightedScore = 0;
  for (const [li, ri, w] of pairs) {
    const l = keypoints[li];
    const r = keypoints[ri];
    if (l && r && l.score > minConfidence && r.score > minConfidence) {
      weightedScore += (l.x - r.x) * w;
      totalWeight += w;
    }
  }
  return totalWeight > 0 ? weightedScore / totalWeight : -Infinity;
}

// -----------------------------------------------------------------------
// 改善 3 テスト対象: finalCheck 失敗判定ロジック
// check.js:L128, L141 のコア
// -----------------------------------------------------------------------

/**
 * 複数角度の body part 距離リストに対して最終チェックを実行します。
 * DOM/Three.js なし版。
 *
 * @param {Array<{angle: number, checks: Array<{name: string, distance: number|null}>}>} angleResults
 * @param {number} thresh
 * @param {number} maxFailedAngles - この数以上失敗したら throw
 * @returns {{ failedAngles: number, passed: boolean }}
 */
export function runFinalCheckPure(angleResults, thresh = 0.15, maxFailedAngles = 3) {
  let failedAngles = 0;
  for (const { checks } of angleResults) {
    let angleHasError = false;
    for (const check of checks) {
      if (check.distance === null || check.distance > thresh) {
        angleHasError = true;
        break;
      }
    }
    if (angleHasError) failedAngles++;
  }
  const passed = failedAngles < maxFailedAngles;
  return { failedAngles, passed };
}

/**
 * 改善版: 角度によって thresh を変える（主要ビューは厳しく）。
 *
 * @param {Array<{angle: number, checks: Array<{name: string, distance: number|null}>}>} angleResults
 * @param {Set<number>} strictIndices - 厳格 thresh を適用する角度インデックスのセット
 * @param {number} strictThresh
 * @param {number} lenientThresh
 * @param {number} maxFailedAngles
 */
export function runFinalCheckImproved(
  angleResults,
  strictIndices = new Set([3, 4, 5, 6, 7]),  // ±15°, 0°, ...
  strictThresh = 0.08,
  lenientThresh = 0.15,
  maxFailedAngles = 2
) {
  let failedAngles = 0;
  for (let i = 0; i < angleResults.length; i++) {
    const { checks } = angleResults[i];
    const thresh = strictIndices.has(i) ? strictThresh : lenientThresh;
    let angleHasError = false;
    for (const check of checks) {
      if (check.distance === null || check.distance > thresh) {
        angleHasError = true;
        break;
      }
    }
    if (angleHasError) failedAngles++;
  }
  return { failedAngles, passed: failedAngles < maxFailedAngles };
}

// -----------------------------------------------------------------------
// 改善 5 テスト対象: calculateHeights histogram コア
// preprocess.js:L257-L310
// -----------------------------------------------------------------------

/**
 * 点群からヒストグラム差分で床 Y 座標を検出します。
 * DOM/async なし版。
 *
 * @param {Array<{x: number, y: number, z: number}>} vertices  (GS 座標: Y 軸上向き反転)
 * @param {number} N  前後 N ビンの差分ウィンドウ
 * @param {{kneeHeight?: number}|null} hints
 * @returns {{ floorY: number, emptySpaceY: number }}
 */
export function calculateHeightsPure(vertices, N = 5, hints = null) {
  const yCoords = vertices.map(v => Math.round(-v.y * 100));
  if (yCoords.length === 0) throw new Error("no vertices");

  const minY = Math.min(...yCoords) - N;
  const maxY = Math.max(...yCoords) + N;

  const frequencyMap = new Map();
  for (let y = minY; y <= maxY; y++) frequencyMap.set(y, 0);
  for (const y of yCoords) frequencyMap.set(y, (frequencyMap.get(y) ?? 0) + 1);

  const sortedYCoords = [...frequencyMap.entries()].sort(([a], [b]) => a - b);

  let floorY = minY + N;
  let maxDifference = -Infinity;

  for (let i = N; i < sortedYCoords.length - N + 1; i++) {
    const currentY = sortedYCoords[i][0];
    if (hints && hints.kneeHeight !== undefined && currentY / 100.0 > hints.kneeHeight) continue;

    let lowerSum = 0;
    for (let j = 0; j < N; j++) lowerSum += sortedYCoords[i - N + j][1];
    let upperSum = 0;
    for (let j = 0; j < N; j++) upperSum += sortedYCoords[i + j][1];

    const difference = upperSum - lowerSum;
    if (difference > maxDifference) {
      maxDifference = difference;
      floorY = sortedYCoords[i + 1][0];
    }
  }

  if (maxDifference === -Infinity) throw new Error("calculateHeights: maxDifference is -Infinity");

  let emptySpaceY = maxY - N;
  for (const [y, frequency] of sortedYCoords) {
    if (y / 100 > floorY / 100 + 0.3 && frequency < vertices.length * 0.00025) {
      emptySpaceY = y;
      break;
    }
  }

  return { floorY: floorY / 100, emptySpaceY: emptySpaceY / 100 };
}

// -----------------------------------------------------------------------
// 改善 7c テスト対象: quatFromMat3 — GLSL を JS で再現
// gvrm-format/gvrm.js:L686-L689 の `quatFromMat3` 相当
// -----------------------------------------------------------------------

/**
 * 3×3 回転行列（column-major flat array, Three.js mat3 layout）からクォータニオンを計算。
 * GLSL `quatFromMat3` と同じロジック（`tempQuat.y = -tempQuat.y` なし）。
 *
 * @param {number[]} m  9 要素 column-major: [m00,m10,m20, m01,m11,m21, m02,m12,m22]
 * @returns {{ x: number, y: number, z: number, w: number }}
 */
export function quatFromMat3ColMajor(m) {
  // Three.js の mat3 は column-major:
  // m[0]=m00, m[1]=m10, m[2]=m20, m[3]=m01, m[4]=m11, m[5]=m21, m[6]=m02, m[7]=m12, m[8]=m22
  const m00=m[0], m10=m[1], m20=m[2];
  const m01=m[3], m11=m[4], m21=m[5];
  const m02=m[6], m12=m[7], m22=m[8];
  const trace = m00 + m11 + m22;
  let x, y, z, w;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s; x = 0.25 * s;
    y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s; x = (m01 + m10) / s;
    y = 0.25 * s;        z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s; x = (m02 + m20) / s;
    y = (m12 + m21) / s; z = 0.25 * s;
  }
  const len = Math.sqrt(x*x + y*y + z*z + w*w);
  return { x: x/len, y: y/len, z: z/len, w: w/len };
}

// -----------------------------------------------------------------------
// 改善 7d テスト対象: outlier cleanup 距離判定
// gvrm-format/gvrm.js:L155-L166
// -----------------------------------------------------------------------

/** ボーン別の outlier 距離閾値テーブル（現状の固定値） */
export const OUTLIER_THRESHOLDS_CURRENT = {
  head: { boneIndex: 57, threshold: 0.3 },
  leftFoot: { boneIndex: 21, threshold: 0.1 },
  rightFoot: { boneIndex: 19, threshold: 0.1 },
  default: { threshold: 0.2 },
};

/**
 * outlier cleanup: スプラットが対応ボーンから遠すぎるか判定
 *
 * @param {number} boneIndex
 * @param {number} distance
 * @param {object} thresholds  OUTLIER_THRESHOLDS_CURRENT と同じ形式
 * @returns {boolean} true = outlier (alpha を 0 にする)
 */
export function isOutlierSplat(boneIndex, distance, thresholds = OUTLIER_THRESHOLDS_CURRENT) {
  if (boneIndex === thresholds.head.boneIndex)      return distance > thresholds.head.threshold;
  if (boneIndex === thresholds.leftFoot.boneIndex)  return distance > thresholds.leftFoot.threshold;
  if (boneIndex === thresholds.rightFoot.boneIndex) return distance > thresholds.rightFoot.threshold;
  return distance > thresholds.default.threshold;
}

/**
 * outlier cleanup バッチ適用
 *
 * @param {Float32Array} splatRelativePoses  [x0,y0,z0, x1,y1,z1, ...]
 * @param {number[]} splatBoneIndices
 * @param {Float32Array} colors  RGBA flat array
 * @param {object} thresholds
 * @returns {number} 削除されたスプラット数
 */
export function applyOutlierCleanup(splatRelativePoses, splatBoneIndices, colors, thresholds = OUTLIER_THRESHOLDS_CURRENT) {
  let removed = 0;
  for (let i = 0; i < splatBoneIndices.length; i++) {
    const dx = splatRelativePoses[i * 3 + 0];
    const dy = splatRelativePoses[i * 3 + 1];
    const dz = splatRelativePoses[i * 3 + 2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (isOutlierSplat(splatBoneIndices[i], distance, thresholds)) {
      colors[i * 4 + 3] = 0;
      removed++;
    }
  }
  return removed;
}

// -----------------------------------------------------------------------
// ユーティリティ: detectShoes grid ロジックコア
// preprocess.js:L430-L510
// -----------------------------------------------------------------------

/**
 * XZ グリッドセルの連結性チェック（孤立グリッドを除去）
 *
 * @param {Map<string, {sum: number, count: number, keep: boolean, mean: number}>} frequencyMap
 * @param {number} isolationThreshold  隣接 keep=false が何個以上で削除するか (default: 5)
 */
export function pruneIsolatedGridCells(frequencyMap, isolationThreshold = 5) {
  for (let x = -51; x <= 51; x++) {
    for (let z = -51; z <= 51; z++) {
      const key = `${x},${z}`;
      const cell = frequencyMap.get(key);
      if (!cell || !cell.keep) continue;

      let nonKeepNeighbors = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) continue;
          const neighbor = frequencyMap.get(`${x + dx},${z + dz}`);
          if (!neighbor || !neighbor.keep) nonKeepNeighbors++;
        }
      }
      if (nonKeepNeighbors >= isolationThreshold) {
        cell.keep = false;
      }
    }
  }
}

// -----------------------------------------------------------------------
// ユーティリティ: addChannels (gvrm-format/utils.js から)
// -----------------------------------------------------------------------

/**
 * @param {ArrayLike<number>} fromArray
 * @param {Float32Array} toArray
 * @param {number} count
 * @param {number} N  省略チャンネル数 (0..3)
 */
export function addChannels(fromArray, toArray, count, N = 1) {
  for (let i = 0; i < count; i++) {
    toArray[i * 4 + 0] = N > 3 ? 1.0 : fromArray[i * (4 - N) + 0];
    toArray[i * 4 + 1] = N > 2 ? 1.0 : fromArray[i * (4 - N) + 1];
    toArray[i * 4 + 2] = N > 1 ? 1.0 : fromArray[i * (4 - N) + 2];
    toArray[i * 4 + 3] = N > 0 ? 1.0 : fromArray[i * (4 - N) + 3];
  }
}

// -----------------------------------------------------------------------
// ユーティリティ: sortSplatsByBones (gvrm-format/gvrm.js から)
// -----------------------------------------------------------------------

/**
 * @param {{ splatBoneIndices: number[], splatVertexIndices: number[], splatRelativePoses: number[] }} extraData
 * @returns {{ sceneSplatIndices: Object, boneSceneMap: Object }}
 */
export function sortSplatsByBonesPure(extraData) {
  const sceneSplatIndices = {};
  let sceneCount = 0;
  const boneSceneMap = {};

  for (let i = 0; i < extraData.splatBoneIndices.length; i++) {
    const boneIndex = extraData.splatBoneIndices[i];
    if (boneSceneMap[boneIndex] === undefined) {
      boneSceneMap[boneIndex] = sceneCount;
      sceneCount++;
      sceneSplatIndices[boneSceneMap[boneIndex]] = [];
    }
    sceneSplatIndices[boneSceneMap[boneIndex]].push(i);
  }
  return { sceneSplatIndices, boneSceneMap };
}

/**
 * @param {{ splatBoneIndices: number[], splatVertexIndices: number[], splatRelativePoses: number[] }} extraData
 * @param {Object} sceneSplatIndices
 */
export function updateExtraDataPure(extraData, sceneSplatIndices) {
  const splatVertexIndices = [];
  const splatBoneIndices = [];
  const splatRelativePoses = [];

  for (const sceneIndex of Object.keys(sceneSplatIndices)) {
    for (const splatIndex of sceneSplatIndices[sceneIndex]) {
      splatVertexIndices.push(extraData.splatVertexIndices[splatIndex]);
      splatBoneIndices.push(extraData.splatBoneIndices[splatIndex]);
      splatRelativePoses.push(
        extraData.splatRelativePoses[splatIndex * 3],
        extraData.splatRelativePoses[splatIndex * 3 + 1],
        extraData.splatRelativePoses[splatIndex * 3 + 2]
      );
    }
  }

  extraData.splatVertexIndices = splatVertexIndices;
  extraData.splatBoneIndices = splatBoneIndices;
  extraData.splatRelativePoses = splatRelativePoses;
}
