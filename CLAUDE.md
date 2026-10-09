# Weather Plate Builder — project brief

## What this is
A broadcast-weather graphics pipeline modeled on the Ryan Hall Y'all style: dark navy U.S. basemap, red county-based risk areas (e.g. "TORNADO RISK"), clean state/city labels. Final graphics are assembled in **Affinity** (Designer/Photo).

Pipeline:
1. **Mapbox Studio style**: the dark basemap (land, water, borders, labels, county lines).
2. **Weather Plate Builder** (`site/index.html`): a single-file web tool. Users click/drag to paint counties into colored risk groups, frame the shot, and export PNG "plates" at 1920×1080 or 3840×2160.
3. **Affinity**: plate goes on the bottom layer; header bar, title, subtitle, footer, and logo sit on top.

## Repo layout
```
CLAUDE.md
site/
  index.html        # the tool
  config.json       # shared site config: token, style, tileset (see below)
style/
  weather-broadcast-style.json   # reference Mapbox style JSON (v8)
  weather-broadcast-dark.studio.json  # live Studio style + fixes (US-only cities, county-lines), ready to upload
```
`.netlify` is in `.gitignore` for when the site gets linked with the Netlify CLI.

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

## The tool (site/index.html)
Vanilla JS, Mapbox GL JS **v3.9.0** from api.mapbox.com, no build step.

- **Fixed frame:** the map container is always 1920×1080 CSS px, scaled to fit the screen with a CSS transform, so preview framing equals export framing. An optional title-bar safe-area overlay (DOM only, never exported) marks the top 140px.
- **Config:** on load it `fetch`es `config.json` (same origin). Fields: `token`, `style` (Studio URL string, or a full style object), `tileset`, `sourceLayer`, `counties` (GeoJSON/TopoJSON URL used when no tileset is set), `idProp` (default `GEOID`), `defaultView` (preset name or `{center, zoom}`; default Southeast), `lockSettings` (hides the settings panel unless explicitly `false`), `groups` (starting risk-group template, used only when localStorage has no saved groups). Without `config.json` (e.g. opened via `file://`) it falls back to the manual settings form plus localStorage. String values containing `REPLACE_ME` count as unset, and the settings panel stays visible while `token` or `style` is unset.
- **Counties:** adds source `tpl-counties`, either a vector source from `tileset` + `sourceLayer`, or, when those are unset, a GeoJSON source from `counties` (default: public `us-atlas@3.0.1/counties-10m.json` on jsDelivr, a simplified Census TopoJSON converted with `topojson-client@3.1.0`). For GeoJSON, the tool copies each feature's ID into `idProp` (zero-padded) and `name` into `NAME`, so the rest of the code works the same either way. It also adds an invisible `tpl-hit` fill layer for `queryRenderedFeatures`, and a `tpl-fill-<groupId>` / `tpl-line-<groupId>` pair per group, filtered with `["in", ["get", idProp], ["literal", ids]]`. FIPS codes are zero-padded to 5 chars. Each group also has a FIPS textarea for typing/pasting codes.
- **Painting:** Paint mode disables dragPan/boxZoom/dragRotate/doubleClickZoom. Mousedown decides add vs. remove (remove if the county is already in the active group or Alt is held), and dragging continues that action. A county belongs to only one group.
- **View presets:** Southeast, Gulf Coast, Midwest, Plains, Northeast, West, Lower 48, fit with top padding of 140px for the header bar.
- **Export:** `preserveDrawingBuffer: true`. The pixel ratio is set to the target scale for *both* sizes (so a HiDPI screen doesn't turn a 1080p export into 4K). It uses `map.setPixelRatio` if it exists. GL JS v3.9 doesn't have it (verified), so the tool overrides `window.devicePixelRatio` and nudges the map container by 1px before calling `map.resize()`: v3.9's `resize()` does nothing unless the container size changed. Afterwards it restores the browser's original `devicePixelRatio` property descriptor. It waits for `idle` (10s timeout), takes `canvas.toBlob`, then restores the original ratio and risk visibility, even if the export fails. The status line warns if the PNG size isn't the expected one. "Risk + clean" exports two PNGs.
- **Persistence:** localStorage key `wpb.v1` (settings + groups). Presets save/load as JSON `{view, groups, active, nextId}`.

## Deployment
- Netlify project: **`weather-plate-builder`** (site ID `efca7ba6-a57f-477a-a7fc-197ebccf3585`), URL `https://weather-plate-builder.netlify.app`. First deployed 2026-10-08 by drag-and-drop with only `index.html` (no `config.json`), so the live site uses the manual settings form.
- Deploy: `netlify deploy --prod --dir site --site efca7ba6-a57f-477a-a7fc-197ebccf3585`, or drag the `site/` folder onto the project's Deploys page.
- The owner has other unrelated Netlify sites on the same team. **Never deploy to any site other than this one.**
- The Mapbox public token in `config.json` is intentionally public. It must be URL-restricted to the Netlify domain in Mapbox account settings.
- `site/config.json` has the real token and style and uses the public `counties` file, so no county tileset is needed. To switch to a sharper uploaded tileset later, add `tileset` and `sourceLayer`; they take precedence.

## Live Studio style
- Style: `mapbox://styles/kbeshore6/cmv003g61004c01s157h57gev` ("Weather Broadcast Dark"), account `kbeshore6`.
- As of 2026-10-08 its layers are `background`, `water`, `admin-1-boundary`, `admin-0-boundary`, `admin-0-boundary-maritime`, `state-label`, `city-dot`, `city-label`. Projection is Albers, as specified.
- It has **no county layers or counties source**, so the base-counties toggle currently does nothing.
- Streets v8 already has US county boundaries: `admin` features with `admin_level == 2` (verified in tiles z5–z9). They're merged lines with no `GEOID` or name, so they're fine for a base `county-lines` layer (put it below `water`, filter `admin_level == 2` and `iso_3166_1 == "US"`) but useless for painting.
- Painting needs county **polygons** with a FIPS ID. The tool currently uses the public us-atlas file (3,231 counties, 1:10m, so edges are simplified when zoomed in). For sharper edges, upload the Census `cb_2023_us_county_500k.zip` as a Studio tileset and set `tileset` and `sourceLayer`.
- Its `city-dot` / `city-label` filters have no `iso_3166_1 == "US"` clause, so Canadian, Mexican and Caribbean cities (Toronto, Havana, Nassau…) appear. The reference JSON has the clause; add it in Studio to match.

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
