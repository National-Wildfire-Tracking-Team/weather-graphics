/* Editor screen: top bar, tools, left panel (add/templates/assets/layers), canvas, right panel (properties/fields). */
(function () {
  const { h, toast } = NS.ui;
  const SAVE_DELAY = 2000;

  NS.EditorView = {
    async open(main, project, opts) {
      opts = opts || {};
      const brand = await NS.getBrand(); NS.brand = brand;
      const V = { project, destroyed: false, saveTimer: null, status: 'saved', lastSaved: project.updated };
      let status = 'saved';
      main.className = 'view editor'; main.innerHTML = '';
      const $ = (tag, a, ...k) => h(tag, a, ...k);

      /* ---------- skeleton ---------- */
      const nameInp = $('input', { id: 'projName', type: 'text', value: project.name, 'aria-label': 'Project name' });
      const statusEl = $('span', { class: 'status', id: 'saveStatus', role: 'status' }, '');
      const zoomLbl = $('span', { class: 'status', style: 'min-width:44px;text-align:center' }, '100%');
      const undoB = $('button', { class: 'btn', 'aria-label': 'Undo', title: 'Undo (Ctrl+Z)', id: 'undoBtn', disabled: true }, '↶');
      const redoB = $('button', { class: 'btn', 'aria-label': 'Redo', title: 'Redo (Ctrl+Shift+Z)', id: 'redoBtn', disabled: true }, '↷');
      const btn = (label, title, fn, id) => $('button', { class: 'btn sm', title, 'aria-label': title, id, onclick: fn }, label);
      const leftPanel = $('div', { id: 'leftPanel' }), rightPanel = $('div', { id: 'rightPanel' }), ws = $('div', { id: 'workspace' });
      const hud = $('div', { id: 'wsHud' }, 'Space+drag or middle-drag to pan · Ctrl+wheel to zoom');
      const hotbar = $('div', { id: 'hotbar', role: 'toolbar', 'aria-label': 'Editing tools' });
      const top = $('div', { id: 'topbar' },
        $('button', { class: 'btn', title: 'Back to dashboard', 'aria-label': 'Back to dashboard', id: 'backBtn', onclick: () => V.leave() }, '←'), nameInp,
        undoB, redoB, $('span', { class: 'sep' }),
        btn('−', 'Zoom out', () => ed.setZoom(ed.zoom / 1.2), 'zoomOut'), zoomLbl, btn('+', 'Zoom in', () => ed.setZoom(ed.zoom * 1.2), 'zoomIn'), btn('Fit', 'Fit canvas to screen (Ctrl+0)', () => ed.fit(), 'zoomFit'), btn('100%', 'Actual size (Ctrl+1)', () => ed.actual(), 'zoomActual'),
        $('span', { class: 'sep' }),
        btn('Canvas…', 'Canvas size and background', () => canvasDialog(), 'canvasBtn'),
        $('button', { class: 'btn sm', id: 'safeBtn', title: 'Toggle title-safe / action-safe guides', onclick: e => { ed.showSafe = !ed.showSafe; e.currentTarget.classList.toggle('on', ed.showSafe); ed.canvas.requestRenderAll(); } }, 'Safe areas'),
        $('button', { class: 'btn sm on', id: 'snapBtn', title: 'Toggle snapping', onclick: e => { ed.snap = !ed.snap; e.currentTarget.classList.toggle('on', ed.snap); } }, 'Snap'),
        $('span', { class: 'sp' }), statusEl,
        btn('Versions', 'Saved versions', () => versionsDialog(), 'versionsBtn'), btn('Save template', 'Save as reusable template', () => saveTemplate(), 'saveTplBtn'),
        $('button', { class: 'btn', id: 'saveBtn', onclick: () => V.save(true) }, 'Save'),
        $('button', { class: 'btn', id: 'previewBtn', onclick: () => exportDialog(true) }, 'Preview'),
        $('button', { class: 'btn primary', id: 'exportBtn', onclick: () => exportDialog(false) }, 'Export'));
      const body = $('div', { id: 'editorBody' }, leftPanel, $('div', { style: 'flex:1;min-width:0;display:flex;flex-direction:column' }, hotbar, ws), rightPanel);
      ws.append(hud); main.append(top, body);

      /* ---------- editor ---------- */
      const hooks = {
        onDirty: () => V.dirty(), onHistory: (u, r) => { undoB.disabled = !u; redoB.disabled = !r; },
        onSelection: () => renderProps(), onLayers: () => renderLayers(), onToast: toast, onSave: () => V.save(true), onZoom: z => { zoomLbl.textContent = Math.round(z * 100) + '%'; },
        onCanvasChange: () => { renderProps(); }
      };
      const ed = new NS.Editor(ws, project, hooks); ed.brand = brand; V.ed = ed;
      await NS.assetsReady;
      const missing = await ed.load(project); ed.initHistory(); ed.fit();
      if (missing.length) toast('Some images could not be found and were skipped (' + missing.length + ').', 'err');
      setStatus('saved', opts.isNew ? 'New project (not saved yet)' : null);
      if (opts.isNew) { status = 'dirty'; setStatus('dirty', 'Not saved yet'); }
      undoB.onclick = () => ed.undo(); redoB.onclick = () => ed.redo();
      ed.p.canvas.titleBar = ed.p.canvas.titleBar || 0;

      function setStatus(s, text) {
        status = s; statusEl.className = 'status ' + (s === 'saved' ? 'ok' : s === 'error' ? 'err' : 'dirty');
        statusEl.textContent = text || (s === 'saved' ? 'Saved locally ' + new Date(V.lastSaved).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : s === 'saving' ? 'Saving…' : s === 'dirty' ? 'Unsaved changes' : 'Not saved');
      }
      V.dirty = () => { setStatus('dirty'); clearTimeout(V.saveTimer); V.saveTimer = setTimeout(() => V.save(false), SAVE_DELAY); };
      V.save = async (manual) => {
        clearTimeout(V.saveTimer); if (V.destroyed) return true;
        try {
          setStatus('saving'); ed.syncProject(); const p = ed.p; p.name = nameInp.value.trim() || 'Untitled graphic';
          if (manual) { p.versions = p.versions || []; p.versions.unshift({ id: NS.uid('v'), at: Date.now(), label: 'Saved', objects: p.objects, canvas: p.canvas, fields: p.fields, settings: p.settings }); p.versions = p.versions.slice(0, 15); }
          p.thumb = await NS.Export.thumbnail(p, 360);
          await NS.Store.put('projects', JSON.parse(JSON.stringify(p))); V.lastSaved = Date.now(); setStatus('saved'); if (manual) toast('Saved locally in this browser.', 'ok'); return true;
        } catch (e) { setStatus('error', 'Save failed: ' + e.message); toast('Could not save: ' + e.message, 'err'); return false; }
      };
      V.leave = () => { location.hash = '#/dashboard'; };
      V.closeGuard = async () => { if (status === 'dirty' || status === 'saving' || status === 'error') { const ok = await V.save(false); if (!ok) return NS.ui.confirm('Leave without saving?', 'The project could not be saved. Leave anyway and lose recent changes?', 'Leave', true); } return true; };
      V.destroy = () => { V.destroyed = true; clearTimeout(V.saveTimer); ed.destroy(); };
      nameInp.addEventListener('change', () => { ed.p.name = nameInp.value; V.dirty(); });
      window.addEventListener('beforeunload', V.beforeUnload = e => { if (!V.destroyed && (status === 'dirty' || status === 'error')) { e.preventDefault(); e.returnValue = ''; } });
      const origDestroy = V.destroy; V.destroy = () => { window.removeEventListener('beforeunload', V.beforeUnload); origDestroy(); };

      /* ---------- hotbar ---------- */
      const hb = (label, title, fn, id) => $('button', { class: 'btn sm', title, 'aria-label': title, id, onclick: fn }, label);
      const sep = () => $('span', { class: 'sep' });
      hotbar.append(
        hb('Text', 'Add text', () => ed.addText(), 'addText'), hb('▭', 'Add rectangle', () => ed.addShape('rect'), 'addRect'), hb('○', 'Add circle', () => ed.addShape('circle'), 'addCircle'), hb('△', 'Add triangle', () => ed.addShape('triangle'), 'addTri'),
        hb('★', 'Add star', () => ed.addShape('star'), 'addStar'), hb('╱', 'Add line', () => ed.addShape('line'), 'addLine'), hb('→', 'Add arrow', () => ed.addShape('arrow'), 'addArrow'), hb('Image', 'Upload image', () => uploadImage(), 'addImage'), hb('Map', 'Add interactive map', () => addMapDialog(), 'addMap'), hb('Chart', 'Add chart, legend or scale', () => chartDialog(), 'addChart'),
        sep(), hb('⇤', 'Align left', () => ed.align('left'), 'alL'), hb('⇹', 'Align horizontal center', () => ed.align('center'), 'alC'), hb('⇥', 'Align right', () => ed.align('right'), 'alR'), hb('⤒', 'Align top', () => ed.align('top'), 'alT'), hb('⇕', 'Align vertical middle', () => ed.align('middle'), 'alM'), hb('⤓', 'Align bottom', () => ed.align('bottom'), 'alB'),
        hb('⇔ Dist', 'Distribute horizontally', () => ed.distribute('h'), 'distH'), hb('⇕ Dist', 'Distribute vertically', () => ed.distribute('v'), 'distV'),
        sep(), hb('Forward', 'Bring forward (Ctrl+])', () => ed.order('forward'), 'ordF'), hb('Backward', 'Send backward (Ctrl+[)', () => ed.order('backward'), 'ordB'), hb('Front', 'Bring to front', () => ed.order('front'), 'ordFront'), hb('Back', 'Send to back', () => ed.order('back'), 'ordBack'),
        sep(), hb('Group', 'Group (Ctrl+G)', () => ed.group(), 'grp'), hb('Ungroup', 'Ungroup (Ctrl+Shift+G)', () => ed.ungroup(), 'ungrp'), hb('Duplicate', 'Duplicate (Ctrl+D)', () => ed.duplicate(), 'dup'), hb('Delete', 'Delete (Del)', () => ed.deleteSelected(), 'del'));

      /* ---------- images / assets ---------- */
      async function addAssetFile(file, collection) {
        if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.type)) throw new Error('Unsupported file type "' + (file.type || 'unknown') + '". Use PNG, JPEG, GIF, WebP or SVG.');
        if (file.size > 20e6) throw new Error('"' + file.name + '" is larger than 20 MB.');
        let url = await NS.ui.fileToDataURL(file), img = await NS.ui.loadImage(url), w = img.naturalWidth, hh = img.naturalHeight;
        const MAX = 4096; if (Math.max(w, hh) > MAX && file.type !== 'image/svg+xml') { const k = MAX / Math.max(w, hh), c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); url = c.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92); w = c.width; hh = c.height; toast('Large image downscaled to ' + w + '×' + hh + '.'); }
        const a = { id: NS.uid('ast'), name: file.name.replace(/\.[^.]+$/, ''), type: file.type, w, h: hh, dataUrl: url, collection: collection || 'Uploads', created: Date.now() };
        await NS.Store.put('assets', a); NS.assetCache.set(a.id, url); NS.assetMeta.set(a.id, a); return a;
      }
      V.addAssetFile = addAssetFile;
      function pickFiles(multi) { return new Promise(res => { const i = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml', multiple: !!multi }); i.onchange = () => res([...i.files]); i.oncancel = () => res([]); i.click(); }); }
      async function uploadImage() { try { const fs = await pickFiles(true); for (const f of fs) { const a = await addAssetFile(f); await ed.addImageAsset(a.id, a.name); } renderLeft(); } catch (e) { toast(e.message, 'err'); } }

      /* ---------- left panel ---------- */
      let leftTab = 'layers', tplQuery = '';
      function renderLeft() {
        leftPanel.innerHTML = '';
        const tabs = [['layers', 'Layers'], ['add', 'Add'], ['assets', 'Assets'], ['templates', 'Templates']];
        leftPanel.append($('div', { class: 'ptabs', role: 'tablist' }, tabs.map(([id, l]) => $('button', { role: 'tab', class: leftTab === id ? 'on' : '', 'aria-selected': leftTab === id, onclick: () => { leftTab = id; renderLeft(); } }, l))));
        const pb = $('div', { class: 'pbody', id: 'leftBody' }); leftPanel.append(pb);
        if (leftTab === 'layers') { pb.id = 'layersBody'; renderLayers(); }
        if (leftTab === 'add') {
          pb.append(sec('Text', [bt('Heading', () => ed.addText('HEADING', { fontSize: Math.round(ed.p.canvas.w / 14), fontWeight: 800 })), bt('Subheading', () => ed.addText('Subheading', { fontSize: Math.round(ed.p.canvas.w / 28), fontWeight: 600 })), bt('Body text', () => ed.addText('Body text', { fontFamily: brand.fonts.body, fontSize: Math.round(ed.p.canvas.w / 50), fontWeight: 400 }))]),
            sec('Shapes', ['rect', 'circle', 'triangle', 'star', 'line', 'arrow'].map(s => bt(s[0].toUpperCase() + s.slice(1), () => ed.addShape(s)))),
            sec('Data', [bt('Bar chart', () => chartDialog('bar')), bt('Line chart', () => chartDialog('line')), bt('Pie chart', () => chartDialog('pie')), bt('Table', () => chartDialog('table')), bt('Callout', () => chartDialog('callout')), bt('Legend / scale', () => chartDialog('legend'))]),
            sec('Map', [bt('Add map…', () => addMapDialog()), bt('Scale bar', () => addScaleBar())]), sec('Media', [bt('Upload image…', () => uploadImage())]));
        }
        if (leftTab === 'assets') {
          pb.append($('div', { class: 'btnrow' }, bt('Upload…', () => uploadImage())));
          const g = $('div', { class: 'assetgrid' }); const all = [...NS.assetMeta.values()].sort((a, b) => b.created - a.created);
          all.forEach(a => g.append($('button', { title: 'Insert ' + a.name, 'aria-label': 'Insert ' + a.name, style: 'background-image:url(' + a.dataUrl + ')', onclick: () => ed.addImageAsset(a.id, a.name).catch(e => toast(e.message, 'err')) })));
          pb.append(all.length ? g : $('div', { class: 'hint' }, 'No assets yet. Upload images here or in the Asset Library.'));
        }
        if (leftTab === 'templates') {
          const q = $('input', { type: 'search', placeholder: 'Search templates', 'aria-label': 'Search templates', value: tplQuery, oninput: e => { tplQuery = e.target.value; list(); } }); pb.append(q, $('p', { class: 'hint' }, 'Opens a new project from the template. Your current project is saved first.'));
          const box = $('div', { class: 'tplmini' }); pb.append(box);
          function list() { box.innerHTML = ''; NS.Templates.list.filter(t => !tplQuery || (t.name + ' ' + t.tags.join(' ') + ' ' + t.category).toLowerCase().includes(tplQuery.toLowerCase())).slice(0, 60).forEach(t => box.append($('button', { class: 'btn sm', style: 'text-align:left', onclick: async () => { if (await V.save(false)) { V.destroy(); NS.App.newFromTemplate(t.id); } } }, t.name))); }
          list();
        }
      }
      const bt = (l, fn) => $('button', { class: 'btn sm', onclick: fn }, l);
      const sec = (t, kids) => $('div', { class: 'sec' }, $('h4', {}, t), $('div', { class: 'btnrow' }, kids));

      /* ---------- layers ---------- */
      function renderLayers() {
        if (leftTab !== 'layers') return; const pb = leftPanel.querySelector('.pbody'); if (!pb) return; pb.innerHTML = '';
        const objs = ed.canvas.getObjects(), sel = new Set(ed.selected()); let dragFrom = null;
        if (!objs.length) pb.append($('div', { class: 'hint' }, 'No objects yet. Use the toolbar above the canvas to add text, shapes, images, charts or a map.'));
        for (let i = objs.length - 1; i >= 0; i--) {
          const o = objs[i], row = $('div', { class: 'layer' + (sel.has(o) ? ' sel' : ''), draggable: 'true', tabindex: 0, role: 'button', 'aria-label': 'Layer ' + (o.name || o.type) });
          row.append($('span', { class: 'nm', title: 'Double-click to rename' }, (o.type === 'textbox' ? 'T · ' + (o.text || '').slice(0, 24) : o.name || o.type)),
            $('button', { title: o.visible === false ? 'Show' : 'Hide', 'aria-label': 'Toggle visibility', class: o.visible === false ? 'on' : '', onclick: e => { e.stopPropagation(); o.visible = o.visible === false; ed.canvas.discardActiveObject(); ed.canvas.requestRenderAll(); ed.commit(); renderLayers(); } }, o.visible === false ? '◌' : '◉'),
            $('button', { title: o.locked ? 'Unlock' : 'Lock', 'aria-label': o.locked ? 'Unlock layer' : 'Lock layer', class: o.locked ? 'on' : '', onclick: e => { e.stopPropagation(); ed.setLock(o, !o.locked); } }, o.locked ? '🔒' : '🔓'));
          row.onclick = e => { if (o.visible === false) return; ed.canvas.setActiveObject(o); ed.canvas.requestRenderAll(); renderLayers(); renderProps(); };
          row.ondblclick = async () => { const n = await NS.ui.prompt('Rename layer', o.name || o.type); if (n) { o.name = n; ed.commit(); renderLayers(); } };
          row.ondragstart = () => { dragFrom = o; }; row.ondragover = e => e.preventDefault(); row.ondrop = e => { e.preventDefault(); if (dragFrom && dragFrom !== o) ed.moveTo(dragFrom, ed.canvas.getObjects().indexOf(o)); };
          pb.append(row);
        }
      }

      /* ---------- right panel ---------- */
      let rightTab = 'props';
      const num = (v, fn, o) => $('input', Object.assign({ type: 'number', value: v == null || isNaN(v) ? '' : Math.round(v * 100) / 100, onchange: e => fn(parseFloat(e.target.value)) }, o));
      const row = (label, ...ctl) => $('div', { class: 'prop' }, $('label', {}, label), $('div', { class: 'ctl' }, ...ctl));
      const color = (v, fn, label) => $('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#ffffff', 'aria-label': label || 'Color', oninput: e => fn(e.target.value), onchange: () => ed.commit() });
      const sel = (opts, v, fn, label) => $('select', { 'aria-label': label, onchange: e => fn(e.target.value) }, opts.map(o => { const [val, l] = Array.isArray(o) ? o : [o, o]; return $('option', { value: val, selected: String(val) === String(v) }, l); }));
      const range = (v, min, max, step, fn, label) => $('input', { type: 'range', min, max, step, value: v, 'aria-label': label, oninput: e => fn(parseFloat(e.target.value)), onchange: () => ed.commit() });
      const apply = (o, props) => { o.set(props); o.setCoords && o.setCoords(); ed.canvas.requestRenderAll(); ed.commitSoon(); };
      const toggleBtn = (l, on, fn, title) => $('button', { class: 'btn sm' + (on ? ' on' : ''), title, 'aria-label': title || l, onclick: fn }, l);

      function renderRight() {
        rightPanel.innerHTML = '';
        rightPanel.append($('div', { class: 'ptabs', role: 'tablist' }, [['props', 'Properties'], ['fields', 'Fields']].map(([id, l]) => $('button', { role: 'tab', class: rightTab === id ? 'on' : '', 'aria-selected': rightTab === id, onclick: () => { rightTab = id; renderRight(); } }, l))), $('div', { class: 'pbody', id: 'rightBody' }));
        renderProps();
      }
      function renderProps() {
        const pb = rightPanel.querySelector('#rightBody'); if (!pb) return; const keep = pb.scrollTop; pb.innerHTML = '';
        if (rightTab === 'fields') { renderFields(pb); return; }
        const objs = ed.selected(), o = ed.active();
        if (!objs.length) { canvasProps(pb); pb.scrollTop = keep; return; }
        if (objs.length > 1) {
          pb.append($('div', { class: 'sec' }, $('h4', {}, objs.length + ' objects selected'), $('div', { class: 'btnrow' }, bt('Group', () => ed.group()), bt('Align to canvas ⇹', () => ed.align('center', true)), bt('Align to canvas ⇕', () => ed.align('middle', true)), bt('Lock all', () => objs.forEach(x => ed.setLock(x, true))), bt('Delete', () => ed.deleteSelected()))));
          pb.append(shadowSec(objs[0], objs), opacitySec(objs)); return;
        }
        pb.append($('div', { class: 'sec' }, $('h4', {}, 'Object'), row('Name', $('input', { type: 'text', value: o.name || '', onchange: e => { o.name = e.target.value; ed.commit(); renderLayers(); } }))));
        pb.append(transformSec(o));
        if (o.type === 'textbox') pb.append(textSec(o));
        if (o.type === 'MapFrame') pb.append(mapSec(o));
        if (o.chartSpec) pb.append(chartSec(o));
        if (['rect', 'circle', 'triangle', 'polygon', 'path', 'line'].includes(o.type) && !o.chartSpec) pb.append(fillSec(o));
        if (o.type === 'image') pb.append(imageSec(o));
        if (o.type !== 'MapFrame') { pb.append(shadowSec(o, [o])); }
        pb.append(opacitySec([o]));
        pb.append($('div', { class: 'sec' }, $('h4', {}, 'Arrange'), $('div', { class: 'btnrow' }, toggleBtn(o.locked ? 'Unlock' : 'Lock', o.locked, () => ed.setLock(o, !o.locked), 'Lock or unlock'), bt('Duplicate', () => ed.duplicate()), bt('Delete', () => ed.deleteSelected()))));
        pb.scrollTop = keep;
      }
      function canvasProps(pb) {
        const c = ed.p.canvas;
        pb.append($('div', { class: 'sec' }, $('h4', {}, 'Canvas'), row('Size', $('span', {}, c.w + ' × ' + c.h + ' px')), row('Background', color(c.bg.color, v => { c.bg.color = v; ed.canvas.requestRenderAll(); ed.commitSoon(); }, 'Background color'), $('label', {}, $('input', { type: 'checkbox', checked: c.bg.transparent, onchange: e => { c.bg.transparent = e.target.checked; ed.canvas.requestRenderAll(); ed.commit(); } }), ' Transparent')), $('div', { class: 'btnrow' }, bt('Size & background…', () => canvasDialog()))),
          $('div', { class: 'hint' }, 'Select an object to edit its properties. Template content is edited in the Fields tab.'));
      }
      function transformSec(o) {
        const br = o.type === 'activeSelection' ? o : o;
        return $('div', { class: 'sec' }, $('h4', {}, 'Position and size'),
          row('X / Y', num(o.left, v => apply(o, { left: v })), num(o.top, v => apply(o, { top: v }))),
          row('W / H', num(o.getScaledWidth(), v => { if (v > 0) apply(o, { scaleX: v / o.width }); if (o.type === 'MapFrame') ed.normalize(o); }), num(o.getScaledHeight(), v => { if (v > 0) apply(o, { scaleY: v / o.height }); if (o.type === 'MapFrame') ed.normalize(o); })),
          row('Rotation', num(o.angle, v => apply(o, { angle: v || 0 }))));
      }
      function textSec(o) {
        const fonts = NS.FONTS.includes(o.fontFamily) ? NS.FONTS : [o.fontFamily, ...NS.FONTS];
        const setFont = async f => { await document.fonts.load('700 24px "' + f + '"').catch(() => {}); if (!document.fonts.check('700 24px "' + f + '"') && !/^(Arial|Helvetica|Georgia|Times New Roman|Courier New|Impact|Verdana|Trebuchet MS)$/.test(f)) toast('Font "' + f + '" is not available here; a fallback will be used.', 'err'); apply(o, { fontFamily: f }); o.initDimensions(); ed.canvas.requestRenderAll(); };
        const bgOn = !!o.textBackgroundColor;
        return $('div', { class: 'sec' }, $('h4', {}, 'Text'),
          row('Font', sel(fonts, o.fontFamily, setFont, 'Font family')),
          row('Size', num(o.fontSize, v => { apply(o, { fontSize: Math.max(4, v) }); o.initDimensions(); }), sel([400, 500, 600, 700, 800], o.fontWeight, v => apply(o, { fontWeight: +v }), 'Weight')),
          row('Color', color(o.fill, v => apply(o, { fill: v }), 'Text color'), toggleBtn('I', o.fontStyle === 'italic', () => { apply(o, { fontStyle: o.fontStyle === 'italic' ? 'normal' : 'italic' }); renderProps(); }, 'Italic'), toggleBtn('U', o.underline, () => { apply(o, { underline: !o.underline }); renderProps(); }, 'Underline'), toggleBtn('AA', false, () => { apply(o, { text: o.text === o.text.toUpperCase() ? o.text.toLowerCase() : o.text.toUpperCase() }); o.initDimensions(); }, 'Toggle uppercase')),
          row('Align', ['left', 'center', 'right', 'justify'].map(a => toggleBtn(a[0].toUpperCase(), o.textAlign === a, () => { apply(o, { textAlign: a }); renderProps(); }, 'Align ' + a))),
          row('Line spacing', range(o.lineHeight, 0.6, 2.5, 0.05, v => { apply(o, { lineHeight: v }); o.initDimensions(); }, 'Line spacing')),
          row('Letter space', range(o.charSpacing, -100, 800, 10, v => { apply(o, { charSpacing: v }); o.initDimensions(); }, 'Letter spacing')),
          row('Background', color(o.textBackgroundColor || '#000000', v => apply(o, { textBackgroundColor: v }), 'Text background'), toggleBtn('None', !bgOn, () => { apply(o, { textBackgroundColor: '' }); renderProps(); }, 'Remove text background')),
          row('Outline', color(o.stroke || '#000000', v => apply(o, { stroke: v, strokeWidth: o.strokeWidth || 2 }), 'Text outline color'), num(o.strokeWidth || 0, v => apply(o, { stroke: o.stroke || '#000000', strokeWidth: v || 0 }), { min: 0, step: 0.5 })));
      }
      const gradOf = o => { const f = o.fill; if (f && f.colorStops) { const c = f.coords, a = Math.round(Math.atan2((c.y2 - c.y1), (c.x2 - c.x1)) * 180 / Math.PI); return { c1: f.colorStops[0].color, c2: f.colorStops[f.colorStops.length - 1].color, a }; } return null; };
      const mkGrad = (c1, c2, a) => { const r = a * Math.PI / 180, dx = Math.cos(r), dy = Math.sin(r); return new fabric.Gradient({ type: 'linear', gradientUnits: 'percentage', coords: { x1: .5 - dx / 2, y1: .5 - dy / 2, x2: .5 + dx / 2, y2: .5 + dy / 2 }, colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }] }); };
      function fillSec(o) {
        const g = gradOf(o), isLine = o.type === 'line', mode = g ? 'gradient' : 'solid', box = $('div', { class: 'sec' }, $('h4', {}, 'Fill and border'));
        if (!isLine) {
          box.append(row('Fill', sel([['solid', 'Solid'], ['gradient', 'Gradient'], ['none', 'None']], o.fill ? mode : 'none', v => { if (v === 'none') apply(o, { fill: null }); else if (v === 'solid') apply(o, { fill: (g && g.c1) || '#F2453D' }); else apply(o, { fill: mkGrad((typeof o.fill === 'string' && o.fill) || '#F2453D', '#0C1119', 90) }); ed.commit(); renderProps(); }, 'Fill type')));
          if (!g && typeof o.fill === 'string') box.append(row('Color', color(o.fill, v => apply(o, { fill: v }), 'Fill color')));
          if (g) box.append(row('Colors', color(g.c1, v => apply(o, { fill: mkGrad(v, gradOf(o).c2, gradOf(o).a) }), 'Gradient start'), color(g.c2, v => apply(o, { fill: mkGrad(gradOf(o).c1, v, gradOf(o).a) }), 'Gradient end')), row('Angle', range(g.a, -180, 180, 5, v => apply(o, { fill: mkGrad(gradOf(o).c1, gradOf(o).c2, v) }), 'Gradient angle')));
        }
        box.append(row('Border', color(o.stroke || '#ffffff', v => apply(o, { stroke: v, strokeWidth: o.strokeWidth || 2 }), 'Border color'), num(o.strokeWidth || 0, v => apply(o, { strokeWidth: v || 0, stroke: o.stroke || '#ffffff' }), { min: 0 })));
        if (o.type === 'rect') box.append(row('Corner radius', num(o.rx || 0, v => apply(o, { rx: v || 0, ry: v || 0 }), { min: 0 })));
        return box;
      }
      function shadowSec(o, objs) {
        const s = o.shadow, on = !!s;
        const set = p => objs.forEach(x => { const cur = x.shadow || { color: 'rgba(0,0,0,.5)', blur: 12, offsetX: 4, offsetY: 4 }; x.set('shadow', new fabric.Shadow(Object.assign({ color: cur.color, blur: cur.blur, offsetX: cur.offsetX, offsetY: cur.offsetY }, p))); }), 
          fire = () => { ed.canvas.requestRenderAll(); ed.commitSoon(); };
        const box = $('div', { class: 'sec' }, $('h4', {}, 'Shadow'), row('Shadow', $('label', {}, $('input', { type: 'checkbox', checked: on, onchange: e => { if (e.target.checked) set({}); else objs.forEach(x => x.set('shadow', null)); fire(); renderProps(); } }), ' Enabled')));
        if (on) box.append(row('Color', color(/^#/.test(s.color) ? s.color : '#000000', v => { set({ color: v }); fire(); }, 'Shadow color')), row('Blur', range(s.blur, 0, 60, 1, v => { set({ blur: v }); fire(); }, 'Shadow blur')), row('Offset X/Y', num(s.offsetX, v => { set({ offsetX: v || 0 }); fire(); }), num(s.offsetY, v => { set({ offsetY: v || 0 }); fire(); })));
        return box;
      }
      function opacitySec(objs) { return $('div', { class: 'sec' }, row('Opacity', range(objs[0].opacity == null ? 1 : objs[0].opacity, 0, 1, 0.01, v => { objs.forEach(x => x.set('opacity', v)); ed.canvas.requestRenderAll(); ed.commitSoon(); }, 'Opacity'))); }
      function imageSec(o) {
        const cr = o.crop || (o.crop = { l: 0, t: 0, r: 0, b: 0 }), el = o.getElement(), nw = el.naturalWidth || el.width, nh = el.naturalHeight || el.height;
        const setCrop = () => {
          const cx0 = o.cropX || 0, cy0 = o.cropY || 0, cx = nw * cr.l / 100, cy = nh * cr.t / 100, w = Math.max(1, nw * (1 - (cr.l + cr.r) / 100)), hh = Math.max(1, nh * (1 - (cr.t + cr.b) / 100));
          const dx = (cx - cx0) * o.scaleX, dy = (cy - cy0) * o.scaleY, a = o.angle * Math.PI / 180;
          o.set({ cropX: cx, cropY: cy, width: w, height: hh, left: o.left + dx * Math.cos(a) - dy * Math.sin(a), top: o.top + dx * Math.sin(a) + dy * Math.cos(a) }); o.setCoords(); ed.canvas.requestRenderAll(); ed.commitSoon();
        };
        const fitTo = cover => { const W = ed.p.canvas.w, H = ed.p.canvas.h, k = (cover ? Math.max : Math.min)(W / o.width, H / o.height); o.set({ scaleX: k, scaleY: k, angle: 0 }); ed.center_(o); ed.canvas.requestRenderAll(); ed.commit(); renderProps(); };
        return $('div', { class: 'sec' }, $('h4', {}, 'Image'),
          $('div', { class: 'btnrow' }, bt('Fit canvas', () => fitTo(false)), bt('Fill canvas', () => fitTo(true)), bt('Reset size', () => { o.set({ scaleX: 1, scaleY: 1 }); ed.canvas.requestRenderAll(); ed.commit(); renderProps(); })),
          row('Flip', toggleBtn('↔', o.flipX, () => { apply(o, { flipX: !o.flipX }); renderProps(); }, 'Flip horizontally'), toggleBtn('↕', o.flipY, () => { apply(o, { flipY: !o.flipY }); renderProps(); }, 'Flip vertically')),
          $('h4', {}, 'Crop (percent trimmed)'),
          ['l', 't', 'r', 'b'].map(k => row({ l: 'Left', t: 'Top', r: 'Right', b: 'Bottom' }[k], range(cr[k], 0, 90, 1, v => { cr[k] = v; setCrop(); }, 'Crop ' + k))),
          row('Border', color(o.stroke || '#ffffff', v => apply(o, { stroke: v, strokeWidth: o.strokeWidth || 4 }), 'Border color'), num(o.strokeWidth || 0, v => apply(o, { strokeWidth: v || 0, stroke: o.stroke || '#ffffff' }), { min: 0 })));
      }
      function mapSec(o) {
        const st = o.mapState, e = NS.mapImages.get(o.id), stl = (NS.STYLES[st.style] || {}).name || st.style;
        const enabled = NS.Providers.filter(p => st.layers[p.id] && st.layers[p.id].on).map(p => p.name);
        return $('div', { class: 'sec' }, $('h4', {}, 'Interactive map'),
          $('div', { class: 'btnrow' }, $('button', { class: 'btn primary', id: 'editMapBtn', onclick: () => editMap(o) }, 'Edit map…'), bt('Re-render', () => { NS.mapImages.delete(o.id); ed.refreshMap(o); })),
          row('Status', $('span', { class: 'tag ' + (e && e.status === 'ok' ? 'ok' : e && e.status === 'error' ? 'err' : '') }, e ? e.status : 'queued')),
          row('Style', $('span', {}, stl)), row('Projection', $('span', {}, st.projection)), row('Zoom', $('span', {}, st.zoom.toFixed(2))), row('Features', $('span', {}, st.features.features.length)),
          row('Data layers', $('span', {}, enabled.length ? enabled.join(', ') : 'none')),
          row('Attribution', $('label', {}, $('input', { type: 'checkbox', checked: st.showAttribution !== false, onchange: ev => { st.showAttribution = ev.target.checked; ed.canvas.requestRenderAll(); ed.commit(); } }), ' Show on graphic')),
          row('SPC legend', $('label', {}, $('input', { type: 'checkbox', checked: st.showLegend !== false, onchange: ev => { st.showLegend = ev.target.checked; ed.canvas.requestRenderAll(); ed.commit(); } }), ' Show on graphic'),
            sel([['br', 'Bottom right'], ['bl', 'Bottom left'], ['tr', 'Top right'], ['tl', 'Top left']], st.legendPos || 'br', v => { st.legendPos = v; ed.canvas.requestRenderAll(); ed.commit(); }, 'Legend position')),
          $('div', { class: 'hint' }, 'The map re-renders at the export resolution; the on-canvas image is a preview. Resizing the frame keeps the saved map extent.'));
      }
      function chartSec(o) { return $('div', { class: 'sec' }, $('h4', {}, 'Chart data'), $('div', { class: 'btnrow' }, $('button', { class: 'btn primary', onclick: () => chartDialog(o.chartSpec.type, o) }, 'Edit data…'))); }

      /* ---------- fields (template content) ---------- */
      function renderFields(pb) {
        const defs = ed.p.fieldDefs || [], f = ed.p.fields || (ed.p.fields = {}), s = ed.p.settings || (ed.p.settings = {});
        if (!defs.length) { pb.append($('div', { class: 'hint' }, 'This project has no template fields. Templates define quick-edit fields (headline, forecast time, units…). Use "Save template" after adding fields via the Fields tab of a template.')); }
        const box = $('div', { class: 'sec' }, $('h4', {}, 'Template fields'));
        const change = () => { ed.applyFields(); };
        defs.forEach(d => {
          let ctl;
          if (d.type === 'setting') ctl = sel(d.options, s[d.key], v => { s[d.key] = v; change(); }, d.label);
          else if (d.type === 'checkbox') ctl = $('input', { type: 'checkbox', checked: !!f[d.key], 'aria-label': d.label, onchange: e => { f[d.key] = e.target.checked; change(); ed.commit(); } });
          else if (d.type === 'color') ctl = color(f[d.key], v => { f[d.key] = v; change(); }, d.label);
          else if (d.type === 'datetime') ctl = $('input', { type: 'datetime-local', value: f[d.key] || '', 'aria-label': d.label, onchange: e => { f[d.key] = e.target.value; change(); ed.commit(); } });
          else if (d.type === 'select') ctl = sel(d.options, f[d.key], v => { f[d.key] = v; change(); ed.commit(); }, d.label);
          else if (d.type === 'textarea') ctl = $('textarea', { rows: 3, 'aria-label': d.label, oninput: e => { f[d.key] = e.target.value; change(); } }, f[d.key] || '');
          else ctl = $('input', { type: d.type === 'number' ? 'number' : 'text', value: f[d.key] == null ? '' : f[d.key], 'aria-label': d.label, oninput: e => { f[d.key] = e.target.value; change(); } });
          if (d.type === 'textarea' || d.type === 'text' || d.type === 'number') ctl.addEventListener('change', () => ed.commit());
          box.append($('div', { class: 'prop', style: 'grid-template-columns:1fr' }, $('label', {}, d.label), ctl));
        });
        pb.append(box);
        if (defs.length) pb.append($('div', { class: 'hint' }, 'Temperatures are entered in °F and wind in mph; the graphic shows them in the selected units.'));
        const n = NS.Export.sampleCount(ed.p); if (n) pb.append($('div', { class: 'sec' }, $('span', { class: 'tag warn' }, n + ' sample-content object' + (n > 1 ? 's' : '')), $('p', { class: 'hint' }, 'Objects marked as sample content (like the SAMPLE badge) must be removed or replaced before publishing. Export warns while any remain.'), $('div', { class: 'btnrow' }, bt('Remove sample badges', () => { ed.canvas.getObjects().filter(x => x.sample).forEach(x => ed.canvas.remove(x)); ed.canvas.requestRenderAll(); renderFields(pb.parentElement.querySelector('#rightBody')); }))));
      }

      /* ---------- dialogs ---------- */
      async function canvasDialog() {
        const c = ed.p.canvas; let w = c.w, hh = c.h;
        const wi = $('input', { type: 'number', value: w, min: 64, max: 8192, 'aria-label': 'Width' }), hi = $('input', { type: 'number', value: hh, min: 64, max: 8192, 'aria-label': 'Height' });
        const ps = $('select', { 'aria-label': 'Preset' }, $('option', { value: '' }, 'Custom'), NS.PRESETS.map(p => $('option', { value: p.id, selected: p.w === w && p.h === hh }, p.name + ' — ' + p.note)));
        ps.onchange = () => { const p = NS.PRESETS.find(x => x.id === ps.value); if (p) { wi.value = p.w; hi.value = p.h; upd(); } };
        const mode = $('select', { 'aria-label': 'Resize mode' }, $('option', { value: 'scale' }, 'Scale layout to fit'), $('option', { value: 'keep' }, 'Keep objects where they are'));
        const bg = color(c.bg.color, () => {}, 'Background'), tr = $('input', { type: 'checkbox', checked: c.bg.transparent });
        const warn = $('p', { class: 'hint' }); const orient = $('button', { class: 'btn sm', onclick: () => { const t = wi.value; wi.value = hi.value; hi.value = t; ps.value = ''; upd(); } }, 'Swap orientation');
        const upd = () => { const nw = +wi.value, nh = +hi.value, asp = (nw / nh) / (c.w / c.h); warn.textContent = (nw === c.w && nh === c.h) ? '' : (Math.abs(asp - 1) > 0.02 ? 'The aspect ratio changes (' + c.w + '×' + c.h + ' → ' + nw + '×' + nh + '). Objects will be scaled and repositioned, but you will likely need to adjust the layout manually.' : 'Same aspect ratio: objects scale proportionally.'); };
        upd(); wi.oninput = hi.oninput = () => { ps.value = ''; upd(); };
        const body = $('div', {}, row('Preset', ps), row('Width', wi, $('span', {}, 'px')), row('Height', hi, $('span', {}, 'px')), row('Orientation', orient, $('span', { class: 'hint' }, c.w >= c.h ? 'landscape' : 'portrait')), row('Resize', mode), row('Background', bg, $('label', {}, tr, ' Transparent')), warn);
        const r = await NS.ui.dialog('Canvas size and background', body, [{ label: 'Cancel', value: null }, { label: 'Create variant (new project)', value: 'variant' }, { label: 'Apply to this project', value: 'apply', primary: true }]);
        if (!r) return; const nw = Math.round(+wi.value), nh = Math.round(+hi.value);
        if (!(nw >= 64 && nw <= 8192 && nh >= 64 && nh <= 8192)) { toast('Width and height must be between 64 and 8192 px.', 'err'); return; }
        if (r === 'variant') { await V.save(false); const copy = JSON.parse(JSON.stringify(ed.syncProject())); copy.id = NS.uid('prj'); copy.name = ed.p.name + ' (' + nw + '×' + nh + ')'; copy.variantOf = ed.p.id; copy.versions = []; copy.created = copy.updated = Date.now(); resizeProject(copy, nw, nh, mode.value); copy.canvas.bg = { transparent: tr.checked, color: bg.value }; await NS.Store.put('projects', copy); location.hash = '#/edit/' + copy.id; toast('Variant created. The original is unchanged.', 'ok'); return; }
        const oldW = c.w, oldH = c.h; c.bg = { transparent: tr.checked, color: bg.value };
        if (nw !== oldW || nh !== oldH) { ed.syncProject(); resizeProject(ed.p, nw, nh, mode.value); await ed.load(ed.p); ed.fit(); }
        ed.canvas.requestRenderAll(); ed.commit(); renderProps();
      }
      function resizeProject(p, nw, nh, mode) {
        const ow = p.canvas.w, oh = p.canvas.h, sx = nw / ow, sy = nh / oh, k = Math.min(sx, sy);
        if (mode === 'scale') (function w(arr) { arr.forEach(o => { o.left *= sx; o.top *= sy; if (o.type === 'MapFrame') { o.width *= sx; o.height *= sy; if (o.mapState) o.mapState.size = [Math.round(o.width), Math.round(o.height)]; } else { o.scaleX = (o.scaleX || 1) * k; o.scaleY = (o.scaleY || 1) * k; } }); })(p.objects);
        p.canvas.w = nw; p.canvas.h = nh; if (p.canvas.titleBar) p.canvas.titleBar = Math.round(p.canvas.titleBar * sy);
      }
      async function versionsDialog() {
        const vs = ed.p.versions || [];
        const list = $('div', {}, vs.length ? vs.map((v, i) => $('div', { class: 'row', style: 'justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)' }, $('span', {}, NS.ui.fmtDate(v.at) + ' · ' + v.label + ' · ' + v.objects.length + ' objects'), $('button', { class: 'btn sm', onclick: async e => { if (!(await NS.ui.confirm('Restore version', 'Replace the current design with this version? You can undo afterwards.', 'Restore'))) return; ed.p.objects = JSON.parse(JSON.stringify(v.objects)); ed.p.canvas = JSON.parse(JSON.stringify(v.canvas)); ed.p.fields = JSON.parse(JSON.stringify(v.fields || {})); ed.p.settings = JSON.parse(JSON.stringify(v.settings || {})); await ed.load(ed.p); ed.fit(); ed.commit(); e.target.closest('dialog').close(); toast('Version restored.', 'ok'); } }, 'Restore'))) : $('p', { class: 'hint' }, 'No saved versions yet. Press Save to record one (the 15 most recent are kept).'));
        await NS.ui.dialog('Versions', list, [{ label: 'Close' }], { width: '520px' });
      }
      async function saveTemplate() {
        const name = await NS.ui.prompt('Save as template', ed.p.name + ' template'); if (!name) return;
        ed.syncProject(); const p = ed.p, t = { id: NS.uid('tpl'), name, category: p.category || 'general', desc: 'Saved from project "' + p.name + '".', w: p.canvas.w, h: p.canvas.h, created: Date.now(), user: true, collection: 'My templates', tags: [], data: JSON.parse(JSON.stringify({ canvas: p.canvas, objects: p.objects, fields: p.fields, fieldDefs: p.fieldDefs, settings: p.settings })), thumb: await NS.Export.thumbnail(p, 360) };
        try { await NS.Store.put('templates', t); toast('Template saved to your library.', 'ok'); } catch (e) { toast('Could not save template: ' + e.message, 'err'); }
      }
      async function addMapDialog() {
        if (!NS.config.token) { toast('No Mapbox token configured. Add one in Brand Settings → Map settings.', 'err'); return; }
        const reg = $('select', { 'aria-label': 'Region' }, Object.keys(NS.VIEWS).map(k => $('option', { value: k }, k))), st = $('select', { 'aria-label': 'Basemap style' }, Object.entries(NS.STYLES).filter(([k]) => k !== 'custom' && (k !== 'broadcast' || NS.config.style)).map(([k, v]) => $('option', { value: k, selected: k === (NS.config.style ? 'broadcast' : 'dark') }, v.name)));
        const r = await NS.ui.dialog('Add map', $('div', {}, row('Region', reg), row('Basemap', st), $('p', { class: 'hint' }, 'The map is a live, editable element. Choose "Edit map…" in Properties to pan, zoom, search, add layers and draw.')), [{ label: 'Cancel', value: null }, { label: 'Add and edit', value: 'edit', primary: true }, { label: 'Add', value: 'add' }]);
        if (!r) return; const state = NS.defaultMapState(reg.value); state.style = st.value; state.projection = st.value === 'broadcast' ? 'albers' : (reg.value === 'Lower 48' ? 'albers' : 'mercator');
        const m = ed.addMap(state, Math.round(ed.p.canvas.w * .9), Math.round(ed.p.canvas.h * .8)); if (r === 'edit') editMap(m);
      }
      function editMap(o) {
        NS.MapStudio.open(o.mapState, { w: Math.round(o.width), h: Math.round(o.height), title: ed.p.name, onApply: state => { o.mapState = state; state.size = [Math.round(o.width), Math.round(o.height)]; NS.mapImages.delete(o.id); ed.refreshMap(o); ed.commit(); renderProps(); }, onToast: toast });
      }
      function addScaleBar() {
        const m = ed.canvas.getObjects().find(x => x.type === 'MapFrame'); const spec = NS.Charts.defaults('scalebar'); spec.font = brand.fonts.body;
        if (m) { const st = m.mapState, sb = NS.Charts.scaleBarFor(st.zoom, st.center[1], 200); spec.km = Math.round(sb.km * 10) / 10; spec.px = Math.round(sb.px); toast('Scale bar computed from the map zoom at its centre (Web Mercator). Re-add it if you change the map zoom.'); } else toast('No map on the canvas; edit the bar length manually.');
        NS.Charts.insert(ed, spec);
      }
      async function chartDialog(type, existing) {
        const sp = existing ? JSON.parse(JSON.stringify(existing.chartSpec)) : NS.Charts.defaults(type || 'bar'); type = sp.type; const t = $('select', { 'aria-label': 'Chart type', disabled: !!existing }, ['bar', 'line', 'pie', 'table', 'callout', 'legend'].map(k => $('option', { value: k, selected: k === type }, k)));
        const title = $('input', { type: 'text', value: sp.title || '', 'aria-label': 'Title' }), unit = $('input', { type: 'text', value: sp.unit || '', 'aria-label': 'Units', style: 'width:80px' });
        let dataVal = '';
        if (type === 'table') dataVal = [sp.columns.join(','), ...sp.rows.map(r => r.join(','))].join('\n'); else if (type === 'legend') dataVal = sp.stops.map(s => s.v + ',' + s.c).join('\n'); else if (type === 'callout') dataVal = sp.value + '\n' + sp.label; else dataVal = (sp.labels || []).map((l, i) => l + ',' + sp.values[i]).join('\n');
        const data = $('textarea', { rows: 8, 'aria-label': 'Data', style: 'font-family:var(--font-mono)' }, dataVal);
        const hint = { bar: 'One "label,value" per line. Only numbers you enter are plotted.', line: 'One "label,value" per line.', pie: 'One "label,value" per line.', table: 'First line = column headers; then one row per line, comma separated.', callout: 'Line 1 = value, line 2 = label.', legend: 'One "value,#hexcolor" per line (low to high).' }[type];
        const col = color(sp.color || (sp.stops && sp.stops[0].c) || '#F2453D', () => {}, 'Accent color'), presets = type === 'legend' ? sel([['', 'Presets…'], ['temp', 'Temperature key'], ['rain', 'Rainfall accumulation scale'], ['wind', 'Wind speed scale']], '', v => { const p = NS.Charts.PRESETS[v]; if (!p) return; title.value = p.title; unit.value = p.unit; data.value = p.stops.map(s => s.v + ',' + s.c).join('\n'); }, 'Legend preset') : null;
        const body = $('div', { style: 'width:480px' }, type !== 'callout' ? row('Title', title) : null, row('Units', unit), type !== 'table' && type !== 'pie' && type !== 'legend' ? row('Color', col) : null, presets ? row('Preset', presets) : null, $('div', { class: 'hint', style: 'margin:6px 0' }, hint), data, type === 'legend' ? $('label', { class: 'hint' }, $('input', { type: 'checkbox', id: 'legCont', checked: sp.continuous }), ' Continuous gradient (otherwise discrete blocks)') : null);
        const r = await NS.ui.dialog(existing ? 'Edit chart data' : 'Add ' + type, body, [{ label: 'Cancel', value: null }, { label: existing ? 'Update' : 'Insert', value: 'ok', primary: true }]); if (r !== 'ok') return;
        sp.title = title.value; sp.unit = unit.value; sp.font = brand.fonts.body; const lines = data.value.split('\n').map(s => s.trim()).filter(Boolean);
        if (['bar', 'line', 'pie'].includes(type)) { sp.labels = []; sp.values = []; for (const ln of lines) { const i = ln.lastIndexOf(','); const v = parseFloat(ln.slice(i + 1)); if (i < 0 || isNaN(v)) { toast('Each line needs "label,number": "' + ln + '"', 'err'); return; } sp.labels.push(ln.slice(0, i).trim()); sp.values.push(v); } if (type !== 'pie') sp.color = col.value; }
        else if (type === 'table') { const rows = lines.map(l => l.split(',').map(s => s.trim())); sp.columns = rows[0] || ['A', 'B']; sp.rows = rows.slice(1).map(r => sp.columns.map((_, i) => r[i] || '')); }
        else if (type === 'callout') { sp.value = lines[0] || ''; sp.label = lines[1] || ''; sp.color = col.value; }
        else if (type === 'legend') { sp.stops = lines.map(l => { const [v, c] = l.split(','); return { v: (v || '').trim(), c: (c || '#888888').trim() }; }); sp.continuous = document.getElementById('legCont') ? true : sp.continuous; }
        if (existing) NS.Charts.rebuild(ed, existing, sp); else NS.Charts.insert(ed, sp);
      }
      function exportDialog(previewOnly) { return NS.ExportUI.open(ed.syncProject(), previewOnly, brand); }
      V.exportDialog = exportDialog;

      renderLeft(); renderRight(); renderLayers();
      return V;
    }
  };
})();
