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

## How it's built

- **Electron, with electron-vite.**
  - `src/main` owns the workspace folder: it reads it, writes pages atomically, moves deleted pages to the Trash, and watches for outside changes.
  - `src/preload` is the one bridge to the window (`window.quest`).
  - `src/renderer` is the React app.
- **The page editor** is BlockNote. Charts are drawn with lightweight-charts, and prices come from Binance's public market data.
- **`src/shared`** holds the code both sides use: the page file types, JSON formatting, safe file names and the IPC types.

The UI started as the trading-notebook prototype and keeps its look and behaviour.
