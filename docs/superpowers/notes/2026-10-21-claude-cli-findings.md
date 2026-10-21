# What the claude CLI (2.1.288) does on this Mac: findings

Recorded 2026-10-22 from real runs on the owner's Max subscription (`claude auth status`:
loggedIn true, authMethod "claude.ai", subscriptionType "max"). About 6 short runs, all in a scratch
workspace. Fixtures are in `src/main/claude/__fixtures__/`; the rules that work are in
`src/main/claude/permissions.json`.

Fixtures: `read-and-edit.jsonl` (read + edit + create SVG), `denied.jsonl` (the default-mode denial
run), `resume.jsonl` (second turn with `--resume`). They are the full stdout, untrimmed. The scratch
root was rewritten: `<scratchpad>/cli-lab/ws` -> `/WS`, `<scratchpad>/cli-lab` -> `/LAB` (so the
file outside the workspace is `/LAB/outside.json`). Path fragments split across `input_json_delta`
events (`"e/scratchpad/"`) were left as they are. Scrubbed: nothing needed it. No email, organisation
name or org/account UUID appears in the three fixtures (grepped); those only appear in
`claude auth status` output and in a SessionStart hook output, which are not committed. The
uuid/session ids in the fixtures are kept. Never commit `auth status` output: it contains the email
and orgId.

## Result in one paragraph

Use default permission mode with command-line allow and deny rules, plus `--restricted`:

    claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages \
      --restricted --tools Read,Glob,Grep,Edit,Write \
      --permission-mode default \
      --allowedTools Read Glob Grep "Edit(/*/**/*.json)" "Edit(/*/**/drawing-*.svg)" \
      --disallowedTools "Edit(/.quest/**)"

with the workspace folder as the working directory, stdin closed (`< /dev/null`), and
`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` unset. Do not use `acceptEdits` plus a `--settings`
deny file: it leaked (see Permissions).

## Process and flags

- Stdin: if it is not redirected the CLI waits 3 s and warns on stderr ("no stdin data received in
  3s"). Spawn with stdin `ignore`d.
- `--verbose` is needed for stream-json in `-p`. `--include-partial-messages` adds the `stream_event`s.
- Exit code: only recorded for the SIGINT run (0, normal completion). Failed auth gave 1 earlier. Exit codes of the other runs were not captured; assume 0 on a `result` with `is_error:false`.
- Cost/time seen: a first turn is about 12 s; `--resume` second turn 2 s.
- Each first turn created about 110k-330k cache tokens (the user's skills, plugins, hooks, and
  system prompt), `total_cost_usd` ~1-2.6 for a tiny prompt. It is a subscription, but the usage
  shows up as 5-hour/7-day window utilisation (see `rate_limit_event`). Keep prompts small.
- The user's own setup is loaded in `-p`: the `slash_commands`, `skills`, `plugins`, `agents` lists in
  init come from the user's setup, and in the no-api-key run (which had no `--include-partial-messages`,
  `--restricted` or `--tools`) SessionStart hooks ran: `system/hook_started` / `hook_response` events,
  with the superpowers plugin injecting a large `additionalContext`. No hook events appear in the three
  committed fixtures, so whether hooks ran in the restricted runs is not known from the stream. Recommendation (not tested): add
  `--strict-mcp-config` (with no `--mcp-config`, so no MCP servers load; the claude.ai connector
  servers asana/atlassian/... otherwise show up as "need authorization" in the model's reply text: the
  denied-accept and sigint runs ended with a paragraph about the Atlassian Rovo and Google Calendar
  connectors) and consider `--setting-sources` (to limit user/project settings and hooks, e.g.
  `--setting-sources project` or an empty value). Whether these flags suppress the hooks and connector
  notices must be tested before relying on them. The init `mcp_servers` was `[]` in every run, so
  the notice appears in the model's text only.

## Event types seen

Each line is one JSON object with `type`:

| type | subtype / inner type | notes |
|---|---|---|
| `system` | `init` | once, first line |
| `system` | `status` | `{"status":"requesting"}` before each model request |
| `system` | `thinking_tokens` | `estimated_tokens`, `estimated_tokens_delta`; thinking text is not sent |
| `system` | `commands_changed` | big slash-command list; ignore |
| `system` | `permission_denied` | `tool_name`, `tool_use_id`, `message` (see Denials) |
| `system` | `hook_started` / `hook_response` | seen only in the no-api-key run (flags differed); ignore |
| `stream_event` | `event.type`: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop` | the raw API stream |
| `assistant` | | one complete message per content block (not per message) |
| `user` | | tool results |
| `rate_limit_event` | | `rate_limit_info.status` "allowed", `rateLimitType` "five_hour", `unifiedWindows` |
| `result` | `success` | last line |

Unknown types must be ignored by the parser. All events but `rate_limit_event`/`system` carry
`session_id`; `stream_event`/`assistant`/`user` carry `parent_tool_use_id` (null here).

### init

    {"type":"system","subtype":"init","cwd":"/WS","session_id":"e607f87c-...","tools":["Edit","Glob","Grep","Read","Write"],
     "mcp_servers":[],"model":"claude-opus-5-5","permissionMode":"default","apiKeySource":"none",
     "claude_code_version":"2.1.288","slash_commands":[...],"skills":[...],"plugins":[...],"agents":[...],"output_style":"default", ...}

- `tools` is exactly the `--tools` list (alphabetical): Bash is absent, no Task/WebFetch/etc.
- `permissionMode` echoes `--permission-mode`.
- `apiKeySource` is `"none"` on a subscription login. It does not say "subscription"; "none" with
  `loggedIn:true` from `claude auth status` is the subscription case. No-api-key run: see below.
- `session_id` is the id for `--resume`.
- The `model` was `claude-opus-5-5` (the user's default); pass `--model` to choose.

### Streaming text and tool input

Text deltas (the stream you show live):

    {"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"I added the"}},"session_id":"...","parent_tool_use_id":null,"uuid":"..."}

Block starts:

    ..."event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}
    ..."event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01...","name":"Read","input":{},"caller":{"type":"direct"}}}
    ..."event":{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}  (text blocks)

Other deltas: `thinking_delta` (`thinking` is an empty string; only `estimated_tokens`),
`signature_delta`, and `input_json_delta` (`partial_json`, a fragment of the tool input JSON; the
first one is `""`). `index` is the content-block index within one message; it restarts at 0 for each
model message. `message_delta` carries `delta.stop_reason` ("tool_use" or "end_turn") and cumulative
`usage`.

Recommendation for the parser: show text from `text_delta`; take tool calls from the complete
`assistant` events (so you do not have to assemble `input_json_delta`); one turn is several model
messages (tool_use -> tool_result -> more text).

### assistant (complete blocks)

    {"type":"assistant","message":{"model":"claude-opus-5-5","id":"msg_...","role":"assistant",
      "content":[{"type":"tool_use","id":"toolu_01WHK...","name":"Edit",
        "input":{"replace_all":false,"file_path":"/WS/Markets/A.json","old_string":"...","new_string":"..."},
        "caller":{"type":"direct"}}],"stop_reason":null,"usage":{...}},"parent_tool_use_id":null,"session_id":"...","uuid":"..."}

- Each content block gets its own `assistant` event (same `message.id`, so one model message can
  appear as separate events for `thinking`, `text`, `tool_use`). `thinking` blocks have `thinking:""`.
- Tools used: `Read` (`file_path`), `Edit` (`file_path`, `old_string`, `new_string`, `replace_all`),
  `Write` (`file_path`, `content`).
- **`input.file_path` is absolute** (`/WS/Markets/A.json` in the fixtures; the real cwd-based path
  live), even when the prompt said `Markets/A.json`. The panel must make it relative to the
  workspace root (and be ready for the realpath: the cwd was `/private/tmp/...`, and the model used
  that same form).
- A text block: `{"type":"text","text":"I added the ..."}` (the full final text).
- Edits of a page are plain `Edit` calls on the JSON text (the model does string replacement on the
  JSON file), so after a run the page file must be re-read from disk; do not rely on event contents.

### user (tool results)

Success:

    {"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01WHK...","type":"tool_result",
      "content":"The file /WS/Markets/A.json has been updated successfully. (file state is current ...)"}]},
     "tool_use_result":{"filePath":"/WS/Markets/A.json","oldString":"...","newString":"...","originalFile":"...","structuredPatch":[...],...}, ...}

Read results: `content` is cat -n text (`"1\t# Test workspace..."`); `tool_use_result` is
`{"type":"text","file":{"filePath","content","numLines","startLine","totalLines"}}`. A Write that
creates a file: `content` "File created successfully at: ...", `tool_use_result` has `"type":"create"`.

Error (denial or failure): the tool_result block has `"is_error":true`, `content` is a message, and
`tool_use_result` is a string `"Error: ..."`. `tool_use_result` is an object on success and a string
on error, so check its type.

### result (last line)

    {"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed","stop_reason":"end_turn",
     "result":"I added the \"Hello from Claude.\" paragraph block ...","session_id":"e607f87c-...",
     "num_turns":4,"duration_ms":12458,"total_cost_usd":2.63,"permission_denials":[],
     "usage":{"input_tokens":6,"cache_creation_input_tokens":326032,"cache_read_input_tokens":12631,"output_tokens":935,...},
     "modelUsage":{...},"uuid":"..."}

- `subtype` is "success" even when `is_error` is true (auth failure): test `is_error`.
- `result` is the final text. `terminal_reason` was "completed" (and "api_error" on auth failure).
- `permission_denials` is an array of `{tool_name, tool_use_id, tool_input}`; empty on success.
- `usage` is cumulative for the turn, with `input_tokens` tiny and the bulk in cache fields.

## Permissions

Goal: editing `Markets/A.json` and creating `Markets/A/drawing-x1.svg` succeed; editing
`README.md`, `.quest/workspace.json`, creating a top-level `New.txt`, and writing `../outside.json`
are refused; no shell.

### Works: default mode with CLI allow/deny rules (candidate a)

Flags are in the Result paragraph and `permissions.json`.

`read-and-edit.jsonl`: `Edit(/*/**/*.json)` allowed the Edit on `Markets/A.json`, and the
`Edit(/*/**/drawing-*.svg)` allow rule also covered the `Write` tool creating
`Markets/A/drawing-x1.svg` (the `Edit(...)` rule applies to the file-writing tools as a group, Write
included). `permission_denials` was `[]`.

`denied.jsonl` (the same flags, asked to try five forbidden things):

| attempt | outcome |
|---|---|
| Edit `README.md` | refused. tool_result error: "Claude requested permissions to write to /WS/README.md, but you haven't granted it yet." `tool_result_meta`: `non_execution_kind:"user-rejected"`. A `system/permission_denied` event too. (There is no prompt in `-p`, so anything not allowed is refused.) |
| Edit `.quest/workspace.json` | refused by the deny rule. tool_result error: `<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>`. No `system/permission_denied` event, but it is listed under `result.permission_denials`. |
| Write new `New.txt` | refused like README ("...but you haven't granted it yet."), `permission_denied` event |
| Write `../outside.json` | The model first got "File has not been read yet" from Write (the file exists), then tried Read: refused by `--restricted`: "/LAB/outside.json is outside /WS; --restricted confines the file tools to the working directory." (`non_execution_kind:"permission-rule"`, `permission_denied` event) |
| `ls` in a shell | no shell tool exists (Bash is not in `tools`); the model said so and made no call |

The `result` event lists the four refusals in `permission_denials` and has `is_error:false`: a
refusal does not fail the turn; the model just reports it. Files on disk were not changed (checked).

### Rule syntax that worked

- Rules passed on the command line are `Tool(pattern)`. A leading `/` is relative to the working
  directory (the workspace root): `Edit(/*/**/*.json)` matched `Markets/A.json`, so `**` matches zero
  directories and `/*/` is one top-level folder (a space), `Edit(/.quest/**)` matched
  `.quest/workspace.json`.
- Deny beats allow: `.quest/workspace.json` also matches `Edit(/*/**/*.json)` and was refused.
- The top-level `README.md` and `New.txt` match no allow rule, so they are refused in default mode.
- Caveat for the app: top-level JSON files at the workspace root would not match `/*/**/*.json`
  (there is no folder), good; but any `*.json` in any space folder at any depth is allowed, and so
  are non-page JSON files. Page ids are not enforced by the rules.
- A drawing in the space folder directly (`Markets/drawing-x.svg`) matches too (`**` is zero dirs);
  not tested, inferred.

### Does not work: acceptEdits + `--settings` deny file (candidate b), LEAKED

`--permission-mode acceptEdits --settings accept-deny.json` with
`{"permissions":{"deny":["Edit(/.quest/**)","Edit(/*.md)","Edit(/*.json)","Edit(/*.txt)"]}}`, same
prompt: README.md was written ("x" appended), `.quest/workspace.json` was changed (name "Lab" ->
"Changed"), `New.txt` was created. Only `../outside.json` was refused, with the message "File is in a
directory that is denied by your permission settings" (not `--restricted`'s message). The likely
reason: in a settings file a leading `/` is anchored at the settings file's own folder (the lab
folder, which holds `outside.json`), not at the cwd, so `/.quest/**` and `/*.md` never matched the
workspace. That is an inference from one run, not tested. Conclusions: do not rely on a settings
file with `/` rules; acceptEdits allows every in-cwd edit, so one mis-anchored deny rule means a
leak. The default-mode allow list fails closed (anything not matched is refused), which is why it is
the chosen design. (If a settings file is ever needed, an absolute `//path` prefix is the documented
form for absolute paths; untested here.)

## --resume

`resume.jsonl`: `claude -p "In one sentence: what did I ask you to do in my first message?" --resume <session_id> <same flags>`
returned the same `session_id` (e607f87c-..., so a resumed session keeps its id) and answered
correctly: the model restated the first message (read A.json, add a second paragraph "Hello from
Claude.", create the SVG, reply in one sentence). `num_turns:1`, 2 s, `permission_denials:[]`. The
init event is the same shape (same flags must be passed again: `permissionMode`, `tools` were
re-applied from the new command line). Mostly cache reads (`cache_read_input_tokens` ~220k).
Resume needs the same cwd (sessions are stored per project directory under `~/.claude/projects`).

## Interrupt (SIGINT)

`sigint.jsonl` / `sigint-exit.txt`: INCONCLUSIVE. The script sent `kill -INT` 4 s in to a
backgrounded process, but a background job started from a non-interactive zsh script runs with
SIGINT ignored, so the CLI never saw it: the turn ran to the end (`result` success, `terminal_reason`
"completed", the whole 300-word essay, `num_turns:2`) and the exit code was 0. So the
"exit code 0 / result present" is the normal completion, not interrupt behaviour. Still to measure
from a real spawn (Node `child.kill('SIGINT')`, which does deliver it): the exit code, whether a
`result` event is emitted, and whether the session can be resumed afterwards. Until then the plan
should treat a stop as "kill the process, then expect either no `result` or one with `is_error`",
and not depend on either.

## Logged out / auth failure

`claude auth status` prints JSON (`--text` for readable). Logged out:
`{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty",...}` (exit 0). Logged in adds
`email`, `orgId`, `orgName`, `subscriptionType`; do not log or fixture it. There is no usable
headless `claude doctor` (`/doctor` is a slash command).

With an expired login (before the owner logged in again), headless stream-json was four events:
`system/init`, `system/status`, an `assistant` event whose model is `<synthetic>` with
`"error":"authentication_failed"` and `"is_api_error_message":true`, text "Failed to authenticate:
OAuth session expired and could not be refreshed", then `result` with `is_error:true`,
`terminal_reason:"api_error"`, exit code 1. A fully logged-out run (`--output-format json`) gave
`result:"Not logged in · Please run /login"`, `is_error:true`, exit 1. The setup state should run
`claude auth status` and check `loggedIn`, and also treat `error === "authentication_failed"` or an
`is_error` result with `terminal_reason:"api_error"` as "log in again" (the user does that in a
terminal: `claude auth login`).

## API key in the environment

`no-api-key.jsonl` (`ANTHROPIC_API_KEY=sk-ant-invalid-test env -u ANTHROPIC_API_KEY claude -p "Say ok."`):
init `apiKeySource:"none"`, the run succeeded on the subscription. Caveat: the script's `env -u`
removes the variable it just set, so this proves only that an unset key gives "none"; it does not
show what happens if a key is present and passed through. Keep unsetting `ANTHROPIC_API_KEY` and
`ANTHROPIC_AUTH_TOKEN` in the spawn environment (and `CLAUDE_CODE_*`, `ANTHROPIC_BASE_URL` set by
host apps) so a key can never silently bill the API. Note this run's file mixes stderr in and has
the hook events; it is not committed because the hook output holds personal context.

## Surprises

- The claude.ai connector and plugin-hook machinery of the user's account loads inside `-p`
  (hooks ran, connector "needs authorization" notices appear in the model's reply). Worth trying
  `--strict-mcp-config` and `--setting-sources` (untested) so the panel is deterministic.
- First turns are costly in cache tokens because of that setup.
- A failed edit does not end the run: the model sees the error, and the result is still
  `is_error:false`. The panel must show denials from `permission_denied` events or
  `result.permission_denials` (the `.quest` denial has no `permission_denied` event, only a
  tool_result error and a `permission_denials` entry), not from `is_error`.
- Edit rules also gate `Write`.
- `Read` is allowed without a path rule but `--restricted` confines it to the cwd.
