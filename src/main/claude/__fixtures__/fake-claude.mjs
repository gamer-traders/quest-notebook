/*
  A stand-in for the claude CLI, for tests only: run as `node fake-claude.mjs <claude arguments>`.
  `--version` and `auth status` answer like the real CLI. A turn picks what to do from the prompt (the argument
  after `--`), writes into its working directory like Claude would, and prints recorded stream-json lines with
  the recorded workspace root (/WS) replaced by its own working directory.

  Prompt words:
    (none of these)  edits Markets/A.json, creates Markets/A/drawing-x1.svg, prints read-and-edit.jsonl
    "others write"   the same, and also changes Markets/B.json without saying so (as another app would)
    "others folder"  the same, and also creates Markets/Other/Y.json without saying so
    "sleep"          prints the init line and waits. SIGINT exits 130, unless:
      "stubborn"       SIGINT is ignored
      "deaf"           SIGINT and SIGTERM are ignored
      "noisy"          SIGTERM is answered with a last reply, then exit 143
      "edit"           first does the default edits and prints read-and-edit.jsonl without its result line
    "linger"         replies, then exits while a grandchild keeps stdout open for 5 s (its pid goes in the log)
    "two parts"      text, a Read, then more text
    "new space"      creates NewSpace/P.json with a Write
    "sub page"       creates Markets/Folder/X.json with a Write, in a folder that wasn't there
    "fail auth"      a failed login result, exit 1
    "refuse"         prints denied.jsonl
    "odd session"    a reply whose session id isn't a UUID
    "lost session"   with --resume: "No conversation found" on stderr, exit 1

  Environment:
    FAKE_LOG=<file>       a turn first writes { argv, envKeys, path } there (keep it outside the workspace)
    FAKE_LOGGED_OUT=1     `auth status` says loggedIn: false
    FAKE_AUTH_BROKEN=1    `auth status` prints something that isn't JSON
*/
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

/** Kept equal to service.test.ts. */
const PARAGRAPH = { type: 'paragraph', text: 'Hello from Claude.' };
const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1 1 L9 9"/></svg>\n';
const OTHER = { type: 'paragraph', text: 'Written by another app.' };

const print = (lines, then) => process.stdout.write(lines.map((line) => `${line}\n`).join(''), then);

function fixture(name) {
  const cwd = process.cwd();
  return readFileSync(join(here, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('/WS').join(cwd));
}

function appendTo(rel, block) {
  const abs = join(process.cwd(), rel);
  const page = JSON.parse(readFileSync(abs, 'utf8'));
  page.blocks.push(block);
  writeFileSync(abs, `${JSON.stringify(page, null, 2)}\n`);
}

/** What read-and-edit.jsonl did: a paragraph added to Markets/A.json, and a drawing created beside it. */
function editPages() {
  appendTo('Markets/A.json', PARAGRAPH);
  mkdirSync(join(process.cwd(), 'Markets/A'), { recursive: true });
  writeFileSync(join(process.cwd(), 'Markets/A/drawing-x1.svg'), DRAWING);
}

function turn() {
  const at = args.indexOf('--');
  const prompt = at >= 0 ? (args[at + 1] ?? '') : '';
  const cwd = process.cwd();
  const init = fixture('read-and-edit.jsonl')[0];
  const sessionId = JSON.parse(init).session_id;
  const delta = (text) =>
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, session_id: sessionId, parent_tool_use_id: null });
  const textStart = () =>
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, session_id: sessionId, parent_tool_use_id: null });
  const tool = (name, id, input) =>
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] }, parent_tool_use_id: null, session_id: sessionId });
  const success = (text) =>
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, terminal_reason: 'completed', result: text, session_id: sessionId, permission_denials: [] });

  // Signal handlers go in before anything is logged, so a test that waits for the log can signal safely.
  if (prompt.includes('sleep')) {
    const deaf = prompt.includes('deaf');
    process.on('SIGINT', () => {
      if (!prompt.includes('stubborn') && !deaf) process.exit(130);
    });
    if (deaf) process.on('SIGTERM', () => {});
    // "noisy": answers SIGTERM with a last reply before exiting, as a CLI flushing its output might.
    else if (prompt.includes('noisy')) process.on('SIGTERM', () => print([delta('late text'), success('late text')], () => process.exit(143)));
  }

  const log = { argv: args, envKeys: Object.keys(process.env), path: process.env.PATH ?? '' };
  const writeLog = (extra = {}) => {
    if (process.env.FAKE_LOG) writeFileSync(process.env.FAKE_LOG, JSON.stringify({ ...log, ...extra }));
  };
  writeLog();

  if (prompt.includes('lost session') && args.includes('--resume')) {
    process.stderr.write(`No conversation found with session ID: ${args[args.indexOf('--resume') + 1]}\n`);
    process.exitCode = 1;
    return;
  }

  if (prompt.includes('sleep')) {
    if (prompt.includes('edit')) {
      editPages();
      print(fixture('read-and-edit.jsonl').filter((line) => JSON.parse(line).type !== 'result'));
    } else {
      print([init]);
    }
    setInterval(() => {}, 1 << 30);
    return;
  }

  if (prompt.includes('linger')) {
    const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true });
    grandchild.unref();
    writeLog({ grandchild: grandchild.pid });
    print([init, textStart(), delta('Still here.'), success('Still here.')]);
    return;
  }

  if (prompt.includes('two parts')) {
    print([init, textStart(), delta("I'll read the page."), tool('Read', 'toolu_two_1', { file_path: `${cwd}/Markets/A.json` }), textStart(), delta('Done.'), success("I'll read the page.Done.")]);
    return;
  }

  if (prompt.includes('odd session')) {
    const odd = '--settings=evil.json';
    print([JSON.stringify({ ...JSON.parse(init), session_id: odd }), delta('Hi.'), JSON.stringify({ ...JSON.parse(success('Hi.')), session_id: odd })]);
    return;
  }

  if (prompt.includes('new space')) {
    const page = `${JSON.stringify({ id: 'np000001', title: 'P', position: 0, blocks: [] }, null, 2)}\n`;
    // Like the real CLI: the tool call is reported, then run.
    print([init, tool('Write', 'toolu_new_1', { file_path: `${cwd}/NewSpace/P.json`, content: page })], () => {
      mkdirSync(join(cwd, 'NewSpace'), { recursive: true });
      writeFileSync(join(cwd, 'NewSpace/P.json'), page);
      print([delta('I made a new space.'), success('I made a new space.')]);
    });
    return;
  }

  if (prompt.includes('sub page')) {
    const page = `${JSON.stringify({ id: 'sub00001', title: 'X', position: 0, blocks: [] }, null, 2)}\n`;
    print([init, tool('Write', 'toolu_sub_1', { file_path: `${cwd}/Markets/Folder/X.json`, content: page })], () => {
      mkdirSync(join(cwd, 'Markets/Folder'), { recursive: true });
      writeFileSync(join(cwd, 'Markets/Folder/X.json'), page);
      print([delta('I made a sub-page.'), success('I made a sub-page.')]);
    });
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

  editPages();
  if (prompt.includes('others write')) appendTo('Markets/B.json', OTHER);
  if (prompt.includes('others folder')) {
    mkdirSync(join(cwd, 'Markets/Other'), { recursive: true });
    writeFileSync(join(cwd, 'Markets/Other/Y.json'), `${JSON.stringify({ id: 'oth00001', title: 'Y', position: 0, blocks: [] }, null, 2)}\n`);
  }
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
