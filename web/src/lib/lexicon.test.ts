import { describe, expect, it } from 'vitest';
import { cardCoverage, cardLocked, exerciseLocked, exerciseText, lexiconReport, mdText, misspelling, tokens } from './lexicon';
import type { Card, DeckData, Exercise } from './types';

const ex = (id: string, params: Record<string, any>, more: Partial<Exercise> = {}): Exercise => ({ id, template: 'cloze-type', status: 'ready', params, ...more });

function card(id: string, term: string | undefined, exercises: Exercise[], more: Partial<Card> = {}): Card {
  return { id, kind: 'word', topic: 'people', path: `topics/people/${id}`, content: { term, examples: [] }, theory: null, exercises, templates: [], ...more };
}

function deck(cards: Card[], known?: string[]): DeckData {
  return {
    root: '', deck: { name: 't', limits: { new_cards_per_day: 5, reviews_per_day: 100 }, fsrs: { retention: 0.9 } },
    placement: [
      { en: 'be', ru: 'быть', forms: ['am', 'is', 'are', 'was', 'were'] }, { en: 'the', ru: '' }, { en: 'she', ru: '' }, { en: 'he', ru: '' },
      { en: 'go', ru: '', forms: ['went', 'gone'] }, { en: 'do', ru: '' }, { en: 'not', ru: '' }, { en: 'like', ru: '' }, { en: 'it', ru: '' },
      { en: 'thing', ru: '' }, { en: 'very', ru: '' }, { en: 'man', ru: '', forms: ['men'] }, { en: 'of', ru: '' }, { en: 'will', ru: '' }, { en: 'and', ru: '' }, { en: 'to', ru: '' },
    ],
    known: known ? { words: known } : undefined,
    topics: [{ id: 'people', title: 'People', order: cards.map((c) => c.id), cards, exercises: [], templates: [] }],
    templates: [], partials: {}, baseCss: '',
  };
}

const BASE = ['be', 'the', 'she', 'he', 'go', 'do', 'not', 'like', 'it', 'very', 'man', 'of', 'will', 'and', 'to'];
const introduce = (c: Card) => { c.progress = { stage: 'learning', introduced: '2026-10-01', totals: { answers: 0, correct: 0, lapses: 0 }, skills: {}, exercises: {}, recent: [] }; };

describe('text extraction', () => {
  it('keeps latin words and drops numbers, cyrillic and suffix notation', () => {
    expect(tokens('She is 3rd — она 30 лет, a -ing form, \'re here')).toEqual(['She', 'is', 'a', 'form', 'here']);
    expect(tokens("I don't know, it’s Anna's T-shirt.")).toEqual(['I', "don't", 'know', "it's", "Anna's", 'T-shirt']);
  });

  it('reads the question side of a markdown exercise only', () => {
    const md = mdText('Сравни.\n\nTom is [[taller|tall]] than Anna.\n\n[[chips: Where · does | works · do]]\n\n- [x] right\n- [ ] wrong\n\n???\n\nexplanation words');
    const all = [...md.text, ...md.distractors].join(' ');
    expect(all).toContain('taller');
    expect(all).not.toContain('tall ');
    expect(all).not.toContain('explanation');
    expect(md.distractors.join(' ')).toContain('works');
    expect(md.distractors).toContain('wrong');
  });

  it('skips hidden params and adds the from: example', () => {
    const c = card('tall', 'tall', [], { content: { term: 'tall', examples: [{ id: 'ex1', term: 'He is a tall man.', meaning: '' }] } });
    const t = exerciseText(c, ex('e1', { text: 'He is ___.', answer: 'tall', translation: 'Он высокий', explanation: 'secret', options: ['tall', 'high'], audio: 'ex1.mp3' }, { from: 'examples.ex1' }));
    expect(t.text.join(' ')).toContain('He is a tall man.');
    expect(t.text.join(' ')).not.toContain('secret');
    expect(t.distractors).toEqual(['high']);
  });
});

describe('exerciseLocked', () => {
  it('never locks before the placement test', () => {
    const c = card('tall', 'tall', [ex('e1', { text: 'The mountain is ___.' })]);
    expect(exerciseLocked(deck([c]), c, c.exercises[0])).toBe(false);
  });

  it('locks a sentence with a word neither known nor introduced', () => {
    const high = card('high', 'high', []);
    const tall = card('tall', 'tall', [ex('e1', { text: 'He is very ___.', answer: 'tall' }), ex('e2', { text: 'It is not ___, it is high.' })]);
    const data = deck([tall, high], BASE);
    expect(exerciseLocked(data, tall, tall.exercises[0])).toBe(false);
    expect(exerciseLocked(data, tall, tall.exercises[1])).toBe(true);
    introduce(high);
    expect(exerciseLocked(deck([tall, high], BASE), tall, tall.exercises[1])).toBe(false);
  });

  it('knows inflections, irregular forms, contractions and multi-word terms', () => {
    const kind = card('kind-of', 'kind of', [ex('e1', { text: "She doesn't like it, she's kind of tired." })]);
    const tired = card('tired', 'tired', []);
    introduce(tired);
    const data = deck([kind, tired], BASE);
    expect(exerciseLocked(data, kind, kind.exercises[0])).toBe(false);
    const went = card('went', 'shop', [ex('e1', { text: 'The men went to the shops. They won\'t go.' }, { allow: ['they'] })]);
    expect(exerciseLocked(deck([went], BASE), went, went.exercises[0])).toBe(false);
  });

  it('does not take a word of its own for an inflection of another', () => {
    const c = card('x', 'x', [ex('e1', { text: 'She is a thing.' })]);
    expect(exerciseLocked(deck([c], BASE.filter((w) => w !== 'thing')), c, c.exercises[0])).toBe(true);
  });

  it('ignores names and deliberate misspellings among distractors', () => {
    const c = card('go', 'go', [ex('e1', { text: 'Anna and Tom ___.', answer: 'went', options: ['went', 'goed', 'goned'] })]);
    expect(exerciseLocked(deck([c], BASE), c, c.exercises[0])).toBe(false);
  });

  it('honours needs: and allow:', () => {
    const high = card('high', 'high', []);
    const tall = card('tall', 'tall', [ex('e1', { text: 'He is ___.' }, { needs: ['high'] }), ex('e2', { text: 'He is a giant.' }, { allow: ['giant'] })]);
    const data = deck([tall, high], BASE);
    expect(exerciseLocked(data, tall, tall.exercises[0])).toBe(true);
    expect(exerciseLocked(data, tall, tall.exercises[1])).toBe(false);
  });
});

describe('listening coverage', () => {
  const clip = (text: string) => card('clip', undefined, [ex('d1', { answer: 'She was a noble man.' })], {
    kind: 'listening', listening: { media: 'clip.mp3', segments: [{ start: 0, end: 1, text, words: [] }] },
  });

  it('counts running words and locks below the threshold', () => {
    const c = clip('She is not very noble. He is the man.');
    const data = deck([c], BASE);
    expect(cardCoverage(data, c)).toBeCloseTo(8 / 9);
    expect(cardLocked(data, c)).toBe(true);
    data.deck.listening = { min_coverage: 0.8 };
    expect(cardLocked(data, c)).toBe(false);
  });

  it('locks every clip until the placement test is taken, and lets its own exercises use its words', () => {
    const c = clip('She was a noble man.');
    expect(cardLocked(deck([c]), c)).toBe(true);
    expect(cardCoverage(deck([card('w', 'w', [])]), card('w', 'w', []))).toBe(1);
    expect(exerciseLocked(deck([c], BASE), c, c.exercises[0])).toBe(false);
  });
});

describe('author report', () => {
  it('checks each exercise against the cards before it', () => {
    const tall = card('tall', 'tall', [ex('e1', { text: 'It is high, not ___.' })]);
    const high = card('high', 'high', [ex('e1', { text: 'It is not tall, it is ___.' })]);
    const r = lexiconReport(deck([tall, high]), BASE);
    expect(r.findings).toEqual([{ topic: 'people', card: 'tall', exercise: 'e1', words: ['high'], outside: [] }]);
    expect(r.exercises).toBe(2);
  });

  it('lists real unknown words among wrong options apart, but not slips of known words', () => {
    const terms = ['shout', 'child', 'height', 'study', 'write', 'sleep', 'kind', 'interesting', 'fix', 'make', 'usually', 'there'];
    const cards = terms.map((t) => card(t, t, []));
    const go = card('went', 'went', [
      ex('e1', { text: 'She ___ there.', answer: 'went', options: ['went', 'goed', 'rare'] }),
      ex('e2', { text: 'He ___ to.', answer: 'went', options: ['went', 'shoutting', 'childs', 'mans', 'writed', 'interestinger', 'heighth', 'studing', 'studieing', 'fixeing', 'makking'] }),
      ex('e3', { text: 'It is ___.', answer: 'it', extra: ['sleepy', 'kindness', 'usual', 'theme', 'kinda'] }),
    ]);
    const data = deck([...cards, go]);
    for (const w of ['goed', 'shoutting', 'childs', 'mans', 'writed', 'interestinger', 'heighth', 'studing', 'studieing', 'fixeing', 'makking']) expect(misspelling(data, w), w).toBe(true);
    for (const w of ['rare', 'sleepy', 'kindness', 'usual', 'theme', 'kinda']) expect(misspelling(data, w), w).toBe(false);
    const r = lexiconReport(data, [...BASE, ...terms]);
    expect(r.findings).toEqual([]);
    expect(r.distractors.map((f) => [f.exercise, f.words])).toEqual([['e1', ['rare']], ['e3', ['sleepy', 'kindness', 'usual', 'theme', 'kinda']]]);
    expect(exerciseLocked(deck([...cards, go], [...BASE, ...terms]), go, go.exercises[2])).toBe(false);
  });
});
