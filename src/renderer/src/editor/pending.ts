/**
 * Pages whose editor holds words not yet handed to the store: it waits a moment after typing stops. A change
 * on disk to one of them waits too, so it can't replace what's being typed.
 */
const typing = new Set<string>();

export const unsavedEditors = {
  mark: (notebookId: string) => void typing.add(notebookId),
  clear: (notebookId: string) => void typing.delete(notebookId),
  ids: (): Set<string> => new Set(typing),
};
