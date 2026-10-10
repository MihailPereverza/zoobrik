import { beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { CORE } from './core';
import { review } from './fsrs';
import { bury, dayKey, suspend } from './progress';
import { balanceDue, buildSession, cardSkills, exerciseRung, gateOpen, isDue, isPrimed, learnItems, limitReviews, movesSchedule, nextBatch, nextDueDate, practiceSession, queueAfter, reviewItems, spread, topicIsOpen } from './scheduler';
import { answerItem, runSession } from './sessionsim';
import type { Card, DeckConfig, DeckData, Exercise, Grade, Progress, QueueItem, SkillState, Topic } from './types';

const locks = vi.hoisted(() => ({ exercises: new Set<string>(), cards: new Set<string>() }));
vi.mock('./lexicon', () => ({
  exerciseLocked: (_d: unknown, card: Card, ex: Exercise) => locks.exercises.has(`${card.id}:${ex.id}`),
  cardLocked: (_d: unknown, card: Card) => locks.cards.has(card.id),
  cardCoverage: () => 1,
}));
beforeEach(() => { locks.exercises.clear(); locks.cards.clear(); });

const NOW = new Date('2026-05-04T09:00:00Z');
const DAY = 86_400_000;

const exercises = (): Exercise[] => [
  { id: 'intro', template: 'intro', status: 'ready', params: {} },
  { id: 'e1', template: 'en-ru-choice', skill: 'recognize', status: 'ready', params: { word: 'w', answer: 'a', options: ['a', 'b', 'c', 'd'] } },
  { id: 'e2', template: 'ru-en-type', skill: ['recall', 'spell'], status: 'ready', params: { prompt: 'p', answer: 'w' } },
  { id: 'e3', template: 'sentence-build-ru-en', skill: 'context', status: 'ready', params: { prompt: 'p', answer: 'I see w.', extra: ['x', 'y'] } },
  { id: 'e4', template: 'listen-type', skill: ['listen', 'spell'], status: 'draft', params: { audio: 'word.mp3', answer: 'w', translation: 't' } },
  { id: 'e5', template: 'cloze-choice', skill: 'apply', status: 'ready', params: { text: 'I ___ w.', answer: 'see', options: ['see', 'sees'] } },
];

function mkCard(topic: string, id: string, progress?: Progress): Card {
  return { id, kind: 'word', topic, path: `topics/${topic}/${id}`, content: { term: id, meaning: id }, theory: null, exercises: exercises(), templates: [], progress };
}

function mkTopic(id: string, n: number, extra: Partial<Topic> = {}): Topic {
  const cards = Array.from({ length: n }, (_, i) => mkCard(id, `${id}-${i}`));
  return { id, title: id, batch: 4, order: cards.map((c) => c.id), cards, exercises: [], templates: [], ...extra };
}

function mkDeck(topics: Topic[], over: Partial<DeckConfig> = {}): DeckData {
  const deck: DeckConfig = { name: 'test', limits: { new_cards_per_day: 8, reviews_per_day: 250 }, fsrs: { retention: {}, learning_steps: ['1m', '10m'], relearning_steps: ['10m'] }, cycle: { cards: 4, min_gap: 2 }, ...over };
  return { root: '', deck, topics, templates: CORE.templates, partials: CORE.partials, baseCss: CORE.baseCss };
}

function reviewState(dueOffsetDays: number, s = 10): SkillState {
  const last = new Date(NOW.getTime() + dueOffsetDays * DAY - s * DAY);
  return { state: 'review', s, d: 5, due: new Date(NOW.getTime() + dueOffsetDays * DAY).toISOString(), last: last.toISOString(), reps: 4, lapses: 0, step: 0 };
}

/** A card introduced long ago, its memory in review and due `dueOffsetDays` from NOW (negative = overdue). */
function mature(card: Card, dueOffsetDays: number, rung = 2): Card {
  card.progress = { stage: 'review', introduced: '2026-03-01', totals: { answers: 10, correct: 9, lapses: 0 }, skills: {}, memory: reviewState(dueOffsetDays), rung, exercises: {}, recent: [] };
  return card;
}

const always = (g: Grade) => () => g;
const graded = (answers: { card: Card; graded: boolean }[], card: Card) => answers.filter((a) => a.card === card && a.graded).length;

describe('ladder and due', () => {
  it('puts an exercise on the lowest rung among its skills, spell counting as recall', () => {
    const data = mkDeck([mkTopic('a', 1)]);
    const card = data.topics[0].cards[0];
    const rung = (id: string) => exerciseRung(data, card, card.exercises.find((e) => e.id === id)!);
    expect([rung('e1'), rung('e2'), rung('e3'), rung('e4'), rung('e5')]).toEqual([0, 1, 2, 1, 4]);
    expect(cardSkills(data, card)).toEqual(['recognize', 'recall', 'context', 'apply']);
  });

  it('a card that was never introduced is never due; an introduced one waits for its memory', () => {
    const data = mkDeck([mkTopic('a', 2)]);
    const [fresh, c] = data.topics[0].cards;
    expect(isDue(data, fresh, NOW)).toBe(false);
    mature(c, 5);
    expect(isDue(data, c, NOW)).toBe(false);
    mature(c, -1);
    expect(isDue(data, c, NOW)).toBe(true);
  });

  it('buried and suspended cards are not due', () => {
    const data = mkDeck([mkTopic('a', 2)]);
    const [x, y] = data.topics[0].cards.map((c) => mature(c, -2));
    x.progress = bury(x, NOW);
    y.progress = suspend(y, NOW);
    expect(isDue(data, x, NOW)).toBe(false);
    expect(isDue(data, y, NOW)).toBe(false);
  });

  it('asks a due card exactly one exercise, from its current rung', () => {
    const data = mkDeck([mkTopic('a', 1)]);
    const card = mature(data.topics[0].cards[0], -1, 1);
    const items = reviewItems(data, card);
    expect(items.map((q) => [q.exercise.id, q.skills[0], q.mode])).toEqual([['e2', 'recall', 'review']]);
  });

  it('uses the nearest rung when the current one has nothing (lower one on a tie)', () => {
    const data = mkDeck([mkTopic('a', 1)]);
    const card = mature(data.topics[0].cards[0], -1, 3);
    expect(reviewItems(data, card)[0].exercise.id).toBe('e3');
    card.exercises = card.exercises.filter((e) => e.id !== 'e1');
    card.progress!.rung = 0;
    expect(reviewItems(data, card)[0].exercise.id).toBe('e2');
  });

  it('at the top rung rotates through the upper half of the ladder', () => {
    const data = mkDeck([mkTopic('a', 1)]);
    const card = mature(data.topics[0].cards[0], -1, 4);
    const first = reviewItems(data, card)[0].exercise.id;
    card.progress!.exercises[first] = { shown: 1, correct: 1, avg_ms: 1, last: NOW.toISOString() };
    const second = reviewItems(data, card)[0].exercise.id;
    expect(new Set([first, second])).toEqual(new Set(['e3', 'e5']));
  });

  it('honours a ladder from deck.yaml', () => {
    const data = mkDeck([mkTopic('a', 1)], { ladder: ['apply', 'recognize'] });
    const card = data.topics[0].cards[0];
    expect(learnItems(data, card)[1].exercise.id).toBe('e5');
  });
});

describe('first day of a word', () => {
  it('Good, Good: intro, one rung-0 check, one rung-1 check at the end of the session, then tomorrow', () => {
    const data = mkDeck([mkTopic('a', 4)]);
    const { answers } = runSession(data, NOW, always(3));
    for (const card of data.topics[0].cards) {
      const own = answers.filter((a) => a.card === card);
      expect(own.map((a) => a.item.skills[0])).toEqual(['recognize', 'recall']);
      expect(card.progress!.memory!.state).toBe('review');
      expect(card.progress!.rung).toBe(2);
      expect(new Date(card.progress!.memory!.due).getTime()).toBeGreaterThanOrEqual(NOW.getTime() + DAY - 3600_000);
    }
    const last = answers.slice(-4).map((a) => a.item.skills[0]);
    expect(last).toEqual(['recall', 'recall', 'recall', 'recall']);
  });

  it('never gives a new word more than 3 graded exercises on its first day, whatever the grades', () => {
    for (const g of [1, 2, 3] as Grade[]) {
      const data = mkDeck([mkTopic('a', 4)]);
      const { answers } = runSession(data, NOW, always(g));
      for (const card of data.topics[0].cards) expect(graded(answers, card)).toBeLessThanOrEqual(3);
      const later = runSession(data, new Date(NOW.getTime() + 3 * 3600_000), always(g), { allowNew: false }).answers;
      for (const card of data.topics[0].cards) expect(graded(later, card)).toBe(0);
    }
  });

  it('Easy on the first check graduates the card at once', () => {
    const data = mkDeck([mkTopic('a', 1)]);
    const card = data.topics[0].cards[0];
    const { answers } = runSession(data, NOW, always(4));
    expect(graded(answers, card)).toBe(1);
    expect(card.progress!.memory!.state).toBe('review');
    expect(card.progress!.rung).toBe(2);
    expect(new Date(card.progress!.memory!.due).getTime() - NOW.getTime()).toBeGreaterThan(2 * DAY);
  });

  it('Again drops back a rung and relearns within the same session', () => {
    const data = mkDeck([mkTopic('a', 1)]);
    const card = data.topics[0].cards[0];
    const grades: Grade[] = [3, 1, 3];
    const { answers } = runSession(data, NOW, () => grades.shift() ?? 3);
    expect(answers.map((a) => a.item.skills[0])).toEqual(['recognize', 'recall', 'recognize']);
    expect(card.progress!.rung).toBe(1);
  });
});

describe('within a session', () => {
  const item = (card: Card, id: string, extra: Partial<QueueItem> = {}): QueueItem => ({ key: `${card.id}:${id}`, card, exercise: card.exercises.find((e) => e.id === id) ?? { id, template: 'match-pairs', status: 'ready', params: {} }, skills: ['recall'], mode: 'review', ...extra });

  it('Easy drops the card\'s other queued exercises but keeps topic exercises', () => {
    const data = mkDeck([mkTopic('a', 2)]);
    const [a, b] = data.topics[0].cards.map((c) => mature(c, -1));
    const topicItem = item(a, 't1', { topicCards: [a, b] });
    const queue = [item(a, 'e1'), item(b, 'e1'), item(a, 'e2'), topicItem];
    answerItem(data, queue[0], 4, NOW);
    expect(queueAfter(data, queue, 0, 4, false, NOW).map((q) => q.key)).toEqual(['a-0:e1', 'a-1:e1', 'a-0:t1']);
    expect(queueAfter(data, queue, 0, 3, false, NOW)).toEqual(queue);
  });

  it('topic exercises are practice: they never move a card\'s schedule', () => {
    const topic = mkTopic('a', 3);
    topic.exercises = [{ id: 't1', template: 'match-pairs', status: 'ready', params: { pairs: [] }, cards: Object.fromEntries(topic.cards.map((c) => [c.id, 'recognize'])) }];
    const data = mkDeck([topic]);
    topic.cards.forEach((c) => mature(c, -1));
    const t = buildSession(data, NOW, false).queue.find((q) => q.topicCards)!;
    expect(t).toBeTruthy();
    expect(movesSchedule(t)).toBe(false);
    const before = topic.cards.map((c) => JSON.stringify([c.progress!.memory, c.progress!.rung]));
    expect(answerItem(data, t, 1, NOW)).toBe(false);
    expect(topic.cards.map((c) => JSON.stringify([c.progress!.memory, c.progress!.rung]))).toEqual(before);
    expect(topic.cards.every((c) => c.progress!.recent[0].includes(' p1 '))).toBe(true);
  });
});

describe('daily cap', () => {
  it('stops a card after max_per_day graded exercises, practice excluded', () => {
    const data = mkDeck([mkTopic('a', 1)], { cycle: { max_per_day: 2 } });
    const card = mature(data.topics[0].cards[0], -1);
    const stamp = (min: number, g: string) => `${new Date(NOW.getTime() - min * 60_000).toISOString().replace(/\.\d+Z$/, 'Z')} e1 recognize ${g} 3000 mac`;
    card.progress!.recent = [stamp(5, 'p3'), stamp(10, '1')];
    expect(isDue(data, card, NOW)).toBe(true);
    card.progress!.recent.unshift(stamp(1, '1'));
    expect(isDue(data, card, NOW)).toBe(false);
    expect(buildSession(data, NOW).queue).toHaveLength(0);
    expect(nextDueDate(data, NOW)).toBeNull();
    expect(isDue(data, card, new Date(NOW.getTime() + DAY))).toBe(true);
  });
});

describe('migration from the six-skill model', () => {
  // Progress block of decks/english-notebook/topics/appearance-hair/hair/card.yaml (all six skills in review).
  const HAIR = YAML.parse(`
stage: review
introduced: 2026-10-05
totals: { answers: 16, correct: 14, lapses: 0 }
skills:
  recognize: { state: review, s: 9.4858, d: 1, due: 2026-10-13T16:42:07.467Z, last: 2026-10-06T16:42:07.467Z, reps: 4, lapses: 0, step: 0 }
  listen: { state: review, s: 1.5623, d: 7.5794, due: 2026-10-08T16:28:57.156Z, last: 2026-10-06T16:28:57.156Z, reps: 4, lapses: 0, step: 0 }
  apply: { state: review, s: 1.1614, d: 6.4928, due: 2026-10-08T16:40:57.370Z, last: 2026-10-06T16:40:57.370Z, reps: 4, lapses: 0, step: 0 }
  recall: { state: review, s: 7.3153, d: 2.1112, due: 2026-10-13T16:27:00.412Z, last: 2026-10-06T16:27:00.412Z, reps: 2, lapses: 0, step: 0 }
  spell: { state: review, s: 7.3153, d: 2.1112, due: 2026-10-22T16:28:57.156Z, last: 2026-10-06T16:28:57.156Z, reps: 2, lapses: 0, step: 0 }
  context: { state: review, s: 2.3065, d: 2.1112, due: 2026-10-10T16:41:34.137Z, last: 2026-10-06T16:41:34.137Z, reps: 2, lapses: 0, step: 0 }
exercises: {}
recent: []
`) as Progress;

  it('is due when its weakest skill was due, with one exercise from the top of the ladder', () => {
    const data = mkDeck([mkTopic('a', 1)]);
    const card = data.topics[0].cards[0];
    card.progress = HAIR;
    expect(isDue(data, card, new Date('2026-10-07T12:00:00Z'))).toBe(false);
    const at = new Date('2026-10-08T17:00:00Z');
    expect(isDue(data, card, at)).toBe(true);
    const items = reviewItems(data, card);
    expect(items).toHaveLength(1);
    expect(['e3', 'e5']).toContain(items[0].exercise.id);
    expect(gateOpen(data, data.topics[0])).toBe(true);
  });
});

describe('Rule B: locked exercises and cards', () => {
  it('never asks a locked exercise and skips to the nearest open rung', () => {
    const data = mkDeck([mkTopic('a', 1)]);
    const card = data.topics[0].cards[0];
    locks.exercises.add(`${card.id}:e1`);
    expect(learnItems(data, card)[1].exercise.id).toBe('e2');
  });

  it('does not introduce a locked card', () => {
    const data = mkDeck([mkTopic('a', 6)]);
    locks.cards.add('a-0');
    expect(nextBatch(data, NOW, 0)!.cards.map((c) => c.id)).toEqual(['a-1', 'a-2', 'a-3', 'a-4']);
  });

  it('a card whose every exercise is locked is neither introduced nor due, and does not hold the gate', () => {
    const data = mkDeck([mkTopic('a', 2)]);
    const [c, d] = data.topics[0].cards;
    for (const ex of [...c.exercises, ...d.exercises]) locks.exercises.add(`${c.id}:${ex.id}`);
    expect(nextBatch(data, NOW, 0)!.cards.map((x) => x.id)).toEqual(['a-1']);
    c.progress = { stage: 'learning', introduced: '2026-05-01', totals: { answers: 0, correct: 0, lapses: 0 }, skills: {}, exercises: {}, recent: [] };
    expect(isDue(data, c, NOW)).toBe(false);
    expect(gateOpen(data, data.topics[0])).toBe(true);
  });
});

describe('new cards', () => {
  it('opens the first batch of the first topic, in topic order', () => {
    const data = mkDeck([mkTopic('a', 10)]);
    expect(nextBatch(data, NOW, 0)!.cards.map((c) => c.id)).toEqual(['a-0', 'a-1', 'a-2', 'a-3']);
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
    first.forEach((c) => { c.progress = { stage: 'learning', introduced: '2026-05-03', totals: { answers: 1, correct: 1, lapses: 0 }, skills: {}, memory: review(data.deck, undefined, 3, NOW), exercises: {}, recent: [] }; });
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
  it('starts a new batch with the intro of each card, then one first-rung check', () => {
    const data = mkDeck([mkTopic('a', 4)]);
    const { queue, newCards } = buildSession(data, NOW);
    expect(newCards).toBe(4);
    for (const card of data.topics[0].cards) {
      expect(queue.filter((q) => q.card === card).map((q) => q.exercise.id)).toEqual(['intro', 'e1']);
    }
  });

  it('never shows two exercises of the same word back to back when there are neighbours', () => {
    const data = mkDeck([mkTopic('a', 4)]);
    data.topics[0].cards.forEach((c) => mature(c, -1));
    const { queue } = buildSession(data, NOW);
    expect(queue).toHaveLength(4);
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
});

describe('daily review limit', () => {
  it('caps mature reviews but always lets learning cards through', () => {
    const data = mkDeck([mkTopic('a', 6)], { limits: { new_cards_per_day: 0, reviews_per_day: 2 } });
    const [l, ...rest] = data.topics[0].cards;
    rest.forEach((c, i) => mature(c, -1 - i));
    l.progress = { stage: 'learning', introduced: '2026-05-01', totals: { answers: 1, correct: 0, lapses: 0 }, skills: {}, memory: review(data.deck, undefined, 1, new Date(NOW.getTime() - 3600_000)), exercises: {}, recent: [] };
    const due = data.topics[0].cards.filter((c) => isDue(data, c, NOW));
    const limited = limitReviews(data, due, NOW);
    expect(limited).toContain(l);
    expect(limited.filter((c) => c !== l)).toHaveLength(2);
  });

  it('counts reviews already done today against the limit', () => {
    const data = mkDeck([mkTopic('a', 4)], { limits: { new_cards_per_day: 0, reviews_per_day: 2 } });
    const cards = data.topics[0].cards.map((c) => mature(c, -1));
    cards[0].progress!.exercises = { e1: { shown: 1, correct: 1, avg_ms: 1, last: NOW.toISOString() } };
    cards[0].progress!.memory = reviewState(5);
    const due = cards.filter((c) => isDue(data, c, NOW));
    expect(limitReviews(data, due, NOW)).toHaveLength(1);
  });
});

describe('load balancer', () => {
  it('moves a review to the least busy day inside the fuzz range', () => {
    const data = mkDeck([mkTopic('a', 30)]);
    const [target, ...others] = data.topics[0].cards;
    const state: SkillState = { state: 'review', s: 20, d: 5, due: new Date(NOW.getTime() + 20 * DAY).toISOString(), last: NOW.toISOString(), reps: 5, lapses: 0, step: 0 };
    others.forEach((c) => mature(c, 20));
    const days = Math.round((Date.parse(balanceDue(data, target, state).due) - NOW.getTime()) / DAY);
    expect(days).not.toBe(20);
    expect(Math.abs(days - 20)).toBeLessThanOrEqual(4);
  });

  it('leaves short intervals, learning states and disabled balancing untouched', () => {
    const data = mkDeck([mkTopic('a', 3)]);
    const short: SkillState = { ...reviewState(2, 2), last: NOW.toISOString(), due: new Date(NOW.getTime() + 2 * DAY).toISOString() };
    expect(balanceDue(data, data.topics[0].cards[0], short)).toEqual(short);
    const learning = review(data.deck, undefined, 3, NOW);
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
    const q = practiceSession(data, data.topics[0].cards, NOW);
    expect(q.length).toBeGreaterThan(0);
    expect(q.every((x) => x.mode === 'practice' && !movesSchedule(x) && ['a-0', 'a-1'].includes(x.card.id))).toBe(true);
  });
});

describe('priming rule', () => {
  const seen = new Map([['term', 3], ['meaning', 3]]);
  it('treats a review answer as practice when the cycle already revealed the asked form', () => {
    expect(isPrimed(['term'], seen, 6, 'review')).toBe(true);
  });
  it('never applies while a word is being learned or introduced', () => {
    expect(isPrimed(['term'], seen, 6, 'learn')).toBe(false);
    expect(isPrimed(['meaning'], seen, 4, 'intro')).toBe(false);
  });
  it('expires after the window and needs every asked form', () => {
    expect(isPrimed(['term'], seen, 30, 'review')).toBe(false);
    expect(isPrimed(['term', 'audio'], seen, 5, 'review')).toBe(false);
    expect(isPrimed([], seen, 5, 'review')).toBe(false);
  });
});
