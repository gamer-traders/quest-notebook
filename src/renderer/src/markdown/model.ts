import type { MarkdownRecord } from '@shared/ipc';
import type { MarkdownFile } from '../types';

/*
  A Markdown file in the workspace, shown beside the pages. It has no id of its own, so its path names it, and
  the app never changes its text unless it's edited in the app.
*/

const PREFIX = 'md:';

export const markdownId = (path: string) => `${PREFIX}${path}`;
export const isMarkdownId = (id: string | null): id is string => id !== null && id.startsWith(PREFIX);

/** What the sidebar calls it: the file's name, without `.md`. */
export const markdownName = (file: Pick<MarkdownFile, 'path'>) => (file.path.split('/').at(-1) ?? file.path).replace(/\.md$/i, '');

export const markdownFromRecord = (record: MarkdownRecord): MarkdownFile => ({
  id: markdownId(record.path),
  path: record.path,
  spaceId: record.spaceId,
  parentId: record.parentId,
  text: record.text,
});
