/**
 * algorithm-overview.js
 *
 * Gaussian-VRM 前処理パイプラインのアルゴリズム概要とアーキテクチャを
 * 実コードに対応した疑似コードで示すリファレンスファイル。
 *
 * 実装の場所:
 *   apps/preprocess/preprocess.js  … メインパイプライン
 *   apps/preprocess/pose.js        … BlazePose ラッパー
 *   apps/preprocess/check.js       … finalCheck
 *   gvrm-format/utils.js           … ボーンカプセル生成・ボーン操作
 *   gvrm-format/gvrm.js            … GS / VRM ローダー・セーバー
 *   apps/preprocess/preprocess_gl.js … GPU 版割り当て
 */


// ─────────────────────────────────────────────────────────────────────────────
// §1  システム全体のデータフロー
// ─────────────────────────────────────────────────────────────────────────────
//
//   入力
//     vrmPath  … A-pose VRM モデル（必須）
//     gsPath   … ガウシアンスプラットスキャン PLY
//
//   出力 (.gvrm = ZIP)
//     model.vrm   … スケール調整済み VRM
//     model.ply   … 背景除去済みスプラット
//     data.json   … splatBoneIndices / splatVertexIndices /
//                    splatRelativePoses / boneOperations / modelScale
//
//   パイプライン  ─ stage パラメータで早期スキップ可 (?stage=N)
//
//     [Stage 0]  cleanSplats()            背景除去・高さ/重心検出
//     [Stage 0]  findBestAngleInRange()   BlazePose で正面方向推定
//     [Stage 0]  VRM スケール/位置合わせ
//     [Stage 0]  傾き補正
//     [Stage 0]  地面検証
//     [Stage 0/2] boneOperations 算出     腕/脚回転をキーポイントから逆算
//     [Stage 0/2] finalCheck()            11 アングルで整合性検証
//     [Stage 0/2/3] Splat 割り当て        CPU または GPU (?gpu)
//


// ─────────────────────────────────────────────────────────────────────────────
// §2  メインパイプライン   apps/preprocess/preprocess.js: preprocess()
// ─────────────────────────────────────────────────────────────────────────────

async function preprocess(vrmPath, gsPath, scene, camera, renderer,
                          stage, useGPU, hints) {

  // ── Step 1: 背景除去 ─────────────────────────────────────────────────────
  //   実装: cleanSplats()  L221
  //
  //   ① PLY 全頂点の Y 座標ヒストグラムを作成し、
  //      密度の谷を見つけて床面 (floorY) と人物高さ (heights.max) を推定。
  //   ② XZ 平面でキャラクター周囲の半径 distXZ を推定し、
  //      その円の内側にある頂点のみ「前景」として残す。
  //   ③ 足元重心 centroid / 頭重心 centroidHead を算出。
  //   ④ 前景 PLY と背景 PLY を別ファイルとして出力。
  const { urls: gsPaths, centroid, heights, distXZ, centroidHead }
    = await cleanSplats(gsPath);
  gsPath = gsPaths[0];  // 前景のみ以降で使用


  // ── Step 2: スケール合わせ ───────────────────────────────────────────────
  //   実装: preprocess() L776
  //
  //   VRM の bbox 高さとスキャン人物の高さの比でスケールを決定し VRM を再ロード。
  //   PLY シーンの原点を VRM の足元 (character.ground) に揃える。
  //
  //   vrmScale = (heights.max - heights.min) / (-character.ground * 2 + 0.05)
  const vrmScale = (heights.max - heights.min) / (-character.ground * 2 + 0.05);
  character = await GVRM.initVRM(vrmPath, scene, camera, renderer, vrmScale);
  gs.scene.position.y = character.ground - heights.min;  // Y 原点合わせ
  gs.scene.position.x += centroid.x;                     // XZ 原点合わせ
  gs.scene.position.z -= centroid.z;


  // ── Step 3: 正面方向の推定 ───────────────────────────────────────────────
  //   実装: findBestAngleInRange() L577
  //
  //   カメラを人物周囲に配置してレンダリングし、
  //   BlazePose の両手首スコアが最大になるアングルを選ぶ（正面＝左右対称）。
  //
  //   score(angle) = left_wrist.x − right_wrist.x
  //               … 正面を向くとき最大になる
  //
  //   粗探索 (360° / 12 ステップ) → 微探索 (±18° / 12 ステップ) の 2 段階。
  const coarseResult = await findBestAngleInRange(0, 2*Math.PI, 12);
  const fineResult   = await findBestAngleInRange(
    coarseResult.angle - Math.PI/10, coarseResult.angle + Math.PI/10, 12);

  gs.scene.rotation.y = -fineResult.angle;  // PLY を正面向きに回転


  // ── Step 4: 傾き補正 ────────────────────────────────────────────────────
  //   実装: preprocess() L914
  //
  //   足元重心と頭重心のベクトルから前後・左右の傾きを求め VRM に適用。
  const dx = centroidHead.x - centroid.x;
  const dy = centroidHead.y - centroid.y;
  const dz = centroidHead.z - centroid.z;
  character.scene.rotation.x = Math.atan2(dz, dy);         // 前後傾き
  character.scene.rotation.z = Math.PI*0.5 - Math.atan2(dy, dx); // 左右傾き


  // ── Step 5: 地面検証 ────────────────────────────────────────────────────
  //   実装: preprocess() L879
  //
  //   膝キーポイント (25, 26) の 3D 高さが地面円の高さより上であることを確認。
  //   下なら地面検出が誤っている → [ErrorID 3]。
  const kneeHeight = avg(keypoint25.y, keypoint26.y);
  if (kneeHeight < circle.position.y) throw new Error("[ErrorID 3]");


  // ── Step 6: boneOperations の算出 ───────────────────────────────────────
  //   実装: preprocess() L932  →  §4 で詳説
  boneOperations = await estimateBoneOperations(camera, poseDetector, radius);
  GVRMUtils.resetPose(character, boneOperations);  // VRM スケルトンに適用


  // ── Step 7: finalCheck() ────────────────────────────────────────────────
  //   実装: check.js: finalCheck()
  //
  //   11 アングル (-75°〜+75°) でレンダリングし、
  //   VRM ボーンカプセルのスクリーン投影座標と BlazePose キーポイントを比較。
  //   3 アングル以上が閾値 0.15 を超えたら失敗。
  await finalCheck(scene, camera, renderer, poseDetector, character);


  // ── Step 8: Splat 割り当て ───────────────────────────────────────────────
  //   実装: preprocess() L1110  →  §5 で詳説
  const { pmc, capsuleBoneIndex } = GVRMUtils.getPointsMeshCapsules(character);

  if (useGPU) {
    await assignSplatsToBonesGL(gs, pmc.capsules, capsuleBoneIndex);   // GPU 版
    await assignSplatsToPointsGL(character, gs, pmc.capsules, capsuleBoneIndex);
  } else {
    await assignSplatsToBones(gs, pmc.capsules, capsuleBoneIndex);     // CPU 版
    await assignSplatsToPoints(character, gs, pmc.capsules, capsuleBoneIndex);
  }


  // ── Step 9: .gvrm 保存 ──────────────────────────────────────────────────
  await GVRM.save(gs, character, boneOperations, vrmScale);
}


// ─────────────────────────────────────────────────────────────────────────────
// §3  BlazePose を使った角度探索   apps/preprocess/preprocess.js: L577
// ─────────────────────────────────────────────────────────────────────────────

async function findBestAngleInRange(startAngle, endAngle, steps, radius) {
  const scores = [];

  for (let step = 0; step < steps; step++) {
    const angle = startAngle + (endAngle - startAngle) * step / steps;

    // カメラを円周上に配置してレンダリング
    camera.position.set(
      radius * Math.sin(angle),
      0,
      radius * Math.cos(angle)
    );
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);

    // PNG をキャプチャして BlazePose へ
    const dataURL = renderer.domElement.toDataURL('image/png');
    const keypoints = await poseDetector.detect(dataURL);  // 33 キーポイント

    if (keypoints) {
      const leftWrist  = keypoints.get(15);  // BlazePose index 15
      const rightWrist = keypoints.get(16);  // BlazePose index 16
      // 正面ほど左右対称 → score が正で大きい
      const score = leftWrist.position.x - rightWrist.position.x;
      scores.push({ angle, score });
    }
  }

  // 360° 探索のときは 5 ステップのスライディング平均でピークを選ぶ
  const isFullCircle = (endAngle - startAngle) >= Math.PI * 2 * 0.9;
  return isFullCircle
    ? argmaxSlidingWindow(scores, windowSize=5)
    : argmax(scores);
}


// ─────────────────────────────────────────────────────────────────────────────
// §4  A-Pose ボーン操作の推定   apps/preprocess/preprocess.js: L932
// ─────────────────────────────────────────────────────────────────────────────
//
//  考え方:
//    BlazePose は 2D 画像座標を返すだけなので、
//    複数アングルのキーポイントを組み合わせて 3D ボーン回転を逆算する。
//
//    ・正面ビュー (angle=0)     → Z 軸回転（腕/脚の上下角）
//    ・側面ビュー (angle=±π/2) → X 軸回転（腕の前後角、深度方向）

async function estimateBoneOperations(camera, poseDetector, radius) {

  // デフォルト boneOperations をロード（lowerArm の offset など）
  let boneOperations = await fetch("./assets/default.json")
                            .then(r => r.json())
                            .then(p => p.boneOperations);

  // ── 正面から腕の Z 回転を推定 ──────────────────────────────────────────
  await moveCameraAndDetect(camera, angle=0, radius);

  {
    // 左腕: shoulder(11) → wrist(15) の XY ベクトルから傾き角
    const shoulder = keypoint(11).position;
    const wrist    = keypoint(15).position;
    const zRot = -Math.atan2(wrist.y - shoulder.y, wrist.x - shoulder.x);
    boneOperations[/*leftUpperArm*/ 2].rotation.z = zRot * 180/Math.PI;

    // A-pose 検証: 手首が肩より内側なら腕が折れている → [ErrorID 4]
    const threshX = shoulder.x * 0.67 + rightShoulder.x * 0.33;
    if (wrist.x < threshX) throw new Error("[ErrorID 4]");
  }

  {
    // 右腕: shoulder(12) → wrist(16)
    const shoulder = keypoint(12).position;
    const wrist    = keypoint(16).position;
    const zRot = -180 - Math.atan2(wrist.y - shoulder.y, wrist.x - shoulder.x) * 180/Math.PI;
    boneOperations[/*rightUpperArm*/ 3].rotation.z = zRot;
  }

  // ── 正面から脚の Z 回転を推定 ──────────────────────────────────────────
  {
    // 左脚: hip(23) → ankle(27)
    const hip   = keypoint(23).position;
    const ankle = keypoint(27).position;
    const zRot = -90 - Math.atan2(ankle.y - hip.y, ankle.x - hip.x) * 180/Math.PI;
    boneOperations[/*leftUpperLeg*/ 4].rotation.z = zRot;
  }
  {
    // 右脚: hip(24) → ankle(28)
    const hip   = keypoint(24).position;
    const ankle = keypoint(28).position;
    const zRot = 90 - Math.atan2(ankle.y - hip.y, ankle.x - hip.x) * 180/Math.PI;
    boneOperations[/*rightUpperLeg*/ 5].rotation.z = zRot;
  }

  // ── 側面から腕の X 回転を推定（深度方向の補正）────────────────────────
  await moveCameraAndDetect(camera, angle=-Math.PI/2, radius); // 右側面
  {
    // 右腕を右横から見ると Y-Z 平面の傾きが取れる
    const shoulder = keypoint(12).position;
    const wrist    = keypoint(16).position;
    const xRot = 90 + Math.atan2(wrist.y - shoulder.y, wrist.z - shoulder.z) * 180/Math.PI;
    boneOperations[/*rightUpperArm*/ 3].rotation.x = xRot;
  }

  await moveCameraAndDetect(camera, angle=+Math.PI/2, radius); // 左側面
  {
    // 左腕を左横から見る
    const shoulder = keypoint(11).position;
    const wrist    = keypoint(15).position;
    const xRot = -90 - Math.atan2(wrist.y - shoulder.y, wrist.z - shoulder.z) * 180/Math.PI;
    boneOperations[/*leftUpperArm*/ 2].rotation.x = xRot;
  }

  return boneOperations;
}


// ─────────────────────────────────────────────────────────────────────────────
// §5  ボーンカプセルの生成   gvrm-format/utils.js: getPointsMeshCapsules()
// ─────────────────────────────────────────────────────────────────────────────
//
//  VRM スケルトンの各ボーン間を「カプセル形状」で近似する。
//  カプセルは「親ボーン→子ボーン」の線分を中心軸として配置される。
//
//  BONE_CONFIG で部位ごとに半径とスケールを定義:
//    arm     : radius=0.06,  scale={x:1.0, z:1.0}  (細い円柱)
//    leg     : radius=0.08,  scale={x:1.0, z:1.0}
//    torso   : radius=0.03,  scale={x:6.0, z:4.0}  (横に潰した楕円=体幹)
//    head    : radius=0.03,  scale={x:2.0, z:2.0}
//    headTop : radius=0.06,  scale={x:1.5, z:2.0}

function getPointsMeshCapsules(character) {
  const capsules = new THREE.Group();
  const capsuleBoneIndex = [];  // capsuleBoneIndex[ci] = skeleton の bone index

  // VRM スケルトンを再帰的に辿る
  function traverseNodes(parentNode) {
    parentNode.children.forEach(childNode => {
      if (!childNode.isBone) return;

      const parentPos = parentNode.matrixWorld.getPosition();
      const childPos  = childNode.matrixWorld.getPosition();

      // このボーンが BONE_CONFIG に含まれているか確認
      const boneConfig = findBoneConfig(childNode.name);
      if (boneConfig) {
        const length  = parentPos.distanceTo(childPos);
        const midPoint = avg3D(parentPos, childPos);

        // カプセルを親→子の中点に配置し、ボーン方向に回転
        const capsule = new THREE.CapsuleGeometry(
          boneConfig.radius,
          length - boneConfig.radius * 2,
          /*radialSeg=*/ 1,
          /*heightSeg=*/ 6
        );
        capsule.scale.set(boneConfig.scale.x, 1, boneConfig.scale.z);
        capsule.position.copy(midPoint);

        // Y 軸 → ボーン方向に向ける回転を設定
        const direction = childPos.clone().sub(parentPos).normalize();
        const quaternion = new THREE.Quaternion()
          .setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        capsule.setRotationFromQuaternion(quaternion);

        // カプセル番号 → スケルトン内ボーン番号 のマッピングを記録
        capsuleBoneIndex.push(skeleton.bones.indexOf(childNode));
        capsules.add(capsule);
      }

      traverseNodes(childNode);  // 子を再帰的に処理
    });
  }

  traverseNodes(character.scene.children[0].children[0]); // root bone

  return { pmc: { capsules, ... }, capsuleBoneIndex };
}


// ─────────────────────────────────────────────────────────────────────────────
// §6  Splat → ボーン割り当て   apps/preprocess/preprocess.js: assignSplatsToBones()
// ─────────────────────────────────────────────────────────────────────────────
//
//  各 Splat について、全カプセルのポリゴン（三角形）との最短距離を求め、
//  最も近いカプセルが担当するボーンを割り当てる。
//
//  計算量: O(splatCount × capsuleCount × trianglesPerCapsule)
//  fast モード: 10 個に 1 個だけ厳密計算し残りは前の結果を流用

async function assignSplatsToBones(gs, capsules, capsuleBoneIndex) {
  gs.splatBoneIndices = [];

  for (let i = 0; i < gs.splatCount; i++) {

    // Splat の中心をワールド座標に変換
    const splat = new THREE.Vector3(
      gs.centers0[i*3], gs.centers0[i*3+1], gs.centers0[i*3+2]
    ).applyMatrix4(gs.splatMesh.matrixWorld);

    let minDist = Infinity;
    let bestCapsuleIndex = 0;

    // 全カプセルの全三角形について最短距離を探索
    for (let ci = 0; ci < capsules.children.length; ci++) {
      const capsule = capsules.children[ci];
      const { position, index } = capsule.geometry.attributes;

      for (let ii = 0; ii < index.count; ii += 3) {
        const tri = new THREE.Triangle(
          vertex(position, index[ii+0]).applyMatrix4(capsule.matrixWorld),
          vertex(position, index[ii+1]).applyMatrix4(capsule.matrixWorld),
          vertex(position, index[ii+2]).applyMatrix4(capsule.matrixWorld),
        );

        const closest = new THREE.Vector3();
        tri.closestPointToPoint(splat, closest);

        const dist = splat.distanceTo(closest);
        if (dist < minDist) {
          minDist = dist;
          bestCapsuleIndex = ci;
        }
      }
    }

    // カプセル番号 → ボーン番号 に変換して格納
    gs.splatBoneIndices.push(capsuleBoneIndex[bestCapsuleIndex]);

    // 可視化: Splat をボーン色に塗る（デバッグ用 Cキー）
    gs.colors[i*4+0] = BONE_COLORS[bestCapsuleIndex][0];
    gs.colors[i*4+1] = BONE_COLORS[bestCapsuleIndex][1];
    gs.colors[i*4+2] = BONE_COLORS[bestCapsuleIndex][2];
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// §7  Splat → 頂点割り当て   apps/preprocess/preprocess.js: assignSplatsToPoints()
// ─────────────────────────────────────────────────────────────────────────────
//
//  ボーン単位の割り当てだけでは粗いため、さらに VRM メッシュの「最近傍頂点」に
//  紐付ける。ランタイムはその頂点のスキニング変換を Splat に適用する。
//
//  2 フェーズで実装:
//    Phase A: VRM 頂点 → 最近傍ボーンカプセル (boneVertexIndices を構築)
//    Phase B: 各 Splat → 同一ボーン内の最近傍頂点 (探索範囲を絞る)
//    Phase C: 相対位置ベクトルの算出 (splatRelativePoses)

async function assignSplatsToPoints(character, gs, capsules, capsuleBoneIndex) {
  const skinnedMesh = character.currentVrm.scene.children[character.skinnedMeshIndex];
  const position = skinnedMesh.geometry.getAttribute('position');

  // ── Phase A: 各 VRM 頂点がどのボーンに属するか ─────────────────────────
  //  applyBoneTransform() でスキニング後の頂点位置を取得し、
  //  Splat 割り当てと同じカプセル最短距離法で分類する。
  //
  const boneVertexIndices = {};  // { boneIndex: [vertexIndex, ...] }

  for (let vi = 0; vi < position.count; vi++) {
    const vertex = new THREE.Vector3().fromBufferAttribute(position, vi);
    const skinnedVertex = skinnedMesh.applyBoneTransform(vi, vertex)
                            .applyMatrix4(character.scene.matrixWorld);

    const bestCi = closestCapsule(skinnedVertex, capsules);  // §6 と同じロジック
    const boneIndex = capsuleBoneIndex[bestCi];

    boneVertexIndices[boneIndex] = boneVertexIndices[boneIndex] ?? [];
    boneVertexIndices[boneIndex].push(vi);
  }

  // ── Phase B: 各 Splat → 同一ボーン内の最近傍頂点 ─────────────────────
  //  splatBoneIndices[i] (§6 で決定) を使ってボーンを特定し、
  //  そのボーンの頂点リスト内だけで最近傍を探す → 計算量を大幅削減。
  //
  gs.splatVertexIndices = [];

  for (let i = 0; i < gs.splatCount; i++) {
    const splat = splatWorldPos(gs, i);
    const boneIndex = gs.splatBoneIndices[i];
    const candidates = boneVertexIndices[boneIndex];  // このボーンの頂点のみ

    let minDist = Infinity;
    let bestVi = candidates[0];

    for (const vi of candidates) {
      const v = new THREE.Vector3().fromBufferAttribute(position, vi);
      const sv = skinnedMesh.applyBoneTransform(vi, v)
                   .applyMatrix4(character.scene.matrixWorld);
      const d = splat.distanceTo(sv);
      if (d < minDist) { minDist = d; bestVi = vi; }
    }

    gs.splatVertexIndices.push(bestVi);
  }

  // ── Phase C: 相対位置ベクトルの算出 ──────────────────────────────────
  //  splatRelativePoses[i] = splat_center − vertex_position (ローカル座標)
  //
  //  ランタイム (shader) では:
  //    animated_splat = animated_vertex + splatRelativePose
  //  として Splat の最終位置を決定する。
  //
  gs.splatRelativePoses = [];

  for (let i = 0; i < gs.splatCount; i++) {
    const vi = gs.splatVertexIndices[i];
    const vertex = new THREE.Vector3().fromBufferAttribute(position, vi);
    const skinnedVertex = skinnedMesh.applyBoneTransform(vi, vertex);

    const center0 = splatLocalPos(gs, i)
                      .applyMatrix4(character.scene.matrixWorld.clone().invert());

    const relativePos = center0.sub(skinnedVertex);  // Δ = splat − vertex
    gs.splatRelativePoses.push(relativePos.x, relativePos.y, relativePos.z);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// §8  ランタイムでの Splat スキニング (概念)
// ─────────────────────────────────────────────────────────────────────────────
//
//  前処理で記録した 3 つのデータを使い、アニメーション中に各 Splat を動かす。
//
//  前処理で保存:
//    splatVertexIndices[i]   … Splat i が追従する VRM 頂点番号
//    splatRelativePoses[i]   … 頂点からの相対オフセット (ローカル座標)
//    boneOperations          … A-pose 補正パラメータ
//
//  ランタイム (apps/main.js + shader injection):
//
//    per frame:
//      for each splat i:
//        vertexIndex = splatVertexIndices[i]
//        animatedVertex = skinningMatrix(vertexIndex) * restVertex(vertexIndex)
//        splatCenter    = animatedVertex + splatRelativePoses[i]
//
//  実装: gsCustomizeMaterial() がカスタムシェーダーを注入し、
//        GPU テクスチャ (boneTexture, vertexTexture, relPoseTexture) から
//        上記計算を頂点シェーダーで並列実行する。
//
//  → 詳細: apps/preprocess/shader-skinning スキル を参照


// ─────────────────────────────────────────────────────────────────────────────
// §9  GPU 版割り当て   apps/preprocess/preprocess_gl.js
// ─────────────────────────────────────────────────────────────────────────────
//
//  §6/§7 の CPU ループを WebGL (GLSL) で並列化したもの。
//  スプラット数 100K+ のとき ?gpu URL パラメータで有効化。
//
//  手順:
//    1. カプセル全頂点をテクスチャにパック (Float32 RGBA)
//    2. Splat 全中心をテクスチャにパック
//    3. フラグメントシェーダーで各ピクセル = 1 スプラット として最小距離を計算
//    4. readPixels() で結果を CPU に転送
//
//  制限: ブラウザの最大テクスチャサイズ (通常 16384px) によりスプラット数に上限。


// ─────────────────────────────────────────────────────────────────────────────
// §10  エラー ID 一覧
// ─────────────────────────────────────────────────────────────────────────────
//
//  [ErrorID 1]  特定角度でポーズ検出失敗  → ?stage=2 でスキップ
//  [ErrorID 2]  キャラクター向き検出失敗  → PLY の向きを確認
//  [ErrorID 3]  地面検出失敗              → ?stage=2 + 手動高さ指定
//  [ErrorID 4]  A-pose 腕折れ検出         → default.json の boneOperations 調整
//  [ErrorID 5]  重心計算で頂点未検出      → VRM メッシュ構造を確認
//  [ErrorID 6]  高さ計算でターゲット未検出 → スキャンデータ品質を確認
