import { getElement } from './dom.js';
import type { ScreenName } from './types.js';

const SCREEN_IDS: Record<ScreenName, string> = {
  title: 'title-screen',
  map:   'map-screen',
  ar:    'game-screen',
};

let currentScreen: ScreenName = 'title';

/** Show exactly one screen, hiding all others. */
export function showScreen(name: ScreenName): void {
  for (const [key, id] of Object.entries(SCREEN_IDS) as [ScreenName, string][]) {
    const el = getElement<HTMLDivElement>(id);
    if (key === name) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }
  currentScreen = name;
}

export function getCurrentScreen(): ScreenName {
  return currentScreen;
}
