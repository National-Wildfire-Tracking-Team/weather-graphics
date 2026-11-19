/* Field reporters panel: the relay preview login is readable only by approved members, settable only by admins. */
import { users, anonClient, admin, check, summary, errOf } from './env.mjs';
const tag = 'r' + Date.now().toString(36);
console.log('Field reporter relay config — users tagged', tag);
const U = await users(tag);
const rpc = (u, fn, args) => (u ? U[u].c : anonClient()).rpc(fn, args);
const PASS = 'preview-pass-' + tag + '-0123456789';
const reporters = [{ name: 'jane-doe', label: 'Jane Doe' }, { name: 'test-reporter' }];

let r = await rpc('producer', 'gs_set_relay_config', { p_whep_base: 'https://relay.example.org', p_preview_user: 'preview', p_preview_pass: PASS, p_reporters: reporters });
check('a producer cannot configure the relay', !!r.error);
r = await rpc('admin', 'gs_set_relay_config', { p_whep_base: 'https://relay.example.org/', p_preview_user: 'preview', p_preview_pass: PASS, p_reporters: reporters });
check('an administrator configures the relay', !r.error, errOf(r));
r = await rpc('admin', 'gs_set_relay_config', { p_whep_base: 'http://relay.example.org', p_preview_user: 'preview', p_preview_pass: PASS, p_reporters: [] });
check('a non-https preview address is refused', !!r.error);
r = await rpc('admin', 'gs_set_relay_config', { p_whep_base: 'https://relay.example.org', p_preview_user: 'preview', p_preview_pass: PASS, p_reporters: [{ name: 'Bad Name' }] });
check('an invalid reporter name is refused', !!r.error);

for (const who of ['admin', 'producer', 'editor', 'broadcaster', 'viewer']) {
  r = await rpc(who, 'gs_relay_preview', {});
  check(`${who} gets the preview login and reporters`, !r.error && r.data && r.data.pass === PASS && r.data.whep_base === 'https://relay.example.org' && r.data.reporters.length === 2, errOf(r));
}
r = await rpc('outsider', 'gs_relay_preview', {}); check('a signed-in account without approval cannot read it', !!r.error);
r = await rpc(null, 'gs_relay_preview', {}); check('anonymous users cannot read it', !!r.error);
r = await U.admin.c.from('relay_config').select('*'); check('no direct table access, even for admins', !!r.error || r.data.length === 0);
r = await anonClient().from('relay_config').select('*'); check('no anonymous table access', !!r.error || r.data.length === 0);
r = await admin.from('audit_log').select('detail').eq('action', 'relay.configure').order('at', { ascending: false }).limit(1).single();
check('configuration is audited without the password', !r.error && !JSON.stringify(r.data.detail).includes(PASS) && r.data.detail.reporters === 2, r.data);

process.exit(summary() ? 1 : 0);
