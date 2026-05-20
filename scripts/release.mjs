import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options,
  })
}

function check(command, args) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'ignore',
  }).status === 0
}

const cargoToml = readFileSync(join(repoRoot, 'src-tauri/Cargo.toml'), 'utf8')
const version = cargoToml.match(/^version = "([^"]+)"/m)?.[1]

if (!version) {
  throw new Error('Could not find version in src-tauri/Cargo.toml')
}

const tag = `v${version}`

if (check('git', ['rev-parse', '--verify', '--quiet', tag])) {
  throw new Error(`Tag ${tag} already exists`)
}

if (!check('git', ['diff', '--cached', '--quiet'])) {
  throw new Error('Release aborted: commit or unstage existing staged changes first')
}

run(process.execPath, ['scripts/sync-version.mjs'])
run('git', [
  'add',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'package.json',
  'app/package.json',
  'scripts/sync-version.mjs',
  'scripts/release.mjs',
])
run('git', ['commit', '-m', tag])
run('git', ['tag', tag])
run('git', ['push', 'origin', 'main'])
run('git', ['push', 'origin', tag])
run('gh', [
  'workflow',
  'run',
  'release.yml',
  '--ref',
  'main',
  '-f',
  'platform=all',
  '-f',
  'publish_release=true',
])

console.log(`Released ${tag} and started the release workflow`)
