import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { applyTheme } from './lib/state.svelte';
import { log } from './lib/log';
import { installFonts } from './lib/fonts';

installFonts();

log('app', 'start', { build: __BUILD__, ua: navigator.userAgent, standalone: matchMedia('(display-mode: standalone)').matches });
addEventListener('error', (e) => log('app', 'error', { message: e.message, source: e.filename?.split('/').pop(), line: e.lineno }));
addEventListener('unhandledrejection', (e) => log('app', 'unhandled rejection', String((e.reason as Error)?.message ?? e.reason)));

applyTheme();
mount(App, { target: document.getElementById('app')! });

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onRegisteredSW(_url, registration) {
          log('app', 'service worker registered', { active: Boolean(registration?.active) });
          document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') registration?.update(); });
        },
        onRegisterError(error) { log('app', 'service worker failed', String(error)); },
      });
    })
    .catch((e) => log('app', 'service worker failed', String(e)));
}
