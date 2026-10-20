import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
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
    const batch = { spaces: [markets], journalSpaceId: null, saves: [{ id: 'x', spaceId: markets.id, parentId: null, title: 'X', json: '{}\n' }], deletes: [] };
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
