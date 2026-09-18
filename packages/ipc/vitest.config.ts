import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'ipc',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
