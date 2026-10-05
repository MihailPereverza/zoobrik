import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import YAML from 'yaml';
import { readProgress, withProgress } from './cardyaml';
import { CORE } from './core';
import { buildDeck, isTextFile, type FileMap } from './deckfs';
import { getBlob, getRepoInfo, getTextBlobs, getTree, pool, type RepoConfig } from './github';
import { deckLangs } from './lang';
import type { DeckConfig } from './types';

/** One file of a deck, with a path relative to the deck folder. */
export interface PackageFile { path: string; text?: string; bytes?: Uint8Array }

export const PACKAGE_FORMAT = 1;
export const PACKAGE_EXT = '.zoobrik';
const MEDIA = /\.(mp3|ogg|opus|wav|m4a|webp|png|jpe?g|gif|svg)$/i;
const SKIPPED = /^(journal\/|\.git\/|\.github\/|zoobrik\.json$)|(^|\/)\.DS_Store$/;

export const isMediaFile = (path: string) => MEDIA.test(path);

/** Only deck content travels: no hidden folders, no journals, no path tricks, no unknown file types. */
export function isPackagePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.split('/').some((part) => part === '..' || part === '')) return false;
  if (SKIPPED.test(path)) return false;
  return isTextFile(path) || isMediaFile(path);
}

export function stripCard(text: string): string {
  const doc = YAML.parseDocument(text);
  doc.delete('progress');
  return doc.toString({ lineWidth: 0 });
}

/** Personal state never leaves the device: optimised FSRS weights and where the deck itself was imported from. */
export function stripDeckYaml(text: string): string {
  const doc = YAML.parseDocument(text);
  doc.deleteIn(['fsrs', 'params']);
  doc.delete('source');
  return doc.toString({ lineWidth: 0 });
}

function shareable(file: PackageFile): PackageFile {
  if (file.text === undefined) return file;
  if (file.path.endsWith('card.yaml')) return { ...file, text: stripCard(file.text) };
  if (file.path === 'deck.yaml') return { ...file, text: stripDeckYaml(file.text) };
  return file;
}

export interface PackageMeta { format: number; id: string; name: string; version?: string; lang?: DeckConfig['lang']; exported: string; cards: number }

export function packDeck(files: PackageFile[], now = new Date()): Uint8Array {
  const kept = files.filter((f) => isPackagePath(f.path)).map(shareable);
  const deckFile = kept.find((f) => f.path === 'deck.yaml');
  if (!deckFile?.text) throw new Error('В колоде нет deck.yaml');
  const deck = YAML.parse(deckFile.text) as DeckConfig;
  const meta: PackageMeta = {
    format: PACKAGE_FORMAT, id: deck.id ?? slug(deck.name), name: deck.name, version: deck.version, lang: deck.lang,
    exported: now.toISOString(), cards: kept.filter((f) => f.path.endsWith('/card.yaml')).length,
  };
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { 'zoobrik.json': strToU8(JSON.stringify(meta, null, 2)) };
  // Audio and images are already compressed; deflating them again only costs time.
  for (const f of kept) entries[f.path] = f.text !== undefined ? strToU8(f.text) : [f.bytes!, { level: 0 }];
  return zipSync(entries as any, { level: 6 });
}

/** A zip of a deck: either the deck at the top level or inside one folder (as GitHub "Download ZIP" makes it). */
export function unpackDeck(bytes: Uint8Array): PackageFile[] {
  const raw = unzipSync(bytes);
  const paths = Object.keys(raw).filter((p) => !p.endsWith('/'));
  const deckYaml = paths.filter((p) => /(^|\/)deck\.yaml$/.test(p)).sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!deckYaml) throw new Error('Это не колода Zoobrik: в архиве нет deck.yaml');
  const root = deckYaml.slice(0, -'deck.yaml'.length);
  return paths
    .filter((p) => p.startsWith(root))
    .map((p) => ({ path: p.slice(root.length), data: raw[p] }))
    .filter((f) => isPackagePath(f.path))
    .map((f) => (isTextFile(f.path) ? { path: f.path, text: strFromU8(f.data) } : { path: f.path, bytes: f.data }));
}

export function slug(text: string | undefined): string {
  const base = (text ?? '').toLowerCase()
    .replace(/[а-яё]/g, (c) => TRANSLIT[c] ?? '')
    .normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base.slice(0, 40) || 'deck';
}

const TRANSLIT: Record<string, string> = Object.fromEntries(
  'а:a б:b в:v г:g д:d е:e ё:e ж:zh з:z и:i й:y к:k л:l м:m н:n о:o п:p р:r с:s т:t у:u ф:f х:h ц:ts ч:ch ш:sh щ:sch ъ: ы:y ь: э:e ю:yu я:ya'
    .split(' ').map((pair) => pair.split(':') as [string, string]),
);

export interface DeckPreview {
  id: string;
  name: string;
  description: string;
  lang: string;
  topics: number;
  cards: number;
  exercises: number;
  media: number;
  bytes: number;
  scripts: number;
}

export function previewDeck(files: PackageFile[]): DeckPreview {
  const map: FileMap = new Map(files.filter((f) => f.text !== undefined).map((f) => [f.path, f.text!]));
  const data = buildDeck(map, CORE);
  const langs = deckLangs(data.deck);
  const cards = data.topics.flatMap((t) => t.cards);
  return {
    id: data.deck.id ?? slug(data.deck.name),
    name: data.deck.name ?? 'Без названия',
    description: data.deck.description ?? '',
    lang: `${langs.target.short} → ${langs.native.short}`,
    topics: data.topics.length,
    cards: cards.length,
    exercises: cards.reduce((n, c) => n + c.exercises.length, 0),
    media: files.filter((f) => f.bytes).length,
    bytes: files.reduce((n, f) => n + (f.bytes?.length ?? f.text?.length ?? 0), 0),
    scripts: files.filter((f) => f.path.endsWith('/logic.js')).length,
  };
}

export interface LinkSource { kind: 'github'; owner: string; repo: string; branch?: string; path: string }

/** `owner/repo`, `github:owner/repo/path@branch` or a github.com URL, optionally with /tree/<branch>/<path>. */
export function parseLink(link: string): LinkSource | { kind: 'url'; url: string } | null {
  const text = link.trim();
  if (!text) return null;
  const short = /^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?((?:\/[^@\s]+)*)(?:@([\w./-]+))?$/.exec(text);
  if (short && !text.includes('://')) return { kind: 'github', owner: short[1], repo: short[2], path: trimSlashes(short[3] ?? ''), branch: short[4] };
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if (url.hostname === 'github.com') {
    const [owner, repo, kind, branch, ...rest] = url.pathname.split('/').filter(Boolean);
    if (!owner || !repo) return null;
    return { kind: 'github', owner, repo: repo.replace(/\.git$/, ''), branch: kind === 'tree' ? branch : undefined, path: kind === 'tree' ? rest.join('/') : '' };
  }
  return { kind: 'url', url: url.toString() };
}

const trimSlashes = (s: string) => s.replace(/^\/+|\/+$/g, '');

export function linkText(src: LinkSource): string {
  return `github:${src.owner}/${src.repo}${src.path ? `/${src.path}` : ''}${src.branch ? `@${src.branch}` : ''}`;
}

export interface Fetched { files: PackageFile[]; source: { url: string; media?: string } }
export type Progress = (done: number, total: number) => void;

/** Reads a deck straight from GitHub; anonymous access goes through raw.githubusercontent.com, which has no API rate limit. */
export async function fetchGitHub(src: LinkSource, token: string | undefined, opts: { media: boolean; onProgress?: Progress }): Promise<Fetched> {
  const cfg: RepoConfig = { owner: src.owner, repo: src.repo, branch: src.branch ?? '', token: token ?? '' };
  if (!cfg.branch) cfg.branch = (await getRepoInfo(cfg)).defaultBranch;
  const prefix = src.path ? `${src.path}/` : '';
  const all = await getTree(cfg, cfg.branch);
  const entries = all.filter((e) => e.path.startsWith(prefix) && isPackagePath(e.path.slice(prefix.length)) && (e.path === `${prefix}deck.yaml` || !e.path.slice(prefix.length).startsWith('decks/')));
  const wanted = entries.filter((e) => opts.media || isTextFile(e.path));
  if (!entries.some((e) => e.path === `${prefix}deck.yaml`)) {
    const inside = entries.map((e) => /^(.*decks\/[^/]+)\/deck\.yaml$/.exec(e.path)?.[1]).filter(Boolean);
    throw new Error(inside.length ? `Здесь несколько колод, укажите одну: ${inside.map((p) => linkText({ ...src, path: p! })).join(', ')}` : `В ${linkText(src)} нет deck.yaml`);
  }
  const raw = (path: string) => `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${encodeURIComponent(cfg.branch)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const texts = token ? await getTextBlobs(cfg, wanted.filter((e) => isTextFile(e.path)).map((e) => e.sha)).catch(() => new Map<string, string>()) : new Map<string, string>();
  let done = 0;
  const files = await pool(wanted, 8, async (e) => {
    const path = e.path.slice(prefix.length);
    const file = isTextFile(path)
      ? { path, text: texts.get(e.sha) ?? (token ? new TextDecoder().decode(await getBlob(cfg, e.sha)) : await fetchText(raw(e.path))) }
      : { path, bytes: token ? await getBlob(cfg, e.sha) : await fetchBytes(raw(e.path)) };
    opts.onProgress?.(++done, wanted.length);
    return file;
  });
  return { files, source: { url: linkText({ ...src, branch: src.branch }), media: opts.media ? undefined : raw(prefix).replace(/\/$/, '') } };
}

async function fetchText(url: string): Promise<string> {
  return new TextDecoder().decode(await fetchBytes(url));
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function fetchPackageUrl(url: string): Promise<Fetched> {
  return { files: unpackDeck(await fetchBytes(url)), source: { url } };
}

export interface UpdatePlan { write: PackageFile[]; remove: string[]; kept: number; changed: number; added: number }

/**
 * Applies a new version of a deck on top of the local copy: content comes from the author, the learner's progress stays.
 * Cards the author removed keep their card.yaml while they have progress, so the history is not lost.
 */
export function planUpdate(local: Map<string, string>, mediaPaths: Set<string>, incoming: PackageFile[]): UpdatePlan {
  const write: PackageFile[] = [];
  let changed = 0, added = 0;
  const incomingPaths = new Set(incoming.map((f) => f.path));
  for (const f of incoming) {
    if (f.bytes) { if (!mediaPaths.has(f.path)) { write.push(f); added++; } continue; }
    const mine = local.get(f.path);
    let text = f.text!;
    if (f.path.endsWith('card.yaml') && mine) {
      const progress = readProgress(mine);
      text = progress ? withProgress(stripCard(text), progress) : stripCard(text);
    }
    if (f.path === 'deck.yaml' && mine) text = keepPersonalDeckFields(mine, text);
    if (mine === text) continue;
    write.push({ path: f.path, text });
    if (mine === undefined) added++; else changed++;
  }
  const remove: string[] = [];
  let kept = 0;
  for (const path of local.keys()) {
    if (incomingPaths.has(path) || !isPackagePath(path)) continue;
    if (path.endsWith('card.yaml') && readProgress(local.get(path)!)) { kept++; continue; }
    remove.push(path);
  }
  return { write, remove, kept, changed, added };
}

function keepPersonalDeckFields(mine: string, theirs: string): string {
  const local = YAML.parse(mine) ?? {};
  const doc = YAML.parseDocument(stripDeckYaml(theirs));
  if (local.fsrs?.params) doc.setIn(['fsrs', 'params'], doc.createNode(local.fsrs.params, { flow: true }));
  if (local.source) doc.set('source', local.source);
  return doc.toString({ lineWidth: 0 });
}

export function withSource(deckYaml: string, source: { url: string; media?: string; version?: string }, now = new Date()): string {
  const doc = YAML.parseDocument(deckYaml);
  doc.set('source', doc.createNode({ ...source, imported: now.toISOString().slice(0, 10) }));
  return doc.toString({ lineWidth: 0 });
}

export function withDeckId(deckYaml: string, id: string): string {
  const doc = YAML.parseDocument(deckYaml);
  doc.set('id', id);
  return doc.toString({ lineWidth: 0 });
}
