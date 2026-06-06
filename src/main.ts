import './styles.css';
import { getElement } from './dom.js';
import { showScreen } from './screens.js';
import { initMap, resizeMap } from './map.js';
import { enterARScene, pauseARScene } from './ar/three-scene.js';

const startBtn = getElement<HTMLButtonElement>('start-btn');
const backBtn  = getElement<HTMLButtonElement>('back-btn');

// ── Screen flow ───────────────────────────────────────────────────────────────

startBtn.addEventListener('click', () => {
  showScreen('map');
  // rAF lets the browser complete layout so MapLibre reads the correct container size
  requestAnimationFrame(() => initMap(enterAR));
});

backBtn.addEventListener('click', () => {
  pauseARScene();
  showScreen('map');
  resizeMap(); // re-check container size
});

async function enterAR(): Promise<void> {
  showScreen('ar');
  await enterARScene();
}
