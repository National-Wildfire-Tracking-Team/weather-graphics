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

## obs / Phase 1 live production (2026-11-18)
`obs.test.mjs`: 43 passed, 0 failed. Covers: config brand defaults; the 11-slot NWTT kit (templates exist, 1920×1080, overlays transparent and full-screen opaque); NWTT templates carry no sample data and demand an as-of time and source; OBS overlay export (1920×1080 RGBA, corners alpha 0, `_obs-overlay` name, OBS-ready tag); OBS full-screen export (opaque, `_obs-full`), including a map graphic; opaque-as-overlay and >45% coverage warnings; not-ready-to-air confirmation (cancel / export anyway / once per dialog); Save to folder + Overwrite (stubbed File System Access API); project import keeps its name; incident graphics show DATA AS OF the fetch time; guide/onboarding render, list every scene 00-10, file-name table matches the exporter, no keys in docs, renderer creates no markup from text.
Full `run-all.sh` (15 suites): all pass except two that were investigated: `templates` "template duplicated" used a fixed 500 ms wait that the larger library (74 templates) outgrew. It now waits for the duplicate tile (25/25). `tabs` hit a CAL FIRE CORS error on a local server once (unrelated code; the README notes CAL FIRE only works through the Netlify proxy). It passed 13/13 on re-run. `streaming` 14/14 with the OBS file name updated to `_obs-overlay`; `DPR=2 export` 15/15.

## Phase 2: live graphics, shared cloud (2026-11-18)
Local Supabase stack (CLI 2.122.1, Postgres 17, Auth, PostgREST, Storage, Realtime), headless Chromium.
- `tests/cloud/backend.test.mjs`: 101 passed, 0 failed (auth, roles, RLS on every table, shared projects, approval, revisions, templates, assets/storage, sessions, preview validation, Take/Update/Rollback/Clear, version conflicts and simultaneous publishes, control transfer/override, expiry, output tokens, rate limit, Realtime nudge, end session, audit).
- `tests/cloud/live.e2e.mjs`: 53 passed, 0 failed on the final runs (Computer A producer → Supabase → Computer B OBS output; C second producer; viewer; offline and unconfigured browsers). One intermittent failure was found while developing ("producer2 sees the controls", about 1 run in 6). Cause: overlapping console refreshes could apply an older response last. Fixed by applying only the newest refresh and never a lower session version; it has passed on every run since.
- Existing suites (`run-all.sh`, 15 suites): all pass; `tabs` updated for the fourth top tab (Live Broadcast Control).
Not covered: a hosted Supabase project, OBS's own CEF browser, real email delivery.

## Pending approval + console lifecycle fix (2026-11-18)
- Backend: pending-approval checks added (admin-only listing, decline, re-approve, audit), 114–115 passed (the last-admin check only runs when the test DB has exactly one admin).
- End-to-end: 62 passed on every run (7 runs). Adds the administrator UI (pending count, Approve with role, Decline), Request access when self sign-up is off, and unapproved accounts seeing nothing.
- Fixed a real bug behind the earlier intermittent "producer2 sees the controls" failure: a console built by a superseded render shut down the visible console's Realtime and polling, freezing it. Consoles now start only once attached, clean up only themselves, and the app re-renders on cloud events only when sign-in state or role changes. The new regression test fails on the old code ("Reconnecting (polling)") and passes on the fix.
- Existing suites touched (tabs 13, app 14, templates 25, obs 43): all pass.
