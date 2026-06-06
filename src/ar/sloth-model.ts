import * as THREE from 'three';

// ─── To swap in a real .glb later: ────────────────────────────────────────────
// import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// export async function loadSlothModel(url: string): Promise<THREE.Group> {
//   const gltf = await new GLTFLoader().loadAsync(url);
//   return gltf.scene as THREE.Group;
// }

/** Build the procedural sloth mesh and return it as a named Group. */
export function createSloth(): THREE.Group {
  const group = new THREE.Group();

  const bodyMat  = new THREE.MeshLambertMaterial({ color: 0x7b5230 });
  const headMat  = new THREE.MeshLambertMaterial({ color: 0xbf9468 });
  const maskMat  = new THREE.MeshLambertMaterial({ color: 0xd9b98c });
  const patchMat = new THREE.MeshLambertMaterial({ color: 0x1c0e00 });
  const eyeWMat  = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const noseMat  = new THREE.MeshLambertMaterial({ color: 0x4a2808 });
  const clawMat  = new THREE.MeshLambertMaterial({ color: 0x231000 });
  const chestMat = new THREE.MeshLambertMaterial({ color: 0xd9b98c });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.58, 18, 14), bodyMat);
  body.scale.y = 1.22;
  body.name = 'body';
  group.add(body);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), chestMat);
  chest.position.set(0, 0.02, 0.45);
  chest.scale.y = 0.75;
  group.add(chest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.40, 18, 14), headMat);
  head.position.set(0, 0.88, 0);
  group.add(head);

  const mask = new THREE.Mesh(new THREE.CircleGeometry(0.27, 22), maskMat);
  mask.position.set(0, 0.86, 0.393);
  group.add(mask);

  const EX = 0.115;
  const EY = 0.93;
  const patchGeo = new THREE.CircleGeometry(0.105, 18);
  const whiteGeo = new THREE.CircleGeometry(0.062, 14);
  const pupilGeo = new THREE.CircleGeometry(0.034, 12);

  ([-1, 1] as const).forEach((side) => {
    const p  = new THREE.Mesh(patchGeo, patchMat);
    p.position.set(side * EX, EY, 0.395);
    group.add(p);

    const e  = new THREE.Mesh(whiteGeo, eyeWMat);
    e.position.set(side * EX, EY, 0.400);
    group.add(e);

    const pu = new THREE.Mesh(pupilGeo, pupilMat);
    pu.position.set(side * EX - side * 0.018, EY - 0.012, 0.41);
    group.add(pu);
  });

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), noseMat);
  nose.position.set(0, 0.80, 0.40);
  nose.scale.set(1.2, 0.75, 0.7);
  group.add(nose);

  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.085, 0.018, 8, 14, Math.PI),
    patchMat,
  );
  smile.position.set(0, 0.73, 0.40);
  smile.rotation.z = Math.PI;
  group.add(smile);

  const armGeo = new THREE.CylinderGeometry(0.075, 0.055, 1.05, 9);

  const armL = new THREE.Mesh(armGeo, bodyMat);
  armL.position.set(-0.68, 0.30, 0.08);
  armL.rotation.z = Math.PI / 3.8;
  armL.rotation.x = 0.18;
  group.add(armL);

  const armR = new THREE.Mesh(armGeo, bodyMat);
  armR.position.set(0.68, 0.30, 0.08);
  armR.rotation.z = -Math.PI / 3.8;
  armR.rotation.x = 0.18;
  group.add(armR);

  const clawGeo = new THREE.CylinderGeometry(0.013, 0.032, 0.22, 6);
  ([-0.07, 0, 0.07] as const).forEach((off) => {
    const cL = new THREE.Mesh(clawGeo, clawMat);
    cL.position.set(-1.05 + off * 0.35, 0.68 + off * 0.1, 0.12);
    cL.rotation.z = Math.PI / 3.8;
    group.add(cL);

    const cR = new THREE.Mesh(clawGeo, clawMat);
    cR.position.set(1.05 + off * 0.35, 0.68 + off * 0.1, 0.12);
    cR.rotation.z = -Math.PI / 3.8;
    group.add(cR);
  });

  return group;
}
