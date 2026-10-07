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

interface TextMatch { correct: boolean; typo: boolean }

export function matchText(given: string, variants: string[]): TextMatch {
  const g = normalize(given);
  if (!g) return { correct: false, typo: false };
  const normalized = variants.filter(Boolean).map(normalize);
  if (normalized.includes(g)) return { correct: true, typo: false };
  const close = normalized.some((v) => levenshtein(g, v) <= allowedTypos(v));
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
  if (type === 'pairs') {
    const mistakes = answer.mistakes ?? 0;
    const r = result(mistakes <= 1, mistakes === 1, '');
    return mistakes === 0 ? r : { ...r, suggested: mistakes === 1 ? 2 : 1 };
  }
  return result(true, false, '');
}
