// What a speed means in practice, and what a quantization costs in quality. The thresholds
// are rules of thumb anchored to measured facts (reading speed, response-time research,
// llama.cpp KL-divergence tables); the /guide/ page cites them. Kept free of window/document
// access so the page prerenders.
import type { CalcResult } from './calc'
import { fmt } from './calc'

/** silent reading ≈ 238 wpm (Brysbaert 2019) ≈ 5.3 tok/s at 0.75 words per token */
export const READING_TPS = 5.3
/** coding agents need a long context to hold a repo and tool output; 256K is the practical floor */
export const AGENT_CTX = 262144
/** hidden thinking tokens a reasoning model spends before answering */
const THINK_TOKENS = 2000

const band = (tps: number, cuts: number[], words: string[]) => words[cuts.findIndex(c => tps < c) === -1 ? words.length - 1 : cuts.findIndex(c => tps < c)]

const secs = (s: number) => { const r = Math.round(s); return r < 60 ? `${r} s` : `${Math.floor(r / 60)} min ${r % 60} s` }

export interface Verdict { label: string; head: string; detail: string; good: boolean }

const cap = (x: string) => x[0].toUpperCase() + x.slice(1)

/** verdicts per workload for an estimate that runs. `agent` is the same setup estimated at an
 *  AGENT_CTX-token prompt (its prefill rate and memory fit) */
export function workloads(c: CalcResult, agent: CalcResult, contextMax: number): Verdict[] {
  const t = c.base
  const agentOk = contextMax >= AGENT_CTX && agent.fit === 'fits'
  const think = THINK_TOKENS / t
  return [
    { label: 'Chat', head: cap(band(t, [5, 10, 20, 40], ['slower than you read', 'reading speed', 'comfortable', 'snappy', 'faster than you read'])),
      detail: `${fmt(t)} tok/s; you read about ${READING_TPS}`, good: t >= 10 },
    { label: 'Coding help', head: cap(band(t, [5, 10, 20, 40], ['unusable', 'sluggish', 'usable', 'good', 'great'])),
      detail: `writes a 300-line file (~3K tokens) in ${secs(3000 / t)}`, good: t >= 10 },
    { label: 'Agentic coding',
      head: contextMax < AGENT_CTX || agent.fit !== 'fits' ? 'Won\'t fit' : cap(band(agent.base, [10, 20, 40, 80], ['too slow', 'slow', 'workable', 'good', 'great'])),
      detail: contextMax < AGENT_CTX ? `context tops out at ${Math.round(contextMax / 1024)}K; agents need 256K`
        : agent.fit !== 'fits' ? 'a 256K context doesn\'t fit in memory'
        : `${fmt(agent.base)} tok/s at 256K deep; first full read ${secs(agent.ttft)}, cached turns after`,
      // the first 256K read is a one-time cost; cached turns run at decode speed, so that decides
      good: agentOk && agent.base >= 20 },
    { label: 'Reasoning', head: think < 30 ? 'Quick' : think < 90 ? 'Noticeable wait' : 'Long wait',
      detail: `a ${THINK_TOKENS / 1000}K-token hidden think takes ${secs(think)}`, good: think < 30 },
  ]
}

/** short quality note for a quant id; params matter because big models tolerate low bits better */
export function quantNote(id: string, totalParamsB: number): string {
  if (id === 'fp16') return 'reference quality'
  if (id === 'mxfp4') return 'native format, full quality'
  if (/q8/.test(id)) return 'indistinguishable'
  if (/q6|q5/.test(id)) return 'near-lossless'
  if (/q4|iq4/.test(id)) return 'small loss'
  if (/q3|iq3/.test(id)) return totalParamsB >= 100 ? 'minor loss on big models' : 'noticeable on code/math'
  if (/q2|iq2/.test(id)) return totalParamsB >= 200 ? 'usable on huge models' : 'large loss'
  if (/iq1/.test(id)) return totalParamsB >= 400 ? 'last resort, huge models only' : 'broken on this size'
  return ''
}

const SPEED_ROWS: [string, string, string, string, string][] = [
  ['under 5', 'slower than reading', 'unusable', 'unusable', 'over 6.5 min'],
  ['5-10', 'about reading speed', 'sluggish', 'very slow', '3.3-6.7 min'],
  ['10-20', 'comfortable', 'usable', 'slow, turns add up', '1.7-3.3 min'],
  ['20-40', 'snappy', 'good', 'workable', '50 s - 1.7 min'],
  ['40-80', 'faster than you read', 'great', 'good', '25-50 s'],
  ['80+', 'no visible gain', 'instant', 'best; prefill now limits', 'under 25 s'],
]

const QUANT_ROWS: [string, string, string, string][] = [
  ['FP16 / BF16', '16', 'reference', '-'],
  ['Q8_0', '8.5', 'indistinguishable', '+0.02% PPL, KLD 0.001, 97.7% same top token'],
  ['Q6_K', '6.6', 'indistinguishable in practice', '+0.3% PPL, KLD 0.006'],
  ['Q5_K_M', '5.7', 'minor', '+0.9% PPL, KLD 0.011'],
  ['Q4_K_M', '4.9', 'small loss, the usual default', '+2.4% PPL, KLD 0.028, 91.9% same top token'],
  ['IQ4_XS', '4.4', 'small to noticeable', '+3.6% PPL, KLD 0.036'],
  ['Q3_K_M', '4.0', 'noticeable, worst on code and math', '+10.5% PPL, KLD 0.10'],
  ['Q2_K', '3.2', 'large on small models', '+56% PPL, KLD 0.45, 71% same top token'],
  ['IQ1_S', '2.0', 'broken on small models', 'PPL ~10x'],
]

export function GuideSection() {
  return (
    <>
      <h2>How fast is fast enough?</h2>
      <p>
        People read silently at about 238 words per minute, roughly {READING_TPS} tokens per second
        (<a href="https://www.gwern.net/doc/psychology/linguistics/2019-brysbaert.pdf">Brysbaert 2019</a>, at OpenAI's 0.75 words per token).
        Anything above that streams faster than you can follow. What else matters depends on the job.
        There is no user study that sets tok/s cut-offs, so the table below is a rule of thumb built from reading speed
        and the <a href="https://www.nngroup.com/articles/response-times-3-important-limits/">0.1 s / 1 s / 10 s response-time limits</a>.
      </p>
      <div class="seo-table"><table>
        <thead><tr><th>tok/s</th><th>Chat</th><th>Coding help</th><th>Agentic coding</th><th>2K-token thinking</th></tr></thead>
        <tbody>{SPEED_ROWS.map(r => <tr key={r[0]}>{r.map((x, i) => <td key={i}>{x}</td>)}</tr>)}</tbody>
      </table></div>
      <h3>Time to first token</h3>
      <p>
        Under 0.3 s feels instant and is what editor autocomplete needs (Copilot completions average under 200 ms).
        Up to 1 s is fine for chat. 1-3 s is noticeable but acceptable for agent steps and document questions.
        Past 10 s attention wanders, so long prompts need a progress indicator.
      </p>
      <p>
        Two workloads are bound by prompt processing (prefill), not generation. <strong>Agentic coding</strong> re-sends
        a large context on every turn, and a real repository plus tool output needs at least 256K tokens of it.
        The first full read of 256K takes minutes even on fast GPUs (an RTX PRO 6000 prefills about 640 tok/s at that depth, and generation drops
        from about 200 to 38 tok/s), so prompt caching decides how long later steps wait. Models capped at 128K context don't make the cut.
        <strong> Document summarization and RAG</strong> wait roughly prompt tokens ÷ prefill speed before the first word.
        Macs and Strix Halo generate well for their price but prefill slowly; discrete NVIDIA cards prefill several times faster.
        <strong> Reasoning models</strong> think in hidden tokens first, so their thinking time acts like extra wait before the answer.
      </p>

      <h2>What quantization costs in quality</h2>
      <p>
        Quantization stores each weight in fewer bits. The numbers below are measured on Llama 3 8B against FP16 on Wikitext-2
        (<a href="https://github.com/ggml-org/llama.cpp/blob/master/tools/perplexity/README.md">llama.cpp perplexity tables</a>).
        KLD is how far the output distribution drifts from the original; lower is better.
      </p>
      <div class="seo-table"><table>
        <thead><tr><th>Quant</th><th>Bits/weight</th><th>Quality</th><th>Measured (8B model)</th></tr></thead>
        <tbody>{QUANT_ROWS.map(r => <tr key={r[0]}>{r.map((x, i) => <td key={i}>{x}</td>)}</tr>)}</tbody>
      </table></div>
      <h3>Bigger models tolerate fewer bits</h3>
      <p>
        The same quant hurts a small model more. On Llama 2 70B, Q2_K costs +8.8% perplexity against +56% on an 8B model.
        Unsloth's dynamic quants push this further on huge MoE models: DeepSeek V3.1 (671B) keeps 69.7 of 71.6 on Aider Polyglot at 4-bit,
        65.8 at 2-bit, and still 55.7 at 1-bit (<a href="https://unsloth.ai/docs/basics/unsloth-dynamic-2.0-ggufs/unsloth-dynamic-ggufs-on-aider-polyglot">Unsloth</a>).
        The same 1-bit treatment breaks a 27B model (Gemma 3 27B MMLU drops from 71.5 to 41.9).
      </p>
      <p>
        Rules of thumb: Q8 is free, Q4_K_M is the sweet spot for most models, Q3 is fine on 100B+ models but shows on code and math in
        small ones, and 1-2 bit quants only make sense for models in the hundreds of billions of parameters.
        Code, math and long reasoning chains degrade first (<a href="https://arxiv.org/abs/2504.04823">Liu et al. 2025</a>).
        Models that ship in a low-bit format, like GPT-OSS in MXFP4 or Kimi K2 in INT4, lose nothing at that size because they were trained for it.
      </p>
      <h3>KV cache quantization</h3>
      <p>
        Quantizing the context cache saves memory at long contexts. Q8_0 for both keys and values is close to free (+0.05% perplexity in one test);
        values are more sensitive than keys, so be careful with Q4 values. The evidence here is thinner, mostly community tests.
      </p>
    </>
  )
}
