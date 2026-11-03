import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { DiskDelta } from '@shared/ipc';
import type { ChartCell, ItemData, MarkdownFile, Notebook, Space } from './types';
import { markdownFromRecord, markdownId } from './markdown/model';
import type { PageBlock } from './page/blockTypes';
import { itemSequence, pruneItems } from './page/blocks';
import { childrenOf, deletePageTree, movePage as moveInTree, nextActiveAfterDelete, positionBetween, type Target } from './page/tree';
import { newChart, uid } from './lib/cells';
import { todayDate, todayLabel } from './lib/format';
import { journalPage, paragraph } from './lib/seed';
import { resolveLinks } from './files/links';
import { deltaToNotebooks, type LoadedState } from './workspace/load';
import { DARK_QUERY, DEFAULT_APPEARANCE, appearanceFromSaved, applyAppearance, resolveTheme, type Appearance } from './lib/appearance';

/** The theme the app shows: the owner's choice, with System resolved against the computer. */
export type Theme = 'light' | 'dark';

interface State {
  /** The workspace folder open now, or null before one is. */
  workspace: { root: string; name: string } | null;
  /** How many times each page was replaced by a change on disk. The editor starts over when it goes up. */
  diskRevision: Record<string, number>;
  notebooks: Notebook[];
  /** Markdown files in the spaces and page folders. */
  markdown: MarkdownFile[];
  /** The owner's spaces, in sidebar order. */
  spaces: Space[];
  /** The space "Today's journal" adds pages to, known by id so a rename keeps it. */
  journalSpaceId: string | null;
  /** Pages whose sub-pages show in the sidebar. */
  expanded: Record<string, boolean>;
  /** Pages whose Sub-pages panel is shut. */
  panelCollapsed: Record<string, boolean>;
  /** Spaces folded in the sidebar. */
  spaceCollapsed: Record<string, boolean>;
  activeId: string | null;
  view: 'notebook' | 'review';
  /** Resolved from `appearance.theme`. Charts, the editor and the migration gate read this one. */
  theme: Theme;
  appearance: Appearance;
  /** A block to scroll to and highlight once, after a jump from search or review. */
  flashBlockId: string | null;
  /** A page whose title field should take focus and select its text once, after it is created. */
  focusTitleId: string | null;

  /** Replaces everything with a workspace read from disk. */
  loadWorkspace: (root: string, name: string, loaded: LoadedState) => void;
  /** Takes in pages and spaces changed on disk outside the app. */
  applyDiskDelta: (delta: DiskDelta) => void;
  /** Back to no workspace. */
  closeWorkspace: () => void;
  openNotebook: (id: string, blockId?: string) => void;
  openReview: () => void;
  /** Adds a page last among its siblings and, unless `open` is false, opens it with its title focused. */
  createPage: (spaceId: string, parentId: string | null, title?: string, open?: boolean) => string;
  /** Moves a page and its sub-pages. False, with nothing changed, when the move is refused. */
  movePage: (id: string, to: Target) => boolean;
  /** Deletes a page and all its sub-pages. */
  deletePage: (id: string) => void;
  createSpace: (name?: string) => string;
  renameSpace: (id: string, name: string) => void;
  /** `toIndex` counts the other spaces, as though this one were already taken out. */
  moveSpace: (id: string, toIndex: number) => void;
  /** Deletes a space and its pages. The last space stays. */
  deleteSpace: (id: string) => void;
  toggleExpanded: (id: string) => void;
  /** Folds a space's pages away in the sidebar, or opens them again. */
  toggleSpace: (id: string) => void;
  setPanelCollapsed: (id: string, collapsed: boolean) => void;
  clearFocusTitle: () => void;
  openTodayJournal: () => void;
  updateNotebook: (id: string, patch: Partial<Pick<Notebook, 'title'>>) => void;
  /** A Markdown file's text, once it's saved. */
  setMarkdownText: (id: string, text: string) => void;
  setBlocks: (notebookId: string, blocks: PageBlock[]) => void;
  addItem: (notebookId: string, item: ItemData) => void;
  updateItem: <T extends ItemData>(notebookId: string, itemId: string, patch: Partial<T>) => void;
  /** Applies at once, to the page and to what's saved. */
  setAppearance: (patch: Partial<Appearance>) => void;
  resetAppearance: () => void;
  clearFlash: () => void;
}

/** What's kept in the app's own storage: only the look. Notebooks live in the workspace folder. */
type Saved = Pick<State, 'appearance'>;

/** Where the look is kept between launches. */
export const APPEARANCE_KEY = 'quest-notebook-appearance';

/** The computer's light or dark setting. A browser that can't tell, or fails to, counts as light. */
const darkQuery = (): MediaQueryList | null => {
  try {
    return (typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY)) || null;
  } catch {
    return null;
  }
};

const systemPrefersDark = (): boolean => darkQuery()?.matches === true;

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

/**
 * The appearance and its resolved theme, as loaded from saved data. It never throws, so it can't stop
 * the saved notebooks loading: whatever goes wrong, the look falls back to the defaults.
 */
const loadedAppearance = (saved: { appearance?: unknown }): Pick<State, 'appearance' | 'theme'> => {
  try {
    const appearance = appearanceFromSaved(saved);
    return { appearance, theme: resolveTheme(appearance.theme, systemPrefersDark()) };
  } catch (error) {
    console.error('The saved appearance could not be read, so the defaults are used.', error);
    return { appearance: DEFAULT_APPEARANCE, theme: resolveTheme(DEFAULT_APPEARANCE.theme, systemPrefersDark()) };
  }
};

/** A journal page: one with a date. */
const isJournal = (nb: Notebook) => nb.journalDate !== undefined;

/** The saved maps hold only the ids that are on, and none for pages that are gone, so they stay small. */
const without = (map: Record<string, boolean>, gone: Set<string>) => Object.fromEntries(Object.entries(map).filter(([id]) => !gone.has(id)));
const flag = (map: Record<string, boolean>, id: string, on: boolean) => (on ? { ...map, [id]: true } : without(map, new Set([id])));

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const editNotebook = (id: string, fn: (nb: Notebook) => Notebook) =>
        set((s) => ({ notebooks: s.notebooks.map((nb) => (nb.id === id ? { ...fn(nb), updatedAt: Date.now() } : nb)) }));

      /**
       * Takes pages away. If the open page went with them, the app moves on from `deletedId`, the page the
       * delete started at: its parent, then a sibling, then the first page there is. A whole space has no
       * such page, so null starts from the open page, whose parent and siblings went too.
       */
      const removePages = (s: State, deletedId: string | null, removed: string[], next: Notebook[], spaces: Space[]): Partial<State> => {
        const gone = new Set(removed);
        const activeGone = s.activeId !== null && gone.has(s.activeId);
        return {
          notebooks: next,
          activeId: activeGone ? nextActiveAfterDelete(s.notebooks, spaces, deletedId ?? s.activeId!, next) : s.activeId,
          flashBlockId: activeGone ? null : s.flashBlockId,
          focusTitleId: s.focusTitleId !== null && gone.has(s.focusTitleId) ? null : s.focusTitleId,
          expanded: without(s.expanded, gone),
          panelCollapsed: without(s.panelCollapsed, gone),
        };
      };

      return {
        workspace: null,
        diskRevision: {},
        notebooks: [],
        markdown: [],
        spaces: [],
        journalSpaceId: null,
        expanded: {},
        panelCollapsed: {},
        spaceCollapsed: {},
        activeId: null,
        view: 'notebook',
        theme: resolveTheme(DEFAULT_APPEARANCE.theme, systemPrefersDark()),
        appearance: DEFAULT_APPEARANCE,
        flashBlockId: null,
        focusTitleId: null,

        loadWorkspace: (root, name, loaded) =>
          set({
            workspace: { root, name },
            diskRevision: {},
            notebooks: loaded.notebooks,
            markdown: loaded.markdown,
            spaces: loaded.spaces,
            journalSpaceId: loaded.journalSpaceId,
            expanded: loaded.expanded,
            panelCollapsed: loaded.panelCollapsed,
            spaceCollapsed: loaded.spaceCollapsed,
            activeId: loaded.activeId,
            view: 'notebook',
            flashBlockId: null,
            focusTitleId: null,
          }),

        applyDiskDelta: (delta) =>
          set((s) => {
            const { upserts, removed } = deltaToNotebooks(delta, s.notebooks);
            const replacing = new Map(upserts.map((nb) => [nb.id, nb]));
            const gone = new Set(removed);
            const kept = s.notebooks.filter((nb) => !gone.has(nb.id)).map((nb) => replacing.get(nb.id) ?? nb);
            const known = new Set(kept.map((nb) => nb.id));
            const next = resolveLinks([...kept, ...upserts.filter((nb) => !known.has(nb.id))], delta.spaces);
            const diskRevision = { ...s.diskRevision };
            for (const nb of upserts) diskRevision[nb.id] = (diskRevision[nb.id] ?? 0) + 1;

            const changed = new Map((delta.markdown ?? []).map((r) => [r.path, markdownFromRecord(r)]));
            const goneMarkdown = new Set((delta.removedMarkdown ?? []).map(markdownId));
            const markdown = [
              ...s.markdown.filter((m) => !goneMarkdown.has(m.id)).map((m) => changed.get(m.path) ?? m),
              ...[...changed.values()].filter((m) => !s.markdown.some((had) => had.id === m.id)),
            ];

            let activeId = s.activeId;
            // A Markdown file that was open and went: its page shows, or the first page there is.
            if (activeId !== null && goneMarkdown.has(activeId)) {
              const was = s.markdown.find((m) => m.id === activeId);
              activeId = (was?.parentId && next.some((nb) => nb.id === was.parentId) ? was.parentId : null) ?? nextActiveAfterDelete(s.notebooks, delta.spaces, activeId, next);
            }
            if (activeId !== null && gone.has(activeId)) {
              // A file fixed or renamed outside comes back as a new page at the same path: it stays open.
              const was = s.notebooks.find((nb) => nb.id === activeId);
              const same = was?.path ? upserts.find((nb) => nb.path === was.path) : undefined;
              activeId = same?.id ?? nextActiveAfterDelete(s.notebooks, delta.spaces, activeId, next);
            }
            return {
              notebooks: next,
              markdown,
              spaces: delta.spaces,
              journalSpaceId: delta.journalSpaceId,
              diskRevision,
              activeId,
              expanded: without(s.expanded, gone),
              panelCollapsed: without(s.panelCollapsed, gone),
              flashBlockId: activeId === s.activeId ? s.flashBlockId : null,
            };
          }),

        closeWorkspace: () =>
          set({ workspace: null, diskRevision: {}, notebooks: [], markdown: [], spaces: [], journalSpaceId: null, expanded: {}, panelCollapsed: {}, spaceCollapsed: {}, activeId: null, view: 'notebook', flashBlockId: null, focusTitleId: null }),

        // Data for deleted blocks is dropped here rather than on delete, so undoing a delete still finds it.
        // The page already showing is left alone: its editor may hold an undo, or a block not saved yet.
        openNotebook: (id, blockId) =>
          set((s) => {
            const showing = s.view === 'notebook' && s.activeId === id;
            const notebooks = showing ? s.notebooks : s.notebooks.map((nb) => (nb.id === id ? pruneItems(nb) : nb));
            const focusTitleId = s.focusTitleId === id ? s.focusTitleId : null;
            return { notebooks, activeId: id, view: 'notebook', flashBlockId: blockId ?? null, focusTitleId };
          }),
        openReview: () => set({ view: 'review' }),

        createPage: (spaceId, parentId, title = '', open = true) => {
          const { notebooks, spaces } = get();
          // A page always lands somewhere the sidebar shows: under its parent, in that parent's space.
          const parent = parentId === null ? undefined : notebooks.find((nb) => nb.id === parentId);
          const space = parent?.spaceId ?? (spaces.some((sp) => sp.id === spaceId) ? spaceId : (spaces[0]?.id ?? spaceId));
          const siblings = childrenOf(notebooks, space, parent?.id ?? null);
          const now = Date.now();
          const nb: Notebook = {
            id: uid(),
            title,
            spaceId: space,
            parentId: parent?.id ?? null,
            position: positionBetween(siblings.at(-1)?.position, undefined),
            createdAt: now,
            updatedAt: now,
            blocks: [paragraph()],
            items: {},
          };
          set((s) => ({
            notebooks: [nb, ...s.notebooks],
            expanded: parent ? flag(s.expanded, parent.id, true) : s.expanded,
            ...(open ? { activeId: nb.id, view: 'notebook' as const, flashBlockId: null, focusTitleId: nb.id } : {}),
          }));
          return nb.id;
        },

        movePage: (id, to) => {
          const { notebooks, spaces } = get();
          if (!Number.isInteger(to.index) || !spaces.some((sp) => sp.id === to.spaceId)) return false;
          const parent = to.parentId === null ? null : notebooks.find((nb) => nb.id === to.parentId);
          if (parent === undefined || (parent && parent.spaceId !== to.spaceId)) return false;
          // Refuses a page into itself or its own sub-page.
          const next = moveInTree(notebooks, id, to);
          if (!next) return false;
          set((s) => ({ notebooks: next, expanded: parent ? flag(s.expanded, parent.id, true) : s.expanded }));
          return true;
        },

        deletePage: (id) =>
          set((s) => {
            const { notebooks, removed } = deletePageTree(s.notebooks, id);
            return removed.length === 0 ? {} : removePages(s, id, removed, notebooks, s.spaces);
          }),

        createSpace: (name = 'New space') => {
          const space: Space = { id: uid(), name };
          set((s) => ({ spaces: [...s.spaces, space] }));
          return space.id;
        },

        renameSpace: (id, name) => set((s) => ({ spaces: s.spaces.map((sp) => (sp.id === id ? { ...sp, name } : sp)) })),

        moveSpace: (id, toIndex) =>
          set((s) => {
            const space = s.spaces.find((sp) => sp.id === id);
            if (!space || !Number.isFinite(toIndex)) return {};
            const rest = s.spaces.filter((sp) => sp.id !== id);
            const at = Math.max(0, Math.min(Math.trunc(toIndex), rest.length));
            return { spaces: [...rest.slice(0, at), space, ...rest.slice(at)] };
          }),

        deleteSpace: (id) =>
          set((s) => {
            if (s.spaces.length <= 1 || !s.spaces.some((sp) => sp.id === id)) return {};
            const spaces = s.spaces.filter((sp) => sp.id !== id);
            const removed = s.notebooks.filter((nb) => nb.spaceId === id).map((nb) => nb.id);
            const notebooks = s.notebooks.filter((nb) => nb.spaceId !== id);
            return {
              ...removePages(s, null, removed, notebooks, spaces),
              spaces,
              spaceCollapsed: without(s.spaceCollapsed, new Set([id])),
              journalSpaceId: s.journalSpaceId === id ? null : s.journalSpaceId,
            };
          }),

        toggleExpanded: (id) => set((s) => ({ expanded: flag(s.expanded, id, !s.expanded[id]) })),

        toggleSpace: (id) => set((s) => ({ spaceCollapsed: flag(s.spaceCollapsed, id, !s.spaceCollapsed[id]) })),

        setPanelCollapsed: (id, collapsed) => set((s) => ({ panelCollapsed: flag(s.panelCollapsed, id, collapsed) })),

        clearFocusTitle: () => set({ focusTitleId: null }),

        // Today's page is found wherever it has been moved: by its date, or by the title journals had before dates.
        openTodayJournal: () => {
          const date = todayDate();
          const legacyTitle = `Journal: ${todayLabel()}`;
          const { notebooks } = get();
          const existing = notebooks.find((nb) => nb.journalDate === date) ?? notebooks.find((nb) => nb.title === legacyTitle);
          if (existing) return get().openNotebook(existing.id);

          // The journal space may have been deleted: a new one goes at the top.
          const { spaces, journalSpaceId } = get();
          const space = spaces.find((sp) => sp.id === journalSpaceId) ?? { id: uid(), name: 'Journal' };
          const latest = notebooks.filter(isJournal).reduce<Notebook | undefined>((a, b) => (a && a.createdAt >= b.createdAt ? a : b), undefined);
          const lastChart = latest && itemSequence(latest).find((i): i is ChartCell => i.type === 'chart');
          const now = Date.now();
          const nb: Notebook = {
            id: uid(),
            title: todayLabel(),
            journalDate: date,
            spaceId: space.id,
            parentId: null,
            position: positionBetween(undefined, childrenOf(notebooks, space.id, null)[0]?.position),
            createdAt: now,
            updatedAt: now,
            ...journalPage(newChart({ symbol: lastChart?.symbol ?? 'BTCUSDT', interval: lastChart?.interval ?? '4h' })),
          };
          set((s) => ({
            notebooks: [nb, ...s.notebooks],
            spaces: s.spaces.includes(space) ? s.spaces : [space, ...s.spaces],
            journalSpaceId: space.id,
            activeId: nb.id,
            view: 'notebook',
            flashBlockId: null,
            focusTitleId: null,
          }));
        },

        updateNotebook: (id, patch) => editNotebook(id, (nb) => ({ ...nb, ...patch })),

        setMarkdownText: (id, text) => set((s) => ({ markdown: s.markdown.map((m) => (m.id === id ? { ...m, text } : m)) })),

        setBlocks: (notebookId, blocks) => editNotebook(notebookId, (nb) => ({ ...nb, blocks })),

        addItem: (notebookId, item) => editNotebook(notebookId, (nb) => ({ ...nb, items: { ...nb.items, [item.id]: item } })),

        updateItem: (notebookId, itemId, patch) =>
          editNotebook(notebookId, (nb) => {
            const item = nb.items[itemId];
            return item ? { ...nb, items: { ...nb.items, [itemId]: { ...item, ...patch } as ItemData } } : nb;
          }),

        // The page takes the new look before the state changes, so charts read the new colours when they redraw.
        setAppearance: (patch) => {
          const appearance = { ...get().appearance, ...patch };
          const theme = resolveTheme(appearance.theme, systemPrefersDark());
          applyAppearance(appearance);
          applyTheme(theme);
          set({ appearance, theme });
        },

        resetAppearance: () => get().setAppearance(DEFAULT_APPEARANCE),

        clearFlash: () => set({ flashBlockId: null }),
      };
    },
    {
      name: APPEARANCE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s): Saved => ({ appearance: s.appearance }),
      // The appearance is checked choice by choice, and the theme is resolved afresh, since the computer may have switched.
      merge: (persisted, current) => {
        const saved = persisted as Partial<Saved> | undefined;
        return saved ? { ...current, ...loadedAppearance(saved) } : current;
      },
    },
  ),
);

/**
 * While the theme choice is System, switches the theme when the computer switches between light and dark.
 * Every open tab hears the switch. A hidden one only recolours the page: changing the store would save it,
 * and a tab left in the background could write its old notebooks over newer edits. It catches up when seen.
 * Returns a function that stops following.
 */
export function followSystemTheme(): () => void {
  const query = darkQuery();
  if (!query) return () => {};
  const follow = () => {
    if (useStore.getState().appearance.theme !== 'system') return;
    const theme = resolveTheme('system', query.matches);
    applyTheme(theme);
    if (!document.hidden && useStore.getState().theme !== theme) useStore.setState({ theme });
  };
  const onVisible = () => !document.hidden && follow();
  query.addEventListener('change', follow);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    query.removeEventListener('change', follow);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
