import type { FileChange } from '@shared/ipc';

/** Everything Claude changed in one turn, merged per file: where each file started, and where it ended. */
export class TurnChanges {
  private readonly byPath = new Map<string, FileChange>();

  add(changes: FileChange[]): void {
    for (const change of changes) {
      const first = this.byPath.get(change.path);
      const newSpace = first?.newSpace || change.newSpace;
      const merged: FileChange = first ? { ...change, kind: first.kind, before: first.before } : { ...change };
      if (newSpace) merged.newSpace = true;
      else delete merged.newSpace;
      this.byPath.set(change.path, merged);
    }
  }

  /** Sorted by path, without the files that ended up as they began. */
  list(): FileChange[] {
    return [...this.byPath.values()].filter((c) => c.after !== c.before).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
}
