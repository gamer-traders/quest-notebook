import type * as CodeEditorModule from './codeEditor';

/** The code editor, Monaco and all. It's loaded the first time a page shows a code block. */
export type CodeEditorApi = typeof CodeEditorModule;

let loading: Promise<CodeEditorApi> | null = null;
let loaded: CodeEditorApi | null = null;

export function loadCodeEditor(): Promise<CodeEditorApi> {
  loading ??= import('./codeEditor').then(
    (api) => (loaded = api),
    (error: unknown) => {
      // A chunk that failed to load can be tried again.
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The code editor when it's loaded already, so a block can start it without waiting. */
export const loadedCodeEditor = (): CodeEditorApi | null => loaded;
