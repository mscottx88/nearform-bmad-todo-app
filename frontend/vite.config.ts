/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Story 1.5: Playwright lives in `e2e/` and uses `.spec.ts`, the
    // same extension Vitest collects by default. Exclude the folder
    // so `npx vitest run` skips Playwright tests instead of trying
    // to load them as unit tests (Playwright's `test` import is
    // incompatible with Vitest's runner).
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Story-level success-criterion gate: ≥70% meaningful coverage.
      // Set on lines + statements + functions; branches set lower
      // because R3F + Three.js scene branches are visual-effect
      // toggles that aren't worth driving from unit tests.
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 60,
      },
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
})
