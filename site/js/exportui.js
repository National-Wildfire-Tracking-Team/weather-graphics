/* Export / preview dialog: renders from the saved project, verifies the decoded file, then offers the download. */
(function () {
  NS.ExportUI = { handles: new Map(), async open(p, previewOnly, brand) {
        const { h: $$ } = NS.ui; const $ = (t, a, ...k) => $$(t, a, ...k);
        const row = (label, ...ctl) => $('div', { class: 'prop' }, $('label', {}, label), $('div', { class: 'ctl' }, ...ctl));
        const sel = (opts, v, fn, label) => $('select', { 'aria-label': label, onchange: e => fn(e.target.value) }, opts.map(o => { const [val, l] = Array.isArray(o) ? o : [o, o]; return $('option', { value: val, selected: String(val) === String(v) }, l); }));
        const range = (v, min, max, step, fn, label) => $('input', { type: 'range', min, max, step, value: v, 'aria-label': label, oninput: e => fn(parseFloat(e.target.value)) });
        const toast = NS.ui.toast; const isTransp = p.canvas.bg.transparent;
        const fmt = sel([['png', 'PNG'], ['jpeg', 'JPEG'], ['svg', 'SVG (vector shapes/text; maps raster)']], (brand||{}).defaultFormat === 'jpeg' ? 'jpeg' : 'png', () => {}, 'Format'), scale = sel([[1, '1× — ' + p.canvas.w + '×' + p.canvas.h], [2, '2× — ' + p.canvas.w * 2 + '×' + p.canvas.h * 2], [0.5, '0.5× — ' + Math.round(p.canvas.w / 2) + '×' + Math.round(p.canvas.h / 2)], [3, '3× — ' + p.canvas.w * 3 + '×' + p.canvas.h * 3]], (brand||{}).defaultScale || 1, () => {}, 'Scale');
        const tr = $('input', { type: 'checkbox', checked: isTransp, disabled: !isTransp }), q = range(0.92, 0.5, 1, 0.01, () => {}, 'JPEG quality');
        const T = NS.Export.TARGETS, how = $('div', { class: 'hint', id: 'exportHowto' });
        const dest = sel([['custom', 'Custom (choose format and scale)']].concat(Object.keys(T).map(k => [k, T[k].label])), 'custom', v => {
          [fmt, scale, tr, q].forEach(c => { c.disabled = v !== 'custom' || (c === tr && !isTransp); });
          how.replaceChildren(T[v] ? T[v].howto + (Math.abs(p.canvas.w / p.canvas.h - 16 / 9) > 0.01 ? ' Note: this design is not 16:9.' : '') : '',
            T[v] && T[v].obs ? $('span', {}, ' File name: ', $('code', {}, NS.Export.fileName(p, { w: T[v].w, h: T[v].h, target: v, ext: 'png' })), '. ', $('a', { href: '#/obs', target: '_blank', rel: 'noopener', id: 'obsGuideLink' }, 'OBS setup guide (new tab)')) : '');
          if (T[v] && T[v].obs) how.append(' ', $('b', {}, T[v].obs === 'overlay' ? (isTransp ? '' : 'This design has an opaque background; use the full-screen option unless it is meant to cover the whole scene.') : (isTransp ? 'This design is transparent; use the overlay option to keep transparency.' : '')));
        }, 'Destination');
        const out = $('div', { style: 'margin-top:10px;min-height:60px' }), prevBg = sel([['checker', 'Checkerboard'], ['dark', 'Dark'], ['light', 'Light']], 'checker', v => setBg(v), 'Preview background');
        const img = $('img', { alt: 'Export preview', style: 'max-width:100%;max-height:46vh;display:block;margin:auto' }), frame = $('div', { class: 'checker', style: 'padding:8px;border:1px solid var(--border);margin-top:8px', hidden: true }, img);
        const setBg = v => { frame.className = v === 'checker' ? 'checker' : ''; frame.style.background = v === 'dark' ? '#0C1119' : v === 'light' ? '#f3f3f3' : ''; };
        const issues = NS.Export.readiness(p); let last = null, objUrl = null, acked = false;
        const info = $('div', { class: 'hint' });
        /* Ask once per dialog before a file with sample/placeholder content leaves the studio. */
        const ack = async () => { if (acked || !issues.length) return true;
          const ok = await NS.ui.dialog('Graphic not ready to air', $('div', { style: 'max-width:520px' }, $('p', {}, 'This graphic still has content that must be checked before it goes on air:'), $('ul', {}, issues.map(t => $('li', {}, t))), $('p', { class: 'hint' }, 'Only export it anyway for rehearsal or review. Replace sample content with verified information from the official source before broadcast.')),
            [{ label: 'Cancel', value: false }, { label: 'Export anyway', value: true, danger: true }]);
          acked = !!ok; return acked; };
        const tagLine = () => { const t = T[last.target]; return t && t.obs ? (last.warnings.length ? $('span', { class: 'tag warn' }, 'check warnings before using in OBS') : $('span', { class: 'tag ok', id: 'obsReady' }, 'OBS-ready: ' + (t.obs === 'overlay' ? 'transparent overlay' : 'full-screen') + ' ' + last.w + '×' + last.h)) : null; };
        /* Chrome/Edge can write straight into the broadcaster's OBS graphics folder and overwrite the file the Image source uses. */
        const canSave = typeof window.showSaveFilePicker === 'function', handles = NS.ExportUI.handles;
        const saveTo = async (reuse) => {
          if (!last || !(await ack())) return; const name = NS.Export.fileName(p, last), key = p.id + '|' + (last.target || 'custom');
          try {
            let hd = reuse && handles.get(key);
            if (!hd) hd = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: last.format.toUpperCase() + ' image', accept: { [last.blob.type]: ['.' + last.ext] } }] });
            const w = await hd.createWritable(); await w.write(last.blob); await w.close(); handles.set(key, hd);
            await NS.Export.record(p, last); toast('Saved ' + hd.name + (T[last.target] && T[last.target].obs ? '. OBS reloads the Image source automatically.' : '.'), 'ok'); upd.hidden = false; upd.textContent = 'Overwrite ' + hd.name;
          } catch (e) { if (e && e.name !== 'AbortError') toast('Could not save: ' + e.message, 'err'); }
        };
        const save = $('button', { class: 'btn', id: 'exportSaveAs', disabled: true, hidden: !canSave, title: 'Choose a folder and file name; pick the existing file to replace it', onclick: () => saveTo(false) }, 'Save to folder…');
        const upd = $('button', { class: 'btn', id: 'exportOverwrite', disabled: true, hidden: true, onclick: () => saveTo(true) }, 'Overwrite');
        const render = async () => {
          out.textContent = 'Rendering…'; dl.disabled = true; info.textContent = ''; frame.hidden = true; last = null;
          try {
            const r = await NS.Export.render(p, NS.Export.targetOptions(p, dest.value) || { format: fmt.value, scale: +scale.value, transparent: tr.checked && isTransp, quality: +q.value }); last = r;
            if (objUrl) URL.revokeObjectURL(objUrl); objUrl = URL.createObjectURL(r.blob); img.src = objUrl; frame.hidden = false;
            out.replaceChildren($('div', {}, $('span', { class: 'tag ok' }, r.w + ' × ' + r.h + ' px'), ' ', $('span', { class: 'tag' }, r.format.toUpperCase() + ' · ' + NS.ui.fmtBytes(r.blob.size)), ' ', r.format === 'png' ? $('span', { class: 'tag' + (r.info.hasAlpha ? ' ok' : '') }, r.info.hasAlpha ? 'transparent pixels present' : 'opaque') : null, ' ', tagLine()), ...r.warnings.map(w => $('div', { class: 'tag warn', style: 'display:block;margin-top:4px;white-space:normal' }, w)));
            dl.disabled = save.disabled = upd.disabled = false; const hd = handles.get(p.id + '|' + (r.target || 'custom')); upd.hidden = !hd; if (hd) upd.textContent = 'Overwrite ' + hd.name;
          } catch (e) { out.replaceChildren($('div', { class: 'tag err', style: 'display:block;white-space:normal' }, 'Export failed: ' + e.message)); dl.disabled = save.disabled = upd.disabled = true; }
        };
        const dl = $('button', { class: 'btn primary', disabled: true, id: 'exportDownload', onclick: async () => { if (!last || !(await ack())) return; NS.Export.download(last.blob, NS.Export.fileName(p, last)); await NS.Export.record(p, last); toast('Exported ' + last.w + '×' + last.h + ' ' + last.format.toUpperCase() + (T[last.target] ? ' for ' + T[last.target].label.split(' (')[0] : ''), 'ok'); } }, 'Download');
        const body = $('div', { style: 'width:720px;max-width:86vw' }, issues.length ? $('div', { class: 'tag warn', id: 'exportIssues', style: 'display:block;white-space:normal;margin-bottom:8px' }, $('b', {}, 'Not ready to air: '), issues.join(' '), ' You will be asked to confirm before exporting.') : null,
          row('Destination', dest), how, row('Format', fmt), row('Scale', scale), row('Transparent', $('label', {}, tr, ' ' + (isTransp ? 'Keep transparent background' : 'Design background is opaque'))), row('JPEG quality', q), $('div', { class: 'btnrow' }, $('button', { class: 'btn', id: 'renderPreview', onclick: render }, previewOnly ? 'Render preview' : 'Render and verify'), dl, save, upd), out, row('View on', prevBg), frame, info);
        if (previewOnly) setTimeout(render, 30);
        await NS.ui.dialog(previewOnly ? 'Preview' : 'Export', body, [{ label: 'Close' }], { focus: false });
        if (objUrl) URL.revokeObjectURL(objUrl);
      } };
})();
