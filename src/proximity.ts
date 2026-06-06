import { getElement } from './dom.js';
import type { SlothFeature } from './types.js';
import { NEARBY_RADIUS_M } from './types.js';

const nearbyToastEl = getElement<HTMLDivElement>('nearby-toast');

let prevNearbyCount = 0;

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
 * Re-evaluates which sloths are within NEARBY_RADIUS_M of the player position.
 * Returns a new array with updated `nearby` properties.
 * Side-effects: updates the toast UI and fires haptic/chime when entering proximity.
 */
export function checkProximity(
  lat: number,
  lng: number,
  features: SlothFeature[],
): SlothFeature[] {
  if (features.length === 0) return features;

  let nearbyCount = 0;

  const updated: SlothFeature[] = features.map((f) => {
    const [slothLng, slothLat] = f.geometry.coordinates as [number, number];
    const dist   = getDistanceM(lat, lng, slothLat, slothLng);
    const nearby = dist <= NEARBY_RADIUS_M;
    if (nearby) nearbyCount++;
    return { ...f, properties: { ...f.properties, nearby } };
  });

  if (nearbyCount > 0 && prevNearbyCount === 0) {
    // Transition: none → some
    signalNearbySloth(nearbyCount);
  } else if (nearbyCount > prevNearbyCount && prevNearbyCount > 0) {
    // Another sloth just entered range — update text, no repeated beep
    nearbyToastEl.textContent = toastText(nearbyCount);
  } else if (nearbyCount === 0 && prevNearbyCount > 0) {
    // All out of range — dismiss
    nearbyToastEl.classList.add('hidden');
  }

  prevNearbyCount = nearbyCount;
  return updated;
}

export function resetProximityState(): void {
  prevNearbyCount = 0;
  nearbyToastEl.classList.add('hidden');
}

function toastText(count: number): string {
  return count === 1
    ? '🦥 Sloth nearby! Tap to encounter'
    : `🦥 ${count} sloths nearby! Tap any to encounter`;
}

function signalNearbySloth(count: number): void {
  nearbyToastEl.textContent = toastText(count);

  // Re-trigger CSS slide-up animation by forcing a reflow
  nearbyToastEl.classList.add('hidden');
  void nearbyToastEl.offsetWidth; // flush layout so animation restarts
  nearbyToastEl.classList.remove('hidden');

  navigator.vibrate?.([180, 80, 180]); // double-pulse haptic (ignored on desktop)
  playChime();
}

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
