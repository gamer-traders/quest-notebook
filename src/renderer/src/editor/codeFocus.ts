import { createExtension, type BlockNoteEditor, type ExtensionFactoryInstance } from '@blocknote/core';
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { EdgeExit } from './codeKeys';
import { typedLanguage } from './codeLanguages';

/*
  A code block's code is edited in an editor of its own, inside the page. Moving between the two: the arrows and
  Escape out of the code (see codeKeys), the arrows and Enter into it, and a new code block taking the caret.
*/

type AnyEditor = BlockNoteEditor<any, any, any>;
export type CodeEdge = 'start' | 'end';

/** What a code block on the page offers to focus its code. */
type FocusCode = (at: CodeEdge) => void;

interface PageCode {
  editors: Map<string, FocusCode>;
  /** A code block made a moment ago, whose code takes the caret once its editor is up. */
  pending?: { id: string; at: CodeEdge };
}

const pages = new WeakMap<AnyEditor, PageCode>();

function pageCode(editor: AnyEditor): PageCode {
  let page = pages.get(editor);
  if (!page) pages.set(editor, (page = { editors: new Map() }));
  return page;
}

/** A code block's editor is up. Returns its removal. */
export function registerCode(editor: AnyEditor, blockId: string, focus: FocusCode): () => void {
  const page = pageCode(editor);
  page.editors.set(blockId, focus);
  if (page.pending?.id === blockId) {
    const { at } = page.pending;
    page.pending = undefined;
    focus(at);
  }
  return () => {
    if (page.editors.get(blockId) === focus) page.editors.delete(blockId);
  };
}

/** Puts the caret in a code block's code. False when its editor isn't up yet. */
export function focusCode(editor: AnyEditor, blockId: string, at: CodeEdge): boolean {
  const focus = pageCode(editor).editors.get(blockId);
  focus?.(at);
  return !!focus;
}

/** Puts the caret in a code block's code now, or as soon as its editor is up. */
export function focusCodeSoon(editor: AnyEditor, blockId: string, at: CodeEdge = 'start') {
  if (!focusCode(editor, blockId, at)) pageCode(editor).pending = { id: blockId, at };
}

interface Spot {
  id: string;
  type: string;
}

/** Every block's content, in the order the page reads. */
function spots(state: EditorState): Spot[] {
  const out: Spot[] = [];
  state.doc.descendants((node, _pos, parent) => {
    if (!node.type.isInGroup('blockContent')) return true;
    out.push({ id: String(parent?.attrs.id ?? ''), type: node.type.name });
    return false;
  });
  return out;
}

/** The block before or after this one, as the page reads. */
function neighbour(state: EditorState, blockId: string, back: boolean): Spot | undefined {
  const all = spots(state);
  const i = all.findIndex((s) => s.id === blockId);
  return i < 0 ? undefined : all[back ? i - 1 : i + 1];
}

/** Leaves a code block's code: for the end of the block above, the start of the block below, or the block selected. */
export function leaveCode(editor: AnyEditor, blockId: string, how: EdgeExit) {
  if (how === 'select') {
    editor.setTextCursorPosition(blockId);
    editor.focus();
    return;
  }
  const back = how === 'up';
  const next = neighbour(editor.prosemirrorState, blockId, back);
  const edge: CodeEdge = back ? 'end' : 'start';
  if (!next) {
    // Nothing above: the caret stays. Nothing below: a new line to write on.
    if (back || !editor.isEditable) return;
    const [line] = editor.insertBlocks([{ type: 'paragraph' }], blockId, 'after');
    editor.setTextCursorPosition(line, 'start');
    editor.focus();
    return;
  }
  if (next.type === 'codeBlock' && focusCode(editor, next.id, edge)) return;
  editor.setTextCursorPosition(next.id, edge);
  editor.focus();
}

/** The code editor's own element: what happens in it is the code's, never the page's. */
export const CODE_EDITOR_ATTR = 'data-code-editor';

const inCode = (target: EventTarget | null): boolean => {
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return !!el?.closest(`[${CODE_EDITOR_ATTR}]`);
};

// Everything the page editor would act on. Drops are left to it, so a dragged block can still land by a code block.
const CODE_EVENTS = [
  'keydown',
  'keypress',
  'keyup',
  'beforeinput',
  'input',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'mousedown',
  'touchstart',
  'touchmove',
  'contextmenu',
  'copy',
  'cut',
  'paste',
  'dragstart',
] as const;

/** The plugin that keeps the page out of code blocks. */
export const codeEventsKey = new PluginKey('codeBlockEvents');

const ARROWS: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/** The code block a node selection is on, by its block's id. */
function selectedCode(state: EditorState): string | null {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection)) return null;
  if (sel.node.type.name === 'codeBlock') return String(sel.$from.parent.attrs.id);
  if (sel.node.firstChild?.type.name === 'codeBlock') return String(sel.node.attrs.id);
  return null;
}

function enterCode(editor: AnyEditor, view: EditorView, event: KeyboardEvent): boolean {
  if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || event.isComposing) return false;
  const { state } = view;
  if (event.key === 'Enter') {
    const id = selectedCode(state);
    return id !== null && focusCode(editor, id, 'end');
  }
  const dir = ARROWS[event.key];
  const sel = state.selection;
  if (!dir || !(sel instanceof TextSelection) || !sel.empty || !view.endOfTextblock(dir)) return false;
  const back = dir === 'up' || dir === 'left';
  const here = sel.$from.node(sel.$from.depth - 1);
  const next = neighbour(state, String(here.attrs.id), back);
  return next?.type === 'codeBlock' && focusCode(editor, next.id, back ? 'end' : 'start');
}

/** The text of a block's inline content, links by their words. */
const inlineWords = (content: unknown): string =>
  Array.isArray(content) ? content.map((part) => (part?.type === 'text' ? part.text : part?.type === 'link' ? inlineWords(part.content) : '')).join('') : '';

/**
 * Keeps the page editor out of code blocks, moves the caret into them, and makes one from ``` then a space or
 * Enter at the start of a line. What follows the caret on that line becomes the code.
 */
export const codeBlockExtension = (): ExtensionFactoryInstance =>
  createExtension(({ editor }) => ({
    key: 'codeBlockKeys',
    prosemirrorPlugins: [
      new Plugin({
        key: codeEventsKey,
        props: {
          handleDOMEvents: Object.fromEntries(CODE_EVENTS.map((type) => [type, (_view: EditorView, event: Event) => inCode(event.target)])),
          handleKeyDown: (view, event) => enterCode(editor, view, event),
        },
      }),
    ],
    inputRules: [
      {
        find: /^```(.*?)\s$/,
        replace: ({ match, editor: page }) => {
          const { block } = page.getTextCursorPosition();
          // The typed space or line break isn't in the line yet.
          const code = inlineWords(block.content).slice(match[0].length - 1);
          focusCodeSoon(page, block.id, 'start');
          return { type: 'codeBlock', props: { language: typedLanguage(match[1]), code } };
        },
      },
    ],
  }))();
