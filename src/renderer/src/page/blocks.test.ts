import { describe, expect, test } from 'vitest';
import type { CallCell, ChartCell, Notebook, PlanCell } from '../types';
import type { PageBlock } from './blockTypes';
import { backlinksTo, blockText, chartAboveItem, chartBeforeBlock, copiedItems, flattenBlocks, inlineText, itemsUnderChart, linksIn, pruneItems, titleLookup } from './blocks';

const chart = (id: string): ChartCell => ({
  id, type: 'chart', symbol: 'BTCUSDT', interval: '1d', asOf: 0, revealed: false, practice: false, levels: [], trends: [], pins: [],
});
const plan = (id: string): PlanCell => ({ id, type: 'plan', side: 'long', entry: null, stop: null, target: null, reason: '' });
const call = (id: string): CallCell => ({ id, type: 'call', direction: 'up', bars: 5, reason: '' });

const block = (id: string, type: string, content?: unknown, children: PageBlock[] = []): PageBlock => ({ id, type, props: {}, content, children });
const text = (t: string) => ({ type: 'text', text: t, styles: {} });

const nb = (blocks: PageBlock[], items: Notebook['items'] = {}, id = 'n1'): Notebook => ({
  id, title: id, spaceId: 'space-market', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks, items,
});

const fixture = nb(
  [
    block('h', 'heading', [text('Title')]),
    block('para', 'paragraph', [text('Intro')], [block('c1', 'chart')]),
    block('p1', 'tradePlan'),
    block('c2', 'chart'),
    block('k1', 'prediction'),
  ],
  { c1: chart('c1'), p1: plan('p1'), c2: chart('c2'), k1: call('k1'), x9: plan('x9') },
);

const titleOf = (id: string) => (id === 'n2' ? 'Support and resistance' : null);

describe('flattenBlocks', () => {
  test('puts children right after their parent', () => {
    expect(flattenBlocks(fixture.blocks).map((b) => b.type)).toEqual(['heading', 'paragraph', 'chart', 'tradePlan', 'chart', 'prediction']);
  });
});

describe('chartBeforeBlock', () => {
  test('finds the chart before any block', () => {
    expect(chartBeforeBlock(fixture, 'h')).toBeNull();
    expect(chartBeforeBlock(fixture, 'k1')?.id).toBe('c2');
  });
});

describe('chartAboveItem', () => {
  test('uses the nearest chart above in page order', () => {
    expect(chartAboveItem(fixture, 'p1')?.id).toBe('c1');
    expect(chartAboveItem(fixture, 'k1')?.id).toBe('c2');
    const early = nb([block('p0', 'tradePlan'), block('c1', 'chart')], { p0: plan('p0'), c1: chart('c1') });
    expect(chartAboveItem(early, 'p0')).toBeNull();
  });
});

describe('itemsUnderChart', () => {
  test('stops at the next chart', () => {
    expect(itemsUnderChart(fixture, 'c1').map((i) => i.id)).toEqual(['p1']);
    expect(itemsUnderChart(fixture, 'c2').map((i) => i.id)).toEqual(['k1']);
  });
});

describe('pruneItems', () => {
  test('drops data no block refers to', () => {
    expect(Object.keys(pruneItems(fixture).items)).toEqual(['c1', 'p1', 'c2', 'k1']);
  });

  test('returns the same notebook when nothing is unreferenced', () => {
    const clean = pruneItems(fixture);
    expect(pruneItems(clean)).toBe(clean);
  });
});

describe('copiedItems', () => {
  const pasted = (id: string, type: string, itemId: string): PageBlock => ({ id, type, props: { itemId }, content: undefined, children: [] });
  const find = (id: string) => fixture.items[id];

  test('copies the data a pasted block points at, under the new block id', () => {
    const blocks = [...fixture.blocks, block('para2', 'paragraph', [], [pasted('c9', 'chart', 'c1')])];
    expect(copiedItems(blocks, fixture.items, find)).toEqual([{ ...chart('c1'), id: 'c9' }]);
  });

  test('leaves blocks that have data, point at nothing, or point at the wrong kind of data', () => {
    const blocks = [...fixture.blocks, pasted('c8', 'chart', 'gone'), pasted('k8', 'prediction', 'p1')];
    expect(copiedItems(blocks, fixture.items, find)).toEqual([]);
  });
});

describe('inlineText', () => {
  test('reads notebook links by their current title', () => {
    const content = [text('See '), { type: 'notebookLink', props: { notebookId: 'n2' } }, text('.')];
    expect(inlineText(content, titleOf)).toBe('See Support and resistance.');
    expect(inlineText(content, () => null)).toBe('See Deleted notebook.');
  });

  test('reads a notebook link without props as a deleted link', () => {
    const content = [text('See '), { type: 'notebookLink' }, text(' and '), { type: 'notebookLink', props: {} }, text('.')];
    expect(inlineText(content, titleOf)).toBe('See Deleted notebook and Deleted notebook.');
  });
});

describe('blockText', () => {
  test("a text block's words, and a code block's code, which search and the tag list read", () => {
    expect(blockText(block('p', 'paragraph', [text('Levels #btc')]), titleOf)).toBe('Levels #btc');
    const code: PageBlock = { id: 'c', type: 'codeBlock', props: { language: 'python', code: 'stop = 61_800  # #risk\n[[Not a link]]' }, children: [] };
    expect(blockText(code, titleOf)).toBe('stop = 61_800  # #risk\n[[Not a link]]');
    expect(blockText({ ...code, props: { language: 'python' } }, titleOf)).toBe('');
  });
});

describe('titleLookup', () => {
  const pages = [{ ...nb([], {}, 'n2'), title: 'Support and resistance' }, { ...nb([], {}, 'n4'), title: '' }, { ...nb([], {}, 'n5'), title: '   ' }];

  test('reads each page by its title, an untitled one as Untitled, and a missing one as deleted', () => {
    const lookup = titleLookup(pages);
    expect(lookup('n2')).toBe('Support and resistance');
    expect(lookup('n4')).toBe('Untitled');
    expect(lookup('n5')).toBe('Untitled');
    expect(lookup('gone')).toBeNull();
  });

  test('a link to an untitled page reads as Untitled, in its text and its backlink sentence', () => {
    const lookup = titleLookup(pages);
    const content = [text('See '), { type: 'notebookLink', props: { notebookId: 'n4' } }, text('.')];
    expect(inlineText(content, lookup)).toBe('See Untitled.');
    const page = nb([block('b1', 'paragraph', content)], {}, 'n3');
    expect(backlinksTo([page], 'n4', lookup)[0].sentence).toBe('See Untitled.');
  });
});

const linking = (id: string, body: string) =>
  nb([block('b1', 'paragraph', [text(body.split('|')[0]), { type: 'notebookLink', props: { notebookId: 'n2' } }, text(body.split('|')[1])])], {}, id);

describe('linksIn / backlinksTo', () => {
  test('returns the sentence holding the link', () => {
    const page = linking('n3', 'Rough day. Same setup as |, again! Moving on.');
    expect(linksIn(page, titleOf)).toEqual([
      { targetId: 'n2', blockId: 'b1', sentence: 'Same setup as Support and resistance, again!' },
    ]);
    expect(backlinksTo([page], 'n2', titleOf)[0].sentence).toBe('Same setup as Support and resistance, again!');
  });

  test('leaves out the target itself and lists each notebook once', () => {
    const twice = nb(
      [
        block('b1', 'paragraph', [{ type: 'notebookLink', props: { notebookId: 'n2' } }]),
        block('b2', 'paragraph', [{ type: 'notebookLink', props: { notebookId: 'n2' } }]),
      ],
      {},
      'n3',
    );
    const self = linking('n2', 'Me: |.');
    const result = backlinksTo([self, twice], 'n2', titleOf);
    expect(result.map((r) => r.notebook.id)).toEqual(['n3']);
    expect(result[0].blockId).toBe('b1');
  });

  test('a link to a deleted notebook reads as Deleted notebook', () => {
    const page = nb([block('b1', 'paragraph', [text('Old note on '), { type: 'notebookLink', props: { notebookId: 'gone' } }, text('.')])], {}, 'n3');
    expect(linksIn(page, titleOf)).toEqual([{ targetId: 'gone', blockId: 'b1', sentence: 'Old note on Deleted notebook.' }]);
    expect(backlinksTo([page], 'gone', titleOf).map((r) => r.sentence)).toEqual(['Old note on Deleted notebook.']);
  });

  test('a link without props is a deleted link, not an error', () => {
    const page = nb([block('b1', 'paragraph', [text('Broken '), { type: 'notebookLink' }, text('.')])], {}, 'n3');
    expect(linksIn(page, titleOf)).toEqual([{ targetId: '', blockId: 'b1', sentence: 'Broken Deleted notebook.' }]);
    expect(backlinksTo([page], 'n2', titleOf)).toEqual([]);
  });
});
