// "Copy link for [[ ]]": a page link on the clipboard. Pasted into a page it becomes a link chip;
// pasted anywhere else it is the text [[Title]].

const ATTR = 'data-notebook-link';

const escapeHTML = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The two clipboard forms of a link: '[[Title]]', and the same words in a span tagged with the page's id. */
export function linkClipboard(notebookId: string, title: string): { text: string; html: string } {
  const text = `[[${title}]]`;
  return { text, html: `<span ${ATTR}="${escapeHTML(notebookId)}">${escapeHTML(text)}</span>` };
}

/** The page ids tagged in pasted HTML, in order. */
export function linksInPastedHTML(html: string): string[] {
  if (!html.includes(ATTR)) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll(`[${ATTR}]`)].map((el) => el.getAttribute(ATTR) ?? '').filter((id) => id !== '');
}

/**
 * Puts both forms on the clipboard. Runs inside the click that asked for it: the copy event is the one way
 * every browser takes HTML, and the async clipboard is the fallback.
 */
export async function copyLink(notebookId: string, title: string): Promise<void> {
  const { text, html } = linkClipboard(notebookId, title);
  let copied = false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', text);
    event.clipboardData.setData('text/html', html);
    event.preventDefault();
    copied = true;
  };
  document.addEventListener('copy', onCopy);
  try {
    document.execCommand('copy');
  } catch {
    // Some browsers refuse it outright; the async clipboard below still can.
  } finally {
    document.removeEventListener('copy', onCopy);
  }
  if (copied) return;
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) }),
    ]);
  } else {
    await navigator.clipboard?.writeText(text);
  }
}
