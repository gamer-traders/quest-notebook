import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Chat } from '@shared/ipc';
import { CHATS_DIR, chatTitle, deleteChat, listChats, newChatId, readChat, writeChat } from './chats';

const chat = (id: string, updated: string, title = 'Hello'): Chat => ({
  id,
  title,
  sessionId: null,
  created: '2026-01-01T00:00:00.000Z',
  updated,
  messages: [{ id: 'm1', role: 'user', text: 'Hi', created: updated }],
});
const tmp = () => mkdtemp(join(tmpdir(), 'quest-chats-'));

describe('chats on disk', () => {
  test('write, list and read round-trip, newest first', async () => {
    const root = await tmp();
    const old = chat('aaaaaaaa', '2026-01-02T00:00:00.000Z');
    const fresh = chat('bbbbbbbb', '2026-01-03T00:00:00.000Z', 'Newer');
    await writeChat(root, old);
    await writeChat(root, fresh);
    expect(await listChats(root)).toEqual([
      { id: 'bbbbbbbb', title: 'Newer', updated: fresh.updated },
      { id: 'aaaaaaaa', title: 'Hello', updated: old.updated },
    ]);
    expect(await readChat(root, 'aaaaaaaa')).toEqual(old);
  });

  test('a missing folder lists nothing', async () => {
    expect(await listChats(await tmp())).toEqual([]);
  });

  test('corrupt and misshapen files are skipped', async () => {
    const root = await tmp();
    await writeChat(root, chat('good0001', '2026-01-02T00:00:00.000Z'));
    const dir = join(root, CHATS_DIR);
    await writeFile(join(dir, 'corrupt1.json'), '{not json');
    await writeFile(join(dir, 'badmsg01.json'), JSON.stringify({ ...chat('badmsg01', 'x'), messages: [{ id: 'm', role: 'robot', text: 'x' }] }));
    await writeFile(join(dir, 'notchat1.json'), JSON.stringify({ hello: 'world' }));
    await writeFile(join(dir, 'mismatch.json'), JSON.stringify(chat('othername', 'x')));
    await writeFile(join(dir, 'notes.txt'), 'notes');
    expect((await listChats(root)).map((c) => c.id)).toEqual(['good0001']);
    expect(await readChat(root, 'corrupt1')).toBeNull();
    expect(await readChat(root, 'badmsg01')).toBeNull();
    expect(await readChat(root, 'notchat1')).toBeNull();
    expect(await readChat(root, 'nothere1')).toBeNull();
  });

  test('a chat whose session id is not a UUID is not read', async () => {
    const root = await tmp();
    await writeChat(root, { ...chat('uuid0001', '2026-01-02T00:00:00.000Z'), sessionId: 'e607f87c-c213-4764-b30b-b92b8927eec4' });
    const dir = join(root, CHATS_DIR);
    await writeFile(join(dir, 'option01.json'), JSON.stringify({ ...chat('option01', 'x'), sessionId: '--settings=evil.json' }));
    await writeFile(join(dir, 'number01.json'), JSON.stringify({ ...chat('number01', 'x'), sessionId: 5 }));
    expect((await listChats(root)).map((c) => c.id)).toEqual(['uuid0001']);
    expect(await readChat(root, 'option01')).toBeNull();
    expect(await readChat(root, 'number01')).toBeNull();
    expect((await readChat(root, 'uuid0001'))?.sessionId).toBe('e607f87c-c213-4764-b30b-b92b8927eec4');
  });

  test('ids that could leave the folder are refused', async () => {
    const root = await tmp();
    for (const id of ['../x', 'ABCDEFGH', 'abc']) expect(await readChat(root, id)).toBeNull();
    await expect(writeChat(root, chat('../evil1', 'x'))).rejects.toThrow();
    await expect(readdir(join(root, '.quest'))).rejects.toThrow();
    const trashed: string[] = [];
    await deleteChat(root, '../x', async (abs) => void trashed.push(abs));
    expect(trashed).toEqual([]);
  });

  test('delete trashes the file', async () => {
    const root = await tmp();
    await writeChat(root, chat('aaaaaaaa', 'x'));
    const trashed: string[] = [];
    await deleteChat(root, 'aaaaaaaa', async (abs) => void trashed.push(abs));
    expect(trashed).toEqual([join(root, CHATS_DIR, 'aaaaaaaa.json')]);
    await mkdir(join(root, CHATS_DIR), { recursive: true });
    await deleteChat(root, 'zzzzzzzz', async (abs) => void trashed.push(abs));
    expect(trashed).toHaveLength(1);
  });
});

describe('chatTitle', () => {
  test('cuts a long line to 60 characters', () => {
    const title = chatTitle('x'.repeat(100));
    expect(title).toHaveLength(60);
    expect(title.endsWith('…')).toBe(true);
  });
  test('keeps a short line', () => expect(chatTitle('Short one')).toBe('Short one'));
  test('uses the first non-empty line', () => expect(chatTitle('\n\n  Hello\nworld')).toBe('Hello'));
  test('names an empty chat', () => expect(chatTitle('')).toBe('New chat'));
});

test('newChatId makes 8 characters from a-z0-9', () => {
  for (let i = 0; i < 50; i++) expect(newChatId()).toMatch(/^[a-z0-9]{8}$/);
});
