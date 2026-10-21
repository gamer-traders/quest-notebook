import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LineSplitter, parseStreamLine, type StreamItem } from './events';

function fixture(name: string, root = '/WS'): StreamItem[] {
  const lines = readFileSync(join(__dirname, '__fixtures__', name), 'utf8').split('\n');
  return lines.flatMap((line) => parseStreamLine(line, root));
}

function resultText(name: string): string {
  const lines = readFileSync(join(__dirname, '__fixtures__', name), 'utf8').split('\n').filter(Boolean);
  return JSON.parse(lines[lines.length - 1]).result;
}

function initSessionId(name: string): string {
  const lines = readFileSync(join(__dirname, '__fixtures__', name), 'utf8').split('\n').filter(Boolean);
  return JSON.parse(lines[0]).session_id;
}

const kinds = (items: StreamItem[]) => items.map((i) => i.kind);
const actions = (items: StreamItem[]) => items.flatMap((i) => (i.kind === 'action' ? [i.action] : []));
const joinedText = (items: StreamItem[]) => items.map((i) => (i.kind === 'text' ? i.text : '')).join('');

describe('parseStreamLine on the fixtures', () => {
  it('read-and-edit: session, actions in order, text, done', () => {
    const items = fixture('read-and-edit.jsonl');
    const k = kinds(items);
    expect(k[0]).toBe('session');
    expect(k.filter((x) => x === 'session')).toHaveLength(1);
    expect(k[k.length - 1]).toBe('done');
    expect(k.indexOf('text')).toBeGreaterThan(k.lastIndexOf('action'));
    expect(actions(items).map(({ id, ...rest }) => rest)).toEqual([
      { verb: 'read', path: 'Markets/A.json' },
      { verb: 'edited', path: 'Markets/A.json' },
      { verb: 'created', path: 'Markets/A/drawing-x1.svg' },
    ]);
    expect(actions(items).every((a) => typeof a.id === 'string' && a.id.length > 0)).toBe(true);
    expect(joinedText(items)).toBe(resultText('read-and-edit.jsonl'));
    expect(items[items.length - 1]).toEqual({ kind: 'done', ok: true, refused: [] });
  });

  it('denied: an action per attempt, refusals, and the four denial ids', () => {
    const items = fixture('denied.jsonl');
    expect(actions(items).map(({ id, ...rest }) => rest)).toEqual([
      { verb: 'read', path: 'README.md' },
      { verb: 'read', path: '.quest/workspace.json' },
      { verb: 'edited', path: 'README.md' },
      { verb: 'edited', path: '.quest/workspace.json' },
      { verb: 'created', path: 'New.txt' },
      { verb: 'created', detail: '/LAB/outside.json' },
      { verb: 'read', detail: '/LAB/outside.json' },
    ]);
    const refused = items.filter((i) => i.kind === 'refused');
    expect(refused).toHaveLength(3);
    expect(refused.every((r) => r.kind === 'refused' && r.id && r.message)).toBe(true);
    const done = items[items.length - 1];
    expect(done).toEqual({
      kind: 'done',
      ok: true,
      refused: ['toolu_01LoCENCcmhoC9RHHsBMyq27', 'toolu_01PJkQHSxryFKttNhGwmoV9t', 'toolu_012tiZcqnGrt5DutPowRKo4Y', 'toolu_011PvP1pN99ZvfmCCt8oGDqS'],
    });
    // The "File has not been read yet" failure (the Write of /LAB/outside.json) is an ordinary failed call.
    const writeOutside = actions(items).find((a) => a.verb === 'created' && a.detail === '/LAB/outside.json');
    expect(done.kind === 'done' && done.refused).not.toContain(writeOutside?.id);
    expect(joinedText(items)).toBe(resultText('denied.jsonl'));
  });

  it('resume: the init session id, text, done', () => {
    const items = fixture('resume.jsonl');
    expect(kinds(items)[0]).toBe('session');
    expect(items[0]).toEqual({ kind: 'session', sessionId: initSessionId('resume.jsonl') });
    expect(kinds(items).filter((k) => k !== 'text')).toEqual(['session', 'done']);
    expect(items[items.length - 1]).toMatchObject({ kind: 'done', ok: true });
    expect(joinedText(items)).toBe(resultText('resume.jsonl'));
  });
});

describe('parseStreamLine: done', () => {
  const result = (extra: object) => JSON.stringify({ type: 'result', subtype: 'success', session_id: 'x', ...extra });

  it('reads an expired login as logged out', () => {
    const text = 'Failed to authenticate: OAuth session expired and could not be refreshed';
    expect(parseStreamLine(result({ is_error: true, terminal_reason: 'api_error', result: text }), '/WS')).toEqual([
      { kind: 'done', ok: false, error: text, loggedOut: true, refused: [] },
    ]);
  });

  it('reads "Not logged in" as logged out', () => {
    const text = 'Not logged in · Please run /login';
    expect(parseStreamLine(result({ is_error: true, result: text }), '/WS')).toEqual([
      { kind: 'done', ok: false, error: text, loggedOut: true, refused: [] },
    ]);
  });

  it('keeps other failures as plain errors', () => {
    const [done] = parseStreamLine(result({ is_error: true, result: 'Claude AI usage limit reached' }), '/WS');
    expect(done).toEqual({ kind: 'done', ok: false, error: 'Claude AI usage limit reached', refused: [] });
    expect(done).not.toHaveProperty('loggedOut');
  });
});

describe('parseStreamLine: actions', () => {
  const tool = (name: string, input: object, extra: object = {}) =>
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name, input }] }, parent_tool_use_id: null, ...extra });

  it('Glob and Grep are searches with the pattern as detail', () => {
    expect(parseStreamLine(tool('Glob', { pattern: '**/*.json' }), '/WS')).toEqual([
      { kind: 'action', action: { id: 'toolu_1', verb: 'searched', detail: '**/*.json' } },
    ]);
    expect(parseStreamLine(tool('Grep', { pattern: 'todo', path: '/WS/Markets' }), '/WS')).toEqual([
      { kind: 'action', action: { id: 'toolu_1', verb: 'searched', path: 'Markets', detail: 'todo' } },
    ]);
    expect(parseStreamLine(tool('Grep', { pattern: 'todo', path: '/LAB' }), '/WS')).toEqual([
      { kind: 'action', action: { id: 'toolu_1', verb: 'searched', detail: 'todo' } },
    ]);
  });

  it('an unknown tool is "other" with its name', () => {
    expect(parseStreamLine(tool('WebFetch', { url: 'https://x' }), '/WS')).toEqual([
      { kind: 'action', action: { id: 'toolu_1', verb: 'other', detail: 'WebFetch' } },
    ]);
  });

  it('a root with a trailing slash gives the same paths', () => {
    expect(parseStreamLine(tool('Read', { file_path: '/WS/Markets/A.json' }), '/WS/')).toEqual(
      parseStreamLine(tool('Read', { file_path: '/WS/Markets/A.json' }), '/WS'),
    );
  });

  it('a sibling folder sharing the root as a prefix is outside', () => {
    expect(parseStreamLine(tool('Read', { file_path: '/WS2/a.json' }), '/WS')).toEqual([
      { kind: 'action', action: { id: 'toolu_1', verb: 'read', detail: '/WS2/a.json' } },
    ]);
  });

  it('gives several actions for several tool_use blocks', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 'a', name: 'Read', input: { file_path: '/WS/x.json' } }, { type: 'tool_use', id: 'b', name: 'Edit', input: { file_path: '/WS/y.json' } }] },
      parent_tool_use_id: null,
    });
    expect(actions(parseStreamLine(line, '/WS')).map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('ignores events from a sub-agent', () => {
    expect(parseStreamLine(tool('Read', { file_path: '/WS/x.json' }, { parent_tool_use_id: 'toolu_p' }), '/WS')).toEqual([]);
    const delta = { type: 'stream_event', parent_tool_use_id: 'toolu_p', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } };
    expect(parseStreamLine(JSON.stringify(delta), '/WS')).toEqual([]);
  });

  it('gives nothing for the synthetic auth-failure message', () => {
    const line = JSON.stringify({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Failed to authenticate' }] }, error: 'authentication_failed', parent_tool_use_id: null });
    expect(parseStreamLine(line, '/WS')).toEqual([]);
  });
});

describe('parseStreamLine: garbage', () => {
  it('gives nothing', () => {
    for (const line of ['not json', '', '   ', '{"type":"system","subtype":"status"}', '[1]', 'null', '{"type":"rate_limit_event"}']) {
      expect(parseStreamLine(line, '/WS')).toEqual([]);
    }
  });
});

describe('LineSplitter', () => {
  it('carries a partial line over', () => {
    const s = new LineSplitter();
    expect(s.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(s.push(':2}\n')).toEqual(['{"b":2}']);
    expect(s.end()).toEqual([]);
  });

  it('handles \\r\\n', () => {
    const s = new LineSplitter();
    expect(s.push('a\r\nb\r')).toEqual(['a']);
    expect(s.push('\nc\r\n')).toEqual(['b', 'c']);
  });

  it('flushes a last unterminated line on end()', () => {
    const s = new LineSplitter();
    expect(s.push('a\nb')).toEqual(['a']);
    expect(s.end()).toEqual(['b']);
    expect(s.end()).toEqual([]);
  });
});
