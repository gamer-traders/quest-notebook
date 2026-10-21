import { mkdir, readFile, rmdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FileChange, UndoResult } from '@shared/ipc';
import { insideRoot, writeFileAtomic } from '../workspace/paths';

const readOrNull = (abs: string) => readFile(abs, 'utf8').catch(() => null);

/** Removes the folders above a trashed file while they're empty, stopping below the space folder, which stays unless the turn made it. */
async function removeEmptyParents(root: string, path: string, includeSpace: boolean): Promise<void> {
  const parts = path.split('/');
  for (let depth = parts.length - 1; depth >= (includeSpace ? 1 : 2); depth--) {
    try {
      await rmdir(insideRoot(root, parts.slice(0, depth).join('/')));
    } catch {
      return;
    }
  }
}

/**
 * Puts each file back as it was before the turn: its old text, or the Trash for a file the turn created.
 * A file that no longer holds what the turn left is a conflict, and is left alone unless `force`.
 */
export async function undoChanges(root: string, changes: FileChange[], opts: { force: boolean; trash(abs: string): Promise<void> }): Promise<UndoResult> {
  const result: UndoResult = { undone: [], conflicts: [] };
  // Every path is checked first, so a bad one throws before anything is written.
  const targets = changes.map((change) => ({ change, abs: insideRoot(root, change.path) }));
  for (const { change, abs } of targets) {
    const current = await readOrNull(abs);
    if (!opts.force && current !== change.after) {
      result.conflicts.push(change.path);
      continue;
    }
    if (change.before === null) {
      if (current === null) continue;
      await opts.trash(abs);
      await removeEmptyParents(root, change.path, change.newSpace === true);
    } else {
      await mkdir(dirname(abs), { recursive: true });
      await writeFileAtomic(abs, change.before);
    }
    result.undone.push(change.path);
  }
  return result;
}
