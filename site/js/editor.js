/* Graphics editor engine (Fabric.js 5.3.1). Document = structured JSON (project.objects); nothing is flattened while editing.
   Map elements are fabric.MapFrame objects holding a mapState; their bitmap is a cache re-rendered from that state. */
(function () {
  const PROPS = ['id', 'name', 'locked', 'kind', 'mapState', 'fieldKey', 'fieldFmt', 'fieldTpl', 'showIf', 'colorRole', 'sample', 'assetId', 'crop', 'chartSpec', 'role', 'attrib'];
  NS.PROPS = PROPS;
  NS.mapImages = new Map();      // object id -> {status, canvas, msg, key}
  NS.assetCache = new Map();     // asset id -> dataURL (filled by app when assets load)

  /* ---------- MapFrame ---------- */
  fabric.MapFrame = fabric.util.createClass(fabric.Rect, {
    type: 'MapFrame', kind: 'map', mapState: null, objectCaching: false, fill: '#1A2230', stroke: null, strokeWidth: 0,
    toObject(extra) { return fabric.util.object.extend(this.callSuper('toObject', extra), { kind: 'map', mapState: this.mapState }); },
    _render(ctx) {
      const w = this.width, h = this.height, x = -w / 2, y = -h / 2;
      const ex = this.canvas && this.canvas.__exportImages && this.canvas.__exportImages[this.id];
      const e = ex ? { status: 'ok', canvas: ex } : NS.mapImages.get(this.id);
      ctx.save();
      if (e && e.canvas) {
        ctx.drawImage(e.canvas, x, y, w, h);
        if (e.status === 'loading') { ctx.fillStyle = 'rgba(12,17,25,.35)'; ctx.fillRect(x, y, w, h); }
      } else {
        ctx.fillStyle = '#1A2230'; ctx.fillRect(x, y, w, h);
      }
      const st = this.mapState;
      if (e && e.status !== 'ok' && !ex) {
        const fs = Math.max(14, Math.min(w, h) / 22);
        ctx.fillStyle = e.status === 'error' ? '#F2453D' : '#9AA7B8'; ctx.font = '600 ' + fs + 'px Barlow, sans-serif'; ctx.textAlign = 'center';
        const lines = e.status === 'error' ? ['MAP UNAVAILABLE', (e.msg || '').slice(0, 90)] : [e.status === 'loading' ? 'Rendering map…' : 'Map not rendered'];
        lines.forEach((t, i) => ctx.fillText(t, 0, (i - (lines.length - 1) / 2) * fs * 1.4));
      }
      if (st && st.showAttribution !== false && e && e.status === 'ok' && !(this.canvas && this.canvas.__noAttr)) {
        const txt = NS.attributionFor(st), fs = Math.max(9, Math.round(h / 90)); ctx.font = '400 ' + fs + 'px Barlow, sans-serif'; ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(8,12,18,.6)'; const tw = ctx.measureText(txt).width; ctx.fillRect(x + w - tw - fs * 1.4, y + h - fs * 1.9, tw + fs * 1.4, fs * 1.9);
        ctx.fillStyle = '#E8EDF3'; ctx.fillText(txt, x + w - fs * 0.7, y + h - fs * 0.55);
      }
      if (st && st.showLegend !== false && e && e.status === 'ok') NS.drawLegend(ctx, NS.legendEntries(st), x, y, w, h, st.legendPos || 'br');
      ctx.restore();
    },
    _toSVG() {
      const ex = this.canvas && this.canvas.__exportImages && this.canvas.__exportImages[this.id];
      const w = this.width, h = this.height;
      if (!ex) return ['<rect x="', -w / 2, '" y="', -h / 2, '" width="', w, '" height="', h, '" fill="#1A2230"/>\n'];
      return ['<image x="', -w / 2, '" y="', -h / 2, '" width="', w, '" height="', h, '" xlink:href="', ex.toDataURL('image/png'), '"/>\n'];
    }
  });
  fabric.MapFrame.fromObject = function (o, cb) { return fabric.Object._fromObject('MapFrame', o, cb); };

  const FONTS = ['Barlow Condensed', 'Barlow', 'Oswald', 'Merriweather', 'Roboto Mono', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Verdana', 'Trebuchet MS'];
  NS.FONTS = FONTS;
  const fmtDT = v => { if (!v) return ''; const d = new Date(v); if (isNaN(d)) return v; return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(',', '').toUpperCase(); };
  const WIND_U = { mph: [1, ' MPH'], kt: [0.868976, ' KT'], kmh: [1.609344, ' KM/H'] };
  NS.formatField = function (obj, fields, settings) {
    const raw = fields[obj.fieldKey]; let v = raw == null ? '' : String(raw), u = '';
    if (v === '' && (obj.fieldFmt === 'temp' || obj.fieldFmt === 'wind')) return '--';
    switch (obj.fieldFmt) {
      case 'temp': if (v !== '' && !isNaN(+v)) { v = settings.tempUnit === 'C' ? Math.round((+v - 32) * 5 / 9) : Math.round(+v); u = '°'; } break;
      case 'wind': if (v !== '' && !isNaN(+v)) { const c = WIND_U[settings.windUnit] || WIND_U.mph; v = Math.round(+v * c[0]); u = c[1]; } break;
      case 'datetime': v = fmtDT(v); break;
      case 'upper': v = v.toUpperCase(); break;
    }
    return (obj.fieldTpl || '{v}{u}').replace('{v}', v).replace('{u}', u);
  };

  NS.applyFields = function walk(objs, f, s) {
    (objs || []).forEach(o => {
      if (o.fieldKey && o.type === 'textbox') { const t = NS.formatField(o, f, s); if (o.text !== t) { o.set('text', t); o.initDimensions && o.initDimensions(); } }
      if (o.showIf) o.visible = !!f[o.showIf];
      if (o.colorRole && f[o.colorRole]) o.set('fill', f[o.colorRole]);
      if (o._objects) walk(o._objects, f, s);
    });
  };

  class Editor {
    constructor(host, project, hooks) {
      this.host = host; this.p = project; this.h = hooks || {};
      this.zoom = 1; this.guides = []; this.tool = null; this.space = false; this.panning = false;
      this.showSafe = false; this.snap = true; this.loading = true; this.hist = []; this.hi = -1; this.dirtyCb = hooks.onDirty || (() => {});
      const el = document.createElement('canvas'); host.appendChild(el);
      this.canvas = new fabric.Canvas(el, { preserveObjectStacking: true, selection: true, stopContextMenu: true, fireRightClick: true, enableRetinaScaling: true, backgroundColor: null });
      this.bindEvents(); this.resize();
      this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host);
    }
    destroy() { this.ro.disconnect(); window.removeEventListener('keydown', this._kd); window.removeEventListener('keyup', this._ku); this.canvas.dispose(); this.host.innerHTML = ''; this.destroyed = true; }

    /* ----- document load/save ----- */
    async load(project) {
      this.p = project || this.p; this.loading = true;
      const data = { version: fabric.version, objects: JSON.parse(JSON.stringify(this.p.objects || [])) };
      const resolve = o => { if (o.type === 'image' && o.assetId && String(o.src).startsWith('asset:')) o.src = NS.assetCache.get(o.assetId) || ''; (o.objects || []).forEach(resolve); };
      data.objects.forEach(resolve);
      const missing = []; data.objects.forEach(function f(o) { if (o.type === 'image' && !o.src) missing.push(o.assetId); (o.objects || []).forEach(f); });
      data.objects = data.objects.filter(o => !(o.type === 'image' && !o.src));
      await this.ensureFonts(data.objects);
      const vpt = this.canvas.viewportTransform.slice();
      await new Promise(res => this.canvas.loadFromJSON(data, res, (o, obj) => { if (!obj.id) obj.id = NS.uid('o'); this.applyLock(obj); }));
      this.canvas.setViewportTransform(vpt); this.canvas.backgroundColor = null;
      this.canvas.getObjects().forEach(o => { if (o.type === 'MapFrame') this.refreshMap(o); });
      this.applyFields(true);
      this.loading = false; this.canvas.requestRenderAll();
      return missing;
    }
    serialize() {
      const json = this.canvas.toJSON(PROPS);
      const strip = o => { if (o.type === 'image' && o.assetId) o.src = 'asset:' + o.assetId; (o.objects || []).forEach(strip); };
      json.objects.forEach(strip);
      return json.objects;
    }
    /* Text typed directly on the canvas must win over the template field it is bound to; otherwise applyFields()
       (run on load, preview and export) silently reverts it. Plain bindings write back to the field; formatted ones detach. */
    reconcileFields() {
      const f = this.p.fields || (this.p.fields = {}), s = this.p.settings || {};
      (function walk(objs) {
        (objs || []).forEach(o => {
          if (o.fieldKey && o.type === 'textbox' && o.text !== NS.formatField(o, f, s)) {
            const plain = (!o.fieldFmt || o.fieldFmt === 'upper') && (!o.fieldTpl || o.fieldTpl === '{v}{u}');
            if (plain) f[o.fieldKey] = o.text; else o.fieldKey = null;
          }
          if (o._objects) walk(o._objects);
        });
      })(this.canvas.getObjects());
    }
    syncProject() { this.reconcileFields(); this.p.objects = this.serialize(); this.p.updated = Date.now(); return this.p; }

    /* ----- history ----- */
    snapshot() { this.reconcileFields(); return JSON.stringify([this.serialize(), this.p.canvas, this.p.fields, this.p.settings]); }
    initHistory() { this.hist = [this.snapshot()]; this.hi = 0; this.emitHist(); }
    commit(markDirty) {
      if (this.loading) return;
      const s = this.snapshot(); if (s === this.hist[this.hi]) return;
      this.hist = this.hist.slice(0, this.hi + 1); this.hist.push(s); if (this.hist.length > 120) this.hist.shift(); this.hi = this.hist.length - 1;
      this.emitHist(); if (markDirty !== false) this.dirtyCb();
    }
    emitHist() { this.h.onHistory && this.h.onHistory(this.hi > 0, this.hi < this.hist.length - 1); }
    async restore(i) {
      const [objs, cv, fields, settings] = JSON.parse(this.hist[i]); this.hi = i;
      this.p.canvas = cv; this.p.fields = fields; this.p.settings = settings; this.p.objects = objs;
      this.canvas.discardActiveObject(); await this.load(); this.emitHist(); this.dirtyCb(); this.h.onSelection && this.h.onSelection(); this.h.onCanvasChange && this.h.onCanvasChange();
    }
    undo() { if (this.hi > 0) return this.restore(this.hi - 1); }
    redo() { if (this.hi < this.hist.length - 1) return this.restore(this.hi + 1); }

    /* ----- viewport ----- */
    resize() { const r = this.host.getBoundingClientRect(); if (!r.width) return; this.canvas.setDimensions({ width: r.width, height: r.height }); if (!this._placed) { this._placed = true; this.fit(); } else this.canvas.requestRenderAll(); }
    setZoom(z, cx, cy) {
      z = Math.max(0.05, Math.min(8, z)); const c = this.canvas, v = c.viewportTransform.slice(), w = c.getWidth(), h = c.getHeight();
      cx = cx == null ? w / 2 : cx; cy = cy == null ? h / 2 : cy;
      const wx = (cx - v[4]) / v[0], wy = (cy - v[5]) / v[3];
      v[0] = v[3] = z; v[4] = cx - wx * z; v[5] = cy - wy * z; c.setViewportTransform(v); this.zoom = z; this.h.onZoom && this.h.onZoom(z);
    }
    fit() { const c = this.canvas, W = this.p.canvas.w, H = this.p.canvas.h, z = Math.min((c.getWidth() - 80) / W, (c.getHeight() - 80) / H); this.center(Math.max(0.05, z)); }
    actual() { this.center(1); }
    center(z) { const c = this.canvas; c.setViewportTransform([z, 0, 0, z, (c.getWidth() - this.p.canvas.w * z) / 2, (c.getHeight() - this.p.canvas.h * z) / 2]); this.zoom = z; this.h.onZoom && this.h.onZoom(z); }

    /* ----- events ----- */
    bindEvents() {
      const c = this.canvas;
      c.on('before:render', e => this.drawArtboard(e.ctx));
      c.on('after:render', e => this.drawGuides(e.ctx));
      ['object:added', 'object:removed'].forEach(ev => c.on(ev, e => { if (this.loading) return; const o = e.target; if (o && !o.id && o.type !== 'activeSelection') o.id = NS.uid('o'); if (ev === 'object:added' && o && o.type === 'MapFrame' && !NS.mapImages.has(o.id)) this.refreshMap(o); this.commit(); this.h.onLayers && this.h.onLayers(); }));
      c.on('object:modified', e => { this.normalize(e.target); this.guides = []; this.commit(); this.h.onSelection && this.h.onSelection(); this.h.onLayers && this.h.onLayers(); });
      c.on('object:moving', e => this.snapMove(e.target));
      c.on('mouse:up', () => { this.guides = []; this.panning = false; this.canvas.requestRenderAll(); });
      ['selection:created', 'selection:updated', 'selection:cleared'].forEach(ev => c.on(ev, () => { this.h.onSelection && this.h.onSelection(); this.h.onLayers && this.h.onLayers(); }));
      c.on('text:changed', () => { this.commitSoon(); });
      c.on('text:editing:exited', () => this.commit());
      c.on('mouse:down', e => { const ev = e.e; if (this.space || ev.button === 1 || this.tool === 'hand') { this.panning = true; c.selection = false; this.lastX = ev.clientX; this.lastY = ev.clientY; c.setCursor('grabbing'); } });
      c.on('mouse:move', e => { if (!this.panning) return; const ev = e.e, v = c.viewportTransform; v[4] += ev.clientX - this.lastX; v[5] += ev.clientY - this.lastY; this.lastX = ev.clientX; this.lastY = ev.clientY; c.requestRenderAll(); });
      c.on('mouse:wheel', e => {
        const ev = e.e; ev.preventDefault(); ev.stopPropagation();
        if (ev.ctrlKey || ev.metaKey) this.setZoom(this.zoom * Math.pow(0.998, ev.deltaY), ev.offsetX, ev.offsetY);
        else { const v = c.viewportTransform; v[4] -= ev.shiftKey ? ev.deltaY : ev.deltaX; v[5] -= ev.shiftKey ? 0 : ev.deltaY; c.requestRenderAll(); }
      });
      this._kd = e => this.onKey(e); this._ku = e => { if (e.code === 'Space') { this.space = false; this.canvas.selection = true; } };
      window.addEventListener('keydown', this._kd); window.addEventListener('keyup', this._ku);
    }
    commitSoon() { clearTimeout(this._cs); this._cs = setTimeout(() => this.commit(), 400); }
    inField(e) { const t = e.target; return t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable); }
    onKey(e) {
      if (this.destroyed || this.inField(e)) return;
      if (document.querySelector('dialog[open]') || document.getElementById('mapStudio')) return;
      const act = this.canvas.getActiveObject(); if (act && act.isEditing) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (e.code === 'Space') { this.space = true; this.canvas.selection = false; e.preventDefault(); return; }
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if (mod && k === 'y') { e.preventDefault(); this.redo(); }
      else if (mod && k === 'c') { e.preventDefault(); this.copy(); }
      else if (mod && k === 'v') { e.preventDefault(); this.paste(); }
      else if (mod && k === 'd') { e.preventDefault(); this.duplicate(); }
      else if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? this.ungroup() : this.group(); }
      else if (mod && k === 'a') { e.preventDefault(); this.selectAll(); }
      else if (mod && k === ']') { e.preventDefault(); this.order(e.shiftKey ? 'front' : 'forward'); }
      else if (mod && k === '[') { e.preventDefault(); this.order(e.shiftKey ? 'back' : 'backward'); }
      else if (mod && k === '0') { e.preventDefault(); this.fit(); }
      else if (mod && k === '1') { e.preventDefault(); this.actual(); }
      else if (mod && k === 's') { e.preventDefault(); this.h.onSave && this.h.onSave(); }
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); this.deleteSelected(); }
      else if (k === 'escape') { this.canvas.discardActiveObject(); this.canvas.requestRenderAll(); }
      else if (/^arrow/.test(k) && act) { e.preventDefault(); const d = e.shiftKey ? 10 : 1; if (act.locked) return; if (k === 'arrowleft') act.left -= d; if (k === 'arrowright') act.left += d; if (k === 'arrowup') act.top -= d; if (k === 'arrowdown') act.top += d; act.setCoords(); this.canvas.requestRenderAll(); this.commitSoon(); }
      else if (!mod && (k === '+' || k === '=')) this.setZoom(this.zoom * 1.2);
      else if (!mod && k === '-') this.setZoom(this.zoom / 1.2);
    }

    /* ----- artboard + guides (editor chrome; never part of exports) ----- */
    drawArtboard(ctx) {
      const v = this.canvas.viewportTransform, W = this.p.canvas.w, H = this.p.canvas.h, bg = this.p.canvas.bg;
      ctx.save(); ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
      ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 24; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.shadowColor = 'transparent';
      if (bg.transparent) {
        const s = 24 / Math.max(1, this.zoom > 1 ? 1 : 1); ctx.fillStyle = '#2a3140'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#1c222c';
        for (let y = 0; y < H; y += s * 2) for (let x = 0; x < W; x += s * 2) { ctx.fillRect(x, y, s, s); ctx.fillRect(x + s, y + s, s, s); }
      } else { ctx.fillStyle = bg.color; ctx.fillRect(0, 0, W, H); }
      ctx.restore();
    }
    drawGuides(ctx) {
      const v = this.canvas.viewportTransform, W = this.p.canvas.w, H = this.p.canvas.h, z = this.zoom;
      ctx.save(); ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]); ctx.lineWidth = 1 / z;
      ctx.strokeStyle = 'rgba(138,160,190,.9)'; ctx.setLineDash([]); ctx.strokeRect(0, 0, W, H);
      if (this.showSafe) {
        ctx.setLineDash([6 / z, 4 / z]);
        [[0.05, '#F2B53D', 'TITLE SAFE'], [0.0325, '#4C9BFF', 'ACTION SAFE']].forEach(([m, col, lab]) => {
          ctx.strokeStyle = col; ctx.strokeRect(W * m, H * m, W * (1 - 2 * m), H * (1 - 2 * m));
          ctx.fillStyle = col; ctx.font = (11 / z) + 'px Barlow, sans-serif'; ctx.fillText(lab, W * m + 4 / z, H * m + 12 / z);
        });
        if (this.p.canvas.titleBar) { ctx.strokeStyle = '#F2453D'; ctx.strokeRect(0, 0, W, this.p.canvas.titleBar); }
      }
      ctx.setLineDash([]); ctx.strokeStyle = '#F2453D';
      this.guides.forEach(g => { ctx.beginPath(); if (g.x != null) { ctx.moveTo(g.x, -2000); ctx.lineTo(g.x, H + 2000); } else { ctx.moveTo(-2000, g.y); ctx.lineTo(W + 2000, g.y); } ctx.stroke(); });
      ctx.restore();
    }
    snapMove(t) {
      this.guides = []; if (!this.snap || !t) return;
      const W = this.p.canvas.w, H = this.p.canvas.h, th = 7 / this.zoom, br = t.getBoundingRect(true, true);
      const xs = [0, W / 2, W], ys = [0, H / 2, H];
      if (this.showSafe) { xs.push(W * 0.05, W * 0.95); ys.push(H * 0.05, H * 0.95); }
      this.canvas.getObjects().forEach(o => { if (o === t || (t.type === 'activeSelection' && t._objects.includes(o)) || !o.visible) return; const b = o.getBoundingRect(true, true); xs.push(b.left, b.left + b.width / 2, b.left + b.width); ys.push(b.top, b.top + b.height / 2, b.top + b.height); });
      const best = (edges, cands) => { let bd = th + 1, bo = 0, bg = null; edges.forEach(e => cands.forEach(c => { const d = Math.abs(c - e); if (d < bd) { bd = d; bo = c - e; bg = c; } })); return bd <= th ? { o: bo, g: bg } : null; };
      const sx = best([br.left, br.left + br.width / 2, br.left + br.width], xs), sy = best([br.top, br.top + br.height / 2, br.top + br.height], ys);
      if (sx) { t.left += sx.o; this.guides.push({ x: sx.g }); }
      if (sy) { t.top += sy.o; this.guides.push({ y: sy.g }); }
      if (sx || sy) t.setCoords();
    }
    normalize(o) {
      if (!o) return;
      if (o.type === 'textbox' && (o.scaleX !== 1 || o.scaleY !== 1)) { o.set({ fontSize: Math.max(4, Math.round(o.fontSize * o.scaleY)), width: Math.max(10, o.width * o.scaleX / o.scaleY * (o.scaleY)), scaleX: 1, scaleY: 1 }); o.initDimensions(); o.setCoords(); }
      if (o.type === 'MapFrame' && (o.scaleX !== 1 || o.scaleY !== 1)) { o.set({ width: Math.round(o.width * o.scaleX), height: Math.round(o.height * o.scaleY), scaleX: 1, scaleY: 1 }); o.setCoords(); this.refreshMap(o); }
    }

    /* ----- object operations ----- */
    applyLock(o) { const l = !!o.locked; o.set({ lockMovementX: l, lockMovementY: l, lockRotation: l, lockScalingX: l, lockScalingY: l, hasControls: !l }); }
    add(o, name) { o.id = o.id || NS.uid('o'); o.name = o.name || name || o.type; this.canvas.add(o); this.canvas.setActiveObject(o); this.canvas.requestRenderAll(); return o; }
    center_(o) { const W = this.p.canvas.w, H = this.p.canvas.h; o.set({ left: (W - o.getScaledWidth()) / 2, top: (H - o.getScaledHeight()) / 2 }); o.setCoords(); }
    addText(txt, opts) {
      const b = this.brand || NS.DEFAULT_BRAND, W = this.p.canvas.w;
      const t = new fabric.Textbox(txt || 'Double-click to edit', Object.assign({ left: W * 0.1, top: this.p.canvas.h * 0.4, width: W * 0.5, fontFamily: b.fonts.display, fontSize: Math.round(W / 22), fontWeight: 700, fill: '#E8EDF3', textAlign: 'left', lineHeight: 1.1, charSpacing: 0, splitByGrapheme: false }, opts));
      return this.add(t, 'Text');
    }
    addShape(type, opts) {
      const W = this.p.canvas.w, H = this.p.canvas.h, s = Math.round(Math.min(W, H) / 4), accent = NS.brandColor(this.brand || NS.DEFAULT_BRAND, 'Accent', '#F2453D');
      const base = Object.assign({ left: W / 2 - s / 2, top: H / 2 - s / 2, fill: accent, stroke: '#FFFFFF', strokeWidth: 0, strokeUniform: true }, opts);
      let o;
      switch (type) {
        case 'rect': o = new fabric.Rect(Object.assign({ width: s * 1.6, height: s, rx: 0, ry: 0 }, base)); break;
        case 'circle': o = new fabric.Circle(Object.assign({ radius: s / 2 }, base)); break;
        case 'triangle': o = new fabric.Triangle(Object.assign({ width: s, height: s }, base)); break;
        case 'star': { const pts = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.22 : s * 0.5, a = Math.PI * i / 5 - Math.PI / 2; pts.push({ x: s / 2 + r * Math.cos(a), y: s / 2 + r * Math.sin(a) }); } o = new fabric.Polygon(pts, base); break; }
        case 'line': o = new fabric.Line([0, 0, s * 2, 0], Object.assign({}, base, { fill: null, stroke: accent, strokeWidth: 8, strokeLineCap: 'round', left: W / 2 - s, top: H / 2 })); break;
        case 'arrow': { const L = s * 2, hd = 28; o = new fabric.Path('M 0 0 L ' + L + ' 0 M ' + (L - hd) + ' ' + (-hd * 0.7) + ' L ' + L + ' 0 L ' + (L - hd) + ' ' + (hd * 0.7), Object.assign({}, base, { fill: null, stroke: accent, strokeWidth: 10, strokeLineCap: 'round', strokeLineJoin: 'round', left: W / 2 - s, top: H / 2 })); break; }
        default: return null;
      }
      return this.add(o, type[0].toUpperCase() + type.slice(1));
    }
    async addImageAsset(assetId, name) {
      const src = NS.assetCache.get(assetId); if (!src) throw new Error('Asset data is missing.');
      return new Promise((res, rej) => fabric.Image.fromURL(src, img => {
        if (!img || !img.width) return rej(new Error('Could not decode that image.'));
        const W = this.p.canvas.w, H = this.p.canvas.h, k = Math.min(1, (W * 0.5) / img.width, (H * 0.5) / img.height);
        img.set({ scaleX: k, scaleY: k, assetId, crop: { l: 0, t: 0, r: 0, b: 0 } }); this.center_(img); this.add(img, name || 'Image'); res(img);
      }));
    }
    addMap(state, w, h, opts) {
      const W = this.p.canvas.w, H = this.p.canvas.h; w = w || Math.round(W * 0.9); h = h || Math.round(H * 0.8);
      const m = new fabric.MapFrame(Object.assign({ left: (W - w) / 2, top: (H - h) / 2 + (opts && opts.dy || 0), width: w, height: h, mapState: state, name: 'Map' }, opts));
      m.mapState.size = [w, h]; return this.add(m, 'Map');
    }
    refreshMap(o) {
      if (!o.id) o.id = NS.uid('o');
      const st = o.mapState; if (!st) return;
      const w = Math.round(o.width), h = Math.round(o.height), key = JSON.stringify(st) + w + 'x' + h;
      const prev = NS.mapImages.get(o.id); if (prev && prev.key === key && prev.status !== 'error') return;
      NS.mapImages.set(o.id, { status: 'loading', canvas: prev && prev.canvas, key });
      const token = (this._mapTok = (this._mapTok || 0) + 1); (o._tok = token);
      NS.renderMapCanvas(st, w, h, 1).then(r => { if (o._tok !== token) return; NS.mapImages.set(o.id, { status: 'ok', canvas: r.canvas, key }); }).catch(err => {
        if (o._tok !== token) return; NS.mapImages.set(o.id, { status: 'error', msg: err.message, canvas: null, key }); this.h.onToast && this.h.onToast(err.message, 'err');
      }).finally(() => { this.canvas && this.canvas.requestRenderAll && this.canvas.requestRenderAll(); this.h.onSelection && this.h.onSelection(); });
      this.canvas.requestRenderAll && this.canvas.requestRenderAll();
    }
    active() { return this.canvas.getActiveObject(); }
    selected() { const a = this.active(); return !a ? [] : a.type === 'activeSelection' ? a.getObjects() : [a]; }
    deleteSelected() {
      const a = this.active(); if (!a) return; const objs = this.selected().filter(o => !o.locked);
      if (!objs.length) { this.h.onToast && this.h.onToast('Selected objects are locked.', 'err'); return; }
      this.canvas.discardActiveObject(); objs.forEach(o => this.canvas.remove(o)); this.canvas.requestRenderAll();
    }
    selectAll() { const os = this.canvas.getObjects().filter(o => o.selectable && o.visible); if (os.length === 1) this.canvas.setActiveObject(os[0]); else if (os.length) this.canvas.setActiveObject(new fabric.ActiveSelection(os, { canvas: this.canvas })); this.canvas.requestRenderAll(); }
    copy() { const a = this.active(); if (!a) return; a.clone(c => { NS.clip = c; }, PROPS); this.h.onToast && this.h.onToast('Copied', 'ok'); }
    paste() {
      if (!NS.clip) return; const cv = this.canvas;
      NS.clip.clone(c => {
        cv.discardActiveObject(); c.set({ left: c.left + 24, top: c.top + 24, evented: true });
        if (c.type === 'activeSelection') { c.canvas = cv; c.forEachObject(o => { o.id = NS.uid('o'); cv.add(o); }); c.setCoords(); } else { c.id = NS.uid('o'); cv.add(c); }
        NS.clip.left += 24; NS.clip.top += 24; cv.setActiveObject(c); cv.requestRenderAll();
      }, PROPS);
    }
    duplicate() { const a = this.active(); if (!a) return; a.clone(c => { const cv = this.canvas; cv.discardActiveObject(); c.set({ left: a.left + 24, top: a.top + 24 }); if (c.type === 'activeSelection') { c.canvas = cv; c.forEachObject(o => { o.id = NS.uid('o'); cv.add(o); }); c.setCoords(); } else { c.id = NS.uid('o'); cv.add(c); } cv.setActiveObject(c); cv.requestRenderAll(); }, PROPS); }
    group() { const a = this.active(); if (!a || a.type !== 'activeSelection') return; const g = a.toGroup(); g.id = NS.uid('o'); g.name = 'Group'; this.canvas.setActiveObject(g); this.canvas.requestRenderAll(); this.commit(); this.h.onSelection && this.h.onSelection(); this.h.onLayers && this.h.onLayers(); }
    ungroup() { const a = this.active(); if (!a || a.type !== 'group') return; const s = a.toActiveSelection(); this.canvas.requestRenderAll(); this.commit(); this.h.onSelection && this.h.onSelection(); this.h.onLayers && this.h.onLayers(); }
    order(dir) {
      const cv = this.canvas, objs = this.selected(); if (!objs.length) return;
      const list = dir === 'front' || dir === 'forward' ? objs.slice() : objs.slice().reverse();
      list.forEach(o => dir === 'front' ? cv.bringToFront(o) : dir === 'back' ? cv.sendToBack(o) : dir === 'forward' ? cv.bringForward(o) : cv.sendBackwards(o));
      cv.requestRenderAll(); this.commit(); this.h.onLayers && this.h.onLayers();
    }
    moveTo(o, idx) { this.canvas.moveTo(o, idx); this.canvas.requestRenderAll(); this.commit(); this.h.onLayers && this.h.onLayers(); }
    setLock(o, v) { o.locked = v; this.applyLock(o); this.canvas.requestRenderAll(); this.commit(); this.h.onLayers && this.h.onLayers(); this.h.onSelection && this.h.onSelection(); }
    align(dir, toCanvas) {
      const cv = this.canvas, objs = this.selected().filter(o => !o.locked); if (!objs.length) return; const multi = objs.length > 1 && !toCanvas;
      cv.discardActiveObject();
      const W = this.p.canvas.w, H = this.p.canvas.h, bs = objs.map(o => o.getBoundingRect(true, true));
      const box = multi ? { l: Math.min(...bs.map(b => b.left)), t: Math.min(...bs.map(b => b.top)), r: Math.max(...bs.map(b => b.left + b.width)), b: Math.max(...bs.map(b => b.top + b.height)) } : { l: 0, t: 0, r: W, b: H };
      objs.forEach((o, i) => { const b = bs[i]; let dx = 0, dy = 0;
        if (dir === 'left') dx = box.l - b.left; if (dir === 'center') dx = (box.l + box.r) / 2 - (b.left + b.width / 2); if (dir === 'right') dx = box.r - (b.left + b.width);
        if (dir === 'top') dy = box.t - b.top; if (dir === 'middle') dy = (box.t + box.b) / 2 - (b.top + b.height / 2); if (dir === 'bottom') dy = box.b - (b.top + b.height);
        o.left += dx; o.top += dy; o.setCoords(); });
      this.reselect(objs); this.commit();
    }
    distribute(axis) {
      const cv = this.canvas, objs = this.selected().filter(o => !o.locked); if (objs.length < 3) { this.h.onToast && this.h.onToast('Select three or more objects to distribute.', 'err'); return; }
      cv.discardActiveObject(); const h = axis === 'h';
      const items = objs.map(o => ({ o, b: o.getBoundingRect(true, true) })).sort((a, b) => h ? a.b.left - b.b.left : a.b.top - b.b.top);
      const first = items[0].b, last = items[items.length - 1].b, total = items.reduce((s, i) => s + (h ? i.b.width : i.b.height), 0);
      const span = h ? (last.left + last.width - first.left) : (last.top + last.height - first.top), gap = (span - total) / (items.length - 1);
      let pos = h ? first.left : first.top;
      items.forEach(i => { const d = pos - (h ? i.b.left : i.b.top); if (h) i.o.left += d; else i.o.top += d; i.o.setCoords(); pos += (h ? i.b.width : i.b.height) + gap; });
      this.reselect(objs); this.commit();
    }
    reselect(objs) { const cv = this.canvas; if (objs.length === 1) cv.setActiveObject(objs[0]); else cv.setActiveObject(new fabric.ActiveSelection(objs, { canvas: cv })); cv.requestRenderAll(); this.h.onSelection && this.h.onSelection(); }

    /* ----- template fields (forecast time, units, headline…) ----- */
    applyFields(silent) { NS.applyFields(this.canvas.getObjects(), this.p.fields || {}, this.p.settings || {}); this.canvas.requestRenderAll(); if (!silent) this.commitSoon(); }
    async ensureFonts(objs) {
      const fam = new Set(); (function w(a) { (a || []).forEach(o => { if (o.fontFamily) fam.add(o.fontFamily + '|' + (o.fontWeight || 400)); w(o.objects); }); })(objs);
      if (document.fonts && document.fonts.load) { await Promise.all([...fam].map(k => { const [f, wgt] = k.split('|'); return document.fonts.load(wgt + ' 24px "' + f + '"').catch(() => {}); })); if (fabric.util.clearFabricFontCache) fabric.util.clearFabricFontCache(); }
    }
  }
  NS.Editor = Editor;
})();
