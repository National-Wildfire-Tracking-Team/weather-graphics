import { launch, check, summary } from './lib.mjs';
const { b, page, errs } = await launch();
const ev = (fn, arg) => page.evaluate(fn, arg);
console.log('Interactive map');
check('token loaded from config.json', await ev(() => !!NS.config.token && !!NS.config.style));
await page.click('#nav a[data-r=map]'); await page.waitForSelector('#createMap');
await page.selectOption('#mapRegion', 'Southeast'); await page.click('#createMap');
await page.waitForSelector('#mapStudio #msMap .mapboxgl-canvas', { timeout: 30000 }); await page.waitForTimeout(4000);
check('map studio opened with a real mapbox canvas', await page.locator('#msMap canvas.mapboxgl-canvas').count() === 1);
const st = () => ev(() => { const m = NS.MapStudio.current; return { z: m.map.getZoom(), c: m.map.getCenter().toArray(), loaded: m.map.loaded(), style: m.state.style, nl: m.map.getStyle().layers.map(l => l.id) }; });
let s0 = await st(); console.log('   style', s0.style, 'zoom', s0.z.toFixed(2), 'loaded', s0.loaded);
check('basemap style loaded (has water layer)', s0.nl.includes('water') || s0.nl.some(l => /water/.test(l)), s0.nl.slice(0, 10));
await page.screenshot({ path: '/tmp/claude-0/shot-map1.png' });
// zoom/pan
await ev(() => { const m = NS.MapStudio.current.map; m.jumpTo({ zoom: m.getZoom() + 1 }); m.panBy([100, 50], { duration: 0 }); });
const s1 = await st(); check('zoom and pan change view', s1.z > s0.z && (s1.c[0] !== s0.c[0]));
// switch style
await page.selectOption('#msStyle', 'dark'); await page.waitForTimeout(3500);
const s2 = await st(); check('style switch to Dark', s2.style === 'dark' && s2.nl.length > 10);
check('feature layers survive style switch', s2.nl.includes('ns-fill') && s2.nl.includes('ns-pts'));
// satellite
await page.selectOption('#msStyle', 'satellite-labels'); await page.waitForTimeout(3500);
check('satellite-with-labels style loaded', (await st()).style === 'satellite-labels');
await page.selectOption('#msStyle', 'dark'); await page.waitForTimeout(3000);
// search
await page.fill('#msSearch', 'Atlanta, Georgia'); await page.press('#msSearch', 'Enter'); await page.waitForTimeout(3000);
const nres = await page.locator('#msResults button').count(); check('geocoding returns results', nres > 0, nres);
if (nres) { await page.click('#msResults button >> nth=0'); await page.waitForTimeout(2500); const c = (await st()).c; check('search result moves map near Atlanta', Math.abs(c[0] + 84.4) < 3 && Math.abs(c[1] - 33.7) < 3, c); }
// drawing: marker
const box = await page.locator('#msMap').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.click('#tool-marker'); await page.mouse.click(cx, cy); await page.waitForTimeout(300);
let nf = () => ev(() => NS.MapStudio.current.state.features.features.map(f => f.properties.kind));
check('marker added', (await nf()).join() === 'marker');
await page.fill('#featLabel', 'Atlanta'); await page.waitForTimeout(200);
check('marker label editable', await ev(() => NS.MapStudio.current.state.features.features[0].properties.label === 'Atlanta'));
// line
await page.click('#tool-line'); await page.mouse.click(cx - 200, cy - 100); await page.mouse.click(cx - 100, cy - 150); await page.mouse.dblclick(cx, cy - 100); await page.waitForTimeout(300);
check('line drawn', (await nf()).includes('line'));
// polygon
await page.click('#tool-polygon'); for (const [dx, dy] of [[100, 50], [250, 50], [250, 150], [100, 150]]) await page.mouse.click(cx + dx, cy + dy); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
check('polygon drawn', (await nf()).includes('polygon'));
// circle
await page.click('#tool-circle'); await page.mouse.click(cx - 250, cy + 150); await page.mouse.click(cx - 150, cy + 150); await page.waitForTimeout(300);
check('circle drawn with radius', await ev(() => { const f = NS.MapStudio.current.state.features.features.find(f => f.properties.kind === 'circle'); return f && f.properties.radiusKm > 1 && f.geometry.coordinates[0].length > 20; }));
// arrow + track
await page.click('#tool-arrow'); await page.mouse.click(cx - 300, cy + 50); await page.mouse.dblclick(cx - 200, cy + 20); await page.waitForTimeout(300);
check('arrow drawn', (await nf()).includes('arrow'));
await page.click('#tool-track'); for (const [dx, dy] of [[-300, -200], [-250, -170], [-190, -150]]) await page.mouse.click(cx + dx, cy + dy); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
check('track drawn', (await nf()).includes('track'));
// select + edit + restyle
await page.click('#tool-select'); await page.mouse.click(cx, cy); await page.waitForTimeout(300);
check('click selects marker', await ev(() => NS.MapStudio.current.selId && NS.MapStudio.current.state.features.features.find(f => f.properties.id === NS.MapStudio.current.selId).properties.kind === 'marker'));
// drag marker
const before = await ev(() => NS.MapStudio.current.state.features.features[0].geometry.coordinates.slice());
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy + 30, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(300);
const after = await ev(() => NS.MapStudio.current.state.features.features[0].geometry.coordinates.slice());
check('marker can be dragged', before[0] !== after[0] && before[1] !== after[1], { before, after });
// delete
const nBefore = (await nf()).length; await page.click('#featDelete'); await page.waitForTimeout(200);
check('feature deleted', (await nf()).length === nBefore - 1);
// undo
await page.click('#msUndo'); await page.waitForTimeout(200); check('map undo restores feature', (await nf()).length === nBefore);
// geojson import
await ev(() => NS.MapStudio.current.importGeoJSON({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Test A', stroke: '#00ff00' }, geometry: { type: 'LineString', coordinates: [[-84, 33], [-83, 34]] } }, { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[[[-85, 32], [-84, 32], [-84, 33], [-85, 32]]], [[[-82, 32], [-81, 32], [-81, 33], [-82, 32]]]] } }] }));
check('GeoJSON import (incl. multipolygon split)', (await nf()).length === nBefore + 3, await nf());
check('import rejects bad GeoJSON', await ev(() => { try { NS.MapStudio.current.importGeoJSON({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [500, 500] } }] }); return false; } catch (e) { return /longitude/.test(e.message); } }));
// layers
await page.check('#lyr-radar-nexrad'); await page.waitForTimeout(3000);
check('radar raster layer added', await ev(() => !!NS.MapStudio.current.map.getLayer('ns-ov-radar-nexrad-raster')));
await page.check('#lyr-nws-tornado'); await page.waitForTimeout(6000);
const tw = await ev(() => ({ st: NS.statusFor(NS.MapStudio.current.state, NS.Providers.find(p => p.id === 'nws-tornado')), snap: !!NS.MapStudio.current.state.layerData['nws-tornado'] }));
console.log('   tornado layer status:', tw.st.state, tw.st.text); check('NWS layer reports real status (ok/empty), not fabricated', ['ok', 'empty'].includes(tw.st.state) && tw.snap, tw);
await page.uncheck('#lyr-radar-nexrad'); await page.waitForTimeout(500);
check('toggle layer off removes it', await ev(() => !NS.MapStudio.current.map.getLayer('ns-ov-radar-nexrad-raster')));
check('unconfigured layers are disabled', await page.locator('#lyr-wind-data').isDisabled());
// save/restore config
await page.click('#msSaveCfg'); await page.fill('dialog input', 'Test View'); await page.click('dialog .btn.primary'); await page.waitForTimeout(800);
check('map configuration saved', await page.locator('text=Test View').count() >= 1);
await page.screenshot({ path: '/tmp/claude-0/shot-map2.png' });
// apply
await page.click('#msApply'); await page.waitForTimeout(500);
check('map studio closed on apply', await page.locator('#mapStudio').count() === 0);
await page.waitForTimeout(5000);
const info = await ev(() => { const e = NS.App.editor.ed; const m = e.canvas.getObjects().find(o => o.type === 'MapFrame'); return { feats: m.mapState.features.features.length, img: NS.mapImages.get(m.id) && NS.mapImages.get(m.id).status, layers: Object.keys(m.mapState.layers), zoom: m.mapState.zoom }; });
check('map frame updated with features and re-rendered', info.feats >= 6 && info.img === 'ok', info);
await page.screenshot({ path: '/tmp/claude-0/shot-map3.png' });
console.log(errs.join('\n') || 'no page errors');
const f = summary(); await b.close(); process.exit(f ? 1 : 0);
