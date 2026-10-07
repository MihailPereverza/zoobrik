import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { check, levenshtein, matchText, normalize } from './check';
import { parseMdExercise } from './md';
import { patchCardExercise, patchMdExercise, readProgress, splitFrontmatter, withDeckParams, withProgress } from './cardyaml';
import type { Exercise, TemplateManifest } from './types';

const ex = (template: string, params: Record<string, unknown>): Exercise => ({ id: 'e', template, status: 'ready', params });
const m = (type: string): TemplateManifest => ({ id: 't', check: { type } });

describe('normalize and distance', () => {
  it('ignores case, curly apostrophes, extra spaces and final punctuation', () => {
    expect(normalize("  I  can’t   find it. ")).toBe("i can't find it");
    expect(normalize('Where were you born?')).toBe('where were you born');
  });

  it('measures edit distance', () => {
    expect(levenshtein('luggage', 'lugage')).toBe(1);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });

  it('accepts one typo in words of 5+ letters, none in short words', () => {
    expect(matchText('lugage', ['luggage'])).toEqual({ correct: true, typo: true });
    expect(matchText('bal', ['bad'])).toEqual({ correct: false, typo: false });
    expect(matchText('', ['bad'])).toEqual({ correct: false, typo: false });
  });

  it('allows two typos in long answers', () => {
    expect(matchText('of avarage heigt', ['of average height']).correct).toBe(true);
  });
});

describe('check by type', () => {
  it('choice: exact option', () => {
    expect(check(ex('c', { answer: 'багаж' }), m('choice'), { choice: 'багаж' })).toMatchObject({ correct: true, suggested: 3 });
    expect(check(ex('c', { answer: 'багаж' }), m('choice'), { choice: 'вещи' })).toMatchObject({ correct: false, suggested: 1, expected: 'багаж' });
  });

  it('fuzzy: accepts alternatives and flags typos as Hard', () => {
    const e = ex('t', { answer: 'luggage', accept: ['baggage'] });
    expect(check(e, m('fuzzy'), { text: 'Baggage' })).toMatchObject({ correct: true, suggested: 3 });
    expect(check(e, m('fuzzy'), { text: 'lugage' })).toMatchObject({ correct: true, typo: true, suggested: 2 });
    expect(check(e, m('fuzzy'), { text: 'suitcase' })).toMatchObject({ correct: false, suggested: 1 });
  });

  it('exact: no typo tolerance', () => {
    expect(check(ex('t', { answer: 'luggage' }), m('exact'), { text: 'lugage' }).correct).toBe(false);
  });

  it('tokens: word order matters, punctuation placement does not', () => {
    const e = ex('s', { answer: 'Ты ходишь на работу каждый день?', accept: ['Ты каждый день ходишь на работу?'] });
    expect(check(e, m('tokens'), { tokens: ['Ты', 'ходишь', 'на', 'работу', 'каждый', 'день?'] }).correct).toBe(true);
    expect(check(e, m('tokens'), { tokens: ['Ты', 'каждый', 'день?', 'ходишь', 'на', 'работу'] }).correct).toBe(true);
    expect(check(e, m('tokens'), { tokens: ['ходишь', 'Ты', 'на', 'работу', 'каждый', 'день?'] }).correct).toBe(false);
  });

  it('pairs: no mistakes Good, one Hard, more Again', () => {
    expect(check(ex('p', {}), m('pairs'), { mistakes: 0, total: 5 }).suggested).toBe(3);
    expect(check(ex('p', {}), m('pairs'), { mistakes: 1, total: 5 }).suggested).toBe(2);
    expect(check(ex('p', {}), m('pairs'), { mistakes: 3, total: 5 }).suggested).toBe(1);
  });

  it('an exercise-level check overrides the template (inline exercises)', () => {
    const e = { ...ex('inline', {}), check: { type: 'choice', expected: 'a piece of luggage' } };
    expect(check(e, m('none'), { choice: 'a piece of luggage' }).correct).toBe(true);
  });
});

describe('markdown exercises', () => {
  const media = (f: string) => `/deck/x/${f}`;

  it('parses a choice with the correct option marked [x]', () => {
    const md = parseMdExercise('Pick one\n\n- [ ] luggages\n- [x] pieces of luggage\n\n???\n\nUncountable.', media);
    expect(md.kind).toBe('choice');
    expect(md.options).toEqual(['luggages', 'pieces of luggage']);
    expect(md.answer).toBe('pieces of luggage');
    expect(md.back).toContain('Uncountable');
    expect(check(ex('md', {}), m('md'), { choice: 'pieces of luggage' }, md).correct).toBe(true);
  });

  it('parses typed gaps with alternatives and marks each gap', () => {
    const md = parseMdExercise('He [[goes]] to [[work|the office]] every day.', media);
    expect(md.kind).toBe('gaps');
    expect(md.gaps).toEqual([['goes'], ['work', 'the office']]);
    expect(md.front.match(/data-gap=/g)).toHaveLength(2);
    const res = check(ex('md', {}), m('md'), { texts: ['goes', 'school'] }, md);
    expect(res.correct).toBe(false);
    expect(res.marks?.gaps).toEqual([true, false]);
  });

  it('parses a chip builder with distractors', () => {
    const md = parseMdExercise('Build it: [[chips: She · goes · to · work. | go · going]]', media);
    expect(md.kind).toBe('chips');
    expect(md.chips).toEqual({ answer: 'She goes to work.', extra: ['go', 'going'] });
  });

  it('turns !audio() into a play button pointing at the card file', () => {
    const md = parseMdExercise('Listen !audio(ex1.mp3)\n\nWhat did you hear?', media);
    expect(md.kind).toBe('flip');
    expect(md.front).toContain('data-src="/deck/x/ex1.mp3"');
  });
});

describe('card.yaml editing', () => {
  const card = `# comment kept\nid: luggage\nkind: word\ncontent:\n  en: luggage\nexercises:\n  - id: e1\n    template: ru-en-type\n    status: draft\n    params: { prompt: багаж, answer: luggage }\n`;

  it('writes progress and reads it back, keeping comments and other fields', () => {
    const progress = { stage: 'review', totals: { answers: 1, correct: 1, lapses: 0 }, skills: { recall: { state: 'review', s: 3 } }, exercises: {}, recent: [] };
    const out = withProgress(card, progress);
    expect(out).toContain('# comment kept');
    expect(readProgress(out)).toEqual(progress);
    expect(YAML.parse(out).content.en).toBe('luggage');
    expect(readProgress(withProgress(out, { ...progress, stage: 'mastered' })).stage).toBe('mastered');
  });

  it('patches the status and params of one exercise', () => {
    const out = patchCardExercise(card, 'e1', { status: 'ready', params: { prompt: 'багаж', answer: 'luggage', accept: ['baggage'] } });
    const e = YAML.parse(out).exercises[0];
    expect(e.status).toBe('ready');
    expect(e.params.accept).toEqual(['baggage']);
    expect(() => patchCardExercise(card, 'nope', { status: 'off' })).toThrow();
  });

  it('patches markdown exercise frontmatter without touching the body', () => {
    const md = '---\nid: md1\nstatus: draft\n---\nHe [[goes]].\n';
    const out = patchMdExercise(md, { status: 'ready' });
    expect(splitFrontmatter(out).meta).toEqual({ id: 'md1', status: 'ready' });
    expect(splitFrontmatter(out).body).toBe('He [[goes]].\n');
  });

  it('stores optimised FSRS parameters in deck.yaml and can reset them', () => {
    const deck = 'name: English\nfsrs:\n  retention: { recall: 0.9 }\n  params: null\n';
    const withParams = withDeckParams(deck, [0.2, 1.2, 2.3]);
    expect(YAML.parse(withParams).fsrs).toEqual({ retention: { recall: 0.9 }, params: [0.2, 1.2, 2.3] });
    expect(YAML.parse(withDeckParams(withParams, null)).fsrs.params).toBeNull();
  });
});

import { typoLetters } from './typo';
describe('typo letters', () => {
  it('marks the missing letter', () => {
    expect(typoLetters('lugage', 'luggage').filter((l) => l.fix).map((l) => l.ch)).toEqual(['g']);
  });
  it('marks a substituted letter and keeps case of the expected word', () => {
    const out = typoLetters('heigth', 'height');
    expect(out.map((l) => l.ch).join('')).toBe('height');
    expect(out.some((l) => l.fix)).toBe(true);
  });
  it('marks nothing for an exact answer', () => {
    expect(typoLetters('Gate', 'gate').every((l) => !l.fix)).toBe(true);
  });
});

import { contracted, editDistance, setKnownWords } from './check';
describe('Duolingo-style text checking', () => {
  it('treats short and full forms as the same answer', () => {
    expect(contracted("She is wearing a coat")).toBe(contracted("She's wearing a coat"));
    expect(matchText('I do not understand', ["I don't understand."]).correct).toBe(true);
    expect(matchText("I'm not working today", ['I am not working today']).correct).toBe(true);
    expect(matchText('He cannot swim', ["He can't swim"]).correct).toBe(true);
  });

  it('counts an adjacent swap as one typo', () => {
    expect(editDistance('satrt', 'start')).toBe(1);
    expect(matchText('wearnig', ['wearing'])).toEqual({ correct: true, typo: true });
  });

  it('rejects a typo that spells another real word', () => {
    setKnownWords(['quiet', 'their', 'where']);
    expect(matchText('It is quiet good', ['It is quite good']).correct).toBe(false);
    expect(matchText('Look at thier car', ['Look at their car'])).toEqual({ correct: true, typo: true });
    expect(matchText('Where are you?', ['Were are you?']).correct).toBe(false);
    expect(matchText('quiet', ['quite']).correct).toBe(false);
    setKnownWords(['wear', 'carry']);
    expect(matchText('She wears a hat', ['She wear a hat']).correct).toBe(false);
    expect(matchText('carryng', ['carrying']).typo).toBe(true);
    setKnownWords([]);
  });

  it('one slip per word at most', () => {
    expect(matchText('trousres', ['trousers']).typo).toBe(true);
    expect(matchText('trowsres', ['trousers']).correct).toBe(false);
  });

  it('explains a missing or extra small word', () => {
    expect(matchText('I need new pair of jeans', ['I need a new pair of jeans']).note).toBe('пропущено слово «a»');
    expect(matchText('I like the music very much', ['I like music very much']).note).toBe('лишнее слово «the»');
  });
});
