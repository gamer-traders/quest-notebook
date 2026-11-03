/** Which version of the README this is. A README an earlier app version wrote is replaced by this one. */
export const README_MARKER = '<!-- quest-notebook-readme: 8 -->';

/** The file format, from the folder's layout on: what the README explains, and the guide for AI agents repeats. */
export const FORMAT_REFERENCE = `## Layout

\`\`\`
README.md                     about this folder, for people
AGENTS.md                     the guide for AI agents (CLAUDE.md and GEMINI.md bring it in)
.claude/, .agents/            the same guide, where Claude Code and Antigravity look for it
.quest/workspace.json         workspace settings: name, space order, the journal space
.quest/state.json             what the app was showing (the app's own; don't edit)
.quest/chats/                 the Claude panel's chats (the app's own; don't edit)
<Space>/                      a top-level folder is a space, named after the folder
  <Page title>.json           a page
  <Notes>.md                  a Markdown file, shown beside the pages
  <Page title>/               the page's folder, if it has sub-pages or drawings
    <Sub-page title>.json     a sub-page
    drawing-<id>.svg          a drawing on the page
\`\`\`

- **Pages:** every \`.json\` file inside a space folder is a page.
- **Markdown files:** a \`.md\` file in a space, or in a page's folder, shows in the app beside the pages, as it's written. The app changes one only when it's edited in the app, and never over a change made on disk since it was opened.
- **Ignored:** files at the top of the workspace, names starting with \`.\`, and files that aren't \`.json\` or \`.md\` (except a page's drawings).
- **File names:** a page's file is named after its title, with \`/ \\ : * ? " < > |\` replaced by \`-\`. Pages with the same title next to each other get \`Title 2.json\`, \`Title 3.json\`, ….
- **Renaming a file:** the file's new name becomes the page's title.
- **A page and its folder go together.** Rename or move the folder along with the page file. If the folder holds only drawings and you forget it, the app moves it after the page file for you.
- **A folder with no page file:** it becomes a page, and the app writes its \`.json\`. A folder holding only drawing files doesn't: it's what a page left behind.
- **README.md and the AI guides** are rewritten by the app when the file format changes. Keep your own notes in pages.
- **The app's Claude panel** edits only page files and drawing files inside space folders. It never writes README.md, the AI guides, \`.quest/\` or other files.

## Page file

\`\`\`json
{
  "id": "k3f9a2x1",
  "title": "Bitcoin, big picture",
  "position": 1,
  "created": "2026-10-20T09:14:00Z",
  "updated": "2026-10-20T11:02:00Z",
  "blocks": [
    { "type": "heading", "level": 2, "text": "What I see" },
    { "type": "paragraph", "text": "Buyers keep stepping in at ==62,000==. See [[Weekly levels]]. #btc" },
    { "type": "chart", "id": "c81d0k2m", "source": "binance", "symbol": "BTCUSDT", "interval": "4h",
      "frozenAt": "2026-10-18T03:59:59Z", "revealed": false, "practice": false,
      "levels": [{ "price": 62000, "color": "yellow", "note": "support" }],
      "trendLines": [], "pins": [], "labels": [] },
    { "type": "prediction", "id": "p2x7q9w1", "direction": "up", "bars": 6, "reason": "Third test of support holds" },
    { "type": "checklist", "checked": false, "text": "Wait for a 4h close above 64k" }
  ]
}
\`\`\`

| field | meaning |
|---|---|
| \`id\` | Unique in the workspace. Leave it out of a new page and the app adds one. Never reuse an id. |
| \`title\` | The page title. |
| \`position\` | Order among the pages next to it: lower comes first. Leave it out and the page goes last. |
| \`journalDate\` | Only on journal pages: the day, \`YYYY-MM-DD\`. |
| \`created\`, \`updated\` | ISO 8601 times. |
| \`blocks\` | The page's content, top to bottom. |

## Block types

| \`type\` | fields |
|---|---|
| \`paragraph\` | \`text\` |
| \`heading\` | \`level\` (1, 2 or 3), \`text\` |
| \`bullet\` | \`text\`: a bulleted list item |
| \`numbered\` | \`text\`, optional \`start\`: a numbered list item |
| \`checklist\` | \`checked\` (true or false), \`text\` |
| \`quote\` | \`text\` |
| \`callout\` | \`text\`: a note set apart |
| \`divider\` | none |
| \`code\` | \`language\`, \`code\`: raw text, with no markup |
| \`chart\` | a trading chart: see below |
| \`tradePlan\` | \`id\`, \`side\` (\`long\` or \`short\`), \`entry\`, \`stop\`, \`target\` (numbers or \`null\`), \`reason\` |
| \`prediction\` | \`id\`, \`direction\` (\`up\` or \`down\`), \`bars\` (how many candles later it's checked), \`reason\` |
| \`embed\` | \`id\`, \`html\` or \`url\`, \`height\`: see below |

- **Nesting:** any block can have \`children\`, a list of blocks nested under it, as in an indented list.
- **Plans and predictions** are checked against the nearest chart above them on the page.
- **Unknown block types** are kept as code blocks holding their JSON, so nothing is lost.

### Trading charts

| field | meaning |
|---|---|
| \`id\` | Unique on the page. |
| \`source\` | \`binance\`, for live prices of \`symbol\` (such as \`BTCUSDT\`), or \`custom\`, for your own \`candles\`. |
| \`interval\` | \`15m\`, \`1h\`, \`4h\`, \`1d\` or \`1w\`. |
| \`frozenAt\` | The chart shows candles up to this moment. Later candles stay hidden until revealed. |
| \`revealed\` | Whether the hidden candles are shown. |
| \`practice\` | Practice charts hide their dates. |
| \`levels\` | Horizontal lines: \`{ "price", "color"?, "line"?, "width"?, "note"? }\`. |
| \`trendLines\` | \`{ "from": { "time", "price" }, "to": { "time", "price" }, "color"?, "line"?, "width"?, "note"? }\`. |
| \`pins\` | Notes pinned to a candle: \`{ "time", "text", "color"? }\`. |
| \`labels\` | Words written on the chart: \`{ "time", "price", "text", "color"? }\`. |
| \`name\`, \`dated\`, \`candles\` | Custom charts only. \`candles\` holds \`{ "time", "open", "high", "low", "close", "volume" }\`. |

- **Colours:** \`yellow\`, \`blue\`, \`green\`, \`red\`, \`purple\` or \`gray\`.
- **Line styles:** \`line\` is \`solid\`, \`dashed\` or \`dotted\`, and \`width\` is \`thin\`, \`normal\` or \`thick\`.

### Embeds

An \`embed\` block shows a piece of the web on the page:

\`\`\`json
{ "type": "embed", "id": "h6j3w9e2", "html": "<style>p { color: #1d5bc2 }</style><p>Hello</p><script>console.log('hi')</script>", "height": 300 }
{ "type": "embed", "id": "w3b8n5r2", "url": "https://example.com/", "height": 600 }
\`\`\`

- **\`html\`** is a whole web page in one string, with its CSS and scripts. It can load scripts, styles and data from the web.
- **\`url\`** shows the web page at that address, \`http\` or \`https\`. Some sites refuse to be shown inside another app, and stay blank.
- **One or the other.** When a block has both, \`url\` shows, and \`html\` is dropped the next time the app saves the page.
- **\`height\`** is in pixels, from 80 to 4000.
- **Sealed off.** An embed runs in a frame of its own. It can't reach the app, the workspace's files or the pages, and \`html\` has no \`localStorage\` or cookies.

## Drawings

A \`drawing\` block in a page points at its own SVG file, in the page's folder (the folder named like the page file):

\`\`\`json
{ "type": "drawing", "id": "d81k2m0q", "file": "drawing-d81k2m0q.svg" }
\`\`\`

The SVG is the drawing: a picture anyone can open, whose paths also carry the strokes they were drawn from.

\`\`\`xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 420" data-background="grid">
  <path data-tool="pen" data-color="ink" data-size="3" data-pressure="true"
        data-points="120.5,80.2,0.42 121.3,81,0.47" d="M120.4,79.6 Q …" fill="#17202a"/>
</svg>
\`\`\`

| attribute | meaning |
|---|---|
| \`viewBox\` | \`0 0 1000 <height>\`: a drawing is always 1000 units wide, with y going down. |
| \`data-background\` | \`blank\`, \`grid\` or \`lines\`. |
| \`data-tool\` | \`pen\`, \`pencil\`, \`marker\` or \`highlighter\`. |
| \`data-color\` | \`ink\` (black, or white on a dark page), \`yellow\`, \`blue\`, \`green\`, \`red\`, \`purple\` or \`gray\`. |
| \`data-size\` | The line's width at full pressure. |
| \`data-pressure\` | \`true\` when the points carry a pen's pressure; \`false\` for mouse strokes, whose width comes from speed. |
| \`data-points\` | \`x,y,pressure\` triples separated by spaces. Pressure runs from 0 to 1. |

- **The points are the truth.** \`d\` is the drawn outline, and the app works it out again from \`data-points\`.
  - To add a stroke, a \`<path>\` with \`data-points\` is enough. The app shows it at once, and fills in the outline the next time someone draws in that drawing.
  - Strokes can also go in the page, as a \`strokes\` list on the drawing block (each \`{ "tool", "color", "size", "points" }\`, with \`points\` as above). The app adds them to the drawing's file and takes them out of the page. They never replace the strokes already in the file.
- **Only strokes are kept.** When the app writes a drawing, the file holds its paper, its background and its strokes. Anything else in it, like a label, a shape or a path without \`data-points\`, isn't drawn again: the old file goes to the Trash first, so nothing is lost.
- **Ids and file names.** A drawing's \`id\` is letters, digits, \`-\` or \`_\` (at most 64), its own on the page, and its file is always \`drawing-<id>.svg\`. A drawing with another id or file name gets a new id, its drawing is copied to the new file, and the page is updated to point at it.
- **A missing file** shows an empty drawing, and the app never writes one for it: the file may still be on its way.
- **Changes from outside win** when the app hasn't touched that drawing. The app never writes over a drawing file that changed since it last read it.
- **Removing a drawing in the app** moves its file to the Trash. A drawing file whose block is gone from the page is left alone.

## Text markup

The \`text\` of a block uses Markdown-style marks:

| write | to get |
|---|---|
| \`**bold**\` | bold |
| \`*italic*\` | italic |
| \`<u>underline</u>\` | underline |
| \`~~strike~~\` | strikethrough |
| \`\` \`code\` \`\` | inline code |
| \`==words==\` | a yellow highlight |
| \`=={blue}words==\` | a highlight in another colour: blue, green, red, purple or gray |
| \`[words](https://example.com)\` | a web link |
| \`[[Page title]]\` | a link to another page in this workspace |

- **Escaping:** a backslash makes the next character plain, as in \`\\*\` and \`\\[\`.
- **Inline code takes no other mark.** The app shows code inside bold, italic or a highlight as plain code, and code inside a link's words as plain words. Close the other mark first: \`\` **Total:** \`600 kcal\` \`\`.
- **Line breaks** inside a block are \`\\n\`.
- **Tags:** \`#tags\` are plain text, and the app lists and searches them.
- **Page links** name the page by its title. When two pages share a title, they name it by its path from the space: \`[[Markets/Bitcoin, big picture/Weekly levels]]\`.
- **Renaming a page in the app** updates the links to it.
- **A link to a page that doesn't exist** keeps its words and shows as a missing link.

## Times

- All times are ISO 8601 in UTC, such as \`2024-10-28T00:00:00Z\`.
- Candles typed or drawn in the app have no real dates. They use made-up days starting 3 Jan 2000, one per candle, and their chart says \`"dated": false\`.

## Good to know

- **Unreadable files:** a file that isn't valid JSON, or is JSON but not a page (a page is an object with a \`blocks\` list), is shown in the app with the reason, and never written to. Fix it and it reloads.
- **Fields the app doesn't know** are dropped the next time the app saves that page.
- **Deleting** a page or space in the app moves its files to the system Trash.
- **An edit wins over a delete.** A page file deleted while the page has edits in the app not yet saved comes back, with its drawings, and the app says so. A page deleted in the app while its file changes on disk comes back too, with the change.
`;

/** The README.md written into a new workspace: the file format, for the people and AI tools that open the folder. */
export const WORKSPACE_README = `# Quest Notebook workspace
${README_MARKER}

This folder is a Quest Notebook workspace: a trading notebook whose pages are plain JSON files.
The Quest Notebook app shows them as Notion-style pages with live charts. You can also read and edit
them directly, by hand or with an AI tool. While the app is open, it picks up changes within a second.

${FORMAT_REFERENCE}`;
