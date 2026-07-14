// Copies the Emscripten render build + the web templates into website/public so
// the /create page can load them. Run after:
//   cargo build -p render-wasm --target wasm32-unknown-emscripten --release
//
// /create is a phone-shaped flow, so only portrait templates are published here.
// To offer another one, add it to WEB_TEMPLATES — it needs a portrait scene, a
// preview.jpg, and fonts that live in resources/fonts. The wasm build has no
// system fonts to fall back on, which is why the landscape templates (and
// aaron, which asks for Times New Roman) stay desktop-only.
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wasmOut = join(root, 'src-tauri/target/wasm32-unknown-emscripten/release')
const publicDir = join(root, 'website/public')
const createDir = join(publicDir, 'create')

const WEB_TEMPLATES = [
  {
    id: 'strava',
    name: 'Year in Sport',
    blurb: 'Distance, elevation, time, and your route — a recap card for Stories.',
    dir: 'templates/strava',
    json: 'strava.json',
    fonts: ['Year in Sport Font.otf'],
  },
]

function copy(src, dest) {
  if (!existsSync(src)) {
    console.error(`missing: ${src}`)
    process.exit(1)
  }
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest)
  console.log(`synced ${dest}`)
}

copy(join(wasmOut, 'cyclemetry_render.js'), join(publicDir, 'wasm/cyclemetry_render.js'))
copy(join(wasmOut, 'cyclemetry_render.wasm'), join(publicDir, 'wasm/cyclemetry_render.wasm'))

// Rebuilt from scratch so a template dropped from WEB_TEMPLATES stops being served.
rmSync(createDir, { recursive: true, force: true })

const manifest = WEB_TEMPLATES.map((t) => {
  const templateSrc = join(root, t.dir, t.json)
  if (!existsSync(templateSrc)) {
    console.error(`missing: ${templateSrc}`)
    process.exit(1)
  }
  const { scene } = JSON.parse(readFileSync(templateSrc, 'utf8'))
  if (scene.height <= scene.width) {
    console.error(
      `${t.id} is not portrait (${scene.width}x${scene.height}) — /create is portrait-only`,
    )
    process.exit(1)
  }

  copy(templateSrc, join(createDir, 'templates', t.id, 'template.json'))
  copy(join(root, t.dir, 'preview.jpg'), join(createDir, 'templates', t.id, 'preview.jpg'))
  for (const font of t.fonts) {
    copy(join(root, 'resources/fonts', font), join(createDir, 'fonts', font))
  }

  return {
    id: t.id,
    name: t.name,
    blurb: t.blurb,
    width: scene.width,
    height: scene.height,
    seconds: scene.target_duration ?? null,
    fonts: t.fonts,
    template: `/create/templates/${t.id}/template.json`,
    preview: `/create/templates/${t.id}/preview.jpg`,
  }
})

const manifestPath = join(createDir, 'manifest.json')
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`synced ${manifestPath} (${manifest.length} template${manifest.length === 1 ? '' : 's'})`)
