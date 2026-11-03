// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { MAX_IMAGE_BYTES } from '@shared/ipc';
import { COUNT_ERROR, SIZE_ERROR, TYPE_ERROR, base64Bytes, cacheImage, cachedImage, checkImages, dataUrlOf, readImage } from './images';

const file = (type: string, size = 1000) => ({ type, size });

test('PNG, JPEG, GIF and WebP images up to 5 MB are taken, ten at most', () => {
  const fine = [file('image/png'), file('image/jpeg'), file('image/gif'), file('image/webp', MAX_IMAGE_BYTES)];
  expect(checkImages(0, fine)).toEqual({ accepted: fine, error: null });
  expect(checkImages(6, fine)).toEqual({ accepted: fine, error: null });
});

test('another type is left out, and says which types can be sent', () => {
  const png = file('image/png');
  expect(checkImages(0, [file('image/bmp'), png, file('application/pdf'), file('')])).toEqual({ accepted: [png], error: TYPE_ERROR });
  expect(TYPE_ERROR).toBe('Only PNG, JPEG, GIF and WebP images can be sent');
});

test('an image over 5 MB is left out', () => {
  const small = file('image/png', 10);
  expect(checkImages(0, [file('image/jpeg', MAX_IMAGE_BYTES + 1), small])).toEqual({ accepted: [small], error: SIZE_ERROR });
  expect(SIZE_ERROR).toBe('Each image must be under 5 MB');
});

test('past ten images in the message, the rest are left out', () => {
  const four = [file('image/png', 1), file('image/png', 2), file('image/png', 3), file('image/png', 4)];
  expect(checkImages(8, four)).toEqual({ accepted: four.slice(0, 2), error: COUNT_ERROR });
  expect(checkImages(10, four)).toEqual({ accepted: [], error: COUNT_ERROR });
  expect(COUNT_ERROR).toBe('At most 10 images per message');
});

test('with several problems, the first one met is said', () => {
  expect(checkImages(9, [file('image/png', MAX_IMAGE_BYTES + 1), file('image/tiff'), file('image/png'), file('image/png')]).error).toBe(SIZE_ERROR);
  // Bad images don't use up places.
  expect(checkImages(9, [file('image/tiff'), file('image/png', 5)]).accepted).toEqual([file('image/png', 5)]);
});

test('base64 counts the bytes it holds', () => {
  expect(base64Bytes('')).toBe(0);
  expect(base64Bytes('YQ==')).toBe(1);
  expect(base64Bytes('YWI=')).toBe(2);
  expect(base64Bytes('YWJj')).toBe(3);
  expect(base64Bytes(btoa('x'.repeat(1001)))).toBe(1001);
});

test('an image file is read as base64, without the data: prefix, and shown as a data URL', async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 10]);
  const image = await readImage(new File([bytes], 'shot.png', { type: 'image/png' }));
  expect(image).toEqual({ type: 'image/png', data: btoa(String.fromCharCode(...bytes)) });
  expect(dataUrlOf(image)).toBe(`data:image/png;base64,${image.data}`);
  // The same image gives the same string, made once.
  expect(dataUrlOf(image)).toBe(dataUrlOf(image));
});

test('saved images are kept by chat and file once loaded, the oldest let go past the limit', () => {
  expect(cachedImage('c/a.png')).toBeUndefined();
  cacheImage('c/a.png', 'data:image/png;base64,AA');
  expect(cachedImage('c/a.png')).toBe('data:image/png;base64,AA');
  for (let i = 0; i < 200; i++) cacheImage(`c/${i}.png`, 'x');
  expect(cachedImage('c/a.png')).toBeUndefined();
  expect(cachedImage('c/199.png')).toBe('x');
});
