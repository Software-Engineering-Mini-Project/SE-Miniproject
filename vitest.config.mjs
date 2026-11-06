import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sourceRoot = fileURLToPath(new URL('./src/', import.meta.url));
const fixturesRoot = fileURLToPath(new URL('./fixtures/', import.meta.url));

export default defineConfig({
  resolve: {
    // Mirrors jsconfig.json paths so modules that import fixtures resolve under Vitest too.
    alias: { '@fixtures': fixturesRoot, '@': sourceRoot },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/ui/setup.mjs'],
    include: ['tests/ui/**/*.test.mjs'],
    // UI tests stub fetch, so they always exercise the HTTP client, even when CI exports
    // NEXT_PUBLIC_API_MODE=mock for the build and the mock E2E run.
    env: { NEXT_PUBLIC_API_MODE: 'http' },
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/components/**/*.jsx', 'src/features/**/*.jsx'],
      exclude: ['src/**/*.css'],
    },
  },
});
