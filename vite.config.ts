import {defineConfig, loadEnv} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const base = env.VITE_BASE_PATH || '/';
  return {
    base,
    plugins: [react()],
    server: {host: '127.0.0.1', port: 4173, allowedHosts: ['terminal.local']},
    preview: {host: '127.0.0.1', port: 4173, allowedHosts: ['terminal.local']},
    build: {
      target: 'es2022',
      sourcemap: true,
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
          },
        },
      },
    },
  };
});
