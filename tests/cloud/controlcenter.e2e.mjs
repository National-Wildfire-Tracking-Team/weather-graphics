/* One NWTT control center: Graphics Studio's Live Broadcast Control with Sentinel's map control embedded in it.
   Computer A runs the control center (one sign-in, in Graphics Studio); Computer B is an OBS map output.
   Needs the local Supabase stack, Graphics Studio on :8765 and a Sentinel dev server started with
     VITE_BROADCAST_SUPABASE_URL/ANON_KEY = this local stack, VITE_GRAPHICS_STUDIO_URL=http://localhost:8765,
     VITE_BROADCAST_EMBED_ORIGINS=http://localhost:8765
   then: SENTINEL_URL=http://app.localhost:3000 node controlcenter.e2e.mjs */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';
import { users, check, summary, PASSWORD, URL_, ANON } from './env.mjs';

const SITE = process.env.SITE || 'http://localhost:8765/';
const SENTINEL = process.env.SENTINEL_URL;
if (!SENTINEL) { console.log('SENTINEL_URL not set: skipping the control center e2e.'); process.exit(0); }
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium'].find(p => existsSync(p));
const tag = 'cc' + Date.now().toString(36); const U = await users(tag);
console.log('One control center (Graphics Studio + embedded Sentinel map) — users tagged', tag);
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const vp = { viewport: { width: 1920, height: 1080 } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const A = await b.newContext(vp);
await A.route('**/config.json', async r => { const res = await r.fetch(); const j = await res.json(); j.supabase = { url: URL_, anonKey: ANON }; j.sentinelUrl = SENTINEL; r.fulfill({ response: res, json: j }); });
const pa = await A.newPage();
pa.on('dialog', d => d.accept(d.type() === 'prompt' ? (d.message().startsWith('Label for') ? 'Studio OBS map' : d.defaultValue() || 'x') : undefined));
await pa.goto(SITE + 'index.html#/dashboard'); await pa.waitForSelector('#signInBtn', { timeout: 15000 });
await pa.click('#signInBtn'); await pa.fill('#loginEmail', U.producer.email); await pa.fill('#loginPassword', PASSWORD);
await pa.click('dialog[aria-label="Sign in"] .btn.primary'); await pa.waitForFunction(() => NS.Cloud.signedIn(), null, { timeout: 15000 });
await pa.goto(SITE + 'index.html#/live'); await pa.waitForSelector('#newSessionTitle', { timeout: 15000 });
await pa.fill('#newSessionTitle', 'Control center ' + tag); await pa.click('#createSession');
await pa.waitForSelector('#liveSession #liveStatus', { timeout: 15000 });
const sessionId = pa.url().split('#/live/')[1];
check('graphics and map are on one page (Live map panel present)', await pa.isVisible('#liveMap #liveMapFrame'));
const map = pa.frameLocator('#liveMapFrame');
await map.locator('[data-broadcast-control]').waitFor({ timeout: 45000 }).catch(() => {});
check('embedded map control is signed in by Graphics Studio (no second sign-in form)', await map.locator('[data-broadcast-control]').count() === 1 && await map.locator('[data-broadcast-signin]').count() === 0);
check('embedded panel hides its own session controls (they are in the control center)', await map.locator('#bcTransfer, #bcEnd').count() === 0);

// OBS map output from inside the panel
await map.locator('#bcNewOutput').click();
const outUrl = await map.locator('#bcOutputUrl').inputValue();
check('map output URL created in the panel', new RegExp(`/broadcast/output/${sessionId}#t=[0-9a-f]{64}$`).test(outUrl), outUrl);
const B = await b.newContext(vp); const pb = await B.newPage();
await pb.goto(outUrl); await pb.waitForSelector('[data-standby]', { timeout: 30000 });
const ver = async () => Number(await pb.getAttribute('[data-broadcast-output]', 'data-version'));
const waitVer = async (v, t = 30000) => { const end = Date.now() + t; while (Date.now() < end) { if (await ver() >= v) return true; await sleep(500); } return false; };

await map.locator('[data-preset-cut="southeast"]').click(); await sleep(800);
await map.locator('#bcTakeLive').click();
check('Take Live in the embedded panel reaches the OBS map output', await waitVer(1), await ver());

// token refresh in Graphics Studio is handed to the panel; the panel keeps working
await pa.evaluate(() => NS.Cloud.client.auth.refreshSession());
await sleep(1500);
await map.locator('[data-preset-cut="plains"]').click(); await sleep(800);
await map.locator('#bcTakeLive').click();
check('after a Graphics Studio token refresh the panel still publishes', await waitVer(2), await ver());
check('Graphics Studio is still signed in (the panel never refreshed or revoked its session)', await pa.evaluate(async () => !!(await NS.Cloud.client.auth.getSession()).data.session));

// direct visits go to the one control center
const pc = await (await b.newContext(vp)).newPage();
await pc.goto(SENTINEL + '/broadcast/control/' + sessionId); await pc.waitForURL(u => u.href.startsWith(SITE.replace(/\/$/, '')), { timeout: 20000 }).catch(() => {});
check('Sentinel /broadcast/control/<id> on its own redirects to Graphics Studio #/live/<id>', pc.url().endsWith('#/live/' + sessionId), pc.url());
await pc.goto(SENTINEL + '/broadcast'); await pc.waitForURL(u => u.href.includes('#/live'), { timeout: 20000 }).catch(() => {});
check('Sentinel /broadcast redirects to the control center', /#\/live$/.test(pc.url()), pc.url());

// a page on another origin cannot hand the panel a session
const tokens = await pa.evaluate(async () => { const s = (await NS.Cloud.client.auth.getSession()).data.session; return { a: s.access_token, r: s.refresh_token }; });
// EVIL_URL: a page on another origin (e.g. a static server on :8766) that frames the panel and posts real tokens.
const EVIL = process.env.EVIL_URL || 'http://localhost:8766/';
const E = await b.newContext(vp); const pe = await E.newPage();
await pe.goto(EVIL);
await pe.evaluate(({ src, a, r }) => {
  const f = document.createElement('iframe'); f.id = 'f'; f.src = src; f.style.cssText = 'width:1600px;height:900px'; document.body.append(f);
  addEventListener('message', e => { if (e.data && e.data.type === 'nwtt-map:ready') f.contentWindow.postMessage({ type: 'nwtt-map:session', access_token: a, refresh_token: r }, '*'); });
  setTimeout(() => f.contentWindow.postMessage({ type: 'nwtt-map:session', access_token: a, refresh_token: r }, '*'), 6000);
}, { src: `${SENTINEL}/broadcast/control/${sessionId}?embed=1`, a: tokens.a, r: tokens.r });
await sleep(10000);
const ev = pe.frameLocator('#f');
check('a page on another origin cannot sign the panel in (it stays waiting)', await ev.locator('[data-broadcast-embed-wait]').count() === 1 && await ev.locator('[data-broadcast-control]').count() === 0);

// signing out of Graphics Studio signs the panel out (locally) too
await pa.evaluate(() => NS.Cloud.signOut());
await map.locator('[data-broadcast-embed-wait]').waitFor({ timeout: 15000 }).catch(() => {});
check('signing out of Graphics Studio signs the embedded panel out', await map.locator('[data-broadcast-embed-wait]').count() === 1 || await pa.locator('#liveMapFrame').count() === 0);
await pb.screenshot({ path: '/tmp/cc-output.png' }).catch(() => {});
await pa.goto(SITE + 'index.html#/dashboard');
await b.close();
process.exit(summary() ? 1 : 0);
