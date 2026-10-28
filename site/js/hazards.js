/* Week-Ahead Hazards: a 5-7 day overview (e.g. Saturday to next Friday) built from the official SPC, WPC and CPC outlooks.
   Day cards list the hazards each product shows for that date, the map previews any day (or the whole period), and the
   selection can become a map graphic. Data, dates and limits live in NS.Hazards (providers.js). */
(function () {
  const { h, toast } = NS.ui;
  const DAY = 86400000, LAYER = 'hazards-outlook';
  const fmt = (iso, o) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC' }, o));
  const dayName = iso => fmt(iso, { weekday: 'long', month: 'short', day: 'numeric' });
  const shortName = iso => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });
  const todayIso = () => NS.Hazards.isoDay(NS.Hazards.today());
  // Upcoming Saturday (today if it is Saturday): the "weekend into next week" planning window.
  const nextSat = () => { const t = NS.Hazards.today(); return NS.Hazards.isoDay(t + ((6 - new Date(t).getUTCDay() + 7) % 7) * DAY); };
  const inLower48 = e => e[0][0] > -130 && e[1][0] < -60 && e[0][1] > 22 && e[1][1] < 51;

  NS.HazardsView = async function () {
    const opt = { start: nextSat(), span: 7, sel: 'all', sources: NS.Hazards.SOURCES.map(s => s.id), thunder: false, style: NS.config.style ? 'broadcast' : 'dark', title: '', subtitle: '' };
    let titleEdited = false, subEdited = false, busy = false, data = null, err = '', scene = null, ready = false, popup = null;
    const root = h('div', {}, h('h1', {}, 'Week-Ahead Hazards'),
      h('p', { class: 'sub' }, 'A day-by-day look at the hazards in the official outlooks for the next 5 to 7 days (for example, Saturday through next Friday). Pick the days, click a day to see it on the map, then make a graphic from a day or the whole period.'));
    const status = h('div', { class: 'row', style: 'margin-bottom:10px' }), controls = h('div', {}), days = h('div', {}), mapWrap = h('div', {}), graphic = h('div', {});
    root.append(status, controls, days, mapWrap, graphic);

    const dates = () => NS.Hazards.range(opt.start, opt.span);
    const shown = () => opt.sel === 'all' ? dates() : [opt.sel];
    const filt = () => ({ sources: opt.sources, thunder: opt.thunder });
    const rangeText = () => { const d = dates(); return shortName(d[0]) + ' – ' + shortName(d[d.length - 1]); };

    async function load(force) {
      err = ''; busy = true; drawStatus();
      try { data = await NS.Hazards.load(force); } catch (e) { err = 'Could not load the outlooks: ' + e.message; data = null; }
      busy = false; drawAll();
    }
    function drawAll() { drawStatus(); drawControls(); drawDays(); drawMap(); drawGraphic(); }

    function drawStatus() {
      status.innerHTML = '';
      status.append(h('button', { class: 'btn', id: 'hzRefresh', disabled: busy, onclick: () => load(true) }, busy ? 'Loading…' : 'Refresh outlooks'),
        data ? h('span', { class: 'hint' }, 'Loaded ' + new Date(data.fetchedAt).toLocaleTimeString()) : err ? h('span', { class: 'tag err', style: 'white-space:normal' }, err) : h('span', { class: 'hint' }, 'Contacting NOAA outlook services…'));
      if (data) data.sources.forEach(s => status.append(h('span', { class: 'tag' + (s.error ? ' err' : ' ok'), 'data-src': s.id, title: s.error ? s.error : s.name + ' · ' + s.range + (s.issued ? ' · latest issue ' + new Date(s.issued).toUTCString().slice(5, 22) + ' UTC' : '') },
        s.short + (s.error ? ' · failed' : ' · ' + s.range))));
    }

    function drawControls() {
      controls.innerHTML = '';
      const preset = (label, start, span, id) => h('button', { class: 'chip' + (opt.start === start && opt.span === span ? ' on' : ''), id, onclick: () => { opt.start = start; opt.span = span; opt.sel = 'all'; autoText(); drawAll(); } }, label);
      const sat = nextSat(), t = todayIso();
      const startIn = h('input', { type: 'date', id: 'hzStart', value: opt.start, 'aria-label': 'First day', onchange: e => { if (e.target.value) { opt.start = e.target.value; opt.sel = 'all'; autoText(); drawAll(); } } });
      const spanSel = h('select', { id: 'hzSpan', 'aria-label': 'Number of days', onchange: e => { opt.span = +e.target.value; opt.sel = 'all'; autoText(); drawAll(); } }, [5, 6, 7].map(n => h('option', { value: n, selected: n === opt.span }, n + ' days')));
      const srcs = NS.Hazards.SOURCES.map(s => h('label', { class: 'row', style: 'gap:4px' }, h('input', { type: 'checkbox', 'data-source': s.id, checked: opt.sources.includes(s.id), onchange: e => {
        opt.sources = e.target.checked ? opt.sources.concat(s.id) : opt.sources.filter(x => x !== s.id); drawDays(); drawMap(); drawGraphic(); } }), s.short + ' (' + s.range + ')'));
      controls.append(h('div', { class: 'row', style: 'margin-bottom:8px' }, preset('Sat → next Fri', sat, 7, 'hzSatFri'), preset('Next 7 days', t, 7, 'hzNext7'), preset('Next 5 days', t, 5, 'hzNext5'),
        h('label', {}, 'From ', startIn), spanSel, h('span', { class: 'hint' }, rangeText())),
        h('div', { class: 'row', style: 'margin-bottom:12px;gap:14px' }, h('span', { class: 'hint', style: 'font-weight:600' }, 'Outlooks:'), srcs,
          h('label', { class: 'row', style: 'gap:4px' }, h('input', { type: 'checkbox', id: 'hzThunder', checked: opt.thunder, onchange: e => { opt.thunder = e.target.checked; drawDays(); drawMap(); drawGraphic(); } }), 'General thunder areas')));
    }

    function drawDays() {
      days.innerHTML = '';
      if (!data) return;
      const cards = dates().map(iso => {
        const s = NS.Hazards.summary(iso, filt()), on = opt.sel === iso, past = s.day < 1;
        const body = past ? h('div', { class: 'hint' }, 'In the past: outlooks only cover today onward.')
          : !s.covered.length ? h('div', { class: 'hint' }, 'No official outlook reaches this day yet (Day ' + s.day + ').')
          : s.items.length ? h('div', { style: 'display:flex;flex-direction:column;gap:3px' }, s.items.map(it => h('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap;align-items:flex-start' },
            h('span', { style: 'width:10px;height:10px;margin-top:4px;border-radius:2px;flex:none;background:' + it.color }),
            h('span', { style: 'flex:1;line-height:16px' }, h('b', {}, it.hazard), it.detail ? ' · ' + it.detail : '', h('span', { class: 'hint' }, ' (' + it.srcName + ')')))))
          : h('div', { class: 'hint' }, 'No hazard areas in the outlooks.');
        return h('button', { class: 'tile', 'data-day': iso, 'aria-pressed': String(on), style: 'text-align:left;padding:10px;gap:6px;cursor:pointer;justify-content:flex-start;' + (on ? 'outline:2px solid var(--accent);' : ''), onclick: () => { opt.sel = on ? 'all' : iso; autoText(); drawDays(); drawMap(); drawGraphic(); } },
          h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:nowrap' }, h('b', { style: 'font:700 18px/20px var(--font-display);text-transform:uppercase' }, shortName(iso)), h('span', { class: 'tag' }, past ? 'past' : 'Day ' + s.day)),
          body, s.covered.length && !past ? h('div', { class: 'hint', style: 'margin-top:auto;font-size:11px' }, 'From: ' + s.covered.join(' · ')) : null);
      });
      days.append(h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, h('h2', { style: 'margin:0' }, 'Overview'),
        h('div', { class: 'row' }, h('button', { class: 'btn sm' + (opt.sel === 'all' ? ' on' : ''), id: 'hzAll', onclick: () => { opt.sel = 'all'; autoText(); drawDays(); drawMap(); drawGraphic(); } }, 'Whole period on map'),
          h('button', { class: 'btn sm', id: 'hzCopy', onclick: copyText }, 'Copy text summary'))),
        h('div', { id: 'hzDays', style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px' }, cards));
    }

    function textSummary() {
      const lines = ['HAZARDS OUTLOOK · ' + rangeText(), ''];
      dates().forEach(iso => {
        const s = NS.Hazards.summary(iso, filt());
        lines.push(dayName(iso).toUpperCase() + (s.day >= 1 ? ' (Day ' + s.day + ')' : ''));
        if (s.day < 1) lines.push('  (past)'); else if (!s.covered.length) lines.push('  No official outlook yet');
        else if (!s.items.length) lines.push('  No hazard areas outlined');
        else s.items.forEach(it => lines.push('  - ' + it.hazard + (it.detail ? ': ' + it.detail : '') + ' [' + it.srcName + ']'));
      });
      lines.push('', 'Sources: ' + data.sources.filter(s => !s.error && opt.sources.includes(s.id)).map(s => s.name).join('; ') + '. Loaded ' + new Date(data.fetchedAt).toLocaleString() + '. Confirm with SPC/WPC/CPC before publishing.');
      return lines.join('\n');
    }
    async function copyText() {
      const t = textSummary();
      try { await navigator.clipboard.writeText(t); toast('Summary copied to the clipboard.', 'ok'); }
      catch (e) { NS.ui.download(new Blob([t], { type: 'text/plain' }), 'hazards-outlook.txt'); toast('Clipboard unavailable; the summary was downloaded as a text file.', 'ok'); }
    }

    // Live preview: the same MapScene and provider layer the exported graphic uses.
    function mapState() {
      const s = NS.defaultMapState('Lower 48'); s.style = opt.style === 'broadcast' && !NS.config.style ? 'dark' : opt.style; s.projection = 'albers';
      s.fit = { extent: NS.VIEWS['Lower 48'], padding: 10 }; s.layers[LAYER] = { on: true, opacity: 0.85 }; s.layerOrder = [LAYER];
      s.layerData[LAYER] = { fetchedAt: Date.now(), data: NS.Hazards.build(shown(), filt()) }; return s;
    }
    async function drawMap() {
      if (!data) { mapWrap.innerHTML = ''; return; }
      const label = opt.sel === 'all' ? 'Whole period · ' + rangeText() : dayName(opt.sel);
      if (scene) { refreshMap(); return; }   // still initializing: refreshMap is a no-op until ready, then runs once
      mapWrap.innerHTML = '';
      const el = h('div', { id: 'hzMap', style: 'width:100%;aspect-ratio:16/9;max-height:620px;background:var(--map-land);border:1px solid var(--border);border-radius:var(--radius-sm)' });
      mapWrap.append(h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, h('h2', { style: 'margin:0' }, 'Map'), h('span', { class: 'tag', id: 'hzMapLabel' }, label)), el,
        h('p', { class: 'hint' }, 'Click a shaded area for its hazard, product and day. Broad Hazards Outlook areas are drawn underneath the detailed SPC/WPC outlooks.'));
      if (!NS.config.token) { el.append(h('div', { class: 'empty' }, 'No Mapbox token configured, so the map cannot be shown. The day cards above still work.')); return; }
      try {
        scene = new NS.MapScene(el, {}); await scene.init(mapState()); ready = true; refreshMap();
        scene.map.on('click', e => {
          const fs = scene.map.queryRenderedFeatures(e.point, { layers: ['ns-ov-' + LAYER + '-fill'] }); if (!fs.length) return;
          const seen = new Set(), rows = fs.map(f => f.properties).filter(p => { const k = p.src + p.hazard + p.detail + p.day; return !seen.has(k) && seen.add(k); }).reverse();
          if (popup) popup.remove();
          popup = new mapboxgl.Popup({ closeButton: true, maxWidth: '320px' }).setLngLat(e.lngLat).setDOMContent(h('div', { style: 'color:#0C1119;font:13px/17px var(--font-sans)' }, rows.map(p => h('div', {}, h('b', {}, p.hazard), p.detail ? ' · ' + p.detail : '', ' — ' + p.srcName + ', ' + p.day)))).addTo(scene.map);
        });
      } catch (e) { if (scene) scene.destroy(); scene = null; ready = false; el.innerHTML = ''; el.append(h('div', { class: 'empty' }, 'Map could not load: ' + e.message)); }
    }

    function refreshMap() {
      if (!scene || !ready || !scene.map) return;
      scene.state.layerData[LAYER].data = NS.Hazards.build(shown(), filt()); scene.installAll();
      const l = document.getElementById('hzMapLabel'); if (l) l.textContent = opt.sel === 'all' ? 'Whole period · ' + rangeText() : dayName(opt.sel);
    }
    function autoText() {
      if (!titleEdited) opt.title = 'HAZARDS OUTLOOK';
      if (!subEdited) opt.subtitle = opt.sel === 'all' ? rangeText() : dayName(opt.sel);
      const t = document.getElementById('hzTitle'), s = document.getElementById('hzSub'); if (t) t.value = opt.title; if (s) s.value = opt.subtitle;
    }
    function drawGraphic() {
      graphic.innerHTML = ''; if (!data) return;
      const n = NS.Hazards.build(shown(), filt()).features.length;
      const f = (l, ctl) => h('div', { class: 'prop', style: 'max-width:620px;grid-template-columns:130px 1fr' }, h('label', {}, l), ctl);
      const sty = h('select', { id: 'hzStyle', 'aria-label': 'Basemap', onchange: async e => { opt.style = e.target.value; if (scene && ready) { try { await scene.setStyle(mapState()); refreshMap(); } catch (er) { toast(er.message, 'err'); } } } },
        Object.entries(NS.STYLES).filter(([k]) => k !== 'custom' && (k !== 'broadcast' || NS.config.style)).map(([k, v]) => h('option', { value: k, selected: opt.style === k }, v.name)));
      graphic.append(h('h2', {}, 'Graphic'), f('Title', h('input', { type: 'text', id: 'hzTitle', value: opt.title, oninput: e => { opt.title = e.target.value; titleEdited = true; } })),
        f('Subtitle', h('input', { type: 'text', id: 'hzSub', value: opt.subtitle, oninput: e => { opt.subtitle = e.target.value; subEdited = true; } })), f('Basemap', sty),
        h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', id: 'hzCreate', disabled: busy || !n || !NS.config.token, onclick: create }, busy ? 'Building…' : 'Create graphic'),
          h('span', { class: n ? 'tag ok' : 'tag warn', id: 'hzSummary' }, (opt.sel === 'all' ? 'Whole period' : shortName(opt.sel)) + ' · ' + n + ' hazard area' + (n === 1 ? '' : 's')),
          !NS.config.token ? h('span', { class: 'tag err' }, 'No Mapbox token configured') : null),
        h('p', { class: 'hint' }, 'Outlooks are public NOAA products with no SLA. Check the issue and valid times on the SPC, WPC and CPC sites before publishing. The graphic keeps the snapshot taken now; use Refresh data in Map Studio to update it.'));
    }

    async function create() {
      if (busy) return; busy = true; drawGraphic();
      try {
        const cfg = { dates: shown(), sources: opt.sources.slice(), thunder: opt.thunder }, fc = NS.Hazards.build(cfg.dates, cfg);
        if (!fc.features.length) throw new Error('No hazard areas for this selection.');
        const extent = NS.VIEWS['Lower 48'], brand = await NS.getBrand();
        const p = await NS.Templates.alertGraphic(brand, { title: opt.title || 'HAZARDS OUTLOOK', subtitle: opt.subtitle, style: opt.style === 'broadcast' && !NS.config.style ? 'dark' : opt.style,
          extent, projection: opt.style === 'broadcast' && inLower48(extent) ? 'albers' : 'mercator', data: fc, layerId: LAYER, layerCfg: cfg, category: 'weather', templateId: 'hazards-outlook',
          source: 'NOAA / NWS: SPC, WPC, CPC outlooks' });
        await NS.App.createProject(p);
      } catch (e) { toast('Could not create the graphic: ' + e.message, 'err', 9000); }
      busy = false; if (document.getElementById('hzCreate')) drawGraphic();
    }

    function cleanup() { if (popup) popup.remove(); if (scene) scene.destroy(); scene = null; ready = false; window.removeEventListener('hashchange', cleanup); }
    window.addEventListener('hashchange', cleanup);
    autoText(); drawAll(); load(false);
    return root;
  };
})();
