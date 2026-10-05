import { describe, expect, it } from 'vitest';
import { default_w } from 'ts-fsrs';
import { formatInterval, preview, retrievability, review } from './fsrs';
import type { DeckConfig, Grade, Skill, SkillState } from './types';

const MIN = 60_000;
const DAY = 86_400_000;
const T0 = new Date('2026-03-01T09:00:00Z');

function deckWith(over: Partial<DeckConfig['fsrs']> = {}): DeckConfig {
  return {
    name: 'test',
    limits: { new_cards_per_day: 8, reviews_per_day: 250 },
    fsrs: { retention: { recognize: 0.9, recall: 0.9, spell: 0.85, context: 0.9, listen: 0.9, apply: 0.9 }, learning_steps: ['1m', '10m'], relearning_steps: ['10m'], max_interval: '365d', ...over },
  };
}

const deck = deckWith();
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
const dueIn = (state: SkillState, now: Date) => new Date(state.due).getTime() - now.getTime();
const days = (ms: number) => ms / DAY;

/** Answer with the given grade each time the card becomes due, returning every state. */
function walk(grades: Grade[], skill: Skill = 'recall', cfg = deck, start = T0): { state: SkillState; now: Date }[] {
  const out: { state: SkillState; now: Date }[] = [];
  let state: SkillState | undefined;
  let now = start;
  for (const g of grades) {
    state = review(cfg, skill, state, g, now);
    out.push({ state, now });
    now = new Date(state.due);
  }
  return out;
}

/** A card that graduated and went through a few successful reviews. */
function matureState(): { state: SkillState; now: Date } {
  const steps = walk([3, 3, 3, 3]);
  const last = steps[steps.length - 1];
  return { state: last.state, now: new Date(last.state.due) };
}

describe('learning steps (Anki-style 1m → 10m → graduate)', () => {
  it('Again on a new card schedules the first step: 1 minute', () => {
    const s = review(deck, 'recall', undefined, 1, T0);
    expect(s.state).toBe('learning');
    expect(dueIn(s, T0)).toBe(1 * MIN);
    expect(s.reps).toBe(1);
  });

  it('Good on a new card moves to the second step: 10 minutes', () => {
    const s = review(deck, 'recall', undefined, 3, T0);
    expect(s.state).toBe('learning');
    expect(dueIn(s, T0)).toBe(10 * MIN);
  });

  it('Hard on a new card stays in the first step, between Again and Good', () => {
    const s = review(deck, 'recall', undefined, 2, T0);
    expect(s.state).toBe('learning');
    expect(dueIn(s, T0)).toBeGreaterThan(1 * MIN);
    expect(dueIn(s, T0)).toBeLessThan(10 * MIN);
  });

  it('Easy on a new card graduates straight to review with a multi-day interval', () => {
    const s = review(deck, 'recall', undefined, 4, T0);
    expect(s.state).toBe('review');
    expect(days(dueIn(s, T0))).toBeGreaterThanOrEqual(1);
  });

  it('Good at the last learning step graduates the card to review', () => {
    const [, second] = walk([3, 3]);
    expect(second.state.state).toBe('review');
    expect(days(dueIn(second.state, second.now))).toBeGreaterThanOrEqual(1);
  });

  it('Again during learning returns to the first step', () => {
    const first = review(deck, 'recall', undefined, 3, T0);
    const again = review(deck, 'recall', first, 1, at(T0, 10 * MIN));
    expect(again.state).toBe('learning');
    expect(dueIn(again, at(T0, 10 * MIN))).toBe(1 * MIN);
  });

  it('honours custom learning steps from deck.yaml', () => {
    const cfg = deckWith({ learning_steps: ['5m', '30m', '2h'] });
    const [a, b, c] = walk([3, 3, 3], 'recall', cfg);
    expect(dueIn(a.state, a.now)).toBe(30 * MIN);
    expect(dueIn(b.state, b.now)).toBe(120 * MIN);
    expect(c.state.state).toBe('review');
  });
});

describe('review and relearning', () => {
  it('orders the next interval Again < Hard < Good < Easy', () => {
    const { state, now } = matureState();
    const due = preview(deck, 'recall', state, now);
    expect(due[1].getTime()).toBeLessThan(due[2].getTime());
    expect(due[2].getTime()).toBeLessThan(due[3].getTime());
    expect(due[3].getTime()).toBeLessThan(due[4].getTime());
  });

  it('preview matches what review() actually schedules', () => {
    const { state, now } = matureState();
    const due = preview(deck, 'recall', state, now);
    for (const g of [1, 2, 3, 4] as Grade[]) expect(review(deck, 'recall', state, g, now).due).toBe(due[g].toISOString());
  });

  it('a lapse moves the card to relearning, counts the lapse and cuts stability', () => {
    const { state, now } = matureState();
    const lapsed = review(deck, 'recall', state, 1, now);
    expect(lapsed.state).toBe('relearning');
    expect(lapsed.lapses).toBe(state.lapses + 1);
    expect(lapsed.s).toBeLessThan(state.s);
    expect(dueIn(lapsed, now)).toBe(10 * MIN);
  });

  it('passing the relearning step returns the card to review', () => {
    const { state, now } = matureState();
    const lapsed = review(deck, 'recall', state, 1, now);
    const back = review(deck, 'recall', lapsed, 3, new Date(lapsed.due));
    expect(back.state).toBe('review');
  });

  it('consecutive Good reviews grow the interval every time', () => {
    const steps = walk([3, 3, 3, 3, 3, 3, 3, 3]).filter((x) => x.state.state === 'review');
    const intervals = steps.map((x) => dueIn(x.state, x.now));
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
  });

  it('Hard grows stability less than Good, Easy more', () => {
    const { state, now } = matureState();
    const [hard, good, easy] = ([2, 3, 4] as Grade[]).map((g) => review(deck, 'recall', state, g, now).s);
    expect(hard).toBeLessThan(good);
    expect(good).toBeLessThan(easy);
  });

  it('Again raises difficulty and Easy lowers it', () => {
    const { state, now } = matureState();
    expect(review(deck, 'recall', state, 1, now).d).toBeGreaterThan(state.d);
    expect(review(deck, 'recall', state, 4, now).d).toBeLessThan(state.d);
  });

  it('survives twenty lapses in a row without an invalid state (leech words)', () => {
    const { state, now } = matureState();
    let s = state;
    let t = now;
    for (let i = 0; i < 20; i++) {
      s = review(deck, 'recall', s, 1, t);
      t = new Date(s.due);
      expect(s.s).toBeGreaterThan(0);
    }
    expect(s.lapses).toBeGreaterThanOrEqual(state.lapses + 1);
  });

  it('difficulty stays within 1..10 under extreme histories', () => {
    for (const grades of [Array(20).fill(1), Array(20).fill(4)] as Grade[][]) {
      for (const { state } of walk(grades)) {
        expect(state.d).toBeGreaterThanOrEqual(1);
        expect(state.d).toBeLessThanOrEqual(10);
      }
    }
  });

  it('never schedules beyond the maximum interval (fuzz included)', () => {
    const cfg = deckWith({ max_interval: '60d' });
    for (const { state, now } of walk(Array(15).fill(4) as Grade[], 'recall', cfg)) expect(days(dueIn(state, now))).toBeLessThanOrEqual(60);
  });
});

describe('memory model', () => {
  it('a skill never reviewed has zero retrievability', () => {
    expect(retrievability(deck, 'recall', undefined, T0)).toBe(0);
  });

  it('retrievability is ~1 right after a review and decays monotonically', () => {
    const { state } = matureState();
    const last = new Date(state.last!);
    let prev = retrievability(deck, 'recall', state, last);
    expect(prev).toBeGreaterThan(0.99);
    for (const d of [1, 3, 7, 30, 90]) {
      const r = retrievability(deck, 'recall', state, at(last, d * DAY));
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });

  it('stability is the time at which recall probability falls to 90%', () => {
    const { state } = matureState();
    const r = retrievability(deck, 'recall', state, at(new Date(state.last!), state.s * DAY));
    expect(r).toBeCloseTo(0.9, 2);
  });

  it('a higher desired retention gives shorter intervals', () => {
    const { state, now } = matureState();
    const strict = deckWith({ retention: { recall: 0.95 } });
    const relaxed = deckWith({ retention: { recall: 0.8 } });
    expect(dueIn(review(strict, 'recall', state, 3, now), now)).toBeLessThan(dueIn(review(relaxed, 'recall', state, 3, now), now));
  });

  it('per-skill retention from deck.yaml is applied: spell (0.85) waits longer than recall (0.9)', () => {
    const { state, now } = matureState();
    expect(dueIn(review(deck, 'spell', state, 3, now), now)).toBeGreaterThan(dueIn(review(deck, 'recall', state, 3, now), now));
  });

  it('an overdue success raises stability more than an on-time one (spacing effect)', () => {
    const { state, now } = matureState();
    const onTime = review(deck, 'recall', state, 3, now);
    const late = review(deck, 'recall', state, 3, at(now, 3 * state.s * DAY));
    expect(late.s).toBeGreaterThan(onTime.s);
  });

  it('an early review adds little stability', () => {
    const { state, now } = matureState();
    const early = review(deck, 'recall', state, 3, at(new Date(state.last!), 2 * 60 * MIN));
    const onTime = review(deck, 'recall', state, 3, now);
    expect(early.s - state.s).toBeLessThan(onTime.s - state.s);
  });

  it('custom parameters from the optimizer change the schedule', () => {
    const tuned = [...default_w];
    tuned[3] = default_w[3] * 3;
    const cfg = deckWith({ params: tuned });
    const base = review(deck, 'recall', undefined, 4, T0);
    const fast = review(cfg, 'recall', undefined, 4, T0);
    expect(fast.s).toBeGreaterThan(base.s * 2);
    expect(dueIn(fast, T0)).toBeGreaterThan(dueIn(base, T0));
  });
});

describe('determinism and storage', () => {
  it('replaying the same history yields identical states (needed for sync merges)', () => {
    const grades: Grade[] = [3, 3, 1, 3, 2, 3, 4, 3];
    expect(walk(grades)).toEqual(walk(grades));
  });

  it('a state survives a JSON round-trip through card.yaml', () => {
    const { state, now } = matureState();
    const stored: SkillState = JSON.parse(JSON.stringify(state));
    expect(review(deck, 'recall', stored, 3, now)).toEqual(review(deck, 'recall', state, 3, now));
  });

  it('keeps reps and lapses counters consistent with the history', () => {
    const steps = walk([3, 3, 3, 1, 3, 3]);
    const last = steps[steps.length - 1].state;
    expect(last.reps).toBe(6);
    expect(last.lapses).toBe(1);
  });
});

describe('formatInterval', () => {
  it.each([
    [30 * 1000, '1 мин'],
    [10 * MIN, '10 мин'],
    [3 * 60 * MIN, '3 ч'],
    [5 * DAY, '5 дн'],
    [60 * DAY, '2 мес'],
    [400 * DAY, '1.1 г'],
  ])('%i ms → %s', (ms, text) => {
    expect(formatInterval(T0, at(T0, ms))).toBe(text);
  });
});
