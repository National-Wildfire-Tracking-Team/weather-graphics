import { launch, check, summary } from './lib.mjs';
// NWS Alert Graphics: filter UI + graphic creation. api.weather.gov is stubbed so the test is deterministic.
const sq = (x, y) => ({ type: 'Polygon', coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] });
const alert = (id, event, sev, ugc, geometry, zones) => ({ id, type: 'Feature', geometry, properties: { id, event, severity: sev, headline: event + ' test', areaDesc: 'Test', sent: '2026-10-10T12:00:00Z', expires: '2026-10-10T18:00:00Z', senderName: 'NWS Test', geocode: { UGC: ugc }, affectedZones: zones || [] } });
const FEED = { features: [
  alert('a1', 'Tornado Warning', 'Extreme', ['ALC001'], sq(-87, 33)), alert('a2', 'Tornado Warning', 'Extreme', ['MSC001'], sq(-89, 33)),
  alert('a3', 'Winter Storm Warning', 'Severe', ['MNZ001', 'MNZ002'], null, ['https://api.weather.gov/zones/forecast/MNZ001', 'https://api.weather.gov/zones/forecast/MNZ002']),
  alert('a4', 'Small Craft Advisory', 'Minor', ['GMZ830'], null, ['https://api.weather.gov/zones/coastal/GMZ830'])] };
const { b, ctx, page, errs } = await launch();
await page.route('https://api.weather.gov/alerts/active**', r => r.fulfill({ json: FEED, headers: { 'access-control-allow-origin': '*' } }));
await page.route('https://api.weather.gov/zones/**', r => { const id = r.request().url().split('/').pop(); r.fulfill({ json: { type: 'Feature', geometry: id === 'MNZ002' ? null : sq(-94, 45), properties: { id } }, headers: { 'access-control-allow-origin': '*' } }); });
console.log('NWS Alert Graphics');
await page.click('#nav a[data-r=alerts]'); await page.waitForSelector('#nwsEvents input');
const evs = () => page.$$eval('#nwsEvents input', is => is.map(i => i.dataset.event));
check('lists distinct event types, warnings first', JSON.stringify(await evs()) === JSON.stringify(['Tornado Warning', 'Winter Storm Warning', 'Small Craft Advisory']), await evs());
check('create is disabled until an alert type is chosen', await page.locator('#nwsCreate').isDisabled());
await page.fill('#nwsSearch', 'craft'); check('search narrows the list', (await evs()).length === 1); await page.fill('#nwsSearch', '');
await page.check('#nwsEvents input[data-event="Winter Storm Warning"]');
check('title defaults to the selected alert', (await page.inputValue('#nwsTitle')) === 'WINTER STORM WARNING');
check('summary reports zone shapes to load', /1 alert match.*2 zone shapes/.test(await page.textContent('#nwsSummary')), await page.textContent('#nwsSummary'));
await page.uncheck('#nwsEvents input[data-event="Winter Storm Warning"]'); await page.check('#nwsEvents input[data-event="Tornado Warning"]');
await page.click('[data-state="MS"]');
check('state filter limits matches', /^1 alert match/.test(await page.textContent('#nwsSummary')), await page.textContent('#nwsSummary'));
await page.click('[data-state="MS"]');
check('both tornado warnings match without state filter', /^2 alerts match/.test(await page.textContent('#nwsSummary')));
await page.check('#nwsEvents input[data-event="Winter Storm Warning"]');
await page.click('#nwsCreate'); await page.waitForSelector('#workspace canvas', { timeout: 30000 }); await page.waitForTimeout(1500);
const st = await page.evaluate(() => { const m = NS.App.editor.ed.canvas.getObjects().find(o => o.type === 'MapFrame'); return m.mapState; });
const L = st.layers['nws-custom'], D = st.layerData['nws-custom'].data;
check('graphic has the filtered NWS layer on', L && L.on && JSON.stringify(L.filter.events) === JSON.stringify(['Tornado Warning', 'Winter Storm Warning']), L);
check('polygon alerts and resolved zones are in the snapshot (unresolvable zone omitted, flagged)', D.features.length === 3 && D.notes.length === 1, { n: D.features.length, notes: D.notes });
check('features are colored by alert type', D.features.some(f => f.properties.event === 'Tornado Warning' && f.properties.color === '#F2453D') && D.features.some(f => f.properties.event === 'Winter Storm Warning'));
check('map is fitted to the alerts', st.fit && st.fit.extent[0][0] <= -94 && st.fit.extent[1][0] >= -86, st.fit);
check('title text uses the selection', await page.evaluate(() => NS.App.editor.ed.canvas.getObjects().some(o => o.fieldKey === 'title' && /NWS ALERTS/.test(o.text))));
console.log('page errors:', errs.filter(e => !/Failed to load resource|net::/.test(e)));
check('no unexpected page errors', errs.filter(e => !/Failed to load resource|net::/.test(e)).length === 0);
await b.close(); process.exit(summary() ? 1 : 0);
