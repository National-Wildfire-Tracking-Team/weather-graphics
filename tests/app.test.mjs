import { launch, check, summary, clickDownload } from './lib.mjs';
import fs from 'fs';
const { b, ctx, page, errs } = await launch();
const ev = (fn, arg) => page.evaluate(fn, arg);
console.log('App: persistence, assets, brand, project files');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
// brand
await page.click('#nav a[data-r=brand]'); await page.waitForSelector('#brandOrg'); await page.fill('#brandOrg', 'WXYZ News'); 
await page.fill('#mapToken', 'sk.secret'); await page.click('#brandSave'); await page.waitForTimeout(300);
check('secret (sk.) Mapbox token is refused', await page.locator('#toast .err:has-text("secret")').count() === 1);
await page.fill('#mapToken', ''); await page.click('#brandSave'); await page.waitForTimeout(500);
check('brand saved: sidebar shows org name', (await page.textContent('#orgName')) === 'WXYZ NEWS');
// assets
await page.click('#nav a[data-r=assets]'); await page.waitForSelector('#assetUpload');
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#assetUpload')]); await fc.setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png }); await page.waitForTimeout(800);
check('asset uploaded and listed', await page.locator('#assetGrid .tile:has-text("logo")').count() === 1);
const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('#assetUpload')]); await fc2.setFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }); await page.waitForTimeout(500);
check('non-image upload rejected', await page.locator('#toast .err').count() >= 1 && await page.locator('#assetGrid .tile').count() === 1);
// set as logo and make project from template -> logo present
await page.click('#nav a[data-r=brand]'); await page.waitForSelector('#brandOrg'); await page.selectOption('select[aria-label="primary logo"]', { label: 'logo' }); await page.click('#brandSave'); await page.waitForTimeout(500);
await ev(() => NS.App.newFromTemplate('bn-breaking')); await page.waitForSelector('#workspace canvas'); await page.waitForTimeout(1500);
check('brand logo placed in new template project', await ev(() => NS.App.editor.ed.canvas.getObjects().some(o => o.type === 'image' && o.name === 'Logo')));
check('brand org name used in template', await ev(() => NS.App.editor.ed.canvas.getObjects().some(o => o.fieldKey === 'org' && o.text === 'WXYZ NEWS')));
await page.fill('#projName', 'Persist Me'); await page.click('#saveBtn'); await page.waitForTimeout(600);
const url = page.url();
// restart: new context sharing no memory, same browser profile? emulate app restart via reload
await page.reload(); await page.waitForFunction(() => window.NS && NS.App && document.querySelector('#workspace canvas'), null, { timeout: 15000 }); await page.waitForTimeout(1500);
check('after reload the project reopens from storage', await ev(() => NS.App.editor.ed.p.name === 'Persist Me'));
check('after reload the logo image still resolves from asset store', await ev(() => NS.App.editor.ed.canvas.getObjects().some(o => o.type === 'image' && o.width > 0)));
// replace asset updates project when reopened
await page.click('#backBtn'); await page.click('#nav a[data-r=assets]'); await page.waitForSelector('#assetGrid .tile');
// project export file roundtrip
await page.click('#nav a[data-r=projects]'); await page.waitForSelector('#projGrid .tile');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#projGrid .tile >> nth=0 >> text=Export file')]); const path = await dl.path(); const file = JSON.parse(fs.readFileSync(path, 'utf8'));
check('editable project file contains project + referenced assets', file.format === 'newsroom-graphics-studio-project' && file.project.objects.length > 3 && file.assets.length === 1, [file.format, file.assets.length]);
const nBefore = await page.locator('#projGrid .tile').count();
const [fc3] = await Promise.all([page.waitForEvent('filechooser'), page.click('#importProject')]); await fc3.setFiles(path); await page.waitForTimeout(800);
check('project file re-imports as a new project', await page.locator('#projGrid .tile').count() === nBefore + 1);
// export center
await page.click('#nav a[data-r=exports]'); await page.waitForSelector('#exportOpen'); await page.click('#exportOpen'); await page.waitForSelector('#renderPreview'); await page.click('#renderPreview'); await page.waitForSelector('#exportDownload:not([disabled])', { timeout: 20000 });
const d2 = await clickDownload(page, '#exportDownload'); const buf = fs.readFileSync(await d2.path()); check('Export Center renders a project at full size', buf.readUInt32BE(16) === 1920 && buf.readUInt32BE(20) === 1080);
await page.keyboard.press('Escape'); await page.click('#nav a[data-r=exports]'); await page.waitForTimeout(400);
check('export history recorded', await page.locator('table.t tbody tr').count() >= 1);
// dashboard shows recent
await page.click('#nav a[data-r=dashboard]'); await page.waitForTimeout(600); check('dashboard lists recent projects', await page.locator('.grid .tile').count() >= 1);
// a11y: all buttons in editor have accessible names
await page.click('.tile >> nth=0 >> a'); await page.waitForSelector('#workspace canvas');
const unnamed = await ev(() => [...document.querySelectorAll('button,input,select,textarea')].filter(e => !e.closest('dialog') && !(e.getAttribute('aria-label') || e.title || (e.textContent || '').trim() || e.labels && e.labels.length || e.placeholder || e.type === 'hidden')).map(e => e.outerHTML.slice(0, 80))); check('all controls have accessible names', unnamed.length === 0, unnamed.slice(0, 4));
console.log(errs.join('\n') || 'no page errors');
const f = summary(); await b.close(); process.exit(f ? 1 : 0);
