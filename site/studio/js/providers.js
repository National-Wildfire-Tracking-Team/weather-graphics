/* Data-layer provider registry.
   A provider describes ONE dataset: what it supplies, attribution, cadence, limits, and how to fetch it.
   Nothing here fabricates data: if a fetch fails or returns nothing, the layer shows error/empty, never sample data.
   To add a source: push another object onto NS.Providers (see the fields below). */
(function () {
  const MIN = 60000;
  async function fetchJSON(url, ms) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 25000);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/geo+json, application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' from ' + new URL(url).host);
      return await r.json();
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'Timed out contacting ' + new URL(url).host : (e.message || 'Network error'));
    } finally { clearTimeout(t); }
  }
  const FC = f => ({ type: 'FeatureCollection', features: f });
  const nwsAlert = (id, name, event, color) => ({
    id, group: 'Severe weather', name, mode: 'geojson', style: { color, kind: 'poly' },
    supplies: event + ' polygons currently active in the U.S.',
    attribution: 'NOAA / National Weather Service (api.weather.gov)',
    updateFreq: 'Continuous; refresh manually', staleAfter: 10 * MIN,
    limitations: 'Only alerts with a polygon are drawn (some alerts are zone-based and have no polygon). Snapshot is frozen when fetched; press Refresh to update.',
    async fetch() {
      const d = await fetchJSON('https://api.weather.gov/alerts/active?status=actual&event=' + encodeURIComponent(event));
      return FC((d.features || []).filter(f => f.geometry).map(f => ({ type: 'Feature', geometry: f.geometry,
        properties: { headline: f.properties.headline, areaDesc: f.properties.areaDesc, event: f.properties.event, expires: f.properties.expires, sent: f.properties.sent } })));
    }
  });

  const NHC = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';
  async function nhcFetch() {
    const meta = await fetchJSON(NHC + '?f=json');
    const want = { 'Forecast Points': 'forecastPoint', 'Forecast Track': 'forecastTrack', 'Forecast Cone': 'cone', 'Past Points': 'pastPoint', 'Past Track': 'pastTrack' };
    const byName = {}; (meta.layers || []).forEach(l => { byName[l.name] = l.id; });
    const slots = []; ['AT', 'EP', 'CP'].forEach(b => { for (let i = 1; i <= 5; i++) slots.push(b + i); });
    const q = async (slot, label) => {
      const id = byName[slot + ' ' + label]; if (id == null) return [];
      const d = await fetchJSON(NHC + '/' + id + '/query?where=1%3D1&outFields=*&outSR=4326&f=geojson');
      return (d.features || []).map(f => { f.properties = Object.assign({}, f.properties, { slot, nhcKind: want[label] }); return f; });
    };
    const all = [];
    for (let i = 0; i < slots.length; i += 5) {
      const pts = await Promise.all(slots.slice(i, i + 5).map(s => q(s, 'Forecast Points')));
      const active = slots.slice(i, i + 5).filter((s, k) => pts[k].length);
      pts.forEach(p => all.push(...p));
      for (const s of active) for (const lab of ['Forecast Track', 'Forecast Cone', 'Past Track', 'Past Points']) all.push(...await q(s, lab));
    }
    return FC(all);
  }

  window.NS.Providers = [
    nwsAlert('nws-tornado', 'Tornado warnings', 'Tornado Warning', '#F2453D'),
    nwsAlert('nws-svr', 'Severe thunderstorm warnings', 'Severe Thunderstorm Warning', '#F2B53D'),
    nwsAlert('nws-ffw', 'Flash flood warnings', 'Flash Flood Warning', '#4C9BFF'),
    nwsAlert('nws-flood', 'Flood warnings', 'Flood Warning', '#3FB6C9'),
    {
      id: 'nhc-tropical', group: 'Tropical', name: 'NHC active tropical cyclones', mode: 'geojson', style: { kind: 'tropical' },
      supplies: 'Forecast cone, forecast track and points, past track and points for active storms (Atlantic, East and Central Pacific).',
      attribution: 'NOAA / National Hurricane Center', updateFreq: 'Advisory cycle (typically every 6 h; intermediate advisories possible)', staleAfter: 7 * 3600000,
      limitations: 'Empty when no storms are active. Cone geometry is NHC\'s own; it is never computed here. Check the advisory time on the NHC site before publishing.',
      fetch: nhcFetch
    },
    {
      id: 'nifc-fire', group: 'Incidents', name: 'Wildfire perimeters (current)', mode: 'geojson', style: { color: '#F2B53D', kind: 'poly' },
      supplies: 'Current interagency wildfire perimeters (WFIGS).', attribution: 'NIFC / WFIGS Interagency Fire Perimeters',
      updateFreq: 'Approximately every 15 minutes to hourly', staleAfter: 60 * MIN,
      limitations: 'Geometry is simplified for display. Only incidents with a mapped perimeter appear. Not an evacuation or official warning source.',
      async fetch() {
        const d = await fetchJSON('https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1%3D1&outFields=poly_IncidentName,poly_GISAcres&outSR=4326&maxAllowableOffset=0.002&geometryPrecision=4&f=geojson&resultRecordCount=2000', 45000);
        return FC(d.features || []);
      }
    },
    {
      id: 'radar-nexrad', group: 'Radar', name: 'NEXRAD radar mosaic (current)', mode: 'raster', style: {},
      tiles: ['https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 9,
      supplies: 'CONUS base reflectivity mosaic tiles.', attribution: 'Radar: NEXRAD via Iowa Environmental Mesonet',
      updateFreq: 'About every 5 minutes', staleAfter: 15 * MIN,
      limitations: 'Raster tiles are always "current" and cannot be frozen: an exported graphic shows radar as of render time. CONUS only. Third-party service, no SLA; confirm terms for broadcast use.'
    },
    {
      id: 'us-counties', group: 'Boundaries', name: 'U.S. county boundaries', mode: 'geojson-static', style: { color: '#FFFFFF', kind: 'line', opacity: 0.25 },
      url: 'https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/counties-10m.json',
      supplies: 'Simplified Census county boundaries (1:10m).', attribution: 'US Census Bureau via us-atlas', updateFreq: 'Static',
      limitations: 'Simplified geometry; edges are coarse when zoomed in.',
      async fetch() {
        const d = await fetchJSON(this.url, 45000);
        const f = topoToFC(d); return f;
      }
    },
    // Declared but intentionally unconfigured: shown as "Not configured" until a verified source is added.
    ...[['rain-fcst', 'Rainfall forecast overlay'], ['snow-fcst', 'Snowfall forecast overlay'], ['wind-data', 'Wind data'], ['temp-data', 'Temperature data'],
        ['evac-zones', 'Evacuation zones'], ['flood-zones', 'Flood zones'], ['storm-history', 'Historical storm tracks']].map(([id, name]) => ({
      id, group: 'Not configured', name, mode: 'none', supplies: name + '.', attribution: '', updateFreq: 'n/a', unconfigured: true,
      limitations: 'No verified data source is configured yet. Import GeoJSON from an authoritative source as a custom layer in the meantime.'
    }))
  ];

  // Minimal TopoJSON -> GeoJSON converter for the county file (arcs + transform), avoids another dependency.
  function topoToFC(t) {
    const sc = t.transform ? t.transform.scale : [1, 1], tr = t.transform ? t.transform.translate : [0, 0];
    const arcs = t.arcs.map(a => { let x = 0, y = 0; return a.map(p => { x += p[0]; y += p[1]; return [x * sc[0] + tr[0], y * sc[1] + tr[1]]; }); });
    const arc = i => i < 0 ? arcs[~i].slice().reverse() : arcs[i];
    const ring = idx => { const out = []; idx.forEach((i, k) => { const a = arc(i); out.push(...(k ? a.slice(1) : a)); }); return out; };
    const geom = g => g.type === 'Polygon' ? { type: 'Polygon', coordinates: g.arcs.map(ring) } : { type: 'MultiPolygon', coordinates: g.arcs.map(p => p.map(ring)) };
    const obj = t.objects.counties;
    // Draw only county outlines: converting each polygon to lines is enough for a boundary layer.
    return FC(obj.geometries.filter(g => g.arcs).map(g => ({ type: 'Feature', id: g.id, properties: { GEOID: String(g.id).padStart(5, '0'), NAME: g.properties && g.properties.name }, geometry: geom(g) })));
  }
  NS.topoToFC = topoToFC;
  NS.fetchJSON = fetchJSON;

  // Geocoding via Mapbox Geocoding v6 (same public token as the map).
  NS.geocode = async function (q, token, opts) {
    opts = opts || {};
    const u = 'https://api.mapbox.com/search/geocode/v6/forward?limit=6&q=' + encodeURIComponent(q) + (opts.country ? '&country=' + opts.country : '') + '&access_token=' + encodeURIComponent(token);
    const d = await fetchJSON(u, 12000);
    return (d.features || []).map(f => ({
      name: f.properties.full_address || f.properties.name_preferred || f.properties.name, type: f.properties.feature_type,
      center: f.geometry.coordinates, bbox: f.properties.bbox || f.bbox || null
    }));
  };
})();
