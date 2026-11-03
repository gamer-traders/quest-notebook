import { create } from 'zustand';
import type { Chat, ChatAction, ChatMessage, ChatReference, ChatSummary, ClaudeEvent, ClaudeStatus, ImageData, QuestApi } from '@shared/ipc';
import { useStore } from '../store';
import type { Notebook } from '../types';
import { ancestorsOf, displayTitle } from '../page/tree';
import { changedTitles, conflictQuestion } from './panel';
import { base64Bytes, cacheImage, cachedImage, checkImages, dataUrlOf } from './images';

type Api = QuestApi['claude'];

export interface PanelSettings {
  open: boolean;
  width: number;
}

export const DEFAULT_PANEL: PanelSettings = { open: false, width: 400 };
export const MIN_WIDTH = 320;
export const MAX_WIDTH = 720;

const KEY = 'quest-notebook-claude-panel';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const clampWidth = (w: number): number => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));

export function readPanel(storage: Pick<Storage, 'getItem'> | null): PanelSettings {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? 'null') as Partial<Record<keyof PanelSettings, unknown>> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_PANEL;
    return {
      open: raw.open === true,
      width: typeof raw.width === 'number' && Number.isFinite(raw.width) ? clampWidth(raw.width) : DEFAULT_PANEL.width,
    };
  } catch {
    return DEFAULT_PANEL;
  }
}

export function writePanel(storage: Store | null, panel: PanelSettings): void {
  try {
    storage?.setItem(KEY, JSON.stringify(panel));
  } catch {
    // Not remembered this time; the panel still works.
  }
}

const browserStorage = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export interface Running {
  chatId: string;
  messageId: string;
  lockedPageId: string | null;
}

interface Streaming {
  /** Pieces of the reply so far, joined only when shown. */
  text: string[];
  actions: ChatAction[];
}

interface ClaudeState extends PanelSettings {
  status: ClaudeStatus | null;
  chats: ChatSummary[];
  /** Null is a new, empty chat. */
  chat: Chat | null;
  running: Running | null;
  /** True while `send` waits for main's reply. */
  sending: boolean;
  streaming: Streaming;
  /** Page ids by assistant message id: pages that were open and read-only when Claude changed them. */
  notApplied: Record<string, string[]>;
  attachments: ChatReference[];
  /** Images pasted or dropped, for the next message. */
  images: ImageData[];
  /** A sent message's images as data URLs, by its local id, shown until the chat is read back with the saved ones. */
  localImages: Record<string, string[]>;
  /** The "This page" chip was removed for the next message. */
  skipOpenPage: boolean;
  error: string | null;

  toggle: () => void;
  setOpen: (open: boolean) => void;
  setWidth: (px: number) => void;
  refresh: () => Promise<void>;
  reset: () => void;
  openChat: (id: string | null) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  attach: (ref: ChatReference) => void;
  detach: (index: number) => void;
  /** Adds what can go of these images, and says what can't in `error`. */
  addImages: (list: ImageData[]) => void;
  removeImage: (index: number) => void;
  setSkipOpenPage: (skip: boolean) => void;
  send: (message: string, openPageId: string | null) => Promise<void>;
  stop: () => void;
  onEvent: (e: ClaudeEvent) => void;
  undo: (messageId: string, paths: string[] | null) => Promise<void>;
  markNotApplied: (pageId: string) => void;
}

let api: Api | null = null;
/** Saves everything before a turn. The app passes the workspace's own at boot; this module doesn't import it. */
let flush: () => Promise<void> = async () => {};
let confirmAsk: (text: string) => boolean = (text) => window.confirm(text);
/** Events that came while `send` was still waiting for main to say which message they belong to. */
let queued: ClaudeEvent[] = [];
/** Counts resets, one for each workspace loaded: an answer about the workspace open before one is dropped. */
let resets = 0;
/** Counts the owner's choices of chat: only the latest one is shown. */
let choices = 0;

const emptyStreaming = (): Streaming => ({ text: [], actions: [] });

/** Connects the store to main. `bootWorkspace` calls it with `window.quest.claude` and `flushWorkspace`; tests give fakes. */
export function bindClaude(claude: Api, deps: { flush?: () => Promise<void>; confirm?: (text: string) => boolean } = {}): void {
  api = claude;
  flush = deps.flush ?? (async () => {});
  confirmAsk = deps.confirm ?? ((text) => window.confirm(text));
  queued = [];
  claude.onEvent((e) => useClaude.getState().onEvent(e));
}

const persist = (s: ClaudeState) => writePanel(browserStorage(), { open: s.open, width: s.width });

export const useClaude = create<ClaudeState>((set, get) => {
  const rereadChat = async (chatId: string): Promise<Chat | null> => (await api!.readChat(chatId)) ?? null;

  /** Reads the chat list again, unless another workspace is open by the time it comes. */
  const relist = async (): Promise<void> => {
    const at = resets;
    const chats = await api!.listChats();
    if (at === resets) set({ chats });
  };

  const pageTitle = (id: string): string | null => {
    const page = useStore.getState().notebooks.find((n) => n.id === id);
    return page ? displayTitle(page.title) : null;
  };

  return {
    ...readPanel(browserStorage()),
    status: null,
    chats: [],
    chat: null,
    running: null,
    sending: false,
    streaming: emptyStreaming(),
    notApplied: {},
    attachments: [],
    images: [],
    localImages: {},
    skipOpenPage: false,
    error: null,

    toggle: () => get().setOpen(!get().open),
    setOpen: (open) => {
      set({ open });
      persist(get());
    },
    setWidth: (px) => {
      set({ width: clampWidth(px) });
      persist(get());
    },

    refresh: async () => {
      if (!api) return;
      const at = resets;
      const [status, chats] = await Promise.all([api.status(), api.listChats()]);
      // Another workspace opened meanwhile: these were about the last one, whose service may be closed by now.
      if (at !== resets) return get().refresh();
      set({ status, chats });
    },

    // On every workspace load, panel open or not. Looking for the CLI waits until the panel opens.
    reset: () => {
      resets++;
      queued = [];
      set({ chat: null, chats: [], running: null, sending: false, streaming: emptyStreaming(), attachments: [], images: [], localImages: {}, skipOpenPage: false, notApplied: {}, error: null });
      if (api) relist().catch(() => {});
    },

    openChat: async (id) => {
      // While a message is on its way, or Claude answers in another chat, the chat on screen stays.
      if (!api || get().sending) return;
      if (id === null) {
        if (get().running) return;
        choices++;
        set({ chat: null, error: null });
        return;
      }
      if (get().running && get().running!.chatId !== id) return;
      const choice = ++choices;
      const at = resets;
      const from = get().chat?.id ?? null;
      const chat = await api.readChat(id);
      // Shown only if nothing else changed the chat on screen while it was read.
      const now = get();
      if (!chat || choice !== choices || at !== resets || now.sending || (now.running && now.running.chatId !== id) || (now.chat?.id ?? null) !== from) return;
      // A chat read from disk has its images saved: the copies of ones just sent aren't needed.
      set({ chat, error: null, localImages: {} });
    },

    deleteChat: async (id) => {
      if (!api) return;
      await api.deleteChat(id);
      if (get().chat?.id === id) set({ chat: null });
      await relist();
    },

    attach: (ref) => {
      set((s) => {
        const dup = ref.kind === 'page' && s.attachments.some((a) => a.kind === 'page' && a.pageId === ref.pageId);
        return { open: true, attachments: dup ? s.attachments : [...s.attachments, ref] };
      });
      persist(get());
    },
    detach: (index) => set((s) => ({ attachments: s.attachments.filter((_, i) => i !== index) })),
    addImages: (list) => {
      const { accepted, error } = checkImages(
        get().images.length,
        list.map((image) => ({ image, type: image.type as string, size: base64Bytes(image.data) })),
      );
      set((s) => ({ images: [...s.images, ...accepted.map((a) => a.image)], ...(error ? { error } : {}) }));
    },
    removeImage: (index) => set((s) => ({ images: s.images.filter((_, i) => i !== index) })),
    setSkipOpenPage: (skipOpenPage) => set({ skipOpenPage }),

    send: async (message, openPageId) => {
      // Images can go without words.
      if (!api || get().running || get().sending || (!message.trim() && get().images.length === 0)) return;
      const at = resets;
      set({ sending: true });
      queued = [];
      try {
        await flush();
        // Another workspace opened meanwhile: the reset let go of this message, and the new workspace has its own chats.
        if (at !== resets) return;
        const { chat, attachments, images, skipOpenPage } = get();
        const result = await api.send({
          chatId: chat?.id ?? null,
          message,
          references: attachments,
          openPageId: skipOpenPage ? null : openPageId,
          ...(images.length ? { images } : {}),
        });
        if (at !== resets) return;
        if ('error' in result) {
          queued = [];
          set({ error: result.error, sending: false });
          void get().refresh();
          return;
        }
        const now = new Date().toISOString();
        const user: ChatMessage = { id: `local-${now}`, role: 'user', text: message, created: now, ...(attachments.length ? { references: attachments } : {}) };
        // Images can be pasted while the message is on its way: only those sent are cleared.
        const left = get().images.filter((i) => !images.includes(i));
        const base: Chat = chat ?? { id: result.chatId, title: message.slice(0, 60), sessionId: null, created: now, updated: now, messages: [] };
        set({
          running: { chatId: result.chatId, messageId: result.messageId, lockedPageId: openPageId },
          sending: false,
          chat: { ...base, id: result.chatId, messages: [...base.messages, user] },
          attachments: [],
          images: left,
          localImages: images.length ? { ...get().localImages, [user.id]: images.map(dataUrlOf) } : get().localImages,
          skipOpenPage: false,
          error: null,
          streaming: emptyStreaming(),
        });
        const early = queued;
        queued = [];
        for (const e of early) get().onEvent(e);
      } catch (err) {
        if (at !== resets) return;
        queued = [];
        set({ error: err instanceof Error ? err.message : String(err), sending: false });
      }
    },

    stop: () => {
      void api?.stop();
    },

    onEvent: (e) => {
      const { running, sending } = get();
      if (!running) {
        if (sending) queued.push(e);
        return;
      }
      if (e.messageId !== running.messageId) return;
      if (e.kind === 'text') {
        const { streaming } = get();
        streaming.text.push(e.text);
        set({ streaming: { text: streaming.text, actions: streaming.actions } });
      } else if (e.kind === 'action') {
        const { streaming } = get();
        const id = e.action.id;
        const at = id === undefined ? -1 : streaming.actions.findIndex((a) => a.id === id);
        const actions = at < 0 ? [...streaming.actions, e.action] : streaming.actions.map((a, i) => (i === at ? e.action : a));
        set({ streaming: { text: streaming.text, actions } });
      } else {
        // The reply shows at once, so it doesn't blink out while the saved chat is read back.
        const cur = get().chat;
        const asked = cur?.id === e.chatId && Array.isArray(cur.messages) ? cur.messages.filter((m) => m?.role === 'user').at(-1) : undefined;
        set({
          running: null,
          streaming: emptyStreaming(),
          ...(cur && cur.id === e.chatId ? { chat: { ...cur, messages: [...cur.messages, e.message] } } : {}),
        });
        void (async () => {
          let chat: Chat | null = null;
          try {
            chat = await rereadChat(e.chatId);
          } catch {
            chat = null;
          }
          if (chat && get().chat?.id === e.chatId) {
            if (asked) knowSavedImages(chat, e.message.id, get().localImages[asked.id]);
            set({ chat, localImages: {} });
          }
          try {
            await relist();
          } catch {
            // The list is stale until the next refresh.
          }
          if (e.message.error) void get().refresh();
        })();
      }
    },

    undo: async (messageId, paths) => {
      const chat = get().chat;
      if (!api || !chat) return;
      // Words typed just before reach the disk first. The undo then sees them as a change since Claude's reply and asks,
      // instead of the save landing over the restored file.
      await flush();
      const first = await api.undo(chat.id, messageId, paths, false);
      if (first.conflicts.length) {
        const message = chat.messages.find((m) => m.id === messageId);
        if (confirmAsk(conflictQuestion(changedTitles(message, first.conflicts, pageTitle)))) await api.undo(chat.id, messageId, first.conflicts, true);
      }
      const fresh = await api.readChat(chat.id);
      // The owner may have gone to another chat meanwhile: it stays.
      if (fresh && get().chat?.id === chat.id) set({ chat: fresh });
    },

    markNotApplied: (pageId) => {
      const { running } = get();
      if (!running) return;
      set((s) => {
        const have = s.notApplied[running.messageId] ?? [];
        return have.includes(pageId) ? s : { notApplied: { ...s.notApplied, [running.messageId]: [...have, pageId] } };
      });
    },
  };
});

/**
 * The images of the message a reply answered, as saved, are the ones just sent: their data URLs are kept by file,
 * so the message shows them without asking main for them again.
 */
function knowSavedImages(chat: Chat, replyId: string, urls: string[] | undefined): void {
  if (!urls || !Array.isArray(chat.messages)) return;
  const at = chat.messages.findIndex((m) => m?.id === replyId);
  const asked = at > 0 ? chat.messages[at - 1] : undefined;
  const saved = asked?.role === 'user' && Array.isArray(asked.images) ? asked.images : [];
  if (saved.length !== urls.length) return;
  saved.forEach((image, i) => {
    if (typeof image?.file === 'string') cacheImage(`${chat.id}/${image.file}`, urls[i]);
  });
}

/** A saved image as a data URL, or null when it's gone. Loaded once, then kept. */
export async function loadSavedImage(chatId: string, file: string): Promise<string | null> {
  const key = `${chatId}/${file}`;
  const known = cachedImage(key);
  if (known !== undefined) return known;
  if (!api) return null;
  const image = await api.image(chatId, file);
  if (!image) return null;
  const url = dataUrlOf(image);
  cacheImage(key, url);
  return url;
}

/** True for the page a running turn started on: it stays read-only until the turn ends. */
export const isLocked = (state: Pick<ClaudeState, 'running'>, pageId: string | null | undefined): boolean =>
  !!pageId && state.running?.lockedPageId === pageId;

export const useLocked = (pageId: string | null | undefined): boolean => useClaude((s) => isLocked(s, pageId));

/** The locked page and the pages above it. Deleting any of them would trash the page Claude is working on. */
export function lockedBranch(state: Pick<ClaudeState, 'running'>, notebooks: Notebook[]): Set<string> {
  const id = state.running?.lockedPageId;
  return new Set(id ? [id, ...ancestorsOf(notebooks, id).map((a) => a.id)] : []);
}

/** The space the locked page is in, which goes with its pages when it's deleted. */
export const lockedSpace = (state: Pick<ClaudeState, 'running'>, notebooks: Notebook[]): string | null =>
  notebooks.find((n) => n.id === state.running?.lockedPageId)?.spaceId ?? null;

/** True for a page that can't be deleted until the turn ends: the locked page, or one above it. */
export const useHoldsLock = (pageId: string | null | undefined): boolean => {
  const running = useClaude((s) => s.running);
  return useStore((s) => !!pageId && lockedBranch({ running }, s.notebooks).has(pageId));
};
