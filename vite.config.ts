import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@excalidraw/utils': path.resolve(__dirname, 'vendor/excalidraw/utils'),
    },
  },
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/[\\/]vendor[\\/]excalidraw[\\/]/.test(id)) {
            return 'excalidraw-core'
          }
          if (/[\\/]node_modules[\\/](@capacitor)[\\/]/.test(id)) {
            return 'capacitor-vendor'
          }
          if (
            /[\\/]node_modules[\\/]react[\\/]/.test(id) ||
            /[\\/]node_modules[\\/]react-dom[\\/]/.test(id)
          ) {
            return 'react-vendor'
          }
          return undefined
        },
      },
    },
  },
})
