// @vitest-environment jsdom
// PagePath.tsx imports the store, which needs a localStorage.
import { describe, expect, it } from 'vitest';
import { foldedLabel, shortenPath } from './PagePath';

describe('shortenPath', () => {
  it('collapses the middle ancestors on a narrow screen', () => {
    expect(shortenPath(['S', 'A', 'B', 'C', 'Page'], true)).toEqual(['S', '…', 'Page']);
  });
  it('keeps a short path as it is', () => {
    expect(shortenPath(['S', 'A', 'Page'], true)).toEqual(['S', 'A', 'Page']);
  });
  it('leaves a wide screen alone', () => {
    expect(shortenPath(['S', 'A', 'B', 'C', 'Page'], false)).toEqual(['S', 'A', 'B', 'C', 'Page']);
  });
});

describe('foldedLabel', () => {
  const parts = ['Markets', 'Coins', 'Altcoins', 'Solana notes', 'Weekly levels'];
  it('names every folded ancestor, the direct parent too', () => {
    expect(shortenPath(parts, true)).toEqual(['Markets', '…', 'Weekly levels']);
    expect(foldedLabel(parts, true)).toBe('Coins › Altcoins › Solana notes');
  });
  it('is empty when nothing is folded', () => {
    expect(foldedLabel(parts, false)).toBe('');
    expect(foldedLabel(['Markets', 'Coins', 'Weekly levels'], true)).toBe('');
  });
});
