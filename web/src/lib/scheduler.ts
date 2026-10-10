import { get_fuzz_range } from 'ts-fsrs';
import { retrievability } from './fsrs';
import { cardLocked, exerciseLocked } from './lexicon';
import { dayKey, gradedToday, isBuried, ladderOf, maxPerDay, memoryOf, rungOf } from './progress';
import { resolveTemplate } from './render';
import type { Card, DeckData, Exercise, Grade, Mode, QueueItem, Skill, SkillState, TemplateManifest, Topic } from './types';

const LEARN_AHEAD_MS = 20 * 60 * 1000;

export function manifestOf(data: DeckData, card: Card, exercise: Exercise): TemplateManifest | null {
  return resolveTemplate(data, card, exercise)?.manifest ?? null;
}

export function exerciseSkills(data: DeckData, card: Card, exercise: Exercise): Skill[] {
  if (exercise.skill) return Array.isArray(exercise.skill) ? exercise.skill : [exercise.skill];
  return manifestOf(data, card, exercise)?.trains ?? [];
}

/** Ladder rung of an exercise: the lowest rung among its skills (spell counts as recall); null when off the ladder. */
export function exerciseRung(data: DeckData, card: Card, exercise: Exercise): number | null {
  const ladder = ladderOf(data.deck);
  const rungs = exerciseSkills(data, card, exercise)
    .map((s) => ladder.indexOf(s === 'spell' && !ladder.includes('spell') ? 'recall' : s))
    .filter((i) => i >= 0);
  return rungs.length ? Math.min(...rungs) : null;
}

/** The skill an exercise is journaled under: its ladder rung's skill. */
export function exerciseSkill(data: DeckData, card: Card, exercise: Exercise): Skill | undefined {
  const rung = exerciseRung(data, card, exercise);
  return rung === null ? exerciseSkills(data, card, exercise)[0] : ladderOf(data.deck)[rung];
}

function difficulty(data: DeckData, card: Card, exercise: Exercise): number {
  return exercise.difficulty ?? manifestOf(data, card, exercise)?.difficulty ?? 3;
}

function usable(data: DeckData, card: Card, exercise: Exercise, mode: Mode): boolean {
  if (exercise.status !== 'ready' || exercise.template === 'intro') return false;
  const manifest = manifestOf(data, card, exercise);
  if (!manifest || (manifest.modes && !manifest.modes.includes(mode))) return false;
  return !exerciseLocked(data, card, exercise);
}

/** Exercises the schedule can ask, with their rungs. */
function ladderPool(data: DeckData, card: Card, mode: Mode): { exercise: Exercise; rung: number }[] {
  return card.exercises
    .filter((e) => usable(data, card, e, mode))
    .map((exercise) => ({ exercise, rung: exerciseRung(data, card, exercise) }))
    .filter((x): x is { exercise: Exercise; rung: number } => x.rung !== null);
}

/** Ladder skills the card has exercises for, in ladder order. */
export function cardSkills(data: DeckData, card: Card): Skill[] {
  const rungs = new Set(ladderPool(data, card, 'review').map((x) => x.rung));
  return ladderOf(data.deck).filter((_, i) => rungs.has(i));
}

export function introExercise(card: Card): Exercise {
  return card.exercises.find((e) => e.template === 'intro' && e.status !== 'off') ?? { id: 'intro', template: 'intro', status: 'ready', params: {} };
}

export const isIntroduced = (card: Card) => Boolean(card.progress?.introduced);
const isSuspended = (card: Card) => card.progress?.stage === 'suspended';
const atDailyCap = (data: DeckData, card: Card, now: Date) => gradedToday(card.progress, now) >= maxPerDay(data.deck);

export const LEARN_AHEAD = LEARN_AHEAD_MS;

/** A started card is due when its memory is due (learning steps up to `aheadMs` early) and today's cap is not used up. */
export function isDue(data: DeckData, card: Card, now: Date, aheadMs = 0): boolean {
  if (!isIntroduced(card) || isSuspended(card) || isBuried(card, now) || atDailyCap(data, card, now)) return false;
  if (!ladderPool(data, card, 'review').length) return false;
  const memory = memoryOf(card.progress);
  if (!memory) return true;
  const ahead = memory.state === 'learning' || memory.state === 'relearning' ? aheadMs : 0;
  return new Date(memory.due).getTime() <= now.getTime() + ahead;
}

export function cardRetrievability(data: DeckData, card: Card, now: Date): number {
  return retrievability(data.deck, memoryOf(card.progress), now);
}

function pickExercise(data: DeckData, card: Card, target: number, mode: Mode, used: Set<string> = new Set()): { exercise: Exercise; rung: number } | null {
  const pool = ladderPool(data, card, mode).filter((x) => !used.has(x.exercise.id));
  if (!pool.length) return null;
  const top = ladderOf(data.deck).length - 1;
  // At the top rung the formats rotate through the upper half of the ladder.
  let candidates = target >= top ? pool.filter((x) => x.rung >= Math.floor((top + 1) / 2)) : [];
  if (!candidates.length) {
    const nearest = pool.reduce((best, x) => {
      const d = Math.abs(x.rung - target), bd = Math.abs(best - target);
      return d < bd || (d === bd && x.rung < best) ? x.rung : best;
    }, pool[0].rung);
    candidates = pool.filter((x) => x.rung === nearest);
  }
  const stats = card.progress?.exercises ?? {};
  candidates.sort((a, b) => {
    const la = stats[a.exercise.id]?.last ?? '', lb = stats[b.exercise.id]?.last ?? '';
    if (la !== lb) return la < lb ? -1 : 1;
    const ea = 1 - (stats[a.exercise.id]?.correct ?? 0) / Math.max(1, stats[a.exercise.id]?.shown ?? 0);
    const eb = 1 - (stats[b.exercise.id]?.correct ?? 0) / Math.max(1, stats[b.exercise.id]?.shown ?? 0);
    return eb - ea || (mode === 'learn' ? difficulty(data, card, a.exercise) - difficulty(data, card, b.exercise) : 0);
  });
  return candidates[0];
}

function ladderItem(data: DeckData, card: Card, target: number, mode: Mode): QueueItem | null {
  const picked = pickExercise(data, card, target, mode);
  if (!picked) return null;
  const skill = ladderOf(data.deck)[picked.rung];
  return { key: `${card.id}:${picked.exercise.id}:${Math.random().toString(36).slice(2, 7)}`, card, exercise: picked.exercise, skills: [skill], mode };
}

/** One exercise for a due card, from its current rung. */
export function reviewItems(data: DeckData, card: Card, _now?: Date): QueueItem[] {
  const memory = memoryOf(card.progress);
  const mode: Mode = memory?.state === 'review' ? 'review' : 'learn';
  const item = ladderItem(data, card, rungOf(card.progress, ladderOf(data.deck)), mode);
  return item ? [item] : [];
}

/** A new card: its intro, then one check from the first rung. */
export function learnItems(data: DeckData, card: Card): QueueItem[] {
  const intro: QueueItem = { key: `${card.id}:intro`, card, exercise: introExercise(card), skills: [], mode: 'intro' };
  const first = ladderItem(data, card, 0, 'learn');
  return first ? [intro, first] : [intro];
}

/** After a graded answer: the next check of a card still in its learning step, for the end of this session. */
export function followUp(data: DeckData, card: Card, now: Date): QueueItem | null {
  const memory = memoryOf(card.progress);
  if (!memory || memory.state === 'review' || !isDue(data, card, now, LEARN_AHEAD_MS)) return null;
  return reviewItems(data, card)[0] ?? null;
}

/** Topic exercises (one item over several cards) and practice are extra training: they never move a card's schedule. */
export const movesSchedule = (item: QueueItem) => item.mode !== 'practice' && !item.topicCards;

/**
 * The session queue after answering `queue[index]`: Easy drops the card's other items (it is known);
 * a card still in its learning step gets its next check at the end of the session, within the daily cap.
 */
export function queueAfter(data: DeckData, queue: QueueItem[], index: number, grade: Grade, practice: boolean, now: Date): QueueItem[] {
  const current = queue[index];
  const later = queue.slice(index + 1);
  if (grade === 4 && movesSchedule(current)) return [...queue.slice(0, index + 1), ...later.filter((q) => q.card !== current.card || q.topicCards)];
  if (practice || !movesSchedule(current) || later.some((q) => q.card === current.card && !q.topicCards)) return queue;
  const next = followUp(data, current.card, now);
  return next ? [...queue, next] : queue;
}

export function spread(lists: QueueItem[][], minGap: number, staggered: boolean): QueueItem[] {
  const queues = lists.map((l) => [...l]).filter((l) => l.length);
  const last = new Map<number, number>();
  const out: QueueItem[] = [];
  let unlocked = staggered ? 1 : queues.length;
  while (queues.some((q) => q.length)) {
    const pos = out.length;
    const open = (i: number) => i < unlocked && queues[i].length > 0;
    let eligible = queues.map((_, i) => i).filter((i) => open(i) && (last.get(i) ?? -99) < pos - minGap);
    if (!eligible.length && unlocked < queues.length) { unlocked += 1; continue; }
    if (!eligible.length) eligible = queues.map((_, i) => i).filter(open);
    eligible.sort((a, b) => (last.get(a) ?? -99) - (last.get(b) ?? -99));
    const pick = eligible[0];
    out.push(queues[pick].shift()!);
    last.set(pick, pos);
  }
  return out;
}

function topicExerciseItems(data: DeckData, topic: Topic, cards: Card[]): QueueItem[] {
  const ids = new Set(cards.map((c) => c.id));
  return topic.exercises
    .filter((e) => e.status === 'ready' && e.cards && Object.keys(e.cards).filter((id) => ids.has(id)).length >= 3)
    .slice(0, 1)
    .map((e) => {
      const members = topic.cards.filter((c) => Boolean(e.cards![c.id]) && (ids.has(c.id) || isIntroduced(c)));
      return { key: `${topic.id}:${e.id}`, card: members[0], exercise: e, skills: [], mode: 'review' as Mode, topicCards: members };
    })
    .filter((item) => item.card && resolveTemplate(data, item.card, item.exercise));
}

function cardsIntroducedToday(data: DeckData, now: Date): number {
  const today = now.toISOString().slice(0, 10);
  return data.topics.flatMap((t) => t.cards).filter((c) => c.progress?.introduced === today).length;
}

// A started card with nothing left to ask (all its exercises locked) must not hold the gate shut.
function graduated(data: DeckData, card: Card): boolean {
  return memoryOf(card.progress)?.state === 'review' || !ladderPool(data, card, 'review').length;
}

export function topicIsOpen(data: DeckData, topic: Topic): boolean {
  return (topic.requires ?? []).every((id) => {
    const required = data.topics.find((t) => t.id === id);
    if (!required) return true;
    const started = required.cards.filter(isIntroduced);
    return started.length >= Math.min(required.cards.length, required.batch ?? 4) && started.every((c) => graduated(data, c));
  });
}

export function gateOpen(data: DeckData, topic: Topic): boolean {
  return topic.cards.filter(isIntroduced).every((c) => graduated(data, c));
}

export function orderedCards(topic: Topic): Card[] {
  const order = topic.order ?? [];
  return [...topic.cards].sort((a, b) => (order.indexOf(a.id) + 1 || 999) - (order.indexOf(b.id) + 1 || 999));
}

export function nextBatch(data: DeckData, now: Date, dueCount: number): { topic: Topic; cards: Card[] } | null {
  const left = (data.deck.limits?.new_cards_per_day ?? 8) - cardsIntroducedToday(data, now);
  if (left <= 0 || dueCount > (data.deck.limits?.reviews_per_day ?? 250)) return null;
  for (const topic of data.topics) {
    const fresh = orderedCards(topic).filter((c) => !isIntroduced(c) && !isSuspended(c) && !isBuried(c, now) && !cardLocked(data, c) && ladderPool(data, c, 'learn').length > 0);
    if (!fresh.length || !topicIsOpen(data, topic) || !gateOpen(data, topic)) continue;
    return { topic, cards: fresh.slice(0, Math.min(topic.batch ?? 4, left)) };
  }
  return null;
}

export interface SessionPlan {
  queue: QueueItem[];
  dueCards: number;
  newCards: number;
  nextDue: Date | null;
}

export function buildSession(data: DeckData, now: Date, allowNew = true, aheadMs = 0): SessionPlan {
  const cycleSize = data.deck.cycle?.cards ?? 4;
  const minGap = data.deck.cycle?.min_gap ?? 2;
  const queue: QueueItem[] = [];
  const due = limitReviews(data, data.topics.flatMap((t) => t.cards).filter((c) => isDue(data, c, now, aheadMs)), now);
  const byTopic = new Map<string, Card[]>();
  for (const card of due) byTopic.set(card.topic, [...(byTopic.get(card.topic) ?? []), card]);
  const topics = [...byTopic.entries()].sort((a, b) => Math.min(...a[1].map((c) => cardRetrievability(data, c, now))) - Math.min(...b[1].map((c) => cardRetrievability(data, c, now))));
  for (const [topicId, cards] of topics) {
    const topic = data.topics.find((t) => t.id === topicId)!;
    cards.sort((a, b) => cardRetrievability(data, a, now) - cardRetrievability(data, b, now));
    for (let i = 0; i < cards.length; i += cycleSize) {
      const window = cards.slice(i, i + cycleSize);
      queue.push(...spread(window.map((c) => reviewItems(data, c)), minGap, false), ...topicExerciseItems(data, topic, window));
    }
  }
  const batch = allowNew ? nextBatch(data, now, due.length) : null;
  if (batch) queue.push(...spread(batch.cards.map((c) => learnItems(data, c)), minGap, true), ...topicExerciseItems(data, batch.topic, batch.cards));
  return { queue, dueCards: due.length, newCards: batch?.cards.length ?? 0, nextDue: nextDueDate(data, now) };
}

function isLearningCard(data: DeckData, card: Card, now: Date): boolean {
  if (card.progress?.introduced === dayKey(now)) return true;
  return isDue(data, card, now, LEARN_AHEAD_MS) && memoryOf(card.progress)?.state !== 'review';
}

export function reviewsDoneToday(data: DeckData, now: Date): number {
  const today = dayKey(now);
  return data.topics.flatMap((t) => t.cards).filter((c) =>
    c.progress?.introduced && c.progress.introduced < today && Object.values(c.progress.exercises ?? {}).some((e) => e.last?.slice(0, 10) === today)).length;
}

// Anki's daily review limit: learning cards always come; mature reviews are capped, most-forgotten first.
export function limitReviews(data: DeckData, due: Card[], now: Date): Card[] {
  const limit = data.deck.limits?.reviews_per_day ?? 250;
  const left = Math.max(0, limit - reviewsDoneToday(data, now));
  const learning = due.filter((c) => isLearningCard(data, c, now));
  const reviews = due.filter((c) => !isLearningCard(data, c, now)).sort((a, b) => cardRetrievability(data, a, now) - cardRetrievability(data, b, now));
  return [...learning, ...reviews.slice(0, left)];
}

function dueLoad(data: DeckData, except: Card): Map<string, number> {
  const load = new Map<string, number>();
  for (const card of data.topics.flatMap((t) => t.cards)) {
    if (card === except || !isIntroduced(card) || isSuspended(card)) continue;
    const due = memoryOf(card.progress)?.due;
    if (due) load.set(due.slice(0, 10), (load.get(due.slice(0, 10)) ?? 0) + 1);
  }
  return load;
}

// Anki 24.11 load balancer: inside the fuzz range pick the day with the fewest reviews; Easy Days count as busier.
export function balanceDue(data: DeckData, card: Card, state: SkillState): SkillState {
  if (data.deck.fsrs?.load_balance === false || state.state !== 'review' || !state.last) return state;
  const last = new Date(state.last);
  const interval = Math.round((new Date(state.due).getTime() - last.getTime()) / 86_400_000);
  if (interval < 3) return state;
  const maximum = parseFloat(data.deck.fsrs?.max_interval ?? '365') || 365;
  const { min_ivl, max_ivl } = get_fuzz_range(interval, 0, maximum);
  const load = dueLoad(data, card);
  const easy = new Set(data.deck.fsrs?.easy_days ?? []);
  let best = interval;
  let bestScore = Infinity;
  for (let ivl = min_ivl; ivl <= max_ivl; ivl++) {
    const day = new Date(last.getTime() + ivl * 86_400_000);
    const score = (load.get(dayKey(day)) ?? 0) * (easy.has(day.getUTCDay()) ? 2 : 1) + Math.abs(ivl - interval) * 0.01;
    if (score < bestScore) { bestScore = score; best = ivl; }
  }
  return { ...state, due: new Date(last.getTime() + best * 86_400_000).toISOString() };
}

/** Extra practice on chosen cards (a search, a tag, the hard ones); answers do not move the schedule. */
export function practiceSession(data: DeckData, chosen: Card[], _now: Date): QueueItem[] {
  const cards = chosen.filter((c) => isIntroduced(c) && !isSuspended(c));
  const lists = cards.map((card) => {
    const pool = card.exercises.filter((e) => usable(data, card, e, 'practice'));
    const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, 2);
    return picked.map((exercise) => ({ key: `${card.id}:${exercise.id}:p${Math.random().toString(36).slice(2, 6)}`, card, exercise, skills: [exerciseSkill(data, card, exercise)].filter((x): x is Skill => Boolean(x)), mode: 'practice' as Mode }));
  });
  return spread(lists, data.deck.cycle?.min_gap ?? 2, false).slice(0, 30);
}

/**
 * A correct answer counts only as practice when the same cycle already showed what this exercise asks for.
 * Applies to reviews of mature skills only: while a word is being learned, answers drive the learning steps.
 */
export function isPrimed(asks: string[], seen: Map<string, number> | undefined, position: number, mode: Mode, window = 14): boolean {
  if (mode !== 'review' || !asks.length || !seen) return false;
  return asks.every((form) => seen.has(form) && position - seen.get(form)! <= window);
}

export function nextDueDate(data: DeckData, now: Date): Date | null {
  let best: number | null = null;
  for (const card of data.topics.flatMap((t) => t.cards)) {
    if (!isIntroduced(card) || isSuspended(card) || atDailyCap(data, card, now)) continue;
    const memory = memoryOf(card.progress);
    const due = memory ? new Date(memory.due).getTime() : now.getTime();
    if (due > now.getTime() && (best === null || due < best)) best = due;
  }
  return best === null ? null : new Date(best);
}
