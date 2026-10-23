// Search landing pages: one static page per hardware × model combo, plus per-hardware and
// per-model index pages. The same <SeoSection> renders into the prerendered HTML at build time
// (src/prerender.tsx) and below the hero in the live app, so crawlers with and without JS see
// identical content. Must stay free of window/document access.
import { createContext, type ComponentChildren } from 'preact'
import { useContext, useState } from 'preact/hooks'
import { GuideSection } from './guide'
import { HW, MODELS, PRESETS, quantsFor, releasedLabel, type Hw, type Model, type Quant } from './data'
import { calc, DEFAULT_OPTS, fmt, type CalcResult, type Opts } from './calc'

/** public site URL without a trailing slash; the Pages workflow sets it for forks */
export const SITE: string = (import.meta.env.VITE_SITE_URL || 'https://llmspeed.dev').replace(/\/$/, '')
/** root path of the site: '/' locally and on a custom domain, '/<repo>/' on a GitHub project page */
export const BASE: string = import.meta.env.VITE_BASE_PATH || '/'
/** link to a page under the site's base path */
export const hrefOf = (p: Page) => BASE + pathOf(p).slice(1)

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
  if (BASE !== '/' && path.startsWith(BASE)) path = path.slice(BASE.length - 1)
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

const FIT_RANK = { fits: 0, partial: 1, no: 2 }
/** ascending comparators per column; rows that won't run sink to the bottom of speed columns either way */
type Col<R> = { label: string; cell: (r: R) => ComponentChildren; cmp?: (a: R, b: R) => number; desc?: boolean }
type Row = { c: CalcResult }
const byFit = (a: Row, b: Row) => FIT_RANK[a.c.fit] - FIT_RANK[b.c.fit]
const byGen = (a: Row, b: Row) => (runs(b.c) ? b.c.base : -1) - (runs(a.c) ? a.c.base : -1)
const byTtft = (a: Row, b: Row) => (runs(a.c) ? a.c.ttft : Infinity) - (runs(b.c) ? b.c.ttft : Infinity)
const CONF_RANK = { measured: 0, derived: 1, projected: 2 }
const byConf = (a: Row, b: Row) => (a.c.conf ? CONF_RANK[a.c.conf] : 3) - (b.c.conf ? CONF_RANK[b.c.conf] : 3)
const byText = <R,>(f: (r: R) => string) => (a: R, b: R) => f(a).localeCompare(f(b))

/** a table sorted by fit, then generation speed; clicking a header sorts by that column, again to reverse */
function SortTable<R extends Row>({ cols, rows, rowKey, initial }: { cols: Col<R>[]; rows: R[]; rowKey: (r: R) => string; initial: number }) {
  const [sort, setSort] = useState({ col: initial, dir: 1 })
  const cmp = cols[sort.col].cmp
  // a column flagged desc lists its largest values first in its default direction
  const asc = (i: number) => (sort.dir > 0) !== !!cols[i].desc
  const sorted = cmp ? [...rows].sort((a, b) => {
    // speed columns keep rows that won't run last in both directions
    const dead = (cmp === byGen || cmp === byTtft) ? Number(!runs(a.c)) - Number(!runs(b.c)) : 0
    return dead || sort.dir * cmp(a, b) || byGen(a, b)
  }) : rows
  return (
    <div class="seo-table"><table>
      <thead><tr>{cols.map((c, i) => (
        <th key={c.label} aria-sort={i === sort.col ? (asc(i) ? 'ascending' : 'descending') : undefined}>
          {c.cmp ? <button class="seo-sort" onClick={() => setSort(x => ({ col: i, dir: x.col === i ? -x.dir : 1 }))}>{c.label}{i === sort.col ? (asc(i) ? ' ↑' : ' ↓') : ''}</button> : c.label}
        </th>
      ))}</tr></thead>
      <tbody>{sorted.map(r => <tr key={rowKey(r)}>{cols.map(c => <td key={c.label}>{c.cell(r)}</td>)}</tr>)}</tbody>
    </table></div>
  )
}
const released = (m: Model) => releasedLabel(m.id) ? `, released ${releasedLabel(m.id)}` : ''
const params = (m: Model) => (m.active_params_b < m.total_params_b
  ? `a ${m.total_params_b}B-parameter mixture-of-experts model (${m.active_params_b}B active per token)`
  : `a ${m.total_params_b}B-parameter model`) + released(m)
const CONF_TEXT: Record<string, string> = {
  measured: 'This estimate is based on community benchmarks of this exact setup.',
  derived: 'This setup was not benchmarked; the estimate comes from a formula calibrated on measured runs of similar setups.',
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
const A = ({ p, children }: { p: Page; children: ComponentChildren }) => <a href={hrefOf(p) + useContext(SettingsQuery)}>{children}</a>

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
      <SortTable rows={rows} rowKey={r => r.q.id} initial={2} cols={[
        { label: 'Quantization', cell: r => r.q.label, cmp: (a, b) => m.quants[a.q.id].file_gb - m.quants[b.q.id].file_gb },
        { label: 'File size', cell: r => `${m.quants[r.q.id].file_gb.toFixed(1)} GB`, cmp: (a, b) => m.quants[a.q.id].file_gb - m.quants[b.q.id].file_gb },
        { label: 'Memory', cell: r => fitLabel(r.c), cmp: byFit },
        { label: 'Generation', cell: r => speed(r.c), cmp: byGen, desc: true },
        { label: 'First token', cell: r => ttft(r.c), cmp: byTtft },
        { label: 'Source', cell: r => runs(r.c) ? confLabel(r.c) : '—', cmp: byConf },
      ]} />
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
      <SortTable rows={rows} rowKey={r => r.m.id} initial={2} cols={[
        { label: 'Model', cell: r => <A p={{ kind: 'combo', hw, m: r.m }}>{r.m.name}</A>, cmp: byText(r => r.m.name) },
        { label: 'Quantization', cell: r => r.q.label, cmp: byText(r => r.q.label) },
        { label: 'Memory', cell: r => fitLabel(r.c), cmp: byFit },
        { label: 'Generation', cell: r => speed(r.c), cmp: byGen, desc: true },
        { label: 'First token', cell: r => ttft(r.c), cmp: byTtft },
      ]} />
      <h3>Other hardware</h3>
      <LinkList items={HW.filter(h => h.id !== hw.id).map(h => ({ p: { kind: 'hw', hw: h }, label: h.name }))} />
    </>
  )
}

function ModelSection({ m, o }: { m: Model; o: Opts }) {
  const rows = HW.map(hw => ({ hw, ...est(hw, m, o) }))
  return (
    <>
      <h2>{m.name} speed on GPUs and Macs</h2>
      <p>{m.name} is {params(m)}. Smaller quantizations need less memory and run faster, at some cost in quality. Below is the expected speed on each piece of hardware at the best quantization that fits.</p>
      <SortTable rows={rows} rowKey={r => r.hw.id} initial={2} cols={[
        { label: 'Hardware', cell: r => <A p={{ kind: 'combo', hw: r.hw, m }}>{r.hw.name}</A>, cmp: byText(r => r.hw.name) },
        { label: 'Quantization', cell: r => r.q.label, cmp: byText(r => r.q.label) },
        { label: 'Memory', cell: r => fitLabel(r.c), cmp: byFit },
        { label: 'Generation', cell: r => speed(r.c), cmp: byGen, desc: true },
        { label: 'First token', cell: r => ttft(r.c), cmp: byTtft },
      ]} />
      <h3>Other models</h3>
      <LinkList items={MODELS.filter(x => x.id !== m.id).map(x => ({ p: { kind: 'model', m: x }, label: x.name }))} />
    </>
  )
}

function HomeSection() {
  return (
    <>
      <p><a href={`${BASE}guide/`}>How many tokens per second do you need, and what quantization costs</a></p>
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
