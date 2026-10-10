import { applyAnswer, applyIntro } from './progress';
import { balanceDue, buildSession, exerciseRung, movesSchedule, queueAfter } from './scheduler';
import type { Card, DeckData, Grade, QueueItem } from './types';

// Headless copy of Session.svelte's grading loop, for tests and replays of a learner's journal.

export interface SimAnswer { card: Card; item: QueueItem; grade: Grade; at: Date; graded: boolean }

export function answerItem(data: DeckData, item: QueueItem, grade: Grade, now: Date): boolean {
  const practice = !movesSchedule(item);
  for (const card of item.topicCards ?? [item.card]) {
    const skill = item.topicCards ? item.exercise.cards![card.id] : item.skills[0] ?? '-';
    const rung = item.topicCards ? undefined : exerciseRung(data, card, item.exercise) ?? undefined;
    const effect = applyAnswer({ deck: data.deck, card, exercise: item.exercise, skill, rung, grade, practice, ms: 5000, now, device: 'sim' });
    if (!practice && effect.progress.memory) effect.progress.memory = balanceDue(data, card, effect.progress.memory);
    card.progress = effect.progress;
  }
  return !practice;
}

/** Plays one sitting: the planned queue, its follow-ups, then fresh plans until nothing is due. */
export function runSession(data: DeckData, start: Date, grader: (item: QueueItem) => Grade, opts: { allowNew?: boolean; queue?: QueueItem[]; stepMs?: number } = {}): { answers: SimAnswer[]; end: Date } {
  const step = opts.stepMs ?? 20_000;
  let now = new Date(start);
  let queue = opts.queue ?? buildSession(data, now, opts.allowNew ?? true).queue;
  const answers: SimAnswer[] = [];
  for (let round = 0; round < 50 && queue.length; round++) {
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      if (item.mode === 'intro') item.card.progress = applyIntro(item.card, now, 'sim').progress;
      else {
        const grade = grader(item);
        const graded = answerItem(data, item, grade, now);
        answers.push({ card: item.card, item, grade, at: now, graded });
        queue = queueAfter(data, queue, i, grade, false, now);
      }
      now = new Date(now.getTime() + step);
    }
    queue = buildSession(data, now, opts.allowNew ?? true).queue;
  }
  return { answers, end: now };
}
