import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { applyTheme } from './lib/state.svelte';

applyTheme();
mount(App, { target: document.getElementById('app')! });

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') registration?.update(); });
      },
    });
    void update;
  });
}
