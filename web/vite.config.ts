import path from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { deckApi } from './server/deckApi.ts';

const root = path.resolve(import.meta.dirname, '..');

export default defineConfig({
  plugins: [
    svelte(),
    deckApi({
      deckDir: path.resolve(process.env.ZOOBRIK_DECK ?? path.join(root, 'decks/english-notebook')),
      coreDir: path.join(root, 'core-templates'),
    }),
  ],
  server: { port: 5173 },
});
