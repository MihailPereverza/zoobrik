import { GitHubBackend, serverBackend, type Backend } from './backend';
import type { RepoConfig } from './github';
import type { DeckData } from './types';

type Theme = 'system' | 'light' | 'dark';
export const STANDALONE = import.meta.env.VITE_STANDALONE === '1';

function stored(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function store(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage unavailable: setting lives for this tab only */ }
}

function storedRepo(): RepoConfig | null {
  try { return JSON.parse(stored('zb.github', 'null')); } catch { return null; }
}

export const app = $state({
  data: null as DeckData | null,
  error: '',
  theme: stored('zb.theme', 'system') as Theme,
  device: stored('zb.device', /iPhone|iPad/i.test(navigator.userAgent) ? 'iphone' : /Android/i.test(navigator.userAgent) ? 'android' : 'mac'),
  effectiveTheme: 'light' as 'light' | 'dark',
  version: 0,
  mode: (stored('zb.backend', STANDALONE ? 'github' : 'server')) as 'server' | 'github',
  repo: storedRepo(),
  pending: 0,
  syncing: false,
  syncMessage: '',
  online: navigator.onLine,
});

let current: Backend | null = null;
export function backend(): Backend {
  if (!current) current = app.mode === 'github' && app.repo ? new GitHubBackend(app.repo) : serverBackend;
  return current;
}

export const needsSetup = () => app.mode === 'github' && !app.repo;

const media = matchMedia('(prefers-color-scheme: dark)');

export function applyTheme() {
  const effective = app.theme === 'system' ? (media.matches ? 'dark' : 'light') : app.theme;
  app.effectiveTheme = effective;
  document.documentElement.dataset.theme = effective;
  document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute('content', effective === 'dark' ? '#121212' : '#FFFFFF');
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

export function setRepo(repo: RepoConfig | null, mode: 'server' | 'github' = 'github') {
  app.repo = repo;
  app.mode = mode;
  store('zb.github', repo ? JSON.stringify(repo) : null);
  store('zb.backend', STANDALONE && mode === 'github' ? null : mode);
  current = null;
  app.data = null;
}

export async function refreshPending() {
  app.pending = await backend().pendingCount();
}

export async function reload() {
  if (needsSetup()) { app.data = null; app.error = ''; return; }
  try {
    app.data = await backend().load();
    app.error = '';
    app.version += 1;
    await refreshPending();
  } catch (error) {
    app.error = (error as Error).message;
  }
}

export async function sync(): Promise<string> {
  if (app.syncing || needsSetup()) return '';
  app.syncing = true;
  try {
    const res = await backend().sync(app.device);
    app.syncMessage = res.log;
    if (res.ok && backend().kind === 'github') app.data = await backend().load();
    app.version += 1;
    await refreshPending();
    return res.log;
  } catch (error) {
    app.syncMessage = `Синхронизация не удалась: ${(error as Error).message}`;
    return app.syncMessage;
  } finally {
    app.syncing = false;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
export function scheduleSync(delayMs = 90_000) {
  if (backend().kind !== 'github') return;
  clearTimeout(timer);
  timer = setTimeout(() => { if (navigator.onLine) sync(); }, delayMs);
}

addEventListener('online', () => { app.online = true; scheduleSync(2000); });
addEventListener('offline', () => { app.online = false; });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && app.pending) scheduleSync(0); });

export function touch() { app.version += 1; }
