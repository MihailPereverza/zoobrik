import { loadDeck } from './api';
import type { DeckData } from './types';

type Theme = 'system' | 'light' | 'dark';

function stored(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: setting lives for this tab only */ }
}

export const app = $state({
  data: null as DeckData | null,
  error: '',
  theme: stored('zb.theme', 'system') as Theme,
  device: stored('zb.device', /iPhone|Android/i.test(navigator.userAgent) ? 'phone' : 'mac'),
  effectiveTheme: 'light' as 'light' | 'dark',
  version: 0,
});

const media = matchMedia('(prefers-color-scheme: dark)');

export function applyTheme() {
  const effective = app.theme === 'system' ? (media.matches ? 'dark' : 'light') : app.theme;
  app.effectiveTheme = effective;
  document.documentElement.dataset.theme = effective;
}
media.addEventListener('change', applyTheme);

export function setTheme(theme: Theme) {
  app.theme = theme;
  store('zb.theme', theme);
  applyTheme();
}

export function setDevice(device: string) {
  app.device = device.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'device';
  store('zb.device', app.device);
}

export async function reload() {
  try {
    app.data = await loadDeck();
    app.error = '';
    app.version += 1;
  } catch (error) {
    app.error = (error as Error).message;
  }
}

export function touch() { app.version += 1; }
