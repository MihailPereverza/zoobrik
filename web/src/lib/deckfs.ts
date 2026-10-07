import YAML from 'yaml';
import { splitFrontmatter } from './cardyaml';
import { deckLangs, normalizeContent, type DeckLangs } from './lang';
import type { Card, DeckData, Exercise, TemplateSource, Topic } from './types';

export type FileMap = Map<string, string>;

export interface CoreBundle {
  templates: TemplateSource[];
  partials: Record<string, string>;
  baseCss: string;
}

const parse = (text: string | undefined) => (text ? YAML.parse(text) : null);

function templatesUnder(files: FileMap, prefix: string, scope: string): TemplateSource[] {
  const ids = new Set<string>();
  for (const path of files.keys()) {
    const m = path.startsWith(prefix) ? /^([^/]+)\/view\.njk$/.exec(path.slice(prefix.length)) : null;
    if (m) ids.add(m[1]);
  }
  return [...ids].sort().map((id) => ({
    id, scope,
    manifest: parse(files.get(`${prefix}${id}/manifest.yaml`)) ?? { id },
    view: files.get(`${prefix}${id}/view.njk`) ?? '',
    style: files.get(`${prefix}${id}/style.css`) ?? '',
    logic: files.get(`${prefix}${id}/logic.js`) ?? null,
  }));
}

function mdExercises(files: FileMap, cardDir: string): Exercise[] {
  const prefix = `${cardDir}/exercises/`;
  return [...files.keys()]
    .filter((p) => p.startsWith(prefix) && p.endsWith('.md') && !p.slice(prefix.length).includes('/'))
    .sort()
    .map((p) => {
      const { meta, body } = splitFrontmatter(files.get(p)!);
      const file = p.slice(cardDir.length + 1);
      return { id: meta.id ?? file.replace(/^exercises\/|\.md$/g, ''), template: 'md', skill: meta.skill, status: meta.status ?? 'draft', difficulty: meta.difficulty, file, params: { markdown: body } };
    });
}

function buildCard(files: FileMap, root: string, langs: DeckLangs, topicId: string, cardId: string): Card {
  const dir = `${root}topics/${topicId}/${cardId}`;
  const raw = parse(files.get(`${dir}/card.yaml`)) ?? {};
  const theoryFile = raw.content?.theory;
  const transcript = raw.content?.transcript ? parse(files.get(`${dir}/${raw.content.transcript}`)) : null;
  return {
    ...raw,
    id: raw.id ?? cardId,
    topic: topicId,
    path: dir,
    content: normalizeContent(raw.content ?? {}, langs),
    listening: transcript ? { media: raw.content.media, poster: raw.content.poster, duration: transcript.duration, segments: transcript.segments ?? [], source: raw.content.source } : undefined,
    theory: theoryFile ? files.get(`${dir}/${theoryFile}`) ?? null : null,
    exercises: [...(raw.exercises ?? []), ...mdExercises(files, dir)],
    templates: templatesUnder(files, `${dir}/views/`, `card:${topicId}/${cardId}`),
  };
}

function buildTopic(files: FileMap, root: string, langs: DeckLangs, topicId: string): Topic {
  const dir = `${root}topics/${topicId}`;
  const raw = parse(files.get(`${dir}/topic.yaml`)) ?? {};
  const cardIds = [...files.keys()]
    .map((p) => (p.startsWith(`${dir}/`) ? /^([^/]+)\/card\.yaml$/.exec(p.slice(dir.length + 1))?.[1] : undefined))
    .filter((id): id is string => Boolean(id))
    .sort();
  return {
    ...raw,
    id: raw.id ?? topicId,
    title: raw.title ?? topicId,
    cards: cardIds.map((id) => buildCard(files, root, langs, topicId, id)),
    exercises: parse(files.get(`${dir}/exercises.yaml`)) ?? [],
    templates: templatesUnder(files, `${dir}/views/`, `topic:${topicId}`),
  };
}

export function buildDeck(files: FileMap, core: CoreBundle, root = '', media: Iterable<string> = []): DeckData {
  const deck = parse(files.get(`${root}deck.yaml`));
  if (!deck) throw new Error(`Нет ${root}deck.yaml`);
  const langs = deckLangs(deck);
  const found = [...files.keys()]
    .map((p) => (p.startsWith(root) ? /^topics\/([^/]+)\/topic\.yaml$/.exec(p.slice(root.length))?.[1] : undefined))
    .filter((id): id is string => Boolean(id)).sort();
  const order: string[] = deck.topics ?? [];
  const ids = [...order.filter((t) => found.includes(t)), ...found.filter((t) => !order.includes(t))];
  return {
    root,
    media: [...media].filter((p) => p.startsWith(root)),
    glossary: parse(files.get(`${root}glossary.yaml`)) ?? {},
    deck,
    topics: ids.map((id) => buildTopic(files, root, langs, id)),
    templates: [...core.templates, ...templatesUnder(files, `${root}templates/`, 'deck')],
    partials: core.partials,
    baseCss: core.baseCss,
  };
}

/** Deck folders in a library: the repository root (legacy single-deck layout) and every decks/<id>/. */
export function deckRoots(paths: Iterable<string>): string[] {
  const roots: string[] = [];
  for (const p of paths) {
    if (p === 'deck.yaml') roots.push('');
    const m = /^decks\/([^/]+)\/deck\.yaml$/.exec(p);
    if (m) roots.push(`decks/${m[1]}/`);
  }
  return roots.sort();
}

export const isTextFile = (path: string) => /\.(ya?ml|md|njk|css|js|json|txt)$/i.test(path);
