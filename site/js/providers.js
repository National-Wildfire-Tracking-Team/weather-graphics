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

  /* ---------- NWS alert explorer ----------
     Loads every active NWS alert, lets the UI filter by event / state / severity, and turns a selection into GeoJSON.
     Many alerts (watches, advisories, winter/heat/marine products) carry no polygon, only a list of NWS zones, so the
     zone shapes are fetched from api.weather.gov and drawn instead. Nothing is invented: zones that fail to load are reported. */
  const STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP'.split(' '));
  const MAX_ZONES = 700;
  const ugcState = u => (STATES.has(u.slice(0, 2)) && (u[2] === 'Z' || u[2] === 'C')) ? u.slice(0, 2) : 'Marine/other';
  const eventColor = ev => /Tornado (Warning|Emergency)|Extreme Wind|Hurricane Warning|Flash Flood Emergency/.test(ev) ? '#F2453D'
    : /Warning$/.test(ev) ? '#F2453D' : /Watch$/.test(ev) ? '#F2B53D' : /Advisory$/.test(ev) ? '#4C9BFF' : /Statement$|Outlook$/.test(ev) ? '#3FB6C9' : '#9AA7B8';
  const roundGeom = g => { const r = c => typeof c[0] === 'number' ? [+c[0].toFixed(4), +c[1].toFixed(4)] : c.map(r); return g && g.coordinates ? { type: g.type, coordinates: r(g.coordinates) } : g; };
  const zoneCache = new Map();
  const NWS = NS.NWS = {
    MAX_ZONES, eventColor, loaded: null,
    async loadActive() {
      const d = await fetchJSON('https://api.weather.gov/alerts/active?status=actual&message_type=alert,update', 60000);
      const list = (d.features || []).map(f => {
        const p = f.properties || {}, ugc = (p.geocode && p.geocode.UGC) || [];
        return { id: f.id || p.id, event: p.event, severity: p.severity || 'Unknown', headline: p.headline, areaDesc: p.areaDesc, sent: p.sent, expires: p.expires, sender: p.senderName,
          geometry: f.geometry || null, zones: p.affectedZones || [], states: Array.from(new Set(ugc.map(ugcState))) };
      }).filter(a => a.event);
      return (NWS.loaded = { fetchedAt: Date.now(), alerts: list });
    },
    filter(list, f) {
      f = f || {};
      return list.filter(a => (!f.events || !f.events.length || f.events.includes(a.event)) && (!f.states || !f.states.length || a.states.some(s => f.states.includes(s)))
        && (!f.severities || !f.severities.length || f.severities.includes(a.severity)));
    },
    // Zone URLs that would have to be fetched for polygon-less alerts under filter f (states restrict zones, not just alerts).
    zoneUrls(alerts, f) {
      const out = new Set();
      alerts.forEach(a => { if (!a.geometry) a.zones.forEach(u => { if (!f.states || !f.states.length || f.states.includes(ugcState(u.split('/').pop()))) out.add(u); }); });
      return Array.from(out);
    },
    async build(alerts, f, color, onProgress) {
      f = f || {}; const feats = [], notes = [], byZone = new Map();
      const props = (a, extra) => Object.assign({ event: a.event, headline: a.headline, areaDesc: a.areaDesc, severity: a.severity, expires: a.expires, sent: a.sent, sender: a.sender, color: color || eventColor(a.event) }, extra);
      alerts.forEach(a => {
        if (a.geometry) { feats.push({ type: 'Feature', geometry: roundGeom(a.geometry), properties: props(a) }); return; }
        a.zones.forEach(u => {
          if (f.states && f.states.length && !f.states.includes(ugcState(u.split('/').pop()))) return;
          const l = byZone.get(u) || byZone.set(u, new Map()).get(u); if (!l.has(a.event)) l.set(a.event, a);
        });
      });
      const urls = Array.from(byZone.keys());
      if (urls.length > MAX_ZONES) throw new Error(urls.length + ' alert areas are too many to draw (limit ' + MAX_ZONES + '). Narrow the selection with a state filter.');
      let done = 0, failed = 0, next = 0;
      const worker = async () => {
        while (next < urls.length) {
          const u = urls[next++];
          try {
            if (!zoneCache.has(u)) { const z = await fetchJSON(u, 20000); zoneCache.set(u, z && z.geometry ? roundGeom(z.geometry) : null); }
            const g = zoneCache.get(u); if (!g) failed++; else byZone.get(u).forEach(a => feats.push({ type: 'Feature', geometry: g, properties: props(a, { zone: u.split('/').pop() }) }));
          } catch (e) { failed++; }
          onProgress && onProgress(++done, urls.length);
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
      if (failed) notes.push(failed + ' of ' + urls.length + ' alert zone shapes could not be loaded and are missing from the map.');
      if (urls.length && failed === urls.length && !feats.length) throw new Error('Could not load alert zone shapes from api.weather.gov.');
      const fc = FC(feats); fc.notes = notes; return fc;
    }
  };

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

  /* ---------- WPC forecast polygons (rainfall, excessive rainfall, snowfall) ----------
     Real NWS/WPC product polygons, drawn as issued: nothing is interpolated or invented here.
     Colors are assigned from each polygon's own value (QPF inches / outlook probability class). */
  const WPC = 'https://mapservices.weather.noaa.gov/vector/rest/services';
  const QPF_COLORS = [[0.01, '#9ADBF2'], [0.1, '#4FC3E8'], [0.25, '#3FBF7F'], [0.5, '#6FD04A'], [0.75, '#B5E04A'], [1, '#F2E84A'], [1.25, '#F7C63D'], [1.5, '#F59A3A'], [1.75, '#F2703A'],
    [2, '#E8453D'], [2.5, '#D6283F'], [3, '#C2185B'], [4, '#A8179F'], [5, '#8A2BE2'], [7, '#6A3FD0'], [10, '#F0F0FF']];   // light blue → green → yellow → red → magenta → violet
  const qpfColor = q => { let c = QPF_COLORS[0][1]; QPF_COLORS.forEach(([t, k]) => { if (q >= t) c = k; }); return c; };
  const SNOW_COLORS = { 1: '#4C9BFF', 2: '#B04CE0', 3: '#F2453D' };   // WPC outlook classes: Slight / Moderate / High
  async function wpcQuery(service, layer, fields) {
    const d = await fetchJSON(WPC + '/' + service + '/MapServer/' + layer + '/query?where=1%3D1&outFields=' + fields + '&outSR=4326&maxAllowableOffset=0.01&geometryPrecision=3&f=geojson', 45000);
    return d.features || [];
  }
  const wpcQpf = (id, name, layer, span) => ({
    id, group: 'Forecast', name, mode: 'geojson', style: { color: '#4C9BFF', kind: 'poly', perFeatureColor: true, solid: true },
    supplies: 'WPC quantitative precipitation forecast (' + span + '), as contoured polygons; color follows the forecast inches of each polygon.',
    attribution: 'NOAA / NWS Weather Prediction Center (QPF)', updateFreq: 'Issued about every 6 hours; refresh manually', staleAfter: 8 * 3600000,
    limitations: 'Forecast, not observed rainfall. Polygons are WPC\'s own contours (lightly simplified for display); the polygon\'s lower bound in inches is its value. Check the valid and issue times on the WPC site before publishing. Snapshot is frozen when fetched; press Refresh to update.',
    async fetch() {
      // Contours are nested: draw lowest amounts first so higher amounts sit on top of them.
      return FC((await wpcQuery('precip/wpc_qpf', layer, 'qpf,units,valid_time,issue_time')).map(f => {
        f.properties = Object.assign({}, f.properties, { color: qpfColor(+f.properties.qpf || 0) }); return f;
      }).sort((a, b) => a.properties.qpf - b.properties.qpf));
    }
  });
  const wpcSnow = (id, name, layer, day) => ({
    id, group: 'Forecast', name, mode: 'geojson', style: { color: '#4C9BFF', kind: 'poly', perFeatureColor: true },
    supplies: 'WPC probability of at least 4 inches of snow, ' + day + ' (Slight 10-39%, Moderate 40-69%, High 70-100%).',
    attribution: 'NOAA / NWS Weather Prediction Center (Winter Weather)', updateFreq: 'Issued about every 6 to 12 hours; refresh manually', staleAfter: 12 * 3600000,
    limitations: 'This is a probability outlook, not a snowfall-amount forecast, and it is often empty outside winter. Check the valid and issue times on the WPC site before publishing. Snapshot is frozen when fetched; press Refresh to update.',
    async fetch() {
      return FC((await wpcQuery('precip/wpc_prob_winter_precip', layer, 'outlook,dn,valid_time,issue_time')).map(f => {
        f.properties = Object.assign({}, f.properties, { color: SNOW_COLORS[Math.round(f.properties.dn)] || '#9AA7B8' }); return f;
      }));
    }
  });

  /* WPC Excessive Rainfall Outlook: probability that rainfall exceeds flash-flood guidance within 25 miles of a point.
     Colors are WPC's own (from the service renderer): Marginal green, Slight yellow, Moderate red, High magenta. */
  const ERO_COLORS = { 1: ['#38A800', '#00734C'], 2: ['#FFFE00', '#E69800'], 3: ['#F50000', '#8A0000'], 4: ['#FF69C5', '#FF00FF'] };
  const wpcEro = (id, name, layer, day) => ({
    id, group: 'Forecast', name, mode: 'geojson', style: { color: '#38A800', kind: 'poly', perFeatureColor: true, solid: true },
    supplies: 'WPC Excessive Rainfall Outlook, ' + day + ': probability of rainfall exceeding flash flood guidance within 25 miles of a point (Marginal 5%+, Slight 15%+, Moderate 40%+, High 70%+).',
    attribution: 'NOAA / NWS Weather Prediction Center (Excessive Rainfall Outlook)', updateFreq: 'Issued several times daily (Days 1-3), daily (Days 4-5); refresh manually', staleAfter: 12 * 3600000,
    limitations: 'Official WPC polygons drawn as issued, with WPC\'s colors. Empty when WPC outlines no risk area for that day. Check the valid and issue times on the WPC site before publishing. Snapshot is frozen when fetched; press Refresh to update.',
    async fetch() {
      // Higher risk sits inside lower risk, so draw low first.
      return FC((await wpcQuery('hazards/wpc_precip_hazards', layer, 'dn,outlook,product,valid_time,issue_time')).filter(f => f.properties && ERO_COLORS[f.properties.dn]).map(f => {
        const c = ERO_COLORS[f.properties.dn]; f.properties = Object.assign({}, f.properties, { color: c[0], fill: c[0], stroke: c[1] }); return f;
      }).sort((a, b) => a.properties.dn - b.properties.dn));
    }
  });

  /* ---------- SPC convective outlooks ----------
     Official Storm Prediction Center polygons, colored with SPC's own fill colors (shipped in each feature).
     Overview = categorical outlook; Likelihood = probability of the hazard; Intensity = conditional intensity (significant-severe) area. */
  const SPC = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer';
  const SPC_KIND = { overview: 'categorical risk categories', likelihood: 'probability of the hazard within 25 miles of a point', intensity: 'conditional intensity (area where significant severe is possible)' };
  const spcOutlook = (id, name, layer, kind, day) => ({
    id, group: 'Convective outlooks', name, mode: 'geojson', style: { color: '#F2B53D', kind: 'poly', perFeatureColor: true, solid: kind !== 'intensity' },
    supplies: 'SPC ' + day + ' convective outlook: ' + SPC_KIND[kind] + '.',
    attribution: 'NOAA / NWS Storm Prediction Center', updateFreq: 'Issued several times daily; refresh manually', staleAfter: 8 * 3600000,
    limitations: 'Official SPC polygons drawn as issued, with SPC\'s colors. ' + (kind === 'intensity' ? 'Intensity areas only exist when SPC outlines a significant-severe area, so this layer is often empty. ' : 'Empty when SPC issues no outlook for that hazard. ') + 'Check the valid and issue times on the SPC site before publishing. Snapshot is frozen when fetched; press Refresh to update.',
    async fetch() {
      const d = await fetchJSON(SPC + '/' + layer + '/query?where=1%3D1&outFields=dn,label,label2,stroke,fill,valid,issue&outSR=4326&maxAllowableOffset=0.01&geometryPrecision=3&f=geojson', 45000);
      // Higher-risk polygons sit inside lower ones, so draw low first. SPC returns a placeholder row (no label/fill) when a day has no outlook; skip it.
      return FC((d.features || []).filter(f => f.properties && f.properties.fill).map(f => { f.properties = Object.assign({}, f.properties, { color: f.properties.fill }); return f; })
        .sort((a, b) => a.properties.dn - b.properties.dn));
    }
  });

  window.NS.Providers = [
    nwsAlert('nws-tornado', 'Tornado warnings', 'Tornado Warning', '#F2453D'),
    nwsAlert('nws-svr', 'Severe thunderstorm warnings', 'Severe Thunderstorm Warning', '#F2B53D'),
    nwsAlert('nws-ffw', 'Flash flood warnings', 'Flash Flood Warning', '#4C9BFF'),
    nwsAlert('nws-flood', 'Flood warnings', 'Flood Warning', '#3FB6C9'),
    {
      id: 'nws-custom', group: 'Severe weather', name: 'NWS alerts (selected types)', mode: 'geojson', style: { color: '#F2453D', kind: 'poly', perFeatureColor: true },
      supplies: 'Any NWS alert type (warnings, watches, advisories, statements), filtered by event, state and severity. Polygon alerts are drawn as issued; zone-based alerts are drawn from the NWS zone shapes.',
      attribution: 'NOAA / National Weather Service (api.weather.gov)', updateFreq: 'Continuous; refresh manually', staleAfter: 10 * MIN,
      limitations: 'Choose the alert types in NWS Alert Graphics (the filter is stored with the graphic). Zone-based alerts show whole NWS zones, which can be larger than the area actually affected. Snapshot is frozen when fetched; press Refresh to update.',
      async fetch(cfg) {
        const f = cfg && cfg.filter;
        if (!f || !f.events || !f.events.length) throw new Error('No alert type selected. Create this graphic from NWS Alert Graphics.');
        const { alerts } = await NWS.loadActive();
        return NWS.build(NWS.filter(alerts, f), f, cfg.color || null);
      }
    },
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
    wpcQpf('rain-fcst', 'Rainfall forecast (WPC QPF, Day 1)', 1, '24 h, Day 1'),
    wpcQpf('rain-fcst-d2', 'Rainfall forecast (WPC QPF, Day 2)', 2, '24 h, Day 2'),
    wpcQpf('rain-fcst-d3', 'Rainfall forecast (WPC QPF, Day 3)', 3, '24 h, Day 3'),
    wpcQpf('rain-fcst-d45', 'Rainfall forecast (WPC QPF, Days 4-5)', 4, '48 h, Days 4-5'),
    wpcQpf('rain-fcst-d67', 'Rainfall forecast (WPC QPF, Days 6-7)', 5, '48 h, Days 6-7'),
    wpcQpf('rain-fcst-t2', 'Rainfall forecast (WPC QPF, 2-day total)', 8, '48 h accumulation, Days 1-2'),
    wpcQpf('rain-fcst-t3', 'Rainfall forecast (WPC QPF, 3-day total)', 9, '72 h accumulation, Days 1-3'),
    wpcQpf('rain-fcst-t5', 'Rainfall forecast (WPC QPF, 5-day total)', 10, '120 h accumulation, Days 1-5'),
    wpcQpf('rain-fcst-7d', 'Rainfall forecast (WPC QPF, 7-day total)', 11, '168 h accumulation, Days 1-7'),
    wpcEro('ero-d1', 'Excessive Rainfall Outlook (WPC, Day 1)', 0, 'Day 1'),
    wpcEro('ero-d2', 'Excessive Rainfall Outlook (WPC, Day 2)', 1, 'Day 2'),
    wpcEro('ero-d3', 'Excessive Rainfall Outlook (WPC, Day 3)', 2, 'Day 3'),
    wpcEro('ero-d4', 'Excessive Rainfall Outlook (WPC, Day 4)', 3, 'Day 4'),
    wpcEro('ero-d5', 'Excessive Rainfall Outlook (WPC, Day 5)', 4, 'Day 5'),
    wpcSnow('snow-fcst', 'Snowfall outlook (WPC, 4+ in, Day 1)', 1, 'Day 1'),
    wpcSnow('snow-fcst-d2', 'Snowfall outlook (WPC, 4+ in, Day 2)', 6, 'Day 2'),
    wpcSnow('snow-fcst-d3', 'Snowfall outlook (WPC, 4+ in, Day 3)', 11, 'Day 3'),
    spcOutlook('spc-d1-overview', 'SPC Day 1 Overview', 1, 'overview', 'Day 1'),
    spcOutlook('spc-d1-tornado-lik', 'SPC Day 1 Tornado Likelihood', 3, 'likelihood', 'Day 1'),
    spcOutlook('spc-d1-tornado-int', 'SPC Day 1 Tornado Intensity', 2, 'intensity', 'Day 1'),
    spcOutlook('spc-d1-hail-lik', 'SPC Day 1 Hail Likelihood', 5, 'likelihood', 'Day 1'),
    spcOutlook('spc-d1-hail-int', 'SPC Day 1 Hail Intensity', 4, 'intensity', 'Day 1'),
    spcOutlook('spc-d1-wind-lik', 'SPC Day 1 Wind Likelihood', 7, 'likelihood', 'Day 1'),
    spcOutlook('spc-d1-wind-int', 'SPC Day 1 Wind Intensity', 6, 'intensity', 'Day 1'),
    spcOutlook('spc-d2-overview', 'SPC Day 2 Overview', 9, 'overview', 'Day 2'),
    spcOutlook('spc-d2-tornado-lik', 'SPC Day 2 Tornado Likelihood', 11, 'likelihood', 'Day 2'),
    spcOutlook('spc-d2-tornado-int', 'SPC Day 2 Tornado Intensity', 10, 'intensity', 'Day 2'),
    spcOutlook('spc-d2-hail-lik', 'SPC Day 2 Hail Likelihood', 13, 'likelihood', 'Day 2'),
    spcOutlook('spc-d2-hail-int', 'SPC Day 2 Hail Intensity', 12, 'intensity', 'Day 2'),
    spcOutlook('spc-d2-wind-lik', 'SPC Day 2 Wind Likelihood', 15, 'likelihood', 'Day 2'),
    spcOutlook('spc-d2-wind-int', 'SPC Day 2 Wind Intensity', 14, 'intensity', 'Day 2'),
    spcOutlook('spc-d3-overview', 'SPC Day 3 Overview', 17, 'overview', 'Day 3'),
    spcOutlook('spc-d3-severe-lik', 'SPC Day 3 Severe Likelihood (all hazards)', 19, 'likelihood', 'Day 3'),
    spcOutlook('spc-d3-severe-int', 'SPC Day 3 Severe Intensity (all hazards)', 18, 'intensity', 'Day 3'),
    spcOutlook('spc-d4-severe-lik', 'SPC Day 4 Severe Likelihood (all hazards)', 21, 'likelihood', 'Day 4'),
    spcOutlook('spc-d5-severe-lik', 'SPC Day 5 Severe Likelihood (all hazards)', 22, 'likelihood', 'Day 5'),
    spcOutlook('spc-d6-severe-lik', 'SPC Day 6 Severe Likelihood (all hazards)', 23, 'likelihood', 'Day 6'),
    spcOutlook('spc-d7-severe-lik', 'SPC Day 7 Severe Likelihood (all hazards)', 24, 'likelihood', 'Day 7'),
    spcOutlook('spc-d8-severe-lik', 'SPC Day 8 Severe Likelihood (all hazards)', 25, 'likelihood', 'Day 8'),
    // Declared but intentionally unconfigured: shown as "Not configured" until a verified source is added.
    // Checked 2026-10-12: NOAA NDFD temperature MapServer is stale (time extent ends 2025-08-28); FEMA NFHL flood zones export rendered
    // blank in testing and is zoom-limited; no national authoritative wind-grid, evacuation-zone or historical-track service was found.
    ...[['wind-data', 'Wind data'], ['temp-data', 'Temperature data'],
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
