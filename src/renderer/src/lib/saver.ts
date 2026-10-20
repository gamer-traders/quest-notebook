/**
 * Saves a burst of changes once, `delayMs` after the last one.
 * `flush` saves a pending change straight away, for when the page is about to go.
 */
export function createSaver(save: () => void, delayMs: number): { schedule(): void; flush(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    save();
  };

  return {
    schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flush,
  };
}
