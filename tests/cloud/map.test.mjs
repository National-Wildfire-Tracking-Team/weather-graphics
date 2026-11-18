/* Phase 3 backend: live broadcast map state, presets and map-scoped OBS outputs (local Supabase stack). */
import { users, anonClient, check, summary, errOf } from './env.mjs';
const tag = 'm' + Date.now().toString(36);
console.log('Phase 3 backend (broadcast map) — users tagged', tag);
const U = await users(tag);
const anon = anonClient();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rpc = (u, fn, args) => (u ? U[u].c : anon).rpc(fn, args);
const state = (over = {}) => Object.assign({ v: 1, camera: { center: [-120.5, 38.6], zoom: 7, bearing: 0, pitch: 0 }, tab: 'wildfire', basemap: 'satellite',
  layers: { incidentLocations: true, weatherAlerts: true }, radar: { product: 'reflectivity', playing: false, frameMs: 450, frameId: null, opacity: 0.8 },
  annotations: { type: 'FeatureCollection', features: [] } }, over);

let r = await rpc('producer', 'bc_create_session', { p_title: 'Map test ' + tag, p_type: 'severe', p_broadcaster: U.broadcaster.id });
const S = r.data; check('session created', !r.error, errOf(r));

// read access
r = await U.producer.c.from('broadcast_map_state').select('*').eq('session_id', S.id); check('no live map until first publish', !r.error && r.data.length === 0);
r = await anon.from('broadcast_map_state').select('*'); check('anonymous users cannot read map state', !!r.error || r.data.length === 0);

// validation
for (const [label, bad] of [['missing camera', { layers: {} }], ['longitude out of range', state({ camera: { center: [500, 10], zoom: 5 } })],
  ['zoom out of range', state({ camera: { center: [0, 0], zoom: 40 } })], ['too many annotations', state({ annotations: { type: 'FeatureCollection', features: Array.from({ length: 301 }, () => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} })) } })],
  ['non-numeric camera', state({ camera: { center: ['a', 'b'], zoom: 5 } })]]) {
  r = await rpc('producer', 'bc_map_publish', { p_session: S.id, p_state: bad, p_expected_version: 0 }); check('invalid state refused: ' + label, !!r.error, r.data);
}

// publish: controller only, version-checked
r = await rpc('producer2', 'bc_map_publish', { p_session: S.id, p_state: state(), p_expected_version: 0 }); check('non-controller producer cannot publish the map', /not the controller/.test(errOf(r) || ''), errOf(r));
r = await rpc('editor', 'bc_map_publish', { p_session: S.id, p_state: state(), p_expected_version: 0 }); check('graphics editor cannot publish the map', !!r.error);
r = await rpc(null, 'bc_map_publish', { p_session: S.id, p_state: state(), p_expected_version: 0 }); check('anonymous users cannot publish the map', !!r.error);
r = await rpc('producer', 'bc_map_publish', { p_session: S.id, p_state: state(), p_expected_version: 0, p_action: 'take' });
check('controller takes the map live (version 1)', !r.error && r.data.version === 1 && r.data.last_action === 'take', errOf(r));
r = await rpc('producer', 'bc_map_publish', { p_session: S.id, p_state: state(), p_expected_version: 0 }); check('stale version refused (version_conflict)', /version_conflict/.test(errOf(r) || ''), errOf(r));
const [a, b] = await Promise.all([1, 2].map(i => rpc('producer', 'bc_map_publish', { p_session: S.id, p_state: state({ camera: { center: [-97 + i, 35], zoom: 6 } }), p_expected_version: 1, p_action: 'preset' })));
check('two simultaneous publishes on the same version: exactly one wins', [a, b].filter(x => !x.error).length === 1, [errOf(a), errOf(b)]);
r = await U.broadcaster.c.from('broadcast_map_state').select('version,state,updated_by').eq('session_id', S.id).single();
check('assigned broadcaster can read the live map state', !r.error && r.data.version === 2 && r.data.updated_by === U.producer.id, errOf(r));
r = await U.editor2.c.from('broadcast_map_state').select('version').eq('session_id', S.id); check('unassigned editor cannot read it', !r.error && r.data.length === 0);
r = await U.producer.c.from('broadcast_sessions').select('status').eq('id', S.id).single(); check('first map publish marks the session live', r.data.status === 'live', r.data);

// live-control mode
r = await rpc('producer2', 'bc_map_set_live_control', { p_session: S.id, p_on: true }); check('only the controller can switch live-control mode', !!r.error);
r = await rpc('producer', 'bc_map_set_live_control', { p_session: S.id, p_on: true }); check('controller enables live-control mode', !r.error && r.data.live_control === true, errOf(r));
let v = 2; let ok = 0;
for (let i = 0; i < 20; i++) { const x = await rpc('producer', 'bc_map_publish', { p_session: S.id, p_state: state({ camera: { center: [-90 - i * 0.1, 30], zoom: 6 } }), p_expected_version: v, p_action: 'live' }); if (!x.error) { v = x.data.version; ok++; } }
check('live-control camera streaming: 20 rapid publishes accepted in order', ok === 20 && v === 22, { ok, v });

// map outputs: issue, read, scope separation
r = await rpc('broadcaster', 'bc_issue_output_token', { p_session: S.id, p_label: 'OBS map', p_scope: 'map' }); check('assigned broadcaster creates a map output', !r.error && r.data.scope === 'map', errOf(r));
const MT = r.data;
r = await rpc('producer', 'bc_issue_output_token', { p_session: S.id, p_label: 'OBS graphics' }); const GT = r.data; check('graphics output still defaults to graphics scope', !r.error && GT.scope === 'graphics', errOf(r));
r = await rpc('producer', 'bc_issue_output_token', { p_session: S.id, p_label: 'x', p_scope: 'admin' }); check('unknown output type refused', !!r.error);
r = await rpc(null, 'bc_map_output_state', { p_token: MT.token }); check('map output reads the live map state', r.data.ok && r.data.version === 22 && r.data.state.camera.center[0] === -91.9, r.data && { ok: r.data.ok, v: r.data.version });
r = await rpc(null, 'bc_map_output_state', { p_token: MT.token, p_have_version: 22, p_status: 'rendered' }); check('no state payload when the output is already current', r.data.ok && r.data.state === null && r.data.version === 22);
r = await U.producer.c.from('output_tokens').select('last_rendered_seq,last_status,scope').eq('id', MT.id).single(); check('console sees map output health', r.data.last_rendered_seq === 22 && r.data.last_status === 'rendered' && r.data.scope === 'map', r.data);
r = await rpc(null, 'bc_map_output_state', { p_token: GT.token }); check('a graphics token cannot read the map', r.data.ok === false && r.data.reason === 'invalid', r.data);
r = await rpc(null, 'bc_output_state', { p_token: MT.token }); check('a map token cannot read graphics', r.data.ok === false && r.data.reason === 'invalid', r.data);
r = await rpc(null, 'bc_output_state', { p_token: GT.token }); check('graphics token still works for graphics (Phase 2 unchanged)', r.data.ok === true, r.data);
r = await rpc(null, 'bc_map_output_state', { p_token: 'e'.repeat(64) }); check('unknown map token refused', r.data.ok === false);

// realtime nudge carries only the version
const chan = (await rpc(null, 'bc_map_output_state', { p_token: MT.token })).data.channel;
const rt = anonClient(); const got = [];
const ch = rt.channel(chan).on('broadcast', { event: 'map' }, m => got.push(m.payload)); await new Promise(res => ch.subscribe(st => st === 'SUBSCRIBED' && res())); await sleep(300);
r = await rpc('producer', 'bc_map_publish', { p_session: S.id, p_state: state({ tab: 'weather' }), p_expected_version: 22, p_action: 'radar' }); await sleep(1500);
check('Realtime nudge (map_version only) reaches the output channel', got.some(x => x.map_version === 23 && Object.keys(x).filter(k => k !== 'id').length === 1), got);
await rt.removeAllChannels();

// control transfer applies to the map
r = await U.producer.c.from('broadcast_sessions').select('version').eq('id', S.id).single();
await rpc('producer', 'bc_transfer_control', { p_session: S.id, p_to: U.producer2.id, p_expected_version: r.data.version });
r = await rpc('producer', 'bc_map_publish', { p_session: S.id, p_state: state(), p_expected_version: 23 }); check('after a control transfer the previous controller cannot move the map', !!r.error);
r = await rpc('producer2', 'bc_map_publish', { p_session: S.id, p_state: state(), p_expected_version: 23, p_action: 'take' }); check('new controller can', !r.error && r.data.version === 24, errOf(r));

// presets
r = await rpc('viewer', 'gs_me'); r = await U.viewer.c.from('map_presets').insert({ name: 'v', state: state() }).select(); check('viewer cannot save presets', !!r.error);
r = await U.producer.c.from('map_presets').insert({ name: 'Southeast severe ' + tag, kind: 'view', state: state() }).select().single(); check('producer saves a preset', !r.error, errOf(r));
const P = r.data;
r = await U.broadcaster.c.from('map_presets').select('id').eq('id', P.id); check('members can read presets', r.data.length === 1);
r = await U.editor.c.from('map_presets').delete().eq('id', P.id).select(); check("others cannot delete someone's preset", !r.error && r.data.length === 0);
r = await U.producer.c.from('map_presets').update({ name: 'Renamed' }).eq('id', P.id).select().single(); check('creator can rename it', !r.error && r.data.name === 'Renamed');

// audit and end of session
r = await U.admin.c.from('audit_log').select('action').eq('session_id', S.id); const acts = new Set(r.data.map(x => x.action));
check('map actions are audited (take, preset, radar, live-control) but live camera streaming is not', ['map.take', 'map.preset', 'map.radar', 'map.live_control_on', 'output.issue'].every(x => acts.has(x)) && !acts.has('map.live'), [...acts]);
r = await U.producer2.c.from('broadcast_sessions').select('version').eq('id', S.id).single();
await rpc('producer2', 'bc_set_status', { p_session: S.id, p_status: 'ended', p_expected_version: r.data.version });
r = await rpc(null, 'bc_map_output_state', { p_token: MT.token }); check('ending the session stops map outputs', r.data.ok === false, r.data);
r = await rpc('producer2', 'bc_map_publish', { p_session: S.id, p_state: state(), p_expected_version: 24 }); check('no map publishing to an ended session', /ended/.test(errOf(r) || ''), errOf(r));

const f = summary(); process.exit(f ? 1 : 0);
