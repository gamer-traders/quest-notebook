/*
  HTML written into an embed block travels in the address its frame loads. Main answers that address with the HTML
  as a page of its own (main/embedProtocol.ts), so the page isn't held to the app's content policy, which would stop
  its scripts, and nothing is kept anywhere but in the page file.
*/

export const EMBED_SCHEME = 'quest-embed';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** The address a frame loads to show this HTML. */
export const embedUrl = (html: string) => `${EMBED_SCHEME}://html/?h=${toBase64Url(new TextEncoder().encode(html))}`;

/** The HTML an embed address carries, or null for any other address. */
export function htmlFromEmbedUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const h = parsed.protocol === `${EMBED_SCHEME}:` ? parsed.searchParams.get('h') : null;
  if (!h) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(h));
  } catch {
    return null;
  }
}
