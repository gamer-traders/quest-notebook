// @vitest-environment jsdom
// The code block in a real page editor. Monaco doesn't run in jsdom: a stand-in plays its part, as the block sees it.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { type PartialBlock } from '@blocknote/core';
import { SuggestionMenu } from '@blocknote/core/extensions';
import { BlockNoteView } from '@blocknote/mantine';
import { SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { formatJson } from '@shared/formatJson';
import type { CodeEditorHandle, CodeEditorOptions } from './codeEditor';
import type { CodeEdge } from './codeFocus';
import { codeBlockExtension, codeEventsKey } from './codeFocus';
import { schema, type PageEditor } from './schema';
import { NotebookContext } from './NotebookContext';
import { LINK_TRIGGER, linkMenuOpensHere } from './inlineRules';
import { pageSlashItems } from './slashItems';
import { useStore } from '../store';
import { useClaude } from '../claude/store';
import { fileToPage, pageToFile } from '../files/convert';

/** Monaco, as the block drives it: its value, what it was told, and the element its text area would be. */
class StandIn {
  value: string;
  language: string;
  readOnly: boolean;
  focused: CodeEdge | null = null;
  /** Times its value was replaced from outside. */
  resets = 0;
  disposed = false;
  readonly lines: HTMLElement;
  readonly textArea: HTMLTextAreaElement;

  constructor(
    host: HTMLElement,
    readonly options: CodeEditorOptions,
  ) {
    this.value = options.code;
    this.language = options.language;
    this.readOnly = options.readOnly;
    this.lines = document.createElement('div');
    this.lines.className = 'stand-in-lines';
    this.lines.textContent = options.code;
    this.textArea = document.createElement('textarea');
    host.append(this.lines, this.textArea);
  }

  /** The reader typing: the code changes, and the block hears of it. */
  type(code: string) {
    this.value = code;
    this.options.onChange(code);
  }

  handle(): CodeEditorHandle {
    return {
      getValue: () => this.value,
      setValue: (code) => {
        if (code === this.value) return;
        this.value = code;
        this.resets++;
      },
      setLanguage: (language) => void (this.language = language),
      setReadOnly: (readOnly) => void (this.readOnly = readOnly),
      setFont: () => {},
      focus: (at) => void (this.focused = at),
      gutter: () => ({ numbers: 26, code: 52 }),
      dispose: () => void (this.disposed = true),
    };
  }
}

const monaco = vi.hoisted(() => ({ editors: [] as unknown[], release: () => {} }));
const standIns = () => monaco.editors as StandIn[];

vi.mock('./codeLoader', () => {
  const api = {
    applyCodeTheme: () => {},
    createCodeEditor: (host: HTMLElement, options: CodeEditorOptions) => {
      const standIn = new StandIn(host, options);
      monaco.editors.push(standIn);
      return standIn.handle();
    },
  };
  // Loaded when the test lets it be, as a lazy chunk arrives.
  let loaded: Promise<unknown> = new Promise((resolve) => (monaco.release = () => resolve(api)));
  return {
    loadCodeEditor: () => loaded,
    loadedCodeEditor: () => null,
    reset: () => (loaded = new Promise((resolve) => (monaco.release = () => resolve(api)))),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
window.scrollTo = () => {};
Element.prototype.scrollIntoView ??= () => {};
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
// The suggestion menus place themselves by their trigger's rect, as JSON.
const rectOf = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function () {
  const r = rectOf.call(this);
  return Object.assign(r, { toJSON: () => ({ x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left }) });
};

type Content = PartialBlock<PageEditor['schema']['blockSchema']>[];

let editor: PageEditor;
let host: HTMLElement;
let root: Root;

function Page({ content }: { content: Content }) {
  editor = useCreateBlockNote({ schema, initialContent: content, extensions: [codeBlockExtension()] });
  return (
    <NotebookContext.Provider value="pg">
      <BlockNoteView editor={editor} slashMenu={false} formattingToolbar={false} sideMenu={false}>
        <SuggestionMenuController triggerCharacter="/" getItems={async () => []} />
        <SuggestionMenuController triggerCharacter={LINK_TRIGGER} getItems={async () => []} shouldOpen={linkMenuOpensHere} />
      </BlockNoteView>
    </NotebookContext.Provider>
  );
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

/** Draws the page, and lets the code editor load unless asked not to. */
async function open(content: Content, { load = true } = {}) {
  await act(async () => root.render(<Page content={content} />));
  await vi.waitFor(() => expect(host.querySelector('.code-block')).not.toBeNull());
  if (load) await loadMonaco();
}

async function loadMonaco() {
  const before = standIns().length;
  await act(async () => monaco.release());
  await vi.waitFor(async () => {
    await settle();
    expect(standIns().length).toBeGreaterThan(before);
    expect(host.querySelector('.code-block.is-loading')).toBeNull();
  });
}

const view = () => editor.prosemirrorView!;
const menu = () => editor.getExtension(SuggestionMenu)!.store.state;
const codeOf = (id: string) => editor.getBlock(id)!.props as { language: string; code: string };
const fire = (target: EventTarget, event: Event) => act(() => void target.dispatchEvent(event));
const key = (k: string) => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });

/** Types into the page as the keyboard does: each character goes past the page's text input handlers first. */
function typeInPage(text: string) {
  for (const ch of text) {
    const { from, to } = view().state.selection;
    const insert = () => view().state.tr.insertText(ch, from, to);
    if (!view().someProp('handleTextInput', (f) => f(view(), from, to, ch, insert))) view().dispatch(insert());
  }
}

const page: Content = [
  { id: 'p1', type: 'paragraph', content: 'Before' },
  { id: 'c', type: 'codeBlock', props: { language: 'py', code: 'x = 1\n\ty = "naïve"  ' } },
  { id: 'p2', type: 'paragraph', content: 'After' },
];

beforeEach(async () => {
  monaco.editors.length = 0;
  const loader = (await import('./codeLoader')) as unknown as { reset: () => void };
  loader.reset();
  useStore.setState({ notebooks: [], theme: 'light' });
  useClaude.setState({ running: null });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

test('until the code editor is loaded, the block shows its code as plain text; then the editor takes it', async () => {
  await open(page, { load: false });
  const plain = [...host.querySelectorAll('.code-plain-line')].map((line) => line.textContent);
  expect(plain).toEqual(['1x = 1', '2\ty = "naïve"  ']);
  expect(standIns()).toHaveLength(0);

  await loadMonaco();
  expect(host.querySelector('.code-plain')).toBeNull();
  expect(standIns()).toHaveLength(1);
  expect(standIns()[0]).toMatchObject({ value: 'x = 1\n\ty = "naïve"  ', language: 'py', readOnly: false });
  // The editor sits in the block, marked as the code's own.
  expect(standIns()[0].textArea.closest('[data-code-editor]')).not.toBeNull();
});

test('typing in the code saves it in the block, without making the editor again or resetting it', async () => {
  await open(page);
  const code = standIns()[0];
  act(() => {
    code.type('x = 2');
    code.type('x = 23');
    code.type('x = 234');
  });
  await settle();
  expect(codeOf('c')).toEqual({ language: 'py', code: 'x = 234' });
  expect(standIns()).toHaveLength(1);
  expect(code.resets).toBe(0);
  expect(code.disposed).toBe(false);
});

test('code changed from outside, like an undo in the page, goes into the editor', async () => {
  await open(page);
  act(() => editor.updateBlock('c', { props: { code: 'print("from outside")' } }));
  await settle();
  expect(standIns()[0].value).toBe('print("from outside")');
  expect(standIns()[0].resets).toBe(1);
  expect(standIns()).toHaveLength(1);
});

test('the language picker shows the language, and choosing one changes the block and the colouring', async () => {
  await open(page);
  const select = host.querySelector<HTMLSelectElement>('.code-language select')!;
  // "py", as the page file wrote it, is Python.
  expect(select.value).toBe('python');
  await act(async () => {
    select.value = 'javascript';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
  expect(codeOf('c').language).toBe('javascript');
  expect(standIns()[0].language).toBe('javascript');
});

test("while Claude works on the page, the code is read-only and its language can't change", async () => {
  await open(page);
  expect(host.querySelector<HTMLSelectElement>('.code-language select')!.disabled).toBe(false);
  act(() => useClaude.setState({ running: { chatId: 'chat', messageId: 'm', lockedPageId: 'pg' } }));
  await settle();
  expect(standIns()[0].readOnly).toBe(true);
  expect(host.querySelector<HTMLSelectElement>('.code-language select')!.disabled).toBe(true);
  act(() => useClaude.setState({ running: null }));
  await settle();
  expect(standIns()[0].readOnly).toBe(false);
});

test('keys, text, pastes and clicks in the code never reach the page: no / menu, no [[ link, nothing typed twice', async () => {
  await open(page);
  const code = standIns()[0];
  editor.setTextCursorPosition('p2', 'end');
  const before = JSON.stringify(editor.document);
  const selection = view().state.selection.toJSON();

  for (const target of [code.textArea, code.lines]) {
    for (const k of ['/', '[', 'Enter', 'Backspace', 'Tab', 'a']) {
      await fire(target, key(k));
      await fire(target, new KeyboardEvent('keypress', { key: k, bubbles: true, cancelable: true }));
      await fire(target, new InputEvent('beforeinput', { inputType: 'insertText', data: k, bubbles: true, cancelable: true }));
      await fire(target, new InputEvent('input', { inputType: 'insertText', data: k, bubbles: true }));
    }
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { types: ['text/plain'], getData: (t: string) => (t === 'text/plain' ? 'pasted [[words]]' : ''), files: [], items: [] } });
    await fire(target, paste);
    await fire(target, new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    await fire(target, new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
  }
  await settle();
  expect(menu()?.show).toBeFalsy();
  expect(JSON.stringify(editor.document)).toBe(before);
  expect(view().state.selection.toJSON()).toEqual(selection);
});

// jsdom lays nothing out, so ProseMirror can't act on a click there the way a browser does. What the page editor is
// asked about events is checked instead: from inside the code, every one is the code's.
test('the page editor leaves every event from inside the code to the code, and drops to itself', async () => {
  await open(page);
  const code = standIns()[0];
  const at = (type: string, target: EventTarget) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'target', { value: target });
    return event;
  };
  const guard = codeEventsKey.get(view().state)!.props.handleDOMEvents as Record<string, ((v: unknown, e: Event) => boolean) | undefined>;
  const pageText = host.querySelector('[data-id="p1"] .bn-inline-content')!;
  for (const type of ['keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionend', 'paste', 'copy', 'cut', 'mousedown', 'contextmenu', 'dragstart']) {
    expect(guard[type]?.(view(), at(type, code.lines))).toBe(true);
    expect(guard[type]?.(view(), at(type, code.textArea))).toBe(true);
    // The page's own text is still the page's.
    expect(guard[type]?.(view(), at(type, pageText))).toBe(false);
  }
  // Nothing in the page acts on a click in the code before the guard says so.
  for (const type of ['mousedown', 'contextmenu', 'dragstart']) {
    expect(view().someProp('handleDOMEvents', (handlers) => (handlers as typeof guard)[type]?.(view(), at(type, code.lines)))).toBe(true);
  }
  // A block dragged onto the code still lands in the page.
  expect(guard.drop).toBeUndefined();
  expect(guard.dragover).toBeUndefined();
});

test('the arrows at the edges of the code go on to the blocks around it, and Escape selects the block', async () => {
  await open(page);
  const code = standIns()[0];
  act(() => code.options.onExit('up'));
  expect(view().state.selection).toBeInstanceOf(TextSelection);
  expect(editor.getTextCursorPosition().block.id).toBe('p1');
  expect(view().state.selection.$from.parentOffset).toBe('Before'.length);

  act(() => code.options.onExit('down'));
  expect(editor.getTextCursorPosition().block.id).toBe('p2');
  expect(view().state.selection.$from.parentOffset).toBe(0);

  act(() => code.options.onExit('select'));
  const selected = view().state.selection;
  expect(selected).toBeInstanceOf(NodeSelection);
  expect((selected as NodeSelection).node.type.name).toBe('codeBlock');
});

test('leaving the code downward at the end of the page starts a new line under it', async () => {
  await open([{ id: 'c', type: 'codeBlock', props: { code: 'end' } }]);
  act(() => standIns()[0].options.onExit('down'));
  const blocks = editor.document;
  const after = blocks[blocks.findIndex((b) => b.id === 'c') + 1];
  expect(after.type).toBe('paragraph');
  expect(editor.getTextCursorPosition().block.id).toBe(after.id);
});

test('the arrows from the text around a code block, and Enter on it selected, put the caret in its code', async () => {
  await open(page);
  const code = standIns()[0];
  editor.setTextCursorPosition('p1', 'end');
  await fire(view().dom, key('ArrowRight'));
  expect(code.focused).toBe('start');

  editor.setTextCursorPosition('p2', 'start');
  await fire(view().dom, key('ArrowLeft'));
  expect(code.focused).toBe('end');

  code.focused = null;
  editor.setTextCursorPosition('c');
  expect(view().state.selection).toBeInstanceOf(NodeSelection);
  await fire(view().dom, key('Enter'));
  expect(code.focused).toBe('end');

  // In the middle of a line, the arrows stay in the text.
  code.focused = null;
  editor.setTextCursorPosition('p1', 'start');
  await fire(view().dom, key('ArrowRight'));
  expect(code.focused).toBeNull();
});

test('``` then a space at the start of a line makes a code block in that language, and the caret goes into its code', async () => {
  await open([{ id: 'p', type: 'paragraph', content: 'print(1)' }, ...page]);
  editor.setTextCursorPosition('p', 'start');
  act(() => typeInPage('```py '));
  await settle();
  expect(editor.getBlock('p')).toMatchObject({ type: 'codeBlock', props: { language: 'python', code: 'print(1)' } });
  await vi.waitFor(async () => {
    await settle();
    expect(standIns().find((s) => s.options.code === 'print(1)')?.focused).toBe('start');
  });
});

test('``` then Enter makes a plain code block too', async () => {
  await open([{ id: 'p', type: 'paragraph', content: '' }, ...page]);
  editor.setTextCursorPosition('p', 'start');
  act(() => typeInPage('```'));
  await fire(view().dom, key('Enter'));
  await settle();
  expect(editor.getBlock('p')).toMatchObject({ type: 'codeBlock', props: { language: 'text', code: '' } });
});

test("the / menu's code block item makes one, and the caret goes into its code", async () => {
  await open([{ id: 'p', type: 'paragraph', content: '' }, ...page]);
  editor.setTextCursorPosition('p', 'start');
  const item = pageSlashItems(editor, 'pg').find((i) => i.title === editor.dictionary.slash_menu.code_block.title)!;
  act(() => item.onItemClick());
  await settle();
  expect(editor.getBlock('p')).toMatchObject({ type: 'codeBlock', props: { language: 'text', code: '' } });
  await vi.waitFor(async () => {
    await settle();
    expect(standIns().find((s) => s.focused === 'start')).toBeDefined();
  });
});

test('copied out of the page, a code block is <pre><code class="language-x">', async () => {
  await open(page);
  const html = await editor.blocksToHTMLLossy([editor.getBlock('c')!]);
  expect(html).toBe('<pre><code class="language-py" data-language="py">x = 1\n\ty = "naïve"  </code></pre>');
});

test('pasted HTML with <pre><code class="language-x">, or a bare <pre>, becomes a code block', async () => {
  await open(page);
  expect(await editor.tryParseHTMLToBlocks('<pre><code class="hljs language-rust">fn main() {\n    let x = 1 &lt; 2;\n}</code></pre>')).toMatchObject([
    { type: 'codeBlock', props: { language: 'rust', code: 'fn main() {\n    let x = 1 < 2;\n}' } },
  ]);
  expect(await editor.tryParseHTMLToBlocks('<pre>a\n\tb<br>c</pre>')).toMatchObject([{ type: 'codeBlock', props: { language: 'text', code: 'a\n\tb\nc' } }]);
});

test('copied and pasted within the app, a code block keeps its code exactly', async () => {
  await open(page);
  const html = editor.blocksToFullHTML([editor.getBlock('c')!]);
  expect(await editor.tryParseHTMLToBlocks(html)).toMatchObject([{ type: 'codeBlock', props: { language: 'py', code: 'x = 1\n\ty = "naïve"  ' } }]);
});

test('a page file with code goes through the editor and back byte for byte', async () => {
  const codes = ['def f():\n\treturn 1\t \n', '', 'naïve — 日本語 🚀 ქართული\n', 'a\r\nb', '[[Not a link]] **x** `y`'];
  const file = {
    id: 'pg',
    title: 'Code',
    position: 0,
    created: '2026-10-20T00:00:00Z',
    updated: '2026-10-20T00:00:00Z',
    blocks: [{ type: 'paragraph', text: 'Intro **bold**' }, ...codes.map((code) => ({ type: 'code', language: 'python', code })), { type: 'quote', text: 'After' }],
  };
  const text = formatJson(file);
  const { notebook } = fileToPage(JSON.parse(text), { id: 'pg', spaceId: 's', parentId: null, path: 'Code.json', fileTimeMs: 0, fallbackPosition: 0 });
  await open(notebook.blocks as Content);
  const saved = pageToFile({ ...notebook, blocks: editor.document as never }, () => '');
  expect(formatJson(saved)).toBe(text);
});
