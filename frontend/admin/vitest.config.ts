import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_TEST_LOCAL_ADAPTER': JSON.stringify('true'),
    'import.meta.env.VITE_API_MODE': JSON.stringify('local'),
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(''),
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], exclude: ['node_modules/**', 'e2e/**'] },
})
