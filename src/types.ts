import type { Feature, Point } from 'geojson';

export type ScreenName = 'title' | 'map' | 'ar';

export interface SlothProperties {
  id: number;
  nearby: boolean;
}

export type SlothFeature = Feature<Point, SlothProperties>;

/** Snapshot of the player's GPS position and all spawned sloths at AR-entry time. */
export interface GeoContext {
  lat: number;
  lng: number;
  sloths: SlothFeature[];
}

/** Within this radius (m) the sloth is automatically caught. */
export const CATCH_RADIUS_M = 15;
/** Within this radius (m) the golden aura glows as a "getting warm" cue. */
export const APPROACH_RADIUS_M = 30;
export const DEFAULT_LNG = 21.012; // Warsaw — overwritten by real GPS on first fix
export const DEFAULT_LAT = 52.229;
export const SLOTH_SPAWN_COUNT = 6;
