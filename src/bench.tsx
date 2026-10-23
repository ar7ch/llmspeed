// Model quality chart: published benchmark scores for every model, sorted, with the bars
// that run on the selected setup in the accent color. Scores are for full-precision weights;
// quantization costs some of it (see the quant notes).
import { Component } from 'preact'
import { BENCHES, HW, MODELS, type Bench, macLimitNote, releasedLabel, releasedOf, macRaisedUsable, nodeCounts, quantsFor, scoresOf, setupName, type Hw, type Model, type Quant } from './data'
import { calc, fmt, type CalcResult } from './calc'

const ACCENT = 'oklch(0.62 0.17 30)'

// only models and benchmark editions from 2026 on; older ones compare poorly with current ones
const SINCE = '2026-01-01'
const CURRENT = MODELS.filter(m => releasedOf(m.id) >= SINCE)
const BY_GB = [...HW].sort((a, b) => b.vram_gb - a.vram_gb || a.popularity_rank - b.popularity_rank)

/** 1- or 2-bit quants: these lose real quality, so a published full-precision score overstates them */
const lowBits = (q: Quant) => /iq1/.test(q.id) ? 1 : /q2|iq2/.test(q.id) ? 2 : 0

/** scores keep their published precision (89.2, not 89) */
export const fmtScore = (x: number) => x.toFixed(1).replace(/\.0$/, '')

interface Props { hw: Hw; n: number; bench: string; setBench: (id: string) => void; floor: number; setFloor: (f: number) => void; ctx: number; model: string; pick: (m: Model, q: Quant) => void; setHw: (hw: Hw, n: number) => void }
interface St { sort: 'score' | 'speed'; hover: string | null }

/** the quant to run: the largest Q4 that fits, else the largest that fits, else the smallest */
function bestRun(hw: Hw, n: number, m: Model, ctx: number): { q: Quant; c: CalcResult } {
  const all = quantsFor(m).map(q => ({ q, c: calc(hw, m, q, ctx, n) }))
  const fits = all.filter(x => x.c.fit === 'fits')
  const q4 = fits.filter(x => /q4|mxfp4/.test(x.q.id))
  return q4[q4.length - 1] ?? fits[fits.length - 1] ?? all.find(x => x.c.fit === 'partial') ?? all[0]
}

/** rough share of a published full-precision score kept at this quant; bigger models tolerate
 *  fewer bits (llama.cpp KLD tables, Unsloth Aider runs: DeepSeek V3.1 keeps 97% at Q4, 92% at Q2) */
// TODO: rule-of-thumb factors, replace with per-model quantized eval results if they get published
export function quantKeep(q: Quant, m: Model): number {
  const p = m.total_params_b
  // NOTE: Kimi ships native INT4 and GPT-OSS native MXFP4 weights, so their 4-bit files are full quality
  if (/kimi|gpt-oss/.test(m.id) && /q4|mxfp4/.test(q.id)) return 1
  if (/iq1/.test(q.id)) return p >= 400 ? 0.78 : 0.4
  if (/q2|iq2/.test(q.id)) return p >= 200 ? 0.92 : 0.75
  if (/q3|iq3/.test(q.id)) return p >= 100 ? 0.96 : 0.92
  if (/q4|iq4|mxfp4/.test(q.id)) return 0.98
  return 1
}

/** apply a quant's quality loss to a score; Elo is discounted above a 1000 floor */
const adjust = (s: number, keep: number, b: { axis?: string }) => b.axis === 'elo' ? 1000 + (s - 1000) * keep : s * keep

/** speed floors offered for the best-pick card: reading speed, comfortable chat, agents */
export const FLOORS = [5, 10, 20]

export interface Ranked { m: Model; s: number; ok: boolean; q: Quant; c: CalcResult; adj: number }

/** Best pick: for each 2026 model with a score on `b`, the quant with the highest quality-adjusted
 *  score that fits and still runs at the speed floor (`ok`), else the best one that fits at all.
 *  Quants within 2.5% of the best adjusted score count as equal and the fastest wins, so Q4 beats
 *  a 2x slower Q8 or FP16. Models that don't fit are left out. */
export function rankModels(hw: Hw, n: number, ctx: number, b: Bench, floor: number): Ranked[] {
  return CURRENT.flatMap(m => {
    const s = scoresOf(m.id)[b.id] as number | undefined
    if (typeof s !== 'number') return []
    const opts = quantsFor(m).map(q => ({ q, c: calc(hw, m, q, ctx, n), adj: adjust(s, quantKeep(q, m), b) })).filter(x => x.c.fit === 'fits')
    const choose = (xs: typeof opts) => {
      const top = Math.max(...xs.map(x => x.adj))
      // the window is 2.5% of the score above Elo's 1000 floor (or above 0 for percentages)
      const floor0 = b.axis === 'elo' ? 1000 : 0
      return xs.filter(x => x.adj >= top - (top - floor0) * 0.025).sort((x, y) => y.c.base - x.c.base)[0]
    }
    const fast = opts.filter(x => x.c.base >= floor)
    return opts.length ? [{ m, s, ok: fast.length > 0, ...choose(fast.length ? fast : opts) }] : []
  })
}

export class BenchChart extends Component<Props, St> {
  state: St = { sort: 'score', hover: null }

  render({ hw, n, bench, setBench, floor, setFloor, ctx, model, pick, setHw }: Props, { sort, hover }: St) {
    const b = BENCHES.find(x => x.id === bench)
    if (!b) return null
    const rows = CURRENT.map(m => ({ m, s: scoresOf(m.id)[b.id] as number | undefined, ...bestRun(hw, n, m, ctx) }))
    // speed sort: runnable models by tok/s, then the ones that don't fit, by score
    const tps = (r: { c: CalcResult }) => r.c.fit === 'no' ? -1 : r.c.base
    const scored = rows.filter(r => typeof r.s === 'number').sort((x, y) => (sort === 'speed' ? tps(y) - tps(x) : 0) || y.s! - x.s!)
    const missing = rows.filter(r => typeof r.s !== 'number')
    const hi = Math.max(...scored.map(r => r.s!)), lo = Math.min(...scored.map(r => r.s!))
    // Elo bars start near the lowest score, otherwise every bar looks the same length
    const axisMin = b.axis === 'elo' ? Math.floor((lo - 60) / 50) * 50 : 0
    const max = b.unit === '%' ? 100 : b.axis === 'elo' ? hi + 20 : hi * 1.1
    const fitting = rankModels(hw, n, ctx, b, floor)
    const picks = fitting.filter(x => x.ok).sort((x, y) => y.adj - x.adj).slice(0, 3)
    // the best model that fits but misses the floor, when it would have made the top three
    const slower = fitting.filter(x => !x.ok && (picks.length < 3 || x.adj > picks[picks.length - 1].adj)).sort((x, y) => y.adj - x.adj)[0]
    const slowerRank = slower ? picks.filter(p => p.adj > slower.adj).length + 1 : 0
    const runs = scored.filter(r => r.c.fit !== 'no').length
    const hv = scored.find(r => r.m.id === hover)
    const tab = (act: boolean) => `border-radius:99px; padding:4px 11px; font-size:12px; cursor:pointer; white-space:nowrap; ${act ? 'background:var(--c-ink); border:1px solid var(--c-ink); color:var(--c-bg)' : 'background:none; border:1px solid var(--c-border); color:var(--c-text-muted)'}`
    return (
      <section class="page-col" style="width:100%; max-width:780px; margin:0 auto; padding-top:40px">
        <h2 style="font-size:20px; font-weight:700; letter-spacing:-0.01em; color:var(--c-ink); margin:0 0 4px">How smart is each model?</h2>
        <p style="font-size:13.5px; color:var(--c-text-sec); margin:0 0 14px; line-height:1.55">
          {b.name}{b.unit === '%' ? ' score (%)' : ''}. <span style={`display:inline-block; width:9px; height:9px; border-radius:2px; background:${ACCENT}`}></span> runs on <strong style="color:var(--c-ink)">{setupName(hw, n)}</strong> ({runs} of {scored.length}), faded with partial offload to system RAM, striped when only a 1–2 bit quant fits (expect a lower score than shown); gray doesn't fit. Click a bar to load that model.
        </p>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px">
          <select aria-label="Hardware" class="bench-select" value={hw.id} onChange={e => { const h = HW.find(x => x.id === (e.target as HTMLSelectElement).value)!; setHw(h, nodeCounts(h).includes(n) ? n : 1) }}>
            {BY_GB.map(h => <option key={h.id} value={h.id}>{h.name} · {h.vram_gb} GB</option>)}
          </select>
          <select aria-label="Devices" class="bench-select" value={n} onChange={e => setHw(hw, +(e.target as HTMLSelectElement).value)}>
            {nodeCounts(hw).map(k => <option key={k} value={k}>{k === 1 ? '1 device' : `${k} devices`}</option>)}
          </select>
          <span style="display:inline-flex; align-items:center; gap:4px; margin-left:auto">
            <span style="font-size:11px; color:var(--c-text-faint); padding:0 4px">Sort</span>
            {(['score', 'speed'] as const).map(k => <button key={k} onClick={() => this.setState({ sort: k })} style={tab(sort === k)}>{k === 'score' ? 'Score' : 'Speed'}</button>)}
          </span>
        </div>
        <div class="best-pick">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
            <div style="font-size:11px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; color:var(--c-text-muted); flex:1; min-width:180px">Best for {setupName(hw, n)} by {b.short}</div>
            <span style="font-size:11px; color:var(--c-text-faint)">At least</span>
            {FLOORS.map(f => <button key={f} onClick={() => setFloor(f)} style={tab(floor === f)}>{f} tok/s</button>)}
          </div>
          {picks.length === 0 ? <div style="font-size:13px; color:var(--c-text-sec); margin-top:8px">No 2026 model with a {b.short} score fits here at {floor}+ tok/s.</div> : picks.map((p, i) => (
            <div key={p.m.id} style={`display:flex; align-items:center; gap:12px; margin-top:${i ? 6 : 10}px`}>
              <div style="flex:1; min-width:0">
                <div style={`font-size:${i ? 13.5 : 17}px; font-weight:${i ? 500 : 650}; color:var(--c-ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap`}>{i ? `${i + 1}. ` : ''}{p.m.name} <span style="font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:400; color:var(--c-text-muted)">{p.q.label}</span></div>
                <div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:4px">
                  <span class="chip">{fmtScore(p.s)}{b.unit} published</span>
                  {p.adj < p.s - 0.05 && <span class="chip chip-warn">~{fmtScore(p.adj)} after {p.q.label}</span>}
                  <span class={`chip ${p.c.base >= 20 ? 'chip-good' : 'chip-warn'}`}>{fmt(p.c.base)} tok/s</span>
                  <span class={`chip ${p.c.total / p.c.usable > 0.9 ? 'chip-warn' : ''}`}>{p.c.total.toFixed(0)} of {p.c.usable.toFixed(0)} GB</span>
                </div>
              </div>
              <button onClick={() => pick(p.m, p.q)} class="pill-link" style="cursor:pointer; flex-shrink:0">Load</button>
            </div>
          ))}
          {slower && <div style="font-size:12.5px; color:var(--c-text-sec); margin-top:10px"><button onClick={() => pick(slower.m, slower.q)} style="background:none; border:none; padding:0; font:inherit; color:var(--c-ink); text-decoration:underline; cursor:pointer">{slower.m.name}</button> would rank #{slowerRank} here ({fmtScore(slower.s)}{b.unit}) but runs at {fmt(slower.c.base)} tok/s at {slower.q.label}, under the {floor} tok/s floor.</div>}
          <div style="font-size:11.5px; color:var(--c-text-faint); margin-top:10px; line-height:1.45">Fits in memory and runs at {floor}+ tok/s; among quants within 2.5% of the best score the fastest is picked. Scores are discounted for quantization with rough factors (about 2% at Q4, more below Q3 on smaller models); differences of a few points are noise.</div>
        </div>
        <div role="tablist" style="display:flex; gap:6px; overflow-x:auto; padding-bottom:12px; -webkit-overflow-scrolling:touch">
          {BENCHES.map(x => <button key={x.id} role="tab" aria-selected={x.id === bench} onClick={() => { setBench(x.id); this.setState({ hover: null }) }} style={tab(x.id === bench)}>{x.short}</button>)}
        </div>
        <div style="display:flex; flex-direction:column; gap:2px" onMouseLeave={() => this.setState({ hover: null })}>
          {scored.map(r => {
            const ok = r.c.fit !== 'no', sel = r.m.id === model, lb = ok ? lowBits(r.q) : 0
            const fill = !ok ? 'var(--c-border-strong)' : lb ? `repeating-linear-gradient(45deg, ${ACCENT} 0 3px, transparent 3px 6px)` : ACCENT
            // NOTE: 85% leaves room for the score label at the bar tip
            const w = Math.max(1, (r.s! - axisMin) / (max - axisMin) * 85)
            return (
              <button key={r.m.id} onClick={() => pick(r.m, r.q)} onMouseEnter={() => this.setState({ hover: r.m.id })} onFocus={() => this.setState({ hover: r.m.id })}
                class="bench-row" style={`display:grid; align-items:center; gap:10px; width:100%; padding:3px 4px; border:none; border-radius:6px; background:${hover === r.m.id ? 'var(--c-bg-subtle)' : 'none'}; cursor:pointer; text-align:left; font:inherit`}>
                <span style={`font-size:12.5px; color:${sel ? 'var(--c-ink)' : 'var(--c-text-sec)'}; font-weight:${sel ? 600 : 400}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap`}>{r.m.name}</span>
                <span style="display:flex; align-items:center; gap:6px; min-width:0">
                  <span style={`height:14px; width:${w}%; border-radius:0 4px 4px 0; background:${fill}; ${lb ? `box-shadow:inset 0 0 0 1px ${ACCENT};` : ''} opacity:${r.c.fit === 'partial' ? 0.5 : 1}; flex-shrink:0`}></span>
                  <span style="font-family:'IBM Plex Mono',monospace; font-size:11.5px; color:var(--c-text-strong)">{fmtScore(r.s!)}</span>
                </span>
                <span style="font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--c-text-muted); text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">
                  {r.c.fit === 'no' ? `needs ${Math.round(r.c.total)} GB` : `${fmt(r.c.base)} tok/s${lb ? ` · ${lb}-bit` : r.c.fit === 'partial' ? ' · offload' : ''}`}
                </span>
              </button>
            )
          })}
        </div>
        <div style="min-height:40px; margin-top:10px; font-size:12.5px; color:var(--c-text-sec); line-height:1.5">
          {hv ? <>
            <strong style="color:var(--c-ink)">{hv.m.name}</strong>{releasedLabel(hv.m.id) && ` (${releasedLabel(hv.m.id)})`}: {fmtScore(hv.s!)}{b.unit} on {b.short}{scoresOf(hv.m.id)._note ? ` (${scoresOf(hv.m.id)._note})` : ''}.{' '}
            {hv.c.fit === 'no' ? `Needs ${hv.c.total.toFixed(0)} GB even at ${hv.q.label}; ${setupName(hw, n)} has ${hv.c.usable.toFixed(0)} GB usable.`
              : `${lowBits(hv.q) ? `Only fits at ${hv.q.label}, a ${lowBits(hv.q)}-bit quant: expect a clearly lower score than the full-precision one shown. ` : ''}Runs at ${hv.q.label}: ${fmt(hv.c.lo)}–${fmt(hv.c.hi)} tok/s, ${hv.c.total.toFixed(0)} of ${hv.c.usable.toFixed(0)} GB${hv.c.fit === 'partial' ? ', part offloaded to system RAM' : ''}.`}
          </> : <span style="color:var(--c-text-muted)">{b.note} <a href={b.url} target="_blank" rel="noopener" style="color:var(--c-text-sec)">Source</a></span>}
        </div>
        {b.axis === 'elo' && <p style="font-size:12px; color:var(--c-text-muted); margin:8px 0 0; line-height:1.5">Bars start at {axisMin} Elo so differences are visible; a 50-point gap means the higher model wins about 57% of votes.</p>}
        {missing.length > 0 && <p style="font-size:12px; color:var(--c-text-muted); margin:8px 0 0; line-height:1.5">No published {b.short} score: {missing.map(r => r.m.name).join(', ')}.</p>}
        {macLimitNote(hw, n) && (() => {
          const more = scored.filter(r => r.c.fit === 'no' && quantsFor(r.m).some(q => calc(hw, r.m, q, ctx, n).total <= macRaisedUsable(hw, n))).length
          return <p style="font-size:12px; color:var(--c-text-muted); margin:6px 0 0; line-height:1.5">{macLimitNote(hw, n)}{more > 0 && ` That would let ${more} more model${more > 1 ? 's' : ''} here fit.`}</p>
        })()}
        <p style="font-size:12px; color:var(--c-text-muted); margin:6px 0 0; line-height:1.5">Showing models and benchmark editions released in 2026; {MODELS.length - CURRENT.length} older models are hidden.</p>
        <p style="font-size:12px; color:var(--c-text-muted); margin:6px 0 0; line-height:1.5">Scores are vendor-reported or from Artificial Analysis, at full precision. Quantization lowers them a little at Q4 and a lot below Q3 on small models.</p>
      </section>
    )
  }
}
