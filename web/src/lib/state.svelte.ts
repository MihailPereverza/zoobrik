import YAML from 'yaml';
import { countActivity, GitHubBackend, LocalBackend, localRoots, ServerBackend, serverFiles, type Backend, type StoreKind } from './backend';
import { deckRoots } from './deckfs';
import type { RepoConfig } from './github';
import { deckLangs } from './lang';
import { dayKey } from './progress';
import type { DeckData } from './types';
import { log } from './log';

export type ThemeId = 'pushcha' | 'night' | 'snow' | 'contrast';
type Theme = 'system' | ThemeId;
export type MascotMode = 'active' | 'quiet' | 'off';
export const THEMES: { id: ThemeId; name: string; bg: string; btn: string }[] = [
  { id: 'pushcha', name: 'Пуща', bg: '#F3F0EA', btn: '#33251C' },
  { id: 'night', name: 'Ночь', bg: '#141110', btn: '#E6DAC4' },
  { id: 'snow', name: 'Снег', bg: '#EDF0F2', btn: '#33251C' },
  { id: 'contrast', name: 'Контраст', bg: '#FFFFFF', btn: '#000000' },
];
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
  theme: (['system', 'pushcha', 'night', 'snow', 'contrast'].includes(stored('zb.theme', 'system')) ? stored('zb.theme', 'system') : 'system') as Theme,
  device: stored('zb.device', /iPhone|iPad/i.test(navigator.userAgent) ? 'iphone' : /Android/i.test(navigator.userAgent) ? 'android' : 'mac'),
  effectiveTheme: 'pushcha' as ThemeId,
  mascotMode: stored('zb.mascot', 'active') as MascotMode,
  mascotMotion: stored('zb.mascotMotion', '1') === '1',
  version: 0,
  mode: (stored('zb.backend', STANDALONE ? 'github' : 'server')) as 'server' | 'github',
  repo: storedRepo(),
  pending: 0,
  syncing: false,
  syncMessage: '',
  online: navigator.onLine,
  goal: Number(stored('zb.goal', '30')) || 30,
  activity: {} as Record<string, number>,
  decks: [] as DeckRef[],
  deckKey: stored('zb.deck', ''),
  scanned: false,
});

/** A deck in one of the stores: the GitHub library repository, the files on this Mac (dev) or this device. */
export interface DeckRef { key: string; store: StoreKind; root: string; name: string; lang: string; description: string; source: string; cards: number }

export function openDeck(ref: Pick<DeckRef, 'store' | 'root'>): Backend {
  if (ref.store === 'github' && app.repo) return new GitHubBackend(app.repo, ref.root);
  if (ref.store === 'local') return new LocalBackend(ref.root);
  return new ServerBackend(ref.root);
}

function describe(store: StoreKind, root: string, files: Map<string, string> | Record<string, string>): DeckRef {
  const get = (p: string) => (files instanceof Map ? files.get(p) : files[p]);
  let deck: any = {};
  try { deck = YAML.parse(get(`${root}deck.yaml`) ?? '') ?? {}; } catch { /* a broken deck.yaml still shows up, so it can be fixed or removed */ }
  const langs = deckLangs(deck);
  const keys = files instanceof Map ? [...files.keys()] : Object.keys(files);
  const cards = keys.filter((p) => p.startsWith(`${root}topics/`) && p.endsWith('/card.yaml') && !(root === '' && p.startsWith('decks/'))).length;
  return { key: `${store}:${root}`, store, root, name: deck.name ?? (root || 'Колода'), lang: `${langs.target.short} → ${langs.native.short}`, description: deck.description ?? '', source: deck.source?.url ?? '', cards };
}

/** Lists decks of every available store; a store that fails (offline, revoked token) is skipped, not fatal. */
export async function scanLibrary(): Promise<DeckRef[]> {
  const found: DeckRef[] = [];
  if (app.mode === 'server') {
    try { const l = await serverFiles(true); found.push(...deckRoots(Object.keys(l.texts)).map((r) => describe('server', r, l.texts))); } catch (e) { log('library', 'server unavailable', String(e)); }
  } else if (app.repo) {
    const gh = new GitHubBackend(app.repo);
    const texts = await gh.allTexts();
    found.push(...deckRoots(texts.keys()).map((r) => describe('github', r, texts)));
  }
  for (const root of await localRoots()) {
    const { texts } = await new LocalBackend(root).listing();
    found.push(describe('local', root, new Map([...texts].map(([p, t]) => [root + p, t]))));
  }
  return found;
}

export function setActiveDeck(key: string) {
  app.deckKey = key;
  store('zb.deck', key);
  current = null;
}

export const activeDeck = (): DeckRef | undefined => app.decks.find((d) => d.key === app.deckKey) ?? app.decks[0];

export async function refreshActivity() {
  try { app.activity = await backend().activity(); } catch { /* activity is decorative: keep the previous numbers */ }
}

/** Counts fresh answers right away, so the daily goal and Zubrik react during a session, not after the next reload. */
export function bumpActivity(lines: string[]) {
  const add = countActivity(lines);
  if (!Object.keys(add).length) return;
  const next = { ...app.activity };
  for (const [day, n] of Object.entries(add)) next[day] = (next[day] ?? 0) + n;
  app.activity = next;
}

export const goalMet = (now = new Date()) => (app.activity[dayKey(now)] ?? 0) >= app.goal;

export function setGoal(goal: number) {
  app.goal = goal;
  store('zb.goal', String(goal));
}

let current: Backend | null = null;
export function backend(): Backend {
  if (!current) {
    const ref = activeDeck();
    current = ref ? openDeck(ref) : app.mode === 'github' && app.repo ? new GitHubBackend(app.repo) : new ServerBackend('');
  }
  return current;
}

/** Nothing to study yet: no repository connected and no deck on the device. */
export const needsSetup = () => app.scanned && !app.decks.length;

const media = matchMedia('(prefers-color-scheme: dark)');

export function applyTheme() {
  const effective: ThemeId = app.theme === 'system' ? (media.matches ? 'night' : 'pushcha') : app.theme;
  app.effectiveTheme = effective;
  document.documentElement.dataset.theme = effective;
  document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute('content', THEMES.find((t) => t.id === effective)!.bg);
}
media.addEventListener('change', applyTheme);

export function setTheme(theme: Theme) {
  app.theme = theme;
  store('zb.theme', theme);
  applyTheme();
}

export function setMascot(mode: MascotMode) {
  app.mascotMode = mode;
  store('zb.mascot', mode);
}

export function setMascotMotion(on: boolean) {
  app.mascotMotion = on;
  store('zb.mascotMotion', on ? '1' : '0');
}

export const isDark = () => app.effectiveTheme === 'night';

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
  try {
    app.decks = await scanLibrary();
    app.scanned = true;
    if (!app.decks.length) { app.data = null; app.error = ''; return; }
    if (!app.decks.some((d) => d.key === app.deckKey)) setActiveDeck(app.decks[0].key);
    current = null;
    app.data = await backend().load();
    app.error = '';
    app.version += 1;
    await refreshPending();
    refreshActivity();
    log('deck', 'loaded', { mode: backend().kind, topics: app.data.topics.length, cards: app.data.topics.reduce((n, t) => n + t.cards.length, 0), pending: app.pending });
  } catch (error) {
    app.error = (error as Error).message;
    log('deck', 'load failed', app.error);
  }
}

export async function sync(): Promise<string> {
  if (app.syncing || needsSetup()) return '';
  app.syncing = true;
  try {
    log('sync', 'start', { pending: app.pending, device: app.device });
    const res = await backend().sync(app.device);
    log('sync', res.ok ? 'done' : 'failed', res.log);
    app.syncMessage = res.log;
    if (res.ok && backend().kind === 'github') { app.data = await backend().load(); app.decks = await scanLibrary(); }
    app.version += 1;
    await refreshPending();
    return res.log;
  } catch (error) {
    app.syncMessage = `Синхронизация не удалась: ${(error as Error).message}`;
    log('sync', 'error', String((error as Error).message));
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
