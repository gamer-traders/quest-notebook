import type { ImageData } from '@shared/ipc';

/**
 * The permission flags verified against the CLI (see permissions.json and the findings note).
 * command.test.ts keeps this equal to permissions.json. Default mode refuses anything not allowed, so a
 * mistake here fails closed; never switch to acceptEdits or a --settings deny file, both leaked.
 */
export const PERMISSIONS = {
  permissionMode: 'default',
  tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'],
  allowedTools: ['Read', 'Glob', 'Grep', 'Edit(/*/**/*.json)', 'Edit(/*/**/drawing-*.svg)'],
  disallowedTools: ['Edit(/.quest/**)'],
} as const;

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A CLI session id, as the CLI makes them: a UUID. Anything else could be read as an option after `--resume`. */
export const isSessionId = (id: unknown): id is string => typeof id === 'string' && SESSION_ID.test(id);

/**
 * The claude arguments for one turn. The message isn't among them: it goes in on stdin (see `userMessageLine`), so no
 * text of the owner's is ever read as an option. A session id that isn't a UUID throws: `--resume` takes an optional
 * value, so `--settings=…` would become an option.
 */
export function claudeArgs(p: { sessionId: string | null; guide: string }): string[] {
  if (p.sessionId !== null && !isSessionId(p.sessionId)) throw new Error('Invalid session id');
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    ...(p.sessionId ? ['--resume', p.sessionId] : []),
    '--restricted',
    '--strict-mcp-config',
    '--tools', PERMISSIONS.tools.join(','),
    '--permission-mode', PERMISSIONS.permissionMode,
    '--allowedTools', ...PERMISSIONS.allowedTools,
    '--disallowedTools', ...PERMISSIONS.disallowedTools,
    '--append-system-prompt', p.guide,
  ];
}

/**
 * The turn's message for the CLI's stdin, as `--input-format stream-json` reads it: one line of JSON, a user message
 * with the images first, in order, then the text. Stdin is closed after it.
 */
export function userMessageLine(text: string, images: ImageData[]): string {
  const content = [
    ...images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.type, data: image.data } })),
    { type: 'text', text },
  ];
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
}

/**
 * The child's environment. An app started from inside Claude Code inherits host variables (CLAUDE_CODE_SIMPLE=1 makes the
 * CLI look logged out, a proxy ANTHROPIC_BASE_URL misroutes it), and an API key would bypass the owner's subscription.
 */
export function claudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (key === 'ANTHROPIC_API_KEY' || key === 'ANTHROPIC_AUTH_TOKEN' || key === 'ANTHROPIC_BASE_URL') continue;
    if (key.startsWith('CLAUDE') && key !== 'CLAUDE_CONFIG_DIR') continue;
    out[key] = value;
  }
  return out;
}

interface PageRef {
  title: string;
  path: string;
}

/** Blocks of a page, as they're written in its file, and where they sit on it, in words. */
interface BlockRef extends PageRef {
  where: string;
  text: string;
}

/** A code fence longer than any run of backticks in the text, and at least three long. */
function fenceFor(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((most, run) => Math.max(most, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * The message plus what the owner attached: pages, then each block as fenced JSON, then each selected passage in turn,
 * quoted. Empty sections are left out.
 */
export function buildPrompt(p: { message: string; openPage: PageRef | null; references: PageRef[]; blocks: BlockRef[]; selections: { title: string; text: string }[] }): string {
  const parts = [p.message];
  const refs: string[] = [];
  if (p.openPage) refs.push(`- The page open now: ${p.openPage.title} (${p.openPage.path})`);
  for (const ref of p.references) if (ref.path !== p.openPage?.path) refs.push(`- ${ref.title} (${ref.path})`);
  if (refs.length) parts.push(['References:', ...refs].join('\n'));
  for (const block of p.blocks) {
    const fence = fenceFor(block.text);
    parts.push([`Block from ${block.title} (${block.path}), ${block.where}:`, `${fence}json`, block.text, fence].join('\n'));
  }
  for (const selection of p.selections) parts.push([`Selected text from ${selection.title}:`, ...selection.text.split('\n').map((line) => `> ${line}`)].join('\n'));
  return parts.join('\n\n');
}
