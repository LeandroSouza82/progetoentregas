import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Garante que os caminhos dos assets funcionem em qualquer subpasta
  build: {
    outDir: 'dist', // Define explicitamente a pasta de saída para a Vercel encontrar
    chunkSizeWarningLimit: 1600, // Aumenta o limite para o Leaflet não gerar avisos
    rollupOptions: {
      output: {
        // Organiza os arquivos de saída para evitar conflitos de cache
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    host: true, // Permite acesso pela rede local (celular)
    port: 5173, // Define uma porta fixa para facilitar o seu teste
  },
})