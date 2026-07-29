import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// A project GitHub Pages site is served from /<repo>/, so the base path must match. Override with
// BASE_PATH=/ for a user/organisation site or a custom domain.
const base = process.env.BASE_PATH ?? '/x-editor/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  build: { target: 'es2022', sourcemap: true },
});
