import { expect, test } from 'vitest';
import type { FileBlock } from '@shared/pageFile';
import { AGENT_GUIDE } from '@shared/guide';
import { fileToPage, pageToFile } from './convert';
import { linkWriter } from './links';

// Every block type a page file can hold. A type added to FileBlock but not here fails the typecheck, and then
// this test, until the guide shows it.
const EVERY_TYPE: Record<FileBlock['type'], true> = {
  paragraph: true,
  heading: true,
  bullet: true,
  numbered: true,
  checklist: true,
  quote: true,
  callout: true,
  divider: true,
  code: true,
  chart: true,
  tradePlan: true,
  prediction: true,
  drawing: true,
};

type Block = { type: string; children?: Block[] };
const typesIn = (blocks: Block[]): string[] => blocks.flatMap((b) => [b.type, ...typesIn(b.children ?? [])]);

function example(): { blocks: Block[] } {
  const section = AGENT_GUIDE.split('## Every block, with an example')[1] ?? '';
  const json = /```json\n([\s\S]*?)\n```/.exec(section);
  if (!json) throw new Error('The guide has no example page');
  return JSON.parse(json[1]);
}

test('the guide’s example page holds every block type', () => {
  expect(new Set(typesIn(example().blocks))).toEqual(new Set(Object.keys(EVERY_TYPE)));
});

test('the guide’s example page loads, and saves back exactly as written', () => {
  const page = example();
  const meta = { id: 'k3f9a2x1', spaceId: 'sm', parentId: null, path: 'Markets/Example.json', fileTimeMs: 0, fallbackPosition: 0 };
  const { notebook, repaired } = fileToPage(page, meta, {});
  expect(repaired).toBe(false);
  expect(pageToFile(notebook, linkWriter([notebook], [{ id: 'sm', name: 'Markets' }]))).toEqual(page);
});
