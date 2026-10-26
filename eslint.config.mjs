import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Flat config. eslint-config-next v16 exports flat-config arrays directly, so
 * no FlatCompat shim is needed.
 */
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**'] },

  ...coreWebVitals,
  ...nextTypescript,

  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // ADR-009 and brief C11: time must be injectable so fixtures and tests
      // can freeze it. systemClock is the single permitted construction site.
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Use the injected Clock port instead of new Date() (src/lib/time.ts).',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Use the injected Clock port instead of Date.now() (src/lib/time.ts).',
        },
      ],
    },
  },

  {
    // Tests and seed data must name concrete markets, times and currencies.
    files: ['src/**/*.test.{ts,tsx}', 'src/db/seed/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];

export default config;
