# Frontend

React + TypeScript + Vite. Everything runs in the browser: the Python engine (`../engine/src/warehouse_sim`)
executes in Pyodide inside a Web Worker. The contract with the engine is `src/types.ts`.

```sh
npm install
npm run dev       # copies Pyodide into public/pyodide, then starts Vite
npm run build     # same copy step, then tsc + vite build (dist/ includes dist/pyodide/)
npm run lint
```

| Path | What |
|---|---|
| `scripts/copy-pyodide.mjs` | self-hosts the Pyodide runtime (no CDN); writes `files.json` for download progress |
| `src/engine/worker.ts` | boots Pyodide, loads the engine sources (bundled via `import.meta.glob`), runs live/test loops |
| `src/engine/client.ts` | promise API over the worker, Stop (interrupt buffer), watchdog restart |
| `src/engine/protocol.ts` | worker message types |
| `src/useWorkbench.ts` | app state: code, scenario, session, tests, results, console |
| `src/scenario.ts` | scenario form fields, validation, size estimates, view size limits |

## Hosting

The static server must send these headers so the page is cross-origin isolated (enables
`SharedArrayBuffer`, which lets Stop interrupt runaway user code):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without them the app still works, but a runaway loop is stopped by terminating and restarting the
engine worker. A CSP needs at least `script-src 'self' 'wasm-unsafe-eval'` (Pyodide's Emscripten
runtime also calls `eval` for some snippets, so `'unsafe-eval'` may be required; untested) and
`worker-src 'self'`. CodeMirror injects `<style>` elements, so `style-src` needs `'unsafe-inline'`.
