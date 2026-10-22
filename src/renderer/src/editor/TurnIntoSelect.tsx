import { BlockTypeSelect, useBlockNoteEditor, useEditorState } from '@blocknote/react';
import { ITEM_BLOCK_TYPES } from '../page/blockTypes';

/** The part of an editor that says which blocks a "turn into" would change. */
interface SelectionSource {
  getSelection(): { blocks: { type: string }[] } | undefined;
  getTextCursorPosition(): { block: { type: string } };
}

// Blocks whose content isn't text: turned into text, they would lose it.
const KEPT_AS_THEY_ARE: readonly string[] = [...ITEM_BLOCK_TYPES, 'codeBlock'];

/**
 * BlockNote's "turn into" changes every block in the selection. A chart, plan or prediction turned into
 * text would lose its data, and a code block its code, so a selection that takes one in doesn't offer it.
 */
export function canTurnInto(editor: SelectionSource): boolean {
  const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
  return !blocks.some((b) => KEPT_AS_THEY_ARE.includes(b.type));
}

/** The toolbar's "turn into", left out while the selection takes in a chart, plan, prediction, drawing or code block. */
export function TurnIntoSelect() {
  const editor = useBlockNoteEditor();
  const allowed = useEditorState({ editor, selector: ({ editor }) => canTurnInto(editor) });
  return allowed ? <BlockTypeSelect /> : null;
}
