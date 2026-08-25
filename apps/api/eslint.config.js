// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // tsconfig.spec.json extends tsconfig.json and only adds things
        // spec files need (jest globals, a broader rootDir) — using it for
        // everything avoids TS6's stricter automatic @types inclusion
        // silently dropping ambient jest/multer types depending on which
        // config eslint happens to resolve for a given file.
        project: './tsconfig.spec.json',
        tsconfigRootDir: __dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
