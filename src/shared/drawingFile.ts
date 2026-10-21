/*
  Whether a drawing file is exactly what the app writes: its paper, its background rules, and strokes that each
  carry their data and their drawn outline. Anything else in it (a label, a shape, a path drawn by hand, a
  comment) is someone else's work, which the app moves to the Trash before it writes the drawing over it.
*/

const ELEMENTS = new Set(['svg', 'rect', 'defs', 'pattern', 'path']);

export function isAppMadeDrawing(text: string): boolean {
  if (!/^\s*<svg\b/i.test(text)) return false;
  // Words between the tags are someone's writing.
  if (text.replace(/<[^>]*>/g, '').trim() !== '') return false;
  let inPattern = false;
  let rects = 0;
  for (const m of text.matchAll(/<([!?/]?)([A-Za-z][\w:-]*)?([^>]*)>/g)) {
    const [, mark, name = '', rest] = m;
    const tag = name.toLowerCase();
    // Comments, declarations and anything else that isn't a plain element.
    if (mark === '!' || mark === '?' || !ELEMENTS.has(tag)) return false;
    if (mark === '/') {
      if (tag === 'pattern') inPattern = false;
      continue;
    }
    if (tag === 'pattern') inPattern = !rest.trim().endsWith('/');
    // The app's rects are its paper and its background, the whole drawing in size.
    if (tag === 'rect' && (++rects > 2 || /\s(x|y)\s*=/.test(rest))) return false;
    if (tag === 'path') {
      const hasData = /\sdata-points\s*=/.test(rest);
      const hasOutline = /\sd\s*=/.test(rest);
      // A stroke carries its data and its outline; a path without data is only the background's rule line.
      if (hasData ? !hasOutline : !inPattern) return false;
    }
  }
  return true;
}
