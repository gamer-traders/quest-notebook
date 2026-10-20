/**
 * JSON for files people and AI read: two-space indents, and an object or array of plain values kept on one
 * line when it fits, so a candle or a chart level reads as one row instead of eight.
 */
export function formatJson(value: unknown, width = 120): string {
  return `${format(toJsonValue(value), '', width) ?? 'null'}\n`;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** What JSON.stringify would keep: undefined and functions dropped from objects, null in arrays, toJSON applied. */
function toJsonValue(value: unknown): Json {
  return JSON.parse(JSON.stringify(value) ?? 'null') as Json;
}

const isContainer = (v: Json): v is Json[] | { [key: string]: Json } => typeof v === 'object' && v !== null;

function format(value: Json, indent: string, width: number): string {
  if (!isContainer(value)) return JSON.stringify(value);
  const isArray = Array.isArray(value);
  const entries: [string | null, Json][] = isArray ? value.map((v) => [null, v]) : Object.entries(value);
  const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
  if (entries.length === 0) return open + close;

  const label = (key: string | null) => (key === null ? '' : `${JSON.stringify(key)}: `);
  if (entries.every(([, v]) => !isContainer(v))) {
    const inner = entries.map(([k, v]) => label(k) + JSON.stringify(v)).join(', ');
    const line = isArray ? `[${inner}]` : `{ ${inner} }`;
    // The line sits after the indent and, at worst, a key and a trailing comma.
    if (indent.length + line.length + 1 <= width) return line;
  }

  const inner = indent + '  ';
  const lines = entries.map(([k, v]) => inner + label(k) + format(v, inner, width));
  return `${open}\n${lines.join(',\n')}\n${indent}${close}`;
}
