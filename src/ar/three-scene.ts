import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { getElement } from '../dom.js';
import { createSloth } from './sloth-model.js';

const videoEl  = getElement<HTMLVideoElement>('camera');
const canvasEl = getElement<HTMLCanvasElement>('three-canvas');
const camErrEl = getElement<HTMLDivElement>('camera-error');
const arHintEl = getElement<HTMLDivElement>('ar-hint');
const hudEl    = getElement<HTMLDivElement>('hud');

// Camera-overlay ("magic window") sloth placement — approx 2 m ahead
const OVERLAY_Z     = -2.2;
const OVERLAY_Y     = -0.4;
const OVERLAY_SCALE = 0.585; // 0.9 × 0.65

// WebXR immersive-ar sloth scale — real world metres
const XR_SCALE = 0.2925; // 0.45 × 0.65

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera | null = null;
let clock: THREE.Clock;
let slothGroup: THREE.Group;
let crossGroup: THREE.Group;
let hitTestSource: XRHitTestSource | null = null;
let initialised = false;

// Scratch objects — allocated once to avoid per-frame GC pressure
const _hitMatrix = new THREE.Matrix4();
const _v3        = new THREE.Vector3();

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

  scene  = new THREE.Scene();
  // Camera at origin looking down −Z; sloth lives at OVERLAY_Z in front.
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 100);
  resizeRenderer(); // must come after camera is assigned

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

  crossGroup = buildCross();
  crossGroup.visible = false;
  scene.add(crossGroup);

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

function onFrame(_time: number, frame: XRFrame | undefined): void {
  const dt = clock.getDelta();
  const t  = clock.elapsedTime;

  if (frame != null) {
    // ── WebXR immersive session ──────────────────────────────────────────────
    const refSpace = renderer!.xr.getReferenceSpace();

    if (hitTestSource != null && refSpace != null) {
      const results = frame.getHitTestResults(hitTestSource);

      if (results.length > 0) {
        const pose = results[0]?.getPose(refSpace);
        if (pose != null) {
          // Flat surface found — snap sloth to it
          _hitMatrix.fromArray(pose.transform.matrix);
          slothGroup.position.setFromMatrixPosition(_hitMatrix);
          slothGroup.visible = true;
          crossGroup.visible = false;
          arHintEl.classList.add('hidden');
        }
      } else {
        // No surface in view — float red cross in front of viewer
        slothGroup.visible = false;
        crossGroup.visible = true;
        positionInFrontOfViewer(crossGroup);
        arHintEl.classList.remove('hidden');
      }
    } else {
      // hit-test source not ready yet — show cross while initialising
      crossGroup.visible = true;
      slothGroup.visible = false;
      positionInFrontOfViewer(crossGroup);
    }

    if (slothGroup.visible) slothGroup.rotation.y += dt * 0.55;
  } else {
    // ── Camera overlay mode ──────────────────────────────────────────────────
    if (slothGroup.visible) {
      slothGroup.rotation.y += dt * 0.55;
      const baseY = slothGroup.userData['baseY'] as number;
      slothGroup.position.y = baseY + Math.sin(t * 1.3) * 0.09;
    }
  }

  renderer!.render(scene, camera!);
}

// ── WebXR (optional progressive enhancement) ──────────────────────────────────

function setupAR(): void {
  const arBtn = ARButton.createButton(renderer!, {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay:       { root: hudEl },
  });

  Object.assign(arBtn.style, {
    position:      'absolute',
    bottom:        '100px',
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

  // Stop the getUserMedia stream before WebXR requests the camera — otherwise
  // the two compete for the same hardware and the session hangs.
  arBtn.addEventListener('click', stopCameraStream, true);

  renderer!.xr.addEventListener('sessionstart', () => { void onARSessionStart(); });
  renderer!.xr.addEventListener('sessionend',   onARSessionEnd);
}

async function onARSessionStart(): Promise<void> {
  const session   = renderer!.xr.getSession()!;
  const viewerRef = await session.requestReferenceSpace('viewer');
  hitTestSource   = await session.requestHitTestSource?.({ space: viewerRef }) ?? null;

  slothGroup.scale.setScalar(XR_SCALE);
  slothGroup.visible = false;
  crossGroup.visible = true;

  arHintEl.textContent = 'Point at a flat surface';
  arHintEl.classList.remove('hidden');

  if (videoEl.srcObject != null) videoEl.pause();
}

function onARSessionEnd(): void {
  hitTestSource?.cancel?.();
  hitTestSource = null;
  crossGroup.visible = false;
  arHintEl.classList.add('hidden');
  placeSlothOverlay();
  void startCamera(); // restart getUserMedia stream after WebXR releases camera
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCross(): THREE.Group {
  const mat    = new THREE.MeshBasicMaterial({ color: 0xff2222, depthTest: false });
  const barGeo = new THREE.BoxGeometry(0.35, 0.05, 0.05);
  const bar1   = new THREE.Mesh(barGeo, mat);
  bar1.rotation.z = Math.PI / 4;
  const bar2 = new THREE.Mesh(barGeo, mat);
  bar2.rotation.z = -Math.PI / 4;
  const group = new THREE.Group();
  group.add(bar1, bar2);
  return group;
}

/** Move a group to ~1.5 m in front of and slightly below the XR viewer each frame. */
function positionInFrontOfViewer(target: THREE.Group): void {
  const xrCam = renderer!.xr.getCamera();
  _v3.set(0, -0.2, -1.5).applyQuaternion(xrCam.quaternion);
  target.position.copy(xrCam.position).add(_v3);
  target.quaternion.copy(xrCam.quaternion);
}

/** Reset the sloth to camera-overlay (magic-window) position and make it visible. */
function placeSlothOverlay(): void {
  slothGroup.position.set(0, OVERLAY_Y, OVERLAY_Z);
  slothGroup.userData['baseY'] = OVERLAY_Y;
  slothGroup.scale.setScalar(OVERLAY_SCALE);
  slothGroup.visible = true;
}

function stopCameraStream(): void {
  if (videoEl.srcObject instanceof MediaStream) {
    videoEl.srcObject.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  }
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
  if (renderer == null || camera == null) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
