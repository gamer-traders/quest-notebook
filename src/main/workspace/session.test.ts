import { access, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import type { DiskDelta } from '@shared/ipc';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { WorkspaceSession } from './session';

test('a batch meant for another workspace is refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quest-session-'));
  await mkdir(join(root, 'Markets'));
  const session = await WorkspaceSession.open(root, false, { change: () => {}, lost: () => {} }, (abs) => rm(abs, { recursive: true }));
  try {
    const markets = session.snapshot.spaces[0];
    const batch = { spaces: [markets], createdSpaces: [], deletedSpaces: [], journalSpaceId: null, saves: [{ id: 'x', spaceId: markets.id, parentId: null, title: 'X', json: '{}\n', sidecars: {} }], deletes: [] };
    const result = await session.flush({ ...batch, root: '/somewhere/else' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/another workspace/);
    await expect(access(join(root, 'Markets/X.json'))).rejects.toThrow();
    expect((await session.flush({ ...batch, root })).ok).toBe(true);
    await access(join(root, 'Markets/X.json'));
  } finally {
    session.close();
  }
});

test('a workspace folder deleted while open is reported as lost', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'quest-lost-'));
  const root = join(parent, 'ws');
  await mkdir(join(root, 'Markets'), { recursive: true });
  let lost: string | null = null;
  const session = await WorkspaceSession.open(root, false, { change: () => {}, lost: (m) => (lost = m) }, async () => {}, 100);
  try {
    await rm(parent, { recursive: true });
    for (let i = 0; i < 30 && lost === null; i++) await new Promise((r) => setTimeout(r, 50));
    expect(lost).toBe(`Couldn't find ${root}`);
  } finally {
    session.close();
  }
});

test('a save planned before an outside change to that page is refused as stale, and applied once the change was seen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quest-stale-'));
  await mkdir(join(root, 'Markets'));
  await mkdir(join(root, 'Lessons'));
  await writeFile(join(root, 'Markets/A.json'), JSON.stringify({ id: 'a', title: 'A', position: 0, blocks: [] }));
  const deltas: DiskDelta[] = [];
  const session = await WorkspaceSession.open(root, false, { change: (d) => deltas.push(d), lost: () => {} }, async () => {});
  try {
    const markets = session.snapshot.spaces.find((s) => s.name === 'Markets')!;
    const lessons = session.snapshot.spaces.find((s) => s.name === 'Lessons')!;
    await rename(join(root, 'Markets/A.json'), join(root, 'Lessons/A.json'));
    for (let i = 0; i < 60 && deltas.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(deltas[0].seq).toBe(1);

    const stale = { spaces: [markets, lessons], createdSpaces: [], deletedSpaces: [], journalSpaceId: null, deletes: [], seenSeq: 0, saves: [{ id: 'a', spaceId: markets.id, parentId: null, title: 'A', json: '{"id":"a","title":"A","position":0,"blocks":[]}\n', sidecars: {} }] };
    const refused = await session.flush(stale);
    expect(refused.stale).toEqual(['a']);
    await access(join(root, 'Lessons/A.json'));

    const seen = await session.flush({ ...stale, seenSeq: 1, saves: [{ ...stale.saves[0], spaceId: lessons.id, json: '{"id":"a","title":"A","position":1,"blocks":[]}\n' }] });
    expect(seen).toMatchObject({ ok: true, paths: { a: 'Lessons/A.json' } });
    expect(seen.stale ?? []).toEqual([]);
  } finally {
    session.close();
  }
});

test('saving into a workspace whose folder is gone re-creates nothing and reports it lost', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'quest-gone-'));
  const root = join(parent, 'ws');
  await mkdir(join(root, 'Markets'), { recursive: true });
  let lost: string | null = null;
  // A long presence check, so only the save can notice.
  const session = await WorkspaceSession.open(root, false, { change: () => {}, lost: (m) => (lost = m) }, async () => {}, 60_000);
  try {
    const markets = session.snapshot.spaces[0];
    await rm(root, { recursive: true });
    const result = await session.flush({ spaces: [markets], createdSpaces: [], deletedSpaces: [], journalSpaceId: null, deletes: [], saves: [{ id: 'n', spaceId: markets.id, parentId: null, title: 'New', json: '{}\n', sidecars: {} }] });
    await session.saveUi({ openPageId: null, expanded: [], collapsedPanels: [] });
    expect(result.ok).toBe(false);
    expect(lost).toBe(`Couldn't find ${root}`);
    await expect(access(root)).rejects.toThrow();
  } finally {
    session.close();
  }
});
