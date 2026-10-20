import { useCallback, useEffect, useMemo, type JSX } from 'react';
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
  useCreateBlockNote,
  useDictionary,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import type { Transaction } from 'prosemirror-state';
import '@blocknote/mantine/style.css';
import './editor.css';
import type { Notebook } from '../types';
import type { PageBlock } from '../page/blockTypes';
import { createSaver } from '../lib/saver';
import { useStore } from '../store';
import { NotebookContext } from './NotebookContext';
import { itemBlocksExtension } from './itemExtension';
import { LINK_TRIGGER, linkMenuOpensHere, pageExtensions } from './inlineRules';
import { linkChoices, type LinkChoice } from './linkItems';
import { insertNotebookLink, linkClosingExtension, LinkMenu } from './NotebookLink';
import { pageSlashItems } from './slashItems';
import { pastePage } from './paste';
import { HighlightButton } from './HighlightButton';
import { TurnIntoSelect } from './TurnIntoSelect';
import { schema, type PageEditor } from './schema';

const PLACEHOLDER = 'Type / for blocks, [[ to link a notebook';

const dictionary = { ...en, placeholders: { ...en.placeholders, default: PLACEHOLDER, emptyDocument: PLACEHOLDER } };

/** The selection toolbar: turn into, the four text styles, the highlighter and a link. No text colours. */
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
    </FormattingToolbar>
  );
}

/** The drag handle's menu holds only Delete: its block colours would bring colours from outside the chart marks. */
function PageDragHandleMenu() {
  const dict = useDictionary();
  return (
    <DragHandleMenu>
      <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
    </DragHandleMenu>
  );
}

const PageSideMenu = () => <SideMenu dragHandleMenu={PageDragHandleMenu} />;

// A '/' in code is part of the code.
const slashOpensHere = (tr: Transaction) => !tr.selection.$from.parent.type.spec.code;

export function NotebookEditor({ notebook }: { notebook: Notebook }): JSX.Element {
  const theme = useStore((s) => s.theme);
  const notebookId = notebook.id;

  // The page is read once, when it opens. After that the editor owns it and saves it back.
  const editor = useCreateBlockNote({
    schema,
    dictionary,
    extensions: [itemBlocksExtension(notebookId), linkClosingExtension(notebookId), ...pageExtensions],
    pasteHandler: pastePage,
    initialContent: (notebook.blocks.length ? notebook.blocks : [{ type: 'paragraph' }]) as PartialBlock<PageEditor['schema']['blockSchema']>[],
  });

  const getSlashItems = useCallback(
    async (query: string) => filterSuggestionItems(pageSlashItems(editor, notebookId), query),
    [editor, notebookId],
  );

  const getLinkChoices = useCallback(async (query: string) => linkChoices(useStore.getState().notebooks, query, notebookId), [notebookId]);
  const onLinkChoice = useCallback((choice: LinkChoice) => insertNotebookLink(editor, notebookId, choice), [editor, notebookId]);

  const saver = useMemo(
    () => createSaver(() => useStore.getState().setBlocks(notebookId, editor.document as unknown as PageBlock[]), 300),
    [editor, notebookId],
  );

  // Closing the tab, or switching notebooks, right after typing still saves the last words.
  // Some browsers close a tab without a pagehide, but the page always turns hidden first.
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
        slashMenu={false}
        formattingToolbar={false}
        sideMenu={false}
        onChange={saver.schedule}
      >
        <SuggestionMenuController triggerCharacter="/" getItems={getSlashItems} shouldOpen={slashOpensHere} />
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
    </NotebookContext.Provider>
  );
}
