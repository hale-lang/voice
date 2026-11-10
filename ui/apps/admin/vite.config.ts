import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { bootScript } from '@hale/tokens/boot';
import { THEME_KEY } from './src/theme-key';

// In development the api (or its stub) answers on 8080 and the dev server
// proxies both planes to it, so the UI runs on one origin as it does in
// production, where the api serves the built files itself.
const api = process.env.VOICE_API ?? 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [
    react(),
    // the saved theme, applied by a classic script at the top of <head>, so
    // the first paint is already in it (no flash of the default)
    {
      name: 'theme-boot',
      transformIndexHtml: () => [{ tag: 'script', children: bootScript(THEME_KEY), injectTo: 'head' }],
    },
  ],
  server: {
    port: 5173,
    proxy: {
      '/v1': api,
      '/admin': api,
      '/healthz': api,
      '/readyz': api,
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
