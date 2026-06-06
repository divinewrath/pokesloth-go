import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { getElement } from '../dom.js';
import { createSloth } from './sloth-model.js';

const videoEl    = getElement<HTMLVideoElement>('camera');
const canvasEl   = getElement<HTMLCanvasElement>('three-canvas');
const camErrEl   = getElement<HTMLDivElement>('camera-error');
const arHintEl   = getElement<HTMLDivElement>('ar-hint');
const hudEl      = getElement<HTMLDivElement>('hud');

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let clock: THREE.Clock;
let slothGroup: THREE.Group;
let reticle: THREE.Group;
let hitTestSource: XRHitTestSource | null = null;
let slothPlaced  = false;
let initialised  = false; // guard against double-tap before init completes

/** Entry point — lazily initialised on first AR screen entry, resumed on subsequent ones. */
export async function enterARScene(): Promise<void> {
  if (!initialised) {
    initialised = true;
    await initThree();
  } else {
    renderer?.setAnimationLoop(onFrame);
  }
}

/** Pause the render loop (call when leaving the AR screen to save battery). */
export function pauseARScene(): void {
  renderer?.setAnimationLoop(null);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

async function initThree(): Promise<void> {
  clock = new THREE.Clock();

  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.xr.enabled = true;
  resizeRenderer();

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, 0.6, 4.5);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(3, 6, 5);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xa0c8ff, 0.6);
  fill.position.set(-4, 0, -2);
  scene.add(fill);

  slothGroup = createSloth();
  slothGroup.position.set(0, -0.4, 0);
  slothGroup.userData['baseY'] = -0.4;
  scene.add(slothGroup);

  // ── Reticle (AR surface indicator) ──
  const reticleGroup = new THREE.Group();

  const ringGeo = new THREE.RingGeometry(0.09, 0.13, 36);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(
    ringGeo,
    new THREE.MeshBasicMaterial({
      color:       0x44ff88,
      side:        THREE.DoubleSide,
      transparent: true,
      opacity:     0.9,
    }),
  );
  reticleGroup.add(ring);

  const crossMat = new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.7 });
  const barGeo   = new THREE.BoxGeometry(0.18, 0.004, 0.01);

  const cH = new THREE.Mesh(barGeo, crossMat);
  cH.rotation.x = -Math.PI / 2;
  const cV = new THREE.Mesh(barGeo, crossMat);
  cV.rotation.x = -Math.PI / 2;
  cV.rotation.z = Math.PI / 2;
  reticleGroup.add(cH, cV);

  reticle = reticleGroup;
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // AR or getUserMedia fallback
  const arSupported = await navigator.xr?.isSessionSupported('immersive-ar').catch(() => false) ?? false;
  if (arSupported) {
    setupAR();
  } else {
    await startCamera();
  }

  renderer.setAnimationLoop(onFrame);
  window.addEventListener('resize', resizeRenderer);
}

// ── Main animation loop ───────────────────────────────────────────────────────

function onFrame(_time: number, frame: XRFrame | undefined): void {
  const dt = clock.getDelta();
  const t  = clock.elapsedTime;

  if (frame != null && hitTestSource != null) {
    const refSpace = renderer!.xr.getReferenceSpace();
    if (refSpace != null) {
      const results = frame.getHitTestResults(hitTestSource);

      if (results.length > 0 && !slothPlaced) {
        const pose = results[0]?.getPose(refSpace);
        if (pose != null) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
          const s = 1 + Math.sin(t * 6) * 0.08;
          reticle.scale.set(s, 1, s);
          arHintEl.classList.remove('hidden');
        }
      } else {
        reticle.visible = false;
        if (!slothPlaced) arHintEl.classList.add('hidden');
      }
    }
  }

  if (slothGroup.visible) {
    slothGroup.rotation.y += dt * 0.55;
    if (!slothPlaced) {
      const baseY = slothGroup.userData['baseY'] as number;
      slothGroup.position.y = baseY + Math.sin(t * 1.3) * 0.09;
    }
  }

  renderer!.render(scene, camera);
}

// ── AR path ───────────────────────────────────────────────────────────────────

function setupAR(): void {
  const arBtn = ARButton.createButton(renderer!, {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay:       { root: hudEl },
  });

  Object.assign(arBtn.style, {
    position:      'absolute',
    bottom:        '40px',
    left:          '50%',
    transform:     'translateX(-50%)',
    padding:       '14px 40px',
    fontSize:      '1.05rem',
    fontWeight:    '800',
    background:    'linear-gradient(135deg, #44ff88, #00aa55)',
    color:         '#001a0a',
    border:        'none',
    borderRadius:  '100px',
    cursor:        'pointer',
    boxShadow:     '0 6px 24px rgba(0,255,100,0.45)',
    letterSpacing: '0.06em',
    zIndex:        '20',
    pointerEvents: 'auto',
  } satisfies Partial<CSSStyleDeclaration>);
  // vendor-prefixed property set via setProperty to satisfy strict typing
  arBtn.style.setProperty('-webkit-tap-highlight-color', 'transparent');

  hudEl.appendChild(arBtn);

  renderer!.xr.addEventListener('sessionstart', () => { void onARSessionStart(); });
  renderer!.xr.addEventListener('sessionend',   onARSessionEnd);
}

async function onARSessionStart(): Promise<void> {
  const session   = renderer!.xr.getSession()!;
  const viewerRef = await session.requestReferenceSpace('viewer');
  hitTestSource   = await session.requestHitTestSource?.({ space: viewerRef }) ?? null;

  slothGroup.scale.setScalar(0.45);
  slothGroup.userData['baseY'] = 0;
  slothPlaced = false;

  session.addEventListener('select', onARSelect);
  if (videoEl.srcObject != null) videoEl.pause();
}

function onARSessionEnd(): void {
  hitTestSource?.cancel?.();
  hitTestSource = null;
  reticle.visible = false;
  arHintEl.classList.add('hidden');
  slothGroup.scale.setScalar(1);
  slothGroup.userData['baseY'] = -0.4;
  slothGroup.position.set(0, -0.4, 0);
  slothPlaced = false;
}

function onARSelect(): void {
  if (!reticle.visible || slothPlaced) return;
  slothGroup.position.setFromMatrixPosition(reticle.matrix);
  slothGroup.userData['baseY'] = slothGroup.position.y;
  slothGroup.rotation.y        = Math.random() * Math.PI * 2;
  slothPlaced                  = true;
  reticle.visible              = false;
  arHintEl.classList.add('hidden');
}

// ── getUserMedia fallback ─────────────────────────────────────────────────────

async function startCamera(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    camErrEl.classList.remove('hidden');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    videoEl.srcObject = stream;
  } catch (err) {
    console.warn('Camera:', err instanceof Error ? err.message : err);
    camErrEl.classList.remove('hidden');
  }
}

// ── Resize ────────────────────────────────────────────────────────────────────

function resizeRenderer(): void {
  if (renderer == null) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
