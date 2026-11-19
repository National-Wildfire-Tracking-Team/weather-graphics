/* Field reporters panel in Live Broadcast Control. The relay's WebRTC (WHEP) endpoint is simulated with Playwright
   routes (real video can't be tested here), so this checks the panel's behaviour: not configured, offline reporters,
   a refused login, the preview login sent only to the relay, the list refreshing, and members-only access.
   Needs the local Supabase stack and the static site on :8765. */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';
import { users, check, summary, PASSWORD, URL_, ANON } from './env.mjs';

const SITE = process.env.SITE || 'http://localhost:8765/';
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium'].find(p => existsSync(p));
const tag = 'fr' + Date.now().toString(36); const U = await users(tag);
console.log('Field reporters panel — users tagged', tag);
const RELAY = 'https://relay.example.test';
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const whep = [];
async function computer(who) {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.route('**/config.json', async r => { const res = await r.fetch(); const j = await res.json(); j.supabase = { url: URL_, anonKey: ANON }; j.sentinelUrl = 'off'; r.fulfill({ response: res, json: j }); });
  await ctx.route(RELAY + '/**', r => {
    const req = r.request(); whep.push({ url: req.url(), method: req.method(), auth: req.headers()['authorization'] || '', type: req.headers()['content-type'] || '' });
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' } });
    const cors = { 'access-control-allow-origin': '*' };
    if (req.url().includes('/locked/')) return r.fulfill({ status: 401, headers: cors, body: 'unauthorized' });
    return r.fulfill({ status: 404, headers: cors, body: 'no stream is available on path' });
  });
  const page = await ctx.newPage();
  await page.goto(SITE + 'index.html#/dashboard'); await page.waitForSelector('#signInBtn', { timeout: 15000 });
  await page.click('#signInBtn'); await page.fill('#loginEmail', U[who].email); await page.fill('#loginPassword', PASSWORD);
  await page.click('dialog[aria-label="Sign in"] .btn.primary');
  if (who === 'outsider') await page.waitForFunction(() => NS.Cloud.user, null, { timeout: 15000 });   // signed in, but waiting for approval
  else await page.waitForFunction(() => NS.Cloud.signedIn(), null, { timeout: 15000 });
  return page;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const session = (await U.producer.c.rpc('bc_create_session', { p_title: 'Field ' + tag, p_type: 'wildfire' })).data;

// 1. not configured yet
await U.admin.c.rpc('gs_set_relay_config', { p_whep_base: RELAY, p_preview_user: 'preview', p_preview_pass: 'x'.repeat(20), p_reporters: [] }); // make sure the row exists, then clear it
await (await import('./env.mjs')).admin.from('relay_config').delete().eq('id', true);
const A = await computer('producer');
await A.goto(SITE + 'index.html#/live/' + session.id); await A.waitForSelector('#liveReporters', { timeout: 15000 });
await A.waitForFunction(() => !/Loading/.test(document.getElementById('reportersNote').textContent), null, { timeout: 15000 });
check('panel says the relay is not configured yet', /not configured/.test(await A.innerText('#reportersNote')), await A.innerText('#reportersNote'));

// 2. configured: two reporters, one offline, one with a refused login
const PASS = 'preview-' + tag + '-abcdefghij';
await U.admin.c.rpc('gs_set_relay_config', { p_whep_base: RELAY, p_preview_user: 'preview', p_preview_pass: PASS, p_reporters: [{ name: 'jane-doe', label: 'Jane Doe' }, { name: 'locked' }] });
await A.reload(); await A.waitForSelector('[data-reporter="jane-doe"]', { timeout: 15000 });
await A.waitForFunction(() => document.querySelector('[data-reporter-status="jane-doe"]')?.dataset.state === 'offline' && document.querySelector('[data-reporter-status="locked"]')?.dataset.state === 'login refused', null, { timeout: 20000 }).catch(() => {});
check('one tile per reporter, with labels', (await A.locator('[data-reporter]').count()) === 2 && /Jane Doe/.test(await A.innerText('[data-reporter="jane-doe"]')));
check('a reporter who is not streaming shows "offline"', (await A.getAttribute('[data-reporter-status="jane-doe"]', 'data-state')) === 'offline');
check('a refused preview login is shown, not hidden', (await A.getAttribute('[data-reporter-status="locked"]', 'data-state')) === 'login refused');
const posts = whep.filter(x => x.method === 'POST');
check('previews use WHEP: POST of an SDP offer to <relay>/<reporter>/whep', posts.some(x => x.url === RELAY + '/jane-doe/whep' && x.type === 'application/sdp'), posts.slice(0, 2));
check('the preview login goes only to the relay (Basic auth)', posts.every(x => x.auth === 'Basic ' + Buffer.from('preview:' + PASS).toString('base64')));
const n0 = whep.filter(x => x.method === 'POST' && x.url.endsWith('/jane-doe/whep')).length; await sleep(15000);  // offline retry: ~6 s + offer/ICE time
check('an offline reporter is retried automatically', whep.filter(x => x.method === 'POST' && x.url.endsWith('/jane-doe/whep')).length > n0);
check('the panel is labelled as preview, not on air', /not on air/i.test(await A.innerText('#liveReporters h3')));

// 3. reporters list changes are picked up (on the next refresh / reload)
await U.admin.c.rpc('gs_set_relay_config', { p_whep_base: RELAY, p_preview_user: 'preview', p_preview_pass: PASS, p_reporters: [{ name: 'jane-doe', label: 'Jane Doe' }] });
await A.reload(); await A.waitForSelector('[data-reporter="jane-doe"]', { timeout: 15000 }); await sleep(1500);
check('a removed reporter disappears', (await A.locator('[data-reporter]').count()) === 1);

// 4. graphics columns still work alongside (the panel doesn't break the console)
check('graphics console still renders with the panel', await A.isVisible('#liveStatus') && await A.isVisible('#takeLive'));

// 5. an account waiting for approval never sees reporters (the console itself is closed to it)
const O = await computer('outsider');
await O.goto(SITE + 'index.html#/live/' + session.id); await sleep(4000);
check('an unapproved account gets no reporter previews', (await O.locator('[data-reporter]').count()) === 0);

await b.close();
process.exit(summary() ? 1 : 0);
