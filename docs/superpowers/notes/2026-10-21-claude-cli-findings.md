# What the claude CLI (2.1.288) does on this Mac: findings

STATUS: PARTIAL. The live experiments (read-and-edit, denial, resume, SIGINT) could not be run,
because the CLI's stored login on this Mac has expired. Nothing below about permissions, deltas,
tool_use shapes, resume or SIGINT is verified. No fixtures were recorded (none were faked).
Re-run Task 1 steps 2 to 4 after the owner runs `claude auth login` in a terminal.

## What was verified

### Logged-out / expired login (Step 5)

`claude auth status` (JSON by default; `--text` and `--json` flags exist) prints, with exit 0:

    {"loggedIn": false, "authMethod": "none", "apiProvider": "firstParty",
     "analyticsDisabled": false, "projectsDirectory": "~/.claude/projects", "configDirectory": "~/.claude"}

The keychain item "Claude Code-credentials" exists, yet the CLI reports loggedIn false, so the OAuth
session is expired and cannot be refreshed. There is no `claude doctor` subcommand output usable
headless (it is an interactive/slash command; `/doctor` appears in slash_commands).

Headless run with an expired login, `claude -p hi --output-format json < /dev/null`, exit code 1:

    {"type":"result","subtype":"success","is_error":true,"terminal_reason":"api_error",
     "result":"Not logged in · Please run /login","api_error_status":null,"num_turns":1,
     "duration_ms":43,"total_cost_usd":0,"session_id":"<uuid>", "usage":{...all zero...}, ...}

Note `subtype` is "success" even though `is_error` is true: the parser must test `is_error`, not subtype.

With `--output-format stream-json --verbose` (run with the sandbox's environment, where an
OAuth refresh is attempted) the stream was exactly four lines:

1. `{"type":"system","subtype":"init", ...}`
2. `{"type":"system","subtype":"status","status":"requesting","session_id":...}`
3. `{"type":"assistant","message":{"model":"<synthetic>","stop_reason":"stop_sequence","content":[{"type":"text","text":"Failed to authenticate: OAuth session expired and could not be refreshed"}], ...},"error":"authentication_failed","is_api_error_message":true,...}`
4. the result event: `is_error:true`, `terminal_reason:"api_error"`, `result` = same text, exit code 1.

So an auth failure shows as an assistant event with `error: "authentication_failed"` (model
`<synthetic>`, zero usage) followed by an error result. In the "not logged in" variant the text is
"Not logged in · Please run /login". The setup state should detect auth by running
`claude auth status` (check `loggedIn`) before the first turn, and also treat `error === "authentication_failed"`
or an `is_error` result with `terminal_reason:"api_error"` as "log in again".

### Init event (from the failed run; shape is the same on success)

Fields seen: `type:"system"`, `subtype:"init"`, `cwd`, `session_id`, `tools` (exactly the
`--tools` list, here `["Edit","Glob","Grep","Read","Write"]` for `--restricted`... see below),
`mcp_servers:[]`, `model` ("claude-opus-5-5"), `permissionMode` ("default" with `--permission-mode default`),
`slash_commands`, `apiKeySource` ("none" with the key env vars unset; it is `"none"` also for OAuth
subscription logins, so it does not by itself prove the subscription), `claude_code_version`,
`agents`, `skills`, `plugins`, `uuid`, `startup_timing`, and more. Nothing in it carries an email or
org id (checked), so nothing needed scrubbing. The `--restricted --tools Read,Glob,Grep,Edit,Write
--settings <file>` flags were accepted without complaint, and `--tools` is reflected exactly.
`--settings` with a permissions block loaded without error.

### Other

- With stdin not a TTY and not redirected, the CLI waits 3 s and prints to stderr
  "Warning: no stdin data received in 3s, proceeding without it...". Spawn with stdin ignored or
  closed (`< /dev/null` / `stdio: ['ignore', ...]`), or write the prompt to stdin and end it.
- Startup took about 3.2 s to `input_ready` in that run (mostly the stdin wait).
- This Mac's session environment injects `ANTHROPIC_BASE_URL` and many `CLAUDE_CODE_*` variables
  (the desktop app host). The app's spawn should build a clean env (HOME, PATH, USER), unset
  `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`, and not inherit `CLAUDE_CODE_*` or `ANTHROPIC_BASE_URL`.
  `env -i HOME PATH claude auth status` gave the same logged-out result.
- `claude auth` has `login`, `logout`, `status`. I did not run login (entering credentials/OAuth is the
  owner's step).

## Not verified (candidate rules to try after login)

Untested candidate from the brief, saved only as an idea, not committed as `permissions.json`:

    {"permissions":{"allow":["Read","Glob","Grep","Edit(/*/**/*.json)","Edit(/*/**/drawing-*.svg)"],
                    "deny":["Edit(/.quest/**)","Bash"]}}

Questions to answer then: does `/*/**/*.json` match `Markets/A.json` (** with zero dirs)? Does it
also match `.quest/workspace.json` (deny must win)? Is `/` relative to the settings file, the cwd
or the filesystem root (Claude docs: `//path` is absolute, `/path` is relative to the project root)?
Is `../outside.json` refused? Are Write calls (new file) governed by the `Edit(...)` rules? What
does a denial look like (expected: a `user` event with a `tool_result` block, `is_error:true`, and
`permission_denials` filled in the result event)?
