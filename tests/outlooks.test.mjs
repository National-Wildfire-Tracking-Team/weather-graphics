import { launch, check, summary } from './lib.mjs';
const { b, page, errs } = await launch();
const ev = (fn, arg) => page.evaluate(fn, arg);
console.log('WPC Excessive Rainfall Outlooks');
check('ERO Day 1-5 providers registered', await ev(() => ['ero-d1', 'ero-d2', 'ero-d3', 'ero-d4', 'ero-d5'].every(id => NS.Providers.some(p => p.id === id))));
// Live fetch: every day must return without error; features (if any) carry WPC's class and colors.
const days = await ev(async () => Promise.all(['ero-d1', 'ero-d2', 'ero-d3', 'ero-d4', 'ero-d5'].map(async id => {
  try { const fc = await NS.Providers.find(p => p.id === id).fetch(); return { id, n: fc.features.length, ok: fc.features.every(f => [1, 2, 3, 4].includes(f.properties.dn) && /^#/.test(f.properties.color) && f.properties.stroke) }; }
  catch (e) { return { id, err: e.message }; }
})));
console.log('   ', JSON.stringify(days));
check('all five ERO days fetch without error', days.every(d => !d.err), days);
check('ERO features carry WPC risk class and colors', days.every(d => d.ok !== false));
const withData = days.find(d => d.n);
if (withData) {
  await page.click('#nav a[data-r=map]'); await page.waitForSelector('#createMap');
  await page.selectOption('#mapRegion', 'Lower 48'); await page.click('#createMap');
  await page.waitForSelector('#mapStudio #msMap .mapboxgl-canvas', { timeout: 30000 }); await page.waitForTimeout(3000);
  await page.fill('#lyrFilter', 'Excessive Rainfall'); await page.waitForTimeout(300);
  check('layer filter finds all five ERO layers', await page.locator('[id^=lyr-ero-]').count() === 5);
  await page.check('#lyr-' + withData.id); await page.waitForTimeout(6000);
  const r = await ev(id => { const m = NS.MapStudio.current; return { snap: (m.state.layerData[id] && m.state.layerData[id].data.features.length) || 0, layers: m.map.getStyle().layers.map(l => l.id).filter(l => l.includes(id)), legend: NS.legendEntries(m.state).map(e => e.title) }; }, withData.id);
  console.log('   ', JSON.stringify(r));
  check('enabled ERO layer is snapshotted and drawn on the map', r.snap === withData.n && r.layers.length >= 2, r);
  check('legend lists the ERO risk categories', r.legend.length > 0 && r.legend.every(t => /^\d\/4 (MARGINAL|SLIGHT|MODERATE|HIGH)$/.test(t)), r.legend);
  await page.screenshot({ path: '/tmp/claude-0/shot-ero.png' });
} else console.log('   (no ERO risk areas issued right now; map/legend checks skipped)');
check('no page errors', !errs.length, errs);
await b.close(); process.exit(summary() ? 1 : 0);
