// @vitest-environment jsdom
// SettingsDialog.tsx imports the store, which needs a localStorage.
import { afterEach, expect, test } from 'vitest';
import { isSettingsShortcut, onBackdrop, settingsOpener, settingsShortcutLabel } from './SettingsDialog';

afterEach(() => {
  document.body.replaceChildren();
});

const press = (keys: Partial<KeyboardEvent>) => ({ key: ',', code: 'Comma', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...keys });

test('Cmd+, opens Settings on a Mac, and Ctrl+, everywhere else', () => {
  expect(isSettingsShortcut(press({ metaKey: true }), true)).toBe(true);
  expect(isSettingsShortcut(press({ ctrlKey: true }), false)).toBe(true);
  expect(isSettingsShortcut(press({ ctrlKey: true }), true)).toBe(false);
  expect(isSettingsShortcut(press({ metaKey: true }), false)).toBe(false);
  expect(settingsShortcutLabel(true)).toBe('⌘,');
  expect(settingsShortcutLabel(false)).toBe('Ctrl+,');
});

test('a comma typed on the page, other keys and extra modifiers are left alone', () => {
  expect(isSettingsShortcut(press({}), true)).toBe(false);
  expect(isSettingsShortcut(press({ metaKey: true, key: '.', code: 'Period' }), true)).toBe(false);
  expect(isSettingsShortcut(press({ metaKey: true, altKey: true }), true)).toBe(false);
  expect(isSettingsShortcut(press({ metaKey: true, ctrlKey: true }), true)).toBe(false);
  expect(isSettingsShortcut(press({ metaKey: true, shiftKey: true, key: '<' }), true)).toBe(false);
});

test('the comma is known by its character, or by its key when the keyboard layout types another letter there', () => {
  expect(isSettingsShortcut(press({ metaKey: true, code: '' }), true)).toBe(true);
  expect(isSettingsShortcut(press({ metaKey: true, key: 'б' }), true)).toBe(true);
});

test('the ⚙ button that opened Settings gets focus back, even when the click gave it no focus', () => {
  // Safari and Firefox on a Mac don't focus a clicked button, so the focus is still elsewhere.
  const button = document.createElement('button');
  const search = document.createElement('input');
  document.body.append(button, search);
  search.focus();
  expect(settingsOpener(button)).toEqual({ el: button, range: null });
});

test('from the shortcut, the focused page and its caret are kept', () => {
  const page = document.createElement('div');
  page.tabIndex = 0;
  page.textContent = 'Support is a price';
  document.body.append(page);
  page.focus();
  const caret = document.createRange();
  caret.setStart(page.firstChild!, 7);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(caret);

  const opener = settingsOpener(null);
  expect(opener.el).toBe(page);
  expect(opener.range?.startContainer).toBe(page.firstChild);
  expect(opener.range?.startOffset).toBe(7);
});

test('only a press on the dialog itself, outside its box, is on the backdrop', () => {
  const dialog = document.createElement('dialog');
  const option = document.createElement('button');
  dialog.append(option);
  dialog.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 400 }) as DOMRect;
  expect(onBackdrop(dialog, { target: dialog, clientX: 50, clientY: 200 })).toBe(true);
  expect(onBackdrop(dialog, { target: dialog, clientX: 300, clientY: 450 })).toBe(true);
  // Inside the box: the dialog's own edge, not the backdrop.
  expect(onBackdrop(dialog, { target: dialog, clientX: 300, clientY: 200 })).toBe(false);
  // Enter or Space on an option clicks it at 0, 0.
  expect(onBackdrop(dialog, { target: option, clientX: 0, clientY: 0 })).toBe(false);
});
