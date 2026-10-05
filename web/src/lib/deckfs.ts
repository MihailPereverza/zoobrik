import YAML from 'yaml';
import { splitFrontmatter } from './cardyaml';
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
      return { id: meta.id ?? file.replace(/^exercises\/|\.md$/g, ''), template: 'md', skill: meta.skill, status: meta.status ?? 'draft', file, params: { markdown: body } };
    });
}

function buildCard(files: FileMap, topicId: string, cardId: string): Card {
  const dir = `topics/${topicId}/${cardId}`;
  const raw = parse(files.get(`${dir}/card.yaml`)) ?? {};
  const theoryFile = raw.content?.theory;
  return {
    ...raw,
    id: raw.id ?? cardId,
    topic: topicId,
    path: dir,
    content: raw.content ?? {},
    theory: theoryFile ? files.get(`${dir}/${theoryFile}`) ?? null : null,
    exercises: [...(raw.exercises ?? []), ...mdExercises(files, dir)],
    templates: templatesUnder(files, `${dir}/views/`, `card:${topicId}/${cardId}`),
  };
}

function buildTopic(files: FileMap, topicId: string): Topic {
  const raw = parse(files.get(`topics/${topicId}/topic.yaml`)) ?? {};
  const cardIds = [...files.keys()]
    .map((p) => new RegExp(`^topics/${topicId}/([^/]+)/card\\.yaml$`).exec(p)?.[1])
    .filter((id): id is string => Boolean(id))
    .sort();
  return {
    ...raw,
    id: raw.id ?? topicId,
    title: raw.title ?? topicId,
    cards: cardIds.map((id) => buildCard(files, topicId, id)),
    exercises: parse(files.get(`topics/${topicId}/exercises.yaml`)) ?? [],
    templates: templatesUnder(files, `topics/${topicId}/views/`, `topic:${topicId}`),
  };
}

export function buildDeck(files: FileMap, core: CoreBundle): DeckData {
  const deck = parse(files.get('deck.yaml'));
  if (!deck) throw new Error('В репозитории нет deck.yaml');
  const found = [...files.keys()].map((p) => /^topics\/([^/]+)\/topic\.yaml$/.exec(p)?.[1]).filter((id): id is string => Boolean(id)).sort();
  const order: string[] = deck.topics ?? [];
  const ids = [...order.filter((t) => found.includes(t)), ...found.filter((t) => !order.includes(t))];
  return {
    deck,
    topics: ids.map((id) => buildTopic(files, id)),
    templates: [...core.templates, ...templatesUnder(files, 'templates/', 'deck')],
    partials: core.partials,
    baseCss: core.baseCss,
  };
}

export const isTextFile = (path: string) => /\.(ya?ml|md|njk|css|js|json|txt)$/i.test(path);
