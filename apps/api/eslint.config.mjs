import { baseConfig } from '../../packages/config/eslint-base.mjs';

export default [
  ...baseConfig,
  {
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
  {
    ignores: ['dist/**'],
  },
];
