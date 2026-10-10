import { createEmptyCard, fsrs, generatorParameters, S_MIN, State, type Card as FsrsCard, type FSRS, type Grade as FsrsGrade, type Steps } from 'ts-fsrs';
import type { DeckConfig, Grade, SkillPhase, SkillState } from './types';

const PHASES: SkillPhase[] = ['new', 'learning', 'review', 'relearning'];
const engines = new Map<string, FSRS>();

function days(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseFloat(value);
  return value.endsWith('d') ? n : value.endsWith('y') ? n * 365 : n;
}

/** One retention for the card's single memory; an old per-skill map gives its `recall` value. */
export function retentionOf(deck: DeckConfig): number {
  const r = deck.fsrs?.retention;
  return typeof r === 'number' ? r : r?.recall ?? 0.9;
}

const minutes = (step: string) => parseFloat(step) * (step.endsWith('d') ? 1440 : step.endsWith('h') ? 60 : step.endsWith('s') ? 1 / 60 : 1);

// A new word is checked once more at the end of the session, never a minute later: shorter steps become 10m.
function learningSteps(deck: DeckConfig): Steps {
  const steps = deck.fsrs?.learning_steps?.length ? deck.fsrs.learning_steps : ['10m', '10m'];
  return steps.map((s) => (minutes(s) < 10 ? '10m' : s)) as Steps;
}

function engine(deck: DeckConfig): FSRS {
  const retention = retentionOf(deck);
  const steps = learningSteps(deck);
  const key = JSON.stringify([retention, deck.fsrs?.params ?? null, steps, deck.fsrs?.relearning_steps ?? null, deck.fsrs?.max_interval ?? null]);
  let f = engines.get(key);
  if (!f) {
    f = fsrs(generatorParameters({
      request_retention: retention,
      maximum_interval: days(deck.fsrs?.max_interval, 365),
      enable_fuzz: true,
      enable_short_term: true,
      learning_steps: steps,
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
    // Stability can drop far below 0.01 after repeated lapses; rounding it to zero makes the state invalid.
    state: PHASES[card.state], s: Math.max(S_MIN, round(card.stability)), d: round(card.difficulty),
    due: card.due.toISOString(), last: card.last_review?.toISOString(),
    reps: card.reps, lapses: card.lapses, step: card.learning_steps,
  };
}

function round(n: number): number { return Math.round(n * 10000) / 10000; }

// ts-fsrs forces Easy one day past Good even when Good already sits at the maximum interval.
function clampToMaximum(deck: DeckConfig, state: SkillState): SkillState {
  if (state.state !== 'review' || !state.last) return state;
  const limit = new Date(state.last).getTime() + days(deck.fsrs?.max_interval, 365) * 86_400_000;
  return new Date(state.due).getTime() > limit ? { ...state, due: new Date(limit).toISOString() } : state;
}

export function review(deck: DeckConfig, state: SkillState | undefined, grade: Grade, now: Date): SkillState {
  const f = engine(deck);
  return clampToMaximum(deck, fromFsrs(f.next(toFsrs(state, now), now, grade as FsrsGrade).card));
}

export function preview(deck: DeckConfig, state: SkillState | undefined, now: Date): Record<Grade, Date> {
  const f = engine(deck);
  const result = f.repeat(toFsrs(state, now), now);
  const due = (g: Grade) => new Date(clampToMaximum(deck, fromFsrs(result[g].card)).due);
  return { 1: due(1), 2: due(2), 3: due(3), 4: due(4) };
}

export function retrievability(deck: DeckConfig, state: SkillState | undefined, now: Date): number {
  if (!state || state.state === 'new') return 0;
  return engine(deck).get_retrievability(toFsrs(state, now), now, false);
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
