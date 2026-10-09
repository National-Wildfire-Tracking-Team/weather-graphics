# Last recorded test results (2026-10-09, headless Chromium, software WebGL, real Mapbox + public data)

| Suite | Result |
|---|---|
| editor.test.mjs | 23 passed |
| editor2.test.mjs | 26 passed |
| map.test.mjs | 29 passed |
| mapexport.test.mjs | 12 passed (DPR 1 and DPR 2) |
| export.test.mjs | 15 passed (DPR 1 and DPR 2) |
| templates.test.mjs | 25 passed |
| app.test.mjs | 14 passed |

Suites were run individually during development; a final combined `run-all.sh` run was in progress when this was committed.
Not covered: visual regression, other browsers, real GPU rendering, multi-user behaviour (none exists).
