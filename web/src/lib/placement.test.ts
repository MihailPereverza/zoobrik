import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { answerScreen, knownYaml, lemmaOf, placementResult, startPlacement, withKnown, type PlacementState } from './placement';
import type { PlacementWord } from './types';

const words: PlacementWord[] = Array.from({ length: 450 }, (_, i) => ({ en: `w${i}`, ru: `с${i}` }));
const rng = () => 0.5;

/** Answers screens with `unknownOf(word)` deciding each tap, until the test ends. */
function run(unknownOf: (w: string) => boolean) {
  let s: PlacementState = startPlacement(words, rng);
  const screens: string[][] = [];
  while (!s.done) { screens.push(s.screen); s = answerScreen(words, s, s.screen.filter(unknownOf), rng); }
  return { s, screens };
}
const rank = (w: string) => Number(w.slice(1));

describe('placement test', () => {
  it('samples 10 words of the first band', () => {
    const s = startPlacement(words, rng);
    expect(s.screen).toHaveLength(10);
    expect(s.screen.every((w) => rank(w) < 100)).toBe(true);
  });

  it('counts a whole band as known after 9–10 known in the sample, minus the tapped words', () => {
    const s0 = startPlacement(words, rng);
    const s1 = answerScreen(words, s0, [s0.screen[0]], rng);
    expect(s1.band).toBe(1);
    expect(s1.phase).toBe('sample');
    expect(s1.known).toHaveLength(99);
    expect(s1.unknown).toEqual([s0.screen[0]]);
  });

  it('shows the rest of a band screen by screen after 4–8 known', () => {
    const s0 = startPlacement(words, rng);
    const s1 = answerScreen(words, s0, s0.screen.slice(0, 4), rng);
    expect(s1.phase).toBe('rest');
    expect(s1.band).toBe(0);
    expect(s1.screen.some((w) => s0.screen.includes(w))).toBe(false);
    let s = s1;
    for (let i = 0; i < 9; i++) s = answerScreen(words, s, [], rng);
    expect(s.band).toBe(1);
    expect(s.known).toHaveLength(96);
    expect(s.unknown).toHaveLength(4);
  });

  it('stops after two bands in a row with 3 or fewer known, leaving the rest unknown', () => {
    const { s, screens } = run((w) => rank(w) >= 200);
    expect(s.done).toBe(true);
    expect(screens).toHaveLength(4);
    expect(s.known.filter((w) => rank(w) >= 200)).toHaveLength(0);
    expect(s.known).toHaveLength(200);
  });

  it('keeps going after a single weak band', () => {
    const { s } = run((w) => rank(w) >= 100 && rank(w) < 200);
    expect(s.done).toBe(true);
    expect(s.known.filter((w) => rank(w) >= 200)).toHaveLength(250);
  });

  it('ends on the last, shorter band', () => {
    const { s, screens } = run(() => false);
    expect(screens).toHaveLength(5);
    expect(s.known).toHaveLength(450);
  });

  it('writes known.yaml in placement order', () => {
    const { s } = run((w) => rank(w) % 2 === 1 && rank(w) < 100);
    const known = placementResult(words, s, '2026-10-07');
    expect(known.words.slice(0, 3)).toEqual(['w0', 'w2', 'w4']);
    expect(YAML.parse(knownYaml(known))).toEqual(known);
    expect(knownYaml(known)).toMatch(/^tested: 2026-10-07\n/);
  });
});

describe('known words', () => {
  const placement: PlacementWord[] = [{ en: 'go', ru: 'идти', forms: ['went', 'gone'] }, { en: 'city', ru: 'город' }];

  it('maps a tapped form to its placement lemma', () => {
    expect(lemmaOf(placement, 'Went')).toBe('go');
    expect(lemmaOf(placement, 'cities')).toBe('city');
    expect(lemmaOf(placement, 'scarves')).toBe('scarves');
  });

  it('adds words once and takes them off the unknown list', () => {
    const k = withKnown({ words: ['go'], unknown: ['city', 'scarf'] }, ['city', 'go', 'city']);
    expect(k).toEqual({ words: ['go', 'city'], unknown: ['scarf'] });
  });
});
