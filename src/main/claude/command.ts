/**
 * The permission flags verified against the CLI (see permissions.json and the findings note).
 * command.test.ts keeps this equal to permissions.json. Default mode refuses anything not allowed, so a
 * mistake here fails closed; never switch to acceptEdits or a --settings deny file, both leaked.
 */
export const PERMISSIONS = {
  permissionMode: 'default',
  tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'],
  allowedTools: ['Read', 'Glob', 'Grep', 'Edit(/*/**/*.json)', 'Edit(/*/**/drawing-*.svg)'],
  disallowedTools: ['Edit(/.quest/**)'],
} as const;

/** The claude arguments for one turn. The prompt goes last, after `--`, so text starting with '-' isn't read as an option. */
export function claudeArgs(p: { prompt: string; sessionId: string | null; guide: string }): string[] {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    ...(p.sessionId ? ['--resume', p.sessionId] : []),
    '--restricted',
    '--strict-mcp-config',
    '--tools', PERMISSIONS.tools.join(','),
    '--permission-mode', PERMISSIONS.permissionMode,
    '--allowedTools', ...PERMISSIONS.allowedTools,
    '--disallowedTools', ...PERMISSIONS.disallowedTools,
    '--append-system-prompt', p.guide,
    '--',
    p.prompt,
  ];
}

/**
 * The child's environment. An app started from inside Claude Code inherits host variables (CLAUDE_CODE_SIMPLE=1 makes the
 * CLI look logged out, a proxy ANTHROPIC_BASE_URL misroutes it), and an API key would bypass the owner's subscription.
 */
export function claudeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (key === 'ANTHROPIC_API_KEY' || key === 'ANTHROPIC_AUTH_TOKEN' || key === 'ANTHROPIC_BASE_URL') continue;
    if (key.startsWith('CLAUDE') && key !== 'CLAUDE_CONFIG_DIR') continue;
    out[key] = value;
  }
  return out;
}

interface PageRef {
  title: string;
  path: string;
}

/** The message plus what the owner attached: pages, then selected text. Empty sections are left out. */
export function buildPrompt(p: { message: string; openPage: PageRef | null; references: PageRef[]; selection: { title: string; text: string } | null }): string {
  const parts = [p.message];
  const refs: string[] = [];
  if (p.openPage) refs.push(`- The page open now: ${p.openPage.title} (${p.openPage.path})`);
  for (const ref of p.references) if (ref.path !== p.openPage?.path) refs.push(`- ${ref.title} (${ref.path})`);
  if (refs.length) parts.push(['References:', ...refs].join('\n'));
  if (p.selection) parts.push([`Selected text from ${p.selection.title}:`, ...p.selection.text.split('\n').map((line) => `> ${line}`)].join('\n'));
  return parts.join('\n\n');
}
