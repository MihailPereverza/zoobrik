import type { Answer, CheckResult, Exercise, Grade, TemplateManifest } from './types';
import type { MdExercise } from './md';
import { baseForms } from './gloss';

export function normalize(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,.!?;:])\s*/g, '$1 ')
    .replace(/[.!?]+\s*$/g, '')
    .trim();
}

function withoutPunctuation(text: string): string {
  return normalize(text).replace(/[.,!?;:"]/g, '').replace(/\s+/g, ' ').trim();
}

function matchTokens(tokens: string[], variants: string[]): boolean {
  const given = withoutPunctuation(contracted(tokens.join(' ')));
  return variants.filter(Boolean).some((v) => withoutPunctuation(contracted(v)) === given);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Short forms and full forms are the same answer: "I'm" = "I am", "doesn't" = "does not".
const CONTRACTIONS: [RegExp, string][] = [
  [/\bi am\b/g, "i'm"], [/\byou are\b/g, "you're"], [/\bwe are\b/g, "we're"], [/\bthey are\b/g, "they're"],
  [/\b(he|she|it|that|there|what|where|who) is\b/g, "$1's"], [/\b(he|she|it) has got\b/g, "$1's got"],
  [/\b(do|does|did|is|are|was|were|have|has|had|should|would|could) not\b/g, "$1n't"],
  [/\bcan ?not\b/g, "can't"], [/\bwill not\b/g, "won't"], [/\blet us\b/g, "let's"],
  [/\b(i|you|we|they) have got\b/g, "$1've got"], [/\b(i|you|we|they|he|she|it) will\b/g, "$1'll"],
];

export function contracted(text: string): string {
  return CONTRACTIONS.reduce((t, [re, short]) => t.replace(re, short), normalize(text));
}

const FUNCTION_WORDS = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'do', 'does', 'is', 'are', 'am', 'it', 'with', 'by', 'from']);

/** Real English words the deck knows; a "typo" that spells one of them (there/their, quite/quiet) is a different word. */
let knownWords: Set<string> = new Set();
export function setKnownWords(words: Iterable<string>) { knownWords = new Set([...words].map((w) => w.toLowerCase())); }

// "wears" for "wear" is a wrong form, not a typo: any inflection of a known word counts as a real word.
const isRealWord = (word: string) => baseForms(word).some((form) => knownWords.has(form));

/** Optimal string alignment distance: an adjacent swap ("satrt") counts as one edit, like a single typo. */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const words = (text: string) => contracted(text).replace(/[.,!?;:"]/g, ' ').split(/\s+/).filter(Boolean);

interface TextMatch { correct: boolean; typo: boolean; note?: string }

/** Word by word, like Duolingo: one slip per word is a typo unless it makes another real word; two slips are wrong. */
function compareWords(given: string[], expected: string[]): TextMatch {
  if (given.length !== expected.length) return { correct: false, typo: false, note: missingWordNote(given, expected) };
  let typos = 0;
  for (let i = 0; i < given.length; i++) {
    if (given[i] === expected[i]) continue;
    const slip = expected[i].length >= 4 && editDistance(given[i], expected[i]) === 1 && !isRealWord(given[i]);
    if (!slip) return { correct: false, typo: false };
    typos++;
  }
  return typos <= Math.max(2, Math.floor(expected.length / 3)) ? { correct: true, typo: typos > 0 } : { correct: false, typo: false };
}

function missingWordNote(given: string[], expected: string[]): string | undefined {
  const [longer, shorter, verb] = given.length > expected.length ? [given, expected, 'лишнее'] : [expected, given, 'пропущено'];
  if (longer.length - shorter.length !== 1) return undefined;
  for (let i = 0; i < longer.length; i++) {
    const without = [...longer.slice(0, i), ...longer.slice(i + 1)];
    if (without.join(' ') === shorter.join(' ') && FUNCTION_WORDS.has(longer[i])) return `${verb} слово «${longer[i]}»`;
  }
  return undefined;
}

export function matchText(given: string, variants: string[]): TextMatch {
  const g = contracted(given);
  if (!g) return { correct: false, typo: false };
  const all = variants.filter(Boolean);
  if (all.some((v) => contracted(v) === g)) return { correct: true, typo: false };
  let best: TextMatch = { correct: false, typo: false };
  for (const v of all) {
    const m = compareWords(words(given), words(v));
    if (m.correct) return m;
    best = best.note ? best : m;
  }
  return best;
}

function result(correct: boolean, typo: boolean, expected: string, marks?: CheckResult['marks'], note?: string): CheckResult {
  const suggested: Grade = !correct ? 1 : typo ? 2 : 3;
  return note ? { correct, typo, expected, suggested, marks, note } : { correct, typo, expected, suggested, marks };
}

function variantsOf(params: Record<string, any>): string[] {
  return [params.answer, ...(params.accept ?? [])].map(String);
}

function checkMd(md: MdExercise, answer: Answer): CheckResult {
  if (md.kind === 'open') return { correct: false, typo: false, expected: md.reference, suggested: 1, open: true };
  if (md.kind === 'choice') return result(answer.choice === md.answer, false, md.answer);
  if (md.kind === 'chips') {
    return result(matchTokens(answer.tokens ?? [], [md.chips.answer]), false, md.chips.answer);
  }
  const gaps = md.gaps.map((variants, i) => matchText(answer.texts?.[i] ?? '', variants));
  const correct = gaps.every((g) => g.correct);
  return result(correct, gaps.some((g) => g.typo), md.gaps.map((v) => v[0]).join(' · '), { gaps: gaps.map((g) => g.correct) });
}

export function check(exercise: Exercise, manifest: TemplateManifest, answer: Answer, md?: MdExercise): CheckResult {
  const type = exercise.check?.type ?? manifest.check?.type ?? 'none';
  const params = exercise.params ?? {};
  if (type === 'md' && md) return checkMd(md, answer);
  if (type === 'choice') {
    const expected = exercise.check?.expected ?? params.answer;
    return result(answer.choice === expected, false, expected);
  }
  if (type === 'tokens') {
    return result(matchTokens(answer.tokens ?? [], variantsOf(params)), false, params.answer);
  }
  if (type === 'fuzzy' || type === 'exact') {
    const ok = matchText(answer.text ?? '', variantsOf(params));
    const correct = type === 'exact' ? ok.correct && !ok.typo : ok.correct;
    return result(correct, ok.typo, params.answer, undefined, ok.note);
  }
  if (type === 'pairs') {
    const mistakes = answer.mistakes ?? 0;
    const r = result(mistakes <= 1, mistakes === 1, '');
    return mistakes === 0 ? r : { ...r, suggested: mistakes === 1 ? 2 : 1 };
  }
  return result(true, false, '');
}
