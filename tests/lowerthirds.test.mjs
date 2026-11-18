import { launch, check, summary, BASE } from './lib.mjs';
import { readFileSync } from 'node:fs';
// Lower Thirds: view, styles, PNG export sizes/transparency, live browser-source page, WebM recording.
const SHOTS = process.env.SHOTS || '';
const { b, ctx, page, errs } = await launch();
console.log('Lower Thirds');
await page.evaluate(() => localStorage.removeItem('nsgs.lt.current'));
await page.click('#nav a[data-r=lowerthirds]'); await page.waitForSelector('#ltCanvas');
check('sidebar entry opens the view', await page.evaluate(() => location.hash === '#/lowerthirds' && !!document.querySelector('#ltStage')));
await page.waitForTimeout(400);
const px = (x, y) => page.evaluate(([x, y]) => Array.from(document.getElementById('ltCanvas').getContext('2d').getImageData(x, y, 1, 1).data), [x, y]);
check('preview draws the white headline bar', (await px(960, 886))[3] === 255 && (await px(960, 886))[0] > 200, await px(960, 886));
check('area above the strap stays transparent', (await px(960, 300))[3] === 0);
for (const st of ['cable', 'cable-red', 'business', 'nameplate', 'weather']) {
  await page.selectOption('#lt-style', st); await page.waitForTimeout(150);
  const a = await px(700, 886);
  check('style ' + st + ' renders', a[3] === 255, a);
  if (SHOTS) await page.locator('#ltStage').screenshot({ path: SHOTS + '/lt-' + st + '.png' });
}
await page.click('[data-preset="Breaking news"]'); await page.waitForTimeout(1200);
await page.fill('#lt-headline', 'Storms move into the metro tonight');
check('editing text persists to localStorage', await page.evaluate(() => JSON.parse(localStorage.getItem('nsgs.lt.current')).headline === 'Storms move into the metro tonight'));
await page.click('#ltOut'); await page.waitForTimeout(1200);
check('Take out clears the strap', (await page.textContent('#ltState')) === 'off' && (await px(960, 886))[3] === 0);
await page.click('#ltIn'); await page.waitForTimeout(1300);
check('Take in brings it back', (await page.textContent('#ltState')) === 'on' && (await px(960, 886))[3] === 255);

async function dl(btn) { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click(btn)]); return { name: d.suggestedFilename(), buf: readFileSync(await d.path()) }; }
const pngInfo = buf => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colorType: buf[25] });
for (const [btn, w, hh] of [['#ltPng1080', 1920, 1080], ['#ltPng720', 1280, 720], ['#ltPng4k', 3840, 2160]]) {
  const f = await dl(btn); const i = pngInfo(f.buf);
  check(`PNG ${w}×${hh} has the right size and an alpha channel`, i.w === w && i.h === hh && i.colorType === 6, [f.name, i]);
}
const f720 = await dl('#ltPng720');
check('StreamYard PNG is tagged and under 20 MB', /streamyard-overlay\.png$/.test(f720.name) && f720.buf.length < 20e6, f720.name);
const tr = await page.evaluate(async b64 => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return [x.getImageData(640, 200, 1, 1).data[3], x.getImageData(640, 590, 1, 1).data[3]]; }, f720.buf.toString('base64'));
check('PNG is transparent above the strap and opaque on it', tr[0] === 0 && tr[1] === 255, tr);

// Save / load
await page.fill('#ltSaveName', 'Test strap'); await page.click('#ltSave');
check('saved list shows the entry', /Test strap/.test(await page.textContent('#ltSaved')));

// Live browser source
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await page.click('#ltCopy'); const url = await page.evaluate(() => navigator.clipboard.readText());
check('copied URL points at the live page', /lower-thirds-live\.html#c=/.test(url), url.slice(0, 80));
const live = await ctx.newPage(); await live.setViewportSize({ width: 1920, height: 1080 });
await live.goto(url); await live.waitForTimeout(2000);
const lp = (x, y) => live.evaluate(([x, y]) => Array.from(document.getElementById('lt').getContext('2d').getImageData(x, y, 1, 1).data), [x, y]);
check('live page animates in and shows the strap', await live.evaluate(() => window.ltPlayer.state) === 'on' && (await lp(960, 886))[3] === 255);
check('live page background is transparent', await live.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgba(0, 0, 0, 0)' && (await lp(960, 300))[3] === 0);
const x1 = await live.evaluate(() => window.ltPlayer.crawlX); await live.waitForTimeout(500);
check('ticker crawl is moving', (await live.evaluate(() => window.ltPlayer.crawlX)) > x1);
if (SHOTS) await live.screenshot({ path: SHOTS + '/lt-live.png', omitBackground: true });
await live.keyboard.press('Space'); await live.waitForTimeout(1200);
check('Space takes the live strap out', await live.evaluate(() => window.ltPlayer.state) === 'off');
await live.goto(new URL('lower-thirds-live.html', BASE).href); await live.waitForTimeout(500);
check('live page without config explains what to do', /No lower third/.test(await live.textContent('#msg')));
await live.close();

// WebM recording (shorten it)
await page.fill('#lt-hold', '1'); await page.fill('#lt-inDur', '0.4');
const wv = await dl('#ltWebm');
check('WebM downloads with data', /\.webm$/.test(wv.name) && wv.buf.length > 5000, [wv.name, wv.buf.length]);
const alpha = await page.evaluate(async b64 => {
  const v = document.createElement('video'); v.muted = true; v.src = 'data:video/webm;base64,' + b64; await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('decode')); });
  v.currentTime = 0.9; await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); });
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; const x = c.getContext('2d'); x.drawImage(v, 0, 0);
  return { w: v.videoWidth, top: x.getImageData(c.width / 2, c.height * 0.25, 1, 1).data[3], bar: x.getImageData(c.width / 2, c.height * 0.82, 1, 1).data[3] };
}, wv.buf.toString('base64')).catch(e => ({ err: e.message }));
console.log('    webm probe', JSON.stringify(alpha));
check('WebM is 1920 wide', alpha.w === 1920, alpha);
check('WebM keeps transparency (alpha 0 above the strap, opaque on it)', alpha.top === 0 && alpha.bar === 255, alpha);
check('no page errors', errs.length === 0, errs);
await b.close(); process.exit(summary() ? 1 : 0);
