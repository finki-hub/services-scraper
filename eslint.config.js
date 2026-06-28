import {
  base,
  node,
  perfectionist,
  prettier,
  typescript,
  vitest,
} from 'eslint-config-imperium';

const config = [
  { ignores: ['dist/', 'logs/'] },
  ...base,
  node,
  typescript,
  vitest,
  prettier,
  perfectionist,
  {
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['off'],
      'class-methods-use-this': ['off'],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];

export default config;
