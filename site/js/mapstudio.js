/* Interactive Map Studio: full-screen editor for one map element's state. Everything drawn is stored as editable GeoJSON
   in mapState.features; the graphic re-renders it at export resolution. */
(function () {
  const { h, toast } = NS.ui;
  const DRAW = { marker: 'Marker', label: 'Label', line: 'Line', route: 'Route', polygon: 'Polygon', circle: 'Circle', arrow: 'Arrow', track: 'Track points' };
  const PRESET_ROLES = {
    observed: { stroke: '#E8EDF3', lineStyle: 'solid', strokeWidth: 4, fill: '#E8EDF3' },
    forecast: { stroke: '#F2B53D', lineStyle: 'dashed', strokeWidth: 4, fill: '#F2B53D' },
    cone: { stroke: '#E8EDF3', fill: '#E8EDF3', fillOpacity: 0.25, strokeWidth: 1.5, lineStyle: 'solid' }
  };
  const clone = o => JSON.parse(JSON.stringify(o));

  NS.MapStudio = {
    async open(initial, opts) {
      if (document.getElementById('mapStudio')) return;
      opts = opts || {}; const FW = opts.w || 1920, FH = opts.h || 1080;
      let state = clone(initial); state.layers = state.layers || {}; state.layerData = state.layerData || {}; state.layerOrder = state.layerOrder || []; state.toggles = state.toggles || {}; state.features = state.features || { type: 'FeatureCollection', features: [] };
      let map = null, keyH = null, changed = false, scene = null, tool = 'select', selId = null, draft = null, dragging = null, fsOn = false;
      const defaults = { stroke: '#F2453D', fill: '#F2453D', fillOpacity: 0.35, strokeWidth: 4, size: 10, lineStyle: 'solid', labelSize: 18, labelColor: '#FFFFFF' };
      const hist = [JSON.stringify(state.features)]; let hi = 0;

      const root = h('div', { id: 'mapStudio', role: 'dialog', 'aria-label': 'Map Studio' });
      const left = h('div', { id: 'msLeft' }), right = h('div', { id: 'msRight' }), mapEl = h('div', { id: 'msMap' }), frame = h('div', { id: 'msFrame', style: 'width:' + FW + 'px;height:' + FH + 'px' }, mapEl), scaler = h('div', { id: 'msScaler' }, frame), stage = h('div', { id: 'msStage' }, scaler);
      const hud = h('div', { id: 'msHud' }, '—'); stage.append(hud);
      const toolbar = h('div', { class: 'row', role: 'toolbar', 'aria-label': 'Map tools', id: 'msTools' });
      const top = h('div', { id: 'topbar' }, h('strong', {}, 'Map Studio'), h('span', { class: 'status' }, (opts.title || '') + ' · frame ' + FW + '×' + FH), h('span', { class: 'sp' }),
        h('button', { class: 'btn', id: 'msFs', onclick: () => { fsOn = !fsOn; root.classList.toggle('fs', fsOn); setTimeout(fit, 30); } }, 'Full screen'), h('button', { class: 'btn', id: 'msCancel', onclick: () => close(false) }, 'Cancel'), h('button', { class: 'btn primary', id: 'msApply', onclick: () => close(true) }, 'Apply to graphic'));
      root.append(top, h('div', { id: 'msToolsBar', style: 'padding:6px 8px;background:var(--surface-panel);border-bottom:1px solid var(--border)' }, toolbar), h('div', { id: 'msBody' }, left, stage, right));
      document.body.append(root);

      function fit() { const s = Math.min((stage.clientWidth - 24) / FW, (stage.clientHeight - 24) / FH); scaler.style.width = FW * s + 'px'; scaler.style.height = FH * s + 'px'; frame.style.transform = 'scale(' + s + ')'; frame.dataset.s = s; if (scene && scene.map) scene.map.resize(); }
      window.addEventListener('resize', fit);

      /* ---------- features ---------- */
      const feats = () => state.features.features;
      const byId = id => feats().find(f => f.properties.id === id);
      function push(msg) { changed = true; hist.length = hi + 1; hist.push(JSON.stringify(state.features)); hi = hist.length - 1; scene.setFeatures(state.features); renderRight(); }
      function undo() { if (hi > 0) { hi--; state.features = JSON.parse(hist[hi]); if (!byId(selId)) selId = null; scene.setFeatures(state.features); renderRight(); drawSel(); } }
      function redo() { if (hi < hist.length - 1) { hi++; state.features = JSON.parse(hist[hi]); scene.setFeatures(state.features); renderRight(); drawSel(); } }
      function addFeature(kind, geometry, extra) {
        const p = Object.assign({ id: NS.uid('f'), kind }, defaults, extra); if (kind === 'marker' || kind === 'label') delete p.fillOpacity;
        const f = { type: 'Feature', geometry, properties: p }; feats().push(f); push(); selectFeature(p.id); return f;
      }
      function deleteSel() { if (!selId) return; state.features.features = feats().filter(f => f.properties.id !== selId); selId = null; push(); drawSel(); }
      function selectFeature(id) { selId = id; drawSel(); renderRight(); }

      /* ---------- draft + selection layers ---------- */
      function installDraft() {
        if (!map.getSource('ns-draft')) { map.addSource('ns-draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          map.addLayer({ id: 'ns-draft-fill', type: 'fill', source: 'ns-draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#4C9BFF', 'fill-opacity': 0.2 } });
          map.addLayer({ id: 'ns-draft-line', type: 'line', source: 'ns-draft', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#4C9BFF', 'line-width': 2, 'line-dasharray': [2, 2] } });
          map.addLayer({ id: 'ns-draft-pt', type: 'circle', source: 'ns-draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#4C9BFF', 'circle-stroke-width': 2 } }); }
        if (!map.getSource('ns-sel')) { map.addSource('ns-sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          map.addLayer({ id: 'ns-sel-line', type: 'line', source: 'ns-sel', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#4C9BFF', 'line-width': 1.5, 'line-gap-width': 6, 'line-opacity': 0.7 } });
          map.addLayer({ id: 'ns-sel-handle', type: 'circle', source: 'ns-sel', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#4C9BFF', 'circle-stroke-width': 2.5 } }); }
        drawSel();
      }
      function drawDraft(cursor) {
        const src = map.getSource('ns-draft'); if (!src) return; const out = [];
        if (draft) {
          const pts = draft.pts.slice(); if (cursor && draft.kind !== 'circle') pts.push(cursor);
          if (draft.kind === 'circle' && cursor && draft.pts.length) out.push({ type: 'Feature', properties: {}, geometry: NS.geo.circlePolygon(draft.pts[0], NS.geo.distKm(draft.pts[0], cursor)) });
          else if (draft.kind === 'polygon' && pts.length > 2) out.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts.concat([pts[0]])] } });
          else if (pts.length > 1) out.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
          draft.pts.forEach(p => out.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }));
        }
        src.setData({ type: 'FeatureCollection', features: out });
      }
      function handlesFor(f) {
        const g = f.geometry, p = f.properties; if (!g) return [];
        if (p.kind === 'circle') { const c = p.center, east = [c[0] + (p.radiusKm / (111.32 * Math.cos(c[1] * Math.PI / 180))), c[1]]; return [{ pt: c, role: 'center' }, { pt: east, role: 'radius' }]; }
        if (g.type === 'Point') return [{ pt: g.coordinates, role: 'point' }];
        if (g.type === 'LineString') return g.coordinates.map((c, i) => ({ pt: c, role: 'v', i }));
        if (g.type === 'Polygon') return g.coordinates[0].slice(0, -1).map((c, i) => ({ pt: c, role: 'v', i }));
        return [];
      }
      function drawSel() {
        const src = map.getSource('ns-sel'); if (!src) return; const f = selId && byId(selId); const out = [];
        if (f) { out.push({ type: 'Feature', properties: {}, geometry: f.geometry }); handlesFor(f).forEach(hd => out.push({ type: 'Feature', properties: { role: hd.role, i: hd.i }, geometry: { type: 'Point', coordinates: hd.pt } })); }
        src.setData({ type: 'FeatureCollection', features: out });
      }

      /* ---------- interaction ---------- */
      const HIT = ['ns-pts', 'ns-line-solid', 'ns-line-dashed', 'ns-line-dotted', 'ns-fill', 'ns-labels'];
      function hit(pt) {
        const box = [[pt.x - 6, pt.y - 6], [pt.x + 6, pt.y + 6]], layers = HIT.filter(l => map.getLayer(l));
        const r = map.queryRenderedFeatures(box, { layers }); for (const f of r) { const id = f.properties.id || f.properties.parentId; if (id && byId(id)) return id; } return null;
      }
      function handleAt(pt) { const r = map.queryRenderedFeatures([[pt.x - 8, pt.y - 8], [pt.x + 8, pt.y + 8]], { layers: map.getLayer('ns-sel-handle') ? ['ns-sel-handle'] : [] }); return r.length ? r[0].properties : null; }
      function onDown(e) {
        if (tool !== 'select' || draft) return; const hd = selId && handleAt(e.point);
        if (hd) { dragging = { type: 'handle', role: hd.role, i: hd.i }; map.dragPan.disable(); return; }
        const id = hit(e.point); if (id && id === selId) { dragging = { type: 'move', last: e.lngLat, moved: false }; map.dragPan.disable(); }
      }
      function onUp() { if (dragging) { const d = dragging; dragging = null; map.dragPan.enable(); if (d.moved || d.type === 'handle' && d.moved) push(); } }
      function onMove(e) {
        if (draft) { drawDraft([e.lngLat.lng, e.lngLat.lat]); return; }
        if (!dragging) return; const f = byId(selId); if (!f) return; const p = f.properties, ll = [e.lngLat.lng, e.lngLat.lat];
        if (dragging.type === 'handle') {
          dragging.moved = true;
          if (dragging.role === 'point') f.geometry.coordinates = ll;
          else if (dragging.role === 'v') { if (f.geometry.type === 'LineString') f.geometry.coordinates[dragging.i] = ll; else { const r = f.geometry.coordinates[0]; r[dragging.i] = ll; if (dragging.i === 0) r[r.length - 1] = ll; } }
          else if (dragging.role === 'center') { p.center = ll; f.geometry = NS.geo.circlePolygon(ll, p.radiusKm); }
          else if (dragging.role === 'radius') { p.radiusKm = Math.max(0.05, NS.geo.distKm(p.center, ll)); f.geometry = NS.geo.circlePolygon(p.center, p.radiusKm); }
        } else {
          const dx = e.lngLat.lng - dragging.last.lng, dy = e.lngLat.lat - dragging.last.lat; dragging.last = e.lngLat; dragging.moved = true;
          const mv = c => [c[0] + dx, c[1] + dy], g = f.geometry;
          if (g.type === 'Point') g.coordinates = mv(g.coordinates); else if (g.type === 'LineString') g.coordinates = g.coordinates.map(mv); else g.coordinates = g.coordinates.map(r => r.map(mv));
          if (p.center) p.center = mv(p.center);
        }
        scene.setFeatures(state.features); drawSel();
      }
      function onClick(e) {
        const ll = [e.lngLat.lng, e.lngLat.lat];
        if (tool === 'select') { if (dragging) return; const id = hit(e.point); selectFeature(id); return; }
        if (tool === 'marker') { addFeature('marker', { type: 'Point', coordinates: ll }, { label: '', size: defaults.size }); return; }
        if (tool === 'label') { addFeature('label', { type: 'Point', coordinates: ll }, { label: 'Label', size: 0, labelAnchor: 'center', labelSize: 22 }); return; }
        if (tool === 'circle') { if (!draft) { draft = { kind: 'circle', pts: [ll] }; drawDraft(); } else { const km = NS.geo.distKm(draft.pts[0], ll); if (km < 0.05) return; const c = draft.pts[0]; draft = null; drawDraft(); addFeature('circle', NS.geo.circlePolygon(c, km), { center: c, radiusKm: km }); setTool('select'); } return; }
        if (['line', 'route', 'polygon', 'arrow', 'track'].includes(tool)) { if (!draft) draft = { kind: tool, pts: [] }; draft.pts.push(ll); drawDraft(ll); }
      }
      function onDbl(e) { if (draft && draft.pts.length) { e.preventDefault(); draft.pts.pop(); finishDraft(); } }
      function finishDraft() {
        if (!draft) return; const k = draft.kind, pts = draft.pts; draft = null; drawDraft();
        if (k === 'polygon') { if (pts.length < 3) { toast('A polygon needs at least 3 points.', 'err'); return; } addFeature('polygon', { type: 'Polygon', coordinates: [pts.concat([pts[0]])] }); }
        else { if (pts.length < 2) { toast('A line needs at least 2 points.', 'err'); return; } addFeature(k === 'route' ? 'route' : k, { type: 'LineString', coordinates: pts }, k === 'route' ? { lineStyle: 'dashed' } : k === 'track' ? { size: 7, pointLabels: '' } : {}); }
        setTool('select');
      }
      function setTool(t) { tool = t; draft = null; drawDraft(); mapEl.classList.toggle('draw', t !== 'select'); renderTools(); }
      function renderTools() {
        toolbar.innerHTML = ''; toolbar.append(h('button', { class: 'btn sm' + (tool === 'select' ? ' on' : ''), id: 'tool-select', onclick: () => setTool('select'), title: 'Select and edit features' }, 'Select'));
        Object.entries(DRAW).forEach(([k, l]) => toolbar.append(h('button', { class: 'btn sm' + (tool === k ? ' on' : ''), id: 'tool-' + k, onclick: () => setTool(k), title: l + (['line', 'route', 'polygon', 'arrow', 'track'].includes(k) ? ' — click points, double-click or Enter to finish' : k === 'circle' ? ' — click centre then radius' : ' — click on the map') }, l)));
        toolbar.append(h('span', { class: 'sep', style: 'width:1px;height:20px;background:var(--border);margin:0 6px' }), h('button', { class: 'btn sm', onclick: undo, title: 'Undo (Ctrl+Z)', id: 'msUndo' }, 'Undo'), h('button', { class: 'btn sm', onclick: redo, title: 'Redo', id: 'msRedo' }, 'Redo'),
          h('span', { class: 'hint', style: 'margin-left:8px' }, tool === 'select' ? 'Click a feature to edit; drag handles to reshape.' : draft ? 'Enter/double-click to finish · Esc to cancel · Backspace removes last point' : 'Click the map to draw.'));
      }

      /* ---------- left: search, view, style, layers ---------- */
      const q = { text: '', results: [], err: '' };
      const lyrUI = { text: '', onlyOn: false, open: {} };   // data-layer list UI state; survives renderLeft()
      function renderLeft() {
        left.innerHTML = '';
        const input = h('input', { type: 'search', id: 'msSearch', placeholder: 'Search city, county, state, address…', 'aria-label': 'Geographic search', value: q.text, style: 'width:100%', onkeydown: e => { if (e.key === 'Enter') doSearch(e.target.value); }, oninput: e => { q.text = e.target.value; } });
        const res = h('div', { class: 'srlist', id: 'msResults' }, q.err ? h('div', { class: 'tag err', style: 'white-space:normal' }, q.err) : q.results.map(r => h('button', { onclick: () => goto(r) }, r.name, h('small', { class: 'hint', style: 'display:block' }, r.type))));
        left.append(h('div', { class: 'sec' }, h('h4', {}, 'Search'), input, res));
        left.append(h('div', { class: 'sec' }, h('h4', {}, 'Region'), h('div', { class: 'btnrow' }, Object.keys(NS.VIEWS).map(k => h('button', { class: 'btn sm', onclick: () => { scene.fit(NS.VIEWS[k], 10); changed = true; } }, k)))));
        const ext = [0, 1, 2, 3].map(() => h('input', { type: 'number', step: 'any', style: 'width:72px' })); const b = map.getBounds(); [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].forEach((v, i) => ext[i].value = v.toFixed(3));
        left.append(h('div', { class: 'sec' }, h('h4', {}, 'Extent (W S E N)'), h('div', { class: 'btnrow' }, ext), h('div', { class: 'btnrow' }, h('button', { class: 'btn sm', id: 'msSetExtent', onclick: () => { const v = ext.map(x => parseFloat(x.value)); if (v.some(isNaN) || v[0] >= v[2] || v[1] >= v[3]) { toast('Enter a valid extent: west < east, south < north.', 'err'); return; } scene.fit([[v[0], v[1]], [v[2], v[3]]], 0); changed = true; } }, 'Fit to extent'), h('button', { class: 'btn sm', onclick: () => { map.easeTo({ bearing: 0, pitch: 0 }); } }, 'Reset north'))));
        // style
        const stSel = h('select', { id: 'msStyle', 'aria-label': 'Basemap style', onchange: async e => { state.style = e.target.value; if (state.style === 'broadcast') state.projection = 'albers'; changed = true; await applyStyle(); } }, Object.entries(NS.STYLES).filter(([k]) => k !== 'broadcast' || NS.config.style).map(([k, v]) => h('option', { value: k, selected: k === state.style }, v.name)));
        const proj = h('select', { id: 'msProj', 'aria-label': 'Projection', onchange: e => { state.projection = e.target.value; changed = true; scene.installAll(); } }, ['mercator', 'albers', 'globe'].map(p => h('option', { value: p, selected: p === state.projection }, p)));
        const cust = state.style === 'custom' ? h('input', { type: 'text', placeholder: 'mapbox://styles/user/id', value: state.customStyle, style: 'width:100%;margin-top:4px', onchange: async e => { state.customStyle = e.target.value.trim(); changed = true; await applyStyle(); } }) : null;
        left.append(h('div', { class: 'sec' }, h('h4', {}, 'Basemap'), h('div', { class: 'prop' }, h('label', {}, 'Style'), stSel), cust, h('div', { class: 'prop' }, h('label', {}, 'Projection'), proj),
          h('div', { class: 'prop' }, h('label', {}, '3D terrain'), h('label', {}, h('input', { type: 'checkbox', id: 'msTerrain', checked: state.terrain3d, disabled: state.projection === 'albers', onchange: e => { state.terrain3d = e.target.checked; changed = true; scene.applyTerrain(); if (state.terrain3d && map.getPitch() < 30) map.easeTo({ pitch: 55 }); } }), ' on (Mercator/globe only)')),
          h('div', { class: 'prop' }, h('label', {}, 'Basemap'), h('label', {}, h('input', { type: 'checkbox', id: 'msBasemap', checked: state.basemap !== false, onchange: e => { state.basemap = e.target.checked; changed = true; scene.applyToggles(); } }), ' visible (off = transparent overlay-only export)')),
          h('div', { class: 'hint' }, (NS.STYLES[state.style] || {}).note || '')));
        // layers
        const styleIds = ((map.getStyle() || {}).layers || []).map(l => l.id), tg = h('div', { class: 'sec' }, h('h4', {}, 'Basemap layers'));
        NS.STYLE_TOGGLES.forEach(t => { const avail = styleIds.some(id => !/^ns-/.test(id) && t.re.test(id)), st = NS.STYLES[state.style] || {}; const on = t.id in state.toggles ? state.toggles[t.id] : !(st.hide && st.hide.test(t.id === 'labels' ? 'label' : t.id));
          tg.append(h('label', { class: 'lyr', style: avail ? '' : 'opacity:.5' }, h('input', { type: 'checkbox', checked: on && avail, disabled: !avail, onchange: e => { state.toggles[t.id] = e.target.checked; changed = true; scene.applyToggles(); } }), h('span', {}, t.name, avail ? '' : h('small', {}, 'not in this style')), h('span'))); });
        left.append(tg);
        const groups = {}; NS.Providers.forEach(p => (groups[p.group] = groups[p.group] || []).push(p));
        const dl = h('div', { class: 'sec' }, h('h4', {}, 'Data layers'), h('div', { class: 'hint' }, 'Live layers are only shown when their source returns data. Snapshots are frozen when fetched.'));
        // Filter + collapsible groups. Filtering toggles row visibility in place (no re-render), so the search box keeps focus.
        const entries = [], gEls = [];
        const apply = () => {
          const t = lyrUI.text.trim().toLowerCase(), filtering = !!t || lyrUI.onlyOn;
          gEls.forEach(({ det, g, rows, count }) => {
            let vis = 0;
            rows.forEach(({ p, row }) => {
              const on = !!(state.layers[p.id] && state.layers[p.id].on), show = (!t || (p.name + ' ' + g + ' ' + (p.attribution || '')).toLowerCase().includes(t)) && (!lyrUI.onlyOn || on);
              row.style.display = show ? '' : 'none'; if (show) vis++;
            });
            det.style.display = vis ? '' : 'none';
            det.open = filtering ? vis > 0 : (g in lyrUI.open ? lyrUI.open[g] : rows.some(({ p }) => state.layers[p.id] && state.layers[p.id].on));
            count.textContent = filtering ? vis + ' of ' + rows.length : rows.length + (rows.filter(({ p }) => state.layers[p.id] && state.layers[p.id].on).length ? ' · ' + rows.filter(({ p }) => state.layers[p.id] && state.layers[p.id].on).length + ' on' : '');
          });
          none.style.display = gEls.some(({ det }) => det.style.display !== 'none') ? 'none' : '';
        };
        const none = h('div', { class: 'hint', style: 'display:none;margin-top:8px' }, 'No layers match.');
        dl.append(h('div', { class: 'row', style: 'gap:6px;margin-top:6px' },
          h('input', { type: 'search', id: 'lyrFilter', placeholder: 'Filter layers…', 'aria-label': 'Filter data layers', value: lyrUI.text, style: 'flex:1;min-width:0', oninput: e => { lyrUI.text = e.target.value; apply(); } }),
          h('label', { class: 'hint', style: 'white-space:nowrap' }, h('input', { type: 'checkbox', id: 'lyrOnlyOn', checked: lyrUI.onlyOn, onchange: e => { lyrUI.onlyOn = e.target.checked; apply(); } }), ' On only')));
        Object.entries(groups).forEach(([g, ps]) => {
          const count = h('small', { style: 'display:inline;margin-left:6px;font-weight:400' }), det = h('details', { class: 'lgrp' }, h('summary', { style: 'font-weight:600;cursor:pointer;margin-top:8px' }, g, count));
          det.addEventListener('toggle', () => { if (!lyrUI.text.trim() && !lyrUI.onlyOn) lyrUI.open[g] = det.open; });
          const rows = ps.map(p => { const row = layerRow(p); det.append(row); return { p, row }; });
          gEls.push({ det, g, rows, count }); dl.append(det);
        });
        dl.append(none); apply();
        left.append(dl);
        left.append(importExportSec(), savedViewsSec());
      }
      function layerRow(p) {
        const cfg = state.layers[p.id] || {}, st = NS.statusFor(state, p), tagCls = { ok: 'ok', error: 'err', stale: 'warn', loading: '', unavailable: '', idle: '', empty: 'warn', off: '' }[st.state];
        const cb = h('input', { type: 'checkbox', id: 'lyr-' + p.id, checked: !!cfg.on, disabled: p.mode === 'none', 'aria-label': p.name, onchange: async e => { state.layers[p.id] = Object.assign({ opacity: 0.85 }, state.layers[p.id], { on: e.target.checked }); const o = state.layerOrder.indexOf(p.id); if (e.target.checked && o < 0) state.layerOrder.push(p.id); if (!e.target.checked && o >= 0) state.layerOrder.splice(o, 1); changed = true;
          if (e.target.checked && p.mode.startsWith('geojson') && !state.layerData[p.id]) { await NS.fetchLayer(state, p.id, renderLeft); }
          scene.installOverlays(); renderLeft(); } });
        const row = h('div', { class: 'lyr' }, cb, h('div', {}, p.name, h('small', {}, p.attribution || ''), h('span', { class: 'tag ' + (tagCls || ''), style: 'margin-top:2px' }, st.text)),
          h('div', { class: 'row', style: 'gap:2px' }, cfg.on && p.mode.startsWith('geojson') && p.mode !== 'geojson-static' ? h('button', { class: 'btn sm', title: 'Refresh data', onclick: async () => { delete state.layerData[p.id]; await NS.fetchLayer(state, p.id, renderLeft); scene.installOverlays(); renderLeft(); } }, '⟳') : null,
            cfg.on ? [h('button', { class: 'btn sm', title: 'Move up', 'aria-label': 'Move layer up', onclick: () => moveLayer(p.id, 1) }, '↑'), h('button', { class: 'btn sm', title: 'Move down', 'aria-label': 'Move layer down', onclick: () => moveLayer(p.id, -1) }, '↓')] : null));
        if (cfg.on) row.append(h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: cfg.opacity == null ? 0.85 : cfg.opacity, 'aria-label': p.name + ' opacity', oninput: e => { cfg.opacity = +e.target.value; changed = true; scene.installOverlays(); } }));
        const det = h('details', { style: 'grid-column:2/4' }, h('summary', { class: 'hint' }, 'About this layer'), h('div', { class: 'hint' }, p.supplies, h('br'), 'Updates: ' + p.updateFreq, h('br'), 'Limitations: ' + p.limitations)); row.append(det); return row;
      }
      function moveLayer(id, dir) { const o = state.layerOrder, i = o.indexOf(id), j = i + dir; if (i < 0 || j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; changed = true; scene.installOverlays(); }
      async function applyStyle() { try { await scene.setStyle(state); } catch (e) { toast('Could not load that style: ' + e.message, 'err'); } renderLeft(); }
      async function doSearch(t) {
        q.text = t; q.err = ''; q.results = []; if (!t.trim()) return renderLeft();
        try { q.results = await NS.geocode(t, NS.config.token); if (!q.results.length) q.err = 'No results for "' + t + '".'; } catch (e) { q.err = 'Search unavailable: ' + e.message; } renderLeft();
      }
      function goto(r) { if (r.bbox) scene.fit([[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]], 30); else map.flyTo({ center: r.center, zoom: { address: 15, street: 14, place: 10, locality: 11, district: 8, region: 6, country: 4 }[r.type] || 9, duration: 600 }); changed = true; }
      function importExportSec() {
        return h('div', { class: 'sec' }, h('h4', {}, 'GeoJSON'), h('div', { class: 'btnrow' }, h('button', { class: 'btn sm', id: 'msImport', onclick: () => importGeo() }, 'Import file…'), h('button', { class: 'btn sm', onclick: () => { const b = new Blob([JSON.stringify(state.features, null, 1)], { type: 'application/geo+json' }); NS.Export.download(b, 'map-features.geojson'); } }, 'Export features')), h('div', { class: 'hint' }, 'Imported features become editable map features (max 5 MB, 5000 features).'));
      }
      function importGeo() {
        const i = h('input', { type: 'file', accept: '.geojson,.json,application/geo+json,application/json' });
        i.onchange = async () => { const f = i.files[0]; if (!f) return; try { if (f.size > 5e6) throw new Error('File is larger than 5 MB.'); const n = importGeoJSON(JSON.parse(await f.text())); toast('Imported ' + n + ' feature' + (n === 1 ? '' : 's') + '.', 'ok'); } catch (e) { toast('Import failed: ' + e.message, 'err'); } };
        i.click();
      }
      function importGeoJSON(gj) {
        let list; if (gj.type === 'FeatureCollection') list = gj.features; else if (gj.type === 'Feature') list = [gj]; else if (gj.type && gj.coordinates) list = [{ type: 'Feature', properties: {}, geometry: gj }]; else throw new Error('Not valid GeoJSON (expected FeatureCollection, Feature or geometry).');
        if (!Array.isArray(list)) throw new Error('FeatureCollection has no features array.'); if (list.length > 5000) throw new Error('More than 5000 features.');
        const out = [];
        const okc = c => Array.isArray(c) && c.length >= 2 && isFinite(c[0]) && isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
        const check = (c, d) => d === 0 ? okc(c) : Array.isArray(c) && c.every(x => check(x, d - 1));
        list.forEach(f => { if (!f || !f.geometry) return; const g = f.geometry, pr = f.properties || {};
          const parts = g.type === 'MultiPolygon' ? g.coordinates.map(c => ({ type: 'Polygon', coordinates: c })) : g.type === 'MultiLineString' ? g.coordinates.map(c => ({ type: 'LineString', coordinates: c })) : g.type === 'MultiPoint' ? g.coordinates.map(c => ({ type: 'Point', coordinates: c })) : [g];
          parts.forEach(pg => { const depth = { Point: 0, LineString: 1, Polygon: 2 }[pg.type]; if (depth == null) throw new Error('Unsupported geometry type "' + pg.type + '".'); if (!check(pg.coordinates, depth)) throw new Error('Coordinates must be [longitude, latitude] within valid ranges.');
            const kind = pg.type === 'Point' ? 'marker' : pg.type === 'LineString' ? 'line' : 'polygon';
            const p = Object.assign({}, defaults, { id: NS.uid('f'), kind, label: pr.label || pr.title || pr.name || pr.NAME || '' });
            if (pr.stroke) p.stroke = pr.stroke; if (pr['stroke-width']) p.strokeWidth = +pr['stroke-width']; if (pr.fill) p.fill = pr.fill; if (pr['marker-color']) p.fill = pr['marker-color']; if (pr['fill-opacity'] != null) p.fillOpacity = +pr['fill-opacity'];
            if (pr.nhcKind === 'cone') Object.assign(p, PRESET_ROLES.cone, { kind: 'polygon' }); else if (pr.nhcKind === 'forecastTrack') Object.assign(p, PRESET_ROLES.forecast, { kind: 'track' }); else if (pr.nhcKind === 'pastTrack') Object.assign(p, PRESET_ROLES.observed, { kind: 'track' });
            if (p.kind === 'polygon' && !pr.fill) { p.fill = defaults.fill; }
            out.push({ type: 'Feature', geometry: pg, properties: p }); }); });
        if (!out.length) throw new Error('No usable geometries found.');
        state.features.features.push(...out); push(); const b = new mapboxgl.LngLatBounds(); out.forEach(f => (function w(c) { if (typeof c[0] === 'number') b.extend(c); else c.forEach(w); })(f.geometry.coordinates)); if (!b.isEmpty()) map.fitBounds(b, { padding: 60, maxZoom: 12, duration: 400 }); return out.length;
      }
      function savedViewsSec() {
        const box = h('div', { class: 'sec' }, h('h4', {}, 'Saved map configurations'), h('div', { class: 'btnrow' }, h('button', { class: 'btn sm', id: 'msSaveCfg', onclick: async () => { const n = await NS.ui.prompt('Save map configuration', 'My map view'); if (!n) return; const st = clone(state); Object.assign(st, scene.getView()); try { await NS.Store.put('settings', { id: 'mapcfg_' + NS.uid('c'), name: n, saved: Date.now(), state: st }); toast('Map configuration saved.', 'ok'); renderLeft(); } catch (e) { toast('Could not save: ' + e.message, 'err'); } } }, 'Save current…')));
        NS.Store.all('settings').then(all => { all.filter(s => /^mapcfg_/.test(s.id)).forEach(s => box.append(h('div', { class: 'row', style: 'justify-content:space-between;margin-top:4px' }, h('span', {}, s.name), h('span', {}, h('button', { class: 'btn sm', onclick: async () => { state = Object.assign(clone(s.state), { features: state.features.features.length && !s.state.features.features.length ? state.features : s.state.features }); changed = true; await scene.setStyle(state); map.jumpTo({ center: state.center, zoom: state.zoom, bearing: state.bearing, pitch: state.pitch }); scene.refreshFeatures(); renderLeft(); } }, 'Load'), h('button', { class: 'btn sm', 'aria-label': 'Delete configuration', onclick: async () => { if (await NS.ui.confirm('Delete configuration', 'Delete "' + s.name + '"?', 'Delete', true)) { await NS.Store.del('settings', s.id); renderLeft(); } } }, '✕'))))); }).catch(() => {});
        return box;
      }

      /* ---------- right: feature properties ---------- */
      function renderRight() {
        right.innerHTML = ''; const f = selId && byId(selId), p = f ? f.properties : defaults;
        const row = (l, ...c) => h('div', { class: 'prop' }, h('label', {}, l), h('div', { class: 'ctl' }, ...c)); const ch = (k, v, live) => { p[k] = v; if (f) { scene.setFeatures(state.features); drawSel(); if (!live) push(); else changed = true; } };
        const col = (k, label) => h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(p[k] || '') ? p[k] : '#ffffff', 'aria-label': label, oninput: e => ch(k, e.target.value, true), onchange: () => f && push() });
        right.append(h('h4', { class: 'hint', style: 'text-transform:uppercase' }, f ? 'Selected: ' + (f.properties.kind) : 'Drawing style (new features)'));
        const kind = f ? f.properties.kind : null, isPoint = kind === 'marker' || kind === 'label', isLine = kind === 'line' || kind === 'route' || kind === 'arrow' || kind === 'track', isPoly = kind === 'polygon' || kind === 'circle';
        if (f) right.append(row('Label', h('input', { type: 'text', id: 'featLabel', value: p.label || '', oninput: e => ch('label', e.target.value, true), onchange: () => push() })));
        if (!f || isLine || isPoly) right.append(row('Stroke', col('stroke', 'Stroke color'), h('input', { type: 'number', min: 0, max: 40, step: 0.5, value: p.strokeWidth, 'aria-label': 'Stroke width', onchange: e => ch('strokeWidth', +e.target.value) })));
        if (!f || isPoint) right.append(row('Marker', col('fill', 'Marker fill'), col('stroke', 'Marker outline'), h('input', { type: 'number', min: 0, max: 60, value: p.size, 'aria-label': 'Marker size', onchange: e => ch('size', +e.target.value) })));
        if (!f || isPoly) right.append(row('Fill', col('fill', 'Fill color')), row('Fill opacity', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: p.fillOpacity == null ? 0.35 : p.fillOpacity, 'aria-label': 'Fill opacity', oninput: e => ch('fillOpacity', +e.target.value, true), onchange: () => f && push() })));
        if (!f || isLine || isPoly) right.append(row('Line style', h('select', { 'aria-label': 'Line style', onchange: e => ch('lineStyle', e.target.value) }, ['solid', 'dashed', 'dotted'].map(s => h('option', { value: s, selected: (p.lineStyle || 'solid') === s }, s)))));
        right.append(row('Label', col('labelColor', 'Label color'), h('input', { type: 'number', min: 8, max: 80, value: p.labelSize, 'aria-label': 'Label size', onchange: e => ch('labelSize', +e.target.value) })));
        if (f && (isLine || kind === 'polygon')) right.append(row('Style as', h('select', { 'aria-label': 'Apply role style', onchange: e => { const r = PRESET_ROLES[e.target.value]; if (r) { Object.assign(p, r); p.role = e.target.value; scene.setFeatures(state.features); push(); } } }, h('option', { value: '' }, 'Role preset…'), h('option', { value: 'observed' }, 'Observed position/track'), h('option', { value: 'forecast' }, 'Forecast track'), h('option', { value: 'cone' }, 'Forecast cone (supplied data only)'))));
        if (f && kind === 'track') right.append(h('div', { class: 'prop', style: 'grid-template-columns:1fr' }, h('label', {}, 'Point labels (one per vertex, e.g. "Thu 8 AM · 75 mph")'), h('textarea', { rows: 5, id: 'trackLabels', oninput: e => { p.pointLabels = e.target.value; scene.setFeatures(state.features); changed = true; }, onchange: () => push() }, p.pointLabels || '')));
        if (kind === 'circle') right.append(row('Radius (km)', h('input', { type: 'number', min: 0.05, step: 0.1, value: +p.radiusKm.toFixed(2), onchange: e => { p.radiusKm = Math.max(0.05, +e.target.value); f.geometry = NS.geo.circlePolygon(p.center, p.radiusKm); scene.setFeatures(state.features); drawSel(); push(); } })));
        if (f) right.append(h('div', { class: 'btnrow' }, h('button', { class: 'btn sm', id: 'featDelete', onclick: deleteSel }, 'Delete'), h('button', { class: 'btn sm', onclick: () => { const c = clone(f); c.properties.id = NS.uid('f'); const mv = x => [x[0] + 0.1, x[1] - 0.1], g = c.geometry; if (g.type === 'Point') g.coordinates = mv(g.coordinates); else if (g.type === 'LineString') g.coordinates = g.coordinates.map(mv); else g.coordinates = g.coordinates.map(r => r.map(mv)); if (c.properties.center) c.properties.center = mv(c.properties.center); feats().push(c); push(); selectFeature(c.properties.id); } }, 'Duplicate')));
        const list = h('div', { class: 'sec', id: 'featList' }, h('h4', {}, 'Features (' + feats().length + ')'));
        feats().forEach(x => list.append(h('div', { class: 'layer' + (x.properties.id === selId ? ' sel' : ''), onclick: () => selectFeature(x.properties.id) }, h('span', { class: 'nm' }, x.properties.kind + (x.properties.label ? ' · ' + x.properties.label : '')))));
        right.append(h('hr', { style: 'border:0;border-top:1px solid var(--border);margin:12px 0' }), list);
        right.append(h('div', { class: 'hint' }, 'Tropical forecast cones must come from supplied data (NHC layer or imported GeoJSON). Drawing a polygon around a track is not a forecast cone.'));
      }

      function refreshAll() { renderTools(); renderLeft(); renderRight(); }
      async function close(apply) {
        if (apply) {
          const v = scene.getView(); state.center = v.center; state.zoom = v.zoom; state.bearing = v.bearing; state.pitch = v.pitch; state.extent = v.extent; state.size = [FW, FH]; delete state.fit;
          for (const p of NS.Providers) { const c = state.layers[p.id]; if (c && c.on && p.mode === 'geojson' && !state.layerData[p.id]) { toast('Layer "' + p.name + '" has no data, so it will be omitted until it loads.', 'err'); } }
          opts.onApply && opts.onApply(state);
        } else if (changed && !(await NS.ui.confirm('Discard map changes?', 'Close Map Studio without applying your changes?', 'Discard', true))) return;
        window.removeEventListener('resize', fit); window.removeEventListener('mouseup', onUp); window.removeEventListener('keydown', keyH); scene.destroy(); root.remove();
      }
      async function boot() {
      try { scene = new NS.MapScene(mapEl, { interactive: true, onError: m => { hud.title = m; } }); await scene.init(state); } catch (e) { toast(e.message, 'err'); root.remove(); window.removeEventListener('resize', fit); return false; }
      map = scene.map; scene.onInstall = () => { installDraft(); renderLeft(); };
      map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right'); map.addControl(new mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-right');
      fit(); map.resize(); if (!state.fit && state.size && state.extent && (state.size[0] !== FW || state.size[1] !== FH)) scene.fit(state.extent, 0);
      installDraft(); refreshAll();
      map.on('mousemove', e => { hud.textContent = e.lngLat.lat.toFixed(4) + ', ' + e.lngLat.lng.toFixed(4) + ' · z' + map.getZoom().toFixed(2) + ' · brg ' + Math.round(map.getBearing()) + '° · pitch ' + Math.round(map.getPitch()) + '°'; onMove(e); });
      map.on('click', onClick); map.on('dblclick', onDbl); map.on('mousedown', onDown); window.addEventListener('mouseup', onUp);
      keyH = e => { if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName)) return; if (document.querySelector('dialog[open]')) return;
        if (e.key === 'Escape') { if (draft) { draft = null; drawDraft(); } else selectFeature(null); } else if (e.key === 'Enter' && draft) finishDraft(); else if (e.key === 'Backspace' && draft) { e.preventDefault(); draft.pts.pop(); if (!draft.pts.length) draft = null; drawDraft(); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && selId) { e.preventDefault(); deleteSel(); } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); } };
      window.addEventListener('keydown', keyH);
        return true;
      }
      if (!(await boot())) return;
      NS.MapStudio.current = { get state() { return state; }, scene, map, importGeoJSON, setTool, close, get selId() { return selId; } };
    }
  };
})();
