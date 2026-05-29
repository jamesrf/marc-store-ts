import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/__tests__/**',
        'src/index.ts', // Barrel file excluded from coverage
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 80, // Parser has complex error handling paths
        statements: 90,
      },
    },
  },
});
