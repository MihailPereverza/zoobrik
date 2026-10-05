import { check } from './check';
import { mediaUrl, render } from './render';
import { backend } from './state.svelte';
import type { Answer, Card, DeckData, Exercise } from './types';
import type { MdExercise } from './md';

export interface LintIssue { card: Card; exercise?: Exercise; message: string }

function idealAnswer(exercise: Exercise, type: string, md?: MdExercise): Answer | null {
  const p = exercise.params ?? {};
  if (type === 'md' && md) {
    if (md.kind === 'choice') return { choice: md.answer };
    if (md.kind === 'chips') return { tokens: md.chips.answer.split(' ') };
    if (md.kind === 'gaps') return { texts: md.gaps.map((g) => g[0]) };
    return null;
  }
  if (type === 'choice') return { choice: exercise.check?.expected ?? p.answer };
  if (type === 'tokens') return { tokens: String(p.answer).split(/\s+/) };
  if (type === 'fuzzy' || type === 'exact') return { text: p.answer };
  return null;
}

function chipProblems(exercise: Exercise): string | null {
  const p = exercise.params ?? {};
  const answer = String(p.answer ?? '').split(/\s+/).filter(Boolean);
  const pool = exercise.template === 'word-order' ? [...(p.tokens ?? [])].map(String) : [...answer, ...(p.extra ?? [])].map(String);
  for (const token of answer) {
    const i = pool.indexOf(token);
    if (i < 0) return `в фишках нет слова «${token}» из ответа`;
    pool.splice(i, 1);
  }
  if (exercise.template === 'word-order' && pool.length) return `лишние фишки: ${pool.join(', ')}`;
  return null;
}

function mdProblems(md: MdExercise): string | null {
  if (md.kind === 'choice' && !md.answer) return 'в выборе не отмечен верный вариант [x]';
  if (md.kind === 'choice' && md.options.length < 2) return 'меньше двух вариантов';
  return null;
}

function lintExercise(data: DeckData, card: Card, exercise: Exercise): string[] {
  const out = render(data, card, exercise, exercise.template === 'intro' ? 'intro' : 'review', 'light');
  if ('error' in out) return [out.error];
  const issues: string[] = [];
  const type = exercise.check?.type ?? out.template.manifest.check?.type ?? 'none';
  if (type === 'tokens') { const p = chipProblems(exercise); if (p) issues.push(p); }
  if (out.md) { const p = mdProblems(out.md); if (p) issues.push(p); }
  if (type === 'choice' && Array.isArray(exercise.params?.options) && !exercise.params.options.includes(exercise.params.answer)) issues.push('верного ответа нет среди вариантов');
  const ideal = idealAnswer(exercise, type, out.md);
  if (ideal && !check(exercise, out.template.manifest, ideal, out.md).correct) issues.push('эталонный ответ не засчитывается проверкой');
  return issues;
}

function audioFiles(card: Card): string[] {
  const files = new Set<string>();
  if (card.content.audio) files.add(card.content.audio);
  card.content.examples?.forEach((e) => e.audio && files.add(e.audio));
  card.exercises.forEach((e) => typeof e.params?.audio === 'string' && files.add(e.params.audio));
  return [...files];
}

export async function lintDeck(data: DeckData, onProgress: (done: number, total: number) => void): Promise<{ issues: LintIssue[]; exercises: number; audio: number }> {
  const issues: LintIssue[] = [];
  const cards = data.topics.flatMap((t) => t.cards);
  let exercises = 0;
  let audio = 0;
  for (const [i, card] of cards.entries()) {
    for (const exercise of card.exercises) {
      exercises += 1;
      lintExercise(data, card, exercise).forEach((message) => issues.push({ card, exercise, message }));
    }
    const files = audioFiles(card);
    audio += files.length;
    const missing = await Promise.all(files.map(async (f) => ((await backend().mediaExists(mediaUrl(card, f))) ? null : f)));
    missing.filter(Boolean).forEach((f) => issues.push({ card, message: `нет аудиофайла ${f}` }));
    onProgress(i + 1, cards.length);
  }
  for (const topic of data.topics) {
    for (const exercise of topic.exercises) {
      const member = topic.cards.find((c) => exercise.cards?.[c.id]);
      if (!member) { issues.push({ card: topic.cards[0], exercise, message: 'задание темы не ссылается на карточки' }); continue; }
      exercises += 1;
      lintExercise(data, member, exercise).forEach((message) => issues.push({ card: member, exercise, message }));
    }
  }
  return { issues, exercises, audio };
}
