import { describe, expect, it } from 'vitest';
import { baseForms, lookupGloss } from './gloss';

const map = new Map<string, string>([
  ['kind', 'добрый; вид, тип'], ['kind of', 'типа, немного; вид, тип'], ['tired', 'уставший'], ['wear', 'носить'], ['carry', 'нести'],
  ['in front of', 'перед'], ['front', 'перед, передняя часть'], ['put on', 'надевать'], ['stop', 'останавливать'], ['lie', 'лежать'],
  ["i'm", 'я (есть) — I am'], ['she', 'она'], ['city', 'город'], ['look for', 'искать'], ['at the moment', 'сейчас'],
]);
const words = (s: string) => s.split(' ');

describe('tap to translate', () => {
  it('prefers the longest set phrase around the tapped word', () => {
    expect(lookupGloss(map, words("I'm kind of tired."), 1)).toMatchObject({ phrase: 'kind of', start: 1, length: 2 });
    expect(lookupGloss(map, words('There is a car in front of the house.'), 5)).toMatchObject({ phrase: 'in front of' });
    expect(lookupGloss(map, words('She is kind.'), 2)).toMatchObject({ phrase: 'kind.', ru: 'добрый; вид, тип' });
  });

  it('finds inflected forms by their dictionary form', () => {
    expect(lookupGloss(map, words('She wears a hat.'), 1)?.ru).toBe('носить');
    expect(lookupGloss(map, words('He is carrying a bag.'), 2)?.ru).toBe('нести');
    expect(lookupGloss(map, words('They stopped.'), 1)?.ru).toBe('останавливать');
    expect(lookupGloss(map, words('Why is the dog lying here?'), 4)?.ru).toBe('лежать');
    expect(lookupGloss(map, words('Big cities.'), 1)?.ru).toBe('город');
    expect(lookupGloss(map, words('He puts on his coat.'), 1)).toMatchObject({ phrase: 'puts on', ru: 'надевать' });
    expect(lookupGloss(map, words("I'm looking for my keys."), 2)).toMatchObject({ phrase: 'looking for', ru: 'искать' });
  });

  it('handles contractions and punctuation', () => {
    expect(lookupGloss(map, words("I'm here."), 0)?.ru).toContain('I am');
    expect(lookupGloss(map, words('Look, she’s here.'), 1)?.ru).toBe('она');
    expect(lookupGloss(map, words('I am here at the moment.'), 4)).toMatchObject({ phrase: 'at the moment.' });
  });

  it('returns nothing for unknown words', () => {
    expect(lookupGloss(map, words('Zyxw.'), 0)).toBeNull();
  });

  it('lists base forms for common endings', () => {
    expect(baseForms('running')).toContain('run');
    expect(baseForms('making')).toContain('make');
    expect(baseForms('studies')).toContain('study');
    expect(baseForms("doesn't")).toContain('does');
  });
});
