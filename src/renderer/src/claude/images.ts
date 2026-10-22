import { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES, type ImageData, type ImageType } from '@shared/ipc';

// Images pasted or dropped into a message: which can go, how they're read, and the saved ones once loaded.

export const TYPE_ERROR = 'Only PNG, JPEG, GIF and WebP images can be sent';
export const SIZE_ERROR = 'Each image must be under 5 MB';
export const COUNT_ERROR = `At most ${MAX_IMAGES} images per message`;

export const isImageType = (type: unknown): type is ImageType => (IMAGE_TYPES as readonly unknown[]).includes(type);

/**
 * The images that can join a message that has `have` already, in order, and the first problem met with the rest:
 * a type Claude can't see, an image over the size limit, or more than the message can take.
 */
export function checkImages<T extends { type: string; size: number }>(have: number, files: readonly T[]): { accepted: T[]; error: string | null } {
  const accepted: T[] = [];
  let error: string | null = null;
  for (const f of files) {
    const problem = !isImageType(f.type) ? TYPE_ERROR : f.size > MAX_IMAGE_BYTES ? SIZE_ERROR : have + accepted.length >= MAX_IMAGES ? COUNT_ERROR : null;
    if (problem) error ??= problem;
    else accepted.push(f);
  }
  return { accepted, error };
}

/** How many bytes a base64 string holds. */
export const base64Bytes = (data: string): number => Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);

/** A file's bytes, as base64 without the `data:…;base64,` in front. Its type is checked before. */
export function readImage(file: Blob): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve({ type: file.type as ImageType, data: url.slice(url.indexOf(',') + 1) });
    };
    reader.onerror = () => reject(reader.error ?? new Error("The image couldn't be read."));
    reader.readAsDataURL(file);
  });
}

// An image's data URL is long: it's made once for each image, not on each draw.
const urls = new WeakMap<ImageData, string>();

export function dataUrlOf(image: ImageData): string {
  let url = urls.get(image);
  if (url === undefined) {
    url = `data:${image.type};base64,${image.data}`;
    urls.set(image, url);
  }
  return url;
}

// Saved images by `chatId/file`, as data URLs. Past the limit the oldest go, and are read again when shown.
const LIMIT = 120;
const saved = new Map<string, string>();

export const cachedImage = (key: string): string | undefined => saved.get(key);

export function cacheImage(key: string, url: string): void {
  saved.delete(key);
  saved.set(key, url);
  while (saved.size > LIMIT) saved.delete(saved.keys().next().value!);
}
