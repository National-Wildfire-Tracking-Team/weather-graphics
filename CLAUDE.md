# Weather Plate Builder — project brief

## What this is
A broadcast-weather graphics pipeline modeled on the Ryan Hall Y'all style: dark navy U.S. basemap, red county-based risk areas (e.g. "TORNADO RISK"), clean state/city labels. Final graphics are assembled in **Affinity** (Designer/Photo).

Pipeline:
1. **Mapbox Studio style**: the dark basemap (land, water, borders, labels, county lines).
2. **Weather Plate Builder** (`site/plate-builder.html`): a single-file web tool. Users click/drag to paint counties into colored risk groups, frame the shot, and export PNG "plates" at 1920×1080 or 3840×2160.
3. **Affinity**: plate goes on the bottom layer; header bar, title, subtitle, footer, and logo sit on top.

## Repo layout
```
CLAUDE.md
site/
  index.html        # Newsroom Graphics Studio (home page, multi-file static app; see site/README.md)
  js/, studio.css   # Studio modules and styles
  plate-builder.html # the Weather Plate Builder (county painting tool), linked from the Studio sidebar
  config.json       # shared site config: token, style, tileset (see below)
tests/              # Playwright e2e suites for the Studio (tests/run-all.sh); tests/cloud = Phase 2 backend + cross-computer tests (local Supabase)
supabase/           # Phase 2 backend: config.toml (local stack), migrations/ (schema, RLS, broadcast functions), README.md (deploy/rollback/security)
style/
  weather-broadcast-style.json   # reference Mapbox style JSON (v8)
  weather-broadcast-dark.studio.json  # live Studio style + fixes (US-only cities, county-lines), ready to upload
```
`.netlify` is in `.gitignore` for when the site gets linked with the Netlify CLI.

## Newsroom Graphics Studio (site/ — the home page `/`)
A second, larger app next to the Plate Builder (which is untouched): editor + Map Studio + template library + export engine. Vanilla JS modules loaded by `<script>` tags in `index.html` (no build step), Fabric.js 5.3.1 and Mapbox GL JS 3.9.0 (same engine/token/style as the Plate Builder, read from `../config.json`). Full docs, limitations and remaining work: `site/README.md`.
- Module map: `store.js` (IndexedDB + project model) · `providers.js` (data-layer registry; add sources here) · `mapscene.js` (map runtime, `NS.renderMapCanvas` = native high-res map render) · `editor.js` (Fabric engine, `fabric.MapFrame`) · `charts.js` · `templates.js` · `alerts.js` (NWS Alert Graphics) · `hazards.js` (Week-Ahead Hazards: 5-7 day SPC/WPC/CPC outlook overview, data in `NS.Hazards` in `providers.js`) · `headlines.js` (WX Headlines tab) · `incidents.js` (Incident Detection tab: NIFC/CAL FIRE/InciWeb/NWS evacuations/FEMA IPAWS WEA (PBS WARN, via the ~1-day-delayed OpenFEMA archive)/Cal OES zones + unverified Bluesky/Mastodon; CAL FIRE via the `/proxy/calfire/*` rewrite in `site/_redirects`) · `incidentpage.js` (per-incident pages at `#/incident/<key>` when 2+ sources report the same incident) · `export.js`/`exportui.js` (incl. OBS overlay/full-screen targets and `NS.Export.readiness`, the not-ready-to-air check) · `broadcast.js` (NWTT live production: `NS.Broadcast.KIT` graphics→templates→OBS export, `SCENES` 00-10, kit table, `#/obs` docs view rendering `site/docs/*.md`) · `cloud.js` (optional Supabase client, sign-in, roles, Team view) · `cloudprojects.js` (shared projects via linked local mirrors, migration, revisions, shared templates/assets) · `live.js` (Live Broadcast Control, `#/live`) · `editorui.js` · `mapstudio.js` · `app.js` (router/views). OBS output page: `site/broadcast/output.html` + `output.js` (standalone, read-only).
- Top section tabs (`TABS` in `app.js`): Graphics Studio (all sidebar routes), WX Headlines (`#/headlines`), Incident Detection (`#/incidents`; old `#/resources` redirects there), Live Broadcast Control (`#/live`).
- Contract: map state lives in `MapFrame.mapState` (GeoJSON features, layers, view) and is never flattened; exports re-render maps at the target pixel ratio. Never fabricate weather data: unconfigured layers stay "Not configured", failed fetches show errors, templates flag sample content.
- Persistence is browser-local (IndexedDB) unless the optional Phase 2 cloud is configured (`supabase` in config.json) and a project is explicitly shared; do not describe local projects as shared/team storage.
- Phase 2 backend: a **dedicated** Supabase project for Graphics Studio, never Sentinel's (`hmtavsjepgefjhwcqqhd`). Hosted: `nwtt-graphics`, ref `meqtsuapaxydmcyjoshn` (us-west-1), migrations `20261118141634`, `20261118151005` (pending approval) and `20261118175753` (Phase 3 live map: `broadcast_map_state`, `map_presets`, map-scoped output tokens, `bc_map_*`) applied 2026-11-18; first administrator: kyle@nationalwildfiretrackingteam.org; `site/config.json` → `supabase` points at it (anon key only); Supabase auth settings (site URL, SMTP, self sign-up choice, MFA) are still to be set in the dashboard (see `supabase/README.md`). Hosted migration versions differ from local file timestamps when applied through the MCP; rename the local file to the hosted version afterwards. Only the anon key may be in config.json. Permissions live in RLS and `bc_*`/`gs_*` SECURITY DEFINER functions (`supabase/migrations`); every live action is controller-only, version-checked and audited. Do not apply migrations to a hosted project or deploy without the owner's authorization.
- Tests: serve `site/` on :8765, then `tests/run-all.sh` (needs network for Mapbox and public data).

## Basemap style (style/weather-broadcast-style.json)
- Source: `mapbox://mapbox.mapbox-streets-v8` as `composite`.
- Projection: `albers`, center [-96, 38], parallels [29.5, 45.5].
- Layer order (bottom → top), with IDs the tool depends on:
  `background` → `county-lines` → `risk-fill` → `risk-county-lines` → **`water`** → `admin-1-boundary` → `admin-0-boundary` → `admin-0-boundary-maritime` → **`state-label`** → **`city-dot`** → **`city-label`**
- The tool inserts its risk layers directly below the layer with ID `water`, so the coastline clips the red fill. **The live Studio style must keep a layer with ID `water`.** Otherwise the risk fill lands on top of everything (the tool shows a warning in its status line).
- The tool's Labels toggle targets `state-label`, `city-label` and `city-dot`. Its base-counties toggle targets `county-lines`.
- `county-lines`, `risk-fill` and `risk-county-lines` in the JSON reference a `counties` source with **placeholder** URL/source-layer. Don't load this JSON as-is; the real style lives in Mapbox Studio. The tool adds its own `tpl-*` county layers at runtime and ignores the stubs.

### Palette
| Use | Value |
|---|---|
| Land (background) | `#1A2230` |
| Water | `#080C12` |
| State borders | `#5A6A82`, 0.7→1.4px (z3→z8) |
| Country borders | `#6B7A90`; maritime dashed `[3,2]` in `#5A6A82` |
| Base county lines | `#FFFFFF` @ 0.10 (or solid `#2A3445`), 0.4px |
| Risk fill | `#F2453D` @ 0.92 |
| County lines inside risk | `#FFFFFF` @ 0.35, 0.5px |
| State labels | `#6B7A90`, uppercase, letter-spacing 0.2, halo 2px land color |
| City labels | `#E8EDF3`, halo 1.5px; white dots; US only, `symbolrank <= 8` |
| Header bar (Affinity) | `#0C1119` @ ~85%, ~130–140px tall at 1080p |
| Title font | Barlow Condensed ExtraBold / Oswald Bold, `#F2453D` |

## The tool (site/plate-builder.html)
Vanilla JS, Mapbox GL JS **v3.9.0** from api.mapbox.com, no build step.

- **Fixed frame:** the map container is always 1920×1080 CSS px, scaled to fit the screen with a CSS transform, so preview framing equals export framing. An optional title-bar safe-area overlay (DOM only, never exported) marks the top 140px.
- **Config:** on load it `fetch`es `config.json` (same origin). Fields: `token`, `style` (Studio URL string, or a full style object), `tileset`, `sourceLayer`, `counties` (GeoJSON/TopoJSON URL used when no tileset is set), `projection` (passed to the Map constructor, overriding the style's projection; config pins Albers), `idProp` (default `GEOID`), `defaultView` (preset name or `{center, zoom}`; default Southeast), `lockSettings` (hides the settings panel unless explicitly `false`), `groups` (starting risk-group template, used only when localStorage has no saved groups). Without `config.json` (e.g. opened via `file://`) it falls back to the manual settings form plus localStorage. String values containing `REPLACE_ME` count as unset, and the settings panel stays visible while `token` or `style` is unset.
- **Counties:** adds source `tpl-counties`, either a vector source from `tileset` + `sourceLayer`, or, when those are unset, a GeoJSON source from `counties` (default: public `us-atlas@3.0.1/counties-10m.json` on jsDelivr, a simplified Census TopoJSON converted with `topojson-client@3.1.0`). For GeoJSON, the tool copies each feature's ID into `idProp` (zero-padded) and `name` into `NAME`, so the rest of the code works the same either way. It also adds an invisible `tpl-hit` fill layer for `queryRenderedFeatures`, and a `tpl-fill-<groupId>` / `tpl-line-<groupId>` pair per group, filtered with `["in", ["get", idProp], ["literal", ids]]`. FIPS codes are zero-padded to 5 chars. Each group also has a FIPS textarea for typing/pasting codes.
- **Painting:** Paint mode disables dragPan/boxZoom/dragRotate/doubleClickZoom. Mousedown decides add vs. remove (remove if the county is already in the active group or Alt is held), and dragging continues that action. A county belongs to only one group.
- **View presets:** Southeast, Gulf Coast, Midwest, Plains, Northeast, West, Lower 48, fit with top padding of 140px for the header bar.
- **Export:** `preserveDrawingBuffer: true`. The pixel ratio is set to the target scale for *both* sizes (so a HiDPI screen doesn't turn a 1080p export into 4K). It uses `map.setPixelRatio` if it exists. GL JS v3.9 doesn't have it (verified), so the tool overrides `window.devicePixelRatio` and nudges the map container by 1px before calling `map.resize()`: v3.9's `resize()` does nothing unless the container size changed. Afterwards it restores the browser's original `devicePixelRatio` property descriptor. It waits for `idle` (10s timeout), takes `canvas.toBlob`, then restores the original ratio and risk visibility, even if the export fails. The status line warns if the PNG size isn't the expected one. "Risk + clean" exports two PNGs.
- **Live streams:** a third resolution, 1280×720 (ratio 2/3), matches StreamYard's background spec. Plates are opaque, so they go in OBS as a bottom Image source and in StreamYard as a Background, not an Overlay. The Studio's Export dialog has OBS overlay / OBS full-screen / StreamYard overlay / StreamYard background destinations (`NS.Export.TARGETS` in `site/js/export.js`; tests in `tests/streaming.test.mjs` and `tests/obs.test.mjs`).
- **NWTT livestreams (Phase 1):** broadcasters run OBS on their own computers with static PNGs from the Studio, streaming via Restream to YouTube and X. Docs: `site/docs/obs-setup-guide.md` and `site/docs/broadcaster-onboarding.md` (also in-app at `#/obs`). Shared branding comes from `brand` in `site/config.json`. Phase 2 adds the live Browser Source output and Live Broadcast Control (see the Studio section); Phase 3 = Sentinel Broadcast Mode (live map for OBS; uses this Supabase project, not Sentinel's). **Live Broadcast Control (`#/live/<id>`) is the one NWTT control center**: graphics plus Sentinel's map control embedded as the Live map panel (`L.mapPanel` in `live.js`, iframe of Sentinel `/broadcast/control/<id>?embed=1`; session handed over by postMessage to Sentinel's exact origin; Sentinel only lets this origin frame that path). `sentinelUrl` in config.json overrides the Sentinel origin (or `"off"`); test: `tests/cloud/controlcenter.e2e.mjs`. The **Field reporters** panel (`L.reportersPanel`) plays each reporter from the SRT relay (Sentinel `infra/aws` SentinelSrtRelay, `relay.nationalwildfiretrackingteam.org`) over WebRTC/WHEP with the members-only preview login from `gs_relay_preview()` (migration `20261119120000_relay_preview`; admins set it with `gs_set_relay_config`); preview only, OBS takes reporters over SRT; out of scope: OBS WebSocket/scene switching, Restream automation, direct YouTube/X publishing.
- **Persistence:** localStorage key `wpb.v1` (settings + groups). Presets save/load as JSON `{view, groups, active, nextId}`.

## Deployment
- **Current site: `snazzy-gumdrop-5718eb`** (site ID `2c7e39e4-1e7b-4d30-8cb8-a7d323649455`), `https://snazzy-gumdrop-5718eb.netlify.app`. `netlify.toml` publishes `site/` with no build; Studio at `/`, Plate Builder at `/plate-builder.html` (`/studio/*` redirects to `/`). Link the GitHub repo in Netlify with production branch `main`. The notes below describe the older `weather-plate-builder` site (ID `efca7ba6-a57f-477a-a7fc-197ebccf3585`); for new deploys use the site above.
- Netlify project: **`weather-plate-builder`** (site ID `efca7ba6-a57f-477a-a7fc-197ebccf3585`), URL `https://weather-plate-builder.netlify.app`. First deployed 2026-10-08 by drag-and-drop (old tool, no `config.json`). Redeployed 2026-10-09 from `site/` (deploy `6ac8e7cce7e622ba64540993`): current tool + `config.json`.
- Deploy: `netlify deploy --prod --dir site --site efca7ba6-a57f-477a-a7fc-197ebccf3585`, or drag the `site/` folder onto the project's Deploys page.
- From a Claude Code cloud session: the Netlify MCP `deploy-site` returns an `npx @netlify/mcp … --site-id …` command. Run it **from inside `site/`** (it uploads the current directory) with `NODE_USE_ENV_PROXY=1`, or Node's fetch bypasses the egress proxy and fails with `fetch failed`.
- The owner has other unrelated Netlify sites on the same team. **Never deploy to any site other than the two named in this section.**
- The Mapbox public token in `config.json` is intentionally public. It must be URL-restricted to the Netlify domain in Mapbox account settings.
- `site/config.json` has the real token and style and uses the public `counties` file, so no county tileset is needed. To switch to a sharper uploaded tileset later, add `tileset` and `sourceLayer`; they take precedence.

## Live Studio style
- Style: `mapbox://styles/kbeshore6/cmv003g61004c01s157h57gev` ("Weather Broadcast Dark"), account `kbeshore6`.
- Published 2026-10-09 13:05 UTC: layers `background`, `county-lines` (Streets v8 `admin_level == 2`, US, white @ 0.19, 0.6px), `water`, `admin-1-boundary`, `admin-0-boundary`, `admin-0-boundary-maritime`, `state-label`, `city-dot`, `city-label`.
- **That publish dropped the Albers projection** (the style now has no `projection`, so Mapbox defaults to Mercator). `config.json` pins Albers via `projection`, so the tool is unaffected. Re-set it in Studio (Style settings → Map projection) if the style is used elsewhere.
- `city-dot` is US-only with `symbolrank <= 8`, but `city-label` allows US/CA/MX/BM/BS with `symbolrank <= 9`, so some labels (Memphis, Birmingham, Nassau…) have no dot. Make the two filters match if that's not intended.
- Streets v8 `admin` `admin_level == 2` features are merged county lines with no `GEOID`, so they're fine for `county-lines` but useless for painting.
- Painting needs county **polygons** with a FIPS ID. The tool currently uses the public us-atlas file (3,231 counties, 1:10m, so edges are simplified when zoomed in). For sharper edges, upload the Census `cb_2023_us_county_500k.zip` as a Studio tileset and set `tileset` and `sourceLayer`.
- Mapbox's API caches styles: a plain request can return the previous publish for a while. Add `&fresh=true` to see the latest.

## Verification status
Checked 2026-10-08/09 in headless Chromium against the live style, using the public county file:
- ✅ The tool loads the real Studio style and counties with no errors.
- ✅ Export sizes: 1920×1080 and 3840×2160 come out correct on both 1x and 2x screens, and the preview canvas is restored afterwards. Before the fix, export size followed the screen's DPR instead.
- ✅ Streets v8 `place_label` state features carry `iso_3166_1 = "US"`, so the `state-label` filter works.
- ✅ Painting: `queryRenderedFeatures` on the opacity-0 `tpl-hit` layer works, and clicks land on the right county under the CSS-scaled frame (cursor over Atlanta → DeKalb 13089). Click-add, drag-add and click-erase all work.
- ✅ Risk fill sits under `water` (lakes cut through it).
- ✅ "Risk + clean" with the risk toggle off downloads both PNGs (clean has zero red pixels) and leaves risk off afterwards.

Not yet checked: painting against an uploaded Mapbox tileset (only matters if one is added later).

## Ideas / roadmap
- One-click "select all counties in state X" (FIPS prefix = state code).
- Import an SPC/NWS outlook polygon (GeoJSON/shapefile) and auto-select intersecting counties (turf.js).
- Render the header bar and title in-tool, as an optional full-graphic export.
- Transparent-background risk-only plate for more flexible layering in Affinity.
- Named template presets (Tornado, Severe, Flood, Winter) with preset group colors/names in `config.json`.
- Attribution: export currently has no Mapbox logo or attribution. Review Mapbox terms for broadcast use.

## Working conventions
- Keep it a single static HTML file with no build step unless there's a strong reason.
- Pin library versions exactly.
- Don't break the layer-ID contract above without updating both the tool and the Studio style.
