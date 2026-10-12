/* Small DOM + dialog helpers shared by all views. */
(function () {
  const U = NS.ui = {};
  U.h = function (tag, attrs, ...kids) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v; else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') e[k] = !!v; else e.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach(k => { if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); });
    return e;
  };
  const h = U.h;
  U.toast = function (msg, type, ms) {
    const box = document.getElementById('toast'); const d = h('div', { class: type || '' }, msg); box.append(d); setTimeout(() => d.remove(), ms || (type === 'err' ? 7000 : 3200));
  };
  U.dialog = function (title, body, buttons, opts) {
    return new Promise(res => {
      const dlg = h('dialog', { 'aria-label': title, style: opts && opts.width ? 'width:' + opts.width : '' }, h('h3', {}, title), body);
      const close = v => { dlg.close(); dlg.remove(); res(v); };
      const foot = h('div', { class: 'dlgfoot' }, (buttons || [{ label: 'Close', value: null }]).map(b => h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), disabled: b.disabled, onclick: async () => { if (b.onclick) { const r = await b.onclick(dlg); if (r === false) return; close(r === undefined ? b.value : r); } else close(b.value); } }, b.label)));
      dlg.append(foot); dlg.addEventListener('cancel', e => { e.preventDefault(); close(null); }); document.body.append(dlg); dlg.showModal();
      const f = dlg.querySelector('input,select,textarea'); f && f.focus && opts && opts.focus !== false && f.focus();
      if (opts && opts.onOpen) opts.onOpen(dlg);
    });
  };
  U.confirm = (title, msg, okLabel, danger) => U.dialog(title, h('p', {}, msg), [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', value: true, primary: !danger, danger }]);
  U.prompt = async (title, val, label) => {
    const inp = h('input', { type: 'text', value: val || '', style: 'width:320px', 'aria-label': label || title });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.closest('dialog').querySelector('.btn.primary').click(); });
    const r = await U.dialog(title, inp, [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, onclick: () => { return inp.value; } }]); return r;
  };
  U.fileToDataURL = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read file.')); r.readAsDataURL(f); });
  U.loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not decode image.')); i.src = src; });
  U.download = (blob, name) => NS.Export.download(blob, name);
  U.fmtDate = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  U.fmtBytes = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';
  U.esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
})();
