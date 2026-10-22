import type { ImageData, ImageType } from '@shared/ipc';

/** Bytes that start as a file of this type does, `size` long in all: enough for the image checks, for tests only. */
export function imageBytes(type: ImageType, size = 64): Buffer {
  const head: Record<ImageType, Buffer> = {
    'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    'image/gif': Buffer.from('GIF89a', 'latin1'),
    'image/webp': Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ', 'latin1')]),
  };
  const bytes = Buffer.alloc(size, 7);
  head[type].copy(bytes);
  return bytes;
}

/** An image as a send request carries it. */
export const testImage = (type: ImageType, size = 64): ImageData => ({ type, data: imageBytes(type, size).toString('base64') });
