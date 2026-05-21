import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const templatesDir = join(repoRoot, 'templates')
const readmePath = join(templatesDir, 'README.md')

// Helper to convert lowercase snake_case or standard folder names to display names
// (underscores -> spaces, title-cased)
function getDisplayName(folderName) {
  return folderName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Read templates directory
const items = readdirSync(templatesDir)
const templates = []

for (const item of items) {
  const itemPath = join(templatesDir, item)
  if (!statSync(itemPath).isDirectory() || item === 'assets') {
    continue
  }

  const previewPath = join(itemPath, 'preview.jpg')
  const jsonPath = join(itemPath, `${item}.json`)

  if (existsSync(previewPath) && existsSync(jsonPath)) {
    templates.push({
      name: item,
      displayName: getDisplayName(item),
      previewUrl: `${item}/preview.jpg`
    })
  }
}

// Sort templates alphabetically by display name
templates.sort((a, b) => a.displayName.localeCompare(b.displayName))

// Generate the Showcase Markdown table
let showcaseContent = '\n\n| Template | Preview |\n| --- | --- |\n'
for (const template of templates) {
  showcaseContent += `| **${template.displayName}** | ![${template.displayName}](${template.previewUrl}) |\n`
}
showcaseContent += '\n'

// Read the current README
let readmeContent = readFileSync(readmePath, 'utf8')

const startMarker = '<!-- SHOWCASE_START -->'
const endMarker = '<!-- SHOWCASE_END -->'

const startIndex = readmeContent.indexOf(startMarker)
const endIndex = readmeContent.indexOf(endMarker)

if (startIndex === -1 || endIndex === -1) {
  throw new Error(`Could not find markers ${startMarker} and/or ${endMarker} in templates/README.md`)
}

const before = readmeContent.substring(0, startIndex + startMarker.length)
const after = readmeContent.substring(endIndex)

const newReadmeContent = before + showcaseContent + after

writeFileSync(readmePath, newReadmeContent)
console.log(`Successfully updated templates/README.md with ${templates.length} templates.`)
