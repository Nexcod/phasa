import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Architecture rules from docs/plan.md §3.2, enforced at lint time.
const CONTENT_SCRIPT_FORBIDDEN = [
  {
    group: ['dexie', '**/src/db', '**/src/db/**', '@/src/db', '@/src/db/**'],
    message:
      'IndexedDB lives in the extension origin only. Ask the service worker via src/messaging.',
  },
  {
    group: [
      '**/src/auth',
      '**/src/auth/**',
      '@/src/auth',
      '@/src/auth/**',
      '**/src/ai',
      '**/src/ai/**',
      '@/src/ai',
      '@/src/ai/**',
    ],
    message: 'OpenAI tokens never leave the service worker. Use a messaging method instead.',
  },
];

export default defineConfig(
  {
    ignores: [
      '.output/**',
      '.wxt/**',
      'node_modules/**',
      'data/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    },
  },
  {
    files: ['**/*.tsx', 'src/ui/**/*.ts'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
  {
    files: ['entrypoints/youtube*.content/**', 'entrypoints/youtube*.content.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: CONTENT_SCRIPT_FORBIDDEN }] },
  },
  {
    files: ['scripts/**', 'tests/**', '*.config.{ts,js}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['tests/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // Throwaway phase-0 spike extensions: plain JS loaded unpacked, no build step.
    files: ['spikes/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.webextensions, ...globals.serviceworker },
    },
    rules: { 'no-unused-vars': ['error', { ignoreRestSiblings: true, argsIgnorePattern: '^_' }] },
  },
  prettier,
);
