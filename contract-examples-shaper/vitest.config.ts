import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/unit/**/*.test.{ts,tsx}'] } },
      // Starts a real Microcks in a container: needs a Docker-compatible runtime (see README).
      { test: { name: 'it', include: ['test/it/**/*.test.ts'], testTimeout: 180_000, hookTimeout: 300_000 } },
    ],
  },
});
