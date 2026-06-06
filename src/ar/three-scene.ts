import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { getElement } from '../dom.js';
import { createSloth } from './sloth-model.js';
import { getBearingDeg, getDistanceM, scaleForDistance, toScenePosition } from './geo-placement.js';
import {
  getCameraQuaternion,
  startDeviceOrientation,
  stopDeviceOrientation,
} from './device-orientation.js';
import type { GeoContext } from '../types.js';

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

// Y height (world units) for geo-anchored sloths — just below eye level
const FIELD_Y = -0.5;

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera | null = null;
let clock: THREE.Clock;
let slothGroup: THREE.Group;    // single sloth: WebXR hit-test + overlay fallback
let slothField: THREE.Group | null = null; // geo-anchored multi-sloth group
let crossGroup: THREE.Group;
let hitTestSource: XRHitTestSource | null = null;
let initialised = false;

let geoCtx: GeoContext | null = null;
let orientationAvailable = false;

// Scratch objects — allocated once to avoid per-frame GC pressure
const _hitMatrix = new THREE.Matrix4();
const _v3        = new THREE.Vector3();

// ── Entry points ──────────────────────────────────────────────────────────────

/**
 * Enter the AR screen with a geo snapshot from the map.
 * Lazily initialises Three.js on first call; resumes on subsequent ones.
 *
 * `startDeviceOrientation()` is called synchronously before any awaits so that
 * the iOS DeviceOrientationEvent.requestPermission() call lands within the
 * original user-gesture stack frame.
 */
export async function enterARScene(ctx: GeoContext): Promise<void> {
  geoCtx = ctx;

  // Must start orientation before any await to preserve iOS gesture chain.
  const orientationPromise = startDeviceOrientation();

  if (!initialised) {
    initialised = true;
    try {
      await initThree();
    } catch (err) {
      initialised = false; // allow retry on next entry
      console.error('AR init error:', err);
      camErrEl.textContent = '⚠️ AR unavailable';
      camErrEl.classList.remove('hidden');
      return;
    }
  } else {
    renderer?.setAnimationLoop(onFrame);
  }

  // Seed with the overlay fallback immediately — user never sees an empty canvas.
  buildSlothField();

  // Upgrade to geo-anchored sloths as soon as orientation confirms.
  orientationPromise
    .then((hasOrientation) => {
      orientationAvailable = hasOrientation;
      if (hasOrientation) {
        buildSlothField();
      } else {
        // Hint only on mobile; desktop always lacks a compass so stay silent.
        const isMobile = /Mobi|Android/i.test(navigator.userAgent);
        if (isMobile) {
          arHintEl.textContent = '🧭 Enable compass for geo AR';
          arHintEl.classList.remove('hidden');
          setTimeout(() => arHintEl.classList.add('hidden'), 3_000);
        }
      }
    })
    .catch(() => { /* orientation unavailable — overlay fallback stays */ });
}

/** Pause the render loop and compass listener (call when leaving the AR screen). */
export function pauseARScene(): void {
  renderer?.setAnimationLoop(null);
  stopDeviceOrientation();
}

// ── Setup ─────────────────────────────────────────────────────────────────────

async function initThree(): Promise<void> {
  clock = new THREE.Clock();

  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.xr.enabled = true;

  scene  = new THREE.Scene();
  // Camera at origin looking down −Z; overlay sloth lives at OVERLAY_Z in front.
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

    // Apply compass-based camera rotation when orientation is available.
    if (orientationAvailable) {
      camera!.quaternion.copy(getCameraQuaternion());
    }

    if (slothField != null) {
      // Animate each geo-anchored sloth model (first child of each entity group).
      for (const entity of slothField.children) {
        const model = entity.children[0];
        if (model == null) continue;
        model.rotation.y += dt * 0.55;
        const phase = (model.userData['phase'] as number | undefined) ?? 0;
        model.position.y = Math.sin(t * 1.3 + phase) * 0.09;
      }
    } else if (slothGroup.visible) {
      // Fallback: single overlay sloth bobs in place.
      slothGroup.rotation.y += dt * 0.55;
      const baseY = slothGroup.userData['baseY'] as number;
      slothGroup.position.y = baseY + Math.sin(t * 1.3) * 0.09;
    }
  }

  renderer!.render(scene, camera!);
}

// ── Geo-anchored sloth field ──────────────────────────────────────────────────

/**
 * Rebuild the sloth scene from the current geo snapshot and orientation state.
 *
 * - Orientation available: creates one sloth per GeoContext entry, placed at
 *   the correct compass bearing and scene-clamped distance.
 * - Orientation unavailable (or no context): falls back to the single overlay
 *   sloth parked ~2 m in front of the camera.
 *
 * Skipped while a WebXR immersive session is in progress.
 */
function buildSlothField(): void {
  if (renderer?.xr.isPresenting) return; // WebXR manages its own sloth

  // Tear down the previous field
  if (slothField != null) {
    scene.remove(slothField);
    disposeGroup(slothField);
    slothField = null;
  }

  if (!orientationAvailable || geoCtx == null || geoCtx.sloths.length === 0) {
    placeSlothOverlay();
    return;
  }

  // Hide the single overlay sloth — the field replaces it.
  slothGroup.visible = false;

  slothField = new THREE.Group();

  for (const f of geoCtx.sloths) {
    const [slothLng, slothLat] = f.geometry.coordinates as [number, number];
    const distM      = getDistanceM(geoCtx.lat, geoCtx.lng, slothLat, slothLng);
    const bearingDeg = getBearingDeg(geoCtx.lat, geoCtx.lng, slothLat, slothLng);
    const { x, z, sceneDist } = toScenePosition(distM, bearingDeg);

    const entity = new THREE.Group();
    const scale   = scaleForDistance(sceneDist);

    const model = createSloth();
    model.scale.setScalar(scale);
    model.userData['phase'] = Math.random() * Math.PI * 2;
    entity.add(model);

    // Label: distance-proportional size so it always subtends ~3.4° on screen.
    // Canvas aspect ratio is 128:36 ≈ 3.56.
    const labelW = sceneDist * 0.06;
    const label  = makeLabelSprite(`${Math.round(distM)} m`);
    label.position.set(0, 1.28 * scale + 0.08, 0); // just above sloth head
    label.scale.set(labelW, labelW / 3.56, 1);
    entity.add(label);

    entity.position.set(x, FIELD_Y, z);
    slothField.add(entity);
  }

  scene.add(slothField);
}

/** Create a canvas-texture distance label that always faces the camera. */
function makeLabelSprite(text: string): THREE.Sprite {
  const W = 128, H = 36;
  const canvas  = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fillRect(0, 0, W, H);

  ctx.font         = 'bold 20px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = '#ffee99';
  ctx.fillText(text, W / 2, H / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  const mat     = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  return new THREE.Sprite(mat);
}

/** Recursively dispose geometries and materials in a group. */
function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m.dispose();
    } else if (obj instanceof THREE.Sprite) {
      obj.material.map?.dispose();
      obj.material.dispose();
    }
  });
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

  // Hide geo field during WebXR session; show single sloth via hit-test.
  if (slothField != null) slothField.visible = false;
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

  // Restore overlay / geo field
  buildSlothField();
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
