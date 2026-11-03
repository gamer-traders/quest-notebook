import type { ChatAction } from '@shared/ipc';

export interface ActionLabel {
  text: string;
  target: string | null;
  refused: boolean;
}

const DRAWING = /^(.*)\/drawing-[^/]+\.svg$/;

/** The words for one thing Claude did. The panel shows `text`, then `target` in italics. */
export function actionLabel(a: ChatAction, titleOf: (path: string) => string | null): ActionLabel {
  const refused = a.refused === true;
  if (a.verb === 'searched') return { text: `Searched for “${a.detail ?? ''}”`, target: null, refused };
  if (a.verb === 'other') return { text: a.detail || 'Used a tool', target: null, refused };

  const drawing = a.path ? DRAWING.exec(a.path) : null;
  const known = (p: string) => titleOf(p) ?? p;
  if (a.path && drawing) {
    const text = a.verb === 'read' ? 'Looked at a drawing in' : 'Drew in';
    return { text, target: known(`${drawing[1]}.json`), refused };
  }
  const text = a.verb === 'read' ? 'Read' : a.verb === 'edited' ? 'Edited' : 'Created';
  return { text, target: a.path ? known(a.path) : (a.detail ?? null), refused };
}
