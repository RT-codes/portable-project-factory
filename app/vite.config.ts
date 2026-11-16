import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { defineConfig } from 'vite'

// The page of the desktop app (dist-desktop/), loaded by electron/main.ts.
export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  base: './',
  resolve: { alias: { $lib: path.resolve('./src/lib'), $shared: path.resolve('./shared') } },
  // the whole Lucide set is one lazy chunk so any icon name in a pipeline's config works
  build: { outDir: 'dist-desktop', chunkSizeWarningLimit: 4000 },
})
