import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, (process as any).cwd(), '');

  return {
    plugins: [react()],
    define: {
      // Vitally important: This replaces 'process.env.API_KEY' in the client code
      // with the actual string value from the build environment.
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
    },
    server: {
      host: true,
      port: 3000
    }
  };
});