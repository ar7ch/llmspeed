// Typed loader for data/app-data.json — the single build artifact the pipeline emits
// (see docs/data-contract.md). The checked-in JSON is a hand-seeded placeholder with an
// empty `combos` map: until the pipeline produces real per-combo ranges, every prediction
// falls back to the coefficient formulas in calc.ts and shows as "projected".

import raw from '../data/app-data.json'
import projected from '../data/app-data.projected.json'

export type Vendor = 'nvidia' | 'amd' | 'apple' | 'intel' | 'cpu'
export type Backend = 'cuda' | 'metal' | 'rocm' | 'vulkan' | 'cpu'
export type Tier = 'measured' | 'derived' | 'projected' | 'wont_run'

export interface Hw {
  id: string
  name: string
  vendor: Vendor
  backend: Backend
  /** memory capacity in GB (VRAM, or unified memory on Apple/Strix Halo) */
  vram_gb: number
  bandwidth_gbs: number
  tflops_fp16: number
  form_factor: 'desktop' | 'laptop' | 'mini' | 'server'
  status: 'released' | 'announced'
  popularity_rank: number
}

export interface Model {
  id: string
  name: string
  family: string
  total_params_b: number
  /** active params per token — < total for MoE; drives speed, total drives memory */
  active_params_b: number
  /** fp16 KV cache size at 8,192 context tokens */
  kv_gb_per_8k: number
  quants: Record<string, { file_gb: number }>
  context_max: number
  popularity_rank: number
}

export interface Quant {
  id: string
  label: string
}

export interface Coeffs {
  decode_bw_eff: number
  prefill_flops_eff: number
  /** multiplicative throughput derate per 8k tokens of context depth */
  ctx_derate_per_8k: number
}

export interface OffloadCal {
  /** effective system-RAM bandwidth serving CPU-resident weights, GB/s */
  ram_bw_gbs: number
  /** LOO error factors from offload-row calibration — interval width */
  err_q50: number
  err_q80: number
  n_rows: number
}

export interface ComboPred {
  tier: Tier
  /** [lo, hi] tok/s at near-zero context; null for wont_run */
  gen_tps: [number, number] | null
  /** [lo, hi] tok/s per prompt-length preset (same order as prompt_presets); null if unmodeled */
  prefill_tps: [number, number][] | null
  /** links to the measurements behind a hand-curated combo */
  sources?: string[]
  /** same-architecture models some of those measurements actually ran */
  tested?: string[]
  /** the file format the measurement ran, when it isn't this catalog quant (e.g. MLX 4-bit) */
  ran?: string
}

/** a measured multi-device run, shown next to the projection; quant is free text because
 *  most cluster runs use engine-native formats (MLX, NVFP4, AWQ) the catalog doesn't have */
export interface ClusterRun {
  hw: string
  n: number
  link: string
  engine: string
  model: string
  quant: string
  gen_tps: number
  /** the model actually benchmarked, when a same-architecture proxy stands in */
  tested: string | null
  source: string
}

/** how several identical devices are joined into one setup; factors are per doubling for
 *  'tensor' (speed × f^log2 n) and flat for 'layer' (speed × f) */
export interface Link {
  label: string
  mode: 'tensor' | 'layer'
  max_n: number
  decode_dense: number
  decode_moe: number
  prefill_dense: number
  prefill_moe: number
  source: string
}

export interface Bench {
  id: string
  name: string
  short: string
  unit: string
  url: string
  note: string
  /** 'elo' scores cluster far from zero, so the chart's axis starts near the lowest one */
  axis?: 'elo'
}

/** published scores per model id; `_note` says which variant or mode the scores belong to,
 *  `_vendor` lists the benchmark ids whose score only the model's maker has reported */
export type Scores = Record<string, number | string | string[] | undefined> & { _note?: string; _vendor?: string[] }
/** a closed-weight API model, shown in the quality chart for reference only */
export interface ClosedRef { id: string; name: string; maker: string; released: string; scores: Scores; sources: string[] }

/** throughput past the longest prompt preset falls as (1 + from/K) / (1 + ctx/K) */
export interface LongCtx {
  from_tokens: number
  decode_k_dense: number
  decode_k_moe: number
  prefill_k: number
  /** sliding-window / hybrid linear attention models slow down much less with depth */
  decode_k_efficient: number
  prefill_k_efficient: number
  /** Metal override of prefill_k_efficient for dense models */
  prefill_k_efficient_metal_dense?: number
  efficient_attention: string[]
}

interface AppData {
  prompt_presets: number[]
  hardware: Hw[]
  models: Model[]
  coefficients: Partial<Record<Backend, Coeffs>>
  offload?: OffloadCal
  /** keyed "hardware_id|model_id|quant" */
  combos: Record<string, ComboPred>
  links?: Record<string, Link>
  cluster_runs?: ClusterRun[]
  benchmarks?: Bench[]
  scores?: Record<string, Scores>
  closed_refs?: ClosedRef[]
  long_context?: LongCtx
  /** first open-weights release, YYYY-MM-DD */
  released?: Record<string, string>
  /** decode bandwidth efficiency per backend, plus dense overrides per hardware id */
  projected_decode_eff?: Partial<Record<Backend, { dense: number; moe: number }>> & {
    hardware?: Record<string, number>
    /** MoE floor on weight bytes read per token, GB per billion active params */
    moe_min_gb_per_b?: number
    /** MoE fixed time per token, ms */
    moe_overhead_ms?: number
  }
  /** factors that put a row measured with MLX on the llama.cpp basis the app models */
  mlx_to_llamacpp?: { decode: number; prefill: number }
  /** pipeline measured combos treated as derived because the source measured something else */
  pipeline_demote?: { keys: string[] }
  /** per-hardware prefill multipliers for chips whose compute the TFLOPS spec understates */
  prefill_mult?: { hardware: Record<string, { dense: number; moe: number }> }
}

// Hand-curated entries (new models, cluster setups) live in app-data.projected.json so a
// pipeline re-run can't overwrite them. Lists are appended; the pipeline wins on id clashes,
// except that a measured overlay combo replaces a pipeline combo that is only derived or projected
// (keeping the pipeline's prefill when the overlay has none). Overlay rows measured with MLX are scaled
// to llama.cpp speed, and pipeline combos listed in pipeline_demote count as derived.
const EXTRA = projected as unknown as Partial<AppData>
const MLX = EXTRA.mlx_to_llamacpp
const EXTRA_COMBOS: Record<string, ComboPred> = Object.fromEntries(Object.entries(EXTRA.combos ?? {}).map(([k, c]) =>
  [k, MLX && c.ran?.includes('MLX') ? {
    ...c,
    gen_tps: c.gen_tps && [c.gen_tps[0] * MLX.decode, c.gen_tps[1] * MLX.decode],
    prefill_tps: c.prefill_tps && c.prefill_tps.map(([a, b]) => [a * MLX.prefill, b * MLX.prefill]),
  } : c]))
const DEMOTE = new Set(EXTRA.pipeline_demote?.keys ?? [])
const RAW_COMBOS: Record<string, ComboPred> = Object.fromEntries(Object.entries((raw as unknown as AppData).combos)
  .map(([k, c]) => [k, DEMOTE.has(k) ? { ...c, tier: 'derived' as const } : c]))
const merge = <T extends { id: string }>(base: T[], extra: T[] = []) => [...base, ...extra.filter(e => !base.some(b => b.id === e.id))]
const DATA: AppData = {
  ...(raw as unknown as AppData),
  hardware: merge((raw as unknown as AppData).hardware, EXTRA.hardware),
  models: merge((raw as unknown as AppData).models, EXTRA.models),
  combos: { ...EXTRA_COMBOS, ...RAW_COMBOS, ...Object.fromEntries(Object.entries(EXTRA_COMBOS)
    .filter(([k, c]) => c.tier === 'measured' && RAW_COMBOS[k] && RAW_COMBOS[k].tier !== 'measured')
    .map(([k, c]) => [k, c.prefill_tps ? c : { ...c, prefill_tps: RAW_COMBOS[k].prefill_tps }])) },
  links: EXTRA.links,
  cluster_runs: EXTRA.cluster_runs,
  benchmarks: EXTRA.benchmarks,
  scores: EXTRA.scores,
  closed_refs: EXTRA.closed_refs,
  released: EXTRA.released,
  long_context: EXTRA.long_context,
  projected_decode_eff: EXTRA.projected_decode_eff,
  prefill_mult: EXTRA.prefill_mult,
}

export const HW: Hw[] = [...DATA.hardware].sort((a, b) => a.popularity_rank - b.popularity_rank)
/** models released before this are hidden: they sit at the bottom of every 2026 benchmark. Their data stays
 *  in the JSON, and the speed calibration constants were fitted with them */
export const MIN_RELEASED = '2025-12-01'
/** superseded by newer models of the same size that score higher (Qwen 3.6, Gemma 4) */
const SUPERSEDED = new Set(['qwen3-coder-next', 'devstral-small-2-24b', 'devstral-2-123b'])
export const MODELS: Model[] = DATA.models.filter(m => (DATA.released?.[m.id] ?? '') >= MIN_RELEASED && !SUPERSEDED.has(m.id)).sort((a, b) => a.popularity_rank - b.popularity_rank)
export const PROMPT_PRESET_TOKS: number[] = DATA.prompt_presets

/** Kimi ships native INT4, GPT-OSS and MiMo native MXFP4 weights, so their 4-bit files are full quality */
export const nativeLowBit = (modelId: string, quantId: string) => /kimi|gpt-oss|mimo/.test(modelId) && /^(ud-)?q4_|^mxfp4$/.test(quantId)

export function quantOf(id: string): Quant {
  return { id, label: id.toUpperCase() }
}

/** quants this model actually has files for, smallest first */
export function quantsFor(m: Model): Quant[] {
  return Object.keys(m.quants)
    .sort((a, b) => m.quants[a].file_gb - m.quants[b].file_gb)
    .map(quantOf)
}

const FALLBACK_COEFFS: Coeffs = { decode_bw_eff: 0.5, prefill_flops_eff: 0.25, ctx_derate_per_8k: 0.92 }

export function coeffs(backend: Backend): Coeffs {
  return DATA.coefficients[backend] ?? FALLBACK_COEFFS
}

/** decode bandwidth efficiency from measured llama.cpp rows, split by dense/MoE, with per-device dense
 *  overrides; backends the overlay doesn't calibrate fall back to the pipeline's blended coefficient */
export function decodeEff(hw: Hw, moe: boolean): number {
  const h = moe ? undefined : DATA.projected_decode_eff?.hardware?.[hw.id]
  const e = DATA.projected_decode_eff?.[hw.backend]
  return h ?? (e ? (moe ? e.moe : e.dense) : coeffs(hw.backend).decode_bw_eff)
}

/** the overlay calibrates decode efficiency for this backend */
export const decodeEffCalibrated = (backend: Backend) => !!DATA.projected_decode_eff?.[backend]

/** weight GB read per token and fixed ms per token for the bandwidth formula. On calibrated backends
 *  MoE models read at least a floor per active parameter and pay a fixed per-token time, so tiny
 *  active weights don't project absurd speeds. */
export function decodeCost(hw: Hw, m: Model, aw: number): { gb: number; ms: number } {
  const e = DATA.projected_decode_eff
  if (m.active_params_b >= m.total_params_b || !decodeEffCalibrated(hw.backend)) return { gb: aw, ms: 0 }
  return { gb: Math.max(aw, m.active_params_b * (e?.moe_min_gb_per_b ?? 0)), ms: e?.moe_overhead_ms ?? 0 }
}

/** prefill multiplier for this hardware, 1 unless the overlay calibrates one */
export function prefillMult(hwId: string, moe: boolean): number {
  const p = DATA.prefill_mult?.hardware[hwId]
  return p ? (moe ? p.moe : p.dense) : 1
}

export const LONG_CTX: LongCtx = DATA.long_context ?? { from_tokens: 12500, decode_k_dense: 100000, decode_k_moe: 50000, prefill_k: 30000, decode_k_efficient: 150000, prefill_k_efficient: 40000, efficient_attention: [] }

export const OFFLOAD: OffloadCal = DATA.offload ?? { ram_bw_gbs: 55, err_q50: 1.5, err_q80: 2.0, n_rows: 0 }

/** the interconnect a multi-device setup of this hardware uses */
export function linkFor(hw: Hw): Link {
  const L = DATA.links!
  if (hw.vendor === 'apple') return L['tb5-rdma']
  if (hw.id.startsWith('dgx-spark')) return L['connectx7']
  if (hw.form_factor === 'desktop' || hw.form_factor === 'server') return hw.vendor === 'cpu' ? L['ethernet-rpc'] : L['pcie']
  return L['ethernet-rpc']
}

/** node counts the hardware's link supports, 1 first */
export const nodeCounts = (hw: Hw) => [1, 2, 4, 8].filter(n => n <= linkFor(hw).max_n)

/** a node count this hardware supports, else 1 (for share links and hardware switches) */
export const clampNodes = (hw: Hw, n: unknown) => typeof n === 'number' && nodeCounts(hw).includes(n) ? n : 1

/** macOS caps GPU-wired memory at ~75% of unified memory; `sudo sysctl iogpu.wired_limit_mb`
 *  raises it, and leaving ~8 GB for the system is the usual setting. Per-device MB to set. */
export const macRaisedLimitMb = (hw: Hw) => (hw.vram_gb - 8) * 1024
export const macRaisedUsable = (hw: Hw, n: number) => (hw.vram_gb - 8) * (n > 1 ? n * 0.97 : 1)
/** per-device GPU memory on a Mac: 75% by default, total - 8 GB with the limit raised (when that is more) */
export const macUsable = (hw: Hw, raised: boolean) => raised ? Math.max(hw.vram_gb * 0.75, hw.vram_gb - 8) : hw.vram_gb * 0.75
/** raising the limit gains memory only above 32 GB */
export const macCanRaise = (hw: Hw) => hw.vendor === 'apple' && hw.vram_gb - 8 > hw.vram_gb * 0.75
/** empty for non-Macs, and when raising the limit gains nothing: at 32 GB and below, total - 8 GB is under the 75% default */
export const macLimitNote = (hw: Hw, n: number, raised = false) => !macCanRaise(hw) ? '' : raised ?
  `Assumes the macOS GPU memory limit is raised with sudo sysctl iogpu.wired_limit_mb=${macRaisedLimitMb(hw)}${n > 1 ? ' on each Mac' : ''}, ` +
  `leaving about 8 GB for the system. The setting resets on reboot.` :
  `Macs: macOS lets the GPU use about 75% of unified memory by default, which is what these numbers assume. ` +
  `Running sudo sysctl iogpu.wired_limit_mb=${macRaisedLimitMb(hw)}${n > 1 ? ' on each Mac' : ''} raises it to leave about 8 GB for the system, ` +
  `giving about ${Math.round(macRaisedUsable(hw, n))} GB usable here. The setting resets on reboot.`

export const setupName = (hw: Hw, n: number) => n > 1 ? `${n}× ${hw.name}` : hw.name

export const BENCHES: Bench[] = DATA.benchmarks ?? []
export const releasedOf = (modelId: string) => DATA.released?.[modelId] ?? ''
/** "Apr 2026", or '' when unknown */
/** "Apr 2026" for a YYYY-MM-DD date, '' when missing */
export const dateLabel = (d: string | undefined) => d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''
export const releasedLabel = (modelId: string) => dateLabel(releasedOf(modelId))
export const scoresOf = (modelId: string): Scores => DATA.scores?.[modelId] ?? {}
/** the score is self-reported by the model's maker, not an independent run */
export const isVendorScore = (modelId: string, benchId: string) => scoresOf(modelId)._vendor?.includes(benchId) ?? false
export const CLOSED: ClosedRef[] = DATA.closed_refs ?? []

export const clusterRuns = (hwId: string, modelId: string) =>
  (DATA.cluster_runs ?? []).filter(r => r.hw === hwId && r.model === modelId).sort((a, b) => a.n - b.n)

export function combo(hwId: string, modelId: string, quantId: string): ComboPred | undefined {
  return DATA.combos[`${hwId}|${modelId}|${quantId}`]
}

/** the combo in effect is a hand-curated one with its own measured prefill */
export function handPrefill(hwId: string, modelId: string, quantId: string): boolean {
  const k = `${hwId}|${modelId}|${quantId}`
  return !!DATA.combos[k]?.prefill_tps && DATA.combos[k] === EXTRA_COMBOS[k]
}

// Share URLs minted before the pipeline-style catalog ids existed. Catalog ids are
// permanent per the data contract, so this map only ever grows.
const LEGACY_HW: Record<string, string> = {
  rtx3060: 'rtx-3060', rtx4070: 'rtx-4070', rtx4070ts: 'rtx-4070-ti-super',
  rtx4090: 'rtx-4090', rtx5090: 'rtx-5090',
  m2pro: 'm2-pro-16gb', m4pro: 'm4-pro-24gb', m3max: 'm3-max-48gb', m4max: 'm4-max-128gb',
  rx7900xt: 'rx-7900-xt', rx7900xtx: 'rx-7900-xtx',
  a100: 'a100-80gb', h100: 'h100-80gb',
}
const LEGACY_MODEL: Record<string, string> = {
  'llama31-8b': 'llama-3.1-8b', 'llama33-70b': 'llama-3.3-70b',
  'qwen25-7b': 'qwen-2.5-7b', 'qwen25-32b': 'qwen-2.5-32b', 'qwen25-72b': 'qwen-2.5-72b',
  mistral7b: 'mistral-7b', mixtral: 'mixtral-8x7b',
  'r1-14b': 'deepseek-r1-14b', 'r1-32b': 'deepseek-r1-32b', phi4: 'phi-4-14b',
}
const LEGACY_QUANT: Record<string, string> = { q4: 'q4_k_m', q8: 'q8_0', f16: 'fp16' }

export const canonHw = (id: string) => LEGACY_HW[id] ?? id
export const canonModel = (id: string) => LEGACY_MODEL[id] ?? id
export const canonQuant = (id: string) => LEGACY_QUANT[id] ?? id

export interface Preset {
  label: string
  tok: number
  text: string
}

// Prompt texts are pure UI; the token depths come from app-data.json so the
// pipeline's prefill presets and the picker always agree.
const PRESET_UI: { label: string; text: string }[] = [
  { label: 'Short chat', text: "What's the practical difference between RAM and VRAM for running local models? Keep it brief." },
  { label: 'Email draft', text: "Draft a polite email to my landlord about the broken heating. Notes: reported it twice already (Oct 12, Oct 19), no response. Lease says repairs within 14 days. I want a firm but friendly tone, mention I'll escalate to the tenancy board if not fixed by end of month. Sign as Sam." },
  { label: 'Code file', text: "Review this file for bugs and suggest fixes:\n\nfunction debounce(fn, wait) {\n  let t;\n  return (...args) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(args), wait);\n  };\n}\n\nasync function fetchUsers(ids) {\n  const out = [];\n  ids.forEach(async id => {\n    const r = await fetch('/api/users/' + id);\n    out.push(r.json());\n  });\n  return out;\n}\n\n… [file continues — ~1,800 tokens total]" },
  { label: '20-page doc', text: "Summarize the key obligations, deadlines, and termination clauses in this services agreement:\n\nMASTER SERVICES AGREEMENT — This Agreement is entered into as of the Effective Date by and between the Client and the Provider. 1. SERVICES. Provider shall perform the services described in each Statement of Work…\n\n… [document continues — ~12,500 tokens total]" },
]

export const PRESETS: Preset[] = PRESET_UI.map((p, i) => ({ ...p, tok: PROMPT_PRESET_TOKS[i] ?? [42, 290, 1800, 12500][i] }))

export const RESP: string[] = [
  "RAM is your system's general-purpose working memory — the CPU uses it for everything. VRAM is memory that lives on the graphics card, wired directly to the GPU with much higher bandwidth. For local models that distinction is the whole game: the model's weights have to be read once per generated token, so whichever memory holds the weights sets your speed. Weights in VRAM stream at hundreds of GB/s; spill into system RAM and you drop to a tenth of that. Practical rule: buy enough VRAM to hold the model you actually want to run, at the quantization you can tolerate. Speed is mostly memory bandwidth, capacity decides what fits.",
  "Here's a draft you can send:\n\nSubject: Heating repair — follow-up and next steps\n\nHi [Landlord's name],\n\nI'm writing to follow up on the broken heating in my unit, which I reported on October 12 and again on October 19 without a response. As the weather is getting colder, this is becoming urgent.\n\nPer the lease, repairs are to be completed within 14 days of notice — we're now well past that window from my first report. I'd genuinely prefer to resolve this directly: could you confirm by Friday when a repair visit will happen?\n\nIf the heating isn't fixed by the end of the month, I'll need to escalate the matter to the tenancy board, which I'd rather avoid.\n\nThanks for your attention to this.\n\nBest,\nSam",
  "Two real bugs here.\n\n1. debounce drops the spread. You collect ...args but then call fn(args) — that passes a single array instead of the original arguments. Fix: fn(...args). Also consider preserving `this` by using a function expression and fn.apply(this, args) if it will decorate methods.\n\n2. fetchUsers returns before any fetch resolves. forEach ignores the async callback's promise, so `out` is empty (or partially filled, later — a race). Also r.json() is pushed as a promise, never awaited. Fix:\n\nasync function fetchUsers(ids) {\n  return Promise.all(ids.map(async id => {\n    const r = await fetch('/api/users/' + id);\n    if (!r.ok) throw new Error('user ' + id + ': ' + r.status);\n    return r.json();\n  }));\n}\n\nThat runs requests concurrently, preserves order, and surfaces HTTP errors instead of silently succeeding. If the id list can be large, batch with a small concurrency limit to avoid hammering the API.",
  "Summary of key obligations, deadlines, and termination provisions:\n\nProvider obligations. Perform services per each Statement of Work to professional standards; assign qualified personnel; deliver work product on the schedule set in the applicable SOW; maintain confidentiality of Client materials indefinitely for trade secrets and five years for other confidential information.\n\nClient obligations. Provide timely access to systems, data, and personnel reasonably needed; review and accept or reject deliverables within 10 business days (silence is deemed acceptance); pay undisputed invoices net-30 from receipt, with 1.5% monthly late interest.\n\nKey deadlines. Deliverable review: 10 business days. Invoice payment: 30 days. Cure period for material breach: 30 days from written notice. Insurance certificates due within 15 days of signing.\n\nTermination. Either party may terminate for uncured material breach after the 30-day cure window. Client may terminate any SOW for convenience on 30 days' written notice, paying for work performed plus non-cancellable commitments. Provider may suspend work if undisputed invoices are 45+ days overdue, after 10 days' notice. Sections on confidentiality, IP assignment, and limitation of liability survive termination.",
]

export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
