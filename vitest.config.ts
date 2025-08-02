/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/integration/**',
    ],
    setupFiles: ['./test/setup.ts'],
    coverage: {
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['lib/**/*.ts', 'api/**/*.ts'],
      exclude: [
        'lib/**/*.d.ts',
        'lib/**/*.test.ts',
        'lib/**/*.spec.ts',
        'test/**/*',
        'dist/**/*',
        '**/*.config.*',
        '**/node_modules/**',
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70,
        },
      },
    },
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './lib'),
      '@test': resolve(__dirname, './test'),
    },
  },
});
