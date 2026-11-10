import { launch, check, summary } from './lib.mjs';
// Incident pages: an incident reported by 2+ sources gets a page. All sources stubbed.
const now = Date.now(), H = 3600000;
const pt = (lon, lat, p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: p });
const WFIGS = { type: 'FeatureCollection', features: [
  pt(-121.12, 40.31, { IncidentName: 'BAILEY', IncidentSize: 250, PercentContained: 10, POOState: 'US-CA', POOCounty: 'Plumas', FireDiscoveryDateTime: now - 3 * H, ModifiedOnDateTime_dt: now - H, UniqueFireIdentifier: '2026-CALMU-007049' }),
  pt(-117.0, 34.0, { IncidentName: 'BAILEY', IncidentSize: 5, PercentContained: 0, POOState: 'US-CA', POOCounty: 'Riverside', FireDiscoveryDateTime: now - 2 * H, ModifiedOnDateTime_dt: now - H, UniqueFireIdentifier: '2026-CARRU-000123' }),
  pt(-122.5, 44.0, { IncidentName: 'Bailey', IncidentSize: 12, PercentContained: 0, POOState: 'US-OR', POOCounty: 'Lane', FireDiscoveryDateTime: now - 2 * H, ModifiedOnDateTime_dt: now - H, UniqueFireIdentifier: '2026-ORWIF-000777' }),
  pt(-106.9, 44.3, { IncidentName: 'Foot Creek', IncidentSize: 683, PercentContained: 40, POOState: 'US-WY', POOCounty: 'Johnson', FireDiscoveryDateTime: now - 5 * 24 * H, ModifiedOnDateTime_dt: now - 3 * H, UniqueFireIdentifier: '2026-WYBHF-000401' }),
  pt(-97.5, 35.4, { IncidentName: 'Prairie', IncidentSize: 3, POOState: 'US-OK', POOCounty: 'Oklahoma', FireDiscoveryDateTime: now - H, ModifiedOnDateTime_dt: now - H, UniqueFireIdentifier: '2026-OKOKS-000101' }),
  pt(-118.2, 34.0, { IncidentName: 'LAC-406202', POOState: 'US-CA', POOCounty: 'Los Angeles', FireDiscoveryDateTime: now - H, ModifiedOnDateTime_dt: now - H, UniqueFireIdentifier: '2026-CALAC-406202' })] };
const CALFIRE = [{ Name: 'Bailey Fire', IsActive: true, Updated: new Date(now - 30 * 60000).toISOString(), Started: new Date(now - 3 * H).toISOString(), County: 'Plumas', Location: 'Hwy 70', AcresBurned: 310, PercentContained: 5, Latitude: 40.33, Longitude: -121.10, UniqueId: 'aaaabbbb-1111', Url: 'https://www.fire.ca.gov/incidents/2026/11/9/bailey-fire/' }];
const NWS = { type: 'FeatureCollection', features: [{ id: 'n1', type: 'Feature', geometry: null, properties: { id: 'n1', event: 'Evacuation Immediate', headline: 'Evacuation Immediate issued for Bailey Fire area near Quincy', areaDesc: 'Plumas, CA', sent: new Date(now - H).toISOString(), expires: new Date(now + 5 * H).toISOString(), senderName: 'NWS Sacramento', description: 'Plumas County Sheriff: leave now via Highway 70.', geocode: { UGC: ['CAZ068'] } } }] };
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Foot Creek Fire</title><link>http://inciweb.wildfire.gov/incident-information/wybhf-foot-creek</link>
<description>The type of incident is Wildfire and involves the following unit(s) Bighorn NF. --- State: Wyoming --- </description><pubDate>${new Date(now - 4 * H).toUTCString()}</pubDate></item>
<item><title>CAPNF Bailey Prescribed Burning</title><link>http://inciweb.wildfire.gov/incident-information/capnf-bailey-rx</link><description>The type of incident is Prescribed Fire and involves the following unit(s) Plumas NF. --- State: California ---</description><pubDate>${new Date(now - 4 * H).toUTCString()}</pubDate></item></channel></rss>`;
const BSKY = { posts: [
  { uri: 'at://did:plc:a/app.bsky.feed.post/1', author: { handle: 'ktvz.bsky.social', displayName: 'KTVZ News' }, record: { text: 'Crews responding to the Bailey Fire near Quincy in Plumas County', createdAt: new Date(now - 40 * 60000).toISOString() } },
  { uri: 'at://did:plc:a/app.bsky.feed.post/3', author: { handle: 'vague.bsky.social', displayName: 'Vague' }, record: { text: 'The Bailey Fire smoke is wild today', createdAt: new Date(now - 20 * 60000).toISOString() } },
  { uri: 'at://did:plc:a/app.bsky.feed.post/2', author: { handle: 'old.bsky.social', displayName: 'Old' }, record: { text: 'Remembering the Prairie Fire of last spring', createdAt: new Date(now - 30 * 24 * H).toISOString() } }] };
BSKY.posts.push({ uri: 'at://did:plc:a/app.bsky.feed.post/4', author: { handle: 'roundup.bsky.social', displayName: 'Fire Roundup' }, record: { text: 'Large fires tonight: Foot Creek Fire (Johnson County), Prairie Fire (Oklahoma County), Bailey Fire (Plumas County)', createdAt: new Date(now - 10 * 60000).toISOString() } });
const PERIM = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-121.15, 40.29], [-121.08, 40.29], [-121.08, 40.34], [-121.15, 40.34], [-121.15, 40.29]]] }, properties: { poly_IncidentName: 'BAILEY', poly_GISAcres: 298.4 } }] };
const json = (r, body) => r.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
const empty = { type: 'FeatureCollection', features: [] };

const { b, page, errs } = await launch();
let sourcesDown = false;
await page.route('**/WFIGS_Incident_Locations_Current/**', r => json(r, sourcesDown ? empty : WFIGS));
await page.route('**/WFIGS_Interagency_Perimeters_Current/**', r => json(r, /CALMU-007049/.test(decodeURIComponent(r.request().url())) ? PERIM : empty));
await page.route('**/CA_EVACUATIONS_CalOESHosted_view/**', r => json(r, { features: [] }));
await page.route('https://api.weather.gov/alerts/active**', r => json(r, sourcesDown ? empty : NWS));
await page.route('https://www.fema.gov/api/open/v1/IpawsArchivedAlerts**', r => json(r, { IpawsArchivedAlerts: [] }));
await page.route('https://inciweb.wildfire.gov/incidents/rss.xml', r => r.fulfill({ body: sourcesDown ? '<rss><channel></channel></rss>' : RSS, contentType: 'application/rss+xml', headers: { 'access-control-allow-origin': '*' } }));
await page.route('https://api.bsky.app/xrpc/**', r => json(r, sourcesDown ? { posts: [] } : BSKY));
await page.route('https://mastodon.social/api/v1/timelines/tag/**', r => json(r, []));
await page.route('**/proxy/calfire/**', r => json(r, sourcesDown ? [] : CALFIRE));
console.log('Incident pages');
await page.evaluate(() => { localStorage.removeItem('nsgs.incidentPages.v1'); localStorage.removeItem('nsgs.incidents.v1'); });
await page.click('#tab-incidents');
await page.waitForSelector('#incRefresh'); await page.waitForFunction(() => !document.getElementById('incRefresh').disabled, null, { timeout: 30000 });
const cards = await page.$$eval('#incPages a.incpagecard', e => e.map(x => ({ key: x.dataset.key, t: x.textContent })));
console.log('   cards:', cards.map(c => c.key + ' :: ' + c.t));
check('two multi-source incidents get pages', cards.length === 2, cards);
check('ambiguous same-name evacuation and post attach only where the county matches', !cards.some(c => /Riverside|Lane/.test(c.t)));
const bailey = cards.find(c => /Bailey/.test(c.t));
check('NIFC + CAL FIRE + NWS + social merged into one Bailey page', bailey && bailey.key === '2026-calmu-007049' && /NIFC/.test(bailey.t) && /CAL FIRE/.test(bailey.t) && /NWS/.test(bailey.t) && /Social/.test(bailey.t) && /Evacuations/.test(bailey.t));
check('NIFC + InciWeb merged for Foot Creek', cards.some(c => /Foot Creek/.test(c.t) && /InciWeb/.test(c.t)));
check('same-name fires in another county or state stay separate (no page)', !cards.some(c => /Riverside|Lane/.test(c.t)));
check('roundup post naming 3 incidents does not count as a source', !cards.some(c => /Prairie/.test(c.t)) && !/Social/.test((cards.find(c => /Foot Creek/.test(c.t)) || {}).t));
check('old social post does not create a page for a new fire', !cards.some(c => /Prairie/.test(c.t)));
check('dispatch-code names are never matched', !cards.some(c => /LAC-406202/.test(c.t)));
check('fire table links to the page', (await page.$$('#incFires a[href="#/incident/2026-calmu-007049"]')).length >= 1);
await page.click('#incPages a[data-key="2026-calmu-007049"]');
await page.waitForSelector('#ipName'); await page.waitForFunction(() => /Perimeter: NIFC/.test((document.getElementById('ipPerNote') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
check('page route keeps the Incident Detection tab active', await page.evaluate(() => document.querySelector('#tab-incidents').classList.contains('active') && location.hash === '#/incident/2026-calmu-007049'));
check('page title uses the CAL FIRE name', (await page.textContent('#ipName')) === 'Bailey Fire');
check('page is LIVE with 4 sources', /LIVE · 4 sources/.test(await page.textContent('#ipLive')));
const rows = await page.$$eval('#ipReports tbody tr', e => e.map(x => x.dataset.src + ':' + x.children[2].textContent));
check('source reports shown side by side, not merged', rows.join() === 'wfigs:250 ac,calfire:310 ac', rows);
check('size disagreement is flagged', !!(await page.$('#ipDisagree')));
check('linked evacuation shown', /Evacuation Immediate issued for Bailey Fire/.test(await page.textContent('#ipEvac')));
check('social mention shown and labeled unverified', /Crews responding to the Bailey Fire/.test(await page.textContent('#ipSocial')));
check('roundup post still listed on the page, marked', /Large fires tonight/.test(await page.textContent('#ipSocial')) && /roundup/.test(await page.textContent('#ipSocial')));
check('ambiguous post (three Bailey fires, no county) is not attached', !/smoke is wild/.test(await page.textContent('#ipSocial')));
check('timeline lists discovery and evacuation', /Discovered/.test(await page.textContent('#ipTimeline')) && /Evacuation order/.test(await page.textContent('#ipTimeline')));
check('perimeter found', /Perimeter: NIFC \/ WFIGS, 298 ac mapped/.test(await page.textContent('#ipPerNote')), await page.textContent('#ipPerNote'));
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
await page.click('#ipCopy'); const clip = await page.evaluate(() => navigator.clipboard.readText());
check('copy summary attributes each figure', /BAILEY FIRE \(Plumas County, CA\)/.test(clip) && /NIFC: 250 ac, 10% contained/.test(clip) && /CAL FIRE: 310 ac, 5% contained/.test(clip) && /Evacuation order: .*\(NWS/.test(clip), clip);
check('make graphic enabled with a perimeter', await page.isEnabled('#ipGraphic'));
await page.click('#ipGraphic'); await page.waitForFunction(() => location.hash.startsWith('#/edit/'), null, { timeout: 30000 }).catch(() => {});
check('make graphic opens an editable project', await page.evaluate(() => location.hash.startsWith('#/edit/')));
const proj = await page.evaluate(async () => { const ps = await NS.Store.all('projects'); const p = ps.find(x => x.templateId === 'incident-perimeter'); const m = p && p.objects.find(o => o.type === 'MapFrame'); return p && { name: p.name, layer: m && m.mapState.layerOrder.includes('nifc-fire'), feats: m && m.mapState.layerData['nifc-fire'].data.features.length }; });
check('project holds the NIFC perimeter as map data', proj && proj.name === 'Bailey Fire perimeter' && proj.layer && proj.feats === 1, proj);
// Snapshot survives when the incident leaves the feeds.
sourcesDown = true;
await page.evaluate(() => { location.hash = '#/incident/2026-calmu-007049'; }); await page.reload(); await page.waitForFunction(() => window.NS && NS.App, null, { timeout: 15000 });
await page.waitForFunction(() => /Snapshot/.test((document.getElementById('ipLive') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
check('page persists as a snapshot after the incident leaves the feeds', /Snapshot .* no longer in the feeds/.test(await page.textContent('#ipLive')) && (await page.textContent('#ipName')) === 'Bailey Fire');
await page.goto(page.url().replace(/#.*$/, '#/incident/nope-123')); await page.waitForTimeout(1500);
check('unknown page ID says so', /Incident page not found/.test(await page.textContent('#main')));
await page.goto(page.url().replace(/#.*$/, '#/incident/2026-calmu-007049')); await page.waitForSelector('#ipDelete');
page.once('dialog', d => d.accept());
await page.click('#ipDelete'); await page.locator('dialog .btn.danger').click();
await page.waitForFunction(() => location.hash === '#/incidents', null, { timeout: 5000 }).catch(() => {});
check('remove page deletes it', await page.evaluate(() => !JSON.parse(localStorage.getItem('nsgs.incidentPages.v1')).pages['2026-calmu-007049']));
const bad = errs.filter(e => !/Failed to load resource|net::|HTTP \d+|CORS|Incident map|mapbox|WebGL/i.test(e));
console.log('page errors:', bad);
check('no unexpected page errors', bad.length === 0);
await b.close(); process.exit(summary() ? 1 : 0);
