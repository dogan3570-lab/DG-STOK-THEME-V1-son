import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    },
    proxy: {
      '/products': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/nav-badges': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/auth': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/ai-settings': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/xml-sources': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/marketplaces': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/categories': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/brands': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/variants': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/listings': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/ready-to-ship': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/orders': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/marketplace-send': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/health': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/api-status': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
      '/profit-engine': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        credentials: true,
      },
    },
  },
});
