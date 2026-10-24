import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '#root': new URL('./src', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['src/integration/**/*.test.ts'],
    testTimeout: 20000,
  },
})
