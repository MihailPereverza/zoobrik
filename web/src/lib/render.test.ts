import { describe, expect, it, vi } from 'vitest';
import { CORE } from './core';
import { render } from './render';
import type { Card, DeckData, Exercise } from './types';

// The frame links fonts from the app's origin.
vi.stubGlobal('location', { origin: 'http://localhost' });

const media = {
  video: 'https://www.playphrase.me/video/eng/m/1.mp4',
  text: 'I get up early in the morning.',
  words: [['I', 0, 100], ['get', 120, 300], ['up', 320, 400], ['early', 420, 700], ['in', 720, 800], ['the', 820, 900], ['morning.', 920, 1400]],
  source: { title: 'Film (2000)', url: 'https://www.imdb.com/title/tt0000001/' },
};

function draw(exercise: Exercise) {
  const card: Card = { id: 'c', kind: 'phrase', topic: 't', path: 'topics/t/c', content: { term: 'in the morning' }, theory: null, exercises: [exercise], templates: [] };
  const data: DeckData = { root: '', deck: { name: 'd', limits: { new_cards_per_day: 8, reviews_per_day: 250 }, fsrs: { retention: 0.9 } }, topics: [{ id: 't', title: 't', cards: [card], exercises: [], templates: [] }], templates: CORE.templates, partials: CORE.partials, baseCss: CORE.baseCss };
  const out = render(data, card, exercise, 'learn', 'pushcha');
  if ('error' in out) throw new Error(out.error);
  return out.html;
}

describe('movie clip templates', () => {
  it('shows the line with a gap, the player and the credit, and keeps the full line for after the answer', () => {
    const html = draw({ id: 'v1', template: 'clip-type', status: 'ready', params: { ...media, gap: 'in the morning', answer: 'in the morning' } });
    expect(html).toContain('I get up early <span class="blank">');
    expect(html).toContain('src="https://www.playphrase.me/video/eng/m/1.mp4#t=0.001"');
    expect(html).not.toContain('autoplay');
    expect(html).toContain('>Film (2000)</a>');
    expect(html).toMatch(/data-zb-back hidden>.*data-at="920"/s);
  });

  it('shows nothing of the line before a dictation is answered', () => {
    const html = draw({ id: 'v2', template: 'clip-type', status: 'ready', params: { ...media, answer: media.text } });
    const front = html.split('data-zb-back')[0];
    expect(front).not.toContain('early');
    expect(front).toContain('data-zb-input');
  });

  it('asks the question with the options', () => {
    const html = draw({ id: 'v3', template: 'clip-choice', status: 'ready', params: { ...media, question: 'Что сказал герой?', answer: media.text, options: [media.text, 'I get up early in the evening.', 'I got up early in the morning.'] } });
    expect(html).toContain('Что сказал герой?');
    expect(html.match(/data-zb-choice=/g)).toHaveLength(3);
  });
});
