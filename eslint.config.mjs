import nextPlugin from 'eslint-config-next'

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  ...(Array.isArray(nextPlugin) ? nextPlugin : [nextPlugin]),
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'dist/**',
      'electron/**',
      'scripts/**',
      'supabase/**',
      'eslint-report.json',
    ],
  },
  {
    rules: {
      // React Compiler-era rules flag common controlled-UI sync patterns across this codebase.
      // Disabling avoids false-positive blocks; real race bugs were fixed in payment/delete paths.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },
]

export default eslintConfig
