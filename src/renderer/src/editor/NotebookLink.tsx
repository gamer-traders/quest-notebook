import { createReactInlineContentSpec, useComponentsContext, useDictionary, type SuggestionMenuProps } from '@blocknote/react';
import { DELETED_NOTEBOOK } from '../page/blocks';
import { findLinkTarget } from '../files/links';
import { useContext } from 'react';
import { NotebookContext } from './NotebookContext';
import { useStore } from '../store';
import { linkClosing } from './inlineRules';
import { linkChoiceLabel, linkChoicePath, notebookTitled, type LinkChoice } from './linkItems';
import type { PageEditor } from './schema';

/**
 * A link to another notebook, in the sentence. It shows the notebook's title as it is now, so renames carry through.
 * A link read from a page file that names no page yet shows the words it was written with.
 */
function NotebookLinkChip({ notebookId, target }: { notebookId: string; target: string }) {
  const pageId = useContext(NotebookContext);
  // A link written in a file before its page existed finds the page by its words once it's there.
  const id = useStore((s) => {
    if (notebookId && s.notebooks.some((n) => n.id === notebookId)) return notebookId;
    if (!target) return notebookId;
    const from = s.notebooks.find((n) => n.id === pageId)?.spaceId ?? '';
    return findLinkTarget(s.notebooks, s.spaces, target, from) ?? notebookId;
  });
  const title = useStore((s) => (id ? (s.notebooks.find((n) => n.id === id)?.title ?? null) : null));

  if (title === null && target) {
    return (
      <span className="notebook-link is-missing" role="button" aria-disabled="true" title={`No page called “${target}”`}>
        {target}
      </span>
    );
  }
  if (title === null) {
    return (
      <span className="notebook-link is-deleted" role="button" aria-disabled="true">
        {DELETED_NOTEBOOK}
      </span>
    );
  }
  return (
    <span className="notebook-link" role="button" onClick={() => useStore.getState().openNotebook(id)}>
      {title || 'Untitled'}
    </span>
  );
}

export const NotebookLink = createReactInlineContentSpec(
  { type: 'notebookLink', propSchema: { notebookId: { default: '' }, target: { default: '' } }, content: 'none' },
  { render: ({ inlineContent }) => <NotebookLinkChip notebookId={inlineContent.props.notebookId} target={inlineContent.props.target} /> },
);

/**
 * Puts a link to the choice at the caret, where the menu has just taken out '[[' and the query.
 * A new notebook goes at the top level of this one's space, and the writer stays on this page.
 */
export function insertNotebookLink(editor: PageEditor, notebookId: string, choice: LinkChoice) {
  const { notebooks, createPage } = useStore.getState();
  let targetId: string;
  if (choice.kind === 'create') {
    const current = notebooks.find((n) => n.id === notebookId);
    if (!current) return;
    targetId = createPage(current.spaceId, null, choice.title, false);
  } else {
    targetId = choice.notebookId;
  }

  insertLinks(editor, [targetId]);
}

/**
 * Puts links to the pages in place of the selection, set apart by spaces. At the end of a line the caret
 * gets a space to sit in after them; mid-sentence the text goes on as it was.
 */
export function insertLinks(editor: PageEditor, notebookIds: string[]) {
  const atLineEnd = editor.transact((tr) => tr.selection.$to.parentOffset === tr.selection.$to.parent.content.size);
  const links = notebookIds.flatMap((notebookId, i) => [...(i > 0 ? [' '] : []), { type: 'notebookLink' as const, props: { notebookId, target: '' } }]);
  editor.insertInlineContent([...links, ...(atLineEnd ? [' '] : [])]);
}

/** ']]' closes a link typed out in full: '[[Title]]' links to the notebook with that title, if it isn't this one. */
export const linkClosingExtension = (notebookId: string) =>
  linkClosing((title) => notebookTitled(useStore.getState().notebooks, title, notebookId)?.id ?? null);

// Line icons drawn like the / menu's: on a 24-unit grid, in the text colour.
const lineIcon = (d: string) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const NOTEBOOK_ICON = lineIcon('M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h3');
const CREATE_ICON = lineIcon('M12 5v14M5 12h14');

/**
 * The [[ menu: drawn with the / menu's parts, keyed by notebook, since two notebooks can share a title.
 * Each page shows where it sits under its title, so those two can be told apart.
 */
export function LinkMenu({ items, selectedIndex, onItemClick, loadingState }: SuggestionMenuProps<LinkChoice>) {
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const notebooks = useStore((s) => s.notebooks);
  const spaces = useStore((s) => s.spaces);

  return (
    <Components.SuggestionMenu.Root id="bn-suggestion-menu" className="bn-suggestion-menu link-menu">
      {items.map((choice, i) => (
        <Components.SuggestionMenu.Item
          key={choice.kind === 'notebook' ? `notebook-${choice.notebookId}` : 'create'}
          className="bn-suggestion-menu-item bn-suggestion-menu-item-small"
          id={`bn-suggestion-menu-item-${i}`}
          isSelected={i === selectedIndex}
          item={{
            title: linkChoiceLabel(choice),
            subtext: linkChoicePath(choice, notebooks, spaces) || undefined,
            icon: choice.kind === 'notebook' ? NOTEBOOK_ICON : CREATE_ICON,
          }}
          onClick={() => onItemClick?.(choice)}
        />
      ))}
      {items.length === 0 && loadingState === 'loaded' && (
        <Components.SuggestionMenu.EmptyItem className="bn-suggestion-menu-item">{dict.suggestion_menu.no_items_title}</Components.SuggestionMenu.EmptyItem>
      )}
    </Components.SuggestionMenu.Root>
  );
}
