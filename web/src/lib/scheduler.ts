import { retrievability } from './fsrs';
import { resolveTemplate } from './render';
import type { Card, DeckData, Exercise, Mode, QueueItem, Skill, TemplateManifest, Topic } from './types';

const LEARN_AHEAD_MS = 20 * 60 * 1000;
const SKILL_ORDER: Skill[] = ['recognize', 'listen', 'recall', 'spell', 'context', 'apply'];

export function manifestOf(data: DeckData, card: Card, exercise: Exercise): TemplateManifest | null {
  return resolveTemplate(data, card, exercise)?.manifest ?? null;
}

export function exerciseSkills(data: DeckData, card: Card, exercise: Exercise): Skill[] {
  if (exercise.skill) return Array.isArray(exercise.skill) ? exercise.skill : [exercise.skill];
  return manifestOf(data, card, exercise)?.trains ?? [];
}

function difficulty(data: DeckData, card: Card, exercise: Exercise): number {
  return manifestOf(data, card, exercise)?.difficulty ?? 3;
}

function usable(data: DeckData, card: Card, exercise: Exercise, mode: Mode): boolean {
  if (exercise.status !== 'ready' || exercise.template === 'intro') return false;
  const manifest = manifestOf(data, card, exercise);
  if (!manifest) return false;
  return !manifest.modes || manifest.modes.includes(mode);
}

export function cardSkills(data: DeckData, card: Card): Skill[] {
  const set = new Set<Skill>();
  for (const ex of card.exercises) if (usable(data, card, ex, 'review')) exerciseSkills(data, card, ex).forEach((s) => set.add(s));
  return SKILL_ORDER.filter((s) => set.has(s));
}

export function introExercise(card: Card): Exercise {
  return card.exercises.find((e) => e.template === 'intro' && e.status !== 'off') ?? { id: 'intro', template: 'intro', status: 'ready', params: {} };
}

export const isIntroduced = (card: Card) => Boolean(card.progress?.introduced);
const isSuspended = (card: Card) => card.progress?.stage === 'suspended';

export const LEARN_AHEAD = LEARN_AHEAD_MS;

export function dueSkills(data: DeckData, card: Card, now: Date, aheadMs = 0): Skill[] {
  if (!isIntroduced(card) || isSuspended(card)) return [];
  const limit = now.getTime() + aheadMs;
  return cardSkills(data, card).filter((skill) => {
    const state = card.progress?.skills?.[skill];
    if (!state) return true;
    const ahead = state.state === 'learning' || state.state === 'relearning' ? limit : now.getTime();
    return new Date(state.due).getTime() <= ahead;
  });
}

export function minRetrievability(data: DeckData, card: Card, now: Date): number {
  const values = cardSkills(data, card).map((s) => retrievability(data.deck, s, card.progress?.skills?.[s], now));
  return values.length ? Math.min(...values) : 0;
}

function pickExercise(data: DeckData, card: Card, skill: Skill, mode: Mode, used: Set<string>): Exercise | null {
  const candidates = card.exercises.filter((e) => usable(data, card, e, mode) && !used.has(e.id) && exerciseSkills(data, card, e).includes(skill));
  const stats = card.progress?.exercises ?? {};
  candidates.sort((a, b) => {
    const la = stats[a.id]?.last ?? '', lb = stats[b.id]?.last ?? '';
    if (la !== lb) return la < lb ? -1 : 1;
    const ea = 1 - (stats[a.id]?.correct ?? 0) / Math.max(1, stats[a.id]?.shown ?? 0);
    const eb = 1 - (stats[b.id]?.correct ?? 0) / Math.max(1, stats[b.id]?.shown ?? 0);
    return eb - ea || (mode === 'learn' ? difficulty(data, card, a) - difficulty(data, card, b) : 0);
  });
  return candidates[0] ?? null;
}

function itemsForSkills(data: DeckData, card: Card, skills: Skill[], mode: Mode, limit: number): QueueItem[] {
  const used = new Set<string>();
  const covered = new Set<Skill>();
  const items: QueueItem[] = [];
  for (const skill of skills) {
    if (covered.has(skill) || items.length >= limit) continue;
    const exercise = pickExercise(data, card, skill, mode, used);
    if (!exercise) continue;
    used.add(exercise.id);
    const trained = exerciseSkills(data, card, exercise).filter((s) => skills.includes(s) && !covered.has(s));
    trained.forEach((s) => covered.add(s));
    items.push({ key: `${card.id}:${exercise.id}:${Math.random().toString(36).slice(2, 7)}`, card, exercise, skills: trained, mode });
  }
  const dir = mode === 'learn' ? 1 : -1;
  return items.sort((a, b) => dir * (difficulty(data, card, a.exercise) - difficulty(data, card, b.exercise)));
}

export function reviewItems(data: DeckData, card: Card, now: Date, aheadMs = 0): QueueItem[] {
  const max = data.deck.cycle?.max_exercises_per_card ?? 5;
  const due = dueSkills(data, card, now, aheadMs);
  const extra = cardSkills(data, card)
    .filter((s) => !due.includes(s))
    .map((s) => ({ s, r: retrievability(data.deck, s, card.progress?.skills?.[s], now) }))
    .filter((x) => x.r < 0.95)
    .sort((a, b) => a.r - b.r)
    .slice(0, 2)
    .map((x) => x.s);
  const mode: Mode = due.some((s) => (card.progress?.skills?.[s]?.state ?? 'new') !== 'review') ? 'learn' : 'review';
  return itemsForSkills(data, card, [...due, ...extra], mode, Math.max(2, max));
}

export function learnItems(data: DeckData, card: Card): QueueItem[] {
  const max = data.deck.cycle?.max_exercises_per_card ?? 5;
  const intro: QueueItem = { key: `${card.id}:intro`, card, exercise: introExercise(card), skills: [], mode: 'intro' };
  return [intro, ...itemsForSkills(data, card, cardSkills(data, card), 'learn', max)];
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

function graduated(data: DeckData, card: Card): boolean {
  const states = cardSkills(data, card).map((s) => card.progress?.skills?.[s]);
  return states.length > 0 && states.every((s) => s && s.state === 'review');
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
    const fresh = orderedCards(topic).filter((c) => !isIntroduced(c) && cardSkills(data, c).length > 0);
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
  const due = data.topics.flatMap((t) => t.cards).filter((c) => dueSkills(data, c, now, aheadMs).length > 0);
  const byTopic = new Map<string, Card[]>();
  for (const card of due) byTopic.set(card.topic, [...(byTopic.get(card.topic) ?? []), card]);
  const topics = [...byTopic.entries()].sort((a, b) => Math.min(...a[1].map((c) => minRetrievability(data, c, now))) - Math.min(...b[1].map((c) => minRetrievability(data, c, now))));
  for (const [topicId, cards] of topics) {
    const topic = data.topics.find((t) => t.id === topicId)!;
    cards.sort((a, b) => minRetrievability(data, a, now) - minRetrievability(data, b, now));
    for (let i = 0; i < cards.length; i += cycleSize) {
      const window = cards.slice(i, i + cycleSize);
      queue.push(...spread(window.map((c) => reviewItems(data, c, now, aheadMs)), minGap, false), ...topicExerciseItems(data, topic, window));
    }
  }
  const batch = allowNew ? nextBatch(data, now, due.length) : null;
  if (batch) queue.push(...spread(batch.cards.map((c) => learnItems(data, c)), minGap, true), ...topicExerciseItems(data, batch.topic, batch.cards));
  return { queue, dueCards: due.length, newCards: batch?.cards.length ?? 0, nextDue: nextDueDate(data, now) };
}

export function nextDueDate(data: DeckData, now: Date): Date | null {
  let best: number | null = null;
  for (const card of data.topics.flatMap((t) => t.cards)) {
    if (!isIntroduced(card) || isSuspended(card)) continue;
    for (const skill of cardSkills(data, card)) {
      const state = card.progress?.skills?.[skill];
      const due = state ? new Date(state.due).getTime() : now.getTime();
      if (due > now.getTime() && (best === null || due < best)) best = due;
    }
  }
  return best === null ? null : new Date(best);
}

export function replacementItem(data: DeckData, item: QueueItem): QueueItem | null {
  const skill = item.skills[0];
  if (!skill || item.topicCards) return null;
  const used = new Set([item.exercise.id]);
  const exercise = pickExercise(data, item.card, skill, 'learn', used) ?? item.exercise;
  return { ...item, key: `${item.card.id}:${exercise.id}:${Math.random().toString(36).slice(2, 7)}`, exercise, skills: exerciseSkills(data, item.card, exercise).filter((s) => item.skills.includes(s) || s === skill), mode: 'learn' };
}
