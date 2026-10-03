import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost:5173' } },
    setupFiles: ['tests/setup.js'],
    globalSetup: ['tests/globalSetup.js'],
    include: ['tests/**/*.test.js'],
    server: { deps: { inline: ['vuetify'] } },
    css: false,
    testTimeout: 60000,
  },
});
