import type { ChatAction } from '@shared/ipc';

export type StreamItem =
  | { kind: 'session'; sessionId: string }
  | { kind: 'text'; text: string }
  /** A new block of text begins: text from separate blocks shouldn't run together. */
  | { kind: 'text-start' }
  | { kind: 'action'; action: ChatAction }
  | { kind: 'refused'; id: string; message: string }
  | { kind: 'done'; ok: boolean; error?: string; loggedOut?: boolean; refused: string[] };

const LOGGED_OUT = /not logged in|failed to authenticate|please run \/login|authentication_failed/i;

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** `abs` relative to `root` with `/` separators, or null when it isn't inside it. */
function relativeTo(root: string, abs: string): string | null {
  const base = root.replace(/\/+$/, '');
  if (!abs.startsWith(base + '/')) return null;
  return abs.slice(base.length + 1) || null;
}

const VERBS: Record<string, ChatAction['verb']> = { Read: 'read', Edit: 'edited', Write: 'created', Glob: 'searched', Grep: 'searched' };

function toAction(block: Json, root: string): ChatAction {
  const name = str(block.name) ?? '';
  const input = isObject(block.input) ? block.input : {};
  const verb = VERBS[name] ?? 'other';
  const action: ChatAction = { verb };
  const id = str(block.id);
  if (id) action.id = id;
  if (verb === 'other') {
    action.detail = name;
    return action;
  }
  const search = verb === 'searched';
  const given = str(input.file_path) ?? (search ? str(input.path) : undefined);
  if (search && str(input.pattern)) action.detail = str(input.pattern);
  if (given) {
    const rel = relativeTo(root, given);
    if (rel !== null) action.path = rel;
    else if (!search) action.detail = given;
  }
  return action;
}

/** What one stdout line of `claude -p --output-format stream-json` means to the panel. Anything unrecognised gives []. */
export function parseStreamLine(line: string, root: string): StreamItem[] {
  if (!line.trim()) return [];
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isObject(event)) return [];
  if (event.parent_tool_use_id != null) return [];

  switch (event.type) {
    case 'system': {
      if (event.subtype === 'init') {
        const sessionId = str(event.session_id);
        return sessionId ? [{ kind: 'session', sessionId }] : [];
      }
      if (event.subtype === 'permission_denied') {
        const id = str(event.tool_use_id);
        return id ? [{ kind: 'refused', id, message: str(event.message) ?? '' }] : [];
      }
      return [];
    }
    case 'stream_event': {
      const inner = event.event;
      if (isObject(inner) && inner.type === 'content_block_start') {
        return isObject(inner.content_block) && inner.content_block.type === 'text' ? [{ kind: 'text-start' }] : [];
      }
      if (!isObject(inner) || inner.type !== 'content_block_delta' || !isObject(inner.delta)) return [];
      const text = str(inner.delta.text);
      return inner.delta.type === 'text_delta' && text !== undefined ? [{ kind: 'text', text }] : [];
    }
    case 'assistant': {
      const content = isObject(event.message) ? event.message.content : undefined;
      if (!Array.isArray(content)) return [];
      return content.filter((b): b is Json => isObject(b) && b.type === 'tool_use').map((b) => ({ kind: 'action' as const, action: toAction(b, root) }));
    }
    case 'result': {
      const isError = event.is_error === true;
      const denials = Array.isArray(event.permission_denials) ? event.permission_denials : [];
      const refused = denials.flatMap((d) => (isObject(d) && str(d.tool_use_id) ? [str(d.tool_use_id) as string] : []));
      const done: StreamItem = { kind: 'done', ok: !isError, refused };
      if (isError) {
        const text = str(event.result) ?? '';
        done.error = text;
        if (LOGGED_OUT.test(text)) done.loggedOut = true;
      }
      return [done];
    }
    default:
      return [];
  }
}

/** Turns stdout chunks into whole lines, carrying a partial line over to the next chunk. */
export class LineSplitter {
  private rest = '';

  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split('\n');
    this.rest = parts.pop() ?? '';
    return parts.map((p) => p.replace(/\r$/, ''));
  }

  /** The last line, if the stream ended without a newline. */
  end(): string[] {
    const last = this.rest.replace(/\r$/, '');
    this.rest = '';
    return last ? [last] : [];
  }
}
