/*
  An embed: a piece of the web on a page. Either HTML written into the page, with its own CSS and scripts, or a
  web page shown by its address. It shows in a frame of its own, which can't reach the app or the workspace.
*/

export const EMBED_HEIGHT = 400;
export const MIN_EMBED_HEIGHT = 80;
export const MAX_EMBED_HEIGHT = 4000;

/** A height as the page keeps it: whole pixels, within reach. Anything else is the usual height. */
export function embedHeight(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_EMBED_HEIGHT && value <= MAX_EMBED_HEIGHT ? Math.round(value) : EMBED_HEIGHT;
}

/**
 * The address a web page embed may show, or null. Only http and https pages: a file, a script or the app's own
 * pages (`appOrigin`) would run with the reach of the app.
 */
export function showableUrl(text: string, appOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.origin === appOrigin ? null : url.href;
}
