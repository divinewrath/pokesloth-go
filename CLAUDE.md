# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**PokeSloth Go!** is a Pokémon Go–style web game. It is built with **TypeScript + Vite** and bundled
into static assets. Camera and GPS APIs require HTTPS (or `localhost`).

## Commands

```bash
npm install          # install dependencies
npm run dev          # Vite dev server with HMR at http://localhost:5173
npm run build        # tsc --noEmit type-check then Vite production build → dist/
npm run typecheck    # tsc --noEmit only (no bundle)
```

For mobile device testing, tunnel localhost via a tool like `npx localtunnel --port 5173`.

## Architecture

`index.html` is markup-only. All logic lives in `src/`.

Three screens are toggled by adding/removing `.hidden` (`screens.ts`):

1. **Title screen** (`#title-screen`) — splash with "Start" button.
2. **Map screen** (`#map-screen`) — MapLibre GL JS map (OpenFreeMap tiles, no API key). Player
   location tracked via `navigator.geolocation.watchPosition`. Six sloths spawn as a WebGL symbol
   layer using a custom animated Canvas image (`sloth-icon`). A `sloths-aura` circle layer
   highlights nearby sloths. Proximity is computed with the Haversine formula (`getDistanceM` in
   `proximity.ts`); within `NEARBY_RADIUS_M = 15 m` triggers a toast + haptic + chime.
3. **AR / Camera screen** (`#game-screen`) — Three.js scene rendered over a `<video>` camera feed.
   Lazily initialised on first entry (the `initialised` guard in `ar/three-scene.ts`). Uses WebXR
   `immersive-ar` with `hit-test` if supported; falls back to `getUserMedia` rear camera otherwise.
   The 3D sloth is built procedurally in `ar/sloth-model.ts` — no external `.glb`. A commented-out
   `GLTFLoader` block marks where a real model can be swapped in.

### Source module map

| File | Responsibility |
|---|---|
| `src/main.ts` | Entry point — wires screen transitions and module callbacks |
| `src/styles.css` | All CSS (extracted from original inline styles, rules unchanged) |
| `src/dom.ts` | `getElement<T>(id)` — typed, throws if element missing |
| `src/screens.ts` | `showScreen(name)` state machine over the `ScreenName` union |
| `src/types.ts` | `SlothFeature`, `SlothProperties`, `ScreenName`, shared constants |
| `src/map.ts` | `MapController` — MapLibre init, GPS watch, sloth spawn/clear/proximity |
| `src/proximity.ts` | `getDistanceM`, `checkProximity`, toast/haptic/chime side-effects |
| `src/ar/three-scene.ts` | Three.js renderer, WebXR AR session, getUserMedia fallback |
| `src/ar/sloth-model.ts` | `createSloth()` procedural `THREE.Group` |

## Key constants and hooks

| Symbol | File | Purpose |
|---|---|---|
| `NEARBY_RADIUS_M` | `src/types.ts` | Proximity threshold in metres |
| `DEFAULT_LNG/LAT` | `src/types.ts` | Warsaw fallback coords before GPS fix |
| `SLOTH_SPAWN_COUNT` | `src/types.ts` | How many sloths to spawn per location |
| `spawnSloths()` | `src/map.ts` | Adjust `count`/spread to change density |
| `createSloth()` | `src/ar/sloth-model.ts` | All procedural geometry; replace with GLTFLoader for real model |
| `playChime()` | `src/proximity.ts` | C5–E5–G5 Web Audio chime on encounter |

## TypeScript conventions

- **No `any`** — strict mode with `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnusedLocals/Parameters`.
- DOM elements retrieved only via `getElement<T>()` — never `querySelector` with `!` or unchecked nulls.
- `SlothFeature = GeoJSON.Feature<Point, SlothProperties>` — sloth GeoJSON is fully typed.
- `@types/webxr` covers `XRHitTestSource`, `XRFrame`, reference spaces.
- Vendor-prefixed CSS properties set via `element.style.setProperty(...)`, not `Object.assign`.

## Dependencies

- **Runtime:** `three`, `maplibre-gl` (maplibre ships its own types)
- **Dev:** `typescript`, `vite`, `@types/three`, `@types/webxr`, `@types/geojson`
- **Tile source:** OpenFreeMap `liberty` style — no API key required
