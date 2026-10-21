import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { locateClaude, loginShellLookup } from './locate';

const HOME = '/home/me';
const existing = (...paths: string[]) => async (p: string) => paths.includes(p);
const noShell = async () => null;

test('prefers the configured path when it exists', async () => {
  const found = await locateClaude({ configured: '/custom/claude', shellLookup: async () => '/sh/claude', exists: existing('/custom/claude', '/sh/claude'), home: HOME });
  expect(found).toBe('/custom/claude');
});

test('skips a configured path that does not exist', async () => {
  const found = await locateClaude({ configured: '/custom/claude', shellLookup: async () => '/sh/claude', exists: existing('/sh/claude'), home: HOME });
  expect(found).toBe('/sh/claude');
});

test('uses the shell lookup only when the file exists', async () => {
  const found = await locateClaude({ shellLookup: async () => 'claude: aliased to something', exists: existing('/usr/local/bin/claude'), home: HOME });
  expect(found).toBe('/usr/local/bin/claude');
});

test('then the first candidate that exists, in order', async () => {
  const all = [`${HOME}/.local/bin/claude`, `${HOME}/.claude/local/claude`, '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  for (let i = 0; i < all.length; i++) {
    expect(await locateClaude({ shellLookup: noShell, exists: existing(...all.slice(i)), home: HOME })).toBe(all[i]);
  }
});

test('gives null when nothing is found', async () => {
  expect(await locateClaude({ shellLookup: noShell, exists: existing(), home: HOME })).toBeNull();
});

async function script(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'quest-shell-'));
  const path = join(dir, 'fakeshell');
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

test('loginShellLookup takes the last non-empty line, skipping banners', async () => {
  const sh = await script('echo "Welcome back"\necho /opt/x/claude\necho');
  expect(await loginShellLookup(sh)).toBe('/opt/x/claude');
});

test('loginShellLookup gives null on a non-zero exit', async () => {
  const sh = await script('exit 1');
  expect(await loginShellLookup(sh)).toBeNull();
});

test('loginShellLookup gives null when the output is not an absolute path', async () => {
  const sh = await script('echo "claude: aliased to foo"');
  expect(await loginShellLookup(sh)).toBeNull();
});

test('loginShellLookup gives null on timeout', async () => {
  const sh = await script('sleep 5');
  expect(await loginShellLookup(sh, 100)).toBeNull();
});
