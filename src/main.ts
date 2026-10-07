import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/caveat/latin-600.css';
import '@fontsource/caveat/latin-700.css';
import './styles/main.css';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';

async function boot(): Promise<void> {
  // The answer font is drawn on a canvas, so make sure it is loaded first
  // (it is self-hosted and precached, so this is instant after first visit).
  try {
    await Promise.race([document.fonts.load('600 48px Caveat'), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* fall back to the system handwriting font */
  }
  const app = new App();
  app.start();

  // Precache every asset (app shell, WASM runtime, model, fonts) so the whole
  // app works in airplane mode after the first visit.
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    registerSW({
      immediate: true,
      onOfflineReady: () => app.setOfflineReady(),
      onRegisteredSW: (_url, reg) => {
        if (reg?.active && navigator.serviceWorker.controller) app.setOfflineReady();
      },
    });
  }
}

void boot();
