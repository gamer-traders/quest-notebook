/*
  A stand-in for the claude CLI, for tests only: run as `node fake-claude.mjs <claude arguments>`.
  `--version` and `auth status` answer like the real CLI. A turn needs `--input-format stream-json`, and reads its
  message from stdin as the real CLI does: the first line, a stream-json user message, once stdin is closed. It
  picks what to do from the prompt (the message's text block), writes into its working directory like Claude would,
  and prints recorded stream-json lines with the recorded workspace root (/WS) replaced by its own working directory.
  A message it can't read is an error on stderr, exit 1.

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
    "no position"    creates Markets/R.json with a Write: a page with no position, as the app would fill in
    "inline strokes" adds a drawing block with its strokes inline to Markets/A.json with an Edit, as the app would
                     move to a drawing file
      "hold"           either of these two waits for the file FAKE_GO to exist before it finishes
    "fail auth"      a failed login result, exit 1
    "refuse"         prints denied.jsonl
    "odd session"    a reply whose session id isn't a UUID
    "lost session"   with --resume: "No conversation found" on stderr, exit 1

  Environment:
    FAKE_LOG=<file>       a turn first writes { argv, envKeys, path, prompt, images } there (keep it outside the
                          workspace); `prompt` is the text block, `images` is [{ type, bytes }] for each image block
    FAKE_EXIT_AT_ONCE=1   a turn exits with code 3 at once, before reading stdin
    FAKE_LOGGED_OUT=1     `auth status` says loggedIn: false
    FAKE_AUTH_BROKEN=1    `auth status` prints something that isn't JSON
    FAKE_GO=<file>        a "hold" turn finishes once this file exists
*/
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

/** Kept equal to service.test.ts. */
const PARAGRAPH = { type: 'paragraph', text: 'Hello from Claude.' };
const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1 1 L9 9"/></svg>\n';
const OTHER = { type: 'paragraph', text: 'Written by another app.' };
const R_PAGE = `${JSON.stringify({ id: 'rng00001', title: 'R', created: '2026-10-21T00:00:00.000Z', updated: '2026-10-21T00:00:00.000Z', blocks: [] }, null, 2)}\n`;
const INLINE = { type: 'drawing', id: 'd1', height: 200, strokes: [{ tool: 'pen', color: 'ink', size: 3, points: '10,10,0.5 60,60,0.5' }] };

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

/** The prompt and the images of the stream-json user message on the first line of stdin; null when it isn't one. */
function readMessage(input) {
  try {
    const content = JSON.parse(input.split('\n')[0]).message.content;
    const text = content.find((block) => block.type === 'text');
    if (typeof text?.text !== 'string') return null;
    const images = content
      .filter((block) => block.type === 'image')
      .map((block) => ({ type: block.source.media_type, bytes: Buffer.from(block.source.data, 'base64').length }));
    return { prompt: text.text, images };
  } catch {
    return null;
  }
}

function turn({ prompt, images }) {
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

  const log = { argv: args, envKeys: Object.keys(process.env), path: process.env.PATH ?? '', prompt, images };
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

  // Ends the turn with this text: at once, or for "hold" once FAKE_GO exists.
  const finish = (text) => {
    const end = () => print([textStart(), delta(text), success(text)]);
    if (!prompt.includes('hold')) return end();
    const timer = setInterval(() => {
      if (!existsSync(process.env.FAKE_GO ?? '')) return;
      clearInterval(timer);
      end();
    }, 10);
  };

  if (prompt.includes('no position')) {
    print([init, tool('Write', 'toolu_pos_1', { file_path: `${cwd}/Markets/R.json`, content: R_PAGE })], () => {
      writeFileSync(join(cwd, 'Markets/R.json'), R_PAGE);
      finish('I made a page.');
    });
    return;
  }

  if (prompt.includes('inline strokes')) {
    print([init, tool('Edit', 'toolu_ink_1', { file_path: `${cwd}/Markets/A.json`, old_string: ']', new_string: ', …]' })], () => {
      appendTo('Markets/A.json', INLINE);
      finish('I drew on the page.');
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
} else if (process.env.FAKE_EXIT_AT_ONCE === '1') {
  process.exit(3);
} else if (!args.includes('--input-format') || args[args.indexOf('--input-format') + 1] !== 'stream-json') {
  process.stderr.write('fake-claude: expected --input-format stream-json\n');
  process.exitCode = 1;
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    const message = readMessage(input);
    if (message) return turn(message);
    process.stderr.write('fake-claude: stdin did not hold a stream-json user message\n');
    process.exitCode = 1;
  });
}
