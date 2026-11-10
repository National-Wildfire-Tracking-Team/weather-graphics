/* Incident Detection tab: a live watch desk for new wildfires, evacuations and social chatter, built only from free public feeds.
   Verified sources: NIFC WFIGS incident locations, CAL FIRE incidents, InciWeb, NWS evacuation/civil alerts,
   FEMA IPAWS state/local alerts (the WEA messages PBS WARN relays, via the OpenFEMA archive), Cal OES evacuation zones.
   Unverified signals: Bluesky post search and Mastodon hashtag timelines (no keys needed). Social posts are never merged into the
   verified feed; they are shown separately, labeled unverified, and only cross-referenced to incident names.
   Nothing is invented: a failed source shows its error, an empty source says so. Sources live in NS.Incidents.SOURCES. */
(function () {
  const { h, toast } = NS.ui;
  const HOUR = 3600000, MAXROWS = 100, AUTO_MS = 5 * 60000, LS = 'nsgs.incidents.v1';
  const NWS_EVAC_EVENTS = ['Evacuation Immediate', 'Fire Warning', 'Shelter In Place Warning', 'Civil Emergency Message', 'Civil Danger Warning', 'Local Area Emergency', 'Law Enforcement Warning', 'Hazardous Materials Warning'];
  const STATE_NAMES = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'Puerto Rico': 'PR' };
  const FIPS = { '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY', '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR', '78': 'VI' };
  // IPAWS (the system PBS WARN relays to phones as Wireless Emergency Alerts): which messages count as evacuations.
  const IPAWS_EVAC_CODES = ['EVI', 'SPW', 'FRW'], IPAWS_TEST_CODES = ['RWT', 'RMT', 'DMO', 'NPT', 'NMN', 'ADR'];
  const EVAC_TEXT = /evacuat|shelter[- ]in[- ]place|leave (the area )?(now|immediately)|evacuaci[oó]n|evacuar|refugio en el lugar/i;
  const LIFTED_TEXT = /\b(lifted|all clear|rescinded|cancell?ed|may return|allowed to return|repopulat)/i;
  const evacVerb = x => LIFTED_TEXT.test(x.status) ? 'Evacuation lifted' : /order|immediate/i.test(x.status) ? 'Evacuation order' : /warning|prepare|ready/i.test(x.status) && /evac/i.test(x.status) ? 'Evacuation warning' : x.status;
  const evacTag = x => LIFTED_TEXT.test(x.status) ? 'ok' : /order|immediate|shelter/i.test(x.status) ? 'err' : 'warn';
  const DEFAULT_TERMS = ['wildfire', 'evacuation order', 'brush fire', 'evacuation warning'];
  const DEFAULT_TAGS = ['wildfire', 'evacuation', 'calfire'];

  async function get(url, ms, kind) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 25000);
    const host = new URL(url, location.href).host;
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' from ' + host);
      if (kind === 'text') return await r.text();
      const ct = r.headers.get('content-type') || '';
      if (!/json/.test(ct)) throw new Error('Unexpected response from ' + host);
      return await r.json();
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'Timed out contacting ' + host : (e.message === 'Failed to fetch' ? 'Could not reach ' + host + ' (network or CORS)' : e.message || 'Network error'));
    } finally { clearTimeout(t); }
  }
  const ms = v => v == null || v === '' ? null : (typeof v === 'number' ? v : (isNaN(Date.parse(v)) ? null : Date.parse(v)));
  // Social HTML (Mastodon) -> plain text. DOMParser documents never run scripts; script/style text is dropped too.
  const htmlText = s => { const b = new DOMParser().parseFromString('<body>' + (s || '').replace(/<br\s*\/?>|<\/p>/gi, ' ') + '</body>', 'text/html').body;
    b.querySelectorAll('script,style').forEach(e => e.remove()); return b.textContent.replace(/\s+/g, ' ').trim(); };
  const ugcState = u => /^[A-Z]{2}[CZ]\d{3}$/.test(u) ? u.slice(0, 2) : null;
  const ago = t => { if (!t) return '—'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 48 * 60 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  const fmt = t => t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  const fireName = n => /fire$|\d{3,}|\//i.test(n) ? n : n + ' Fire'; // leave dispatch codes (LAC-406202) alone
  const acres = a => a == null ? '—' : (a < 10 ? (+a).toFixed(1).replace(/\.0$/, '') : Math.round(a).toLocaleString()) + ' ac';

  /* ---------- sources ---------- */
  const WFIGS = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query';
  const CALOES = 'https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/CA_EVACUATIONS_CalOESHosted_view/FeatureServer/0/query';
  // CAL FIRE sends no CORS headers, so the browser cannot read it directly. site/_redirects proxies /proxy/calfire/* on Netlify.
  const CALFIRE_PATH = '/umbraco/api/IncidentApi/List?inactive=false';
  const SOURCES = [
    { id: 'wfigs', kind: 'fire', name: 'NIFC WFIGS incidents', short: 'NIFC', home: 'https://data-nifc.opendata.arcgis.com/', verified: true,
      about: 'Current interagency wildfire incident points (IRWIN), nationwide, updated every few minutes.',
      async load() {
        const q = new URLSearchParams({ where: "IncidentTypeCategory='WF'", outFields: 'IncidentName,IncidentSize,PercentContained,POOState,POOCounty,FireDiscoveryDateTime,ModifiedOnDateTime_dt,UniqueFireIdentifier,TotalIncidentPersonnel,FireCause',
          returnGeometry: 'true', outSR: '4326', orderByFields: 'FireDiscoveryDateTime DESC', resultRecordCount: '2000', f: 'geojson' });
        const d = await get(WFIGS + '?' + q, 45000);
        return (d.features || []).map(f => { const p = f.properties || {}, c = f.geometry && f.geometry.coordinates;
          return { src: 'wfigs', id: 'wfigs:' + (p.UniqueFireIdentifier || p.IncidentName), name: (p.IncidentName || 'Unnamed').trim(), state: String(p.POOState || '').replace(/^US-/, ''), county: p.POOCounty || '',
            acres: p.IncidentSize, contained: p.PercentContained, start: ms(p.FireDiscoveryDateTime), updated: ms(p.ModifiedOnDateTime_dt), personnel: p.TotalIncidentPersonnel, cause: p.FireCause,
            lat: c ? +c[1] : null, lon: c ? +c[0] : null, ref: p.UniqueFireIdentifier }; });
      } },
    { id: 'calfire', kind: 'fire', name: 'CAL FIRE incidents', short: 'CAL FIRE', home: 'https://www.fire.ca.gov/incidents', verified: true,
      about: 'Active incidents from CAL FIRE\'s public incident API (California only).',
      async load() {
        let d, err;
        for (const u of ['/proxy/calfire' + CALFIRE_PATH, 'https://incidents.fire.ca.gov' + CALFIRE_PATH]) {
          try { d = await get(u, 25000); break; } catch (e) { err = err || e; }
        }
        if (!d) throw new Error('CAL FIRE is only reachable through the site\'s /proxy/calfire rewrite (deployed on Netlify). ' + (err ? err.message : ''));
        return (Array.isArray(d) ? d : []).filter(x => x.IsActive !== false).map(x => ({ src: 'calfire', id: 'calfire:' + x.UniqueId, name: x.Name, state: 'CA', county: x.County || '', acres: x.AcresBurned, contained: x.PercentContained,
          start: ms(x.Started), updated: ms(x.Updated), lat: x.Latitude, lon: x.Longitude, url: x.Url, location: x.Location, type: x.Type }));
      } },
    { id: 'inciweb', kind: 'fire', name: 'InciWeb', short: 'InciWeb', home: 'https://inciweb.wildfire.gov/', verified: true,
      about: 'Incidents with an official InciWeb page (larger or longer fires, prescribed burns, closures).',
      async load() {
        const doc = new DOMParser().parseFromString(await get('https://inciweb.wildfire.gov/incidents/rss.xml', 25000, 'text'), 'text/xml');
        if (doc.querySelector('parsererror')) throw new Error('InciWeb returned an unreadable feed');
        return [...doc.querySelectorAll('item')].map(it => { const t = s => (it.querySelector(s) || {}).textContent || '', desc = t('description');
          const st = (desc.match(/State:\s*([A-Za-z .]+?)\s*(?:---|\n|$)/) || [])[1], type = (desc.match(/type of incident is ([^.]+?)\s+and involves/i) || [])[1];
          return { src: 'inciweb', id: 'inciweb:' + t('link'), name: t('title').trim(), state: STATE_NAMES[(st || '').trim()] || '', type: (type || '').trim(), updated: ms(t('pubDate')), url: t('link').replace(/^http:/, 'https:') }; });
      } },
    { id: 'nws-evac', kind: 'evac', name: 'NWS evacuation & civil alerts', short: 'NWS', home: 'https://alerts.weather.gov/', verified: true,
      about: 'Evacuation Immediate, Fire Warning, Shelter In Place and other civil-emergency messages relayed by the NWS.',
      async load() {
        const d = await get('https://api.weather.gov/alerts/active?status=actual&event=' + encodeURIComponent(NWS_EVAC_EVENTS.join(',')), 30000);
        return (d.features || []).map(f => { const p = f.properties || {}, ugc = (p.geocode && p.geocode.UGC) || [];
          return { src: 'nws-evac', id: 'nws:' + (p.id || f.id), name: p.event, status: p.event, headline: p.headline || p.event, area: p.areaDesc || '', states: [...new Set(ugc.map(ugcState).filter(Boolean))],
            updated: ms(p.sent), expires: ms(p.expires), sender: p.senderName, text: [p.description, p.instruction].filter(Boolean).join('\n\n') }; })
          .filter(a => NWS_EVAC_EVENTS.includes(a.status));
      } },
    { id: 'ipaws', kind: 'evac', name: 'FEMA IPAWS alerts (WEA · PBS WARN)', short: 'IPAWS', home: 'https://www.fema.gov/openfema-data-page/ipaws-archived-alerts-v1', verified: true,
      about: 'Wireless Emergency Alerts and EAS messages from state and local alerting authorities via FEMA IPAWS (the alerts PBS WARN relays to phones). Read from the OpenFEMA archive, which runs several hours to about a day behind real time.',
      async load() {
        const since = new Date(Date.now() - 96 * HOUR).toISOString();
        const q = '$top=1000&$orderby=sent%20desc&$select=id,sender,sent,status,msgType,info&$filter=' + encodeURIComponent("sent ge '" + since + "' and status eq 'Actual'");
        const d = await get('https://www.fema.gov/api/open/v1/IpawsArchivedAlerts?' + q, 45000);
        const rows = d.IpawsArchivedAlerts || [], newest = rows.reduce((m, r) => Math.max(m, ms(r.sent) || 0), 0), out = [];
        rows.forEach(r => {
          const infos = r.info || [], i = infos.find(x => /^en/i.test(x.language || '')) || infos[0];
          if (!i || /nws|noaa/i.test((r.sender || '') + (i.senderName || ''))) return; // NWS-issued alerts come from api.weather.gov above
          const codes = (i.eventCode || []).map(c => c.value), par = n => ((i.parameter || []).find(p => p.name === n) || {}).value || '';
          if (codes.some(c => IPAWS_TEST_CODES.includes(c))) return;
          const wea = par('CMAMtext'), long = par('CMAMlongtext'), body = [i.description, i.instruction].filter(Boolean).join('\n\n');
          const all = [i.event, i.headline, wea, long, body].join(' ');
          if (!codes.some(c => IPAWS_EVAC_CODES.includes(c)) && !EVAC_TEXT.test(all)) return;
          const lifted = r.msgType === 'Cancel' || LIFTED_TEXT.test([wea, i.headline, long].join(' '));
          const status = lifted ? 'Evacuation lifted' : codes.includes('EVI') || /evacuation order|evacuate (now|immediately)|leave (the area )?now|mandatory evac/i.test(all) ? 'Evacuation order'
            : codes.includes('SPW') || /shelter[- ]in[- ]place/i.test(all) ? 'Shelter in place' : codes.includes('FRW') ? 'Fire Warning' : /evacuation warning|prepare to evac|voluntary evac/i.test(all) ? 'Evacuation warning' : i.event || 'Evacuation notice';
          const areas = i.area || [], fips = areas.flatMap(a => (a.geocode || []).filter(g => g.name === 'SAME').map(g => String(g.value).padStart(6, '0')));
          out.push({ src: 'ipaws', id: 'ipaws:' + r.id, name: status, status, headline: wea || i.headline || i.event, area: areas.map(a => a.areaDesc).filter(a => a && a !== 'AffectedArea').join('; ') || fips.join(', '),
            states: [...new Set(fips.map(f => FIPS[f.slice(1, 3)]).filter(Boolean))], updated: ms(r.sent), expires: ms(i.expires), sender: i.senderName || r.sender, wea: !!wea,
            text: [long && long !== wea ? long : '', body].filter(Boolean).join('\n\n'), url: i.web || null });
        });
        out.lagHours = newest ? Math.max(0, Math.round((Date.now() - newest) / HOUR)) : null;
        return out;
      } },
    { id: 'caloes', kind: 'evac', name: 'Cal OES evacuation zones', short: 'Cal OES', home: 'https://data.ca.gov/dataset/california-evacuation-aggregation-layer', verified: true,
      about: 'California Active Evacuation Zones (aggregated county Genasys/Zonehaven zones), refreshed about every 10 minutes.',
      async load() {
        const q = new URLSearchParams({ where: 'STATUS IS NOT NULL', outFields: 'COUNTY,CITY,ZONE_NAME,ZONE_ID,STATUS,NOTES,PUBLIC_INFO,EDIT_DATE', returnGeometry: 'false', resultRecordCount: '4000', f: 'json' });
        const d = await get(CALOES + '?' + q, 45000);
        if (d.error) throw new Error('Cal OES: ' + (d.error.message || 'query failed'));
        const groups = new Map();
        (d.features || []).forEach(f => { const a = f.attributes || {}, county = (a.COUNTY || 'Unknown').replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase()), key = county + '|' + a.STATUS + '|' + (a.NOTES || '');
          const g = groups.get(key) || groups.set(key, { src: 'caloes', id: 'caloes:' + key, name: a.STATUS, status: a.STATUS, county, reason: a.NOTES || '', states: ['CA'], zones: [], updated: 0, info: a.PUBLIC_INFO || '' }).get(key);
          g.zones.push(a.ZONE_NAME || a.ZONE_ID); g.updated = Math.max(g.updated, ms(a.EDIT_DATE) || 0); });
        return [...groups.values()].map(g => Object.assign(g, { headline: g.status + ': ' + g.zones.length + ' zone' + (g.zones.length === 1 ? '' : 's') + ' in ' + g.county + ' County' + (g.reason ? ' (' + g.reason + ')' : ''), area: g.county + ' County, CA', updated: g.updated || null }));
      } },
    { id: 'bluesky', kind: 'social', name: 'Bluesky search', short: 'Bluesky', home: 'https://bsky.app/', verified: false,
      about: 'Latest public posts matching your search terms (free public API, no account needed).',
      async load(cfg) {
        const res = await Promise.allSettled(cfg.terms.map(term => get('https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?' + new URLSearchParams({ q: term, sort: 'latest', limit: '25' }), 20000)));
        if (res.every(r => r.status === 'rejected')) throw res[0].reason;
        return res.flatMap((r, i) => r.status === 'fulfilled' ? (r.value.posts || []).map(p => ({ src: 'bluesky', id: 'bsky:' + p.uri, term: cfg.terms[i], author: (p.author && (p.author.displayName || p.author.handle)) || 'unknown',
          handle: p.author && p.author.handle, text: (p.record && p.record.text) || '', time: ms((p.record && p.record.createdAt) || p.indexedAt),
          url: p.author ? 'https://bsky.app/profile/' + p.author.handle + '/post/' + p.uri.split('/').pop() : null })) : []);
      } },
    { id: 'mastodon', kind: 'social', name: 'Mastodon hashtags', short: 'Mastodon', home: 'https://mastodon.social/', verified: false,
      about: 'Public hashtag timelines on mastodon.social (federated posts included; no account needed).',
      async load(cfg) {
        const res = await Promise.allSettled(cfg.tags.map(tag => get('https://mastodon.social/api/v1/timelines/tag/' + encodeURIComponent(tag) + '?limit=20', 20000)));
        if (res.every(r => r.status === 'rejected')) throw res[0].reason;
        return res.flatMap((r, i) => r.status === 'fulfilled' ? (r.value || []).filter(s => s && s.visibility === 'public').map(s => ({ src: 'mastodon', id: 'mast:' + s.uri, term: '#' + cfg.tags[i],
          author: (s.account && (s.account.display_name || s.account.acct)) || 'unknown', handle: s.account && s.account.acct, text: htmlText(s.content), time: ms(s.created_at), url: s.url || s.uri })) : []);
      } }
  ];
  const srcById = id => SOURCES.find(s => s.id === id);
  NS.Incidents = { SOURCES, NWS_EVAC_EVENTS, STATE_NAMES, IPAWS_EVAC_CODES };

  async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch (e) { toast('Clipboard unavailable: ' + e.message, 'err'); } }
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } }
  function savePrefs(p) { try { localStorage.setItem(LS, JSON.stringify(p)); } catch (e) {} }
  const splitList = s => String(s || '').split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean).slice(0, 6);

  NS.IncidentsView = async function () {
    const pref = loadPrefs(), cfg = (NS.config && NS.config.incidents) || {};
    const st = { state: pref.state || '', hours: pref.hours || 24, minAcres: pref.minAcres || 0, sort: 'new', auto: !!pref.auto,
      terms: pref.terms || cfg.socialTerms || DEFAULT_TERMS, tags: pref.tags || cfg.mastodonTags || DEFAULT_TAGS,
      data: {}, err: {}, at: {}, busy: false, seen: null, fresh: new Set(), showAll: false };
    const persist = () => savePrefs({ state: st.state, hours: st.hours, minAcres: st.minAcres, auto: st.auto, terms: st.terms, tags: st.tags });

    const root = h('div', { class: 'incidents' }, h('h1', {}, 'Incident Detection'),
      h('p', { class: 'sub' }, 'New wildfire starts, evacuation orders and social chatter from free public feeds. Verified agency sources are kept separate from unverified social posts. Confirm every detail with the incident agency before going on air.'));
    const bar = h('div', { class: 'bar' }), srcs = h('div', { id: 'incSources', class: 'incsrc' }), feed = h('section', { id: 'incFeed' }), evac = h('section', { id: 'incEvac' }),
      fires = h('section', { id: 'incFires' }), social = h('section', { id: 'incSocial' }), links = h('section', { id: 'incLinks' });
    root.append(bar, srcs, feed, evac, fires, social, links);

    async function load() {
      if (st.busy) return; st.busy = true; drawBar(); drawSources();
      const c = { terms: st.terms, tags: st.tags };
      await Promise.all(SOURCES.map(s => s.load(c).then(d => { st.data[s.id] = d; st.err[s.id] = ''; st.at[s.id] = Date.now(); }, e => { st.data[s.id] = null; st.err[s.id] = e.message || String(e); })));
      // Track what is new since the previous load in this session (first load marks nothing).
      const ids = new Set(SOURCES.filter(s => s.verified).flatMap(s => (st.data[s.id] || []).map(x => x.id)));
      st.fresh = st.seen ? new Set([...ids].filter(i => !st.seen.has(i))) : new Set();
      if (st.seen && st.fresh.size) toast(st.fresh.size + ' new verified item' + (st.fresh.size === 1 ? '' : 's') + ' since the last refresh.', 'ok');
      st.seen = ids; st.busy = false; draw();
    }
    function draw() { drawBar(); drawSources(); drawFeed(); drawEvac(); drawFires(); drawSocial(); drawLinks(); }

    const inState = (x) => !st.state || x.state === st.state || (x.states || []).includes(st.state);
    const sizeOk = x => !st.minAcres || (x.acres || 0) >= st.minAcres;
    const allFires = () => ['wfigs', 'calfire'].flatMap(id => st.data[id] || []);
    const EVAC_SRCS = ['nws-evac', 'ipaws', 'caloes'], allEvac = () => EVAC_SRCS.flatMap(id => st.data[id] || []);

    function drawBar() {
      const states = [...new Set(SOURCES.filter(s => s.verified).flatMap(s => (st.data[s.id] || []).flatMap(x => x.states || [x.state])).filter(s => s && s.length === 2))].sort();
      if (st.state && !states.includes(st.state)) states.push(st.state);
      const sel = (id, label, opts, val, on) => h('label', { class: 'row' }, label + ' ', h('select', { id, 'aria-label': label, onchange: e => on(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l))));
      bar.replaceChildren(
        h('button', { class: 'btn primary', id: 'incRefresh', disabled: st.busy, onclick: load }, st.busy ? 'Checking sources…' : 'Refresh'),
        sel('incState', 'State', [['', 'All states'], ...states.map(s => [s, s])], st.state, v => { st.state = v; persist(); draw(); }),
        sel('incWindow', 'New within', [[1, '1 hour'], [3, '3 hours'], [6, '6 hours'], [12, '12 hours'], [24, '24 hours'], [72, '3 days']], st.hours, v => { st.hours = +v; persist(); draw(); }),
        sel('incSize', 'Fire size', [[0, 'Any size'], [10, '≥ 10 ac'], [100, '≥ 100 ac'], [1000, '≥ 1,000 ac']], st.minAcres, v => { st.minAcres = +v; persist(); draw(); }),
        h('label', { class: 'row', title: 'Re-check every source every 5 minutes while this tab is open' }, h('input', { type: 'checkbox', id: 'incAuto', checked: st.auto, onchange: e => { st.auto = e.target.checked; persist(); } }), 'Auto-refresh (5 min)'));
    }

    function drawSources() {
      srcs.replaceChildren(...SOURCES.map(s => {
        const d = st.data[s.id], e = st.err[s.id];
        const status = e ? 'error' : d ? d.length + (s.kind === 'social' ? ' posts' : s.id === 'caloes' ? ' zone groups' : ' items') + (d.lagHours != null ? ' · ' + d.lagHours + ' h behind' : '') : st.busy ? 'loading…' : 'not loaded';
        return h('div', { class: 'incsrcitem' + (e ? ' err' : ''), 'data-src': s.id, title: e || s.about },
          h('b', {}, s.short), h('span', { class: 'tag' + (e ? ' err' : '') }, status), s.verified ? null : h('span', { class: 'tag warn' }, 'unverified'));
      }));
    }

    /* Unified, verified detection feed: things that started, were issued or were updated inside the window. */
    function drawFeed() {
      const since = Date.now() - st.hours * HOUR, items = [];
      allFires().filter(x => inState(x) && sizeOk(x) && x.start && x.start >= since).forEach(x => items.push({ t: x.start, x, verb: 'New fire', line: fireName(x.name) + ' · ' + [x.county && x.county + ' Co.', x.state].filter(Boolean).join(', ') + (x.acres != null ? ' · ' + acres(x.acres) : '') + (x.contained != null ? ' · ' + x.contained + '% contained' : '') }));
      (st.data.inciweb || []).filter(x => inState(x) && x.updated && x.updated >= since).forEach(x => items.push({ t: x.updated, x, verb: 'InciWeb update', line: x.name + (x.type ? ' · ' + x.type : '') + (x.state ? ' · ' + x.state : '') }));
      allEvac().filter(x => inState(x) && x.updated && x.updated >= since).forEach(x => items.push({ t: x.updated, x, verb: evacVerb(x), line: x.headline, evac: true }));
      items.sort((a, b) => b.t - a.t);
      feed.replaceChildren(h('h2', {}, 'Detection feed', h('span', { class: 'hint' }, ' · verified sources, last ' + (st.hours === 1 ? 'hour' : st.hours + ' hours'))));
      const loaded = SOURCES.some(s => s.verified && st.data[s.id]);
      if (!loaded) { feed.append(h('p', { class: 'hint' }, st.busy ? 'Contacting NIFC, CAL FIRE, InciWeb, NWS, FEMA IPAWS and Cal OES…' : 'No verified source could be loaded. See the source status above.')); return; }
      if (!items.length) { feed.append(h('div', { class: 'empty' }, 'Nothing new' + (st.state ? ' in ' + st.state : '') + ' in this window from the sources that loaded.')); return; }
      const shown = st.showAll ? items : items.slice(0, 40);
      feed.append(h('ul', { class: 'incfeed' }, shown.map(it => {
        const s = srcById(it.x.src), isNew = st.fresh.has(it.x.id);
        return h('li', { class: (it.evac ? 'evac' : 'fire') + (isNew ? ' fresh' : ''), 'data-id': it.x.id },
          h('span', { class: 'when', title: fmt(it.t) }, ago(it.t)), h('span', { class: 'tag ' + (it.evac ? evacTag(it.x) : 'warn') }, it.verb),
          h('span', { class: 'grow' }, it.line), isNew ? h('span', { class: 'tag ok' }, 'NEW') : null, h('span', { class: 'tag' }, s.short),
          it.x.url ? h('a', { class: 'btn sm', href: it.x.url, target: '_blank', rel: 'noopener' }, 'Source ↗') : null,
          h('button', { class: 'btn sm', title: 'Copy headline', onclick: () => copy(it.verb + ': ' + it.line + ' (' + s.short + ', ' + fmt(it.t) + ')') }, 'Copy'));
      })), items.length > 40 && !st.showAll ? h('button', { class: 'btn sm', onclick: () => { st.showAll = true; drawFeed(); } }, 'Show all ' + items.length) : null);
    }

    function drawEvac() {
      evac.replaceChildren(h('h2', {}, 'Evacuations'));
      const errs = EVAC_SRCS.filter(id => st.err[id]).map(id => h('div', { class: 'tag err', style: 'white-space:normal', 'data-src': id }, srcById(id).name + ': ' + st.err[id]));
      evac.append(...errs);
      if (EVAC_SRCS.every(id => !st.data[id])) { if (errs.length < EVAC_SRCS.length) evac.append(h('p', { class: 'hint' }, 'Contacting api.weather.gov, FEMA IPAWS and Cal OES…')); return; }
      const lag = st.data.ipaws && st.data.ipaws.lagHours;
      if (lag != null) evac.append(h('p', { class: 'hint', id: 'incIpawsLag' }, 'IPAWS / WEA (PBS WARN) messages come from FEMA\'s archive, whose newest message is ' + lag + ' h old. Brand-new phone alerts may not appear yet.'));
      const rank = x => evacTag(x) === 'err' ? 0 : evacTag(x) === 'warn' ? 1 : 2;
      const list = allEvac().filter(inState).sort((a, b) => rank(a) - rank(b) || (b.updated || 0) - (a.updated || 0));
      if (!list.length) { evac.append(h('div', { class: 'empty' }, 'No active evacuation alerts or zones' + (st.state ? ' in ' + st.state : '') + ' from the sources that loaded.')); }
      else evac.append(h('div', { class: 'hllist' }, list.map(x => {
        const s = srcById(x.src), old = x.updated && Date.now() - x.updated > 7 * 24 * HOUR;
        return h('details', { class: 'hlrow', 'data-id': x.id },
          h('summary', {}, h('span', { class: 'tag ' + evacTag(x) }, x.status), x.expires && x.expires < Date.now() ? h('span', { class: 'tag', title: 'Expired ' + fmt(x.expires) }, 'expired') : null, x.wea ? h('span', { class: 'tag', title: 'Sent to phones as a Wireless Emergency Alert' }, 'WEA') : null, h('b', { class: 'grow' }, x.headline),
            old ? h('span', { class: 'tag warn', title: 'Last edited ' + fmt(x.updated) + '. Zone may not have been cleared in the aggregate layer; confirm with the county.' }, 'last edited ' + ago(x.updated)) : h('span', { class: 'hint' }, ago(x.updated)),
            h('span', { class: 'tag' }, s.short), h('button', { class: 'btn sm', onclick: e => { e.preventDefault(); copy(x.headline + ' (' + s.short + ')'); } }, 'Copy')),
          h('div', { class: 'incdetail' }, h('div', { class: 'hint' }, x.area + (x.sender ? ' · ' + x.sender : '') + (x.expires ? ' · until ' + fmt(x.expires) : '')),
            x.zones ? h('div', {}, 'Zones: ' + x.zones.slice(0, 40).join(', ') + (x.zones.length > 40 ? ' …+' + (x.zones.length - 40) : '')) : null,
            x.url ? h('a', { class: 'btn sm', href: x.url, target: '_blank', rel: 'noopener', style: 'align-self:flex-start' }, 'Issuer page ↗') : null,
            x.text || x.info ? h('pre', { class: 'inctext' }, (x.text || x.info).slice(0, 2000)) : null));
      })));
      evac.append(h('p', { class: 'hint' }, 'Sources: NWS alerts (' + NWS_EVAC_EVENTS.join(', ') + '), FEMA IPAWS state/local alerts (the Wireless Emergency Alerts PBS WARN carries; evacuation, shelter-in-place and fire codes, or evacuation wording) and Cal OES California Active Evacuation Zones. Many counties publish evacuations only through their own sites or Genasys Protect; absence here does not mean no evacuations.'));
    }

    function drawFires() {
      fires.replaceChildren(h('h2', {}, 'Active wildfire incidents'));
      ['wfigs', 'calfire', 'inciweb'].filter(id => st.err[id]).forEach(id => fires.append(h('div', { class: 'tag err', style: 'white-space:normal;margin:0 6px 6px 0', 'data-src': id }, srcById(id).name + ': ' + st.err[id])));
      if (!st.data.wfigs && !st.data.calfire) { if (!st.err.wfigs || !st.err.calfire) fires.append(h('p', { class: 'hint' }, 'Contacting NIFC and CAL FIRE…')); return; }
      const list = allFires().filter(x => inState(x) && sizeOk(x)).sort(st.sort === 'size' ? (a, b) => (b.acres || 0) - (a.acres || 0) : (a, b) => (b.start || 0) - (a.start || 0));
      fires.append(h('div', { class: 'row', style: 'margin-bottom:6px' }, h('label', { class: 'row' }, 'Sort ', h('select', { id: 'incSort', 'aria-label': 'Sort incidents', onchange: e => { st.sort = e.target.value; drawFires(); } },
        h('option', { value: 'new', selected: st.sort === 'new' }, 'Newest first'), h('option', { value: 'size', selected: st.sort === 'size' }, 'Largest first'))),
        h('span', { class: 'hint' }, list.length + ' incidents' + (list.length > MAXROWS ? ', showing ' + MAXROWS : '') + '. NIFC includes small and unnamed starts; CAL FIRE lists only incidents it publishes.')));
      if (!list.length) { fires.append(h('div', { class: 'empty' }, 'No incidents match these filters.')); }
      else fires.append(h('table', { class: 't inctable' }, h('thead', {}, h('tr', {}, ['Incident', 'Location', 'Size', 'Contained', 'Discovered', 'Updated', 'Source', ''].map(x => h('th', {}, x)))),
        h('tbody', {}, list.slice(0, MAXROWS).map(x => h('tr', { 'data-id': x.id, class: st.fresh.has(x.id) ? 'fresh' : '' },
          h('td', {}, h('b', {}, x.name), x.ref ? h('div', { class: 'hint' }, x.ref) : null), h('td', {}, [x.county, x.state].filter(Boolean).join(', ') || '—', x.lat != null ? h('div', { class: 'hint' }, (+x.lat).toFixed(3) + ', ' + (+x.lon).toFixed(3)) : null),
          h('td', {}, acres(x.acres)), h('td', {}, x.contained == null ? '—' : x.contained + '%'), h('td', { title: fmt(x.start) }, ago(x.start)), h('td', { title: fmt(x.updated) }, ago(x.updated)),
          h('td', {}, h('span', { class: 'tag' }, srcById(x.src).short)), h('td', {}, x.url ? h('a', { class: 'btn sm', href: x.url, target: '_blank', rel: 'noopener' }, '↗') : null))))));
      const iw = (st.data.inciweb || []).filter(inState).sort((a, b) => (b.updated || 0) - (a.updated || 0));
      if (st.data.inciweb) fires.append(h('h3', {}, 'InciWeb pages'), iw.length ? h('ul', { class: 'incfeed', id: 'incInciweb' }, iw.slice(0, 30).map(x => h('li', { 'data-id': x.id },
        h('span', { class: 'when', title: fmt(x.updated) }, ago(x.updated)), h('span', { class: 'grow' }, x.name), x.type ? h('span', { class: 'tag' }, x.type) : null, x.state ? h('span', { class: 'tag' }, x.state) : null,
        h('a', { class: 'btn sm', href: x.url, target: '_blank', rel: 'noopener' }, 'InciWeb ↗')))) : h('div', { class: 'empty' }, 'No InciWeb incidents' + (st.state ? ' in ' + st.state : '') + '.'));
    }

    function drawSocial() {
      social.replaceChildren(h('h2', {}, 'Social signals ', h('span', { class: 'tag warn' }, 'UNVERIFIED')));
      const terms = h('input', { type: 'text', id: 'incTerms', value: st.terms.join(', '), style: 'width:300px', 'aria-label': 'Bluesky search terms (comma-separated)' });
      const tags = h('input', { type: 'text', id: 'incTags', value: st.tags.join(', '), style: 'width:220px', 'aria-label': 'Mastodon hashtags (comma-separated)' });
      const apply = () => { const t = splitList(terms.value), g = splitList(tags.value); if (!t.length && !g.length) { toast('Enter at least one term or hashtag.', 'err'); return; } st.terms = t; st.tags = g; persist(); reloadSocial(); };
      [terms, tags].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); }));
      social.append(h('p', { class: 'hint' }, 'Public posts from people and outlets, not agencies. Use them to spot something early, then confirm with an official source. Never put a post on air as fact.'),
        h('div', { class: 'bar' }, h('label', { class: 'row' }, 'Bluesky terms ', terms), h('label', { class: 'row' }, 'Mastodon #tags ', tags), h('button', { class: 'btn', id: 'incSocialApply', onclick: apply }, 'Search')));
      ['bluesky', 'mastodon'].filter(id => st.err[id]).forEach(id => social.append(h('div', { class: 'tag err', style: 'white-space:normal;margin:0 6px 6px 0', 'data-src': id }, srcById(id).name + ': ' + st.err[id])));
      if (!st.data.bluesky && !st.data.mastodon) { if (!st.err.bluesky || !st.err.mastodon) social.append(h('p', { class: 'hint' }, 'Searching Bluesky and Mastodon…')); return; }
      // Cross-reference posts with names of incidents currently in the verified sources.
      const names = [...new Set(allFires().map(x => x.name).filter(n => n && n.length >= 4 && !/^[A-Z]{2,4}-\d+$/.test(n)).map(n => n.replace(/\s+fire$/i, '').toLowerCase()))];
      const seen = new Set(), posts = ['bluesky', 'mastodon'].flatMap(id => st.data[id] || []).filter(p => p.text && !seen.has(p.id) && seen.add(p.id))
        .sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 80);
      const since = Date.now() - st.hours * HOUR, recent = posts.filter(p => p.time && p.time >= since).length;
      social.append(h('p', { class: 'hint', id: 'incSocialCount' }, posts.length + ' posts, ' + recent + ' in the last ' + (st.hours === 1 ? 'hour' : st.hours + ' hours') + '.'));
      if (!posts.length) { social.append(h('div', { class: 'empty' }, 'No posts matched.')); return; }
      social.append(h('ul', { class: 'incsocial' }, posts.map(p => {
        const low = p.text.toLowerCase(), hit = names.find(n => new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+fire\\b').test(low));
        return h('li', { 'data-src': p.src },
          h('div', { class: 'row' }, h('b', {}, p.author), p.handle ? h('span', { class: 'hint' }, '@' + p.handle) : null, h('span', { class: 'hint', title: fmt(p.time) }, ago(p.time)), h('span', { class: 'tag' }, srcById(p.src).short + ' · ' + p.term),
            hit ? h('span', { class: 'tag ok', title: 'Mentions an incident listed by NIFC or CAL FIRE' }, 'mentions ' + hit.replace(/\b\w/g, c => c.toUpperCase()) + ' Fire') : null,
            h('span', { class: 'grow' }), p.url ? h('a', { class: 'btn sm', href: p.url, target: '_blank', rel: 'noopener' }, 'Open ↗') : null),
          h('div', { class: 'posttext' }, p.text.slice(0, 500)));
      })));
    }
    async function reloadSocial() {
      const c = { terms: st.terms, tags: st.tags };
      st.data.bluesky = st.data.mastodon = null; st.err.bluesky = st.err.mastodon = ''; drawSocial(); drawSources();
      await Promise.all(SOURCES.filter(s => s.kind === 'social').map(s => s.load(c).then(d => { st.data[s.id] = d; st.err[s.id] = ''; }, e => { st.data[s.id] = null; st.err[s.id] = e.message; })));
      drawSocial(); drawSources();
    }

    function drawLinks() {
      links.replaceChildren(h('h2', {}, 'Official sources'), h('div', { class: 'row', style: 'flex-wrap:wrap' },
        [...SOURCES.filter(s => s.verified).map(s => [s.name, s.home]), ['NIFC National Fire News', 'https://www.nifc.gov/fire-information/nfn'], ['PBS WARN', 'https://www.pbs.org/about/about-pbs/warn/'], ['Genasys Protect (evacuation zones)', 'https://protect.genasys.com/'], ['SPC Fire Weather Outlooks', 'https://www.spc.noaa.gov/products/fire_wx/'], ['NASA FIRMS hotspots', 'https://firms.modaps.eosdis.nasa.gov/usfs/map/']]
          .map(([n, u]) => h('a', { class: 'btn sm', href: u, target: '_blank', rel: 'noopener' }, n + ' ↗'))),
        h('p', { class: 'hint' }, 'Wildfire perimeters can be added to a graphic from the Interactive Map Studio (Incidents → Wildfire perimeters).'));
    }

    const timer = setInterval(() => { if (!root.isConnected) { clearInterval(timer); return; } if (st.auto && !st.busy && !document.hidden) load(); }, AUTO_MS);
    draw(); load();
    return root;
  };
})();
