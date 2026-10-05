import { describe, expect, it } from 'vitest';
import { applyAnswer, applyIntro, bury, computeStage, dayKey, isBuried, mergeProgress, suspend, unsuspend } from './progress';
import { review } from './fsrs';
import type { Card, DeckConfig, Exercise, Progress, Skill } from './types';

const NOW = new Date('2026-04-10T10:00:00Z');
const deck: DeckConfig = { name: 't', limits: { new_cards_per_day: 8, reviews_per_day: 250 }, fsrs: { retention: {}, leech_threshold: 3 } };
const exercise: Exercise = { id: 'e1', template: 'ru-en-type', status: 'ready', params: {} };

function card(progress?: Progress): Card {
  return { id: 'luggage', kind: 'word', topic: 'travel', path: 'topics/travel/luggage', content: { en: 'luggage' }, theory: null, exercises: [exercise], templates: [], progress };
}

function answer(c: Card, grade: 1 | 2 | 3 | 4, opts: { skills?: Skill[]; practice?: boolean; now?: Date; ms?: number } = {}) {
  return applyAnswer({ deck, card: c, exercise, skills: opts.skills ?? ['recall'], grade, practice: opts.practice ?? false, ms: opts.ms ?? 4000, now: opts.now ?? NOW, device: 'mac' });
}

describe('applyAnswer', () => {
  it('creates progress on the first answer and marks the card introduced today', () => {
    const { progress } = answer(card(), 3);
    expect(progress.introduced).toBe(dayKey(NOW));
    expect(progress.skills.recall?.state).toBe('learning');
    expect(progress.totals).toEqual({ answers: 1, correct: 1, lapses: 0 });
  });

  it('updates every skill an exercise trains and writes one journal line per skill', () => {
    const { progress, lines } = answer(card(), 3, { skills: ['recall', 'spell'] });
    expect(Object.keys(progress.skills).sort()).toEqual(['recall', 'spell']);
    expect(lines).toHaveLength(2);
    expect(lines[0].split('\t')).toEqual(['2026-04-10T10:00:00Z', 'travel/luggage', 'e1', 'recall', '3', '4000', 'mac']);
  });

  it('practice answers are journaled with a p prefix and never touch the schedule', () => {
    const first = answer(card(), 3).progress;
    const { progress, lines } = answer(card(first), 1, { practice: true });
    expect(progress.skills.recall).toEqual(first.skills.recall);
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

  it('counts a lapse only when a reviewed skill is forgotten', () => {
    const learning = answer(card(), 1).progress;
    expect(learning.totals.lapses).toBe(0);
    const reviewState = review(deck, 'recall', undefined, 4, NOW);
    const p = { ...learning, skills: { recall: reviewState } };
    expect(answer(card(p), 1, { now: new Date(reviewState.due) }).progress.totals.lapses).toBe(1);
  });
});

describe('leeches', () => {
  function lapsedTimes(n: number) {
    let state = review(deck, 'recall', undefined, 4, NOW);
    let c = card({ stage: 'review', introduced: '2026-04-01', totals: { answers: 1, correct: 1, lapses: 0 }, skills: { recall: state }, exercises: {}, recent: [] });
    let became = false;
    for (let i = 0; i < n; i++) {
      const at = new Date(c.progress!.skills.recall!.due);
      const fail = answer(c, 1, { now: at });
      became ||= Boolean(fail.becameLeech);
      c = card(fail.progress);
      const pass = answer(c, 3, { now: new Date(c.progress!.skills.recall!.due) });
      c = card(pass.progress);
      state = c.progress!.skills.recall!;
    }
    return { c, became };
  }

  it('tags the card as a leech when a skill reaches the lapse threshold', () => {
    const { c, became } = lapsedTimes(3);
    expect(became).toBe(true);
    expect(c.progress!.leech).toBe(true);
    expect(c.progress!.stage).not.toBe('suspended');
  });

  it('does not tag before the threshold', () => {
    expect(lapsedTimes(2).c.progress!.leech).toBeFalsy();
  });

  it('suspends leeches when the deck asks for it', () => {
    const strict = { ...deck, fsrs: { ...deck.fsrs, leech_action: 'suspend' as const } };
    let state = review(strict, 'recall', undefined, 4, NOW);
    let c = card({ stage: 'review', introduced: '2026-04-01', totals: { answers: 1, correct: 1, lapses: 0 }, skills: { recall: state }, exercises: {}, recent: [] });
    for (let i = 0; i < 3; i++) {
      c = card(applyAnswer({ deck: strict, card: c, exercise, skills: ['recall'], grade: 1, practice: false, ms: 1, now: new Date(c.progress!.skills.recall!.due), device: 'mac' }).progress);
      if (c.progress!.stage === 'suspended') break;
      c = card(applyAnswer({ deck: strict, card: c, exercise, skills: ['recall'], grade: 3, practice: false, ms: 1, now: new Date(c.progress!.skills.recall!.due), device: 'mac' }).progress);
      state = c.progress!.skills.recall!;
    }
    expect(c.progress!.stage).toBe('suspended');
  });
});

describe('stage, bury and suspend', () => {
  it('derives learning / review / mastered from the skills', () => {
    const p: Progress = { stage: 'learning', totals: { answers: 0, correct: 0, lapses: 0 }, skills: {}, exercises: {}, recent: [] };
    expect(computeStage({ ...p, skills: { recall: { state: 'learning', s: 1, d: 5, due: '', reps: 1, lapses: 0, step: 0 } } })).toBe('learning');
    expect(computeStage({ ...p, skills: { recall: { state: 'review', s: 10, d: 5, due: '', reps: 3, lapses: 0, step: 0 } } })).toBe('review');
    expect(computeStage({ ...p, skills: { recall: { state: 'review', s: 120, d: 5, due: '', reps: 9, lapses: 0, step: 0 } } })).toBe('mastered');
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
    expect(back.skills.recall).toEqual(started.skills.recall);
  });

  it('suspends a card that was never started, and restoring keeps it new', () => {
    const s = suspend(card(), NOW);
    expect(s.introduced).toBeUndefined();
    expect(unsuspend(card(s), NOW).stage).toBe('new');
  });

  it('marks a card introduced after the intro screen', () => {
    const { progress, lines } = applyIntro(card(), NOW, 'mac');
    expect(progress.introduced).toBe('2026-04-10');
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

  it('keeps the freshest state of every skill', () => {
    const a = answer(card(base), 3, { now: later, skills: ['recall'] }).progress;
    const b = answer(card(base), 1, { now: new Date(NOW.getTime() + 60_000), skills: ['listen'] }).progress;
    const m = mergeProgress(a, b)!;
    expect(m.skills.recall).toEqual(a.skills.recall);
    expect(m.skills.listen).toEqual(b.skills.listen);
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

  it('is symmetric for skill states', () => {
    const a = answer(card(base), 3, { now: later }).progress;
    const b = answer(card(base), 1, { now: new Date(later.getTime() + 5000), skills: ['spell'] }).progress;
    expect(mergeProgress(a, b)!.skills).toEqual(mergeProgress(b, a)!.skills);
  });
});
