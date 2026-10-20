import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { forgetWorkspace, readRegistry, touchWorkspace } from './registry';

const file = async () => join(await mkdtemp(join(tmpdir(), 'quest-registry-')), 'workspaces.json');
const at = (minute: number) => new Date(Date.UTC(2026, 9, 20, 12, minute));

test('a missing or broken registry reads as empty', async () => {
  const f = await file();
  expect(await readRegistry(f)).toEqual({ recent: [], last: null });
  await writeFile(f, 'nope');
  expect(await readRegistry(f)).toEqual({ recent: [], last: null });
});

test('opening a workspace puts it first and makes it the last one used', async () => {
  const f = await file();
  await touchWorkspace(f, '/w/a', 'A', at(1));
  await touchWorkspace(f, '/w/b', 'B', at(2));
  const reg = await touchWorkspace(f, '/w/a', 'A renamed', at(3));
  expect(reg).toEqual({
    recent: [
      { path: '/w/a', name: 'A renamed', lastOpened: '2026-10-20T12:03:00.000Z' },
      { path: '/w/b', name: 'B', lastOpened: '2026-10-20T12:02:00.000Z' },
    ],
    last: '/w/a',
  });
  expect(await readRegistry(f)).toEqual(reg);
});

test('ten workspaces are kept', async () => {
  const f = await file();
  for (let i = 0; i < 11; i++) await touchWorkspace(f, `/w/${i}`, `W${i}`, at(i));
  const reg = await readRegistry(f);
  expect(reg.recent).toHaveLength(10);
  expect(reg.recent[0].path).toBe('/w/10');
  expect(reg.recent.some((w) => w.path === '/w/0')).toBe(false);
});

test('forgetting a workspace takes it off the list, and off "last" too', async () => {
  const f = await file();
  await touchWorkspace(f, '/w/a', 'A', at(1));
  await touchWorkspace(f, '/w/b', 'B', at(2));
  expect(await forgetWorkspace(f, '/w/a')).toEqual({ recent: [expect.objectContaining({ path: '/w/b' })], last: '/w/b' });
  expect(await forgetWorkspace(f, '/w/b')).toEqual({ recent: [], last: null });
});
