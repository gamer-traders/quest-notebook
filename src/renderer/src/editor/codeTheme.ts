/*
  The code editor's colours: a Monaco theme built from the app's own tokens, so code reads in the notebook's
  paper and ink, never in VS Code's colours. Nothing is inherited from Monaco's themes: every colour the
  editor draws with is named here, from a token.
*/

/** The app's CSS tokens the theme is made from, by the role each plays. */
export const CODE_TOKENS = {
  /** The code block's own background. */
  background: '--chart-grid',
  /** Widgets that float over the code, like the find bar. */
  sheet: '--sheet',
  ink: '--ink',
  inkSoft: '--ink-soft',
  pencil: '--pencil',
  rule: '--rule',
  ruleStrong: '--rule-strong',
  /** The highlighter: selections and matches. */
  mark: '--mark',
  markSolid: '--mark-solid',
  focus: '--focus',
  blue: '--mark-blue-ink',
  green: '--mark-green-ink',
  red: '--mark-red-ink',
  purple: '--mark-purple-ink',
  yellow: '--mark-yellow-ink',
  down: '--down',
} as const;

export type CodeTokens = Record<keyof typeof CODE_TOKENS, string>;

/** Monaco's IStandaloneThemeData, without importing Monaco. */
export interface CodeThemeData {
  base: 'vs' | 'vs-dark';
  inherit: boolean;
  rules: { token: string; foreground?: string; background?: string; fontStyle?: string }[];
  colors: Record<string, string>;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0 to 1. */
  a: number;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^(rgba?|color)\((.*)\)$/i;

const unit = (part: string, scale: number): number => (part.endsWith('%') ? (parseFloat(part) / 100) * scale : parseFloat(part));

/** A colour as CSS writes it: #hex, rgb(), rgba(), or color(srgb …) as a browser computes it. Null for anything else. */
export function parseColor(css: string): Rgba | null {
  const text = css.trim();
  const hex = HEX.exec(text)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = FUNC.exec(text);
  if (!fn) return null;
  let parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  const srgb = fn[1].toLowerCase() === 'color';
  if (srgb) {
    if (parts[0] !== 'srgb') return null;
    parts = parts.slice(1);
  }
  if (parts.length < 3 || parts.length > 4) return null;
  const [r, g, b] = parts.slice(0, 3).map((p) => (srgb ? unit(p, 1) * 255 : unit(p, 255)));
  const a = parts[3] === undefined ? 1 : unit(parts[3], 1);
  if (![r, g, b, a].every(Number.isFinite)) return null;
  const byte = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
  return { r: byte(r), g: byte(g), b: byte(b), a: Math.min(1, Math.max(0, a)) };
}

const pair = (v: number) => v.toString(16).padStart(2, '0');

/** '#rrggbb', or '#rrggbbaa' when the colour, times `alpha`, isn't opaque. */
export function hexColor(c: Rgba, alpha = 1): string {
  const a = Math.round(c.a * alpha * 255);
  return `#${pair(c.r)}${pair(c.g)}${pair(c.b)}${a === 255 ? '' : pair(a)}`;
}

/** The Monaco theme for these tokens. Light and dark use one mapping: the tokens already follow the theme. */
export function codeTheme(tokens: CodeTokens, dark: boolean): CodeThemeData {
  const ink = parseColor(tokens.ink);
  if (!ink) throw new Error(`The code theme needs the ink colour, and ${CODE_TOKENS.ink} is "${tokens.ink}"`);
  // A token that can't be read takes the ink: the theme never makes up a colour of its own.
  const read = (name: keyof CodeTokens): Rgba => parseColor(tokens[name]) ?? ink;
  const c = (name: keyof CodeTokens) => hexColor(read(name));
  const a = (name: keyof CodeTokens, alpha: number) => hexColor(read(name), alpha);
  const clear = (name: keyof CodeTokens) => hexColor(read(name), 0);
  // Token colours are opaque: Monaco reads six hex digits, without '#'.
  const fg = (name: keyof CodeTokens) => hexColor({ ...read(name), a: 1 }).slice(1);

  const each = (prefix: string, value: string, count = 6) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`${prefix}${i + 1}`, value]));

  const colors: Record<string, string> = {
    foreground: c('ink'),
    descriptionForeground: c('pencil'),
    errorForeground: c('down'),
    focusBorder: c('focus'),
    'icon.foreground': c('pencil'),
    'widget.shadow': a('ink', dark ? 0.45 : 0.18),
    'widget.border': c('rule'),
    'sash.hoverBorder': c('focus'),
    'textLink.foreground': c('focus'),
    'textLink.activeForeground': c('focus'),
    'textCodeBlock.background': c('background'),
    'textPreformat.foreground': c('ink'),
    'textPreformat.background': c('background'),
    'toolbar.hoverBackground': c('rule'),
    'toolbar.activeBackground': c('ruleStrong'),

    'scrollbar.shadow': clear('ink'),
    'scrollbarSlider.background': a('pencil', 0.25),
    'scrollbarSlider.hoverBackground': a('pencil', 0.4),
    'scrollbarSlider.activeBackground': a('pencil', 0.55),

    'input.background': c('background'),
    'input.foreground': c('ink'),
    'input.border': c('rule'),
    'input.placeholderForeground': c('pencil'),
    'inputOption.activeBorder': c('focus'),
    'inputOption.activeBackground': a('focus', 0.15),
    'inputOption.activeForeground': c('ink'),
    'inputOption.hoverBackground': c('rule'),
    'inputValidation.infoBackground': c('sheet'),
    'inputValidation.infoBorder': c('rule'),
    'inputValidation.infoForeground': c('ink'),
    'inputValidation.warningBackground': c('sheet'),
    'inputValidation.warningBorder': c('yellow'),
    'inputValidation.warningForeground': c('ink'),
    'inputValidation.errorBackground': c('sheet'),
    'inputValidation.errorBorder': c('down'),
    'inputValidation.errorForeground': c('ink'),
    'button.background': c('ink'),
    'button.foreground': c('sheet'),
    'button.hoverBackground': c('inkSoft'),
    'checkbox.background': c('sheet'),
    'checkbox.border': c('rule'),
    'checkbox.foreground': c('ink'),

    'editor.background': c('background'),
    'editor.foreground': c('ink'),
    'editorGutter.background': c('background'),
    'editorGutter.foldingControlForeground': c('pencil'),
    'editorLineNumber.foreground': c('pencil'),
    'editorLineNumber.activeForeground': c('ink'),
    'editorLineNumber.dimmedForeground': c('pencil'),
    'editorCursor.foreground': c('ink'),
    'editorCursor.background': c('background'),
    'editorMultiCursor.primary.foreground': c('ink'),
    'editorMultiCursor.primary.background': c('background'),
    'editorMultiCursor.secondary.foreground': c('ink'),
    'editorMultiCursor.secondary.background': c('background'),
    'editor.compositionBorder': c('ink'),
    'editor.placeholder.foreground': c('pencil'),
    'editorGhostText.foreground': c('pencil'),

    'editor.selectionBackground': c('mark'),
    'editor.inactiveSelectionBackground': a('mark', 0.6),
    'editor.selectionHighlightBackground': a('mark', 0.45),
    'editor.selectionHighlightBorder': clear('mark'),
    'editor.wordHighlightBackground': a('mark', 0.4),
    'editor.wordHighlightStrongBackground': a('mark', 0.6),
    'editor.wordHighlightTextBackground': a('mark', 0.4),
    'editor.findMatchBackground': c('mark'),
    'editor.findMatchBorder': c('markSolid'),
    'editor.findMatchHighlightBackground': a('mark', 0.55),
    'editor.findMatchHighlightBorder': clear('mark'),
    'editor.findRangeHighlightBackground': a('mark', 0.25),
    'editor.rangeHighlightBackground': a('mark', 0.3),
    'editor.hoverHighlightBackground': a('mark', 0.3),
    'editor.lineHighlightBackground': clear('background'),
    'editor.lineHighlightBorder': clear('background'),
    'editor.foldBackground': a('mark', 0.2),
    'editor.foldPlaceholderForeground': c('pencil'),

    'editorBracketMatch.background': a('mark', 0.5),
    'editorBracketMatch.border': a('pencil', 0.6),
    ...each('editorBracketHighlight.foreground', c('ink')),
    'editorBracketHighlight.unexpectedBracket.foreground': c('down'),
    ...each('editorBracketPairGuide.background', c('rule')),
    ...each('editorBracketPairGuide.activeBackground', c('ruleStrong')),
    ...each('editorIndentGuide.background', c('rule')),
    ...each('editorIndentGuide.activeBackground', c('ruleStrong')),
    'editorWhitespace.foreground': c('ruleStrong'),
    'editorRuler.foreground': c('rule'),
    'editorCodeLens.foreground': c('pencil'),
    'editorLink.activeForeground': c('focus'),
    'editorOverviewRuler.border': clear('background'),
    'editorOverviewRuler.background': c('background'),
    'editorStickyScroll.background': c('background'),
    'editorUnicodeHighlight.border': c('yellow'),
    'editorUnicodeHighlight.background': clear('yellow'),
    'editorError.foreground': c('down'),
    'editorWarning.foreground': c('yellow'),
    'editorInfo.foreground': c('blue'),

    'editorWidget.background': c('sheet'),
    'editorWidget.foreground': c('ink'),
    'editorWidget.border': c('rule'),
    'editorWidget.resizeBorder': c('ruleStrong'),
    'editorHoverWidget.background': c('sheet'),
    'editorHoverWidget.foreground': c('ink'),
    'editorHoverWidget.border': c('rule'),
    'editorHoverWidget.highlightForeground': c('blue'),
    'editorHoverWidget.statusBarBackground': c('background'),
    'editorSuggestWidget.background': c('sheet'),
    'editorSuggestWidget.border': c('rule'),
    'editorSuggestWidget.foreground': c('ink'),
    'editorSuggestWidget.selectedBackground': c('mark'),
    'editorSuggestWidget.selectedForeground': c('ink'),
    'editorSuggestWidget.highlightForeground': c('blue'),
    'editorSuggestWidget.focusHighlightForeground': c('blue'),
    'list.hoverBackground': c('rule'),
    'list.activeSelectionBackground': c('mark'),
    'list.activeSelectionForeground': c('ink'),
    'list.focusBackground': c('mark'),
    'list.highlightForeground': c('blue'),
    'list.inactiveSelectionBackground': c('rule'),
    'menu.background': c('sheet'),
    'menu.foreground': c('ink'),
    'menu.border': c('rule'),
    'menu.selectionBackground': c('mark'),
    'menu.selectionForeground': c('ink'),
    'menu.separatorBackground': c('rule'),
    'menu.selectionBorder': clear('mark'),
    'list.focusOutline': c('focus'),
    'list.hoverForeground': c('ink'),

    // Kept quiet: states a code block rarely shows, so no VS Code colour can turn up in one.
    disabledForeground: a('pencil', 0.7),
    'actionBar.toggledBackground': a('focus', 0.15),
    'badge.background': c('rule'),
    'badge.foreground': c('ink'),
    'keybindingLabel.background': c('background'),
    'keybindingLabel.foreground': c('ink'),
    'keybindingLabel.border': c('rule'),
    'keybindingLabel.bottomBorder': c('ruleStrong'),
    'button.border': clear('ink'),
    'button.separator': a('sheet', 0.4),
    'button.secondaryBackground': c('rule'),
    'button.secondaryForeground': c('ink'),
    'button.secondaryHoverBackground': c('ruleStrong'),
    'scrollbar.background': clear('background'),
    'editor.rangeHighlightBorder': clear('mark'),
    'editor.symbolHighlightBackground': a('mark', 0.5),
    'editor.symbolHighlightBorder': clear('mark'),
    'editor.wordHighlightBorder': clear('mark'),
    'editor.wordHighlightStrongBorder': clear('mark'),
    'editor.wordHighlightTextBorder': clear('mark'),
    'editorError.background': clear('down'),
    'editorError.border': clear('down'),
    'editorWarning.background': clear('yellow'),
    'editorWarning.border': clear('yellow'),
    'editorInfo.background': clear('blue'),
    'editorInfo.border': clear('blue'),
    'editorHint.border': clear('pencil'),
    'editorUnnecessaryCode.border': clear('pencil'),
    'editorGutter.itemBackground': c('background'),
    'editorGutter.itemGlyphForeground': c('pencil'),
  };

  const rules: CodeThemeData['rules'] = [
    { token: '', foreground: fg('ink') },
    { token: 'identifier', foreground: fg('ink') },
    { token: 'variable', foreground: fg('ink') },
    { token: 'comment', foreground: fg('pencil'), fontStyle: 'italic' },
    { token: 'keyword', foreground: fg('blue') },
    { token: 'tag', foreground: fg('blue') },
    // A string's quotes and escapes too (Python's grammar calls its quotes escapes), so a string reads as one.
    { token: 'string', foreground: fg('green') },
    { token: 'attribute.value', foreground: fg('green') },
    { token: 'number', foreground: fg('yellow') },
    { token: 'constant', foreground: fg('yellow') },
    { token: 'annotation', foreground: fg('yellow') },
    { token: 'metatag', foreground: fg('yellow') },
    { token: 'type', foreground: fg('purple') },
    { token: 'function', foreground: fg('purple') },
    { token: 'predefined', foreground: fg('purple') },
    { token: 'variable.predefined', foreground: fg('purple') },
    { token: 'attribute.name', foreground: fg('purple') },
    // JSON's keys, as YAML's are types: names, apart from the values.
    { token: 'string.key', foreground: fg('purple') },
    { token: 'regexp', foreground: fg('red') },
    { token: 'delimiter', foreground: fg('inkSoft') },
    { token: 'operator', foreground: fg('inkSoft') },
    { token: 'operators', foreground: fg('inkSoft') },
    { token: 'invalid', foreground: fg('down') },
    { token: 'emphasis', fontStyle: 'italic' },
    { token: 'strong', fontStyle: 'bold' },
  ];

  return { base: dark ? 'vs-dark' : 'vs', inherit: false, rules, colors };
}

/** The tokens as the page has them now. Anything the theme can't read is turned into rgb() by the browser first. */
export function readCodeTokens(root: HTMLElement = document.documentElement): CodeTokens {
  const style = getComputedStyle(root);
  let probe: HTMLElement | null = null;
  const plain = (value: string): string => {
    if (!value || parseColor(value)) return value;
    probe ??= root.appendChild(document.createElement('span'));
    probe.style.color = '';
    probe.style.color = value;
    return probe.style.color ? getComputedStyle(probe).color : value;
  };
  const tokens = Object.fromEntries(
    (Object.keys(CODE_TOKENS) as (keyof CodeTokens)[]).map((name) => [name, plain(style.getPropertyValue(CODE_TOKENS[name]).trim())]),
  ) as CodeTokens;
  (probe as HTMLElement | null)?.remove();
  return tokens;
}
