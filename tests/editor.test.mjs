import { launch, check, summary } from './lib.mjs';
const { b, page, errs } = await launch();
const ev = (fn, arg) => page.evaluate(fn, arg);
const ed = () => 'NS.App.editor.ed';
console.log('Graphics editor');
await page.click('#nav a[data-r=studio]'); await page.click('text=Full HD 1920 × 1080'); await page.waitForSelector('#workspace canvas', { timeout: 10000 }); await page.waitForTimeout(800);
check('blank 1920x1080 canvas created', await ev(() => NS.App.editor.ed.p.canvas.w === 1920 && NS.App.editor.ed.p.canvas.h === 1080));
// add text
await page.click('#addText'); await page.waitForTimeout(150);
check('text added', await ev(() => NS.App.editor.ed.canvas.getObjects().length === 1 && NS.App.editor.ed.active().type === 'textbox'));
await ev(() => { const o = NS.App.editor.ed.active(); o.set({ text: 'HELLO', fontSize: 100, fill: '#ff0000' }); NS.App.editor.ed.canvas.fire('object:modified', { target: o }); });
check('text edited', await ev(() => NS.App.editor.ed.active().text === 'HELLO'));
// shapes
for (const id of ['#addRect', '#addCircle', '#addTri', '#addStar', '#addLine', '#addArrow']) await page.click(id);
check('6 shapes added (7 objects)', await ev(() => NS.App.editor.ed.canvas.getObjects().length === 7));
// properties panel shows for selection
check('props panel has text controls after selecting text', await (async () => { await ev(() => { const e = NS.App.editor.ed; e.canvas.setActiveObject(e.canvas.getObjects()[0]); }); await page.waitForTimeout(100); return (await page.locator('#rightBody select[aria-label="Font family"]').count()) === 1; })());
// font change
await page.selectOption('select[aria-label="Font family"]', 'Oswald'); await page.waitForTimeout(300);
check('font family changed', await ev(() => NS.App.editor.ed.active().fontFamily === 'Oswald'));
// layer order
const before = await ev(() => NS.App.editor.ed.canvas.getObjects().indexOf(NS.App.editor.ed.active()));
await page.click('#ordFront'); const after = await ev(() => NS.App.editor.ed.canvas.getObjects().indexOf(NS.App.editor.ed.active()));
check('bring to front changes layer order', before === 0 && after === 6, { before, after });
// undo/redo
const n0 = await ev(() => NS.App.editor.ed.canvas.getObjects().length);
await page.click('#addRect'); await page.waitForTimeout(100);
await page.click('#undoBtn'); await page.waitForTimeout(600);
check('undo removes last object', await ev(() => NS.App.editor.ed.canvas.getObjects().length) === n0);
await page.click('#redoBtn'); await page.waitForTimeout(600);
check('redo restores it', await ev(() => NS.App.editor.ed.canvas.getObjects().length) === n0 + 1);
// lock / duplicate / group / delete
await ev(() => { const e = NS.App.editor.ed; e.selectAll(); });
await page.click('#grp'); await page.waitForTimeout(100);
check('group created', await ev(() => NS.App.editor.ed.canvas.getObjects().length === 1 && NS.App.editor.ed.canvas.getObjects()[0].type === 'group'));
await page.click('#ungrp'); await page.waitForTimeout(100);
check('ungroup restores objects', await ev(() => NS.App.editor.ed.canvas.getObjects().length) === n0 + 1);
await ev(() => { const e = NS.App.editor.ed; e.canvas.discardActiveObject(); e.canvas.setActiveObject(e.canvas.getObjects()[2]); });
await page.click('#dup'); await page.waitForTimeout(100);
check('duplicate adds object', await ev(() => NS.App.editor.ed.canvas.getObjects().length) === n0 + 2);
await page.keyboard.press('Delete'); await page.waitForTimeout(100);
check('Delete key removes selection', await ev(() => NS.App.editor.ed.canvas.getObjects().length) === n0 + 1);
// keyboard copy/paste
await ev(() => { const e = NS.App.editor.ed; e.canvas.setActiveObject(e.canvas.getObjects()[1]); });
await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v'); await page.waitForTimeout(300);
check('copy/paste adds object', await ev(() => NS.App.editor.ed.canvas.getObjects().length) === n0 + 2);
// lock
await ev(() => { const e = NS.App.editor.ed; e.setLock(e.canvas.getObjects()[0], true); });
check('lock sets flags', await ev(() => NS.App.editor.ed.canvas.getObjects()[0].lockMovementX === true));
// image upload
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
await ev(() => { window.__fi = null; }); 
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#addImage')]);
await fc.setFiles({ name: 'test.png', mimeType: 'image/png', buffer: png }); await page.waitForTimeout(800);
check('image uploaded and placed', await ev(() => NS.App.editor.ed.canvas.getObjects().some(o => o.type === 'image' && o.assetId)));
await ev(() => { const e = NS.App.editor.ed; e.canvas.setActiveObject(e.canvas.getObjects().find(o => o.type === 'image')); }); await page.waitForTimeout(100);
check('image crop controls', await page.locator('input[aria-label="Crop l"]').count() === 1);
// save + reopen
await page.fill('#projName', 'E2E Project'); await page.click('#saveBtn'); await page.waitForTimeout(800);
check('save status says saved', (await page.textContent('#saveStatus')).includes('Saved locally'));
const nobj = await ev(() => NS.App.editor.ed.canvas.getObjects().length);
await page.click('#backBtn'); await page.waitForTimeout(800);
await page.click('#nav a[data-r=projects]'); await page.waitForTimeout(500);
check('project appears in list', await page.locator('#projGrid .tile').count() >= 1);
await page.click('#projGrid .tile a'); await page.waitForSelector('#workspace canvas'); await page.waitForTimeout(1200);
check('reopened with same object count', await ev(() => NS.App.editor.ed.canvas.getObjects().length) === nobj);
check('reopened: image still editable (assetId kept)', await ev(() => NS.App.editor.ed.canvas.getObjects().some(o => o.type === 'image' && o.assetId)));
check('reopened: text still textbox with edit', await ev(() => NS.App.editor.ed.canvas.getObjects().some(o => o.type === 'textbox' && o.text === 'HELLO')));
check('undo history initialised on reopen', await ev(() => NS.App.editor.ed.hist.length === 1));
// canvas size
await ev(() => NS.App.editor.ed.p.canvas.w); 
console.log(errs.join('\n') || 'no page errors');
await page.screenshot({ path: '/tmp/claude-0/shot-editor.png' });
const f = summary(); await b.close(); process.exit(f ? 1 : 0);
