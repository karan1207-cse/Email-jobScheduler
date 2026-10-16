import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory or root directory.
  const env = loadEnv(mode, path.resolve(__dirname, '../../'), '');

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      host: true,
    },
    define: {
      'process.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL || 'http://localhost:5000'),
    },
  };
});
