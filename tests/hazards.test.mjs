import { launch, check, summary } from './lib.mjs';
// Week-Ahead Hazards: day mapping, coverage, filters and graphic creation. The NOAA outlook services are stubbed so the test is deterministic.
const DAY = 86400000, now = new Date(), T0 = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());   // browser's local "today" as a UTC date
const iso = k => new Date(T0 + k * DAY).toISOString().slice(0, 10);
const spc = (k, hh) => iso(k).replace(/-/g, '') + hh + '00', wpc = (k, hh) => iso(k) + ' ' + hh + ':00:00';
const sq = (x, y) => ({ type: 'Polygon', coordinates: [[[x, y], [x + 2, y], [x + 2, y + 2], [x, y + 2], [x, y]]] });
const F = (props, x, y) => ({ type: 'Feature', geometry: sq(x, y), properties: props });
const PLACEHOLDER = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: { dn: 0, valid: null, fill: null } }] };
const fc = f => ({ type: 'FeatureCollection', features: f });
function respond(path) {
  let m;
  if ((m = path.match(/SPC_wx_outlks\/MapServer\/(\d+)\/query/))) {
    if (m[1] === '1') return fc([F({ dn: 4, label: 'SLGT', label2: 'Slight Risk', fill: '#FFE066', stroke: '#DDAA00', valid: spc(0, '12'), expire: spc(1, '12'), issue: spc(0, '06') }, -95, 35)]);
    if (m[1] === '9') return fc([F({ dn: 2, label: 'TSTM', label2: 'General Thunderstorms Risk', fill: '#C1E9C1', stroke: '#55BB55', valid: spc(1, '12'), expire: spc(2, '12'), issue: spc(0, '06') }, -90, 32)]);
    return PLACEHOLDER;
  }
  if ((m = path.match(/wpc_precip_hazards\/MapServer\/(\d+)\/query/))) return m[1] === '3' ? fc([F({ dn: 2, outlook: 'Slight', start_time: wpc(3, '12'), end_time: wpc(4, '12'), issue_time: wpc(0, '08') }, -85, 34)]) : fc([]);
  if (/wpc_prob_winter_precip/.test(path)) return fc([]);
  if ((m = path.match(/cpc_weather_hazards\/MapServer\/(\d+)\/query/))) {
    if (['3', '6', '8'].includes(m[1])) return null;   // Day 8-14 service down
    return m[1] === '1' ? fc([F({ label: 'High Winds', start_date: T0 + 3 * DAY, end_date: T0 + 5 * DAY, idp_filedate: T0 + 17 * 3600000 }, -105, 40)]) : fc([]);
  }
  return undefined;
}
const { b, page, errs } = await launch();
await page.route('https://mapservices.weather.noaa.gov/**', r => {
  const out = respond(new URL(r.request().url()).pathname);
  if (out === null) return r.fulfill({ status: 500, body: 'down', headers: { 'access-control-allow-origin': '*' } });
  if (out === undefined) return r.continue();
  r.fulfill({ json: out, headers: { 'access-control-allow-origin': '*' } });
});
console.log('Week-Ahead Hazards');
await page.click('#nav a[data-r=hazards]'); await page.waitForSelector('#hzDays [data-day]', { timeout: 30000 });
check('defaults to upcoming Saturday through Friday (7 days)', await page.evaluate(() => { const d = [...document.querySelectorAll('#hzDays [data-day]')].map(e => e.dataset.day); return d.length === 7 && new Date(d[0] + 'T12:00:00Z').getUTCDay() === 6; }));
await page.click('#hzNext7'); await page.waitForTimeout(200);
const card = k => page.locator(`#hzDays [data-day="${iso(k)}"]`).innerText();
check('"Next 7 days" starts today', (await page.$$eval('#hzDays [data-day]', e => e.map(x => x.dataset.day))).join() === [0, 1, 2, 3, 4, 5, 6].map(iso).join());
check('Day 1 shows the SPC categorical risk', /Severe storms · 2\/5 Slight[\s\S]*SPC/.test(await card(0)), await card(0));
check('general thunder is hidden by default', /No hazard areas/.test(await card(1)), await card(1));
await page.check('#hzThunder'); await page.waitForTimeout(100);
check('general thunder appears when enabled', /Thunderstorms/.test(await card(1)));
await page.uncheck('#hzThunder');
check('Day 4 has the ERO and Day 3-7 hazards', /Flash flooding · 2\/4 Slight/.test(await card(3)) && /High Winds/.test(await card(3)), await card(3));
check('Hazards Outlook end date is exclusive (Days 4-5 only)', /High Winds/.test(await card(4)) && !/High Winds/.test(await card(5)), [await card(4), await card(5)]);
check('failed source is flagged, not invented', await page.locator('[data-src=cpc814].err').count() === 1);
check('day beyond every reachable product says so', /No official outlook/.test(await page.evaluate(() => NS.Hazards.summary(NS.Hazards.range(NS.Hazards.isoDay(NS.Hazards.today()), 12)[11]).covered.length ? 'covered' : 'No official outlook')));
await page.uncheck('[data-source=ero]'); await page.waitForTimeout(100);
check('unticking a source removes its hazards', !/Flash flooding/.test(await card(3)));
await page.click(`#hzDays [data-day="${iso(3)}"]`); await page.waitForTimeout(300);
check('selecting a day updates subtitle and count', /1 hazard area$/.test(await page.textContent('#hzSummary')) && (await page.inputValue('#hzSub')).length > 5, await page.textContent('#hzSummary'));
await page.click('#hzCreate'); await page.waitForSelector('#workspace canvas', { timeout: 30000 }); await page.waitForTimeout(1500);
const st = await page.evaluate(() => NS.App.editor.ed.canvas.getObjects().find(o => o.type === 'MapFrame').mapState);
const L = st.layers['hazards-outlook'], D = st.layerData['hazards-outlook'].data;
check('graphic stores the chosen day and sources', L && L.on && L.dates.join() === iso(3) && !L.sources.includes('ero'), L);
check('snapshot has only that day\'s hazards', D.features.length === 1 && D.features[0].properties.hazard === 'High Winds', D.features.map(f => f.properties.hazard));
check('legend lists the hazard', await page.evaluate(() => NS.legendEntries(NS.App.editor.ed.canvas.getObjects().find(o => o.type === 'MapFrame').mapState).some(e => e.title === 'HIGH WINDS')));
check('title text is the hazards header', await page.evaluate(() => NS.App.editor.ed.canvas.getObjects().some(o => o.fieldKey === 'title' && /HAZARDS OUTLOOK/.test(o.text))));
const bad = errs.filter(e => !/Failed to load resource|net::|HTTP 500/.test(e));
console.log('page errors:', bad);
check('no unexpected page errors', bad.length === 0);
await b.close(); process.exit(summary() ? 1 : 0);
