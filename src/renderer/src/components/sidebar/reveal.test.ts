import { describe, expect, test } from 'vitest';
import { revealKey, shouldReveal } from './reveal';

describe('shouldReveal', () => {
  test('the first draw after the app loads reveals nothing, so rows collapsed last time stay collapsed', () => {
    expect(shouldReveal(null, revealKey('p', ['a', 'b']))).toBe(false);
  });

  test('a page that opens is revealed', () => {
    expect(shouldReveal(revealKey('x', []), revealKey('p', ['a', 'b']))).toBe(true);
  });

  test('a page opened from search is revealed when the tree comes back, though the tree was not drawn meanwhile', () => {
    // Before the search the tree last revealed x. The hit opened p, and the tree is drawn again on clearing the query.
    const beforeSearch = revealKey('x', []);
    expect(shouldReveal(beforeSearch, revealKey('p', ['a', 'b']))).toBe(true);
  });

  test('the open page moving under other pages is revealed', () => {
    expect(shouldReveal(revealKey('p', ['a']), revealKey('p', ['c', 'a']))).toBe(true);
  });

  test('nothing changed reveals nothing, so a parent collapsed by hand stays collapsed', () => {
    expect(shouldReveal(revealKey('p', ['a', 'b']), revealKey('p', ['a', 'b']))).toBe(false);
  });
});
