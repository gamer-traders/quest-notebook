import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const alias = { '@shared': resolve(import.meta.dirname, 'src/shared') };

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.binance.com https://data-api.binance.vision",
].join('; ');

/** The built app gets a content security policy. The dev server's hot reload needs inline scripts, so it goes without. */
const contentSecurityPolicy = (): Plugin => ({
  name: 'quest-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  main: {
    resolve: { alias },
  },
  preload: {
    resolve: { alias },
    // A sandboxed preload runs as a classic script, so it can't be an ES module.
    build: { rolldownOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } },
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), contentSecurityPolicy()],
    server: { port: 5183 },
  },
});
