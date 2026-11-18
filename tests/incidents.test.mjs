import { launch, check, summary } from './lib.mjs';
// Incident Detection tab. Every source is stubbed so results are deterministic; CAL FIRE is forced to fail to prove errors surface.
const now = Date.now(), H = 3600000;
const WFIGS = { type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-121.12, 40.31] }, properties: { IncidentName: 'BAILEY', IncidentSize: 250, PercentContained: 10, POOState: 'US-CA', POOCounty: 'Plumas', FireDiscoveryDateTime: now - 2 * H, ModifiedOnDateTime_dt: now - H, UniqueFireIdentifier: '2026-CALMU-007049' } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-106.9, 44.3] }, properties: { IncidentName: 'Foot Creek', IncidentSize: 683, PercentContained: 40, POOState: 'US-WY', POOCounty: 'Johnson', FireDiscoveryDateTime: now - 5 * 24 * H, ModifiedOnDateTime_dt: now - 3 * H, UniqueFireIdentifier: '2026-WYBHF-000401' } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [-97.5, 35.4] }, properties: { IncidentName: 'Prairie', IncidentSize: 3, PercentContained: null, POOState: 'US-OK', POOCounty: 'Oklahoma', FireDiscoveryDateTime: now - 30 * 60000, ModifiedOnDateTime_dt: now - 20 * 60000, UniqueFireIdentifier: '2026-OKOKS-000101' } }] };
const NWS = { type: 'FeatureCollection', features: [
  { id: 'n1', type: 'Feature', geometry: null, properties: { id: 'n1', event: 'Evacuation Immediate', headline: 'Evacuation Immediate issued for Bailey Fire area', areaDesc: 'Plumas, CA', sent: new Date(now - H).toISOString(), expires: new Date(now + 5 * H).toISOString(), senderName: 'NWS Sacramento', description: 'Leave now via Highway 70.', instruction: 'Follow law enforcement directions.', geocode: { UGC: ['CAZ068'] } } },
  { id: 'n2', type: 'Feature', geometry: null, properties: { id: 'n2', event: 'Red Flag Warning', headline: 'Not an evacuation', areaDesc: 'x', sent: new Date(now).toISOString(), geocode: { UGC: ['CAZ211'] } } }] };
const CALOES = { features: [
  { attributes: { COUNTY: 'TULARE', ZONE_ID: 'US-CA-XTU-PVL-E044', STATUS: 'Evacuation Order', NOTES: 'Flooding', EDIT_DATE: now - 400 * 24 * H } },
  { attributes: { COUNTY: 'TULARE', ZONE_ID: 'US-CA-XTU-PVL-E036', STATUS: 'Evacuation Order', NOTES: 'Flooding', EDIT_DATE: now - 400 * 24 * H } }] };
const I = (id, sent, sender, codes, extra, msgType) => ({ id, sender, sent: new Date(sent).toISOString(), status: 'Actual', msgType: msgType || 'Alert', info: [Object.assign({ language: 'en-US', senderName: sender, event: 'Local Area Emergency',
  eventCode: codes.map(value => ({ name: 'SAME', value })), area: [{ areaDesc: 'Rio Grande County, CO', geocode: [{ name: 'SAME', value: '008105' }] }], parameter: [] }, extra)] });
const wea = t => [{ name: 'CMAMtext', value: t }];
const IPAWS = { IpawsArchivedAlerts: [
  I('i1', now - 2 * H, 'Rio_Grande_County_OEM', ['EVI'], { event: 'Evacuation Immediate', parameter: wea('Rio Grande Co: EVACUATE NOW Beaver Mtn Estates due to wildfire. Leave via CR 15.'), description: 'Go to the shelter at Del Norte High School.', web: 'https://example.gov/evac' }),
  I('i2', now - 3 * H, 'Rio_Grande_County_OEM', ['LAE'], { parameter: wea('Evacuation lifted for Willow Park. Residents may return.') }),
  I('i3', now - 3 * H, 'GDOT', ['LAE'], { parameter: wea('I-285 closed from exits 2 to 5.') }),
  I('i4', now - 3 * H, 'County_EMA', ['RWT'], { event: 'Required Weekly Test', parameter: wea('Test of evacuation alerting') }),
  I('i5', now - 3 * H, 'w-nws.webmaster@noaa.gov', ['EVI'], { event: 'Evacuation Immediate', parameter: wea('NWS relay duplicate') }),
  I('i6', now - 5 * H, 'Bexar_OEM', ['SPW'], { event: 'Shelter in Place Warning', parameter: wea('Shelter in place now: chemical fire near Loop 410.'), area: [{ areaDesc: 'AffectedArea', geocode: [{ name: 'SAME', value: '048029' }] }] })
] };
// A Spanish twin in the same record: the English info block must win.
IPAWS.IpawsArchivedAlerts[5].info.unshift({ language: 'es-US', event: 'Advertencia de Lugar de Refugio', eventCode: [{ name: 'SAME', value: 'SPW' }], parameter: wea('Refugio en el lugar'), area: [] });
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Foot Creek Fire</title><link>http://inciweb.wildfire.gov/incident-information/wybhf-foot-creek</link>
<description>The type of incident is Wildfire and involves the following unit(s) Bighorn NF. --- State: Wyoming --- Coordinates</description><pubDate>${new Date(now - 4 * H).toUTCString()}</pubDate></item></channel></rss>`;
const BSKY = { posts: [{ uri: 'at://did:plc:abc/app.bsky.feed.post/3xyz', author: { handle: 'ktvz.bsky.social', displayName: 'KTVZ News' }, record: { text: 'Crews responding to the Bailey Fire near Quincy, evacuation orders issued', createdAt: new Date(now - 40 * 60000).toISOString() } }] };
const MAST = [{ uri: 'https://m.example/1', url: 'https://m.example/@a/1', visibility: 'public', created_at: new Date(now - 2 * H).toISOString(), content: '<p>Smoke visible <script>alert(1)</script>near town <a href="#">#wildfire</a></p>', account: { acct: 'a@m.example', display_name: 'Alice' } }];
const json = (r, body) => r.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });

const { b, page, errs } = await launch();
await page.route('**/WFIGS_Incident_Locations_Current/**', r => json(r, WFIGS));
await page.route('**/CA_EVACUATIONS_CalOESHosted_view/**', r => json(r, CALOES));
await page.route('https://api.weather.gov/alerts/active**', r => json(r, NWS));
await page.route('https://www.fema.gov/api/open/v1/IpawsArchivedAlerts**', r => json(r, IPAWS));
await page.route('https://inciweb.wildfire.gov/incidents/rss.xml', r => r.fulfill({ body: RSS, contentType: 'application/rss+xml', headers: { 'access-control-allow-origin': '*' } }));
await page.route('https://api.bsky.app/xrpc/**', r => json(r, BSKY));
await page.route('https://mastodon.social/api/v1/timelines/tag/**', r => json(r, MAST));
await page.route('**/proxy/calfire/**', r => r.fulfill({ status: 404, body: 'nope' }));
await page.route('https://incidents.fire.ca.gov/**', r => r.abort());
console.log('Incident Detection');
await page.evaluate(() => localStorage.removeItem('nsgs.incidents.v1'));
await page.click('#tab-incidents');
await page.waitForSelector('#incRefresh'); await page.waitForFunction(() => !document.getElementById('incRefresh').disabled, null, { timeout: 30000 });
const src = await page.$$eval('#incSources .incsrcitem', e => Object.fromEntries(e.map(x => [x.dataset.src, x.textContent])));
check('all eight sources reported', Object.keys(src).length === 8, src);
check('IPAWS chip shows archive lag', /3 items · 2 h behind/.test(src.ipaws), src.ipaws);
check('failed CAL FIRE shows an error, not data', /error/.test(src.calfire) && /proxy\/calfire/.test(await page.textContent('#incFires')));
check('social sources are labeled unverified', /unverified/.test(src.bluesky) && /unverified/.test(src.mastodon));
const feed = await page.$$eval('#incFeed li', e => e.map(x => x.textContent));
check('feed has new fires, InciWeb update, NWS + IPAWS evacuations in the 24 h window', feed.length === 7, feed);
check('feed is newest first', /Prairie/.test(feed[0]), feed[0]);
check('old fire start is not in the feed', !feed.some(t => /New fire.*Foot Creek/.test(t)));
check('evacuation alert is in the feed', feed.some(t => /Evacuation order.*Bailey Fire area/i.test(t)));
check('IPAWS evacuation order in feed', feed.some(t => /Evacuation order.*EVACUATE NOW Beaver Mtn/.test(t)));
check('IPAWS lifted message labeled lifted', feed.some(t => /Evacuation lifted.*Willow Park/.test(t)));
check('IPAWS shelter-in-place uses the English message', feed.some(t => /Shelter in place.*chemical fire/.test(t)) && !feed.some(t => /Refugio/.test(t)));
const evacText = await page.textContent('#incEvac');
check('IPAWS road closures, tests and NWS duplicates filtered out', !/I-285|Test of evacuation|NWS relay duplicate/.test(evacText));
check('IPAWS lag note shown', /newest message is 2 h old/.test(evacText));
check('IPAWS items marked WEA', (await page.$$('#incEvac details[data-id^="ipaws"] .tag[title*="Wireless"]')).length === 3);
check('non-evacuation NWS events filtered out', !/Not an evacuation/.test(await page.textContent('#incEvac')));
check('stale Cal OES zone group flagged', /2 zones in Tulare County \(Flooding\)/.test(await page.textContent('#incEvac')) && /last edited/.test(await page.textContent('#incEvac')));
await page.locator('#incEvac details[data-id^="nws"] summary').click();
check('evacuation details show instructions', /Leave now via Highway 70/.test(await page.textContent('#incEvac')));
check('fire table lists NIFC incidents', (await page.$$('#incFires table tbody tr')).length === 3);
await page.selectOption('#incSort', 'size');
check('sort by size', /Foot Creek/.test(await page.locator('#incFires tbody tr').first().textContent()));
check('InciWeb item parsed with state', /Foot Creek Fire/.test(await page.textContent('#incInciweb')) && /WY/.test(await page.textContent('#incInciweb')));
await page.selectOption('#incState', 'CA');
check('state filter narrows fires', (await page.$$('#incFires tbody tr')).length === 1);
check('state filter narrows feed', (await page.$$eval('#incFeed li', e => e.length)) === 2);
await page.selectOption('#incState', 'TX');
check('IPAWS states come from SAME codes', /chemical fire/.test(await page.textContent('#incEvac')) && !/Beaver Mtn/.test(await page.textContent('#incEvac')));
await page.selectOption('#incState', 'CA');
await page.selectOption('#incSize', '1000');
check('size filter empties the table', /No incidents match/.test(await page.textContent('#incFires')));
await page.selectOption('#incSize', '0'); await page.selectOption('#incState', '');
check('Bluesky post cross-referenced to a verified incident', /mentions Bailey Fire/.test(await page.textContent('#incSocial')));
check('Mastodon HTML is reduced to text (no script element)', await page.evaluate(() => !document.querySelector('#incSocial script') && /Smoke visible\s*near town #wildfire/.test(document.getElementById('incSocial').textContent)));
check('external links open in a new tab', await page.$$eval('#main a[href^="http"]', e => e.length > 5 && e.every(a => a.target === '_blank' && a.rel === 'noopener')));
const reqs = []; page.on('request', r => reqs.push(r.url()));
await page.fill('#incTerms', 'brush fire'); await page.fill('#incTags', '#firewx');
await page.click('#incSocialApply'); await page.waitForTimeout(800);
check('custom terms and tags are searched', reqs.some(u => /searchPosts\?q=brush\+fire/.test(u)) && reqs.some(u => /tag\/firewx/.test(u)), reqs);
check('prefs persist', await page.evaluate(() => JSON.parse(localStorage.getItem('nsgs.incidents.v1')).tags[0] === 'firewx'));
await page.route('https://www.facebook.com/**', r => r.fulfill({ body: '<html><body>fb stub</body></html>', contentType: 'text/html' }));
check('Facebook embeds are not loaded until asked', (await page.$$('#incFacebook iframe')).length === 0 && /Show Facebook pages \(4\)/.test(await page.textContent('#incFbToggle')));
await page.click('#incFbToggle');
const fbSrc = await page.$$eval('#incFacebook iframe', e => e.map(x => x.src));
check('Facebook Page Plugin embeds for each listed page', fbSrc.length === 4 && fbSrc.every(u => u.startsWith('https://www.facebook.com/plugins/page.php?href=https%3A%2F%2Fwww.facebook.com%2F')), fbSrc);
await page.fill('#incFbPages', 'CALFIRE, https://evil.example/page'); await page.click('#incFbSave');
check('non-Facebook URLs are rejected', (await page.$$('#incFacebook iframe')).length === 4);
await page.fill('#incFbPages', 'https://m.facebook.com/CALFIRELNU/, facebook.com/CalOES'); await page.click('#incFbSave');
const fbPages = await page.$$eval('#incFacebook .incfbcol', e => e.map(x => x.dataset.page));
check('Facebook Page names and URLs normalized and saved', fbPages.join() === 'https://www.facebook.com/CALFIRELNU,https://www.facebook.com/CalOES' && JSON.parse(await page.evaluate(() => localStorage.getItem('nsgs.incidents.v1'))).fb.length === 2, fbPages);
check('Facebook is never counted as a detection source', !(await page.$('#incSources [data-src*="facebook"]')));
const bad = errs.filter(e => !/Failed to load resource|net::|HTTP \d+|CORS/.test(e));
console.log('page errors:', bad);
check('no unexpected page errors', bad.length === 0);
await b.close(); process.exit(summary() ? 1 : 0);
