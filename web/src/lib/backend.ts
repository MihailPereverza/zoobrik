import { createStore, del, get, set } from 'idb-keyval';
import * as api from './api';
import { patchCardExercise, patchMdExercise, readProgress, withDeckParams, withProgress, type ExercisePatch } from './cardyaml';
import { CORE } from './core';
import { buildDeck, deckRoots, isTextFile, type FileMap } from './deckfs';
import { createBinaryBlob, createBlob, createCommit, createTree, getBlob, getHead, getTextBlob, getTextBlobs, getTree, GitHubError, pool, updateRef, type RepoConfig, type TreeChange } from './github';
import { mergeProgress } from './progress';
import { log } from './log';
import type { PackageFile, Progress as OnProgress } from './package';
import type { DeckData, Progress } from './types';

export interface SyncResult { ok: boolean; log: string }
export type StoreKind = 'server' | 'github' | 'local';

export interface Backend {
  kind: StoreKind;
  /** Deck folder inside the store: '' or 'decks/<id>/'. */
  root: string;
  load(): Promise<DeckData>;
  saveAnswer(device: string, updates: { cardPath: string; progress: Progress }[], lines: string[]): Promise<void>;
  patchExercise(body: { cardPath: string; exerciseId: string; file?: string; patch: ExercisePatch }): Promise<void>;
  sync(device: string): Promise<SyncResult>;
  activity(): Promise<Record<string, number>>;
  media(url: string): Promise<string>;
  mediaNow(url: string): string | null;
  mediaExists(url: string): Promise<boolean>;
  pendingCount(): Promise<number>;
  journal(): Promise<string[]>;
  saveParams(params: number[] | null): Promise<void>;
  /** Every file of the deck, paths relative to its folder; media is downloaded. */
  files(onProgress?: OnProgress): Promise<PackageFile[]>;
  /** Text files of the deck (relative paths) and the set of its media paths, without downloading media. */
  listing(): Promise<{ texts: Map<string, string>; media: Set<string> }>;
  /** Writes files into the deck folder and removes others; used by import and update. */
  write(files: PackageFile[], remove: string[], message: string, onProgress?: OnProgress): Promise<void>;
  /** Removes the whole deck folder. */
  destroy(): Promise<void>;
}

const MEDIA_PREFIX = '/deck/';
const store = createStore('zoobrik', 'kv');

export function countActivity(lines: string[]): Record<string, number> {
  const days: Record<string, number> = {};
  for (const l of lines) {
    const d = l.slice(0, 10);
    const grade = l.split('\t')[4];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || grade === 'seen') continue;
    days[d] = (days[d] ?? 0) + (grade === 'undo' ? -1 : 1);
  }
  return days;
}

export function mediaPathOf(url: string): string | null {
  const at = url.indexOf(MEDIA_PREFIX);
  return at < 0 ? null : decodeURIComponent(url.slice(at + MEDIA_PREFIX.length));
}

const mimeOf = (path: string) => (/\.mp3$/i.test(path) ? 'audio/mpeg' : /\.(ogg|opus)$/i.test(path) ? 'audio/ogg' : /\.wav$/i.test(path) ? 'audio/wav' : /\.m4a$/i.test(path) ? 'audio/mp4'
  : /\.png$/i.test(path) ? 'image/png' : /\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.webp$/i.test(path) ? 'image/webp' : /\.svg$/i.test(path) ? 'image/svg+xml' : 'application/octet-stream');

const relative = (root: string, paths: Iterable<string>) => [...paths].filter((p) => p.startsWith(root) && !(root === '' && p.startsWith('decks/'))).map((p) => p.slice(root.length));

/** Imported decks may leave their audio at the source; a missing local file is then fetched from there. */
function sourceMedia(data: DeckData | null, root: string, path: string): string | null {
  const base = data?.deck.source?.media;
  return base && path.startsWith(root) ? `${base}/${path.slice(root.length).split('/').map(encodeURIComponent).join('/')}` : null;
}

// ---------------------------------------------------------------- dev server (files on this Mac)

let serverListing: Promise<api.Listing> | null = null;
export function serverFiles(fresh = false): Promise<api.Listing> {
  if (!serverListing || fresh) serverListing = api.listFiles();
  return serverListing;
}

export class ServerBackend implements Backend {
  kind = 'server' as const;
  private data: DeckData | null = null;
  constructor(public root: string) {}

  async load() {
    const listing = await serverFiles(true);
    this.known = new Set(listing.binaries);
    this.data = buildDeck(new Map(Object.entries(listing.texts)), CORE, this.root, listing.binaries);
    return this.data;
  }
  async saveAnswer(device: string, updates: { cardPath: string; progress: Progress }[], lines: string[]) { await api.saveAnswer(this.root, device, updates, lines); }
  async patchExercise(body: { cardPath: string; exerciseId: string; file?: string; patch: ExercisePatch }) { await api.patchExercise(body); }
  sync(device: string) { return api.syncDeck(device); }
  async activity() { return countActivity(await this.journal()); }
  journal() { return api.loadJournal(this.root); }
  async media(url: string) { return this.mediaNow(url); }
  mediaNow(url: string) {
    const path = mediaPathOf(url);
    return path && !this.known.has(path) ? sourceMedia(this.data, this.root, path) ?? url : url;
  }
  private known = new Set<string>();
  async mediaExists(url: string) { const path = mediaPathOf(url); return Boolean(path && (await serverFiles()).binaries.includes(path)); }
  async pendingCount() { return 0; }
  async saveParams(params: number[] | null) { await api.saveDeckParams(this.root, params); }
  async listing() {
    const l = await serverFiles();
    return { texts: new Map(relative(this.root, Object.keys(l.texts)).map((p) => [p, l.texts[this.root + p]])), media: new Set(relative(this.root, l.binaries)) };
  }
  async files(onProgress?: OnProgress) {
    const { texts, media } = await this.listing();
    let done = 0;
    const binaries = await pool([...media], 8, async (path) => {
      const res = await fetch(`${MEDIA_PREFIX}${this.root}${path}`);
      onProgress?.(++done, media.size);
      return { path, bytes: new Uint8Array(await res.arrayBuffer()) };
    });
    return [...[...texts].map(([path, text]) => ({ path, text })), ...binaries];
  }
  async write(files: PackageFile[], remove: string[], _message: string, onProgress?: OnProgress) {
    for (let i = 0; i < files.length; i += 40) {
      await api.writeFiles(this.root, files.slice(i, i + 40), i === 0 ? remove : []);
      onProgress?.(Math.min(i + 40, files.length), files.length);
    }
    if (!files.length && remove.length) await api.writeFiles(this.root, [], remove);
    await serverFiles(true);
  }
  async destroy() { await api.removeDeck(this.root); await serverFiles(true); }
}

// ---------------------------------------------------------------- this device only (IndexedDB)

interface LocalDeck { texts: Record<string, string>; media: string[] }
const LOCAL_INDEX = 'local:decks';

export async function localRoots(): Promise<string[]> { return (await get(LOCAL_INDEX, store)) ?? []; }

export class LocalBackend implements Backend {
  kind = 'local' as const;
  private urls = new Map<string, string>();
  private data: DeckData | null = null;
  constructor(public root: string) {}

  private key() { return `local:deck:${this.root}`; }
  private async deck(): Promise<LocalDeck> { return (await get(this.key(), store)) ?? { texts: {}, media: [] }; }
  private async save(d: LocalDeck) { await set(this.key(), d, store); }

  async load() {
    const d = await this.deck();
    this.data = buildDeck(new Map(Object.entries(d.texts)), CORE, this.root, d.media);
    return this.data;
  }

  private async editText(path: string, change: (text: string) => string) {
    const d = await this.deck();
    if (d.texts[path] === undefined) throw new Error(`Нет файла ${path}`);
    d.texts[path] = change(d.texts[path]);
    await this.save(d);
  }

  async saveAnswer(device: string, updates: { cardPath: string; progress: Progress }[], lines: string[]) {
    const d = await this.deck();
    for (const u of updates) d.texts[`${u.cardPath}/card.yaml`] = withProgress(d.texts[`${u.cardPath}/card.yaml`] ?? '', u.progress);
    for (const line of lines) {
      const path = `${this.root}journal/${line.slice(0, 7)}/${device}.tsv`;
      d.texts[path] = (d.texts[path] ?? '') + line + '\n';
    }
    await this.save(d);
  }

  async patchExercise(body: { cardPath: string; exerciseId: string; file?: string; patch: ExercisePatch }) {
    if (body.file) await this.editText(`${body.cardPath}/${body.file}`, (t) => patchMdExercise(t, body.patch));
    else await this.editText(`${body.cardPath}/card.yaml`, (t) => patchCardExercise(t, body.exerciseId, body.patch));
  }

  async sync(): Promise<SyncResult> { return { ok: true, log: 'Колода хранится только на этом устройстве.' }; }
  async journal() {
    const d = await this.deck();
    return Object.entries(d.texts).filter(([p]) => p.startsWith(`${this.root}journal/`)).flatMap(([, t]) => t.split('\n').filter(Boolean)).sort();
  }
  async activity() { return countActivity(await this.journal()); }
  async pendingCount() { return 0; }
  async saveParams(params: number[] | null) { await this.editText(`${this.root}deck.yaml`, (t) => withDeckParams(t, params)); }

  async media(url: string) {
    const path = mediaPathOf(url);
    if (!path) return url;
    const cached = this.urls.get(path);
    if (cached) return cached;
    const blob: Blob | undefined = await get(`local:bin:${path}`, store);
    if (!blob) return sourceMedia(this.data, this.root, path) ?? Promise.reject(new Error(`Нет файла ${path}`));
    const objectUrl = URL.createObjectURL(blob);
    this.urls.set(path, objectUrl);
    return objectUrl;
  }
  mediaNow(url: string) { const path = mediaPathOf(url); return path ? this.urls.get(path) ?? null : url; }
  async mediaExists(url: string) { const path = mediaPathOf(url); return Boolean(path && (await this.deck()).media.includes(path)); }

  async listing() {
    const d = await this.deck();
    return { texts: new Map(relative(this.root, Object.keys(d.texts)).map((p) => [p, d.texts[this.root + p]])), media: new Set(relative(this.root, d.media)) };
  }
  async files(onProgress?: OnProgress) {
    const { texts, media } = await this.listing();
    let done = 0;
    const binaries = await pool([...media], 8, async (path) => {
      const blob: Blob | undefined = await get(`local:bin:${this.root}${path}`, store);
      onProgress?.(++done, media.size);
      return { path, bytes: new Uint8Array(blob ? await blob.arrayBuffer() : new ArrayBuffer(0)) };
    });
    return [...[...texts].map(([path, text]) => ({ path, text })), ...binaries.filter((b) => b.bytes.length)];
  }

  async write(files: PackageFile[], remove: string[], _message: string, onProgress?: OnProgress) {
    const d = await this.deck();
    const media = new Set(d.media);
    let done = 0;
    for (const f of files) {
      const full = this.root + f.path;
      if (f.text !== undefined) d.texts[full] = f.text;
      else { await set(`local:bin:${full}`, new Blob([f.bytes as BlobPart], { type: mimeOf(f.path) }), store); media.add(full); }
      onProgress?.(++done, files.length);
    }
    for (const p of remove) {
      const full = this.root + p;
      delete d.texts[full];
      if (media.delete(full)) await del(`local:bin:${full}`, store);
    }
    d.media = [...media];
    await this.save(d);
    const roots = await localRoots();
    if (!roots.includes(this.root)) await set(LOCAL_INDEX, [...roots, this.root], store);
  }

  async destroy() {
    const d = await this.deck();
    for (const p of d.media) await del(`local:bin:${p}`, store);
    await del(this.key(), store);
    await set(LOCAL_INDEX, (await localRoots()).filter((r) => r !== this.root), store);
  }
}

// ---------------------------------------------------------------- GitHub repository

interface Snapshot { commit: string; tree: string; shas: Record<string, string> }
/** Unsent local edits of the whole repository: changed files (full paths) and journal lines per deck folder. */
interface Pending { files: Record<string, string>; base: Record<string, string>; journals: Record<string, string[]>; journal?: string[] }

function emptyPending(): Pending { return { files: {}, base: {}, journals: {} }; }

export class GitHubBackend implements Backend {
  kind = 'github' as const;
  private mediaUrls = new Map<string, string>();
  private data: DeckData | null = null;
  constructor(private cfg: RepoConfig, public root = '') {}

  private key(name: string) { return `${this.cfg.owner}/${this.cfg.repo}@${this.cfg.branch}:${name}`; }
  async snapshot(): Promise<Snapshot | undefined> { return get(this.key('snapshot'), store); }
  private async pending(): Promise<Pending> {
    const p: Pending = (await get(this.key('pending'), store)) ?? emptyPending();
    // Pending edits saved before multi-deck support belong to the root deck.
    if (p.journal) { p.journals = { ...(p.journals ?? {}), '': [...(p.journals?.[''] ?? []), ...p.journal] }; delete p.journal; }
    p.journals ??= {};
    return p;
  }
  private async savePending(p: Pending) { await set(this.key('pending'), p, store); }
  private async cachedText(sha: string): Promise<string | undefined> { return get(`text:${sha}`, store); }

  async refresh(): Promise<Snapshot> {
    const head = await getHead(this.cfg);
    const current = await this.snapshot();
    if (current?.commit === head.commit) return current;
    return this.adopt(head.commit, head.tree);
  }

  /** Makes a known commit the local snapshot; used right after our own commits, since reading the branch back can lag behind. */
  private async adopt(commit: string, treeSha: string): Promise<Snapshot> {
    const entries = await getTree(this.cfg, treeSha);
    const texts = entries.filter((e) => isTextFile(e.path) || e.path.endsWith('.tsv'));
    const missing: string[] = [];
    for (const e of texts) if ((await this.cachedText(e.sha)) === undefined) missing.push(e.sha);
    const fetched = missing.length ? await getTextBlobs(this.cfg, [...new Set(missing)]).catch(() => new Map<string, string>()) : new Map<string, string>();
    await pool(missing, 8, async (sha) => set(`text:${sha}`, fetched.get(sha) ?? await getTextBlob(this.cfg, sha), store));
    const snap: Snapshot = { commit, tree: treeSha, shas: Object.fromEntries(entries.map((e) => [e.path, e.sha])) };
    await set(this.key('snapshot'), snap, store);
    return snap;
  }

  /** Refreshes when online, otherwise falls back to the cached snapshot. */
  async current(): Promise<Snapshot> {
    const started = performance.now();
    try {
      const snap = await this.refresh();
      log('deck', 'refreshed from GitHub', { commit: snap.commit.slice(0, 7), ms: Math.round(performance.now() - started) });
      return snap;
    } catch (error) {
      log('deck', 'offline, using cached deck', String((error as Error).message));
      const snap = await this.snapshot();
      if (!snap) throw error;
      return snap;
    }
  }

  private async textFiles(snap: Snapshot, pending: Pending): Promise<FileMap> {
    const files: FileMap = new Map();
    for (const [path, sha] of Object.entries(snap.shas)) {
      if (!isTextFile(path) && !path.endsWith('.tsv')) continue;
      const text = await this.cachedText(sha);
      if (text !== undefined) files.set(path, text);
    }
    for (const [path, text] of Object.entries(pending.files)) files.set(path, text);
    return files;
  }

  async allTexts(): Promise<FileMap> { return this.textFiles(await this.current(), await this.pending()); }

  async load(): Promise<DeckData> {
    const snap = await this.current();
    const media = Object.keys(snap.shas).filter((p) => !isTextFile(p) && !p.endsWith('.tsv'));
    this.data = buildDeck(await this.textFiles(snap, await this.pending()), CORE, this.root, media);
    return this.data;
  }

  private async currentText(path: string, pending: Pending, snap: Snapshot): Promise<string> {
    const text = pending.files[path] ?? (snap.shas[path] ? await this.cachedText(snap.shas[path]) : undefined);
    if (text === undefined) throw new Error(`Файл ${path} не загружен`);
    return text;
  }

  private async edit(path: string, change: (text: string) => string) {
    const [snap, pending] = [await this.snapshot(), await this.pending()];
    if (!snap) throw new Error('Колода ещё не загружена');
    const text = await this.currentText(path, pending, snap);
    if (!(path in pending.base)) pending.base[path] = snap.shas[path] ?? '';
    pending.files[path] = change(text);
    await this.savePending(pending);
  }

  async saveAnswer(_device: string, updates: { cardPath: string; progress: Progress }[], lines: string[]) {
    for (const u of updates) await this.edit(`${u.cardPath}/card.yaml`, (text) => withProgress(text, u.progress));
    const pending = await this.pending();
    pending.journals[this.root] = [...(pending.journals[this.root] ?? []), ...lines];
    await this.savePending(pending);
  }

  async patchExercise(body: { cardPath: string; exerciseId: string; file?: string; patch: ExercisePatch }) {
    if (body.file) await this.edit(`${body.cardPath}/${body.file}`, (text) => patchMdExercise(text, body.patch));
    else await this.edit(`${body.cardPath}/card.yaml`, (text) => patchCardExercise(text, body.exerciseId, body.patch));
  }

  async pendingCount() {
    const p = await this.pending();
    return Object.keys(p.files).length + (Object.values(p.journals).some((l) => l.length) ? 1 : 0);
  }

  private mergeFile(path: string, local: string, remote: string): string {
    if (!path.endsWith('/card.yaml')) return local;
    return withProgress(remote, mergeProgress(readProgress(local), readProgress(remote)));
  }

  private async journalFiles(device: string, journals: Record<string, string[]>, snap: Snapshot): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [root, lines] of Object.entries(journals)) {
      for (const line of lines) {
        const path = `${root}journal/${line.slice(0, 7)}/${device}.tsv`;
        if (out[path] === undefined) out[path] = snap.shas[path] ? (await this.cachedText(snap.shas[path])) ?? '' : '';
        out[path] += line + '\n';
      }
    }
    return out;
  }

  private async commitOnce(device: string): Promise<SyncResult | null> {
    const snap = await this.refresh();
    const pending = await this.pending();
    const files: Record<string, string> = {};
    for (const [path, local] of Object.entries(pending.files)) {
      const remoteChanged = (snap.shas[path] ?? '') !== (pending.base[path] ?? '');
      const remote = snap.shas[path] ? await this.cachedText(snap.shas[path]) : undefined;
      files[path] = remoteChanged && remote !== undefined ? this.mergeFile(path, local, remote) : local;
    }
    Object.assign(files, await this.journalFiles(device, pending.journals, snap));
    const answers = Object.values(pending.journals).reduce((n, l) => n + l.length, 0);
    const entries = await pool(Object.entries(files), 6, async ([path, text]) => ({ path, sha: await createBlob(this.cfg, text), text }));
    const tree = await createTree(this.cfg, snap.tree, entries);
    const cards = Object.keys(pending.files).filter((p) => p.endsWith('card.yaml')).length;
    const commit = await createCommit(this.cfg, `review: ${cards} cards · ${answers} answers · ${device}`, tree, snap.commit);
    if (!(await this.moveBranch(commit))) return null;
    for (const e of entries) await set(`text:${e.sha}`, e.text, store);
    const shas = { ...snap.shas, ...Object.fromEntries(entries.map((e) => [e.path, e.sha])) };
    await set(this.key('snapshot'), { commit, tree, shas }, store);
    await del(this.key('pending'), store);
    return { ok: true, log: `Отправлено: ${cards} карточек, ${answers} ответов.` };
  }

  /** False when someone else moved the branch first; the caller rebuilds the commit on the new head. */
  private async moveBranch(commit: string): Promise<boolean> {
    try { await updateRef(this.cfg, commit); return true; } catch (error) {
      if (error instanceof GitHubError && error.status === 422) return false;
      throw error;
    }
  }

  async sync(device: string): Promise<SyncResult> {
    if (!(await this.pendingCount())) {
      await this.refresh();
      return { ok: true, log: 'Изменений нет, колода обновлена.' };
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await this.commitOnce(device);
      if (result) return result;
    }
    return { ok: false, log: 'Не удалось отправить: ветка постоянно меняется. Попробуйте ещё раз.' };
  }

  private async journalTexts(): Promise<string[]> {
    const snap = await this.snapshot();
    const lines: string[] = [];
    for (const [path, sha] of Object.entries(snap?.shas ?? {})) if (path.startsWith(`${this.root}journal/`)) lines.push(...((await this.cachedText(sha)) ?? '').split('\n').filter(Boolean));
    lines.push(...((await this.pending()).journals[this.root] ?? []));
    return lines;
  }

  async journal(): Promise<string[]> { return (await this.journalTexts()).sort(); }
  async activity(): Promise<Record<string, number>> { return countActivity(await this.journalTexts()); }
  async saveParams(params: number[] | null) { await this.edit(`${this.root}deck.yaml`, (text) => withDeckParams(text, params)); }

  private async mediaBlob(path: string, sha: string): Promise<Blob> {
    let blob: Blob | undefined = await get(`media:${sha}`, store);
    if (!blob) {
      const bytes = await getBlob(this.cfg, sha);
      blob = new Blob([bytes as BlobPart], { type: mimeOf(path) });
      await set(`media:${sha}`, blob, store);
    }
    return blob;
  }

  async media(url: string): Promise<string> {
    const path = mediaPathOf(url);
    if (!path) return url;
    const cached = this.mediaUrls.get(path);
    if (cached) return cached;
    const started = performance.now();
    const sha = (await this.snapshot())?.shas[path];
    if (!sha) {
      const remote = sourceMedia(this.data, this.root, path);
      if (remote) return remote;
      throw new Error(`Нет файла ${path}`);
    }
    const fromCache = Boolean(await get(`media:${sha}`, store));
    const blob = await this.mediaBlob(path, sha);
    const objectUrl = URL.createObjectURL(blob);
    this.mediaUrls.set(path, objectUrl);
    log('media', fromCache ? 'from device cache' : 'downloaded', { path: path.replace(/^(decks\/[^/]+\/)?topics\//, ''), bytes: blob.size, ms: Math.round(performance.now() - started) });
    return objectUrl;
  }

  mediaNow(url: string): string | null {
    const path = mediaPathOf(url);
    return path ? this.mediaUrls.get(path) ?? null : url;
  }

  async mediaExists(url: string): Promise<boolean> {
    const path = mediaPathOf(url);
    return Boolean(path && ((await this.snapshot())?.shas[path] || sourceMedia(this.data, this.root, path)));
  }

  async listing() {
    const snap = await this.current();
    const texts = await this.textFiles(snap, await this.pending());
    const mine = relative(this.root, Object.keys(snap.shas));
    return {
      texts: new Map(relative(this.root, texts.keys()).filter((p) => isTextFile(p)).map((p) => [p, texts.get(this.root + p)!])),
      media: new Set(mine.filter((p) => !isTextFile(p) && !p.endsWith('.tsv'))),
    };
  }

  async files(onProgress?: OnProgress): Promise<PackageFile[]> {
    const snap = await this.current();
    const { texts, media } = await this.listing();
    let done = 0;
    const binaries = await pool([...media], 6, async (path) => {
      const blob = await this.mediaBlob(path, snap.shas[this.root + path]);
      onProgress?.(++done, media.size);
      return { path, bytes: new Uint8Array(await blob.arrayBuffer()) };
    });
    return [...[...texts].map(([path, text]) => ({ path, text })), ...binaries];
  }

  /** One commit for the whole import: text goes inline in the tree, media as blobs (each is one API call, so they are paced). */
  async write(files: PackageFile[], remove: string[], message: string, onProgress?: OnProgress) {
    const binaries = files.filter((f) => f.bytes);
    let done = 0;
    const blobShas = await pool(binaries, 3, async (f) => {
      const sha = await createBinaryBlob(this.cfg, f.bytes!);
      onProgress?.(++done, binaries.length);
      return sha;
    });
    const changes: TreeChange[] = [
      ...files.filter((f) => f.text !== undefined).map((f) => ({ path: this.root + f.path, content: f.text })),
      ...binaries.map((f, i) => ({ path: this.root + f.path, sha: blobShas[i] })),
    ];
    for (let attempt = 0; attempt < 4; attempt++) {
      const snap = await this.refresh();
      const deletions = remove.map((p) => this.root + p).filter((p) => snap.shas[p]).map((path) => ({ path, sha: null }));
      const tree = await createTree(this.cfg, snap.tree, [...changes, ...deletions]);
      const commit = await createCommit(this.cfg, message, tree, snap.commit);
      if (await this.moveBranch(commit)) { await this.adopt(commit, tree); return; }
    }
    throw new Error('Не удалось записать колоду: ветка постоянно меняется.');
  }

  async destroy() {
    const snap = await this.refresh();
    const mine = Object.keys(snap.shas).filter((p) => p.startsWith(this.root));
    if (!this.root || !mine.length) throw new Error('Колоду в корне репозитория удалить нельзя');
    await this.write([], mine.map((p) => p.slice(this.root.length)), `remove deck ${this.root}`);
  }

  async prefetchMedia(paths: string[]) {
    await pool(paths, 4, (p) => this.media(`${MEDIA_PREFIX}${p}`).catch(() => ''));
  }

  async roots(): Promise<string[]> { return deckRoots(Object.keys((await this.current()).shas)); }
}

export async function testConnection(cfg: RepoConfig): Promise<void> {
  try { await getHead(cfg); } catch (error) {
    if (error instanceof GitHubError && error.status === 409) throw new Error('Репозиторий пустой: создайте в нём хотя бы README, потом подключите снова');
    throw error;
  }
}
