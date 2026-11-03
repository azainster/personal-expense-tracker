import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    setupFiles: ['src/__tests__/setup.ts'],
    // Tests never touch the real store, and never make a network call.
    env: {
      DATABASE_PATH: ':memory:',
      LOG_LEVEL: 'error',
      ENABLE_REMOTE_LLM_FALLBACK: 'false',
      TOKEN_ENCRYPTION_KEY: '0'.repeat(64),
      DEFAULT_CURRENCY: 'INR',
    },
  },
});
