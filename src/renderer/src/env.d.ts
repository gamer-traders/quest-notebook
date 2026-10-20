import type { QuestApi } from '@shared/ipc';

declare global {
  interface Window {
    /** The bridge to the main process, from src/preload. */
    quest: QuestApi;
  }
}
