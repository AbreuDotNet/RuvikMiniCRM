import { defineConfig } from 'vitest/config';

/**
 * Unit tests only, under plain Node.
 *
 * Nothing here renders a component: the modules under test — the HTTP client,
 * the money parsing, the formatters — are deliberately free of React Native
 * imports so they can be exercised without a native runtime or a transform
 * pipeline that would need maintaining.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
