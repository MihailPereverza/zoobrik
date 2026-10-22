import { describe, expect, it } from 'vitest';
import { Feed, shortMeaning, type Pair } from './speed';

describe('speed pairs', () => {
  it('shows the gist of a meaning', () => {
    expect(shortMeaning('редко (книжный синоним rarely)')).toBe('редко');
    expect(shortMeaning('надевать; носить')).toBe('надевать');
    expect(shortMeaning('в середине, посреди')).toBe('в середине, посреди');
  });

  it('never deals a pair whose word or translation is already on the board', () => {
    const pairs: Pair[] = [{ id: 'rarely', en: 'rarely', ru: 'редко' }, { id: 'seldom', en: 'seldom', ru: 'редко' }, { id: 'often', en: 'often', ru: 'часто' }];
    const feed = new Feed(pairs);
    for (let i = 0; i < 20; i++) {
      const board = [pairs[0]];
      expect(feed.next(board)?.id).toBe('often');
    }
    expect(new Feed(pairs.slice(0, 2)).next([pairs[0]])).toBeNull();
  });
});
