import { review } from './fsrs';
import type { Card, DeckConfig, Exercise, Grade, Progress, Skill, SkillState, Stage } from './types';

export const MASTERED_DAYS = 90;
const RUNG_STEP: Record<Grade, number> = { 1: -1, 2: 0, 3: 1, 4: 2 };
export const DEFAULT_LADDER: Skill[] = ['recognize', 'recall', 'context', 'listen', 'apply'];

export const ladderOf = (deck: DeckConfig): Skill[] => (deck.ladder?.length ? deck.ladder : DEFAULT_LADDER);

/** The card's memory; progress from the six-skill model counts as its weakest (lowest stability) skill. */
export function memoryOf(progress: Progress | undefined): SkillState | undefined {
  if (!progress) return undefined;
  if (progress.memory) return progress.memory;
  const states = Object.values(progress.skills ?? {}).filter(Boolean) as SkillState[];
  // New skills all start at the same stability: on a tie the earlier due wins, so a pending learning step is not lost.
  return states.length ? states.reduce((a, b) => (b.s < a.s || (b.s === a.s && Date.parse(b.due) < Date.parse(a.due)) ? b : a)) : undefined;
}

/** Ladder position; old progress climbs one rung per ladder skill that already reached review. */
export function rungOf(progress: Progress | undefined, ladder: Skill[]): number {
  if (!progress) return 0;
  const rung = progress.rung ?? ladder.filter((s) => progress.skills?.[s]?.state === 'review').length;
  return Math.max(0, Math.min(ladder.length - 1, rung));
}

/** Graded (non-practice) answers given to the card on the learning day of `now`. */
export function gradedToday(progress: Progress | undefined, now: Date): number {
  const today = dayKey(now);
  return (progress?.recent ?? []).filter((line) => {
    const [time, , , grade] = line.split(' ');
    return time?.slice(0, 10) === today && /^[1-4]$/.test(grade ?? '');
  }).length;
}

export const maxPerDay = (deck: DeckConfig) => deck.cycle?.max_per_day ?? 3;
/** A word still climbing the ladder may come back often, but not forever in one day. */
export const MAX_LEARNING_PER_DAY = 15;

const DEFAULT_LADDER_STEPS = ['5m', '10m', '30m', '1h'];
const AGAIN_STEP = '5m';
const minutesOf = (step: string) => parseFloat(step) * (step.endsWith('d') ? 1440 : step.endsWith('h') ? 60 : 1);

/**
 * A card is learned once it has passed every format of the ladder. Cards that reached the top rung under the earlier
 * scheduler count as learned; those that went to long intervals halfway up come back to finish the ladder.
 */
export function isLearned(progress: Progress | undefined, ladder: Skill[]): boolean {
  if (!progress) return false;
  if (progress.learned) return true;
  return memoryOf(progress)?.state === 'review' && rungOf(progress, ladder) >= ladder.length - 1;
}

/** Wait before the next format of a word still on the ladder: short steps that grow with the rung. */
export function ladderStepMs(deck: DeckConfig, rung: number, grade: Grade): number {
  const steps = deck.fsrs?.ladder_steps?.length ? deck.fsrs.ladder_steps : DEFAULT_LADDER_STEPS;
  const step = grade === 1 ? AGAIN_STEP : steps[Math.max(0, Math.min(steps.length - 1, rung - 1))];
  return minutesOf(step) * 60_000;
}

export interface NextState { memory: SkillState; rung: number; learned?: string }

/**
 * What one graded answer does. On the ladder: Good climbs a rung, Easy two, Hard stays, Again steps down, and the card
 * comes back after a short step. Passing the top rung hands the card to FSRS with its long intervals.
 */
export function nextState(deck: DeckConfig, progress: Progress | undefined, exerciseRung: number | undefined, grade: Grade, now: Date): NextState {
  const ladder = ladderOf(deck);
  const top = ladder.length - 1;
  const before = memoryOf(progress);
  const rung = rungOf(progress, ladder);
  const from = grade > 2 ? Math.max(rung, exerciseRung ?? rung) : rung;
  const target = from + RUNG_STEP[grade];
  const fsrs = review(deck, before, grade, now);
  if (isLearned(progress, ladder)) return { memory: fsrs, rung: Math.max(0, Math.min(top, target)), learned: progress?.learned };
  if (target > top) {
    const day = now.getTime() + 86_400_000;
    const memory = fsrs.state === 'review' && Date.parse(fsrs.due) >= day ? fsrs : { ...fsrs, state: 'review' as const, s: Math.max(fsrs.s, 1), due: new Date(day).toISOString(), step: 0 };
    return { memory, rung: top, learned: dayKey(now) };
  }
  const next = Math.max(0, target);
  const state = before?.state === 'review' || before?.state === 'relearning' ? 'relearning' as const : 'learning' as const;
  return { memory: { ...fsrs, state, due: new Date(now.getTime() + ladderStepMs(deck, next, grade)).toISOString() }, rung: next };
}

// One learning day is a UTC date: for Europe/Asia time zones it rolls over at night, close to Anki's 4 am.
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function nextDayKey(now: Date): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + 1);
  return dayKey(d);
}

export function emptyProgress(now: Date): Progress {
  return {
    stage: 'learning', introduced: now.toISOString().slice(0, 10),
    totals: { answers: 0, correct: 0, lapses: 0 }, skills: {}, exercises: {}, recent: [],
  };
}

export function computeStage(progress: Progress): Stage {
  if (progress.stage === 'suspended') return 'suspended';
  const memory = memoryOf(progress);
  if (!memory || memory.state !== 'review') return 'learning';
  return memory.s >= MASTERED_DAYS ? 'mastered' : 'review';
}

function clone(progress: Progress | undefined, now: Date): Progress {
  const base: Progress = progress ? JSON.parse(JSON.stringify(progress)) : emptyProgress(now);
  base.totals ??= { answers: 0, correct: 0, lapses: 0 };
  base.skills ??= {};
  base.exercises ??= {};
  base.recent ??= [];
  return base;
}

export interface AnswerEffect {
  progress: Progress;
  lines: string[];
  becameLeech?: boolean;
}

interface ApplyInput {
  deck: DeckConfig;
  card: Card;
  exercise: Exercise;
  /** Ladder skill of the exercise, written to the journal. */
  skill: string;
  /** Ladder rung of the exercise; a correct answer climbs from here when it is above the card's rung. */
  rung?: number;
  grade: Grade;
  practice: boolean;
  ms: number;
  now: Date;
  device: string;
  flags?: string;
}

function journalLine(input: ApplyInput, skill: string, gradeText: string): string {
  const time = input.now.toISOString().replace(/\.\d+Z$/, 'Z');
  return [time, `${input.card.topic}/${input.card.id}`, input.exercise.id, skill, gradeText, input.ms, input.device, input.flags ?? ''].join('\t').trimEnd();
}

/** When each grade would bring the card back, for the grade buttons. */
export function previewNext(deck: DeckConfig, progress: Progress | undefined, exerciseRung: number | undefined, now: Date): Record<Grade, Date> {
  const at = (g: Grade) => new Date(nextState(deck, progress, exerciseRung, g, now).memory.due);
  return { 1: at(1), 2: at(2), 3: at(3), 4: at(4) };
}

export function applyIntro(card: Card, now: Date, device: string): AnswerEffect {
  const progress = clone(card.progress, now);
  progress.introduced ??= now.toISOString().slice(0, 10);
  progress.stage = computeStage(progress);
  const line = [now.toISOString().replace(/\.\d+Z$/, 'Z'), `${card.topic}/${card.id}`, 'intro', '-', 'seen', 0, device].join('\t');
  return { progress, lines: [line] };
}


export function applyAnswer(input: ApplyInput): AnswerEffect {
  const progress = clone(input.card.progress, input.now);
  const nowIso = input.now.toISOString();
  if (!input.practice) {
    const before = memoryOf(progress);
    const next = nextState(input.deck, progress, input.rung, input.grade, input.now);
    progress.memory = next.memory;
    progress.rung = next.rung;
    if (next.learned) progress.learned = next.learned;
    if (input.grade === 1 && before?.state === 'review') progress.totals.lapses += 1;
  }
  const lines = [journalLine(input, input.skill, input.practice ? `p${input.grade}` : String(input.grade))];
  progress.totals.answers += 1;
  if (input.grade > 1) progress.totals.correct += 1;
  const stats = progress.exercises[input.exercise.id] ?? { shown: 0, correct: 0, avg_ms: 0 };
  stats.avg_ms = Math.round((stats.avg_ms * stats.shown + input.ms) / (stats.shown + 1));
  stats.shown += 1;
  if (input.grade > 1) stats.correct += 1;
  stats.last = nowIso;
  progress.exercises[input.exercise.id] = stats;
  progress.recent = [`${nowIso.replace(/\.\d+Z$/, 'Z')} ${input.exercise.id} ${input.skill} ${input.practice ? 'p' : ''}${input.grade} ${input.ms} ${input.device}`, ...progress.recent].slice(0, 20);
  progress.as_of = `${input.device}:${nowIso.replace(/\.\d+Z$/, 'Z')}`;
  progress.stage = computeStage(progress);
  const becameLeech = markLeech(input, progress);
  return { progress, lines, becameLeech };
}

// Anki's leech rule: a card that lapsed `leech_threshold` times gets tagged (and optionally suspended).
function markLeech(input: ApplyInput, progress: Progress): boolean {
  if (progress.leech || input.practice || input.grade !== 1) return false;
  const threshold = input.deck.fsrs?.leech_threshold ?? 8;
  if ((progress.memory?.lapses ?? 0) < threshold) return false;
  progress.leech = true;
  if (input.deck.fsrs?.leech_action === 'suspend') progress.stage = 'suspended';
  return true;
}

function base(card: Card, now: Date): Progress {
  if (card.progress) return clone(card.progress, now);
  return { stage: 'new', totals: { answers: 0, correct: 0, lapses: 0 }, skills: {}, exercises: {}, recent: [] };
}

export function suspend(card: Card, now: Date): Progress {
  const p = base(card, now);
  p.stage = 'suspended';
  return p;
}

export function unsuspend(card: Card, now: Date): Progress {
  const p = base(card, now);
  p.stage = 'learning';
  p.stage = p.introduced ? computeStage(p) : 'new';
  return p;
}

export function bury(card: Card, now: Date): Progress {
  const p = base(card, now);
  p.buried_until = nextDayKey(now);
  return p;
}

export const isBuried = (card: Card, now: Date) => Boolean(card.progress?.buried_until && card.progress.buried_until > dayKey(now));
export const isSuspendedCard = (card: Card) => card.progress?.stage === 'suspended';

function laterSkill<T extends { last?: string; reps: number }>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a || !b) return a ?? b;
  if ((a.last ?? '') !== (b.last ?? '')) return (a.last ?? '') > (b.last ?? '') ? a : b;
  return a.reps >= b.reps ? a : b;
}

// Two devices may review the same card between syncs: keep the freshest memory (with its rung) and the widest counters.
export function mergeProgress(local: Progress | null | undefined, remote: Progress | null | undefined): Progress | null {
  if (!local || !remote) return local ?? remote ?? null;
  const merged: Progress = JSON.parse(JSON.stringify(remote));
  merged.skills ??= {};
  for (const skill of new Set([...Object.keys(local.skills ?? {}), ...Object.keys(remote.skills ?? {})]) as Set<keyof Progress['skills']>) {
    merged.skills[skill] = laterSkill(local.skills?.[skill], remote.skills?.[skill]);
  }
  const memory = laterSkill(memoryOf(local), memoryOf(remote));
  if (memory && (local.memory || remote.memory)) {
    const side = memory === memoryOf(local) ? local : remote;
    merged.memory = memory;
    if (side.rung !== undefined) merged.rung = side.rung; else delete merged.rung;
  }
  for (const id of new Set([...Object.keys(local.exercises ?? {}), ...Object.keys(remote.exercises ?? {})])) {
    const a = local.exercises?.[id], b = remote.exercises?.[id];
    merged.exercises[id] = !a || !b ? (a ?? b)! : (a.shown >= b.shown ? a : b);
  }
  merged.totals = {
    answers: Math.max(local.totals?.answers ?? 0, remote.totals?.answers ?? 0),
    correct: Math.max(local.totals?.correct ?? 0, remote.totals?.correct ?? 0),
    lapses: Math.max(local.totals?.lapses ?? 0, remote.totals?.lapses ?? 0),
  };
  merged.recent = [...new Set([...(local.recent ?? []), ...(remote.recent ?? [])])].sort().reverse().slice(0, 20);
  merged.introduced = [local.introduced, remote.introduced].filter(Boolean).sort()[0];
  merged.as_of = [local.as_of, remote.as_of].filter(Boolean).sort((x, y) => (x!.split(':').slice(1).join(':') > y!.split(':').slice(1).join(':') ? -1 : 1))[0];
  merged.stage = local.stage === 'suspended' || remote.stage === 'suspended' ? 'suspended' : computeStage(merged);
  return merged;
}
