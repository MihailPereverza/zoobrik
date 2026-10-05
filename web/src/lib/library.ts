import YAML from 'yaml';
import type { StoreKind } from './backend';
import {
  fetchGitHub, fetchPackageUrl, PACKAGE_EXT, packDeck, parseLink, planUpdate, slug, stripCard, stripDeckYaml, unpackDeck, withDeckId, withSource,
  type Fetched, type PackageFile, type Progress, type UpdatePlan,
} from './package';
import { app, openDeck, reload, setActiveDeck, type DeckRef } from './state.svelte';
import { log } from './log';

/** Where new decks go: the connected GitHub library, the Mac in dev mode, or this device. */
export function defaultStore(): StoreKind {
  if (app.mode === 'server') return 'server';
  return app.repo ? 'github' : 'local';
}

export function availableStores(): StoreKind[] {
  return app.mode === 'server' ? ['server', 'local'] : app.repo ? ['github', 'local'] : ['local'];
}

export const STORE_NAME: Record<StoreKind, string> = { github: 'GitHub', local: 'Это устройство', server: 'Файлы на Mac' };

export async function fetchLink(link: string, opts: { media: boolean; onProgress?: Progress }): Promise<Fetched> {
  const src = parseLink(link);
  if (!src) throw new Error('Не понимаю ссылку. Подойдёт owner/repo, адрес на github.com или прямая ссылка на файл .zoobrik.');
  if (src.kind === 'url') return fetchPackageUrl(src.url);
  // The user's own token opens private repositories they share with friends; public ones work without it.
  const token = app.repo && app.repo.owner.toLowerCase() === src.owner.toLowerCase() ? app.repo.token : undefined;
  return fetchGitHub(src, token, opts);
}

export async function readPackageFile(file: File): Promise<PackageFile[]> {
  return unpackDeck(new Uint8Array(await file.arrayBuffer()));
}

function uniqueId(base: string, store: StoreKind): string {
  const taken = new Set(app.decks.filter((d) => d.store === store).map((d) => d.root));
  let id = base;
  for (let n = 2; taken.has(`decks/${id}/`); n++) id = `${base}-${n}`;
  return id;
}

export async function addDeck(files: PackageFile[], source: Fetched['source'] | null, store: StoreKind, onProgress?: Progress): Promise<DeckRef> {
  const deckFile = files.find((f) => f.path === 'deck.yaml');
  if (!deckFile?.text) throw new Error('В колоде нет deck.yaml');
  const deck = YAML.parse(deckFile.text) ?? {};
  const id = uniqueId(slug(deck.id ?? deck.name), store);
  let deckYaml = withDeckId(stripDeckYaml(deckFile.text), id);
  if (source) deckYaml = withSource(deckYaml, { ...source, version: deck.version });
  const root = `decks/${id}/`;
  // Someone else's progress never comes along: a deck starts fresh even if the archive was made by hand from a studied copy.
  const prepared = files.map((f) => (f.path === 'deck.yaml' ? { path: f.path, text: deckYaml } : f.text !== undefined && f.path.endsWith('card.yaml') ? { path: f.path, text: stripCard(f.text) } : f));
  await openDeck({ store, root }).write(prepared, [], `add deck ${id}${source ? ` from ${source.url}` : ''}`, onProgress);
  log('library', 'deck added', { id, store, files: files.length, source: source?.url });
  setActiveDeck(`${store}:${root}`);
  await reload();
  return app.decks.find((d) => d.root === root && d.store === store)!;
}

export interface UpdateCheck { plan: UpdatePlan; files: PackageFile[] }

export async function checkUpdate(ref: DeckRef, files?: PackageFile[], onProgress?: Progress): Promise<UpdateCheck> {
  const backend = openDeck(ref);
  const listing = await backend.listing();
  const deck = YAML.parse(listing.texts.get('deck.yaml') ?? '') ?? {};
  let incoming = files;
  if (!incoming) {
    if (!deck.source?.url) throw new Error('У колоды нет источника — обновить можно только из файла.');
    incoming = (await fetchLink(deck.source.url, { media: !deck.source.media, onProgress })).files;
  }
  const keepId = incoming.map((f) => (f.path === 'deck.yaml' && f.text ? { ...f, text: withDeckId(f.text, deck.id ?? ref.root.slice(6, -1)) } : f));
  return { plan: planUpdate(listing.texts, listing.media, keepId), files: keepId };
}

export async function applyUpdate(ref: DeckRef, plan: UpdatePlan, onProgress?: Progress) {
  await openDeck(ref).write(plan.write, plan.remove, `update deck ${ref.root || 'root'}`, onProgress);
  await reload();
}

export async function exportDeck(ref: DeckRef, onProgress?: Progress): Promise<File> {
  const files = await openDeck(ref).files(onProgress);
  const bytes = packDeck(files);
  return new File([bytes as BlobPart], `${slug(ref.name)}${PACKAGE_EXT}`, { type: 'application/zip' });
}

export async function removeDeck(ref: DeckRef) {
  await openDeck(ref).destroy();
  await reload();
}

/** A link that opens the import screen with the deck filled in; it only works for decks others can read. */
export function shareLink(source: string): string {
  return `${location.origin}${import.meta.env.BASE_URL}#/add?src=${encodeURIComponent(source)}`;
}
