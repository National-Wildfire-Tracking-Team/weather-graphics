import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';
// The pinned Chromium build moves between environments; fall back to the /opt/pw-browsers/chromium symlink, or set CHROME.
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find(p => existsSync(p));
export const BASE = process.env.BASE || 'http://localhost:8765/index.html';
export async function launch(opts = {}) {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: opts.dpr || 1, acceptDownloads: true });
  const page = await ctx.newPage(); const errs = [];
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); }); page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await page.goto(BASE); await page.waitForFunction(() => window.NS && NS.App && document.querySelector('#nav a'), null, { timeout: 15000 }); await page.waitForTimeout(500);
  return { b, ctx, page, errs };
}
let pass = 0, fail = 0; export const results = [];
export function check(name, cond, extra) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra) : ''); } results.push([name, !!cond]); }
export const summary = () => { console.log(`\n${pass} passed, ${fail} failed`); return fail; };
