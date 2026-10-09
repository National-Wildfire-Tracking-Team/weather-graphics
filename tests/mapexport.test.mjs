import { launch, check, summary } from './lib.mjs';
import fs from 'fs';
const dpr = +(process.env.DPR || 1);
const { b, page, errs } = await launch({ dpr });
const ev = (fn, arg) => page.evaluate(fn, arg);
console.log('Map export (dpr ' + dpr + ')');
await ev(() => NS.App.newFromTemplate('gn-blank-map')); await page.waitForSelector('#workspace canvas'); await page.waitForTimeout(6000);
check('map template: map element present and rendered', await ev(() => { const m = NS.App.editor.ed.canvas.getObjects().find(o => o.type === 'MapFrame'); return m && NS.mapImages.get(m.id).status === 'ok'; }));
// add a big marker + label feature via state, at known position (center of view)
await ev(() => { const e = NS.App.editor.ed, m = e.canvas.getObjects().find(o => o.type === 'MapFrame'), st = m.mapState; delete st.fit; st.zoom = 5; st.features.features.push({ type: 'Feature', properties: { id: 'f1', kind: 'marker', fill: '#00ff00', stroke: '#ffffff', size: 30, label: 'CENTER', labelSize: 40, labelColor: '#ffffff' }, geometry: { type: 'Point', coordinates: st.center } }); NS.mapImages.delete(m.id); e.refreshMap(m); e.commit(); });
await page.waitForTimeout(6000);
for (const scale of [1, 2]) {
  const r = await ev(async (scale) => { const t0 = performance.now(); const res = await NS.Export.render(NS.App.editor.ed.syncProject(), { format: 'png', scale }); const bm = await createImageBitmap(res.blob); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
    // green marker at map centre of the frame: frame covers canvas (0,0,1920,1080) minus header? marker is at view centre = frame centre
    const cx = Math.round(bm.width / 2), cy = Math.round(bm.height / 2), d = x.getImageData(cx - 10, cy - 10, 20, 20).data; let g = 0; for (let k = 0; k < d.length; k += 4) if (d[k + 1] > 200 && d[k] < 80 && d[k + 2] < 80) g++;
    // label text sharpness: count of distinct near-white pixels around label
    const l = x.getImageData(cx - 200 * scale, cy + 20 * scale, 400 * scale, 100 * scale).data; let white = 0; for (let k = 0; k < l.length; k += 4) if (l[k] > 235 && l[k + 1] > 235 && l[k + 2] > 235) white++;
    return { w: res.w, h: res.h, green: g, white, warns: res.warnings, ms: Math.round(performance.now() - t0) }; }, scale);
  console.log('   ', JSON.stringify(r));
  check(scale + 'x map graphic exports at ' + 1920 * scale + 'x' + 1080 * scale, r.w === 1920 * scale && r.h === 1080 * scale, r);
  check(scale + 'x: geographic overlay (marker) rendered at map centre', r.green > 40, r);
  check(scale + 'x: map label text rendered', r.white > 100 * scale, r);
  check(scale + 'x: no render warnings', r.warns.filter(w => /Map/.test(w)).length === 0, r.warns);
}
// direct: native render canvas sizes
const nat = await ev(async () => { const m = NS.App.editor.ed.canvas.getObjects().find(o => o.type === 'MapFrame'); const r = await NS.renderMapCanvas(m.mapState, 960, 540, 3); return [r.canvas.width, r.canvas.height, r.warnings]; });
check('renderMapCanvas draws natively at ratio 3 (2880x1620)', nat[0] === 2880 && nat[1] === 1620, nat);
check('page devicePixelRatio restored after map render', await ev(() => window.devicePixelRatio) === dpr);
// transparent overlay-only map
await ev(async () => { const e = NS.App.editor.ed, m = e.canvas.getObjects().find(o => o.type === 'MapFrame'); m.mapState.basemap = false; m.mapState.showAttribution = false; });
const tp = await ev(async () => { const m = NS.App.editor.ed.canvas.getObjects().find(o => o.type === 'MapFrame'); const r = await NS.renderMapCanvas(m.mapState, 960, 540, 1); const x = r.canvas.getContext('2d'); const a = x.getImageData(5, 5, 1, 1).data[3]; const g = x.getImageData(480, 270, 1, 1).data; return { cornerAlpha: a, centre: Array.from(g) }; });
check('overlay-only map render: basemap transparent, overlays kept', tp.cornerAlpha === 0, tp);
console.log(errs.join('\n') || 'no page errors');
const f = summary(); await b.close(); process.exit(f ? 1 : 0);
