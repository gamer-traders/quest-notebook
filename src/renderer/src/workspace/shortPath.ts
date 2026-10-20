/** A folder's path as people say it: the home folder as ~. */
export const shortPath = (path: string): string => path.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/, '~');

/** A folder's path, cut to its last two folders when it's longer than that. */
export function tailPath(path: string): string {
  const short = shortPath(path);
  const parts = short.split(/[/\\]/);
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : short;
}
