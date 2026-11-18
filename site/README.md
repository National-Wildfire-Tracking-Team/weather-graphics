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
- **Week-Ahead Hazards (`js/hazards.js`, sidebar → Week-Ahead Hazards):** a 5-7 day overview (default: the upcoming Saturday through the next Friday; presets for the next 5 or 7 days, or any start date). One card per day lists the hazards in the official outlooks for that date, with their product: SPC convective outlooks (Days 1-3 categorical, Days 4-8 probability), WPC Excessive Rainfall (Days 1-5), WPC probability of 4+ in of snow (Days 1-3), the WPC Day 3-7 Hazards Outlook and the CPC Day 8-14 Hazards Outlook (`hazards/cpc_weather_hazards` on mapservices.weather.noaa.gov). Each polygon is placed on its calendar day from the product's own valid/start/end times (12Z-12Z products count as the U.S. day they start on; Hazards Outlook end dates are exclusive). Days no product reaches say "No official outlook", and a failed service is flagged rather than skipped silently. Click a day (or "Whole period") to see it on the map (click an area for its hazard and product), copy a plain-text summary for briefings, or **Create graphic** (`hazards-outlook` layer; the chosen days and sources are stored so ⟳ re-fetches them, and the outlook legend lists each hazard). Limits: past Day 8 only the broad CPC outlook exists; the Hazards Outlooks are issued on weekdays only, so on weekends they can be a few days old (the issue time is in each source tag's tooltip).
- **Lower Thirds (`js/lowerthirds.js` + `js/lowerthirds-render.js`, sidebar → Lower Thirds, `#/lowerthirds`):** cable-news and business-news style lower thirds built in seconds. **NWTT branding is the default:** three NWTT looks (news strap with an NWTT flame bug on the headline bar, live-shot package with the NWTT logo box, name/title strap) in fire orange `#FF5A00`/`#B13505`, near-black `#0A0C0E`/`#1D1D1F` and slate `#A9B6C8`, with the flame mark drawn as a vector (taken from nationalwildfiretrackingteam.org, 2026-11-18). Plus six generic looks (cable white bar, cable red bar, business blue, name/title strap, weather navy, and **Weather live shot**: a full weather-channel package with a logo box (two text lines or an uploaded PNG), reporter name/role strip, red prefix + headline + sub line on white, a promo box on the right with title, red strip and an uploaded image such as a radar screenshot, a red LIVE / label crawl, and an optional top-right current-conditions panel whose location, temperature, low/high, conditions and up to five `Label | value` rows are typed by the user), one-click presets (Breaking news, Fire update, Live report, Guest/interview, NWTT live shot, Weather alert on NWTT styles, plus Generic cable), tag, headline, sub line, ALL CAPS, colour overrides, scrolling ticker (one item per line; a trailing `+1.2` / `-0.8` is coloured green/red with an arrow), live clock with time zone, top-left LIVE bug with location, in-animation time and auto-out. Text that doesn't fit shrinks, then condenses; it is never cut off. Outputs: **live browser source** (`lower-thirds-live.html#c=…`, the whole lower third is encoded in the URL: animates in on load, ticker scrolls, clock runs, click/Space/Enter takes it in/out, `?static=1` shows the finished frame, `?wait=1` waits for a click, `?auto=0` ignores auto-out) for OBS / vMix / Wirecast at 1920×1080; **transparent PNG** at 1920×1080, 1280×720 (StreamYard overlay) and 3840×2160; **animated WebM with alpha** (in, hold, out; VP9/VP8 via MediaRecorder, Chrome/Edge). "Open live output" in the same browser follows edits and the Take in/out buttons (BroadcastChannel); a URL already pasted into OBS does not change, so copy it again after edits. Uploaded images are downscaled (logo ≤400 px PNG, box ≤640×360 JPEG) and stored inside the config, so the live URL carries them (it warns past 1.5 MB). Working copy and saved lower thirds are in localStorage (this browser only). No real headlines or market numbers are filled in: presets are placeholder text. Tests: `tests/lowerthirds.test.mjs`.
- **Section tabs (top bar, `app.js` `TABS`):** **Graphics Studio** (every sidebar route), **WX Headlines** (`#/headlines`, `js/headlines.js`) and **Resources** (`#/resources`, `js/resources.js`); the sidebar is hidden on the last two. WX Headlines is a read-only live briefing: today's and tomorrow's outlook hazards (from `NS.Hazards.summary`) and active NWS alerts grouped by event, most severe first, with a state filter, expandable per-alert headlines and Copy buttons for on-air text. Failed sources show an error; nothing is filled in. Resources is a filterable link list (forecast centers, fire weather, radar, the data APIs the Studio uses, and in-app tools); edit `RESOURCES` in `resources.js` to change it. Tests: `tests/tabs.test.mjs`.
- **Templates:** 67 built-in templates (forecast panels, weather/severe/tropical maps, breaking news, broadcast overlays, social formats, closure lists, charts). Built from Brand Settings at creation time. Sample content is flagged with a SAMPLE badge and `sample` objects; export warns while any remain.
  Template **Fields** tab: title/subtitle, forecast and valid time, temperature (°F/°C) and wind (mph/kt/km/h) units, legend and attribution toggles, accent colour, storm/advisory fields. Save any project as a template, duplicate, favourite, group into collections.
- **Projects:** autosave (2 s) + manual Save, version history (15), duplicate, rename, delete with confirmation, search/sort/filter, editable project file export/import (JSON with referenced assets).
- **Live-stream destinations (Export dialog → Destination):** *OBS Studio* (1920×1080 PNG, transparency kept, for an Image source), *StreamYard overlay* (1280×720 transparent PNG, under 20 MB) and *StreamYard background* (1280×720 opaque PNG). Each sizes the file for the destination, tags the filename (`_obs`, `_streamyard-overlay`, `_streamyard-bg`), shows where to load it, and warns if the design isn't 16:9, is over StreamYard's 20 MB limit, or is opaque but exported as an overlay (it would cover the cameras). StreamYard's sizes come from its published spec (1280×720, JPG/PNG/GIF, < 20 MB).
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
cd tests && ./run-all.sh        # all suites, incl. lowerthirds
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
