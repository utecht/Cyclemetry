import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const templatesDir = join(repoRoot, 'templates')
const readmePath = join(templatesDir, 'README.md')

function templateDisplayName(folderName) {
  return folderName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function markdownLink(label, url) {
  return `[${label.replaceAll('|', '\\|')}](${url})`
}

function readTemplateReadme(templateId) {
  const path = join(templatesDir, templateId, 'README.md')
  if (!existsSync(path)) {
    throw new Error(`Template "${templateId}" is missing templates/${templateId}/README.md`)
  }
  return readFileSync(path, 'utf8')
}

function readTitle(readme, templateId) {
  const match = readme.match(/^#\s+(.+?)\s*$/m)
  return match?.[1]?.trim() || templateDisplayName(templateId)
}

function section(readme, heading) {
  const lines = readme.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`)
  if (start === -1) return ''
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line))
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n')
}

function readInspiration(readme) {
  const text = section(readme, 'Inspiration')
  if (!text.trim()) return null
  const link = text.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/)
  if (link) {
    return { label: link[1].trim(), url: link[2].trim() }
  }
  const bareUrl = text.match(/https?:\/\/\S+/)
  if (bareUrl) {
    return { label: 'Inspiration', url: bareUrl[0].trim() }
  }
  return null
}

const templates = []

for (const item of readdirSync(templatesDir)) {
  const itemPath = join(templatesDir, item)
  if (!statSync(itemPath).isDirectory() || !/^[a-z][a-z0-9_]*$/.test(item)) {
    continue
  }

  const previewPath = join(itemPath, 'preview.jpg')
  const jsonPath = join(itemPath, `${item}.json`)

  if (!existsSync(previewPath) || !existsSync(jsonPath)) {
    continue
  }

  const readme = readTemplateReadme(item)
  const publicDestDir = join(repoRoot, 'website/public/templates', item)
  if (!existsSync(publicDestDir)) {
    mkdirSync(publicDestDir, { recursive: true })
  }
  copyFileSync(previewPath, join(publicDestDir, 'preview.jpg'))

  templates.push({
    name: item,
    displayName: readTitle(readme, item),
    inspiration: readInspiration(readme),
    readmePreviewUrl: `${item}/preview.jpg`,
    webPreviewUrl: `/templates/${item}/preview.jpg`,
    githubUrl: `https://github.com/walkersutton/cyclemetry/tree/main/templates/${item}`,
    jsonUrl: `https://raw.githubusercontent.com/walkersutton/cyclemetry/main/templates/${item}/${item}.json`
  })
}

templates.sort((a, b) => a.displayName.localeCompare(b.displayName))

let showcaseContent = '\n\n| Template | Preview |\n| --- | --- |\n'
for (const template of templates) {
  showcaseContent += `| **${template.displayName}** | ![${template.displayName}](${template.readmePreviewUrl}) |\n`
}
showcaseContent += '\n'

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

const websiteTemplates = templates.map((t) => ({
  name: t.name,
  displayName: t.displayName,
  inspiration: t.inspiration,
  previewUrl: t.webPreviewUrl,
  githubUrl: t.githubUrl,
  jsonUrl: t.jsonUrl
}))

writeFileSync(join(repoRoot, 'website/content/templates.json'), JSON.stringify(websiteTemplates, null, 2) + '\n')
console.log(`Successfully updated website/content/templates.json with ${websiteTemplates.length} templates.`)
