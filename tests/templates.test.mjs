import { launch, check, summary } from './lib.mjs';
const { b, page, errs } = await launch();
const ev = (fn, arg) => page.evaluate(fn, arg);
console.log('Templates and projects');
const all = await ev(async () => {
  const brand = await NS.getBrand(); const out = { n: NS.Templates.list.length, bad: [], badFields: [], cats: {}, sizes: {} };
  for (const t of NS.Templates.list) {
    try { const p = await NS.Templates.instantiate(t, brand); out.cats[t.category] = (out.cats[t.category] || 0) + 1; out.sizes[p.canvas.w + 'x' + p.canvas.h] = 1;
      if (!p.objects.length) out.bad.push(t.id + ': empty');
      const keys = new Set(); (function w(a) { a.forEach(o => { if (o.fieldKey) keys.add(o.fieldKey); w(o.objects || []); }); })(p.objects);
      keys.forEach(k => { if (!(k in p.fields) && k !== 'org') out.badFields.push(t.id + ':' + k); });
      const sc = new fabric.StaticCanvas(null, { width: p.canvas.w, height: p.canvas.h }); await new Promise(r => sc.loadFromJSON({ objects: JSON.parse(JSON.stringify(p.objects)) }, r)); if (sc.getObjects().length !== p.objects.length) out.bad.push(t.id + ': load mismatch'); sc.dispose();
    } catch (e) { out.bad.push(t.id + ': ' + e.message); }
  } return out; });
console.log('   ', all.n, 'templates', JSON.stringify(all.cats));
check('library has 60+ built-in templates', all.n >= 60, all.n); check('all templates instantiate and load', all.bad.length === 0, all.bad); check('all field-bound text has a field value', all.badFields.length === 0, all.badFields.slice(0, 8));
check('every category populated', ['weather', 'tropical', 'severe', 'breaking', 'broadcast', 'social', 'safety', 'general'].every(c => all.cats[c] > 0), all.cats);
const required = ['wx-current', 'wx-daily', 'wx-7day', 'wx-hourly', 'wx-hilo', 'wx-regional', 'wx-national', 'wx-temp-map', 'wx-rain', 'wx-snow', 'wx-wind', 'wx-heat', 'wx-cold', 'sv-outlook', 'sv-tornado', 'sv-svr', 'sv-ffw', 'tr-track', 'tr-update', 'wx-radar', 'wx-satellite', 'sv-damage', 'sv-flooding', 'sf-wildfire', 'sf-evac', 'wx-closures', 'bn-breaking', 'bn-developing', 'bn-live', 'bn-emergency', 'bn-presser', 'bn-roads', 'bn-psa', 'bn-incident', 'bn-stats', 'bn-quote', 'bn-reporter-loc', 'bc-interview', 'bn-headline', 'gn-lowerthird-web', 'bc-lower3', 'bc-nameplate', 'bc-reporter', 'bc-live', 'bc-strap', 'bc-title', 'bc-transition', 'bc-bug', 'bc-overlay', 'bc-videobg', 'bc-closing', 'bc-presenter', 'so-fb', 'so-ig', 'so-story', 'so-yt', 'so-ytc', 'so-short', 'so-x', 'so-web', 'so-article'];
const ids = await ev(() => NS.Templates.list.map(t => t.id)); check('all brief-listed template types present', required.every(r => ids.includes(r) || ids.includes(r.replace('wx-regional', 'wx-regional-cities'))), required.filter(r => !ids.includes(r)));
// UI: gallery search / filter / favorite
await page.click('#nav a[data-r=templates]'); await page.waitForSelector('#tplGrid .tile');
const n0 = await page.locator('#tplGrid .tile').count(); await page.fill('#tplSearch', 'tornado'); await page.waitForTimeout(200); const n1 = await page.locator('#tplGrid .tile').count();
check('keyword search filters templates', n1 > 0 && n1 < n0, [n0, n1]);
await page.fill('#tplSearch', ''); await page.click('.chip:has-text("Social media")'); await page.waitForTimeout(200); check('category filter shows only the 9 social templates', (await page.locator('#tplGrid .tile').count()) === 9, await page.locator('#tplGrid .tile').count());
await page.click('#tplGrid .tile >> nth=0 >> text=☆ Favorite'); await page.waitForTimeout(500); check('favorite toggles and persists', await ev(async () => (await NS.Store.get('settings', 'favorites')).ids.length) === 1);
// create from template, edit fields
await ev(() => NS.App.newFromTemplate('sv-tornado')); await page.waitForSelector('#workspace canvas'); await page.waitForTimeout(8000);
check('project created from template (map + header)', await ev(() => { const o = NS.App.editor.ed.canvas.getObjects(); return o.some(x => x.type === 'MapFrame') && o.some(x => x.name === 'Title'); }));
await page.click('#rightBody >> text=x', { timeout: 500 }).catch(() => {}); await page.click('.ptabs button:has-text("Fields")');
await page.fill('#rightBody input[aria-label="Title"]', 'Tornado Warning — Test County'); await page.waitForTimeout(300);
check('Fields tab edits title text live (uppercased)', await ev(() => NS.App.editor.ed.canvas.getObjects().find(o => o.name === 'Title').text === 'TORNADO WARNING — TEST COUNTY'));
check('placeholder/sample badge present', await ev(() => NS.App.editor.ed.canvas.getObjects().some(o => o.sample)));
// units
await ev(() => NS.App.newFromTemplate('wx-7day')); await page.waitForSelector('#workspace canvas'); await page.waitForTimeout(1000); await page.click('.ptabs button:has-text("Fields")');
const t0 = await ev(() => NS.App.editor.ed.canvas.getObjects().filter(o => o.fieldKey === 'i0v')[0].text); await page.selectOption('#rightBody select[aria-label="Temperature units"]', 'C'); await page.waitForTimeout(200);
const t1 = await ev(() => NS.App.editor.ed.canvas.getObjects().filter(o => o.fieldKey === 'i0v')[0].text); check('temperature unit toggle converts °F→°C', t0 === '70°' && t1 === '21°', [t0, t1]);
// valid time field
await page.fill('#rightBody input[type=datetime-local] >> nth=0', '2026-10-09T17:30'); await page.waitForTimeout(200);
check('valid time field formats into the header', await ev(() => NS.App.editor.ed.canvas.getObjects().some(o => o.fieldKey === 'validTime' && /OCT 9/.test(o.text))));
// edit template content then save as template, original unchanged
const origText = await ev(async () => JSON.stringify(NS.Templates.list.find(t => t.id === 'wx-7day').build(await NS.getBrand()).objects).length);
await ev(() => { const e = NS.App.editor.ed; e.addText('EXTRA LINE'); });
await page.click('#saveTplBtn'); await page.fill('dialog input', 'My 7-day'); await page.click('dialog .btn.primary'); await page.waitForTimeout(800);
check('project saved as reusable template', await ev(async () => (await NS.Store.all('templates')).some(t => t.name === 'My 7-day' && t.data.objects.some(o => o.text === 'EXTRA LINE'))));
check('built-in template unchanged after editing project', await ev(async () => JSON.stringify(NS.Templates.list.find(t => t.id === 'wx-7day').build(await NS.getBrand()).objects).length) === origText);
await page.click('#backBtn'); await page.waitForTimeout(600); await page.click('#nav a[data-r=templates]'); await page.waitForSelector('#tplGrid .tile'); 
check('user template listed in library', await page.locator('#tplGrid .tile:has-text("My 7-day")').count() === 1);
await page.click('#tplGrid .tile:has-text("My 7-day") >> text=Duplicate'); await page.locator('#tplGrid .tile:has-text("My 7-day (copy)")').waitFor({ timeout: 10000 }).catch(() => {});
check('template duplicated', await page.locator('#tplGrid .tile:has-text("My 7-day (copy)")').count() === 1);
const tid = await ev(async () => (await NS.Store.all('templates')).find(t => t.name === 'My 7-day').id);
await ev((id) => NS.App.newFromTemplate(id), tid); await page.waitForSelector('#workspace canvas'); await page.waitForTimeout(1000);
check('create project from user template keeps edits', await ev(() => NS.App.editor.ed.canvas.getObjects().some(o => o.text === 'EXTRA LINE')));
await ev(() => { NS.App.editor.ed.canvas.getObjects().find(o => o.text === 'EXTRA LINE').set('text', 'CHANGED'); NS.App.editor.ed.commit(); });
await page.click('#saveBtn'); await page.waitForTimeout(500);
check('editing the project does not alter the template', await ev(async () => (await NS.Store.all('templates')).find(t => t.name === 'My 7-day').data.objects.some(o => o.text === 'EXTRA LINE')));
// duplicate project + reopen map project
await page.click('#backBtn'); await page.waitForTimeout(500); await page.click('#nav a[data-r=projects]'); await page.waitForSelector('#projGrid .tile');
const np = await page.locator('#projGrid .tile').count(); await page.click('#projGrid .tile:has-text("Tornado") >> text=Duplicate'); await page.waitForTimeout(600);
check('project duplicated', await page.locator('#projGrid .tile').count() === np + 1);
await page.click('#projGrid .tile:has-text("copy") >> a'); await page.waitForSelector('#workspace canvas'); await page.waitForTimeout(8000);
check('reopened duplicate: map still an editable MapFrame with state', await ev(() => { const m = NS.App.editor.ed.canvas.getObjects().find(o => o.type === 'MapFrame'); return m && m.mapState.layers['nws-tornado'] && NS.mapImages.get(m.id).status === 'ok'; }));
check('reopened duplicate: fields preserved', await ev(() => NS.App.editor.ed.canvas.getObjects().find(o => o.name === 'Title').text === 'TORNADO WARNING — TEST COUNTY'));
// delete w/ confirmation
await page.click('#backBtn'); await page.click('#nav a[data-r=projects]'); await page.waitForSelector('#projGrid .tile'); const n2 = await page.locator('#projGrid .tile').count();
await page.click('#projGrid .tile >> nth=0 >> text=Delete'); await page.waitForSelector('dialog'); check('delete asks for confirmation', await page.locator('dialog:has-text("cannot be undone")').count() === 1);
await page.click('dialog >> text=Cancel'); await page.waitForTimeout(200); check('cancel keeps project', await page.locator('#projGrid .tile').count() === n2);
await page.click('#projGrid .tile >> nth=0 >> text=Delete'); await page.click('dialog .btn.danger'); await page.waitForTimeout(600); check('confirmed delete removes project', await page.locator('#projGrid .tile').count() === n2 - 1);
// search & sort
await page.fill('#projGrid >> xpath=../div[@class="bar"]//input', 'zzzz'); await page.waitForTimeout(200);
console.log(errs.join('\n') || 'no page errors');
const f = summary(); await b.close(); process.exit(f ? 1 : 0);
