import { describe, expect, it } from 'vitest';
import { CORE } from './core';
import { teachingSteps } from './curriculum';
import { cardWaits, grammarLocked, grammarReport, rulesUsed, sentences } from './grammar';
import { buildSession, topicIsOpen } from './scheduler';
import type { Card, DeckData, Exercise, Progress, Topic } from './types';

const PC = "\\b(?:am|is|are|'m|'s|'re)\\s+(?!interesting\\b)[a-z]{2,}ing\\b";
const ex = (id: string, params: Record<string, any>, more: Partial<Exercise> = {}): Exercise =>
  ({ id, template: 'cloze-type', skill: 'context', status: 'ready', params: { answer: 'x', ...params }, ...more });

const learnedProgress = (): Progress => ({ stage: 'review', introduced: '2026-05-01', learned: '2026-05-01', totals: { answers: 1, correct: 1, lapses: 0 }, skills: {}, exercises: {}, recent: [] });
const introducedProgress = (): Progress => ({ stage: 'learning', introduced: '2026-05-01', totals: { answers: 0, correct: 0, lapses: 0 }, skills: {}, exercises: {}, recent: [] });

function card(topic: string, id: string, exercises: Exercise[], more: Partial<Card> = {}): Card {
  return { id, kind: 'word', topic, path: `topics/${topic}/${id}`, content: { term: id, meaning: id, examples: [] }, theory: null, exercises, templates: [], ...more };
}

function deck(): { data: DeckData; rule: Card; word: Card; clip: Card } {
  const rule = card('grammar-pc', 'pc-form', [ex('g1', { text: 'She ___ a coat.', answer: 'is wearing' })], { kind: 'grammar', detect: [PC] });
  const word = card('clothes', 'coat', [
    ex('e1', { text: 'This is my ___.', answer: 'coat' }),
    ex('e2', { text: 'She is ___ a coat.', answer: 'wearing' }),
    ex('e3', { text: 'The film is ___.', answer: 'interesting' }),
    ex('e4', { text: "She's ___ a coat.", answer: 'wearing' }, { allow_rules: ['pc-form'] }),
  ]);
  const clip = card('listening', 'clip', [ex('l1', { text: 'Where is ___?', answer: 'Anna' })], { kind: 'listening', needs: ['pc-form'] });
  const topics: Topic[] = [
    { id: 'clothes', title: 'c', kind: 'vocab', batch: 4, order: ['coat'], cards: [word], exercises: [], templates: [] },
    { id: 'grammar-pc', title: 'g', kind: 'grammar', batch: 1, order: ['pc-form'], cards: [rule], exercises: [], templates: [] },
    { id: 'listening', title: 'l', kind: 'listening', cards: [clip], exercises: [], templates: [] },
  ];
  const data: DeckData = { root: '', deck: { name: 't', limits: { new_cards_per_day: 8, reviews_per_day: 250 }, fsrs: { retention: 0.9 } }, topics, templates: CORE.templates, partials: CORE.partials, baseCss: CORE.baseCss };
  return { data, rule, word, clip };
}

describe('Rule G: grammar prerequisites', () => {
  it('fills gaps with the answer before looking for a construction', () => {
    expect(sentences('She is ___ a coat. Look!', ['wearing'])).toEqual(['She is wearing a coat.', 'Look!']);
  });

  it('locks an exercise that uses a rule not learned yet, and opens it once the rule is learned', () => {
    const { data, rule, word } = deck();
    expect(grammarLocked(data, word, word.exercises[0])).toBe(false);
    expect(grammarLocked(data, word, word.exercises[1])).toBe(true);
    rule.progress = introducedProgress();
    expect(grammarLocked(data, word, word.exercises[1])).toBe(true);
    rule.progress = learnedProgress();
    expect(grammarLocked(data, word, word.exercises[1])).toBe(false);
  });

  it('ignores excluded look-alikes and constructions the author allowed', () => {
    const { data, word } = deck();
    expect(rulesUsed(data, word, word.exercises[2])).toEqual([]);
    expect(rulesUsed(data, word, word.exercises[3])).toEqual([]);
  });

  it('never locks a rule card by its own construction', () => {
    const { data, rule } = deck();
    expect(grammarLocked(data, rule, rule.exercises[0])).toBe(false);
  });

  it('keeps a card with `needs` out until those cards are learned', () => {
    const { data, rule, clip } = deck();
    expect(cardWaits(data, clip)).toBe(true);
    rule.progress = learnedProgress();
    expect(cardWaits(data, clip)).toBe(false);
  });

  it('a new session never asks a locked exercise', () => {
    const { data, word } = deck();
    const asked = buildSession(data, new Date('2026-05-04T09:00:00Z')).queue.filter((q) => q.card === word).map((q) => q.exercise.id);
    expect(asked).not.toContain('e2');
  });

  it('a rule topic that requires another rule topic opens only once that one is learned', () => {
    const { data, rule } = deck();
    const next: Topic = { id: 'grammar-next', title: 'n', kind: 'grammar', requires: ['grammar-pc'], cards: [card('grammar-next', 'n1', [ex('x', {})], { kind: 'grammar' })], exercises: [], templates: [] };
    data.topics.push(next);
    rule.progress = introducedProgress();
    expect(topicIsOpen(data, next)).toBe(false);
    rule.progress = learnedProgress();
    expect(topicIsOpen(data, next)).toBe(true);
  });
});

describe('teaching order and the author report', () => {
  it('puts a rule next to each portion of words, listening last', () => {
    const { data } = deck();
    expect(teachingSteps(data).map((s) => s.map((c) => c.id))).toEqual([['coat', 'pc-form'], ['clip']]);
  });

  it('reports examples shown before their rule and exercises that wait', () => {
    const { data } = deck();
    data.topics[0].cards.push(card('clothes', 'early', [ex('w', { text: 'He is ___ a hat.', answer: 'wearing' })], { content: { term: 'early', examples: [{ id: 'ex1', term: 'He is wearing a hat.', meaning: '' }] } }));
    data.topics[0].order = ['coat', 'early'];
    // Both words come in step 1 with the rule: nothing waits for a later step.
    expect(grammarReport(data).content).toEqual([]);
    // The rule waits for a later topic: the word's example comes before it.
    data.topics.splice(1, 0, { id: 'later', title: 'l', kind: 'vocab', batch: 4, cards: [card('later', 'hat', [])], exercises: [], templates: [] });
    data.topics[2].requires = ['later'];
    const report = grammarReport(data);
    expect(report.content.map((f) => `${f.card} ${f.where}`)).toEqual(['early examples.ex1']);
    expect(report.exercises.map((f) => `${f.card} ${f.where}`)).toEqual(['coat e2', 'early w']);
  });
});
