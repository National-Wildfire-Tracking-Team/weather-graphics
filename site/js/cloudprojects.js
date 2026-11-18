/* Shared projects, templates and assets (Phase 2).
   A cloud project is edited through a LOCAL mirror (an ordinary IndexedDB project with `cloud: {id, version, dirty}`),
   so the editor, autosave and offline drafts work exactly as before. After each local save the mirror is pushed with
   optimistic concurrency (`version`); offline or failed pushes stay marked `dirty` and are retried, never dropped.
   Local projects are only uploaded when the user picks them in "Upload local projects…"; nothing local is deleted. */
(function () {
  const { h, toast } = NS.ui, C = NS.Cloud;
  const CP = NS.CloudProjects = { templates: [], members: new Map(), listeners: new Set() };
  const strip = p => { const d = JSON.parse(JSON.stringify(p)); ['id', 'thumb', 'versions', 'cloud', 'created', 'updated'].forEach(k => delete d[k]); return d; };
  const assetIds = p => { const ids = new Set(); (function w(a) { (a || []).forEach(o => { if (o.assetId) ids.add(o.assetId); w(o.objects); }); })(p.objects); return [...ids]; };
  const emitStatus = (p, s, text) => CP.listeners.forEach(fn => fn(p, s, text));
  CP.onStatus = fn => { CP.listeners.add(fn); return () => CP.listeners.delete(fn); };
  CP.canEdit = () => C.signedIn() && C.can('admin', 'producer', 'editor');

  /* Upload the images a project uses into the shared bucket (once per asset) and return {assetId: storagePath}. */
  async function pushAssets(p) {
    const refs = {};
    for (const id of assetIds(p)) {
      const a = NS.assetMeta.get(id); if (!a) continue;
      if (a.cloudPath) { refs[id] = a.cloudPath; continue; }
      if (!/^image\/(png|jpeg|gif|webp)$/.test(a.type || '')) throw new Error('"' + a.name + '" is ' + (a.type || 'an unknown type') + '; shared assets must be PNG, JPEG, GIF or WebP.');
      const blob = await (await fetch(a.dataUrl)).blob(), path = C.user.id + '/' + id + '.' + a.type.split('/')[1];
      const up = await C.client.storage.from('graphics-assets').upload(path, blob, { contentType: a.type, upsert: false });
      if (up.error && !/exists|Duplicate/i.test(up.error.message)) throw up.error;
      await C.client.from('assets').insert({ name: a.name, collection: a.collection || null, mime: a.type, bytes: blob.size, w: a.w, h: a.h, storage_path: path }).then(r => { if (r.error && !/duplicate/i.test(r.error.message)) throw r.error; });
      a.cloudPath = path; await NS.Store.put('assets', a); refs[id] = path;
    }
    return refs;
  }
  /* Download shared images a cloud project needs into this browser (same asset ids on every computer). */
  async function pullAssets(refs) {
    for (const [id, path] of Object.entries(refs || {})) {
      if (NS.assetMeta.has(id)) continue;
      const r = await C.client.storage.from('graphics-assets').download(path); if (r.error) { console.warn('asset', path, r.error.message); continue; }
      const url = await NS.ui.fileToDataURL(r.data), im = await NS.ui.loadImage(url);
      const a = { id, name: path.split('/').pop(), type: r.data.type, w: im.naturalWidth, h: im.naturalHeight, dataUrl: url, collection: 'Shared', created: Date.now(), cloudPath: path };
      await NS.Store.put('assets', a); NS.assetMeta.set(id, a); NS.assetCache.set(id, url);
    }
  }
  CP.pullAssets = pullAssets;

  /* ---------- sync of a linked local mirror ---------- */
  const timers = new Map();
  CP.afterLocalSave = function (p, manual) {
    if (!p.cloud) return;
    p.cloud.dirty = true; clearTimeout(timers.get(p.id));
    if (manual) return CP.push(p, true);
    timers.set(p.id, setTimeout(() => CP.push(p, false), 4000));
    emitStatus(p, 'pending', 'Cloud: changes pending');
  };
  CP.push = async function (p, manual) {
    clearTimeout(timers.get(p.id));
    if (!p.cloud) return 'local';
    if (!C.signedIn() || !navigator.onLine) { await persist(p); emitStatus(p, 'offline', 'Cloud: offline — saved in this browser, will sync when reconnected'); return 'offline'; }
    if (!CP.canEdit()) { emitStatus(p, 'readonly', 'Cloud: read-only for your role (changes stay in this browser)'); return 'readonly'; }
    emitStatus(p, 'syncing', 'Cloud: syncing…');
    try {
      const data = strip(p); data.assetRefs = await pushAssets(p);
      const r = await C.client.from('projects').update({ name: p.name, category: p.category || 'general', data, thumb: p.thumb || null, save_kind: manual ? 'manual' : 'auto' }).eq('id', p.cloud.id).eq('version', p.cloud.version).select('version,approval,updated_at').maybeSingle();
      if (r.error) throw r.error;
      if (!r.data) {   // nothing updated: newer version in the cloud, or no permission
        const cur = await C.client.from('projects').select('version,updated_by,team_can_edit,owner_id').eq('id', p.cloud.id).maybeSingle();
        if (cur.data && cur.data.version !== p.cloud.version) { p.cloud.conflict = cur.data.version; await persist(p); emitStatus(p, 'conflict', 'Cloud: conflict — someone else saved a newer version'); return 'conflict'; }
        emitStatus(p, 'readonly', 'Cloud: you cannot edit this shared project (owner locked it)'); return 'readonly';
      }
      Object.assign(p.cloud, { version: r.data.version, approval: r.data.approval, dirty: false, conflict: null, syncedAt: Date.now() });
      await persist(p); emitStatus(p, 'synced', 'Cloud: saved v' + r.data.version + ' ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      return 'synced';
    } catch (e) { p.cloud.dirty = true; await persist(p); emitStatus(p, 'error', 'Cloud: not saved — ' + C.msg(e) + ' (kept in this browser)'); return 'error'; }
  };
  async function persist(p) { const cur = await NS.Store.get('projects', p.id).catch(() => null); const copy = JSON.parse(JSON.stringify(cur || p)); copy.cloud = JSON.parse(JSON.stringify(p.cloud)); await NS.Store.put('projects', copy).catch(() => {}); }
  /* Recovery: push every linked project left dirty by an earlier offline/failed session. */
  CP.retryDirty = async function () {
    if (!C.signedIn() || !CP.canEdit()) return 0; let n = 0;
    for (const p of await NS.Store.all('projects').catch(() => [])) if (p.cloud && p.cloud.dirty && !p.cloud.conflict && !(NS.App.editor && NS.App.editor.project.id === p.id)) { if (await CP.push(p, false) === 'synced') n++; }
    if (n) toast('Synced ' + n + ' project' + (n > 1 ? 's' : '') + ' saved while offline.', 'ok'); return n;
  };
  window.addEventListener('online', () => setTimeout(CP.retryDirty, 1500));
  setInterval(() => CP.retryDirty().catch(() => {}), 60000);
  C.on(() => { if (C.signedIn()) { CP.retryDirty().catch(() => {}); loadMembers(); } });
  CP.loadMembers = () => loadMembers();
  async function loadMembers() { const r = await C.client.from('org_members').select('user_id,email,display_name,role,active'); if (!r.error) { CP.members.clear(); r.data.forEach(m => CP.members.set(m.user_id, m)); } }
  CP.who = id => { const m = CP.members.get(id); return m ? (m.display_name || m.email) : id ? 'unknown member' : '—'; };

  /* Conflict: keep both. The cloud version is loaded; local work is preserved as a separate local copy. */
  CP.resolveConflict = async function (p) {
    const v = await NS.ui.dialog('Cloud conflict', h('div', { style: 'max-width:520px' }, h('p', {}, 'Someone else saved "' + p.name + '" (cloud version ' + p.cloud.conflict + ') after your last sync. Your changes are safe in this browser.'),
      h('ul', {}, h('li', {}, h('b', {}, 'Load the cloud version'), ': your current version is kept as a separate local project ("… (my local changes)").'), h('li', {}, h('b', {}, 'Overwrite the cloud'), ': save your version as the newest cloud version (theirs stays in revision history).'))),
      [{ label: 'Decide later', value: null }, { label: 'Overwrite the cloud', value: 'mine' }, { label: 'Load the cloud version', value: 'theirs', primary: true }]);
    if (v === 'mine') { p.cloud.version = p.cloud.conflict; p.cloud.conflict = null; return CP.push(p, true); }
    if (v === 'theirs') { const keep = JSON.parse(JSON.stringify(p)); keep.id = NS.uid('prj'); keep.name = p.name + ' (my local changes)'; delete keep.cloud; await NS.Store.put('projects', keep); await CP.open(p.cloud.id, true); }
    return v;
  };

  /* Open a cloud project: create or refresh its local mirror, then open it in the editor. */
  CP.open = async function (cloudId, force) {
    const r = await C.client.from('projects').select('*').eq('id', cloudId).single(); if (r.error) throw r.error;
    const row = r.data, mirror = (await NS.Store.all('projects')).find(p => p.cloud && p.cloud.id === cloudId);
    if (mirror && mirror.cloud.dirty && !force && mirror.cloud.version !== row.version) { mirror.cloud.conflict = row.version; await NS.Store.put('projects', mirror); location.hash = '#/edit/' + mirror.id; return; }
    await pullAssets(row.data.assetRefs);
    const p = Object.assign(NS.blankProject(row.data.canvas.w, row.data.canvas.h, row.name, row.category), row.data, { id: mirror ? mirror.id : NS.uid('prj'), name: row.name, thumb: row.thumb, updated: Date.parse(row.updated_at),
      cloud: { id: row.id, version: row.version, approval: row.approval, owner: row.owner_id, dirty: false, syncedAt: Date.now() } });
    delete p.assetRefs; await NS.Store.put('projects', p); location.hash = '#/edit/' + p.id;
  };
  /* Explicit upload of local projects (migration). The local project stays and becomes linked to the cloud copy. */
  CP.upload = async function (p) {
    const data = strip(p); data.assetRefs = await pushAssets(p);
    const r = await C.client.from('projects').insert({ name: p.name, category: p.category || 'general', data, thumb: p.thumb || null, save_kind: 'import' }).select().single();
    if (r.error) throw r.error;
    p.cloud = { id: r.data.id, version: r.data.version, approval: r.data.approval, owner: r.data.owner_id, dirty: false, syncedAt: Date.now() }; await NS.Store.put('projects', p); return r.data;
  };
  CP.migrateDialog = async function () {
    const local = (await NS.Store.all('projects')).filter(p => !p.cloud).sort((a, b) => b.updated - a.updated);
    if (!local.length) { toast('Every local project is already linked to the cloud.', 'ok'); return; }
    const boxes = local.map(p => ({ p, cb: h('input', { type: 'checkbox', 'data-name': p.name }) }));
    const ok = await NS.ui.dialog('Upload local projects to the shared cloud', h('div', { style: 'max-width:620px' },
      h('p', {}, 'Choose which projects in this browser to share with the NWTT team. Nothing is uploaded unless you tick it.'),
      h('p', { class: 'hint' }, 'Local copies are NOT deleted: each uploaded project stays in this browser and becomes linked to its cloud copy. Images it uses are uploaded to the shared asset library (PNG, JPEG, GIF, WebP only).'),
      h('div', { id: 'migrateList', style: 'max-height:46vh;overflow:auto' }, boxes.map(({ p, cb }) => h('label', { class: 'row', style: 'margin:4px 0' }, cb, h('b', {}, p.name), h('span', { class: 'hint' }, p.canvas.w + '×' + p.canvas.h + ' · edited ' + NS.ui.fmtDate(p.updated)))))),
      [{ label: 'Cancel', value: false }, { label: 'Upload selected', value: true, primary: true }]);
    if (!ok) return;
    let n = 0; for (const { p, cb } of boxes) if (cb.checked) { try { await CP.upload(p); n++; } catch (e) { toast('"' + p.name + '" was not uploaded: ' + C.msg(e), 'err', 9000); } }
    toast(n + ' project' + (n === 1 ? '' : 's') + ' uploaded and linked. Local copies kept.', n ? 'ok' : 'err'); NS.App.render();
  };

  /* ---------- Shared Projects view ---------- */
  const APPROVAL = { draft: ['Draft', ''], submitted: ['Submitted for approval', 'warn'], approved: ['Approved for broadcast', 'ok'], rejected: ['Changes requested', 'err'] };
  CP.view = async function () {
    const root = h('div', {}, h('h1', {}, 'Shared Projects'), h('p', { class: 'sub' }, 'Graphics stored in the NWTT shared cloud. Opening one edits a copy in this browser that saves back to the cloud (and keeps working offline).'));
    if (!C.signedIn()) { root.append(h('div', { class: 'empty' }, C.status === 'off' ? 'The shared cloud is not configured for this site. Projects are stored in this browser only (Saved Projects).' : C.status === 'offline' ? 'The shared cloud is unreachable. Your local projects are still available under Saved Projects.' : 'Sign in to see shared projects.')); return root; }
    await loadMembers();
    const r = await C.client.from('projects').select('id,name,category,owner_id,approval,version,updated_at,updated_by,thumb,team_can_edit,approved_by').is('deleted_at', null).order('updated_at', { ascending: false });
    if (r.error) { root.append(h('div', { class: 'tag err' }, C.msg(r.error))); return root; }
    const local = await NS.Store.all('projects').catch(() => []), mirrors = new Map(local.filter(p => p.cloud).map(p => [p.cloud.id, p]));
    if (CP.canEdit()) root.append(h('div', { class: 'bar' }, h('button', { class: 'btn primary', id: 'migrateBtn', onclick: CP.migrateDialog }, 'Upload local projects…'), h('span', { class: 'hint' }, local.filter(p => !p.cloud).length + ' local project(s) not shared yet')));
    const grid = h('div', { class: 'grid', id: 'sharedGrid' }); root.append(grid);
    if (!r.data.length) grid.append(h('div', { class: 'empty' }, 'No shared projects yet.'));
    r.data.forEach(row => {
      const m = mirrors.get(row.id), ap = APPROVAL[row.approval], mine = row.owner_id === C.user.id;
      const acts = [h('button', { class: 'btn sm primary', onclick: () => CP.open(row.id).catch(e => toast(C.msg(e), 'err')) }, 'Open')];
      if ((mine || C.can('admin', 'producer', 'editor')) && row.approval !== 'submitted' && row.approval !== 'approved' && CP.canEdit()) acts.push(h('button', { class: 'btn sm', onclick: async () => { const x = await C.client.from('projects').update({ approval: 'submitted' }).eq('id', row.id).select(); x.error || !x.data.length ? toast(x.error ? C.msg(x.error) : 'You cannot change this project.', 'err') : (toast('Submitted for broadcast approval.', 'ok'), NS.App.render()); } }, 'Submit for approval'));
      if (C.can('admin', 'producer')) { acts.push(h('button', { class: 'btn sm', 'data-approve': row.id, onclick: () => setApproval(row, 'approved') }, 'Approve'), h('button', { class: 'btn sm', onclick: () => setApproval(row, 'rejected') }, 'Request changes')); }
      acts.push(h('button', { class: 'btn sm', onclick: () => revisionsDialog(row) }, 'Revisions'));
      if (mine || C.can('admin')) acts.push(h('button', { class: 'btn sm danger', onclick: async () => { if (await NS.ui.confirm('Delete shared project', 'Remove "' + row.name + '" from the shared cloud for everyone? Revisions are kept for administrators; your local copy (if any) is not deleted.', 'Delete', true)) { const x = await C.client.from('projects').update({ deleted_at: new Date().toISOString() }).eq('id', row.id).select(); x.error || !x.data.length ? toast(x.error ? C.msg(x.error) : 'Not allowed.', 'err') : NS.App.render(); } } }, 'Delete'));
      grid.append(h('div', { class: 'tile', 'data-cloud': row.id }, h('div', { class: 'thumb', style: row.thumb ? 'background-image:url(' + row.thumb + ')' : '' }, row.thumb ? '' : 'No preview'),
        h('div', { class: 'meta' }, h('b', {}, row.name), h('span', { class: 'tag ' + ap[1] }, ap[0]), h('span', {}, 'v' + row.version + ' · ' + CP.who(row.owner_id) + (row.team_can_edit ? '' : ' · owner-only edits')), h('span', {}, 'Edited ' + NS.ui.fmtDate(Date.parse(row.updated_at)) + ' by ' + CP.who(row.updated_by)),
          m ? h('span', { class: 'hint' }, m.cloud.dirty ? '● unsynced changes in this browser' : 'Copy in this browser (v' + m.cloud.version + ')') : null), h('div', { class: 'acts' }, acts)));
    });
    return root;
  };
  async function setApproval(row, a) { const x = await C.client.rpc('gs_set_approval', { p_project: row.id, p_approval: a }); x.error ? toast(C.msg(x.error), 'err') : (toast(a === 'approved' ? 'Approved for broadcast.' : 'Marked as needing changes.', 'ok'), NS.App.render()); }
  async function revisionsDialog(row) {
    const r = await C.client.from('project_revisions').select('id,version,name,save_kind,created_by,created_at').eq('project_id', row.id).order('version', { ascending: false }).limit(100);
    if (r.error) { toast(C.msg(r.error), 'err'); return; }
    const restore = async (v, btn) => {
      const full = await C.client.from('project_revisions').select('data,name').eq('id', v.id).single(); if (full.error) return toast(C.msg(full.error), 'err');
      const cur = await C.client.from('projects').select('version').eq('id', row.id).single(); if (cur.error) return toast(C.msg(cur.error), 'err');
      const u = await C.client.from('projects').update({ data: full.data.data, name: full.data.name, save_kind: 'manual' }).eq('id', row.id).eq('version', cur.data.version).select();
      if (u.error || !u.data.length) return toast(u.error ? C.msg(u.error) : 'It changed meanwhile, or you cannot edit it. Try again.', 'err');
      toast('Restored v' + v.version + ' as a new version. Reopen the project to see it.', 'ok'); btn.disabled = true;
    };
    const rows = r.data.map(v => {
      const btn = CP.canEdit() ? h('button', { class: 'btn sm', onclick: e => restore(v, e.target) }, 'Restore') : null;
      return h('tr', {}, h('td', {}, 'v' + v.version), h('td', {}, NS.ui.fmtDate(Date.parse(v.created_at))), h('td', {}, CP.who(v.created_by)), h('td', {}, v.save_kind), h('td', {}, btn));
    });
    const table = h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Version', 'Saved', 'By', 'Kind', ''].map(x => h('th', {}, x)))), h('tbody', {}, rows));
    await NS.ui.dialog('Revisions — ' + row.name, h('div', { style: 'max-width:620px;max-height:60vh;overflow:auto' }, table), [{ label: 'Close' }]);
  }

  /* ---------- shared templates ---------- */
  CP.loadTemplates = async function () {
    if (!C.signedIn()) return (CP.templates = []);
    const r = await C.client.from('templates').select('*').order('name'); if (r.error) return (CP.templates = []);
    return (CP.templates = r.data.map(t => ({ id: 'cloud:' + t.id, cloudId: t.id, name: t.name, category: t.category, w: t.w, h: t.h, data: t.data, thumb: t.thumb, collection: 'Shared (NWTT)', user: true, cloud: true, createdBy: t.created_by, desc: 'Shared template' })));
  };
  CP.shareTemplate = async function (t) {
    const data = JSON.parse(JSON.stringify(t.data)); data.assetRefs = await pushAssets({ objects: data.objects });
    const r = await C.client.from('templates').insert({ name: t.name, category: t.category || 'general', collection: t.collection || null, w: t.w, h: t.h, data, thumb: t.thumb || null }).select().single();
    if (r.error) throw r.error; return r.data;
  };

  /* ---------- shared assets (Asset Library section) ---------- */
  CP.assetsSection = async function () {
    const box = h('div', { id: 'sharedAssets' }, h('h2', {}, 'Shared assets (NWTT cloud)'));
    if (!C.signedIn()) { box.append(h('p', { class: 'hint' }, 'Sign in to use the shared asset library.')); return box; }
    const r = await C.client.from('assets').select('*').order('created_at', { ascending: false }).limit(200);
    if (r.error) { box.append(h('div', { class: 'tag err' }, C.msg(r.error))); return box; }
    const have = new Set([...NS.assetMeta.values()].map(a => a.cloudPath).filter(Boolean));
    box.append(h('p', { class: 'hint' }, 'Images shared with the team. "Add to this browser" makes one available to your projects. Only PNG, JPEG, GIF and WebP are accepted (no SVG).'),
      r.data.length ? h('table', { class: 't' }, h('tbody', {}, r.data.map(a => h('tr', {}, h('td', {}, h('b', {}, a.name)), h('td', {}, (a.w || '?') + '×' + (a.h || '?') + ' · ' + NS.ui.fmtBytes(a.bytes)), h('td', {}, CP.who(a.created_by)),
        h('td', {}, have.has(a.storage_path) ? h('span', { class: 'tag ok' }, 'in this browser') : h('button', { class: 'btn sm', onclick: async () => { const id = a.storage_path.split('/').pop().replace(/\.\w+$/, ''); await pullAssets({ [id]: a.storage_path }); toast('Added to this browser.', 'ok'); NS.App.render(); } }, 'Add to this browser')))))) : h('div', { class: 'empty' }, 'No shared assets yet.'));
    return box;
  };
  CP.shareAsset = async function (a) { await pushAssets({ objects: [{ assetId: a.id }] }); };
})();
