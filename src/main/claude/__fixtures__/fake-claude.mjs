/*
  A stand-in for the claude CLI, for tests only: run as `node fake-claude.mjs <claude arguments>`.
  `--version` and `auth status` answer like the real CLI. A turn picks what to do from the prompt (the argument
  after `--`), writes into its working directory like Claude would, and prints recorded stream-json lines with
  the recorded workspace root (/WS) replaced by its own working directory.

  Environment:
    FAKE_LOG=<file>       a turn first writes { argv, envKeys, path } there (keep it outside the workspace)
    FAKE_LOGGED_OUT=1     `auth status` says loggedIn: false
    FAKE_AUTH_BROKEN=1    `auth status` prints something that isn't JSON
*/
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

/** Kept equal to service.test.ts. */
const PARAGRAPH = { type: 'paragraph', text: 'Hello from Claude.' };
const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1 1 L9 9"/></svg>\n';

const print = (lines, then) => process.stdout.write(lines.map((line) => `${line}\n`).join(''), then);

function fixture(name) {
  const cwd = process.cwd();
  return readFileSync(join(here, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('/WS').join(cwd));
}

function turn() {
  const at = args.indexOf('--');
  const prompt = at >= 0 ? (args[at + 1] ?? '') : '';
  const init = fixture('read-and-edit.jsonl')[0];
  const sessionId = JSON.parse(init).session_id;
  const delta = (text) =>
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, session_id: sessionId, parent_tool_use_id: null });
  const success = (text) =>
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, terminal_reason: 'completed', result: text, session_id: sessionId, permission_denials: [] });

  // Signal handlers go in before anything is logged, so a test that waits for the log can signal safely.
  if (prompt.includes('sleep')) {
    process.on('SIGINT', () => {
      if (!prompt.includes('stubborn')) process.exit(130);
    });
    // "noisy": answers SIGTERM with a last reply before exiting, as a CLI flushing its output might.
    if (prompt.includes('noisy')) process.on('SIGTERM', () => print([delta('late text'), success('late text')], () => process.exit(143)));
  }

  if (process.env.FAKE_LOG) writeFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: args, envKeys: Object.keys(process.env), path: process.env.PATH ?? '' }));

  if (prompt.includes('sleep')) {
    print([init]);
    setInterval(() => {}, 1 << 30);
    return;
  }

  if (prompt.includes('new space')) {
    mkdirSync(join(process.cwd(), 'NewSpace'), { recursive: true });
    writeFileSync(join(process.cwd(), 'NewSpace/P.json'), `${JSON.stringify({ id: 'np000001', title: 'P', position: 0, blocks: [] }, null, 2)}\n`);
    print([init, delta('I made a new space.'), success('I made a new space.')]);
    return;
  }

  if (prompt.includes('fail auth')) {
    process.exitCode = 1;
    print([
      init,
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: true,
        terminal_reason: 'api_error',
        result: 'Failed to authenticate: OAuth session expired and could not be refreshed',
        session_id: 'x',
      }),
    ]);
    return;
  }

  if (prompt.includes('refuse')) {
    print(fixture('denied.jsonl'));
    return;
  }

  const pagePath = join(process.cwd(), 'Markets/A.json');
  const page = JSON.parse(readFileSync(pagePath, 'utf8'));
  page.blocks.push(PARAGRAPH);
  writeFileSync(pagePath, `${JSON.stringify(page, null, 2)}\n`);
  mkdirSync(join(process.cwd(), 'Markets/A'), { recursive: true });
  writeFileSync(join(process.cwd(), 'Markets/A/drawing-x1.svg'), DRAWING);
  print(fixture('read-and-edit.jsonl'));
}

if (args[0] === '--version') {
  print(['2.1.288 (Claude Code)']);
} else if (args[0] === 'auth' && args[1] === 'status') {
  if (process.env.FAKE_AUTH_BROKEN === '1') print(['Something went wrong']);
  else print([JSON.stringify({ loggedIn: process.env.FAKE_LOGGED_OUT !== '1', authMethod: process.env.FAKE_LOGGED_OUT === '1' ? 'none' : 'claude.ai' })]);
} else {
  turn();
}
