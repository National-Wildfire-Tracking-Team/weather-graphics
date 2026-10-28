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

  /* ---------- Week-ahead hazards ----------
     Collects every official outlook polygon that carries a valid date and maps it onto the calendar days it covers:
     SPC convective outlooks (Days 1-3 categorical, Days 4-8 probability), WPC Excessive Rainfall Outlook (Days 1-5),
     WPC probability of 4+ in of snow (Days 1-3), the WPC Day 3-7 Hazards Outlook and the CPC Day 8-14 Hazards Outlook.
     A day that no product reaches is reported as "no outlook", never filled in. */
  const DAY = 86400000;
  const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
  const localToday = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  const spcTime = s => /^\d{12}$/.test(s || '') ? Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12)) : null;
  const wpcTime = s => { const t = s ? Date.parse(String(s).replace(' ', 'T') + 'Z') : NaN; return isNaN(t) ? null : t; };
  // 12Z-to-12Z products belong to the U.S. day they start on (shift back 6 h so a 01Z update still counts as the previous evening).
  const convDay = start => isoDay(start - 6 * 3600000);
  const SPC_CAT = { 2: [0, 'Thunderstorms', 'General thunder', 'THUNDERSTORMS'], 3: [1, 'Severe storms', '1/5 Marginal', '1/5 MARGINAL SEVERE'], 4: [2, 'Severe storms', '2/5 Slight', '2/5 SLIGHT SEVERE'],
    5: [3, 'Severe storms', '3/5 Enhanced', '3/5 ENHANCED SEVERE'], 6: [4, 'Severe storms', '4/5 Moderate', '4/5 MODERATE SEVERE'], 8: [5, 'Severe storms', '5/5 High', '5/5 HIGH SEVERE'] };
  const ERO_TXT = { 1: [1, '1/4 Marginal'], 2: [2, '2/4 Slight'], 3: [4, '3/4 Moderate'], 4: [5, '4/4 High'] };
  const SNOW_TXT = { 1: [1, '10-39% chance of 4+ in', 'SNOW 4"+ 10-39%'], 2: [3, '40-69% chance of 4+ in', 'SNOW 4"+ 40-69%'], 3: [4, '70%+ chance of 4+ in', 'SNOW 4"+ 70%+'] };
  // WPC/CPC hazards colors from the service renderer; "Critical Wildfire Risk" is black there, which vanishes on a dark basemap, so it is drawn orange.
  const CPC_COLORS = { 'Frost/Freeze': '#C500FF', 'Hazardous Heat': '#A80000', 'Excessive Heat': '#A80000', 'Hazardous Cold': '#005CE6', 'High Winds': '#CDAA66', 'Significant Waves': '#FFD37F',
    'Much Above Normal Temperatures': '#FF0000', 'Much Below Normal Temperatures': '#005CE6', 'Flooding Likely': '#DF73FF', 'Flooding Occurring or Imminent': '#9B30D9', 'Flooding Possible': '#E8BEFF',
    'Freezing Rain': '#FF00C5', 'Heavy Ice': '#FF00C5', 'Heavy Precipitation': '#00E6A9', 'Heavy Rain': '#38A800', 'Heavy Snow': '#0084A8', 'Severe Weather': '#E69800',
    'Critical Wildfire Risk': '#FF6A00', 'Severe Drought': '#A0522D', 'Rapid Onset Drought Risk': '#FFD37F' };
  const CPC_LEVEL = { 'Flooding Possible': 1, 'Flooding Likely': 3, 'Flooding Occurring or Imminent': 4, 'Critical Wildfire Risk': 3 };
  const HZ_SOURCES = [
    { id: 'spc', name: 'SPC convective outlooks', short: 'SPC', range: 'Days 1-8', attribution: 'NOAA / NWS Storm Prediction Center',
      layers: [[1, 1], [9, 2], [17, 3], [21, 4], [22, 5], [23, 6], [24, 7], [25, 8]].map(([l, d]) => ({ url: SPC + '/' + l, day: d, fields: 'dn,label,label2,stroke,fill,valid,expire,issue' })),
      norm(p, L) {
        const start = spcTime(p.valid); if (!p.fill || p.dn == null) return null;
        let level, hazard, detail, legend;
        if (L.day <= 3) { const c = SPC_CAT[p.dn]; if (!c) return null; [level, hazard, detail, legend] = c; }
        else { const pct = Math.round(+p.dn) || parseInt(p.label2, 10) || 0; level = pct >= 30 ? 3 : 2; hazard = 'Severe storms'; detail = pct + '% chance'; legend = pct + '% SEVERE'; }
        return { hazard, detail, legend, level, fill: p.fill, stroke: p.stroke || p.fill, start, end: spcTime(p.expire), issued: spcTime(p.issue) };
      } },
    { id: 'ero', name: 'WPC Excessive Rainfall Outlook', short: 'WPC ERO', range: 'Days 1-5', attribution: 'NOAA / NWS Weather Prediction Center',
      layers: [0, 1, 2, 3, 4].map(l => ({ url: WPC + '/hazards/wpc_precip_hazards/MapServer/' + l, day: l + 1, fields: 'dn,outlook,start_time,end_time,issue_time' })),
      norm(p) {
        const c = ERO_TXT[p.dn], k = ERO_COLORS[p.dn]; if (!c) return null;
        return { hazard: 'Flash flooding', detail: c[1], legend: c[1].toUpperCase() + ' FLOOD', level: c[0], fill: k[0], stroke: k[1], start: wpcTime(p.start_time), end: wpcTime(p.end_time), issued: wpcTime(p.issue_time) };
      } },
    { id: 'snow', name: 'WPC snowfall probability', short: 'WPC snow', range: 'Days 1-3', attribution: 'NOAA / NWS Weather Prediction Center',
      layers: [[1, 1], [6, 2], [11, 3]].map(([l, d]) => ({ url: WPC + '/precip/wpc_prob_winter_precip/MapServer/' + l, day: d, fields: 'dn,outlook,start_time,end_time,issue_time' })),
      norm(p) {
        const c = SNOW_TXT[Math.round(p.dn)]; if (!c) return null;
        return { hazard: 'Heavy snow', detail: c[1], legend: c[2], level: c[0], fill: SNOW_COLORS[Math.round(p.dn)], stroke: SNOW_COLORS[Math.round(p.dn)], start: wpcTime(p.start_time), end: wpcTime(p.end_time), issued: wpcTime(p.issue_time) };
      } },
    { id: 'wpc37', name: 'WPC Day 3-7 Hazards Outlook', short: 'WPC 3-7', range: 'Days 3-7', attribution: 'NOAA / NWS Weather Prediction Center', span: true,
      layers: [1, 4, 7].map(l => ({ url: WPC + '/hazards/cpc_weather_hazards/MapServer/' + l, day: 3, last: 7, fields: 'label,start_date,end_date,idp_filedate' })),
      norm: p => cpcNorm(p) },
    { id: 'cpc814', name: 'CPC Day 8-14 Hazards Outlook', short: 'CPC 8-14', range: 'Days 8-14', attribution: 'NOAA / NWS Climate Prediction Center', span: true,
      layers: [3, 6, 8].map(l => ({ url: WPC + '/hazards/cpc_weather_hazards/MapServer/' + l, day: 8, last: 14, fields: 'label,start_date,end_date,idp_filedate' })),
      norm: p => cpcNorm(p) }
  ];
  function cpcNorm(p) {
    if (!p.label || p.start_date == null) return null; const col = CPC_COLORS[p.label] || '#9AA7B8';
    return { hazard: p.label, detail: '', legend: p.label.toUpperCase(), level: CPC_LEVEL[p.label] || 2, fill: col, stroke: col, start: +p.start_date, end: +p.end_date, issued: p.idp_filedate || null };
  }
  // Dates a normalized feature applies to. Hazards Outlook dates are 00Z calendar dates with an exclusive end.
  function hzDates(src, n, L, today) {
    if (src.span) { const out = []; for (let t = n.start; t < (n.end > n.start ? n.end : n.start + 1); t += DAY) out.push(isoDay(t)); return out; }
    return [n.start ? convDay(n.start) : isoDay(today + (L.day - 1) * DAY)];
  }
  const HZ_DRAW = ['cpc814', 'wpc37', 'snow', 'ero', 'spc'];   // broad outlooks underneath, detailed short-range ones on top
  const HZ = NS.Hazards = {
    SOURCES: HZ_SOURCES, loaded: null, today: localToday, isoDay,
    async load(force) {
      if (!force && HZ.loaded && Date.now() - HZ.loaded.fetchedAt < 10 * MIN) return HZ.loaded;
      const today = localToday(), feats = [], sources = [];
      await Promise.all(HZ_SOURCES.map(async src => {
        const r = { id: src.id, name: src.name, short: src.short, range: src.range, attribution: src.attribution, dates: new Set(), count: 0, issued: null, errors: [] };
        await Promise.all(src.layers.map(async L => {
          let list;
          try {
            const d = await fetchJSON(L.url + '/query?where=1%3D1&outFields=' + L.fields + '&outSR=4326&maxAllowableOffset=0.01&geometryPrecision=3&f=geojson', 45000);
            list = d.features || [];
          } catch (e) { r.errors.push(e.message); return; }
          let timed = false;
          list.forEach(f => {
            const n = f.geometry && f.properties && src.norm(f.properties, L); if (!n) return;
            const dates = hzDates(src, n, L, today); if (n.start) timed = true;
            if (n.issued && (!r.issued || n.issued > r.issued)) r.issued = n.issued;
            dates.forEach(x => r.dates.add(x)); r.count++;
            feats.push({ type: 'Feature', geometry: f.geometry, properties: Object.assign(n, { src: src.id, srcName: src.short, day: src.span ? src.range : 'Day ' + L.day, dates, color: n.fill, uid: feats.length + 1 }) });
          });
          // Coverage even when a day's product is empty: the day it is valid for.
          if (!timed && !src.span) r.dates.add(isoDay(today + (L.day - 1) * DAY));
        }));
        // Hazards Outlooks: the whole Day 3-7 / 8-14 window, counted from the product's issue date (they are issued on weekdays only).
        if (src.span && (r.count || !r.errors.length)) { const L = src.layers[0], base = r.issued ? Date.parse(isoDay(r.issued) + 'T00:00:00Z') : today; for (let k = L.day; k <= L.last; k++) r.dates.add(isoDay(base + (k - 1) * DAY)); }
        if (r.errors.length === src.layers.length) r.error = r.errors[0];
        r.dates = [...r.dates].sort(); sources.push(r);
      }));
      sources.sort((a, b) => HZ_SOURCES.findIndex(s => s.id === a.id) - HZ_SOURCES.findIndex(s => s.id === b.id));
      if (sources.every(s => s.error)) throw new Error('No outlook service answered (' + sources[0].error + ').');
      feats.forEach(f => { delete f.properties.start; delete f.properties.end; });
      return (HZ.loaded = { fetchedAt: Date.now(), features: feats, sources });
    },
    /* ISO dates [start, start + n) */
    range(startIso, n) { const t = Date.parse(startIso + 'T00:00:00Z'); return Array.from({ length: n }, (_, i) => isoDay(t + i * DAY)); },
    dayIndex(iso) { return Math.round((Date.parse(iso + 'T00:00:00Z') - localToday()) / DAY) + 1; },
    matches(f, dates, o) {
      o = o || {}; const p = f.properties;
      return (!o.sources || o.sources.includes(p.src)) && (o.thunder || p.level > 0) && p.dates.some(d => dates.includes(d));
    },
    /* GeoJSON for the given days, drawn broad-to-detailed then low-to-high risk. */
    build(dates, o) {
      const L = HZ.loaded; if (!L) throw new Error('Hazard outlooks are not loaded.');
      return FC(L.features.filter(f => HZ.matches(f, dates, o)).sort((a, b) => HZ_DRAW.indexOf(a.properties.src) - HZ_DRAW.indexOf(b.properties.src) || a.properties.level - b.properties.level)
        .map(f => ({ type: 'Feature', geometry: f.geometry, properties: Object.assign({}, f.properties, { dates: f.properties.dates.join(',') }) })));
    },
    /* One day's overview: distinct hazards (highest risk first) and which products reach that day. */
    summary(iso, o) {
      const L = HZ.loaded, seen = new Map();
      L.features.filter(f => HZ.matches(f, [iso], o)).forEach(f => {
        const p = f.properties, k = p.src + '|' + p.hazard + '|' + p.detail;
        if (!seen.has(k)) seen.set(k, { hazard: p.hazard, detail: p.detail, level: p.level, color: p.fill, src: p.src, srcName: p.srcName });
      });
      const items = [...seen.values()].sort((a, b) => b.level - a.level || a.hazard.localeCompare(b.hazard));
      const covered = L.sources.filter(s => !s.error && (!o || !o.sources || o.sources.includes(s.id)) && s.dates.includes(iso)).map(s => s.short);
      return { iso, day: HZ.dayIndex(iso), items, covered };
    }
  };

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
      id: 'hazards-outlook', group: 'Forecast', name: 'Week-ahead hazards (selected days)', mode: 'geojson', style: { color: '#F2B53D', kind: 'poly', perFeatureColor: true },
      supplies: 'Official outlook polygons for chosen calendar days: SPC convective (Days 1-8), WPC Excessive Rainfall (Days 1-5), WPC snow probability (Days 1-3), WPC Day 3-7 and CPC Day 8-14 Hazards Outlooks.',
      attribution: 'NOAA / NWS (SPC, WPC, CPC outlooks)', updateFreq: 'SPC/WPC several times daily; Hazards Outlooks weekdays ~17Z; refresh manually', staleAfter: 12 * 3600000,
      limitations: 'Choose the days in Week-Ahead Hazards (the days are stored with the graphic). Days beyond Day 8 only have the broad CPC Day 8-14 outlook. Check issue times on the SPC/WPC/CPC sites before publishing. Snapshot is frozen when fetched; press Refresh to update.',
      async fetch(cfg) {
        if (!cfg || !cfg.dates || !cfg.dates.length) throw new Error('No days selected. Create this graphic from Week-Ahead Hazards.');
        await NS.Hazards.load(true);
        return NS.Hazards.build(cfg.dates, cfg);
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
