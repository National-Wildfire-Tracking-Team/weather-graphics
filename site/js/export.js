/* Export engine. Renders from the saved project JSON into an off-screen StaticCanvas at the project's real size x scale,
   never from the editor viewport. Maps are re-rendered natively at the target pixel ratio. */
(function () {
  const MAX_SIDE = 8192, MAX_PIXELS = 64e6;
  async function loadInto(sc, project) {
    const data = { version: fabric.version, objects: JSON.parse(JSON.stringify(project.objects || [])) }, warnings = [];
    const resolve = o => { if (o.type === 'image' && String(o.src).startsWith('asset:')) { const d = NS.assetCache.get(o.assetId); if (!d) { warnings.push('Missing image asset "' + (o.name || o.assetId) + '" — skipped.'); o.src = ''; } else o.src = d; } (o.objects || []).forEach(resolve); };
    data.objects.forEach(resolve); data.objects = data.objects.filter(o => !(o.type === 'image' && !o.src));
    const fams = new Set(); (function w(a) { (a || []).forEach(o => { if (o.fontFamily) fams.add(o.fontFamily + '|' + (o.fontWeight || 400)); w(o.objects); }); })(data.objects);
    await Promise.all([...fams].map(k => { const [f, wgt] = k.split('|'); return document.fonts.load(wgt + ' 24px "' + f + '"').catch(() => {}); }));
    if (fabric.util.clearFabricFontCache) fabric.util.clearFabricFontCache();
    fams.forEach(k => { const [f, wgt] = k.split('|'); if (document.fonts && !document.fonts.check(wgt + ' 24px "' + f + '"')) warnings.push('Font "' + f + '" is not available in this browser; a fallback font was used.'); });
    await new Promise(res => sc.loadFromJSON(data, res));
    NS.applyFields(sc.getObjects(), project.fields || {}, project.settings || {});
    return warnings;
  }
  function boundsWarnings(sc, W, H) {
    let n = 0; sc.getObjects().forEach(o => { if (!o.visible) return; const b = o.getBoundingRect(true, true); if (b.left < -1 || b.top < -1 || b.left + b.width > W + 1 || b.top + b.height > H + 1) n++; });
    return n ? [n + ' object' + (n > 1 ? 's extend' : ' extends') + ' beyond the canvas edge and will be clipped in the export.'] : [];
  }
  /* Live-production destinations. OBS's default canvas is 1920×1080 and its Image source keeps PNG alpha.
     StreamYard's published spec for overlays/backgrounds is 1280×720, JPG/PNG/GIF, under 20 MB; overlays need transparency. */
  const TARGETS = {
    obs: { label: 'OBS Studio — Image source (1920×1080 PNG)', w: 1920, h: 1080, format: 'png', alpha: 'keep', suffix: '_obs',
      howto: 'In OBS: Sources → + → Image → pick this file. It fills a 1920×1080 canvas exactly; transparent areas show the sources below it.' },
    'sy-overlay': { label: 'StreamYard — Overlay (1280×720 transparent PNG)', w: 1280, h: 720, format: 'png', alpha: 'keep', maxBytes: 20e6, needsAlpha: true, suffix: '_streamyard-overlay',
      howto: 'In StreamYard: Brand → Overlays → + → upload this file, then click it in the studio to show it over the cameras.' },
    'sy-background': { label: 'StreamYard — Background (1280×720 PNG)', w: 1280, h: 720, format: 'png', alpha: 'off', maxBytes: 20e6, suffix: '_streamyard-bg',
      howto: 'In StreamYard: Brand → Backgrounds → + → upload this file. Cameras and screen shares sit on top of it.' }
  };
  const E = NS.Export = {
    TARGETS,
    /* Export options for a destination: output fits the destination frame (exact for 16:9 canvases). */
    targetOptions(project, id) {
      const t = TARGETS[id]; if (!t) return null;
      const W = project.canvas.w, H = project.canvas.h, scale = Math.min(t.w / W, t.h / H);
      return { format: t.format, scale, transparent: t.alpha === 'keep' && !!project.canvas.bg.transparent, target: id };
    },
    /* Checks the verified file against the destination's requirements. */
    targetWarnings(project, r, id) {
      const t = TARGETS[id]; if (!t) return []; const w = [];
      if (r.w !== t.w || r.h !== t.h) w.push('This design is ' + project.canvas.w + '×' + project.canvas.h + ', not 16:9, so the file is ' + r.w + '×' + r.h + ' instead of ' + t.w + '×' + t.h + '. ' + (id === 'obs' ? 'OBS will show it unscaled; resize it in the scene if needed.' : 'StreamYard stretches overlays and backgrounds to fill the frame, so it will look distorted. Use a 1920×1080 or 1280×720 canvas.'));
      if (t.maxBytes && r.blob.size > t.maxBytes) w.push('File is ' + NS.ui.fmtBytes(r.blob.size) + '; StreamYard rejects files over 20 MB.');
      if (t.needsAlpha && !r.info.hasAlpha) w.push('This file has no transparent pixels, so as an overlay it will cover the cameras. Use a transparent template (e.g. Broadcast → Lower third) or export as a StreamYard background instead.');
      return w;
    },
    sampleCount(project) { let n = 0; (function w(a) { (a || []).forEach(o => { if (o.sample) n++; w(o.objects); }); })(project.objects); return n; },
    async render(project, o) {
      o = Object.assign({ format: 'png', scale: 1, transparent: false, quality: 0.92 }, o);
      const W = project.canvas.w, H = project.canvas.h, scale = o.scale, outW = Math.round(W * scale), outH = Math.round(H * scale);
      if (outW > MAX_SIDE || outH > MAX_SIDE || outW * outH > MAX_PIXELS) throw new Error('Output ' + outW + '×' + outH + ' exceeds this browser tool\'s limit (' + MAX_SIDE + ' px per side). Reduce the scale.');
      const sc = new fabric.StaticCanvas(null, { width: W, height: H, enableRetinaScaling: false, renderOnAddRemove: false });
      sc.__exportImages = {};
      let warnings = await loadInto(sc, project);
      warnings = warnings.concat(boundsWarnings(sc, W, H));
      for (const m of sc.getObjects().filter(x => x.type === 'MapFrame')) {
        const r = await NS.renderMapCanvas(m.mapState, Math.round(m.width * (m.scaleX || 1)), Math.round(m.height * (m.scaleY || 1)), scale); sc.__exportImages[m.id] = r.canvas; warnings.push(...r.warnings);
      }
      const bg = project.canvas.bg, wantAlpha = !!(o.transparent && bg.transparent && o.format !== 'jpeg');
      const fill = /^#[0-9a-f]{6}$/i.test(bg.color) ? bg.color : '#0C1119';
      let blob;
      if (o.format === 'svg') {
        let svg = sc.toSVG({ width: outW + 'px', height: outH + 'px', viewBox: { x: 0, y: 0, width: W, height: H } });
        if (!(o.transparent && bg.transparent)) svg = svg.replace(/(<svg[^>]*>)/, '$1<rect width="100%" height="100%" fill="' + (bg.transparent ? '#ffffff' : fill) + '"/>');
        blob = new Blob([svg], { type: 'image/svg+xml' });
        warnings.push('SVG: text keeps its font-family names (fonts are not embedded) and each map is embedded as a raster image.');
      } else {
        const art = sc.toCanvasElement(scale), out = document.createElement('canvas'); out.width = outW; out.height = outH; const ctx = out.getContext('2d');
        if (art.width !== outW || art.height !== outH) warnings.push('Rendered ' + art.width + '×' + art.height + ', expected ' + outW + '×' + outH + '.');
        if (!wantAlpha) {
          ctx.fillStyle = bg.transparent ? (o.format === 'jpeg' ? '#ffffff' : fill) : fill; ctx.fillRect(0, 0, outW, outH);
          if (bg.transparent) warnings.push(o.format === 'jpeg' ? 'JPEG cannot be transparent; transparent areas were filled white.' : 'This design has a transparent background but "Transparent" was off: background filled with ' + fill + '.');
        }
        ctx.drawImage(art, 0, 0);
        blob = await new Promise(r => out.toBlob(r, o.format === 'jpeg' ? 'image/jpeg' : 'image/png', o.quality));
      }
      sc.dispose();
      if (!blob) throw new Error('The browser could not encode the image.');
      const info = await E.verify(blob, o.format, outW, outH);
      if (wantAlpha && !info.hasAlpha) warnings.push('Transparent PNG requested but no transparent pixels were found.');
      if (info.mismatch) warnings.push('Decoded size ' + info.w + '×' + info.h + ' does not match the expected ' + outW + '×' + outH + '.');
      const r = { blob, w: info.w || outW, h: info.h || outH, format: o.format, warnings, info, ext: o.format === 'jpeg' ? 'jpg' : o.format, target: o.target || null };
      warnings.push(...E.targetWarnings(project, r, o.target));
      return r;
    },
    /* Decode the produced file and check its real dimensions / transparency (not just what we asked for). */
    async verify(blob, format, w, h) {
      if (format === 'svg') return { w, h, hasAlpha: true, bytes: blob.size, mismatch: false };
      const bmp = await createImageBitmap(blob), c = document.createElement('canvas'); c.width = Math.min(bmp.width, 512); c.height = Math.min(bmp.height, 512);
      const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0, c.width, c.height); const d = ctx.getImageData(0, 0, c.width, c.height).data; let clear = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) clear++;
      const out = { w: bmp.width, h: bmp.height, hasAlpha: clear > 0, clearFraction: clear / (d.length / 4), bytes: blob.size, mismatch: bmp.width !== w || bmp.height !== h }; bmp.close && bmp.close(); return out;
    },
    fileName(project, r, suffix) { return (project.name || 'graphic').replace(/[^\w\-]+/g, '_') + '_' + r.w + 'x' + r.h + (TARGETS[r.target] ? TARGETS[r.target].suffix : '') + (suffix || '') + '.' + r.ext; },
    download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); },
    async record(project, r) { try { await NS.Store.put('exports', { id: NS.uid('exp'), projectId: project.id, projectName: project.name, format: r.format, w: r.w, h: r.h, bytes: r.blob.size, at: Date.now(), transparent: !!r.info.hasAlpha && r.format === 'png', target: r.target, warnings: r.warnings }); } catch (e) {} },
    /* Editable project file: project JSON + the image assets it references. */
    async projectFile(project) {
      const ids = new Set(); (function w(a) { (a || []).forEach(o => { if (o.assetId) ids.add(o.assetId); w(o.objects); }); })(project.objects);
      const assets = []; for (const id of ids) { const a = await NS.Store.get('assets', id); if (a) assets.push(a); }
      return new Blob([JSON.stringify({ format: 'newsroom-graphics-studio-project', version: 1, project, assets }, null, 1)], { type: 'application/json' });
    }
  };
})();
/* Thumbnails for project cards: re-uses cached map bitmaps (no map re-render). */
NS.Export.thumbnail = async function (project, width) {
  const W = project.canvas.w, H = project.canvas.h, sc = new fabric.StaticCanvas(null, { width: W, height: H, enableRetinaScaling: false, renderOnAddRemove: false });
  sc.__exportImages = {};
  try {
    const ls = {}; await (async () => { const data = { version: fabric.version, objects: JSON.parse(JSON.stringify(project.objects || [])) };
      const resolve = o => { if (o.type === 'image' && String(o.src).startsWith('asset:')) o.src = NS.assetCache.get(o.assetId) || ''; (o.objects || []).forEach(resolve); }; data.objects.forEach(resolve); data.objects = data.objects.filter(o => !(o.type === 'image' && !o.src));
      await new Promise(res => sc.loadFromJSON(data, res)); })();
    NS.applyFields(sc.getObjects(), project.fields || {}, project.settings || {});
    sc.getObjects().forEach(o => { if (o.type === 'MapFrame') { const e = NS.mapImages.get(o.id); if (e && e.canvas) sc.__exportImages[o.id] = e.canvas; } });
    const k = (width || 360) / W, art = sc.toCanvasElement(k), out = document.createElement('canvas'); out.width = Math.round(W * k); out.height = Math.round(H * k);
    const ctx = out.getContext('2d'), bg = project.canvas.bg;
    if (bg.transparent) { ctx.fillStyle = '#2a3140'; ctx.fillRect(0, 0, out.width, out.height); ctx.fillStyle = '#1c222c'; for (let y = 0; y < out.height; y += 16) for (let x = (y / 16) % 2 ? 0 : 16; x < out.width; x += 32) ctx.fillRect(x, y, 16, 16); } else { ctx.fillStyle = bg.color; ctx.fillRect(0, 0, out.width, out.height); }
    ctx.drawImage(art, 0, 0); return out.toDataURL('image/jpeg', 0.7);
  } catch (e) { return null; } finally { sc.dispose(); }
};
