import type { Answer, CheckResult, Exercise, Grade, TemplateManifest } from './types';
import type { MdExercise } from './md';

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
  const given = withoutPunctuation(tokens.join(' '));
  return variants.filter(Boolean).some((v) => withoutPunctuation(v) === given);
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

function allowedTypos(expected: string): number {
  if (expected.length >= 14) return 2;
  return expected.length >= 5 ? 1 : 0;
}

// Endings that change the grammar, not the spelling: works/work, played/play, taller/tall, studies/study.
const ENDINGS = /(?:ies|es|s|ied|ed|d|ing|ier|er|iest|est|n't)$/;
const stem = (w: string) => w.replace(ENDINGS, '').replace(/(?:e|y|i)$/, '');
const ending = (w: string) => ENDINGS.exec(w)?.[0] ?? '';
const inflected = (a: string, b: string) => stem(a) === stem(b) && ending(a) !== ending(b);

/** True when the answer differs from the expected one by a whole word or a grammatical ending: a mistake, never a typo. */
export function otherForm(given: string, expected: string): boolean {
  const a = given.split(' '), b = expected.split(' ');
  if (a.length !== b.length) return true;
  return a.some((w, i) => w !== b[i] && (inflected(w, b[i]) || Math.max(w.length, b[i].length) <= 4 || levenshtein(w, b[i]) > Math.ceil(b[i].length / 4)));
}

interface TextMatch { correct: boolean; typo: boolean }

export function matchText(given: string, variants: string[]): TextMatch {
  const g = normalize(given);
  if (!g) return { correct: false, typo: false };
  const normalized = variants.filter(Boolean).map(normalize);
  if (normalized.includes(g)) return { correct: true, typo: false };
  const close = normalized.some((v) => levenshtein(g, v) <= allowedTypos(v) && !otherForm(g, v));
  return { correct: close, typo: close };
}

function result(correct: boolean, typo: boolean, expected: string, marks?: CheckResult['marks']): CheckResult {
  const suggested: Grade = !correct ? 1 : typo ? 2 : 3;
  return { correct, typo, expected, suggested, marks };
}

function variantsOf(params: Record<string, any>): string[] {
  return [params.answer, ...(params.accept ?? [])].map(String);
}

function checkMd(md: MdExercise, answer: Answer): CheckResult {
  if (md.kind === 'choice') return result(answer.choice === md.answer, false, md.answer);
  if (md.kind === 'chips') {
    return result(matchTokens(answer.tokens ?? [], [md.chips.answer]), false, md.chips.answer);
  }
  if (md.kind === 'order') {
    const given = answer.tokens ?? [];
    return result(given.length === md.order.length && given.every((t, i) => t === md.order[i]), false, md.order.join(' → '));
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
    return result(correct, ok.typo, params.answer);
  }
  if (type === 'custom') return customResult(answer, params);
  if (type === 'pairs') {
    const mistakes = answer.mistakes ?? 0;
    const r = result(mistakes <= 1, mistakes === 1, '');
    return mistakes === 0 ? r : { ...r, suggested: mistakes === 1 ? 2 : 1 };
  }
  if (SELF_GRADED.has(type)) return result(true, false, '');
  return { ...result(false, false, `неизвестный тип проверки «${type}»`), error: `unknown check type ${type}` };
}

// Flip cards and the intro are graded by the learner, not checked.
const SELF_GRADED = new Set(['none', 'manual', 'ai']);

function customResult(answer: Answer, params: Record<string, any>): CheckResult {
  const v = answer.verdict;
  if (!v || v.error) return { ...result(false, false, 'шаблон не проверил ответ'), error: v?.error ?? 'no verdict from logic.js check()' };
  const score = typeof v.score === 'number' ? Math.max(0, Math.min(1, v.score)) : v.correct ? 1 : 0;
  const correct = v.correct ?? score >= 0.5;
  const expected = String(v.expected ?? params.answer ?? '');
  const suggested: Grade = !correct ? 1 : v.typo || score < 1 ? 2 : 3;
  return { correct, typo: Boolean(v.typo), expected, suggested, marks: v.marks };
}
