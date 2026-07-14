// Copies the Emscripten render build + demo assets into website/public so the
// /create page can load them. Run after:
//   cargo build -p render-wasm --target wasm32-unknown-emscripten --release
import { cpSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wasmOut = join(
  root,
  'src-tauri/target/wasm32-unknown-emscripten/release'
)
const publicDir = join(root, 'website/public')

const copies = [
  [join(wasmOut, 'cyclemetry_render.js'), join(publicDir, 'wasm/cyclemetry_render.js')],
  [join(wasmOut, 'cyclemetry_render.wasm'), join(publicDir, 'wasm/cyclemetry_render.wasm')],
  [join(root, 'templates/strava/strava.json'), join(publicDir, 'create-demo/template.json')],
  [
    join(root, 'resources/fonts/Year in Sport Font.otf'),
    join(publicDir, 'create-demo/fonts/Year in Sport Font.otf'),
  ],
]

for (const [src, dest] of copies) {
  if (!existsSync(src)) {
    console.error(`missing: ${src}`)
    process.exit(1)
  }
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest)
  console.log(`synced ${dest}`)
}
