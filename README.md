# ⚡ llmspeed

**Feel how fast a local LLM runs before you buy the hardware.**

Pick a GPU or Mac and a model, and watch the answer stream at the real speed, including the wait before the first token.

[![Live site](https://img.shields.io/badge/try_it-llmspeed.dev-e05a3c)](https://llmspeed.dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Deploy](https://github.com/nicorobinreal/llmspeed/actions/workflows/deploy.yml/badge.svg)](https://github.com/nicorobinreal/llmspeed/actions/workflows/deploy.yml)

https://github.com/user-attachments/assets/534b4736-6b59-426e-bc0a-e93a196156b9

*RTX 5090 vs Mac Studio M5 Ultra 512GB on GLM-5.3 Flash (Q8). The 5090 can't load it.*

## Features

- **Real-time simulation:** text streams at the predicted tokens/sec, after a realistic time to first token for your prompt length
- **Race mode:** run two setups side by side, e.g. a 5090 against a Mac Studio
- **Memory fit:** see whether a model fits at each quantization, needs partial offload to system RAM, or won't run at all
- **30 GPUs, Macs and CPUs × 18 open models released since December 2025**, across CUDA, Metal, ROCm, Vulkan and CPU
- **Multi-device setups:** 2 to 8 devices joined over Thunderbolt 5 RDMA (Macs), ConnectX-7 (DGX Spark), PCIe (GPUs in one PC) or Ethernet (llama.cpp RPC), with measured cluster runs shown next to the estimate
- **Model quality chart:** 2026 benchmark scores (LMArena WebDev by default, Terminal-Bench 4.0 and 2.1, AA Index, LMArena Text, DeepSWE, τ³-bench, AIME 2026, CyberGym) for every listed model, with closed API models as reference bars, highlighting what runs on your setup
- **Workload verdicts and a [guide](https://llmspeed.dev/guide/):** what a given tok/s means for chat, coding help, coding agents and reasoning models, and what each quantization costs in quality
- **Shareable links** to any setup or race

## How the numbers work

Every estimate is labeled with how much to trust it:

| Label | Meaning |
|---|---|
| **Measured** | Benchmarked on this exact hardware, model and quantization |
| **Derived** | Not measured on this setup: on NVIDIA, Apple and AMD GPUs the bandwidth formula calibrated on measured llama.cpp runs, elsewhere interpolated from similar setups |
| **Projected** | Calculated from hardware specs, e.g. for announced but unreleased hardware |

**Sources.** Benchmarks are collected and verified from [r/LocalLLaMA](https://www.reddit.com/r/LocalLLaMA/), [localscore.ai](https://www.localscore.ai/), llama.cpp discussions and more.

**The model.** When no benchmark exists, llmspeed falls back to first principles:

- **Generation speed** is bound by memory bandwidth: every token reads the active weights once. For mixture-of-experts models only the active parameters count.
- **Prompt processing** is bound by compute (FP16 TFLOPS). M5 Macs get a per-chip multiplier for the matrix units in their GPU cores, which the TFLOPS figure leaves out.
- Both use per-backend efficiency coefficients calibrated against the measured benchmarks, plus a slowdown as context grows. Decode efficiency is fitted separately for dense and mixture-of-experts models to llama.cpp runs at short context with speculative decoding off, and a few devices whose own runs sit far from their backend (M3 Ultra, MI50, RX 9070 XT) get their own dense value. For mixture-of-experts models the formula also adds a fixed 2 ms per token and counts at least 0.5 GB per billion active parameters, since attention and shared weights stay near 8 bits in low-bit files; without these, tiny active weights projected several hundred tokens per second more than measured runs show. The fitted values and their sources are in [`data/app-data.projected.json`](data/app-data.projected.json) under `projected_decode_eff`.
- **The engine is llama.cpp** (also what Ollama and LM Studio run for GGUF files). A few measured rows only exist as MLX runs on a Mac; they are scaled to llama.cpp speed (decode ×0.84, prompt processing ×1.23, medians of same-Mac pairs), and the breakdown names the MLX file they ran.
- **Partial offload** uses a hybrid model: the GPU-resident share streams at GPU bandwidth and the spilled share at an effective system-RAM bandwidth, calibrated from measured offload runs.
- **Memory fit** counts weights, KV cache and runtime overhead against usable memory: about 75% of unified memory on Macs and 93% of VRAM on discrete GPUs. The KV cache defaults to F16, which llama.cpp, Ollama and LM Studio all use unless told otherwise; Q8_0 and Q4_0 caches can be picked in the quantization menu. The cache type changes memory only, not the speed estimate.

## Contributing benchmarks

The most valuable contribution is a real measurement. To add one, open a PR that appends a row to [`benchmarks/submissions.csv`](benchmarks/submissions.csv).

1. Run llama.cpp's benchmark tool on your machine:
   ```sh
   llama-bench -m your-model.gguf -p 512 -n 128
   ```
2. Add a row with your results:

   | Column | Example |
   |---|---|
   | `hardware` | `NVIDIA RTX 4090 24GB` |
   | `model` | `Llama 3.1 8B Instruct` |
   | `quant` | `Q4_K_M` |
   | `backend` | `CUDA`, `Metal`, `ROCm`, `Vulkan` or `CPU` |
   | `engine_version` | `llama.cpp b6500` |
   | `gen_tps` | `128.4` (the `tg128` result) |
   | `prefill_tps` | `9850` (the `pp512` result) |
   | `prompt_tokens` | `512` |
   | `source_url` | a link to your post, issue or gist with the full output |
   | `notes` | anything unusual: power limits, flash attention, offload, … |

3. In the PR description, paste the full `llama-bench` output.

Results from other engines (MLX, vLLM, ExLlama, …) are welcome too; just name the engine in `engine_version`. Want a model or GPU added? Open an issue.

## Development

```sh
npm install
npm run dev      # local dev server
npm run build    # production build + prerendered landing pages + sitemap
```

Built with [Vite](https://vite.dev), [Preact](https://preactjs.com) and TypeScript. The site is fully static and deployed to GitHub Pages on every push to `main`. All predictions live in [`data/app-data.json`](data/app-data.json), which is generated by the benchmark pipeline. Hand-added entries that have no pipeline data yet (new models, cluster setups) go in [`data/app-data.projected.json`](data/app-data.projected.json), which is merged in at load time so a pipeline run doesn't overwrite them.

## Limitations

- **Clusters are projected.** Multi-device speeds scale a single-device estimate by per-link factors calibrated from a handful of published runs; most of those runs used engine-native formats (MLX, NVFP4, AWQ), not GGUF.
- **Mac memory** assumes the default macOS GPU limit (about 75% of unified memory). The hardware menu can switch to a raised limit (total minus 8 GB, set with `sudo sysctl iogpu.wired_limit_mb`), which resets on reboot.
- **M5 prompt processing** assumes an engine that uses the Metal 4 tensor API, as current llama.cpp does. Builds without it, such as some LM Studio runtimes, can process prompts about half as fast.
- **Partial offload** still uses the older blended GPU efficiency, because its system-RAM bandwidth was fitted together with it. Speeds just past the fit boundary can therefore step down more than they would in practice.
- **Estimates, not guarantees.** Drivers, engine versions, flash attention, power limits and thermals can all move real numbers by 10–30%.
- **Projected numbers** for unreleased hardware will be replaced with measurements as they appear.

## Star history

<a href="https://star-history.com/#nicorobinreal/llmspeed&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=nicorobinreal/llmspeed&type=Date&theme=dark" />
    <img alt="Star history chart" src="https://api.star-history.com/svg?repos=nicorobinreal/llmspeed&type=Date" />
  </picture>
</a>

## License

[MIT](LICENSE). Benchmark data credits go to the r/LocalLLaMA and localscore.ai communities and everyone who has shared their numbers.
