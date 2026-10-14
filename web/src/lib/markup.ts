import { brokenMarkup } from './md';
import type { Card, DeckData, Exercise } from './types';

export interface MarkupIssue { card: Card; exercise?: Exercise; message: string }

const MARKDOWN_PARAMS = ['explanation', 'instruction', 'hint', 'translation', 'question', 'note', 'markdown'];

/** Text whose markdown shows raw stars to the learner: theory, notes, explanations, markdown exercises. */
export function markupIssues(data: DeckData): MarkupIssue[] {
  const out: MarkupIssue[] = [];
  for (const card of data.topics.flatMap((t) => t.cards)) {
    const blocks = [card.theory ?? '', card.content.note ?? ''].flatMap((t) => t.split('\n'));
    for (const line of [...blocks, card.content.title ?? '', card.content.formula ?? '']) if (brokenMarkup(line)) out.push({ card, message: `вёрстка: ${line.trim().slice(0, 80)}` });
    for (const exercise of card.exercises) for (const key of MARKDOWN_PARAMS) {
      const value = exercise.params?.[key];
      if (typeof value !== 'string') continue;
      const bad = value.split('\n').find((line) => brokenMarkup(line));
      if (bad) out.push({ card, exercise, message: `вёрстка в ${key}: ${bad.trim().slice(0, 80)}` });
    }
  }
  return out;
}
