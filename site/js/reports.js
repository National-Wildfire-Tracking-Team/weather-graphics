/* Storm Reports tab: a live situational-awareness dashboard (counts, hazard tiles, map, latest-reports list, charts)
   built from NWS Local Storm Reports (LSRs) via the Iowa Environmental Mesonet's public GeoJSON service.
   LSRs are preliminary reports from spotters, emergency managers, the public and automated sites; nothing is filled in:
   a failed fetch shows its error, an empty window says so. */
(function () {
  const { h, toast } = NS.ui;
  const HOUR = 3600000, DAY = 24 * HOUR;
  const URL = 'https://mesonet.agron.iastate.edu/geojson/lsr.php?hours=168';
  // Fixed category order and hues (dark categorical palette, validated against the panel surface). "Other" folds the rest.
  const CATS = [
    { id: 'tornado', label: 'Tornado', color: '#e66767', re: /TORNADO|FUNNEL|WATERSPOUT|WALL CLOUD/ },
    { id: 'tropical', label: 'Tropical', color: '#d55181', re: /TROPICAL|HURRICANE|STORM SURGE/ },
    { id: 'hail', label: 'Hail', color: '#c98500', re: /HAIL/ },
    { id: 'winter', label: 'Snow & ice', color: '#9085e9', re: /SNOW|BLIZZARD|ICE|SLEET|FREEZ|CHILL|EXTREME COLD|AVALANCHE/ },
    { id: 'fire', label: 'Wildfire', color: '#d95926', re: /FIRE/ },
    { id: 'flood', label: 'Flooding', color: '#199e70', re: /FLOOD|DEBRIS FLOW/ },
    { id: 'wind', label: 'Wind', color: '#3987e5', re: /WND|WIND|DOWNBURST|GUSTNADO/ },
    { id: 'rain', label: 'Rain totals', color: '#008300', re: /RAIN/ },
    { id: 'other', label: 'Other', color: '#8A93A0', re: /./ }
  ];
  const catOf = t => CATS.find(c => c.re.test(String(t || '').toUpperCase())) || CATS[CATS.length - 1];
  const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));
  const localMidnight = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const fmtTime = t => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const titleCase = s => String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  const SR = NS.StormReports = {
    CATS, catOf, URL, loaded: null,
    async load(force) {
      if (!force && SR.loaded && Date.now() - SR.loaded.fetchedAt < 5 * 60000) return SR.loaded;
      const d = await NS.fetchJSON(URL, 45000);
      const reports = (d.features || []).map((f, i) => {
        const p = f.properties || {}, t = Date.parse(p.valid), c = catOf(p.typetext);
        const unit = String(p.unit || '').toLowerCase(), mag = p.magnitude != null && p.magnitude !== '' && p.magnitude !== 'None' ? p.magnitude + (unit ? ' ' + (unit === 'm' ? 'mi' : unit) : '') : '';
        const remark = String(p.remark || '').trim();
        return { id: p.product_id ? p.product_id + '-' + i : 'r' + i, t, type: titleCase(p.typetext), cat: c.id, mag, city: p.city || '', county: p.county || '', state: p.st || p.state || '',
          source: p.source || '', remark: /[a-z0-9]/i.test(remark) ? remark : '', wfo: p.wfo || '', lon: +p.lon, lat: +p.lat };
      }).filter(r => isFinite(r.t) && isFinite(r.lon) && isFinite(r.lat)).sort((a, b) => b.t - a.t);
      return (SR.loaded = { fetchedAt: Date.now(), reports });
    },
    // [start, end) for a window id, in the viewer's local time.
    window(id, now) {
      now = now || Date.now(); const mid = localMidnight(now);
      if (id === 'yesterday') return [localMidnight(mid - 1), mid];
      if (id === 'today') return [mid, now + 1];
      if (id === '7d') return [now - 7 * DAY, now + 1];
      return [now - DAY, now + 1];
    }
  };

  const WINDOWS = [['24h', 'Last 24 hrs'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days']];

  NS.ReportsView = async function () {
    const st = { win: '24h', state: '', cats: new Set(CATS.filter(c => c.id !== 'rain').map(c => c.id)), data: null, err: '', busy: false };
    let scene = null, ready = false, popup = null, tip = null;
    const root = h('div', { class: 'reports' }, h('h1', {}, 'Storm Reports'),
      h('p', { class: 'sub' }, 'Live NWS Local Storm Reports: what spotters, emergency managers, the public and weather stations are reporting. Reports are preliminary and unverified; confirm with the issuing NWS office before going on air.'));
    const bar = h('div', { class: 'bar', id: 'srBar' }), kpis = h('div', { class: 'srkpis', id: 'srKpis' }), cats = h('div', { class: 'srcats', id: 'srCats' });
    const mapEl = h('div', { id: 'srMap', class: 'srmap' }), list = h('div', { class: 'srlist', id: 'srList' });
    const charts = h('div', { class: 'srcharts' }), byType = h('div', { class: 'srchart', id: 'srByType' }), byDay = h('div', { class: 'srchart', id: 'srByDay' });
    charts.append(byType, byDay);
    root.append(bar, kpis, cats, h('div', { class: 'srmain' }, h('div', { class: 'srpanel' }, mapEl), h('div', { class: 'srpanel' }, h('h2', {}, 'Latest reports'), list)), charts,
      h('p', { class: 'hint' }, 'Source: NOAA/NWS Local Storm Reports, via the Iowa Environmental Mesonet (mesonet.agron.iastate.edu). Covers the last 7 days. Rain totals are measurements, not events, so they are hidden unless switched on.'));

    const inState = r => !st.state || r.state === st.state;
    const inWin = (r, id) => { const [a, b] = SR.window(id || st.win); return r.t >= a && r.t < b; };
    const shown = () => st.data ? st.data.reports.filter(r => inState(r) && inWin(r) && st.cats.has(r.cat)) : [];

    async function load(force) {
      st.busy = true; drawBar();
      try { st.data = await SR.load(force); st.err = ''; } catch (e) { st.data = null; st.err = 'Could not load storm reports: ' + e.message; }
      st.busy = false; draw();
    }
    function draw() { drawBar(); drawKpis(); drawCats(); drawList(); drawCharts(); drawMap(); }

    function drawBar() {
      const states = st.data ? [...new Set(st.data.reports.map(r => r.state))].filter(Boolean).sort() : [];
      bar.replaceChildren(
        h('div', { class: 'row', role: 'group', 'aria-label': 'Time window' }, WINDOWS.map(([id, l]) => h('button', { class: 'chip' + (st.win === id ? ' on' : ''), 'data-win': id, 'aria-pressed': st.win === id, onclick: () => { st.win = id; draw(); } }, l))),
        h('label', { class: 'row' }, 'State ', h('select', { id: 'srState', 'aria-label': 'Filter by state', onchange: e => { st.state = e.target.value; draw(); } },
          h('option', { value: '' }, 'All states'), states.map(s => h('option', { value: s, selected: s === st.state }, s)))),
        h('label', { class: 'row' }, h('input', { type: 'checkbox', id: 'srRain', checked: st.cats.has('rain'), onchange: e => { e.target.checked ? st.cats.add('rain') : st.cats.delete('rain'); draw(); } }), 'Include rain totals'),
        h('button', { class: 'btn', id: 'srRefresh', disabled: st.busy, onclick: () => load(true) }, st.busy ? 'Loading…' : 'Refresh'),
        st.err ? h('span', { class: 'tag err', style: 'white-space:normal' }, st.err) : st.data ? h('span', { class: 'hint' }, 'Loaded ' + new Date(st.data.fetchedAt).toLocaleTimeString()) : h('span', { class: 'hint' }, 'Contacting the Iowa Environmental Mesonet…'));
    }

    function drawKpis() {
      if (!st.data) { kpis.replaceChildren(); return; }
      const base = st.data.reports.filter(r => inState(r) && st.cats.has(r.cat));
      const n = id => base.filter(r => inWin(r, id)).length;
      kpis.replaceChildren(...WINDOWS.map(([id, l]) => h('button', { class: 'srkpi' + (st.win === id ? ' on' : ''), 'data-kpi': id, onclick: () => { st.win = id; draw(); } },
        h('span', { class: 'n' }, n(id).toLocaleString()), h('span', { class: 'l' }, 'Reports · ' + l))));
    }

    function drawCats() {
      if (!st.data) { cats.replaceChildren(); return; }
      const base = st.data.reports.filter(r => inState(r) && inWin(r));
      cats.replaceChildren(...CATS.map(c => {
        const n = base.filter(r => r.cat === c.id).length, on = st.cats.has(c.id);
        return h('button', { class: 'srcat' + (on ? ' on' : ''), 'data-cat': c.id, 'aria-pressed': on, title: (on ? 'Hide ' : 'Show ') + c.label,
          onclick: () => { on ? st.cats.delete(c.id) : st.cats.add(c.id); draw(); } },
          h('span', { class: 'sw', style: 'background:' + c.color }), h('span', { class: 'l' }, c.label), h('span', { class: 'n' }, n.toLocaleString()));
      }));
    }

    function drawList() {
      if (!st.data) { list.replaceChildren(); return; }
      const rs = shown();
      if (!rs.length) { list.replaceChildren(h('div', { class: 'empty' }, 'No reports match in this window.')); return; }
      list.replaceChildren(...rs.slice(0, 40).map(r => h('div', { class: 'srrow', 'data-cat': r.cat },
        h('div', { class: 'row' }, h('span', { class: 'sw', style: 'background:' + CAT[r.cat].color }), h('b', { class: 'grow' }, r.type + (r.mag ? ' · ' + r.mag : '')), h('span', { class: 'hint' }, fmtTime(r.t))),
        h('div', {}, [r.city, r.county ? (/^[A-Z]{2}Z\d{3}$|^[A-Z]{3}\d{3}$/.test(r.county) ? r.county : r.county + ' Co.') : '', r.state].filter(Boolean).join(', ')),
        r.remark ? h('div', { class: 'hint' }, r.remark.length > 200 ? r.remark.slice(0, 200) + '…' : r.remark) : null,
        h('div', { class: 'hint' }, [r.source, r.wfo ? 'NWS ' + r.wfo : ''].filter(Boolean).join(' · ')))),
        rs.length > 40 ? h('p', { class: 'hint' }, 'Showing the latest 40 of ' + rs.length.toLocaleString() + '.') : '');
    }

    /* charts: one series each, so no legend; hover tooltips; text stays in ink colors */
    function tooltip(e, text) {
      if (!tip) { tip = h('div', { class: 'srtip', role: 'tooltip' }); document.body.append(tip); }
      if (!text) { tip.hidden = true; return; }
      tip.hidden = false; tip.textContent = text; tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY - 28) + 'px';
    }
    function drawCharts() {
      if (!st.data) { byType.replaceChildren(); byDay.replaceChildren(); return; }
      const rs = shown(), total = rs.length;
      const counts = CATS.map(c => ({ c, n: rs.filter(r => r.cat === c.id).length })).filter(x => x.n).sort((a, b) => b.n - a.n);
      const max = Math.max(1, ...counts.map(x => x.n));
      byType.replaceChildren(h('h2', {}, 'Reports by type'), counts.length ? h('div', { class: 'hbars' }, counts.map(x => h('div', { class: 'hbar', 'data-cat': x.c.id,
        onmousemove: e => tooltip(e, x.c.label + ': ' + x.n.toLocaleString() + ' (' + Math.round(100 * x.n / total) + '%)'), onmouseleave: e => tooltip(e) },
        h('span', { class: 'l' }, x.c.label), h('span', { class: 'track' }, h('span', { class: 'fill', style: 'width:' + (100 * x.n / max) + '%;background:' + x.c.color })), h('span', { class: 'n' }, x.n.toLocaleString())))) : h('p', { class: 'hint' }, 'No reports.'));
      // by day over the 7 days available (respects state and type filters, not the time window)
      const base = st.data.reports.filter(r => inState(r) && st.cats.has(r.cat)), today = localMidnight(Date.now());
      const days = Array.from({ length: 8 }, (_, i) => { const t = localMidnight(today - (7 - i) * DAY + 2 * HOUR); return { t, k: dayKey(t), n: 0 }; });
      const idx = Object.fromEntries(days.map((d, i) => [d.k, i]));
      base.forEach(r => { const i = idx[dayKey(r.t)]; if (i != null) days[i].n++; });
      const dmax = Math.max(1, ...days.map(d => d.n)), pk = days.reduce((a, b) => b.n > a.n ? b : a, days[0]);
      byDay.replaceChildren(h('h2', {}, 'Reports by day'), h('div', { class: 'vbars', role: 'img', 'aria-label': 'Reports per day: ' + days.map(d => new Date(d.t).toLocaleDateString([], { weekday: 'short' }) + ' ' + d.n).join(', ') },
        days.map(d => { const lbl = new Date(d.t).toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' });
          return h('div', { class: 'vcol', 'data-day': d.k, onmousemove: e => tooltip(e, lbl + ': ' + d.n.toLocaleString() + ' reports' + (d.k === dayKey(today) ? ' (so far)' : '')), onmouseleave: e => tooltip(e) },
            h('span', { class: 'n' }, d === pk && d.n ? d.n.toLocaleString() : ''), h('span', { class: 'col', style: 'height:' + Math.max(d.n ? 2 : 0, 100 * d.n / dmax) + '%' }), h('span', { class: 'l' }, lbl)); })),
        h('p', { class: 'hint' }, 'The first day is partial (7-day feed); today is so far.'));
    }

    /* map: Studio basemap + a circle layer for the shown reports */
    const fc = () => ({ type: 'FeatureCollection', features: shown().slice().reverse().map(r => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      properties: { id: r.id, color: CAT[r.cat].color, big: r.cat === 'tornado' || r.cat === 'tropical' ? 1 : 0 } })) });
    function installPts() {
      const m = scene && scene.map; if (!m) return;
      if (!m.isStyleLoaded()) { m.once('idle', installPts); return; }
      if (!m.getSource('sr-pts')) m.addSource('sr-pts', { type: 'geojson', data: fc() }); else m.getSource('sr-pts').setData(fc());
      if (!m.getLayer('sr-pts')) m.addLayer({ id: 'sr-pts', type: 'circle', source: 'sr-pts', paint: { 'circle-radius': ['case', ['==', ['get', 'big'], 1], 7, 5], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#0C1119', 'circle-stroke-width': 1.5 } });
    }
    async function drawMap() {
      if (!st.data) return;
      if (scene) { if (ready) installPts(); return; }
      if (!NS.config.token) { mapEl.replaceChildren(h('div', { class: 'empty' }, 'No Mapbox token configured, so the map cannot be shown. The counts and list still work.')); return; }
      try {
        const s = NS.defaultMapState('Lower 48'); s.style = NS.config.style ? 'broadcast' : 'dark'; s.projection = 'albers'; s.fit = { extent: NS.VIEWS['Lower 48'], padding: 10 };
        scene = new NS.MapScene(mapEl, {}); await scene.init(s); ready = true; installPts();
        scene.map.on('style.load', installPts);
        scene.map.on('mouseenter', 'sr-pts', () => { scene.map.getCanvas().style.cursor = 'pointer'; });
        scene.map.on('mouseleave', 'sr-pts', () => { scene.map.getCanvas().style.cursor = ''; });
        scene.map.on('click', e => {
          const fs = scene.map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['sr-pts'] }); if (!fs.length) return;
          const ids = new Set(fs.map(f => f.properties.id)), rs = st.data.reports.filter(r => ids.has(r.id)).slice(0, 6);
          if (popup) popup.remove();
          popup = new mapboxgl.Popup({ maxWidth: '320px' }).setLngLat(e.lngLat).setDOMContent(h('div', { style: 'color:#0C1119;font:13px/17px var(--font-sans)' },
            rs.map(r => h('div', { style: 'margin-bottom:6px' }, h('b', {}, r.type + (r.mag ? ' · ' + r.mag : '')), h('div', {}, [r.city, r.state].filter(Boolean).join(', ') + ' · ' + fmtTime(r.t)), r.remark ? h('div', {}, r.remark.slice(0, 160)) : null)))).addTo(scene.map);
        });
      } catch (e) { if (scene) scene.destroy(); scene = null; ready = false; mapEl.replaceChildren(h('div', { class: 'empty' }, 'Map could not load: ' + e.message)); }
    }

    // Tear down the map and tooltip when the view is replaced.
    const obs = new MutationObserver(() => { if (!root.isConnected) { obs.disconnect(); if (scene) scene.destroy(); scene = null; if (tip) tip.remove(); } });
    setTimeout(() => root.parentNode && obs.observe(root.parentNode, { childList: true }), 0);

    draw(); load(false);
    return root;
  };
})();
