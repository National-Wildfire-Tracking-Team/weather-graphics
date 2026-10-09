import { launch } from './lib.mjs';
import fs from 'fs';
const { b, page, errs } = await launch();
const ids = process.argv.slice(2);
for (const id of ids) {
  const b64 = await page.evaluate(async (id) => { const t = NS.Templates.list.find(t => t.id === id); const p = await NS.Templates.instantiate(t, await NS.getBrand()); const r = await NS.Export.render(p, { format: 'png', scale: 0.5, transparent: false }); const buf = new Uint8Array(await r.blob.arrayBuffer()); let s = ''; buf.forEach(v => s += String.fromCharCode(v)); return btoa(s); }, id);
  fs.writeFileSync('/tmp/claude-0/t-' + id + '.png', Buffer.from(b64, 'base64')); console.log('wrote', id);
}
console.log(errs.join('\n')); await b.close();
