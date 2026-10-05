/// <reference types="vitest" />
import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages under any repo name.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
  // Full simulated matches take a few seconds each.
  test: { testTimeout: 60000 },
});
