import { useBlockNoteEditor, useComponentsContext, useEditorState, usePortalElement, useUIMode } from '@blocknote/react';
import type { MarkColor } from '../types';
import { MARK_COLORS } from '../chart/palette';

type Choice = MarkColor | 'none';

const nameOf = (c: Choice) => c[0].toUpperCase() + c.slice(1);

/** The highlighter in the selection toolbar: the chart marks' six colours, or none. */
export function HighlightButton() {
  const Components = useComponentsContext()!;
  const portalElement = usePortalElement();
  const uiMode = useUIMode();
  const editor = useBlockNoteEditor();

  const current = useEditorState({
    editor,
    selector: ({ editor }): Choice | undefined => {
      const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
      if (!editor.isEditable || !blocks.some((b) => b.content !== undefined)) return undefined;
      return (editor.getActiveStyles().backgroundColor as MarkColor | undefined) ?? 'none';
    },
  });

  if (current === undefined) return null;

  const paint = (choice: Choice) => {
    if (choice === 'none') editor.removeStyles({ backgroundColor: 'default' });
    else editor.addStyles({ backgroundColor: choice });
    editor.focus();
  };

  return (
    // As BlockNote's own colour menu does: themed portal, and on a phone the keyboard stays up.
    <Components.Generic.Menu.Root portalElement={portalElement} preventFocusOnOpen={uiMode === 'mobile'}>
      <Components.Generic.Menu.Trigger>
        <Components.FormattingToolbar.Button
          className="bn-button"
          label="Highlight"
          mainTooltip="Highlight"
          icon={
            // The pen shows its ink: yellow, the default, until you pick another.
            <span className="highlight-icon" data-background-color={current === 'none' ? 'yellow' : current}>
              A
            </span>
          }
        />
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown">
        {[...MARK_COLORS, 'none' as const].map((c) => (
          <Components.Generic.Menu.Item
            key={c}
            checked={c === current}
            icon={<span className="highlight-swatch" data-background-color={c === 'none' ? undefined : c} />}
            onClick={() => paint(c)}
          >
            {nameOf(c)}
          </Components.Generic.Menu.Item>
        ))}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}
