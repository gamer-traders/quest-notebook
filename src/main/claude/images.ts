import { randomInt } from 'node:crypto';
import { lstat, mkdir, readdir, readFile } from 'node:fs/promises';
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES, type ChatImage, type ImageData, type ImageType } from '@shared/ipc';
import { insideRoot, writeFileAtomic } from '../workspace/paths';

/** Where a chat's images are kept, as `<chat id>-<8 letters or digits>.<ext>`. */
export const IMAGES_DIR = '.quest/chats/images';

export const BAD_REQUEST = 'Bad request';
const TOO_MANY = `At most ${MAX_IMAGES} images per message`;
const TOO_BIG = `Each image must be under ${MAX_IMAGE_BYTES / (1024 * 1024)} MB`;
const WRONG_TYPE = 'Only PNG, JPEG, GIF and WebP images can be sent';

const CHAT_ID = /^[a-z0-9]{8}$/;
const IMAGE_FILE = /^([a-z0-9]{8})-[a-z0-9]{8}\.(png|jpg|gif|webp)$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const EXTENSION: Record<ImageType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const TYPE_OF: Record<string, ImageType> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isImageType = (v: unknown): v is ImageType => (IMAGE_TYPES as readonly unknown[]).includes(v);

/** Standard base64, padded to whole groups of four. */
const isBase64 = (data: string) => data.length % 4 === 0 && BASE64.test(data);

/** Whether the first bytes are those of a file of this type. */
function startsAs(type: ImageType, bytes: Buffer): boolean {
  const at = (offset: number, expected: number[]) => expected.every((byte, i) => bytes[offset + i] === byte);
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
  switch (type) {
    case 'image/png':
      return at(0, [0x89, 0x50, 0x4e, 0x47]);
    case 'image/jpeg':
      return at(0, [0xff, 0xd8, 0xff]);
    case 'image/gif':
      return at(0, ascii('GIF8'));
    case 'image/webp':
      return at(0, ascii('RIFF')) && at(8, ascii('WEBP'));
  }
}

/**
 * The images of a send request, checked one by one and rebuilt with only their fields; or why they can't be sent. The
 * type must be one Claude can see and match the image's first bytes, and the image must be at most MAX_IMAGE_BYTES.
 */
export function parseImages(v: unknown): ImageData[] | { error: string } {
  if (!Array.isArray(v)) return { error: BAD_REQUEST };
  if (v.length > MAX_IMAGES) return { error: TOO_MANY };
  const images: ImageData[] = [];
  for (const item of v) {
    if (!isObject(item) || !isString(item.type) || !isString(item.data)) return { error: BAD_REQUEST };
    const { type, data } = item;
    if (!isImageType(type)) return { error: WRONG_TYPE };
    if (!isBase64(data)) return { error: BAD_REQUEST };
    if (Buffer.byteLength(data, 'base64') > MAX_IMAGE_BYTES) return { error: TOO_BIG };
    // 16 characters are the first 12 bytes: enough for every type's.
    if (!startsAs(type, Buffer.from(data.slice(0, 16), 'base64'))) return { error: WRONG_TYPE };
    images.push({ type, data });
  }
  return images;
}

/** The type of one of this chat's image files, from its extension; null when the name isn't one of that chat's. */
export function imageFileType(chatId: string, file: string): ImageType | null {
  if (!CHAT_ID.test(chatId)) return null;
  const match = IMAGE_FILE.exec(file);
  return match && match[1] === chatId ? TYPE_OF[match[2]] : null;
}

/** An image listed on a message in a chat file: a good name for this chat and a known type, or null. */
export function parseChatImage(v: unknown, chatId: string): ChatImage | null {
  if (!isObject(v) || !isString(v.file) || !isImageType(v.type)) return null;
  return imageFileType(chatId, v.file) === null ? null : { file: v.file, type: v.type };
}

const randomPart = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/** Saves each image as a new file of the chat's, and gives what to list on its message, in the same order. */
export async function saveImages(root: string, chatId: string, images: ImageData[]): Promise<ChatImage[]> {
  if (!CHAT_ID.test(chatId)) throw new Error('Invalid chat id');
  if (images.length === 0) return [];
  await mkdir(insideRoot(root, IMAGES_DIR), { recursive: true });
  const saved: ChatImage[] = [];
  for (const image of images) {
    const file = `${chatId}-${randomPart()}.${EXTENSION[image.type]}`;
    await writeFileAtomic(insideRoot(root, `${IMAGES_DIR}/${file}`), Buffer.from(image.data, 'base64'));
    saved.push({ file, type: image.type });
  }
  return saved;
}

/**
 * One of a chat's images, as base64; null when the name isn't one of that chat's, or the file is missing. Only a
 * plain file no bigger than an image can be is read: a link or anything else under that name is not ours.
 */
export async function readImage(root: string, chatId: string, file: string): Promise<ImageData | null> {
  const type = imageFileType(chatId, file);
  if (!type) return null;
  try {
    const abs = insideRoot(root, `${IMAGES_DIR}/${file}`);
    const info = await lstat(abs);
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) return null;
    return { type, data: (await readFile(abs)).toString('base64') };
  } catch {
    return null;
  }
}

/** Moves every file of the chat's in the images folder (its name starts with `<chat id>-`) to the Trash. */
export async function trashImages(root: string, chatId: string, trash: (abs: string) => Promise<void>): Promise<void> {
  if (!CHAT_ID.test(chatId)) return;
  let names: string[];
  try {
    names = await readdir(insideRoot(root, IMAGES_DIR));
  } catch {
    return;
  }
  for (const name of names) if (name.startsWith(`${chatId}-`)) await trash(insideRoot(root, `${IMAGES_DIR}/${name}`));
}
