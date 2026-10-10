import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { applyAnswer, applyIntro, bury, computeStage, dayKey, gradedToday, isBuried, ladderOf, memoryOf, mergeProgress, rungOf, suspend, unsuspend } from './progress';
import { review } from './fsrs';
import type { Card, DeckConfig, Exercise, Progress } from './types';

const NOW = new Date('2026-04-10T10:00:00Z');
const deck: DeckConfig = { name: 't', limits: { new_cards_per_day: 8, reviews_per_day: 250 }, fsrs: { retention: {}, leech_threshold: 3 } };
const exercise: Exercise = { id: 'e1', template: 'ru-en-type', status: 'ready', params: {} };
const LADDER = ladderOf(deck);

function card(progress?: Progress): Card {
  return { id: 'luggage', kind: 'word', topic: 'travel', path: 'topics/travel/luggage', content: { term: 'luggage' }, theory: null, exercises: [exercise], templates: [], progress };
}

function answer(c: Card, grade: 1 | 2 | 3 | 4, opts: { skill?: string; rung?: number; practice?: boolean; now?: Date; ms?: number; deck?: DeckConfig } = {}) {
  return applyAnswer({ deck: opts.deck ?? deck, card: c, exercise, skill: opts.skill ?? 'recall', rung: opts.rung, grade, practice: opts.practice ?? false, ms: opts.ms ?? 4000, now: opts.now ?? NOW, device: 'mac' });
}

// Progress of topics/appearance-hair/hair/card.yaml from the real deck, written by the six-skill scheduler.
const HAIR_PROGRESS = `
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
exercises:
  e2: { shown: 2, correct: 2, avg_ms: 9510, last: 2026-10-05T15:39:31.628Z }
  e3: { shown: 2, correct: 2, avg_ms: 5526, last: 2026-10-06T16:27:00.412Z }
recent:
  - 2026-10-06T16:42:07Z t1 recognize 3 18769 android
  - 2026-10-06T16:41:34Z e8 context 3 9428 android
  - 2026-10-06T16:40:57Z e9 apply 4 3892 android
  - 2026-10-05T15:39:31Z e2 recognize 4 11801 android
as_of: android:2026-10-06T16:42:07Z
`;
const hair = (): Progress => YAML.parse(HAIR_PROGRESS);

describe('applyAnswer', () => {
  it('creates progress on the first answer and marks the card introduced today', () => {
    const { progress } = answer(card(), 3);
    expect(progress.introduced).toBe(dayKey(NOW));
    expect(progress.memory?.state).toBe('learning');
    expect(progress.totals).toEqual({ answers: 1, correct: 1, lapses: 0 });
  });

  it('moves one memory per card and writes one journal line with the ladder skill', () => {
    const { progress, lines } = answer(card(), 3, { skill: 'recall' });
    expect(progress.skills).toEqual({});
    expect(lines).toHaveLength(1);
    expect(lines[0].split('\t')).toEqual(['2026-04-10T10:00:00Z', 'travel/luggage', 'e1', 'recall', '3', '4000', 'mac']);
  });

  it('practice answers are journaled with a p prefix and never touch the schedule', () => {
    const first = answer(card(), 3).progress;
    const { progress, lines } = answer(card(first), 1, { practice: true });
    expect(progress.memory).toEqual(first.memory);
    expect(progress.rung).toBe(first.rung);
    expect(lines[0].split('\t')[4]).toBe('p1');
  });

  it('keeps a running average of answer time per exercise', () => {
    let c = card();
    for (const ms of [2000, 4000, 6000]) c = card(answer(c, 3, { ms }).progress);
    expect(c.progress!.exercises.e1).toMatchObject({ shown: 3, correct: 3, avg_ms: 4000 });
  });

  it('keeps only the 20 latest answers in the card, newest first', () => {
    let c = card();
    for (let i = 0; i < 25; i++) c = card(answer(c, 3, { now: new Date(NOW.getTime() + i * 60_000) }).progress);
    expect(c.progress!.recent).toHaveLength(20);
    expect(c.progress!.recent[0] > c.progress!.recent[19]).toBe(true);
  });

  it('counts a lapse only when a reviewed memory is forgotten', () => {
    const learning = answer(card(), 1).progress;
    expect(learning.totals.lapses).toBe(0);
    const reviewState = review(deck, undefined, 4, NOW);
    const p = { ...learning, memory: reviewState };
    expect(answer(card(p), 1, { now: new Date(reviewState.due) }).progress.totals.lapses).toBe(1);
  });
});

describe('ladder', () => {
  const at = (rung: number): Progress => ({ ...answer(card(), 4).progress, rung });

  it('Good climbs one rung, Easy two, Hard stays, Again drops one', () => {
    expect(answer(card(at(1)), 3).progress.rung).toBe(2);
    expect(answer(card(at(1)), 4).progress.rung).toBe(3);
    expect(answer(card(at(1)), 2).progress.rung).toBe(1);
    expect(answer(card(at(1)), 1).progress.rung).toBe(0);
  });

  it('starts at the bottom and stays within the ladder', () => {
    expect(answer(card(), 3).progress.rung).toBe(1);
    expect(answer(card(at(0)), 1).progress.rung).toBe(0);
    expect(answer(card(at(LADDER.length - 1)), 4).progress.rung).toBe(LADDER.length - 1);
  });

  it('a correct answer on a higher-rung exercise climbs from that rung (the card had nothing lower)', () => {
    expect(answer(card(at(0)), 3, { rung: 2 }).progress.rung).toBe(3);
    expect(answer(card(at(3)), 3, { rung: 2 }).progress.rung).toBe(4);
    expect(answer(card(at(3)), 1, { rung: 2 }).progress.rung).toBe(2);
  });

  it('honours a ladder from deck.yaml', () => {
    const short: DeckConfig = { ...deck, ladder: ['recognize', 'recall'] };
    expect(answer(card(), 4, { deck: short }).progress.rung).toBe(1);
  });
});

describe('daily cap counter', () => {
  it('counts graded answers of today, not practice and not other days', () => {
    let c = card();
    c = card(answer(c, 3, { now: new Date(NOW.getTime() - 86_400_000) }).progress);
    c = card(answer(c, 3).progress);
    c = card(answer(c, 3, { practice: true, now: new Date(NOW.getTime() + 1000) }).progress);
    c = card(answer(c, 1, { now: new Date(NOW.getTime() + 2000) }).progress);
    expect(gradedToday(c.progress, NOW)).toBe(2);
  });
});

describe('migration from the six-skill model', () => {
  it('takes the weakest skill as the memory and climbs one rung per ladder skill in review', () => {
    const p = hair();
    expect(memoryOf(p)).toEqual(p.skills.apply);
    expect(rungOf(p, LADDER)).toBe(LADDER.length - 1);
    expect(rungOf({ ...p, skills: { recognize: p.skills.recognize, recall: { ...p.skills.recall!, state: 'learning' } } }, LADDER)).toBe(1);
  });

  it('on a stability tie takes the skill due first, so a pending learning step stays due (real deck: thin)', () => {
    const review = { state: 'review' as const, s: 2.3065, d: 2.1, due: '2026-10-08T16:40:35.359Z', last: '2026-10-06T16:40:35.359Z', reps: 2, lapses: 0, step: 0 };
    const listen = { ...review, state: 'learning' as const, due: '2026-10-06T16:48:23.160Z', reps: 1, step: 1 };
    const p = { ...hair(), skills: { recognize: review, listen, recall: { ...review, s: 11.7 } } };
    expect(memoryOf(p)).toEqual(listen);
  });

  it('keeps the old stage reading and leaves the old skills untouched on the next answer', () => {
    const p = hair();
    expect(computeStage(p)).toBe('review');
    const { progress } = answer(card(p), 3, { now: new Date('2026-10-08T17:00:00Z') });
    expect(progress.skills).toEqual(hair().skills);
    expect(progress.memory?.state).toBe('review');
    expect(progress.memory!.s).toBeGreaterThan(p.skills.apply!.s);
    expect(progress.rung).toBe(LADDER.length - 1);
  });

  it('counts the legacy recent lines toward the daily cap', () => {
    expect(gradedToday(hair(), new Date('2026-10-06T20:00:00Z'))).toBe(3);
  });
});

describe('leeches', () => {
  function lapsedTimes(n: number, cfg = deck) {
    let c = card({ stage: 'review', introduced: '2026-04-01', totals: { answers: 1, correct: 1, lapses: 0 }, skills: {}, memory: review(cfg, undefined, 4, NOW), exercises: {}, recent: [] });
    let became = false;
    for (let i = 0; i < n; i++) {
      const fail = answer(c, 1, { now: new Date(c.progress!.memory!.due), deck: cfg });
      became ||= Boolean(fail.becameLeech);
      c = card(fail.progress);
      if (c.progress!.stage === 'suspended') break;
      c = card(answer(c, 3, { now: new Date(c.progress!.memory!.due), deck: cfg }).progress);
    }
    return { c, became };
  }

  it('tags the card as a leech when its memory reaches the lapse threshold', () => {
    const { c, became } = lapsedTimes(3);
    expect(became).toBe(true);
    expect(c.progress!.leech).toBe(true);
    expect(c.progress!.stage).not.toBe('suspended');
  });

  it('does not tag before the threshold', () => {
    expect(lapsedTimes(2).c.progress!.leech).toBeFalsy();
  });

  it('suspends leeches when the deck asks for it', () => {
    expect(lapsedTimes(3, { ...deck, fsrs: { ...deck.fsrs, leech_action: 'suspend' } }).c.progress!.stage).toBe('suspended');
  });
});

describe('stage, bury and suspend', () => {
  it('derives learning / review / mastered from the memory', () => {
    const p: Progress = { stage: 'learning', totals: { answers: 0, correct: 0, lapses: 0 }, skills: {}, exercises: {}, recent: [] };
    expect(computeStage(p)).toBe('learning');
    expect(computeStage({ ...p, memory: { state: 'learning', s: 1, d: 5, due: '', reps: 1, lapses: 0, step: 0 } })).toBe('learning');
    expect(computeStage({ ...p, memory: { state: 'review', s: 10, d: 5, due: '', reps: 3, lapses: 0, step: 0 } })).toBe('review');
    expect(computeStage({ ...p, memory: { state: 'review', s: 120, d: 5, due: '', reps: 9, lapses: 0, step: 0 } })).toBe('mastered');
  });

  it('buries a card until the next learning day', () => {
    const c = card(bury(card(), NOW));
    expect(isBuried(c, NOW)).toBe(true);
    expect(isBuried(c, new Date('2026-04-11T00:30:00Z'))).toBe(false);
  });

  it('suspends and restores a started card without losing its schedule', () => {
    const started = answer(card(), 3).progress;
    const s = suspend(card(started), NOW);
    expect(s.stage).toBe('suspended');
    expect(computeStage(s)).toBe('suspended');
    const back = unsuspend(card(s), NOW);
    expect(back.stage).toBe('learning');
    expect(back.memory).toEqual(started.memory);
  });

  it('suspends a card that was never started, and restoring keeps it new', () => {
    const s = suspend(card(), NOW);
    expect(s.introduced).toBeUndefined();
    expect(unsuspend(card(s), NOW).stage).toBe('new');
  });

  it('marks a card introduced after the intro screen', () => {
    const { progress, lines } = applyIntro(card(), NOW, 'mac');
    expect(progress.introduced).toBe('2026-04-10');
    expect(progress.memory).toBeUndefined();
    expect(lines[0].split('\t')[4]).toBe('seen');
  });
});

describe('mergeProgress (two devices)', () => {
  const base = answer(card(), 3).progress;
  const later = new Date(NOW.getTime() + 3600_000);

  it('returns the other side when one is missing', () => {
    expect(mergeProgress(null, base)).toEqual(base);
    expect(mergeProgress(base, undefined)).toEqual(base);
  });

  it('keeps the freshest memory together with its rung', () => {
    const a = answer(card(base), 3, { now: later }).progress;
    const b = answer(card(base), 1, { now: new Date(NOW.getTime() + 60_000) }).progress;
    const m = mergeProgress(a, b)!;
    expect(m.memory).toEqual(a.memory);
    expect(m.rung).toBe(a.rung);
    expect(mergeProgress(b, a)!.memory).toEqual(a.memory);
  });

  it('a migrated side loses to a fresher answer on the other device', () => {
    const answered = answer(card(hair()), 3, { now: new Date('2026-10-08T17:00:00Z') }).progress;
    expect(mergeProgress(hair(), answered)!.memory).toEqual(answered.memory);
    expect(mergeProgress(hair(), hair())!.memory).toBeUndefined();
  });

  it('unions recent answers without duplicates', () => {
    const a = answer(card(base), 3, { now: later }).progress;
    const b = answer(card(base), 2, { now: new Date(later.getTime() + 1000) }).progress;
    const m = mergeProgress(a, b)!;
    expect(new Set(m.recent).size).toBe(m.recent.length);
    expect(m.recent.length).toBe(3);
  });

  it('keeps the earliest introduction date and a suspension from either side', () => {
    const s = suspend(card(base), NOW);
    expect(mergeProgress(s, { ...base, introduced: '2026-04-12' })!.stage).toBe('suspended');
    expect(mergeProgress({ ...base, introduced: '2026-04-09' }, base)!.introduced).toBe('2026-04-09');
  });
});
