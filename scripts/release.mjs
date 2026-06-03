// One-command release.
//
//   pnpm release patch        bump 0.2.0 -> 0.2.1, then release
//   pnpm release minor        bump 0.2.0 -> 0.3.0, then release
//   pnpm release major        bump 0.2.0 -> 1.0.0, then release
//   pnpm release 1.4.2        release an explicit version
//   pnpm release              release the version already in Cargo.toml
//                             (also how you retry after a failed gate build)
//
// Flow:
//   1. Local preflight (scripts/release-check.mjs). Abort on failure, before
//      anything is bumped, committed, or pushed.
//   2. Changelog. If the entry for the target version is missing, generate it
//      from the git commits since the last release tag (you can edit after).
//   3. Bump src-tauri/Cargo.toml (single source of truth), sync the version
//      everywhere, commit vX.Y.Z, and push main — but NOT the tag yet.
//   4. Gate. Dispatch the full multi-platform Release workflow with publishing
//      DISABLED and wait for it to finish. If the build is red, stop here:
//      no tag is created and nothing is published. Main carries only the
//      (unreleased) version-bump commit; fix forward and re-run `pnpm release`.
//   5. Publish. Once the gate build is green, create + push the vX.Y.Z tag and
//      dispatch the Release workflow with publishing enabled.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO = 'walkersutton/cyclemetry'

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options,
  })
}

function check(command, args) {
  return spawnSync(command, args, { cwd: repoRoot, stdio: 'ignore' }).status === 0
}

function output(command, args) {
  return execFileSync(command, args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// --- Version -----------------------------------------------------------------

function readCargoVersion() {
  const cargoToml = readFileSync(join(repoRoot, 'src-tauri/Cargo.toml'), 'utf8')
  const version = cargoToml.match(/^version = "([^"]+)"/m)?.[1]
  if (!version) {
    throw new Error('Could not find version in src-tauri/Cargo.toml')
  }
  return version
}

function writeCargoVersion(version) {
  const path = join(repoRoot, 'src-tauri/Cargo.toml')
  const cargoToml = readFileSync(path, 'utf8')
  // The package version is the first `version = "..."` line in the manifest.
  writeFileSync(path, cargoToml.replace(/^version = "[^"]+"/m, `version = "${version}"`))
}

function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) {
    return bump
  }
  const [major, minor, patch] = current.split('.').map(Number)
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
    default:
      throw new Error(`Invalid release argument "${bump}". Use patch | minor | major | x.y.z`)
  }
}

// --- Changelog ---------------------------------------------------------------

function changelogSlug(version) {
  return `v${version.replaceAll('.', '-')}`
}

function changelogPaths(version) {
  const slug = changelogSlug(version)
  return {
    slug,
    page: `website/content/changelog/${slug}.mdx`,
    index: 'website/content/changelog/index.mdx',
    meta: 'website/content/changelog/_meta.js',
  }
}

function humanDate() {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function changelogComplete(version) {
  const { slug, page, index, meta } = changelogPaths(version)
  const pagePath = join(repoRoot, page)
  if (!existsSync(pagePath) || !existsSync(join(repoRoot, index)) || !existsSync(join(repoRoot, meta))) {
    return false
  }
  const pageText = readFileSync(pagePath, 'utf8')
  const indexText = readFileSync(join(repoRoot, index), 'utf8')
  const metaText = readFileSync(join(repoRoot, meta), 'utf8')
  return (
    pageText.includes(`title: v${version}`) &&
    indexText.includes(`/changelog/${slug}`) &&
    metaText.includes(`'${slug}'`)
  )
}

// Newest existing vX.Y.Z tag, or null if there are no release tags yet.
function lastReleaseTag() {
  const result = spawnSync('git', ['tag', '--list', 'v*', '--sort=-v:refname'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (result.status !== 0) return null
  const tags = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  return tags[0] ?? null
}

// Commit subjects to skip entirely in user-facing notes.
const SKIP_COMMIT = /^(chore|ci|docs|test|build|style)(\(.+\))?:/i

// Group commit subjects since the last tag into changelog buckets.
function categorizeCommits(subjects) {
  const buckets = { feat: [], fix: [], perf: [], other: [] }
  for (const subject of subjects) {
    if (/^v\d+\.\d+\.\d+/.test(subject)) continue // release commits
    if (SKIP_COMMIT.test(subject)) continue
    const match = subject.match(/^(\w+)(\(.+\))?:\s*(.+)$/)
    const type = match ? match[1].toLowerCase() : 'other'
    const text = match ? match[3] : subject
    const display = text.charAt(0).toUpperCase() + text.slice(1)
    if (type === 'feat') buckets.feat.push(display)
    else if (type === 'fix') buckets.fix.push(display)
    else if (type === 'perf') buckets.perf.push(display)
    else buckets.other.push(display)
  }
  return buckets
}

function section(title, items) {
  return `## ${title}\n\n${items.map((item) => `- ${item}`).join('\n')}`
}

function changelogBody(buckets) {
  const parts = []
  if (buckets.feat.length) parts.push(section('Features', buckets.feat))
  if (buckets.fix.length) parts.push(section('Bug Fixes', buckets.fix))
  if (buckets.perf.length) parts.push(section('Performance', buckets.perf))
  if (buckets.other.length) parts.push(section('Improvements', buckets.other))
  if (!parts.length) parts.push(section('Changes', ['Maintenance and internal improvements']))
  return parts.join('\n\n')
}

function changelogHighlights(buckets) {
  const pool = [...buckets.feat, ...buckets.fix, ...buckets.other, ...buckets.perf]
  return pool.length ? pool.slice(0, 3).join(', ') : 'Maintenance and improvements'
}

// Generate the changelog page, release-table row, and nav label from the
// commits since the last release tag. Returns the rendered notes for display.
function generateChangelog(version) {
  const { slug, page, index, meta } = changelogPaths(version)
  const date = humanDate()
  const tag = `v${version}`

  const since = lastReleaseTag()
  const range = since ? `${since}..HEAD` : 'HEAD'
  const subjects = output('git', ['log', range, '--no-merges', '--pretty=format:%s'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const buckets = categorizeCommits(subjects)
  const body = changelogBody(buckets)
  const highlights = changelogHighlights(buckets)

  writeFileSync(
    join(repoRoot, page),
    `---
title: ${tag}
description: Cyclemetry ${tag} release notes.
---

import { Callout } from 'nextra/components'

# ${tag}

<div className="blog-meta">Released ${date}</div>

<Callout type="info">
  Download from [GitHub Releases](https://github.com/${REPO}/releases/tag/${tag})
</Callout>

${body}

## Upgrading

Download the latest \`.dmg\` (macOS), \`.exe\` installer (Windows), or \`.deb\`/\`.AppImage\` (Linux) from [GitHub Releases](https://github.com/${REPO}/releases).
`,
  )

  const indexPath = join(repoRoot, index)
  let indexText = readFileSync(indexPath, 'utf8')
  if (!indexText.includes(`/changelog/${slug}`)) {
    // Insert as the newest (top) row, right after the table header separator.
    indexText = indexText.replace(/(\|[-| ]+\|\n)/, `$1| [${tag}](/changelog/${slug}) | ${date} | ${highlights} |\n`)
    writeFileSync(indexPath, indexText)
  }

  const metaPath = join(repoRoot, meta)
  let metaText = readFileSync(metaPath, 'utf8')
  if (!metaText.includes(`'${slug}'`)) {
    metaText = metaText.replace(/(index: 'Release History',\n)/, `$1  '${slug}': '${tag}',\n`)
    writeFileSync(metaPath, metaText)
  }

  return body
}

// --- Release workflow gate ---------------------------------------------------

function latestReleaseRunId() {
  const id = output('gh', [
    'run',
    'list',
    '--workflow',
    'release.yml',
    '--limit',
    '1',
    '--json',
    'databaseId',
    '--jq',
    '.[0].databaseId // 0',
  ])
  return Number(id || '0')
}

function waitForNewRun(previousId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const id = latestReleaseRunId()
    if (id && id !== previousId) return id
    sleepMs(2000)
  }
  throw new Error('Timed out waiting for the Release workflow run to start')
}

// Dispatch the Release workflow and block until it finishes. `gh run watch
// --exit-status` exits non-zero on a failed run, so a red build aborts here.
function dispatchReleaseBuild({ publish, label }) {
  const before = latestReleaseRunId()
  run('gh', ['workflow', 'run', 'release.yml', '--ref', 'main', '-f', 'platform=all', '-f', `publish_release=${publish}`])
  const id = waitForNewRun(before)
  console.log(`\n${label}\n  https://github.com/${REPO}/actions/runs/${id}\n`)
  run('gh', ['run', 'watch', String(id), '--exit-status', '--interval', '15'])
}

// --- Run ---------------------------------------------------------------------

const bumpArg = process.argv[2]
const currentVersion = readCargoVersion()
const version = bumpArg ? nextVersion(currentVersion, bumpArg) : currentVersion
const tag = `v${version}`

if (bumpArg && version !== currentVersion) {
  console.log(`Releasing ${tag} (${bumpArg} bump from v${currentVersion})`)
} else {
  console.log(`Releasing ${tag}`)
}

if (check('git', ['rev-parse', '--verify', '--quiet', tag])) {
  throw new Error(`Tag ${tag} already exists`)
}

if (!check('git', ['diff', '--cached', '--quiet'])) {
  throw new Error('Release aborted: commit or unstage existing staged changes first')
}

// 1. Local preflight — fail before touching anything.
run(process.execPath, ['scripts/release-check.mjs'])

// 2. Changelog — generate from commits if it does not exist yet.
if (!changelogComplete(version)) {
  console.log(`\nGenerating changelog for ${tag} from commits since ${lastReleaseTag() ?? 'the first commit'}…`)
  const notes = generateChangelog(version)
  console.log(`\n${'-'.repeat(60)}\n${notes}\n${'-'.repeat(60)}`)
  console.log(`\nWrote ${changelogPaths(version).page} — edit it now if you want, then let this continue.`)
}

// 3. Bump, sync, commit, push main (no tag yet).
if (version !== currentVersion) {
  writeCargoVersion(version)
}

run(process.execPath, ['scripts/sync-version.mjs'])

const { page, index, meta } = changelogPaths(version)
run('git', [
  'add',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'package.json',
  'app/package.json',
  page,
  index,
  meta,
  'scripts/sync-version.mjs',
  'scripts/release.mjs',
  'scripts/release-check.mjs',
])

if (check('git', ['diff', '--cached', '--quiet'])) {
  const head = output('git', ['rev-parse', '--short', 'HEAD'])
  console.log(`No release metadata changes to commit; using existing HEAD ${head}`)
} else {
  run('git', ['commit', '-m', tag])
}

run('git', ['push', 'origin', 'main'])

// 4. Gate — full multi-platform build with publishing disabled. A red build
//    throws here, so the tag below is never created.
dispatchReleaseBuild({ publish: 'false', label: `Gate: full build for ${tag} (publishing disabled)` })

// 5. Publish — gate passed, so tag and ship.
run('git', ['tag', tag])
run('git', ['push', 'origin', tag])
dispatchReleaseBuild({ publish: 'true', label: `Publishing ${tag}` })

console.log(`\nReleased ${tag}.`)
