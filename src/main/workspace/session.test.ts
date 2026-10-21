import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { DiskDelta, FileChange } from '@shared/ipc';
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
    // Reads the folder now rather than waiting on the watcher: a watcher only just started can miss a change while
    // other processes open and close many watchers (as the claude service tests do).
    await session.settle();
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
}, 20_000);

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

test('an outside edit reports its file changes, a flush does not, and settle waits for the report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quest-changes-'));
  await mkdir(join(root, 'Markets'));
  const old = '{"id":"a","title":"A","position":0,"blocks":[]}\n';
  await writeFile(join(root, 'Markets/A.json'), old);
  const reported: FileChange[][] = [];
  const session = await WorkspaceSession.open(root, false, { change: () => {}, lost: () => {}, fileChanges: (c) => reported.push(c) }, async () => {}, 60_000);
  try {
    const markets = session.snapshot.spaces[0];
    const next = '{"id":"a","title":"A","position":0,"blocks":[{"type":"paragraph","text":"hi"}]}\n';
    const flushed = await session.flush({ spaces: [markets], createdSpaces: [], deletedSpaces: [], journalSpaceId: null, deletes: [], saves: [{ id: 'a', spaceId: markets.id, parentId: null, title: 'A', json: next, sidecars: {} }] });
    expect(flushed.ok).toBe(true);
    await session.settle();
    expect(reported).toEqual([]);

    const outside = '{"id":"a","title":"A","position":0,"blocks":[{"type":"paragraph","text":"claude"}]}\n';
    await writeFile(join(root, 'Markets/A.json'), outside);
    await session.settle();
    expect(reported).toEqual([[{ path: 'Markets/A.json', pageId: 'a', kind: 'edited', drawing: false, before: next, after: outside }]]);
  } finally {
    session.close();
  }
});

test('pageIdForPath and pageInfo, with the file name as the title when there is none', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quest-info-'));
  await mkdir(join(root, 'Markets'));
  await writeFile(join(root, 'Markets/A.json'), '{"id":"a","title":"Alpha","position":0,"blocks":[]}\n');
  await writeFile(join(root, 'Markets/Untitled.json'), '{"id":"u","position":1,"blocks":[]}\n');
  await writeFile(join(root, 'Markets/Broken.json'), '{ nope');
  const session = await WorkspaceSession.open(root, false, { change: () => {}, lost: () => {} }, async () => {}, 60_000);
  try {
    expect(session.pageIdForPath('Markets/A.json')).toBe('a');
    expect(session.pageIdForPath('Markets/Nope.json')).toBeUndefined();
    expect(session.pageInfo('a')).toEqual({ path: 'Markets/A.json', title: 'Alpha' });
    expect(session.pageInfo('u')).toEqual({ path: 'Markets/Untitled.json', title: 'Untitled' });
    const broken = session.pageIdForPath('Markets/Broken.json')!;
    expect(session.pageInfo(broken)).toEqual({ path: 'Markets/Broken.json', title: 'Broken' });
    expect(session.pageInfo('zzz')).toBeUndefined();
  } finally {
    session.close();
  }
});

test('exclusive runs work in the queue, and refuses once the session is closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quest-excl-'));
  await mkdir(join(root, 'Markets'));
  const session = await WorkspaceSession.open(root, false, { change: () => {}, lost: () => {} }, async () => {}, 60_000);
  expect(await session.exclusive(async () => 42)).toBe(42);
  session.close();
  await expect(session.exclusive(async () => 1)).rejects.toThrow(/closed/);
});

test('work run with rescanAfter is seen before the next queued save, which is refused as stale if planned before it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quest-rescan-after-'));
  await mkdir(join(root, 'Markets'));
  const claude = '{"id":"a","title":"A","position":0,"blocks":[{"type":"paragraph","text":"claude"}]}\n';
  const restored = '{"id":"a","title":"A","position":0,"blocks":[]}\n';
  await writeFile(join(root, 'Markets/A.json'), claude);
  const deltas: DiskDelta[] = [];
  const session = await WorkspaceSession.open(root, false, { change: (d) => deltas.push(d), lost: () => {} }, async () => {}, 60_000);
  try {
    const markets = session.snapshot.spaces[0];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // An undo holds the queue: it writes the old text back, and the window's save is queued behind it.
    const undoing = session.exclusive(
      async () => {
        await writeFile(join(root, 'Markets/A.json'), restored);
        await gate;
        return 'done';
      },
      { rescanAfter: true },
    );
    const flushing = session.flush({
      spaces: [markets],
      createdSpaces: [],
      deletedSpaces: [],
      journalSpaceId: null,
      deletes: [],
      seenSeq: 0,
      saves: [{ id: 'a', spaceId: markets.id, parentId: null, title: 'A', json: claude, sidecars: {} }],
    });
    release();
    expect(await undoing).toBe('done');
    const result = await flushing;
    expect(result.stale).toEqual(['a']);
    expect(await readFile(join(root, 'Markets/A.json'), 'utf8')).toBe(restored);
    expect(deltas.map((d) => d.seq)).toEqual([1]);
  } finally {
    session.close();
  }
});

test('rescanAfter also runs when the work fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quest-rescan-fail-'));
  await mkdir(join(root, 'Markets'));
  await writeFile(join(root, 'Markets/A.json'), '{"id":"a","title":"A","position":0,"blocks":[]}\n');
  const deltas: DiskDelta[] = [];
  const session = await WorkspaceSession.open(root, false, { change: (d) => deltas.push(d), lost: () => {} }, async () => {}, 60_000);
  try {
    const failing = session.exclusive(
      async () => {
        await writeFile(join(root, 'Markets/A.json'), '{"id":"a","title":"A","position":0,"blocks":[{"type":"paragraph","text":"x"}]}\n');
        throw new Error('half way');
      },
      { rescanAfter: true },
    );
    await expect(failing).rejects.toThrow('half way');
    expect(deltas).toHaveLength(1);
  } finally {
    session.close();
  }
});

test('the watcher reports an outside change by itself, once it is watching', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quest-watching-'));
  await mkdir(join(root, 'Markets'));
  await writeFile(join(root, 'Markets/A.json'), '{"id":"a","title":"A","position":0,"blocks":[]}\n');
  const deltas: DiskDelta[] = [];
  const session = await WorkspaceSession.open(root, false, { change: (d) => deltas.push(d), lost: () => {} }, async () => {}, 60_000);
  const waitForDelta = async (count: number, ms: number) => {
    for (let waited = 0; deltas.length < count && waited < ms; waited += 20) await new Promise((r) => setTimeout(r, 20));
  };
  try {
    // A watcher only just started can miss a change, so warm it up: change a page until one change comes through.
    for (let i = 0; i < 40 && deltas.length === 0; i++) {
      await writeFile(join(root, 'Markets/Warm.json'), `{"id":"w","title":"Warm","position":1,"blocks":[],"n":${i}}\n`);
      await waitForDelta(1, 500);
    }
    expect(deltas.length).toBeGreaterThan(0);
    const seen = deltas.length;
    const outside = '{"id":"a","title":"A","position":0,"blocks":[{"type":"paragraph","text":"outside"}]}\n';
    await writeFile(join(root, 'Markets/A.json'), outside);
    await waitForDelta(seen + 1, 10_000);
    const page = deltas.slice(seen).flatMap((d) => d.pages).find((p) => p.id === 'a');
    expect(page?.file).toEqual(JSON.parse(outside));
  } finally {
    session.close();
  }
}, 30_000);
