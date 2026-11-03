/*
  Markdown edits on their way to disk. Before the window closes or the workspace switches, every open Markdown file
  saves what's waiting, and the window waits for those saves.
*/

const flushers = new Set<() => Promise<void>>();

export const markdownSaves = {
  /** An open file's way to save what's waiting. Returns a function that forgets it. */
  register(flush: () => Promise<void>): () => void {
    flushers.add(flush);
    return () => void flushers.delete(flush);
  },
  /** Every open Markdown file saves what's waiting, now. */
  async flushAll(): Promise<void> {
    await Promise.allSettled([...flushers].map((flush) => flush()));
  },
};
