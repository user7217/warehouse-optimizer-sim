// Copies the Pyodide runtime from node_modules into public/pyodide/ so the site self-hosts it
// (no CDN at runtime). Also writes files.json (version + byte sizes) which the worker uses to
// show real download progress. Runs automatically before `dev` and `build`; skips work when the
// copy is already current.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'pyodide')
const dest = join(root, 'public', 'pyodide')

// Everything loadPyodide() fetches for a stdlib-only interpreter (no extra packages).
const FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']

const { version } = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'))
const sizes = Object.fromEntries(FILES.map((f) => [f, statSync(join(src, f)).size]))
const manifest = JSON.stringify({ version, files: sizes }, null, 2) + '\n'

const manifestPath = join(dest, 'files.json')
const current =
  existsSync(manifestPath) &&
  readFileSync(manifestPath, 'utf8') === manifest &&
  FILES.every((f) => existsSync(join(dest, f)) && statSync(join(dest, f)).size === sizes[f])

if (current) {
  console.log(`pyodide ${version}: public/pyodide is up to date`)
} else {
  mkdirSync(dest, { recursive: true })
  for (const f of FILES) copyFileSync(join(src, f), join(dest, f))
  writeFileSync(manifestPath, manifest)
  const mb = Object.values(sizes).reduce((a, b) => a + b, 0) / 1e6
  console.log(`pyodide ${version}: copied ${FILES.length} files (${mb.toFixed(1)} MB) to public/pyodide`)
}
