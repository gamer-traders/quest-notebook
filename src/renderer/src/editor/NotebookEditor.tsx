import { useCallback, useEffect, useMemo, useState, type JSX, type MouseEvent } from 'react';
import { filterSuggestionItems, type PartialBlock } from '@blocknote/core';
import { en } from '@blocknote/core/locales';
import {
  BasicTextStyleButton,
  CreateLinkButton,
  DragHandleMenu,
  FormattingToolbar,
  FormattingToolbarController,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  useDictionary,
  useEditorState,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import './editor.css';
import type { Notebook } from '../types';
import type { PageBlock } from '../page/blockTypes';
import { createSaver } from '../lib/saver';
import { unsavedEditors } from './pending';
import { useStore } from '../store';
import { NotebookContext, useNotebookId } from './NotebookContext';
import { itemBlocksExtension } from './itemExtension';
import { LINK_TRIGGER, linkMenuOpensHere, pageExtensions } from './inlineRules';
import { codeBlockExtension } from './codeFocus';
import { linkChoices, type LinkChoice } from './linkItems';
import { insertNotebookLink, linkClosingExtension, LinkMenu } from './NotebookLink';
import { pageSlashItems } from './slashItems';
import { pastePage } from './paste';
import { HighlightButton } from './HighlightButton';
import { TurnIntoSelect } from './TurnIntoSelect';
import { schema, type PageEditor } from './schema';
import { displayTitle } from '../page/tree';
import { askClaude } from '../claude/ClaudePanel';
import { AskClaudeItem, BlockMenu, blockMenuAt, type BlockMenuAt } from './BlockMenu';

const PLACEHOLDER = 'Type / for blocks, [[ to link a notebook';

const dictionary = { ...en, placeholders: { ...en.placeholders, default: PLACEHOLDER, emptyDocument: PLACEHOLDER } };

/** Puts the selected words in Claude's message box, to ask about. Shown on a read-only page too. */
function AskClaudeButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const pageId = useNotebookId();
  const text = useEditorState({ editor, selector: ({ editor }) => editor.getSelectedText() });
  if (!text.trim()) return null;
  const ask = () => {
    const title = useStore.getState().notebooks.find((n) => n.id === pageId)?.title ?? '';
    askClaude({ kind: 'selection', pageId, title: displayTitle(title), text });
  };
  return (
    <Components.FormattingToolbar.Button className="bn-button" label="Ask Claude" mainTooltip="Ask Claude about the selection" onClick={ask}>
      Ask Claude
    </Components.FormattingToolbar.Button>
  );
}

/** The selection toolbar: turn into, the four text styles, the highlighter, a link and Ask Claude. No text colours. */
function PageToolbar() {
  return (
    <FormattingToolbar>
      <TurnIntoSelect />
      <BasicTextStyleButton basicTextStyle="bold" />
      <BasicTextStyleButton basicTextStyle="italic" />
      <BasicTextStyleButton basicTextStyle="underline" />
      <BasicTextStyleButton basicTextStyle="strike" />
      <HighlightButton />
      <CreateLinkButton />
      <AskClaudeButton />
    </FormattingToolbar>
  );
}

/** The drag handle's menu holds Ask Claude and Delete: its block colours would bring colours from outside the chart marks. */
function PageDragHandleMenu() {
  const dict = useDictionary();
  return (
    <DragHandleMenu>
      <AskClaudeItem />
      <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
    </DragHandleMenu>
  );
}

const PageSideMenu = () => <SideMenu dragHandleMenu={PageDragHandleMenu} />;

/** `editable` false makes the page read-only: it can still be scrolled, selected, and its links followed. */
export function NotebookEditor({ notebook, editable = true }: { notebook: Notebook; editable?: boolean }): JSX.Element {
  const theme = useStore((s) => s.theme);
  const notebookId = notebook.id;

  // The page is read once, when it opens. After that the editor owns it and saves it back.
  const editor = useCreateBlockNote({
    schema,
    dictionary,
    extensions: [itemBlocksExtension(notebookId), linkClosingExtension(notebookId), codeBlockExtension(), ...pageExtensions],
    pasteHandler: pastePage,
    initialContent: (notebook.blocks.length ? notebook.blocks : [{ type: 'paragraph' }]) as PartialBlock<PageEditor['schema']['blockSchema']>[],
  });

  const getSlashItems = useCallback(
    async (query: string) => filterSuggestionItems(pageSlashItems(editor, notebookId), query),
    [editor, notebookId],
  );

  // Right-clicking a block offers to ask Claude about it.
  const [blockMenu, setBlockMenu] = useState<BlockMenuAt | null>(null);
  const closeBlockMenu = useCallback(() => setBlockMenu(null), []);
  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    const at = blockMenuAt(editor, notebookId, e.target, e.clientX, e.clientY);
    if (!at) return;
    e.preventDefault();
    setBlockMenu(at);
  };

  const getLinkChoices = useCallback(async (query: string) => linkChoices(useStore.getState().notebooks, query, notebookId), [notebookId]);
  const onLinkChoice = useCallback((choice: LinkChoice) => insertNotebookLink(editor, notebookId, choice), [editor, notebookId]);

  const saver = useMemo(() => {
    const inner = createSaver(() => {
      unsavedEditors.clear(notebookId);
      useStore.getState().setBlocks(notebookId, editor.document as unknown as PageBlock[]);
    }, 300);
    return {
      schedule: () => {
        unsavedEditors.mark(notebookId);
        inner.schedule();
      },
      flush: inner.flush,
    };
  }, [editor, notebookId]);

  // Closing the tab, or switching notebooks, right after typing still saves the last words.
  // Some browsers close a tab without a pagehide, but the page always turns hidden first.
  // Main asks for pending saves before the window closes or the workspace switches.
  useEffect(() => unsavedEditors.register(notebookId, saver.flush), [notebookId, saver]);

  useEffect(() => {
    const flush = () => saver.flush();
    const flushIfHidden = () => document.visibilityState === 'hidden' && saver.flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushIfHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushIfHidden);
      saver.flush();
    };
  }, [saver]);

  return (
    <NotebookContext.Provider value={notebookId}>
      <BlockNoteView
        editor={editor}
        theme={theme}
        className="page-editor"
        editable={editable}
        slashMenu={false}
        formattingToolbar={false}
        sideMenu={false}
        onChange={saver.schedule}
        onContextMenu={onContextMenu}
      >
        {/* A '/' in a code block is typed in its code editor, which the page never sees: the menu can't open there. */}
        <SuggestionMenuController triggerCharacter="/" getItems={getSlashItems} />
        <SuggestionMenuController
          triggerCharacter={LINK_TRIGGER}
          getItems={getLinkChoices}
          onItemClick={onLinkChoice}
          shouldOpen={linkMenuOpensHere}
          suggestionMenuComponent={LinkMenu}
        />
        <FormattingToolbarController formattingToolbar={PageToolbar} />
        <SideMenuController sideMenu={PageSideMenu} />
      </BlockNoteView>
      {blockMenu && <BlockMenu at={blockMenu} onClose={closeBlockMenu} />}
    </NotebookContext.Provider>
  );
}
