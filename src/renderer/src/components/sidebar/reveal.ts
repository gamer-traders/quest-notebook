// When the sidebar tree expands the open page's ancestors, so its row shows.

/** The open page and its ancestors, root first: what a reveal shows. */
export const revealKey = (activeId: string | null, ancestorIds: string[]): string => [activeId ?? '', ...ancestorIds].join(' ');

/**
 * Whether to expand the open page's ancestors. `lastRevealed` is the key last seen, kept outside the tree,
 * since search swaps the tree out: a page opened from a hit is revealed when the tree comes back. It's null
 * only on the first draw after the app loads, which reveals nothing, so rows collapsed last time stay collapsed.
 */
export const shouldReveal = (lastRevealed: string | null, now: string): boolean => lastRevealed !== null && lastRevealed !== now;
