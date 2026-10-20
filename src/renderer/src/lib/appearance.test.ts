import { expect, test } from 'vitest';
import { DEFAULT_APPEARANCE, appearanceAttributes, appearanceFromSaved, resolveTheme, type Appearance } from './appearance';

test('Light and Dark are fixed, and System follows the computer', () => {
  expect(resolveTheme('light', true)).toBe('light');
  expect(resolveTheme('light', false)).toBe('light');
  expect(resolveTheme('dark', true)).toBe('dark');
  expect(resolveTheme('dark', false)).toBe('dark');
  expect(resolveTheme('system', true)).toBe('dark');
  expect(resolveTheme('system', false)).toBe('light');
});

test('the defaults are System, Default, Default, Default and Serif', () => {
  expect(DEFAULT_APPEARANCE).toEqual({ theme: 'system', density: 'default', textSize: 'default', pageWidth: 'default', noteFont: 'serif' });
});

test('with nothing saved, appearance is the defaults', () => {
  expect(appearanceFromSaved({})).toEqual(DEFAULT_APPEARANCE);
});

test('saved data from before appearance keeps its light or dark theme as the choice', () => {
  expect(appearanceFromSaved({ theme: 'dark' })).toEqual({ ...DEFAULT_APPEARANCE, theme: 'dark' });
  expect(appearanceFromSaved({ theme: 'light' })).toEqual({ ...DEFAULT_APPEARANCE, theme: 'light' });
  expect(appearanceFromSaved({ theme: 'sepia' })).toEqual(DEFAULT_APPEARANCE);
  expect(appearanceFromSaved({ theme: 'dark', appearance: null })).toEqual({ ...DEFAULT_APPEARANCE, theme: 'dark' });
});

test('a saved appearance is kept, and its theme choice wins over the resolved theme saved beside it', () => {
  const saved: Appearance = { theme: 'system', density: 'compact', textSize: 'large', pageWidth: 'full', noteFont: 'sans' };
  expect(appearanceFromSaved({ theme: 'dark', appearance: saved })).toEqual(saved);
  expect(appearanceFromSaved({ appearance: { ...saved, density: 'comfortable', textSize: 'small', pageWidth: 'narrow' } })).toEqual({
    ...saved,
    density: 'comfortable',
    textSize: 'small',
    pageWidth: 'narrow',
  });
});

test('invalid saved values fall back to the defaults field by field', () => {
  const garbled = { theme: 'blue', density: 'compact', textSize: 3, pageWidth: null, noteFont: 'sans', extra: true };
  expect(appearanceFromSaved({ appearance: garbled })).toEqual({ ...DEFAULT_APPEARANCE, density: 'compact', noteFont: 'sans' });
  expect(appearanceFromSaved({ appearance: 'compact' })).toEqual(DEFAULT_APPEARANCE);
  expect(appearanceFromSaved({ appearance: ['compact'] })).toEqual(DEFAULT_APPEARANCE);
  expect(appearanceFromSaved({ appearance: { density: 'toString', noteFont: 'constructor' } })).toEqual(DEFAULT_APPEARANCE);
  // An unreadable theme choice falls back as a missing one does: to the saved light or dark theme, then System.
  expect(appearanceFromSaved({ theme: 'dark', appearance: { theme: 'blue' } })).toEqual({ ...DEFAULT_APPEARANCE, theme: 'dark' });
});

test('appearanceAttributes gives the data attributes for <html>, one per choice but the theme', () => {
  expect(appearanceAttributes(DEFAULT_APPEARANCE)).toEqual({
    'data-density': 'default',
    'data-text-size': 'default',
    'data-page-width': 'default',
    'data-note-font': 'serif',
  });
  expect(appearanceAttributes({ theme: 'dark', density: 'compact', textSize: 'large', pageWidth: 'full', noteFont: 'sans' })).toEqual({
    'data-density': 'compact',
    'data-text-size': 'large',
    'data-page-width': 'full',
    'data-note-font': 'sans',
  });
});
