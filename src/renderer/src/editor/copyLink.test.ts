// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { linkClipboard, linksInPastedHTML } from './copyLink';

test('linkClipboard makes a [[Title]] text and a tagged span', () => {
  expect(linkClipboard('sr', 'Support and resistance')).toEqual({
    text: '[[Support and resistance]]',
    html: '<span data-notebook-link="sr">[[Support and resistance]]</span>',
  });
  // The title and the id can't break out of the span.
  expect(linkClipboard('a"b', 'P&L <today>').html).toBe('<span data-notebook-link="a&quot;b">[[P&amp;L &lt;today&gt;]]</span>');
});

test('linksInPastedHTML finds the tagged notebook ids', () => {
  // As a browser hands it over: wrapped, and with more around it.
  const html =
    '<meta charset="utf-8"><span data-notebook-link="sr">[[Support and resistance]]</span> and ' +
    "<span data-notebook-link='btc'>[[Bitcoin, big picture]]</span>";
  expect(linksInPastedHTML(html)).toEqual(['sr', 'btc']);
  expect(linksInPastedHTML(linkClipboard('a"b', 'P&L').html)).toEqual(['a"b']);
  expect(linksInPastedHTML('<p>No links here</p>')).toEqual([]);
  expect(linksInPastedHTML('<span data-notebook-link="">[[x]]</span>')).toEqual([]);
  expect(linksInPastedHTML('')).toEqual([]);
});
