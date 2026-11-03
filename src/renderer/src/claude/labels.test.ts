import { expect, test } from 'vitest';
import type { ChatAction } from '@shared/ipc';
import { actionLabel } from './labels';

const titles: Record<string, string> = { 'Markets/A.json': 'A', 'Markets/B.json': 'B *bold*' };
const titleOf = (p: string) => titles[p] ?? null;
const label = (a: ChatAction) => actionLabel(a, titleOf);

test('read, edited and created name the page', () => {
  expect(label({ verb: 'read', path: 'Markets/A.json' })).toEqual({ text: 'Read', target: 'A', refused: false });
  expect(label({ verb: 'edited', path: 'Markets/A.json' })).toEqual({ text: 'Edited', target: 'A', refused: false });
  expect(label({ verb: 'created', path: 'Markets/B.json' })).toEqual({ text: 'Created', target: 'B *bold*', refused: false });
});

test('searched and other use the detail', () => {
  expect(label({ verb: 'searched', detail: 'gold' })).toEqual({ text: 'Searched for “gold”', target: null, refused: false });
  expect(label({ verb: 'other', detail: 'Listed files' })).toEqual({ text: 'Listed files', target: null, refused: false });
  expect(label({ verb: 'other' })).toEqual({ text: 'Used a tool', target: null, refused: false });
});

test('a drawing belongs to its folder\'s page', () => {
  expect(label({ verb: 'edited', path: 'Markets/A/drawing-x.svg' })).toEqual({ text: 'Drew in', target: 'A', refused: false });
  expect(label({ verb: 'created', path: 'Markets/A/drawing-x.svg' })).toEqual({ text: 'Drew in', target: 'A', refused: false });
  expect(label({ verb: 'read', path: 'Markets/A/drawing-x.svg' })).toEqual({ text: 'Looked at a drawing in', target: 'A', refused: false });
});

test('an unknown path shows itself; with no path the detail is the target', () => {
  expect(label({ verb: 'read', path: 'Nowhere/Z.json' }).target).toBe('Nowhere/Z.json');
  expect(label({ verb: 'read', detail: '/etc/hosts' })).toEqual({ text: 'Read', target: '/etc/hosts', refused: false });
  expect(label({ verb: 'read' }).target).toBeNull();
});

test('refused is copied', () => {
  expect(label({ verb: 'edited', path: 'Markets/A.json', refused: true }).refused).toBe(true);
});
