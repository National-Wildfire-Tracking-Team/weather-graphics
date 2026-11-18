import { launch, check, summary } from './lib.mjs';
// Top-level tabs: Graphics Studio / WX Headlines / Incident Detection. NWS alerts are stubbed; outlook services may be live or fail (both are valid states).
const A = (id, event, severity, ugc, headline) => ({ id, type: 'Feature', geometry: null, properties: { id, event, severity, headline, areaDesc: 'Somewhere County', sent: '2026-11-06T12:00:00Z', expires: '2026-11-06T18:00:00Z', senderName: 'NWS Test', affectedZones: [], geocode: { UGC: ugc } } });
const ALERTS = { type: 'FeatureCollection', features: [
  A('a1', 'Red Flag Warning', 'Severe', ['CAZ211', 'NVZ450'], 'Red Flag Warning issued for wind and low humidity'),
  A('a2', 'Red Flag Warning', 'Severe', ['CAZ212'], 'Second red flag'),
  A('a3', 'Tornado Warning', 'Extreme', ['OKC109'], 'Tornado Warning for Oklahoma County'),
  A('a4', 'Frost Advisory', 'Minor', ['GAZ001'], 'Frost Advisory')] };
const { b, page, errs } = await launch();
await page.route('https://api.weather.gov/alerts/active**', r => r.fulfill({ json: ALERTS, headers: { 'access-control-allow-origin': '*' } }));
console.log('Section tabs');
check('four tabs in order', (await page.$$eval('#tabs [role=tab]', e => e.map(x => x.textContent))).join('|') === 'Graphics Studio|WX Headlines|Incident Detection|Live Broadcast Control');
check('Graphics Studio tab active on the dashboard, sidebar visible', await page.evaluate(() => document.querySelector('#tab-studio-home').classList.contains('active') && getComputedStyle(document.getElementById('sidebar')).display !== 'none'));
await page.click('#tab-headlines'); await page.waitForSelector('#hlAlerts .hlrow', { timeout: 20000 });
check('WX Headlines tab active and sidebar hidden', await page.evaluate(() => document.querySelector('#tab-headlines').getAttribute('aria-selected') === 'true' && getComputedStyle(document.getElementById('sidebar')).display === 'none'));
const events = await page.$$eval('#hlAlerts .hlrow', e => e.map(x => x.dataset.event));
check('alerts grouped by event, most severe first', events.join('|') === 'Tornado Warning|Red Flag Warning|Frost Advisory', events);
check('group shows count and states', /2 · CA, NV/.test(await page.locator('.hlrow[data-event="Red Flag Warning"] summary').innerText()));
await page.selectOption('#hlState', 'CA');
check('state filter narrows alerts', (await page.$$eval('#hlAlerts .hlrow', e => e.map(x => x.dataset.event))).join() === 'Red Flag Warning');
await page.locator('.hlrow summary').first().click();
check('expanding shows individual headlines', /Red Flag Warning issued/.test(await page.locator('.hlrow[open] ul').innerText()));
await page.waitForFunction(() => !/Contacting NOAA/.test(document.getElementById('hlOutlook').textContent), null, { timeout: 60000 }).catch(() => {});
check('outlook section loaded or shows an error (never blank)', await page.evaluate(() => document.querySelectorAll('#hlOutlook .hlcard').length === 2 || !!document.querySelector('#hlOutlook .tag.err')));
await page.click('#tab-incidents'); await page.waitForSelector('#incSources .incsrcitem');
check('Incident Detection tab active and sidebar hidden', await page.evaluate(() => document.querySelector('#tab-incidents').getAttribute('aria-selected') === 'true' && getComputedStyle(document.getElementById('sidebar')).display === 'none'));
await page.evaluate(() => { location.hash = '#/resources'; }); await page.waitForFunction(() => location.hash === '#/incidents', null, { timeout: 5000 }).catch(() => {});
check('old #/resources links redirect to Incident Detection', await page.evaluate(() => location.hash === '#/incidents'));
await page.click('#tab-studio-home'); await page.waitForTimeout(300);
check('back to Graphics Studio shows the sidebar and dashboard', await page.evaluate(() => location.hash === '#/dashboard' && getComputedStyle(document.getElementById('sidebar')).display !== 'none'));
await page.click('#nav a[data-r=templates]'); await page.waitForTimeout(300);
check('studio sub-pages keep the Graphics Studio tab active', await page.evaluate(() => document.querySelector('#tab-studio-home').classList.contains('active')));
const bad = errs.filter(e => !/Failed to load resource|net::|HTTP \d+/.test(e));
console.log('page errors:', bad);
check('no unexpected page errors', bad.length === 0);
await b.close(); process.exit(summary() ? 1 : 0);
