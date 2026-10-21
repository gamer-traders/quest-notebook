import { create } from 'zustand';
import type { Chat, ChatAction, ChatMessage, ChatReference, ChatSummary, ClaudeEvent, ClaudeStatus, QuestApi } from '@shared/ipc';

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
      const [status, chats] = await Promise.all([api.status(), api.listChats()]);
      set({ status, chats });
    },

    reset: () => {
      queued = [];
      set({ chat: null, running: null, sending: false, streaming: emptyStreaming(), attachments: [], skipOpenPage: false, notApplied: {}, error: null });
      void get().refresh();
    },

    openChat: async (id) => {
      if (!api) return;
      if (id === null) {
        if (!get().running) set({ chat: null, error: null });
        return;
      }
      if (get().running && get().running!.chatId !== id) return;
      const chat = await api.readChat(id);
      if (chat) set({ chat, error: null });
    },

    deleteChat: async (id) => {
      if (!api) return;
      await api.deleteChat(id);
      if (get().chat?.id === id) set({ chat: null });
      set({ chats: await api.listChats() });
    },

    attach: (ref) => {
      set((s) => {
        const dup = ref.kind === 'page' && s.attachments.some((a) => a.kind === 'page' && a.pageId === ref.pageId);
        return { open: true, attachments: dup ? s.attachments : [...s.attachments, ref] };
      });
      persist(get());
    },
    detach: (index) => set((s) => ({ attachments: s.attachments.filter((_, i) => i !== index) })),
    setSkipOpenPage: (skipOpenPage) => set({ skipOpenPage }),

    send: async (message, openPageId) => {
      if (!api || get().running || get().sending || !message.trim()) return;
      set({ sending: true });
      queued = [];
      try {
        await flush();
        const { chat, attachments, skipOpenPage } = get();
        const result = await api.send({ chatId: chat?.id ?? null, message, references: attachments, openPageId: skipOpenPage ? null : openPageId });
        if ('error' in result) {
          queued = [];
          set({ error: result.error, sending: false });
          void get().refresh();
          return;
        }
        const now = new Date().toISOString();
        const user: ChatMessage = { id: `local-${now}`, role: 'user', text: message, created: now, ...(attachments.length ? { references: attachments } : {}) };
        const base: Chat = chat ?? { id: result.chatId, title: message.slice(0, 60), sessionId: null, created: now, updated: now, messages: [] };
        set({
          running: { chatId: result.chatId, messageId: result.messageId, lockedPageId: openPageId },
          sending: false,
          chat: { ...base, id: result.chatId, messages: [...base.messages, user] },
          attachments: [],
          skipOpenPage: false,
          error: null,
          streaming: emptyStreaming(),
        });
        const early = queued;
        queued = [];
        for (const e of early) get().onEvent(e);
      } catch (err) {
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
          if (chat && get().chat?.id === e.chatId) set({ chat });
          try {
            set({ chats: await api!.listChats() });
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
      const first = await api.undo(chat.id, messageId, paths, false);
      if (first.conflicts.length && confirmAsk("These pages changed since Claude's reply. Undo anyway?")) {
        await api.undo(chat.id, messageId, first.conflicts, true);
      }
      const fresh = await api.readChat(chat.id);
      if (fresh) set({ chat: fresh });
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
