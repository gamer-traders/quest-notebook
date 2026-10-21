import { mkdir, readdir, readFile, rename, rmdir, stat } from 'node:fs/promises';
import { formatJson } from '@shared/formatJson';
import { SIDECAR_NAME, type FlushBatch, type FlushResult, type PageSave } from '@shared/ipc';
import { nameKey, safeName, uniqueName } from '@shared/names';
import { insideRoot, writeFileAtomic } from './paths';
import { CONFIG_PATH, isIgnoredName, readConfig, type FileState, type ScanIndex } from './scan';

export interface ApplyDeps {
  /** Moves a file or folder to the system Trash. */
  trash(abs: string): Promise<void>;
  now(): Date;
}

const JSON_EXT = '.json';
const folderOfPage = (path: string) => path.slice(0, -JSON_EXT.length);
/** The page's sub-page folder as it is on disk, which may differ in case from its file's name. */
async function folderOnDisk(root: string, path: string): Promise<string | null> {
  const want = folderOfPage(path);
  const dir = parentDir(want);
  const entries = await readdir(insideRoot(root, dir), { withFileTypes: true }).catch(() => []);
  const hit = entries.find((e) => e.isDirectory() && nameKey(e.name) === nameKey(want.slice(dir.length + 1)));
  return hit ? `${dir}/${hit.name}` : null;
}
const parentDir = (path: string) => path.slice(0, path.lastIndexOf('/'));
const baseOf = (path: string) => folderOfPage(path.slice(path.lastIndexOf('/') + 1));

/**
 * Applies a batch from the window to the workspace folder, and keeps `index` in step, so the next scan
 * finds nothing it didn't expect. Spaces go first, then deletes, then saves, parents before their pages.
 * A save that fails is reported and the rest still apply.
 */
export async function applyFlush(root: string, index: ScanIndex, batch: FlushBatch, deps: ApplyDeps): Promise<FlushResult> {
  const errors: string[] = [];
  const paths: Record<string, string> = {};
  const abs = (rel: string) => insideRoot(root, rel);
  const exists = (rel: string) => stat(abs(rel)).then(() => true, () => false);
  const leftBehind = new Set<string>();

  /** Renames, going through a temporary name when only the case changes, which a case-insensitive disk would skip. */
  const move = async (from: string, to: string) => {
    if (from === to) return;
    if (nameKey(from) === nameKey(to)) {
      const tmp = `${from}.${Date.now()}.tmp`;
      await rename(abs(from), abs(tmp));
      await rename(abs(tmp), abs(to));
    } else {
      await rename(abs(from), abs(to));
    }
  };

  /** Points every index entry under `from/` at `to/` instead. */
  const repoint = (from: string, to: string) => {
    for (const entry of index.pages.values()) if (entry.path.startsWith(`${from}/`)) entry.path = to + entry.path.slice(from.length);
  };

  const dropUnder = (folder: string) => {
    for (const [id, entry] of index.pages) if (entry.path.startsWith(`${folder}/`)) index.pages.delete(id);
  };

  const spaceFolder = new Map<string, string>();
  for (const [folder, id] of index.spaceIds) spaceFolder.set(id, folder);

  // ---- Spaces: made and trashed only when the batch says so ----
  if (batch.spaces.length === 0) errors.push('A workspace keeps at least one space');
  const deletedSpaces = new Set(batch.deletedSpaces);
  const createdSpaces = new Set(batch.createdSpaces);
  for (const id of deletedSpaces) {
    const folder = spaceFolder.get(id);
    if (folder === undefined) continue;
    try {
      if (await exists(folder)) await deps.trash(abs(folder));
      dropUnder(folder);
      index.spaceIds.delete(folder);
      spaceFolder.delete(id);
    } catch (error) {
      errors.push(`Couldn't delete the space “${folder}”: ${message(error)}`);
    }
  }
  for (const space of batch.spaces) {
    if (deletedSpaces.has(space.id)) continue;
    const current = spaceFolder.get(space.id);
    // A space main doesn't know, and wasn't asked to make, changed on disk since the batch was planned.
    if (current === undefined && !createdSpaces.has(space.id)) continue;
    try {
      const taken = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name !== current).map((e) => e.name);
      const name = current !== undefined && safeName(space.name) === current ? current : uniqueName(safeName(space.name), taken);
      if (current === undefined) {
        await mkdir(abs(name));
      } else if (name !== current) {
        await move(current, name);
        repoint(current, name);
        index.spaceIds.delete(current);
      } else continue;
      index.spaceIds.set(name, space.id);
      spaceFolder.set(space.id, name);
    } catch (error) {
      errors.push(`Couldn't update the space “${space.name}”: ${message(error)}`);
    }
  }

  // ---- Deletes: each page's file, and its folder of sub-pages, to the Trash ----
  for (const id of batch.deletes) {
    const entry = index.pages.get(id);
    if (!entry) continue;
    try {
      const folder = (await folderOnDisk(root, entry.path)) ?? folderOfPage(entry.path);
      if (await exists(entry.path)) await deps.trash(abs(entry.path));
      if (await exists(folder)) await deps.trash(abs(folder));
      index.pages.delete(id);
      dropUnder(folder);
      leftBehind.add(parentDir(entry.path));
    } catch (error) {
      errors.push(`Couldn't delete ${entry.path}: ${message(error)}`);
    }
  }

  // ---- Saves ----
  const saving = new Map(batch.saves.map((s) => [s.id, s]));
  const depth = (save: PageSave) => {
    let d = 0;
    for (let p = save.parentId; p && saving.has(p) && d < saving.size; p = saving.get(p)!.parentId) d++;
    return d;
  };
  const ordered = [...batch.saves].sort((a, b) => depth(a) - depth(b));

  for (const save of ordered) {
    try {
      const entry = index.pages.get(save.id);
      // Pictures alone are only redrawn for a page that's on disk.
      if (save.json === undefined && !entry) continue;
      if (entry?.error) throw new Error('Page file is unreadable');
      const space = spaceFolder.get(save.spaceId);
      if (space === undefined) throw new Error(`The space for “${save.title}” isn't in this workspace`);
      let dir = space;
      if (save.parentId) {
        const parent = index.pages.get(save.parentId);
        if (!parent) throw new Error(`The page “${save.title}” sits under a page that isn't on disk`);
        dir = (await folderOnDisk(root, parent.path)) ?? folderOfPage(parent.path);
      }

      // A page needs its name free twice: for its file, and for the folder beside it. Any folder or other file
      // there, such as drawings a page left behind, takes the name too. The page's own file and folder don't.
      const own = entry && parentDir(entry.path) === dir ? nameKey(baseOf(entry.path)) : null;
      const taken = (await exists(dir) ? await readdir(abs(dir)) : [])
        .filter((n) => !isIgnoredName(n))
        .map((n) => (n.toLowerCase().endsWith(JSON_EXT) ? n.slice(0, -JSON_EXT.length) : n))
        .filter((n) => nameKey(n) !== own);
      const name = uniqueName(safeName(save.title), taken);
      const target = `${dir}/${name}${JSON_EXT}`;

      if (!entry) {
        await mkdir(abs(dir), { recursive: true });
      } else if (entry.path !== target) {
        await mkdir(abs(dir), { recursive: true });
        const fromFolder = (await folderOnDisk(root, entry.path)) ?? folderOfPage(entry.path);
        const hasFolder = await exists(fromFolder);
        if (hasFolder && nameKey(fromFolder) !== nameKey(folderOfPage(target)) && (await exists(folderOfPage(target)))) {
          throw new Error(`Couldn't move “${save.title}”: ${folderOfPage(target)} is in the way`);
        }
        await move(entry.path, target);
        if (hasFolder) {
          try {
            await move(fromFolder, folderOfPage(target));
          } catch (error) {
            // The page and its folder stay together: the file goes back where it was.
            await move(target, entry.path);
            throw error;
          }
          repoint(fromFolder, folderOfPage(target));
        }
        leftBehind.add(parentDir(entry.path));
        entry.path = target;
      }

      // Drawing files first: a page that stops holding its strokes is only written once they're safe in their file.
      const sidecars = await writeSidecars(save.id, target, save.sidecars ?? {}, save.removedSidecars ?? []);
      if (save.json !== undefined && entry?.text !== save.json) {
        await writeFileAtomic(abs(target), save.json);
        const info = await stat(abs(target));
        index.pages.set(save.id, { path: target, mtimeMs: info.mtimeMs, size: info.size, text: save.json, sidecars });
      }
      paths[save.id] = target;
    } catch (error) {
      errors.push(message(error));
    }
  }

  /**
   * The page's drawing files, in its folder: written when their text differs, and moved to the Trash when the
   * save names them as removed. They're the drawings themselves, so nothing else is touched or deleted for good.
   */
  async function writeSidecars(id: string, pagePath: string, sidecars: Record<string, string>, removed: string[]): Promise<Record<string, FileState>> {
    const entry = index.pages.get(id);
    const known = { ...(entry?.sidecars ?? {}) };
    const folder = (await folderOnDisk(root, pagePath)) ?? folderOfPage(pagePath);
    const safe = (name: string) => {
      if (SIDECAR_NAME.test(name)) return true;
      errors.push(`Skipped a drawing file with an unsafe name: ${name}`);
      return false;
    };
    const writes = Object.entries(sidecars).filter(([name]) => safe(name));
    if (writes.length) await mkdir(abs(folder), { recursive: true });
    for (const [name, text] of writes) {
      const file = `${folder}/${name}`;
      if (known[name]?.text === text && (await exists(file))) continue;
      if ((await readFile(abs(file), 'utf8').catch(() => null)) !== text) await writeFileAtomic(abs(file), text);
      const info = await stat(abs(file));
      known[name] = { text, mtimeMs: info.mtimeMs, size: info.size };
    }
    for (const name of removed.filter(safe)) {
      const file = `${folder}/${name}`;
      if (await stat(abs(file)).then((info) => info.isFile(), () => false)) await deps.trash(abs(file));
      delete known[name];
      leftBehind.add(folder);
    }
    if (entry) entry.sidecars = known;
    return known;
  }

  // ---- A page folder whose last page left is removed. Space folders stay, even empty. ----
  const spaceFolders = new Set(spaceFolder.values());
  for (const dir of [...leftBehind].sort((a, b) => b.length - a.length)) {
    if (spaceFolders.has(dir)) continue;
    try {
      const entries = await readdir(abs(dir));
      if (entries.length === 0) await rmdir(abs(dir));
    } catch {
      // Already gone, or not empty after all.
    }
  }

  // ---- workspace.json: space order and the journal space ----
  if (batch.spaces.length > 0) {
    try {
      const config = await readConfig(root);
      const journal = batch.journalSpaceId ? spaceFolder.get(batch.journalSpaceId) : undefined;
      const next = formatJson({
        format: 1,
        name: config.name,
        spaces: spaceOrder(batch, index),
        // A journal space the window names but main doesn't know keeps the one on disk.
        journalSpace: batch.journalSpaceId === null ? null : (journal ?? config.journalSpace),
      });
      const current = await readFile(abs(CONFIG_PATH), 'utf8').catch(() => null);
      if (current !== next) {
        await mkdir(abs('.quest'), { recursive: true });
        await writeFileAtomic(abs(CONFIG_PATH), next);
      }
    } catch (error) {
      errors.push(`Couldn't save the workspace settings: ${message(error)}`);
    }
  }

  return { ok: errors.length === 0, ...(errors.length ? { error: errors[0] } : {}), paths };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Space folders in order: those the batch lists, in its order, then any others main knows, as they were. */
export function spaceOrder(batch: FlushBatch, index: ScanIndex): string[] {
  const folderOf = new Map([...index.spaceIds].map(([folder, id]) => [id, folder]));
  const listed = batch.spaces.flatMap((s) => folderOf.get(s.id) ?? []);
  return [...listed, ...[...index.spaceIds.keys()].filter((folder) => !listed.includes(folder))];
}
