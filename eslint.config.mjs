import { baseConfig } from './packages/config/eslint-base.mjs';

// Lints root-level config files only; every app/package under apps/* and
// packages/* owns its own eslint.config.mjs (run via `turbo run lint`).
export default [
  ...baseConfig,
  {
    ignores: ['apps/**', 'packages/**'],
  },
];
