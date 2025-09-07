import { defineConfig } from 'vite'

// If deploying to GitHub Pages at https://<user>.github.io/<repo>/,
// set base to '/<repo>/' so assets resolve correctly.
// We'll replace this dynamically in the workflow if needed.

export default defineConfig({
  base: process.env.VITE_BASE || '/',
});


