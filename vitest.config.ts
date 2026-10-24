import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '#root': new URL('./src', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'coverage/**', 'src/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/!(*.test).ts'],
      exclude: ['src/index.ts', 'src/integration/**', 'src/**/*.test.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
})
