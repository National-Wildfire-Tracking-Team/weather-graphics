/* Map runtime shared by the interactive Map Studio and the high-resolution export renderer.
   Engine: Mapbox GL JS v3.9.0 (already used by the Weather Plate Builder in this repo).
   Map state is plain JSON (see NS.defaultMapState) and is stored separately from the canvas composition. */
(function () {
  NS.config = { token: '', style: '', projection: null };
  NS.loadConfig = async function () {
    try {
      const r = await fetch('config.json', { cache: 'no-store' });
      if (r.ok) { const c = await r.json(); ['token', 'style'].forEach(k => { if (typeof c[k] === 'string' && !/REPLACE_ME/.test(c[k])) NS.config[k] = c[k]; }); NS.config.projection = c.projection || null; }
    } catch (e) { /* offline or file:// */ }
    try { const s = await NS.Store.get('settings', 'map'); if (s) { if (s.token && !NS.config.token) NS.config.token = s.token; if (s.style && !NS.config.style) NS.config.style = s.style; } } catch (e) {}
  };

  NS.prepareFonts = async function (extra) {
    const fams = new Set(['Barlow Condensed', 'Barlow', 'Oswald', 'Merriweather', 'Roboto Mono'].concat(extra || [])); const jobs = [];
    fams.forEach(f => [400, 500, 600, 700, 800].forEach(w => jobs.push(document.fonts.load(w + ' 24px "' + f + '"').catch(() => {}))));
    await Promise.all(jobs); if (fabric.util.clearFabricFontCache) fabric.util.clearFabricFontCache();
  };
  NS.STYLES = {
    broadcast: { name: 'Broadcast dark (Studio style)', get url() { return NS.config.style; }, projection: 'albers', note: 'Custom Mapbox Studio style from config.json.' },
    dark: { name: 'Dark', url: 'mapbox://styles/mapbox/dark-v11' },
    light: { name: 'Light', url: 'mapbox://styles/mapbox/light-v11' },
    streets: { name: 'Streets', url: 'mapbox://styles/mapbox/streets-v12' },
    satellite: { name: 'Satellite imagery', url: 'mapbox://styles/mapbox/satellite-v9' },
    'satellite-labels': { name: 'Satellite with labels', url: 'mapbox://styles/mapbox/satellite-streets-v12' },
    outdoors: { name: 'Terrain (Outdoors)', url: 'mapbox://styles/mapbox/outdoors-v12', note: 'Hillshade and contour lines; 3D terrain optional.' },
    minimal: { name: 'Minimal / muted', url: 'mapbox://styles/mapbox/light-v11', hide: /(road|bridge|tunnel|poi|transit|label)/, note: 'Light basemap with roads and labels hidden by default.' },
    custom: { name: 'Custom style URL', get url() { return ''; } }
  };

  // Basemap layer groups: toggles match style layer IDs by pattern, so they work with any Mapbox-style basemap.
  NS.STYLE_TOGGLES = [
    { id: 'roads', name: 'Roads and highways', re: /(^|-)(road|bridge|tunnel|motorway|trunk|street)/ },
    { id: 'labels', name: 'Cities and geographic labels', re: /(label|city-dot)/ },
    { id: 'admin1', name: 'State boundaries', re: /admin-1/ },
    { id: 'water', name: 'Rivers and lakes', re: /water/ },
    { id: 'terrain', name: 'Terrain shading and contours', re: /(hillshade|contour)/ },
    { id: 'countyStyle', name: 'County lines (Studio style only)', re: /^county-lines$/ }
  ];

  NS.defaultMapState = function (viewName) {
    const v = NS.VIEWS[viewName || 'Southeast'] || NS.VIEWS.Southeast;
    return {
      v: 1, style: NS.config.style ? 'broadcast' : 'dark', customStyle: '', projection: NS.config.style ? 'albers' : 'mercator',
      center: [(v[0][0] + v[1][0]) / 2, (v[0][1] + v[1][1]) / 2], zoom: 5, bearing: 0, pitch: 0, extent: v, size: null,
      fit: { extent: v, padding: 0 },   // until the user frames the map themselves: fit this extent to the frame
      basemap: true, terrain3d: false, showAttribution: true,
      toggles: {}, layers: {}, layerOrder: [], layerData: {},
      features: { type: 'FeatureCollection', features: [] }
    };
  };
  NS.VIEWS = {
    'Southeast': [[-92.5, 24.5], [-76.5, 37.8]], 'Gulf Coast': [[-98, 24], [-80, 33.5]], 'Midwest': [[-98, 36], [-80, 49]],
    'Plains': [[-107, 28], [-90, 49]], 'Northeast': [[-83, 38], [-66, 47.8]], 'West': [[-125.5, 31], [-102, 49.2]],
    'Lower 48': [[-126, 23.5], [-65, 50]], 'Alaska': [[-170, 51], [-129, 72]], 'Hawaii': [[-161, 18.5], [-154.5, 22.5]],
    'Atlantic basin': [[-100, 5], [-10, 50]], 'Gulf of Mexico': [[-98.5, 17.5], [-80, 31]]
  };

  const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
  const FONT = ['DIN Pro Medium', 'Arial Unicode MS Regular'];

  /* ---- geometry helpers ---- */
  const R = 6371;
  NS.geo = {
    circlePolygon(center, km, n) {
      n = n || 72; const [lng, lat] = center, d = km / R, la = lat * Math.PI / 180, lo = lng * Math.PI / 180, ring = [];
      for (let i = 0; i <= n; i++) {
        const b = 2 * Math.PI * i / n;
        const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
        const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
        ring.push([lo2 * 180 / Math.PI, la2 * 180 / Math.PI]);
      }
      return { type: 'Polygon', coordinates: [ring] };
    },
    distKm(a, b) {
      const p = Math.PI / 180, dLa = (b[1] - a[1]) * p, dLo = (b[0] - a[0]) * p;
      const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * p) * Math.cos(b[1] * p) * Math.sin(dLo / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    }
  };

  /* Derived (non-editable) render features: arrowheads, track dots, circle outlines. Source of truth stays state.features. */
  function derive(map, fc) {
    const out = [];
    (fc.features || []).forEach(f => {
      out.push(f);
      const p = f.properties || {};
      if (f.geometry && f.geometry.type === 'LineString' && f.geometry.coordinates.length > 1) {
        const cs = f.geometry.coordinates;
        if (p.kind === 'arrow' && map) {
          const a = map.project(cs[cs.length - 2]), b = map.project(cs[cs.length - 1]);
          const ang = Math.atan2(b.y - a.y, b.x - a.x), s = Math.max(8, (p.strokeWidth || 4) * 3.2);
          const pt = (len, off) => map.unproject([b.x + Math.cos(ang) * len - Math.sin(ang) * off, b.y + Math.sin(ang) * len + Math.cos(ang) * off]).toArray();
          const ring = [pt(s * 0.4, 0), pt(-s, s * 0.7), pt(-s, -s * 0.7), pt(s * 0.4, 0)];
          out.push({ type: 'Feature', properties: { kind: 'arrowhead', parentId: p.id, fill: p.stroke, fillOpacity: 1 }, geometry: { type: 'Polygon', coordinates: [ring] } });
        }
        if (p.kind === 'track') {
          const labels = (p.pointLabels || '').split('\n');
          cs.forEach((c, i) => out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c },
            properties: { kind: 'trackdot', parentId: p.id, fill: p.stroke, size: p.size || 6, label: labels[i] || '', labelColor: p.labelColor || '#E8EDF3', labelSize: p.labelSize || 14 } }));
        }
      }
    });
    return { type: 'FeatureCollection', features: out };
  }

  class MapScene {
    constructor(container, opts) {
      this.el = container; this.opts = opts || {}; this.map = null; this.state = null; this.token = NS.config.token;
      this.destroyed = false; this.onFeaturesNeedRefresh = null;
    }
    async init(state) {
      if (!this.token) throw new Error('No Mapbox token configured. Add one in Brand Settings → Map settings.');
      this.state = state;
      mapboxgl.accessToken = this.token;
      const url = this.styleUrl(state);
      if (!url) throw new Error('The selected map style has no URL. Choose another style or set a custom style URL.');
      const o = {
        container: this.el, style: url, center: state.center, zoom: state.zoom, bearing: state.bearing || 0, pitch: state.pitch || 0,
        projection: state.projection || 'mercator', preserveDrawingBuffer: true, attributionControl: false, fadeDuration: 0, antialias: true,
        interactive: this.opts.interactive !== false, optimizeForTerrain: true
      };
      await NS.ensureStatic(state);
      this.map = new mapboxgl.Map(o);
      this.map.on('error', e => { this.lastError = (e && e.error && e.error.message) || String(e); if (this.opts.onError) this.opts.onError(this.lastError); });
      await new Promise((res, rej) => { this.map.once('load', res); this.map.once('error', e => { if (!this.map.loaded()) rej(new Error('Map failed to load: ' + ((e.error && e.error.message) || 'unknown'))); }); });
      this.map.on('style.load', () => this.installAll());
      if (state.fit && state.fit.extent) this.map.fitBounds(state.fit.extent, { padding: state.fit.padding || 0, duration: 0 });
      await this.installAll();
      this.map.on('zoom', () => this.refreshFeatures()); this.map.on('rotate', () => this.refreshFeatures());
      return this;
    }
    styleUrl(s) {
      if (s.style === 'custom') return s.customStyle;
      const d = NS.STYLES[s.style]; return d && d.url;
    }
    async setStyle(state) {
      const changed = this.styleUrl(state) !== this.styleUrl(this.state) || state.style !== this.state.style;
      this.state = state;
      if (changed) {
        await new Promise(res => { this.map.once('style.load', res); this.map.setStyle(this.styleUrl(state)); });
        await this.installAll();
      } else await this.installAll();
    }
    /* Idempotent: (re)adds our sources/layers and applies toggles; safe after any style swap. */
    async installAll() {
      const m = this.map, s = this.state; if (!m || this.destroyed || !m.isStyleLoaded && !m.getStyle()) return;
      try { m.setProjection(s.projection || 'mercator'); } catch (e) {}
      this.applyToggles();
      this.installOverlays();
      this.installFeatureLayers();
      this.refreshFeatures();
      this.applyTerrain();
      if (this.onInstall) this.onInstall();
    }
    applyToggles() {
      const m = this.map, s = this.state, st = NS.STYLES[s.style] || {}, layers = (m.getStyle() || {}).layers || [];
      const setVis = (id, on) => { try { m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); } catch (e) {} };
      layers.forEach(l => { if (/^ns-/.test(l.id)) return; if (s.basemap === false) { setVis(l.id, false); return; } setVis(l.id, true); });
      if (s.basemap === false) return;
      NS.STYLE_TOGGLES.forEach(t => {
        const def = t.id in (s.toggles || {}) ? s.toggles[t.id] : !(st.hide && st.hide.test(t.id));
        // Minimal style hides roads/labels by default; other styles default to on.
        const on = (t.id in (s.toggles || {})) ? s.toggles[t.id] : !(st.hide && (st.hide.test(t.id) || (t.id === 'labels' && st.hide.test('label'))));
        layers.forEach(l => { if (!/^ns-/.test(l.id) && t.re.test(l.id)) setVis(l.id, on); });
      });
    }
    applyTerrain() {
      const m = this.map, s = this.state;
      try {
        if (s.terrain3d && (s.projection || 'mercator') !== 'albers') {
          if (!m.getSource('ns-dem')) m.addSource('ns-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
          m.setTerrain({ source: 'ns-dem', exaggeration: 1.3 });
        } else if (m.getTerrain()) m.setTerrain(null);
      } catch (e) { this.lastError = 'Terrain: ' + e.message; }
    }
    firstLabelLayer() {
      const ls = (this.map.getStyle() || {}).layers || [];
      const a = ls.find(l => l.id === 'admin-1-boundary'); if (a) return a.id;
      const sym = ls.find(l => l.type === 'symbol' && !/^ns-/.test(l.id)); return sym ? sym.id : undefined;
    }
    installOverlays() {
      const m = this.map, s = this.state, before = this.firstLabelLayer();
      const order = (s.layerOrder || []).filter(id => s.layers[id] && s.layers[id].on);
      NS.Providers.forEach(p => {
        if (p.mode === 'none') return;
        const cfg = s.layers[p.id], on = !!(cfg && cfg.on), op = cfg && cfg.opacity != null ? cfg.opacity : 0.85, sid = 'ns-ov-' + p.id;
        const ids = [sid + '-fill', sid + '-line', sid + '-pts', sid + '-lbl', sid + '-raster'];
        if (!on) { ids.forEach(i => { if (m.getLayer(i)) m.removeLayer(i); }); if (m.getSource(sid)) m.removeSource(sid); return; }
        if (p.mode === 'raster') {
          if (!m.getSource(sid)) m.addSource(sid, { type: 'raster', tiles: p.tiles, tileSize: p.tileSize || 256, maxzoom: p.maxzoom || 18, attribution: '' });
          if (!m.getLayer(sid + '-raster')) m.addLayer({ id: sid + '-raster', type: 'raster', source: sid, paint: { 'raster-opacity': op, 'raster-fade-duration': 0 } }, before);
          else m.setPaintProperty(sid + '-raster', 'raster-opacity', op);
          return;
        }
        const snap = s.layerData[p.id]; const data = p.mode === 'geojson-static' ? (NS.staticCache[p.id] || emptyFC()) : (snap && snap.data ? snap.data : emptyFC());
        if (!m.getSource(sid)) m.addSource(sid, { type: 'geojson', data }); else m.getSource(sid).setData(data);
        const col0 = (cfg && cfg.color) || (p.style && p.style.color) || '#F2453D', col = p.style && p.style.perFeatureColor ? ['coalesce', ['get', 'color'], col0] : col0;
        const fillOp = p.style && p.style.solid ? Math.min(1, op / 0.85) : 0.35 * op / 0.85;   // solid fills are opaque at the default opacity
        if (p.style && p.style.kind === 'tropical') this.installTropical(sid, op, before);
        else {
          if (p.style.kind === 'poly' && !m.getLayer(sid + '-fill')) m.addLayer({ id: sid + '-fill', type: 'fill', source: sid, paint: { 'fill-color': col, 'fill-opacity': fillOp } }, before);
          if (!m.getLayer(sid + '-line')) m.addLayer({ id: sid + '-line', type: 'line', source: sid, paint: { 'line-color': col, 'line-width': p.style.kind === 'line' ? 0.5 : p.style.solid ? 0.6 : 2, 'line-opacity': p.style.opacity != null ? p.style.opacity : op } }, before);
          if (m.getLayer(sid + '-fill')) m.setPaintProperty(sid + '-fill', 'fill-opacity', fillOp);
        }
      });
      // layer order: later in layerOrder = higher
      order.forEach(id => ['-fill', '-line', '-raster', '-pts', '-lbl'].forEach(sfx => { const l = 'ns-ov-' + id + sfx; if (m.getLayer(l)) m.moveLayer(l, before); }));
    }
    installTropical(sid, op, before) {
      const m = this.map; if (m.getLayer(sid + '-fill')) return;
      m.addLayer({ id: sid + '-fill', type: 'fill', source: sid, filter: ['==', ['get', 'nhcKind'], 'cone'], paint: { 'fill-color': '#E8EDF3', 'fill-opacity': 0.25 * op / 0.85 } }, before);
      m.addLayer({ id: sid + '-line', type: 'line', source: sid, filter: ['in', ['get', 'nhcKind'], ['literal', ['cone', 'forecastTrack', 'pastTrack']]],
        paint: { 'line-color': ['match', ['get', 'nhcKind'], 'forecastTrack', '#F2B53D', 'pastTrack', '#E8EDF3', '#E8EDF3'], 'line-width': ['match', ['get', 'nhcKind'], 'cone', 1.2, 3],
          'line-dasharray': ['match', ['get', 'nhcKind'], 'forecastTrack', ['literal', [2, 1.5]], ['literal', [1, 0]]] } }, before);
      m.addLayer({ id: sid + '-pts', type: 'circle', source: sid, filter: ['in', ['get', 'nhcKind'], ['literal', ['forecastPoint', 'pastPoint']]],
        paint: { 'circle-radius': 5, 'circle-color': ['match', ['get', 'nhcKind'], 'forecastPoint', '#F2B53D', '#E8EDF3'], 'circle-stroke-color': '#0C1119', 'circle-stroke-width': 1 } }, before);
    }
    installFeatureLayers() {
      const m = this.map;
      if (!m.getSource('ns-features')) m.addSource('ns-features', { type: 'geojson', data: emptyFC() });
      const P = ['==', ['geometry-type'], 'Polygon'], L = ['==', ['geometry-type'], 'LineString'], Pt = ['==', ['geometry-type'], 'Point'];
      const add = l => { if (!m.getLayer(l.id)) m.addLayer(Object.assign({ source: 'ns-features' }, l)); };
      add({ id: 'ns-fill', type: 'fill', filter: P, paint: { 'fill-color': ['coalesce', ['get', 'fill'], '#F2453D'], 'fill-opacity': ['coalesce', ['get', 'fillOpacity'], 0.35] } });
      const ls = ['coalesce', ['get', 'lineStyle'], 'solid'];
      const lineBase = { 'line-color': ['coalesce', ['get', 'stroke'], '#F2453D'], 'line-width': ['coalesce', ['get', 'strokeWidth'], 3], 'line-opacity': ['coalesce', ['get', 'strokeOpacity'], 1] };
      const notHead = ['!=', ['get', 'kind'], 'arrowhead'];
      add({ id: 'ns-line-solid', type: 'line', filter: ['all', ['any', P, L], ['==', ls, 'solid'], notHead], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: lineBase });
      add({ id: 'ns-line-dashed', type: 'line', filter: ['all', ['any', P, L], ['==', ls, 'dashed']], layout: { 'line-join': 'round' }, paint: Object.assign({ 'line-dasharray': [2.2, 1.6] }, lineBase) });
      add({ id: 'ns-line-dotted', type: 'line', filter: ['all', ['any', P, L], ['==', ls, 'dotted']], layout: { 'line-cap': 'round' }, paint: Object.assign({ 'line-dasharray': [0.01, 2] }, lineBase) });
      add({ id: 'ns-pts', type: 'circle', filter: Pt, paint: { 'circle-radius': ['coalesce', ['get', 'size'], 9], 'circle-color': ['coalesce', ['get', 'fill'], '#F2453D'],
        'circle-stroke-color': ['coalesce', ['get', 'stroke'], '#FFFFFF'], 'circle-stroke-width': ['case', ['==', ['get', 'kind'], 'trackdot'], 1.5, 2.5] } });
      add({ id: 'ns-labels', type: 'symbol', filter: ['all', ['has', 'label'], ['!=', ['get', 'label'], '']], layout: {
        'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': ['coalesce', ['get', 'labelSize'], 16], 'text-anchor': ['coalesce', ['get', 'labelAnchor'], 'top'],
        'text-offset': ['case', Pt, ['literal', [0, 1]], ['literal', [0, 0]]], 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-max-width': 12 },
        paint: { 'text-color': ['coalesce', ['get', 'labelColor'], '#FFFFFF'], 'text-halo-color': 'rgba(8,12,18,0.9)', 'text-halo-width': 1.6 } });
      // top of the stack
      ['ns-fill', 'ns-line-solid', 'ns-line-dashed', 'ns-line-dotted', 'ns-pts', 'ns-labels'].forEach(id => m.moveLayer(id));
    }
    refreshFeatures(sel) {
      const m = this.map; if (!m || this.destroyed) return;
      const src = m.getSource('ns-features'); if (!src) return;
      src.setData(derive(m, this.state.features));
    }
    setFeatures(fc) { this.state.features = fc; this.refreshFeatures(); }
    getView() {
      const m = this.map, b = m.getBounds();
      return { center: m.getCenter().toArray(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch(), extent: [b.getSouthWest().toArray(), b.getNorthEast().toArray()] };
    }
    fit(extent, padding) { this.map.fitBounds(extent, { padding: padding || 0, duration: 0 }); }
    whenIdle(ms) {
      const m = this.map;
      return new Promise(res => {
        let done = false; const fin = ok => { if (!done) { done = true; res(ok); } };
        const chk = () => { if (m.loaded() && !m.isMoving()) fin(true); else m.once('idle', () => fin(true)); };
        m.triggerRepaint(); chk(); setTimeout(() => fin(false), ms || 20000);
      });
    }
    destroy() { this.destroyed = true; try { this.map && this.map.remove(); } catch (e) {} this.map = null; }
  }
  NS.MapScene = MapScene;

  /* ---- provider data ---- */
  NS.staticCache = {};   // large static boundary sets are cached in memory, never saved into projects
  NS.ensureStatic = async function (state) { for (const p of NS.Providers) if (p.mode === 'geojson-static' && state.layers[p.id] && state.layers[p.id].on && !NS.staticCache[p.id]) { try { NS.staticCache[p.id] = await p.fetch(); state.layerData[p.id] = state.layerData[p.id] || { fetchedAt: Date.now(), static: true }; } catch (e) { NS.layerStatus[p.id] = { state: 'error', error: e.message }; } } };
  NS.layerStatus = {};   // id -> {state:'idle|loading|ok|empty|error|stale', fetchedAt, count, error}
  NS.layerCount = d => d && d.features ? d.features.length : 0;
  NS.statusFor = function (state, p) {
    const cfg = state.layers[p.id]; if (p.mode === 'none') return { state: 'unavailable', text: 'Not configured' };
    if (!cfg || !cfg.on) return { state: 'off', text: 'Off' };
    if (p.mode === 'raster') return { state: 'ok', text: 'Live tiles · current at render time' };
    const live = NS.layerStatus[p.id] || {}; if (live.state === 'loading') return { state: 'loading', text: 'Loading…' };
    if (live.state === 'error') return { state: 'error', text: 'Error: ' + live.error };
    const snap = state.layerData[p.id]; if (!snap) return { state: 'idle', text: 'No data fetched yet' };
    const age = Date.now() - snap.fetchedAt, n = NS.layerCount(snap.static ? NS.staticCache[p.id] : snap.data), when = new Date(snap.fetchedAt).toLocaleString();
    if (p.staleAfter && age > p.staleAfter) return { state: 'stale', text: 'Stale · fetched ' + when + (n ? ' · ' + n + ' features' : ' · empty') };
    return { state: n ? 'ok' : 'empty', text: (n ? n + ' features' : 'Fetched; no active features') + ' · ' + when };
  };
  NS.fetchLayer = async function (state, id, onChange) {
    const p = NS.Providers.find(x => x.id === id); if (!p || !p.fetch) return;
    NS.layerStatus[id] = { state: 'loading' }; onChange && onChange();
    try {
      const data = await p.fetch(state.layers[id]);
      if (p.mode === 'geojson-static') { NS.staticCache[id] = data; state.layerData[id] = { fetchedAt: Date.now(), static: true }; }
      else state.layerData[id] = { fetchedAt: Date.now(), data };
      NS.layerStatus[id] = { state: 'ok' };
    } catch (e) { NS.layerStatus[id] = { state: 'error', error: e.message }; }
    onChange && onChange();
  };

  /* ---- high-resolution export renderer ----
     Renders a fresh, off-screen Mapbox map at (w x h CSS px) x ratio device pixels, so labels and lines are drawn
     natively at the target resolution rather than upscaled from a preview screenshot. */
  NS.renderMapCanvas = async function (state, w, h, ratio) {
    const warnings = [];
    for (const p of NS.Providers) {
      const cfg = state.layers[p.id]; if (!(cfg && cfg.on) || p.mode === 'none' || p.mode === 'raster') continue;
      if (p.mode === 'geojson-static') { await NS.ensureStatic(state); if (!NS.staticCache[p.id]) throw new Error('Layer "' + p.name + '" could not be loaded (' + ((NS.layerStatus[p.id] || {}).error || 'unknown error') + ').'); continue; }
      if (!state.layerData[p.id]) { await NS.fetchLayer(state, p.id); }
      if (!state.layerData[p.id]) throw new Error('Layer "' + p.name + '" is enabled but its data could not be loaded (' + ((NS.layerStatus[p.id] || {}).error || 'unknown error') + '). Disable the layer or try again.');
    }
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-20000px;top:0;width:' + w + 'px;height:' + h + 'px;pointer-events:none';
    document.body.appendChild(holder);
    const desc = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { value: ratio, configurable: true, writable: true });
    const st = JSON.parse(JSON.stringify(state));
    let scene;
    try {
      scene = new MapScene(holder, { interactive: false });
      await scene.init(st);
      // Same extent when the frame's aspect differs from the one the map was framed in.
      if (!st.fit && st.size && (Math.abs(st.size[0] / st.size[1] - w / h) > 0.01 || st.size[0] !== w) && st.extent) scene.fit(st.extent, 0);
      await scene.whenIdle(25000);
      scene.refreshFeatures(); await scene.whenIdle(8000);
      const src = scene.map.getCanvas(), c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      c.getContext('2d').drawImage(src, 0, 0);
      if (c.width !== Math.round(w * ratio) || c.height !== Math.round(h * ratio)) warnings.push('Map rendered at ' + c.width + '×' + c.height + ' instead of ' + Math.round(w * ratio) + '×' + Math.round(h * ratio) + ' (browser limit).');
      if (scene.lastError) warnings.push('Map warning: ' + scene.lastError);
      return { canvas: c, warnings };
    } finally {
      if (scene) scene.destroy();
      holder.remove();
      if (desc) Object.defineProperty(window, 'devicePixelRatio', desc); else delete window.devicePixelRatio;
    }
  };
  // Attribution text required by the providers behind the enabled layers/styles.
  NS.attributionFor = function (state) {
    const parts = [];
    if (state.basemap !== false) parts.push('© Mapbox © OpenStreetMap');
    NS.Providers.forEach(p => { if (state.layers[p.id] && state.layers[p.id].on && p.attribution) parts.push(p.attribution.replace(/\s*\(.*\)/, '')); });
    return Array.from(new Set(parts)).join(' · ');
  };
})();
