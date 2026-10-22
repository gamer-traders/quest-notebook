import { expect, test } from 'vitest';
import { CODE_LANGUAGES, codeLanguage, languageChoices, monacoLanguage, typedLanguage } from './codeLanguages';

test('a language is found by its id or a common name for it, in any case', () => {
  expect(codeLanguage('python')?.id).toBe('python');
  expect(codeLanguage('py')?.id).toBe('python');
  expect(codeLanguage(' JS ')?.id).toBe('javascript');
  expect(codeLanguage('bash')?.id).toBe('shell');
  expect(codeLanguage('pine')).toBeUndefined();
});

test('each language is coloured by a Monaco language, and one it does not know is plain text', () => {
  expect(monacoLanguage('python')).toBe('python');
  expect(monacoLanguage('ts')).toBe('typescript');
  expect(monacoLanguage('json')).toBe('json');
  expect(monacoLanguage('text')).toBe('plaintext');
  expect(monacoLanguage('pine')).toBe('plaintext');
  expect(monacoLanguage('')).toBe('plaintext');
});

test('ids and names are unique', () => {
  const names = CODE_LANGUAGES.flatMap((l) => [l.id, ...l.aliases]);
  expect(new Set(names).size).toBe(names.length);
});

test('```py names Python by its id; a language it does not know is kept as typed; none is plain text', () => {
  expect(typedLanguage('py')).toBe('python');
  expect(typedLanguage('Python')).toBe('python');
  expect(typedLanguage('pine')).toBe('pine');
  expect(typedLanguage('')).toBe('text');
  expect(typedLanguage('  ')).toBe('text');
});

test("the picker offers the list, shows a known language under its own id, and keeps one it doesn't know", () => {
  const known = languageChoices('py');
  expect(known.value).toBe('python');
  expect(known.options).toEqual(CODE_LANGUAGES.map((l) => ({ value: l.id, label: l.name })));

  const unknown = languageChoices('pine');
  expect(unknown.value).toBe('pine');
  expect(unknown.options[0]).toEqual({ value: 'pine', label: 'pine' });
  expect(unknown.options.slice(1)).toEqual(known.options);
});
