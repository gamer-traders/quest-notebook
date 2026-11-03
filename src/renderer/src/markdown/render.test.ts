// @vitest-environment jsdom
import { expect, test } from 'vitest';
import type { MarkdownFile, Notebook } from '../types';
import { linkTarget, renderMarkdown } from './render';

const parse = (html: string) => {
  const box = document.createElement('div');
  box.innerHTML = html;
  return box;
};

test('Markdown shows as HTML: headings, lists, tables, code and links', () => {
  const doc = parse(renderMarkdown('# Title\n\n- one\n- [x] two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`code` and [the site](https://example.com)'));
  expect(doc.querySelector('h1')?.textContent).toBe('Title');
  expect(doc.querySelectorAll('li')).toHaveLength(2);
  expect(doc.querySelector('input[type="checkbox"]')).not.toBeNull();
  expect(doc.querySelector('table td')?.textContent).toBe('1');
  expect(doc.querySelector('code')?.textContent).toBe('code');
  expect(doc.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
});

test('nothing in a Markdown file can run in the app', () => {
  const doc = parse(
    renderMarkdown('<script>alert(1)</script>\n\n<img src="x.png" onerror="alert(2)">\n\n<a href="javascript:alert(3)">x</a>\n\n<iframe src="https://example.com"></iframe>\n\n[y](javascript:alert(4))'),
  );
  expect(doc.querySelector('script')).toBeNull();
  expect(doc.querySelector('iframe')).toBeNull();
  expect(doc.querySelector('img')?.getAttribute('onerror')).toBeNull();
  for (const a of doc.querySelectorAll('a')) expect(a.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
});

test('[[links]] name a page or another Markdown file, with words of their own after a |', () => {
  const doc = parse(renderMarkdown('See [[Weekly levels]] and [[Plan|the plan]]. `[[not a link]]`'));
  const links = [...doc.querySelectorAll('a[data-wikilink]')].map((a) => [a.getAttribute('data-wikilink'), a.textContent]);
  expect(links).toEqual([
    ['Weekly levels', 'Weekly levels'],
    ['Plan', 'the plan'],
  ]);
  expect(doc.querySelector('code')?.textContent).toBe('[[not a link]]');
});

const page = (id: string, title: string): Notebook => ({ id, title, spaceId: 'sm', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [], items: {} });
const md = (path: string): MarkdownFile => ({ id: `md:${path}`, path, spaceId: 'sm', parentId: null, text: '' });
const from = md('Markets/Ideas/Today.md');
const files = [from, md('Markets/Ideas/Plan.md'), md('Markets/Plan.md'), md('Markets/Notes on BTC.md')];
const pages = [page('w', 'Weekly levels'), page('p', 'Plan')];

test.each([
  ['a page by its title, in any case', { wikilink: 'weekly LEVELS' }, { open: 'w' }],
  ['a Markdown file beside this one, before a page of that name', { wikilink: 'Plan' }, { open: 'md:Markets/Ideas/Plan.md' }],
  ['a Markdown file anywhere, by its name', { wikilink: 'Notes on BTC' }, { open: 'md:Markets/Notes on BTC.md' }],
  ['a Markdown file by its path from here', { href: '../Plan.md' }, { open: 'md:Markets/Plan.md' }],
  ['a file name with spaces written for the web', { href: '../Notes%20on%20BTC.md' }, { open: 'md:Markets/Notes on BTC.md' }],
  ['a web page', { href: 'https://example.com/a' }, { web: 'https://example.com/a' }],
  ['a page that isn’t there', { wikilink: 'Nowhere' }, null],
  ['a file that isn’t a Markdown file here', { href: 'chart.png' }, null],
])('a link to %s', (_, link, want) => {
  expect(linkTarget(link, from, pages, files)).toEqual(want);
});
