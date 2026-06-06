import { getElement } from './dom.js';
import { getCurrentScreen } from './screens.js';
import type { SlothFeature } from './types.js';
import { APPROACH_RADIUS_M, CATCH_RADIUS_M } from './types.js';

const nearbyToastEl = getElement<HTMLDivElement>('nearby-toast');
const arHintEl      = getElement<HTMLDivElement>('ar-hint');

let mapToastTimer: ReturnType<typeof window.setTimeout> | null = null;
let arHintTimer:   ReturnType<typeof window.setTimeout> | null = null;

/** Haversine distance in metres between two lat/lng points. */
export function getDistanceM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R  = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Split features into caught (≤ CATCH_RADIUS_M) and remaining.
 * Remaining features have their `nearby` flag set based on APPROACH_RADIUS_M,
 * which drives the golden aura layer on the map.
 */
export function detectCatches(
  lat: number,
  lng: number,
  features: SlothFeature[],
): { remaining: SlothFeature[]; caught: SlothFeature[] } {
  if (features.length === 0) return { remaining: [], caught: [] };

  const remaining: SlothFeature[] = [];
  const caught: SlothFeature[]    = [];

  for (const f of features) {
    const [slothLng, slothLat] = f.geometry.coordinates as [number, number];
    const dist = getDistanceM(lat, lng, slothLat, slothLng);
    if (dist <= CATCH_RADIUS_M) {
      caught.push(f);
    } else {
      remaining.push({ ...f, properties: { ...f.properties, nearby: dist <= APPROACH_RADIUS_M } });
    }
  }

  return { remaining, caught };
}

/**
 * Fires haptic + chime and shows a contextual catch message.
 * Uses the map's nearby-toast on the map screen, the AR hint on the AR screen.
 */
export function signalCatch(count: number): void {
  const text = count === 1 ? '🦥 Caught a sloth!' : `🦥 Caught ${count} sloths!`;

  navigator.vibrate?.([180, 80, 180]);
  playChime();

  if (getCurrentScreen() === 'ar') {
    arHintEl.textContent = text;
    arHintEl.classList.remove('hidden');
    if (arHintTimer != null) clearTimeout(arHintTimer);
    arHintTimer = window.setTimeout(() => {
      arHintEl.classList.add('hidden');
      arHintTimer = null;
    }, 2_500);
  } else {
    // Re-trigger the slide-up CSS animation by cycling the hidden class.
    nearbyToastEl.textContent = text;
    nearbyToastEl.classList.add('hidden');
    void nearbyToastEl.offsetWidth; // flush layout so animation restarts
    nearbyToastEl.classList.remove('hidden');
    if (mapToastTimer != null) clearTimeout(mapToastTimer);
    mapToastTimer = window.setTimeout(() => {
      nearbyToastEl.classList.add('hidden');
      mapToastTimer = null;
    }, 3_000);
  }
}

export function resetProximityState(): void {
  nearbyToastEl.classList.add('hidden');
  if (mapToastTimer != null) { clearTimeout(mapToastTimer); mapToastTimer = null; }
}

// ── Private ───────────────────────────────────────────────────────────────────

function playChime(): void {
  try {
    const ac    = new AudioContext();
    const notes = [523.25, 659.25, 783.99]; // C5 – E5 – G5 major triad
    notes.forEach((freq, i) => {
      const osc  = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type            = 'sine';
      osc.frequency.value = freq;
      const t0 = ac.currentTime + i * 0.13;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.22, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
      osc.start(t0);
      osc.stop(t0 + 0.35);
    });
  } catch {
    // AudioContext blocked before user gesture — silent fallback
  }
}
