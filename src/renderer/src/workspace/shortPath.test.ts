import { expect, test } from 'vitest';
import { shortPath, tailPath } from './shortPath';

test('a folder in the home folder is shown from ~', () => {
  expect(shortPath('/Users/abe/Documents/Quest')).toBe('~/Documents/Quest');
  expect(shortPath('/home/abe/quest')).toBe('~/quest');
  expect(shortPath('/Volumes/Data/Quest')).toBe('/Volumes/Data/Quest');
  expect(shortPath('C:\\Users\\abe\\Quest')).toBe('~\\Quest');
});

test('the sidebar shows a long path by its last two folders', () => {
  expect(tailPath('/Users/abe/Documents/Trading/Quest Trading')).toBe('…/Trading/Quest Trading');
  expect(tailPath('/Users/abe/Quest')).toBe('~/Quest');
});
