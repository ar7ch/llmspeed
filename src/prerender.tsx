// SSR entry for the static landing pages; prerender.mjs runs the built module after `vite build`
// and writes the returned files into dist/. Kept free of Node APIs so it typechecks with the app.
import { renderToString } from 'preact-render-to-string'
import { allPages, pageMeta, pathOf, SeoSection, SITE, type Page } from './seo'


const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function jsonLd(p: Page, url: string, title: string) {
  if (p.kind === 'home') return {
    '@context': 'https://schema.org', '@type': 'WebApplication', name: 'llmspeed', url,
    applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any', isAccessibleForFree: true,
    description: pageMeta(p).description, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  }
  const crumbs = [{ name: 'llmspeed', url: SITE + '/' }]
  if (p.kind === 'hw' || p.kind === 'combo') crumbs.push({ name: p.hw.name, url: SITE + pathOf({ kind: 'hw', hw: p.hw }) })
  if (p.kind === 'model') crumbs.push({ name: p.m.name, url })
  if (p.kind === 'combo') crumbs.push({ name: title.split(' | ')[0], url })
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })),
  }
}

/** one HTML file per landing page, built from vite's dist/index.html */
export function pages(template: string): { file: string; html: string }[] {
  return allPages().map(p => {
    const path = pathOf(p), url = SITE + path, meta = pageMeta(p)
    const h1 = meta.h1[1] === '?' ? `${meta.h1[0]} feel?` : `${meta.h1[0]} feel ${meta.h1[1]}`
    const body = renderToString(<div class="seo-pre"><h1>{h1}</h1><SeoSection page={p} /></div>)
    const html = template
      // nested pages need root-relative asset URLs (vite emits ./ for base './')
      .replace(/(src|href)="\.\//g, '$1="/')
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*/, `$1${esc(meta.description)}`)
      .replace(/(<link rel="canonical" href=")[^"]*/, `$1${url}`)
      .replace(/(<meta property="og:url" content=")[^"]*/, `$1${url}`)
      .replace(/(<meta (?:property="og|name="twitter):title" content=")[^"]*/g, `$1${esc(meta.title)}`)
      .replace(/(<meta (?:property="og|name="twitter):description" content=")[^"]*/g, `$1${esc(meta.description)}`)
      .replace('</head>', `  <script type="application/ld+json">${JSON.stringify(jsonLd(p, url, meta.title)).replace(/</g, '\\u003c')}</script>\n</head>`)
      .replace('<div id="app"></div>', `<div id="app">${body}</div>`)
    return { file: path === '/' ? 'index.html' : path.slice(1) + 'index.html', html }
  })
}

export function sitemap(lastmod: string): string {
  const urls = allPages().map(p => `  <url><loc>${SITE}${pathOf(p)}</loc><lastmod>${lastmod}</lastmod></url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}


