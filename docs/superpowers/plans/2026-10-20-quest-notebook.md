# Quest Notebook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the trading-notebook prototype into Quest Notebook, an Electron desktop app whose notes live as AI-readable JSON files in Obsidian-style workspace folders, with live reload of outside changes.

**Architecture:** electron-vite project with three parts:
- `src/main` (Node): workspaces, disk scan, apply, watch and IPC
- `src/preload`: one typed `window.quest` bridge
- `src/renderer`: the prototype's React app, moved over nearly verbatim

The renderer converts pages to and from the JSON file format and sends batched saves to main. Main maps pages to paths (spaces are folders, sub-pages sit in a folder named like their parent), writes atomically, moves files to the Trash, and watches the folder for outside changes.

**Tech Stack:** Electron 44, electron-vite 6, Vite 8, React 19, TypeScript 7, Vitest 5, BlockNote 0.56, zustand 5, lightweight-charts 5, electron-builder 26.

**Spec:** `docs/superpowers/specs/2026-10-20-quest-notebook-design.md`

## Global Constraints

- **Source:** the prototype lives at `/Users/abesalomi/Workspace/local/trading-notebook`. Copy from it; never modify it.
- **Product name:** "Quest Notebook" (window title, menus, brand, `index.html` title). The app id is `com.gamertraders.questnotebook`.
- **Renderer isolation:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. The renderer reaches Node only through `window.quest`.
- **Path safety:** every path main touches must resolve inside the open workspace root. Anything else throws.
- **No permanent deletes:** pages and spaces go to the system Trash (`shell.trashItem`).
- **Unreadable files:** a page file that failed to parse is never written by the app.
- **Page file names:** made with `safeName` and `uniqueName` (Task 2). A space's folder name is its name, made safe with `safeName`.
- **JSON output:** always goes through `formatJson` (Task 2).
- **Times in files:** ISO 8601 UTC with no milliseconds, e.g. `2024-10-28T00:00:00Z`.
- **Tests:** `npm test` (Vitest) stays green. Pure logic is test-first. Disk tests use `fs.mkdtemp(os.tmpdir())` folders.
- **Shared code:** pure code used by both main and renderer lives in `src/shared/` and is imported as `@shared/...`.

## Review Focus

1. **Renaming a page by typing its title:** intermediate titles must not leave stray files. Case-only renames ("notes" → "Notes") must work on the case-insensitive macOS file system. A test in Task 6.
2. **An AI rewrites the open page while the user isn't typing:** the editor shows the new content, and the app doesn't write its old copy back. A test in Task 9 (no echo after a disk delta).
3. **A file that is invalid while being written, then valid:** an error record first, then the page, and the file is never overwritten in between. Tests in Tasks 5 and 7.
4. **Deleting a parent page:** the store also removes its sub-pages, so main gets the ids of the parent and every descendant. It must trash the parent's file and folder once, and skip the children whose files went with it, without errors. A test in Task 6.
5. **The last workspace folder is gone at launch, or vanishes while open:** the welcome screen shows "Couldn't find <path>", with no crash and no folder re-created. A test in Task 8 (the registry open result), plus a manual check in Task 11.

---

### Task 1: Electron shell running the prototype UI

**Files:**
- Create:
  - `package.json`
  - `electron.vite.config.ts`
  - `vitest.config.ts`
  - `tsconfig.json`
  - `.gitignore`
  - `src/main/index.ts`
  - `src/preload/index.ts`
  - `src/renderer/index.html`
- Copy: the prototype's `src/**` to `src/renderer/src/**`
- Delete (after copying):
  - `src/renderer/src/migrate/`
  - `components/MigrationGate.tsx`
  - `components/MigrationBanner.tsx`
  - `components/StorageWarning.tsx`
  - `lib/safeStorage.ts` and `lib/safeStorage.test.ts`
  - `page/upgrade.ts` and `page/upgrade.test.ts`
- Modify:
  - `src/renderer/src/main.tsx`
  - `src/renderer/src/mountApp.tsx`
  - `src/renderer/src/store.ts`
  - `src/renderer/src/store.test.ts`
  - `src/renderer/src/types.ts`
  - `src/renderer/src/lib/seed.ts`
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/components/Sidebar.tsx`

**Interfaces:**
- Produces:
  - `SAMPLE_SPACES: Space[]` in `lib/seed.ts`. It's the old `UPGRADED_SPACES`: `space-journal`/Journal, `space-market`/Markets, `space-lesson`/Lessons.
  - `Notebook` without `kind`; `NotebookKind` is removed.
  - The store keeps every action it has today.

- [ ] **Step 1: Scaffold**
  - **Dependencies:** the prototype's `dependencies` and `devDependencies`, plus `electron@^44`, `electron-vite@^6` and `electron-builder@^26`.
  - **package.json:** `"main": "out/main/index.js"`, plus these scripts:
    - `dev`: `electron-vite dev`
    - `build`: `electron-vite build`
    - `start`: `electron-vite preview`
    - `typecheck`: `tsc --noEmit -p .`
    - `test`: `vitest run`
  - **electron.vite.config.ts:**
    - main and preload get the alias `@shared` → `src/shared`
    - preload builds as CommonJS to `out/preload/index.cjs`, because sandboxed preloads can't be ES modules
    - the renderer gets the React plugin and the same alias
  - **vitest.config.ts:** includes `src/**/*.test.{ts,tsx}`, environment `node`, and the same alias. Renderer tests keep their `// @vitest-environment jsdom` comments.
  - **tsconfig.json:** the prototype's options, plus `"paths": {"@shared/*": ["./src/shared/*"]}`, `"types": ["vite/client", "node"]` and `include: ["src", "*.config.ts"]`.
  - **.gitignore:** `node_modules`, `out`, `dist`, `.superpowers/`, `.worktrees/`.
- [ ] **Step 2: Copy the prototype and remove the browser-storage parts**
  - **main.tsx:** loads the fonts and `styles.css`, then calls `mountApp`. No `prepareStorage` and no gate.
  - **App.tsx:** drops `MigrationBanner` and `StorageWarning`.
  - **store.ts:**
    - `persist` keeps only `appearance`, under the key `quest-notebook-appearance` at version 1. Its `merge` runs `appearanceFromSaved` and resolves the theme.
    - The notebook upgrade is removed.
    - `isJournal` checks only `journalDate`.
    - `UPGRADED_SPACES` imports move to `SAMPLE_SPACES`.
    - It still starts with the seed notebooks for now. Task 9 replaces that.
- [ ] **Step 3: Brand**
  - Every user-visible "Trading notebook" becomes "Quest Notebook": the topbar, the sidebar brand, and `<title>`.
  - The sidebar foot's "Saved in this browser" is removed.
- [ ] **Step 4: Main and preload**
  - `src/main/index.ts` creates one `BrowserWindow`: 1280×840, at least 720×500, titled "Quest Notebook", with the isolation settings from the constraints and preload `out/preload/index.cjs`.
    - In dev it loads `process.env.ELECTRON_RENDERER_URL`. Otherwise it loads `out/renderer/index.html`.
    - It quits when all windows close, except on macOS.
  - `src/preload/index.ts` exposes `window.quest = {}` for now.
- [ ] **Step 5: Fix the tests for the removed modules**
  - Delete the tests of deleted modules.
  - In `store.test.ts`, drop the notebook-persistence tests and keep the rest.
  - Run `npm test`. Expected: PASS.
- [ ] **Step 6: Verify**
  - Run `npm run typecheck && npm run build`. Expected: exit 0.
  - Run `npm run dev`. Expected: an Electron window showing the prototype UI with its sample pages, a chart drawing, and the `/` menu working.
- [ ] **Step 7: Commit:** `feat: Quest Notebook Electron shell running the prototype UI`

---

### Task 2: JSON formatting and safe names (shared)

**Files:**
- Create:
  - `src/shared/formatJson.ts` and `src/shared/formatJson.test.ts`
  - `src/shared/names.ts` and `src/shared/names.test.ts`

**Interfaces:**
- Produces:
  - `formatJson(value: unknown, width?: number /* 120 */): string`
  - `safeName(title: string): string`
  - `uniqueName(base: string, taken: Iterable<string>): string`
  - `UNTITLED = 'Untitled'`

- [ ] **Step 1: Write failing tests**

```ts
test('leaf containers stay on one line', () => {
  expect(formatJson({ a: 1, b: [1, 2], c: { x: 'y' } })).toBe('{\n  "a": 1,\n  "b": [1, 2],\n  "c": { "x": "y" }\n}\n');
});
test('empty containers', () => expect(formatJson({ a: [], b: {} })).toBe('{\n  "a": [],\n  "b": {}\n}\n'));
test('a leaf too long for the width breaks', () => {
  const out = formatJson({ list: Array.from({ length: 40 }, (_, i) => i * 1000) });
  expect(out.split('\n').every((l) => l.length <= 120)).toBe(true);
});
test('round-trips', () => { const v = { blocks: [{ type: 'p', text: 'a "q"\n' }, { n: null, b: true }] }; expect(JSON.parse(formatJson(v))).toEqual(v); });

test('safeName', () => {
  expect(safeName('BTC/USDT: levels?')).toBe('BTC-USDT- levels-');
  expect(safeName('')).toBe('Untitled');
  expect(safeName('   ')).toBe('Untitled');
  expect(safeName('..hidden. ')).toBe('hidden');
  expect(safeName('a\u0000b\nc')).toBe('abc');
  expect(safeName('x'.repeat(200))).toHaveLength(120);
  expect(safeName('Weekly levels')).toBe('Weekly levels');
});
test('uniqueName ignores case', () => {
  expect(uniqueName('Notes', [])).toBe('Notes');
  expect(uniqueName('Notes', ['notes'])).toBe('Notes 2');
  expect(uniqueName('Notes', ['Notes', 'NOTES 2'])).toBe('Notes 3');
});
```

- [ ] **Step 2: Run them.** `npx vitest run src/shared`. Expected: FAIL (the modules don't exist).
- [ ] **Step 3: Implement**
  - **formatJson:**
    - two-space indent and a trailing newline
    - an object or array whose values are all primitives prints on one line, as `[1, 2]` or `{ "k": v }`, when indent plus the line fits `width`
    - anything else prints multi-line
  - **safeName:**
    - drops control characters
    - `/ \ : * ? " < > |` → `-`
    - trims spaces, strips leading dots and trailing dots or spaces
    - cuts to 120 characters, then trims again
    - empty → `Untitled`
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat: JSON formatting and safe file names`

---

### Task 3: Inline text markup

**Files:**
- Create: `src/renderer/src/files/inline.ts` and `src/renderer/src/files/inline.test.ts`
- Modify:
  - `src/renderer/src/page/blockTypes.ts`: `NotebookLinkInline.props` becomes `{ notebookId: string; target?: string }`
  - `src/renderer/src/editor/NotebookLink.tsx`: `propSchema` adds `target: { default: '' }`. When `notebookId` doesn't resolve and `target` isn't empty, the chip shows `target` with the classes `notebook-link is-missing` and the title "No page called …". Otherwise it behaves as today.
  - `styles.css` or `editor.css`: `.notebook-link.is-missing` is dashed underline and muted.

**Interfaces:**
- Consumes: `Inline`, `StyledText`, `LinkInline` and `NotebookLinkInline` from `page/blockTypes.ts`, and `MARK_COLORS` from `chart/palette.ts`.
- Produces:
  - `inlineToMarkup(content: unknown, linkText: (link: NotebookLinkInline) => string): string`
  - `markupToInline(text: string): Inline[]`. Page links come back as `{ type: 'notebookLink', props: { notebookId: '', target } }`.
  - `normalizeInline(content: Inline[]): Inline[]`, which merges neighbours with equal styles and drops empty text.
  - `KEPT_STYLES = ['bold', 'italic', 'underline', 'strike', 'code', 'backgroundColor']`. Other styles are dropped, and so is a `backgroundColor` that isn't one of `MARK_COLORS`.

- [ ] **Step 1: Write failing tests** (`t(text, styles)` builds a StyledText)

```ts
const none = () => '';
test.each([
  ['**b**', [t('b', { bold: true })]],
  ['*i*', [t('i', { italic: true })]],
  ['<u>u</u>', [t('u', { underline: true })]],
  ['~~s~~', [t('s', { strike: true })]],
  ['`c`', [t('c', { code: true })]],
  ['==h==', [t('h', { backgroundColor: 'yellow' })]],
  ['=={blue}h==', [t('h', { backgroundColor: 'blue' })]],
])('%s parses', (markup, runs) => {
  expect(markupToInline(markup)).toEqual(runs);
  expect(inlineToMarkup(runs, none)).toBe(markup);
});
test('web link with styled words', () => {
  const link = { type: 'link', href: 'https://x.io/a_(b)', content: [t('see ', {}), t('this', { bold: true })] };
  expect(markupToInline(inlineToMarkup([link], none))).toEqual([link]);
});
test('page link', () => {
  expect(markupToInline('See [[Weekly levels]].')).toEqual([t('See ', {}), { type: 'notebookLink', props: { notebookId: '', target: 'Weekly levels' } }, t('.', {})]);
  expect(inlineToMarkup([{ type: 'notebookLink', props: { notebookId: 'n1' } }], () => 'Weekly levels')).toBe('[[Weekly levels]]');
});
test('ordinary trading text stays readable', () => {
  expect(inlineToMarkup([t('~70k, x = 5, a-b #btc\nnext line', {})], none)).toBe('~70k, x = 5, a-b #btc\nnext line');
});
test('literal markers are escaped', () => {
  for (const s of ['2*3', 'a**b', '`x`', '[[no]]', '==not==', '~~no~~', '<u>no</u>', 'back\\slash', '[x](y)'])
    expect(markupToInline(inlineToMarkup([t(s, {})], none))).toEqual([t(s, {})]);
});
test('style changes between neighbours', () => {
  const runs = [t('a', { italic: true }), t('b', { bold: true }), t('c', { bold: true, italic: true }), t('d', { backgroundColor: 'yellow' }), t('e', { backgroundColor: 'red' })];
  expect(markupToInline(inlineToMarkup(runs, none))).toEqual(runs);
});
test('random round trips', () => {
  // seeded PRNG; 500 cases; text from 'ab *~=[]`<u>\\\n#' ; random subsets of KEPT_STYLES and colours
  for (const runs of randomRuns(500, 42)) expect(markupToInline(inlineToMarkup(runs, none))).toEqual(normalizeInline(runs));
});
```

- [ ] **Step 2: Run them.** `npx vitest run src/renderer/src/files/inline.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the toggle grammar**
  - **The tokenizer** is greedy, checking in this order:
    1. `\x` (literal)
    2. `=={color}` (opens a highlight in that colour)
    3. `==` (toggles highlight; opening it means yellow)
    4. `**`
    5. `*`
    6. `~~`
    7. `<u>` and `</u>`
    8. `` ` ``: toggles code. Inside code everything is literal except `` \` `` and `\\`.
    9. `[[…]]`
    10. `[…](…)`
  - **Each marker toggles its style.**
  - **The serializer** walks the runs and emits only the style transitions between neighbours.
  - **Escaping:**
    - `\ * ` [ ]` are always escaped
    - `~` and `=` are escaped only where a doubled marker would form
    - `<` is escaped only before `u>` or `/u>`
  - The random round trip is the arbiter.
- [ ] **Step 4: Run them.** Expected: PASS. Also run `npm test`. Expected: PASS, including the existing `NotebookLink.test.ts`.
- [ ] **Step 5: Commit:** `feat: Markdown-style text markup for page files`

---

### Task 4: Page ↔ file conversion and links

**Files:**
- Create:
  - `src/shared/pageFile.ts` (types only)
  - `src/renderer/src/files/convert.ts` and `convert.test.ts`
  - `src/renderer/src/files/links.ts` and `links.test.ts`
- Modify: `src/renderer/src/types.ts`. `Notebook` gains `path?: string` (the path relative to the workspace, for display) and `loadError?: string`.

**Interfaces:**
- Produces, in `@shared/pageFile`:
  - `PageFile { id: string; title: string; position: number; journalDate?: string; created: string; updated: string; blocks: FileBlock[] }`
  - The `FileBlock` union, with types as in the spec's block table: `paragraph`, `heading`, `bullet`, `numbered`, `checklist`, `quote`, `callout`, `divider`, `code`, `chart`, `tradePlan` and `prediction`. Each takes an optional `children?: FileBlock[]`.
  - `FileChart`:
    - from the chart cell: `id`, `source`, `symbol`, `interval`, `frozenAt`, `revealed` and `practice`
    - `levels: {price, color?, line?, width?, note?}[]`
    - `trendLines: {from:{time,price}, to:{time,price}, color?, line?, width?, note?}[]`
    - `pins: {time, text, color?}[]`
    - `labels: {time, price, text, color?}[]`
    - custom charts add `name?`, `dated?` and `candles?: {time, open, high, low, close, volume}[]`
- Produces, in `files/convert.ts`:
  - `pageToFile(nb: Notebook, linkText: (l: NotebookLinkInline) => string): PageFile`
  - `fileToPage(raw: unknown, meta: { id: string; spaceId: string; parentId: string | null; path: string; fileTimeMs: number; fallbackPosition: number }): { notebook: Notebook; repaired: boolean }`
    - It throws `Error` when `raw` isn't an object or `blocks` isn't an array.
    - `repaired` is true when any default was filled in: a title from the file name, a position, or times.
  - `isoFromSec(sec: number): string` and `secFromIso(iso: string): number`
- Produces, in `files/links.ts`:
  - `linkWriter(notebooks: Notebook[], spaces: Space[]): (l: NotebookLinkInline) => string`
    - a target that exists → its display title, or its path joined with `/` when another page shares the title, ignoring case
    - a target that's gone → `l.props.target || 'Deleted notebook'`
  - `resolveLinks(notebooks: Notebook[], spaces: Space[]): Notebook[]`
    - fills `notebookId` for links with an empty id and a `target`
    - matching tries a unique title first, then a path, then the first title match in the same space
    - returns the same object for every notebook it doesn't change
  - `linksTo(nb: Notebook): Set<string>`, the ids `nb` links to

- [ ] **Step 1: Write failing tests**
  - `seed round-trips`: for each of `seedNotebooks()`, `fileToPage(pageToFile(nb, w), meta).notebook` equals `nb`, compared with `stripIds()`, which blanks text-block ids and chart mark ids.
  - `chart times are ISO`: `newChart({ asOf: 1730073600 })` gives the file's `frozenAt` `'2024-10-28T00:00:00Z'`, and pins and trend points are ISO too.
  - `block mapping`: `bulletListItem`→`bullet`, `numberedListItem`→`numbered`, `checkListItem`→`checklist` (with `checked`), `codeBlock`→`code` (with `language`, and `code` set to the raw text), heading keeps its `level`, and children nest.
  - `unknown block kept`: `{ type: 'table', rows: 2 }` becomes a `codeBlock` with `language: 'json'` and text `formatJson({ type: 'table', rows: 2 }).trim()`.
  - `defaults`: when `title` is missing, `meta.path` `'Markets/Weekly levels.json'` gives the title `'Weekly levels'`. Missing `position` gives `fallbackPosition`, and `repaired === true`.
  - `bad shape throws`: `fileToPage('x', meta)` and `fileToPage({ blocks: 1 }, meta)` both throw.
  - `link text`:
    - a unique title gives `Weekly levels`
    - two pages titled "Notes" in Markets and Lessons give `Markets/Notes` and `Lessons/Notes`
    - a deleted target with `target: 'Old'` gives `Old`
  - `resolveLinks`:
    - `target: 'Lessons/Notes'` resolves to the Lessons page
    - an unresolvable target stays `''`
    - notebooks it doesn't change keep their identity (`toBe`)
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement**
  - Item blocks use `notebook.items[block.id]`.
  - Text blocks get fresh `uid()` ids on load. Item blocks keep the file's `id`, or get a new one if it's missing.
  - Marks get fresh ids.
  - `source` is always written. `practice` and `revealed` are always written.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat: page files and links by title`

---

### Task 5: Main: scan a workspace

**Files:**
- Create:
  - `src/shared/ipc.ts` (types)
  - `src/main/workspace/paths.ts`
  - `src/main/workspace/scan.ts` and `scan.test.ts`

**Interfaces:**
- Produces, in `@shared/ipc`:
  - `SpaceRecord { id: string; name: string }`
  - `PageRecord { id: string; spaceId: string; parentId: string | null; path: string; mtimeMs: number; file?: unknown; error?: string; titleFromPath?: string }`
  - `UiState { openPageId: string | null; expanded: string[]; collapsedPanels: string[] }`
  - `WorkspaceSnapshot { root: string; name: string; spaces: SpaceRecord[]; journalSpaceId: string | null; pages: PageRecord[]; ui: UiState; isNew: boolean }`
  - `WorkspaceConfig { format: 1; name: string; spaces: string[]; journalSpace: string | null }`
- Produces, in `paths.ts`:
  - `insideRoot(root: string, rel: string): string`, which returns the absolute path or throws `Error('Path outside workspace')`
  - `writeFileAtomic(abs: string, text: string): Promise<void>`, which writes `<abs>.tmp` then renames
- Produces, in `scan.ts`:
  - `ScanIndex { spaceIds: Map<string /*folder*/, string /*id*/>; pages: Map<string /*id*/, { path: string; mtimeMs: number; size: number; text: string; error?: string }> }`
  - `scanWorkspace(root: string, prev?: ScanIndex): Promise<{ snapshot: WorkspaceSnapshot; index: ScanIndex }>`
    - It reads `.quest/workspace.json`. If that's missing, the name is the folder's base name.
    - **Spaces:** listed folders come first, in their order, then unlisted folders alphabetically. Listed folders that don't exist are left out.
    - Space ids are stable through `prev.spaceIds`. New ones are `s_` plus 8 random characters.
    - **Pages:**
      - It recurses through `X.json` files, and `X/` folders hold sub-pages.
      - An unparsable file becomes `{ id: 'bad:' + path, error }`.
      - A missing or duplicate `id` gets a new 8-character id, written back with `formatJson`, keeping every other field. The duplicate is the later one in sorted path order.
      - An `X/` with no `X.json` gets one: `{ id, title: 'X', position: <after siblings>, created, updated: now ISO, blocks: [] }`.
      - Names starting with `.` and files ending in `.tmp` are skipped. So are non-JSON files and JSON files at the root.
    - `ui` comes from `.quest/state.json`, or is empty if that's missing or invalid.

- [ ] **Step 1: Write failing tests** (helpers `tmpWorkspace(files: Record<string, string>)` and `read(root, rel)`)
  - `spaces follow workspace.json, then new folders`: the config lists `["Markets", "Journal"]` and the folders are Journal, Lessons and Markets. The names come out as `['Markets', 'Journal', 'Lessons']`.
  - `nested pages`: `Markets/A.json` and `Markets/A/B.json` give B a `parentId` of A's id, and both have the Markets `spaceId`.
  - `orphan folder becomes a page`: `Markets/Ideas/C.json` with no `Ideas.json` writes `Markets/Ideas.json` with `title: 'Ideas'`, and C's parent is Ideas.
  - `invalid JSON is reported and left alone`: `Markets/Bad.json` = `'{ nope'` gives a record whose `error` is truthy. The file still reads `'{ nope'`.
  - `missing id written back`: `{ "title": "T", "blocks": [] }` is rewritten with an `id` of 8 characters, and `title` and `blocks` are kept.
  - `duplicate ids`: two files with `"id": "same"` give two different ids. The second file's id changes on disk.
  - `ignored`: `.git/x.json`, `Markets/.hidden.json`, `top.json` and `Markets/a.json.tmp` give no pages.
  - `ui state read`: `.quest/state.json` holds `{"openPageId":"p1","expanded":["p1"],"collapsedPanels":[]}`, and the snapshot's `ui` matches it.
  - `insideRoot('/w', '../x')` throws.
- [ ] **Step 2: Run them.** `npx vitest run src/main`. Expected: FAIL.
- [ ] **Step 3: Implement** `paths.ts` and `scan.ts`.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat: scan a workspace folder into spaces and pages`

---

### Task 6: Main: apply saves to disk

**Files:**
- Create: `src/main/workspace/apply.ts` and `apply.test.ts`
- Modify: `src/shared/ipc.ts`

**Interfaces:**
- Consumes: `ScanIndex` and `scanWorkspace` (Task 5), and `safeName`, `uniqueName` and `formatJson` (Task 2).
- Produces, in `@shared/ipc`:
  - `PageSave { id: string; spaceId: string; parentId: string | null; title: string; json: string }`
  - `FlushBatch { spaces: SpaceRecord[]; journalSpaceId: string | null; saves: PageSave[]; deletes: string[] }`
  - `FlushResult { ok: boolean; error?: string; paths: Record<string, string> }`
- Produces, in `apply.ts`:
  - `applyFlush(root: string, index: ScanIndex, batch: FlushBatch, deps: { trash(abs: string): Promise<void>; now(): Date }): Promise<FlushResult>`
  - It mutates `index` so the next scan sees no change. It runs in this order:
    1. **Spaces:**
       - a new id → mkdir of the safe name, made unique among folders
       - a changed name → rename the folder, and the index paths under it
       - an id missing from the batch → trash the folder and drop its pages from the index
       - then write `.quest/workspace.json` if the order or the journal space changed
    2. **Deletes:** for each id still in the index, trash `X.json` and `X/` if they exist, then drop that id and its descendants from the index.
    3. **Saves:**
       - Sorted by depth: parents first, judged by `parentId` chains within the batch and the index.
       - The target is `<space folder>/<parent path without .json>/<uniqueName(safeName(title), sibling names except self)>.json`.
       - If the target differs from the index path, move `X.json` and `X/`, and rewrite the index paths under it. A case-only rename goes through a temporary name.
       - A missing parent folder is created.
       - The file is written atomically if its text differs from `index.text`. Then the index's `text`, `mtimeMs` and `size` are updated.
       - An index entry with an `error` is never written, and its save fails with `error: 'Page file is unreadable'`.
    4. **Cleanup:** a page folder left empty by a move is removed.
  - An unknown `spaceId` makes that save fail. Other saves still apply. `ok` is false and the first error is reported.

- [ ] **Step 1: Write failing tests** (start from `scanWorkspace` on a temp folder; `trash` moves the path to a `trashed: string[]` list with `fs.rm`)
  - `new page`: saving `{ id: 'n1', spaceId: Markets, parentId: null, title: 'Weekly levels' }` writes `Markets/Weekly levels.json` with exactly `json`.
  - `rename moves file and folder`:
    - Start: `Markets/A.json`, plus a sub-page in `Markets/A/B.json`.
    - Save A titled `A2`.
    - Result: the files are `Markets/A2.json` and `Markets/A2/B.json`, `Markets/A` is gone, and the index has B at `Markets/A2/B.json`.
  - `case-only rename`: `notes` → `Notes` leaves `Markets/Notes.json`, and `readdir` shows exactly one entry.
  - `nest under another page`: moving C under A creates `Markets/A/C.json`.
  - `move across spaces`: A and its sub-pages move to `Lessons/`.
  - `same title siblings`: two saves titled `Notes` give `Notes.json` and `Notes 2.json`.
  - `unchanged text is not rewritten`: a second identical save leaves `mtimeMs` unchanged.
  - `delete parent with children ids`: deleting `[A, B]` trashes only `Markets/A.json` and `Markets/A`, with no error.
  - `space rename and delete`:
    - renaming Markets to `Crypto` renames the folder and updates `.quest/workspace.json` spaces
    - leaving Lessons out of the batch trashes `Lessons`
  - `title cannot escape`: a title of `'../../evil'` writes `Markets/-evil.json` or similar, always inside root.
  - `unreadable entry refused`: a save to a `bad:` id returns `ok: false` and the file is unchanged.
  - `swap titles`: A↔B in one batch gives both files present, with the right contents.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `applyFlush`.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat: write pages, moves and deletes to the workspace folder`

---

### Task 7: Main: watch for outside changes

**Files:**
- Create: `src/main/workspace/watch.ts` and `watch.test.ts`
- Modify: `src/shared/ipc.ts`

**Interfaces:**
- Consumes: `scanWorkspace` and `ScanIndex` (Task 5), and `applyFlush` (Task 6), used in the tests.
- Produces, in `@shared/ipc`: `DiskDelta { spaces: SpaceRecord[]; journalSpaceId: string | null; pages: PageRecord[]; removed: string[] }`
- Produces, in `watch.ts`:
  - `diffScans(prev: { snapshot: WorkspaceSnapshot; index: ScanIndex }, next: { snapshot: WorkspaceSnapshot; index: ScanIndex }): DiskDelta | null`
    - A page goes in `pages` when its text, path, parent, space or error changed.
    - `removed` lists ids gone from the next scan.
    - It returns `null` when no page changed and the spaces and journal space are equal.
    - **A file renamed outside the app:** when the old base name equalled `safeName(title)` (allowing a ` N` suffix) and the new base name doesn't, the record carries `titleFromPath` set to the new base name.
  - `watchWorkspace(root: string, onChange: () => void, debounceMs = 150): () => void`
    - It uses `fs.watch(root, { recursive: true })`.
    - It ignores `.quest/state.json` and `*.tmp`, and never throws.
    - It returns a stop function.

- [ ] **Step 1: Write failing tests**
  - `own writes are quiet`: scan, `applyFlush` one save, then rescan with the mutated index. `diffScans` gives `null`.
  - `outside edit`: rewrite `Markets/A.json` with new `blocks`. The delta's `pages` holds A with the new `file`.
  - `outside rename`: rename `Markets/A.json` to `Markets/Alpha.json`. The delta has A's path `Markets/Alpha.json` and `titleFromPath: 'Alpha'`.
  - `outside delete`: removing B gives `removed: [B]`.
  - `new space folder`: `mkdir Ideas` puts Ideas in `delta.spaces`.
  - `invalid then valid`:
    - Writing `'{'` gives a record with `error`.
    - Writing valid JSON with the same id then gives a record without `error`.
  - `watch fires`: `watchWorkspace` on a temp folder, then writing `Markets/x.json`, calls `onChange` within 2 s.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat: notice outside changes to the workspace`

---

### Task 8: Main: workspaces, IPC, window and menu

**Files:**
- Create:
  - `src/shared/readme.ts`
  - `src/main/registry.ts` and `registry.test.ts`
  - `src/main/workspace/create.ts` and `create.test.ts`
  - `src/main/workspace/session.ts`
  - `src/main/ipc.ts`
  - `src/main/menu.ts`
- Modify:
  - `src/shared/ipc.ts`
  - `src/main/index.ts`
  - `src/preload/index.ts`
  - `src/renderer/src/vite-env.d.ts`, which declares `window.quest: QuestApi`

**Interfaces:**
- Produces, in `@shared/ipc`:

```ts
export interface RecentWorkspace { path: string; name: string; lastOpened: string }
export type OpenResult = { ok: true; snapshot: WorkspaceSnapshot } | { ok: false; error: string; path?: string };
export type MenuCommand = 'new-workspace' | 'open-workspace' | 'reveal-workspace';
export interface QuestApi {
  workspaces: {
    current(): Promise<OpenResult | null>;           // the workspace main opened at launch (last used), or null
    recent(): Promise<RecentWorkspace[]>;
    pickFolder(title: string): Promise<string | null>;
    create(parentDir: string, name: string): Promise<OpenResult>;
    open(path: string): Promise<OpenResult>;
    forget(path: string): Promise<void>;
    reveal(): Promise<void>;
  };
  workspace: {
    flush(batch: FlushBatch): Promise<FlushResult>;
    saveUi(ui: UiState): Promise<void>;
    onDiskChange(cb: (delta: DiskDelta) => void): () => void;
  };
  app: {
    onFlushRequest(cb: () => Promise<void>): () => void;   // main asks before closing or switching
    onMenu(cb: (cmd: MenuCommand) => void): () => void;
    openExternal(url: string): Promise<void>;
  };
}
```

- Produces, in `registry.ts`:
  - `Registry { recent: RecentWorkspace[]; last: string | null }`
  - `readRegistry(file: string): Promise<Registry>`, which gives `{ recent: [], last: null }` if the file is missing or invalid
  - `touchWorkspace(file, path, name, now: Date): Promise<Registry>`, which moves the entry to the front, keeps 10, and sets `last`
  - `forgetWorkspace(file, path): Promise<Registry>`
- Produces, in `create.ts`:
  - `createWorkspace(parentDir: string, name: string, now: Date): Promise<string>`
    - It makes `<parentDir>/<safeName(name)>` and throws `'A folder with that name already has files in it'` if that folder isn't empty.
    - It writes `.quest/workspace.json` as `{format:1, name, spaces:['Journal','Markets','Lessons'], journalSpace:'Journal'}`, creates the three folders, and writes `README.md`.
    - It returns the root.
  - `adoptFolder(root: string): Promise<{ isNew: boolean }>`
    - It throws `Couldn't find <path>` if the folder is missing.
    - If `.quest/workspace.json` is missing, it writes `{format:1, name: basename, spaces: [], journalSpace: null}` and also `README.md` if absent, and returns `isNew: true`.
- Produces, in `readme.ts`: `WORKSPACE_README: string`, the spec's file format sections (layout, page file, block types table, text markup table, times, links, loading rules), written for an AI reader.
- Produces, in `session.ts`:
  - `class WorkspaceSession`
  - `static open(root: string, send: (delta: DiskDelta) => void, trash: (abs: string) => Promise<void>): Promise<WorkspaceSession>`
  - `snapshot: WorkspaceSnapshot`
  - `flush(batch: FlushBatch): Promise<FlushResult>`
  - `saveUi(ui: UiState): Promise<void>`, which writes `.quest/state.json`
  - `close(): void`
  - Scans, flushes and rescans run one at a time through a promise queue. A rescan after a watch event calls `diffScans` and sends the delta if it isn't null.
- **main/index.ts:**
  - **Launch:** read the registry, then `adoptFolder` and open `last` if set. A failure gives `current()` = `{ ok: false, error, path }`.
  - **Close:** the window's `close` handler calls `preventDefault`, sends `app:flush-request`, waits for `app:flushed` or 3 s, then destroys the window.
  - **Switching workspaces:** `open` and `create` do the same flush handshake before closing the old session.
  - **Window title:** `<workspace name> — Quest Notebook`.
  - **Navigation:** `setWindowOpenHandler` sends `http(s)` links to `shell.openExternal` and denies everything else. `will-navigate` is prevented unless the URL is the app's own.
  - **Reveal:** `reveal` calls `shell.openPath(root)`.
  - **Trash:** `shell.trashItem`.
  - **CSP:** set on responses in production only: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.binance.com https://data-api.binance.vision`.
- **menu.ts:**
  - the app menu (macOS)
  - File: New Workspace… (`CmdOrCtrl+Shift+N`), Open Folder… (`CmdOrCtrl+O`), Show Workspace in Finder. Each sends `app:menu`.
  - Edit (`role: 'editMenu'`), View (reload, toggle devtools, zoom), Window
  - No accelerator on `CmdOrCtrl+,`, since the renderer handles it.

- [ ] **Step 1: Write failing tests**
  - `registry`: after touching a, b, then a again, `recent` is `[a, b]` and `last` is a. Forgetting a leaves `[b]`. Eleven touches keep 10.
  - `createWorkspace`:
    - It creates `Quest Trading/` with the three folders, the config JSON and `README.md` containing `## Block types`.
    - It throws on a non-empty existing folder.
  - `adoptFolder`:
    - A missing folder throws `Couldn't find`.
    - An existing README is left untouched.
    - It writes the config only once (`isNew` is false the second time).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the registry, create, readme, session, ipc (`ipcMain.handle` for each `QuestApi` method) and menu. The preload maps each `QuestApi` method to `ipcRenderer.invoke` or `on`, using the same channel names: `workspaces:current`, `workspaces:recent`, `workspaces:pick`, `workspaces:create`, `workspaces:open`, `workspaces:forget`, `workspaces:reveal`, `workspace:flush`, `workspace:ui`, `workspace:disk-change`, `app:flush-request`, `app:flushed`, `app:menu`, `app:open-external`.
- [ ] **Step 4: Run them.** Expected: PASS. Then `npm run typecheck && npm run build`. Expected: exit 0.
- [ ] **Step 5: Commit:** `feat: workspaces, IPC bridge, window and menus`

---

### Task 9: Renderer: load, save and live reload

**Files:**
- Create:
  - `src/renderer/src/workspace/load.ts` and `load.test.ts`
  - `src/renderer/src/workspace/sync.ts` and `sync.test.ts`
  - `src/renderer/src/workspace/saveStatus.ts`
  - `src/renderer/src/components/SaveWarning.tsx`
  - `src/renderer/src/components/UnreadablePage.tsx`
- Modify:
  - `src/renderer/src/store.ts`
  - `src/renderer/src/store.test.ts`
  - `src/renderer/src/components/NotebookView.tsx`
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/mountApp.tsx`

**Interfaces:**
- Consumes: `fileToPage`, `pageToFile`, `linkWriter`, `resolveLinks` and `linksTo` (Task 4), `formatJson` (Task 2), and the `@shared/ipc` types (Tasks 5–8).
- Produces, in `load.ts`:
  - `snapshotToState(s: WorkspaceSnapshot): LoadedState`, where `LoadedState = { notebooks: Notebook[]; spaces: Space[]; journalSpaceId: string | null; expanded: Record<string, true>; panelCollapsed: Record<string, true>; activeId: string | null; repaired: Set<string> }`
    - Unreadable records become a `Notebook` with `loadError`, `title` set to the file base name, empty `blocks` and `items`, and `position` after its siblings.
    - `activeId` is `ui.openPageId` if that page exists, otherwise the first page.
  - `deltaToNotebooks(delta: DiskDelta, current: Notebook[], spaces: Space[]): { upserts: Notebook[]; removed: string[] }`
    - Notebook ids are kept.
    - `titleFromPath` overrides the title, and such pages count as repaired.
- Produces, in `sync.ts`:
  - `planFlush(prev: SyncSlice, next: SyncSlice, baseline: Map<string, string>, dirty: Set<string>): { batch: FlushBatch | null; baseline: Map<string, string> }`
    - `SyncSlice = Pick<State, 'notebooks' | 'spaces' | 'journalSpaceId'>`
    - A notebook is a candidate when its object changed, or it's in `dirty`, or it links to a notebook whose title or path changed, or it links to any notebook titled the old or new title.
    - A candidate is saved when `formatJson(pageToFile(nb, linkWriter(...)))` differs from `baseline.get(id)`.
    - `deletes` lists notebooks in prev that are missing from next.
    - `spaces` and `journalSpaceId` are always included when a batch is sent. A batch is sent if anything changed.
    - Notebooks with `loadError` are never saved.
  - `startSync(api: QuestApi['workspace'], store: typeof useStore): SyncHandle`
  - `SyncHandle { flush(): Promise<void>; applyFromDisk(update: () => void): void; markDirty(ids: Iterable<string>): void; stop(): void }`
    - It subscribes to the store and debounces 300 ms. One flush runs at a time, and a change during a flush schedules another.
    - `applyFromDisk` runs the update with saving suppressed, then sets the baseline for the touched pages to their new serialization.
    - UI state changes (`activeId`, `expanded`, `panelCollapsed`) are saved with `api.saveUi`, debounced 1 s.
    - A failed flush sets `useSaveStatus.setState({ error })`. A successful one clears it.
- Produces, in `store.ts`:
  - New state:
    - `workspace: { root: string; name: string } | null`
    - `diskRevision: Record<string, number>`
  - New actions:
    - `loadWorkspace(root: string, name: string, loaded: LoadedState): void`
    - `applyDiskDelta(delta: DiskDelta): void`
      - It upserts, removes, and replaces the spaces and journal space.
      - It bumps `diskRevision[id]` for each upserted page.
      - If the open page was removed, it picks the next active page with `nextActiveAfterDelete`.
      - It re-runs `resolveLinks` over all notebooks, so links to newly arrived pages resolve.
  - It starts empty: `notebooks: []`, `spaces: []` and `activeId: null`, with no seeds.
- **NotebookView:**
  - The editor key is `${nb.id}:${diskRevision[nb.id] ?? 0}`.
  - A notebook with `loadError` shows `UnreadablePage`: "This page's file couldn't be read", the path, the error, and "Fix the file and it reloads by itself."
- **SaveWarning:** shown when `useSaveStatus.error` is set: "Changes aren't being saved: <error>". It reuses the `migration-banner storage-warning` classes.
- **mountApp:**
  - It calls `window.quest.workspaces.current()`. On success it runs `loadWorkspace` and `startSync`.
  - It registers `onDiskChange`. The handler skips pages with unsaved local edits (`SyncHandle` exposes `pendingIds()`) and otherwise calls `applyFromDisk(() => applyDiskDelta(delta))`, then `markDirty` for repaired pages.
  - It registers `onFlushRequest` to call `flush`.

- [ ] **Step 1: Write failing tests**
  - `load.test.ts`:
    - A snapshot with `Markets/A.json` and `Markets/A/B.json` gives the tree.
    - An unreadable record gives a notebook with `loadError`.
    - `[[A]]` in B resolves to A's id.
    - A missing position is listed in `repaired`.
  - `sync.test.ts` (pure `planFlush`):
    - `edit text`: setting the blocks of n1 gives `saves.map(s => s.id) == ['n1']`, and `deletes` is empty.
    - `no change, no batch`: the same state gives `null`.
    - `rename rewrites links`: n2 links to n1, and renaming n1 saves n1 and n2. n2's `json` contains `[[New title]]`.
    - `delete`: removing n1 and its child n3 gives `deletes` of `['n1', 'n3']`.
    - `space rename`: the batch's `spaces` holds the new name.
    - `unreadable never saved`: a notebook with `loadError` that changed gives no save.
    - `baseline after disk apply`: with the baseline set to the disk page's serialization, a next state containing the disk version gives `null` (no echo).
  - `store.test.ts`:
    - `applyDiskDelta` bumps `diskRevision`, replaces the notebook, and removes ids.
    - Deleting the open page through a delta picks the parent.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** load, sync, the store additions, NotebookView, SaveWarning, UnreadablePage and mountApp.
- [ ] **Step 4: Run them.** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: pages load from and save to the workspace, with live reload`

---

### Task 10: Renderer: welcome screen and workspace switcher

**Files:**
- Create:
  - `src/renderer/src/components/Welcome.tsx`
  - `src/renderer/src/components/WorkspaceMenu.tsx`
  - `src/renderer/src/workspace/session.ts` and `session.test.ts`
- Modify:
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/components/Sidebar.tsx`
  - `src/renderer/src/lib/seed.ts`
  - `src/renderer/src/styles.css`
  - `src/renderer/src/mountApp.tsx`

**Interfaces:**
- Consumes: `QuestApi` (Task 8), and `snapshotToState`, `startSync` and the store's `loadWorkspace` (Task 9).
- Produces:
  - `seedFor(spaces: Space[]): Notebook[]` in `lib/seed.ts`. It's `seedNotebooks()` with sample space ids mapped by name to the given spaces' ids. Samples whose space isn't there are dropped.
  - In `workspace/session.ts`:
    - `openResult(result: OpenResult, opts?: { samples: boolean }): void`
      - On success it stops any running sync, loads, starts sync, and seeds and marks dirty when `opts.samples && snapshot.isNew && snapshot.pages.length === 0`.
      - On failure it sets `useWorkspaceUi.setState({ error })`.
    - `useWorkspaceUi`, a zustand store holding `{ error: string | null; screen: 'app' | 'welcome' | 'create' }`
- **Welcome** (shown when `workspace === null` or `screen !== 'app'`), centred and in the app's look:
  - the brand "Quest Notebook" and the error, if any
  - **"Create a new workspace"** opens a form:
    - Name, defaulting to "My Quest"
    - Location: a chosen folder shown as its path, with a "Choose…" button calling `pickFolder`, defaulting to empty, and Create disabled until chosen
    - a checkbox "Start with sample pages", on by default
    - Create runs `create` then `openResult` with samples, and Cancel goes back
  - **"Open a folder"** runs `pickFolder` then `open`
  - **"Recent"** lists each workspace's name and path. Clicking one opens it, and × runs `forget`. The workspace that's open is marked.
  - While a workspace is open, the welcome screen has a "Back to <name>" link.
- **WorkspaceMenu** replaces the sidebar's `.brand`:
  - a button showing the workspace name with ▾
  - its menu lists the recent workspaces (switch), a separator, New workspace…, Open folder… and Show in Finder
- **Menu commands:** File menu commands (`onMenu`) open the same screens.
- **Sidebar foot:** Settings, plus the workspace path in muted text, shortened with `~` for the home folder. Clicking it reveals the folder.

- [ ] **Step 1: Write a failing test:** `seedFor` maps Journal, Markets and Lessons to the given ids, and keeps "Practice: guess the next move" under "Support and resistance".
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** the components and the session helpers, with styles reusing the existing tokens and classes (`primary`, `quiet` and the dialog styles from `SettingsDialog`).
- [ ] **Step 4: Run it.** `npm test`. Expected: PASS. Then `npm run typecheck`. Expected: exit 0.
- [ ] **Step 5: Commit:** `feat: welcome screen and workspace switcher`

---

### Task 11: Packaging, repo README, end-to-end check

**Files:**
- Create: `electron-builder.yml` and `README.md`
- Modify: `package.json`, adding the script `"dist": "electron-vite build && electron-builder --mac --dir"`

- [ ] **Step 1: Packaging:** `electron-builder.yml` has:
  - `appId`: `com.gamertraders.questnotebook`
  - `productName`: `Quest Notebook`
  - `directories.output`: `dist`
  - `files`: `out/**`
  - `mac.target`: `dmg` and `dir`
  - `mac.category`: `public.app-category.productivity`
- [ ] **Step 2: README.md:** what the app is, `npm install`, `npm run dev`, `npm test` and `npm run dist`, and the workspace file layout, pointing to the spec and to the README that every workspace gets.
- [ ] **Step 3: Verify**
  - Run `npm test && npm run typecheck && npm run build && npm run dist`. Expected: all exit 0, and `dist/mac*/Quest Notebook.app` exists.
- [ ] **Step 4: End-to-end check**, following the spec's "How we'll know it works":
  1. With `npm run dev`, create a workspace in `$TMPDIR/quest-e2e` with samples.
  2. Check the files with `ls -R` and `cat`.
  3. Type, rename, nest and delete in the UI, and check the files after each step.
  4. Edit a page file with a shell `cat > …` while the app is open, and check that the UI updates.
  5. Write invalid JSON, then fix it.
  6. Quit and relaunch.
- [ ] **Step 5: Commit:** `chore: packaging and README`
