import { describe, expect, it } from 'vitest';
import { parseVerdict } from './ai';
import { check } from './check';
import { parseMdExercise } from './md';

describe('AI verdicts', () => {
  it('reads JSON wrapped in prose or code fences', () => {
    expect(parseVerdict('Sure!\n```json\n{"verdict":"partly","feedback":"Почти","corrected":"She is wearing a dress."}\n```')).toEqual({ verdict: 'partly', feedback: 'Почти', corrected: 'She is wearing a dress.' });
  });
  it('rejects replies without a known verdict', () => {
    expect(parseVerdict('{"verdict":"maybe"}')).toBeNull();
    expect(parseVerdict('no json here')).toBeNull();
  });
});

describe('order events', () => {
  const md = parseMdExercise('Put in order.\n\n[[order: Anna eats lunch · Keyana joins them · Ashley leaves]]', (f) => f);
  it('parses phrases and checks the exact order', () => {
    expect(md.kind).toBe('order');
    expect(md.order).toEqual(['Anna eats lunch', 'Keyana joins them', 'Ashley leaves']);
    const ex = { id: 'o', template: 'md', status: 'ready' as const, params: {} };
    expect(check(ex, { id: 'md', check: { type: 'md' } }, { tokens: ['Anna eats lunch', 'Keyana joins them', 'Ashley leaves'] }, md).correct).toBe(true);
    expect(check(ex, { id: 'md', check: { type: 'md' } }, { tokens: ['Keyana joins them', 'Anna eats lunch', 'Ashley leaves'] }, md).correct).toBe(false);
  });
});
