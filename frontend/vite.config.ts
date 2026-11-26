import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

/**
 * The exact headers production nginx sends (parsed from deploy/security-headers.conf), so
 * `npm run preview` tests the real CSP + isolation instead of a look-alike.
 */
function productionHeaders(): Record<string, string> {
  const conf = readFileSync(new URL('../deploy/security-headers.conf', import.meta.url), 'utf8')
  const headers: Record<string, string> = {}
  for (const m of conf.matchAll(/^\s*add_header\s+(\S+)\s+"([^"]*)"/gm)) headers[m[1]] = m[2]
  return headers
}

// Everything runs in the browser: the Python engine executes in Pyodide inside a Web Worker and the
// server only serves static files. The Pyodide runtime is self-hosted from public/pyodide/
// (copied from node_modules by scripts/copy-pyodide.mjs before dev/build).
//
// Cross-origin isolation (COOP + COEP) makes SharedArrayBuffer available, which lets the Stop button
// interrupt runaway user code via pyodide.setInterruptBuffer. The production static server must
// send the same two headers; without them the app falls back to a terminate-and-restart watchdog.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react()],
  server: {
    headers: isolation,
    // The worker bundles the engine's .py sources from ../engine via import.meta.glob.
    fs: { allow: ['.', '../engine'] },
  },
  preview: { headers: productionHeaders() },
  worker: { format: 'es' },
  // The 3D view (three.js) is a lazy chunk of ~1 MB; the app shell stays well under that.
  build: { chunkSizeWarningLimit: 1100 },
})
