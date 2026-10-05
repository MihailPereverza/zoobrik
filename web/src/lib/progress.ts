import { review } from './fsrs';
import type { Card, DeckConfig, Exercise, Grade, Progress, Skill, Stage } from './types';

export const MASTERED_DAYS = 90;

export function emptyProgress(now: Date): Progress {
  return {
    stage: 'learning', introduced: now.toISOString().slice(0, 10),
    totals: { answers: 0, correct: 0, lapses: 0 }, skills: {}, exercises: {}, recent: [],
  };
}

export function computeStage(progress: Progress): Stage {
  if (progress.stage === 'suspended') return 'suspended';
  const states = Object.values(progress.skills);
  if (!states.length) return 'learning';
  if (states.some((s) => s!.state !== 'review')) return 'learning';
  return states.every((s) => s!.s >= MASTERED_DAYS) ? 'mastered' : 'review';
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
}

interface ApplyInput {
  deck: DeckConfig;
  card: Card;
  exercise: Exercise;
  skills: Skill[];
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
  const lines: string[] = [];
  for (const skill of input.skills) {
    const before = progress.skills[skill];
    if (!input.practice) {
      progress.skills[skill] = review(input.deck, skill, before, input.grade, input.now);
      if (input.grade === 1 && before && before.state === 'review') progress.totals.lapses += 1;
    }
    lines.push(journalLine(input, skill, input.practice ? `p${input.grade}` : String(input.grade)));
  }
  progress.totals.answers += 1;
  if (input.grade > 1) progress.totals.correct += 1;
  const stats = progress.exercises[input.exercise.id] ?? { shown: 0, correct: 0, avg_ms: 0 };
  stats.avg_ms = Math.round((stats.avg_ms * stats.shown + input.ms) / (stats.shown + 1));
  stats.shown += 1;
  if (input.grade > 1) stats.correct += 1;
  stats.last = nowIso;
  progress.exercises[input.exercise.id] = stats;
  progress.recent = [`${nowIso.replace(/\.\d+Z$/, 'Z')} ${input.exercise.id} ${input.skills.join(',')} ${input.practice ? 'p' : ''}${input.grade} ${input.ms} ${input.device}`, ...progress.recent].slice(0, 20);
  progress.as_of = `${input.device}:${nowIso.replace(/\.\d+Z$/, 'Z')}`;
  progress.stage = computeStage(progress);
  return { progress, lines };
}

function laterSkill<T extends { last?: string; reps: number }>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a || !b) return a ?? b;
  if ((a.last ?? '') !== (b.last ?? '')) return (a.last ?? '') > (b.last ?? '') ? a : b;
  return a.reps >= b.reps ? a : b;
}

// Two devices may review the same card between syncs: keep the freshest state per skill and the widest counters.
export function mergeProgress(local: Progress | null | undefined, remote: Progress | null | undefined): Progress | null {
  if (!local || !remote) return local ?? remote ?? null;
  const merged: Progress = JSON.parse(JSON.stringify(remote));
  for (const skill of new Set([...Object.keys(local.skills ?? {}), ...Object.keys(remote.skills ?? {})]) as Set<keyof Progress['skills']>) {
    merged.skills[skill] = laterSkill(local.skills?.[skill], remote.skills?.[skill]);
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
