import { createContext, useContext } from 'react';

/** The notebook whose page is being edited, for the blocks inside it. */
export const NotebookContext = createContext<string | null>(null);

export function useNotebookId(): string {
  const id = useContext(NotebookContext);
  if (id === null) throw new Error('useNotebookId needs a NotebookContext around the editor');
  return id;
}
