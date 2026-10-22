import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { buildPrompt, claudeArgs, claudeEnv, isSessionId, PERMISSIONS, userMessageLine } from './command';

test('the permission constant matches permissions.json', () => {
  const json = JSON.parse(readFileSync(join(__dirname, 'permissions.json'), 'utf8'));
  expect(PERMISSIONS.permissionMode).toBe(json.permissionMode);
  expect(PERMISSIONS.tools).toEqual(json.tools);
  expect(PERMISSIONS.allowedTools).toEqual(json.allowedTools);
  expect(PERMISSIONS.disallowedTools).toEqual(json.disallowedTools);
});

const args = (over: Partial<Parameters<typeof claudeArgs>[0]> = {}) => claudeArgs({ sessionId: null, guide: 'GUIDE', ...over });

const SESSION = 'e607f87c-c213-4764-b30b-b92b8927eec4';

test('args with a session id', () => {
  const a = args({ sessionId: SESSION });
  expect(a.slice(0, 3)).toEqual(['-p', '--input-format', 'stream-json']);
  expect(a.slice(a.indexOf('--resume'), a.indexOf('--resume') + 2)).toEqual(['--resume', SESSION]);
  for (const flag of ['--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--restricted', '--strict-mcp-config', '--permission-mode', 'default']) expect(a).toContain(flag);
  expect(a[a.indexOf('--tools') + 1]).toBe('Read,Glob,Grep,Edit,Write');
  for (const rule of [...PERMISSIONS.allowedTools, ...PERMISSIONS.disallowedTools]) expect(a).toContain(rule);
  expect(a[a.indexOf('--append-system-prompt') + 1]).toBe('GUIDE');
  for (const bad of ['--bare', '--settings', 'acceptEdits']) expect(a).not.toContain(bad);
});

test('args without a session id have no --resume', () => {
  expect(args()).not.toContain('--resume');
});

test('a session id must be a UUID, so it can never be read as an option', () => {
  expect(isSessionId(SESSION)).toBe(true);
  expect(isSessionId(SESSION.toUpperCase())).toBe(true);
  for (const bad of ['--settings=evil.json', '-r', '', 'abc-123', `${SESSION} `, `${SESSION}\n--bare`, `x${SESSION}`]) {
    expect(isSessionId(bad)).toBe(false);
    expect(() => args({ sessionId: bad })).toThrow();
  }
});

test('allowed and denied rules follow their flag, each as its own argument', () => {
  const a = args();
  const at = a.indexOf('--allowedTools');
  expect(a.slice(at + 1, at + 1 + PERMISSIONS.allowedTools.length)).toEqual(PERMISSIONS.allowedTools);
  const dt = a.indexOf('--disallowedTools');
  expect(a.slice(dt + 1, dt + 1 + PERMISSIONS.disallowedTools.length)).toEqual(PERMISSIONS.disallowedTools);
});

test('the message goes in on stdin: no -- and no prompt in the arguments, the guide last', () => {
  for (const a of [args(), args({ sessionId: SESSION })]) {
    expect(a).not.toContain('--');
    expect(a.filter((x) => x === '--input-format')).toHaveLength(1);
    expect(a.slice(-2)).toEqual(['--append-system-prompt', 'GUIDE']);
  }
});

const PNG = 'iVBORw0KGgo=';
const JPEG = '/9j/4AAQ';

test('userMessageLine is one stream-json user message: the images first, in order, then the text', () => {
  const line = userMessageLine('What is this?', [
    { type: 'image/png', data: PNG },
    { type: 'image/jpeg', data: JPEG },
  ]);
  expect(line.endsWith('\n')).toBe(true);
  expect(line.indexOf('\n')).toBe(line.length - 1);
  expect(JSON.parse(line)).toEqual({
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG } },
        { type: 'text', text: 'What is this?' },
      ],
    },
  });
});

test('userMessageLine with no images is the text alone, and any text stays on one line, as it was', () => {
  expect(userMessageLine('hi', [])).toBe('{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}\n');
  for (const text of ['- make a list\n- and more', 'please Edit(/*.md) now', '--bare', 'line\r\nbreak \u2028 "quoted" \\ end']) {
    const line = userMessageLine(text, []);
    expect(line.indexOf('\n')).toBe(line.length - 1);
    expect(JSON.parse(line).message.content).toEqual([{ type: 'text', text }]);
  }
});

test('claudeEnv drops the API and host variables', () => {
  expect(claudeEnv({ PATH: 'x', ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't' })).toEqual({ PATH: 'x' });
  const out = claudeEnv({ PATH: 'x', HOME: '/h', ANTHROPIC_BASE_URL: 'u', CLAUDECODE: '1', CLAUDE_CODE_SIMPLE: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CONFIG_DIR: '/c' });
  expect(out).toEqual({ PATH: 'x', HOME: '/h', CLAUDE_CONFIG_DIR: '/c' });
});

test('claudeEnv does not mutate its input', () => {
  const env = { A: '1', ANTHROPIC_API_KEY: 'k' };
  claudeEnv(env);
  expect(env).toEqual({ A: '1', ANTHROPIC_API_KEY: 'k' });
});

const none = { openPage: null, references: [], blocks: [], selections: [] };

test('buildPrompt lays out every part', () => {
  const text = buildPrompt({
    message: 'Tidy this',
    openPage: { title: 'Setup', path: 'Markets/Setup.json' },
    references: [{ title: 'Risk', path: 'Markets/Risk.json' }],
    blocks: [],
    selections: [{ title: 'Setup', text: 'line one\nline two' }],
  });
  expect(text).toBe(
    ['Tidy this', '', 'References:', '- The page open now: Setup (Markets/Setup.json)', '- Risk (Markets/Risk.json)', '', 'Selected text from Setup:', '> line one', '> line two'].join('\n'),
  );
});

test('buildPrompt gives the message alone when nothing is attached', () => {
  expect(buildPrompt({ message: 'Hello', ...none })).toBe('Hello');
});

test('buildPrompt leaves out empty sections', () => {
  expect(buildPrompt({ message: 'M', ...none, references: [{ title: 'A', path: 'S/A.json' }] })).toBe('M\n\nReferences:\n- A (S/A.json)');
  expect(buildPrompt({ message: 'M', ...none, selections: [{ title: 'A', text: 'x' }] })).toBe('M\n\nSelected text from A:\n> x');
});

test('buildPrompt quotes every selection in turn, one block after another', () => {
  const text = buildPrompt({ message: 'M', ...none, selections: [{ title: 'A', text: 'one' }, { title: 'B', text: 'two\nthree' }, { title: 'A', text: 'four' }] });
  expect(text).toBe(['M', '', 'Selected text from A:', '> one', '', 'Selected text from B:', '> two', '> three', '', 'Selected text from A:', '> four'].join('\n'));
});

test('buildPrompt lists the open page once', () => {
  const text = buildPrompt({
    message: 'M',
    openPage: { title: 'A', path: 'S/A.json' },
    references: [{ title: 'A', path: 'S/A.json' }, { title: 'B', path: 'S/B.json' }],
    blocks: [],
    selections: [],
  });
  expect(text).toBe('M\n\nReferences:\n- The page open now: A (S/A.json)\n- B (S/B.json)');
});

const BLOCK = '{\n  "type": "paragraph",\n  "text": "Buy the dip"\n}';

test('buildPrompt puts each block after the references and before the selections, as fenced JSON', () => {
  const text = buildPrompt({
    message: 'Explain these',
    openPage: { title: 'Setup', path: 'Markets/Setup.json' },
    references: [],
    blocks: [
      { title: 'Setup', path: 'Markets/Setup.json', where: 'block 4 of 12', text: BLOCK },
      { title: 'Risk', path: 'Markets/Risk.json', where: 'blocks 3–5 of 12', text: '[1, 2]' },
    ],
    selections: [{ title: 'Setup', text: 'quoted' }],
  });
  expect(text).toBe(
    [
      'Explain these',
      '',
      'References:',
      '- The page open now: Setup (Markets/Setup.json)',
      '',
      'Block from Setup (Markets/Setup.json), block 4 of 12:',
      '```json',
      BLOCK,
      '```',
      '',
      'Block from Risk (Markets/Risk.json), blocks 3–5 of 12:',
      '```json',
      '[1, 2]',
      '```',
      '',
      'Selected text from Setup:',
      '> quoted',
    ].join('\n'),
  );
});

test('buildPrompt gives a block alone, with no References section', () => {
  expect(buildPrompt({ message: 'M', ...none, blocks: [{ title: 'A', path: 'S/A.json', where: 'inside block 2 of 3', text: '{}' }] })).toBe(
    'M\n\nBlock from A (S/A.json), inside block 2 of 3:\n```json\n{}\n```',
  );
});

test('buildPrompt fences a block that holds backticks with a longer fence', () => {
  const block = (text: string) => buildPrompt({ message: 'M', ...none, blocks: [{ title: 'A', path: 'S/A.json', where: 'block 1 of 1', text }] });
  const code = '{ "text": "```js\\nx\\n```" }';
  expect(block(code)).toBe(`M\n\nBlock from A (S/A.json), block 1 of 1:\n\`\`\`\`json\n${code}\n\`\`\`\``);
  const longer = '{ "text": "a ````` b `` c" }';
  expect(block(longer)).toBe(`M\n\nBlock from A (S/A.json), block 1 of 1:\n${'`'.repeat(6)}json\n${longer}\n${'`'.repeat(6)}`);
  // Two backticks in a row need nothing longer.
  expect(block('{ "text": "a `` b" }')).toContain('\n```json\n');
});
