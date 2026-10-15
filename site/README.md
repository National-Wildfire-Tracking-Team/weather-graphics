# Newsroom Graphics Studio

A browser-based graphics studio for newsroom, weather and broadcast graphics, served as static files from `site/` (it is the home page)
(`/` on the deployed site; `/studio/` redirects here). It sits beside the original Weather Plate Builder (`site/plate-builder.html`, linked from the sidebar), which is unchanged.

**Stack:** vanilla JS (no build step, matching the repo), [Fabric.js 5.3.1](https://fabricjs.com/) for the editor, [Mapbox GL JS 3.9.0](https://docs.mapbox.com/mapbox-gl-js/) for maps
(already used by the Plate Builder, so no second map engine). Fonts: Google Fonts (Barlow, Barlow Condensed, Oswald, Merriweather, Roboto Mono).
Libraries are pinned to exact versions and loaded from cdnjs / api.mapbox.com / Google Fonts.

## Run locally

```bash
cd site && python3 -m http.server 8765      # any static server works
open http://localhost:8765/
```
It must be served over http(s) (not `file://`) so `config.json` can be fetched and IndexedDB works.

## Configuration and environment variables

There are **no server-side environment variables**; the app is fully static.

| Setting | Where | Notes |
|---|---|---|
| Mapbox **public** token (`pk.…`) | `site/config.json` → `token`, or Brand Settings → Map settings (stored in the browser) | `config.json` wins if both are set. Secret tokens (`sk.…`) are refused. Restrict the token to your site URL in the Mapbox account. |
| Studio style URL | `site/config.json` → `style` | Enables the "Broadcast dark (Studio style)" basemap. Without it, Dark is the default. |
| Brand (name, colours, fonts, logos, attribution, export defaults) | Brand Settings | Stored in the browser. Applied to **new** projects created from templates. |

## Features (what exists in this build)

- **Dashboard, Graphics Studio, Map Studio, Weather / Breaking / Broadcast / Social workspaces, Template Library, Asset Library, Saved Projects, Brand Settings, Export Center.**
- **Editor:** text (font, size, weight, colour, alignment, line/letter spacing, opacity, text background, outline), rectangles/circles/triangles/stars/lines/arrows, fills, gradients, borders, shadows,
  image upload with crop/fit/fill, layers panel (reorder by drag or buttons, hide, lock, rename), group/ungroup, duplicate, copy/paste, align + distribute, snapping guides, title/action-safe guides,
  zoom/pan (Ctrl+wheel, Space+drag), undo/redo (120 steps), keyboard shortcuts, canvas presets + custom size, orientation swap, resize with layout scaling and a manual-adjustment warning, **variants** (resize into a new project without touching the original).
- **Charts and legends:** bar, line, pie, table, numeric callout, colour-scale legends (temperature, rainfall, wind presets are editable starting points), scale bar. Values come only from what the user types.
- **Map Studio:** real Mapbox GL map (pan, zoom, rotate, pitch, optional 3D terrain), geocoding search (Mapbox Geocoding v6), region presets and custom extent, styles (Studio broadcast style, Dark, Light, Streets, Satellite, Satellite + labels, Terrain/Outdoors, Minimal, custom URL), projection choice (Mercator/Albers/Globe),
  full-screen mode, coordinate HUD, drawing tools (markers, labels, lines, routes, polygons, circles, arrows, track points with per-point labels), vertex/handle editing, drag-to-move, restyle, undo/redo, GeoJSON import/export, saved map configurations.
  Everything drawn is **editable GeoJSON in the project**, never a screenshot. Map state is stored separately from the canvas composition (`MapFrame.mapState`).
- **Data layers (provider registry in `js/providers.js`):** NWS tornado / severe thunderstorm / flash flood / flood warning polygons (api.weather.gov), NHC active tropical cyclones (cone, forecast track/points, past track/points — NHC's own geometry), NIFC wildfire perimeters,
  NEXRAD radar tiles (Iowa Environmental Mesonet), county boundaries (us-atlas). Each shows loading / ok / empty / stale / error. The data-layer list has a filter box and an "On only" toggle, and layers are grouped into collapsible sections (groups with enabled layers start open). Warning/track data is **frozen as a snapshot** with its fetch time; press ⟳ to refresh. Rainfall (WPC QPF: Days 1, 2, 3, 4-5, 6-7 and 2-, 3-, 5-, 7-day totals, drawn as solid fills) and snowfall (WPC probability of 4+ in, Day 1/2/3) are wired to NOAA/WPC polygon services and are frozen as snapshots like the alerts; the snowfall layers are probability outlooks, not amounts. WPC Excessive Rainfall Outlooks (Days 1-5; Marginal/Slight/Moderate/High risk of rain exceeding flash flood guidance) come from NOAA's `hazards/wpc_precip_hazards` service, drawn with WPC's own colors and listed in the on-graphic outlook legend (`1/4 MARGINAL` … `4/4 HIGH`). SPC convective outlooks (Days 1-2: Overview plus Tornado/Hail/Wind Likelihood and Intensity; Day 3: Overview plus all-hazard Severe Likelihood and Intensity; Days 4-8: all-hazard Severe Likelihood) are drawn from the official SPC polygons with SPC's own colors; Intensity layers are only non-empty when SPC outlines a significant-severe area. Wind, temperature, evacuation zones, flood zones and historical tracks are still **Not configured**: as of 2026-10-12 the NOAA NDFD temperature service is stale (ends Aug 2025), the FEMA NFHL flood export rendered blank in testing and is zoom-limited, and no national authoritative wind, evacuation or track service was found. Import GeoJSON from an authoritative source instead.
- **NWS Alert Graphics (`js/alerts.js`, sidebar → NWS Alert Graphics):** loads every active alert from api.weather.gov, lists the alert types with counts, and lets you tick one or more types, narrow by state and severity, then **Create graphic** (header, map fitted to the alerts, `nws-custom` layer). The filter is stored in the layer config so ⟳ in Map Studio re-fetches the same selection. Alerts without a polygon (most watches, advisories, winter/heat/marine products) are drawn from the NWS zone shapes (one request per zone, max 700; pick a state to stay under it), which are whole zones and can be larger than the area actually affected. Zones that fail to load are reported, never invented. Colors follow the alert type (warning red, watch amber, advisory blue) unless overridden.
- **Templates:** 67 built-in templates (forecast panels, weather/severe/tropical maps, breaking news, broadcast overlays, social formats, closure lists, charts). Built from Brand Settings at creation time. Sample content is flagged with a SAMPLE badge and `sample` objects; export warns while any remain.
  Template **Fields** tab: title/subtitle, forecast and valid time, temperature (°F/°C) and wind (mph/kt/km/h) units, legend and attribution toggles, accent colour, storm/advisory fields. Save any project as a template, duplicate, favourite, group into collections.
- **Projects:** autosave (2 s) + manual Save, version history (15), duplicate, rename, delete with confirmation, search/sort/filter, editable project file export/import (JSON with referenced assets).
- **Export:** PNG, JPEG, SVG, transparent PNG, at 0.5×–3× of the canvas size. Exports render from the saved project JSON in an off-screen canvas, **not** from the editor viewport; the output is decoded and verified (size, alpha) before download. Maps are re-rendered natively by a fresh off-screen Mapbox map at the target pixel ratio (labels and lines are drawn at full resolution, not upscaled).

## Licensing, attribution and usage restrictions

- **Mapbox:** basemap tiles/styles, satellite imagery, terrain DEM and geocoding require a Mapbox token and are subject to Mapbox's Terms of Service. Mapbox requires visible attribution; map frames draw "© Mapbox © OpenStreetMap …" on the graphic by default (toggle in the map's properties — keep it on unless your Mapbox agreement allows removal). Review Mapbox terms for broadcast use and for storing/caching geocoding results.
- **NWS / NHC / NIFC** data are U.S. government public data; they carry no SLA. Always confirm warnings and advisories with the issuing office before publishing.
- **Iowa Environmental Mesonet** radar tiles are a third-party service with no SLA; confirm their terms before broadcast use. Radar tiles are always "now" and cannot be frozen.
- Google Fonts (OFL) are loaded from fonts.googleapis.com; us-atlas is ISC-licensed Census data.
- Attribution for each enabled layer is appended to the on-graphic attribution line automatically.

## Persistence: limitations

Projects, templates, assets, brand settings and saved map configurations live in this browser's **IndexedDB**. They survive restarts but are **not shared** between people, browsers or devices and are lost if site data is cleared.
Use *Saved Projects → Export file* (editable JSON) to move work. The save indicator says "Saved locally" only after IndexedDB confirms the write; failures show "Save failed" with the reason.

## Tests

`tests/` contains Playwright end-to-end suites (headless Chromium with software WebGL, using the real Mapbox token and public data sources):

```bash
cd site && python3 -m http.server 8765 &
cd tests && ./run-all.sh        # editor, editor2, map, mapexport, export, templates, app
DPR=2 node export.test.mjs      # verify export size is independent of screen pixel ratio
```
Requires network access to api.mapbox.com, cdnjs, Google Fonts and the public data hosts. See `tests/RESULTS.md` for the last recorded run.

## Known limitations

- Single-user, browser-local storage; no accounts, roles, sharing or activity history (design is ready for it: projects, templates and assets are plain JSON records behind `NS.Store`).
- Fonts are loaded from Google Fonts; offline, fallbacks are used and a warning is shown. SVG export does not embed fonts and embeds each map as a raster.
- Map-frame preview in the editor is rendered at 1× and refreshed when the map or frame changes; the export is always re-rendered at the target resolution. Large exports (e.g. 3× maps) take 10–30 s in software-GL browsers.
- A rotated or scaled frame renders the map at the frame's unrotated size; resizing a frame keeps the saved map extent (the visible area changes to match the new aspect).
- 3D terrain is Mercator/Globe only. Text in transparent exports uses straight alpha as produced by canvas.
- No video/animation output and no broadcast-automation protocol support (no NDI/CasparCG/Viz/etc.).
- Live data layers are fetched from the browser (CORS); a blocked or offline source shows an error and blocks export of a layer that has no data.

## Remaining work

Accounts and roles with server storage (e.g. Supabase) and shared templates/assets; SPC/NWS outlook import with county auto-selection; verified rainfall/snow/wind/temperature overlay sources; evacuation and flood-zone sources;
animated/video templates and transparent video export; configurable chart themes; more templates from real station editorial standards; offline font bundling; automated visual regression tests.
