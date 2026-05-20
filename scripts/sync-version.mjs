import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const cargoToml = readFileSync(join(repoRoot, 'src-tauri/Cargo.toml'), 'utf8')
const version = cargoToml.match(/^version = "([^"]+)"/m)?.[1]

if (!version) {
  throw new Error('Could not find version in src-tauri/Cargo.toml')
}

for (const relativePath of ['package.json', 'app/package.json']) {
  const path = join(repoRoot, relativePath)
  const packageJson = JSON.parse(readFileSync(path, 'utf8'))
  packageJson.version = version
  writeFileSync(path, `${JSON.stringify(packageJson, null, 2)}\n`)
}

const cargoLockPath = join(repoRoot, 'src-tauri/Cargo.lock')
const cargoLock = readFileSync(cargoLockPath, 'utf8')
let foundCargoLockPackage = false
const nextCargoLock = cargoLock.replace(
  /(\[\[package\]\]\nname = "Cyclemetry"\nversion = ")[^"]+(")/,
  (_, prefix, suffix) => {
    foundCargoLockPackage = true
    return `${prefix}${version}${suffix}`
  },
)

if (!foundCargoLockPackage) {
  throw new Error('Could not sync Cyclemetry version in src-tauri/Cargo.lock')
}

writeFileSync(cargoLockPath, nextCargoLock)

console.log(`Synced release metadata to ${version}`)
