import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'frontend',
  envDir: '../', // Load .env from project root
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), './frontend/apps/command-bridge')
    }
  },
  optimizeDeps: {
    entries: ['index.html']
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        secure: false
      },
      '/health': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        secure: false
      },
      '/ws': {
        target: 'ws://127.0.0.1:3001',
        changeOrigin: true,
        secure: false,
        ws: true
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        secure: false,
        ws: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@react-three') || id.includes('three')) return 'vendor-three';
          if (id.includes('mermaid')) return 'vendor-mermaid';
          if (id.includes('cytoscape') || id.includes('dagre')) return 'vendor-graph';
          if (id.includes('recharts') || id.includes('d3')) return 'vendor-charts';
          if (id.includes('framer-motion')) return 'vendor-motion';
          if (id.includes('katex')) return 'vendor-katex';
          if (id.includes('lucide-react')) return 'vendor-icons';
          return 'vendor';
        }
      }
    }
  }
})
