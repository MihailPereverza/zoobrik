import { createEmptyCard, fsrs, generatorParameters, State, type Card as FsrsCard, type FSRS, type Grade as FsrsGrade, type Steps } from 'ts-fsrs';
import type { DeckConfig, Grade, Skill, SkillPhase, SkillState } from './types';

const DEFAULT_RETENTION: Record<Skill, number> = { recognize: 0.92, recall: 0.9, listen: 0.88, spell: 0.85, context: 0.88, apply: 0.88 };
const PHASES: SkillPhase[] = ['new', 'learning', 'review', 'relearning'];
const engines = new Map<string, FSRS>();

function days(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseFloat(value);
  return value.endsWith('d') ? n : value.endsWith('y') ? n * 365 : n;
}

function engine(deck: DeckConfig, skill: Skill): FSRS {
  const retention = deck.fsrs?.retention?.[skill] ?? DEFAULT_RETENTION[skill];
  const key = `${skill}:${retention}`;
  let f = engines.get(key);
  if (!f) {
    f = fsrs(generatorParameters({
      request_retention: retention,
      maximum_interval: days(deck.fsrs?.max_interval, 365),
      enable_fuzz: true,
      enable_short_term: true,
      learning_steps: (deck.fsrs?.learning_steps ?? ['1m', '10m']) as Steps,
      relearning_steps: (deck.fsrs?.relearning_steps ?? ['10m']) as Steps,
      ...(deck.fsrs?.params?.length ? { w: deck.fsrs.params } : {}),
    }));
    engines.set(key, f);
  }
  return f;
}

function toFsrs(state: SkillState | undefined, now: Date): FsrsCard {
  if (!state) return createEmptyCard(now);
  const last = state.last ? new Date(state.last) : undefined;
  const due = new Date(state.due);
  return {
    due, stability: state.s, difficulty: state.d, elapsed_days: 0,
    scheduled_days: last ? Math.max(0, Math.round((due.getTime() - last.getTime()) / 86400000)) : 0,
    learning_steps: state.step ?? 0, reps: state.reps, lapses: state.lapses,
    state: PHASES.indexOf(state.state) as State, last_review: last,
  };
}

function fromFsrs(card: FsrsCard): SkillState {
  return {
    state: PHASES[card.state], s: round(card.stability), d: round(card.difficulty),
    due: card.due.toISOString(), last: card.last_review?.toISOString(),
    reps: card.reps, lapses: card.lapses, step: card.learning_steps,
  };
}

function round(n: number): number { return Math.round(n * 100) / 100; }

export function review(deck: DeckConfig, skill: Skill, state: SkillState | undefined, grade: Grade, now: Date): SkillState {
  const f = engine(deck, skill);
  return fromFsrs(f.next(toFsrs(state, now), now, grade as FsrsGrade).card);
}

export function preview(deck: DeckConfig, skill: Skill, state: SkillState | undefined, now: Date): Record<Grade, Date> {
  const f = engine(deck, skill);
  const result = f.repeat(toFsrs(state, now), now);
  return { 1: result[1].card.due, 2: result[2].card.due, 3: result[3].card.due, 4: result[4].card.due };
}

export function retrievability(deck: DeckConfig, skill: Skill, state: SkillState | undefined, now: Date): number {
  if (!state || state.state === 'new') return 0;
  return engine(deck, skill).get_retrievability(toFsrs(state, now), now, false);
}

export function formatInterval(from: Date, to: Date): string {
  const minutes = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  const d = Math.round(hours / 24);
  if (d < 31) return `${d} дн`;
  const months = Math.round(d / 30);
  return months < 12 ? `${months} мес` : `${Math.round(d / 365 * 10) / 10} г`;
}
