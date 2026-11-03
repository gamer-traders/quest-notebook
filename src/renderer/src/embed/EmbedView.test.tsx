// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { EmbedCell, Notebook } from '../types';
import { useStore } from '../store';
import { EmbedView } from './EmbedView';
import { htmlFromEmbedUrl } from '@shared/embedUrl';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

const embed = (patch: Partial<EmbedCell>): EmbedCell => ({ id: 'e1', type: 'embed', kind: 'html', html: '', url: '', height: 300, ...patch });

/** The embed as its block shows it: drawn again from the page each time it changes. */
function Block() {
  const cell = useStore((s) => s.notebooks[0].items.e1 as EmbedCell);
  return <EmbedView notebookId="n1" embed={cell} />;
}

function show(cell: EmbedCell) {
  const page: Notebook = { id: 'n1', title: 'N', spaceId: 'sm', parentId: null, position: 0, createdAt: 0, updatedAt: 0, blocks: [], items: { [cell.id]: cell } };
  useStore.setState({ notebooks: [page] });
  act(() => root.render(<Block />));
}

const frame = () => container.querySelector('iframe');
const sandbox = () => (frame()?.getAttribute('sandbox') ?? '').split(/\s+/).filter(Boolean);
const stored = () => useStore.getState().notebooks[0].items.e1 as EmbedCell;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test('HTML runs its scripts in a frame of its own, which can never reach the app', () => {
  const html = '<p id="x"></p><script>x.textContent = "hi"</script>';
  show(embed({ html }));
  // Its own address, so it isn't held to the app's own content policy, which would stop its scripts.
  expect(htmlFromEmbedUrl(frame()!.getAttribute('src')!)).toBe(html);
  expect(frame()!.hasAttribute('srcdoc')).toBe(false);
  expect(sandbox()).toContain('allow-scripts');
  // With scripts allowed, the app's own origin would let the frame reach into the app.
  expect(sandbox()).not.toContain('allow-same-origin');
  expect(sandbox()).not.toContain('allow-top-navigation');
  expect(frame()!.style.height).toBe('300px');
});

test('a web page shows at its address, as its own site', () => {
  show(embed({ kind: 'url', url: 'https://example.com/chart' }));
  expect(frame()!.getAttribute('src')).toBe('https://example.com/chart');
  expect(sandbox()).toEqual(expect.arrayContaining(['allow-scripts', 'allow-same-origin']));
  expect(sandbox()).not.toContain('allow-top-navigation');
});

test.each([
  ['a script address', 'javascript:alert(1)'],
  ['a file on the computer', 'file:///etc/passwd'],
  ['the app itself', `${location.origin}/index.html`],
  ['words that are no address', 'not a page'],
])('%s is never shown', (_, url) => {
  show(embed({ kind: 'url', url }));
  expect(frame()).toBeNull();
  expect(container.textContent).toContain('http');
});

test('HTML written in the block is shown once it is done, and kept in the page', () => {
  show(embed({}));
  // An empty embed opens ready to write in.
  const box = container.querySelector('textarea')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, '<b>bold</b>');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(stored().html).toBe('');
  const done = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Done')!;
  act(() => done.click());
  expect(stored()).toMatchObject({ kind: 'html', html: '<b>bold</b>' });
});

test('switching to a web page keeps the HTML, so switching back loses nothing', () => {
  show(embed({ html: '<b>kept</b>' }));
  const choose = (label: string) => act(() => [...container.querySelectorAll('button')].find((b) => b.textContent === label)!.click());
  choose('Web page');
  expect(stored()).toMatchObject({ kind: 'url', html: '<b>kept</b>' });
  choose('HTML');
  expect(stored()).toMatchObject({ kind: 'html', html: '<b>kept</b>' });
});
