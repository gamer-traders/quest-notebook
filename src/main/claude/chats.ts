import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { randomInt } from 'node:crypto';
import type { Chat, ChatAction, ChatMessage, ChatReference, ChatSummary, FileChange } from '@shared/ipc';
import { formatJson } from '@shared/formatJson';
import { insideRoot, writeFileAtomic } from '../workspace/paths';
import { isSessionId } from './command';
import { parseChatImage, trashImages } from './images';

export const CHATS_DIR = '.quest/chats';

const ID = /^[a-z0-9]{8}$/;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const newChatId = (): string => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const VERBS: readonly unknown[] = ['read', 'edited', 'created', 'searched', 'other'] satisfies ChatAction['verb'][];
/** The longest a block reference's blocks and its `where` may be. */
const MAX_BLOCK_TEXT = 50_000;
const MAX_BLOCK_WHERE = 200;

const isStringUpTo = (v: unknown, max: number): v is string => isString(v) && v.length <= max;

/** A reference as the window sends it or a chat file keeps it, rebuilt with only its own fields; null when anything is off. */
export function parseReference(v: unknown): ChatReference | null {
  if (!isObject(v) || !isString(v.pageId) || !isString(v.title)) return null;
  if (v.kind === 'page') return { kind: 'page', pageId: v.pageId, title: v.title };
  if (v.kind === 'selection' && isString(v.text)) return { kind: 'selection', pageId: v.pageId, title: v.title, text: v.text };
  if (v.kind === 'block' && isStringUpTo(v.text, MAX_BLOCK_TEXT) && isStringUpTo(v.where, MAX_BLOCK_WHERE)) {
    return { kind: 'block', pageId: v.pageId, title: v.title, text: v.text, where: v.where };
  }
  return null;
}

/** An action from a chat file: a known verb, and only the optional fields that are well-formed. */
function parseAction(v: unknown): ChatAction | null {
  if (!isObject(v) || !VERBS.includes(v.verb)) return null;
  const action: ChatAction = { verb: v.verb as ChatAction['verb'] };
  if (isString(v.id)) action.id = v.id;
  if (isString(v.path)) action.path = v.path;
  if (isString(v.detail)) action.detail = v.detail;
  if (typeof v.refused === 'boolean') action.refused = v.refused;
  return action;
}

/** A recorded file change from a chat file: every required field well-formed, and only the optional ones that are. */
function parseFileChange(v: unknown): FileChange | null {
  if (!isObject(v) || !isString(v.path) || (v.kind !== 'edited' && v.kind !== 'created') || typeof v.drawing !== 'boolean') return null;
  const { before, after } = v;
  if (!(before === null || isString(before)) || !(after === null || isString(after))) return null;
  return {
    path: v.path,
    ...(isString(v.pageId) ? { pageId: v.pageId } : {}),
    kind: v.kind,
    drawing: v.drawing,
    ...(typeof v.newSpace === 'boolean' ? { newSpace: v.newSpace } : {}),
    before,
    after,
  };
}

/** Sets `key` to the well-formed items of the list there, or drops it when it isn't a list. */
function keepList<T>(message: Record<string, unknown>, key: string, parse: (v: unknown) => T | null): void {
  if (!(key in message)) return;
  const value = message[key];
  if (Array.isArray(value)) message[key] = value.map(parse).filter((item): item is T => item !== null);
  else delete message[key];
}

/**
 * A message from a chat file, which can be damaged or edited by hand: what the window and undo read is cleaned up, and
 * any field (or list item) that isn't well-formed is dropped, so it never reaches them. An image is kept only under a
 * name of this chat's.
 */
function cleanMessage(m: Record<string, unknown>, chatId: string): ChatMessage {
  const message = { ...m };
  keepList(message, 'references', parseReference);
  keepList(message, 'images', (v) => parseChatImage(v, chatId));
  keepList(message, 'actions', parseAction);
  keepList(message, 'changes', parseFileChange);
  keepList(message, 'undone', (v) => (isString(v) ? v : null));
  if ('error' in message && !isString(message.error)) delete message.error;
  return message as unknown as ChatMessage;
}

/** The chat in a file's parsed contents, its messages cleaned up; null when it isn't chat-shaped. */
function parseChat(v: unknown): Chat | null {
  if (!isObject(v)) return null;
  const { id, title, created, updated, sessionId, messages } = v;
  if (!isString(id) || ![title, created, updated].every(isString)) return null;
  // The session id goes on the CLI's command line: anything but a UUID is refused.
  if (sessionId !== null && !isSessionId(sessionId)) return null;
  if (!Array.isArray(messages)) return null;
  const isMessage = (m: unknown): m is Record<string, unknown> => isObject(m) && isString(m.id) && (m.role === 'user' || m.role === 'assistant') && isString(m.text);
  if (!messages.every(isMessage)) return null;
  return { ...(v as unknown as Chat), messages: messages.map((m) => cleanMessage(m, id)) };
}

const chatPath = (root: string, id: string) => insideRoot(root, `${CHATS_DIR}/${id}.json`);

/**
 * The chat saved under `id`, or null when the id is invalid or the file is missing, unreadable or not chat-shaped.
 * Damaged parts of its messages are left out (see `cleanMessage`).
 */
export async function readChat(root: string, id: string): Promise<Chat | null> {
  if (!ID.test(id)) return null;
  try {
    const chat = parseChat(JSON.parse(await readFile(chatPath(root, id), 'utf8')));
    return chat && chat.id === id ? chat : null;
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

/**
 * Moves the chat's file to the Trash, then its images, even when the file is already gone (so a delete that failed half
 * way can be done again). An invalid id does nothing.
 */
export async function deleteChat(root: string, id: string, trash: (abs: string) => Promise<void>): Promise<void> {
  if (!ID.test(id)) return;
  const abs = chatPath(root, id);
  if (await stat(abs).then(() => true, () => false)) await trash(abs);
  await trashImages(root, id, trash);
}

/** A chat's title from its first message: the first non-empty line, cut to 60 characters. */
export function chatTitle(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l !== '');
  if (!line) return 'New chat';
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}
