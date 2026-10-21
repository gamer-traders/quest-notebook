import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { randomInt } from 'node:crypto';
import type { Chat, ChatSummary } from '@shared/ipc';
import { formatJson } from '@shared/formatJson';
import { insideRoot, writeFileAtomic } from '../workspace/paths';

export const CHATS_DIR = '.quest/chats';

const ID = /^[a-z0-9]{8}$/;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const newChatId = (): string => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function isChat(v: unknown): v is Chat {
  if (!isObject(v)) return false;
  const { id, title, created, updated, sessionId, messages } = v;
  if (![id, title, created, updated].every((s) => typeof s === 'string')) return false;
  if (sessionId !== null && typeof sessionId !== 'string') return false;
  return (
    Array.isArray(messages) &&
    messages.every((m) => isObject(m) && typeof m.id === 'string' && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
  );
}

const chatPath = (root: string, id: string) => insideRoot(root, `${CHATS_DIR}/${id}.json`);

/** The chat saved under `id`, or null when the id is invalid or the file is missing, unreadable or not chat-shaped. */
export async function readChat(root: string, id: string): Promise<Chat | null> {
  if (!ID.test(id)) return null;
  try {
    const parsed: unknown = JSON.parse(await readFile(chatPath(root, id), 'utf8'));
    return isChat(parsed) && parsed.id === id ? parsed : null;
  } catch {
    return null;
  }
}

/** Every readable chat, newest first. Files that aren't chats are skipped. */
export async function listChats(root: string): Promise<ChatSummary[]> {
  let names: string[];
  try {
    names = await readdir(insideRoot(root, CHATS_DIR));
  } catch {
    return [];
  }
  const found = await Promise.all(names.map((name) => (name.endsWith('.json') ? readChat(root, name.slice(0, -'.json'.length)) : null)));
  return found
    .filter((c): c is Chat => c !== null)
    .map((c) => ({ id: c.id, title: c.title, updated: c.updated }))
    .sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
}

export async function writeChat(root: string, chat: Chat): Promise<void> {
  if (!ID.test(chat.id)) throw new Error('Invalid chat id');
  const abs = chatPath(root, chat.id);
  await mkdir(insideRoot(root, CHATS_DIR), { recursive: true });
  await writeFileAtomic(abs, formatJson(chat));
}

/** Moves the chat's file to the Trash. An invalid id, or a chat that isn't there, does nothing. */
export async function deleteChat(root: string, id: string, trash: (abs: string) => Promise<void>): Promise<void> {
  if (!ID.test(id)) return;
  const abs = chatPath(root, id);
  if (await stat(abs).then(() => true, () => false)) await trash(abs);
}

/** A chat's title from its first message: the first non-empty line, cut to 60 characters. */
export function chatTitle(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l !== '');
  if (!line) return 'New chat';
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}
