// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

import tailwindcss from '@tailwindcss/vite';

// Prevent Node.js from crashing on ReadableStream errors (Node 22 issue with undici)
process.on('uncaughtException', (err) => {
  if (err.code === 'ERR_INVALID_STATE' && err.message?.includes('ReadableStream')) {
    console.warn('Caught ReadableStream error (non-fatal):', err.message);
    return;
  }
  console.error('Uncaught exception:', err);
  process.exit(1);
});

// https://astro.build/config
export default defineConfig({
  output: 'server',
  integrations: [react()],

  vite: {
    plugins: [tailwindcss()],
  },
});