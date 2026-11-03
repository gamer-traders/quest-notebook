/*
  The languages a code block offers, and the Monaco language that colours each. A page file keeps a code
  block's language as it was written ("py", "bash", or one the list doesn't have), so these only read it.
*/

export interface CodeLanguage {
  /** What the picker writes to the page. */
  id: string;
  name: string;
  /** Other names it's written as, after ``` or in a page file. */
  aliases: string[];
  /** The Monaco language that colours it. */
  monaco: string;
}

export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: 'text', name: 'Plain text', aliases: ['plaintext', 'plain', 'txt'], monaco: 'plaintext' },
  { id: 'python', name: 'Python', aliases: ['py', 'python3'], monaco: 'python' },
  { id: 'javascript', name: 'JavaScript', aliases: ['js', 'jsx', 'mjs', 'cjs', 'node'], monaco: 'javascript' },
  { id: 'typescript', name: 'TypeScript', aliases: ['ts', 'tsx'], monaco: 'typescript' },
  { id: 'json', name: 'JSON', aliases: ['jsonc', 'json5'], monaco: 'json' },
  { id: 'sql', name: 'SQL', aliases: [], monaco: 'sql' },
  { id: 'shell', name: 'Shell', aliases: ['sh', 'bash', 'zsh', 'shellscript', 'console'], monaco: 'shell' },
  { id: 'yaml', name: 'YAML', aliases: ['yml'], monaco: 'yaml' },
  { id: 'markdown', name: 'Markdown', aliases: ['md'], monaco: 'markdown' },
  { id: 'html', name: 'HTML', aliases: ['htm', 'xhtml'], monaco: 'html' },
  { id: 'css', name: 'CSS', aliases: [], monaco: 'css' },
  { id: 'xml', name: 'XML', aliases: ['svg'], monaco: 'xml' },
  { id: 'rust', name: 'Rust', aliases: ['rs'], monaco: 'rust' },
  { id: 'go', name: 'Go', aliases: ['golang'], monaco: 'go' },
  { id: 'java', name: 'Java', aliases: [], monaco: 'java' },
  { id: 'kotlin', name: 'Kotlin', aliases: ['kt'], monaco: 'kotlin' },
  { id: 'c', name: 'C', aliases: ['h'], monaco: 'c' },
  { id: 'cpp', name: 'C++', aliases: ['c++', 'cc', 'cxx', 'hpp'], monaco: 'cpp' },
  { id: 'csharp', name: 'C#', aliases: ['cs', 'c#'], monaco: 'csharp' },
  { id: 'swift', name: 'Swift', aliases: [], monaco: 'swift' },
  { id: 'ruby', name: 'Ruby', aliases: ['rb'], monaco: 'ruby' },
  { id: 'php', name: 'PHP', aliases: [], monaco: 'php' },
  { id: 'r', name: 'R', aliases: [], monaco: 'r' },
  { id: 'solidity', name: 'Solidity', aliases: ['sol'], monaco: 'sol' },
];

/** The language a name means: its id or one of its aliases, in any case. */
export function codeLanguage(name: string): CodeLanguage | undefined {
  const wanted = name.trim().toLowerCase();
  return CODE_LANGUAGES.find((l) => l.id === wanted || l.aliases.includes(wanted));
}

/** The Monaco language that colours a block of this language. One it doesn't know is plain text. */
export const monacoLanguage = (name: string): string => codeLanguage(name)?.monaco ?? 'plaintext';

/** The language for what's typed after ```: a known one by its id, any other as typed, plain text for none. */
export function typedLanguage(typed: string): string {
  const name = typed.trim();
  return codeLanguage(name)?.id ?? (name || 'text');
}

/** The picker's options and its value. A language the list doesn't have is kept, as its own first option. */
export function languageChoices(language: string): { value: string; options: { value: string; label: string }[] } {
  const options = CODE_LANGUAGES.map((l) => ({ value: l.id, label: l.name }));
  const known = codeLanguage(language);
  if (known) return { value: known.id, options };
  return { value: language, options: [{ value: language, label: language }, ...options] };
}
