import { expect, test } from 'vitest';
import { DEFAULT_PEN, readPen, writePen } from './penSettings';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

test('with nothing saved, or something unreadable, the pen starts as a medium ink pen on a blank page', () => {
  expect(DEFAULT_PEN).toEqual({ tool: 'pen', size: 1, color: 'ink', background: 'blank' });
  expect(readPen(memory())).toEqual(DEFAULT_PEN);
  const broken = memory();
  broken.setItem('quest-notebook-pen', '{nope');
  expect(readPen(broken)).toEqual(DEFAULT_PEN);
  const odd = memory();
  odd.setItem('quest-notebook-pen', JSON.stringify({ tool: 'brush', size: 7, color: 'blue', background: 'lines' }));
  expect(readPen(odd)).toEqual({ tool: 'pen', size: 1, color: 'blue', background: 'lines' });
  expect(readPen(null)).toEqual(DEFAULT_PEN);
});

test('the pen chosen is remembered', () => {
  const storage = memory();
  writePen(storage, { tool: 'highlighter', size: 2, color: 'yellow', background: 'grid' });
  expect(readPen(storage)).toEqual({ tool: 'highlighter', size: 2, color: 'yellow', background: 'grid' });
});
