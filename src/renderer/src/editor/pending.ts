/**
 * Pages whose editor holds words not yet handed to the store: it waits a moment after typing stops. A change
 * on disk to one of them waits too, so it can't replace what's being typed. Before the window closes or the
 * workspace switches, every open editor hands its words over.
 */
const typing = new Set<string>();
const flushers = new Map<string, Set<() => void>>();

export const unsavedEditors = {
  mark: (notebookId: string) => void typing.add(notebookId),
  clear: (notebookId: string) => void typing.delete(notebookId),
  ids: (): Set<string> => new Set(typing),
  /** An open editor's way to hand over its words. Returns a function that forgets it. */
  register(notebookId: string, flush: () => void): () => void {
    const set = flushers.get(notebookId) ?? new Set();
    set.add(flush);
    flushers.set(notebookId, set);
    return () => {
      set.delete(flush);
      if (set.size === 0) flushers.delete(notebookId);
    };
  },
  /** Every open editor hands its waiting words to the store now. */
  flushAll(): void {
    for (const set of flushers.values()) for (const flush of set) flush();
  },
};
