# Mapping the Unmeasured

An interactive exhibition exploring the compressive strength of printed clay.
Five archived adaptive-tuning XGBoost models (n = 30, 60, 90, 120, 150) run
entirely in the visitor's browser. No Python service, API keys, or database is required.

## Publish

In this repository's **Settings → Pages → Build and deployment → Source**, choose
**GitHub Actions**. Pushing to `main` runs the numerical and exploration tests,
then publishes only `site/`. The website URL remains the same across updates.

## Edit and preview

- `site/index.html`: content and forms.
- `site/styles.css`: typography, layout and responsive rules.
- `site/app.js`: conversation and interactions.
- `site/hero.js`: Three.js landscape, breathing and camera.
- `site/browser-api.js`: local exploration, prediction, targeting, CSV downloads.
- `site/browser-model.js`: float32 XGBoost numeric-tree inference.
- `site/data/`: archived models, metrics, shared geometry and model-specific surfaces.

Run `python3 -m http.server 8766 --directory site`, then open
`http://127.0.0.1:8766`. This is only a local development server; visitors use
GitHub Pages. No Node dependencies are needed. With Node 22 or newer, run `npm test`.

All site assets use relative paths and support the GitHub Pages repository subpath.
Browser exploration history stays on the visitor's device; it is not centrally collected.
The service worker caches successfully loaded assets for offline reuse. First visits
need internet; a model or resource not previously loaded will still need internet.

## Scientific meaning

Prediction and targeting use the original archived model outputs. Surface smoothing
and the breathing effect change the display only, not numerical predictions or test
metrics. Ground truth is the project's synthetic reference, not physical measurement.
Custom continuous inputs use actual tree inference; their map positions are estimated
from nearby combinations within the same categorical layer. The test partition is
excluded from target candidates. Test scores come from the same frozen 1,200 samples.

`tests/fixtures.json` records the original Python/XGBoost outputs for every frozen
candidate, random continuous inputs and float32 threshold boundary cases. Browser
results are checked before deployment. Source model SHA256 values and the display
settings are recorded in `export-manifest.json`.

The publication package is exported from `8_Website/build_pages.py` in the local
research workspace. The local research directories and session files are not published.

Three.js is distributed under the included MIT license in `site/vendor/`.
Consolas is preferred when installed on the device, with a monospace fallback;
Microsoft font binaries are not redistributed in this package.
