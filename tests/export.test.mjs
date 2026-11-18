import { launch, check, summary, clickDownload } from './lib.mjs';
import fs from 'fs';
const dpr = +(process.env.DPR || 1);
const { b, page, errs } = await launch({ dpr });
const ev = (fn, arg) => page.evaluate(fn, arg);
console.log('Export (device pixel ratio ' + dpr + ')');
function pngInfo(buf) { return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colorType: buf[25] }; }
async function download(clickSel) { const d = await clickDownload(page, clickSel); const p = await d.path(); return { name: d.suggestedFilename(), buf: fs.readFileSync(p) }; }
// project with full-bleed rect + edge text
await page.click('#nav a[data-r=studio]'); await page.click('text=Full HD 1920 × 1080'); await page.waitForSelector('#workspace canvas'); await page.waitForTimeout(600);
await ev(() => { const e = NS.App.editor.ed; e.addShape('rect', { left: 0, top: 0, width: 1920, height: 1080, fill: '#ff0000', rx: 0, ry: 0 }); e.addText('EDGE', { left: 1700, top: 960, fontSize: 90, fill: '#00ff00', width: 220 }); e.canvas.discardActiveObject(); e.commit(); });
// PNG 1x via UI
await page.click('#exportBtn'); await page.waitForSelector('#renderPreview'); await page.selectOption('dialog select[aria-label=Format]', 'png'); await page.selectOption('dialog select[aria-label=Scale]', '1'); await page.click('#renderPreview'); await page.waitForSelector('#exportDownload:not([disabled])', { timeout: 20000 });
let d = await download('#exportDownload'); let i = pngInfo(d.buf);
check('PNG export is exactly 1920x1080', i.w === 1920 && i.h === 1080, i); check('PNG filename carries size', /1920x1080\.png$/.test(d.name), d.name);
// decode pixels
const px = async (buf) => ev(async (b64) => { const bl = await (await fetch('data:image/png;base64,' + b64)).blob(); const bm = await createImageBitmap(bl); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0); const g = (X, Y) => Array.from(x.getImageData(X, Y, 1, 1).data); return { tl: g(0, 0), br: g(bm.width - 1, bm.height - 1), tr: g(bm.width - 1, 0), bl: g(0, bm.height - 1) }; }, buf.toString('base64'));
let p = await px(d.buf); check('design not clipped: all four corners painted red', [p.tl, p.br, p.tr, p.bl].every(c => c[0] > 240 && c[1] < 20 && c[3] === 255), p);
// text near right/bottom edge present
const edgeGreen = await ev(async () => { const r = await NS.Export.render(NS.App.editor.ed.syncProject(), { format: 'png', scale: 1 }); const bm = await createImageBitmap(r.blob); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0); const d = x.getImageData(1700, 950, 220, 130).data; let n = 0; for (let k = 0; k < d.length; k += 4) if (d[k + 1] > 200 && d[k] < 60) n++; return n; });
check('text near the edge rendered (green pixels found)', edgeGreen > 200, edgeGreen);
// 2x
await page.selectOption('dialog select[aria-label=Scale]', '2'); await page.click('#renderPreview'); await page.waitForSelector('#exportDownload:not([disabled])', { timeout: 30000 }); await page.waitForFunction(() => /3840 × 2160 px/.test(document.querySelector('dialog').innerText)); d = await download('#exportDownload'); i = pngInfo(d.buf);
check('2x export is 3840x2160', i.w === 3840 && i.h === 2160, i);
// JPEG
await page.selectOption('dialog select[aria-label=Format]', 'jpeg'); await page.selectOption('dialog select[aria-label=Scale]', '1'); await page.click('#renderPreview'); await page.waitForSelector('#exportDownload:not([disabled])', { timeout: 30000 }); await page.waitForFunction(() => /JPEG ·/.test(document.querySelector('dialog').innerText)); d = await download('#exportDownload');
check('JPEG export has JPEG signature and name', d.buf[0] === 0xff && d.buf[1] === 0xd8 && /\.jpg$/.test(d.name), d.name);
const jd = await ev(async (b64) => { const bm = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + b64)).blob()); return [bm.width, bm.height]; }, d.buf.toString('base64')); check('JPEG is 1920x1080', jd[0] === 1920 && jd[1] === 1080, jd);
// SVG
await page.selectOption('dialog select[aria-label=Format]', 'svg'); await page.click('#renderPreview'); await page.waitForSelector('#exportDownload:not([disabled])', { timeout: 30000 }); await page.waitForFunction(() => /SVG ·/.test(document.querySelector('dialog').innerText)); d = await download('#exportDownload');
check('SVG export contains shapes and text', /<svg/.test(d.buf.toString()) && /EDGE/.test(d.buf.toString()) && /viewBox="0 0 1920 1080"/.test(d.buf.toString()), d.buf.toString().slice(0, 200));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
// transparent PNG from template
await page.goto(page.url().split('#')[0] + '#/dashboard'); await page.waitForTimeout(500);
await ev(() => NS.App.newFromTemplate('bc-lower3')); await page.waitForSelector('#workspace canvas'); await page.waitForTimeout(1200);
check('lower-third template has transparent background', await ev(() => NS.App.editor.ed.p.canvas.bg.transparent === true));
await page.click('#exportBtn'); await page.waitForSelector('#renderPreview'); await page.click('#renderPreview'); await page.waitForSelector('#exportDownload:not([disabled])', { timeout: 20000 });
check('transparent checkbox is ticked by default', await page.locator('dialog input[type=checkbox]').first().isChecked());
d = await download('#exportDownload'); i = pngInfo(d.buf);
check('transparent PNG has alpha channel (RGBA)', i.colorType === 6 && i.w === 1920, i);
p = await px(d.buf); check('transparency preserved in file: corner pixel alpha is 0', p.tl[3] === 0 && p.br[3] === 0, p);
const solid = await ev(async () => { const r = await NS.Export.render(NS.App.editor.ed.syncProject(), { format: 'png', scale: 1, transparent: true }); return { alpha: r.info.hasAlpha, clear: r.info.clearFraction, warns: r.warnings }; });
check('verify() detects transparent pixels and design pixels', solid.alpha && solid.clear > 0.5 && solid.clear < 0.99, solid);
// opaque export of transparent design
const opq = await ev(async () => { const r = await NS.Export.render(NS.App.editor.ed.syncProject(), { format: 'png', scale: 1, transparent: false }); return { alpha: r.info.hasAlpha, warns: r.warnings }; });
check('opaque export of transparent design has no alpha and warns', !opq.alpha && opq.warns.length > 0, opq);
check('sample-content warning shown for template sample badge', await ev(() => NS.Export.sampleCount(NS.App.editor.ed.syncProject())) > 0);
await page.keyboard.press('Escape');
console.log(errs.join('\n') || 'no page errors');
const f = summary(); await b.close(); process.exit(f ? 1 : 0);
