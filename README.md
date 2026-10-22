# Quest Notebook

A desktop trading notebook. You write Notion-style pages with live charts, trade plans and predictions in them. Every page is a plain JSON file in a folder you choose, so you, or an AI tool pointed at the folder, can read and edit your notes directly. The app picks up outside changes as they happen.

## Run it

```bash
npm install
npm run dev
```

- `npm test` runs the tests (Vitest).
- `npm run typecheck` checks the types.
- `npm run dist` builds `dist/mac-arm64/Quest Notebook.app`.
- `npm run dist:dmg` builds a disk image. The app isn't signed yet, so the first time, right-click it and choose Open.

## Workspaces

A workspace is a folder, like an Obsidian vault. On first launch, create one (pick a location and name it) or open an existing folder. The name at the top of the sidebar switches between workspaces, and the File menu has the same commands. The app reopens the last workspace you used.

```
My Quest/
  README.md                     the file format, for people and AI (written once)
  .quest/workspace.json         name, space order, the journal space
  .quest/state.json             what the app was showing
  .quest/chats/                 the Claude panel's chats, one JSON file each
  Journal/                      a space is a top-level folder
    20 Oct 2026.json            a page
  Lessons/
    Support and resistance.json
    Support and resistance/     that page's sub-pages
      Practice- guess the next move.json
```

- **Pages:** each page file holds its title, its position among its siblings, and its blocks: text, headings, lists, checklists, quotes, callouts, dividers, code, charts, trade plans and predictions.
- **Text formatting:** text is written in Markdown-style marks such as `**bold**`, `==highlight==` and `[[Page links]]`.
- **The format in full:** see the `README.md` that every new workspace gets ([source](src/shared/readme.ts)) and the [design](docs/superpowers/specs/2026-10-20-quest-notebook-design.md).

## Claude panel

Press **Cmd+J**, or click **Claude** in a page's header, to open a chat with Claude beside the page. It runs the [Claude Code](https://claude.com/claude-code) CLI already installed on your Mac, on your Claude subscription.

- **Setup:** install Claude Code and log in once in Terminal with `claude auth login`. The panel says so if either is missing. An `ANTHROPIC_API_KEY` in the environment is ignored, so it never bills an API key.
- **References:**
  - The open page is attached to each message. Remove its chip to leave it out.
  - Type `@` to attach other pages.
  - Select text in a page and choose **Ask Claude** to quote it.
  - Right-click a block, or use its ⋮⋮ menu, and choose **Ask Claude about this block**. Claude gets that block exactly as it's written in the page file, so it can change just that block.
  - Paste or drop images (PNG, JPEG, GIF or WebP, up to 10 per message, 5 MB each) into the message box. Claude sees them, as in Claude Code, and they're kept with the chat.
- **What Claude can do:**
  - It reads the whole workspace.
  - It edits and creates pages and drawings in your spaces, and changes show up at once.
  - It can't write anything else (the README, `.quest/`, other files, anything outside the folder) and has no shell, web or MCP access.
- **While it works:** the page that was open is read-only, with a bar to stop it. Other pages stay editable.
- **Undo:**
  - Each reply lists the files it changed, with **Undo** per file and **Undo all**.
  - Undo puts each file back exactly as it was before the reply, and moves pages Claude created to the Trash.
  - If you changed a file since, it asks first.
- **Chats** are kept in `.quest/chats/`, and continuing one resumes Claude's own session, so it remembers.

The [design](docs/superpowers/specs/2026-10-21-claude-panel-design.md) and the [notes on what the CLI does](docs/superpowers/notes/2026-10-21-claude-cli-findings.md) have the details.

## How it's built

- **Electron, with electron-vite.**
  - `src/main` owns the workspace folder: it reads it, writes pages atomically, moves deleted pages to the Trash, and watches for outside changes.
  - `src/preload` is the one bridge to the window (`window.quest`).
  - `src/renderer` is the React app.
- **The page editor** is BlockNote. Charts are drawn with lightweight-charts, and prices come from Binance's public market data.
- **`src/shared`** holds the code both sides use: the page file types, JSON formatting, safe file names and the IPC types.

The UI started as the trading-notebook prototype and keeps its look and behaviour.
