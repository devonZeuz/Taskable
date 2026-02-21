import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/app/services/**/*.ts'],
    },
    projects: [
      {
        test: {
          name: 'client',
          globals: true,
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
          exclude: ['tests/server/**/*.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'server',
          globals: true,
          environment: 'node',
          include: ['tests/server/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
