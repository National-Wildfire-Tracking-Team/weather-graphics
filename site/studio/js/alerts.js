/* NWS Alert Graphics: pick specific NWS alert types (plus optional state / severity filters) from the live active-alert feed
   and create a map graphic from the selection. Data and limits live in NS.NWS (providers.js). */
(function () {
  const { h, toast } = NS.ui;
  const SEV = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];
  const rank = ev => /Warning$|Emergency$/.test(ev) ? 0 : /Watch$/.test(ev) ? 1 : /Advisory$/.test(ev) ? 2 : /Statement$|Outlook$/.test(ev) ? 3 : 4;
  const inLower48 = e => e[0][0] > -130 && e[1][0] < -60 && e[0][1] > 22 && e[1][1] < 51;

  function bounds(fc) {
    let w = 180, s = 90, e = -180, n = -90;
    (function walk(c) { if (typeof c[0] === 'number') { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; } else c.forEach(walk); })(fc.features.map(f => f.geometry.coordinates));
    return [[w, s], [e, n]];
  }
  function padExtent(b) {   // avoid an extreme zoom-in on one small polygon and keep a little air around the shapes
    let [[w, s], [e, n]] = b; const dx = Math.max(0, 3 - (e - w)) / 2, dy = Math.max(0, 2 - (n - s)) / 2;
    return [[Math.max(-179.9, w - dx), Math.max(-85, s - dy)], [Math.min(179.9, e + dx), Math.min(85, n + dy)]];
  }

  NS.AlertsView = async function () {
    const sel = { events: new Set(), states: new Set(), sevs: new Set(), q: '' }, opt = { region: 'fit', style: NS.config.style ? 'broadcast' : 'dark', title: '', subtitle: '', color: '' };
    let titleEdited = false, subEdited = false, busy = false, data = null, err = '';
    const root = h('div', {}, h('h1', {}, 'NWS Alert Graphics'), h('p', { class: 'sub' }, 'Choose a specific NWS alert type from the alerts active right now, optionally narrow it by state or severity, and create a map graphic from it. Shapes come straight from api.weather.gov and are frozen when the graphic is created.'));
    const status = h('div', { class: 'row', style: 'margin-bottom:10px' }), body = h('div', {});
    root.append(status, body);

    async function load() {
      err = ''; data = null; draw();
      try { data = await NS.NWS.loadActive(); } catch (e) { err = 'Could not load NWS alerts: ' + e.message; }
      // drop selections that are no longer active
      const evs = new Set(data ? data.alerts.map(a => a.event) : []); sel.events.forEach(x => { if (!evs.has(x)) sel.events.delete(x); });
      draw();
    }
    const filter = () => ({ events: [...sel.events], states: [...sel.states], severities: [...sel.sevs] });
    // Alerts matching the state/severity filters only (used for per-event counts) and the full filter (used for the preview).
    const scoped = () => NS.NWS.filter(data.alerts, { states: [...sel.states], severities: [...sel.sevs] });
    const matches = () => NS.NWS.filter(data.alerts, filter());

    function eventList() {
      const by = new Map(); scoped().forEach(a => { const r = by.get(a.event) || { n: 0, poly: 0 }; r.n++; if (a.geometry) r.poly++; by.set(a.event, r); });
      sel.events.forEach(ev => { if (!by.has(ev)) by.set(ev, { n: 0, poly: 0 }); });   // keep a selection visible even if filters empty it
      const lq = sel.q.trim().toLowerCase();
      const rows = [...by.entries()].filter(([ev]) => !lq || ev.toLowerCase().includes(lq)).sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].n - a[1].n || a[0].localeCompare(b[0]));
      return h('div', { id: 'nwsEvents', role: 'group', 'aria-label': 'NWS alert types', style: 'max-height:420px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-sm);padding:4px' },
        rows.length ? rows.map(([ev, r]) => h('label', { class: 'lyr', style: 'display:flex;gap:8px;align-items:center;padding:4px 6px' },
          h('input', { type: 'checkbox', checked: sel.events.has(ev), 'data-event': ev, onchange: e => { e.target.checked ? sel.events.add(ev) : sel.events.delete(ev); autoText(); draw(); } }),
          h('span', { style: 'width:10px;height:10px;border-radius:50%;flex:none;background:' + NS.NWS.eventColor(ev) }),
          h('span', { style: 'flex:1' }, ev), h('span', { class: 'tag' }, String(r.n)), r.n && !r.poly ? h('span', { class: 'tag', title: 'No polygons: drawn from NWS zone shapes' }, 'zones') : null))
          : h('div', { class: 'hint', style: 'padding:8px' }, 'No active alerts match.'));
    }
    function chips(label, items, set, key) {
      return h('div', { style: 'margin-top:10px' }, h('div', { class: 'hint', style: 'font-weight:600;margin-bottom:4px' }, label), h('div', { class: 'row', style: 'gap:4px' }, items.map(([v, txt]) => h('button', { class: 'chip' + (set.has(v) ? ' on' : ''), 'aria-pressed': set.has(v), ['data-' + key]: v, onclick: () => { set.has(v) ? set.delete(v) : set.add(v); autoText(); draw(); } }, txt || v))));
    }
    function autoText() {
      const evs = [...sel.events]; if (!titleEdited) opt.title = evs.length === 1 ? evs[0].toUpperCase() : evs.length ? 'NWS ALERTS' : '';
      if (!subEdited) opt.subtitle = evs.length > 1 ? evs.join(' · ') : (sel.states.size ? 'Active alerts · ' + [...sel.states].join(', ') : 'Active alerts');
    }

    function draw() {
      status.innerHTML = ''; body.innerHTML = '';
      status.append(h('button', { class: 'btn', id: 'nwsRefresh', disabled: busy, onclick: load }, data || err ? 'Refresh alerts' : 'Loading…'),
        data ? h('span', { class: 'hint' }, data.alerts.length + ' active alerts · loaded ' + new Date(data.fetchedAt).toLocaleTimeString()) : err ? h('span', { class: 'tag err', style: 'white-space:normal' }, err) : h('span', { class: 'hint' }, 'Contacting api.weather.gov…'));
      if (!data) return;
      const stCount = {}; data.alerts.forEach(a => a.states.forEach(s => { stCount[s] = (stCount[s] || 0) + 1; }));
      const states = Object.keys(stCount).sort((a, b) => (a === 'Marine/other') - (b === 'Marine/other') || a.localeCompare(b)).map(s => [s, s]);
      const sevs = SEV.filter(s => data.alerts.some(a => a.severity === s)).map(s => [s, s]);
      const left = h('div', { style: 'flex:1 1 380px;min-width:300px' }, h('h2', {}, '1. Alert type'),
        h('input', { type: 'search', id: 'nwsSearch', placeholder: 'Search alert types (e.g. flood, winter, heat)', 'aria-label': 'Search alert types', value: sel.q, style: 'width:100%;margin-bottom:6px', oninput: e => { sel.q = e.target.value; const el = document.getElementById('nwsEvents'); el.replaceWith(eventList()); } }),
        eventList(), h('div', { class: 'hint', style: 'margin-top:4px' }, 'Tick one or more. "zones" = no polygon in the alert, so whole NWS zones are drawn.'));
      const right = h('div', { style: 'flex:1 1 380px;min-width:300px' }, h('h2', {}, '2. Narrow it (optional)'), chips('State', states, sel.states, 'state'), chips('Severity', sevs, sel.sevs, 'sev'));
      body.append(h('div', { class: 'row', style: 'align-items:flex-start;gap:24px' }, left, right));

      // 3. graphic options + create
      const m = matches(), polys = m.filter(a => a.geometry).length, zones = NS.NWS.zoneUrls(m, filter()).length, over = zones > NS.NWS.MAX_ZONES;
      const f = (l, ctl) => h('div', { class: 'prop', style: 'max-width:620px;grid-template-columns:130px 1fr' }, h('label', {}, l), ctl);
      const reg = h('select', { id: 'nwsRegion', 'aria-label': 'Map region', onchange: e => { opt.region = e.target.value; } }, h('option', { value: 'fit', selected: opt.region === 'fit' }, 'Fit to the alerts'), Object.keys(NS.VIEWS).map(k => h('option', { value: k, selected: opt.region === k }, k)));
      const sty = h('select', { id: 'nwsStyle', 'aria-label': 'Basemap', onchange: e => { opt.style = e.target.value; } }, Object.entries(NS.STYLES).filter(([k]) => k !== 'custom' && (k !== 'broadcast' || NS.config.style)).map(([k, v]) => h('option', { value: k, selected: opt.style === k }, v.name)));
      const title = h('input', { type: 'text', id: 'nwsTitle', value: opt.title, oninput: e => { opt.title = e.target.value; titleEdited = true; } }), sub = h('input', { type: 'text', id: 'nwsSub', value: opt.subtitle, oninput: e => { opt.subtitle = e.target.value; subEdited = true; } });
      const col = h('input', { type: 'color', id: 'nwsColor', value: opt.color || '#F2453D', 'aria-label': 'Alert color', oninput: e => { opt.color = e.target.value; } });
      const summary = !sel.events.size ? h('span', { class: 'hint' }, 'Select an alert type to continue.')
        : h('span', { class: m.length ? 'tag ok' : 'tag warn', id: 'nwsSummary' }, m.length + ' alert' + (m.length === 1 ? '' : 's') + ' match · ' + polys + ' with polygons' + (zones ? ' · ' + zones + ' zone shapes to load' : ''));
      body.append(h('h2', {}, '3. Graphic'), f('Title', title), f('Subtitle', sub), f('Map region', reg), f('Basemap', sty), f('Color', h('span', { class: 'row' }, col, h('span', { class: 'hint' }, 'Leave to use standard colors by alert type (warning red, watch amber, advisory blue).', ' ', h('button', { class: 'btn sm', onclick: () => { opt.color = ''; draw(); } }, 'Auto')))),
        h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', id: 'nwsCreate', disabled: busy || !sel.events.size || !m.length || over || !NS.config.token, onclick: create }, busy ? 'Building…' : 'Create graphic'), summary,
          over ? h('span', { class: 'tag err' }, 'Too many zones (max ' + NS.NWS.MAX_ZONES + ') — pick a state') : null, !NS.config.token ? h('span', { class: 'tag err' }, 'No Mapbox token configured') : null),
        h('p', { class: 'hint' }, 'Alerts are public NWS products with no SLA. Always confirm with the issuing office before publishing. The map shows the snapshot taken now; use Refresh data in Map Studio to update it.'));
    }

    async function create() {
      if (busy) return; busy = true; const f = filter(), m = matches(), btn = () => document.getElementById('nwsCreate'); draw();
      try {
        const color = opt.color || null;
        const fc = await NS.NWS.build(m, f, color, (d, n) => { const b = btn(); if (b) b.textContent = 'Loading zone shapes ' + d + '/' + n + '…'; });
        if (!fc.features.length) throw new Error('No shapes could be drawn for this selection.');
        (fc.notes || []).forEach(t => toast(t, 'err', 9000));
        let extent = opt.region === 'fit' ? padExtent(bounds(fc)) : NS.VIEWS[opt.region];
        const brand = await NS.getBrand(), accent = color || (f.events.length === 1 ? NS.NWS.eventColor(f.events[0]) : null);
        const p = await NS.Templates.alertGraphic(brand, { title: opt.title || 'NWS ALERTS', subtitle: opt.subtitle, accent: accent || undefined, style: opt.style === 'broadcast' && !NS.config.style ? 'dark' : opt.style,
          extent, projection: opt.style === 'broadcast' && inLower48(extent) ? 'albers' : 'mercator', filter: f, color, data: fc });
        await NS.App.createProject(p);
      } catch (e) { toast('Could not create the graphic: ' + e.message, 'err', 9000); }
      busy = false; if (document.getElementById('nwsRefresh')) draw();
    }

    draw(); load();
    return root;
  };
})();
