import { StrictMode } from 'react';
import type { Root } from 'react-dom/client';
import { App } from './App';
import { applyAppearance } from './lib/appearance';
import { applyTheme, followSystemTheme, useStore } from './store';

// Loaded only once storage holds data in the current shape, because the store reads it on import.

// Set the look before the first render, so nothing flashes and charts read the right colours.
const { appearance, theme } = useStore.getState();
applyAppearance(appearance);
applyTheme(theme);
followSystemTheme();

export function mountApp(root: Root) {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
