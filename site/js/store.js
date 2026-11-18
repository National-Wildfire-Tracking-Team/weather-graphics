/* Persistence (IndexedDB, browser-local) + shared helpers.
   Projects are NOT shared between users or browsers: this is local storage only. */
(function (g) {
  const DB = 'nsgs.v1', STORES = ['projects', 'templates', 'assets', 'exports', 'settings'];
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!g.indexedDB) return rej(new Error('IndexedDB is unavailable in this browser.'));
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => STORES.forEach(s => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('Could not open storage.'));
      r.onblocked = () => rej(new Error('Storage is blocked by another tab.'));
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      let out;
      t.oncomplete = () => res(out);   // resolves only once the write is durable
      t.onerror = () => rej(t.error || new Error('Storage error'));
      t.onabort = () => rej(t.error || new Error('Storage write was aborted (quota?)'));
      const r = fn(t.objectStore(store));
      if (r) r.onsuccess = () => { out = r.result; };
    });
  }
  const Store = {
    put: (s, o) => tx(s, 'readwrite', st => st.put(o)).then(() => o),
    get: (s, id) => tx(s, 'readonly', st => st.get(id)),
    all: s => tx(s, 'readonly', st => st.getAll()).then(a => a || []),
    del: (s, id) => tx(s, 'readwrite', st => st.delete(id))
  };
  const uid = (p) => (p || 'id') + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

  const PRESETS = [
    { id: 'hd1080', name: 'Full HD 1920 × 1080', w: 1920, h: 1080, note: 'Broadcast and video' },
    { id: 'hd720', name: 'HD 1280 × 720', w: 1280, h: 720, note: 'HD video' },
    { id: 'story', name: 'Vertical 1080 × 1920', w: 1080, h: 1920, note: 'Stories, vertical video' },
    { id: 'portrait', name: 'Portrait 1080 × 1350', w: 1080, h: 1350, note: 'Portrait social' },
    { id: 'square', name: 'Square 1080 × 1080', w: 1080, h: 1080, note: 'Square social' },
    { id: 'web', name: 'Landscape 1200 × 675', w: 1200, h: 675, note: 'Digital news' }
  ];
  const DEFAULT_BRAND = {
    id: 'brand', orgName: 'Your Newsroom', tagline: '',
    colors: [
      { name: 'Accent', hex: '#F2453D' }, { name: 'Navy', hex: '#0C1119' }, { name: 'Land', hex: '#1A2230' },
      { name: 'Ink', hex: '#E8EDF3' }, { name: 'Muted', hex: '#9AA7B8' }, { name: 'Warning', hex: '#F2B53D' }, { name: 'Blue', hex: '#4C9BFF' }
    ],
    fonts: { display: 'Barlow Condensed', body: 'Barlow', mono: 'Roboto Mono', extra: ['Oswald', 'Merriweather'] },
    logos: { primary: null, dark: null, mark: null },
    attribution: 'Basemap © Mapbox © OpenStreetMap', defaultSize: 'hd1080', defaultFormat: 'png', defaultScale: 1
  };
  const brandColor = (b, name, fb) => { const c = (b.colors || []).find(c => c.name.toLowerCase() === name.toLowerCase()); return c ? c.hex : fb; };

  async function getBrand() {
    // Precedence: Brand Settings saved in this browser > `brand` in config.json (shared NWTT defaults) > built-in defaults.
    const base = () => { const c = (g.NS && g.NS.config && g.NS.config.brand) || {}; return Object.assign({}, DEFAULT_BRAND, c, { fonts: Object.assign({}, DEFAULT_BRAND.fonts, c.fonts || {}) }); };
    try { const b = await Store.get('settings', 'brand'); return Object.assign(base(), b || {}); } catch (e) { return base(); }
  }
  const blankProject = (w, h, name, category) => ({
    id: uid('prj'), name: name || 'Untitled graphic', category: category || 'general',
    created: Date.now(), updated: Date.now(),
    canvas: { w, h, bg: { transparent: false, color: '#1A2230' } },
    objects: [], fields: {}, settings: { tempUnit: 'F', windUnit: 'mph' }, versions: [], favorite: false, templateId: null
  });

  g.NS = { Store, uid, PRESETS, DEFAULT_BRAND, brandColor, getBrand, blankProject };
})(window);
