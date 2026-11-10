import * as THREE from 'three';

/**
 * ar-viewer/avatar.js
 * プレースホルダーアバター（プリミティブ合成）。
 * 実モデル（GLTF）が用意できたら scene.js の tryLoadAvatarModel に差し替える。
 * motion-controller はこのオブジェクトの parts を前提に動かす。
 */
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
