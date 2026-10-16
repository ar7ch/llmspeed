// Umami (cookie-free) event tracking. The script tag in index.html only reports on llmspeed.dev,
// so dev/preview builds send nothing; track() is a no-op until the script has loaded.

declare global {
  interface Window { umami?: { track(name: string, data?: Record<string, string | number | boolean>): void } }
}

// where this visit came from, captured once at load: UTM tags from our own links/ads first,
// then the referring site, else direct
const ATTR: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  try {
    const qs = new URLSearchParams(location.search)
    for (const k of ['source', 'medium', 'campaign'] as const) {
      const v = qs.get('utm_' + k)
      if (v) out[k] = v.toLowerCase().slice(0, 100)
    }
    if (!out.source) {
      const ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''
      out.source = ref && ref !== location.hostname.replace(/^www\./, '') ? ref : 'direct'
    }
  } catch (e) { }
  return out
})()

export function track(name: string, data: Record<string, string | number | boolean> = {}) {
  try { window.umami?.track(name, { ...ATTR, ...data }) } catch (e) { }
}
