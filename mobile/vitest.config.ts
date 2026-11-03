import { defineConfig } from 'vitest/config';

// Unit tests for the app's pure modules. The engine itself (parsing, store, sync) is tested in
// packages/core against real SQLite; screens are verified by bundling and running the app.
export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
