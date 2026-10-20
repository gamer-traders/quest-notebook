import { createExtension, type ExtensionFactoryInstance } from '@blocknote/core';
import { SuggestionMenu } from '@blocknote/core/extensions';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { tagRanges } from '../lib/format';

// Writing shortcuts the editor doesn't have on its own. The matchers read the text before the
// caret and know nothing of the editor; the ProseMirror plugins below are built on them.

/** The text before the caret ends by closing '==x==': where the pair starts, and the words inside. */
export function matchHighlight(textBefore: string): { from: number; text: string } | null {
  // Like **bold**: the pair starts a word, and the words inside don't start or end with a space.
  const m = /(?<![\w=])==([^=\s](?:[^=]*[^=\s])?)==$/.exec(textBefore);
  return m ? { from: m.index, text: m[1] } : null;
}

/**
 * Typing this opens the notebook link menu. BlockNote's suggestion menus take a trigger of more than one
 * character: as each character is typed it compares the text before the caret, plus that character, with it.
 */
export const LINK_TRIGGER = '[[';

/** '[[' in code, a block or a word of it, is part of the code. */
export function linkMenuOpensHere(tr: Transaction): boolean {
  const { $from } = tr.selection;
  if ($from.parent.type.spec.code) return false;
  return !(tr.storedMarks ?? $from.marks()).some((m) => m.type.name === 'code');
}

/** The text before the caret ends by closing '[[words]]': where the '[[' starts, and the words between. */
export function matchClosedLink(textBefore: string): { from: number; title: string } | null {
  const m = /\[\[([^[\]]*)\]\]$/.exec(textBefore);
  return m ? { from: m.index, title: m[1] } : null;
}

// A notebook link or a line break reads as one character, so offsets in a block's text are positions in it.
const LEAF = '\ufffc';

type Doc = EditorState['doc'];

/** Typing the closing '=' of '==key==' turns the words yellow, the default highlight, and drops the marks. */
function highlightShortcut() {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        const { state } = view;
        const highlight = state.schema.marks.backgroundColor;
        if (text !== '=' || from !== to || !highlight) return false;
        const $from = state.doc.resolve(from);
        // Code means what it says.
        if ($from.parent.type.spec.code || $from.marks().some((m) => m.type.name === 'code')) return false;

        const hit = matchHighlight($from.parent.textBetween(0, $from.parentOffset, undefined, LEAF) + text);
        if (!hit) return false;
        // The caret sits after '==key=': the typed '=' isn't in the page yet.
        const start = $from.start() + hit.from;
        const tr = state.tr
          .delete(from - 1, from)
          .addMark(start + 2, from - 1, highlight.create({ stringValue: 'yellow' }))
          .delete(start, start + 2)
          .removeStoredMark(highlight);
        view.dispatch(tr);
        return true;
      },
    },
  });
}

/**
 * Typing ']]' ends a link. '[[words]]' becomes a link to the notebook `findNotebook` names for the words; when it
 * names none, the text stays as typed. Either way the link menu closes, so Enter after it starts a new line.
 */
export function linkClosing(findNotebook: (title: string) => string | null): ExtensionFactoryInstance {
  return createExtension(({ editor }) => ({
    key: 'linkClosing',
    prosemirrorPlugins: [
      new Plugin({
        props: {
          handleTextInput(view, from, to, text) {
            const { state } = view;
            if (text !== ']' || from !== to || !linkMenuOpensHere(state.tr)) return false;
            const $from = state.doc.resolve(from);
            const before = $from.parent.textBetween(0, $from.parentOffset, undefined, LEAF);
            if (!before.endsWith(']')) return false;

            const menu = editor.getExtension(SuggestionMenu);
            const shown = menu?.store.state;
            if (shown?.show && shown.triggerCharacter === LINK_TRIGGER) menu!.closeMenu();

            const hit = matchClosedLink(before + text);
            const notebookId = hit && findNotebook(hit.title);
            const link = state.schema.nodes.notebookLink;
            if (!hit || !notebookId || !link) return false;
            // The caret sits after '[[words]': the typed ']' isn't in the page yet.
            const start = $from.start() + hit.from;
            view.dispatch(view.state.tr.replaceWith(start, from, link.create({ notebookId })));
            return true;
          },
        },
      }),
    ],
  }))();
}

function tagDecorations(doc: Doc): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, undefined, LEAF);
    for (const { from, to } of tagRanges(text)) decorations.push(Decoration.inline(pos + 1 + from, pos + 1 + to, { class: 'tag' }));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

const tagKey = new PluginKey<DecorationSet>('tagHighlights');

/**
 * #tags wear the highlighter in the text, as everywhere else in the app. They stay plain text.
 * Code blocks too: the sidebar and search count the tags there, so the page shows them.
 */
function tagHighlights() {
  return new Plugin<DecorationSet>({
    key: tagKey,
    state: {
      init: (_config, state) => tagDecorations(state.doc),
      apply: (tr, set) => (tr.docChanged ? tagDecorations(tr.doc) : set),
    },
    props: {
      decorations: (state) => tagKey.getState(state),
    },
  });
}

/** The page's writing shortcuts, for useCreateBlockNote's extensions. */
export const pageExtensions: ExtensionFactoryInstance[] = [
  createExtension({ key: 'highlightShortcut', prosemirrorPlugins: [highlightShortcut()] }),
  createExtension({ key: 'tagHighlights', prosemirrorPlugins: [tagHighlights()] }),
];
