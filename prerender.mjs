// Post-build step: writes a static HTML page per landing page plus sitemap.xml into dist/.
// Run via `npm run build` (after the client build and the SSR build of src/prerender.tsx).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pages, sitemap, SITE } from './.prerender/prerender.js'

const template = readFileSync('dist/index.html', 'utf8')
const out = pages(template)
for (const { file, html } of out) {
  mkdirSync(dirname(join('dist', file)), { recursive: true })
  writeFileSync(join('dist', file), html)
}
writeFileSync('dist/sitemap.xml', sitemap(new Date().toISOString().slice(0, 10)))
writeFileSync('dist/robots.txt', readFileSync('dist/robots.txt', 'utf8').replaceAll('https://llmspeed.dev', SITE))
console.log(`prerendered ${out.length} pages + sitemap.xml`)
