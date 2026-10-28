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

Final combined `run-all.sh` run: all seven suites passed, exit code 0.
Not covered: visual regression, other browsers, real GPU rendering, multi-user behaviour (none exists).

## streaming (2026-10-23)
14 passed, 0 failed: OBS 1920×1080 RGBA PNG; StreamYard overlay 1280×720 RGBA under 20 MB; StreamYard background 1280×720 opaque; opaque-overlay and non-16:9 warnings; Plate Builder 1280×720 plate with preview restored. `export` (15) and `mapexport` (12) still pass.

## hazards (2026-10-28)
16 passed, 0 failed (NOAA outlook services stubbed): Sat→Fri default, day mapping of SPC/ERO/Hazards Outlook polygons, exclusive Hazards Outlook end date, thunder toggle, source toggles, failed-source flag, graphic creation with stored days/sources and legend entry. Full `run-all.sh` (11 suites) passed. Also checked by hand against the live services: all five sources load and the Sat Oct 31 – Fri Nov 6 overview renders. `lib.mjs` now finds Chromium via the `/opt/pw-browsers/chromium` symlink (or `CHROME`) when the pinned build path is missing.
