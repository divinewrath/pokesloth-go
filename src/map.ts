import maplibregl, { type StyleImageInterface } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getElement } from './dom.js';
import { detectCatches, resetProximityState, signalCatch } from './proximity.js';
import type { GeoContext, SlothFeature } from './types.js';
import { DEFAULT_LAT, DEFAULT_LNG, SLOTH_SPAWN_COUNT } from './types.js';

const gpsPillEl    = getElement<HTMLDivElement>('gps-pill');
const slothBadgeEl = getElement<HTMLDivElement>('sloth-badge');

let map: maplibregl.Map | null  = null;
let playerMarker: maplibregl.Marker | null = null;
let mapCentered  = false;
let slothFeatures: SlothFeature[] = [];

// Player position — seeded with fallback, updated on each GPS fix.
let playerLat = DEFAULT_LAT;
let playerLng = DEFAULT_LNG;

// Catch progress counters — reset whenever sloths are respawned.
let caughtCount  = 0;
let totalSpawned = 0;

// Callback set by the caller — pushed on every GPS tick so AR stays live.
let onGeoUpdateCallback: (ctx: GeoContext) => void = () => { /* wired in initMap */ };

/** Initialise the MapLibre map. Call once the map-screen element is visible. */
export function initMap(
  onSlothEncounter: (ctx: GeoContext) => void,
  onGeoUpdate: (ctx: GeoContext) => void,
): void {
  onGeoUpdateCallback = onGeoUpdate;

  map = new maplibregl.Map({
    container: 'map',
    style:     'https://tiles.openfreemap.org/styles/liberty',
    center:    [DEFAULT_LNG, DEFAULT_LAT],
    zoom:      16,
    maxZoom:   19,
  });

  // Player dot — single HTML marker is fine; it uses box-shadow not transform
  const playerEl       = document.createElement('div');
  playerEl.className   = 'player-dot';
  playerMarker = new maplibregl.Marker({ element: playerEl, anchor: 'center' })
    .setLngLat([DEFAULT_LNG, DEFAULT_LAT])
    .addTo(map);

  map.on('load', () => {
    setupSlothLayer(map!); // map is non-null: we're inside its own 'load' handler
    map!.on('click', 'sloths', () =>
      onSlothEncounter({ lat: playerLat, lng: playerLng, sloths: slothFeatures }),
    );
    map!.on('mouseenter', 'sloths', () => { map!.getCanvas().style.cursor = 'pointer'; });
    map!.on('mouseleave', 'sloths', () => { map!.getCanvas().style.cursor = '';        });
    spawnSloths(DEFAULT_LNG, DEFAULT_LAT);
  });

  if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(onGPSUpdate, onGPSError, {
      enableHighAccuracy: true,
      maximumAge:         0,
      timeout:            12_000,
    });
  } else {
    gpsPillEl.textContent = '📍 GPS not available — demo location';
  }
}

/** Let MapLibre know its container was resized (call when returning to map screen). */
export function resizeMap(): void {
  map?.resize();
}

// ── Private helpers ───────────────────────────────────────────────────────────

function setupSlothLayer(m: maplibregl.Map): void {
  // Animated sloth icon via MapLibre's custom image API.
  // render() is called every WebGL repaint; returning true + triggerRepaint() keeps
  // the loop running. Drawn in WebGL so it stays in sync with map tiles — no DOM lag.
  const S = 64;
  const iconCanvas = Object.assign(document.createElement('canvas'), { width: S, height: S });
  const iconCtx    = iconCanvas.getContext('2d')!;

  const slothIcon: StyleImageInterface = {
    width:  S,
    height: S,
    data:   new Uint8Array(S * S * 4),

    render(): boolean {
      const pulse = 1 + Math.sin(performance.now() / 700) * 0.055;

      iconCtx.clearRect(0, 0, S, S);
      iconCtx.save();
      iconCtx.translate(S / 2, S / 2);
      iconCtx.scale(pulse, pulse);
      iconCtx.translate(-S / 2, -S / 2);

      iconCtx.shadowColor   = 'rgba(0,0,0,0.28)';
      iconCtx.shadowBlur    = 6;
      iconCtx.shadowOffsetY = 2;

      iconCtx.fillStyle = '#fff';
      iconCtx.beginPath();
      iconCtx.arc(S / 2, S / 2, S / 2 - 4, 0, 2 * Math.PI);
      iconCtx.fill();

      iconCtx.shadowColor = 'transparent';
      iconCtx.strokeStyle = '#4CAF50';
      iconCtx.lineWidth   = 4;
      iconCtx.beginPath();
      iconCtx.arc(S / 2, S / 2, S / 2 - 4, 0, 2 * Math.PI);
      iconCtx.stroke();

      iconCtx.font         = '28px serif';
      iconCtx.textAlign    = 'center';
      iconCtx.textBaseline = 'middle';
      iconCtx.fillStyle    = '#000';
      iconCtx.fillText('🦥', S / 2, S / 2 + 1);

      iconCtx.restore();
      this.data = new Uint8Array(iconCtx.getImageData(0, 0, S, S).data.buffer);
      m.triggerRepaint();
      return true;
    },
  };

  m.addImage('sloth-icon', slothIcon);

  // GeoJSON source + symbol layer — points rendered in WebGL
  m.addSource('sloths', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // Golden aura behind approaching sloths — circle layer filtered to nearby: true.
  // "nearby" is now set when within APPROACH_RADIUS_M (30 m) as a warm cue.
  m.addLayer({
    id:     'sloths-aura',
    type:   'circle',
    source: 'sloths',
    filter: ['==', ['get', 'nearby'], true],
    paint: {
      'circle-radius':         34,
      'circle-color':          'rgba(255,220,0,0.22)',
      'circle-stroke-color':   '#FFE066',
      'circle-stroke-width':   2.5,
      'circle-stroke-opacity': 0.75,
      'circle-blur':           0.5,
    },
  });

  m.addLayer({
    id:     'sloths',
    type:   'symbol',
    source: 'sloths',
    layout: {
      'icon-image':         'sloth-icon',
      'icon-size':          0.85,
      'icon-allow-overlap': true,
      'icon-anchor':        'center',
    },
  });
}

function spawnSloths(centerLng: number, centerLat: number, count = SLOTH_SPAWN_COUNT): void {
  caughtCount  = 0;
  totalSpawned = count;

  slothFeatures = Array.from({ length: count }, (_, i): SlothFeature => ({
    type: 'Feature',
    geometry: {
      type:        'Point',
      coordinates: [
        centerLng + (Math.random() - 0.5) * 0.006,
        centerLat + (Math.random() - 0.5) * 0.006,
      ],
    },
    properties: { id: i, nearby: false },
  }));

  setSlothData(slothFeatures);
  updateBadge();
}

function clearSloths(): void {
  slothFeatures = [];
  resetProximityState();
  setSlothData([]);
}

function setSlothData(features: SlothFeature[]): void {
  (map?.getSource('sloths') as maplibregl.GeoJSONSource | undefined)
    ?.setData({ type: 'FeatureCollection', features });
}

function updateBadge(): void {
  slothBadgeEl.textContent = `🦥 ${caughtCount}/${totalSpawned}`;
}

function onGPSUpdate(pos: GeolocationPosition): void {
  const { latitude: lat, longitude: lng } = pos.coords;
  playerLat = lat;
  playerLng = lng;
  playerMarker?.setLngLat([lng, lat]);
  gpsPillEl.textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  // Check catches BEFORE the first-GPS respawn so default sloths can't be caught.
  if (mapCentered) {
    const { remaining, caught } = detectCatches(lat, lng, slothFeatures);
    if (caught.length > 0) {
      caughtCount += caught.length;
      updateBadge();
      signalCatch(caught.length);
    }
    slothFeatures = remaining;
    setSlothData(slothFeatures);

    // Push live geo snapshot to the AR view (no-op if AR not open).
    onGeoUpdateCallback({ lat, lng, sloths: slothFeatures });
  }

  if (!mapCentered) {
    mapCentered = true;
    map?.flyTo({ center: [lng, lat], zoom: 16, duration: 1_400 });
    clearSloths();
    map?.once('idle', () => spawnSloths(lng, lat));
  }
}

function onGPSError(): void {
  gpsPillEl.textContent = '📍 GPS unavailable — using demo location';
}
