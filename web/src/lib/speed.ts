import type { DeckData } from './types';

/** A word and its translation on the speed board. */
export interface Pair { id: string; en: string; ru: string }

/** Each round gives less time for the same number of pairs. */
export const ROUNDS = [{ seconds: 75, goal: 15 }, { seconds: 60, goal: 15 }, { seconds: 45, goal: 15 }];
export const ROWS = 5;
export const MIN_WORDS = ROWS + 1;
export const WRONG_PENALTY_S = 2;

// «редко (книжный синоним rarely)» → «редко»: the board shows the gist, the card keeps the nuance.
export function shortMeaning(meaning: string): string {
  return meaning.split(/[;(]/)[0].trim().replace(/[,.]$/, '');
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Words the learner has already met (introduced word, phrase and idiom cards), in random order. */
export function speedPairs(data: DeckData): Pair[] {
  const pairs = data.topics.flatMap((t) => t.cards)
    .filter((c) => c.progress?.introduced && c.progress.stage !== 'suspended' && ['word', 'phrase', 'idiom'].includes(c.kind) && c.content.term && c.content.meaning)
    .map((c) => ({ id: c.id, en: c.content.term!, ru: shortMeaning(c.content.meaning!) }))
    .filter((p) => p.ru && p.en.length <= 28 && p.ru.length <= 28);
  return shuffle(pairs);
}

/**
 * Hands out pairs one by one, round and round: a pair whose word or translation is already on the board waits, so two
 * cells never read the same (rarely and seldom are both «редко»).
 */
export class Feed {
  private queue: Pair[];
  constructor(private readonly pairs: Pair[]) { this.queue = shuffle(pairs); }

  next(onBoard: Pair[]): Pair | null {
    const free = (pair: Pair) => !onBoard.some((p) => p.id === pair.id || p.en === pair.en || p.ru === pair.ru);
    // What is left of this pass may all clash with the board: then the next pass starts behind it.
    if (!this.queue.some(free)) this.queue.push(...shuffle(this.pairs));
    const at = this.queue.findIndex(free);
    return at < 0 ? null : this.queue.splice(at, 1)[0];
  }
}

const RECORD_KEY = 'zb.speed.best';

export function bestScore(): number {
  try { return Number(localStorage.getItem(RECORD_KEY)) || 0; } catch { return 0; }
}

export function saveBest(score: number) {
  try { if (score > bestScore()) localStorage.setItem(RECORD_KEY, String(score)); } catch { /* storage blocked: no record kept */ }
}
