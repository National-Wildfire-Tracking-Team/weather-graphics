import { launch, check, summary, BASE, clickDownload } from './lib.mjs';
import fs from 'fs';
const { b, page, errs } = await launch();
const ev = (fn, arg) => page.evaluate(fn, arg);
console.log('Streaming destinations (OBS / StreamYard)');
const pngInfo = buf => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colorType: buf[25], bytes: buf.length });
async function download(sel) { const d = await clickDownload(page, sel); return { name: d.suggestedFilename(), buf: fs.readFileSync(await d.path()) }; }
async function exportAs(dest) {
  await page.click('#exportBtn'); await page.waitForSelector('#renderPreview');
  await page.selectOption('dialog select[aria-label=Destination]', dest); await page.click('#renderPreview');
  await page.waitForSelector('#exportDownload:not([disabled])', { timeout: 30000 });
  const d = await download('#exportDownload'); const text = await page.locator('dialog').innerText(); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  return { ...d, info: pngInfo(d.buf), text };
}
// Transparent lower third
await ev(() => NS.App.newFromTemplate('bc-lower3')); await page.waitForSelector('#workspace canvas'); await page.waitForTimeout(1200);
let r = await exportAs('obs');
check('OBS: 1920x1080 RGBA PNG', r.info.w === 1920 && r.info.h === 1080 && r.info.colorType === 6, r.info);
check('OBS overlay: filename tagged _obs-overlay', /_1920x1080_obs-overlay\.png$/.test(r.name), r.name);
check('OBS: how-to shown', /Sources → \+ → Image/.test(r.text));
r = await exportAs('sy-overlay');
check('StreamYard overlay: 1280x720 RGBA PNG', r.info.w === 1280 && r.info.h === 720 && r.info.colorType === 6, r.info);
check('StreamYard overlay: under 20 MB', r.info.bytes < 20e6, r.info.bytes);
check('StreamYard overlay: filename tagged', /_1280x720_streamyard-overlay\.png$/.test(r.name), r.name);
check('StreamYard overlay: no cover-the-cameras warning for transparent design', !/cover the cameras/.test(r.text));
r = await exportAs('sy-background');
check('StreamYard background: 1280x720 opaque', r.info.w === 1280 && r.info.h === 720, r.info);
const alpha = await ev(async b64 => { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob()); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0); return x.getImageData(0, 0, 1, 1).data[3]; }, r.buf.toString('base64'));
check('StreamYard background: corner is opaque', alpha === 255, alpha);
// Opaque map design as overlay -> warning; map re-render at fractional ratio
await page.goto(BASE.split('#')[0] + '#/dashboard'); await page.waitForTimeout(500);
await ev(() => NS.App.newFromTemplate('bc-title')); await page.waitForSelector('#workspace canvas'); await page.waitForTimeout(1200);
r = await exportAs('sy-overlay');
check('opaque design as StreamYard overlay warns it covers cameras', /cover the cameras/.test(r.text));
// Non-16:9 canvas warns
const sq = await ev(async () => { const p = JSON.parse(JSON.stringify(NS.App.editor.ed.syncProject())); p.canvas.w = 1080; p.canvas.h = 1080; const r = await NS.Export.render(p, NS.Export.targetOptions(p, 'sy-background')); return { w: r.w, h: r.h, warns: r.warnings }; });
check('square design for StreamYard: fits 720 high and warns about distortion', sq.w === 720 && sq.h === 720 && sq.warns.some(w => /not 16:9/.test(w)), sq);
// Plate Builder 720p option
await page.goto(BASE.replace(/index\.html.*$/, 'plate-builder.html')); await page.waitForFunction(() => document.querySelector('canvas.mapboxgl-canvas'), null, { timeout: 30000 }); await page.waitForTimeout(4000);
await page.selectOption('#res', { label: '1280 × 720 (StreamYard)' });
const pd = await download('#exp'); const pi = pngInfo(pd.buf);
check('Plate Builder: 1280x720 plate', pi.w === 1280 && pi.h === 720, { ...pi, name: pd.name });
check('Plate Builder: status reports exact size', /Exported 1280×720/.test(await page.locator('#status').innerText().catch(() => '')), await page.locator('#status').innerText().catch(() => ''));
const prev = await ev(() => { const c = document.querySelector('canvas.mapboxgl-canvas'); return [c.width, c.height]; });
check('Plate Builder: preview canvas restored', prev[0] === 1920 && prev[1] === 1080, prev);
console.log(errs.join('\n') || 'no page errors');
const f = summary(); await b.close(); process.exit(f ? 1 : 0);
