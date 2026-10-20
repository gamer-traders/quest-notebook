# Quest Notebook: design

Date: 20 Oct 2026
Status: building. The owner asked to skip further questions ("start implementing, I will check later in UI"), so everything under "My calls" is mine and open to review.

## Intent

The trading notebook prototype (`~/Workspace/local/trading-notebook`) becomes **Quest Notebook**, a desktop app. The UI stays the prototype's Notion-style one. What changes is where notes live: in a folder on disk, the **workspace**, like an Obsidian vault, as JSON files laid out to match the sidebar, written so an AI pointed at the folder understands them without the app.

## Decided with the owner

- **Stack:** React and Electron.
- **UI:** the same as the prototype, Notion-like, with every block type it has:
  - text, headings 1–3
  - bulleted, numbered and checklist items
  - quote, callout, divider, code
  - chart, trade plan, prediction
- **Storage:** JSON files on disk.
- **Workspaces like Obsidian:**
  - you pick a folder and name the workspace
  - you can open other workspaces and switch between them
- **Files mirror the app:**
  - a space is a folder
  - a page is a JSON file
  - sub-pages sit in a folder named like their parent page
- **Readable by AI:**
  - plain field names
  - text stored as Markdown-style writing
  - charts' data inside their block
- **Live reload:** when an AI, or anything else, changes a file while the app is open, the app shows the change at once.

## Goals

1. Everything the prototype does keeps working, including:
   - pages and the block editor
   - charts (Binance and your own data, marks, freeze and reveal)
   - plans and predictions, with grading and review
   - spaces, sub-pages, drag and drop, Move to…
   - `[[links]]`, backlinks, search and `#tags`
   - today's journal
   - settings and appearance
   - light and dark themes
2. **Welcome screen** when no workspace is open:
   - Create a new workspace: a name, a location, and "Start with sample pages", which is on by default.
   - Open a folder as a workspace.
   - Recent workspaces, each removable from the list. Removing one never deletes files.
3. **Workspace switcher** at the top of the sidebar:
   - the workspace name
   - recent workspaces
   - New workspace…, Open folder…, Show in Finder
   - The File menu has the same commands.
4. The app reopens the last workspace on launch.
5. **Disk layout** (see "File format"), with every change in the app written to disk within about half a second:
   - edit text or a chart
   - rename a page: the file is renamed, and its sub-page folder with it
   - move or nest a page: the file and its folder are moved
   - delete a page or a space: it goes to the system Trash
   - rename a space: the folder is renamed
   - reorder pages or spaces
6. **External changes appear live:**
   - a new, changed or deleted file
   - a renamed or moved file or folder
   - a new or renamed space folder
   - an edit to `.quest/workspace.json`
   - If the open page changes on disk, the editor reloads it.
7. **A `README.md` in each new workspace** explains the format for people and AI. It's written only if no README exists.

## Non-goals

- Importing the prototype's browser data.
- Several windows at once, sync, accounts or collaboration.
- A page format other than JSON, such as Markdown files.
- Merging simultaneous edits to the same page from the app and an AI.
- Code signing and auto-update.

## Anti-goals: failure even if it technically works

- **Losing data:**
  - overwriting a file the app couldn't read
  - deleting more than the confirmation said
  - permanently deleting anything
- **Writes looping:** the app's own writes coming back as "external changes", or edits bouncing between the app and the disk.
- **Unreadable files:** files an AI can't make sense of without the app.
- **Writing outside the workspace folder.**
- **Typing lag** caused by saving.

## Constraints

- **Versions:** Electron 44, electron-vite 6, Vite 8, React 19, TypeScript 7, Vitest 5, and BlockNote 0.56 (MPL packages only), as the prototype uses.
- **Security:** context isolation and sandbox are on, there's no Node in the renderer, and one typed preload bridge (`window.quest`) connects them.
- **Tests:**
  - `npm test` stays green
  - new pure logic is written test-first
  - disk logic is tested against real temporary folders

## File format

```
<workspace>/
  README.md                     what this folder is, and the format (written once)
  .quest/workspace.json         {"format": 1, "name", "spaces": [folder names in order], "journalSpace": folder name | null}
  .quest/state.json             UI state: open page, expanded rows, collapsed panels (the app's own, not for editing)
  <Space>/                      a top-level folder is a space; its name is the space's name
    <Page title>.json           a page
    <Page title>/               that page's sub-pages, if it has any
      <Sub-page title>.json
```

A page file:

```json
{
  "id": "k3f9a2",
  "title": "Bitcoin, big picture",
  "position": 1,
  "created": "2026-10-20T09:14:00Z",
  "updated": "2026-10-20T11:02:00Z",
  "blocks": [
    { "type": "heading", "level": 2, "text": "What I see" },
    { "type": "paragraph", "text": "Buyers keep stepping in at ==62,000==. See [[Weekly levels]]. #btc" },
    { "type": "chart", "id": "c81d", "source": "binance", "symbol": "BTCUSDT", "interval": "4h",
      "frozenAt": "2026-10-18T03:59:59Z", "revealed": false, "practice": false,
      "levels": [{ "price": 62000, "color": "yellow", "note": "support" }],
      "trendLines": [], "pins": [], "labels": [] },
    { "type": "prediction", "id": "p2x7", "direction": "up", "bars": 6, "reason": "Third test of support holds" },
    { "type": "checklist", "checked": false, "text": "Wait for a 4h close above 64k" }
  ]
}
```

### Block types

| `type` | fields |
|---|---|
| `paragraph`, `quote`, `callout` | `text` |
| `heading` | `level` (1–3), `text` |
| `bullet`, `numbered` | `text`, `start` (numbered, optional) |
| `checklist` | `checked`, `text` |
| `divider` | — |
| `code` | `language`, `code` (raw, no markup) |
| `chart` | `id`, `source` (`binance` or `custom`), `symbol`, `interval` (`15m`, `1h`, `4h`, `1d`, `1w`), `frozenAt`, `revealed`, `practice`, `levels`, `trendLines`, `pins`, `labels`; custom charts add `name`, `dated` and `candles` |
| `tradePlan` | `id`, `side` (`long` or `short`), `entry`, `stop`, `target` (numbers or null), `reason` |
| `prediction` | `id`, `direction` (`up` or `down`), `bars`, `reason` |

- Any block may have `children`, which are nested blocks.
- Trade plans and predictions are checked against the nearest chart above them.

### Text markup inside `text`

| markup | meaning |
|---|---|
| `**bold**` | bold |
| `*italic*` | italic |
| `<u>underline</u>` | underline |
| `~~strike~~` | strikethrough |
| `` `code` `` | inline code |
| `==highlight==` | yellow highlight |
| `=={blue}highlight==` | highlight in blue, green, red, purple or gray |
| `[words](https://…)` | web link |
| `[[Page title]]` | link to a page. The full path is written only when two pages share the title: `[[Markets/Bitcoin, big picture/Weekly levels]]`. |

- A backslash makes the next character literal: `\*`.
- `#tags` are plain text.
- Line breaks are `\n`.

### Times

All times are ISO 8601 UTC. Candles you typed or drew have no real dates, so they use made-up days starting 3 Jan 2000, and the chart says `"dated": false`.

## My calls

- **Electron shell:**
  - one window, with the workspace in the window title
  - the standard macOS menus (Edit, so copy and paste work), plus File → New workspace… and Open folder…
  - web links open in the default browser
- **Recent workspaces** are kept in the app's own data folder, not in a workspace.
- **Appearance is app-wide** and stays in the renderer's own storage. It's a setting, not notebook data.
- **The page title field in the JSON is the page's title.** The file name is made from it:
  - the characters `/ \ : * ? " < > |` become `-`
  - leading dots and trailing dots and spaces are trimmed
  - empty means `Untitled`
  - at most 120 characters
  - ` 2`, ` 3`, … is added when a sibling already has that name, ignoring case
- **A space's name is its folder name.** Renaming a space makes its name safe for a folder the same way.
- **A file renamed outside the app** (same id, new name) takes the new file name as its title.
- **Loading rules:**
  - A missing `id` is added and written back. So is a duplicate id, which the later file in path order gives up.
  - A missing `title` comes from the file name.
  - A missing `position` puts the page after its siblings.
  - A missing `created` or `updated` takes the file's time.
  - A folder with no matching page file becomes a page: its file is written with the folder's name as the title.
  - Files the app can't parse show in the sidebar with the error and are never written over. They reload when fixed.
  - Block types the app doesn't know are kept as code blocks holding their JSON, so nothing is lost.
  - Fields the app doesn't know are dropped the next time the app saves that page. The README says so.
  - Files at the workspace root, folders starting with `.`, and files that aren't `.json` are ignored.
- **Text block ids** aren't stored. They're made fresh on each load. Chart, plan and prediction blocks keep their `id`. Chart marks have no ids in the file.
- **Links:**
  - Links are stored by title, or by path when titles clash, and resolved to pages on load.
  - Renaming a page in the app rewrites every link to it.
  - A link to a page that doesn't exist keeps its text and shows as a missing link.
- **Saving:**
  - Changes are batched, about 300 ms after the last edit. Only pages whose JSON changed are written.
  - Writes are atomic: the app writes a temporary file, then renames it.
  - A save that fails shows a banner saying changes aren't being saved, with the error.
- **Conflicts:** an external change to a page with edits the app hasn't saved yet loses to those edits. Otherwise the disk wins.
- **Closing:** closing the window or switching workspace waits for pending saves, up to 3 seconds.
- **Deleting** moves files to the system Trash, not permanent deletion. The confirmation dialogs stay as they are.
- **New workspaces** get the spaces Journal, Markets and Lessons. With sample pages on, they also get the prototype's sample pages.
- **JSON is pretty-printed with two spaces.** An object or array holding only plain values stays on one line if that line fits in 120 characters, so candle lists stay compact.

## How we'll know it works

1. Create a workspace "Quest Trading" in a temporary folder with sample pages: the folders, `workspace.json`, the README and the sample page files appear, laid out as above.
2. Type in a page: its file changes within a second. Rename it: the file, and its sub-page folder, are renamed. Links to it in other files show the new title.
3. Drag a page under another: the files move. Delete it: they go to the Trash.
4. With the app open, edit a page's JSON in a text editor or with an AI, then add a new page file and delete another: the app shows each change at once, including in the open page.
5. Make a page file invalid JSON: the app shows the error and doesn't overwrite it. Fix it: the page comes back.
6. Quit and relaunch: the same workspace, open page and expanded rows come back.
7. Switch to a second workspace and back.
8. `npm test` and `npm run build` pass.
