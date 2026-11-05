import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

/**
 * Architectural boundaries. The dependency graph is strictly one-directional:
 *
 *   shared  <-  engine  <-  ai
 *   server  ->  { engine, ai, shared }
 *   web     ->  shared            (never engine, never ai)
 *
 * `web` is forbidden from importing `engine` so that no rule logic -- and no type
 * describing the full GameState -- can ever reach the browser bundle. The client
 * renders whatever `PlayerView.legalActions` offers and nothing else.
 *
 * `ai` is forbidden from importing anything under `apps/` so it can never reach
 * the server's session store, which is the only place a real GameState lives.
 */
const escapeHatchPatterns = [
  {
    group: ['**/packages/*/src/**'],
    message: 'Import the workspace package by name, not by path.',
  },
  { group: ['**/apps/*/src/**'], message: 'Import the workspace package by name, not by path.' },
];

/** @param {string[]} allowedInternal */
const boundary = (allowedInternal) => {
  const all = ['@truco/shared', '@truco/engine', '@truco/ai', '@truco/server', '@truco/web'];
  const forbidden = all.filter((p) => !allowedInternal.includes(p));
  return {
    'no-restricted-imports': [
      'error',
      {
        paths: forbidden.map((name) => ({
          name,
          message: `Architectural boundary: this package may only import ${allowedInternal.join(', ') || 'nothing internal'}.`,
        })),
        patterns: [
          ...escapeHatchPatterns,
          ...forbidden.map((name) => ({
            group: [`${name}/**`],
            message: `Architectural boundary: this package may only import ${allowedInternal.join(', ') || 'nothing internal'}.`,
          })),
        ],
      },
    ],
  };
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Exhaustive switches, unless an explicit `default` is handling the rest.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },

  // --- Architectural boundaries, per workspace zone ---
  { files: ['packages/shared/**/*.ts'], rules: boundary([]) },
  { files: ['packages/engine/**/*.ts'], rules: boundary(['@truco/shared']) },
  { files: ['packages/ai/**/*.ts'], rules: boundary(['@truco/shared', '@truco/engine']) },
  { files: ['apps/web/**/*.{ts,tsx}'], rules: boundary(['@truco/shared']) },
  {
    files: ['apps/server/**/*.ts'],
    rules: boundary(['@truco/shared', '@truco/engine', '@truco/ai']),
  },

  // The engine is pure: no I/O, no randomness source of its own.
  {
    files: ['packages/engine/src/**/*.ts', 'packages/ai/src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/bench.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Pure package: no I/O allowed.' },
        { name: 'setTimeout', message: 'Pure package: no timers allowed.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the injected Rng instead of Math.random.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^(node:|fs|path|crypto|http|net)/]',
          message: 'Pure package: Node built-ins are not allowed.',
        },
      ],
    },
  },

  // Browser globals for the web app.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },

  // Tests may be looser.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'e2e/**/*.ts', '**/bench.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  prettier,
);
