/* Built-in template library. Templates are generated from the organisation's brand settings at the moment a project is created,
   so colours, fonts and the logo follow Brand Settings. Sample content is always flagged (SAMPLE chip + `sample` objects). */
(function () {
  const CATS = [['weather', 'Weather'], ['tropical', 'Tropical weather'], ['severe', 'Severe weather'], ['breaking', 'Breaking news'], ['broadcast', 'Broadcast'], ['social', 'Social media'], ['safety', 'Public safety'], ['general', 'General newsroom']];
  NS.TEMPLATE_CATS = CATS;

  function ctx(brand, W, H) {
    const col = (n, fb) => NS.brandColor(brand, n, fb);
    const c = { acc: col('Accent', '#F2453D'), navy: col('Navy', '#0C1119'), land: col('Land', '#1A2230'), ink: col('Ink', '#E8EDF3'), muted: col('Muted', '#9AA7B8'), warn: col('Warning', '#F2B53D'), blue: col('Blue', '#4C9BFF') };
    const objs = []; c.objs = objs; c.W = W; c.H = H; c.s = W / 1920;
    const add = o => { o.id = NS.uid('o'); objs.push(o); return o; };
    c.add = add;
    c.text = (t, x, y, w, o) => { o = o || {}; return add(new fabric.Textbox(t, { left: x, top: y, width: w, fontFamily: o.family || brand.fonts.display, fontSize: o.size || 40, fontWeight: o.weight || 700, fill: o.fill || c.ink, textAlign: o.align || 'left', lineHeight: o.lh || 1.05, charSpacing: o.cs || 0, opacity: o.opacity == null ? 1 : o.opacity, name: o.name || 'Text', fieldKey: o.key, fieldFmt: o.fmt, fieldTpl: o.tpl, showIf: o.showIf, colorRole: o.role, sample: o.sample, textBackgroundColor: o.bg || '' })); };
    c.rect = (x, y, w, h, o) => { o = o || {}; return add(new fabric.Rect({ left: x, top: y, width: w, height: h, fill: o.fill || c.navy, opacity: o.opacity == null ? 1 : o.opacity, rx: o.r || 0, ry: o.r || 0, stroke: o.stroke || null, strokeWidth: o.sw || 0, name: o.name || 'Shape', colorRole: o.role, showIf: o.showIf })); };
    c.grad = (x, y, w, h, c1, c2, o) => { const r = new fabric.Rect({ left: x, top: y, width: w, height: h, name: (o && o.name) || 'Gradient' }); r.set('fill', new fabric.Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: 0, y1: 0, x2: (o && o.horizontal) ? w : 0, y2: (o && o.horizontal) ? 0 : h }, colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }] })); return add(r); };
    c.sample = (x, y) => { const k = Math.max(c.s, 0.85); const g = c.text('SAMPLE CONTENT — REPLACE BEFORE USE', x == null ? 24 * c.s : x, y == null ? H - 54 * c.s : y, 640 * k, { size: 22 * k, weight: 700, fill: c.navy, bg: c.warn, family: brand.fonts.body, name: 'Sample warning', sample: true, cs: 20 }); return g; };
    c.org = (x, y, w, size, align, fill) => c.text((brand.orgName || '').toUpperCase(), x, y, w, { size, weight: 800, align: align || 'right', fill: fill || c.ink, name: 'Organization name', cs: 40, key: 'org', fmt: 'upper' });
    c.logo = (x, y, h, key) => { const id = brand.logos && (brand.logos[key || 'primary'] || brand.logos.primary); if (id) { const o = new fabric.Rect({ left: x, top: y, width: h * 3, height: h, fill: 'rgba(0,0,0,0)', name: 'Logo', assetLogo: id }); o.assetId = id; o.kind = 'logo'; return add(o); } return null; };
    c.map = (x, y, w, h, o) => {
      o = o || {}; const st = NS.defaultMapState(o.view || 'Southeast'); if (o.style) st.style = o.style; if (o.projection) st.projection = o.projection;
      if (st.style === 'broadcast' && !NS.config.style) st.style = 'dark';
      if (o.padTop != null) st.fit = { extent: st.fit.extent, padding: { top: o.padTop, bottom: o.padBottom || 20, left: 20, right: 20 } };
      if (!o.projection && ['Alaska', 'Hawaii', 'Atlantic basin', 'Gulf of Mexico'].includes(o.view)) st.projection = 'mercator';
      (o.layers || []).forEach((id, i) => { st.layers[id] = { on: true, opacity: 0.85 }; st.layerOrder.push(id); }); if (o.toggles) st.toggles = o.toggles; if (o.pitch) st.pitch = o.pitch;
      st.size = [w, h]; const m = new fabric.MapFrame({ left: x, top: y, width: w, height: h, mapState: st, name: o.name || 'Map', id: NS.uid('o') }); objs.push(m); return m;
    };
    c.chart = (spec, x, y) => { const g = NS.Charts.build(spec); g.set({ left: x, top: y }); return add(g); };
    c.header = (o) => {  // broadcast header bar: ~135px tall at 1080p
      const hh = 135 * c.s; c.rect(0, 0, W, hh, { fill: c.navy, opacity: 0.88, name: 'Header bar' }); c.rect(0, hh - 4 * c.s, W, 4 * c.s, { fill: c.acc, role: 'accent', name: 'Header rule' });
      c.text(o.title, 48 * c.s, 14 * c.s, W * 0.62, { size: 74 * c.s, weight: 800, fill: c.acc, role: 'accent', key: 'title', fmt: 'upper', name: 'Title', cs: 10 });
      c.text(o.subtitle || '', 52 * c.s, 92 * c.s, W * 0.62, { size: 30 * c.s, weight: 600, fill: c.ink, key: 'subtitle', name: 'Subtitle', family: brand.fonts.body });
      c.org(W * 0.68, 22 * c.s, W * 0.3, 30 * c.s, 'right', c.ink); c.logo(W - 300 * c.s, 14 * c.s, 80 * c.s);
      if (o.validKey) c.text('', W * 0.62, 78 * c.s, W * 0.36, { size: 26 * c.s, weight: 600, fill: c.muted, align: 'right', key: o.validKey, tpl: o.validTpl || 'VALID {v}', fmt: 'datetime', name: 'Valid time', family: brand.fonts.body });
    };
    c.footer = (o) => {
      const fh = 40 * c.s; c.rect(0, H - fh, W, fh, { fill: c.navy, opacity: 0.85, name: 'Footer bar' });
      c.text('', 24 * c.s, H - fh + 8 * c.s, W * 0.7, { size: 20 * c.s, weight: 500, fill: c.muted, key: 'source', tpl: 'SOURCE: {v}', name: 'Source', family: brand.fonts.body, showIf: 'attribution' });
    };
    return c;
  }
  const finish = (c, extra) => {
    const objects = c.objs.map(o => { const j = o.toObject(NS.PROPS); if (o.assetLogo) j.assetId = o.assetLogo; return j; });
    return Object.assign({ objects }, extra);
  };
  const baseFields = (c, o) => Object.assign({ org: c.org ? undefined : undefined }, o);

  /* ---------- field definitions reused by weather graphics ---------- */
  const F = {
    title: { key: 'title', label: 'Title', type: 'text' }, subtitle: { key: 'subtitle', label: 'Subtitle', type: 'text' },
    forecastTime: { key: 'forecastTime', label: 'Forecast issued', type: 'datetime' }, validTime: { key: 'validTime', label: 'Valid time', type: 'datetime' },
    source: { key: 'source', label: 'Source attribution', type: 'text' }, attribution: { key: 'attribution', label: 'Show source line', type: 'checkbox' },
    legend: { key: 'legend', label: 'Show legend', type: 'checkbox' }, accent: { key: 'accent', label: 'Accent color', type: 'color' },
    tempUnit: { key: 'tempUnit', label: 'Temperature units', type: 'setting', options: [['F', '°F'], ['C', '°C']] }, windUnit: { key: 'windUnit', label: 'Wind units', type: 'setting', options: [['mph', 'mph'], ['kt', 'knots'], ['kmh', 'km/h']] }
  };
  const isoNow = () => { const d = new Date(); d.setMinutes(0, 0, 0); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':00'; };

  /* ---------- layout builders ---------- */
  function mapGraphic(cfg) {
    return (brand) => {
      const c = ctx(brand, 1920, 1080);
      c.map(0, 0, 1920, 1080, { view: cfg.view, style: cfg.style || 'broadcast', layers: cfg.layers, toggles: cfg.toggles, padTop: 150, padBottom: 60 });
      c.header({ title: cfg.title, subtitle: cfg.subtitle, validKey: 'validTime' });
      if (cfg.legend) { const sp = NS.Charts.defaults('legend'); Object.assign(sp, NS.Charts.PRESETS[cfg.legend], { w: 520, textColor: c.ink, font: brand.fonts.body }); c.rect(24, 1080 - 40 - 24 - 118, 568, 118, { fill: c.navy, opacity: 0.85, name: 'Legend panel', showIf: 'legend' }).showIf = 'legend'; const g = c.chart(sp, 48, 1080 - 40 - 24 - 108); g.showIf = 'legend'; }
      if (cfg.panel) { cfg.panel(c); }
      c.footer({});
      if (cfg.sample !== false) c.sample(24, 160);
      const fields = { title: cfg.title, subtitle: cfg.subtitle, forecastTime: isoNow(), validTime: isoNow(), source: cfg.source || (brand.attribution || ''), attribution: true, legend: true, accent: cfg.accent || c.acc, org: brand.orgName, alertType: cfg.alertType };
      const defs = [F.title, F.subtitle, F.forecastTime, F.validTime, F.source, F.attribution]; if (cfg.legend) defs.push(F.legend);
      defs.push(F.accent, F.tempUnit, F.windUnit); if (cfg.defs) defs.push(...cfg.defs); if (cfg.fields) Object.assign(fields, cfg.fields);
      return finish(c, { canvas: { w: 1920, h: 1080, bg: { transparent: false, color: c.land }, titleBar: 140 }, fields, fieldDefs: defs });
    };
  }
  const stormPanel = c => {
    const x = 1920 - 520, y = 160; c.rect(x, y, 496, 400, { fill: c.navy, opacity: 0.88, name: 'Storm info panel' });
    c.text('', x + 20, y + 14, 456, { size: 46, weight: 800, fill: c.acc, role: 'accent', key: 'stormName', fmt: 'upper', name: 'Storm name' });
    const rows = [['ADVISORY', 'advisory', ''], ['AS OF', 'advisoryTime', 'datetime'], ['LOCATION', 'stormLocation', ''], ['MAX WINDS', 'maxWind', 'wind'], ['PRESSURE', 'pressure', ''], ['MOVEMENT', 'movement', '']];
    rows.forEach((r, i) => { c.text(r[0], x + 20, y + 80 + i * 49, 150, { size: 20, weight: 600, fill: c.muted, family: 'Barlow', name: r[0] + ' label' }); c.text('', x + 170, y + 74 + i * 49, 310, { size: 30, weight: 600, fill: c.ink, key: r[1], fmt: r[2] || undefined, name: r[0], family: 'Barlow' }); });
    c.rect(x + 20, y + 372, 14, 14, { fill: '#E8EDF3', name: 'Observed swatch' }); c.text('OBSERVED', x + 42, y + 366, 150, { size: 18, weight: 600, family: 'Barlow', name: 'Observed key' });
    c.rect(x + 220, y + 372, 14, 14, { fill: '#F2B53D', name: 'Forecast swatch' }); c.text('FORECAST', x + 242, y + 366, 150, { size: 18, weight: 600, family: 'Barlow', name: 'Forecast key' });
  };
  const stormFields = { stormName: 'Storm name', advisory: 'Advisory #', advisoryTime: isoNow(), stormLocation: '—', maxWind: '', pressure: '—', movement: '—' };
  const stormDefs = [{ key: 'stormName', label: 'Storm name', type: 'text' }, { key: 'advisory', label: 'Advisory', type: 'text' }, { key: 'advisoryTime', label: 'Advisory time', type: 'datetime' }, { key: 'stormLocation', label: 'Location', type: 'text' }, { key: 'maxWind', label: 'Max winds (mph)', type: 'number' }, { key: 'pressure', label: 'Pressure', type: 'text' }, { key: 'movement', label: 'Movement', type: 'text' }];

  function cardsGraphic(cfg) {   // forecast panels: header + grid of cards
    return (brand) => {
      const c = ctx(brand, 1920, 1080), n = cfg.items.length, cols = cfg.cols || n, rows = Math.ceil(n / cols), gx = 24, top = 170, bot = 70;
      c.rect(0, 0, 1920, 1080, { fill: c.land, name: 'Background' });
      c.header({ title: cfg.title, subtitle: cfg.subtitle, validKey: 'validTime' });
      const cw = (1920 - 96 - gx * (cols - 1)) / cols, ch = (1080 - top - bot - gx * (rows - 1)) / rows, fields = {}, defs = [F.title, F.subtitle, F.validTime, F.tempUnit, F.windUnit];
      cfg.items.forEach((it, i) => {
        const x = 48 + (i % cols) * (cw + gx), y = top + Math.floor(i / cols) * (ch + gx), k = 'i' + i;
        c.rect(x, y, cw, ch, { fill: c.navy, opacity: 0.9, name: 'Card ' + (i + 1) }); c.rect(x, y, cw, 6, { fill: c.acc, role: 'accent', name: 'Card rule' });
        const big = Math.min(ch * 0.34, cw * 0.3, 120);
        c.text('', x + 16, y + 20, cw - 32, { size: Math.min(34, cw * 0.1), weight: 700, fill: c.ink, key: k + 'l', fmt: 'upper', name: 'Label', align: cfg.center ? 'center' : 'left' });
        const ifmt = it[3] || cfg.fmt || 'temp';
        c.text('', x + 16, y + ch * 0.28, cw - 32, { size: big, weight: 800, fill: c.ink, key: k + 'v', fmt: ifmt === 'text' ? undefined : ifmt, name: 'Value', align: cfg.center ? 'center' : 'left' });
        c.text('', x + 16, y + ch * (cfg.fmt === 'none' ? 0.28 : 0.62), cw - 32, { size: Math.min(26, cw * 0.09), weight: 500, fill: c.muted, key: k + 's', name: 'Detail', family: brand.fonts.body, align: cfg.center ? 'center' : 'left' });
        fields[k + 'l'] = it[0]; fields[k + 'v'] = it[1]; fields[k + 's'] = it[2] || '';
        defs.push({ key: k + 'l', label: 'Card ' + (i + 1) + ' label', type: 'text' }, { key: k + 'v', label: 'Card ' + (i + 1) + (ifmt === 'wind' ? ' wind (mph)' : ifmt === 'text' ? ' value' : ' value (°F)'), type: ifmt === 'text' ? 'text' : 'number' }, { key: k + 's', label: 'Card ' + (i + 1) + ' detail', type: 'text' });
      });
      c.sample(48, 1080 - 56);
      Object.assign(fields, { title: cfg.title, subtitle: cfg.subtitle, validTime: isoNow(), accent: c.acc, org: brand.orgName });
      return finish(c, { canvas: { w: 1920, h: 1080, bg: { transparent: false, color: c.land }, titleBar: 140 }, fields, fieldDefs: defs.concat([F.accent]) });
    };
  }

  function newsScreen(cfg) {    // full-screen headline graphic, any size
    return (brand) => {
      const W = cfg.w || 1920, H = cfg.h || 1080, c = ctx(brand, W, H), s = c.s, port = H > W;
      c.rect(0, 0, W, H, { fill: cfg.bg || c.navy, name: 'Background' }); if (cfg.photo !== false) c.grad(0, H * 0.35, W, H * 0.65, 'rgba(12,17,25,0)', 'rgba(12,17,25,0.95)', { name: 'Gradient' });
      const kh = (port ? 90 : 78) * s * (W > 1500 ? 1 : 1.2), pad = (port ? 64 : 96) * (W / 1920) * (port ? 1.4 : 1);
      c.rect(pad, H * (port ? 0.30 : 0.28), 420 * s * (port ? 1.8 : 1.2) + (cfg.kicker.length * 14 * s), kh, { fill: cfg.kickerFill || c.acc, role: cfg.kickerFill ? undefined : 'accent', name: 'Kicker plate' });
      c.text(cfg.kicker, pad + 24 * s, H * (port ? 0.30 : 0.28) + kh * 0.14, W - pad * 2, { size: kh * 0.66, weight: 800, fill: c.navy, key: 'kicker', fmt: 'upper', name: 'Kicker', cs: 30 });
      c.text(cfg.headline, pad, H * (port ? 0.30 : 0.28) + kh + 26 * s, W - pad * 2, { size: (port ? 112 : 124) * (W / 1920) * (port ? 1.1 : 1), weight: 800, fill: c.ink, key: 'headline', fmt: 'upper', name: 'Headline', lh: 0.98 });
      c.text(cfg.sub, pad, H * 0.78, W - pad * 2, { size: (port ? 44 : 40) * (W / 1920) * (port ? 1.25 : 1), weight: 500, fill: c.muted, key: 'deck', name: 'Deck', family: brand.fonts.body, lh: 1.2 });
      c.text('', pad, H - (port ? 120 : 84) * s * (port ? 1.3 : 1), W * 0.6, { size: 28 * (W / 1920) * (port ? 1.3 : 1), weight: 600, fill: c.muted, key: 'location', tpl: '{v}', name: 'Location', family: brand.fonts.body, fmt: 'upper' });
      c.org(W * 0.5, H - (port ? 120 : 84) * s * (port ? 1.3 : 1), W * 0.5 - pad, 30 * (W / 1920) * (port ? 1.3 : 1), 'right', c.ink); c.logo(W - pad - 240 * s, pad * 0.4, 70 * s);
      if (cfg.sampleChip !== false) c.sample(pad, 28 * s);
      const fields = { kicker: cfg.kicker, headline: cfg.headline, deck: cfg.sub, location: cfg.location || '', org: brand.orgName };
      return finish(c, { canvas: { w: W, h: H, bg: { transparent: false, color: cfg.bg || c.navy } }, fields, fieldDefs: [{ key: 'kicker', label: 'Kicker', type: 'text' }, { key: 'headline', label: 'Headline', type: 'textarea' }, { key: 'deck', label: 'Subhead', type: 'textarea' }, { key: 'location', label: 'Location', type: 'text' }] });
    };
  }

  function lowerThird(cfg) {    // transparent broadcast overlays
    return (brand) => {
      const c = ctx(brand, 1920, 1080), x = 96, y = cfg.y || 820, h = cfg.h || 120;
      if (cfg.style === 'bar') { c.rect(x, y, 1100, h, { fill: c.navy, opacity: 0.94, name: 'Plate' }); c.rect(x, y, 14, h, { fill: c.acc, role: 'accent', name: 'Accent bar' });
        c.text(cfg.name, x + 44, y + 10, 1020, { size: 58, weight: 800, fill: c.ink, key: 'name', fmt: 'upper', name: 'Name' }); c.text(cfg.title, x + 46, y + 72, 1020, { size: 34, weight: 500, fill: c.muted, key: 'role', name: 'Title', family: brand.fonts.body, fmt: 'upper' }); }
      else if (cfg.style === 'strap') { c.rect(0, y, 1920, h, { fill: c.navy, opacity: 0.94, name: 'Strap' }); c.rect(0, y, 330, h, { fill: c.acc, role: 'accent', name: 'Tag plate' });
        c.text(cfg.tag, 20, y + h * 0.18, 290, { size: h * 0.56, weight: 800, fill: c.navy, align: 'center', key: 'tag', fmt: 'upper', name: 'Tag' }); c.text(cfg.name, 370, y + h * 0.14, 1480, { size: h * 0.5, weight: 800, fill: c.ink, key: 'name', fmt: 'upper', name: 'Headline' }); }
      else { c.rect(x, y, 760, h, { fill: c.acc, role: 'accent', name: 'Plate' }); c.rect(x + 760, y, 440, h, { fill: c.navy, opacity: 0.94, name: 'Plate 2' });
        c.text(cfg.name, x + 28, y + 12, 710, { size: 62, weight: 800, fill: c.navy, key: 'name', fmt: 'upper', name: 'Name' }); c.text(cfg.title, x + 28, y + 76, 710, { size: 32, weight: 600, fill: c.navy, key: 'role', name: 'Title', family: brand.fonts.body, fmt: 'upper' });
        c.text(cfg.right || '', x + 780, y + 34, 400, { size: 44, weight: 700, fill: c.ink, key: 'right', fmt: 'upper', name: 'Location', align: 'center' }); }
      c.sample(96, y - 50);
      const fields = { name: cfg.name, role: cfg.title, tag: cfg.tag, right: cfg.right, org: brand.orgName };
      const defs = [{ key: 'name', label: cfg.style === 'strap' ? 'Headline' : 'Name', type: 'text' }]; if (cfg.style !== 'strap') defs.push({ key: 'role', label: 'Title / role', type: 'text' }); if (cfg.style === 'strap') defs.push({ key: 'tag', label: 'Tag', type: 'text' }); if (!cfg.style) defs.push({ key: 'right', label: 'Location', type: 'text' });
      return finish(c, { canvas: { w: 1920, h: 1080, bg: { transparent: true, color: '#00000000' } }, fields, fieldDefs: defs });
    };
  }
  const bug = (cfg) => (brand) => {
    const c = ctx(brand, 1920, 1080);
    if (cfg.kind === 'live') { c.rect(1920 - 330, 54, 270, 84, { fill: c.acc, role: 'accent', r: 6, name: 'LIVE plate' }); c.rect(1920 - 310, 86, 20, 20, { fill: c.navy, r: 10, name: 'Dot' }); c.text('LIVE', 1920 - 270, 60, 200, { size: 66, weight: 800, fill: c.navy, key: 'tag', name: 'LIVE', cs: 60 }); c.text('', 1920 - 700, 150, 640, { size: 34, weight: 700, fill: c.ink, align: 'right', key: 'location', fmt: 'upper', name: 'Location', bg: 'rgba(12,17,25,0.85)' }); }
    else { c.rect(1920 - 250, 50, 200, 200, { fill: c.navy, opacity: 0.9, r: 8, name: 'Bug plate' }); c.text((brand.orgName || '').slice(0, 12).toUpperCase(), 1920 - 250, 128, 200, { size: 44, weight: 800, fill: c.ink, align: 'center', name: 'Wordmark', key: 'org', fmt: 'upper' }); c.logo(1920 - 240, 60, 80, 'mark'); }
    const fields = { tag: 'LIVE', location: 'CITY, STATE', org: brand.orgName };
    return finish(c, { canvas: { w: 1920, h: 1080, bg: { transparent: true, color: '#00000000' } }, fields, fieldDefs: cfg.kind === 'live' ? [{ key: 'tag', label: 'Tag', type: 'text' }, { key: 'location', label: 'Location', type: 'text' }] : [] });
  };
  function titleCard(cfg) {
    return (brand) => {
      const c = ctx(brand, 1920, 1080); c.rect(0, 0, 1920, 1080, { fill: cfg.bg || c.navy, name: 'Background' });
      if (cfg.stripe) { c.rect(0, 0, 40, 1080, { fill: c.acc, role: 'accent', name: 'Stripe' }); }
      c.rect(160, 460, 220, 8, { fill: c.acc, role: 'accent', name: 'Rule' });
      c.text(cfg.title, 160, 500, 1500, { size: cfg.size || 140, weight: 800, fill: c.ink, key: 'title', fmt: 'upper', name: 'Title', lh: 0.95 });
      c.text(cfg.sub, 164, 790, 1400, { size: 46, weight: 500, fill: c.muted, key: 'subtitle', name: 'Subtitle', family: brand.fonts.body });
      c.org(160, 120, 800, 40, 'left', c.ink); c.logo(1920 - 460, 90, 120); c.sample(160, 1000);
      return finish(c, { canvas: { w: 1920, h: 1080, bg: { transparent: false, color: cfg.bg || c.navy } }, fields: { title: cfg.title, subtitle: cfg.sub, org: brand.orgName }, fieldDefs: [F.title, F.subtitle] });
    };
  }
  function quoteCard(cfg) {
    return (brand) => {
      const W = cfg.w || 1080, H = cfg.h || 1080, c = ctx(brand, W, H), p = W * 0.08;
      c.rect(0, 0, W, H, { fill: c.navy, name: 'Background' }); c.rect(p, p, 12, H * 0.12, { fill: c.acc, role: 'accent', name: 'Mark' });
      c.text('“', p, H * 0.12, 200, { size: W * 0.28, weight: 800, fill: c.acc, role: 'accent', name: 'Quote mark', family: brand.fonts.display });
      c.text('Replace with the quote text.', p, H * 0.3, W - p * 2, { size: W * 0.065, weight: 600, fill: c.ink, key: 'quote', name: 'Quote', family: brand.fonts.body, lh: 1.15 });
      c.text('SPEAKER NAME', p, H * 0.78, W - p * 2, { size: W * 0.05, weight: 800, fill: c.ink, key: 'speaker', fmt: 'upper', name: 'Speaker' });
      c.text('Title, organization', p, H * 0.78 + W * 0.065, W - p * 2, { size: W * 0.032, weight: 500, fill: c.muted, key: 'role', name: 'Role', family: brand.fonts.body });
      c.org(p, H - p - 30, W - p * 2, W * 0.026, 'right', c.muted); c.sample(p, H - p - 4 - 22);
      return finish(c, { canvas: { w: W, h: H, bg: { transparent: false, color: c.navy } }, fields: { quote: 'Replace with the quote text.', speaker: 'Speaker name', role: 'Title, organization', org: brand.orgName }, fieldDefs: [{ key: 'quote', label: 'Quote', type: 'textarea' }, { key: 'speaker', label: 'Speaker', type: 'text' }, { key: 'role', label: 'Title / organization', type: 'text' }] });
    };
  }
  function chartCard(cfg) {
    return (brand) => {
      const c = ctx(brand, 1920, 1080); c.rect(0, 0, 1920, 1080, { fill: c.navy, name: 'Background' });
      c.text(cfg.title, 96, 70, 1700, { size: 84, weight: 800, fill: c.ink, key: 'title', fmt: 'upper', name: 'Headline' }); c.text(cfg.sub, 98, 170, 1700, { size: 34, weight: 500, fill: c.muted, key: 'subtitle', name: 'Subhead', family: brand.fonts.body });
      const sp = NS.Charts.defaults(cfg.chart); Object.assign(sp, cfg.spec, { w: 1500, h: 640, title: '', color: c.acc, font: brand.fonts.body, textColor: c.ink }); c.chart(sp, 96, 260);
      c.text('', 96, 1000, 1500, { size: 24, weight: 500, fill: c.muted, key: 'source', tpl: 'SOURCE: {v}', name: 'Source', family: brand.fonts.body }); c.org(1100, 1000, 724, 28, 'right', c.muted);
      c.sample(96, 940);
      return finish(c, { canvas: { w: 1920, h: 1080, bg: { transparent: false, color: c.navy } }, fields: { title: cfg.title, subtitle: cfg.sub, source: 'Enter source', org: brand.orgName }, fieldDefs: [F.title, F.subtitle, F.source] });
    };
  }
  function listGraphic(cfg) {   // closures / road closures / evacuation list
    return (brand) => {
      const c = ctx(brand, 1920, 1080); c.rect(0, 0, 1920, 1080, { fill: c.land, name: 'Background' });
      c.header({ title: cfg.title, subtitle: cfg.sub, validKey: 'validTime' });
      const fields = { title: cfg.title, subtitle: cfg.sub, validTime: isoNow(), accent: c.acc, org: brand.orgName }, defs = [F.title, F.subtitle, F.validTime];
      for (let i = 0; i < cfg.rows; i++) { const y = 170 + i * 118; c.rect(48, y, 1824, 100, { fill: c.navy, opacity: 0.92, name: 'Row ' + (i + 1) }); c.rect(48, y, 10, 100, { fill: c.acc, role: 'accent', name: 'Row rule' });
        c.text('', 84, y + 14, 1000, { size: 50, weight: 800, fill: c.ink, key: 'r' + i + 'a', fmt: 'upper', name: 'Name' }); c.text('', 84, y + 64, 1000, { size: 28, weight: 500, fill: c.muted, key: 'r' + i + 'b', name: 'Detail', family: brand.fonts.body });
        c.text('', 1200, y + 26, 640, { size: 46, weight: 700, fill: c.warn, align: 'right', key: 'r' + i + 'c', fmt: 'upper', name: 'Status' });
        fields['r' + i + 'a'] = cfg.sampleRows ? cfg.sampleRows[0] + ' ' + (i + 1) : ''; fields['r' + i + 'b'] = cfg.sampleRows ? cfg.sampleRows[1] : ''; fields['r' + i + 'c'] = cfg.sampleRows ? cfg.sampleRows[2] : '';
        defs.push({ key: 'r' + i + 'a', label: 'Row ' + (i + 1) + ' name', type: 'text' }, { key: 'r' + i + 'b', label: 'Row ' + (i + 1) + ' detail', type: 'text' }, { key: 'r' + i + 'c', label: 'Row ' + (i + 1) + ' status', type: 'text' }); }
      c.sample(48, 1080 - 56);
      return finish(c, { canvas: { w: 1920, h: 1080, bg: { transparent: false, color: c.land }, titleBar: 140 }, fields, fieldDefs: defs.concat([F.accent]) });
    };
  }
  function overlay(cfg) {   // transparent safe-area frame / presenter strip
    return (brand) => {
      const c = ctx(brand, 1920, 1080);
      if (cfg.kind === 'presenter') {
        c.rect(0, 0, 1920, 135, { fill: c.navy, opacity: 0.9, name: 'Header bar' }); c.rect(0, 131, 1920, 4, { fill: c.acc, role: 'accent', name: 'Header rule' });
        c.text('YOUR FORECAST', 48, 16, 1100, { size: 74, weight: 800, fill: c.acc, role: 'accent', key: 'title', fmt: 'upper', name: 'Title' }); c.text('Today', 52, 92, 900, { size: 30, weight: 600, key: 'subtitle', name: 'Subtitle', family: brand.fonts.body });
        for (let i = 0; i < 5; i++) { const x = 1100 + i * 154; c.rect(x, 940, 140, 120, { fill: c.navy, opacity: 0.9, name: 'Day card' }); c.text('DAY', x, 948, 140, { size: 28, weight: 700, align: 'center', key: 'd' + i + 'l', name: 'Day' }); c.text('', x, 984, 140, { size: 54, weight: 800, align: 'center', key: 'd' + i + 'v', fmt: 'temp', name: 'Temp' }); }
        c.sample(48, 1010);
        const fields = { title: 'Your forecast', subtitle: 'Today', org: brand.orgName }; const defs = [F.title, F.subtitle, F.tempUnit]; for (let i = 0; i < 5; i++) { fields['d' + i + 'l'] = ['MON', 'TUE', 'WED', 'THU', 'FRI'][i]; fields['d' + i + 'v'] = ''; defs.push({ key: 'd' + i + 'l', label: 'Day ' + (i + 1), type: 'text' }, { key: 'd' + i + 'v', label: 'Day ' + (i + 1) + ' high (°F)', type: 'number' }); }
        return finish(c, { canvas: { w: 1920, h: 1080, bg: { transparent: true, color: '#00000000' } }, fields, fieldDefs: defs });
      }
      const m = 96; const mk = (x, y, w, h) => c.rect(x, y, w, h, { fill: c.acc, role: 'accent', name: 'Corner mark' });
      [[m, m, 120, 6], [m, m, 6, 120], [1920 - m - 120, m, 120, 6], [1920 - m - 6, m, 6, 120], [m, 1080 - m - 6, 120, 6], [m, 1080 - m - 120, 6, 120], [1920 - m - 120, 1080 - m - 6, 120, 6], [1920 - m - 6, 1080 - m - 120, 6, 120]].forEach(a => mk(...a));
      c.text(cfg.text || 'TRANSPARENT OVERLAY', 0, 1000, 1920, { size: 30, weight: 600, fill: c.ink, align: 'center', key: 'title', name: 'Caption', cs: 120, opacity: 0.9 });
      return finish(c, { canvas: { w: 1920, h: 1080, bg: { transparent: true, color: '#00000000' } }, fields: { title: cfg.text || 'TRANSPARENT OVERLAY', org: brand.orgName }, fieldDefs: [F.title] });
    };
  }
  function socialCard(cfg) {
    return (brand) => {
      const W = cfg.w, H = cfg.h, c = ctx(brand, W, H), s = Math.min(W, H) / 1080, p = Math.min(W, H) * 0.07;
      c.rect(0, 0, W, H, { fill: c.land, name: 'Photo placeholder' }); c.text('PHOTO / MAP AREA — replace with an image', 0, H * 0.22, W, { size: 30 * s, weight: 600, fill: c.muted, align: 'center', family: brand.fonts.body, name: 'Photo note', opacity: 0.8 });
      c.grad(0, H * 0.3, W, H * 0.7, 'rgba(12,17,25,0)', 'rgba(12,17,25,0.96)', { name: 'Gradient' });
      c.rect(p, H * 0.46, 260 * s + cfg.kicker.length * 12 * s, 64 * s, { fill: c.acc, role: 'accent', name: 'Kicker plate' }); c.text(cfg.kicker, p + 18 * s, H * 0.46 + 9 * s, W - 2 * p, { size: 44 * s, weight: 800, fill: c.navy, key: 'kicker', fmt: 'upper', name: 'Kicker', cs: 30 });
      c.text(cfg.headline, p, H * 0.46 + 84 * s, W - 2 * p, { size: (cfg.big || 100) * s, weight: 800, fill: c.ink, key: 'headline', fmt: 'upper', name: 'Headline', lh: 0.98 });
      c.org(p, H - p - 34 * s, W - 2 * p, 30 * s, 'left', c.muted); c.sample(p, H - p - 4 * s - 60 * s);
      return finish(c, { canvas: { w: W, h: H, bg: { transparent: false, color: c.land } }, fields: { kicker: cfg.kicker, headline: cfg.headline, org: brand.orgName }, fieldDefs: [{ key: 'kicker', label: 'Kicker', type: 'text' }, { key: 'headline', label: 'Headline', type: 'textarea' }] });
    };
  }
  const incidentMap = (cfg) => mapGraphic(Object.assign({ view: 'Lower 48', style: 'broadcast', legend: null, sample: true, panel: c => { c.rect(1920 - 520, 160, 496, 150, { fill: c.navy, opacity: 0.9, name: 'Info panel' }); c.text('', 1920 - 500, 174, 456, { size: 40, weight: 800, fill: c.acc, role: 'accent', key: 'location', fmt: 'upper', name: 'Location' }); c.text('', 1920 - 500, 226, 456, { size: 26, weight: 500, fill: c.ink, key: 'detail', name: 'Detail', family: 'Barlow' }); }, fields: { location: 'Location', detail: 'Describe the incident' }, defs: [{ key: 'location', label: 'Location', type: 'text' }, { key: 'detail', label: 'Detail', type: 'textarea' }] }, cfg));

  /* ---------- the library ---------- */
  const T = [];
  const def = (id, name, cat, w, h, desc, build, tags) => T.push({ id, name, category: cat, w, h, desc, build, tags: tags || [] });

  // Weather — map graphics
  const WX = [
    ['wx-temp-map', 'Temperature map', 'weather', 'TEMPERATURES', 'Forecast highs', 'Lower 48', 'temp', [], 'Add temperature points with Map Studio markers; no live temperature layer is configured.'],
    ['wx-rain', 'Rainfall forecast', 'weather', 'RAINFALL FORECAST', 'Expected accumulation', 'Southeast', 'rain', [], 'Draw outlook polygons in Map Studio or import GeoJSON from your forecast source.'],
    ['wx-snow', 'Snowfall forecast', 'weather', 'SNOWFALL FORECAST', 'Expected accumulation', 'Northeast', 'rain', [], 'Draw or import snowfall polygons; edit legend values to match.'],
    ['wx-wind', 'Wind forecast', 'weather', 'WIND FORECAST', 'Peak gusts', 'Plains', 'wind', [], 'Add wind labels with Map Studio markers.'],
    ['wx-heat', 'Heat alert', 'weather', 'HEAT ALERT', 'Dangerous heat expected', 'Southeast', 'temp', [], 'Outline the alert area with a polygon.', '#F2B53D'],
    ['wx-cold', 'Cold alert', 'weather', 'COLD ALERT', 'Dangerously cold conditions', 'Midwest', 'temp', [], 'Outline the alert area with a polygon.', '#4C9BFF'],
    ['wx-regional', 'Regional forecast', 'weather', 'REGIONAL FORECAST', 'Today', 'Southeast', null, [], 'Add city markers with temperatures.'],
    ['wx-national', 'National forecast', 'weather', 'NATIONAL FORECAST', 'Today', 'Lower 48', null, [], 'Add city markers with temperatures.'],
    ['wx-radar', 'Radar presentation', 'weather', 'RADAR', 'Current conditions', 'Southeast', null, ['radar-nexrad'], 'Live NEXRAD tiles via IEM; current at export time.'],
    ['wx-satellite', 'Satellite presentation', 'weather', 'SATELLITE', 'Satellite imagery basemap', 'Lower 48', null, [], 'Satellite basemap imagery (not a live weather-satellite feed).', null, 'satellite-labels'],
    ['sv-outlook', 'Severe weather outlook', 'severe', 'SEVERE WEATHER OUTLOOK', 'Risk areas', 'Plains', null, [], 'Draw each risk area as a polygon from your outlook source.'],
    ['sv-tornado', 'Tornado warning', 'severe', 'TORNADO WARNING', 'Active tornado warnings', 'Southeast', null, ['nws-tornado'], 'NWS tornado warning polygons, frozen when fetched.', '#F2453D'],
    ['sv-svr', 'Severe thunderstorm warning', 'severe', 'SEVERE THUNDERSTORM WARNING', 'Active warnings', 'Southeast', null, ['nws-svr'], 'NWS severe thunderstorm warning polygons.', '#F2B53D'],
    ['sv-ffw', 'Flash flood warning', 'severe', 'FLASH FLOOD WARNING', 'Active warnings', 'Southeast', null, ['nws-ffw'], 'NWS flash flood warning polygons.', '#4C9BFF'],
    ['sv-damage', 'Storm damage', 'severe', 'STORM DAMAGE', 'Reported damage', 'Southeast', null, [], 'Add incident markers for reported damage.', null, 'satellite-labels'],
    ['sv-flooding', 'Flooding', 'severe', 'FLOODING', 'Flood warnings', 'Southeast', null, ['nws-flood'], 'NWS flood warning polygons.', '#3FB6C9'],
    ['sf-wildfire', 'Wildfire incident', 'safety', 'WILDFIRE', 'Current fire perimeters', 'West', null, ['nifc-fire'], 'NIFC current perimeters (simplified).', '#F2B53D', 'outdoors'],
    ['sf-evac', 'Evacuation notice', 'safety', 'EVACUATION NOTICE', 'Affected area', 'Southeast', null, [], 'Outline the evacuation area with a polygon from official sources.', '#F2453D', 'streets']
  ];
  WX.forEach(([id, name, cat, title, sub, view, legend, layers, desc, accent, style]) =>
    def(id, name, cat, 1920, 1080, desc, mapGraphic({ title, subtitle: sub, view, legend, layers, accent, style: style || 'broadcast', alertType: title }), ['map', 'weather']));
  // Tropical
  def('tr-track', 'Hurricane tracking', 'tropical', 1920, 1080, 'NHC active-storm layer (cone, track, points) plus storm info panel.', mapGraphic({ title: 'HURRICANE TRACKER', subtitle: 'Forecast track', view: 'Atlantic basin', layers: ['nhc-tropical'], panel: stormPanel, fields: stormFields, defs: stormDefs, accent: '#F2453D' }), ['map', 'tropical']);
  def('tr-update', 'Tropical storm update', 'tropical', 1920, 1080, 'Gulf-focused tropical update with advisory panel.', mapGraphic({ title: 'TROPICAL STORM UPDATE', subtitle: 'Latest advisory', view: 'Gulf of Mexico', layers: ['nhc-tropical'], panel: stormPanel, fields: stormFields, defs: stormDefs, accent: '#F2B53D' }), ['map', 'tropical']);
  def('tr-manual', 'Storm track (manual data)', 'tropical', 1920, 1080, 'No live layer: draw observed positions and forecast points from the advisory, or import NHC GeoJSON.', mapGraphic({ title: 'STORM TRACK', subtitle: 'From advisory data', view: 'Atlantic basin', layers: [], panel: stormPanel, fields: stormFields, defs: stormDefs }), ['map', 'tropical']);
  // Forecast panels
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  def('wx-current', 'Current conditions', 'weather', 1920, 1080, 'Temperature, feels-like, wind, humidity, pressure, visibility.', cardsGraphic({ title: 'CURRENT CONDITIONS', subtitle: 'City, State', cols: 3, items: [['TEMPERATURE', 72, 'Sunny'], ['FEELS LIKE', 74, ''], ['WIND', 8, 'From the SW', 'wind'], ['HUMIDITY', '55%', '', 'text'], ['PRESSURE', '30.01 in', '', 'text'], ['VISIBILITY', '10 mi', '', 'text']], fmt: 'temp' }), ['panel', 'weather']);
  def('wx-daily', 'Daily forecast', 'weather', 1920, 1080, 'Morning / afternoon / evening / overnight.', cardsGraphic({ title: 'TODAY\'S FORECAST', subtitle: 'City, State', cols: 4, items: [['MORNING', 62, ''], ['AFTERNOON', 78, ''], ['EVENING', 71, ''], ['OVERNIGHT', 58, '']], center: true }), ['panel', 'weather']);
  def('wx-7day', 'Seven-day forecast', 'weather', 1920, 1080, 'Seven day cards with highs.', cardsGraphic({ title: '7-DAY FORECAST', subtitle: 'City, State', cols: 7, items: days.map((d, i) => [d, 70 + i, 'Condition']), center: true }), ['panel', 'weather']);
  def('wx-hourly', 'Hourly forecast', 'weather', 1920, 1080, 'Eight hourly cards.', cardsGraphic({ title: 'HOURLY FORECAST', subtitle: 'City, State', cols: 4, items: [['8 AM', 60, ''], ['9 AM', 62, ''], ['10 AM', 65, ''], ['11 AM', 68, ''], ['NOON', 70, ''], ['1 PM', 72, ''], ['2 PM', 73, ''], ['3 PM', 73, '']], center: true }), ['panel', 'weather']);
  def('wx-hilo', 'High and low temperatures', 'weather', 1920, 1080, 'Cities with high / low.', cardsGraphic({ title: 'HIGHS AND LOWS', subtitle: 'Today', cols: 3, items: [['CITY 1', 80, 'Low: --'], ['CITY 2', 78, 'Low: --'], ['CITY 3', 76, 'Low: --'], ['CITY 4', 74, 'Low: --'], ['CITY 5', 72, 'Low: --'], ['CITY 6', 70, 'Low: --']] }), ['panel', 'weather']);
  def('wx-regional-cities', 'Regional forecast (city list)', 'weather', 1920, 1080, 'Six cities with highs.', cardsGraphic({ title: 'REGIONAL FORECAST', subtitle: 'Today\'s highs', cols: 3, items: [['CITY 1', 82, ''], ['CITY 2', 80, ''], ['CITY 3', 78, ''], ['CITY 4', 76, ''], ['CITY 5', 74, ''], ['CITY 6', 72, '']] }), ['panel', 'weather']);
  def('wx-closures', 'School and business closures', 'safety', 1920, 1080, 'Eight-row closure list.', listGraphic({ title: 'CLOSURES AND DELAYS', sub: 'Updated list', rows: 7, sampleRows: ['School district', 'Details', 'CLOSED'] }), ['list', 'public safety']);
  def('bn-roads', 'Road closures', 'safety', 1920, 1080, 'Road closure list.', listGraphic({ title: 'ROAD CLOSURES', sub: 'Current closures', rows: 7, sampleRows: ['Highway / road', 'Between X and Y', 'CLOSED'] }), ['list', 'public safety']);
  // Breaking
  [['bn-breaking', 'Breaking news', 'BREAKING NEWS', 'HEADLINE GOES HERE', 'Supporting detail goes here.', null], ['bn-developing', 'Developing story', 'DEVELOPING', 'HEADLINE GOES HERE', 'Supporting detail goes here.', '#F2B53D'], ['bn-live', 'Live coverage', 'LIVE COVERAGE', 'WHAT WE ARE COVERING', 'Join us live.', null], ['bn-emergency', 'Emergency alert', 'EMERGENCY ALERT', 'ALERT HEADLINE', 'What people should do.', null], ['bn-presser', 'Press conference', 'PRESS CONFERENCE', 'WHO IS SPEAKING', 'Topic and time.', '#4C9BFF'], ['bn-psa', 'Public safety announcement', 'PUBLIC SAFETY', 'SAFETY MESSAGE', 'What to know.', '#4C9BFF'], ['bn-headline', 'Headline card', 'TOP STORY', 'HEADLINE GOES HERE', 'Deck / summary line.', null], ['bn-explainer', 'News explainer', 'EXPLAINER', 'WHAT YOU NEED TO KNOW', 'Three key points go here.', '#3FB6C9']].forEach(([id, name, k, h, sub, kf]) =>
    def(id, name, id === 'bn-emergency' || id === 'bn-psa' ? 'safety' : 'breaking', 1920, 1080, 'Full-screen ' + name.toLowerCase() + ' with kicker, headline, subhead and location.', newsScreen({ kicker: k, headline: h, sub, kickerFill: kf, location: 'City, State' }), ['news']));
  def('bn-incident', 'Incident location', 'breaking', 1920, 1080, 'Map with pin, location and detail panel.', incidentMap({ title: 'INCIDENT', subtitle: 'Location' }), ['map']);
  def('bn-reporter-loc', 'Reporter location', 'breaking', 1920, 1080, 'Map with reporter location panel.', incidentMap({ title: 'ON LOCATION', subtitle: 'Reporter location', fields: { location: 'Reporter location', detail: 'Reporter name' } }), ['map']);
  def('bn-stats', 'Statistics (bar chart)', 'general', 1920, 1080, 'Bar chart from your own data.', chartCard({ title: 'HEADLINE ABOUT THE NUMBERS', sub: 'Chart subtitle and units', chart: 'bar', spec: { labels: ['One', 'Two', 'Three', 'Four'], values: [10, 20, 15, 25] } }), ['chart']);
  def('bn-stats-line', 'Statistics (line chart)', 'general', 1920, 1080, 'Line chart from your own data.', chartCard({ title: 'TREND HEADLINE', sub: 'Chart subtitle and units', chart: 'line', spec: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'], values: [5, 9, 7, 14, 12] } }), ['chart']);
  def('bn-quote', 'Quote card', 'breaking', 1080, 1080, 'Square quote card.', quoteCard({ w: 1080, h: 1080 }), ['quote']);
  // Broadcast
  def('bc-lower3', 'Lower third', 'broadcast', 1920, 1080, 'Name, title and location on transparent background.', lowerThird({ name: 'NAME GOES HERE', title: 'Title or location', right: 'CITY' }), ['transparent']);
  def('bc-nameplate', 'Anchor nameplate', 'broadcast', 1920, 1080, 'Navy plate with accent bar.', lowerThird({ style: 'bar', name: 'ANCHOR NAME', title: 'Anchor' }), ['transparent']);
  def('bc-reporter', 'Reporter ID banner', 'broadcast', 1920, 1080, 'Reporter name and title.', lowerThird({ style: 'bar', name: 'REPORTER NAME', title: 'Reporter · Location', y: 800 }), ['transparent']);
  def('bc-interview', 'Interview identification', 'broadcast', 1920, 1080, 'Guest name and title.', lowerThird({ style: 'bar', name: 'GUEST NAME', title: 'Title, organization' }), ['transparent']);
  def('bc-strap', 'Breaking news strap', 'broadcast', 1920, 1080, 'Full-width strap with BREAKING tag.', lowerThird({ style: 'strap', tag: 'BREAKING', name: 'HEADLINE TEXT GOES HERE', y: 860, h: 120 }), ['transparent']);
  def('bc-live', 'LIVE indicator', 'broadcast', 1920, 1080, 'LIVE bug with location tag.', bug({ kind: 'live' }), ['transparent']);
  def('bc-bug', 'Logo bug', 'broadcast', 1920, 1080, 'Corner logo bug.', bug({ kind: 'bug' }), ['transparent']);
  def('bc-title', 'Full-screen title card', 'broadcast', 1920, 1080, 'Opaque title card.', titleCard({ title: 'SHOW OR SEGMENT TITLE', sub: 'Subtitle', stripe: true }), ['full screen']);
  def('bc-transition', 'Segment transition', 'broadcast', 1920, 1080, 'Segment title card (static frame).', titleCard({ title: 'NEXT SEGMENT', sub: 'Up next', bg: '#1A2230' }), ['full screen']);
  def('bc-closing', 'Closing card', 'broadcast', 1920, 1080, 'Closing card.', titleCard({ title: 'THANKS FOR WATCHING', sub: 'Website and social handles', size: 120 }), ['full screen']);
  def('bc-videobg', 'Video background', 'broadcast', 1920, 1080, 'Gradient background for video segments.', (brand) => { const c = ctx(brand, 1920, 1080); c.grad(0, 0, 1920, 1080, c.navy, c.land, { name: 'Background gradient' }); c.rect(0, 1000, 1920, 8, { fill: c.acc, role: 'accent', name: 'Accent rule' }); return finish(c, { canvas: { w: 1920, h: 1080, bg: { transparent: false, color: c.navy } }, fields: {}, fieldDefs: [] }); }, ['full screen']);
  def('bc-overlay', 'Transparent safe-area overlay', 'broadcast', 1920, 1080, 'Corner marks and caption on transparent background.', overlay({}), ['transparent']);
  def('bc-presenter', 'Weather presenter graphic', 'broadcast', 1920, 1080, 'Header and five-day strip on a transparent background for use over a presenter.', overlay({ kind: 'presenter' }), ['transparent', 'weather']);
  // Social
  [['so-fb', 'Facebook post', 1200, 630, 'TOP STORY', 'HEADLINE GOES HERE', 84], ['so-ig', 'Instagram post', 1080, 1350, 'BREAKING', 'HEADLINE GOES HERE', 110], ['so-story', 'Instagram story', 1080, 1920, 'BREAKING', 'HEADLINE GOES HERE', 130], ['so-yt', 'YouTube thumbnail', 1280, 720, 'WATCH', 'BIG TEXT HERE', 120], ['so-ytc', 'YouTube community post', 1080, 1080, 'UPDATE', 'HEADLINE GOES HERE', 110], ['so-short', 'Vertical short-form video', 1080, 1920, 'LIVE', 'HEADLINE GOES HERE', 130], ['so-x', 'X post', 1200, 675, 'BREAKING', 'HEADLINE GOES HERE', 90], ['so-web', 'Website thumbnail', 1200, 675, 'NEWS', 'HEADLINE GOES HERE', 90], ['so-article', 'Digital news article', 1200, 675, 'TOP STORY', 'HEADLINE GOES HERE', 90]].forEach(([id, name, w, h, k, hl, big]) =>
    def(id, name, 'social', w, h, name + ' (' + w + '×' + h + ').', socialCard({ w, h, kicker: k, headline: hl, big }), ['social']));
  // Public safety / general
  def('gn-lowerthird-web', 'Digital news thumbnail', 'general', 1200, 675, 'Landscape digital thumbnail.', socialCard({ w: 1200, h: 675, kicker: 'NEWS', headline: 'HEADLINE GOES HERE', big: 90 }), ['thumbnail']);
  def('gn-quote-wide', 'Quote card (wide)', 'general', 1920, 1080, 'Landscape quote card.', quoteCard({ w: 1920, h: 1080 }), ['quote']);
  def('gn-blank-map', 'Blank map graphic', 'general', 1920, 1080, 'A full-frame map with header bar; start here for custom map graphics.', mapGraphic({ title: 'MAP TITLE', subtitle: 'Subtitle', view: 'Lower 48', layers: [], sample: false }), ['map']);

  NS.Templates = {
    list: T,
    async instantiate(t, brand) {
      await NS.prepareFonts([brand.fonts.display, brand.fonts.body, brand.fonts.mono]);
      const r = t.build(brand), p = NS.blankProject(r.canvas.w, r.canvas.h, t.name, t.category);
      Object.assign(p, { canvas: r.canvas, objects: r.objects, fields: r.fields || {}, fieldDefs: r.fieldDefs || [], templateId: t.id });
      return p;
    }
  };
})();
