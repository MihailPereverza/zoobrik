import { exerciseText } from './lexicon';
import { teachingSteps } from './curriculum';
import { isLearned, ladderOf } from './progress';
import type { Card, DeckData, Exercise } from './types';

// Rule G: an exercise may only use grammar the learner has learned. A rule card lists `detect` patterns that find its
// construction in a sentence; an exercise that matches the patterns of a rule not learned yet waits for it.

const GAP = /_{3,}/g;

const compiled = new WeakMap<Card, RegExp[]>();
/** The card's `detect` patterns, case-insensitive; a pattern that does not compile is ignored (the linter reports it). */
export function rulePatterns(card: Card): RegExp[] {
  let out = compiled.get(card);
  if (!out) {
    out = (card.detect ?? []).flatMap((p) => { try { return [new RegExp(p, 'iu')]; } catch { return []; } });
    compiled.set(card, out);
  }
  return out;
}

const rulesCache = new WeakMap<DeckData, Card[]>();
export function ruleCards(data: DeckData): Card[] {
  let rules = rulesCache.get(data);
  if (!rules) {
    // Any card can guard a construction: a rule (She's wearing) or a set phrase a word card teaches (in the evening).
    rules = data.topics.flatMap((t) => t.cards).filter((c) => rulePatterns(c).length > 0);
    rulesCache.set(data, rules);
  }
  return rules;
}

/** Sentences of a text, with each `___` filled by the answers in order, so «He is ___» + «wearing» reads as said. */
export function sentences(text: string, answers: string[] = []): string[] {
  let i = 0;
  const filled = String(text ?? '').replace(GAP, () => answers[i++] ?? answers[0] ?? '');
  return filled.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.replace(/\*\*|__|[«»"“”]/g, '').trim()).filter(Boolean);
}

function exerciseSentences(card: Card, exercise: Exercise): string[] {
  const p = exercise.params ?? {};
  const answers = [p.answer, ...(Array.isArray(p.answers) ? p.answers : [])].filter(Boolean).map(String);
  const t = exerciseText(card, exercise);
  return [...t.text, ...t.distractors].flatMap((s) => sentences(s, answers));
}

/** Rule cards whose construction appears in the text. */
export function rulesIn(data: DeckData, texts: string[]): Card[] {
  return ruleCards(data).filter((rule) => rulePatterns(rule).some((re) => texts.some((s) => re.test(s))));
}

const usedCache = new WeakMap<DeckData, WeakMap<Exercise, Card[]>>();
/** Rules an exercise relies on, besides the card's own rule and those the author marked as fine (`allow_rules`). */
export function rulesUsed(data: DeckData, card: Card, exercise: Exercise): Card[] {
  let byExercise = usedCache.get(data);
  if (!byExercise) usedCache.set(data, (byExercise = new WeakMap()));
  let used = byExercise.get(exercise);
  if (!used) {
    const allowed = new Set(exercise.allow_rules ?? []);
    used = rulesIn(data, exerciseSentences(card, exercise)).filter((r) => r !== card && !allowed.has(r.id) && !allowed.has(`${r.topic}/${r.id}`));
    byExercise.set(exercise, used);
  }
  return used;
}

export const ruleLearned = (data: DeckData, rule: Card) => isLearned(rule.progress, ladderOf(data.deck));

/** True when the exercise uses a construction whose rule the learner has not learned yet. */
export function grammarLocked(data: DeckData, card: Card, exercise: Exercise): boolean {
  return ruleCards(data).length > 0 && rulesUsed(data, card, exercise).some((rule) => !ruleLearned(data, rule));
}

const cardById = (data: DeckData, id: string) => data.topics.flatMap((t) => t.cards).find((c) => c.id === id || `${c.topic}/${c.id}` === id);

/** True while a card listed in the card's own `needs` is not learned yet. */
export function cardWaits(data: DeckData, card: Card): boolean {
  return (card.needs ?? []).some((id) => { const need = cardById(data, id); return Boolean(need) && !ruleLearned(data, need!); });
}

// ---- Author report ----

export interface GrammarFinding {
  topic: string;
  card: string;
  /** Exercise id, `examples.<id>` or `note`. */
  where: string;
  step: number;
  /** Rules used before their step, with the step each one comes at (Infinity: no rule card in the deck order). */
  rules: { id: string; step: number }[];
}

export interface GrammarReport { steps: number; rules: number; exercises: GrammarFinding[]; content: GrammarFinding[]; invalid: { card: string; pattern: string }[] }

/** Exercises that wait for a later rule (they are locked until it is learned) and card content shown before its rule. */
export function grammarReport(data: DeckData): GrammarReport {
  const steps = teachingSteps(data);
  const stepOf = new Map<Card, number>();
  steps.forEach((cards, i) => cards.forEach((c) => stepOf.set(c, i + 1)));
  const late = (card: Card, rules: Card[]) => rules
    .map((r) => ({ id: `${r.topic}/${r.id}`, step: stepOf.get(r) ?? Infinity }))
    .filter((r) => r.step > (stepOf.get(card) ?? 0));
  const report: GrammarReport = { steps: steps.length, rules: ruleCards(data).length, exercises: [], content: [], invalid: [] };
  for (const card of data.topics.flatMap((t) => t.cards)) {
    for (const p of card.detect ?? []) { try { new RegExp(p, 'iu'); } catch { report.invalid.push({ card: `${card.topic}/${card.id}`, pattern: p }); } }
    const step = stepOf.get(card) ?? 0;
    const add = (list: GrammarFinding[], where: string, rules: Card[]) => {
      const lateRules = late(card, rules.filter((r) => r !== card));
      if (lateRules.length) list.push({ topic: card.topic, card: card.id, where, step, rules: lateRules });
    };
    for (const ex of card.exercises) if (ex.status !== 'off' && ex.template !== 'intro') add(report.exercises, ex.id, rulesUsed(data, card, ex));
    for (const ex of card.content.examples ?? []) add(report.content, `examples.${ex.id}`, rulesIn(data, sentences(ex.term)));
  }
  return report;
}
