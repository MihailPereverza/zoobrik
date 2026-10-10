import YAML from 'yaml';
import { baseForms } from './gloss';
import type { KnownWords, PlacementWord } from './types';

export const BAND = 100;
export const SCREEN = 10;

/** Where the adaptive test is: a 10-word sample of a band, or the rest of a band shown screen by screen. */
export interface PlacementState {
  band: number;
  phase: 'sample' | 'rest';
  screen: string[];
  rest: string[];
  low: number;
  known: string[];
  unknown: string[];
  screens: number;
  done: boolean;
}

const bandOf = (words: PlacementWord[], band: number) => words.slice(band * BAND, (band + 1) * BAND).map((w) => w.en);
export const bandCount = (words: PlacementWord[]) => Math.ceil(words.length / BAND);

function sample(list: string[], rng: () => number): string[] {
  const pool = [...list];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const picked = new Set(pool.slice(0, SCREEN));
  return list.filter((w) => picked.has(w));
}

function enterBand(words: PlacementWord[], s: PlacementState, band: number, rng: () => number): PlacementState {
  const list = bandOf(words, band);
  if (!list.length) return { ...s, band, screen: [], rest: [], done: true };
  return { ...s, band, phase: 'sample', screen: sample(list, rng), rest: [] };
}

export function startPlacement(words: PlacementWord[], rng = Math.random): PlacementState {
  return enterBand(words, { band: 0, phase: 'sample', screen: [], rest: [], low: 0, known: [], unknown: [], screens: 0, done: false }, 0, rng);
}

/**
 * Records one screen (the words tapped as unknown) and moves on. A sample of 9–10 known words counts the whole band as
 * known, 4–8 shows the rest of the band, 3 or fewer twice in a row ends the test: everything after is left unknown.
 */
export function answerScreen(words: PlacementWord[], s: PlacementState, tapped: Iterable<string>, rng = Math.random): PlacementState {
  const marked = new Set(tapped);
  const unknown = s.screen.filter((w) => marked.has(w));
  const knew = s.screen.filter((w) => !marked.has(w));
  let next: PlacementState = { ...s, screens: s.screens + 1, unknown: [...s.unknown, ...unknown], known: [...s.known, ...knew] };
  if (s.phase === 'rest') {
    const rest = s.rest.slice(s.screen.length);
    return rest.length ? { ...next, screen: rest.slice(0, SCREEN), rest } : enterBand(words, next, s.band + 1, rng);
  }
  const score = Math.round((knew.length * SCREEN) / Math.max(1, s.screen.length));
  const shown = new Set(s.screen);
  const others = bandOf(words, s.band).filter((w) => !shown.has(w));
  if (score >= 9) return enterBand(words, { ...next, low: 0, known: [...next.known, ...others] }, s.band + 1, rng);
  if (score >= 4) {
    next = { ...next, low: 0 };
    return others.length ? { ...next, phase: 'rest', screen: others.slice(0, SCREEN), rest: others } : enterBand(words, next, s.band + 1, rng);
  }
  next = { ...next, low: s.low + 1 };
  return next.low >= 2 ? { ...next, screen: [], rest: [], done: true } : enterBand(words, next, s.band + 1, rng);
}

/** The test result in placement order, so known.yaml reads from the most frequent words down. */
export function placementResult(words: PlacementWord[], s: PlacementState, today: string): KnownWords {
  const known = new Set(s.known);
  return { tested: today, words: words.map((w) => w.en).filter((w) => known.has(w)), unknown: [...s.unknown] };
}

export function knownYaml(known: KnownWords): string {
  const doc: Record<string, unknown> = {};
  if (known.tested) doc.tested = known.tested;
  doc.words = known.words;
  if (known.unknown?.length) doc.unknown = known.unknown;
  return YAML.stringify(doc, { lineWidth: 0 });
}

/** Dictionary form of a word as the placement list names it (went → go, cities → city); the word itself otherwise. */
export function lemmaOf(placement: PlacementWord[] | undefined, word: string): string {
  const forms = baseForms(word);
  for (const f of forms) {
    const hit = placement?.find((p) => p.en.toLowerCase() === f || p.forms?.some((x) => x.toLowerCase() === f));
    if (hit) return hit.en;
  }
  return forms[0];
}

export function withKnown(known: KnownWords, lemmas: string[]): KnownWords {
  const add = lemmas.filter((w) => w && !known.words.includes(w));
  const unknown = known.unknown?.filter((w) => !lemmas.includes(w));
  return { ...known, words: [...known.words, ...new Set(add)], ...(unknown ? { unknown } : {}) };
}
