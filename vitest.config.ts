import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: false,
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: [
      '**/node_modules/**',
      '**/generated/**',
      '**/.next/**',
    ],
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'app/actions/**'],
      exclude: [
        'lib/prisma.ts',
        'lib/supabase-*.ts',
        'lib/ai-config.ts',
        '**/*.d.ts',
      ],
    },
  },
})
