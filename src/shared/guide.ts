import { FORMAT_REFERENCE } from './readme';

/*
  The guide for AI agents, written into every workspace where each tool looks for it, so an agent opened in the
  folder knows how the files work without being told. The app keeps the files it wrote up to date: each says which
  version of the guide it is, and an older one is replaced when the workspace opens.
*/

/** Which version of the guide this is. Raise it whenever the guide's text changes. */
export const GUIDE_VERSION = 2;

const MARK = `<!-- quest-notebook-guide: ${GUIDE_VERSION} -->`;

/** The version of the guide a file says it is, or null for a file the app didn't write (or whose mark was taken out). */
export function guideVersionOf(text: string): number | null {
  const m = /<!-- quest-notebook-guide: (\d+) -->/.exec(text);
  return m ? Number(m[1]) : null;
}

const EXAMPLE_PAGE = `{
  "id": "k3f9a2x1",
  "title": "Bitcoin, big picture",
  "position": 1,
  "created": "2026-10-20T09:14:00Z",
  "updated": "2026-10-20T11:02:00Z",
  "blocks": [
    { "type": "heading", "level": 2, "text": "What I see" },
    { "type": "paragraph", "text": "Buyers keep stepping in at ==62,000==. **Volume** is *rising*, see [the data](https://example.com). #btc" },
    {
      "type": "bullet",
      "text": "Higher lows since March",
      "children": [{ "type": "bullet", "text": "Each one on more volume" }]
    },
    { "type": "numbered", "text": "Wait for the retest" },
    { "type": "numbered", "text": "Buy the bounce" },
    { "type": "checklist", "checked": false, "text": "Set an alert at 62k" },
    { "type": "quote", "text": "Plan the trade, trade the plan." },
    { "type": "callout", "text": "Risk at most 1% of the account on one trade." },
    { "type": "divider" },
    { "type": "code", "language": "text", "code": "entry 62400\\nstop 61200" },
    {
      "type": "chart",
      "id": "c81d0k2m",
      "source": "binance",
      "symbol": "BTCUSDT",
      "interval": "4h",
      "frozenAt": "2026-10-18T03:59:59Z",
      "revealed": false,
      "practice": false,
      "levels": [{ "price": 62000, "color": "yellow", "note": "support" }],
      "trendLines": [
        { "from": { "time": "2026-10-01T00:00:00Z", "price": 58000 }, "to": { "time": "2026-10-15T00:00:00Z", "price": 61500 }, "color": "blue", "line": "dashed" }
      ],
      "pins": [{ "time": "2026-10-12T08:00:00Z", "text": "Breakout", "color": "green" }],
      "labels": [{ "time": "2026-10-16T00:00:00Z", "price": 64000, "text": "target zone" }]
    },
    {
      "type": "tradePlan",
      "id": "t5m2k8q4",
      "side": "long",
      "entry": 62400,
      "stop": 61200,
      "target": 66000,
      "reason": "Retest of support"
    },
    { "type": "prediction", "id": "p2x7q9w1", "direction": "up", "bars": 6, "reason": "Third test of support holds" },
    {
      "type": "chart",
      "id": "c4n7v1x9",
      "source": "custom",
      "symbol": "BTCUSDT",
      "interval": "1d",
      "frozenAt": "2000-01-04T23:59:59Z",
      "revealed": false,
      "practice": false,
      "levels": [],
      "trendLines": [],
      "pins": [],
      "labels": [],
      "name": "My own candles",
      "dated": false,
      "candles": [
        { "time": "2000-01-03T00:00:00Z", "open": 100, "high": 110, "low": 95, "close": 108, "volume": 0 },
        { "time": "2000-01-04T00:00:00Z", "open": 108, "high": 112, "low": 101, "close": 103, "volume": 0 }
      ]
    },
    { "type": "drawing", "id": "d81k2m0q", "file": "drawing-d81k2m0q.svg" },
    {
      "type": "embed",
      "id": "h6j3w9e2",
      "html": "<style>p { font: 16px sans-serif; color: #1d5bc2 }</style><p id='today'></p><script>document.getElementById('today').textContent = new Date().toDateString()</script>",
      "height": 120
    },
    { "type": "embed", "id": "w3b8n5r2", "url": "https://example.com/", "height": 600 }
  ]
}`;

/** The guide itself, without a title: the same text in every file that carries it whole. */
const BODY = `This folder is a Quest Notebook workspace: a trading notebook whose pages are JSON files, which the Quest
Notebook app shows as Notion-style pages with live charts. Everything you need to read and write them is in
this guide, so you don't need to ask how the files work.

## How to work here

- **Edit the files directly.** The app picks up every change within a second, even while it's open.
- **A new page** is a new \`.json\` file in a space folder, or in a page's folder to make a sub-page. It needs
  \`title\` and \`blocks\`. Leave out \`id\` and \`position\`: the app adds them. Name the file after the title
  (see **File names** below).
- **Keep every file valid JSON**, and check it parses before you finish. A file that doesn't, or has no
  \`blocks\` list, shows in the app as unreadable, and the app won't touch it until it's fixed.
- **Use only the block types and fields in this guide.** An unknown block type is kept as a code block holding
  its JSON, and an unknown field is dropped the next time the app saves the page.
- **Never change a page's \`id\`**, and never give two pages the same one. Links and the app go by it.
- **Formatting goes in \`text\` as markup** (see **Text markup**), not as HTML. A link to another page is
  \`[[Its title]]\`.
- **Move or rename a page together with its folder**: \`<Title>.json\` and \`<Title>/\` go side by side.
- **Delete a page** by deleting its file and its folder. If the app has edits to that page it hasn't saved yet,
  it keeps them and writes the page back.
- **Drawings** are SVG files beside the page. Add a stroke by adding a \`<path>\` with \`data-points\` (see
  **Drawings**).
- **Don't edit** \`.quest/state.json\`, \`README.md\` or the guide files (\`AGENTS.md\`, \`CLAUDE.md\`, \`GEMINI.md\`,
  \`.claude/skills/quest-notebook/\`, \`.agents/rules/quest-notebook.md\`). The app rewrites them.

## Every block, with an example

A page using every block type there is. Copy the shapes exactly: the app reads this page and saves it back
unchanged.

\`\`\`json
${EXAMPLE_PAGE}
\`\`\`

${FORMAT_REFERENCE}`;

const AGENT_TITLE = '# Quest Notebook workspace: a guide for AI agents';
const KEEP_NOTE = `This file is written by the Quest Notebook app, and replaced when the app's guide changes. To keep your own
changes to it, delete the line above that names the guide's version: the app then leaves the file alone.`;

/** The whole guide, as AGENTS.md holds it. */
export const AGENT_GUIDE = `${AGENT_TITLE}
${MARK}

${KEEP_NOTE}

${BODY}`;

const pointer = (tool: string) => `${MARK}
@AGENTS.md

${tool} brings in the Quest Notebook guide from \`AGENTS.md\` above: how the pages in this folder are stored,
and how to edit them. This file is written by the Quest Notebook app. Delete the line naming the guide's version
to keep your own changes to it.
`;

const SKILL = `---
name: quest-notebook
description: How the files of this Quest Notebook workspace work, and how to edit them. Use when reading, creating or changing pages (.json), their blocks, charts, trade plans, predictions or drawings (.svg) in this folder.
---
${MARK}

${KEEP_NOTE}

${BODY}`;

/** Every guide file the app keeps in a workspace, by its path from the workspace folder. */
export const GUIDE_FILES: Record<string, string> = {
  'AGENTS.md': AGENT_GUIDE,
  'CLAUDE.md': pointer('Claude Code'),
  'GEMINI.md': pointer('Gemini and Antigravity'),
  '.claude/skills/quest-notebook/SKILL.md': SKILL,
  '.agents/rules/quest-notebook.md': AGENT_GUIDE,
};
