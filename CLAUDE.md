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

- **Fixed frame:** the map container is always 1920×1080 CSS px, scaled to fit the screen with a CSS transform, so preview framing equals export framing. A "header guide" overlay (DOM only, never exported) shows the 140px header bar area.
- **Config:** on load it `fetch`es `config.json` (same origin). Fields: `token`, `style` (Studio URL string, or a full style object), `tileset`, `sourceLayer`, `idProp` (default `GEOID`), `defaultView` (preset name or `{center, zoom}`), `lockSettings` (hides the settings panel when true), `groups` (starting risk-group template). Without `config.json` (e.g. opened via `file://`) it falls back to the manual settings form plus localStorage. Values containing `REPLACE_ME` count as unset, and the settings panel is shown even if locked.
- **Counties:** adds source `tpl-counties` from the tileset, an invisible `tpl-hit` fill layer for `queryRenderedFeatures`, and a `tpl-fill-<groupId>` / `tpl-line-<groupId>` pair per group, filtered with `["in", ["get", idProp], ["literal", ids]]`. FIPS codes are zero-padded to 5 chars.
- **Painting:** Paint mode disables dragPan/boxZoom/dragRotate/doubleClickZoom. Mousedown decides add vs. remove (remove if the county is already in the active group or Alt is held), and dragging continues that action. A county belongs to only one group. `P` toggles paint mode.
- **View presets:** Southeast, Gulf Coast, Midwest, Plains, Northeast, West, Lower 48, fit with top padding of 140px for the header bar.
- **Export:** `preserveDrawingBuffer: true`. The canvas pixel ratio is forced to the target scale for *both* sizes (on a HiDPI screen the default ratio would make the "1080p" export 4K). It uses `map.setPixelRatio` if it exists, else overrides `window.devicePixelRatio` and calls `map.resize()`. It waits for `idle`, takes `canvas.toBlob`, then restores. The status line reports the actual PNG size and warns on mismatch. "Risk + clean" exports two PNGs.
- **Persistence:** localStorage key `wpb.v1` (settings + groups + view). Presets save/load as JSON `{view, groups, active, nextId}`.

## Deployment
- Netlify project: **`weather-plate-builder`** (site ID `efca7ba6-a57f-477a-a7fc-197ebccf3585`), URL `https://weather-plate-builder.netlify.app`. Created empty; first deploy still pending.
- Deploy: `netlify deploy --prod --dir site --site efca7ba6-a57f-477a-a7fc-197ebccf3585`, or drag the `site/` folder onto the project's Deploys page.
- The owner has other unrelated Netlify sites on the same team. **Never deploy to any site other than this one.**
- The Mapbox public token in `config.json` is intentionally public. It must be URL-restricted to the Netlify domain in Mapbox account settings.
- `site/config.json` currently holds `REPLACE_ME` placeholders for token, style and tileset. Fill them in before the first deploy.

## Unverified: test these first
This has never been run against live Mapbox:
1. The tool loads with the real Studio style URL and tileset, and the status line shows no errors.
2. Painting works: `queryRenderedFeatures` on the opacity-0 `tpl-hit` layer returns features, and clicks land correctly under the CSS-scaled frame.
3. The 4K export is actually 3840×2160 (check the DPR-override fallback; GL JS v3.9 may not have `setPixelRatio`). If it isn't, consider an offscreen map at 2x.
4. The `state-label` filter `iso_3166_1 == "US"` matches Streets v8 data. If state labels vanish, drop that clause.
5. Export with risk off → on → off restores visibility correctly.

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
