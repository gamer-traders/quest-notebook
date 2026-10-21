import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export interface LocateOptions {
  configured?: string;
  shellLookup: () => Promise<string | null>;
  exists: (p: string) => Promise<boolean>;
  home: string;
}

/** Where the claude CLI lives: the configured path, the login shell's answer, then the usual install spots. */
export async function locateClaude(opts: LocateOptions): Promise<string | null> {
  if (opts.configured && (await opts.exists(opts.configured))) return opts.configured;
  // An alias or shell function prints something that isn't a file, so the answer must exist.
  const fromShell = await opts.shellLookup();
  if (fromShell && (await opts.exists(fromShell))) return fromShell;
  const candidates = [join(opts.home, '.local/bin/claude'), join(opts.home, '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  for (const candidate of candidates) if (await opts.exists(candidate)) return candidate;
  return null;
}

/** A file that exists and can be run or read, for `locateClaude`'s `exists`. */
export async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Asks the login shell where `claude` is, because an app launched from Finder doesn't get the PATH of a terminal.
 * Null on timeout, a failed exit, or output that isn't an absolute path.
 */
export function loginShellLookup(shell: string = process.env.SHELL ?? '/bin/zsh', timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(shell, ['-lc', 'command -v claude'], { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout) => {
      if (error) return resolve(null);
      // Login shells may print banners first, so the answer is the last non-empty line.
      const last = stdout.split('\n').map((l) => l.trim()).filter(Boolean).pop();
      resolve(last && isAbsolute(last) ? last : null);
    });
  });
}
