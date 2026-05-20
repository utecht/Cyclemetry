import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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

function output(command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim()
}

function changelogSlug(version) {
  return `v${version.replaceAll('.', '-')}`
}

function requireIncludes(file, expected, label, missing) {
  const text = readFileSync(join(repoRoot, file), 'utf8')
  if (!text.includes(expected)) {
    missing.push(`${file} is missing ${label}: ${expected}`)
  }
}

function checkReleaseChangelog(version) {
  const slug = changelogSlug(version)
  const page = `website/content/changelog/${slug}.mdx`
  const index = 'website/content/changelog/index.mdx'
  const meta = 'website/content/changelog/_meta.js'
  const missing = []

  for (const file of [page, index, meta]) {
    if (!existsSync(join(repoRoot, file))) {
      missing.push(`Missing ${file}`)
    }
  }

  if (missing.length === 0) {
    requireIncludes(page, `title: v${version}`, 'frontmatter title', missing)
    requireIncludes(index, `/changelog/${slug}`, 'release table link', missing)
    requireIncludes(index, `v${version}`, 'release table version', missing)
    requireIncludes(meta, `'${slug}'`, 'Nextra route key', missing)
    requireIncludes(meta, `v${version}`, 'Nextra route label', missing)
  }

  if (missing.length > 0) {
    throw new Error(
      [
        `Release aborted: add the website changelog entry for v${version}.`,
        '',
        ...missing.map((item) => `- ${item}`),
        '',
        `Expected changelog page: ${page}`,
        'Also update the release table in website/content/changelog/index.mdx',
        'and the Nextra nav label in website/content/changelog/_meta.js.',
      ].join('\n'),
    )
  }

  return { page, index, meta }
}

const cargoToml = readFileSync(join(repoRoot, 'src-tauri/Cargo.toml'), 'utf8')
const version = cargoToml.match(/^version = "([^"]+)"/m)?.[1]

if (!version) {
  throw new Error('Could not find version in src-tauri/Cargo.toml')
}

const tag = `v${version}`
const changelogFiles = checkReleaseChangelog(version)

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
  changelogFiles.page,
  changelogFiles.index,
  changelogFiles.meta,
  'scripts/sync-version.mjs',
  'scripts/release.mjs',
])

if (check('git', ['diff', '--cached', '--quiet'])) {
  const head = output('git', ['rev-parse', '--short', 'HEAD'])
  console.log(`No release metadata changes to commit; tagging existing HEAD ${head}`)
} else {
  run('git', ['commit', '-m', tag])
}

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
