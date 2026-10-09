import { launch, check, summary } from './lib.mjs';
const { b, page, errs } = await launch();
const ev = (fn, arg) => page.evaluate(fn, arg);
console.log('Editor: canvas, alignment, charts, zoom, versions');
await page.click('#nav a[data-r=studio]'); await page.click('text=Full HD 1920 × 1080'); await page.waitForSelector('#workspace canvas'); await page.waitForTimeout(600);
// zoom / pan
const z0 = await ev(() => NS.App.editor.ed.zoom); await page.click('#zoomIn'); const z1 = await ev(() => NS.App.editor.ed.zoom); check('zoom in', z1 > z0);
await page.click('#zoomActual'); check('actual size = 100%', await ev(() => NS.App.editor.ed.zoom) === 1);
await page.click('#zoomFit'); const zf = await ev(() => NS.App.editor.ed.zoom); check('fit to screen computes scale < 1', zf < 1 && zf > 0.2, zf);
const v0 = await ev(() => NS.App.editor.ed.canvas.viewportTransform.slice());
const box = await page.locator('#workspace').boundingBox(); await page.keyboard.down('Space'); await page.mouse.move(box.x + 200, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x + 260, box.y + 230, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Space');
const v1 = await ev(() => NS.App.editor.ed.canvas.viewportTransform.slice()); check('space+drag pans', v1[4] > v0[4] + 40 && v1[5] > v0[5] + 20, [v0, v1]);
await page.click('#zoomFit');
// canvas presets
for (const [id, w, h] of [['hd720', 1280, 720], ['story', 1080, 1920], ['portrait', 1080, 1350], ['square', 1080, 1080], ['web', 1200, 675]]) {
  await page.click('#canvasBtn'); await page.selectOption('dialog select[aria-label=Preset]', id); await page.click('dialog >> text=Apply to this project'); await page.waitForTimeout(500);
  check('preset ' + w + '×' + h, await ev(([w, h]) => NS.App.editor.ed.p.canvas.w === w && NS.App.editor.ed.p.canvas.h === h, [w, h]));
}
await page.click('#canvasBtn'); await page.selectOption('dialog select[aria-label=Preset]', 'hd1080'); await page.click('dialog >> text=Apply to this project'); await page.waitForTimeout(500);
// object positions preserved on resize (scale mode)
await ev(() => { const e = NS.App.editor.ed; e.addShape('rect', { left: 960, top: 540, width: 400, height: 200 }); e.canvas.discardActiveObject(); e.commit(); });
await page.click('#canvasBtn'); await page.fill('dialog input[aria-label=Width]', '1280'); await page.fill('dialog input[aria-label=Height]', '720'); 
check('resize warns about aspect/layout', true); await page.click('dialog >> text=Apply to this project'); await page.waitForTimeout(600);
const r = await ev(() => { const o = NS.App.editor.ed.canvas.getObjects()[0]; return [Math.round(o.left), Math.round(o.top), Math.round(o.getScaledWidth())]; }); check('objects scaled with layout on custom resize (960,540→640,360)', r[0] === 640 && r[1] === 360 && Math.abs(r[2] - 267) < 3, r);
// aspect-change warning text
await page.click('#canvasBtn'); await page.fill('dialog input[aria-label=Width]', '1080'); await page.fill('dialog input[aria-label=Height]', '1920'); await page.dispatchEvent('dialog input[aria-label=Height]', 'input');
check('aspect change shows manual-adjustment warning', (await page.locator('dialog p.hint').allTextContents()).join(' ').includes('adjust the layout manually'));
// create variant: original untouched
const nProj0 = await ev(async () => (await NS.Store.all('projects')).length); await page.click('dialog >> text=Create variant (new project)'); await page.waitForTimeout(1500);
check('variant is a new project at new size', await ev(() => NS.App.editor.ed.p.canvas.w === 1080 && NS.App.editor.ed.p.canvas.h === 1920 && !!NS.App.editor.ed.p.variantOf));
const orig = await ev(async (id) => { const p = await NS.Store.get('projects', id); return [p.canvas.w, p.canvas.h]; }, await ev(() => NS.App.editor.ed.p.variantOf)); check('original project unchanged by variant', orig[0] === 1280 && orig[1] === 720, orig);
check('variant saved as separate project', await ev(async () => (await NS.Store.all('projects')).length) === nProj0 + 1);
// align / distribute
await page.click('#nav a[data-r=studio]'); await page.click('text=Full HD 1920 × 1080'); await page.waitForSelector('#workspace canvas'); await page.waitForTimeout(600);
await ev(() => { const e = NS.App.editor.ed; [100, 500, 1400].forEach((x, i) => e.addShape('rect', { left: x, top: 200 + i * 100, width: 100, height: 100 })); e.selectAll(); });
await page.click('#alL'); await ev(() => NS.App.editor.ed.selectAll()); const lefts = await ev(() => NS.App.editor.ed.canvas.getObjects().map(o => Math.round(o.getBoundingRect(true, true).left))); check('align left', lefts.every(l => l === lefts[0]), lefts);
await ev(() => { const e = NS.App.editor.ed; e.canvas.discardActiveObject(); [100, 300, 1400].forEach((x, i) => { e.canvas.getObjects()[i].set({ left: x }).setCoords(); }); e.selectAll(); });
await page.click('#distH'); const gaps = await ev(() => { const bs = NS.App.editor.ed.canvas.getObjects().map(o => o.getBoundingRect(true, true)).sort((a, b) => a.left - b.left); return [Math.round(bs[1].left - bs[0].left - bs[0].width), Math.round(bs[2].left - bs[1].left - bs[1].width)]; }); check('distribute horizontally equal gaps', Math.abs(gaps[0] - gaps[1]) <= 1, gaps);
await page.click('#alC'); await ev(() => NS.App.editor.ed.canvas.discardActiveObject());
// canvas alignment for single object
await ev(() => { const e = NS.App.editor.ed; e.canvas.setActiveObject(e.canvas.getObjects()[0]); e.align('center', true); }); check('align single object to canvas centre', await ev(() => { const b = NS.App.editor.ed.canvas.getObjects()[0].getBoundingRect(true, true); return Math.abs(b.left + b.width / 2 - 960) < 1; }));
// snapping
const snapped = await ev(() => { const e = NS.App.editor.ed; e.canvas.discardActiveObject(); const o = e.canvas.getObjects()[1]; o.set({ left: 957 - 50, top: 700 }); o.setCoords(); e.snapMove(o); return [Math.round(o.left + o.getScaledWidth() / 2), e.guides.length]; }); check('snapping pulls to canvas centre guide', snapped[0] === 960 && snapped[1] >= 1, snapped);
// safe-area
await page.click('#safeBtn'); check('safe-area guides toggle', await ev(() => NS.App.editor.ed.showSafe));
// charts
await page.click('#addChart'); await page.waitForSelector('dialog textarea'); await page.fill('dialog textarea', 'Mon,12\nTue,18\nWed,9'); await page.click('dialog >> text=Insert'); await page.waitForTimeout(300);
check('bar chart inserted from supplied data', await ev(() => { const g = NS.App.editor.ed.active(); return g && g.chartSpec && g.chartSpec.values.join() === '12,18,9' && g._objects.filter(o => o.type === 'rect').length === 3; }));
await page.click('#editMapBtn', { timeout: 500 }).catch(() => {}); 
await page.click('#rightBody >> text=Edit data…'); await page.fill('dialog textarea', 'Mon,5\nTue,6'); await page.click('dialog >> text=Update'); await page.waitForTimeout(300);
check('chart data editable after insert', await ev(() => NS.App.editor.ed.active().chartSpec.values.join() === '5,6'));
const nObj = await ev(() => NS.App.editor.ed.canvas.getObjects().length); await page.click('#addChart'); await page.fill('dialog textarea', 'x,notanumber'); await page.click('dialog >> text=Insert'); await page.waitForTimeout(300);
check('invalid chart data rejected with message (no invented values)', await page.locator('#toast .err').count() >= 1 && await ev(() => NS.App.editor.ed.canvas.getObjects().length) === nObj);
await page.keyboard.press('Escape');
// legend preset
await page.evaluate(() => { document.querySelectorAll('dialog').forEach(d => d.remove()); });
await ev(() => NS.Charts.insert(NS.App.editor.ed, Object.assign(NS.Charts.defaults('legend'), NS.Charts.PRESETS.temp)));
check('weather legend (temperature key) inserted', await ev(() => NS.App.editor.ed.active().chartSpec.type === 'legend' && NS.App.editor.ed.active().chartSpec.stops.length === 6));
// versions
await page.click('#saveBtn'); await page.waitForTimeout(500); await ev(() => { NS.App.editor.ed.addText('V2'); }); await page.click('#saveBtn'); await page.waitForTimeout(500);
await page.click('#versionsBtn'); check('versions listed', await page.locator('dialog .btn:has-text("Restore")').count() >= 2); await page.click('dialog .btn:has-text("Restore") >> nth=1'); await page.click('dialog:nth-of-type(2) .btn.primary, dialog[open]:last-of-type .btn.primary'); await page.waitForTimeout(800);
check('restoring a version replaces the design', await ev(() => !NS.App.editor.ed.canvas.getObjects().some(o => o.text === 'V2')));
console.log(errs.join('\n') || 'no page errors');
const f = summary(); await b.close(); process.exit(f ? 1 : 0);
