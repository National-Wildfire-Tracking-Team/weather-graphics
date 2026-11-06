/* App shell: navigation, dashboard, galleries, projects, assets, brand, export center. */
(function () {
  const { h, toast } = NS.ui;
  const NAV = [
    ['dashboard', 'Dashboard'], ['studio', 'Graphics Studio'], ['map', 'Interactive Map Studio'], ['sep', 'Workspaces'],
    ['weather', 'Weather Graphics'], ['alerts', 'NWS Alert Graphics'], ['hazards', 'Week-Ahead Hazards'], ['news', 'Breaking News Graphics'], ['broadcast', 'Broadcast Graphics'], ['social', 'Social Media Graphics'], ['sep', 'Library'],
    ['templates', 'Template Library'], ['assets', 'Asset Library'], ['projects', 'Saved Projects'], ['sep', 'Settings'], ['brand', 'Brand Settings'], ['exports', 'Export Center'], ['sep', 'Tools'], ['ext:plate-builder.html', 'Plate Builder (counties)']
  ];
  // Top-level tabs. Every route not owned by another tab belongs to Graphics Studio (sidebar visible).
  const TABS = [['studio-home', 'Graphics Studio', '#/dashboard'], ['headlines', 'WX Headlines', '#/headlines'], ['resources', 'Resources', '#/resources']];
  const tabOf = route => TABS.some(t => t[0] === route) ? route : 'studio-home';
  const main = document.getElementById('main'), nav = document.getElementById('nav'), tabs = document.getElementById('tabs'), appEl = document.getElementById('app');
  const App = NS.App = { editor: null };
  NS.assetMeta = new Map();
  NS.assetsReady = Promise.resolve();

  async function loadAssets() {
    try { const all = await NS.Store.all('assets'); all.forEach(a => { NS.assetMeta.set(a.id, a); NS.assetCache.set(a.id, a.dataUrl); }); } catch (e) { toast('Storage unavailable: ' + e.message + '. Projects cannot be saved in this browser session.', 'err', 10000); }
  }
  async function settings(id, fb) { try { return (await NS.Store.get('settings', id)) || fb; } catch (e) { return fb; } }
  const favs = { ids: [] };
  async function bump(key) { try { const u = await settings('usage', { id: 'usage', counts: {} }); u.counts[key] = (u.counts[key] || 0) + 1; await NS.Store.put('settings', u); } catch (e) {} }

  /* ---------- project creation ---------- */
  function fixLogos(p) {
    (function w(arr) { arr.forEach(o => { if (o.kind === 'logo' && o.assetId) { const a = NS.assetMeta.get(o.assetId); if (a) { const k = o.height / a.h; Object.assign(o, { type: 'image', version: fabric.version, width: a.w, height: a.h, scaleX: k, scaleY: k, src: 'asset:' + a.id, crop: { l: 0, t: 0, r: 0, b: 0 }, fill: 'rgb(0,0,0)', rx: undefined, ry: undefined, cropX: 0, cropY: 0 }); } } }); })(p.objects);
  }
  App.createProject = async function (p, extra) {
    try { p.thumb = await NS.Export.thumbnail(p, 360); await NS.Store.put('projects', p); } catch (e) { toast('Could not create project: ' + e.message, 'err'); return; }
    if (extra && extra.openMap) sessionStorage.setItem('nsgs.openMap', p.id);
    location.hash = '#/edit/' + p.id;
  };
  App.newFromTemplate = async function (id) {
    const brand = await NS.getBrand(); let p;
    const t = NS.Templates.list.find(x => x.id === id);
    if (t) p = await NS.Templates.instantiate(t, brand);
    else { const ut = await NS.Store.get('templates', id); if (!ut) { toast('Template not found.', 'err'); return; } p = NS.blankProject(ut.w, ut.h, ut.name, ut.category); Object.assign(p, JSON.parse(JSON.stringify(ut.data)), { templateId: ut.id, name: ut.name.replace(/ template$/i, '') }); p.id = NS.uid('prj'); (function w(a) { a.forEach(o => { o.id = NS.uid('o'); w(o.objects || []); }); })(p.objects); }
    fixLogos(p); bump('tpl:' + id); await App.createProject(p);
  };
  App.newBlank = async function (w, hh, name, bg) {
    const p = NS.blankProject(w, hh, name || 'Untitled graphic'); if (bg) p.canvas.bg = bg; bump('blank'); await App.createProject(p);
  };

  /* ---------- helpers ---------- */
  const thumbCache = new Map();
  async function tplThumb(t, el) {
    if (t.thumb) { el.style.backgroundImage = 'url(' + t.thumb + ')'; return; }
    if (thumbCache.has(t.id)) { el.style.backgroundImage = 'url(' + thumbCache.get(t.id) + ')'; return; }
    try { const brand = await NS.getBrand(); const p = await NS.Templates.instantiate(t, brand); fixLogos(p); const u = await NS.Export.thumbnail(p, 360); if (u) { thumbCache.set(t.id, u); el.style.backgroundImage = 'url(' + u + ')'; } } catch (e) { el.textContent = 'No preview'; }
  }
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); e.target._load && e.target._load(); } }), { rootMargin: '200px' }) : null;
  function lazyThumb(el, t) { el._load = () => tplThumb(t, el); io ? io.observe(el) : el._load(); }
  const catName = id => (NS.TEMPLATE_CATS.find(c => c[0] === id) || [0, id])[1];

  /* ---------- views ---------- */
  const views = {};
  views.dashboard = async () => {
    const root = h('div', {}, h('h1', {}, 'Dashboard'), h('p', { class: 'sub' }, 'Start a graphic, pick up a recent project, or open a favorite template.'));
    const projects = (await NS.Store.all('projects').catch(() => [])).sort((a, b) => b.updated - a.updated);
    const usage = await settings('usage', { counts: {} }); const f = await settings('favorites', { ids: [] });
    root.append(h('h2', {}, 'Create new'), h('div', { class: 'row' }, [['Blank 1920×1080', () => App.newBlank(1920, 1080)], ['Map graphic', () => location.hash = '#/map'], ['Tornado warning', () => App.newFromTemplate('sv-tornado')], ['Breaking news', () => App.newFromTemplate('bn-breaking')], ['Lower third', () => App.newFromTemplate('bc-lower3')], ['Instagram story', () => App.newFromTemplate('so-story')]].map(([l, fn]) => h('button', { class: 'btn', onclick: fn }, l))));
    root.append(h('h2', {}, 'Recent projects'));
    root.append(projects.length ? h('div', { class: 'grid' }, projects.slice(0, 6).map(projectCard)) : h('div', { class: 'empty' }, 'No saved projects yet. Create one above or start from a template.'));
    const fav = [...NS.Templates.list.filter(t => f.ids.includes(t.id))]; const ut = (await NS.Store.all('templates').catch(() => [])).filter(t => f.ids.includes(t.id)); const favs2 = fav.concat(ut);
    root.append(h('h2', {}, 'Favorite templates'), favs2.length ? h('div', { class: 'grid' }, favs2.slice(0, 6).map(t => tplCard(t, f))) : h('div', { class: 'empty' }, 'Star a template in the Template Library to pin it here.'));
    const counts = Object.entries(usage.counts || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
    root.append(h('h2', {}, 'Frequently used'), counts.length ? h('div', { class: 'row' }, counts.map(([k, n]) => { const id = k.replace(/^tpl:/, ''), t = NS.Templates.list.find(x => x.id === id); return k === 'blank' ? h('button', { class: 'btn', onclick: () => App.newBlank(1920, 1080) }, 'Blank graphic · ' + n) : t ? h('button', { class: 'btn', onclick: () => App.newFromTemplate(id) }, t.name + ' · ' + n) : null; })) : h('div', { class: 'hint' }, 'Your most used templates and tools will show up here.'));
    root.append(h('h2', {}, 'Storage'), h('p', { class: 'hint' }, 'Projects, templates and assets are stored locally in this browser (IndexedDB). They are not shared with teammates or other devices. Use Export Center or Saved Projects → Export file to move work between machines.'));
    return root;
  };

  function projectCard(p) {
    const card = h('div', { class: 'tile' }, h('a', { href: '#/edit/' + p.id, style: 'display:block;text-decoration:none;color:inherit' }, h('div', { class: 'thumb', style: p.thumb ? 'background-image:url(' + p.thumb + ')' : '' }, p.thumb ? '' : 'No preview'), h('div', { class: 'meta' }, h('b', {}, p.name), h('span', {}, catName(p.category) + ' · ' + p.canvas.w + '×' + p.canvas.h), h('span', {}, 'Edited ' + NS.ui.fmtDate(p.updated)))));
    card.append(h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => location.hash = '#/edit/' + p.id }, 'Open'),
      h('button', { class: 'btn sm', onclick: async () => { const c = JSON.parse(JSON.stringify(p)); c.id = NS.uid('prj'); c.name = p.name + ' (copy)'; c.created = c.updated = Date.now(); c.versions = []; try { await NS.Store.put('projects', c); toast('Duplicated.', 'ok'); render(); } catch (e) { toast(e.message, 'err'); } } }, 'Duplicate'),
      h('button', { class: 'btn sm', onclick: async () => { const n = await NS.ui.prompt('Rename project', p.name); if (n) { p.name = n; await NS.Store.put('projects', p); render(); } } }, 'Rename'),
      h('button', { class: 'btn sm', onclick: async () => NS.ui.download(await NS.Export.projectFile(p), (p.name || 'project').replace(/[^\w-]+/g, '_') + '.nsgs.json') }, 'Export file'),
      h('button', { class: 'btn sm danger', onclick: async () => { if (await NS.ui.confirm('Delete project', 'Delete "' + p.name + '"? This cannot be undone.', 'Delete', true)) { await NS.Store.del('projects', p.id); toast('Project deleted.', 'ok'); render(); } } }, 'Delete')));
    return card;
  }
  function tplCard(t, f) {
    const isFav = f.ids.includes(t.id), th = h('div', { class: 'thumb' });
    const card = h('div', { class: 'tile' }, th, h('div', { class: 'meta' }, h('b', {}, t.name), h('span', {}, catName(t.category) + ' · ' + t.w + '×' + t.h + (t.user ? ' · ' + (t.collection || 'My templates') : '')), h('span', {}, t.desc || '')));
    t.thumb ? th.style.backgroundImage = 'url(' + t.thumb + ')' : lazyThumb(th, t);
    card.append(h('div', { class: 'acts' }, h('button', { class: 'btn sm primary', onclick: () => App.newFromTemplate(t.id) }, 'Use template'),
      h('button', { class: 'btn sm', 'aria-pressed': isFav, title: isFav ? 'Remove favorite' : 'Favorite', onclick: async () => { f.ids = isFav ? f.ids.filter(x => x !== t.id) : f.ids.concat(t.id); await NS.Store.put('settings', { id: 'favorites', ids: f.ids }); render(); } }, isFav ? '★ Favorite' : '☆ Favorite'),
      t.user ? [h('button', { class: 'btn sm', onclick: async () => { const c = JSON.parse(JSON.stringify(t)); c.id = NS.uid('tpl'); c.name = t.name + ' (copy)'; c.created = Date.now(); await NS.Store.put('templates', c); render(); } }, 'Duplicate'),
        h('button', { class: 'btn sm', onclick: async () => { const n = await NS.ui.prompt('Collection name', t.collection || 'My templates'); if (n) { t.collection = n; await NS.Store.put('templates', t); render(); } } }, 'Collection…'),
        h('button', { class: 'btn sm', onclick: async () => { const n = await NS.ui.prompt('Rename template', t.name); if (n) { t.name = n; await NS.Store.put('templates', t); render(); } } }, 'Rename'),
        h('button', { class: 'btn sm danger', onclick: async () => { if (await NS.ui.confirm('Delete template', 'Delete template "' + t.name + '"? Projects made from it are not affected.', 'Delete', true)) { await NS.Store.del('templates', t.id); render(); } } }, 'Delete')] : null));
    return card;
  }
  async function gallery(title, sub, cats, extra) {
    const root = h('div', {}, h('h1', {}, title), h('p', { class: 'sub' }, sub)); if (extra) root.append(extra);
    const f = await settings('favorites', { id: 'favorites', ids: [] }); const ut = await NS.Store.all('templates').catch(() => []);
    let all = NS.Templates.list.concat(ut), q = '', cat = cats && cats.length === 1 ? cats[0] : 'all', favOnly = false, coll = 'all';
    const colls = ['all', ...new Set(ut.map(t => t.collection || 'My templates'))];
    const grid = h('div', { class: 'grid', id: 'tplGrid' });
    const bar = h('div', { class: 'bar' });
    const draw = () => {
      bar.innerHTML = ''; bar.append(h('input', { type: 'search', placeholder: 'Search templates by keyword', 'aria-label': 'Search templates', value: q, id: 'tplSearch', oninput: e => { q = e.target.value; list(); } }));
      const cl = cats && cats.length ? cats : NS.TEMPLATE_CATS.map(c => c[0]);
      if (!cats || cats.length > 1) { bar.append(h('button', { class: 'chip' + (cat === 'all' ? ' on' : ''), onclick: () => { cat = 'all'; draw(); list(); } }, 'All')); cl.forEach(c => bar.append(h('button', { class: 'chip' + (cat === c ? ' on' : ''), onclick: () => { cat = c; draw(); list(); } }, catName(c)))); }
      bar.append(h('button', { class: 'chip' + (favOnly ? ' on' : ''), onclick: () => { favOnly = !favOnly; draw(); list(); } }, '★ Favorites'));
      if (colls.length > 1) bar.append(h('select', { 'aria-label': 'Collection', onchange: e => { coll = e.target.value; list(); } }, colls.map(c => h('option', { value: c, selected: c === coll }, c === 'all' ? 'All collections' : c))));
    };
    const list = () => {
      grid.innerHTML = ''; const lq = q.toLowerCase();
      const r = all.filter(t => (!cats || !cats.length || cats.includes(t.category) || t.user) && (cat === 'all' || t.category === cat) && (!favOnly || f.ids.includes(t.id)) && (coll === 'all' || (t.collection || 'My templates') === coll) && (!lq || (t.name + ' ' + (t.desc || '') + ' ' + (t.tags || []).join(' ') + ' ' + catName(t.category)).toLowerCase().includes(lq)));
      r.forEach(t => grid.append(tplCard(t, f))); if (!r.length) grid.append(h('div', { class: 'empty' }, 'No templates match.'));
    };
    draw(); list(); root.append(bar, grid); return root;
  }
  views.weather = () => gallery('Weather Graphics', 'Forecast panels, weather maps, severe weather and tropical templates. Sample content is flagged and must be replaced before publishing; live layers only appear when their source returns data.', ['weather', 'severe', 'tropical'], h('div', { class: 'hint', style: 'margin-bottom:10px' }, 'Controls for forecast/valid time, units, legend, attribution, title and accent colour are in each project\'s Fields tab; map layers and region are in Map Studio.'));
  views.alerts = () => NS.AlertsView();
  views.hazards = () => NS.HazardsView();
  views.news = () => gallery('Breaking News Graphics', 'Full-screen headline, alert, location and chart graphics. Edit headlines and fields without rebuilding the design.', ['breaking', 'safety', 'general']);
  views.broadcast = () => gallery('Broadcast Graphics', 'Lower thirds, bugs, straps, cards and presenter overlays. Transparent templates export as true transparent PNG.', ['broadcast']);
  views.social = () => gallery('Social Media Graphics', 'Facebook, Instagram, YouTube, X and web formats. Use Canvas → "Create variant" inside a project to make another aspect ratio without touching the original.', ['social']);
  views.templates = () => gallery('Template Library', 'All templates, including the ones you saved from projects.', null);

  views.studio = async () => {
    const root = h('div', {}, h('h1', {}, 'Graphics Studio'), h('p', { class: 'sub' }, 'Start a blank graphic at a preset size, or choose custom dimensions.'));
    const grid = h('div', { class: 'grid' }, NS.PRESETS.map(p => h('button', { class: 'tile', style: 'padding:12px;gap:6px;cursor:pointer', onclick: () => App.newBlank(p.w, p.h, 'Untitled ' + p.w + '×' + p.h) }, h('b', {}, p.name), h('span', { class: 'hint' }, p.note), h('div', { style: 'height:70px;display:flex;align-items:center' }, h('div', { style: 'border:1px solid var(--border-strong);background:var(--surface-raised);width:' + (p.w >= p.h ? 100 : 100 * p.w / p.h * 0.7) + 'px;aspect-ratio:' + p.w + '/' + p.h }))))); root.append(grid);
    const w = h('input', { type: 'number', value: 1920, min: 64, max: 8192, 'aria-label': 'Custom width' }), hh = h('input', { type: 'number', value: 1080, min: 64, max: 8192, 'aria-label': 'Custom height' }), tr = h('input', { type: 'checkbox' }), bg = h('input', { type: 'color', value: '#1A2230', 'aria-label': 'Background' });
    root.append(h('h2', {}, 'Custom size'), h('div', { class: 'row' }, w, '×', hh, 'px', h('label', {}, bg, ' background'), h('label', {}, tr, ' transparent'), h('button', { class: 'btn primary', id: 'createCustom', onclick: () => { const W = +w.value, H = +hh.value; if (!(W >= 64 && W <= 8192 && H >= 64 && H <= 8192)) { toast('Width and height must be between 64 and 8192.', 'err'); return; } App.newBlank(W, H, 'Untitled ' + W + '×' + H, { transparent: tr.checked, color: bg.value }); } }, 'Create')));
    return root;
  };
  views.map = async () => {
    const root = h('div', {}, h('h1', {}, 'Interactive Map Studio'), h('p', { class: 'sub' }, 'Create a map-first graphic: choose a region, basemap and canvas size, then pan, search, add layers and draw. The map stays an editable element you can compose with text, legends and logos.'));
    if (!NS.config.token) root.append(h('div', { class: 'tag err', style: 'display:block;white-space:normal;margin-bottom:10px' }, 'No Mapbox token is configured. Add one under Brand Settings → Map settings (or in site/config.json).'));
    const reg = h('select', { id: 'mapRegion', 'aria-label': 'Region' }, Object.keys(NS.VIEWS).map(k => h('option', { value: k }, k))), st = h('select', { id: 'mapStyle', 'aria-label': 'Basemap' }, Object.entries(NS.STYLES).filter(([k]) => k !== 'custom' && (k !== 'broadcast' || NS.config.style)).map(([k, v]) => h('option', { value: k }, v.name))), sz = h('select', { id: 'mapSize', 'aria-label': 'Canvas size' }, NS.PRESETS.map(p => h('option', { value: p.id }, p.name)));
    root.append(h('div', { class: 'row' }, h('label', {}, 'Region ', reg), h('label', {}, 'Basemap ', st), h('label', {}, 'Canvas ', sz), h('button', { class: 'btn primary', id: 'createMap', disabled: !NS.config.token, onclick: async () => {
      const pr = NS.PRESETS.find(x => x.id === sz.value), s = NS.defaultMapState(reg.value); s.style = st.value; s.projection = st.value === 'broadcast' || reg.value === 'Lower 48' ? 'albers' : 'mercator';
      const p = NS.blankProject(pr.w, pr.h, 'Map — ' + reg.value, 'weather'); p.canvas.bg.color = '#1A2230'; s.size = [pr.w, pr.h];
      const m = new fabric.MapFrame({ left: 0, top: 0, width: pr.w, height: pr.h, mapState: s, name: 'Map', id: NS.uid('o') }); p.objects.push(m.toObject(NS.PROPS)); bump('map'); await App.createProject(p, { openMap: true }); } }, 'Create map graphic')));
    root.append(h('h2', {}, 'Data layers and sources'), h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Layer', 'Source', 'Update', 'Status in this build'].map(x => h('th', {}, x)))), h('tbody', {}, NS.Providers.map(p => h('tr', {}, h('td', {}, p.name), h('td', {}, p.attribution || '—'), h('td', {}, p.updateFreq), h('td', {}, p.mode === 'none' ? h('span', { class: 'tag' }, 'Not configured') : h('span', { class: 'tag ok' }, 'Available (fetched on demand)')))))));
    return root;
  };
  views.projects = async () => {
    const root = h('div', {}, h('h1', {}, 'Saved Projects')); let all = await NS.Store.all('projects').catch(() => []); let q = '', cat = 'all', sort = 'updated';
    const grid = h('div', { class: 'grid', id: 'projGrid' });
    const draw = () => { grid.innerHTML = ''; let r = all.filter(p => (cat === 'all' || p.category === cat) && (!q || p.name.toLowerCase().includes(q.toLowerCase()))); r.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : b.updated - a.updated); r.forEach(p => grid.append(projectCard(p))); if (!r.length) grid.append(h('div', { class: 'empty' }, all.length ? 'No projects match.' : 'No saved projects yet.')); };
    const imp = h('button', { class: 'btn', id: 'importProject', onclick: () => { const i = h('input', { type: 'file', accept: '.json,application/json' }); i.onchange = async () => { try { const d = JSON.parse(await i.files[0].text()); if (d.format !== 'newsroom-graphics-studio-project') throw new Error('Not a Newsroom Graphics Studio project file.'); for (const a of d.assets || []) { await NS.Store.put('assets', a); NS.assetMeta.set(a.id, a); NS.assetCache.set(a.id, a.dataUrl); } d.project.id = NS.uid('prj'); d.project.name += ' (imported)'; await NS.Store.put('projects', d.project); toast('Project imported.', 'ok'); render(); } catch (e) { toast('Import failed: ' + e.message, 'err'); } }; i.click(); } }, 'Import project file…');
    root.append(h('div', { class: 'bar' }, h('input', { type: 'search', placeholder: 'Search projects', 'aria-label': 'Search projects', oninput: e => { q = e.target.value; draw(); } }), h('select', { 'aria-label': 'Category', onchange: e => { cat = e.target.value; draw(); } }, h('option', { value: 'all' }, 'All categories'), NS.TEMPLATE_CATS.map(c => h('option', { value: c[0] }, c[1]))), h('select', { 'aria-label': 'Sort', onchange: e => { sort = e.target.value; draw(); } }, h('option', { value: 'updated' }, 'Last edited'), h('option', { value: 'name' }, 'Name')), imp), grid); draw(); return root;
  };
  views.assets = async () => {
    const root = h('div', {}, h('h1', {}, 'Asset Library'), h('p', { class: 'sub' }, 'Images, logos and approved photographs, stored in this browser. Replace an asset to update every project that uses it.'));
    let q = '', coll = 'all'; const grid = h('div', { class: 'grid', id: 'assetGrid' });
    const used = async id => { const ps = await NS.Store.all('projects'); return ps.filter(p => JSON.stringify(p.objects).includes('"' + id + '"')).map(p => p.name); };
    const draw = () => { grid.innerHTML = ''; const r = [...NS.assetMeta.values()].filter(a => (coll === 'all' || a.collection === coll) && (!q || (a.name + ' ' + (a.collection || '')).toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.created - a.created);
      r.forEach(a => grid.append(h('div', { class: 'tile' }, h('div', { class: 'thumb', style: 'background-image:url(' + a.dataUrl + ')' }), h('div', { class: 'meta' }, h('b', {}, a.name), h('span', {}, (a.collection || 'Uploads') + ' · ' + a.w + '×' + a.h)),
        h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: async () => { const n = await NS.ui.prompt('Rename asset', a.name); if (n) { a.name = n; await NS.Store.put('assets', a); draw(); } } }, 'Rename'), h('button', { class: 'btn sm', onclick: async () => { const n = await NS.ui.prompt('Collection', a.collection || 'Uploads'); if (n) { a.collection = n; await NS.Store.put('assets', a); render(); } } }, 'Collection…'),
          h('button', { class: 'btn sm', onclick: () => { const i = h('input', { type: 'file', accept: 'image/*' }); i.onchange = async () => { try { const f = i.files[0]; const url = await NS.ui.fileToDataURL(f), im = await NS.ui.loadImage(url); Object.assign(a, { dataUrl: url, w: im.naturalWidth, h: im.naturalHeight, type: f.type }); await NS.Store.put('assets', a); NS.assetCache.set(a.id, url); toast('Asset replaced. Projects using it will show the new image when reopened.', 'ok'); draw(); } catch (e) { toast(e.message, 'err'); } }; i.click(); } }, 'Replace'),
          h('button', { class: 'btn sm danger', onclick: async () => { const u = await used(a.id); if (await NS.ui.confirm('Delete asset', u.length ? '"' + a.name + '" is used by: ' + u.join(', ') + '. Those images will be missing. Delete anyway?' : 'Delete "' + a.name + '"?', 'Delete', true)) { await NS.Store.del('assets', a.id); NS.assetMeta.delete(a.id); NS.assetCache.delete(a.id); draw(); } } }, 'Delete'))))); if (!r.length) grid.append(h('div', { class: 'empty' }, 'No assets.')); };
    const up = h('button', { class: 'btn primary', id: 'assetUpload', onclick: () => { const i = h('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml' }); i.onchange = async () => { for (const f of i.files) { try { await addAsset(f, coll === 'all' ? 'Uploads' : coll); } catch (e) { toast(e.message, 'err'); } } render(); }; i.click(); } }, 'Upload…');
    const colls = ['all', ...new Set([...NS.assetMeta.values()].map(a => a.collection || 'Uploads'))];
    root.append(h('div', { class: 'bar' }, h('input', { type: 'search', placeholder: 'Search assets', 'aria-label': 'Search assets', oninput: e => { q = e.target.value; draw(); } }), h('select', { 'aria-label': 'Collection', onchange: e => { coll = e.target.value; draw(); } }, colls.map(c => h('option', { value: c }, c === 'all' ? 'All collections' : c))), up), grid); draw(); return root;
  };
  async function addAsset(file, collection) {
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.type)) throw new Error('Unsupported file type "' + (file.type || 'unknown') + '".'); if (file.size > 20e6) throw new Error('"' + file.name + '" is larger than 20 MB.');
    let url = await NS.ui.fileToDataURL(file), im = await NS.ui.loadImage(url), w = im.naturalWidth, hh = im.naturalHeight; if (Math.max(w, hh) > 4096 && file.type !== 'image/svg+xml') { const k = 4096 / Math.max(w, hh), c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); url = c.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92); w = c.width; hh = c.height; }
    const a = { id: NS.uid('ast'), name: file.name.replace(/\.[^.]+$/, ''), type: file.type, w, h: hh, dataUrl: url, collection: collection || 'Uploads', created: Date.now() }; await NS.Store.put('assets', a); NS.assetMeta.set(a.id, a); NS.assetCache.set(a.id, url); return a;
  }
  views.brand = async () => {
    const b = await NS.getBrand(), root = h('div', {}, h('h1', {}, 'Brand Settings'), h('p', { class: 'sub' }, 'Used by new projects created from templates. Existing projects keep the colours and fonts they were made with. There is no sign-in in this build, so anyone with access to this browser can edit brand settings.'));
    const f = (l, ctl) => h('div', { class: 'prop', style: 'max-width:620px;grid-template-columns:150px 1fr' }, h('label', {}, l), ctl);
    const org = h('input', { type: 'text', value: b.orgName, id: 'brandOrg' }), tag = h('input', { type: 'text', value: b.tagline || '' }), attr = h('input', { type: 'text', value: b.attribution || '' });
    const fonts = {}; ['display', 'body', 'mono'].forEach(k => fonts[k] = h('select', { 'aria-label': k + ' font' }, NS.FONTS.map(x => h('option', { value: x, selected: x === b.fonts[k] }, x))));
    const colors = b.colors.map(c => ({ ...c })); const cbox = h('div', {}); const drawColors = () => { cbox.innerHTML = ''; colors.forEach((c, i) => cbox.append(h('div', { class: 'row', style: 'margin-bottom:4px' }, h('input', { type: 'color', value: c.hex, 'aria-label': c.name + ' color', oninput: e => c.hex = e.target.value }), h('input', { type: 'text', value: c.name, 'aria-label': 'Color name', oninput: e => c.name = e.target.value }), h('button', { class: 'btn sm', onclick: () => { colors.splice(i, 1); drawColors(); } }, '✕')))); cbox.append(h('button', { class: 'btn sm', onclick: () => { colors.push({ name: 'Color ' + (colors.length + 1), hex: '#888888' }); drawColors(); } }, 'Add color')); }; drawColors();
    const logoSel = {}; ['primary', 'dark', 'mark'].forEach(k => { logoSel[k] = h('select', { 'aria-label': k + ' logo' }, h('option', { value: '' }, '— none —'), [...NS.assetMeta.values()].map(a => h('option', { value: a.id, selected: b.logos[k] === a.id }, a.name))); });
    const sizeSel = h('select', {}, NS.PRESETS.map(p => h('option', { value: p.id, selected: p.id === b.defaultSize }, p.name))), fmtSel = h('select', {}, ['png', 'jpeg'].map(x => h('option', { value: x, selected: x === b.defaultFormat }, x.toUpperCase()))), scSel = h('select', {}, [1, 2].map(x => h('option', { value: x, selected: x === b.defaultScale }, x + '×')));
    root.append(f('Organization name', org), f('Tagline', tag), f('Default attribution', attr), f('Display font', fonts.display), f('Body font', fonts.body), f('Mono font', fonts.mono), f('Brand colors', cbox));
    root.append(h('h2', {}, 'Logos'), h('p', { class: 'hint' }, 'Upload logos in the Asset Library, then select them here. Templates place the logo automatically; with none selected, the organization name is used as a wordmark.'), f('Primary logo', logoSel.primary), f('Dark-background logo', logoSel.dark), f('Logo mark / bug', logoSel.mark), h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => { const i = h('input', { type: 'file', accept: 'image/*' }); i.onchange = async () => { try { await addAsset(i.files[0], 'Logos'); toast('Uploaded to Logos. Reopen this page to select it.', 'ok'); render(); } catch (e) { toast(e.message, 'err'); } }; i.click(); } }, 'Upload logo…')));
    root.append(h('h2', {}, 'Export defaults'), f('Default canvas', sizeSel), f('Default format', fmtSel), f('Default scale', scSel));
    root.append(h('h2', {}, 'Map settings'), h('p', { class: 'hint' }, 'Mapbox GL JS needs a public access token (pk.…) restricted to your site URL in your Mapbox account. Never paste a secret token (sk.…). If site/config.json supplies a token, that takes precedence here.'));
    const ms = await settings('map', { id: 'map' }); const tok = h('input', { type: 'text', id: 'mapToken', value: ms.token || '', placeholder: NS.config.token ? 'Using token from config.json' : 'pk.…' }), sty = h('input', { type: 'text', value: ms.style || '', placeholder: 'mapbox://styles/user/styleid (optional)' });
    root.append(f('Mapbox public token', tok), f('Custom style URL', sty));
    root.append(h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { class: 'btn primary', id: 'brandSave', onclick: async () => {
      if (/^sk\./.test(tok.value.trim())) { toast('That looks like a secret token (sk.). Use a public pk. token.', 'err'); return; }
      try { const nb = Object.assign({}, b, { orgName: org.value, tagline: tag.value, attribution: attr.value, colors, fonts: { ...b.fonts, display: fonts.display.value, body: fonts.body.value, mono: fonts.mono.value }, logos: { primary: logoSel.primary.value || null, dark: logoSel.dark.value || null, mark: logoSel.mark.value || null }, defaultSize: sizeSel.value, defaultFormat: fmtSel.value, defaultScale: +scSel.value });
        await NS.Store.put('settings', nb); await NS.Store.put('settings', { id: 'map', token: tok.value.trim(), style: sty.value.trim() }); if (tok.value.trim() && !NS.config.token) NS.config.token = tok.value.trim(); document.getElementById('orgName').textContent = (nb.orgName || 'Newsroom').toUpperCase(); toast('Brand settings saved.', 'ok'); } catch (e) { toast('Could not save: ' + e.message, 'err'); } } }, 'Save brand settings')));
    return root;
  };
  views.headlines = () => NS.HeadlinesView();
  views.resources = () => NS.ResourcesView();
  views.exports = async () => {
    const root = h('div', {}, h('h1', {}, 'Export Center'), h('p', { class: 'sub' }, 'Render any saved project at full resolution without opening the editor, and review recent exports. Files are verified (decoded size and transparency) before download.'));
    const ps = (await NS.Store.all('projects').catch(() => [])).sort((a, b) => b.updated - a.updated);
    const sel = h('select', { id: 'exportProject', 'aria-label': 'Project' }, ps.map(p => h('option', { value: p.id }, p.name + ' (' + p.canvas.w + '×' + p.canvas.h + ')')));
    root.append(h('div', { class: 'bar' }, sel, h('button', { class: 'btn primary', id: 'exportOpen', disabled: !ps.length, onclick: async () => { const p = ps.find(x => x.id === sel.value); if (p) { await NS.ExportUI.open(p, false, await NS.getBrand()); render(); } } }, 'Export…'), h('button', { class: 'btn', disabled: !ps.length, onclick: async () => { const p = ps.find(x => x.id === sel.value); if (p) NS.ui.download(await NS.Export.projectFile(p), (p.name || 'project').replace(/[^\w-]+/g, '_') + '.nsgs.json'); } }, 'Editable project file')));
    if (!ps.length) root.append(h('div', { class: 'empty' }, 'No saved projects to export yet.'));
    const hist = (await NS.Store.all('exports').catch(() => [])).sort((a, b) => b.at - a.at).slice(0, 40);
    root.append(h('h2', {}, 'Recent exports'), hist.length ? h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['When', 'Project', 'Format', 'Size', 'File', 'Notes'].map(x => h('th', {}, x)))), h('tbody', {}, hist.map(e => h('tr', {}, h('td', {}, NS.ui.fmtDate(e.at)), h('td', {}, e.projectName), h('td', {}, e.format.toUpperCase() + (e.transparent ? ' · transparent' : '') + (e.target && NS.Export.TARGETS[e.target] ? ' · ' + NS.Export.TARGETS[e.target].label.split(' (')[0] : '')), h('td', {}, e.w + '×' + e.h), h('td', {}, NS.ui.fmtBytes(e.bytes)), h('td', {}, (e.warnings || []).length + ' warning(s)'))))) : h('div', { class: 'empty' }, 'No exports yet.'));
    root.append(h('p', { class: 'hint' }, 'Export history records metadata only; exported files are saved to your downloads folder.'));
    return root;
  };

  /* ---------- router ---------- */
  let seq = 0;
  async function render() {
    const my = ++seq, hash = location.hash.replace(/^#\//, '') || 'dashboard', [route, arg] = hash.split('/');
    if (App.editor) { const ed = App.editor; const ok = await ed.closeGuard(); if (!ok) { location.hash = '#/edit/' + ed.project.id; return; } ed.destroy(); App.editor = null; }
    if (my !== seq) return;
    nav.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.dataset.r === (route === 'edit' ? 'projects' : route)));
    const tab = tabOf(route); appEl.classList.toggle('nosidebar', tab !== 'studio-home');
    tabs.querySelectorAll('[role=tab]').forEach(a => { const on = a.dataset.tab === tab; a.classList.toggle('active', on); a.setAttribute('aria-selected', on); });
    main.className = 'view'; main.innerHTML = '';
    try {
      if (route === 'edit') {
        const p = await NS.Store.get('projects', arg); if (!p) { toast('Project not found.', 'err'); location.hash = '#/projects'; return; }
        if (my !== seq) return; const v = await NS.EditorView.open(main, p); App.editor = v;
        if (sessionStorage.getItem('nsgs.openMap') === p.id) { sessionStorage.removeItem('nsgs.openMap'); const m = v.ed.canvas.getObjects().find(o => o.type === 'MapFrame'); if (m) { v.ed.canvas.setActiveObject(m); setTimeout(() => document.getElementById('editMapBtn') && document.getElementById('editMapBtn').click(), 100); } }
        return;
      }
      const v = views[route] || views.dashboard; const el = await v(); if (my !== seq) return; main.append(el);
    } catch (e) { main.append(h('div', { class: 'empty' }, 'Something went wrong: ' + e.message)); console.error(e); }
  }
  App.render = render;
  window.addEventListener('hashchange', render);

  async function boot() {
    TABS.forEach(([id, l, href]) => tabs.append(h('a', { role: 'tab', href, 'data-tab': id, id: 'tab-' + id }, l)));
    NAV.forEach(([id, l]) => nav.append(id === 'sep' ? h('div', { class: 'navsep' }, l) : h('a', Object.assign({ href: id.startsWith('ext:') ? id.slice(4) : '#/' + id, 'data-r': id }, id.startsWith('ext:') ? { target: '_blank', rel: 'noopener' } : {}), l)));
    await NS.loadConfig(); NS.prepareFonts(); NS.assetsReady = loadAssets(); await NS.assetsReady;
    const b = await NS.getBrand(); document.getElementById('orgName').textContent = (b.orgName || 'Newsroom').toUpperCase(); NS.brand = b;
    try { await NS.Store.get('settings', 'brand'); } catch (e) { toast('Browser storage is unavailable: ' + e.message + ' Nothing can be saved.', 'err', 12000); }
    render();
  }
  boot();
})();
