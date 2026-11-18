/* Phase 2 backend: authentication, roles, RLS and broadcast-control RPCs against a local Supabase stack. */
import { users, admin, anonClient, png, check, summary, errOf } from './env.mjs';
const tag = 'b' + Date.now().toString(36);
console.log('Phase 2 backend (RLS + broadcast control) — users tagged', tag);
const U = await users(tag);
const anon = anonClient();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rpc = (u, fn, args) => (u ? U[u].c : anon).rpc(fn, args);
const OVER = png(1920, 1080, [242, 69, 61, 0]), FULL = png(1920, 1080, [26, 34, 48, 255]);

// ---------- authentication and membership
let r = await rpc('viewer', 'gs_me'); check('gs_me reports the member role', r.data && r.data.role === 'viewer', r);
r = await rpc('outsider', 'gs_me'); check('account without membership has no role', r.data && r.data.role === null, r.data);
for (const t of ['projects', 'broadcast_sessions', 'audit_log', 'output_tokens', 'org_members', 'render_images', 'broadcast_revisions']) {
  r = await anon.from(t).select('*').limit(1); check('anonymous users read nothing from ' + t, !!r.error || r.data.length === 0, r.error && r.error.code);
}
r = await U.outsider.c.from('org_members').select('*'); check('non-member sees no member list', !r.error && r.data.length === 0, r);
r = await rpc('producer', 'gs_set_member', { p_email: U.viewer.email, p_role: 'admin' }); check('only administrators can change roles', !!r.error, r.data);
r = await rpc('admin', 'gs_set_member', { p_email: U.outsider.email, p_role: 'viewer', p_active: false }); check('administrator can add a member (inactive)', !r.error, errOf(r));
r = await rpc('outsider', 'gs_me'); check('inactive member has no role', r.data.role === null, r.data);
const admins = (await admin.from('org_members').select('user_id').eq('role', 'admin').eq('active', true)).data.length;
if (admins === 1) { r = await rpc('admin', 'gs_set_member', { p_email: U.admin.email, p_role: 'viewer' }); check('cannot demote the last active administrator', /last active administrator/.test(errOf(r) || ''), errOf(r)); }

// ---------- shared projects
const proj = { canvas: { w: 1920, h: 1080, bg: { transparent: true, color: '#00000000' } }, objects: [], fields: { title: 'T' } };
r = await U.viewer.c.from('projects').insert({ name: 'viewer project', data: proj }).select(); check('viewer cannot create projects', !!r.error, r.data);
r = await U.outsider.c.from('projects').insert({ name: 'x', data: proj }).select(); check('non-member cannot create projects', !!r.error);
r = await U.editor.c.from('projects').insert({ name: 'Shared ' + tag, data: proj, save_kind: 'manual' }).select().single();
check('editor creates a cloud project (version 1, owned by editor)', !r.error && r.data.version === 1 && r.data.owner_id === U.editor.id, errOf(r));
const P = r.data;
r = await U.viewer.c.from('projects').select('id,name').eq('id', P.id); check('viewer can read shared projects', r.data && r.data.length === 1);
r = await U.viewer.c.from('projects').update({ name: 'hacked' }).eq('id', P.id).select(); check('viewer cannot edit', !r.error ? r.data.length === 0 : true);
r = await U.editor2.c.from('projects').update({ data: { ...proj, fields: { title: 'by editor2' } } }).eq('id', P.id).eq('version', 1).select().single();
check('another editor can edit when "team can edit" is on (version 2)', !r.error && r.data.version === 2, errOf(r));
r = await U.editor.c.from('projects').update({ name: 'stale write' }).eq('id', P.id).eq('version', 1).select();
check('stale write (old version) changes nothing: optimistic concurrency', !r.error && r.data.length === 0, r);
await U.editor.c.from('projects').update({ team_can_edit: false }).eq('id', P.id);
r = await U.editor2.c.from('projects').update({ name: 'blocked' }).eq('id', P.id).select(); check('owner can lock editing to themself', !r.error && r.data.length === 0, r);
r = await U.editor.c.from('projects').update({ approval: 'approved' }).eq('id', P.id).select(); check('editor cannot approve for broadcast', !!r.error, r.data);
r = await U.editor.c.from('projects').update({ approval: 'submitted' }).eq('id', P.id).select().single(); check('editor submits for approval', !r.error && r.data.approval === 'submitted', errOf(r));
r = await U.producer.c.from('projects').update({ approval: 'approved' }).eq('id', P.id).select(); check('producer cannot edit a locked project directly', !r.error && r.data.length === 0, r);
r = await rpc('editor', 'gs_set_approval', { p_project: P.id, p_approval: 'approved' }); check('editor cannot use the approval function', !!r.error);
r = await rpc('producer', 'gs_set_approval', { p_project: P.id, p_approval: 'approved' }); check('producer approves (approved_by recorded)', !r.error && r.data.approval === 'approved' && r.data.approved_by === U.producer.id, errOf(r));
r = await U.editor.c.from('projects').update({ data: { ...proj, fields: { title: 'changed after approval' } }, save_kind: 'manual' }).eq('id', P.id).select().single();
check('editing an approved graphic sends it back to draft', !r.error && r.data.approval === 'draft', r.data && r.data.approval);
r = await U.viewer.c.from('project_revisions').select('version,save_kind').eq('project_id', P.id).order('version');
check('saved revisions are kept (manual saves always)', r.data && r.data.length >= 2 && r.data.some(x => x.save_kind === 'manual'), r.data);
await U.editor.c.from('projects').update({ team_can_edit: true }).eq('id', P.id);
r = await U.producer.c.from('projects').update({ owner_id: U.producer.id }).eq('id', P.id).select(); check('only an administrator can change a project owner', !!r.error, r.data);

// ---------- shared templates and assets
r = await U.editor.c.from('templates').insert({ name: 'Org template ' + tag, w: 1920, h: 1080, data: proj }).select().single(); check('editor shares a template', !r.error, errOf(r));
const T = r.data;
r = await U.viewer.c.from('templates').insert({ name: 'v', w: 1920, h: 1080, data: proj }).select(); check('viewer cannot add templates', !!r.error);
r = await U.editor2.c.from('templates').delete().eq('id', T.id).select(); check("editor cannot delete another editor's template", !r.error && r.data.length === 0, r);
const pngBytes = Buffer.from(png(16, 16, [1, 2, 3, 255]), 'base64');
r = await U.editor.c.storage.from('graphics-assets').upload(U.editor.id + '/logo-' + tag + '.png', pngBytes, { contentType: 'image/png' }); check('editor uploads an asset to their own folder', !r.error, errOf(r));
r = await U.editor.c.storage.from('graphics-assets').upload(U.editor2.id + '/x-' + tag + '.png', pngBytes, { contentType: 'image/png' }); check("upload into another user's folder is refused", !!r.error);
r = await U.editor.c.storage.from('graphics-assets').upload(U.editor.id + '/evil-' + tag + '.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), { contentType: 'image/svg+xml' }); check('SVG uploads are refused (scriptable)', !!r.error);
r = await U.viewer.c.storage.from('graphics-assets').upload(U.viewer.id + '/v-' + tag + '.png', pngBytes, { contentType: 'image/png' }); check('viewer cannot upload assets', !!r.error);
r = await U.viewer.c.storage.from('graphics-assets').download(U.editor.id + '/logo-' + tag + '.png'); check('members can download shared assets', !r.error && r.data && r.data.size === pngBytes.length, errOf(r));
r = await anon.storage.from('graphics-assets').download(U.editor.id + '/logo-' + tag + '.png'); check('anonymous users cannot download assets', !!r.error);
r = await U.editor.c.from('assets').insert({ name: 'logo', mime: 'image/png', bytes: pngBytes.length, w: 16, h: 16, storage_path: U.editor.id + '/logo-' + tag + '.png' }).select().single(); check('asset record created', !r.error, errOf(r));
r = await U.editor.c.from('assets').insert({ name: 'x', mime: 'image/svg+xml', bytes: 10, storage_path: U.editor.id + '/x.svg' }); check('asset table rejects SVG', !!r.error);

// ---------- broadcast sessions
r = await rpc('editor', 'bc_create_session', { p_title: 'nope' }); check('graphics editor cannot create a broadcast session', !!r.error);
r = await rpc('producer', 'bc_create_session', { p_title: 'Test Fire coverage ' + tag, p_type: 'wildfire', p_incident_name: 'Test Fire', p_broadcaster: U.broadcaster.id });
check('producer creates a session (controller = producer, status ready)', !r.error && r.data.controller_id === U.producer.id && r.data.status === 'ready', errOf(r));
let S = r.data;
r = await U.broadcaster.c.from('broadcast_sessions').select('id').eq('id', S.id); check('assigned broadcaster sees the session', r.data && r.data.length === 1);
r = await U.editor2.c.from('broadcast_sessions').select('id').eq('id', S.id); check('unassigned editor does not see the session', r.data && r.data.length === 0);
r = await U.producer.c.from('broadcast_sessions').update({ title: 'direct' }).eq('id', S.id).select(); check('sessions cannot be changed except through control functions', !!r.error || r.data.length === 0);

// preview validation
r = await rpc('producer', 'bc_create_preview', { p_session: S.id, p_name: 'bad', p_png_base64: Buffer.from('not a png').toString('base64'), p_overlay: true }); check('preview rejects non-PNG data', /PNG/.test(errOf(r) || ''), errOf(r));
r = await rpc('producer', 'bc_create_preview', { p_session: S.id, p_name: 'small', p_png_base64: png(1280, 720), p_overlay: true }); check('preview rejects sizes other than 1920×1080', /1920×1080/.test(errOf(r) || ''), errOf(r));
r = await rpc('editor2', 'bc_create_preview', { p_session: S.id, p_name: 'x', p_png_base64: OVER, p_overlay: true }); check('editor outside the session cannot send to preview', !!r.error);
await rpc('producer', 'bc_add_member', { p_session: S.id, p_user: U.editor.id, p_role: 'editor', p_expected_version: S.version });
r = await rpc('editor', 'bc_create_preview', { p_session: S.id, p_name: 'unapproved', p_png_base64: OVER, p_overlay: true }); check('session editor cannot preview an arbitrary (non-project) graphic', /approved shared projects/.test(errOf(r) || ''), errOf(r));
r = await rpc('editor', 'bc_create_preview', { p_session: S.id, p_name: 'draft', p_png_base64: OVER, p_overlay: true, p_project: P.id }); check('session editor cannot preview an unapproved project', /approved/.test(errOf(r) || ''), errOf(r));
await rpc('producer', 'gs_set_approval', { p_project: P.id, p_approval: 'approved' });
r = await rpc('editor', 'bc_create_preview', { p_session: S.id, p_name: 'approved', p_png_base64: OVER, p_overlay: true, p_project: P.id }); check('session editor can preview an approved project', !r.error, errOf(r));
r = await rpc('editor', 'bc_publish', { p_session: S.id, p_revision: r.data && r.data.id, p_mode: 'take', p_expected_version: 0 }); check('graphics editor can never publish', !!r.error);
S = (await U.producer.c.from('broadcast_sessions').select('*').eq('id', S.id).single()).data;
r = await rpc('producer', 'bc_create_preview', { p_session: S.id, p_name: 'Wildfire fact panel', p_png_base64: OVER, p_overlay: true, p_category: 'safety', p_source: 'NIFC', p_source_time: new Date().toISOString(), p_expires_at: new Date(Date.now() + 3600e3).toISOString(), p_stale_after_s: 300 });
check('producer previews a rendered graphic', !r.error && r.data.overlay === true, errOf(r));
const R1 = r.data;
S = (await U.producer.c.from('broadcast_sessions').select('*').eq('id', S.id).single()).data;
check('preview does not change what is live', S.live_revision_id === null && S.live_seq === 0 && S.preview_revision_id === R1.id, S);

// output token + anonymous output access
r = await rpc('editor', 'bc_issue_output_token', { p_session: S.id, p_label: 'x' }); check('graphics editor cannot create OBS outputs', !!r.error);
r = await rpc('broadcaster', 'bc_issue_output_token', { p_session: S.id, p_label: 'Studio B OBS', p_ttl_hours: 12 }); check('assigned broadcaster creates an OBS output', !r.error && /^[0-9a-f]{64}$/.test(r.data.token), errOf(r));
const TOK = r.data;
r = await admin.from('output_tokens').select('token_hash').eq('id', TOK.id).single(); check('only the token hash is stored', r.data.token_hash !== TOK.token && r.data.token_hash.length === 64);
r = await rpc(null, 'bc_output_state', { p_token: TOK.token }); check('output sees nothing live before Take Live', r.data.ok && r.data.live === null && r.data.seq === 0, r.data);
r = await rpc(null, 'bc_output_image', { p_token: TOK.token, p_revision: R1.id }); check('output cannot fetch a preview (not public)', !!r.error);
r = await rpc(null, 'bc_output_state', { p_token: 'f'.repeat(64) }); check('unknown token is refused', r.data.ok === false && r.data.reason === 'invalid');
r = await rpc(null, 'bc_publish', { p_session: S.id, p_revision: R1.id, p_mode: 'take', p_expected_version: S.version }); check('output (anonymous) cannot publish', !!r.error);

// realtime nudge to the output channel
const chanName = (await rpc(null, 'bc_output_state', { p_token: TOK.token })).data.channel;
const rt = anonClient(); const nudges = [];
const ch = rt.channel(chanName).on('broadcast', { event: 'live' }, m => nudges.push(m.payload)); await new Promise(res => ch.subscribe(st => st === 'SUBSCRIBED' && res())); await sleep(300);

// Take Live
r = await rpc('producer2', 'bc_publish', { p_session: S.id, p_revision: R1.id, p_mode: 'take', p_expected_version: S.version }); check('a producer who is not the controller cannot take live', /not the controller/.test(errOf(r) || ''), errOf(r));
r = await rpc('producer', 'bc_publish', { p_session: S.id, p_revision: R1.id, p_mode: 'take', p_expected_version: S.version - 1 }); check('stale expected version is refused (version_conflict)', /version_conflict/.test(errOf(r) || ''), errOf(r));
r = await rpc('producer', 'bc_publish', { p_session: S.id, p_revision: R1.id, p_mode: 'take', p_expected_version: S.version });
check('controller takes the graphic live (seq 1, status live)', !r.error && r.data.live_seq === 1 && r.data.live_revision_id === R1.id && r.data.status === 'live', errOf(r));
S = r.data;
await sleep(1500); check('Realtime nudge reaches the output channel with the new seq', nudges.some(n => n.seq === 1), nudges);
r = await rpc(null, 'bc_output_state', { p_token: TOK.token, p_rendered_seq: 0, p_status: 'loading' }); check('output state shows the live revision', r.data.live && r.data.live.revision === R1.id && r.data.live.overlay === true && r.data.seq === 1, r.data);
r = await rpc(null, 'bc_output_image', { p_token: TOK.token, p_revision: R1.id }); check('output fetches exactly the approved PNG', r.data === OVER);
await rpc(null, 'bc_output_state', { p_token: TOK.token, p_rendered_seq: 1, p_status: 'rendered' });
r = await U.producer.c.from('output_tokens').select('last_rendered_seq,last_status,last_seen_at').eq('id', TOK.id).single(); check('console sees output health (rendered seq 1)', r.data.last_rendered_seq === 1 && r.data.last_status === 'rendered' && !!r.data.last_seen_at, r.data);
r = await rpc('producer', 'bc_publish', { p_session: S.id, p_revision: R1.id, p_mode: 'take', p_expected_version: S.version }); check('Take Live refused while something is live (use Update Live)', /Update Live/.test(errOf(r) || ''));

// Update Live, concurrency, rollback
const R2 = (await rpc('producer', 'bc_create_preview', { p_session: S.id, p_name: 'Starting soon', p_png_base64: FULL, p_overlay: false, p_transition: 'cut' })).data;
S = (await U.producer.c.from('broadcast_sessions').select('*').eq('id', S.id).single()).data;
const [a, b] = await Promise.all([
  rpc('producer', 'bc_publish', { p_session: S.id, p_revision: R2.id, p_mode: 'update', p_expected_version: S.version }),
  rpc('producer', 'bc_publish', { p_session: S.id, p_revision: R2.id, p_mode: 'update', p_expected_version: S.version })]);
check('two simultaneous updates with the same version: exactly one succeeds', [a, b].filter(x => !x.error).length === 1 && [a, b].some(x => /version_conflict/.test(errOf(x) || '')), [errOf(a), errOf(b)]);
S = (a.error ? b : a).data; check('Update Live replaced the graphic (seq 2)', S.live_revision_id === R2.id && S.live_seq === 2);
r = await rpc(null, 'bc_output_image', { p_token: TOK.token, p_revision: R1.id }); check('output can no longer fetch the replaced graphic', !!r.error);
const R3 = (await rpc('producer', 'bc_create_preview', { p_session: S.id, p_name: 'never live', p_png_base64: OVER, p_overlay: true })).data;
S = (await U.producer.c.from('broadcast_sessions').select('*').eq('id', S.id).single()).data;
r = await rpc('producer', 'bc_publish', { p_session: S.id, p_revision: R3.id, p_mode: 'rollback', p_expected_version: S.version }); check('rollback only to a graphic that was previously live', !!r.error);
r = await rpc('producer', 'bc_publish', { p_session: S.id, p_revision: R1.id, p_mode: 'rollback', p_expected_version: S.version }); check('rollback to the previous approved graphic', !r.error && r.data.live_revision_id === R1.id && r.data.live_seq === 3, errOf(r));
S = r.data;

// Clear
r = await rpc('producer', 'bc_clear', { p_session: S.id, p_expected_version: S.version }); check('Clear Graphic empties the output (seq 4)', !r.error && r.data.live_revision_id === null && r.data.live_seq === 4, errOf(r));
S = r.data;
r = await rpc(null, 'bc_output_state', { p_token: TOK.token }); check('output sees the cleared state', r.data.live === null && r.data.seq === 4);

// Control transfer
r = await rpc('producer2', 'bc_transfer_control', { p_session: S.id, p_to: U.producer2.id, p_expected_version: S.version }); check('producer cannot seize control from another producer', !!r.error);
r = await rpc('producer', 'bc_transfer_control', { p_session: S.id, p_to: U.editor.id, p_expected_version: S.version }); check('control can only go to a producer or administrator', !!r.error);
r = await rpc('producer', 'bc_transfer_control', { p_session: S.id, p_to: U.producer2.id, p_expected_version: S.version }); check('controller transfers control to producer2', !r.error && r.data.controller_id === U.producer2.id, errOf(r));
S = r.data;
r = await rpc('producer', 'bc_publish', { p_session: S.id, p_revision: R1.id, p_mode: 'take', p_expected_version: S.version }); check('former controller can no longer publish', !!r.error);
r = await rpc('admin', 'bc_transfer_control', { p_session: S.id, p_to: U.admin.id, p_expected_version: S.version }); check('administrator can override control (audited)', !r.error && r.data.controller_id === U.admin.id, errOf(r));
S = r.data;

// Expiry
const RX = (await rpc('admin', 'bc_create_preview', { p_session: S.id, p_name: 'Evacuation list', p_png_base64: FULL, p_overlay: false, p_expires_at: new Date(Date.now() + 2500).toISOString(), p_source: 'County OES' })).data;
S = (await U.admin.c.from('broadcast_sessions').select('*').eq('id', S.id).single()).data;
r = await rpc('admin', 'bc_publish', { p_session: S.id, p_revision: RX.id, p_mode: 'take', p_expected_version: S.version }); check('time-limited graphic goes live', !r.error, errOf(r)); S = r.data || S;
r = await rpc(null, 'bc_output_state', { p_token: TOK.token }); check('output gets the expiry time', r.data.live && !!r.data.live.expires_at);
await sleep(3200);
r = await rpc(null, 'bc_output_state', { p_token: TOK.token }); check('after expiry the server stops serving it (never shown as current)', r.data.live === null && r.data.expired === true, r.data);
r = await rpc('admin', 'bc_clear', { p_session: S.id, p_expected_version: S.version }); S = r.data;
r = await rpc('admin', 'bc_publish', { p_session: S.id, p_revision: RX.id, p_mode: 'rollback', p_expected_version: S.version }); check('expired graphic cannot be published again', /expired/.test(errOf(r) || ''), errOf(r));
r = await rpc('admin', 'bc_create_preview', { p_session: S.id, p_name: 'x', p_png_base64: FULL, p_overlay: false, p_expires_at: new Date(Date.now() - 1000).toISOString() }); check('expiry in the past is refused', !!r.error);

// Token revocation and renewal
r = await rpc('producer2', 'bc_output_token_admin', { p_token_id: TOK.id, p_action: 'extend', p_hours: 24 }); check('non-controller producer cannot renew someone else\'s output', !!r.error);
r = await rpc('admin', 'bc_output_token_admin', { p_token_id: TOK.id, p_action: 'extend', p_hours: 24 }); check('output access can be renewed', !r.error && new Date(r.data.expires_at) > new Date(Date.now() + 23 * 3600e3), errOf(r));
r = await rpc('admin', 'bc_output_token_admin', { p_token_id: TOK.id, p_action: 'revoke' }); check('output token revoked', !r.error && !!r.data.revoked_at);
r = await rpc(null, 'bc_output_state', { p_token: TOK.token }); check('revoked output gets no state', r.data.ok === false && r.data.reason === 'revoked', r.data);
r = await rpc('admin', 'bc_output_token_admin', { p_token_id: TOK.id, p_action: 'extend', p_hours: 2 }); check('a revoked output cannot be renewed', !!r.error);

// Rate limit on the output endpoint
const T2 = (await rpc('admin', 'bc_issue_output_token', { p_session: S.id, p_label: 'rate test' })).data;
const burst = []; for (let i = 0; i < 10; i++) burst.push(...await Promise.all(Array.from({ length: 25 }, () => rpc(null, 'bc_output_state', { p_token: T2.token }))));
check('output endpoint is rate-limited per token (240/min)', burst.filter(x => x.error && /rate_limited/.test(errOf(x))).length >= 5, burst.filter(x => x.error).length);

// Ending the session
const T3 = (await rpc('admin', 'bc_issue_output_token', { p_session: S.id, p_label: 'end test' })).data;
S = (await U.admin.c.from('broadcast_sessions').select('*').eq('id', S.id).single()).data;
r = await rpc('admin', 'bc_set_status', { p_session: S.id, p_status: 'ended', p_expected_version: S.version }); check('session ended', !r.error && r.data.status === 'ended', errOf(r)); S = r.data;
r = await rpc(null, 'bc_output_state', { p_token: T3.token }); check('ending a session revokes its OBS outputs', r.data.ok === false, r.data);
r = await rpc('admin', 'bc_publish', { p_session: S.id, p_revision: R1.id, p_mode: 'take', p_expected_version: S.version }); check('nothing can be published to an ended session', /ended/.test(errOf(r) || ''));
r = await rpc('admin', 'bc_issue_output_token', { p_session: S.id, p_label: 'late' }); check('no new outputs for an ended session', !!r.error);

// Audit trail
r = await U.producer.c.from('audit_log').select('action').eq('session_id', S.id);
const acts = new Set((r.data || []).map(x => x.action));
check('audit log records publish, update, rollback, clear, transfer, override, revoke, end', ['live.take', 'live.update', 'live.rollback', 'live.clear', 'control.transfer', 'control.override', 'output.revoke', 'session.ended', 'graphic.preview', 'output.issue'].every(a => acts.has(a)), [...acts]);
r = await U.editor2.c.from('audit_log').select('id').eq('session_id', S.id); check('audit entries of other sessions are hidden from unassigned editors', r.data.length === 0);
r = await U.producer.c.from('audit_log').insert({ action: 'fake' }).select(); check('audit log cannot be written directly', !!r.error);
r = await U.producer.c.from('live_events').select('seq,action').eq('session_id', S.id).order('seq'); check('live history is complete and ordered', r.data.map(x => x.action).join(',') === 'take,update,rollback,clear,take,clear,end', r.data.map(x => x.action));

await rt.removeAllChannels();
const f = summary(); process.exit(f ? 1 : 0);
