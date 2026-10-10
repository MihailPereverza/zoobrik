import { describe, expect, it } from 'vitest';
import { default_w, forgetting_curve, fsrs, generatorParameters, type FSRSState } from 'ts-fsrs';
import { evaluate, histories, optimize, parseJournal, trainSet } from './optimizer';

const DAY = 86_400_000;
const T0 = Date.parse('2026-01-05T08:00:00Z');

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const line = (time: number, card: string, grade: string, flags = '', skill = 'recall') =>
  [new Date(time).toISOString(), card, 'e1', skill, grade, 3000, 'test', flags].join('\t');

/** A learner whose memory follows FSRS with `truth`; reviews come at random gaps so the data covers many intervals. */
function simulate(truth: number[], cards: number, seed: number): string[] {
  const random = rng(seed);
  const f = fsrs(generatorParameters({ w: truth, enable_short_term: true }));
  const lines: string[] = [];
  for (let c = 0; c < cards; c++) {
    let time = T0 + Math.floor(random() * 30) * DAY;
    let state: FSRSState | null = null;
    const first = random() < 0.25 ? 1 : random() < 0.85 ? 3 : 4;
    lines.push(line(time, `t/c${c}`, String(first)));
    state = f.next_state(null, 0, first);
    for (let r = 0; r < 7; r++) {
      const gap = 1 + Math.floor(random() * Math.min(60, 2 + state.stability * 2));
      time += gap * DAY;
      const p = forgetting_curve(truth, gap, state.stability);
      const recalled = random() < p;
      const grade = recalled ? (random() < 0.12 ? 2 : random() < 0.1 ? 4 : 3) : 1;
      lines.push(line(time, `t/c${c}`, String(grade)));
      state = f.next_state(state, gap, grade);
    }
  }
  return lines.sort();
}

describe('journal parsing', () => {
  it('ignores intro views, practice answers and malformed lines', () => {
    const lines = [line(T0, 't/a', '3'), line(T0 + DAY, 't/a', 'p3'), line(T0, 't/a', 'seen'), 'garbage', line(T0 + 2 * DAY, 't/a', '1')];
    const h = histories(parseJournal(lines));
    expect(h.get('t/a')?.map((r) => r.rating)).toEqual([3, 1]);
  });

  it('drops answers that were undone', () => {
    const answered = T0 + DAY;
    const lines = [line(T0, 't/a', '3'), line(answered, 't/a', '1'), line(answered + 5000, 't/a', 'undo', `ref=${new Date(answered).toISOString()}`), line(answered + 9000, 't/a', '3')];
    expect(histories(parseJournal(lines)).get('t/a')?.map((r) => r.rating)).toEqual([3, 3]);
  });

  it('keeps one history per card, one review per answer, sorted by time', () => {
    const lines = [line(T0 + DAY, 't/a', '3', '', 'listen'), line(T0, 't/a', '1', '', 'listen'), line(T0, 't/a', '1', '', 'spell'), line(T0 + 2 * DAY, 't/a', '3', '', 'recall')];
    const h = histories(parseJournal(lines));
    expect([...h.keys()]).toEqual(['t/a']);
    expect(h.get('t/a')?.map((r) => r.rating)).toEqual([1, 3, 3]);
  });
});

describe('training set', () => {
  it('builds one item per prefix that reaches a later day', () => {
    const h = histories(parseJournal([line(T0, 't/a', '3'), line(T0 + 60_000, 't/a', '3'), line(T0 + 2 * DAY, 't/a', '3'), line(T0 + 9 * DAY, 't/a', '1')]));
    const { items } = trainSet(h);
    expect(items).toHaveLength(2);
    expect(items[0].reviews.map((r) => r.deltaT)).toEqual([0, 0, 2]);
    expect(items[1].reviews.map((r) => r.deltaT)).toEqual([0, 0, 2, 7]);
  });

  it('skips histories that never left the first day', () => {
    const h = histories(parseJournal([line(T0, 't/a', '1'), line(T0 + 60_000, 't/a', '3')]));
    expect(trainSet(h).items).toHaveLength(0);
  });

  it('orders items by the time of their last review and aligns card ids', () => {
    const lines = simulate([...default_w], 30, 7);
    const { items, cardIds } = trainSet(histories(parseJournal(lines)));
    expect(cardIds).toHaveLength(items.length);
    expect(items.every((it) => it.reviews.some((r) => r.deltaT > 0))).toBe(true);
  });
});

describe('evaluate', () => {
  it('scores the true parameters better than wildly wrong ones', () => {
    const truth = [...default_w];
    const h = histories(parseJournal(simulate(truth, 200, 3)));
    const wrong = [...default_w];
    for (const i of [0, 1, 2, 3]) wrong[i] = default_w[i] * 25;
    expect(evaluate(truth, h).logLoss).toBeLessThan(evaluate(wrong, h).logLoss);
  });

  it('reports zero metrics for an empty history', () => {
    expect(evaluate(default_w, new Map())).toEqual({ logLoss: 0, rmse: 0, n: 0 });
  });
});

describe('optimize', () => {
  it('declines to train on too little history and keeps current parameters', () => {
    const res = optimize([line(T0, 't/a', '3'), line(T0 + DAY, 't/a', '3')]);
    expect(res.adopted).toBe(false);
    expect(res.params).toEqual([...default_w]);
    expect(res.reason).toBeTruthy();
  });

  it('learns a learner whose memory differs from the defaults', () => {
    const truth = [...default_w];
    for (const i of [0, 1, 2, 3]) truth[i] = default_w[i] * 3;
    const lines = simulate(truth, 500, 11);
    const res = optimize(lines);
    expect(res.items).toBeGreaterThan(1000);
    expect(res.adopted).toBe(true);
    expect(res.after.logLoss).toBeLessThan(res.before.logLoss);
    expect(res.after.rmse).toBeLessThan(res.before.rmse);
    expect(res.params).toHaveLength(21);
    const hist = histories(parseJournal(lines));
    expect(res.after.logLoss).toBeLessThan(evaluate(truth, hist).logLoss * 1.03);
    expect(Math.abs(res.params[2] - truth[2])).toBeLessThan(Math.abs(default_w[2] - truth[2]));
  }, 60_000);

  it('produces parameters the scheduler accepts', () => {
    const res = optimize(simulate([...default_w], 300, 5));
    const f = fsrs(generatorParameters({ w: res.params }));
    expect(() => f.next_state(null, 0, 3)).not.toThrow();
    expect(res.params.every((p) => Number.isFinite(p))).toBe(true);
  }, 60_000);

  it('is deterministic for the same journal', () => {
    const lines = simulate([...default_w], 120, 9);
    expect(optimize(lines).params).toEqual(optimize(lines).params);
  }, 60_000);
});
