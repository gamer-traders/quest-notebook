# Claude panel: design

Date: 21 Oct 2026
Status: agreed in conversation. Points marked "my call" were left to me, and the owner accepted the playback as a whole ("nothing, all good").

## Intent

Bring Claude into Quest Notebook as a chat in a side panel. Claude can read the workspace, edit the open page, create pages and change other notes, so the owner can ask for help with their trading notes without leaving the app. It runs on the owner's own Claude subscription, through the Claude Code CLI already installed on their Mac.

The workspace was designed to be clear to an AI: plain JSON pages, drawings as SVG files, and a README that explains the format. This panel puts that to use inside the app.

## Decided with the owner

- **Placement:** a chat in a **side panel**.
- **Engine and billing:** it runs on **Claude Code in headless mode** (`claude -p`) using the owner's **subscription**, not an API key.
- **Abilities:** Claude can edit the open page, create pages, and change other notes.
- **References:** the owner can **reference notes** in a message.
- **Playback accepted as described:**
  - The panel opens from a button.
  - Replies stream in, with a line for each action.
  - The open page is always included.
  - `@` attaches other pages.
  - "Ask Claude" attaches a selection.
  - Each reply lists the pages it changed, with Undo.
  - Claude is limited to the workspace and has no shell.
  - Chats are saved in the workspace.
  - Quick actions are offered.
- **Applying changes:** changes are applied directly, with undo, not proposed for approval. This was my call; the owner prefers "do it, adjust later" and didn't object.
- **The open page locks while Claude works.** The owner chose this over "the owner's typing wins" and over merging block by block. The page turns read-only with a small bar, "Claude is working on this page… Stop", and unlocks when the reply ends. Scrolling, reading and editing other pages stay possible.

## Goals

1. **The panel**
   - A Claude panel on the right side of the window, opened and closed by a button in the page header and by **Cmd+J**.
   - It sits beside the page, not over it. On narrow windows (below about 1000 px) it overlays the page.
   - Its open or closed state and width are remembered (app storage, like appearance), and its left edge can be dragged to resize it.
2. **Chat**
   - A message box: Enter sends, Shift+Enter starts a new line.
   - Claude's reply streams in as it's written.
   - While Claude works, each action shows as a compact line, for example "Read *Markets / Bitcoin, big picture*", "Edited *Weekly levels*", "Created *Lessons / Wyckoff*", "Searched for “breakout”".
   - A **Stop** button ends the turn.
   - Replies are rendered as Markdown.
3. **References**
   - **The open page is attached automatically**, shown as a chip above the message box that the owner can remove for this message.
   - **Typing `@`** opens the page picker, which shows the same titles and paths as the `[[` link menu. Choosing a page adds it as a chip.
   - **Selecting text in a page** shows **Ask Claude** in the selection toolbar. It opens the panel with the selected text attached as a quoted reference.
4. **What Claude can do**
   - Read and search every file in the workspace.
   - Edit page files and drawing files.
   - Create new pages and drawings, following the workspace README.
   - Changes show up in the app at once, through the existing live reload.
5. **The open page during a turn**
   - It's read-only while Claude works, with the bar described above.
   - Switching to another page during the turn is allowed, and that page isn't locked.
   - If the owner types on a page that Claude then changes, the owner's typing wins (the app's existing rule). The reply marks that change "not applied: you were editing this page".
6. **Undo per reply**
   - Under each reply, a list of the pages and drawings it changed or created. Each line opens that page and has **Undo**, and an **Undo all** covers the reply.
   - Undo puts the files back exactly as they were before that reply. A page the reply created goes to the Trash.
   - If a file has changed since the reply, undo asks before overwriting it.
7. **Saved chats**
   - Chats are stored in the workspace under `.quest/chats/`.
   - A chat list in the panel holds a new chat, earlier chats by title and date, and delete chat.
   - Continuing an old chat resumes Claude's own session, so it remembers the conversation.
8. **Quick actions**
   - An empty chat offers one-click starters about the open page:
     - "Summarize this page"
     - "Tidy this page"
     - "Make a checklist from this page"
     - "Turn this week's journal into a lesson page"
   - Each one sends a ready-written message, which the owner can also edit first.
9. **Setup states** — the panel explains, in place of the chat:
   - Claude Code isn't installed: how to install it.
   - The owner isn't logged in: "run `claude` in Terminal once and log in".
   - Claude reports usage limits or errors: the message as it was given.

## Non-goals

- API-key billing, and a choice between engines.
- Several Claude turns running at once. One turn runs at a time per workspace.
- Shell commands, web access and MCP servers for Claude.
- Inline autocomplete or ghost text in the editor.
- Sending images. Claude reads drawings as their SVG files.
- Grading predictions against Binance prices. Claude has no market data beyond what's in the files.

## Anti-goals: failure even if it technically works

- **Running outside the workspace:** Claude reading or writing anything outside the workspace folder, or running commands.
- **Surprise billing:** using an API key that happens to be set in the environment.
- **Losing the owner's words:**
  - Claude working on a stale copy because the last typed words hadn't been saved.
  - Claude's edits silently overwriting text the owner typed during the turn, beyond what undo can restore.
- **Undo that lies:** an Undo that doesn't fully restore the files, or that overwrites newer edits without asking.
- **Broken pages:** Claude leaving page JSON invalid. The app already shows such a file's error and never overwrites it, and undo must be able to restore it.
- **A frozen app:** typing, drawing or scrolling slowing down while Claude streams.

## Constraints

- **The CLI:** use the installed `claude` (version 2.1.288 on the owner's Mac; `--restricted` needs 2.1.248 or later).
  - Find it from the login shell's PATH: an app opened from Finder doesn't inherit the terminal's PATH. Also check the common install locations (`~/.local/bin/claude`, `~/.claude/local/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`), and accept a path set in Settings.
- **Invocation, per turn:**

  ```
  claude -p --output-format stream-json --verbose --include-partial-messages
         [--resume <session-id>] --restricted --strict-mcp-config
         --tools Read,Glob,Grep,Edit,Write --permission-mode default
         --allowedTools Read Glob Grep "Edit(/*/**/*.json)" "Edit(/*/**/drawing-*.svg)"
         --disallowedTools "Edit(/.quest/**)"
         --append-system-prompt <workspace guide> -- <message>
  ```

  (Settled by the first experiment; see "Changed while building". The first draft used `--permission-mode acceptEdits`, which leaked.)

  - Run it with the **workspace folder as the working directory**.
  - **Remove `ANTHROPIC_API_KEY`** and `ANTHROPIC_AUTH_TOKEN` from its environment, so the subscription login is used.
  - Never pass `--bare`, which skips the login.
- **Claude writes only pages and drawings inside existing spaces** (my call).
  - Edit and Write are allowed only for page `.json` files and `drawing-*.svg` files inside a space folder.
  - Denied: files at the top of the workspace (the README and anything else there), other file types, new top-level folders, and `.quest/**`.
  - So everything Claude can change is something the app tracks, lists under the reply, and can undo exactly.
  - The first experiment works out the permission rules that achieve this, using `--allowedTools`/`--disallowedTools` or a `--settings` file.
- **Stopping a turn:** send SIGINT to stop. If it hasn't exited after a few seconds, send SIGTERM.
- **Process split:** all child-process work happens in the main process. The renderer talks to it through `window.quest`, like everything else. Isolation stays as it is: no Node in the renderer.
- **Facts to check by experiment:** the stream-json event shapes and the exact flag behaviour are documented only in part. The plan starts with an experiment that runs the real CLI on this Mac and records the events, and the code is built against what it shows.
- **Tests:** existing tests stay green, and new pure logic, like event parsing and undo bookkeeping, is written test-first.

## My calls

- **Saving before a turn:** before each turn, the app saves everything not yet saved, including words waiting in an editor, so Claude reads the current page.
- **The prompt the app sends:**
  - the owner's message
  - a "References" section listing each attached page by its path relative to the workspace (Claude reads the files itself)
  - the open page marked as "the page open now"
  - selected text quoted in full
- **Workspace guide (appended to the system prompt):**
  - this is a Quest Notebook workspace
  - read `README.md` for the format before editing
  - keep page JSON valid
  - give new pages new ids, or leave the id out so the app adds one
  - drawings follow the README's SVG rules
  - never touch `.quest/`
  - answer in plain language
  - mention pages by title
- **How undo knows what changed:** main already sees every outside change to the workspace, with each file's text before and after. While a turn runs, changes outside the app are counted as Claude's.
  - For each file, main keeps its text just before Claude's first write to it, or notes that the file didn't exist.
  - Edits the owner makes go through the app's own saves and are never counted as Claude's.
  - If the owner saves that file during the turn, undo treats it as "changed since" and asks first.
  - Undo writes the "before" text back through the normal save path. Created files go to the Trash.
- **Showing actions:** the tool lines come from the stream's tool-use events: Read, Edit and Write with file paths shown as page titles, Glob and Grep as "Searched…". A path that belongs to a page links to it.
- **Chat file format:** `.quest/chats/<id>.json` holds:
  - id, title (Claude's first reply, cut to 60 characters, or the owner's first message), created and updated
  - Claude Code session id
  - messages: role, text, references, actions and the files changed with their "before" texts for undo
  - It's readable JSON like the rest of the workspace. The watcher already ignores `.quest/state.json`; chats are ignored the same way.
- **Markdown:** `react-markdown` (MIT), with raw HTML turned off.
- **Model:** Claude Code's default model. No picker for now.
- **Look:** the panel uses the app's tokens and fonts, and the chat text uses the interface font. Claude's replies go on the paper colour; the owner's messages on a light highlighter tint.
- **Busy rule:** one turn at a time. While a turn runs, the message box can be typed in but not sent.

## Left to the builder

- Component structure, the IPC channel names, and how events are batched to the renderer.
- How the `@` picker reuses the existing link-menu code.
- The empty, loading and error layouts, within the app's look.
- The exact wording of the workspace guide, within the points above.

## How we'll know it works

1. Cmd+J opens the panel beside the page.
2. Ask "Summarize this page" on *Support and resistance*:
   - the reply streams in
   - a "Read *Support and resistance*" line appears
   - Stop works mid-reply
3. Ask "Add a checklist of what to watch to this page": the page is locked with the bar while Claude works and updates live, and the reply lists *Support and resistance* as edited. Undo restores the file exactly, byte for byte.
4. Type `@wee`, pick *Weekly levels*, ask a question about both pages: Claude reads both.
5. Ask it to create a lesson page: it appears in the sidebar, and Undo moves it to the Trash.
6. Quit and relaunch: the chat is in the list, and continuing it remembers the earlier messages.
7. With `ANTHROPIC_API_KEY` set in the app's environment, the CLI still runs on the subscription, shown in the init event or `/status` output.
8. Rename `claude` out of the PATH: the panel shows the install help. Claude can't write outside the workspace or run commands; an attempt is refused and shown as such.
9. `npm test`, typecheck and build pass. Typing in a page while Claude streams stays smooth.

## Changed while building (22 Oct 2026)

What the experiments, reviews and the live check changed in the design above:

- **Permissions:**
  - Default permission mode with command-line allow and deny rules, never `acceptEdits`. In the experiment, `acceptEdits` with a deny-rules settings file let Claude write the README, `.quest/workspace.json` and a top-level file. The default mode refuses anything not allowed.
  - `--strict-mcp-config` keeps the account's claude.ai connectors out.
  - The message goes last, after `--`, because a message starting with `-` was read as an option.
- **Environment:** besides `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`, the CLI's environment drops `ANTHROPIC_BASE_URL` and every `CLAUDE*` variable except `CLAUDE_CONFIG_DIR`. An app started from inside Claude Code inherits variables that would put the CLI in bare mode or send it through a proxy. `PATH` starts with the folder `claude` was found in, so an npm-installed CLI finds `node`.
- **New spaces:** the allow rules can't tell an existing space folder from a new one, so Claude can create a page in a new top-level folder, which becomes a new space. The app records it, and undo removes that folder too when it's left empty. A space that existed before the turn is never removed.
- **What a reply records:**
  - Only files Claude itself edited or wrote in that turn, plus the page the app writes for a new folder Claude made. A sync client or another editor changing files during a turn isn't recorded as Claude's.
  - When the app then tidies a page Claude wrote (filling in a missing field, or moving inline drawing strokes to their file), that tidy-up counts as part of Claude's change, so undo doesn't ask about it. An edit by the owner still makes undo ask.
- **Stopping and closing:**
  - Stop sends SIGINT, then SIGTERM, then SIGKILL, a few seconds apart. Pressing Stop twice sends SIGKILL at once.
  - Switching workspace or quitting mid-turn stops the CLI. It also saves the reply so far, with what it changed, into that workspace's chat, so it can still be undone.
- **Chats:**
  - A chat keeps Claude's session id only after a reply that succeeded.
  - If Claude no longer has that session, the next message starts a fresh one instead of failing again.
  - Session ids in chat files must be UUIDs, so a hand-edited chat can't pass options to the CLI.
- **Undo** saves the window's pending edits first, so a word typed just before Undo is seen as a change and Undo asks.
- **While Claude works on a page,** its Delete button is disabled too.
- **Quick actions** send at once. A pencil button beside each puts the text in the message box to edit first.
