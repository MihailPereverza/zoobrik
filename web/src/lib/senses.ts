import { resolveTemplate } from './render';
import type { Card, DeckData, Exercise, Need } from './types';

// What the learner cannot do right now (no headphones on a bus, a sleeping child next door): a setting of this device,
// not of the deck, so it lives here rather than in DeckData that is reloaded on every sync.
let unavailable = new Set<Need>();

export function setUnavailable(needs: Need[]) { unavailable = new Set(needs); }

export const isUnavailable = (need: Need) => unavailable.has(need);

/** What an exercise needs: its own `uses`, else everything on a listening card is answered by ear, else the template's. */
export function exerciseUses(data: DeckData, card: Card, exercise: Exercise): Need[] {
  if (exercise.uses) return exercise.uses;
  if (card.listening) return ['audio'];
  return resolveTemplate(data, card, exercise)?.manifest.uses ?? [];
}

/** The learner can do the exercise now. */
export const doable = (data: DeckData, card: Card, exercise: Exercise) => exerciseUses(data, card, exercise).every((n) => !unavailable.has(n));

/** The deck has exercises that need this, so offering to switch it off makes sense. */
export const deckUses = (data: DeckData, need: Need) => data.topics.some((t) => t.cards.some((c) => c.exercises.some((e) => e.status === 'ready' && e.template !== 'intro' && exerciseUses(data, c, e).includes(need))));
