import { createStore, del, get, set } from 'idb-keyval';
import * as api from './api';
import { patchCardExercise, patchMdExercise, readProgress, withProgress, type ExercisePatch } from './cardyaml';
import { CORE } from './core';
import { buildDeck, isTextFile, type FileMap } from './deckfs';
import { createBlob, createCommit, createTree, getBlob, getHead, getTextBlob, getTextBlobs, getTree, GitHubError, pool, updateRef, type RepoConfig } from './github';
import { mergeProgress } from './progress';
import { log } from './log';
import type { DeckData, Progress } from './types';

export interface SyncResult { ok: boolean; log: string }

export interface Backend {
  kind: 'server' | 'github';
  load(): Promise<DeckData>;
  saveAnswer(device: string, updates: { cardPath: string; progress: Progress }[], lines: string[]): Promise<void>;
  patchExercise(body: { cardPath: string; exerciseId: string; file?: string; patch: ExercisePatch }): Promise<void>;
  sync(device: string): Promise<SyncResult>;
  activity(): Promise<Record<string, number>>;
  media(url: string): Promise<string>;
  mediaNow(url: string): string | null;
  mediaExists(url: string): Promise<boolean>;
  pendingCount(): Promise<number>;
}

export const serverBackend: Backend = {
  kind: 'server',
  load: api.loadDeck,
  saveAnswer: async (device, updates, lines) => { await api.saveAnswer(device, updates, lines); },
  patchExercise: async (body) => { await api.patchExercise(body); },
  sync: api.syncDeck,
  activity: api.loadActivity,
  media: async (url) => url,
  mediaNow: (url) => url,
  mediaExists: async (url) => (await fetch(url, { method: 'HEAD' })).ok,
  pendingCount: async () => 0,
};

interface Snapshot { commit: string; tree: string; shas: Record<string, string> }
interface Pending { files: Record<string, string>; base: Record<string, string>; journal: string[] }

const store = createStore('zoobrik', 'kv');
const MEDIA_PREFIX = '/deck/';

function emptyPending(): Pending { return { files: {}, base: {}, journal: [] }; }

export class GitHubBackend implements Backend {
  kind = 'github' as const;
  private mediaUrls = new Map<string, string>();
  constructor(private cfg: RepoConfig) {}

  private key(name: string) { return `${this.cfg.owner}/${this.cfg.repo}@${this.cfg.branch}:${name}`; }
  private async snapshot(): Promise<Snapshot | undefined> { return get(this.key('snapshot'), store); }
  private async pending(): Promise<Pending> { return (await get(this.key('pending'), store)) ?? emptyPending(); }
  private async savePending(p: Pending) { await set(this.key('pending'), p, store); }
  private async cachedText(sha: string): Promise<string | undefined> { return get(`text:${sha}`, store); }

  private async refresh(): Promise<Snapshot> {
    const head = await getHead(this.cfg);
    const current = await this.snapshot();
    if (current?.commit === head.commit) return current;
    const entries = await getTree(this.cfg, head.tree);
    const texts = entries.filter((e) => isTextFile(e.path) || e.path.endsWith('.tsv'));
    const missing: string[] = [];
    for (const e of texts) if ((await this.cachedText(e.sha)) === undefined) missing.push(e.sha);
    const fetched = missing.length ? await getTextBlobs(this.cfg, [...new Set(missing)]).catch(() => new Map<string, string>()) : new Map<string, string>();
    await pool(missing, 8, async (sha) => set(`text:${sha}`, fetched.get(sha) ?? await getTextBlob(this.cfg, sha), store));
    const snap: Snapshot = { commit: head.commit, tree: head.tree, shas: Object.fromEntries(entries.map((e) => [e.path, e.sha])) };
    await set(this.key('snapshot'), snap, store);
    return snap;
  }

  private async files(snap: Snapshot, pending: Pending): Promise<FileMap> {
    const files: FileMap = new Map();
    for (const [path, sha] of Object.entries(snap.shas)) {
      if (!isTextFile(path) && !path.endsWith('.tsv')) continue;
      const text = await this.cachedText(sha);
      if (text !== undefined) files.set(path, text);
    }
    for (const [path, text] of Object.entries(pending.files)) files.set(path, text);
    return files;
  }

  async load(): Promise<DeckData> {
    let snap: Snapshot | undefined;
    const started = performance.now();
    try { snap = await this.refresh(); log('deck', 'refreshed from GitHub', { commit: snap.commit.slice(0, 7), ms: Math.round(performance.now() - started) }); } catch (error) {
      log('deck', 'offline, using cached deck', String((error as Error).message));
      snap = await this.snapshot();
      if (!snap) throw error;
    }
    return buildDeck(await this.files(snap, await this.pending()), CORE);
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
    pending.journal.push(...lines);
    await this.savePending(pending);
  }

  async patchExercise(body: { cardPath: string; exerciseId: string; file?: string; patch: ExercisePatch }) {
    if (body.file) await this.edit(`${body.cardPath}/${body.file}`, (text) => patchMdExercise(text, body.patch));
    else await this.edit(`${body.cardPath}/card.yaml`, (text) => patchCardExercise(text, body.exerciseId, body.patch));
  }

  async pendingCount() {
    const p = await this.pending();
    return Object.keys(p.files).length + (p.journal.length ? 1 : 0);
  }

  private mergeFile(path: string, local: string, remote: string): string {
    if (!path.endsWith('/card.yaml')) return local;
    return withProgress(remote, mergeProgress(readProgress(local), readProgress(remote)));
  }

  private async journalFiles(device: string, lines: string[], snap: Snapshot): Promise<Record<string, string>> {
    const byMonth = new Map<string, string[]>();
    for (const line of lines) byMonth.set(line.slice(0, 7), [...(byMonth.get(line.slice(0, 7)) ?? []), line]);
    const out: Record<string, string> = {};
    for (const [month, monthLines] of byMonth) {
      const path = `journal/${month}/${device}.tsv`;
      const existing = snap.shas[path] ? (await this.cachedText(snap.shas[path])) ?? '' : '';
      out[path] = existing + monthLines.join('\n') + '\n';
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
    Object.assign(files, await this.journalFiles(device, pending.journal, snap));
    const entries = await pool(Object.entries(files), 6, async ([path, text]) => ({ path, sha: await createBlob(this.cfg, text), text }));
    const tree = await createTree(this.cfg, snap.tree, entries);
    const cards = Object.keys(pending.files).filter((p) => p.endsWith('card.yaml')).length;
    const commit = await createCommit(this.cfg, `review: ${cards} cards · ${pending.journal.length} answers · ${device}`, tree, snap.commit);
    try { await updateRef(this.cfg, commit); } catch (error) {
      if (error instanceof GitHubError && error.status === 422) return null;
      throw error;
    }
    for (const e of entries) await set(`text:${e.sha}`, e.text, store);
    const shas = { ...snap.shas, ...Object.fromEntries(entries.map((e) => [e.path, e.sha])) };
    await set(this.key('snapshot'), { commit, tree, shas }, store);
    await del(this.key('pending'), store);
    return { ok: true, log: `Отправлено: ${cards} карточек, ${pending.journal.length} ответов.` };
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

  async activity(): Promise<Record<string, number>> {
    const snap = await this.snapshot();
    const days: Record<string, number> = {};
    const count = (text: string) => text.split('\n').forEach((l) => { const d = l.slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) days[d] = (days[d] ?? 0) + 1; });
    for (const [path, sha] of Object.entries(snap?.shas ?? {})) if (path.startsWith('journal/')) count((await this.cachedText(sha)) ?? '');
    count((await this.pending()).journal.join('\n'));
    return days;
  }

  async media(url: string): Promise<string> {
    const at = url.indexOf(MEDIA_PREFIX);
    if (at < 0) return url;
    const path = decodeURIComponent(url.slice(at + MEDIA_PREFIX.length));
    const cached = this.mediaUrls.get(path);
    if (cached) return cached;
    const started = performance.now();
    const sha = (await this.snapshot())?.shas[path];
    if (!sha) throw new Error(`Нет файла ${path}`);
    let blob: Blob | undefined = await get(`media:${sha}`, store);
    const fromCache = Boolean(blob);
    if (!blob) {
      const bytes = await getBlob(this.cfg, sha);
      blob = new Blob([bytes as BlobPart], { type: path.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream' });
      await set(`media:${sha}`, blob, store);
    }
    const objectUrl = URL.createObjectURL(blob);
    this.mediaUrls.set(path, objectUrl);
    log('media', fromCache ? 'from device cache' : 'downloaded', { path: path.replace(/^topics\//, ''), bytes: blob.size, ms: Math.round(performance.now() - started) });
    return objectUrl;
  }

  mediaNow(url: string): string | null {
    const at = url.indexOf(MEDIA_PREFIX);
    if (at < 0) return url;
    return this.mediaUrls.get(decodeURIComponent(url.slice(at + MEDIA_PREFIX.length))) ?? null;
  }

  async mediaExists(url: string): Promise<boolean> {
    const at = url.indexOf(MEDIA_PREFIX);
    return at >= 0 && Boolean((await this.snapshot())?.shas[decodeURIComponent(url.slice(at + MEDIA_PREFIX.length))]);
  }

  async prefetchMedia(paths: string[]) {
    await pool(paths, 4, (p) => this.media(`${MEDIA_PREFIX}${p}`).catch(() => ''));
  }
}

export async function testConnection(cfg: RepoConfig): Promise<void> {
  const head = await getHead(cfg);
  const entries = await getTree(cfg, head.tree);
  if (!entries.some((e) => e.path === 'deck.yaml')) throw new Error('В корне репозитория нет deck.yaml');
}
