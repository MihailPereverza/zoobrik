import type { Card, DeckData, Topic } from './types';

// The order the scheduler introduces cards when the learner keeps up: what each card may build on.

const isRuleTopic = (t: Topic) => t.kind === 'grammar';

function sortedCards(topic: Topic): Card[] {
  const order = topic.order ?? [];
  return [...topic.cards].sort((a, b) => (order.indexOf(a.id) + 1 || 999) - (order.indexOf(b.id) + 1 || 999));
}

/**
 * Steps of the curriculum: each step is a portion of words from the first open vocabulary topic plus one rule from the
 * first open grammar topic, as `nextBatch` gives them; a rule topic opens once the rule topics it requires are all in.
 * Listening cards open by known words, not by order, and come last.
 */
export function teachingSteps(data: DeckData): Card[][] {
  const introduced = new Map<string, number>();
  const count = (t: Topic) => introduced.get(t.id) ?? 0;
  const open = (topic: Topic) => (topic.requires ?? []).every((id) => {
    const req = data.topics.find((t) => t.id === id);
    if (!req) return true;
    return count(req) >= (isRuleTopic(req) ? req.cards.length : Math.min(req.cards.length, req.batch ?? 4));
  });
  const take = (rules: boolean, size: (t: Topic) => number): Card[] => {
    const topic = data.topics.find((t) => t.kind !== 'listening' && isRuleTopic(t) === rules && count(t) < t.cards.length && open(t));
    if (!topic) return [];
    const cards = sortedCards(topic).slice(count(topic), count(topic) + size(topic));
    introduced.set(topic.id, count(topic) + cards.length);
    return cards;
  };
  const steps: Card[][] = [];
  for (;;) {
    const step = [...take(false, (t) => t.batch ?? 4), ...take(true, () => 1)];
    if (!step.length) break;
    steps.push(step);
  }
  const listening = data.topics.filter((t) => t.kind === 'listening').flatMap(sortedCards);
  if (listening.length) steps.push(listening);
  return steps;
}

export const teachingOrder = (data: DeckData): Card[] => teachingSteps(data).flat();
