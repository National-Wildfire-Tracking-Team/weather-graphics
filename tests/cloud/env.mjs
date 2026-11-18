/* Shared setup for Phase 2 tests against a LOCAL Supabase stack (`supabase start` in the repo root).
   Keys come from `supabase status -o env` (the CLI's local demo keys) or from SUPABASE_URL / SUPABASE_ANON_KEY /
   SUPABASE_SERVICE_ROLE_KEY. The service-role key is used only here, in the test process, to create test users.
   Never point these tests at a production project. */
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';

function fromCli() {
  const [bin, ...pre] = process.env.SUPABASE_CLI ? [process.env.SUPABASE_CLI] : ['npx', 'supabase'];
  try {
    const out = execFileSync(bin, [...pre, 'status', '-o', 'env'], { cwd: new URL('../..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const kv = Object.fromEntries(out.split('\n').map(l => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map(m => [m[1], m[2]]));
    return { url: kv.API_URL, anon: kv.ANON_KEY, service: kv.SERVICE_ROLE_KEY };
  } catch (e) { return {}; }
}
const cli = (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) ? {} : fromCli();
export const URL_ = process.env.SUPABASE_URL || cli.url, ANON = process.env.SUPABASE_ANON_KEY || cli.anon, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || cli.service;
if (!URL_ || !ANON || !SERVICE) { console.error('Local Supabase not found. Run `npx supabase start` in the repo root (Docker required).'); process.exit(2); }
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(URL_) && !process.env.ALLOW_REMOTE_TEST_DB) { console.error('Refusing to run against a non-local database: ' + URL_); process.exit(2); }

export const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
export const anonClient = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
export const PASSWORD = 'test-password-not-secret-1';
export const ROLES = ['admin', 'producer', 'producer2', 'editor', 'editor2', 'broadcaster', 'viewer', 'outsider'];

/* Creates (or reuses) one user per role; members get their org role, 'outsider' has an account but no membership. */
export async function users(tag = 't') {
  const out = {};
  for (const r of ROLES) {
    const email = `${r}.${tag}@test.nwtt.local`;
    let { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error && !/already/i.test(error.message)) throw error;
    if (!data || !data.user) { const l = await admin.auth.admin.listUsers({ perPage: 1000 }); data = { user: l.data.users.find(u => u.email === email) }; }
    const id = data.user.id;
    if (r !== 'outsider') {
      const role = r.replace(/\d$/, '');
      const { error: e2 } = await admin.from('org_members').upsert({ user_id: id, email, role, display_name: r, active: true });
      if (e2) throw e2;
    }
    const c = anonClient(); const s = await c.auth.signInWithPassword({ email, password: PASSWORD }); if (s.error) throw s.error;
    out[r] = { id, email, c };
  }
  return out;
}

/* A real 1920×1080 PNG (transparent or opaque) as base64, built without a browser. */
import zlib from 'node:zlib';
export function png(w = 1920, h = 1080, rgba = [242, 69, 61, 0]) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.alloc(1 + w * 4); for (let x = 0; x < w; x++) row.set(rgba, 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

let pass = 0, fail = 0;
export function check(name, cond, extra) { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } }
export const summary = () => { console.log(`\n${pass} passed, ${fail} failed`); return fail; };
export const errOf = r => r.error ? (r.error.message || String(r.error)) : null;
