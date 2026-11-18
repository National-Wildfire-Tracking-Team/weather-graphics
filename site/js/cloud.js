/* Shared cloud (Phase 2): Supabase client, sign-in, organisation roles and the Team admin view.
   Optional: without `supabase` in config.json the Studio works exactly as before (browser-local only).
   Only the project's public anon/publishable key is ever used in the browser; permissions are enforced by
   RLS and SECURITY DEFINER functions in supabase/migrations, never by hiding buttons. */
(function () {
  const { h, toast } = NS.ui;
  const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js', LIB_SRI = 'sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK';
  const ROLE_LABEL = { admin: 'Administrator', producer: 'Producer', editor: 'Graphics Editor', broadcaster: 'Broadcaster', viewer: 'Viewer' };
  const listeners = new Set();
  const C = NS.Cloud = { configured: false, client: null, user: null, me: null, status: 'off', error: null, ROLE_LABEL, LIB };

  /* Rejects anything that is not a public client key (service-role JWTs and sb_secret_ keys must never reach a browser). */
  C.safeConfig = function (s) {
    if (!s || typeof s !== 'object' || typeof s.url !== 'string' || typeof s.anonKey !== 'string' || /REPLACE_ME/.test(s.url + s.anonKey) || !s.url || !s.anonKey) return null;
    if (!/^https:\/\/[\w.-]+(:\d+)?\/?$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(s.url)) { console.error('config.json supabase.url must be https (or localhost).'); return null; }
    if (/^sb_secret_/.test(s.anonKey)) { console.error('config.json contains a SECRET Supabase key. Refusing to use it; replace it with the anon/publishable key and rotate the secret.'); return 'secret'; }
    const parts = s.anonKey.split('.');
    if (parts.length === 3) { try { const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))); if (p.role && p.role !== 'anon') { console.error('config.json Supabase key has role "' + p.role + '". Refusing to use it; use the anon key and rotate this one.'); return 'secret'; } } catch (e) {} }
    return { url: s.url.replace(/\/$/, ''), anonKey: s.anonKey };
  };
  const emit = () => listeners.forEach(fn => { try { fn(C); } catch (e) { console.error(e); } });
  C.on = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  C.role = () => (C.me && C.me.role) || null;
  C.can = (...roles) => roles.includes(C.role());
  C.signedIn = () => !!(C.user && C.me && C.me.role);

  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = LIB; s.integrity = LIB_SRI; s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = () => rej(new Error('Could not load the Supabase client library (offline?).')); document.head.append(s); });
  }
  async function refreshMe() {
    if (!C.user) { C.me = null; return; }
    const { data, error } = await C.client.rpc('gs_me');
    if (error) { C.error = error.message; C.status = navigator.onLine ? 'error' : 'offline'; return; }
    C.me = data; C.status = data && data.role ? 'ready' : 'nomember';
  }
  C.init = async function () {
    const cfg = C.safeConfig(NS.config.supabase);
    if (cfg === 'secret') { C.status = 'blocked'; C.error = 'config.json holds a secret Supabase key; cloud features are disabled.'; emit(); return; }
    if (!cfg) { C.status = 'off'; emit(); return; }
    C.configured = true; C.status = 'loading'; C.cfg = cfg; emit();
    try {
      await loadLib();
      C.client = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'nwtt-graphics-auth' }, realtime: { params: { eventsPerSecond: 10 } } });
      const { data } = await C.client.auth.getSession(); C.user = data.session ? data.session.user : null;
      await refreshMe(); if (!C.user) C.status = 'signedout';
      C.client.auth.onAuthStateChange(async (ev, session) => {
        const was = C.user && C.user.id; C.user = session ? session.user : null;
        if ((C.user && C.user.id) !== was || ev === 'SIGNED_IN') { await refreshMe(); if (!C.user) C.status = 'signedout'; emit(); }
      });
    } catch (e) { C.status = 'offline'; C.error = e.message; }
    emit();
    window.addEventListener('online', async () => { if (C.client && C.status !== 'ready') { await refreshMe().catch(() => {}); emit(); } });
  };
  C.signIn = async (email, password) => { const r = await C.client.auth.signInWithPassword({ email: email.trim(), password }); if (r.error) throw r.error; C.user = r.data.user; await refreshMe(); emit(); return C.me; };
  C.sendLink = async email => { const r = await C.client.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } }); if (r.error) throw r.error; };
  C.signOut = async () => { await C.client.auth.signOut(); C.user = null; C.me = null; C.status = 'signedout'; emit(); };
  /* Supabase errors carry Postgres messages written for people (see the migration); add context for the common ones. */
  C.msg = e => { const m = (e && (e.message || e.error_description)) || String(e); return /version_conflict/.test(m) ? 'Someone else changed this at the same time. The latest state has been loaded; check it and try again.' : /rate_limited/.test(m) ? 'Too many requests in a short time. Wait a moment and retry.' : /Failed to fetch|NetworkError|fetch failed/i.test(m) ? 'Cannot reach the shared cloud (offline?). Nothing was changed.' : m; };

  /* ---------- account chip in the top bar ---------- */
  C.chip = function () {
    const el = h('div', { id: 'cloudChip', class: 'cloudchip' });
    const draw = () => {
      el.replaceChildren(); el.hidden = C.status === 'off';
      const st = { loading: ['Cloud: connecting…', ''], offline: ['Cloud: offline', 'warn'], error: ['Cloud: error', 'err'], blocked: ['Cloud: disabled (unsafe key)', 'err'], signedout: ['Cloud: signed out', ''], nomember: ['Cloud: no access', 'warn'], ready: [(C.me && (C.me.display_name || C.me.email)) + ' · ' + ROLE_LABEL[C.role()], 'ok'] }[C.status] || ['', ''];
      el.append(h('span', { class: 'tag ' + st[1], id: 'cloudStatus', title: C.error || '' }, st[0]));
      if (C.status === 'signedout' || C.status === 'nomember') el.append(h('button', { class: 'btn sm', id: 'signInBtn', onclick: () => C.signInDialog() }, C.status === 'nomember' ? 'Switch account' : 'Sign in'));
      if (C.user) el.append(h('button', { class: 'btn sm', id: 'signOutBtn', onclick: () => C.signOut() }, 'Sign out'));
    };
    C.on(draw); draw(); return el;
  };
  C.signInDialog = async function () {
    if (C.user) await C.signOut();
    const email = h('input', { type: 'email', id: 'loginEmail', autocomplete: 'username', style: 'width:300px', 'aria-label': 'Email' }), pw = h('input', { type: 'password', id: 'loginPassword', autocomplete: 'current-password', style: 'width:300px', 'aria-label': 'Password' }), msg = h('p', { class: 'hint', id: 'loginMsg' });
    const body = h('div', {}, h('p', { class: 'hint' }, 'Sign in with your NWTT Graphics Studio account. Accounts are created by an administrator; there is no public sign-up.'), h('div', { class: 'prop' }, h('label', {}, 'Email'), email), h('div', { class: 'prop' }, h('label', {}, 'Password'), pw), msg);
    await NS.ui.dialog('Sign in', body, [{ label: 'Cancel', value: null },
      { label: 'Email me a sign-in link', onclick: async () => { try { await C.sendLink(email.value); msg.textContent = 'If that address has an account, a sign-in link is on its way.'; } catch (e) { msg.textContent = C.msg(e); } return false; } },
      { label: 'Sign in', primary: true, onclick: async () => { msg.textContent = 'Signing in…'; try { const me = await C.signIn(email.value, pw.value); if (!me || !me.role) { msg.textContent = 'Signed in, but this account has no Graphics Studio role yet. Ask an administrator.'; return false; } toast('Signed in as ' + ROLE_LABEL[me.role] + '.', 'ok'); return true; } catch (e) { msg.textContent = C.msg(e); return false; } } }]);
  };

  /* ---------- Team (administrators manage roles; everyone else sees the list) ---------- */
  C.teamView = async function () {
    const root = h('div', {}, h('h1', {}, 'Team and permissions'), h('p', { class: 'sub' }, 'Graphics Studio roles. These are enforced by the database (row-level security), independent of Restream or Sentinel accounts.'));
    if (!C.signedIn()) { root.append(h('div', { class: 'empty' }, C.status === 'off' ? 'The shared cloud is not configured for this site (config.json → supabase).' : 'Sign in to see the team.')); return root; }
    root.append(h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Role', 'Can'].map(x => h('th', {}, x)))), h('tbody', {}, [
      ['Administrator', 'Manage members and roles, organisation settings, every session; override control (audited).'],
      ['Producer', 'Create and run broadcast sessions, approve graphics, Preview / Take Live / Update Live / Clear, create OBS outputs.'],
      ['Graphics Editor', 'Create and edit shared graphics, templates and assets; submit graphics for approval; send approved graphics to a session preview they are part of. Cannot publish.'],
      ['Broadcaster', 'See assigned sessions, create and monitor the OBS outputs for them. Cannot change what is live.'],
      ['Viewer', 'Read shared projects and previews. No editing or publishing.']].map(([a, b]) => h('tr', {}, h('td', {}, h('b', {}, a)), h('td', {}, b))))));
    const { data, error } = await C.client.from('org_members').select('*').order('role').order('email');
    if (error) { root.append(h('div', { class: 'tag err' }, C.msg(error))); return root; }
    const isAdmin = C.can('admin');
    root.append(h('h2', {}, 'Members'), h('table', { class: 't', id: 'teamTable' }, h('thead', {}, h('tr', {}, ['Member', 'Role', 'Active', ''].map(x => h('th', {}, x)))),
      h('tbody', {}, data.map(m => { const sel = h('select', { disabled: !isAdmin, 'aria-label': 'Role for ' + m.email }, Object.keys(ROLE_LABEL).map(r => h('option', { value: r, selected: r === m.role }, ROLE_LABEL[r]))), act = h('input', { type: 'checkbox', checked: m.active, disabled: !isAdmin, 'aria-label': 'Active' });
        return h('tr', {}, h('td', {}, h('b', {}, m.display_name || m.email), h('div', { class: 'hint' }, m.email)), h('td', {}, sel), h('td', {}, act),
          h('td', {}, isAdmin ? h('button', { class: 'btn sm', onclick: async () => { const r = await C.client.rpc('gs_set_member', { p_email: m.email, p_role: sel.value, p_active: act.checked }); r.error ? toast(C.msg(r.error), 'err') : toast('Saved.', 'ok'); } }, 'Save') : null)); }))));
    if (isAdmin) {
      const em = h('input', { type: 'email', placeholder: 'person@example.org', 'aria-label': 'Member email', id: 'teamEmail' }), rl = h('select', { 'aria-label': 'New member role', id: 'teamRole' }, Object.keys(ROLE_LABEL).map(r => h('option', { value: r, selected: r === 'viewer' }, ROLE_LABEL[r])));
      root.append(h('h2', {}, 'Add a member'), h('p', { class: 'hint' }, 'First invite the person from the Supabase dashboard (Authentication → Users → Invite). Once they have an account, give it a role here.'),
        h('div', { class: 'row' }, em, rl, h('button', { class: 'btn primary', id: 'teamAdd', onclick: async () => { const r = await C.client.rpc('gs_set_member', { p_email: em.value, p_role: rl.value }); if (r.error) toast(C.msg(r.error), 'err'); else { toast('Member added.', 'ok'); NS.App.render(); } } }, 'Add / update')));
    }
    return root;
  };
})();
