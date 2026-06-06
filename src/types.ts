import type { Feature, Point } from 'geojson';

export type ScreenName = 'title' | 'map' | 'ar';

export interface SlothProperties {
  id: number;
  nearby: boolean;
}

export type SlothFeature = Feature<Point, SlothProperties>;

export const NEARBY_RADIUS_M = 15;
export const DEFAULT_LNG = 21.012; // Warsaw — overwritten by real GPS on first fix
export const DEFAULT_LAT = 52.229;
export const SLOTH_SPAWN_COUNT = 6;
