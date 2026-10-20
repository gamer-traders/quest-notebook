/** What an empty title is called on disk and on screen. */
export const UNTITLED = 'Untitled';

const MAX_LENGTH = 120;

/**
 * A title made safe as a file or folder name on macOS, Windows and Linux: path and reserved characters
 * become '-', control characters go, and it never starts with a dot, which would hide it.
 */
export function safeName(title: string): string {
  const cleaned = title
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\:*?"<>|]/g, '-')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  const cut = cleaned.slice(0, MAX_LENGTH).replace(/[. ]+$/, '').trim();
  return cut === '' ? UNTITLED : cut;
}

/** What makes two names the same file on macOS and Windows: case and the way accents are stored don't count. */
export const nameKey = (name: string) => name.normalize('NFC').toLowerCase();

/** `base`, or `base 2`, `base 3`, … whichever no sibling has. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(nameKey));
  if (!used.has(nameKey(base))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!used.has(nameKey(candidate))) return candidate;
  }
}
