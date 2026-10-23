// Model quality chart: published benchmark scores for every model, sorted, with the bars
// that run on the selected setup in the accent color. Scores are for full-precision weights;
// quantization costs some of it (see the quant notes).
import { Component } from 'preact'
import { BENCHES, HW, MODELS, macLimitNote, releasedOf, macRaisedUsable, nodeCounts, quantsFor, scoresOf, setupName, type Hw, type Model, type Quant } from './data'
import { calc, fmt, type CalcResult } from './calc'

const ACCENT = 'oklch(0.62 0.17 30)'

// only models and benchmark editions from 2026 on; older ones compare poorly with current ones
const SINCE = '2026-01-01'
const CURRENT = MODELS.filter(m => releasedOf(m.id) >= SINCE)

/** 1- or 2-bit quants: these lose real quality, so a published full-precision score overstates them */
const lowBits = (q: Quant) => /iq1/.test(q.id) ? 1 : /q2|iq2/.test(q.id) ? 2 : 0

/** scores keep their published precision (89.2, not 89) */
export const fmtScore = (x: number) => x.toFixed(1).replace(/\.0$/, '')

interface Props { hw: Hw; n: number; bench: string; setBench: (id: string) => void; ctx: number; model: string; pick: (m: Model, q: Quant) => void; setHw: (hw: Hw, n: number) => void }
interface St { sort: 'score' | 'speed'; hover: string | null }

/** the quant to run: the largest Q4 that fits, else the largest that fits, else the smallest */
function bestRun(hw: Hw, n: number, m: Model, ctx: number): { q: Quant; c: CalcResult } {
  const all = quantsFor(m).map(q => ({ q, c: calc(hw, m, q, ctx, n) }))
  const fits = all.filter(x => x.c.fit === 'fits')
  const q4 = fits.filter(x => /q4|mxfp4/.test(x.q.id))
  return q4[q4.length - 1] ?? fits[fits.length - 1] ?? all.find(x => x.c.fit === 'partial') ?? all[0]
}

export class BenchChart extends Component<Props, St> {
  state: St = { sort: 'score', hover: null }

  render({ hw, n, bench, setBench, ctx, model, pick, setHw }: Props, { sort, hover }: St) {
    const b = BENCHES.find(x => x.id === bench)
    if (!b) return null
    const rows = CURRENT.map(m => ({ m, s: scoresOf(m.id)[b.id] as number | undefined, ...bestRun(hw, n, m, ctx) }))
    // speed sort: runnable models by tok/s, then the ones that don't fit, by score
    const tps = (r: { c: CalcResult }) => r.c.fit === 'no' ? -1 : r.c.base
    const scored = rows.filter(r => typeof r.s === 'number').sort((x, y) => (sort === 'speed' ? tps(y) - tps(x) : 0) || y.s! - x.s!)
    const missing = rows.filter(r => typeof r.s !== 'number')
    const max = b.unit === '%' ? 100 : Math.max(...scored.map(r => r.s!)) * 1.1
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
            {HW.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <select aria-label="Devices" class="bench-select" value={n} onChange={e => setHw(hw, +(e.target as HTMLSelectElement).value)}>
            {nodeCounts(hw).map(k => <option key={k} value={k}>{k === 1 ? '1 device' : `${k} devices`}</option>)}
          </select>
          <span style="display:inline-flex; align-items:center; gap:4px; margin-left:auto">
            <span style="font-size:11px; color:var(--c-text-faint); padding:0 4px">Sort</span>
            {(['score', 'speed'] as const).map(k => <button key={k} onClick={() => this.setState({ sort: k })} style={tab(sort === k)}>{k === 'score' ? 'Score' : 'Speed'}</button>)}
          </span>
        </div>
        <div role="tablist" style="display:flex; gap:6px; overflow-x:auto; padding-bottom:12px; -webkit-overflow-scrolling:touch">
          {BENCHES.map(x => <button key={x.id} role="tab" aria-selected={x.id === bench} onClick={() => { setBench(x.id); this.setState({ hover: null }) }} style={tab(x.id === bench)}>{x.short}</button>)}
        </div>
        <div style="display:flex; flex-direction:column; gap:2px" onMouseLeave={() => this.setState({ hover: null })}>
          {scored.map(r => {
            const ok = r.c.fit !== 'no', sel = r.m.id === model, lb = ok ? lowBits(r.q) : 0
            const fill = !ok ? 'var(--c-border-strong)' : lb ? `repeating-linear-gradient(45deg, ${ACCENT} 0 3px, transparent 3px 6px)` : ACCENT
            // NOTE: 85% leaves room for the score label at the bar tip
            const w = Math.max(1, r.s! / max * 85)
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
            <strong style="color:var(--c-ink)">{hv.m.name}</strong>: {fmtScore(hv.s!)}{b.unit} on {b.short}{scoresOf(hv.m.id)._note ? ` (${scoresOf(hv.m.id)._note})` : ''}.{' '}
            {hv.c.fit === 'no' ? `Needs ${hv.c.total.toFixed(0)} GB even at ${hv.q.label}; ${setupName(hw, n)} has ${hv.c.usable.toFixed(0)} GB usable.`
              : `${lowBits(hv.q) ? `Only fits at ${hv.q.label}, a ${lowBits(hv.q)}-bit quant: expect a clearly lower score than the full-precision one shown. ` : ''}Runs at ${hv.q.label}: ${fmt(hv.c.lo)}–${fmt(hv.c.hi)} tok/s, ${hv.c.total.toFixed(0)} of ${hv.c.usable.toFixed(0)} GB${hv.c.fit === 'partial' ? ', part offloaded to system RAM' : ''}.`}
          </> : <span style="color:var(--c-text-muted)">{b.note} <a href={b.url} target="_blank" rel="noopener" style="color:var(--c-text-sec)">Source</a></span>}
        </div>
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
