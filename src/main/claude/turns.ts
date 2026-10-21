import type { FileChange } from '@shared/ipc';

/** Everything Claude changed in one turn, merged per file: where each file started, and where it ended. */
export class TurnChanges {
  private readonly byPath = new Map<string, FileChange>();

  add(changes: FileChange[]): void {
    for (const change of changes) {
      const first = this.byPath.get(change.path);
      this.byPath.set(change.path, first ? { ...change, kind: first.kind, before: first.before } : { ...change });
    }
  }

  /** Sorted by path, without the files that ended up as they began. */
  list(): FileChange[] {
    return [...this.byPath.values()].filter((c) => c.after !== c.before).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
}
