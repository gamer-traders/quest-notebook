# Claude Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude chat in a side panel of Quest Notebook. It runs the owner's installed `claude` CLI headless on their subscription. It can read the workspace and edit or create pages and drawings, with page references, live updates, undo per reply, saved chats and quick actions.

**Architecture:**
- **Main process:** spawns `claude -p … --output-format stream-json` per turn, inside the workspace folder, and parses its event stream.
- **Recording changes:** outside changes the session already detects during a turn are recorded as Claude's file changes, with their "before" text for undo.
- **Chats** are kept in `.quest/chats/*.json`.
- **Renderer:** a panel (chat list, messages, composer with `@` references) that talks to main through `window.quest.claude`. It locks the open page during a turn.

**Tech Stack:** Electron 44 main-process `child_process.spawn`, Claude Code CLI 2.1.288 on the owner's Mac, React 19 and zustand, `react-markdown` 10 (MIT), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-claude-panel-design.md`

## Global Constraints

- **Invocation:** `claude -p <prompt> --output-format stream-json --verbose --include-partial-messages [--resume <session-id>] --restricted --tools Read,Glob,Grep,Edit,Write …`, plus the permission flags Task 1 settles. The working directory is the workspace root.
- **Environment:** remove `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the child's environment. Never pass `--bare`.
- **What Claude may write:** only page `.json` files and `drawing-*.svg` files inside a space folder. Never `.quest/**`, files at the top of the workspace, or new top-level folders. It gets no shell, web or MCP.
- **Stopping:** SIGINT, then SIGTERM if the process is still running after 3 s.
- **One turn at a time** per workspace. Switching workspace or closing the window stops a running turn.
- **Before a turn:** the renderer saves everything first (`flushWorkspace`), so Claude reads the current page.
- **During a turn:** the page that was open when it started is read-only, with the bar "Claude is working on this page… Stop".
- **Undo** restores each file to its text just before Claude's first write to it in that turn. A file Claude created goes to the Trash. If the disk text no longer equals the text after the turn, undo asks first.
- **Panel:**
  - Cmd+J and a header button toggle it.
  - Its open state and width are remembered in localStorage under `quest-notebook-claude-panel`.
  - Below 1000 px of window width it overlays the page.
- **Quick actions:** exactly "Summarize this page", "Tidy this page", "Make a checklist from this page", "Turn this week's journal into a lesson page".
- **Real CLI runs** (Task 1 and Task 10) use the owner's subscription. Keep them few and short. Automated tests use a fake `claude` script, never the real one.
- **Tests:** `npm test` and `npm run typecheck` stay green, and pure logic is written test-first.
- **The owner's dev app:** don't run `npm run build` while it's open (memory "dev-app-protocol-mismatch"). Stop it before Task 6, and restart it at the end.

## Review Focus

1. **Claude writes invalid JSON to a page.** The page shows as unreadable, the reply lists it as edited, and Undo restores the exact old text. Test in Task 4.
2. **The workspace is switched, or the window closed, mid-turn.** The child process is stopped, and nothing is written into the next workspace. Test in Task 6.
3. **`claude` isn't on the PATH an app launched from Finder sees, or isn't logged in.** The panel shows the matching setup state instead of an error. Tests in Tasks 2 and 3.
4. **A corrupt or hand-edited chat file in `.quest/chats/`.** The chat list skips it, and the rest load. Test in Task 5.
5. **A very long streamed reply** (thousands of text deltas). Appending stays linear, and typing elsewhere doesn't stutter. Test in Task 7.

---

### Task 1: Experiment: the real CLI on this Mac

**Files:**
- Create:
  - `docs/superpowers/notes/2026-10-21-claude-cli-findings.md`
  - `src/main/claude/__fixtures__/read-and-edit.jsonl`
  - `src/main/claude/__fixtures__/denied.jsonl`
  - `src/main/claude/__fixtures__/resume.jsonl`
  - `src/main/claude/permissions.json`: the settings file with the permission rules that work

- [ ] **Step 1: Set up.** Make a scratch workspace: a copy of a sample workspace (README, `Markets/A.json`, `.quest/workspace.json`) under the scratchpad. All runs use it as the working directory, with `ANTHROPIC_API_KEY` unset.
- [ ] **Step 2: Record a read-and-edit turn.** Run `claude -p "Read Markets/A.json and add a paragraph saying hello" --output-format stream-json --verbose --include-partial-messages --restricted --tools Read,Glob,Grep,Edit,Write <candidate permission flags>` and save stdout to `read-and-edit.jsonl`. Record in the findings:
  - the init event's fields: `session_id`, `apiKeySource` or whatever shows the subscription is in use, `permissionMode`, `tools`
  - the shapes of text deltas
  - the shapes of assistant `tool_use` blocks: name, and the `input.file_path` form (absolute or relative)
  - the shapes of tool results, including denials
  - the result event: `subtype`, `is_error`, `result`, `session_id`, usage
- [ ] **Step 3: Permissions.** Find the flags or `--settings` rules under which:
  - editing `Markets/A.json` and creating `Markets/A/drawing-x.svg` succeed
  - editing `README.md`, `.quest/workspace.json`, a new `New.txt` at the root and `../outside.json` are all refused
  - Bash isn't available

  Candidates:
  - (a) `--permission-mode default` with `--allowedTools "Edit(/*/**/*.json)" "Edit(/*/**/drawing-*.svg)"` and deny rules for `Edit(/.quest/**)`
  - (b) `acceptEdits` with deny rules

  Save the denial run as `denied.jsonl` and the working rules as `permissions.json`, a settings JSON passed with `--settings`. Record which rule syntax worked.
- [ ] **Step 4: Resume and stop.**
  - Run a second turn with `--resume <session_id>` asking "what did I ask before?" and save it as `resume.jsonl`. Confirm it remembers.
  - Send SIGINT mid-turn and record the exit code and the last events.
- [ ] **Step 5: Logged-out output.** Record what a missing or invalid login looks like, for the setup state. If it can't be produced safely, note that and use `claude auth status` or `claude doctor` output, whichever exists in 2.1.288.
- [ ] **Step 6: Commit:** `docs: what the claude CLI does here, recorded for the panel`

### Task 2: Main: finding the CLI and building the command

**Files:**
- Create: `src/main/claude/locate.ts` and `locate.test.ts`
- Create: `src/main/claude/command.ts` and `command.test.ts`
- Create: `src/main/claude/guide.ts` (the workspace guide text)

**Interfaces:**
- Produces:
  - `locateClaude(opts: { configured?: string; shellLookup: () => Promise<string | null>; exists: (p: string) => Promise<boolean>; home: string }): Promise<string | null>`
    - Order: the configured path, then the login shell's `command -v claude`, then `~/.local/bin/claude`, `~/.claude/local/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`.
  - `loginShellLookup(shell = process.env.SHELL ?? '/bin/zsh'): Promise<string | null>`, which runs `<shell> -lc 'command -v claude'` with a 5 s timeout.
  - `claudeArgs(p: { prompt: string; sessionId: string | null; guide: string; settingsPath: string }): string[]`
  - `claudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv`, which drops `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`.
  - `WORKSPACE_GUIDE: string`, covering the spec's points:
    - this is a Quest Notebook workspace
    - read `README.md` for the format first
    - keep page JSON valid
    - give new pages new ids, or leave the id out
    - drawings follow the README's SVG rules
    - never touch `.quest/`
    - answer in plain language
    - mention pages by title
  - `buildPrompt(p: { message: string; openPage: { title: string; path: string } | null; references: { title: string; path: string }[]; selection: { title: string; text: string } | null }): string`, in this layout:

    ```
    <message>

    References:
    - The page open now: <title> (<path>)
    - <title> (<path>)

    Selected text from <title>:
    > <text, every line quoted>
    ```

    Sections with nothing in them are left out.

- [ ] **Step 1: Failing tests**
  - `locateClaude`:
    - prefers the configured path when it exists
    - falls back to the shell lookup
    - then the first candidate that exists
    - gives null when nothing is found
  - `claudeArgs` with a session id contains `--resume`, `<id>`, `--restricted` and `--settings`, and never `--bare`. Without a session id it has no `--resume`.
  - `claudeEnv({ PATH: 'x', ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't' })` equals `{ PATH: 'x' }`.
  - `buildPrompt`: the exact layout above for all parts, the message alone when nothing is attached, and a multi-line selection quoted line by line.
- [ ] **Step 2: Run them.** `npx vitest run src/main/claude`. Expected: FAIL.
- [ ] **Step 3: Implement.** `claudeArgs` uses the flags and settings file Task 1 settled. `permissions.json` is shipped and resolved next to the main bundle.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat: find the claude CLI and build its command`

### Task 3: Main: reading the event stream

**Files:**
- Create: `src/main/claude/events.ts` and `events.test.ts`
- Modify: `src/shared/ipc.ts`

**Interfaces:**
- Produces, in `@shared/ipc`:
  - `ChatAction { verb: 'read' | 'edited' | 'created' | 'searched' | 'other'; path?: string; detail?: string }`. The path is relative to the workspace.
  - `ClaudeStatus { state: 'ready' | 'missing' | 'logged-out' | 'error'; path?: string; version?: string; message?: string }`
- Produces, in `events.ts`:
  - `type StreamItem = { kind: 'session'; sessionId: string } | { kind: 'text'; text: string } | { kind: 'action'; action: ChatAction } | { kind: 'done'; ok: boolean; error?: string; loggedOut?: boolean }`
  - `parseStreamLine(line: string, root: string): StreamItem[]`
    - Each stdout line is one JSON object.
    - Partial-message text deltas become `text`.
    - `tool_use` becomes `action`: Read → read; Edit → edited; Write → created (Task 6 turns it into edited when the path is already a known page); Glob or Grep → searched, with the pattern as `detail`.
    - The result event becomes `done`.
    - Unknown lines and malformed JSON give `[]`.
  - `LineSplitter`, which turns chunks into whole lines; partial lines are carried over.

- [ ] **Step 1: Failing tests,** driven by Task 1's fixtures:
  - `read-and-edit.jsonl` gives, in order: one session, text pieces whose concatenation equals the result text, a read action for `Markets/A.json`, an edited action for `Markets/A.json`, and done with ok true.
  - `denied.jsonl` gives an action for each attempted edit, plus done. The denial text ends up in the stream text, or the action carries `detail: 'refused'`, whichever the fixture supports. Record the choice.
  - A logged-out line, from Task 1 step 5, gives done with `loggedOut: true`.
  - `LineSplitter` puts `'{"a":1}\n{"b"'` + `':2}\n'` back together as two lines.
  - Garbage gives `[]`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat: read claude's event stream`

### Task 4: Main: what a turn changed, and undo

**Files:**
- Modify: `src/main/workspace/watch.ts`, adding `fileChanges`
- Create: `src/main/claude/turns.ts` and `turns.test.ts`
- Create: `src/main/claude/undo.ts` and `undo.test.ts`
- Modify: `src/main/workspace/session.ts`, adding `onFileChanges` to `SessionEvents`
- Modify: `src/shared/ipc.ts`

**Interfaces:**
- Produces, in `@shared/ipc`:
  - `FileChange { path: string; pageId?: string; kind: 'edited' | 'created'; drawing: boolean; before: string | null; after: string | null }`
  - `UndoResult { undone: string[]; conflicts: string[] }`
- Produces, in `watch.ts`: `fileChanges(prev: Known, next: ScanResult): FileChange[]`
  - covers every page file and drawing file whose text differs between `prev.index` and `next.index`
  - `before` is null for a new file; a removed file isn't listed
  - unreadable page files are included, with their raw text
- Produces, in `session.ts`:
  - `SessionEvents.fileChanges?(changes: FileChange[]): void`, called from `rescan` with `fileChanges(this.known, next)` before `this.known` is replaced, only when the list isn't empty
  - `WorkspaceSession.pageIdForPath(path: string): string | undefined`
  - `WorkspaceSession.pageInfo(id: string): { path: string; title: string } | undefined`, where the title comes from the page file's `title`, or the file name when it has none
- Produces, in `turns.ts`:
  - `class TurnChanges`, with `add(changes: FileChange[]): void`, which keeps each path's first `before` and its latest `after`, and `list(): FileChange[]`, sorted by path
- Produces, in `undo.ts`:
  - `undoChanges(root: string, changes: FileChange[], opts: { force: boolean; trash(abs: string): Promise<void> }): Promise<UndoResult>`
  - a path whose current disk text isn't the change's `after` (or that's missing when `after` isn't null) is a conflict, unless `force`
  - `before === null` means the file goes to the Trash; otherwise `before` is written back atomically

- [ ] **Step 1: Failing tests**
  - `fileChanges`: on a temp workspace (as in `watch.test.ts`), an outside edit to `Markets/A.json` lists `{ path: 'Markets/A.json', kind: 'edited', before: old, after: new }`. A new `Markets/B.json` lists `created` with `before: null`. A new `Markets/A/drawing-d.svg` lists `drawing: true`. The app's own `applyFlush` write lists nothing.
  - `TurnChanges`: editing a path twice keeps the first `before` and the last `after`.
  - `undoChanges`:
    - restores bytes exactly, including invalid JSON (Review Focus 1)
    - trashes a created file
    - reports a conflict when the file changed after the turn, and leaves it alone
    - with `force`, overwrites anyway
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** `npx vitest run src/main`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat: record what a claude turn changed, and undo it`

### Task 5: Main: saved chats

**Files:**
- Create: `src/main/claude/chats.ts` and `chats.test.ts`
- Modify:
  - `src/main/workspace/watch.ts`: ignore `.quest/chats/`
  - `src/shared/ipc.ts`

**Interfaces:**
- Produces, in `@shared/ipc`:
  - `ChatReference = { kind: 'page'; pageId: string; title: string } | { kind: 'selection'; pageId: string; title: string; text: string }`
  - `ChatMessage { id: string; role: 'user' | 'assistant'; text: string; created: string; references?: ChatReference[]; actions?: ChatAction[]; changes?: FileChange[]; undone?: string[]; error?: string }`
  - `Chat { id: string; title: string; sessionId: string | null; created: string; updated: string; messages: ChatMessage[] }`
  - `ChatSummary { id: string; title: string; updated: string }`
- Produces, in `chats.ts`:
  - `listChats(root): Promise<ChatSummary[]>`, newest first; unreadable files are skipped
  - `readChat(root, id): Promise<Chat | null>`
  - `writeChat(root, chat): Promise<void>`, atomic, with `formatJson`
  - `deleteChat(root, id, trash): Promise<void>`
  - `chatTitle(text: string): string`, the first line cut to 60 characters with "…"
  - ids are 8-character random ids and the files are `.quest/chats/<id>.json`

- [ ] **Step 1: Failing tests:**
  - write, list and read round-trip
  - a corrupt file is skipped by `listChats` while the others load (Review Focus 4)
  - `chatTitle('Summarize this page please and then …')` is 60 characters ending in "…"
  - delete moves the file to the Trash
  - a write in `.quest/chats/` doesn't trigger the watcher callback; extend the watcher test
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat: keep claude chats in the workspace`

### Task 6: Main: running a turn, IPC and preload

**Files:**
- Create:
  - `src/main/claude/service.ts` and `service.test.ts`
  - `src/main/claude/__fixtures__/fake-claude.mjs`, a stand-in CLI for tests
- Modify:
  - `src/main/workspaces.ts`: owns a `ClaudeService` per session, wires `fileChanges`, and stops the turn on switch or close
  - `src/main/ipc.ts`
  - `src/main/index.ts`
  - `src/preload/index.ts`
  - `src/shared/ipc.ts`

**Interfaces:**
- Produces, in `@shared/ipc`:
  - `SendRequest { chatId: string | null; message: string; references: ChatReference[]; openPageId: string | null }`
  - `ClaudeEvent = { chatId: string; messageId: string } & ({ kind: 'text'; text: string } | { kind: 'action'; action: ChatAction } | { kind: 'done'; message: ChatMessage })`
  - `QuestApi.claude`:
    - `status(): Promise<ClaudeStatus>`
    - `send(req: SendRequest): Promise<{ chatId: string; messageId: string } | { error: string }>`
    - `stop(): Promise<void>`
    - `onEvent(cb: (e: ClaudeEvent) => void): () => void`
    - `listChats(): Promise<ChatSummary[]>`
    - `readChat(id: string): Promise<Chat | null>`
    - `deleteChat(id: string): Promise<void>`
    - `undo(chatId: string, messageId: string, paths: string[] | null, force: boolean): Promise<UndoResult>`
- Produces, in `service.ts`: `class ClaudeService(root, session, deps: { locate(): Promise<string | null>; spawn: typeof import('node:child_process').spawn; trash; send(e: ClaudeEvent): void })`
  - **`send`:**
    - refuses while a turn runs ("Claude is still answering")
    - resolves page ids to paths and titles through the session
    - builds the prompt with `buildPrompt`
    - writes the user message to the chat file
    - starts a `TurnChanges`
    - spawns with `claudeArgs` and `claudeEnv`, with `cwd: root`
    - streams `text` and `action` events; a Write action for a path the session already knows (`pageIdForPath`) is sent as `edited`
  - **On exit:**
    - waits for one rescan, so the last writes are seen
    - attaches `changes` to the assistant message
    - stores the session id
    - writes the chat file
    - sends `done`
  - **`stop`:** SIGINT, then SIGTERM after 3 s
  - **`close`:** stops the turn and ignores later output
  - **`status`:** `missing` when `locate` gives null; `logged-out` from the last turn's `loggedOut`; otherwise `ready`, with `--version` output
  - **`undo`:** runs `undoChanges` for the message's changes (or the given paths) and records the undone paths in the chat
- Channels: `claude:status`, `claude:send`, `claude:stop`, `claude:event`, `claude:list`, `claude:read`, `claude:delete`, `claude:undo`.

- [ ] **Step 1: Stop the owner's dev app.** Close the terminal tab running `npm run dev`.
- [ ] **Step 2: Failing tests.** `service.test.ts` uses a temp workspace and `fake-claude.mjs` run through `node`. The fake reads its argv, appends a paragraph to `Markets/A.json` in its cwd, and prints `read-and-edit.jsonl` lines. Tests:
  - a turn streams text and an `edited` action, then `done`
  - `done.message.changes` lists `Markets/A.json` with the exact before and after text
  - the chat file has both messages and the session id
  - a second send while running is refused
  - the second turn gets `--resume <session id>`
  - `stop` ends a fake that sleeps
  - `close` mid-turn kills the child, and nothing more is written to the chat or reported (Review Focus 2)
  - `status` gives `missing` when `locate` gives null
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement** the service, `Workspaces` wiring, IPC and preload.
- [ ] **Step 5: Run them.** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit:** `feat: run claude turns from the main process`

### Task 7: Renderer: the chat store

**Files:**
- Create: `src/renderer/src/claude/store.ts` and `store.test.ts`
- Create: `src/renderer/src/claude/labels.ts` and `labels.test.ts`

**Interfaces:**
- Consumes: `QuestApi.claude` and the types from Tasks 3–6.
- Produces, in `store.ts`, `useClaude`, a zustand store with:
  - `open: boolean` and `width: number`, persisted in localStorage under `quest-notebook-claude-panel` (default closed, 400 px)
  - `status: ClaudeStatus | null`
  - `chats: ChatSummary[]` and `chat: Chat | null`
  - `running: { chatId: string; messageId: string; lockedPageId: string | null } | null`
  - `streaming: { text: string[]; actions: ChatAction[] }`
  - `notApplied: Set<string>`
  - `attachments: ChatReference[]`
  - actions:
    - `toggle()` and `setWidth(px)`
    - `refresh()`, which loads status and chats
    - `openChat(id | null)`
    - `attach(ref)` and `detach(index)`
    - `send(message, openPageId)`: flushes the workspace first with `flushWorkspace()`, sets `running`, with `lockedPageId` set to the open page
    - `stop()`
    - `undo(messageId, paths | null)`: on conflicts, asks "These pages changed since Claude's reply. Undo anyway?" and retries with force
    - `onEvent(e)`, which appends text pieces to an array that's joined only when rendered (Review Focus 5); `done` replaces the stream with the final message and clears `running`
    - `markNotApplied(pageId)`
- Produces, in `labels.ts`: `actionLabel(a: ChatAction, titleOf: (path: string) => string | null): string`
  - "Read *Title*", "Edited *Title*", "Created *Title*", "Searched for “x”"
  - drawings read "Drew in *Title*"
  - unknown paths show the path itself

- [ ] **Step 1: Failing tests**
  - `onEvent` with 5,000 text events finishes under 50 ms, and the joined text is right
  - `done` moves the streamed reply into `chat.messages` and clears `running`
  - `send` while running is ignored
  - `actionLabel` covers each verb, plus the drawing path `Markets/A/drawing-x.svg` → "Drew in *A*"
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat: chat state for the claude panel`

### Task 8: Renderer: the panel

**Files:**
- Create:
  - `src/renderer/src/claude/ClaudePanel.tsx`: chat list, messages, composer and setup states
  - `src/renderer/src/claude/Composer.tsx`: textarea, reference chips, `@` picker
  - `src/renderer/src/claude/MessageView.tsx`: markdown, action lines, changed files with Undo and Undo all
  - `src/renderer/src/claude/claude.css`
- Modify:
  - `src/renderer/src/App.tsx`: the third grid column when the panel is open, Cmd+J, mounting the panel
  - `src/renderer/src/components/NotebookView.tsx`: a "Claude" button in the page header
  - `src/renderer/src/workspace/session.ts`: `bootWorkspace` registers `claude.onEvent` and refreshes on workspace change
  - `package.json`: `react-markdown@^10.1.0`

**Behaviour:**
- **Composer:**
  - Enter sends; Shift+Enter starts a new line.
  - Typing `@` opens a picker from `linkChoices(notebooks, query, '')` (pages only, no "create" choice), shown with paths like the `[[` menu. Choosing a page attaches a chip.
  - The open page shows as a removable chip, "This page".
- **Quick actions:** in an empty chat, four buttons with the spec's exact labels. Clicking one fills the composer with that text and sends it.
- **While a turn runs:** the text streams in, action lines appear under it, Stop shows, and Send is disabled.
- **Under each reply:** "Changed:" lines, each opening its page, with Undo, plus Undo all. A line in `notApplied` reads "not applied: you were editing this page". Undone lines are struck through.
- **Setup states:**
  - `missing`: "Install Claude Code: `npm install -g @anthropic-ai/claude-code`, or see claude.com/claude-code", plus "Check again".
  - `logged-out`: "Open Terminal, run `claude`, and log in", plus "Check again".
  - `error`: the message.
- **Layout:** the left edge drags to resize, from 320 to 720 px. Below 1000 px of window width the panel overlays the page.

- [ ] **Step 1: Install `react-markdown`, then implement** the components and styles in the app's tokens.
- [ ] **Step 2: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 3: Commit:** `feat: the claude panel`

### Task 9: Renderer: page lock, Ask Claude, and "not applied"

**Files:**
- Modify:
  - `src/renderer/src/components/NotebookView.tsx`: when `running.lockedPageId === nb.id`, show the bar "Claude is working on this page… Stop", disable the title input, and pass `editable={false}` to the editor
  - `src/renderer/src/editor/NotebookEditor.tsx`: the `editable` prop
  - `src/renderer/src/drawing/DrawingView.tsx` and `src/renderer/src/cells/*`: no input while locked, through a shared `useLocked(notebookId)` from the claude store
  - the editor's `PageToolbar`: an "Ask Claude" button that attaches `{ kind: 'selection', pageId, title, text: selected plain text }` and opens the panel
  - `src/renderer/src/workspace/session.ts`: `applyDisk` calls `useClaude.getState().markNotApplied(id)` for each page it skips as pending while a turn runs
- Test: `src/renderer/src/claude/lock.test.ts`

- [ ] **Step 1: Failing tests:**
  - `useLocked` is true only for the locked page while a turn runs
  - `applyDisk` during a turn marks a pending page as not applied, and doesn't mark it with no turn running; follow the existing `workspace/session.test.ts` setup
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat: claude locks the page it's working on, and asks about a selection`

### Task 10: Live check and docs

- [ ] **Step 1: Build and launch** on a copy of a sample workspace, with a separate `--user-data-dir`, driven over CDP.
- [ ] **Step 2: Walk through the spec's checks 1–8,** using the real CLI with few, short turns. Record the results.
- [ ] **Step 3: Docs.** Add a "Claude panel" section to `README.md`. Add a line to the workspace README in `src/shared/readme.ts`: chats are kept in `.quest/chats/`, and Claude edits only pages and drawings.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit:** `docs: the claude panel`
- [ ] **Step 6: Restart the owner's dev app** in a terminal tab.
