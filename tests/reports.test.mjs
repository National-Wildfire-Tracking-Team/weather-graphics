import { launch, check, summary } from './lib.mjs';
// Storm Reports tab: IEM Local Storm Reports are stubbed (times relative to now) so counts are deterministic.
const H = 3600000, now = Date.now();
const R = (hoursAgo, typetext, st, extra) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-97, 35] },
  properties: Object.assign({ valid: new Date(now - hoursAgo * H).toISOString().slice(0, 19) + 'Z', typetext, st, state: st, city: '2 N Testville', county: 'Test', lat: 35, lon: -97, magnitude: null, unit: null, remark: null, source: 'Trained Spotter', wfo: 'OUN', product_id: 'p' + hoursAgo }, extra) });
const LSR = { type: 'FeatureCollection', features: [
  R(1, 'TORNADO', 'OK', { remark: 'Brief touchdown in an open field.' }),
  R(2, 'TSTM WND DMG', 'OK'), R(3, 'HAIL', 'KS', { magnitude: '1.75', unit: 'INCH' }),
  R(4, 'RAIN', 'TX', { magnitude: '2.10', unit: 'INCH' }), R(5, 'FLASH FLOOD', 'TX', { remark: '&&' }),
  R(30, 'SNOW', 'CO', { magnitude: '4', unit: 'INCH' }), R(100, 'WILDFIRE', 'CA'), R(200, 'TORNADO', 'OK')] };
let calls = 0;
const { b, page, errs } = await launch();
await page.route('https://mesonet.agron.iastate.edu/geojson/lsr.php**', r => { calls++; r.fulfill({ json: LSR, headers: { 'access-control-allow-origin': '*' } }); });
console.log('Storm Reports');
await page.click('#tab-reports'); await page.waitForSelector('.srkpi');
check('Storm Reports tab is active, sidebar hidden', await page.evaluate(() => document.querySelector('#tab-reports').classList.contains('active') && getComputedStyle(document.getElementById('sidebar')).display === 'none'));
const kpi = id => page.locator(`[data-kpi="${id}"] .n`).innerText();
check('last 24 hrs excludes rain totals by default', await kpi('24h') === '4', await kpi('24h'));
check('last 7 days counts every non-rain report in the feed window', await kpi('7d') === '6', await kpi('7d'));
const cat = id => page.locator(`[data-cat="${id}"].srcat .n`).innerText();
check('hazard tiles count by category', await cat('tornado') === '1' && await cat('hail') === '1' && await cat('wind') === '1' && await cat('flood') === '1' && await cat('rain') === '1');
check('list is newest first with magnitude', /Tornado/.test(await page.locator('.srrow').first().innerText()) && /Hail · 1\.75 inch/.test(await page.locator('#srList').innerText()));
check('punctuation-only remarks are dropped', !/&&/.test(await page.locator('#srList').innerText()));
await page.check('#srRain');
check('rain totals toggle adds them', await kpi('24h') === '5');
await page.click('[data-cat=tornado].srcat');
check('clicking a hazard tile hides it from list and chart', !(await page.locator('.srrow[data-cat=tornado]').count()) && !(await page.locator('.hbar[data-cat=tornado]').count()));
await page.click('[data-cat=tornado].srcat');
await page.selectOption('#srState', 'OK');
check('state filter narrows reports', await page.locator('.srrow').count() === 2);
await page.selectOption('#srState', '');
await page.click('[data-win="7d"]');
check('7-day window shows the wildfire', await page.locator('.srrow[data-cat=fire]').count() === 1);
check('by-day chart has 8 columns and sums to the 7-day feed', await page.evaluate(() => document.querySelectorAll('#srByDay .vcol').length === 8));
check('by-type chart lists each shown category once', await page.locator('#srByType .hbar').count() === 7);
await page.click('#srRefresh'); await page.waitForTimeout(500);
check('Refresh refetches', calls >= 2, calls);
const bad = errs.filter(e => !/Failed to load resource|net::|HTTP \d+/.test(e));
console.log('page errors:', bad);
check('no unexpected page errors', bad.length === 0);
await b.close(); process.exit(summary() ? 1 : 0);
