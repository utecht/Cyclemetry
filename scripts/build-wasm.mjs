// Builds the render-wasm web companion (render pipeline compiled to wasm via
// Emscripten) and syncs the artifacts + demo assets into website/public.
//
// Toolchain requirements (one-time setup):
//   1. emsdk 4.0.x at ~/.cache/emsdk — versions matter: emcc 3.1.x is too old
//      for rustc 1.95's wasm feature flags, and emcc 6.x MISCOMPILES the
//      output (pure-Rust code traps at runtime). 4.0.15 is known good.
//        git clone https://github.com/emscripten-core/emsdk ~/.cache/emsdk
//        cd ~/.cache/emsdk && ./emsdk install 4.0.15 && ./emsdk activate 4.0.15
//   2. Rust std for the target (asdf toolchains have no rustup):
//        curl -O https://static.rust-lang.org/dist/rust-std-<rustc-version>-wasm32-unknown-emscripten.tar.xz
//        …untar and copy lib/rustlib/wasm32-unknown-emscripten into the
//        toolchain's lib/rustlib/ directory.
//
// Env explained:
//   FORCE_SKIA_BUILD=1 — rust-skia's prebuilt wasm binaries use Emscripten's
//     legacy JS exception ABI, which cannot link against rustc's wasm-EH
//     output; Skia must be compiled from source (cached after first build).
//   EMCC_CFLAGS=-fwasm-exceptions — compile Skia's C++ with the same
//     exception ABI rustc links with.
//   BINDGEN_EXTRA_CLANG_ARGS — skia-bindings' hardcoded include list misses
//     emscripten's compat headers (xlocale.h).
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const emsdk = process.env.EMSDK ?? join(homedir(), '.cache/emsdk')
const emscripten = join(emsdk, 'upstream/emscripten')

if (!existsSync(join(emscripten, 'emcc'))) {
  console.error(`emsdk not found at ${emsdk} — see setup notes at the top of this script.`)
  process.exit(1)
}

const env = {
  ...process.env,
  EMSDK: emsdk,
  PATH: `${emscripten}:${process.env.PATH}`,
  FORCE_SKIA_BUILD: '1',
  EMCC_CFLAGS: '-fwasm-exceptions',
  BINDGEN_EXTRA_CLANG_ARGS: `-isystem${emscripten}/system/include/compat`,
}

execSync('cargo build -p render-wasm --target wasm32-unknown-emscripten --release', {
  cwd: join(root, 'src-tauri'),
  env,
  stdio: 'inherit',
})
execSync(`node ${join(root, 'scripts/sync-wasm-web.mjs')}`, { stdio: 'inherit' })
