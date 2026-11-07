import { defineConfig } from 'vite';
import { createHtmlPlugin } from 'vite-plugin-html';

// Un seul fichier JS en sortie : plus simple à héberger (GitHub Pages, artefact) et à mettre en cache.
export default defineConfig({
  base: './',
  build: {
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      output: {
        codeSplitting: false,
        inlineDynamicImports: true,
      },
    },
  },
  plugins: [createHtmlPlugin()],
});
