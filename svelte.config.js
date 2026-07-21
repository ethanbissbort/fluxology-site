import { vitePreprocess } from '@astrojs/svelte';

export default {
  // Enables TypeScript, PostCSS, and other preprocessing in .svelte files.
  preprocess: vitePreprocess(),
};
