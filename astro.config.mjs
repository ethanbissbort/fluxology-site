import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// https://astro.build/config
export default defineConfig({
  integrations: [svelte()],
  output: 'static',
  build: {
    // Custom asset directory (default is '_astro').
    assets: '_assets',
  },
  vite: {
    build: {
      // Drop console/debugger calls from the production client bundle.
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          passes: 2,
        },
      },
    },
  },
});
