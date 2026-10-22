/*
  The code editor in a page's code blocks: Monaco, the editor VS Code is built on, dressed in the app's colours.
  This module is loaded the first time a page shows a code block (see codeLoader), so opening the app and pages
  without code never pays for it.

  Only Monaco's core editor and the features a code block uses are taken, with Monarch colouring for its
  languages. Monaco's language services (TypeScript, JSON, CSS, HTML) and their workers are left out.
*/
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/features/codicon/register';
import 'monaco-editor/features/bracketMatching/register';
import 'monaco-editor/features/clipboard/register';
import 'monaco-editor/features/comment/register';
import 'monaco-editor/features/cursorUndo/register';
import 'monaco-editor/features/find/register';
import 'monaco-editor/features/folding/register';
import 'monaco-editor/features/indentation/register';
import 'monaco-editor/features/lineSelection/register';
import 'monaco-editor/features/linesOperations/register';
import 'monaco-editor/features/multicursor/register';
import 'monaco-editor/features/readOnlyMessage/register';
import 'monaco-editor/features/smartSelect/register';
import 'monaco-editor/features/wordOperations/register';
// Monarch colouring, each language loaded when a block first shows it.
import 'monaco-editor/languages/definitions/python/register';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/typescript/register';
import 'monaco-editor/languages/definitions/sql/register';
import 'monaco-editor/languages/definitions/shell/register';
import 'monaco-editor/languages/definitions/yaml/register';
import 'monaco-editor/languages/definitions/markdown/register';
import 'monaco-editor/languages/definitions/html/register';
import 'monaco-editor/languages/definitions/css/register';
import 'monaco-editor/languages/definitions/xml/register';
import 'monaco-editor/languages/definitions/rust/register';
import 'monaco-editor/languages/definitions/go/register';
import 'monaco-editor/languages/definitions/java/register';
import 'monaco-editor/languages/definitions/kotlin/register';
import 'monaco-editor/languages/definitions/cpp/register';
import 'monaco-editor/languages/definitions/csharp/register';
import 'monaco-editor/languages/definitions/swift/register';
import 'monaco-editor/languages/definitions/ruby/register';
import 'monaco-editor/languages/definitions/php/register';
import 'monaco-editor/languages/definitions/r/register';
import 'monaco-editor/languages/definitions/solidity/register';
// Served from the app itself, so the page's content security policy lets it run.
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { tagRanges } from '../lib/format';
import { edgeExit, type EdgeExit } from './codeKeys';
import { monacoLanguage } from './codeLanguages';
import { codeTheme, readCodeTokens } from './codeTheme';
import type { CodeEdge } from './codeFocus';

(self as typeof self & { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// JSON is coloured by a small Monarch grammar of its own: Monaco's JSON is a language service with a worker.
monaco.languages.register({ id: 'json', aliases: ['JSON', 'json'], extensions: ['.json'] });
monaco.languages.setMonarchTokensProvider('json', {
  tokenPostfix: '.json',
  tokenizer: {
    root: [
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'string.key'],
      [/"(?:[^"\\]|\\.)*"?/, 'string'],
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
      [/\b(?:true|false|null)\b/, 'keyword'],
      [/[{}[\]]/, 'delimiter.bracket'],
      [/[,:]/, 'delimiter'],
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
    ],
    comment: [
      [/[^*/]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[*/]/, 'comment'],
    ],
  },
});
monaco.languages.setLanguageConfiguration('json', {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"', notIn: ['string'] },
  ],
});

let appliedTheme = '';

/**
 * Builds the code theme from the app's tokens as they are now, and applies it to every code editor. It's cheap to
 * call again: nothing happens unless the tokens changed.
 */
export function applyCodeTheme(dark: boolean) {
  const tokens = readCodeTokens();
  const key = `${dark}:${JSON.stringify(tokens)}`;
  if (key === appliedTheme) return;
  appliedTheme = key;
  const name = dark ? 'quest-dark' : 'quest-light';
  monaco.editor.defineTheme(name, codeTheme(tokens, dark));
  monaco.editor.setTheme(name);
}

export interface CodeFont {
  family: string;
  size: number;
  lineHeight: number;
}

export interface CodeEditorOptions {
  code: string;
  language: string;
  readOnly: boolean;
  font: CodeFont;
  /** Room above the first line and below the last. */
  padding: number;
  /** The code changed by typing in it. */
  onChange: (code: string) => void;
  onExit: (how: EdgeExit) => void;
}

export interface CodeEditorHandle {
  getValue(): string;
  /** Code from outside, such as an undo in the page: shown without counting as typing. */
  setValue(code: string): void;
  setLanguage(language: string): void;
  setReadOnly(readOnly: boolean): void;
  setFont(font: CodeFont): void;
  focus(at: CodeEdge): void;
  /** Where the line numbers end, and where the code starts after them. */
  gutter(): { numbers: number; code: number };
  dispose(): void;
}

const fontOptions = (font: CodeFont) => ({ fontFamily: font.family, fontSize: font.size, lineHeight: font.lineHeight });

const FIND = 'editor.contrib.findController';

export function createCodeEditor(host: HTMLElement, options: CodeEditorOptions): CodeEditorHandle {
  const model = monaco.editor.createModel(options.code, monacoLanguage(options.language));
  const editor = monaco.editor.create(host, {
    model,
    ...fontOptions(options.font),
    readOnly: options.readOnly,
    readOnlyMessage: { value: 'Claude is working on this page. It can be edited again when the reply is done.' },
    padding: { top: options.padding, bottom: options.padding },
    ariaLabel: 'Code',
    // The page lays it out: as wide as the block, as tall as the code.
    automaticLayout: false,
    scrollBeyondLastLine: false,
    scrollBeyondLastColumn: 2,
    wordWrap: 'off',
    minimap: { enabled: false },
    scrollbar: {
      vertical: 'hidden',
      verticalScrollbarSize: 0,
      horizontal: 'auto',
      horizontalScrollbarSize: 10,
      useShadows: false,
      // The page scrolls under the wheel: the code only takes it to scroll sideways.
      alwaysConsumeMouseWheel: false,
    },
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    lineNumbers: 'on',
    lineNumbersMinChars: 3,
    lineDecorationsWidth: 10,
    glyphMargin: false,
    folding: true,
    showFoldingControls: 'mouseover',
    renderLineHighlight: 'none',
    matchBrackets: 'always',
    bracketPairColorization: { enabled: false },
    guides: { indentation: true, bracketPairs: false, highlightActiveIndentation: true },
    occurrencesHighlight: 'off',
    selectionHighlight: true,
    renderWhitespace: 'none',
    fontLigatures: false,
    unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false },
    // A notebook, not an IDE: no pop-ups while typing, no menu of Monaco's own, no dragging text about.
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    wordBasedSuggestions: 'off',
    parameterHints: { enabled: false },
    hover: { enabled: 'off' },
    links: false,
    codeLens: false,
    colorDecorators: false,
    inlayHints: { enabled: 'off' },
    lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.Off },
    stickyScroll: { enabled: false },
    contextmenu: false,
    dragAndDrop: false,
    dropIntoEditor: { enabled: false },
    pasteAs: { enabled: false },
    // Typing goes through a text area, which the page editor knows to leave alone.
    editContext: false,
    tabSize: 4,
    insertSpaces: true,
    detectIndentation: true,
  });

  // While code from outside goes in, its change isn't the reader's typing.
  let applying = false;

  // #tags wear the highlighter in code too, as the sidebar and search count them there.
  const tags = editor.createDecorationsCollection();
  const paintTags = () =>
    tags.set(
      tagRanges(model.getValue()).map(({ from, to }) => ({
        range: monaco.Range.fromPositions(model.getPositionAt(from), model.getPositionAt(to)),
        options: { inlineClassName: 'code-tag' },
      })),
    );
  paintTags();

  model.onDidChangeContent(() => {
    paintTags();
    if (!applying) options.onChange(model.getValue());
  });

  // As tall as the code, so it never scrolls up and down inside the page.
  let width = 0;
  const layout = () => {
    width = host.clientWidth;
    const height = editor.getContentHeight();
    host.style.height = `${height}px`;
    editor.layout({ width, height });
  };
  editor.onDidContentSizeChange((e) => {
    if (e.contentHeightChanged) layout();
  });
  const resize = new ResizeObserver(() => {
    if (host.clientWidth !== width) layout();
  });
  resize.observe(host);
  layout();

  editor.onKeyDown((e) => {
    const position = editor.getPosition();
    const selection = editor.getSelection();
    if (!position || !selection) return;
    const lineCount = model.getLineCount();
    const findOpen = editor.getContribution<monaco.editor.IEditorContribution & { getState?: () => { isRevealed: boolean } }>(FIND)?.getState?.().isRevealed === true;
    const exit = edgeExit(
      { key: e.browserEvent.key, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, ctrl: e.ctrlKey, composing: e.browserEvent.isComposing },
      {
        line: position.lineNumber,
        column: position.column,
        lineCount,
        lastColumn: model.getLineMaxColumn(lineCount),
        empty: selection.isEmpty(),
        cursors: editor.getSelections()?.length ?? 1,
        findOpen,
      },
    );
    if (!exit) return;
    e.preventDefault();
    e.stopPropagation();
    options.onExit(exit);
  });

  return {
    getValue: () => model.getValue(),
    setValue(code) {
      // Monaco keeps one kind of line break: code that differs only in those is the same code.
      if (code.replace(/\r\n|\r|\n/g, model.getEOL()) === model.getValue()) return;
      applying = true;
      try {
        // As an edit, so Monaco's own undo can still go back past it.
        model.pushEditOperations(editor.getSelections() ?? [], [{ range: model.getFullModelRange(), text: code }], () => null);
      } finally {
        applying = false;
      }
    },
    setLanguage: (language) => monaco.editor.setModelLanguage(model, monacoLanguage(language)),
    setReadOnly: (readOnly) => editor.updateOptions({ readOnly }),
    setFont: (font) => editor.updateOptions(fontOptions(font)),
    focus(at) {
      const line = at === 'start' ? 1 : model.getLineCount();
      const position = { lineNumber: line, column: at === 'start' ? 1 : model.getLineMaxColumn(line) };
      editor.setPosition(position);
      editor.focus();
      host.scrollIntoView({ block: 'nearest' });
    },
    gutter() {
      const info = editor.getLayoutInfo();
      return { numbers: info.lineNumbersLeft + info.lineNumbersWidth, code: info.contentLeft };
    },
    dispose() {
      resize.disconnect();
      editor.dispose();
      model.dispose();
    },
  };
}
