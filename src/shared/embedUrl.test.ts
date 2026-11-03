import { expect, test } from 'vitest';
import { EMBED_SCHEME, embedUrl, htmlFromEmbedUrl } from './embedUrl';

test('HTML travels in its embed address, and comes back exactly, whatever it holds', () => {
  const html = '<!doctype html><p id="x">Prix 62 000 € — 🚀</p><script>x.textContent += " & more"</script>';
  const url = embedUrl(html);
  expect(url.startsWith(`${EMBED_SCHEME}://html/`)).toBe(true);
  expect(url).not.toMatch(/[<>"' ]/);
  expect(htmlFromEmbedUrl(url)).toBe(html);
});

test('large HTML travels too', () => {
  const html = `<p>${'x'.repeat(300_000)}</p>`;
  expect(htmlFromEmbedUrl(embedUrl(html))).toBe(html);
});

test.each([
  ['another scheme', 'https://html/abc?h=PHA-'],
  ['no HTML in it', `${EMBED_SCHEME}://html/`],
  ['something that is no address', 'not a url'],
])('an address with %s holds no HTML', (_, url) => {
  expect(htmlFromEmbedUrl(url)).toBeNull();
});
