import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MAX_IMAGE_BYTES, MAX_IMAGES } from '@shared/ipc';
import { imageBytes, testImage } from './__fixtures__/image-bytes';
import { IMAGES_DIR, imageFileType, parseChatImage, parseImages, readImage, saveImages, trashImages } from './images';

const image = testImage;

const TOO_MANY = 'At most 10 images per message';
const TOO_BIG = 'Each image must be under 5 MB';
const WRONG_TYPE = 'Only PNG, JPEG, GIF and WebP images can be sent';
const BAD = 'Bad request';

describe('the image checks', () => {
  test('each type passes with its own first bytes, rebuilt with only its fields', () => {
    const all = (['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const).map((type) => image(type));
    expect(parseImages(all)).toEqual(all);
    expect(parseImages([{ ...all[0], extra: 1 }])).toEqual([all[0]]);
    expect(parseImages([])).toEqual([]);
  });

  test(`at most ${MAX_IMAGES} images`, () => {
    expect(parseImages(Array.from({ length: MAX_IMAGES }, () => image('image/png')))).toHaveLength(MAX_IMAGES);
    expect(parseImages(Array.from({ length: MAX_IMAGES + 1 }, () => image('image/png')))).toEqual({ error: TOO_MANY });
  });

  test('each image at most 5 MB, decoded', () => {
    expect(parseImages([image('image/jpeg', MAX_IMAGE_BYTES)])).toHaveLength(1);
    expect(parseImages([image('image/jpeg', MAX_IMAGE_BYTES + 1)])).toEqual({ error: TOO_BIG });
  });

  test('a type that is not one of the four, or first bytes that do not match it, is refused', () => {
    expect(parseImages([{ type: 'image/svg+xml', data: image('image/png').data }])).toEqual({ error: WRONG_TYPE });
    expect(parseImages([{ type: 'image/bmp', data: Buffer.from('BM0000000000').toString('base64') }])).toEqual({ error: WRONG_TYPE });
    expect(parseImages([{ type: 'image/png', data: image('image/jpeg').data }])).toEqual({ error: WRONG_TYPE });
    expect(parseImages([{ type: 'image/jpeg', data: image('image/gif').data }])).toEqual({ error: WRONG_TYPE });
    expect(parseImages([{ type: 'image/gif', data: Buffer.from('GIF7').toString('base64') }])).toEqual({ error: WRONG_TYPE });
    expect(parseImages([{ type: 'image/webp', data: Buffer.from('RIFF1234WAVEfmt ').toString('base64') }])).toEqual({ error: WRONG_TYPE });
    // Too short to hold the first bytes.
    expect(parseImages([{ type: 'image/png', data: Buffer.from([0x89, 0x50]).toString('base64') }])).toEqual({ error: WRONG_TYPE });
    // One bad image refuses the lot.
    expect(parseImages([image('image/png'), { type: 'image/png', data: image('image/webp').data }])).toEqual({ error: WRONG_TYPE });
  });

  test('data that is not base64 is a bad request', () => {
    const good = image('image/png').data;
    const urlSafe = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xfb, 0xff, 0xfe, 0]).toString('base64url');
    expect(urlSafe).toMatch(/[-_]/);
    const unpadded = good.replace(/=+$/, '');
    expect(unpadded).not.toBe(good);
    for (const data of ['', `${good}!`, `data:image/png;base64,${good}`, `${good.slice(0, 8)}\n${good.slice(8)}`, `${good.slice(0, 8)} ${good.slice(8)}`, `${good}===`, `=${good}`, unpadded, urlSafe]) {
      expect(parseImages([{ type: 'image/png', data }])).toEqual({ error: BAD });
    }
  });

  test('anything else malformed is a bad request', () => {
    for (const bad of [null, 'x', {}, { 0: image('image/png') }]) expect(parseImages(bad)).toEqual({ error: BAD });
    for (const item of [null, 'x', 5, [], { type: 'image/png' }, { data: image('image/png').data }, { type: 5, data: image('image/png').data }, { type: 'image/png', data: 5 }]) {
      expect(parseImages([item])).toEqual({ error: BAD });
    }
  });
});

describe('image file names', () => {
  test('a chat image is <chat id>-<8 letters or digits>.<png|jpg|gif|webp>, and its type comes from the extension', () => {
    expect(imageFileType('abcd1234', 'abcd1234-0a1b2c3d.png')).toBe('image/png');
    expect(imageFileType('abcd1234', 'abcd1234-0a1b2c3d.jpg')).toBe('image/jpeg');
    expect(imageFileType('abcd1234', 'abcd1234-0a1b2c3d.gif')).toBe('image/gif');
    expect(imageFileType('abcd1234', 'abcd1234-0a1b2c3d.webp')).toBe('image/webp');
  });

  test('names that leave the folder, belong to another chat or are off in any way are refused', () => {
    for (const file of [
      'zzzz9999-0a1b2c3d.png',
      '../abcd1234-0a1b2c3d.png',
      'abcd1234-0a1b2c3d.png/..',
      'x/abcd1234-0a1b2c3d.png',
      'abcd1234-../../x.png',
      'abcd1234-0a1b2c3d.jpeg',
      'abcd1234-0a1b2c3d.PNG',
      'abcd1234-0A1B2C3D.png',
      'abcd1234-0a1b2c3.png',
      'abcd1234-0a1b2c3d4.png',
      'abcd1234-0a1b2c3d.png.tmp',
      'abcd1234-0a1b2c3d.svg',
      'abcd1234.json',
      '',
    ]) {
      expect(imageFileType('abcd1234', file)).toBeNull();
    }
    for (const chatId of ['../abcd12', 'ABCD1234', 'abc', '.*', 'abcd123.']) expect(imageFileType(chatId, `${chatId}-0a1b2c3d.png`)).toBeNull();
  });

  test('a chat image in a chat file is kept only with a good name for that chat and a known type', () => {
    expect(parseChatImage({ file: 'abcd1234-0a1b2c3d.png', type: 'image/png', extra: 1 }, 'abcd1234')).toEqual({ file: 'abcd1234-0a1b2c3d.png', type: 'image/png' });
    for (const bad of [
      null,
      'abcd1234-0a1b2c3d.png',
      { file: 'abcd1234-0a1b2c3d.png' },
      { file: 'abcd1234-0a1b2c3d.png', type: 'image/bmp' },
      { file: 'abcd1234-0a1b2c3d.png', type: 5 },
      { file: 'zzzz9999-0a1b2c3d.png', type: 'image/png' },
      { file: '../abcd1234-0a1b2c3d.png', type: 'image/png' },
      { file: 5, type: 'image/png' },
    ]) {
      expect(parseChatImage(bad, 'abcd1234')).toBeNull();
    }
  });
});

const tmp = () => mkdtemp(join(tmpdir(), 'quest-images-'));

describe('images on disk', () => {
  test('saved in .quest/chats/images under fresh names, in order, and read back as they were', async () => {
    const root = await tmp();
    const images = [image('image/png', 100), image('image/jpeg', 200), image('image/gif'), image('image/webp')];
    const saved = await saveImages(root, 'abcd1234', images);
    expect(saved.map((s) => s.type)).toEqual(images.map((i) => i.type));
    for (const [i, s] of saved.entries()) {
      expect(s.file).toMatch(/^abcd1234-[a-z0-9]{8}\.(png|jpg|gif|webp)$/);
      expect(s.file.endsWith(`.${['png', 'jpg', 'gif', 'webp'][i]}`)).toBe(true);
      expect(await readFile(join(root, IMAGES_DIR, s.file))).toEqual(Buffer.from(images[i].data, 'base64'));
      expect(await readImage(root, 'abcd1234', s.file)).toEqual(images[i]);
    }
    expect(new Set(saved.map((s) => s.file)).size).toBe(saved.length);
    // Nothing but the images: no temporary files left behind.
    expect((await readdir(join(root, IMAGES_DIR))).sort()).toEqual(saved.map((s) => s.file).sort());
  });

  test('saving nothing makes no folder, and a bad chat id saves nothing', async () => {
    const root = await tmp();
    expect(await saveImages(root, 'abcd1234', [])).toEqual([]);
    await expect(readdir(join(root, '.quest'))).rejects.toThrow();
    await expect(saveImages(root, '../evil1', [image('image/png')])).rejects.toThrow();
    await expect(readdir(join(root, '.quest'))).rejects.toThrow();
  });

  test('reading gives null for a missing file, a bad name, another chat, or something that is not a file', async () => {
    const root = await tmp();
    const [saved] = await saveImages(root, 'abcd1234', [image('image/png')]);
    expect(await readImage(root, 'abcd1234', 'abcd1234-00000000.png')).toBeNull();
    expect(await readImage(root, 'zzzz9999', saved.file)).toBeNull();
    expect(await readImage(root, 'abcd1234', `../images/${saved.file}`)).toBeNull();
    expect(await readImage(root, '../chats', saved.file)).toBeNull();
    // Outside the folder, under a good name: a link is not followed, and a folder is not read.
    await writeFile(join(root, 'secret.png'), imageBytes('image/png'));
    await symlink(join(root, 'secret.png'), join(root, IMAGES_DIR, 'abcd1234-11111111.png'));
    expect(await readImage(root, 'abcd1234', 'abcd1234-11111111.png')).toBeNull();
    await mkdir(join(root, IMAGES_DIR, 'abcd1234-22222222.png'));
    expect(await readImage(root, 'abcd1234', 'abcd1234-22222222.png')).toBeNull();
  });

  test("trashing a chat's images trashes every file in the folder that starts with its id, and nothing else", async () => {
    const root = await tmp();
    const mine = await saveImages(root, 'abcd1234', [image('image/png'), image('image/gif')]);
    const theirs = await saveImages(root, 'zzzz9999', [image('image/png')]);
    await writeFile(join(root, IMAGES_DIR, 'abcd1234-leftover.png.tmp'), 'x');
    await writeFile(join(root, IMAGES_DIR, 'abcd12345-0a1b2c3d.png'), 'x');
    const trashed: string[] = [];
    await trashImages(root, 'abcd1234', async (abs) => void trashed.push(abs));
    expect(trashed.sort()).toEqual([...mine.map((s) => s.file), 'abcd1234-leftover.png.tmp'].map((f) => join(root, IMAGES_DIR, f)).sort());
    expect(theirs).toHaveLength(1);
  });

  test('trashing with no images folder, or a bad id, does nothing', async () => {
    const root = await tmp();
    const trashed: string[] = [];
    await trashImages(root, 'abcd1234', async (abs) => void trashed.push(abs));
    await saveImages(root, 'abcd1234', [image('image/png')]);
    await trashImages(root, '../x', async (abs) => void trashed.push(abs));
    await trashImages(root, '', async (abs) => void trashed.push(abs));
    expect(trashed).toEqual([]);
  });
});
