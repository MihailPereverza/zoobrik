import { dueSkills, isIntroduced } from './scheduler';
import { stageOf } from './summary';
import type { Card, DeckData } from './types';

export type WordStatus = 'all' | 'due' | 'new' | 'learning' | 'known' | 'hard' | 'paused';
export type WordKind = 'all' | 'word' | 'phrase' | 'grammar';

/** What the words screen shows; serialised into the URL so a practice session can rebuild the same set. */
export interface WordFilter { q: string; status: WordStatus; kind: WordKind; tag: string }

export const EMPTY_FILTER: WordFilter = { q: '', status: 'all', kind: 'all', tag: '' };

export const STATUS_LABEL: Record<WordStatus, string> = {
  all: 'Все', due: 'К повторению', new: 'Новые', learning: 'Учу', known: 'Знаю', hard: 'Трудные', paused: 'На паузе',
};

export const KIND_LABEL: Record<WordKind, string> = { all: 'Всё', word: 'Слова', phrase: 'Фразы', grammar: 'Правила' };

const fold = (s: string) => s.toLowerCase().replace(/ё/g, 'е').normalize('NFKD').replace(/[̀-ͯ]/g, '');

function haystack(card: Card): string {
  const c = card.content;
  return fold([c.term, c.meaning, ...(c.alt ?? []), c.title, c.formula, ...(card.tags ?? []), ...(c.examples ?? []).flatMap((e) => [e.term, e.meaning])].filter(Boolean).join(' \u0000 '));
}

function statusOf(data: DeckData, card: Card, now: Date): WordStatus[] {
  const stage = stageOf(card);
  const out: WordStatus[] = [];
  if (stage === 'new') out.push('new');
  if (stage === 'learning') out.push('learning');
  if (stage === 'review' || stage === 'mastered') out.push('known');
  if (stage === 'suspended') out.push('paused');
  if (card.progress?.leech || (card.progress?.totals.lapses ?? 0) >= 3) out.push('hard');
  if (isIntroduced(card) && stage !== 'suspended' && dueSkills(data, card, now, 0).length) out.push('due');
  return out;
}

const kindOf = (card: Card): WordKind => (card.kind === 'grammar' ? 'grammar' : card.kind === 'word' ? 'word' : 'phrase');

export function allCards(data: DeckData): Card[] {
  return data.topics.flatMap((t) => t.cards);
}

export function filterCards(data: DeckData, f: WordFilter, now: Date): Card[] {
  const words = fold(f.q.trim()).split(/\s+/).filter(Boolean);
  return allCards(data).filter((card) => {
    if (f.kind !== 'all' && kindOf(card) !== f.kind) return false;
    if (f.tag && !(card.tags ?? []).includes(f.tag)) return false;
    if (f.status !== 'all' && !statusOf(data, card, now).includes(f.status)) return false;
    if (!words.length) return true;
    const text = haystack(card);
    return words.every((w) => text.includes(w));
  });
}

/** Ranks exact and prefix matches of the word itself above matches in examples. */
export function sortCards(cards: Card[], q: string): Card[] {
  const needle = fold(q.trim());
  if (!needle) return cards;
  const score = (c: Card) => {
    const term = fold(c.content.term ?? c.content.title ?? '');
    const meaning = fold(c.content.meaning ?? '');
    if (term === needle || meaning === needle) return 0;
    if (term.startsWith(needle) || meaning.startsWith(needle)) return 1;
    if (term.includes(needle) || meaning.includes(needle)) return 2;
    return 3;
  };
  return [...cards].sort((a, b) => score(a) - score(b));
}

export function countsByStatus(data: DeckData, now: Date): Record<WordStatus, number> {
  const counts = Object.fromEntries(Object.keys(STATUS_LABEL).map((k) => [k, 0])) as Record<WordStatus, number>;
  for (const card of allCards(data)) {
    counts.all++;
    for (const s of statusOf(data, card, now)) counts[s]++;
  }
  return counts;
}

export function allTags(data: DeckData): string[] {
  return [...new Set(allCards(data).flatMap((c) => c.tags ?? []))].sort();
}

export function filterToQuery(f: WordFilter): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.status !== 'all') p.set('status', f.status);
  if (f.kind !== 'all') p.set('kind', f.kind);
  if (f.tag) p.set('tag', f.tag);
  return p.toString();
}

export function queryToFilter(query: string): WordFilter {
  const p = new URLSearchParams(query);
  const status = p.get('status') as WordStatus | null;
  const kind = p.get('kind') as WordKind | null;
  return {
    q: p.get('q') ?? '',
    status: status && status in STATUS_LABEL ? status : 'all',
    kind: kind && kind in KIND_LABEL ? kind : 'all',
    tag: p.get('tag') ?? '',
  };
}
