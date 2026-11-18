import { launch, check, summary, BASE, clickDownload } from './lib.mjs';
import fs from 'fs';
const { b, page, errs } = await launch();
const ev = (fn, arg) => page.evaluate(fn, arg);
const root = BASE.split('#')[0];
console.log('OBS live-production workflow (Phase 1)');
const pngInfo = buf => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colorType: buf[25], bytes: buf.length });
const corner = buf => ev(async b64 => { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob()); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0); return [x.getImageData(0, 0, 1, 1).data[3], x.getImageData(bm.width - 1, bm.height - 1, 1, 1).data[3]]; }, buf.toString('base64'));
async function openTemplate(id) { await page.goto(root + '#/dashboard'); await page.waitForTimeout(300); await ev(id => NS.App.newFromTemplate(id), id); await page.waitForSelector('#workspace canvas'); await page.waitForTimeout(1200); }
async function render(dest) { await page.click('#exportBtn'); await page.waitForSelector('#renderPreview'); await page.selectOption('dialog select[aria-label=Destination]', dest); await page.click('#renderPreview'); await page.waitForSelector('#exportDownload:not([disabled])', { timeout: 60000 }); return page.locator('dialog').first().innerText(); }
const close = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(200); };

// 1. Brand defaults from config.json (fresh browser profile, no saved Brand Settings)
check('config.json brand defaults apply when Brand Settings were never saved', await ev(async () => (await NS.getBrand()).orgName === 'NWTT' && (await NS.getBrand()).tagline === 'National Wildfire Tracking Team'));

// 2. Kit and template compatibility
const kit = await ev(async () => { const brand = await NS.getBrand(), out = { missing: [], wrongBg: [], wrongSize: [], n: NS.Broadcast.KIT.length };
  for (const k of NS.Broadcast.KIT) for (const [id, tg] of k.use) { const t = NS.Templates.list.find(x => x.id === id); if (!t) { out.missing.push(id); continue; }
    const p = await NS.Templates.instantiate(t, brand); if (p.canvas.w !== 1920 || p.canvas.h !== 1080) out.wrongSize.push(id);
    if (!!p.canvas.bg.transparent !== (tg === 'obs')) out.wrongBg.push(id + ' → ' + tg); if (!NS.Export.TARGETS[tg]) out.missing.push(tg); }
  return out; });
check('NWTT kit covers the 11 standard graphics', kit.n === 11, kit.n);
check('every kit template exists and every OBS target is defined', kit.missing.length === 0, kit.missing);
check('every kit template is 1920×1080', kit.wrongSize.length === 0, kit.wrongSize);
check('kit overlays are transparent and full-screen graphics opaque', kit.wrongBg.length === 0, kit.wrongBg);
const nwtt = await ev(async () => { const brand = await NS.getBrand(); return Promise.all(NS.Templates.list.filter(t => t.id.startsWith('nwtt-')).map(async t => { const p = await NS.Templates.instantiate(t, brand); return { id: t.id, samples: NS.Export.sampleCount(p), ready: NS.Export.readiness(p) }; })); });
check('NWTT templates contain no sample data (only [bracketed] placeholders)', nwtt.length === 7 && nwtt.every(t => t.samples === 0), nwtt);
check('holding cards are ready to air as built', ['nwtt-technical', 'nwtt-ending'].every(id => nwtt.find(t => t.id === id).ready.length === 0), nwtt.filter(t => /technical|ending/.test(t.id)));
check('incident templates demand an "as of" time and source', ['nwtt-incident-update', 'nwtt-wildfire-facts', 'nwtt-source', 'nwtt-evac-list'].every(id => { const r = nwtt.find(t => t.id === id).ready.join(' '); return /as of/i.test(r) && /Source/.test(r); }), nwtt);
const filled = await ev(async () => { const p = await NS.Templates.instantiate(NS.Templates.list.find(t => t.id === 'nwtt-incident-update'), await NS.getBrand());
  Object.assign(p.fields, { incident: 'Test Fire', update: 'Forward progress stopped per agency', asOf: '2026-11-18T09:30', source: 'TEST AGENCY' }); return NS.Export.readiness(p); });
check('readiness clears once placeholders and time are filled', filled.length === 0, filled);

// 3. OBS overlay export: transparent, 1920×1080, standard file name, OBS-ready
await openTemplate('nwtt-source');
await ev(() => { const e = NS.App.editor.ed; Object.assign(e.p.fields, { source: 'NIFC', asOf: '2026-11-18T09:30' }); e.applyFields(); });
let text = await render('obs');
check('overlay: "OBS-ready" shown for a clean transparent overlay', /OBS-ready: transparent overlay 1920×1080/.test(text), text.slice(0, 400));
check('overlay: dialog explains layer order and on-air updates', /TOP of the scene/.test(text) && /reloads the image automatically/.test(text));
check('overlay: dialog shows the standard file name', /NWTT_Source_Attribution_1920x1080_obs-overlay\.png/.test(text));
let d = await clickDownload(page, '#exportDownload', { confirm: false });
check('ready graphic downloads without a confirmation', !!d);
let buf = fs.readFileSync(await d.path()), i = pngInfo(buf);
check('overlay: file is 1920×1080 RGBA PNG', i.w === 1920 && i.h === 1080 && i.colorType === 6, i);
check('overlay: transparency preserved (corners alpha 0)', (await corner(buf)).every(a => a === 0));
check('overlay: file name is <project>_1920x1080_obs-overlay.png', d.suggestedFilename() === 'NWTT_Source_Attribution_1920x1080_obs-overlay.png', d.suggestedFilename());
await close();

// 4. Full-screen opaque export
await openTemplate('nwtt-technical');
text = await render('obs-full');
check('full-screen: "OBS-ready" shown', /OBS-ready: full-screen 1920×1080/.test(text));
check('full-screen: dialog says to keep it at the bottom of the scene', /BOTTOM of the scene/.test(text));
d = await clickDownload(page, '#exportDownload'); buf = fs.readFileSync(await d.path()); i = pngInfo(buf);
check('full-screen: 1920×1080 PNG, fully opaque', i.w === 1920 && i.h === 1080 && (await corner(buf)).every(a => a === 255), i);
check('full-screen: file name tagged _obs-full', d.suggestedFilename() === 'NWTT_Technical_Difficulties_1920x1080_obs-full.png', d.suggestedFilename());
await close();
const mapFull = await ev(async () => { const p = await NS.Templates.instantiate(NS.Templates.list.find(t => t.id === 'gn-blank-map'), await NS.getBrand()); const r = await NS.Export.render(p, NS.Export.targetOptions(p, 'obs-full')); return { w: r.w, h: r.h, alpha: r.info.hasAlpha, warns: r.warnings.filter(w => !/Font/.test(w)) }; });
check('full-screen map graphic: 1920×1080 opaque with no warnings', mapFull.w === 1920 && mapFull.h === 1080 && !mapFull.alpha && mapFull.warns.length === 0, mapFull);

// 5. Warnings that protect the frame
const wrong = await ev(async () => { const p = await NS.Templates.instantiate(NS.Templates.list.find(t => t.id === 'nwtt-ending'), await NS.getBrand()); const r = await NS.Export.render(p, NS.Export.targetOptions(p, 'obs')); return r.warnings; });
check('opaque design exported as OBS overlay warns it hides the scene', wrong.some(w => /hide everything below it/.test(w)), wrong);
const big = await ev(async () => { const p = NS.blankProject(1920, 1080, 'Big overlay'); p.canvas.bg = { transparent: true, color: '#00000000' }; p.objects.push(new fabric.Rect({ left: 0, top: 0, width: 1500, height: 900, fill: '#0C1119', opacity: 0.9 }).toObject(NS.PROPS)); const r = await NS.Export.render(p, NS.Export.targetOptions(p, 'obs')); return { warns: r.warnings, cover: r.info.coverFraction }; });
check('overlay covering most of the frame warns about obscuring content', big.warns.some(w => /covers \d+% of the frame/.test(w)) && big.cover > 0.6, big);
const small = await ev(async () => { const p = await NS.Templates.instantiate(NS.Templates.list.find(t => t.id === 'nwtt-wildfire-facts'), await NS.getBrand()); const r = await NS.Export.render(p, NS.Export.targetOptions(p, 'obs')); return { warns: r.warnings, cover: r.info.coverFraction }; });
check('edge overlays (fact panel) stay under the coverage limit', small.warns.length === 0 && small.cover < 0.2, small);

// 6. Confirmation before exporting sample/placeholder content
await openTemplate('bc-lower3');
text = await render('obs');
check('export dialog lists what is not ready to air', /Not ready to air/.test(text) && /sample-content/.test(text) && /Placeholder/.test(text));
d = await clickDownload(page, '#exportDownload', { confirm: false });
check('Cancel on the confirmation exports nothing', d === null);
d = await clickDownload(page, '#exportDownload');
check('"Export anyway" downloads the file', d && /_obs-overlay\.png$/.test(d.suggestedFilename()));
check('confirmation is asked once per dialog', await (async () => { const dl = page.waitForEvent('download', { timeout: 5000 }); await page.click('#exportDownload'); return !!(await dl); })());
await close();

// 7. Save over the OBS file in place (File System Access API, stubbed)
await openTemplate('nwtt-ending');
await ev(() => { window.__saves = []; window.__picks = 0; window.showSaveFilePicker = async o => { window.__picks++; const name = o.suggestedName; return { name, createWritable: async () => ({ write: async blob => window.__saves.push({ name, size: blob.size, type: blob.type }), close: async () => {} }) }; }; });
await render('obs-full');
check('"Save to folder…" offered where the browser supports it', await page.isVisible('#exportSaveAs'));
await page.click('#exportSaveAs'); await page.waitForTimeout(400);
check('"Overwrite <file>" offered after the first save', /Overwrite NWTT_Broadcast_Ending_1920x1080_obs-full\.png/.test(await page.innerText('#exportOverwrite')));
await page.click('#exportOverwrite'); await page.waitForTimeout(400);
const saves = await ev(() => ({ s: window.__saves, picks: window.__picks }));
check('overwrite reuses the same file without asking again', saves.picks === 1 && saves.s.length === 2 && saves.s.every(x => x.name === 'NWTT_Broadcast_Ending_1920x1080_obs-full.png' && x.type === 'image/png'), saves);
await close();

// 8. Project transfer keeps the name (and therefore the OBS file name)
await page.click('#backBtn').catch(() => {}); await page.goto(root + '#/projects'); await page.waitForSelector('#projGrid .tile');
const pf = await ev(async () => { const p = (await NS.Store.all('projects')).find(x => x.name === 'NWTT Broadcast Ending'); const blob = await NS.Export.projectFile(p); await NS.Store.del('projects', p.id); return { text: await blob.text(), name: p.name }; });
const tmp = '/tmp/nwtt-ending.nsgs.json'; fs.writeFileSync(tmp, pf.text);
await page.goto(root + '#/dashboard'); await page.goto(root + '#/projects'); await page.waitForSelector('#importProject');
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#importProject')]); await fc.setFiles(tmp); await page.waitForTimeout(800);
check('imported project keeps its name when there is no clash', await ev(async () => (await NS.Store.all('projects')).filter(x => x.name === 'NWTT Broadcast Ending').length === 1));
const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('#importProject')]); await fc2.setFiles(tmp); await page.waitForTimeout(800);
check('a second import of the same name is marked (imported)', await ev(async () => (await NS.Store.all('projects')).some(x => x.name === 'NWTT Broadcast Ending (imported)')));

// 9. Incident graphics keep the data time
const inc = await ev(async () => { const at = new Date('2026-11-18T09:42:00').getTime(); const p = await NS.Templates.alertGraphic(await NS.getBrand(), { title: 'TEST FIRE', subtitle: '', extent: [-122, 37, -121, 38], projection: 'mercator', layerId: 'nifc-fire', layerCfg: {}, data: { type: 'FeatureCollection', features: [] }, source: 'NIFC', asOf: at });
  const o = p.objects.find(x => x.fieldKey === 'validTime'); return { v: p.fields.validTime, tpl: o && o.fieldTpl, src: p.fields.source }; });
check('incident map graphic carries "DATA AS OF" the fetch time', inc.v === '2026-11-18T09:42' && inc.tpl === 'DATA AS OF {v}' && inc.src === 'NIFC', inc);

// 10. Docs: guide and onboarding render in the app; scenes and file names match the app
await page.goto(root + '#/obs'); await page.waitForSelector('.doc h1');
const guide = await page.innerText('.docview');
check('OBS guide renders in the app', /OBS Setup Guide/.test(guide) && await page.locator('.doc table').count() >= 3);
const scenes = await ev(() => NS.Broadcast.SCENES.map(s => s.name));
check('guide documents every recommended scene 00-10', scenes.length === 11 && scenes.every(s => guide.includes(s)), scenes.filter(s => !guide.includes(s)));
check('guide covers install, canvas, FPS, Restream and YouTube/X testing', ['Install OBS Studio', '1920x1080', '30', 'Restream.io', 'Test the YouTube and X outputs', 'Updating a graphic during a broadcast'].every(x => guide.includes(x)));
check('guide page includes the kit table', await page.locator('#nwttKit tbody tr').count() === 11);
const md = fs.readFileSync(new URL('../site/docs/obs-setup-guide.md', import.meta.url), 'utf8');
const names = await ev(async () => { const brand = await NS.getBrand(); return NS.Broadcast.KIT.flatMap(k => k.use).map(([id, tg]) => { const t = NS.Templates.list.find(x => x.id === id); return [t.name, NS.Export.fileName({ name: t.name }, { w: 1920, h: 1080, target: tg, ext: 'png' })]; }); });
const docRows = [...md.matchAll(/^\| [^|]+ \| ([^|]+) \| `([^`]+)` \|$/gm)].map(m => [m[1].trim(), m[2]]);
const bad = docRows.filter(([n, f]) => { const x = names.find(y => y[0] === n); return x && x[1] !== f; });
check('file-name table in the guide matches what the Studio exports', docRows.length >= 14 && bad.length === 0 && docRows.every(([n]) => names.some(y => y[0] === n) || n === 'LIVE indicator'), { bad, rows: docRows.length });
check('docs contain no stream keys or tokens', !/(\b[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}(-[a-z0-9]{4})?\b|\bre_\d+_[0-9a-f]{16,}|pk\.eyJ|sk\.eyJ|rtmps?:\/\/\S+\/\S{8,})/.test(md + fs.readFileSync(new URL('../site/docs/broadcaster-onboarding.md', import.meta.url), 'utf8')));
await page.click('a.chip:has-text("Broadcaster Onboarding")'); await page.waitForSelector('.doc h1:has-text("Broadcaster Onboarding")');
check('onboarding guide renders, links back to the OBS guide', await page.locator('.doc a[href="#/obs"]').count() >= 1);
check('sidebar has the OBS Setup Guide entry', await page.locator('#nav a[data-r=obs]').count() === 1);
const xss = await ev(() => { const el = NS.Broadcast.markdown('# <img src=x onerror=alert(1)>\n[click](javascript:alert(1))'); return { img: !!el.querySelector('img'), js: !!el.querySelector('a[href^="javascript"]') }; });
check('doc renderer never creates markup or javascript: links from text', !xss.img && !xss.js, xss);

console.log(errs.join('\n') || 'no page errors');
const f = summary(); await b.close(); process.exit(f ? 1 : 0);
