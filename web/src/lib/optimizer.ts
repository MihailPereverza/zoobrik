import { default_w, forgetting_curve, fsrs, generatorParameters, type FSRSState } from 'ts-fsrs';
import { computeParameters, type FsrsItem, type FsrsRating } from 'ts-fsrs-optimizer';

const DAY = 86_400_000;

export interface JournalEntry { time: number; card: string; exercise: string; skill: string; grade: string; device: string; flags: string }
export interface Review { time: number; rating: FsrsRating }
export interface Metrics { logLoss: number; rmse: number; n: number }
export interface OptimizeResult {
  params: number[];
  before: Metrics;
  after: Metrics;
  reviews: number;
  histories: number;
  items: number;
  adopted: boolean;
  reason?: string;
}

/** Parses journal TSV lines: time, topic/card, exercise, skill, grade (1-4 | pN | seen | undo), ms, device, flags. */
export function parseJournal(lines: string[]): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const line of lines) {
    const f = line.split('\t');
    const time = Date.parse(f[0]);
    if (f.length < 5 || Number.isNaN(time)) continue;
    out.push({ time, card: f[1], exercise: f[2], skill: f[3], grade: f[4], device: f[6] ?? '', flags: f[7] ?? '' });
  }
  return out;
}

/** Review histories per card×skill: graded answers only, without practice, intro views and undone answers. */
export function histories(entries: JournalEntry[]): Map<string, Review[]> {
  const undone = new Set(entries.filter((e) => e.grade === 'undo').map((e) => `${e.card}|${e.skill}|${Date.parse(e.flags.replace(/^ref=/, ''))}`));
  const map = new Map<string, Review[]>();
  for (const e of entries) {
    if (!/^[1-4]$/.test(e.grade) || undone.has(`${e.card}|${e.skill}|${e.time}`)) continue;
    const key = `${e.card}|${e.skill}`;
    const list = map.get(key) ?? [];
    list.push({ time: e.time, rating: Number(e.grade) as FsrsRating });
    map.set(key, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.time - b.time);
  return map;
}

const dayIndex = (time: number) => Math.floor(time / DAY);

/** fsrs-rs training items: every prefix of a history that reaches a later day, ordered by the time of its last review. */
export function trainSet(hist: Map<string, Review[]>): { items: FsrsItem[]; cardIds: number[] } {
  const rows: { time: number; id: number; item: FsrsItem }[] = [];
  let id = 0;
  for (const reviews of hist.values()) {
    id += 1;
    const seq = reviews.map((r, i) => ({ rating: r.rating, deltaT: i === 0 ? 0 : dayIndex(r.time) - dayIndex(reviews[i - 1].time) }));
    const firstLong = seq.findIndex((r) => r.deltaT > 0);
    if (firstLong < 0) continue;
    for (let len = firstLong + 1; len <= seq.length; len++) rows.push({ time: reviews[len - 1].time, id, item: { reviews: seq.slice(0, len) } });
  }
  rows.sort((a, b) => a.time - b.time);
  return { items: rows.map((r) => r.item), cardIds: rows.map((r) => r.id) };
}

/** Log-loss and binned RMSE of predicted recall against actual answers, the metrics Anki reports for FSRS. */
export function evaluate(params: readonly number[], hist: Map<string, Review[]>): Metrics {
  const f = fsrs(generatorParameters({ w: [...params], enable_short_term: true }));
  const bins = new Map<number, { p: number; y: number; n: number }>();
  let loss = 0;
  let n = 0;
  for (const reviews of hist.values()) {
    let state: FSRSState | null = null;
    for (let i = 0; i < reviews.length; i++) {
      const elapsed = i === 0 ? 0 : dayIndex(reviews[i].time) - dayIndex(reviews[i - 1].time);
      if (state && elapsed > 0) {
        const p = Math.min(1 - 1e-6, Math.max(1e-6, forgetting_curve(params, elapsed, state.stability)));
        const y = reviews[i].rating > 1 ? 1 : 0;
        loss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
        n += 1;
        const b = Math.round(p * 20);
        const bin = bins.get(b) ?? { p: 0, y: 0, n: 0 };
        bin.p += p; bin.y += y; bin.n += 1;
        bins.set(b, bin);
      }
      state = f.next_state(state, elapsed, reviews[i].rating);
    }
  }
  let sq = 0;
  for (const bin of bins.values()) sq += bin.n * (bin.p / bin.n - bin.y / bin.n) ** 2;
  return { logLoss: n ? loss / n : 0, rmse: n ? Math.sqrt(sq / n) : 0, n };
}

export function optimize(lines: string[], current?: readonly number[] | null): OptimizeResult {
  const baseline = current?.length ? [...current] : [...default_w];
  const hist = histories(parseJournal(lines));
  const { items, cardIds } = trainSet(hist);
  const reviews = [...hist.values()].reduce((s, h) => s + h.length, 0);
  const before = evaluate(baseline, hist);
  const summary = { reviews, histories: hist.size, items: items.length };
  if (items.length < 8) return { ...summary, params: baseline, before, after: before, adopted: false, reason: 'Пока мало истории: нужны повторения хотя бы через день после первого ответа.' };
  const params = computeParameters({ trainSet: items, cardIds, enableShortTerm: true, numRelearningSteps: 1 });
  const after = evaluate(params, hist);
  const adopted = after.logLoss < before.logLoss;
  return { ...summary, params: adopted ? params : baseline, before, after, adopted, reason: adopted ? undefined : 'Новые параметры предсказывают ответы не лучше текущих — оставляю текущие.' };
}
