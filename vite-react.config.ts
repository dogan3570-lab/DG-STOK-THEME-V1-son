import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  server: {
    port: 5175,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/auth': { target: 'http://localhost:4000', changeOrigin: true },
      '/products': { target: 'http://localhost:4000', changeOrigin: true },
      '/categories': { target: 'http://localhost:4000', changeOrigin: true },
      '/brands': { target: 'http://localhost:4000', changeOrigin: true },
      '/variants': { target: 'http://localhost:4000', changeOrigin: true },
      '/xml-sources': { target: 'http://localhost:4000', changeOrigin: true },
      '/listings': { target: 'http://localhost:4000', changeOrigin: true },
      '/ready-to-ship': { target: 'http://localhost:4000', changeOrigin: true },
      '/marketplaces': { target: 'http://localhost:4000', changeOrigin: true },
      '/marketplace-manage': { target: 'http://localhost:4000', changeOrigin: true },
      '/orders': { target: 'http://localhost:4000', changeOrigin: true },
      '/dashboard': { target: 'http://localhost:4000', changeOrigin: true },
      '/settings': { target: 'http://localhost:4000', changeOrigin: true },
      '/reports': { target: 'http://localhost:4000', changeOrigin: true },
      '/ai-settings': { target: 'http://localhost:4000', changeOrigin: true },
      '/copilot': { target: 'http://localhost:4000', changeOrigin: true },
      '/stock-automation': { target: 'http://localhost:4000', changeOrigin: true },
      '/finance': { target: 'http://localhost:4000', changeOrigin: true },
      '/audit-logs': { target: 'http://localhost:4000', changeOrigin: true },
      '/notifications': { target: 'http://localhost:4000', changeOrigin: true },
      '/users': { target: 'http://localhost:4000', changeOrigin: true },
      '/profit-engine': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist-react',
  },
});
