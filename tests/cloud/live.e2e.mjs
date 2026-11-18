/* Phase 2 end-to-end: Producer on Computer A → Supabase → OBS Browser Source on Computer B.
   Separate browser contexts (separate storage, cookies, sign-ins) stand in for separate computers; they share only the
   local Supabase stack. Needs: `npx supabase start` (repo root) and the static site on :8765 (`cd site && python3 -m http.server 8765`). */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';
import { users, URL_, ANON, PASSWORD, png, check, summary } from './env.mjs';
const SITE = process.env.SITE || 'http://localhost:8765/';
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find(p => existsSync(p));
const tag = 'e' + Date.now().toString(36); const U = await users(tag);
console.log('Phase 2 live graphics end-to-end — users tagged', tag);
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errs = [];
async function computer(name, opts = {}) {
  const ctx = await b.newContext(Object.assign({ viewport: { width: 1600, height: 950 }, acceptDownloads: true }, opts));
  await ctx.route('**/config.json', async r => { const res = await r.fetch(); const j = await res.json(); j.supabase = { url: URL_, anonKey: ANON }; r.fulfill({ response: res, json: j }); });
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(name + ': ' + e.message));
  return { ctx, page, ev: (fn, a) => page.evaluate(fn, a) };
}
async function signIn(c, who) {
  await c.page.goto(SITE + 'index.html#/dashboard'); await c.page.waitForSelector('#signInBtn', { timeout: 15000 });
  await c.page.click('#signInBtn'); await c.page.fill('#loginEmail', U[who].email); await c.page.fill('#loginPassword', PASSWORD);
  await c.page.click('dialog[aria-label="Sign in"] .btn.primary'); await c.page.waitForFunction(() => NS.Cloud.signedIn(), null, { timeout: 15000 });
}
const back = async c => { await c.page.click('#backBtn'); await c.page.waitForSelector('main h1:has-text("Dashboard")', { timeout: 15000 }); };
const confirmDlg = async (page, label) => { await page.click(`dialog .dlgfoot button:has-text("${label}")`); };
const waitOut = (B, fn, arg, timeout = 20000) => B.page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const out = B => B.ev(() => ({ ...window.__nwttOutput, events: undefined }));
// pixel check of the OBS page with a transparent background (what OBS composites)
const pixels = async B => { const buf = await B.page.screenshot({ omitBackground: true }); return B.ev(async b64 => { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob()); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0); const a = (X, Y) => x.getImageData(X, Y, 1, 1).data[3]; let opaque = 0; const d = x.getImageData(0, 0, bm.width, bm.height).data; for (let i = 3; i < d.length; i += 16) if (d[i] > 200) opaque++; return { corner: a(5, 5), center: a(bm.width >> 1, bm.height >> 1), opaqueFrac: opaque / (d.length / 16), w: bm.width, h: bm.height }; }, buf.toString('base64')); };

// ---------------- Computer A: producer
const A = await computer('A'); await signIn(A, 'producer');
check('A: producer signed in, role shown in the top bar', /Producer/.test(await A.page.innerText('#cloudChip')));
// a graphic to air (Phase 1 template), saved locally on A
await A.ev(() => NS.App.newFromTemplate('nwtt-source')); await A.page.waitForSelector('#workspace canvas');
await A.ev(() => { const e = NS.App.editor.ed; Object.assign(e.p.fields, { source: 'CAL FIRE', asOf: '2026-11-18T09:30' }); e.applyFields(); }); await A.page.click('#saveBtn'); await A.page.waitForTimeout(600);
const srcProject = await A.ev(() => NS.App.editor.ed.p.id);
await back(A); await A.page.goto(SITE + 'index.html#/live'); await A.page.waitForSelector('#newSessionTitle');
await A.page.fill('#newSessionTitle', 'Test Fire live ' + tag); await A.page.selectOption('#newSessionType', 'wildfire'); await A.page.fill('#newSessionIncident', 'Test Fire');
await A.page.click('#createSession'); await A.page.waitForSelector('#liveSession #liveStatus', { timeout: 15000 });
const sessionId = A.page.url().split('#/live/')[1];
check('A: broadcast session created and opened', /^[0-9a-f-]{36}$/.test(sessionId), sessionId);
await A.page.waitForFunction(() => /Realtime connected/.test(document.getElementById('liveConn').textContent), null, { timeout: 15000 }).catch(() => {});
check('A: console shows Realtime connection status', /Realtime connected/.test(await A.page.innerText('#liveConn')), await A.page.innerText('#liveConn'));

// Preview (draft → preview)
await A.page.selectOption('#pickGraphic', 'l:' + srcProject); await A.page.click('#sendPreview'); await A.page.waitForSelector('#pvTransition');
check('A: preview dialog proposes an expiry for a time-sensitive graphic', await A.page.inputValue('#pvExpires') === '60' && await A.page.inputValue('#pvSource') === 'CAL FIRE');
await confirmDlg(A.page, 'Preview'); await A.page.waitForSelector('#livePreview img', { timeout: 30000 });
check('A: rendered graphic appears in Preview (not public)', await A.page.isVisible('#livePreview img'));

// Phase 3: the session links to its live map in Sentinel Broadcast Mode
check('A: console links to the Sentinel live map control for this session', (await A.page.getAttribute('#liveMapLink a', 'href')) === 'https://app.nationalwildfiretrackingteam.org/broadcast/control/' + sessionId, await A.page.getAttribute('#liveMapLink a', 'href'));

// OBS output credential
await A.page.fill('#outLabel', 'Computer B OBS'); await A.page.click('#makeOutput'); await A.page.waitForSelector('#outputUrl');
const outUrl = await A.page.inputValue('#outputUrl'); await confirmDlg(A.page, 'Done');
check('A: OBS output URL carries the token only in the fragment', /\/broadcast\/output\/[0-9a-f-]{36}#t=[0-9a-f]{64}$/.test(outUrl), outUrl);
const localOut = SITE + 'broadcast/output.html#' + outUrl.split('#')[1];   // python http.server has no Netlify rewrite

// ---------------- Computer B: OBS Browser Source (1920×1080, no sign-in)
const B = await computer('B', { viewport: { width: 1920, height: 1080 } });
await B.page.goto(localOut); await waitOut(B, () => window.__nwttOutput && window.__nwttOutput.status === 'idle');
let o = await out(B); check('B: output connects and shows nothing before Take Live', o.status === 'idle' && o.shownRevision === null, o);
check('B: output page has no text, links, buttons or inputs', await B.ev(() => document.body.innerText.trim() === '' && !document.querySelector('a,button,input,select,textarea,nav')));
check('B: page does not scroll and is a 1920×1080 stage', await B.ev(() => getComputedStyle(document.body).overflow === 'hidden' && document.getElementById('stage').offsetWidth === 1920 && document.getElementById('stage').offsetHeight === 1080));
let px = await pixels(B); check('B: background fully transparent', px.corner === 0 && px.center === 0 && px.opaqueFrac === 0, px);
check('B: preview is not visible on the output', (await out(B)).shownRevision === null);

// ---------------- Take Live (A) → B
const t0 = Date.now();
await A.page.click('#takeLive'); await confirmDlg(A.page, 'Take Live');
const took = await waitOut(B, () => window.__nwttOutput.status === 'rendered' && window.__nwttOutput.shownRevision);
o = await out(B); check('B: Take Live reaches the output (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)', took && o.seq === 1, o);
check('B: update arrived by Realtime nudge (not only polling)', (await B.ev(() => window.__nwttOutput.events.map(e => e[1]))).some(e => /^nudge 1/.test(e)));
await B.page.waitForTimeout(700); px = await pixels(B);
check('B: transparent overlay keeps transparency (corner clear, graphic drawn)', px.corner === 0 && px.opaqueFrac > 0.005 && px.opaqueFrac < 0.2, px);
check('B: fade transition used by default', await B.ev(() => { const i = document.querySelector('#stage img.on'); return i && !i.classList.contains('cut') && parseFloat(getComputedStyle(i).transitionDuration) > 0; }));
await A.page.waitForSelector('#liveNow img'); await A.page.waitForFunction(() => document.querySelector('#liveOutputs [data-health="ok"]'), null, { timeout: 20000 }).catch(() => {});
check('A: console shows the output as healthy (it reported rendering seq 1)', await A.page.isVisible('#liveOutputs [data-health="ok"]'), await A.page.innerText('#liveOutputs'));
check('A: console shows who changed the live graphic and when', /Last change: take by producer/.test(await A.page.innerText('#liveLast')));

// ---------------- Computer C: second producer cannot publish
const Cc = await computer('C'); await signIn(Cc, 'producer2'); await Cc.page.goto(SITE + 'index.html#/live/' + sessionId); await Cc.page.waitForSelector('#liveStatus');
// Regression: overlapping re-renders (one superseded before it is attached) must not stop the visible console.
await Cc.ev(id => NS.Live.view(id), sessionId);   // a console built but never attached (what a superseded render leaves behind)
await Cc.page.waitForTimeout(3000);
check('C: visible console keeps its live connection after an orphaned/superseded render', /Realtime connected/.test(await Cc.page.innerText('#liveConn')), await Cc.page.innerText('#liveConn').catch(() => '?'));
check('C: non-controller producer sees the session but Take Live / Update / Clear are disabled', await Cc.page.isDisabled('#clearLive') && await Cc.page.isDisabled('#updateLive'));
const cTry = await Cc.ev(async id => (await NS.Cloud.client.rpc('bc_clear', { p_session: id, p_expected_version: NS.Live.debug.state.session.version })).error?.message, sessionId);
check('C: calling the server directly is refused too (server-side enforcement)', /not the controller/.test(cTry || ''), cTry);

// ---------------- Update Live with a full-screen card and a cut
await A.ev(() => NS.App.newFromTemplate('nwtt-technical')); await A.page.waitForSelector('#workspace canvas'); await A.page.click('#saveBtn'); await A.page.waitForTimeout(500);
const card = await A.ev(() => NS.App.editor.ed.p.id); await back(A); await A.page.goto(SITE + 'index.html#/live/' + sessionId); await A.page.waitForSelector('#pickGraphic');
await A.page.selectOption('#pickGraphic', 'l:' + card); await A.page.click('#sendPreview'); await A.page.selectOption('#pvTransition', 'cut'); await confirmDlg(A.page, 'Preview');
await A.page.waitForFunction(() => !document.getElementById('updateLive').disabled, null, { timeout: 30000 });
await A.page.click('#updateLive'); await confirmDlg(A.page, 'Update Live');
await waitOut(B, () => window.__nwttOutput.renderedSeq === 2 && window.__nwttOutput.status === 'rendered');
px = await pixels(B); check('B: Update Live replaced it with an opaque full-screen card', px.corner > 250 && px.opaqueFrac > 0.99, px);
check('B: cut transition (no fade)', await B.ev(() => document.querySelector('#stage img.on').classList.contains('cut') && document.querySelectorAll('#stage img').length === 1));

// ---------------- network interruption on B, Clear on A, recovery
await B.ctx.setOffline(true); await B.page.waitForTimeout(500);
await A.page.click('#clearLive'); await confirmDlg(A.page, 'Clear Graphic');
await B.page.waitForTimeout(6000); o = await out(B);
check('B offline: keeps the last approved holding card (not time-sensitive) and reports offline', o.shownRevision !== null && /offline|error/.test(o.status), o);
await B.ctx.setOffline(false);
const rec = await waitOut(B, () => window.__nwttOutput.seq === 3 && window.__nwttOutput.shownRevision === null, null, 40000);
check('B reconnects and fetches the current state (cleared)', rec, await out(B));
px = await pixels(B); check('B: cleared output is fully transparent again', px.opaqueFrac === 0, px);

// ---------------- rollback (UI) to the earlier overlay
await A.page.waitForSelector('[data-rollback]'); const rbId = await A.page.getAttribute('#liveHistory [data-rollback] >> nth=-1', 'data-rollback');
await A.page.click(`#liveHistory [data-rollback="${rbId}"]`); await confirmDlg(A.page, 'Put it back on air');
check('B: rollback puts the earlier approved graphic back', await waitOut(B, rid => window.__nwttOutput.shownRevision === +rid && window.__nwttOutput.status === 'rendered', rbId));

// ---------------- stale-contact safety for time-sensitive graphics
o = await out(B); check('live overlay is time-sensitive (has expiry and stale limit)', o.live && o.live.expires_at && o.live.stale_after_s === 300, o.live);
await B.ctx.setOffline(true); await B.ev(() => { window.__nwttOutput.lastContact = Date.now() - 301000; });
check('B: time-sensitive graphic is hidden when the output loses contact too long', await waitOut(B, () => window.__nwttOutput.shownRevision === null && window.__nwttOutput.hiddenReason === 'stale', null, 5000));
await B.ctx.setOffline(false);
check('B: shown again once the live state is confirmed', await waitOut(B, () => window.__nwttOutput.shownRevision !== null && window.__nwttOutput.status === 'rendered', null, 40000));

// ---------------- expiry (server-side and on the output)
const S = (await U.producer.c.from('broadcast_sessions').select('*').eq('id', sessionId).single()).data;
const rx = (await U.producer.c.rpc('bc_create_preview', { p_session: sessionId, p_name: 'Evacuation (expires)', p_png_base64: png(1920, 1080, [200, 30, 30, 255]), p_overlay: false, p_expires_at: new Date(Date.now() + 6000).toISOString(), p_source: 'County OES', p_transition: 'cut' })).data;
const S2 = (await U.producer.c.from('broadcast_sessions').select('version').eq('id', sessionId).single()).data;
const pub = await U.producer.c.rpc('bc_publish', { p_session: sessionId, p_revision: rx.id, p_mode: 'update', p_expected_version: S2.version });
check('time-limited graphic published', !pub.error, pub.error && pub.error.message);
check('B: shows it while valid', await waitOut(B, rid => window.__nwttOutput.shownRevision === rid, rx.id));
check('B: hides it at its expiry time — never shown as current after that', await waitOut(B, () => window.__nwttOutput.shownRevision === null && /expired/.test(window.__nwttOutput.hiddenReason || ''), null, 12000), await out(B));
await A.page.waitForFunction(() => /EXPIRED/.test(document.getElementById('liveSession').innerText), null, { timeout: 15000 }).catch(() => {});
check('A: console flags the live graphic as EXPIRED', /EXPIRED/.test(await A.page.innerText('#liveSession')));

// ---------------- output token revocation (UI)
await A.page.click('#liveOutputs [data-revoke]'); await confirmDlg(A.page, 'Revoke');
check('B: revoked output stops (status revoked, nothing shown)', await waitOut(B, () => window.__nwttOutput.status === 'revoked' && !document.querySelector('#stage img'), null, 15000), await out(B));

// ---------------- control transfer (UI) and audit
await A.page.selectOption('#transferTo', U.producer2.id); await A.page.click('#transferBtn'); await confirmDlg(A.page, 'Transfer');
await A.page.waitForFunction(() => /producer2/.test(document.getElementById('liveController').textContent), null, { timeout: 15000 }).catch(() => {});
check('A: control transferred to producer2; A can no longer clear', /producer2/.test(await A.page.innerText('#liveController')) && await A.page.isDisabled('#clearLive'));
const tc = Date.now(); await Cc.page.waitForFunction(() => !document.getElementById('clearLive').disabled, null, { timeout: 30000 }).catch(() => {}); console.log('    (C saw the transfer after ' + ((Date.now() - tc) / 1000).toFixed(1) + ' s)');
check('C: producer2 now has the controls (Realtime update on another computer)', !(await Cc.page.isDisabled('#clearLive')), await Cc.ev(() => { const st = NS.Live.debug && NS.Live.debug.state.session; return { hash: location.hash, ctl: st && st.controller_id, me: NS.Cloud.user.id, ver: st && st.version, live: st && st.live_revision_id, status: st && st.status, conn: document.getElementById('liveConn') && document.getElementById('liveConn').textContent, dialogs: document.querySelectorAll('dialog').length, clear: document.getElementById('clearLive') && document.getElementById('clearLive').disabled }; }));
const audit = (await U.admin.c.from('audit_log').select('action').eq('session_id', sessionId)).data.map(x => x.action);
check('audit trail has preview, take, update, clear, rollback, revoke and transfer', ['graphic.preview', 'live.take', 'live.update', 'live.clear', 'live.rollback', 'output.revoke', 'control.transfer'].every(a => audit.includes(a)), audit);

// ---------------- shared projects: explicit migration, sync, offline draft
await A.page.goto(SITE + 'index.html#/shared'); await A.page.waitForSelector('#migrateBtn'); await A.page.click('#migrateBtn');
await A.page.check('#migrateList input[data-name="NWTT Source Attribution"]'); await confirmDlg(A.page, 'Upload selected'); await A.page.waitForTimeout(1500);
const linked = await A.ev(async id => { const p = await NS.Store.get('projects', id); return p && p.cloud; }, srcProject);
check('migration uploads only the ticked project and keeps the local copy, now linked', !!(linked && linked.id) && (await A.ev(async () => (await NS.Store.all('projects')).filter(p => !p.cloud).length)) >= 1, linked);
const cloudId = linked.id;
await A.page.goto(SITE + 'index.html#/edit/' + srcProject); await A.page.waitForSelector('#workspace canvas'); await A.page.waitForTimeout(800);
await A.ev(() => { const e = NS.App.editor.ed; e.p.fields.source = 'NIFC'; e.applyFields(); e.commit(); }); await A.page.click('#saveBtn');
check('editor: shared project saves to the cloud with a new version', await A.page.waitForFunction(() => /Cloud: saved v2/.test(document.getElementById('cloudSync').textContent), null, { timeout: 15000 }).then(() => true, () => false), await A.page.innerText('#cloudSync').catch(() => ''));
await A.ctx.setOffline(true);
await A.ev(() => { const e = NS.App.editor.ed; e.p.fields.source = 'NIFC / CAL FIRE'; e.applyFields(); e.commit(); }); await A.page.click('#saveBtn'); await A.page.waitForTimeout(800);
check('offline: change kept as a local draft, clearly reported', /offline/.test(await A.page.innerText('#cloudSync')), await A.page.innerText('#cloudSync'));
await A.ctx.setOffline(false); await back(A); await A.page.waitForTimeout(500);
await A.ev(() => window.dispatchEvent(new Event('online'))); await A.page.waitForTimeout(4000);
const row = (await U.viewer.c.from('projects').select('version,data').eq('id', cloudId).single()).data;
check('reconnect: offline draft synced to the cloud (seen from another account)', row.version === 3 && row.data.fields.source === 'NIFC / CAL FIRE', { v: row.version, s: row.data.fields.source });

// Computer C opens the shared project (different browser): same content
await Cc.page.goto(SITE + 'index.html#/shared'); await Cc.page.waitForSelector(`[data-cloud="${cloudId}"]`);
await Cc.page.click(`[data-cloud="${cloudId}"] >> text=Open`); await Cc.page.waitForSelector('#workspace canvas'); await Cc.page.waitForTimeout(800);
check('C: opens the shared project made on A with the latest content', await Cc.ev(() => NS.App.editor.ed.p.fields.source) === 'NIFC / CAL FIRE');

// ---------------- incident detection integration (mock incident data, verified sources only)
const facts = await A.ev(() => { const now = Date.now(); return NS.Live.incidentFacts({ key: 'k', name: 'Mock Fire', county: 'Test', state: 'CA', sources: ['wfigs', 'calfire', 'ipaws', 'social'],
  fires: [{ src: 'wfigs', acres: 1200, contained: 10, updated: now - 3600e3 }, { src: 'calfire', acres: 1500, contained: 15, updated: now - 600e3 }],
  evac: [{ src: 'ipaws', status: 'Evacuation Order', headline: 'Evacuate now', updated: now - 7200e3 }], social: [{ src: 'bluesky', text: '5000 acres!!' }] }); });
check('incident graphic uses the agency record and names it (CAL FIRE)', /1,500 ac \(CAL FIRE\)/.test(facts.fields.acres) && /15% \(CAL FIRE\)/.test(facts.fields.containment), facts.fields);
check('incident graphic keeps the source timestamp as "as of"', !!facts.fields.asOf && facts.sourceTime > 0);
check('IPAWS evacuation is labeled as a delayed archive, never real-time', /archive, delayed/.test(facts.fields.evac) && facts.ipaws === true, facts.fields.evac);
check('social posts are never used', !JSON.stringify(facts).includes('5000') && !facts.sources.some(s => /bluesky|social/i.test(s)), facts.sources);

// ---------------- viewer: no publishing UI and no server access
const V = await computer('V'); await signIn(V, 'viewer'); await V.page.goto(SITE + 'index.html#/live');
await V.page.waitForTimeout(1500);
check('viewer cannot create sessions', !(await V.page.isVisible('#createSession')));
const vTry = await V.ev(async id => (await NS.Cloud.client.rpc('bc_issue_output_token', { p_session: id, p_label: 'x' })).error?.message, sessionId);
check('viewer cannot create OBS outputs (server refuses)', !!vTry, vTry);

// ---------------- ending the session revokes outputs and blocks publishing
const B2url = await (async () => { const r = await U.producer2.c.rpc('bc_issue_output_token', { p_session: sessionId, p_label: 'second' }); return SITE + 'broadcast/output.html#t=' + r.data.token; })();
const B2 = await computer('B2', { viewport: { width: 1920, height: 1080 } }); await B2.page.goto(B2url); await waitOut(B2, () => /rendered|idle/.test(window.__nwttOutput.status));
await Cc.page.goto(SITE + 'index.html#/live/' + sessionId); await Cc.page.waitForSelector('[data-status="ended"]');
await Cc.page.click('[data-status="ended"]'); await confirmDlg(Cc.page, 'End session');
check('ending the session stops its outputs immediately', await waitOut(B2, () => /ended|revoked/.test(window.__nwttOutput.status) && !document.querySelector('#stage img'), null, 15000), await out(B2));

// ---------------- pending approval (administrator UI) and Request access
const { admin: svc } = await import('./env.mjs');
const pend = await svc.auth.admin.createUser({ email: 'newperson.' + tag + '@test.nwtt.local', password: PASSWORD, email_confirm: true });
const pend2 = await svc.auth.admin.createUser({ email: 'stranger.' + tag + '@test.nwtt.local', password: PASSWORD, email_confirm: true });
const AD = await computer('AD'); await signIn(AD, 'admin');
await AD.page.waitForSelector('#pendingChip', { timeout: 15000 }).catch(() => {});
check('admin: top bar shows how many accounts are pending approval', /\d+ pending approval/i.test(await AD.page.innerText('#cloudChip')), await AD.page.innerText('#cloudChip'));
await AD.page.goto(SITE + 'index.html#/team'); await AD.page.waitForSelector('#pendingTable');
check('admin: Pending approval lists the new accounts', await AD.page.isVisible(`[data-pending="newperson.${tag}@test.nwtt.local"]`) && await AD.page.isVisible(`[data-pending="stranger.${tag}@test.nwtt.local"]`));
await AD.page.selectOption(`[data-pending="newperson.${tag}@test.nwtt.local"] select`, 'editor'); await AD.page.click(`[data-approve-user="newperson.${tag}@test.nwtt.local"]`); await confirmDlg(AD.page, 'Approve');
await AD.page.waitForSelector('#teamTable'); await AD.page.waitForTimeout(800);
const np = (await svc.from('org_members').select('role,active').eq('user_id', pend.data.user.id).single()).data;
check('admin: Approve gives the chosen role (Graphics Editor)', np && np.role === 'editor' && np.active, np);
await AD.page.click(`[data-decline-user="stranger.${tag}@test.nwtt.local"]`); await confirmDlg(AD.page, 'Decline'); await AD.page.waitForTimeout(800);
const st2 = (await svc.from('org_members').select('role,active').eq('user_id', pend2.data.user.id).single()).data;
check('admin: Decline leaves the account without access', st2 && st2.active === false, st2);
check('admin: both left the pending list', !(await AD.page.isVisible(`[data-pending="newperson.${tag}@test.nwtt.local"]`)) && !(await AD.page.isVisible(`[data-pending="stranger.${tag}@test.nwtt.local"]`)));
const PV = await computer('PV'); await PV.page.goto(SITE + 'index.html#/dashboard'); await PV.page.waitForSelector('#signInBtn', { timeout: 15000 });
await PV.page.click('#signInBtn'); await PV.page.fill('#loginEmail', 'self.' + tag + '@test.nwtt.local'); await PV.page.fill('#loginPassword', PASSWORD);
await PV.page.click('dialog[aria-label="Sign in"] button:has-text("Request access")'); await PV.page.waitForFunction(() => !/Requesting/.test(document.getElementById('loginMsg').textContent), null, { timeout: 15000 });
check('Request access explains when self sign-up is turned off', /Self sign-up is turned off/.test(await PV.page.innerText('#loginMsg')), await PV.page.innerText('#loginMsg'));
await PV.page.fill('#loginEmail', U.outsider.email); await PV.page.fill('#loginPassword', PASSWORD); await confirmDlg(PV.page, 'Sign in'); await PV.page.waitForTimeout(1500);
check('signed-in account without a role is told it is waiting for approval', /waiting for an administrator/.test(await PV.page.innerText('#loginMsg')), await PV.page.innerText('#loginMsg'));
const ex2 = await PV.ev(async () => [(await NS.Cloud.client.from('projects').select('id')).data.length, (await NS.Cloud.client.rpc('gs_pending_accounts')).error ? 'denied' : 'allowed']);
check('unapproved account sees nothing and cannot list pending accounts', ex2[0] === 0 && ex2[1] === 'denied', ex2);

// ---------------- resilience: cloud unreachable / not configured / secret key
const D = await b.newContext({ viewport: { width: 1400, height: 900 } });
await D.route('**/config.json', async r => { const res = await r.fetch(); const j = await res.json(); j.supabase = { url: 'http://127.0.0.1:9', anonKey: ANON }; r.fulfill({ response: res, json: j }); });
const dp = await D.newPage(); await dp.goto(SITE + 'index.html#/dashboard'); await dp.waitForSelector('#nav a'); await dp.waitForTimeout(2500);
check('cloud unreachable: Studio still loads and local editing works', await dp.evaluate(async () => { await NS.App.newBlank(1920, 1080); await new Promise(r => setTimeout(r, 1500)); return !!document.querySelector('#workspace canvas'); }));
await dp.goto(SITE + 'index.html#/live'); await dp.waitForTimeout(1500);
check('cloud unreachable: Live Broadcast Control says so and offers the PNG fallback', /unreachable|Sign in/.test(await dp.innerText('main')) && await dp.isVisible('text=Download fallback holding cards'), await dp.innerText('main'));
const E = await b.newContext(); await E.route('**/config.json', async r => { const res = await r.fetch(); const j = await res.json(); delete j.supabase; r.fulfill({ response: res, json: j }); }); const ep = await E.newPage(); await ep.goto(SITE + 'index.html#/live'); await ep.waitForSelector('#nav a', { state: 'attached' }); await ep.waitForTimeout(1000);
check('no cloud configured: Live Broadcast Control explains it and keeps the Phase 1 PNG workflow', /needs the shared cloud/.test(await ep.innerText('main')) && !(await ep.isVisible('#cloudChip')));
check('a service-role key in config.json is refused by the browser', await ep.evaluate(sk => NS.Cloud.safeConfig({ url: 'https://x.supabase.co', anonKey: sk }) === 'secret' && NS.Cloud.safeConfig({ url: 'https://x.supabase.co', anonKey: 'sb_secret_abc' }) === 'secret', (await import('./env.mjs')).SERVICE));
await D.close(); await E.close();

console.log(errs.length ? 'page errors:\n' + errs.join('\n') : 'no page errors');
check('no page errors on any computer', errs.length === 0, errs);
const f = summary(); await b.close(); process.exit(f ? 1 : 0);
