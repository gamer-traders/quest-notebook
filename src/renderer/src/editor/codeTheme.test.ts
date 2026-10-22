import { expect, test } from 'vitest';
import { codeTheme, hexColor, parseColor, type CodeTokens } from './codeTheme';

// The app's tokens, as styles.css sets them in light and dark.
const light: CodeTokens = {
  background: '#edf1f5',
  sheet: '#fafbfc',
  ink: '#17202a',
  inkSoft: '#3b4754',
  pencil: '#5c6977',
  rule: '#d3dbe4',
  ruleStrong: '#b8c3cf',
  mark: 'rgba(247, 201, 72, 0.45)',
  markSolid: '#f7c948',
  focus: '#2f6fde',
  blue: '#1d5bc2',
  green: '#0a6b59',
  red: '#a8263b',
  purple: '#643dc2',
  yellow: '#946600',
  down: '#c93a50',
};

const dark: CodeTokens = {
  background: '#1a1d21',
  sheet: '#131519',
  ink: '#f5f7fb',
  inkSoft: '#c5c9d0',
  pencil: '#8b8f96',
  rule: '#212327',
  ruleStrong: '#2c2f35',
  mark: 'rgba(242, 201, 76, 0.3)',
  markSolid: '#f2c94c',
  focus: '#e0e4e7',
  blue: '#8ab4ff',
  green: '#54d6b4',
  red: '#ff8d9b',
  purple: '#b9a0ff',
  yellow: '#f2c94c',
  down: '#ec6475',
};

const rgbOf = (css: string) => {
  const c = parseColor(css);
  if (!c) throw new Error(`not a colour: ${css}`);
  return `${c.r},${c.g},${c.b}`;
};

/** Every colour the theme uses, workbench and token colours alike. */
function themeColours(tokens: CodeTokens, isDark: boolean): string[] {
  const theme = codeTheme(tokens, isDark);
  return [...Object.values(theme.colors), ...theme.rules.flatMap((r) => (r.foreground ? [`#${r.foreground}`] : [])), ...theme.rules.flatMap((r) => (r.background ? [`#${r.background}`] : []))];
}

test.each([
  ['light', light, false],
  ['dark', dark, true],
] as const)('in %s, every colour comes from the app tokens: none is left to VS Code', (_name, tokens, isDark) => {
  const theme = codeTheme(tokens, isDark);
  expect(theme.inherit).toBe(false);
  expect(theme.base).toBe(isDark ? 'vs-dark' : 'vs');
  const inputs = new Set(Object.values(tokens).map(rgbOf));
  for (const colour of themeColours(tokens, isDark)) {
    expect(colour).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
    expect(inputs.has(rgbOf(colour))).toBe(true);
  }
});

test('each token goes to the colour it is read for, whatever the colours are', () => {
  // Every token a colour of its own, so each use can be traced back to the token it came from.
  const names = Object.keys(light) as (keyof CodeTokens)[];
  const own = Object.fromEntries(names.map((name, i) => [name, `#${(i + 1).toString(16).padStart(2, '0')}0000`])) as CodeTokens;
  own.mark = 'rgba(17, 0, 0, 0.5)';
  const theme = codeTheme(own, false);
  const rule = (token: string) => theme.rules.find((r) => r.token === token);

  expect(theme.colors['editor.background']).toBe(own.background);
  expect(theme.colors['editor.foreground']).toBe(own.ink);
  expect(theme.colors['editorGutter.background']).toBe(own.background);
  expect(theme.colors['editorLineNumber.foreground']).toBe(own.pencil);
  expect(theme.colors['editorLineNumber.activeForeground']).toBe(own.ink);
  expect(theme.colors['editorCursor.foreground']).toBe(own.ink);
  expect(theme.colors['editor.selectionBackground']).toBe('#11000080');
  expect(theme.colors['editorWidget.background']).toBe(own.sheet);
  expect(theme.colors['focusBorder']).toBe(own.focus);

  expect(rule('')).toMatchObject({ foreground: own.ink.slice(1) });
  expect(rule('comment')).toMatchObject({ foreground: own.pencil.slice(1), fontStyle: 'italic' });
  expect(rule('keyword')?.foreground).toBe(own.blue.slice(1));
  expect(rule('string')?.foreground).toBe(own.green.slice(1));
  expect(rule('number')?.foreground).toBe(own.yellow.slice(1));
  expect(rule('type')?.foreground).toBe(own.purple.slice(1));
  expect(rule('function')?.foreground).toBe(own.purple.slice(1));
  expect(rule('regexp')?.foreground).toBe(own.red.slice(1));
  expect(rule('delimiter')?.foreground).toBe(own.inkSoft.slice(1));
});

test('a token that cannot be read takes the ink, so a colour is never invented', () => {
  const theme = codeTheme({ ...light, blue: '', green: 'nonsense' }, false);
  expect(theme.rules.find((r) => r.token === 'keyword')?.foreground).toBe('17202a');
  expect(theme.rules.find((r) => r.token === 'string')?.foreground).toBe('17202a');
});

test('colours read as CSS writes them', () => {
  expect(parseColor('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
  expect(parseColor('#abcd')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 0xdd / 255 });
  expect(parseColor(' #1D5BC2 ')).toEqual({ r: 0x1d, g: 0x5b, b: 0xc2, a: 1 });
  expect(parseColor('#1d5bc280')).toEqual({ r: 0x1d, g: 0x5b, b: 0xc2, a: 0x80 / 255 });
  expect(parseColor('rgba(247, 201, 72, 0.45)')).toEqual({ r: 247, g: 201, b: 72, a: 0.45 });
  expect(parseColor('rgb(14, 138, 116)')).toEqual({ r: 14, g: 138, b: 116, a: 1 });
  expect(parseColor('rgb(14 138 116 / 22%)')).toEqual({ r: 14, g: 138, b: 116, a: 0.22 });
  expect(parseColor('rgba(0,0,0,.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  expect(parseColor('red')).toBeNull();
  expect(parseColor('')).toBeNull();
  expect(parseColor('#12')).toBeNull();
});

test('colours are written as the hex Monaco reads, with the alpha only when there is one', () => {
  expect(hexColor({ r: 247, g: 201, b: 72, a: 1 })).toBe('#f7c948');
  expect(hexColor({ r: 247, g: 201, b: 72, a: 0.45 })).toBe('#f7c94873');
  expect(hexColor({ r: 247, g: 201, b: 72, a: 1 }, 0.5)).toBe('#f7c94880');
  expect(hexColor({ r: 247, g: 201, b: 72, a: 0.5 }, 0.5)).toBe('#f7c94840');
  expect(hexColor({ r: 1, g: 2, b: 3, a: 0 })).toBe('#01020300');
});
