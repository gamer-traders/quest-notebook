/** The README.md written into a new workspace: the file format, for the people and AI tools that open the folder. */
export const WORKSPACE_README = `# Quest Notebook workspace

This folder is a Quest Notebook workspace: a trading notebook whose pages are plain JSON files.
The Quest Notebook app shows them as Notion-style pages with live charts. You can also read and edit
them directly, by hand or with an AI tool. While the app is open, it picks up changes within a second.

## Layout

\`\`\`
README.md                     this file
.quest/workspace.json         workspace settings: name, space order, the journal space
.quest/state.json             what the app was showing (the app's own; don't edit)
<Space>/                      a top-level folder is a space, named after the folder
  <Page title>.json           a page
  <Page title>/               the sub-pages of "<Page title>", if it has any
    <Sub-page title>.json
\`\`\`

- **Pages:** every \`.json\` file inside a space folder is a page.
- **Ignored:** files at the top of the workspace, names starting with \`.\`, and files that aren't \`.json\`.
- **File names:** a page's file is named after its title, with \`/ \\ : * ? " < > |\` replaced by \`-\`. Pages with the same title next to each other get \`Title 2.json\`, \`Title 3.json\`, ….
- **Renaming a file:** the file's new name becomes the page's title.
- **A folder with no page file:** it becomes a page, and the app writes its \`.json\`.

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
| \`chart\` | see below |
| \`tradePlan\` | \`id\`, \`side\` (\`long\` or \`short\`), \`entry\`, \`stop\`, \`target\` (numbers or \`null\`), \`reason\` |
| \`prediction\` | \`id\`, \`direction\` (\`up\` or \`down\`), \`bars\` (how many candles later it's checked), \`reason\` |

- **Nesting:** any block can have \`children\`, a list of blocks nested under it, as in an indented list.
- **Plans and predictions** are checked against the nearest chart above them on the page.
- **Unknown block types** are kept as code blocks holding their JSON, so nothing is lost.

### Charts

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
- **Line breaks** inside a block are \`\\n\`.
- **Tags:** \`#tags\` are plain text, and the app lists and searches them.
- **Page links** name the page by its title. When two pages share a title, they name it by its path from the space: \`[[Markets/Bitcoin, big picture/Weekly levels]]\`.
- **Renaming a page in the app** updates the links to it.
- **A link to a page that doesn't exist** keeps its words and shows as a missing link.

## Times

- All times are ISO 8601 in UTC, such as \`2024-10-28T00:00:00Z\`.
- Candles typed or drawn in the app have no real dates. They use made-up days starting 3 Jan 2000, one per candle, and their chart says \`"dated": false\`.

## Good to know

- **Unreadable files:** a file that isn't valid JSON is shown in the app with the error, and never overwritten. Fix it and it reloads.
- **Fields the app doesn't know** are dropped the next time the app saves that page.
- **Deleting** a page or space in the app moves its files to the system Trash.
`;
