// Search landing pages: one static page per hardware × model combo, plus per-hardware and
// per-model index pages. The same <SeoSection> renders into the prerendered HTML at build time
// (src/prerender.tsx) and below the hero in the live app, so crawlers with and without JS see
// identical content. Must stay free of window/document access.
import { createContext, type ComponentChildren } from 'preact'
import { useContext } from 'preact/hooks'
import { GuideSection } from './guide'
import { HW, MODELS, PRESETS, quantsFor, releasedLabel, type Hw, type Model, type Quant } from './data'
import { calc, DEFAULT_OPTS, fmt, type CalcResult, type Opts } from './calc'

export const SITE = 'https://llmspeed.dev'

export type Page =
  | { kind: 'home' }
  | { kind: 'combo'; hw: Hw; m: Model }
  | { kind: 'hw'; hw: Hw }
  | { kind: 'model'; m: Model }
  | { kind: 'guide' }

export function pathOf(p: Page): string {
  if (p.kind === 'combo') return `/${p.m.id}-on-${p.hw.id}/`
  if (p.kind === 'hw') return `/hardware/${p.hw.id}/`
  if (p.kind === 'model') return `/models/${p.m.id}/`
  if (p.kind === 'guide') return '/guide/'
  return '/'
}

export function pageFromPath(path: string): Page {
  const seg = path.replace(/^\/+|\/+$/g, '').split('/')
  if (seg.length === 2 && seg[0] === 'hardware') {
    const hw = HW.find(h => h.id === seg[1])
    if (hw) return { kind: 'hw', hw }
  }
  if (seg.length === 2 && seg[0] === 'models') {
    const m = MODELS.find(x => x.id === seg[1])
    if (m) return { kind: 'model', m }
  }
  if (seg.length === 1 && seg[0] === 'guide') return { kind: 'guide' }
  if (seg.length === 1) {
    for (const m of MODELS) {
      if (!seg[0].startsWith(m.id + '-on-')) continue
      const hw = HW.find(h => h.id === seg[0].slice(m.id.length + 4))
      if (hw) return { kind: 'combo', hw, m }
    }
  }
  return { kind: 'home' }
}

export function allPages(): Page[] {
  return [
    { kind: 'home' },
    { kind: 'guide' },
    ...HW.map(hw => ({ kind: 'hw' as const, hw })),
    ...MODELS.map(m => ({ kind: 'model' as const, m })),
    ...MODELS.flatMap(m => HW.map(hw => ({ kind: 'combo' as const, hw, m }))),
  ]
}

const CTX = PRESETS[0].tok

/** '?kv=…&mac=raised' for non-default settings, '' otherwise */
export function settingsQuery(o: Opts): string {
  const q = new URLSearchParams()
  if (o.kvq !== 'f16') q.set('kv', o.kvq)
  if (o.macRaised) q.set('mac', 'raised')
  const t = q.toString()
  return t ? '?' + t : ''
}

/** the quant a landing page leads with: the largest Q4 that fits, else the largest that fits, else the smallest */
export function pickQuant(hw: Hw, m: Model, o: Opts = DEFAULT_OPTS): Quant {
  const qs = quantsFor(m)
  const fits = qs.filter(q => calc(hw, m, q, CTX, 1, o).fit === 'fits')
  const q4 = fits.filter(q => /q4/.test(q.id))
  return q4[q4.length - 1] ?? fits[fits.length - 1] ?? qs[0]
}

// the prerendered pages use the default settings; the app passes the visitor's cache type and Mac limit
const est = (hw: Hw, m: Model, o: Opts = DEFAULT_OPTS, q: Quant = pickQuant(hw, m, o)) => ({ q, c: calc(hw, m, q, CTX, 1, o) })
const runs = (c: CalcResult) => c.fit !== 'no'
const speed = (c: CalcResult) => runs(c) ? `${fmt(c.base)} tok/s` : "Won't run"
const ttft = (c: CalcResult) => runs(c) ? `${c.ttft < 10 ? c.ttft.toFixed(1) : Math.round(c.ttft)} s` : '—'
const fitLabel = (c: CalcResult) => c.fit === 'fits' ? 'Fits' : c.fit === 'partial' ? 'Partial offload' : "Doesn't fit"
const confLabel = (c: CalcResult) => c.conf === 'measured' ? 'Measured' : c.conf === 'derived' ? 'Derived' : c.conf === 'projected' ? 'Projected' : '—'
const released = (m: Model) => releasedLabel(m.id) ? `, released ${releasedLabel(m.id)}` : ''
const params = (m: Model) => (m.active_params_b < m.total_params_b
  ? `a ${m.total_params_b}B-parameter mixture-of-experts model (${m.active_params_b}B active per token)`
  : `a ${m.total_params_b}B-parameter model`) + released(m)
const CONF_TEXT: Record<string, string> = {
  measured: 'This estimate is based on community benchmarks of this exact setup.',
  derived: 'This estimate is interpolated from benchmarks of similar setups.',
  projected: 'This estimate is projected from the hardware specs; no benchmarks exist yet.',
}

export interface PageMeta {
  title: string
  description: string
  /** hero headline around the animated "feel" word */
  h1: [string, string]
}

export function pageMeta(p: Page): PageMeta {
  if (p.kind === 'combo') {
    const { q, c } = est(p.hw, p.m)
    return {
      title: runs(c)
        ? `${p.m.name} on ${p.hw.name}: ~${fmt(c.base)} tok/s | llmspeed`
        : `Can the ${p.hw.name} run ${p.m.name}? | llmspeed`,
      description: runs(c)
        ? `${p.m.name} runs at about ${fmt(c.base)} tokens/sec on the ${p.hw.name} at ${q.label} (${confLabel(c).toLowerCase()}). See speed, memory fit and time to first token for every quantization, and watch it stream in real time.`
        : `${p.m.name} needs at least ${c.total.toFixed(0)} GB, more than the ${p.hw.name} can hold. See memory requirements for every quantization and which hardware runs it.`,
      h1: [`How fast will ${p.m.name}`, `on the ${p.hw.name}?`],
    }
  }
  if (p.kind === 'hw') return {
    title: `${p.hw.name} LLM speed: tokens/sec for ${MODELS.length} models | llmspeed`,
    description: `How fast do local LLMs run on the ${p.hw.name}? Tokens/sec, time to first token and memory fit for ${MODELS.length} popular models, and watch them stream at real speed.`,
    h1: ['How fast will local models', `on the ${p.hw.name}?`],
  }
  if (p.kind === 'guide') return {
    title: 'How many tokens per second do you need? Local LLM speed and quantization guide | llmspeed',
    description: 'What tok/s and time to first token feel like for chat, coding help, coding agents and reasoning models, and how much quality each GGUF quantization (Q8, Q4_K_M, Q3, Q2, IQ1) costs, with measured numbers.',
    h1: ['How fast should a local model', '?'],
  }
  if (p.kind === 'model') return {
    title: `${p.m.name} speed on GPUs and Macs: tokens/sec | llmspeed`,
    description: `How fast does ${p.m.name} run locally? Tokens/sec, time to first token and memory fit on ${HW.length} GPUs and Macs, and watch it stream at real speed.`,
    h1: [`How fast will ${p.m.name}`, 'on your hardware?'],
  }
  return {
    title: 'llmspeed — feel local LLM speed before you buy',
    description: 'Pick hardware and a model, and feel the real speed of a local LLM before you buy. Simulates tokens/sec and time-to-first-token from verified benchmarks for GPUs, Macs, and more.',
    h1: ['How fast will your local model', '?'],
  }
}

/** query string with the visitor's non-default settings, so links between pages keep them */
const SettingsQuery = createContext('')
const A = ({ p, children }: { p: Page; children: ComponentChildren }) => <a href={pathOf(p) + useContext(SettingsQuery)}>{children}</a>

function LinkList({ items }: { items: { p: Page; label: string; meta?: string }[] }) {
  return (
    <ul class="seo-links">
      {items.map(it => <li key={pathOf(it.p)}><A p={it.p}>{it.label}</A>{it.meta && <span> · {it.meta}</span>}</li>)}
    </ul>
  )
}

function ComboSection({ hw, m, o }: { hw: Hw; m: Model; o: Opts }) {
  const { q, c } = est(hw, m, o)
  const rows = quantsFor(m).map(qq => ({ q: qq, c: calc(hw, m, qq, CTX, 1, o) }))
  const others = HW.filter(h => h.id !== hw.id).map(h => ({ h, ...est(h, m, o) }))
    .sort((a, b) => (runs(b.c) ? b.c.base : -1) - (runs(a.c) ? a.c.base : -1))
  const fitText = c.fit === 'fits' ? 'fits entirely in memory'
    : c.fit === 'partial' ? 'only fits with part of the model offloaded to system RAM, which slows it down'
    : "doesn't fit, even at its smallest quantization"
  return (
    <>
      <h2>{m.name} on the {hw.name}</h2>
      <p>
        {m.name} is {params(m)}. At {q.label} it needs about {c.total.toFixed(1)} GB of memory. The {hw.name} has {c.usable.toFixed(0)} GB usable, so it {fitText}.
        {runs(c) && <> Expect about <strong>{fmt(c.base)} tokens/sec</strong> ({fmt(c.lo)}–{fmt(c.hi)}), with the first token after {ttft(c)} for a short prompt. {c.conf && CONF_TEXT[c.conf]}</>}
      </p>
      <h3>Speed by quantization</h3>
      <div class="seo-table"><table>
        <thead><tr><th>Quantization</th><th>File size</th><th>Memory</th><th>Generation</th><th>First token</th><th>Source</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.q.id}><td>{r.q.label}</td><td>{m.quants[r.q.id].file_gb.toFixed(1)} GB</td><td>{fitLabel(r.c)}</td><td>{speed(r.c)}</td><td>{ttft(r.c)}</td><td>{runs(r.c) ? confLabel(r.c) : '—'}</td></tr>
        ))}</tbody>
      </table></div>
      <h3>{m.name} on other hardware</h3>
      <LinkList items={others.map(o => ({ p: { kind: 'combo', hw: o.h, m }, label: o.h.name, meta: runs(o.c) ? `${fmt(o.c.base)} tok/s at ${o.q.label}` : "won't run" }))} />
      <h3>Other models on the {hw.name}</h3>
      <LinkList items={MODELS.filter(x => x.id !== m.id).map(x => { const e = est(hw, x, o); return { p: { kind: 'combo', hw, m: x }, label: x.name, meta: runs(e.c) ? `${fmt(e.c.base)} tok/s at ${e.q.label}` : "won't run" } })} />
      <p class="seo-more"><A p={{ kind: 'hw', hw }}>All models on the {hw.name}</A> · <A p={{ kind: 'model', m }}>{m.name} on all hardware</A></p>
    </>
  )
}

function HwSection({ hw, o }: { hw: Hw; o: Opts }) {
  const rows = MODELS.map(m => ({ m, ...est(hw, m, o) }))
  return (
    <>
      <h2>Local LLM speed on the {hw.name}</h2>
      <p>The {hw.name} has {hw.vram_gb} GB of {hw.vendor === 'apple' ? 'unified memory' : 'memory'} and {hw.bandwidth_gbs} GB/s of memory bandwidth, which is what mostly decides generation speed. Below is the expected speed for each model at the best quantization that fits.</p>
      <div class="seo-table"><table>
        <thead><tr><th>Model</th><th>Quantization</th><th>Memory</th><th>Generation</th><th>First token</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.m.id}><td><A p={{ kind: 'combo', hw, m: r.m }}>{r.m.name}</A></td><td>{r.q.label}</td><td>{fitLabel(r.c)}</td><td>{speed(r.c)}</td><td>{ttft(r.c)}</td></tr>
        ))}</tbody>
      </table></div>
      <h3>Other hardware</h3>
      <LinkList items={HW.filter(h => h.id !== hw.id).map(h => ({ p: { kind: 'hw', hw: h }, label: h.name }))} />
    </>
  )
}

function ModelSection({ m, o }: { m: Model; o: Opts }) {
  const rows = HW.map(hw => ({ hw, ...est(hw, m, o) }))
    .sort((a, b) => (runs(b.c) ? b.c.base : -1) - (runs(a.c) ? a.c.base : -1))
  return (
    <>
      <h2>{m.name} speed on GPUs and Macs</h2>
      <p>{m.name} is {params(m)}. Smaller quantizations need less memory and run faster, at some cost in quality. Below is the expected speed on each piece of hardware at the best quantization that fits.</p>
      <div class="seo-table"><table>
        <thead><tr><th>Hardware</th><th>Quantization</th><th>Memory</th><th>Generation</th><th>First token</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.hw.id}><td><A p={{ kind: 'combo', hw: r.hw, m }}>{r.hw.name}</A></td><td>{r.q.label}</td><td>{fitLabel(r.c)}</td><td>{speed(r.c)}</td><td>{ttft(r.c)}</td></tr>
        ))}</tbody>
      </table></div>
      <h3>Other models</h3>
      <LinkList items={MODELS.filter(x => x.id !== m.id).map(x => ({ p: { kind: 'model', m: x }, label: x.name }))} />
    </>
  )
}

function HomeSection() {
  return (
    <>
      <p><a href="/guide/">How many tokens per second do you need, and what quantization costs</a></p>
      <h2>Browse by hardware</h2>
      <LinkList items={HW.map(hw => ({ p: { kind: 'hw', hw }, label: hw.name }))} />
      <h2>Browse by model</h2>
      <LinkList items={MODELS.map(m => ({ p: { kind: 'model', m }, label: m.name }))} />
    </>
  )
}

export function SeoSection({ page, opts = DEFAULT_OPTS }: { page: Page; opts?: Opts }) {
  return (
    <SettingsQuery.Provider value={settingsQuery(opts)}>
    <section id="fit" class="seo page-col">
      {page.kind === 'combo' ? <ComboSection hw={page.hw} m={page.m} o={opts} />
        : page.kind === 'hw' ? <HwSection hw={page.hw} o={opts} />
        : page.kind === 'model' ? <ModelSection m={page.m} o={opts} />
        : page.kind === 'guide' ? <GuideSection />
        : <HomeSection />}
      <p class="seo-foot">Estimates for a short prompt on a single device{opts.kvq !== 'f16' || opts.macRaised ? `, with ${[opts.kvq !== 'f16' && `a ${opts.kvq.toUpperCase()} context cache`, opts.macRaised && 'the Mac GPU memory limit raised'].filter(Boolean).join(' and ')}` : ''}. Measured numbers come from community benchmarks (r/LocalLLaMA, localscore.ai and more); others are derived from similar setups or projected from specs. <a href="https://github.com/nicorobinreal/llmspeed">Open source on GitHub</a>.</p>
    </section>
    </SettingsQuery.Provider>
  )
}

/** initial simulator config for a landing page; null keeps the app default */
export function pageCfg(p: Page, def: { hw: string; model: string; quant: string }, o: Opts = DEFAULT_OPTS) {
  if (p.kind === 'home' || p.kind === 'guide') return null
  // model pages open on the most popular hardware that fits the model
  const hw = p.kind === 'model' ? (HW.find(h => est(h, p.m, o).c.fit === 'fits') ?? HW.find(h => h.id === def.hw)!) : p.hw
  const m = p.kind === 'hw' ? MODELS.find(x => x.id === def.model)! : p.m
  return { hw: hw.id, model: m.id, quant: pickQuant(hw, m, o).id }
}
