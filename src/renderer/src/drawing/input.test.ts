import { expect, test } from 'vitest';
import { startsStroke } from './input';

const down = (patch: Partial<Parameters<typeof startsStroke>[0]> = {}) => ({ pointerType: 'pen', isPrimary: true, button: 0, buttons: 1, ...patch });

test('the pen, the mouse or a finger starts a stroke with the main button', () => {
  expect(startsStroke(down(), false)).toBe(true);
  expect(startsStroke(down({ pointerType: 'mouse' }), false)).toBe(true);
  expect(startsStroke(down({ pointerType: 'touch' }), false)).toBe(true);
});

test('the pen’s eraser end starts an erase', () => {
  expect(startsStroke(down({ button: 5, buttons: 32 }), false)).toBe(true);
});

test('a second pointer, such as a palm on the tablet, never interrupts a stroke', () => {
  expect(startsStroke(down({ pointerType: 'touch', isPrimary: false }), false)).toBe(false);
  expect(startsStroke(down({ pointerType: 'touch' }), true)).toBe(false);
});

test('other buttons start nothing', () => {
  expect(startsStroke(down({ pointerType: 'mouse', button: 2, buttons: 2 }), false)).toBe(false);
});
