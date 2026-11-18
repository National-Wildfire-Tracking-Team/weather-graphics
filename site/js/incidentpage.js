/* Incident pages: when the same incident is detected by two or more independent sources, it gets its own page at #/incident/<key>.
   Correlation (NS.IncidentPages.build):
     - Fire records (NIFC WFIGS, CAL FIRE, InciWeb; prescribed burns excluded) are joined when their normalized names match, the states
       agree and, when both have coordinates, they are within MATCH_KM of each other.
     - Evacuation items (NWS, IPAWS/WEA, Cal OES) attach when their text names the incident ("<Name> Fire" / "<Name> Complex") and the
       states agree. Social posts (Bluesky, Mastodon) attach the same way, only if posted after the incident was discovered; they count
       as one "social" source (roundup posts naming 2+ incidents, or posts restating NIFC/CAL FIRE/InciWeb data, do not count) and stay labeled unverified.
     - A page is created once a cluster has >= 2 distinct sources. Pages persist in localStorage (browser-local, PAGES_KEY) with a
       snapshot, so they stay readable after the incident drops out of the feeds. Every figure on a page is attributed to its source;
       values from different sources are shown side by side, never merged or averaged. */
(function () {
  const { h, toast } = NS.ui;
  const I = NS.Incidents, PAGES_KEY = 'nsgs.incidentPages.v1', MATCH_KM = 50, MAX_PAGES = 60, KEEP_DAYS = 30, HOUR = 3600000;
  const FIRE_SRCS = ['wfigs', 'calfire', 'inciweb'], EVAC_SRCS = ['nws-evac', 'ipaws', 'caloes'], SOCIAL_SRCS = ['bluesky', 'mastodon'];

  const norm = n => String(n || '').replace(/^[A-Z]{2}[A-Z0-9]{3,4}\s+(?=\S)/, '').toLowerCase()
    .replace(/\b(wild)?fires?\b|\bcomplex\b|\bincident\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const codeLike = n => !n || n.length < 3 || /^[a-z]{1,5} ?\d+$/.test(n) || /^\d+$/.test(n) || /^(unnamed|unknown|new)$/.test(n);
  const isRx = x => /prescribed|\brx\b|pile burn|burning$/i.test((x.name || '') + ' ' + (x.type || ''));
  const km = (a, b) => { const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const q = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2; return 12742 * Math.asin(Math.sqrt(q)); };
  const hasXY = x => x.lat != null && x.lon != null && isFinite(x.lat) && isFinite(x.lon);
  const title = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentionRe = base => new RegExp('\\b' + base.split(' ').map(esc).join('[\\s-]+') + '[\\s-]+(fire|complex)\\b', 'i');
  const RESTATES = /\b(data|source|via)\s*:?\s*(nifc|wfigs|irwin|inciweb|cal ?fire)\b/i;   // bots re-posting agency feeds are not independent
  const statesOf = x => x.states && x.states.length ? x.states : x.state ? [x.state] : [];

  /* ---------- correlation ---------- */
  function build(data) {
    const recs = FIRE_SRCS.flatMap(id => (data[id] || []).filter(x => !isRx(x)).map(x => Object.assign({ base: norm(x.name) }, x))).filter(x => !codeLike(x.base));
    const groups = new Map();
    recs.forEach(x => { const k = x.base + '|' + (x.state || ''); (groups.get(k) || groups.set(k, []).get(k)).push(x); });
    // InciWeb items sometimes lack a state; let them join a same-name group that has one.
    const clusters = [];
    groups.forEach(list => list.forEach(x => {
      const c = clusters.find(c => c.base === x.base && (c.state === x.state || !c.state || !x.state) && (!hasXY(x) || !c.fires.some(hasXY) || c.fires.some(f => hasXY(f) && km(f, x) <= MATCH_KM)));
      if (c) { c.fires.push(x); c.state = c.state || x.state; } else clusters.push({ base: x.base, state: x.state, fires: [x] });
    }));
    const evac = EVAC_SRCS.flatMap(id => data[id] || []), posts = [...new Map(SOCIAL_SRCS.flatMap(id => data[id] || []).map(p => [p.id, p])).values()];   // one post can match several search terms
    clusters.forEach(c => {
      const by = s => c.fires.find(f => f.src === s), w = by('wfigs'), cf = by('calfire'), iw = by('inciweb');
      c.name = cf ? cf.name : iw ? iw.name.replace(/^[A-Z]{2}[A-Z0-9]{3,4}\s+/, '') : title(w.name) + (/fire$/i.test(w.name) ? '' : ' Fire');
      if (!/fire|complex/i.test(c.name)) c.name += ' Fire';
      c.county = (cf && cf.county) || (w && w.county) || '';
      const xy = c.fires.find(hasXY); c.lat = xy ? +xy.lat : null; c.lon = xy ? +xy.lon : null;
      c.firstSeen = Math.min(...c.fires.map(f => f.start || f.updated || Infinity)); if (!isFinite(c.firstSeen)) c.firstSeen = null;
      c.evac = []; c.social = [];
    });
    // Evacuation items and posts attach by naming the incident. When several clusters share that name, the item must also name the
    // cluster's county (or, for posts, its state); if it still fits more than one, it is attached to none rather than guessed.
    const byBase = new Map(); clusters.forEach(c => (byBase.get(c.base) || byBase.set(c.base, []).get(c.base)).push(c));
    const STATE_FULL = Object.fromEntries(Object.entries(NS.Incidents.STATE_NAMES).map(([n, a]) => [a, n]));
    const names = (c, social) => [c.county, ...(social ? [STATE_FULL[c.state]] : [])].filter(Boolean).map(n => new RegExp('\\b' + esc(n) + '\\b', 'i'));
    const hits = new Map();   // post id -> number of incidents it names; roundup posts (2+) do not count as a source
    function assign(item, text, ok, social) {
      byBase.forEach((cs, base) => {
        if (!mentionRe(base).test(text)) return;
        let cand = cs.filter(c => ok(c));
        if (cand.length > 1) cand = cand.filter(c => names(c, social).some(r => r.test(text)));
        if (cand.length === 1) { cand[0][social ? 'social' : 'evac'].push(item); if (social) hits.set(item.id, (hits.get(item.id) || 0) + 1); }
      });
    }
    evac.forEach(e => assign(e, [e.headline, e.text, e.info, e.reason, e.area].join(' '), c => !c.state || !statesOf(e).length || statesOf(e).includes(c.state), false));
    posts.forEach(p => p.time && assign(p, p.text, c => p.time >= (c.firstSeen || 0) - HOUR, true));
    clusters.forEach(c => {
      const w = c.fires.find(f => f.src === 'wfigs'), cf = c.fires.find(f => f.src === 'calfire'), iw = c.fires.find(f => f.src === 'inciweb');
      c.social.sort((a, b) => b.time - a.time); c.social.forEach(p => { p.roundup = hits.get(p.id) >= 2 || RESTATES.test(p.text); });
      c.sources = [...new Set([...c.fires.map(f => f.src), ...c.evac.map(e => e.src), ...(c.social.some(p => !p.roundup) ? ['social'] : [])])];
      c.updated = Math.max(0, ...c.fires.map(f => f.updated || f.start || 0), ...c.evac.map(e => e.updated || 0));
      c.key = (w && w.ref ? w.ref.toLowerCase() : cf ? 'calfire-' + String(cf.id).split(':').pop().slice(0, 8) : 'inciweb-' + String(iw.url || iw.name).split('/').filter(Boolean).pop()).replace(/[^a-z0-9-]+/gi, '-');
      c.aliases = [...c.fires.map(f => f.id)];
    });
    return clusters;
  }

  /* ---------- page registry (browser-local) ---------- */
  function readReg() { try { return JSON.parse(localStorage.getItem(PAGES_KEY)) || { pages: {} }; } catch (e) { return { pages: {} }; } }
  function writeReg(reg) {
    const keys = Object.keys(reg.pages).sort((a, b) => reg.pages[b].updatedAt - reg.pages[a].updatedAt);
    keys.forEach((k, i) => { if (i >= MAX_PAGES || Date.now() - reg.pages[k].updatedAt > KEEP_DAYS * 24 * HOUR) delete reg.pages[k]; });
    for (let n = 0; n < 5; n++) {
      try { localStorage.setItem(PAGES_KEY, JSON.stringify(reg)); return; } catch (e) {   // quota: drop the oldest page and retry
        const old = Object.keys(reg.pages).sort((a, b) => reg.pages[a].updatedAt - reg.pages[b].updatedAt)[0]; if (!old) return; delete reg.pages[old];
      }
    }
  }
  const clip = (s, n) => s && s.length > n ? s.slice(0, n) + '…' : s;
  const snapshot = c => ({ name: c.name, state: c.state, county: c.county, lat: c.lat, lon: c.lon, firstSeen: c.firstSeen, updated: c.updated, sources: c.sources,
    fires: c.fires.map(f => Object.assign({}, f)), evac: c.evac.slice(0, 20).map(e => Object.assign({}, e, { text: clip(e.text, 1500), info: clip(e.info, 600), zones: e.zones && e.zones.slice(0, 60) })),
    social: c.social.slice(0, 25).map(p => Object.assign({}, p, { text: clip(p.text, 400) })) });
  const findEntry = (reg, c) => reg.pages[c.key] || Object.values(reg.pages).find(p => p.aliases.some(a => c.aliases.includes(a)));

  const P = NS.IncidentPages = { live: new Map(), MATCH_KM, build, norm,
    update(data) {
      const reg = readReg(), created = [], now = Date.now(); P.live = new Map();
      build(data).forEach(c => {
        let e = findEntry(reg, c);
        if (!e && c.sources.length < 2) return;
        if (!e) { e = reg.pages[c.key] = { key: c.key, createdAt: now, aliases: [], seenBy: {} }; created.push(c); }
        c.key = e.key; e.aliases = [...new Set([...e.aliases, ...c.aliases])].slice(-30); e.updatedAt = now; e.liveAt = now;
        c.sources.forEach(s => { if (!e.seenBy[s]) e.seenBy[s] = now; });
        e.snap = snapshot(c); P.live.set(e.key, c);
      });
      writeReg(reg); P.reg = reg;
      return created;
    },
    list() { return Object.values((P.reg = P.reg || readReg()).pages).sort((a, b) => (b.liveAt || 0) - (a.liveAt || 0) || b.updatedAt - a.updatedAt); },
    get(key) { const reg = P.reg = P.reg || readReg(); return reg.pages[key] || Object.values(reg.pages).find(p => p.aliases.includes(key)); },
    pageFor(recordId) { return P.list().find(p => p.aliases.includes(recordId)); },
    remove(key) { const reg = readReg(); delete reg.pages[key]; writeReg(reg); P.reg = reg; P.live.delete(key); }
  };

  /* ---------- page view ---------- */
  const srcName = id => id === 'social' ? 'Social (unverified)' : (I.srcById(id) || {}).short || id;
  const fmtPlace = c => [c.county && c.county + ' County', c.state].filter(Boolean).join(', ');

  function summaryText(c) {
    const lines = [c.name.toUpperCase() + (fmtPlace(c) ? ' (' + fmtPlace(c) + ')' : '')];
    c.fires.filter(f => f.src !== 'inciweb').forEach(f => lines.push(srcName(f.src) + ': ' + [f.acres != null ? I.fmt.acres(f.acres) : null, f.contained != null ? f.contained + '% contained' : null].filter(Boolean).join(', ') + (f.updated ? ' (updated ' + I.fmt.when(f.updated) + ')' : '')));
    c.evac.forEach(e => lines.push(I.evacVerb(e) + ': ' + e.headline + ' (' + srcName(e.src) + ', ' + I.fmt.when(e.updated) + ')'));
    lines.push('Sources: ' + c.sources.filter(s => s !== 'social').map(srcName).join(', ') + '. Confirm with the incident agency before air.');
    return lines.join('\n');
  }

  async function perimeter(c) {
    const w = c.fires.find(f => f.src === 'wfigs' && f.ref); if (!w) return null;
    const q = new URLSearchParams({ where: "attr_UniqueFireIdentifier='" + w.ref.replace(/'/g, "''") + "'", outFields: 'poly_IncidentName,poly_GISAcres,poly_DateCurrent', outSR: '4326', geometryPrecision: '5', f: 'geojson' });
    const r = await fetch('https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?' + q);
    if (!r.ok) throw new Error('HTTP ' + r.status + ' from NIFC perimeters');
    const d = await r.json(); return d.features && d.features.length ? d : null;
  }
  function extentOf(fc, c, minSpan) {   // minSpan in degrees: tight for the preview map, wider for broadcast graphics
    let w = 180, s = 90, e = -180, n = -90;
    const walk = a => { if (typeof a[0] === 'number') { w = Math.min(w, a[0]); e = Math.max(e, a[0]); s = Math.min(s, a[1]); n = Math.max(n, a[1]); } else a.forEach(walk); };
    if (fc) fc.features.forEach(f => f.geometry && walk(f.geometry.coordinates)); else if (c.lat != null) walk([c.lon, c.lat]);
    const ms = minSpan || 0.6, dx = Math.max(ms - (e - w), 0) / 2 + (e - w) * 0.25, dy = Math.max(ms * 0.66 - (n - s), 0) / 2 + (n - s) * 0.25;
    return [[w - dx, s - dy], [e + dx, n + dy]];
  }

  NS.IncidentPageView = async function (key) {
    key = decodeURIComponent(key || '');
    const root = h('div', { class: 'incidents incpage' }), body = h('div', { id: 'ipBody' }), status = h('p', { class: 'hint', id: 'ipStatus' });
    root.append(h('a', { class: 'btn sm', href: '#/incidents', id: 'ipBack' }, '← Incident Detection'), status, body);
    const st = { per: undefined, perErr: '', map: null };

    function draw() {
      const entry = P.get(key), live = entry && P.live.get(entry.key), c = live || (entry && entry.snap);
      if (!c) { body.replaceChildren(h('h1', {}, 'Incident page not found'), h('div', { class: 'empty' }, I.cache.at ? 'No incident page with this ID. Pages are created when two or more sources report the same incident, and are kept in this browser for ' + KEEP_DAYS + ' days.' : 'Checking sources…')); return; }
      document.title = c.name + ' · Incident';
      const fires = c.fires.filter(f => f.src !== 'inciweb'), iw = c.fires.filter(f => f.src === 'inciweb');
      const acresSet = new Set(fires.map(f => f.acres).filter(a => a != null).map(a => Math.round(a)));
      body.replaceChildren(...[
        h('h1', { id: 'ipName' }, c.name),
        h('div', { class: 'row', style: 'flex-wrap:wrap;margin-bottom:10px' }, fmtPlace(c) ? h('b', {}, fmtPlace(c)) : null,
          c.sources.map(s => h('span', { class: 'tag' + (s === 'social' ? ' warn' : ''), 'data-src': s }, srcName(s))),
          live ? h('span', { class: 'tag ok', id: 'ipLive' }, 'LIVE · ' + c.sources.length + ' sources') : h('span', { class: 'tag warn', id: 'ipLive' }, 'Snapshot ' + NS.ui.fmtDate(entry.updatedAt) + ' · no longer in the feeds'),
          h('span', { class: 'hint' }, 'First report ' + I.fmt.when(c.firstSeen) + ' · page created ' + NS.ui.fmtDate(entry.createdAt) + ' · last update ' + I.fmt.ago(c.updated))),
        h('div', { class: 'bar' },
          h('button', { class: 'btn', id: 'ipCopy', onclick: () => I.copy(summaryText(c)) }, 'Copy summary'),
          h('button', { class: 'btn primary', id: 'ipGraphic', disabled: !st.per, title: st.per ? 'Create an editable map graphic of the NIFC perimeter' : 'Needs a mapped NIFC perimeter', onclick: () => makeGraphic(c) }, 'Make map graphic'),
          iw.map(x => h('a', { class: 'btn sm', href: x.url, target: '_blank', rel: 'noopener' }, 'InciWeb ↗')),
          fires.filter(f => f.url).map(f => h('a', { class: 'btn sm', href: f.url, target: '_blank', rel: 'noopener' }, srcName(f.src) + ' ↗')),
          h('a', { class: 'btn sm', id: 'ipFbSearch', href: 'https://www.facebook.com/search/posts?q=' + encodeURIComponent(c.name + (c.county ? ' ' + c.county : '')), target: '_blank', rel: 'noopener', title: 'Search public Facebook posts (opens Facebook; results are unverified)' }, 'Search Facebook ↗'),
          h('span', { class: 'grow' }), h('button', { class: 'btn sm', id: 'ipDelete', title: 'Remove this page from this browser', onclick: async () => { if (await NS.ui.confirm('Remove incident page', 'Remove the page for ' + c.name + ' from this browser? It is re-created if two sources report it again.', 'Remove', true)) { P.remove(entry.key); location.hash = '#/incidents'; } } }, 'Remove page')),
        h('h2', {}, 'Source reports'),
        h('table', { class: 't inctable', id: 'ipReports' }, h('thead', {}, h('tr', {}, ['Source', 'Reported as', 'Size', 'Contained', 'Discovered', 'Updated', 'Location'].map(x => h('th', {}, x)))),
          h('tbody', {}, c.fires.map(f => h('tr', { 'data-src': f.src }, h('td', {}, h('span', { class: 'tag' }, srcName(f.src))), h('td', {}, f.name, f.ref ? h('div', { class: 'hint' }, f.ref) : null),
            h('td', {}, f.acres != null ? I.fmt.acres(f.acres) : '—'), h('td', {}, f.contained != null ? f.contained + '%' : '—'), h('td', { title: I.fmt.when(f.start) }, f.start ? I.fmt.ago(f.start) : '—'),
            h('td', { title: I.fmt.when(f.updated) }, I.fmt.ago(f.updated)), h('td', {}, [f.county, f.state].filter(Boolean).join(', ') || '—', hasXY(f) ? h('div', { class: 'hint' }, (+f.lat).toFixed(3) + ', ' + (+f.lon).toFixed(3)) : null))))),
        acresSet.size > 1 ? h('p', { class: 'tag warn', id: 'ipDisagree', style: 'white-space:normal;margin-top:6px' }, 'Sources disagree on size. Use the most recently updated official figure and name its source on air.') : null,
        h('h2', {}, 'Map'), mapBlock(c),
        h('h2', {}, 'Evacuations linked to this incident'),
        c.evac.length ? h('div', { class: 'hllist', id: 'ipEvac' }, c.evac.map(e => h('details', { class: 'hlrow' },
          h('summary', {}, h('span', { class: 'tag ' + I.evacTag(e) }, e.status), h('b', { class: 'grow' }, e.headline), h('span', { class: 'hint' }, I.fmt.ago(e.updated)), h('span', { class: 'tag' }, srcName(e.src))),
          h('div', { class: 'incdetail' }, h('div', { class: 'hint' }, [e.area, e.sender, e.expires ? 'until ' + I.fmt.when(e.expires) : ''].filter(Boolean).join(' · ')),
            e.zones ? h('div', {}, 'Zones: ' + e.zones.join(', ')) : null, e.text || e.info ? h('pre', { class: 'inctext' }, e.text || e.info) : null))))
          : h('div', { class: 'empty', id: 'ipEvac' }, 'No evacuation message from NWS, IPAWS or Cal OES names this incident. Check the county\'s own alerts.'),
        h('h2', {}, 'Timeline'), timeline(c),
        h('h2', {}, 'Social mentions ', h('span', { class: 'tag warn' }, 'UNVERIFIED')),
        c.social.length ? h('ul', { class: 'incsocial', id: 'ipSocial' }, c.social.map(p => h('li', {},
          h('div', { class: 'row' }, h('b', {}, p.author), p.handle ? h('span', { class: 'hint' }, '@' + p.handle) : null, h('span', { class: 'hint' }, I.fmt.ago(p.time)), h('span', { class: 'tag' }, srcName(p.src)), p.roundup ? h('span', { class: 'tag', title: 'Names several incidents or restates agency data; not counted as an independent source' }, 'roundup') : null, h('span', { class: 'grow' }),
            p.url ? h('a', { class: 'btn sm', href: p.url, target: '_blank', rel: 'noopener' }, 'Open ↗') : null), h('div', { class: 'posttext' }, p.text))))
          : h('div', { class: 'empty', id: 'ipSocial' }, 'No Bluesky or Mastodon posts in the current search mention this incident.'),
        h('p', { class: 'hint' }, 'Records were matched by name, state and distance (≤ ' + MATCH_KM + ' km); evacuation and social items by naming the incident. Check that the matches are the same incident before using them.')].filter(Boolean));
    }

    function timeline(c) {
      const ev = [...c.fires.map(f => f.start && { t: f.start, s: f.src, what: 'Discovered (' + srcName(f.src) + ' record: ' + f.name + ')' }),
        ...c.fires.filter(f => f.src === 'inciweb').map(f => f.updated && { t: f.updated, s: f.src, what: 'InciWeb page updated' }),
        ...c.evac.map(e => e.updated && { t: e.updated, s: e.src, what: I.evacVerb(e) + ': ' + e.headline }),
        ...c.social.slice(0, 1).map(p => ({ t: c.social[c.social.length - 1].time, s: 'social', what: 'First social mention (' + c.social.length + ' posts so far)' }))].filter(Boolean).sort((a, b) => a.t - b.t);
      return ev.length ? h('ul', { class: 'incfeed', id: 'ipTimeline' }, ev.map(e => h('li', { class: /nws|ipaws|caloes/.test(e.s) ? 'evac' : '' }, h('span', { class: 'when', style: 'width:130px' }, I.fmt.when(e.t)), h('span', { class: 'grow' }, e.what), h('span', { class: 'tag' + (e.s === 'social' ? ' warn' : '') }, srcName(e.s)))))
        : h('div', { class: 'empty' }, 'No timed events.');
    }

    function mapBlock(c) {
      const box = h('div', { id: 'incMap', class: 'incmap' });
      if (c.lat == null) { box.append(h('div', { class: 'empty' }, 'No source gives coordinates for this incident.')); return box; }
      if (!NS.config.token || !window.mapboxgl) { box.append(h('div', { class: 'empty' }, 'Add a Mapbox token (Brand Settings) to show the map. Location: ' + c.lat.toFixed(3) + ', ' + c.lon.toFixed(3))); return box; }
      const note = h('div', { class: 'hint', id: 'ipPerNote' }, st.per === undefined ? 'Looking up the NIFC perimeter…' : st.per ? 'Perimeter: NIFC / WFIGS' + (st.per.features[0].properties.poly_GISAcres ? ', ' + I.fmt.acres(st.per.features[0].properties.poly_GISAcres) + ' mapped' : '') : st.perErr ? 'Perimeter lookup failed: ' + st.perErr : 'No mapped perimeter yet; showing reported points.');
      const el = h('div', { class: 'incmapgl' }); box.append(el, note);
      setTimeout(() => {
        if (st.map) { try { st.map.remove(); } catch (e) {} }
        mapboxgl.accessToken = NS.config.token;
        const m = st.map = new mapboxgl.Map({ container: el, style: NS.config.style || 'mapbox://styles/mapbox/dark-v11', bounds: extentOf(st.per, c, 0.12), fitBoundsOptions: { padding: 30 }, projection: 'mercator', attributionControl: true });
        m.on('load', () => {
          if (st.per) { m.addSource('per', { type: 'geojson', data: st.per }); m.addLayer({ id: 'per-fill', type: 'fill', source: 'per', paint: { 'fill-color': '#F2453D', 'fill-opacity': 0.45 } }); m.addLayer({ id: 'per-line', type: 'line', source: 'per', paint: { 'line-color': '#F2453D', 'line-width': 1.5 } }); }
          const pts = c.fires.filter(hasXY).map(f => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [+f.lon, +f.lat] }, properties: { src: srcName(f.src) } }));
          m.addSource('pts', { type: 'geojson', data: { type: 'FeatureCollection', features: pts } });
          m.addLayer({ id: 'pts', type: 'circle', source: 'pts', paint: { 'circle-radius': 6, 'circle-color': '#F2B53D', 'circle-stroke-color': '#000', 'circle-stroke-width': 1 } });
          m.addLayer({ id: 'pts-label', type: 'symbol', source: 'pts', layout: { 'text-field': ['get', 'src'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-allow-overlap': false }, paint: { 'text-color': '#E8EDF3', 'text-halo-color': '#000', 'text-halo-width': 1 } });
        });
        m.on('error', e => console.warn('Incident map:', e && e.error && e.error.message));
      }, 0);
      return box;
    }

    async function makeGraphic(c) {
      const b = document.getElementById('ipGraphic'); if (b) { b.disabled = true; b.textContent = 'Building…'; }
      try {
        const brand = await NS.getBrand(), w = c.fires.find(f => f.src === 'wfigs'), pa = st.per.features[0].properties.poly_GISAcres;
        const p = await NS.Templates.alertGraphic(brand, { title: c.name.toUpperCase(), subtitle: [fmtPlace(c), pa ? I.fmt.acres(pa) + ' mapped' : null, w && w.contained != null ? w.contained + '% contained' : null].filter(Boolean).join(' · '),
          accent: '#F2453D', style: NS.config.style ? 'broadcast' : 'dark', extent: extentOf(st.per, c), projection: 'mercator', layerId: 'nifc-fire', layerCfg: {}, data: st.per,
          source: 'NIFC / WFIGS Interagency Fire Perimeters', category: 'news', templateId: 'incident-perimeter', asOf: I.cache.at || Date.now() });
        p.name = c.name + ' perimeter'; await NS.App.createProject(p);
      } catch (e) { toast('Could not create the graphic: ' + e.message, 'err', 9000); if (b) { b.disabled = false; b.textContent = 'Make map graphic'; } }
    }

    async function refresh(force) {
      const stale = !I.cache.at || Date.now() - I.cache.at > 5 * 60000;
      if (force || stale) { status.textContent = 'Checking sources…'; await I.loadAll(); }
      status.textContent = I.cache.at ? 'Sources checked ' + new Date(I.cache.at).toLocaleTimeString() + '. ' : '';
      status.append(h('button', { class: 'btn sm', id: 'ipRefresh', onclick: () => refresh(true) }, 'Refresh'));
      const entry = P.get(key), c = entry && (P.live.get(entry.key) || entry.snap);
      if (c && st.per === undefined) { try { st.per = await perimeter(c); } catch (e) { st.per = null; st.perErr = e.message; } }
      draw();
    }
    const timer = setInterval(() => { if (!root.isConnected) { clearInterval(timer); if (st.map) try { st.map.remove(); } catch (e) {} } }, 2000);
    draw(); refresh(false);
    return root;
  };
})();
