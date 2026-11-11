import * as THREE from 'three';

/**
 * ar-viewer/avatar.js
 * プレースホルダーアバター（プリミティブ合成）と、実モデル（GLB）の取り込み。
 * 実モデルは createGlbAvatar で正規化し、motion-controller が扱える形に揃える。
 */

/**
 * GLBモデルをアバターとして使える形に整える（Phase 3-B）。
 * - スケール正規化：最大寸法が約1.5mになるよう拡縮し、底面を y=0、XZ中心を原点へ
 * - 名前付きパーツ（Head / Tail）を探し、プロシージャルモーションに使う
 * - アニメーションクリップがあれば AnimationMixer とクリップ表を用意する
 */
export function createGlbAvatar(gltf) {
  const inner = gltf.scene;

  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  inner.scale.setScalar(1.5 / maxDim);
  const box2 = new THREE.Box3().setFromObject(inner);
  inner.position.x -= (box2.min.x + box2.max.x) / 2;
  inner.position.z -= (box2.min.z + box2.max.z) / 2;
  inner.position.y -= box2.min.y;

  const group = new THREE.Group();
  group.add(inner);

  const parts = {};
  inner.traverse((obj) => {
    const n = (obj.name || '').toLowerCase();
    if (!parts.head && /(^|[^a-z])head/.test(n)) parts.head = obj;
    if (!parts.tail && n.includes('tail')) parts.tail = obj;
  });

  let mixer = null;
  const actions = {};
  if (gltf.animations && gltf.animations.length > 0) {
    mixer = new THREE.AnimationMixer(inner);
    for (const clip of gltf.animations) {
      actions[clip.name] = mixer.clipAction(clip);
    }
  }

  return { group, inner, parts, mixer, actions, isGlb: true };
}
export function createPlaceholderAvatar() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4f7ddf, roughness: 0.5 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.35 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x182233, roughness: 0.2 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.45, 6, 16), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 18), headMat);
  head.position.y = 1.22;
  head.castShadow = true;
  group.add(head);

  const eyeGeo = new THREE.SphereGeometry(0.032, 12, 10);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.085, 1.26, 0.21);
  group.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.085;
  group.add(eyeR);

  const armGeo = new THREE.CapsuleGeometry(0.06, 0.34, 4, 10);
  const armL = new THREE.Mesh(armGeo, bodyMat);
  armL.position.set(-0.36, 0.78, 0);
  armL.rotation.z = 0.5;
  armL.castShadow = true;
  group.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.36;
  armR.rotation.z = -0.5;
  group.add(armR);

  return { group, parts: { body, head, eyeL, eyeR, armL, armR } };
}
