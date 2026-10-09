/* Export / preview dialog: renders from the saved project, verifies the decoded file, then offers the download. */
(function () {
  NS.ExportUI = { async open(p, previewOnly, brand) {
        const { h: $$ } = NS.ui; const $ = (t, a, ...k) => $$(t, a, ...k);
        const row = (label, ...ctl) => $('div', { class: 'prop' }, $('label', {}, label), $('div', { class: 'ctl' }, ...ctl));
        const sel = (opts, v, fn, label) => $('select', { 'aria-label': label, onchange: e => fn(e.target.value) }, opts.map(o => { const [val, l] = Array.isArray(o) ? o : [o, o]; return $('option', { value: val, selected: String(val) === String(v) }, l); }));
        const range = (v, min, max, step, fn, label) => $('input', { type: 'range', min, max, step, value: v, 'aria-label': label, oninput: e => fn(parseFloat(e.target.value)) });
        const toast = NS.ui.toast; const isTransp = p.canvas.bg.transparent;
        const fmt = sel([['png', 'PNG'], ['jpeg', 'JPEG'], ['svg', 'SVG (vector shapes/text; maps raster)']], (brand||{}).defaultFormat === 'jpeg' ? 'jpeg' : 'png', () => {}, 'Format'), scale = sel([[1, '1× — ' + p.canvas.w + '×' + p.canvas.h], [2, '2× — ' + p.canvas.w * 2 + '×' + p.canvas.h * 2], [0.5, '0.5× — ' + Math.round(p.canvas.w / 2) + '×' + Math.round(p.canvas.h / 2)], [3, '3× — ' + p.canvas.w * 3 + '×' + p.canvas.h * 3]], (brand||{}).defaultScale || 1, () => {}, 'Scale');
        const tr = $('input', { type: 'checkbox', checked: isTransp, disabled: !isTransp }), q = range(0.92, 0.5, 1, 0.01, () => {}, 'JPEG quality');
        const out = $('div', { style: 'margin-top:10px;min-height:60px' }), prevBg = sel([['checker', 'Checkerboard'], ['dark', 'Dark'], ['light', 'Light']], 'checker', v => setBg(v), 'Preview background');
        const img = $('img', { alt: 'Export preview', style: 'max-width:100%;max-height:46vh;display:block;margin:auto' }), frame = $('div', { class: 'checker', style: 'padding:8px;border:1px solid var(--border);margin-top:8px', hidden: true }, img);
        const setBg = v => { frame.className = v === 'checker' ? 'checker' : ''; frame.style.background = v === 'dark' ? '#0C1119' : v === 'light' ? '#f3f3f3' : ''; };
        const n = NS.Export.sampleCount(p); let last = null, objUrl = null;
        const info = $('div', { class: 'hint' });
        const render = async () => {
          out.textContent = 'Rendering…'; dl.disabled = true; info.textContent = ''; frame.hidden = true; last = null;
          try {
            const r = await NS.Export.render(p, { format: fmt.value, scale: +scale.value, transparent: tr.checked && !tr.disabled, quality: +q.value }); last = r;
            if (objUrl) URL.revokeObjectURL(objUrl); objUrl = URL.createObjectURL(r.blob); img.src = objUrl; frame.hidden = false;
            out.replaceChildren($('div', {}, $('span', { class: 'tag ok' }, r.w + ' × ' + r.h + ' px'), ' ', $('span', { class: 'tag' }, r.format.toUpperCase() + ' · ' + NS.ui.fmtBytes(r.blob.size)), ' ', r.format === 'png' ? $('span', { class: 'tag' + (r.info.hasAlpha ? ' ok' : '') }, r.info.hasAlpha ? 'transparent pixels present' : 'opaque') : null), ...r.warnings.map(w => $('div', { class: 'tag warn', style: 'display:block;margin-top:4px;white-space:normal' }, w)));
            dl.disabled = false;
          } catch (e) { out.replaceChildren($('div', { class: 'tag err', style: 'display:block;white-space:normal' }, 'Export failed: ' + e.message)); dl.disabled = true; }
        };
        const dl = $('button', { class: 'btn primary', disabled: true, id: 'exportDownload', onclick: async () => { if (!last) return; NS.Export.download(last.blob, NS.Export.fileName(p, last)); await NS.Export.record(p, last); toast('Exported ' + last.w + '×' + last.h + ' ' + last.format.toUpperCase(), 'ok'); } }, 'Download');
        const body = $('div', { style: 'width:720px;max-width:86vw' }, n ? $('div', { class: 'tag warn', style: 'display:block;white-space:normal;margin-bottom:8px' }, n + ' sample-content object' + (n > 1 ? 's remain' : ' remains') + ' (e.g. the SAMPLE badge). Remove or replace them before publishing.') : null,
          row('Format', fmt), row('Scale', scale), row('Transparent', $('label', {}, tr, ' ' + (isTransp ? 'Keep transparent background' : 'Design background is opaque'))), row('JPEG quality', q), $('div', { class: 'btnrow' }, $('button', { class: 'btn', id: 'renderPreview', onclick: render }, previewOnly ? 'Render preview' : 'Render and verify'), dl), out, row('View on', prevBg), frame, info);
        if (previewOnly) setTimeout(render, 30);
        await NS.ui.dialog(previewOnly ? 'Preview' : 'Export', body, [{ label: 'Close' }], { focus: false });
        if (objUrl) URL.revokeObjectURL(objUrl);
      } };
})();
