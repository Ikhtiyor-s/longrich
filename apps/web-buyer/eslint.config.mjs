import { FlatCompat } from '@eslint/eslintrc';
import { baseConfig } from '../../packages/config/eslint-base.mjs';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  ...baseConfig,
  ...compat.extends('next/core-web-vitals'),
  { ignores: ['next-env.d.ts'] },
];

export default config;
