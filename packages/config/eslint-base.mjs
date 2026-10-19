import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

/**
 * Shared base flat-config array for every TypeScript app in the workspace.
 * Apps extend this with their own framework-specific config (Nest, Next)
 * and their own `parserOptions.project`/`ignores`.
 */
export const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // .cjs files are deliberately CommonJS by extension (e.g. shared
    // .prettierrc.cjs config files using `require`) — not app source.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    ignores: ['dist/**', 'build/**', '.next/**', '.turbo/**', 'node_modules/**', 'coverage/**'],
  },
];

export default baseConfig;
