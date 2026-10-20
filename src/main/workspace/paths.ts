import { rename, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

/** The absolute path of `rel` inside the workspace. Anything that would land outside it throws. */
export function insideRoot(root: string, rel: string): string {
  const base = resolve(root);
  if (isAbsolute(rel)) throw new Error('Path outside workspace');
  const abs = resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + sep)) throw new Error('Path outside workspace');
  return abs;
}

/** Writes beside the file, then renames over it, so a reader never sees half a file. */
export async function writeFileAtomic(abs: string, text: string): Promise<void> {
  const tmp = `${abs}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, abs);
}

/** Relative paths in the app always use '/', whatever the computer uses. */
export const toPosix = (rel: string) => rel.split(sep).join('/');
