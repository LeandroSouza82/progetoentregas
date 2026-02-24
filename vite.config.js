import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 👇 Esta é a blindagem que força o Vite a entender o pacote
  optimizeDeps: {
    include: ['react-map-gl', 'mapbox-gl']
  }
})