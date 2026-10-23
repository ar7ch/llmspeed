import { coeffs, combo, decodeEff, handPrefill, linkFor, LONG_CTX, OFFLOAD, prefillMult, PROMPT_PRESET_TOKS, type ComboPred, type Hw, type Model, type Quant } from './data'

export type Fit = 'fits' | 'partial' | 'no'
export type Conf = 'measured' | 'derived' | 'projected' | null
/** context (KV) cache precision; llama.cpp, Ollama and LM Studio all default to f16 */
export type KvQ = 'f16' | 'q8_0' | 'q4_0'
/** cache size relative to f16 (q8_0 and q4_0 store 8.5 and 4.5 bits per value) */
export const KV_BYTES: Record<KvQ, number> = { f16: 1, q8_0: 8.5 / 16, q4_0: 4.5 / 16 }

export interface CalcResult {
  /** weight memory, GB */
  w: number
  /** KV cache memory, GB */
  kv: number
  /** usable device memory, GB */
  usable: number
  /** total memory needed, GB */
  total: number
  fit: Fit
  /** decode speed, tok/s */
  base: number
  lo: number
  hi: number
  /** prefill speed, tok/s */
  pre: number
  /** time to first token, s */
  ttft: number
  conf: Conf
  /** decode bandwidth efficiency (coefficient path) */
  eff: number
  /** active weight bytes read per token, GB */
  aw: number
  /** the range came from a pipeline per-combo prediction, not the coefficient formula */
  fromCombo: boolean
  /** fraction of model weights resident on GPU (1 unless fit is partial) */
  gpuShare: number
  /** number of devices in the setup */
  n: number
  /** decode and prefill multipliers from clustering (1 for a single device) */
  decF: number
  preF: number
  kvq: KvQ
}

// NOTE: inferred, no source measured it: replicated embeddings, norms and runtime buffers per node
const CLUSTER_MEM_EFF = 0.97

// Fallback bytes/param per quant, used only when a config references a quant the
// model has no file for (e.g. a stale share link); real sizes come from app-data.
const FALLBACK_BPP: Record<string, number> = { q4_k_m: 0.61, q8_0: 1.06, fp16: 2.0 }

// Long contexts: the per-8K exponential derating fits short prompts but is far too gentle past
// ~16K (an RTX PRO 6000 measured 38 tok/s decode at 256K against 199 at 4K), so beyond the
// longest preset throughput follows a hyperbola fitted to measured long-context runs.
function longCtx(ctx: number, k: number): number {
  const from = LONG_CTX.from_tokens
  return ctx <= from ? 1 : (1 + from / k) / (1 + ctx / k)
}

// log-linear interpolation of the combo's per-preset prefill midpoints over context depth; past the
// longest preset the long-context curve takes over instead of holding the rate flat
function comboPrefill(cb: ComboPred | undefined, ctx: number, prefillK: number): number | null {
  if (!cb || !cb.prefill_tps || !cb.prefill_tps.length) return null
  const n = Math.min(cb.prefill_tps.length, PROMPT_PRESET_TOKS.length)
  const mids = cb.prefill_tps.slice(0, n).map(([a, b]) => (a + b) / 2)
  const toks = PROMPT_PRESET_TOKS.slice(0, n)
  if (ctx <= toks[0]) return mids[0]
  for (let i = 1; i < n; i++) {
    if (ctx <= toks[i]) {
      const t = (Math.log(ctx) - Math.log(toks[i - 1])) / (Math.log(toks[i]) - Math.log(toks[i - 1]))
      return mids[i - 1] + (mids[i] - mids[i - 1]) * t
    }
  }
  return mids[n - 1] * longCtx(ctx, prefillK)
}

/** the pipeline's formula-derived combos put preset-0 prefill at this multiple of the spec formula */
const PIPE_PREFILL_RATIO = 1.11

/** CUDA/Metal context, compute buffers and other runtime memory on top of weights and KV */
export const RUNTIME_GB = 0.6

// NOTE: the cache type changes memory only; measured decode with a quantized cache is about
// the same or slightly slower than f16, so speed is left as is
export function calc(hw: Hw, m: Model, q: Quant, ctx: number, n = 1, kvq: KvQ = 'f16'): CalcResult {
  const co = coeffs(hw.backend)
  const w = m.quants[q.id] ? m.quants[q.id].file_gb : m.total_params_b * (FALLBACK_BPP[q.id] ?? 2)
  const kv = Math.max(0.15, m.kv_gb_per_8k * KV_BYTES[kvq] * (ctx / 8192))
  const usable = (hw.vendor === 'apple' ? hw.vram_gb * 0.75 : hw.vram_gb * 0.93) * (n > 1 ? n * CLUSTER_MEM_EFF : 1)
  const total = w + kv + RUNTIME_GB
  // clusters don't offload to system RAM: the model fits in pooled memory or doesn't run
  const fit: Fit = total <= usable ? 'fits'
    : (n === 1 && hw.vendor !== 'apple' && hw.form_factor !== 'server' && total <= usable * 2.4 ? 'partial' : 'no')
  const moe = m.active_params_b < m.total_params_b
  const shortDerate = Math.pow(co.ctx_derate_per_8k, Math.min(ctx, LONG_CTX.from_tokens) / 8192)
  const efficientAttn = LONG_CTX.efficient_attention.includes(m.id)
  const decodeK = efficientAttn ? LONG_CTX.decode_k_efficient : moe ? LONG_CTX.decode_k_moe : LONG_CTX.decode_k_dense
  // Metal depth sweeps of dense efficient-attention models lose prefill speed more slowly than the
  // cross-backend median. The Metal MoE sweep drops faster, so MoE models keep the shared value.
  const prefillK = !efficientAttn ? LONG_CTX.prefill_k
    : hw.backend === 'metal' && !moe ? LONG_CTX.prefill_k_efficient_metal_dense ?? LONG_CTX.prefill_k_efficient
    : LONG_CTX.prefill_k_efficient
  const derate = shortDerate * longCtx(ctx, decodeK)
  const aw = w * (m.active_params_b / m.total_params_b)
  const cb = combo(hw.id, m.id, q.id)
  const eff = decodeEff(hw.backend, moe)

  let lo: number, hi: number, conf: Conf, fromCombo = false
  if (cb && cb.gen_tps && cb.tier !== 'wont_run') {
    lo = cb.gen_tps[0] * derate
    hi = cb.gen_tps[1] * derate
    conf = cb.tier
    fromCombo = true
  } else {
    const b = (hw.bandwidth_gbs * eff / aw) * derate
    lo = b * 0.85
    hi = b * 1.15
    conf = 'projected'
  }
  // Partial fit: hybrid two-bandwidth model. The GPU-resident share of the
  // active weights streams at GPU bandwidth, the spilled share at effective
  // system-RAM bandwidth (calibrated by the pipeline from measured offload
  // runs) - the two terms add in series. Overrides both paths above: a combo
  // measured full-GPU says nothing about this card's offload behavior.
  let gpuShare = 1
  if (fit === 'partial') {
    gpuShare = usable / total
    const t = (gpuShare * aw) / (hw.bandwidth_gbs * co.decode_bw_eff) + ((1 - gpuShare) * aw) / OFFLOAD.ram_bw_gbs
    const mid = derate / t
    lo = mid / OFFLOAD.err_q80
    hi = mid * OFFLOAD.err_q80
    conf = 'projected'
    fromCombo = false
  }
  // Cluster: start from the single-device speed with the whole model resident (a combo
  // measured on one device, else the bandwidth formula) and scale by the link's factors.
  let decF = 1, preF = 1
  if (n > 1) {
    const L = linkFor(hw)
    const k = L.mode === 'tensor' ? Math.log2(n) : 1
    decF = Math.pow(moe ? L.decode_moe : L.decode_dense, k)
    preF = Math.pow(moe ? L.prefill_moe : L.prefill_dense, k)
    lo *= decF
    hi *= decF
    conf = 'projected'
  }
  if (hw.status === 'announced') conf = 'projected'
  const base = (lo + hi) / 2

  // NOTE: M5 GPUs have matrix units the FP16 TFLOPS spec leaves out, so the pipeline's prefill and the
  // formula both get a per-chip multiplier from the overlay. Pipeline combos whose prefill is the formula
  // sit at PIPE_PREFILL_RATIO x the formula; a measured row above that already shows part of the speedup,
  // so only the rest is applied (M5 Pro gpt-oss-20b runs at 1.68x and gets none). Hand-curated combos
  // carry measured prefill and are left alone.
  const formulaPre = hw.tflops_fp16 * 1000 * co.prefill_flops_eff / (2 * m.active_params_b)
  const seen = cb?.prefill_tps?.length ? (cb.prefill_tps[0][0] + cb.prefill_tps[0][1]) / 2 / (formulaPre * PIPE_PREFILL_RATIO) : 1
  const preMult = handPrefill(hw.id, m.id, q.id) ? 1 : Math.max(1, prefillMult(hw.id, moe) / Math.max(1, seen))
  let pre = (comboPrefill(cb, ctx, prefillK) ?? formulaPre * shortDerate * longCtx(ctx, prefillK)) * preF * preMult
  if (fit === 'partial') pre *= 0.5
  const ttft = ctx / pre + (fit === 'partial' ? 1.2 : 0.3)

  if (fit === 'no') conf = null
  return { w, kv, usable, total, fit, base, lo, hi, pre, ttft, conf, eff: fit === 'partial' ? co.decode_bw_eff : eff, aw, fromCombo, gpuShare, n, decF, preF, kvq }
}

export function fmt(x: number): string {
  return x >= 10 ? Math.round(x).toString() : x.toFixed(1)
}
