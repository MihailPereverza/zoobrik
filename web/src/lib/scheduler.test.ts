import { describe, expect, it } from 'vitest';
import { CORE } from './core';
import { review } from './fsrs';
import { bury, dayKey, suspend } from './progress';
import { balanceDue, buildSession, cardSkills, dueSkills, gateOpen, isPrimed, limitReviews, nextBatch, practiceSession, spread, topicIsOpen } from './scheduler';
import type { Card, DeckConfig, DeckData, Exercise, Progress, QueueItem, SkillState, Topic } from './types';

const NOW = new Date('2026-05-04T09:00:00Z');
const DAY = 86_400_000;

const exercises = (): Exercise[] => [
  { id: 'intro', template: 'intro', status: 'ready', params: {} },
  { id: 'e1', template: 'en-ru-choice', skill: 'recognize', status: 'ready', params: { word: 'w', answer: 'a', options: ['a', 'b', 'c', 'd'] } },
  { id: 'e2', template: 'ru-en-type', skill: ['recall', 'spell'], status: 'ready', params: { prompt: 'p', answer: 'w' } },
  { id: 'e3', template: 'sentence-build-ru-en', skill: 'context', status: 'ready', params: { prompt: 'p', answer: 'I see w.', extra: ['x', 'y'] } },
  { id: 'e4', template: 'listen-type', skill: ['listen', 'spell'], status: 'draft', params: { audio: 'word.mp3', answer: 'w', translation: 't' } },
];

function mkCard(topic: string, id: string, progress?: Progress): Card {
  return { id, kind: 'word', topic, path: `topics/${topic}/${id}`, content: { en: id, ru: id }, theory: null, exercises: exercises(), templates: [], progress };
}

function mkTopic(id: string, n: number, extra: Partial<Topic> = {}): Topic {
  const cards = Array.from({ length: n }, (_, i) => mkCard(id, `${id}-${i}`));
  return { id, title: id, batch: 4, order: cards.map((c) => c.id), cards, exercises: [], templates: [], ...extra };
}

function mkDeck(topics: Topic[], over: Partial<DeckConfig> = {}): DeckData {
  const deck: DeckConfig = { name: 'test', limits: { new_cards_per_day: 8, reviews_per_day: 250 }, fsrs: { retention: {}, learning_steps: ['1m', '10m'], relearning_steps: ['10m'] }, cycle: { cards: 4, min_gap: 2, max_exercises_per_card: 5 }, ...over };
  return { deck, topics, templates: CORE.templates, partials: CORE.partials, baseCss: CORE.baseCss };
}

function reviewState(dueOffsetDays: number, s = 10): SkillState {
  const last = new Date(NOW.getTime() + dueOffsetDays * DAY - s * DAY);
  return { state: 'review', s, d: 5, due: new Date(NOW.getTime() + dueOffsetDays * DAY).toISOString(), last: last.toISOString(), reps: 4, lapses: 0, step: 0 };
}

/** A card introduced long ago with all its skills in review, due `dueOffsetDays` from NOW (negative = overdue). */
function mature(card: Card, dueOffsetDays: number): Card {
  const skills = Object.fromEntries(['recognize', 'recall', 'spell', 'context'].map((s) => [s, reviewState(dueOffsetDays)]));
  card.progress = { stage: 'review', introduced: '2026-03-01', totals: { answers: 10, correct: 9, lapses: 0 }, skills, exercises: {}, recent: [] };
  return card;
}

describe('skills and due', () => {
  it('collects skills only from ready exercises (draft listen-type is ignored)', () => {
    const data = mkDeck([mkTopic('a', 1)]);
    expect(cardSkills(data, data.topics[0].cards[0])).toEqual(['recognize', 'recall', 'spell', 'context']);
  });

  it('a card that was never introduced is never due', () => {
    const data = mkDeck([mkTopic('a', 1)]);
    expect(dueSkills(data, data.topics[0].cards[0], NOW)).toEqual([]);
  });

  it('reports exactly the overdue skills of a mature card', () => {
    const data = mkDeck([mkTopic('a', 1)]);
    const c = mature(data.topics[0].cards[0], 5);
    c.progress!.skills.recall = reviewState(-1);
    expect(dueSkills(data, c, NOW)).toEqual(['recall']);
  });

  it('buried and suspended cards are not due', () => {
    const data = mkDeck([mkTopic('a', 2)]);
    const [x, y] = data.topics[0].cards.map((c) => mature(c, -2));
    x.progress = bury(x, NOW);
    y.progress = suspend(y, NOW);
    expect(dueSkills(data, x, NOW)).toEqual([]);
    expect(dueSkills(data, y, NOW)).toEqual([]);
  });
});

describe('new cards', () => {
  it('opens the first batch of the first topic, in topic order', () => {
    const data = mkDeck([mkTopic('a', 10)]);
    const batch = nextBatch(data, NOW, 0)!;
    expect(batch.cards.map((c) => c.id)).toEqual(['a-0', 'a-1', 'a-2', 'a-3']);
  });

  it('respects the daily new-card limit', () => {
    const data = mkDeck([mkTopic('a', 10)], { limits: { new_cards_per_day: 2, reviews_per_day: 250 } });
    expect(nextBatch(data, NOW, 0)!.cards).toHaveLength(2);
    data.topics[0].cards.slice(0, 2).forEach((c) => mature(c, 1));
    data.topics[0].cards.slice(0, 2).forEach((c) => (c.progress!.introduced = dayKey(NOW)));
    expect(nextBatch(data, NOW, 0)).toBeNull();
  });

  it('holds the next batch until the current one graduates (gate)', () => {
    const data = mkDeck([mkTopic('a', 8)]);
    const first = data.topics[0].cards.slice(0, 4);
    first.forEach((c) => { c.progress = { stage: 'learning', introduced: '2026-05-03', totals: { answers: 1, correct: 1, lapses: 0 }, skills: { recall: review(data.deck, 'recall', undefined, 3, NOW) }, exercises: {}, recent: [] }; });
    expect(gateOpen(data, data.topics[0])).toBe(false);
    expect(nextBatch(data, NOW, 0)).toBeNull();
    first.forEach((c) => mature(c, 3));
    expect(gateOpen(data, data.topics[0])).toBe(true);
    expect(nextBatch(data, NOW, 0)!.cards.map((c) => c.id)).toEqual(['a-4', 'a-5', 'a-6', 'a-7']);
  });

  it('keeps a topic closed until the topics it requires are started and graduated', () => {
    const base = mkTopic('base', 4);
    const next = mkTopic('next', 4, { requires: ['base'] });
    const data = mkDeck([base, next]);
    expect(topicIsOpen(data, next)).toBe(false);
    base.cards.forEach((c) => mature(c, 3));
    expect(topicIsOpen(data, next)).toBe(true);
  });

  it('skips suspended and buried new cards', () => {
    const data = mkDeck([mkTopic('a', 6)]);
    const [c0, c1] = data.topics[0].cards;
    c0.progress = suspend(c0, NOW);
    c1.progress = bury(c1, NOW);
    expect(nextBatch(data, NOW, 0)!.cards.map((c) => c.id)).toEqual(['a-2', 'a-3', 'a-4', 'a-5']);
  });

  it('stops new cards when the review backlog is above the daily review limit', () => {
    const data = mkDeck([mkTopic('a', 6)], { limits: { new_cards_per_day: 8, reviews_per_day: 10 } });
    expect(nextBatch(data, NOW, 50)).toBeNull();
  });
});

describe('session building', () => {
  it('starts a new batch with the intro of each card, then exercises from easy to hard', () => {
    const data = mkDeck([mkTopic('a', 4)]);
    const { queue, newCards } = buildSession(data, NOW);
    expect(newCards).toBe(4);
    for (const card of data.topics[0].cards) {
      const own = queue.filter((q) => q.card === card);
      expect(own[0].exercise.template).toBe('intro');
      expect(own.slice(1).map((q) => q.exercise.id)).toEqual(['e1', 'e2', 'e3']);
    }
  });

  it('never shows two exercises of the same word back to back when there are neighbours', () => {
    const data = mkDeck([mkTopic('a', 4)]);
    data.topics[0].cards.forEach((c) => mature(c, -1));
    const { queue } = buildSession(data, NOW);
    for (let i = 1; i < queue.length; i++) expect(queue[i].card).not.toBe(queue[i - 1].card);
  });

  it('puts the most forgotten topic first', () => {
    const fresh = mkTopic('fresh', 2);
    const old = mkTopic('old', 2);
    const data = mkDeck([fresh, old]);
    fresh.cards.forEach((c) => mature(c, -1));
    old.cards.forEach((c) => mature(c, -40));
    expect(buildSession(data, NOW, false).queue[0].card.topic).toBe('old');
  });

  it('covers every due skill and asks each exercise only once per card', () => {
    const data = mkDeck([mkTopic('a', 1)]);
    mature(data.topics[0].cards[0], -1);
    const { queue } = buildSession(data, NOW, false);
    expect(new Set(queue.flatMap((q) => q.skills))).toEqual(new Set(['recognize', 'recall', 'spell', 'context']));
    expect(new Set(queue.map((q) => q.exercise.id)).size).toBe(queue.length);
  });
});

describe('daily review limit', () => {
  it('caps mature reviews but always lets learning cards through', () => {
    const data = mkDeck([mkTopic('a', 6)], { limits: { new_cards_per_day: 0, reviews_per_day: 2 } });
    const [l, ...rest] = data.topics[0].cards;
    rest.forEach((c, i) => mature(c, -1 - i));
    l.progress = { stage: 'learning', introduced: '2026-05-01', totals: { answers: 1, correct: 0, lapses: 0 }, skills: { recall: { ...review(data.deck, 'recall', undefined, 1, new Date(NOW.getTime() - 3600_000)) } }, exercises: {}, recent: [] };
    const due = data.topics[0].cards.filter((c) => dueSkills(data, c, NOW).length > 0);
    const limited = limitReviews(data, due, NOW);
    expect(limited).toContain(l);
    expect(limited.filter((c) => c !== l)).toHaveLength(2);
  });

  it('counts reviews already done today against the limit', () => {
    const data = mkDeck([mkTopic('a', 4)], { limits: { new_cards_per_day: 0, reviews_per_day: 2 } });
    const cards = data.topics[0].cards.map((c) => mature(c, -1));
    cards[0].progress!.exercises = { e1: { shown: 1, correct: 1, avg_ms: 1, last: NOW.toISOString() } };
    cards[0].progress!.skills = Object.fromEntries(['recognize', 'recall', 'spell', 'context'].map((k) => [k, reviewState(5)]));
    const due = cards.filter((c) => dueSkills(data, c, NOW).length > 0);
    expect(limitReviews(data, due, NOW)).toHaveLength(1);
  });
});

describe('load balancer', () => {
  it('moves a review to the least busy day inside the fuzz range', () => {
    const data = mkDeck([mkTopic('a', 30)]);
    const [target, ...others] = data.topics[0].cards;
    const last = NOW;
    const state: SkillState = { state: 'review', s: 20, d: 5, due: new Date(last.getTime() + 20 * DAY).toISOString(), last: last.toISOString(), reps: 5, lapses: 0, step: 0 };
    others.forEach((c) => mature(c, 20));
    const balanced = balanceDue(data, target, state);
    const days = Math.round((Date.parse(balanced.due) - last.getTime()) / DAY);
    expect(days).not.toBe(20);
    expect(Math.abs(days - 20)).toBeLessThanOrEqual(4);
  });

  it('leaves short intervals, learning states and disabled balancing untouched', () => {
    const data = mkDeck([mkTopic('a', 3)]);
    const short: SkillState = { ...reviewState(2, 2), last: NOW.toISOString(), due: new Date(NOW.getTime() + 2 * DAY).toISOString() };
    expect(balanceDue(data, data.topics[0].cards[0], short)).toEqual(short);
    const learning = review(data.deck, 'recall', undefined, 3, NOW);
    expect(balanceDue(data, data.topics[0].cards[0], learning)).toEqual(learning);
    const off = mkDeck([mkTopic('a', 3)], { fsrs: { retention: {}, load_balance: false } });
    const long: SkillState = { ...reviewState(30, 30), last: NOW.toISOString(), due: new Date(NOW.getTime() + 30 * DAY).toISOString() };
    expect(balanceDue(off, off.topics[0].cards[0], long)).toEqual(long);
  });

  it('avoids Easy Days when another day in range is equally loaded', () => {
    const data = mkDeck([mkTopic('a', 1)], { fsrs: { retention: {}, easy_days: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== new Date(NOW.getTime() + 21 * DAY).getUTCDay()) } });
    const state: SkillState = { state: 'review', s: 20, d: 5, due: new Date(NOW.getTime() + 20 * DAY).toISOString(), last: NOW.toISOString(), reps: 5, lapses: 0, step: 0 };
    const days = Math.round((Date.parse(balanceDue(data, data.topics[0].cards[0], state).due) - NOW.getTime()) / DAY);
    expect(days).toBe(20);
  });
});

describe('spread', () => {
  const items = (card: string, n: number) => Array.from({ length: n }, (_, i) => ({ key: `${card}${i}`, card: { id: card } as Card, exercise: {} as Exercise, skills: [], mode: 'review' }) as QueueItem);

  it('keeps at least minGap other items between exercises of one word', () => {
    const out = spread([items('a', 3), items('b', 3), items('c', 3)], 2, false);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j <= i + 2 && j < out.length; j++) expect(out[j].card.id).not.toBe(out[i].card.id);
  });

  it('preserves the order of exercises within a word', () => {
    const out = spread([items('a', 4), items('b', 2)], 2, false);
    expect(out.filter((x) => x.card.id === 'a').map((x) => x.key)).toEqual(['a0', 'a1', 'a2', 'a3']);
  });

  it('places everything even when only one word is left', () => {
    expect(spread([items('a', 5)], 2, false)).toHaveLength(5);
  });
});

describe('practice', () => {
  it('uses only started cards of the topic and marks items as practice', () => {
    const data = mkDeck([mkTopic('a', 5)]);
    data.topics[0].cards.slice(0, 2).forEach((c) => mature(c, 5));
    const q = practiceSession(data, 'a', NOW);
    expect(q.length).toBeGreaterThan(0);
    expect(q.every((x) => x.mode === 'practice' && ['a-0', 'a-1'].includes(x.card.id))).toBe(true);
  });
});

describe('priming rule', () => {
  const seen = new Map([['en', 3], ['ru', 3]]);
  it('treats a review answer as practice when the cycle already revealed the asked form', () => {
    expect(isPrimed(['en'], seen, 6, 'review')).toBe(true);
  });
  it('never applies while a word is being learned or introduced', () => {
    expect(isPrimed(['en'], seen, 6, 'learn')).toBe(false);
    expect(isPrimed(['ru'], seen, 4, 'intro')).toBe(false);
  });
  it('expires after the window and needs every asked form', () => {
    expect(isPrimed(['en'], seen, 30, 'review')).toBe(false);
    expect(isPrimed(['en', 'audio'], seen, 5, 'review')).toBe(false);
    expect(isPrimed([], seen, 5, 'review')).toBe(false);
  });
});
