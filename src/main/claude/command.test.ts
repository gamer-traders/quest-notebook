import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { buildPrompt, claudeArgs, claudeEnv, isSessionId, PERMISSIONS } from './command';

test('the permission constant matches permissions.json', () => {
  const json = JSON.parse(readFileSync(join(__dirname, 'permissions.json'), 'utf8'));
  expect(PERMISSIONS.permissionMode).toBe(json.permissionMode);
  expect(PERMISSIONS.tools).toEqual(json.tools);
  expect(PERMISSIONS.allowedTools).toEqual(json.allowedTools);
  expect(PERMISSIONS.disallowedTools).toEqual(json.disallowedTools);
});

const args = (over: Partial<Parameters<typeof claudeArgs>[0]> = {}) => claudeArgs({ prompt: 'hi', sessionId: null, guide: 'GUIDE', ...over });

const SESSION = 'e607f87c-c213-4764-b30b-b92b8927eec4';

test('args with a session id', () => {
  const a = args({ sessionId: SESSION });
  expect(a[0]).toBe('-p');
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

test('the prompt is last, after --', () => {
  const a = args({ prompt: 'make a list' });
  expect(a[a.length - 2]).toBe('--');
  expect(a[a.length - 1]).toBe('make a list');
});

test('a prompt that starts with - or contains Edit( stays one argument', () => {
  for (const prompt of ['- make a list\n- and more', 'please Edit(/*.md) now', '--bare']) {
    const a = args({ prompt });
    expect(a.slice(-2)).toEqual(['--', prompt]);
    expect(a.filter((x) => x === prompt)).toHaveLength(1);
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

const none = { openPage: null, references: [], selections: [] };

test('buildPrompt lays out every part', () => {
  const text = buildPrompt({
    message: 'Tidy this',
    openPage: { title: 'Setup', path: 'Markets/Setup.json' },
    references: [{ title: 'Risk', path: 'Markets/Risk.json' }],
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
    selections: [],
  });
  expect(text).toBe('M\n\nReferences:\n- The page open now: A (S/A.json)\n- B (S/B.json)');
});
