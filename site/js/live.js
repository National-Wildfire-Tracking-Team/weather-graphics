/* Live Broadcast Control (Phase 2): broadcast sessions, Preview → Take Live / Update Live / Clear, OBS outputs,
   control transfer, history/rollback and audit. Every action is a server function (supabase/migrations) that checks
   role, session control and the expected session version; this UI only reflects what the server allows.
   Draft (editing) never changes the output: only Take Live / Update Live / Roll back / Clear do, after confirmation. */
(function () {
  const { h, toast } = NS.ui, C = NS.Cloud;
  const TYPES = [['general', 'General'], ['wildfire', 'Wildfire'], ['severe', 'Severe weather'], ['tropical', 'Hurricane / tropical'], ['evacuation', 'Evacuation'], ['breaking', 'Breaking news'], ['briefing', 'Official briefing']];
  const STATUS = { draft: ['Draft', ''], ready: ['Ready', 'ok'], live: ['LIVE', 'err'], interrupted: ['Interrupted', 'warn'], ended: ['Ended', ''], archived: ['Archived', ''] };
  // Categories whose graphics carry time-sensitive public-safety information: they get an expiry and a stale limit by default.
  const TIME_SENSITIVE = /safety|severe|tropical|breaking|evac|incident|wildfire/i;
  const L = NS.Live = { TIME_SENSITIVE };
  const fmtT = t => t ? new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—';
  const ago = t => { if (!t) return 'never'; const s = Math.round((Date.now() - new Date(t)) / 1000); return s < 60 ? s + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; };
  const b64 = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
  const hexToUrl = hex => { const s = hex.replace(/^\\x/, ''), u = new Uint8Array(s.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(s.substr(i * 2, 2), 16); return URL.createObjectURL(new Blob([u], { type: 'image/png' })); };
  L.outputUrl = (sessionId, token) => new URL('broadcast/output/' + sessionId, location.href.replace(/#.*$/, '').replace(/[^/]*$/, '')).href + '#t=' + token;

  /* Render a project with the existing export engine into the exact 1920×1080 PNG that will air. */
  L.renderForLive = async function (p) {
    const overlay = !!p.canvas.bg.transparent;
    if (Math.abs(p.canvas.w / p.canvas.h - 16 / 9) > 0.01) throw new Error('Live graphics must be 16:9 (this one is ' + p.canvas.w + '×' + p.canvas.h + '). Create a 1920×1080 variant first.');
    const r = await NS.Export.render(p, NS.Export.targetOptions(p, overlay ? 'obs' : 'obs-full'));
    if (r.w !== 1920 || r.h !== 1080) throw new Error('Rendered ' + r.w + '×' + r.h + ', expected 1920×1080.');
    return { blob: r.blob, overlay, warnings: r.warnings, info: r.info };
  };
  /* Defaults for expiry / stale limit / source from the project's own fields. */
  L.liveDefaults = function (p) {
    const f = p.fields || {}, sensitive = TIME_SENSITIVE.test((p.category || '') + ' ' + (p.templateId || '')) || !!f.asOf;
    const t = f.asOf || f.validTime || f.advisoryTime || '';
    return { sensitive, expiresMin: sensitive ? 60 : 0, staleAfter: sensitive ? 300 : 0, source: typeof f.source === 'string' && !NS.Export.PLACEHOLDER.test(f.source) ? f.source : '', sourceTime: t ? new Date(t).toISOString() : '' };
  };

  /* Preview dialog: options, readiness confirmation, render, upload. Returns the new revision or null. */
  L.previewDialog = async function (p, session, cloudProject) {
    const d = L.liveDefaults(p), issues = NS.Export.readiness(p);
    const tr = h('select', { 'aria-label': 'Transition', id: 'pvTransition' }, h('option', { value: 'fade' }, 'Fade in / fade out (default)'), h('option', { value: 'cut' }, 'Immediate cut'));
    const ex = h('select', { 'aria-label': 'Expires', id: 'pvExpires' }, [[0, 'Does not expire'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [720, '12 hours'], [1440, '24 hours']].map(([v, l]) => h('option', { value: v, selected: v === d.expiresMin }, l)));
    const st = h('select', { 'aria-label': 'Hide if output loses contact', id: 'pvStale' }, [[0, 'Keep showing (holding cards only)'], [60, 'after 1 minute'], [300, 'after 5 minutes'], [900, 'after 15 minutes']].map(([v, l]) => h('option', { value: v, selected: v === d.staleAfter }, l)));
    const src = h('input', { type: 'text', value: d.source, placeholder: 'e.g. CAL FIRE incident page', 'aria-label': 'Source', id: 'pvSource', style: 'width:100%' });
    const stime = h('input', { type: 'datetime-local', 'aria-label': 'Source time', id: 'pvSourceTime', value: d.sourceTime ? new Date(new Date(d.sourceTime).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '' });
    const warn = h('div', {}, issues.length ? h('div', { class: 'tag warn', style: 'display:block;white-space:normal' }, h('b', {}, 'Not ready to air: '), issues.join(' ')) : null,
      d.sensitive ? h('p', { class: 'hint' }, 'Time-sensitive graphic: it should expire, and the OBS output hides it if it loses contact with the studio, so outdated warnings or evacuation information are never shown as current.') : null);
    const row = (l, c) => h('div', { class: 'prop' }, h('label', {}, l), h('div', { class: 'ctl' }, c));
    const ok = await NS.ui.dialog('Send to preview — ' + session.title, h('div', { style: 'width:560px;max-width:86vw' }, h('p', {}, 'Renders "' + p.name + '" at 1920×1080 and puts it in this session\'s ', h('b', {}, 'Preview'), '. Nothing changes on air until a producer clicks Take Live / Update Live.'),
      row('Transition', tr), row('Expires', ex), row('If output loses contact', st), row('Source', src), row('Source time', stime), warn),
      [{ label: 'Cancel', value: false }, { label: issues.length ? 'Preview anyway' : 'Preview', value: true, primary: !issues.length, danger: !!issues.length }]);
    if (!ok) return null;
    toast('Rendering 1920×1080…');
    const out = await L.renderForLive(p);
    const exp = +ex.value ? new Date(Date.now() + ex.value * 60000).toISOString() : null;
    const r = await C.client.rpc('bc_create_preview', { p_session: session.id, p_name: p.name, p_png_base64: await b64(out.blob), p_overlay: out.overlay, p_project: cloudProject ? cloudProject.id : null, p_project_version: cloudProject ? cloudProject.version : null,
      p_category: p.category || null, p_transition: tr.value, p_expires_at: exp, p_stale_after_s: +st.value || null, p_source: src.value || null, p_source_time: stime.value ? new Date(stime.value).toISOString() : null });
    if (r.error) throw r.error;
    toast('In preview. Review it, then Take Live.', 'ok'); return r.data;
  };

  /* From the editor: pick a session and send the open project to its preview. */
  L.sendFromEditor = async function (p) {
    if (!C.signedIn()) { toast('Sign in to the shared cloud to send graphics to a broadcast.', 'err'); return; }
    const r = await C.client.from('broadcast_sessions').select('id,title,status,version').in('status', ['draft', 'ready', 'live', 'interrupted']).order('updated_at', { ascending: false });
    if (r.error || !r.data.length) { toast(r.error ? C.msg(r.error) : 'No open broadcast sessions you are assigned to.', 'err'); return; }
    const sel = h('select', { 'aria-label': 'Session', id: 'sendSession' }, r.data.map(s => h('option', { value: s.id }, s.title + ' · ' + STATUS[s.status][0])));
    const go = await NS.ui.dialog('Send to Live Broadcast Control', h('div', {}, h('p', {}, 'Choose the broadcast session.'), sel, p.cloud ? null : h('p', { class: 'hint' }, 'This project is only in this browser. Producers can preview it; Graphics Editors must share it and get it approved first.')), [{ label: 'Cancel', value: false }, { label: 'Continue', value: true, primary: true }]);
    if (!go) return;
    try { const s = r.data.find(x => x.id === sel.value); const rev = await L.previewDialog(p, s, p.cloud ? { id: p.cloud.id, version: p.cloud.version } : null); if (rev) location.hash = '#/live/' + s.id; } catch (e) { toast(C.msg(e), 'err', 9000); }
  };

  /* ---------- incident → graphic (verified sources only) ---------- */
  /* Fields for the NWTT Wildfire Fact Panel from an incident cluster. Uses agency records only (NIFC, CAL FIRE, NWS, Cal OES,
     IPAWS archive); social posts are never used. Every value names its source; asOf is the source record's own update time. */
  L.incidentFacts = function (c) {
    const I = NS.Incidents, name = id => (I.srcById(id) || {}).short || id;
    const fires = (c.fires || []).filter(f => f.src === 'wfigs' || f.src === 'calfire');
    const best = fires.find(f => f.src === 'calfire' && f.acres != null) || fires.find(f => f.acres != null) || fires[0] || (c.fires || []).find(f => f.src === 'inciweb');
    const evac = (c.evac || []).filter(e => ['nws-evac', 'caloes', 'ipaws'].includes(e.src));
    const evLine = evac.length ? evac.slice(0, 2).map(e => I.evacVerb(e) + ' (' + name(e.src) + (e.src === 'ipaws' ? ' archive, delayed' : '') + ')').join('; ') : '[Orders / warnings, or "None reported"]';
    const used = [...new Set([best && best.src, ...evac.slice(0, 2).map(e => e.src)].filter(Boolean))].map(name);
    const t = best && (best.updated || best.start);
    return {
      fields: { fireName: (c.name || '[FIRE NAME]').replace(/\s+(fire|complex)$/i, m => m.toUpperCase()), acres: best && best.acres != null ? I.fmt.acres(best.acres) + ' (' + name(best.src) + ')' : '[acres, as reported]',
        containment: best && best.contained != null ? best.contained + '% (' + name(best.src) + ')' : '[% contained, or "Not reported"]',
        location: [c.county && c.county + ' County', c.state].filter(Boolean).join(', ') || '[County, State]', evac: evLine,
        asOf: t ? new Date(t - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '', source: used.join(' / ') || '[AGENCY]' },
      sourceTime: t || null, sources: used, ipaws: evac.some(e => e.src === 'ipaws') };
  };
  L.incidentGraphic = async function (c) {
    const t = NS.Templates.list.find(x => x.id === 'nwtt-wildfire-facts'), brand = await NS.getBrand(), p = await NS.Templates.instantiate(t, brand);
    const f = L.incidentFacts(c); Object.assign(p.fields, f.fields);
    p.name = (c.name || 'Incident') + ' — live facts'; p.incidentRef = { key: c.key, name: c.name, sources: f.sources, sourceTime: f.sourceTime };
    await NS.App.createProject(p);
    toast('Check every value against the agency source before sending it to preview.' + (f.ipaws ? ' IPAWS evacuation messages come from a delayed archive, not a real-time feed.' : ''), 'ok', 9000);
  };
  L.incidentSession = async function (c) {
    if (!C.signedIn() || !C.can('admin', 'producer')) { toast('Only producers can start broadcast sessions (sign in first).', 'err'); return; }
    const r = await C.client.rpc('bc_create_session', { p_title: (c.name || 'Incident') + ' coverage', p_type: 'wildfire', p_incident_name: c.name, p_incident_ref: { key: c.key, name: c.name, state: c.state || null, sources: (c.sources || []).filter(s => s !== 'social') } });
    if (r.error) { toast(C.msg(r.error), 'err'); return; } location.hash = '#/live/' + r.data.id;
  };

  /* ---------- fallback package: holding cards as PNG (no time-sensitive content) ---------- */
  L.fallbackPack = async function () {
    const brand = await NS.getBrand(); let n = 0;
    for (const id of ['nwtt-starting-soon', 'nwtt-technical', 'nwtt-ending']) {
      const p = await NS.Templates.instantiate(NS.Templates.list.find(t => t.id === id), brand); p.fields.subtitle = p.fields.subtitle === '[Coverage title]' ? 'NWTT live coverage' : p.fields.subtitle;
      const r = await NS.Export.render(p, NS.Export.targetOptions(p, 'obs-full')); NS.Export.download(r.blob, NS.Export.fileName(p, r)); n++;
    }
    toast(n + ' fallback holding cards downloaded. In OBS, keep them in scenes 00, 09 and 10.', 'ok');
  };

  /* ---------- views ---------- */
  L.view = async function (arg) {
    if (arg) return sessionView(arg);
    const root = h('div', { class: 'live' }, h('h1', {}, 'Live Broadcast Control'), h('p', { class: 'sub' }, 'Run graphics for a live broadcast: choose a graphic, preview it, then take it live to the OBS Browser Source outputs of the session. OBS still does the scene switching and streaming.'));
    if (!C.signedIn()) { root.append(h('div', { class: 'empty', id: 'liveSignin' }, C.status === 'off' ? 'Live Broadcast Control needs the shared cloud (config.json → supabase). Until then, use Export → OBS Studio (Phase 1 PNG workflow).' : C.status === 'offline' ? 'The shared cloud is unreachable. OBS outputs keep showing the last approved graphic unless it is time-sensitive and goes stale. Use the PNG fallback if needed.' : 'Sign in to run or watch broadcast sessions.', ' ', C.status === 'signedout' ? h('button', { class: 'btn primary', onclick: () => C.signInDialog() }, 'Sign in') : null)); root.append(h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: L.fallbackPack }, 'Download fallback holding cards (PNG)'))); return root; }
    const r = await C.client.from('broadcast_sessions').select('*').order('updated_at', { ascending: false }).limit(100);
    if (r.error) { root.append(h('div', { class: 'tag err' }, C.msg(r.error))); return root; }
    if (C.can('admin', 'producer')) {
      const title = h('input', { type: 'text', id: 'newSessionTitle', placeholder: 'Broadcast title', style: 'min-width:280px' }), type = h('select', { id: 'newSessionType', 'aria-label': 'Broadcast type' }, TYPES.map(([v, l]) => h('option', { value: v }, l)));
      const inc = h('input', { type: 'text', id: 'newSessionIncident', placeholder: 'Incident name (optional)' }), bc = h('select', { id: 'newSessionBroadcaster', 'aria-label': 'Assigned broadcaster' }, h('option', { value: '' }, '— assign broadcaster —'), [...NS.CloudProjects.members.values()].filter(m => m.active && ['broadcaster', 'producer', 'admin'].includes(m.role)).map(m => h('option', { value: m.user_id }, (m.display_name || m.email) + ' (' + C.ROLE_LABEL[m.role] + ')')));
      root.append(h('h2', {}, 'New broadcast session'), h('div', { class: 'row' }, title, type, inc, bc, h('button', { class: 'btn primary', id: 'createSession', onclick: async () => {
        if (!title.value.trim()) return toast('Give the broadcast a title.', 'err');
        const x = await C.client.rpc('bc_create_session', { p_title: title.value, p_type: type.value, p_incident_name: inc.value || null, p_broadcaster: bc.value || null });
        x.error ? toast(C.msg(x.error), 'err') : (location.hash = '#/live/' + x.data.id); } }, 'Create session')));
    }
    root.append(h('h2', {}, 'Sessions'), r.data.length ? h('table', { class: 't', id: 'sessionList' }, h('thead', {}, h('tr', {}, ['Session', 'Type', 'Status', 'Controller', 'On air', 'Updated', ''].map(x => h('th', {}, x)))),
      h('tbody', {}, r.data.map(s => h('tr', {}, h('td', {}, h('b', {}, s.title), s.incident_name ? h('div', { class: 'hint' }, s.incident_name) : null), h('td', {}, (TYPES.find(t => t[0] === s.broadcast_type) || [0, s.broadcast_type])[1]),
        h('td', {}, h('span', { class: 'tag ' + STATUS[s.status][1] }, STATUS[s.status][0])), h('td', {}, NS.CloudProjects.who(s.controller_id)), h('td', {}, s.live_revision_id ? 'graphic live' : '—'), h('td', {}, NS.ui.fmtDate(Date.parse(s.updated_at))),
        h('td', {}, h('a', { class: 'btn sm primary', href: '#/live/' + s.id }, 'Open')))))) : h('div', { class: 'empty' }, 'No sessions yet.'),
      h('div', { class: 'btnrow', style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: L.fallbackPack }, 'Download fallback holding cards (PNG)')));
    return root;
  };

  async function sessionView(id) {
    const root = h('div', { class: 'live', id: 'liveSession' }), imgs = new Map(); let S = null, busy = false, lastOk = 0, rtState = 'connecting', disposed = false, chan = null;
    const conn = h('span', { class: 'tag', id: 'liveConn' }, 'connecting…');
    const state = { session: null, revisions: [], events: [], outputs: [], audit: [] };
    const img = async rid => { if (!rid) return null; if (imgs.has(rid)) return imgs.get(rid); const r = await C.client.from('render_images').select('png').eq('revision_id', rid).single(); const u = r.error ? null : hexToUrl(r.data.png); imgs.set(rid, u); return u; };
    let loadSeq = 0;
    /* Overlapping refreshes can finish out of order: only the newest request may apply, and a session row older than
       the one already shown (lower version) is never applied, so the console cannot slip back to a stale state. */
    async function load() {
      const my = ++loadSeq;
      const [s, rv, ev, out, au] = await Promise.all([
        C.client.from('broadcast_sessions').select('*').eq('id', id).maybeSingle(),
        C.client.from('broadcast_revisions').select('*').eq('session_id', id).order('id', { ascending: false }).limit(40),
        C.client.from('live_events').select('*').eq('session_id', id).order('seq', { ascending: false }).limit(40),
        C.client.from('output_tokens').select('id,label,created_by,created_at,expires_at,revoked_at,last_seen_at,last_rendered_seq,last_status').eq('session_id', id).order('created_at', { ascending: false }),
        C.client.from('audit_log').select('*').eq('session_id', id).order('at', { ascending: false }).limit(60)]);
      const err = [s, rv, ev, au].find(x => x.error); if (err) throw err.error;
      if (!s.data) throw new Error('Session not found, or you are not assigned to it.');
      if (my !== loadSeq || (state.session && s.data.version < state.session.version)) return false;
      Object.assign(state, { session: s.data, revisions: rv.data, events: ev.data, outputs: out.error ? [] : out.data, audit: au.data }); S = s.data; lastOk = Date.now();
    }
    let pending = null; const refresh = () => { clearTimeout(pending); pending = setTimeout(async () => { try { await load(); await draw(); } catch (e) { setConn(); } }, 250); };
    const setConn = () => { const age = (Date.now() - lastOk) / 1000; const cls = rtState === 'SUBSCRIBED' && age < 30 ? 'ok' : age < 60 ? 'warn' : 'err';
      conn.className = 'tag ' + cls; conn.textContent = (rtState === 'SUBSCRIBED' ? 'Realtime connected' : rtState === 'connecting' ? 'Connecting…' : 'Reconnecting (polling)') + ' · state ' + (lastOk ? Math.round(age) + ' s old' : 'not loaded'); conn.dataset.state = cls; };
    const isCtl = () => S && S.controller_id === C.user.id, ended = () => S && ['ended', 'archived'].includes(S.status);
    async function act(label, fn, confirm) {
      if (busy) return; if (confirm && !(await NS.ui.dialog(confirm.title, confirm.body, [{ label: 'Cancel', value: false }, { label: confirm.ok, value: true, primary: !confirm.danger, danger: !!confirm.danger }]))) return;
      busy = true; try { const r = await fn(); if (r && r.error) throw r.error; toast(label, 'ok'); } catch (e) { toast(C.msg(e), 'err', 9000); } finally { busy = false; await load().catch(() => {}); await draw(); }
    }
    const rev = rid => state.revisions.find(r => r.id === rid);
    const expiry = r => !r || !r.expires_at ? 'does not expire' : new Date(r.expires_at) <= new Date() ? 'EXPIRED' : 'expires ' + fmtT(r.expires_at) + ' (' + Math.max(0, Math.round((new Date(r.expires_at) - Date.now()) / 60000)) + ' min)';
    const meta = r => h('div', { class: 'hint' }, [r.overlay ? 'Transparent overlay' : 'Full-screen', r.transition === 'cut' ? 'cut' : 'fade', expiry(r), r.stale_after_s ? 'hides after ' + Math.round(r.stale_after_s / 60) + ' min without contact' : null, r.source ? 'Source: ' + r.source + (r.source_time ? ' (' + NS.ui.fmtDate(Date.parse(r.source_time)) + ')' : '') : 'no source line'].filter(Boolean).join(' · '));
    const frame = (url, cls, id) => h('div', { class: 'livepic checker ' + (cls || ''), id }, url ? h('img', { src: url, alt: '' }) : h('div', { class: 'hint', style: 'padding:40px;text-align:center' }, 'Nothing'));

    async function draw() {
      if (disposed) return;
      const s = state.session, live = rev(s.live_revision_id), pv = rev(s.preview_revision_id), canCtl = isCtl() && !ended();
      const liveUrl = await img(s.live_revision_id), pvUrl = await img(s.preview_revision_id);
      const lastEv = state.events[0];
      // header
      const head = h('div', { class: 'livehead' }, h('a', { class: 'btn sm', href: '#/live' }, '← Sessions'), h('h1', { style: 'margin:0' }, s.title), h('span', { class: 'tag ' + STATUS[s.status][1], id: 'liveStatus' }, STATUS[s.status][0]), conn,
        h('span', { class: 'hint' }, 'Controller: ', h('b', { id: 'liveController' }, CP().who(s.controller_id)), isCtl() ? ' (you)' : ''), h('span', { class: 'hint', id: 'liveVersion' }, 'v' + s.version + ' · seq ' + s.live_seq));
      if (s.incident_name) head.append(h('span', { class: 'tag' }, 'Incident: ' + s.incident_name));
      // three states
      const draft = h('div', { class: 'livecol' }, h('h3', {}, '1 · Draft'), h('p', { class: 'hint' }, 'Edit graphics in Graphics Studio. Editing never changes what is on air.'));
      if (!ended()) draft.append(await graphicPicker());
      const preview = h('div', { class: 'livecol' }, h('h3', {}, '2 · Preview ', h('span', { class: 'tag' }, 'not public')), frame(pvUrl, '', 'livePreview'), pv ? h('div', {}, h('b', {}, pv.name), meta(pv), h('div', { class: 'hint' }, 'Sent by ' + CP().who(pv.created_by) + ' at ' + fmtT(pv.created_at))) : h('p', { class: 'hint' }, 'Send a graphic to preview first.'),
        h('div', { class: 'btnrow' },
          h('button', { class: 'btn primary', id: 'takeLive', disabled: !canCtl || !pv || !!s.live_revision_id || (pv && pv.expires_at && new Date(pv.expires_at) <= new Date()), title: canCtl ? '' : 'Only the session controller can publish', onclick: () => act('Graphic is live.', () => C.client.rpc('bc_publish', { p_session: id, p_revision: pv.id, p_mode: 'take', p_expected_version: S.version }),
            { title: 'Take Live', ok: 'Take Live', body: h('div', { style: 'max-width:520px' }, h('p', {}, 'Publish "' + pv.name + '" to every OBS output of this session?'), frame(pvUrl, 'small'), meta(pv)) }) }, 'Take Live'),
          h('button', { class: 'btn primary', id: 'updateLive', disabled: !canCtl || !pv || !s.live_revision_id || pv.id === s.live_revision_id, onclick: () => act('Live graphic updated.', () => C.client.rpc('bc_publish', { p_session: id, p_revision: pv.id, p_mode: 'update', p_expected_version: S.version }),
            { title: 'Update Live', ok: 'Update Live', body: h('div', { style: 'max-width:620px' }, h('p', {}, 'Replace the live graphic with the preview?'), h('div', { class: 'row' }, h('div', {}, h('div', { class: 'hint' }, 'Now on air'), frame(liveUrl, 'small')), h('div', {}, h('div', { class: 'hint' }, 'Will go on air'), frame(pvUrl, 'small')))) }) }, 'Update Live')));
      const liveCol = h('div', { class: 'livecol onair' }, h('h3', {}, '3 · Live ', live ? h('span', { class: 'tag err' }, 'ON AIR') : h('span', { class: 'tag' }, 'nothing on air')), frame(liveUrl, '', 'liveNow'),
        live ? h('div', {}, h('b', { id: 'liveName' }, live.name), meta(live)) : null,
        h('div', { class: 'hint', id: 'liveLast' }, lastEv ? 'Last change: ' + lastEv.action + ' by ' + CP().who(lastEv.actor_id) + ' at ' + fmtT(lastEv.at) : 'Never published.'),
        live && live.expires_at && new Date(live.expires_at) <= new Date() ? h('div', { class: 'tag err', style: 'display:block' }, 'EXPIRED: outputs have stopped showing it. Clear it or publish an update.') : null,
        h('div', { class: 'btnrow' }, h('button', { class: 'btn danger', id: 'clearLive', disabled: !canCtl || !s.live_revision_id, onclick: () => act('Graphic cleared.', () => C.client.rpc('bc_clear', { p_session: id, p_expected_version: S.version }), { title: 'Clear Graphic', ok: 'Clear Graphic', danger: true, body: h('p', {}, 'Remove the graphic from every OBS output of this session now?') }) }, 'Clear Graphic')));
      const cols = h('div', { class: 'livegrid' }, draft, preview, liveCol);
      // outputs, control, history, audit
      root.replaceChildren(head, cols, h('div', { class: 'livegrid two' }, outputsBox(), controlBox()), historyBox(), auditBox());
      setConn();
    }
    const CP = () => NS.CloudProjects;
    async function graphicPicker() {
      const box = h('div', {}), cloud = await C.client.from('projects').select('id,name,approval,version,category').is('deleted_at', null).order('updated_at', { ascending: false }).limit(60);
      const local = (await NS.Store.all('projects').catch(() => [])).filter(p => p.canvas.w * 9 === p.canvas.h * 16).sort((a, b) => b.updated - a.updated).slice(0, 40);
      const sel = h('select', { id: 'pickGraphic', 'aria-label': 'Graphic', style: 'max-width:100%' },
        h('optgroup', { label: 'Shared projects' }, (cloud.data || []).map(p => h('option', { value: 'c:' + p.id }, p.name + (p.approval === 'approved' ? ' ✓ approved' : ' (' + p.approval + ')')))),
        C.can('admin', 'producer') ? h('optgroup', { label: 'In this browser' }, local.map(p => h('option', { value: 'l:' + p.id }, p.name + (p.cloud ? ' (linked)' : '')))) : null);
      box.append(sel, h('div', { class: 'btnrow' }, h('button', { class: 'btn', id: 'sendPreview', onclick: async () => {
        const v = sel.value; if (!v) return; try {
          let p, cp = null;
          if (v[0] === 'c') { const r = await C.client.from('projects').select('*').eq('id', v.slice(2)).single(); if (r.error) throw r.error; await CP().pullAssets(r.data.data.assetRefs); p = Object.assign(NS.blankProject(1920, 1080, r.data.name, r.data.category), r.data.data, { name: r.data.name, category: r.data.category }); cp = { id: r.data.id, version: r.data.version }; }
          else { p = await NS.Store.get('projects', v.slice(2)); if (p.cloud) cp = { id: p.cloud.id, version: p.cloud.version }; }
          const rv = await L.previewDialog(p, S, cp); if (rv) { await load(); await draw(); }
        } catch (e) { toast(C.msg(e), 'err', 9000); } } }, 'Preview'), h('a', { class: 'btn', href: '#/shared' }, 'Shared projects')));
      if (!C.can('admin', 'producer')) box.append(h('p', { class: 'hint' }, 'As a Graphics Editor you can preview approved shared graphics; a producer takes them live.'));
      return box;
    }
    function outputsBox() {
      const box = h('div', { class: 'livecol', id: 'liveOutputs' }, h('h3', {}, 'OBS outputs'));
      const canMake = !ended() && (isCtl() || C.can('admin') || (C.can('producer', 'broadcaster') && [S.producer_id, S.broadcaster_id].includes(C.user.id)));
      const fresh = state.outputs.filter(o => !o.revoked_at && new Date(o.expires_at) > new Date());
      box.append(fresh.length ? h('table', { class: 't' }, h('tbody', {}, fresh.map(o => {
        const seen = o.last_seen_at ? (Date.now() - Date.parse(o.last_seen_at)) / 1000 : Infinity, behind = o.last_rendered_seq != null && o.last_rendered_seq < S.live_seq;
        const health = seen > 60 ? ['not connected', 'err'] : seen > 20 ? ['connection unstable', 'warn'] : behind ? ['updating…', 'warn'] : o.last_status === 'error' ? ['render error', 'err'] : ['showing current state', 'ok'];
        return h('tr', { 'data-output': o.id }, h('td', {}, h('b', {}, o.label), h('div', { class: 'hint' }, 'expires ' + NS.ui.fmtDate(Date.parse(o.expires_at)))), h('td', {}, h('span', { class: 'tag ' + health[1], 'data-health': health[1] }, health[0]), h('div', { class: 'hint' }, 'seen ' + ago(o.last_seen_at) + (o.last_rendered_seq != null ? ' · rendered seq ' + o.last_rendered_seq : ''))),
          h('td', {}, h('button', { class: 'btn sm', onclick: () => act('Output renewed for 12 h.', () => C.client.rpc('bc_output_token_admin', { p_token_id: o.id, p_action: 'extend', p_hours: 12 })) }, 'Renew 12 h'),
            h('button', { class: 'btn sm danger', 'data-revoke': o.id, onclick: () => act('Output revoked.', () => C.client.rpc('bc_output_token_admin', { p_token_id: o.id, p_action: 'revoke' }), { title: 'Revoke OBS output', ok: 'Revoke', danger: true, body: h('p', {}, '"' + o.label + '" stops showing graphics within seconds and its URL stops working for good. Create a new output to replace it.') }) }, 'Revoke'))); }))) : h('p', { class: 'hint' }, 'No active outputs.'));
      box.append(h('p', { class: 'hint' }, 'Health comes from the output itself (what it last rendered), not just from publishing.'));
      if (canMake) { const lbl = h('input', { type: 'text', id: 'outLabel', placeholder: 'e.g. Kyle — OBS laptop', 'aria-label': 'Output label' }), hrs = h('select', { id: 'outHours', 'aria-label': 'Valid for' }, [4, 12, 24, 72].map(x => h('option', { value: x, selected: x === 12 }, x + ' h')));
        box.append(h('div', { class: 'row' }, lbl, hrs, h('button', { class: 'btn', id: 'makeOutput', onclick: async () => {
          const r = await C.client.rpc('bc_issue_output_token', { p_session: id, p_label: lbl.value || 'OBS output', p_ttl_hours: +hrs.value }); if (r.error) return toast(C.msg(r.error), 'err');
          const url = L.outputUrl(id, r.data.token), inp = h('input', { type: 'text', value: url, readonly: true, id: 'outputUrl', style: 'width:100%', onfocus: e => e.target.select() });
          await NS.ui.dialog('OBS Browser Source URL', h('div', { style: 'max-width:640px' }, h('p', {}, 'Add a ', h('b', {}, 'Browser'), ' source in OBS with this URL, width 1920, height 1080. This is the only time the full URL is shown.'), inp,
            h('p', { class: 'hint' }, 'Treat it like a password: it shows this session\'s live graphic until ' + new Date(r.data.expires_at).toLocaleString() + ' (renewable) or until revoked. It cannot change anything.')),
            [{ label: 'Copy URL', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Copied.', 'ok'); } catch (e) { inp.select(); } return false; } }, { label: 'Done', primary: true }]);
          await load(); await draw(); } }, 'Create OBS output')));
      }
      return box;
    }
    function controlBox() {
      const box = h('div', { class: 'livecol', id: 'liveControl' }, h('h3', {}, 'Control and session'));
      box.append(h('p', {}, 'Only the controller can change what is on air. Control moves only by explicit transfer' + (C.can('admin') ? ' (administrators can override; it is audited).' : '.')));
      const producers = [...CP().members.values()].filter(m => m.active && ['producer', 'admin'].includes(m.role) && m.user_id !== S.controller_id);
      if (isCtl() && !ended() && producers.length) { const to = h('select', { id: 'transferTo', 'aria-label': 'Transfer control to' }, producers.map(m => h('option', { value: m.user_id }, m.display_name || m.email)));
        box.append(h('div', { class: 'row' }, to, h('button', { class: 'btn', id: 'transferBtn', onclick: () => act('Control transferred.', () => C.client.rpc('bc_transfer_control', { p_session: id, p_to: to.value, p_expected_version: S.version }), { title: 'Transfer control', ok: 'Transfer', body: h('p', {}, 'Give control of this broadcast to ' + to.selectedOptions[0].textContent + '? You will no longer be able to publish.') }) }, 'Transfer control'))); }
      if (!isCtl() && !ended() && C.can('admin')) box.append(h('button', { class: 'btn danger', id: 'overrideBtn', onclick: () => act('You now control this session.', () => C.client.rpc('bc_transfer_control', { p_session: id, p_to: C.user.id, p_expected_version: S.version }), { title: 'Take control (override)', ok: 'Take control', danger: true, body: h('p', {}, 'Take control away from ' + CP().who(S.controller_id) + '? This is recorded in the audit log.') }) }, 'Take control (administrator override)'));
      const st = (to, label, danger, body) => h('button', { class: 'btn' + (danger ? ' danger' : ''), 'data-status': to, onclick: () => act('Session: ' + STATUS[to][0], () => C.client.rpc('bc_set_status', { p_session: id, p_status: to, p_expected_version: S.version }), { title: label, ok: label, danger, body: h('p', {}, body) }) }, label);
      const btns = { draft: [st('ready', 'Mark ready', false, 'Mark the session ready?')], ready: [], live: [st('interrupted', 'Mark interrupted', false, 'Mark the broadcast as interrupted? Outputs keep their current graphic.')], interrupted: [st('live', 'Resume', false, 'Mark the broadcast live again?')], ended: [st('archived', 'Archive', false, 'Archive this session?')], archived: [] }[S.status] || [];
      if (!ended()) btns.push(st('ended', 'End session', true, 'End this broadcast? The live graphic is cleared, every OBS output URL is revoked, and nothing more can be published to it.'));
      if (isCtl() || C.can('admin')) box.append(h('div', { class: 'btnrow' }, btns));
      box.append(h('p', { class: 'hint' }, 'Started ' + (S.started_at ? NS.ui.fmtDate(Date.parse(S.started_at)) : '—') + (S.ended_at ? ' · ended ' + NS.ui.fmtDate(Date.parse(S.ended_at)) : '') + ' · producer ' + CP().who(S.producer_id) + ' · broadcaster ' + CP().who(S.broadcaster_id)));
      return box;
    }
    function historyBox() {
      return h('div', { class: 'livecol', id: 'liveHistory' }, h('h3', {}, 'On-air history'), state.events.length ? h('table', { class: 't' }, h('tbody', {}, state.events.map(e => { const r = rev(e.revision_id);
        const canRb = isCtl() && !ended() && r && e.revision_id !== S.live_revision_id && !(r.expires_at && new Date(r.expires_at) <= new Date());
        return h('tr', {}, h('td', {}, '#' + e.seq), h('td', {}, fmtT(e.at)), h('td', {}, e.action), h('td', {}, r ? r.name : e.action === 'clear' ? '(cleared)' : '—'), h('td', {}, CP().who(e.actor_id)),
          h('td', {}, canRb ? h('button', { class: 'btn sm', 'data-rollback': r.id, onclick: () => act('Rolled back.', () => C.client.rpc('bc_publish', { p_session: id, p_revision: r.id, p_mode: 'rollback', p_expected_version: S.version }), { title: 'Roll back', ok: 'Put it back on air', body: h('p', {}, 'Put "' + r.name + '" (approved at ' + fmtT(r.approved_at) + ') back on air?') }) }, 'Roll back') : null)); }))) : h('p', { class: 'hint' }, 'Nothing has been on air yet.'));
    }
    function auditBox() {
      return h('details', { class: 'livecol', id: 'liveAudit' }, h('summary', {}, h('b', {}, 'Audit log'), ' (' + state.audit.length + ')'), h('table', { class: 't' }, h('tbody', {}, state.audit.map(a => h('tr', {}, h('td', {}, NS.ui.fmtDate(Date.parse(a.at))), h('td', {}, a.actor_email || '—'), h('td', {}, a.action), h('td', { class: 'hint' }, JSON.stringify(a.detail).slice(0, 160)))))));
    }

    try { if (!CP().members.size) await CP().loadMembers(); await load(); await draw(); }
    catch (e) { root.replaceChildren(h('a', { class: 'btn sm', href: '#/live' }, '← Sessions'), h('div', { class: 'empty' }, C.msg(e))); return root; }
    // Realtime (RLS-filtered) + polling fallback; full state is reloaded on (re)subscribe so nothing is missed.
    if (L.dispose) L.dispose();   // only one console subscription at a time
    chan = C.client.channel('console-' + id + '-' + Math.random().toString(36).slice(2, 8))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'broadcast_sessions', filter: 'id=eq.' + id }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_events', filter: 'session_id=eq.' + id }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'output_tokens', filter: 'session_id=eq.' + id }, refresh)
      .subscribe(st => { rtState = st; if (st === 'SUBSCRIBED') refresh(); setConn(); });
    const dispose = () => { if (disposed) return; disposed = true; clearInterval(poll); clearTimeout(pending); C.client.removeChannel(chan); imgs.forEach(u => u && URL.revokeObjectURL(u)); if (L.dispose === dispose) L.dispose = null; };
    L.dispose = dispose;
    const poll = setInterval(() => { if (!document.body.contains(root)) return dispose(); if (Date.now() - lastOk > 10000) refresh(); else setConn(); }, 5000);
    window.addEventListener('hashchange', function off() { if (!location.hash.startsWith('#/live/' + id)) { window.removeEventListener('hashchange', off); dispose(); } });
    L.debug = { state, refresh: () => load().then(draw) };
    return root;
  }
})();
