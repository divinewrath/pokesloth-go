import { getDistanceM } from '../proximity.js';

/** Forward azimuth in degrees — 0 = North, 90 = East, clockwise. */
export function getBearingDeg(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y  = Math.sin(Δλ) * Math.cos(φ2);
  const x  = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Visible ring extents in scene metres. */
const MIN_SCENE_DIST = 3;
const MAX_SCENE_DIST = 25;

/**
 * Convert a real-world bearing + distance into a Three.js scene XZ position.
 *
 * Convention: +X = East, −Z = North (Y-up right-handed).
 *
 * Real distance is clamped to [MIN_SCENE_DIST, MAX_SCENE_DIST] so every sloth
 * stays findable; the true distance is returned separately for the distance label.
 */
export function toScenePosition(
  distanceM: number,
  bearingDeg: number,
): { x: number; z: number; sceneDist: number } {
  const sceneDist = Math.min(Math.max(distanceM, MIN_SCENE_DIST), MAX_SCENE_DIST);
  const θ = (bearingDeg * Math.PI) / 180;
  return {
    x: Math.sin(θ) * sceneDist,
    z: -Math.cos(θ) * sceneDist,
    sceneDist,
  };
}

/**
 * Model scale that keeps sloths readable across the clamped ring.
 * Interpolates linearly from 0.55 at MIN_SCENE_DIST to 0.25 at MAX_SCENE_DIST.
 */
export function scaleForDistance(sceneDist: number): number {
  const t = Math.min(Math.max((sceneDist - MIN_SCENE_DIST) / (MAX_SCENE_DIST - MIN_SCENE_DIST), 0), 1);
  return 0.55 - t * 0.30;
}

export { getDistanceM };
