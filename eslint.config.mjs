import js from '@eslint/js';
import globals from 'globals';
import { globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...nextVitals,
  {
    files: ['server/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  globalIgnores(['.next/**', 'node_modules/**', 'out/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts']),
];

export default config;
