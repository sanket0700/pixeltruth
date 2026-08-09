# Generator licensing research - full findings

Two research passes so far, both in service of building `collect_data.py`'s
`TARGET_GENERATORS` list without training on output whose vendor ToS
restricts that use. Pass 1's findings are summarized in
`fine-tuning-scope.md` (repo root, `main`); this file adds pass 2's
expanded results, since that document lives on `main` and this ongoing
research shouldn't keep editing it out from under a shipped decision.

## Pass 1 (original 12 unverified generators)

| Generator | Vendor | Verdict |
|---|---|---|
| Flux Pro v1.1 | Black Forest Labs | Restricted (explicit) |
| SD 3.5 Large | Stability AI | Restricted (explicit - "Community License") |
| Recraft v3 | Recraft | Restricted (explicit) |
| Ideogram v3 | Ideogram | Restricted (indirect - broad "no competing product") |
| Grok Aurora | xAI | Restricted (explicit) |
| Leonardo Phoenix | Leonardo AI | Unverified (site blocks automated access) |
| Seedream | ByteDance/Volcengine | Unverified (language barrier, JS-rendered docs) |
| GLM Image | Zhipu AI | Clean (MIT weights) |
| Z-Image | Alibaba/Tongyi Lab | Clean (Apache 2.0) |
| Wan v2.6 | Alibaba/DashScope | Unverified (no open weights for 2.6 specifically, ToS login-gated) |
| Qwen-Image | Alibaba | Clean (Apache 2.0) |
| Hunyuan v3 | Tencent | Restricted (explicit hard blocker) |

Also confirmed pass-1: GPT Image 1.5 (OpenAI) and Gemini/nano-banana
(Google) both explicitly restricted via their own API terms of service
(not part of the 12-generator sweep - checked directly, see
`fine-tuning-scope.md`).

## Pass 2 (expanded - triggered by "are there more legally-clean generators worth adding")

Key finding: the "no training other models on our output" clause turns
out to be a **newer addition specific to certain vendors' "Community
License" generation** (Stability's post-SD3.5 license, Playground's),
not a feature of the classic OpenRAIL family. That's why SD 3.5 is
restricted but SD 1.x/2.x/XL-base are not - they predate that clause
entirely, different license text.

| Generator | Vendor | License | Verdict |
|---|---|---|---|
| SD 1.4 / 1.5 / 2.1 | Stability AI (1.x via Runway) | CreativeML OpenRAIL-M | **Clean** - Attachment A has no output-training restriction, only illegal-use restrictions (CSAM, defamation, medical/legal advice, etc.) |
| SDXL base 1.0 | Stability AI | CreativeML Open RAIL++-M | **Clean** - same Attachment A structure |
| Dreamshaper | Lykon (community) | CreativeML OpenRAIL-M | **Clean** |
| Juggernaut / Juggernaut XL | RunDiffusion | CreativeML Open RAIL++-M | **Clean** |
| Realistic Vision | SG161222 (community) | CreativeML OpenRAIL-M, explicitly "free, no restrictions" | **Clean** |
| Animagine XL, NoobAI/Pony-family | Cagliostro Lab / community | Fair AI Public License 1.0-SD (FAIPL) | **Clean-leaning** - same prohibited-uses framework, no output-training clause found; has copyleft + revenue-tier terms that don't affect us as a downstream trainer, but verify per-checkpoint before relying on this broadly |
| epicdream, realvisxl, touchofrealism, cyberrealistic | community | presumed OpenRAIL-M/++/FAIPL pattern | **Unverified** - not individually pulled, high confidence same pattern, not directly confirmed |
| openflux.1 | ostris (community) | Apache 2.0 (inherited from Flux Schnell) | **Clean** |
| Chroma | lodestone-rock | Apache 2.0 | **Clean** |
| HiDream-I1-full | HiDream-ai | MIT (text encoder is Llama 3.1 Community License, governs the encoder not the image output) | **Clean** |
| Playground v2.5 | Playground AI | Playground v2.5 Community License | **Restricted (explicit)** - "You will not use ... any output or results ... to improve any other text-to-image generative model." Same pattern as SD3.5. |
| Kolors v1.0 | Kuaishou/Kwai | Apache 2.0 (code) + separate MODEL_LICENSE (weights) | **Unverified/caution** - no explicit output clause found, but commercial use requires registering with Kuaishou; MODEL_LICENSE has vague "must not harm country/society" language not fully retrievable |
| SANA | NVIDIA | Varies by checkpoint: Apache 2.0, NVIDIA Open Model License, or CC-BY-NC-SA-4.0 (non-commercial) | **Unverified** - depends entirely on which specific checkpoint OpenFake used, not confirmed which |
| Wan 2.1, Wan 2.2 | Alibaba | Apache 2.0 | **Clean** (same pattern as other Wan releases) |

### General takeaway for future generators

For mainstream SD1.5/SDXL community fine-tunes specifically, "generally
safe" is a reasonable working assumption - the dominant licenses
(OpenRAIL-M, OpenRAIL++-M, FAIPL) don't restrict output-based training.
It's not universal though (Playground shows vendors do sometimes add
that clause even outside the "obviously proprietary API" category), so
a quick per-model license check before actually adding a new generator
to `TARGET_GENERATORS` is still the right default, not a blanket skip.

## Current confirmed-clean set in use (`collect_data.py`)

flux-schnell, qwen-image, sd-1.5, sd-2.1, sdxl-base, dreamshaper,
juggernaut, realistic-vision, openflux, chroma, hidream, wan-2.1, wan-2.2.

z-image and glm-image were in the target list (confirmed clean per pass
1) but turned out to be absent from OpenFake's `core` config under every
name variant tried (0 hits across 12,000+ sampled rows, two separate
attempts) - dropped from the active collection target, not a licensing
issue, just not present in this particular dataset.
