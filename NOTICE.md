# Third-party notices — Astronomy Glasses

The original code in this repository is MIT licensed (see `LICENSE`).
**The MIT grant does not extend to the vendored files below.** Everything here
is redistributed unmodified unless noted.

If you fork this repository, these obligations travel with it. The CC BY 4.0
textures in particular carry an **attribution requirement that survives forking**.

---

## Vendored libraries

| Path | Project | Licence |
|---|---|---|
| `phase1/lib/three.module.js`, `three.core.js` | three.js r185 | MIT — see `phase1/lib/THREE_LICENSE.txt` |
| `phase1/lib/postprocessing/`, `phase1/lib/shaders/` | three.js addons (EffectComposer, RenderPass, ShaderPass, MaskPass, Pass, UnrealBloomPass, LuminosityHighPassShader) | MIT, part of three.js |
| `phase1/lib/astronomy.browser.js` | Astronomy Engine (cosinekitty) | MIT |

## Vendored assets — ⚠️ attribution required

| Path | Source | Licence |
|---|---|---|
| `phase1/textures/*.jpg`, `*.png` | [Solar System Scope](https://www.solarsystemscope.com/textures/) texture library, NASA-derived imagery | **CC BY 4.0** |

**CC BY 4.0 requires attribution.** This is already satisfied in two places and
both must be preserved: `phase1/textures/README.md`, and in-app under
planet dashboard → Info panel. The 1K moon map was downscaled locally from the
2K original, which CC BY 4.0 permits as an adaptation.

| Path | Source | Status |
|---|---|---|
| `phase1/textures/dso/*.jpg` | Deep-sky object imagery | ⚠️ **Provenance not recorded.** Likely NASA/ESA/ESO, most of which is public domain or CC BY, but this has not been verified per-file. Confirm and document before wider distribution. |
| `phase1/textures/sky/4k_milky_way.jpg` | Milky Way panorama | ⚠️ **Provenance not recorded.** Same caveat. |
| `phase1/data/stars.json`, `deep-time.json` | Star catalogue and timeline data | Authored or derived for this project |
