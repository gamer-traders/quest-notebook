import { expect, test } from 'vitest';
import type { Inline, NotebookLinkInline, StyledText } from '../page/blockTypes';
import { KEPT_STYLES, inlineToMarkup, markupToInline, normalizeInline } from './inline';

const t = (text: string, styles: StyledText['styles'] = {}): StyledText => ({ type: 'text', text, styles });
const none = () => '';
/** Writes a page link with the text it was read with, as the app does for a link to a missing page. */
const asTarget = (link: NotebookLinkInline) => link.props.target ?? '';
const roundTrip = (runs: Inline[]) => markupToInline(inlineToMarkup(runs, asTarget));

test.each<[string, Inline[]]>([
  ['**b**', [t('b', { bold: true })]],
  ['*i*', [t('i', { italic: true })]],
  ['<u>u</u>', [t('u', { underline: true })]],
  ['~~s~~', [t('s', { strike: true })]],
  ['`c`', [t('c', { code: true })]],
  ['==h==', [t('h', { backgroundColor: 'yellow' })]],
  ['=={blue}h==', [t('h', { backgroundColor: 'blue' })]],
  ['plain', [t('plain')]],
])('%s reads as its style and writes back the same', (markup, runs) => {
  expect(markupToInline(markup)).toEqual(runs);
  expect(inlineToMarkup(runs, none)).toBe(markup);
});

test('a sentence mixing styles', () => {
  expect(markupToInline('Buyers at **62k** and ==support==, *maybe*.')).toEqual([
    t('Buyers at '),
    t('62k', { bold: true }),
    t(' and '),
    t('support', { backgroundColor: 'yellow' }),
    t(', '),
    t('maybe', { italic: true }),
    t('.'),
  ]);
});

test('a web link keeps its styled words and its address', () => {
  const link: Inline = { type: 'link', href: 'https://x.io/a_(b)', content: [t('see '), t('this', { bold: true })] };
  expect(inlineToMarkup([link], none)).toBe('[see **this**](https://x.io/a_\\(b\\))');
  expect(roundTrip([link])).toEqual([link]);
});

test('page links read as unresolved targets and write with the text they are given', () => {
  expect(markupToInline('See [[Weekly levels]].')).toEqual([
    t('See '),
    { type: 'notebookLink', props: { notebookId: '', target: 'Weekly levels' } },
    t('.'),
  ]);
  expect(inlineToMarkup([{ type: 'notebookLink', props: { notebookId: 'n1' } }], () => 'Weekly levels')).toBe('[[Weekly levels]]');
  expect(markupToInline('[[Markets/Bitcoin, big picture/Weekly levels]]')).toEqual([
    { type: 'notebookLink', props: { notebookId: '', target: 'Markets/Bitcoin, big picture/Weekly levels' } },
  ]);
});

test('ordinary trading text stays readable', () => {
  const text = '~70k, x = 5, a-b #btc (maybe) <3 50% & more\nnext line';
  expect(inlineToMarkup([t(text)], none)).toBe(text);
  expect(markupToInline(text)).toEqual([t(text)]);
});

test('literal markers are escaped and come back as text', () => {
  for (const s of ['2*3', 'a**b', '`x`', '[[no]]', '==not==', '~~no~~', '<u>no</u>', 'back\\slash', '[x](y)', '=', '~', 'a=', '=={red}x', 'end\\'])
    expect(roundTrip([t(s)])).toEqual([t(s)]);
});

test('style changes between neighbours', () => {
  const runs = [
    t('a', { italic: true }),
    t('b', { bold: true }),
    t('c', { bold: true, italic: true }),
    t('d', { backgroundColor: 'yellow' }),
    t('e', { backgroundColor: 'red' }),
    t('f', { code: true }),
    t('g', { strike: true, underline: true }),
  ];
  expect(roundTrip(runs)).toEqual(runs);
});

test('code inside other marks is plain code, and a link’s words are never code: the editor holds neither', () => {
  expect(markupToInline('**Meal 1 (`~600 kcal` | ==`50g P`==)**')).toEqual([
    t('Meal 1 (', { bold: true }),
    t('~600 kcal', { code: true }),
    t(' | ', { bold: true }),
    t('50g P', { code: true }),
    t(')', { bold: true }),
  ]);
  expect(markupToInline('[see `docs`](https://a.io)')).toEqual([{ type: 'link', href: 'https://a.io', content: [t('see docs')] }]);
  expect(normalizeInline([t('x', { code: true, italic: true, strike: true, underline: true, backgroundColor: 'green' })])).toEqual([t('x', { code: true })]);
});

test('code keeps everything inside it literal', () => {
  const runs = [t('a*b ==c== [[d]] `e` \\f', { code: true })];
  expect(roundTrip(runs)).toEqual(runs);
});

test('styles the file format has no room for are dropped', () => {
  expect(normalizeInline([t('x', { textColor: 'red', bold: true, backgroundColor: 'default' })])).toEqual([t('x', { bold: true })]);
  expect(normalizeInline([t('a', { bold: true }), t('b', { bold: true }), t('')])).toEqual([t('ab', { bold: true })]);
});

/** A small seeded random generator, so a failing case can be replayed. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomRuns(count: number, seed: number): Inline[][] {
  const rand = prng(seed);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const alphabet = 'ab *~=[]`<u>/\\\n#(){}';
  const colors = ['yellow', 'blue', 'green', 'red', 'purple', 'gray'];
  const text = () => Array.from({ length: 1 + Math.floor(rand() * 6) }, () => pick([...alphabet])).join('');
  const styles = () => {
    const out: StyledText['styles'] = {};
    for (const key of KEPT_STYLES) {
      if (rand() < 0.3) out[key] = key === 'backgroundColor' ? pick(colors) : true;
    }
    return out;
  };
  return Array.from({ length: count }, () =>
    Array.from({ length: 1 + Math.floor(rand() * 5) }, (): Inline => {
      const roll = rand();
      if (roll < 0.1) return { type: 'notebookLink', props: { notebookId: '', target: pick(['Notes', 'Markets/Notes', 'A b']) } };
      if (roll < 0.2) return { type: 'link', href: pick(['https://a.io', 'https://b.io/x_(y)']), content: [t(text().replace(/\n/g, ' ') || 'x', styles())] };
      return t(text(), styles());
    }),
  );
}

test('random runs round-trip', () => {
  for (const runs of randomRuns(800, 42)) {
    expect(roundTrip(runs), JSON.stringify(runs)).toEqual(normalizeInline(runs));
  }
});
