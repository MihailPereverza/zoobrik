import { cardSkills, dueSkills, gateOpen, isIntroduced, nextBatch, topicIsOpen } from './scheduler';
import type { Card, DeckData, Stage, Topic } from './types';

export const STAGE_LABEL: Record<Stage, string> = { new: 'новая', learning: 'учу', review: 'повторяю', mastered: 'освоено', suspended: 'пауза' };

export function stageOf(card: Card): Stage {
  if (!isIntroduced(card)) return 'new';
  return card.progress?.stage ?? 'learning';
}

export interface TopicSummary {
  topic: Topic;
  counts: Record<Stage, number>;
  total: number;
  due: number;
  open: boolean;
  gate: boolean;
}

export function topicSummary(data: DeckData, topic: Topic, now: Date): TopicSummary {
  const counts: Record<Stage, number> = { new: 0, learning: 0, review: 0, mastered: 0, suspended: 0 };
  for (const card of topic.cards) counts[stageOf(card)] += 1;
  return {
    topic, counts, total: topic.cards.length,
    due: topic.cards.filter((c) => dueSkills(data, c, now, 0).length > 0).length,
    open: topicIsOpen(data, topic), gate: gateOpen(data, topic),
  };
}

export function deckSummary(data: DeckData, now: Date) {
  const cards = data.topics.flatMap((t) => t.cards);
  const due = cards.filter((c) => dueSkills(data, c, now).length > 0);
  const batch = nextBatch(data, now, due.length);
  return {
    cards: cards.length,
    introduced: cards.filter(isIntroduced).length,
    due: due.length,
    learning: cards.filter((c) => stageOf(c) === 'learning').length,
    batch,
    exercises: cards.reduce((n, c) => n + c.exercises.filter((e) => e.status === 'ready').length, 0),
  };
}

export function forecast(data: DeckData, now: Date, daysAhead: number): number[] {
  const result = new Array(daysAhead).fill(0);
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  for (const card of data.topics.flatMap((t) => t.cards)) {
    if (!isIntroduced(card)) continue;
    const dues = cardSkills(data, card).map((s) => card.progress?.skills?.[s]?.due).filter(Boolean).map((d) => new Date(d!).getTime());
    if (!dues.length) continue;
    const day = Math.max(0, Math.floor((Math.min(...dues) - start.getTime()) / 86400000));
    if (day < daysAhead) result[day] += 1;
  }
  return result;
}
