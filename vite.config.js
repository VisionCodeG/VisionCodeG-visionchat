import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const host = env.VITE_TINODE_HOST || 'localhost:6060';
  const secure = String(env.VITE_TINODE_SECURE || 'false').toLowerCase() === 'true';
  const target = `${secure ? 'https' : 'http'}://${host}`;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/v0': {
          target,
          changeOrigin: true,
        },
      },
    },
  };
});
