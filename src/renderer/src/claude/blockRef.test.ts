import { expect, test } from 'vitest';
import { formatJson } from '@shared/formatJson';
import type { ChartCell, Notebook, PlanCell } from '../types';
import type { NotebookLinkInline, PageBlock } from '../page/blockTypes';
import { pageToFile } from '../files/convert';
import { blockLabel, blockReference } from './blockRef';

const text = (id: string, type: string, words: PageBlock['content'], children: PageBlock[] = [], props: Record<string, unknown> = {}): PageBlock => ({
  id,
  type,
  props,
  content: typeof words === 'string' ? [{ type: 'text', text: words, styles: {} }] : words,
  children,
});
const item = (id: string, type: string, children: PageBlock[] = []): PageBlock => ({ id, type, props: { itemId: id }, children });

const chart: ChartCell = {
  id: 'c1',
  type: 'chart',
  symbol: 'BTCUSDT',
  interval: '4h',
  asOf: 1730073600,
  revealed: false,
  practice: false,
  levels: [{ id: 'l1', price: 62400, color: 'green', note: 'held three times' }],
  trends: [{ id: 't1', a: { time: 1725580800, price: 52550 }, b: { time: 1728518400, price: 58946 } }],
  pins: [],
};
const plan: PlanCell = { id: 'k1', type: 'plan', side: 'long', entry: 62500, stop: 61800, target: 64000, reason: '' };

const page: Notebook = {
  id: 'pg',
  title: 'Weekly levels',
  spaceId: 's',
  parentId: null,
  position: 0,
  createdAt: 0,
  updatedAt: 0,
  blocks: [
    text('p1', 'paragraph', [
      { type: 'text', text: 'Entry at the ', styles: {} },
      { type: 'text', text: 'weekly', styles: { bold: true } },
      { type: 'text', text: ' open', styles: {} },
    ]),
    text('h1', 'heading', 'Plan', [], { level: 2 }),
    item('c1', 'chart'),
    text('b1', 'bulletListItem', 'Levels', [text('b2', 'bulletListItem', '62,400 held 3 times'), text('b3', 'bulletListItem', '58,900 broke')]),
    // A chart whose data is gone isn't written: the paragraph in it moves up in its place.
    item('gone', 'chart', [text('p9', 'paragraph', 'moved up')]),
    text('l1', 'paragraph', [{ type: 'text', text: 'See ', styles: {} }, { type: 'notebookLink', props: { notebookId: 'w2' } }]),
    item('k1', 'tradePlan'),
  ],
  items: { c1: chart, k1: plan },
};

const linkText = (link: NotebookLinkInline) => (link.props.notebookId === 'w2' ? 'Monday prep' : '?');
const file = pageToFile(page, linkText);
const fileText = formatJson(file);

/** The text appears in the page file just as it is, each line at the block's indent there. */
const inFile = (json: string, depth: number) => {
  const indent = ' '.repeat(4 + 4 * depth);
  expect(fileText).toContain(json.split('\n').map((line) => indent + line).join('\n'));
};

test('a paragraph is its JSON as the page file has it, with where it sits', () => {
  const ref = blockReference(page, ['p1'], linkText)!;
  expect(ref).toEqual({ kind: 'block', pageId: 'pg', title: 'Weekly levels', text: '{ "type": "paragraph", "text": "Entry at the **weekly** open" }', where: 'block 1 of 7' });
  inFile(ref.text, 0);
});

test('a chart is all of its data, as written in the file', () => {
  const ref = blockReference(page, ['c1'], linkText)!;
  expect(JSON.parse(ref.text)).toEqual(file.blocks[2]);
  expect(ref.text.split('\n').length).toBeGreaterThan(3);
  inFile(ref.text, 0);
  expect(ref.where).toBe('block 3 of 7');
});

test('a nested bullet says which block it is inside; its parent brings it along', () => {
  const child = blockReference(page, ['b2'], linkText)!;
  expect(child.text).toBe('{ "type": "bullet", "text": "62,400 held 3 times" }');
  expect(child.where).toBe('inside block 4 of 7');
  inFile(child.text, 1);

  const parent = blockReference(page, ['b1'], linkText)!;
  expect(JSON.parse(parent.text)).toEqual({ type: 'bullet', text: 'Levels', children: [{ type: 'bullet', text: '62,400 held 3 times' }, { type: 'bullet', text: '58,900 broke' }] });
  expect(parent.where).toBe('block 4 of 7');
  inFile(parent.text, 0);
});

test('page links read as the file writes them', () => {
  expect(JSON.parse(blockReference(page, ['l1'], linkText)!.text)).toEqual({ type: 'paragraph', text: 'See [[Monday prep]]' });
});

test('several blocks are one array, in page order, with the range they cover', () => {
  const ref = blockReference(page, ['b1', 'h1', 'c1'], linkText)!;
  expect(JSON.parse(ref.text)).toEqual(file.blocks.slice(1, 4));
  expect(ref.text.startsWith('[\n  {')).toBe(true);
  expect(ref.where).toBe('blocks 2–4 of 7');
  // Inside the brackets, the blocks are laid out as they follow each other in the file.
  const inner = ref.text.split('\n').slice(1, -1);
  expect(fileText).toContain(inner.map((line) => `  ${line}`).join('\n'));

  expect(blockReference(page, ['b2', 'b3'], linkText)!.where).toBe('inside block 4 of 7');
  expect(blockReference(page, ['b3', 'p9'], linkText)!.where).toBe('blocks 4–5 of 7');
  // A block inside one already chosen comes with it, once.
  expect(JSON.parse(blockReference(page, ['b1', 'b2'], linkText)!.text)).toEqual(file.blocks[3]);
});

test('positions count blocks as the file has them: a block moved up out of a chart that is gone counts where it now is', () => {
  expect(file.blocks).toHaveLength(7);
  expect(blockReference(page, ['p9'], linkText)).toMatchObject({ text: '{ "type": "paragraph", "text": "moved up" }', where: 'block 5 of 7' });
  expect(blockReference(page, ['k1'], linkText)!.where).toBe('block 7 of 7');
  // What isn't written, or isn't on the page, can't be asked about.
  expect(blockReference(page, ['gone'], linkText)).toBeNull();
  expect(blockReference(page, ['nope'], linkText)).toBeNull();
  expect(blockReference(page, [], linkText)).toBeNull();
});

test('a code block is sent with its code just as the file has it, and its chip reads the code', () => {
  const code = 'print("hi")\n\tstop = 61_800  \n';
  const withCode: Notebook = { ...page, blocks: [...page.blocks, { id: 'cb', type: 'codeBlock', props: { language: 'python', code }, children: [] }] };
  const ref = blockReference(withCode, ['cb'], linkText)!;
  expect(JSON.parse(ref.text)).toEqual({ type: 'code', language: 'python', code });
  expect(ref.where).toBe('block 8 of 8');
  expect(blockLabel(ref.text)).toBe('Block: print("hi") stop = 61_800');
});

test("an untitled page's blocks name it as the app does", () => {
  expect(blockReference({ ...page, title: ' ' }, ['p1'], linkText)!.title).toBe('Untitled');
});

test("a block's chip reads its first words, or what it is", () => {
  const label = (ids: string[]) => blockLabel(blockReference(page, ids, linkText)!.text);
  expect(label(['p1'])).toBe('Block: Entry at the weekly open');
  expect(label(['l1'])).toBe('Block: See Monday prep');
  expect(label(['c1'])).toBe('Block: trading chart BTCUSDT 4h');
  expect(label(['k1'])).toBe('Block: tradePlan long');
  expect(label(['h1', 'c1'])).toBe('Blocks: Plan');
  expect(blockLabel('{ "type": "paragraph", "text": "" }')).toBe('Block: paragraph');
  expect(blockLabel('{ "type": "divider" }')).toBe('Block: divider');
  expect(blockLabel('{ "type": "code", "language": "text", "code": "x  =\\n 1" }')).toBe('Block: x = 1');
  expect(blockLabel(JSON.stringify({ type: 'quote', text: 'The trend is your friend until the end when it bends' }))).toBe('Block: The trend is your friend until the end w…');
  // Read from a chat file that may be damaged.
  expect(blockLabel('not json')).toBe('Block');
  expect(blockLabel('[]')).toBe('Block');
  expect(blockLabel('7')).toBe('Block');
});
