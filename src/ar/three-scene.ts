import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { getElement } from '../dom.js';
import { createSloth } from './sloth-model.js';

const videoEl  = getElement<HTMLVideoElement>('camera');
const canvasEl = getElement<HTMLCanvasElement>('three-canvas');
const camErrEl = getElement<HTMLDivElement>('camera-error');
const hudEl    = getElement<HTMLDivElement>('hud');

// Camera-overlay ("magic window") sloth placement — approx 2 m ahead
const OVERLAY_Z     = -2.2;
const OVERLAY_Y     = -0.4;
const OVERLAY_SCALE = 0.9;

// WebXR immersive-ar sloth placement — real world metres
const XR_Z     = -2;
const XR_Y     = -0.4;
const XR_SCALE = 0.45;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let clock: THREE.Clock;
let slothGroup: THREE.Group;
let initialised = false;

/** Entry point — lazily initialised on first AR screen entry, resumed on subsequent ones. */
export async function enterARScene(): Promise<void> {
  if (!initialised) {
    initialised = true;
    try {
      await initThree();
    } catch (err) {
      initialised = false; // allow retry on next entry
      console.error('AR init error:', err);
      camErrEl.textContent = '⚠️ AR unavailable';
      camErrEl.classList.remove('hidden');
    }
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
  // Camera at origin looking down −Z; sloth lives at OVERLAY_Z in front.
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 100);

  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(3, 6, 5);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xa0c8ff, 0.6);
  fill.position.set(-4, 0, -2);
  scene.add(fill);

  slothGroup = createSloth();
  placeSlothOverlay();
  scene.add(slothGroup);

  // ── Step 1: autostart camera overlay — guaranteed to run ─────────────────
  await startCamera();
  renderer.setAnimationLoop(onFrame);
  window.addEventListener('resize', resizeRenderer);

  // ── Step 2: optional WebXR button — failure never affects the overlay ─────
  try {
    const arSupported =
      await (navigator.xr?.isSessionSupported('immersive-ar') ?? Promise.resolve(false)).catch(
        () => false,
      );
    if (arSupported) setupAR();
  } catch {
    // WebXR probe failed — camera overlay continues unaffected
  }
}

// ── Main animation loop ───────────────────────────────────────────────────────

function onFrame(_time: number, _frame: XRFrame | undefined): void {
  const dt = clock.getDelta();
  const t  = clock.elapsedTime;

  if (slothGroup.visible) {
    slothGroup.rotation.y += dt * 0.55;
    const baseY = slothGroup.userData['baseY'] as number;
    slothGroup.position.y = baseY + Math.sin(t * 1.3) * 0.09;
  }

  renderer!.render(scene, camera);
}

// ── WebXR (optional progressive enhancement) ──────────────────────────────────

function setupAR(): void {
  const arBtn = ARButton.createButton(renderer!, {
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
  arBtn.style.setProperty('-webkit-tap-highlight-color', 'transparent');

  hudEl.appendChild(arBtn);

  renderer!.xr.addEventListener('sessionstart', onARSessionStart);
  renderer!.xr.addEventListener('sessionend',   onARSessionEnd);
}

function onARSessionStart(): void {
  // Auto-place sloth 2 real metres ahead; no tap-to-place needed
  slothGroup.position.set(0, XR_Y, XR_Z);
  slothGroup.userData['baseY'] = XR_Y;
  slothGroup.scale.setScalar(XR_SCALE);
  slothGroup.rotation.y = Math.random() * Math.PI * 2;
  if (videoEl.srcObject != null) videoEl.pause();
}

function onARSessionEnd(): void {
  placeSlothOverlay();
  if (videoEl.srcObject != null) void videoEl.play().catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Reset the sloth to camera-overlay (magic-window) position. */
function placeSlothOverlay(): void {
  slothGroup.position.set(0, OVERLAY_Y, OVERLAY_Z);
  slothGroup.userData['baseY'] = OVERLAY_Y;
  slothGroup.scale.setScalar(OVERLAY_SCALE);
}

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
    await videoEl.play().catch(() => {});
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
