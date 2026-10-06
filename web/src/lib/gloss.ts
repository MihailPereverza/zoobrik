import type { DeckData } from './types';

/** A translation shown when a word or a set phrase in an exercise is tapped. */
export interface Gloss { phrase: string; ru: string; start: number; length: number }

const MAX_PHRASE = 4;
const index = new WeakMap<object, Map<string, string>>();

const clean = (word: string) => word.toLowerCase().replace(/[’`]/g, "'").replace(/^[^a-z]+|[^a-z']+$/g, '');

function add(map: Map<string, string>, key: string, ru: string) {
  const k = clean(key.replace(/\s+/g, ' ').trim()).replace(/[^a-z' -]/g, '');
  if (!k || !ru) return;
  const known = map.get(k);
  if (!known) map.set(k, ru);
  else if (!known.split('; ').includes(ru)) map.set(k, `${known}; ${ru}`);
}

/** Card terms first (they are what the learner studies), then the deck glossary for every other word. */
export function glossary(data: DeckData): Map<string, string> {
  const cached = index.get(data);
  if (cached) return cached;
  const map = new Map<string, string>();
  for (const card of data.topics.flatMap((t) => t.cards)) {
    const { term, meaning } = card.content;
    if (term && meaning) add(map, term, meaning);
  }
  for (const [word, ru] of Object.entries(data.glossary ?? {})) add(map, word, String(ru));
  index.set(data, map);
  return map;
}

/** Spellings a dictionary form can take in a sentence: wears, carrying, stopped, cities, she's. */
export function baseForms(word: string): string[] {
  const w = clean(word);
  const out = [w];
  const push = (x: string) => { if (x.length > 1 && !out.includes(x)) out.push(x); };
  if (w.endsWith("'s") || w.endsWith("'re") || w.endsWith("'m") || w.endsWith("'ve") || w.endsWith("'ll") || w.endsWith("'d")) push(w.replace(/'[a-z]+$/, ''));
  if (w.endsWith("n't")) push(w.slice(0, -3));
  if (w.endsWith('ies')) push(`${w.slice(0, -3)}y`);
  if (w.endsWith('es')) push(w.slice(0, -2));
  if (w.endsWith('s')) push(w.slice(0, -1));
  if (w.endsWith('ied')) push(`${w.slice(0, -3)}y`);
  if (w.endsWith('ed')) { push(w.slice(0, -2)); push(w.slice(0, -1)); if (/(.)\1ed$/.test(w)) push(w.slice(0, -3)); }
  if (w.endsWith('ying')) push(`${w.slice(0, -4)}ie`);
  if (w.endsWith('ing')) { push(w.slice(0, -3)); push(`${w.slice(0, -3)}e`); if (/(.)\1ing$/.test(w)) push(w.slice(0, -4)); }
  if (w.endsWith('er')) { push(w.slice(0, -2)); push(w.slice(0, -1)); if (/(.)\1er$/.test(w)) push(w.slice(0, -3)); if (w.endsWith('ier')) push(`${w.slice(0, -3)}y`); }
  if (w.endsWith('est')) { push(w.slice(0, -3)); push(w.slice(0, -2)); if (w.endsWith('iest')) push(`${w.slice(0, -4)}y`); }
  if (w.endsWith('ly')) { push(w.slice(0, -2)); if (w.endsWith('ily')) push(`${w.slice(0, -3)}y`); }
  return out;
}

function find(map: Map<string, string>, words: string[]): string | undefined {
  const exact = map.get(words.map(clean).join(' '));
  if (exact) return exact;
  // Only the last word of a phrase is inflected: "puts on" → "put on" needs the first; "pieces of luggage" the last.
  for (let i = 0; i < words.length; i++) {
    for (const form of baseForms(words[i]).slice(1)) {
      const hit = map.get(words.map((w, j) => (j === i ? form : clean(w))).join(' '));
      if (hit) return hit;
    }
  }
  return undefined;
}

/** The longest known phrase around the tapped word wins: "kind of" over "kind", "in front of" over "front". */
export function lookupGloss(map: Map<string, string>, words: string[], at: number): Gloss | null {
  for (let len = Math.min(MAX_PHRASE, words.length); len >= 1; len--) {
    for (let start = Math.max(0, at - len + 1); start <= at && start + len <= words.length; start++) {
      const slice = words.slice(start, start + len);
      const ru = find(map, slice);
      if (ru) return { phrase: slice.join(' '), ru, start, length: len };
    }
  }
  return null;
}
