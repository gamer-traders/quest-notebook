import { SIDECAR_NAME, type FileChange } from '@shared/ipc';
import type { RepairedFile } from '../workspace/session';

const byPathOrder = (a: FileChange, b: FileChange) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const isPageFile = (path: string) => /\.json$/i.test(path);
const isDrawingFile = (path: string) => SIDECAR_NAME.test(path.slice(path.lastIndexOf('/') + 1));

/** The page file whose folder holds this drawing file directly, among `pages`. */
function pageOfDrawing(path: string, pages: string[]): string | undefined {
  return pages.find((page) => {
    const folder = `${page.slice(0, -'.json'.length)}/`;
    return path.startsWith(folder) && !path.slice(folder.length).includes('/');
  });
}

/**
 * Recorded changes, moved over the app's own tidy-up of what they left (fields filled in, strokes moved to a drawing
 * file). The owner changed nothing, so it's part of the change:
 * - a file whose recorded `after` is the text the tidy-up started from now ends where the tidy-up left it
 * - a new drawing file the tidy-up made beside such a page is recorded as created, so undo trashes it too
 * Paths in `skip` (those already undone) are left as they are. The changes come back sorted by path, with the drawing
 * files that were added and their page.
 */
export function repairChanges(
  changes: readonly FileChange[],
  files: readonly RepairedFile[],
  skip: ReadonlySet<string> = new Set(),
): { changes: FileChange[]; added: { path: string; page: string }[]; changed: boolean } {
  const byPath = new Map(changes.map((c) => [c.path, c]));
  let changed = false;
  // Pages the turn left exactly as the tidy-up found them.
  const pages: string[] = [];
  for (const file of files) {
    const change = byPath.get(file.path);
    if (file.before === null || !change || skip.has(file.path) || change.after !== file.before) continue;
    if (isPageFile(file.path)) pages.push(file.path);
    if (change.after === file.after) continue;
    byPath.set(file.path, { ...change, after: file.after });
    changed = true;
  }
  const added: { path: string; page: string }[] = [];
  for (const file of files) {
    if (file.before !== null || !isDrawingFile(file.path) || byPath.has(file.path) || skip.has(file.path)) continue;
    const page = pageOfDrawing(file.path, pages);
    if (page === undefined) continue;
    const { pageId, newSpace } = byPath.get(page)!;
    byPath.set(file.path, {
      path: file.path,
      ...(typeof pageId === 'string' ? { pageId } : {}),
      kind: 'created',
      drawing: true,
      ...(newSpace === true ? { newSpace } : {}),
      before: null,
      after: file.after,
    });
    added.push({ path: file.path, page });
    changed = true;
  }
  return { changes: [...byPath.values()].sort(byPathOrder), added, changed };
}

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

  /**
   * The app tidied files as this turn left them (see `repairChanges`): they end where the tidy-up left them. A file that
   * ended up as it began isn't the turn's change, so it's left as it is. Returns the drawing files added, with their page.
   */
  repair(files: readonly RepairedFile[]): { path: string; page: string }[] {
    const { changes, added } = repairChanges(this.list(), files);
    for (const change of changes) this.byPath.set(change.path, change);
    return added;
  }

  /** Sorted by path, without the files that ended up as they began. */
  list(): FileChange[] {
    return [...this.byPath.values()].filter((c) => c.after !== c.before).sort(byPathOrder);
  }
}
