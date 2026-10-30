import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sourceRoot = fileURLToPath(new URL('./src/', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': sourceRoot },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/ui/setup.mjs'],
    include: ['tests/ui/**/*.test.mjs'],
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
