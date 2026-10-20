/*
  How the app looks: the owner's choices in Settings → Appearance.
  The theme choice may be System, so the theme the app shows is resolved from it and the computer's setting.
  The other choices become data attributes on <html>, and styles.css turns them into spacing, sizes and fonts.
*/

export type ThemeChoice = 'light' | 'dark' | 'system';
export type Density = 'compact' | 'default' | 'comfortable';
export type TextSize = 'small' | 'default' | 'large';
export type PageWidth = 'narrow' | 'default' | 'full';
export type NoteFont = 'serif' | 'sans';

export interface Appearance {
  theme: ThemeChoice;
  density: Density;
  textSize: TextSize;
  pageWidth: PageWidth;
  noteFont: NoteFont;
}

/** Every value each choice can take. */
export const APPEARANCE_VALUES: { [K in keyof Appearance]: readonly Appearance[K][] } = {
  theme: ['light', 'dark', 'system'],
  density: ['compact', 'default', 'comfortable'],
  textSize: ['small', 'default', 'large'],
  pageWidth: ['narrow', 'default', 'full'],
  noteFont: ['serif', 'sans'],
};

export const DEFAULT_APPEARANCE: Appearance = { theme: 'system', density: 'default', textSize: 'default', pageWidth: 'default', noteFont: 'serif' };

export const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The theme to show: Light and Dark are fixed, System follows the computer. */
export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): 'light' | 'dark' {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light';
  return choice;
}

const pick = <K extends keyof Appearance>(key: K, value: unknown): Appearance[K] | undefined =>
  APPEARANCE_VALUES[key].find((v) => v === value);

/**
 * The appearance in saved data, each choice checked on its own: one that can't be read takes its default.
 * Data saved before appearance existed has only the light or dark `theme`, which carries over as the theme choice.
 */
export function appearanceFromSaved(saved: { theme?: unknown; appearance?: unknown }): Appearance {
  const a: Partial<Record<keyof Appearance, unknown>> =
    typeof saved.appearance === 'object' && saved.appearance !== null && !Array.isArray(saved.appearance) ? saved.appearance : {};
  return {
    theme: pick('theme', a.theme) ?? (saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : DEFAULT_APPEARANCE.theme),
    density: pick('density', a.density) ?? DEFAULT_APPEARANCE.density,
    textSize: pick('textSize', a.textSize) ?? DEFAULT_APPEARANCE.textSize,
    pageWidth: pick('pageWidth', a.pageWidth) ?? DEFAULT_APPEARANCE.pageWidth,
    noteFont: pick('noteFont', a.noteFont) ?? DEFAULT_APPEARANCE.noteFont,
  };
}

/** The attributes <html> carries for the choices. The theme isn't one: `data-theme` holds the resolved theme. */
export function appearanceAttributes(a: Appearance): Record<string, string> {
  return {
    'data-density': a.density,
    'data-text-size': a.textSize,
    'data-page-width': a.pageWidth,
    'data-note-font': a.noteFont,
  };
}

export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement) {
  for (const [name, value] of Object.entries(appearanceAttributes(a))) root.setAttribute(name, value);
}
