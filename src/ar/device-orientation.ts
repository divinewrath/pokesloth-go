import * as THREE from 'three';

// ── Scratch objects — allocated once, reused every orientation event ──────────
const _zee   = new THREE.Vector3(0, 0, 1);
const _q0    = new THREE.Quaternion();
// -90° around X: corrects "device Y = look direction" → "device -Z = look direction"
const _q1    = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const _euler = new THREE.Euler();

let _current = new THREE.Quaternion(); // latest camera orientation

// ── iOS non-standard extension ────────────────────────────────────────────────
// DeviceOrientationEvent on iOS carries webkitCompassHeading (CW degrees from
// true north, same as "heading" in compass apps). We extend the event type
// locally so we can read it without `any`.
type AbsoluteOrientationEvent = DeviceOrientationEvent & {
  readonly webkitCompassHeading?: number;
};

// iOS 13+ requires explicit permission from a user gesture.
type DOEConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

// ── Handler refs for cleanup ──────────────────────────────────────────────────
let _onAbsolute: ((e: Event) => void) | null = null;
let _onRelative: ((e: Event) => void) | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Request orientation permission (iOS) and attach listeners.
 *
 * MUST be called synchronously within a user-gesture handler to preserve the
 * iOS gesture chain for DeviceOrientationEvent.requestPermission().
 *
 * Returns a Promise that resolves `true` once a valid absolute-heading event
 * arrives, or `false` after an 800 ms timeout (desktop, denied permission, or
 * device has no magnetometer).
 */
export function startDeviceOrientation(): Promise<boolean> {
  stopDeviceOrientation(); // clean up any previous listeners

  const DOEC = DeviceOrientationEvent as DOEConstructor;

  // Kick off iOS permission synchronously from the gesture context.
  // The returned Promise is the outer one we resolve/reject below.
  const permissionPromise: Promise<'granted' | 'denied'> =
    typeof DOEC.requestPermission === 'function'
      ? DOEC.requestPermission()
      : Promise.resolve('granted');

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const done = (result: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => done(false), 800);

    // Handler for `deviceorientationabsolute` (Android, Chrome on desktop).
    // alpha here is already absolute (0 = North, increases CCW from above).
    const onAbsolute = (e: Event): void => {
      const ev = e as AbsoluteOrientationEvent;
      if (ev.alpha == null) return;
      clearTimeout(timer);
      done(true);
      applyOrientation(ev.alpha, ev.beta, ev.gamma);
    };

    // Handler for `deviceorientation` (iOS Safari).
    // alpha is relative unless webkitCompassHeading is present, which gives
    // degrees CW from north — convert to the standard CCW convention.
    const onRelative = (e: Event): void => {
      const ev = e as AbsoluteOrientationEvent;
      if (ev.alpha == null || ev.webkitCompassHeading == null) return;
      clearTimeout(timer);
      done(true);
      const absAlpha = (360 - ev.webkitCompassHeading) % 360;
      applyOrientation(absAlpha, ev.beta, ev.gamma);
    };

    permissionPromise.then((state) => {
      if (state !== 'granted') { clearTimeout(timer); done(false); return; }

      _onAbsolute = onAbsolute;
      _onRelative = onRelative;
      window.addEventListener('deviceorientationabsolute', onAbsolute);
      window.addEventListener('deviceorientation', onRelative);
    }).catch(() => { clearTimeout(timer); done(false); });
  });
}

/** Read the latest camera quaternion (updated every orientation event). */
export function getCameraQuaternion(): THREE.Quaternion {
  return _current;
}

/** Remove listeners and reset state. Call when leaving the AR screen. */
export function stopDeviceOrientation(): void {
  if (_onAbsolute != null) {
    window.removeEventListener('deviceorientationabsolute', _onAbsolute);
    _onAbsolute = null;
  }
  if (_onRelative != null) {
    window.removeEventListener('deviceorientation', _onRelative);
    _onRelative = null;
  }
}

// ── Private ───────────────────────────────────────────────────────────────────

/**
 * Converts DeviceOrientation Euler angles into a Three.js camera quaternion
 * that is geo-aligned: when the phone points North and is held upright, the
 * camera looks at −Z (North in our scene convention).
 *
 * Algorithm: Three.js DeviceOrientationControls (MIT licence).
 * https://github.com/mrdoob/three.js/blob/dev/examples/jsm/controls/DeviceOrientationControls.js
 */
function applyOrientation(
  alpha: number,
  beta:  number | null,
  gamma: number | null,
): void {
  const b = beta  ?? 0;
  const g = gamma ?? 0;

  // Screen orientation correction (portrait=0, landscape-left=90, etc.)
  const screenAngle = screen.orientation.angle * (Math.PI / 180);

  _euler.set(
    THREE.MathUtils.degToRad(b),
    THREE.MathUtils.degToRad(alpha),
    -THREE.MathUtils.degToRad(g),
    'YXZ',
  );

  _current.setFromEuler(_euler);
  _current.multiply(_q1);                                       // look out the back
  _current.multiply(_q0.setFromAxisAngle(_zee, -screenAngle)); // screen rotation
}
