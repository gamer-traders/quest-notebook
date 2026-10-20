import { expect, test } from 'vitest';
import { tagRanges } from '../lib/format';
import { matchClosedLink, matchHighlight } from './inlineRules';

test('matchHighlight finds a closed pair at the cursor', () => {
  expect(matchHighlight('note ==key==')).toEqual({ from: 5, text: 'key' });
});

test('matchHighlight ignores an unclosed pair', () => {
  expect(matchHighlight('a ==b=')).toBeNull();
});

test('matchHighlight ignores empty marks', () => {
  expect(matchHighlight('====')).toBeNull();
});

test('matchClosedLink finds [[words]] closed at the cursor', () => {
  expect(matchClosedLink('held at [[Support and resistance]]')).toEqual({ from: 8, title: 'Support and resistance' });
});

test('matchClosedLink ignores a pair that is not closed, or holds brackets', () => {
  expect(matchClosedLink('held at [[Support]')).toBeNull();
  expect(matchClosedLink('a]]')).toBeNull();
  expect(matchClosedLink('[[a[b]]')).toBeNull();
});

test('tagRanges matches extractTags', () => {
  expect(tagRanges('Break #breakout and #stop-loss, not a#b')).toEqual([
    { from: 6, to: 15 },
    { from: 20, to: 30 },
  ]);
});
