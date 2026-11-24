import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The Python backend (uvicorn, port 8000) owns all simulation logic.
// Vite proxies /api to it so the browser sees one origin and no CORS is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})
