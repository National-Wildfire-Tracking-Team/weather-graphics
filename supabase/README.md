# Graphics Studio cloud backend (Phase 2)

Supabase (Postgres + Auth + Storage + Realtime) for shared projects, roles, broadcast sessions and the live OBS output. The site stays a static Netlify deploy: the browser talks to Supabase directly with the **public** anon key, and every permission is enforced in the database (RLS + `SECURITY DEFINER` functions in `migrations/`).

## Which Supabase project

**Use a dedicated Supabase project for Graphics Studio. Do not use Sentinel's project (`sentinel`, ref `hmtavsjepgefjhwcqqhd`).** That project was inspected read-only on 2026-11-18. It holds Sentinel's operational and public-user data: public sign-ups (`profiles`, `subscriptions`, `push_tokens`, `saved_locations`), incident data, and a mobile-app compatibility contract (see Sentinel's CLAUDE.md). Sharing it would:

- put newsroom roles and broadcast control in the same `auth.users` as the public;
- let a Graphics Studio migration affect production Sentinel tables and the installed iOS app;
- mix audit and RLS concerns across two products.

A separate project keeps the blast radius small and lets Graphics Studio stay invite-only.

### The hosted project (created 2026-11-18 with the owner's authorization)

| | |
|---|---|
| Project | **`nwtt-graphics`**, ref **`meqtsuapaxydmcyjoshn`**, region `us-west-1`, organisation `nationalwildfiretrackingteam's Org` |
| API URL | `https://meqtsuapaxydmcyjoshn.supabase.co` |
| Migrations | `20261118141634_graphics_studio_phase2` and `20261118151005_pending_accounts`, both applied 2026-11-18 (repo files are named to match the hosted migration history, so `supabase db push` won't re-apply them) |
| Administrator | `kyle@nationalwildfiretrackingteam.org` (bootstrapped 2026-11-18; the only administrator, so the only person who can approve accounts and change roles) |
| Verified after applying | RLS on all 14 tables (22 table + 3 storage policies); `anon` has no table grants and can execute only `bc_output_state` / `bc_output_image`; private `graphics-assets` bucket (20 MB, PNG/JPEG/GIF/WebP); Realtime publication has `broadcast_sessions`, `live_events`, `output_tokens`. Anonymous API checks: every table read denied, `bc_publish` and `gs_me` denied, bad output token refused. 0 users, 0 members. |
| Advisors | Security: only the by-design findings (signed-in callers can run the role-checking `SECURITY DEFINER` functions; `anon` can run the two token-gated output functions; `rate_limits` has RLS and no policies because it is internal). Performance: 13 unindexed foreign keys and 9 policies that could wrap `auth.uid()` in `(select …)`; not significant at NWTT's scale, a candidate for a follow-up migration (tested locally first). |
| Still to do in the dashboard | Step 2 below: auth settings (site URL, SMTP, optional MFA, and whether to allow self sign-up: on lets people use **Request access** and appear under Pending approval with no access; off means only accounts you create), Step 6 is done: `site/config.json` → `supabase` points at this project with the anon key (takes effect on the live site when the branch is merged to `main`). |

## What the migration creates

`migrations/20261118141634_graphics_studio_phase2.sql` (one file, all-or-nothing):

| Object | Purpose | Access |
|---|---|---|
| `org_members`, `org_settings` | Roles: `admin`, `producer`, `editor`, `broadcaster`, `viewer` | Members read; changes only via `gs_set_member` (admins), which can't remove the last admin |
| `projects`, `project_revisions` | Shared graphics (JSON), optimistic `version`, approval (`draft`/`submitted`/`approved`/`rejected`), last 100 revisions | Members read; admin/producer/editor write (owner, or anyone if `team_can_edit`); approving needs producer/admin (`gs_set_approval`); editing an approved graphic resets it to draft |
| `templates`, `assets` + bucket `graphics-assets` | Shared templates and images (private bucket, 20 MB, PNG/JPEG/GIF/WebP only; no SVG) | Members read; admin/producer/editor upload into their own folder |
| `broadcast_sessions`, `session_members` | Sessions: title, incident, type, status (`draft`→`ready`→`live`/`interrupted`→`ended`→`archived`), producer, broadcaster, **controller**, `version`, `live_seq` | Visible to admins/producers and assigned members; changed only through `bc_*` functions |
| `broadcast_revisions`, `render_images` | Previewed graphics: exact 1920×1080 PNG (≤ 8 MB, signature and size checked), transition, expiry (≤ 24 h), stale limit, source + source time | Session-visible; created by `bc_create_preview` |
| `live_events` | Ordered on-air history (`take`, `update`, `rollback`, `clear`, `end`) | Session-visible |
| `output_tokens` | OBS output credentials: **SHA-256 hash only**, label, expiry (1–72 h), revocation, last seen, last rendered seq | Admin/producer/broadcaster of the session can read; never the token itself |
| `audit_log` | Every member, approval, preview, publish, clear, rollback, control, output and status action | Admins/producers; session-visible rows for others; no direct writes |
| `rate_limits` | Fixed-window limits: 60 control actions/min per user, 240 state polls and 60 image fetches/min per output token | Internal |

**Pending approval** (`20261118151005_pending_accounts.sql`): `gs_pending_accounts()` lists accounts with no role, and `gs_decline_account(user)` records an account as an inactive member with no access (reversible). Both are administrator-only and audited (`member.decline`); approval is `gs_set_member` with a role. Accounts can come from **Request access** in the Studio's sign-in dialog, but only while Supabase's "Allow new users to sign up" is on; with it off, the dialog says to ask an administrator.

**Control functions** (granted to `authenticated`):
- `bc_create_session`, `bc_add_member`, `bc_transfer_control`
- `bc_create_preview`, `bc_publish` (`take` / `update` / `rollback`), `bc_clear`, `bc_set_status`
- `bc_issue_output_token`, `bc_output_token_admin` (`revoke` / `extend`)
- `gs_me`, `gs_set_member`, `gs_set_approval`

Each control function locks the session row, checks the caller's role and that they are the **controller**, and requires the caller's `expected_version` (stale → `version_conflict`). It then writes the audit record, all in one transaction.

**Output functions** (granted to `anon`):
- `bc_output_state(token, …)` returns only the current live revision's metadata, and records the output's heartbeat.
- `bc_output_image(token, revision)` returns the PNG of the **current live revision only**: no previews, no history.

Neither can change broadcast state.

**Realtime:**
- Publishing sends a broadcast message on `nwtt-out-<random channel key>` that carries only the sequence number. The output then fetches state with its token, and polls every ~4 s anyway.
- The console uses `postgres_changes` on `broadcast_sessions`, `live_events` and `output_tokens`. RLS applies.

## Configuration

The site has **no server environment variables**. The browser reads `site/config.json`:

```json
"supabase": { "url": "https://<project-ref>.supabase.co", "anonKey": "<anon or publishable key>" }
```

- Use the project's **anon / publishable** key only. The Studio refuses `service_role` JWTs and `sb_secret_` keys, and disables cloud features if it finds one.
- If you ever commit a secret key by mistake, rotate it in the dashboard immediately.
- Without the `supabase` block, the Studio works exactly as before (browser-local) and Live Broadcast Control explains that the cloud isn't configured.

Test-only variables (`tests/cloud`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_CLI`, `SITE`, `ALLOW_REMOTE_TEST_DB`. The tests refuse non-local URLs unless `ALLOW_REMOTE_TEST_DB` is set; never set it for production.

## Deploy (after authorization)

1. **Create the project.** Supabase dashboard → New project (for example `nwtt-graphics`, region `us-west-2` or close to the team). Keep the database password in your password manager.
2. **Configure auth** (Authentication → Providers / URL configuration):
   - Email provider: **on**.
   - **Allow new users to sign up: off** (invite-only). Confirm email: on.
   - Site URL: `https://snazzy-gumdrop-5718eb.netlify.app`. Redirect URLs: the same URL, plus any custom domain.
   - SMTP: configure a real sender. The built-in one is rate-limited and not for production.
   - Optional: require MFA for admins and producers (Authentication → MFA).
3. **Apply the migration.** From the repo root:

   ```bash
   npx supabase@2.122.1 login
   ```

   ```bash
   npx supabase@2.122.1 link --project-ref <graphics-project-ref>
   ```

   ```bash
   npx supabase@2.122.1 db push
   ```

   Double-check the ref first. It must **not** be Sentinel's (`hmtavsjepgefjhwcqqhd`).
4. **Bootstrap the first administrator.** Authentication → Users → **Invite user** (your email), accept the invite and set a password. Then in the SQL editor:

   ```sql
   insert into public.org_members (user_id, email, role, display_name)
   select id, email, 'admin', 'Your Name' from auth.users where email = 'you@example.org';
   ```

   After that, add people in Graphics Studio → **Team and permissions** (invite them in the dashboard first).
5. **Realtime and Storage.** The migration adds the tables to the `supabase_realtime` publication and creates the `graphics-assets` bucket with its policies. Check that they appear in the dashboard.
6. **Point the site at it.** Add the `supabase` block to `site/config.json` (anon key only), commit, and let Netlify deploy `main`. `site/_redirects` already maps `/broadcast/output/*` to the output page.
7. **Verify** with the two-computer procedure in `site/docs/live-browser-source.md` (steps 8–12) before any real broadcast.

## Rollback

- **Front end:** in Netlify, redeploy the previous deploy, or remove the `supabase` block from `config.json`. The Studio falls back to browser-local mode, and local projects are untouched (they were never deleted). OBS Browser Sources then show nothing, so switch broadcasters to the PNG fallback.
- **During an incident on air:** a producer can **Clear Graphic** or **End session**, which revokes every output. Broadcasters can also hide the Browser Source in OBS.
- **Database:** the migration only creates new objects. To remove it from a dedicated project, export what you need, then drop the Phase 2 objects (tables `org_settings`, `org_members`, `audit_log`, `rate_limits`, `projects`, `project_revisions`, `templates`, `assets`, `broadcast_sessions`, `session_members`, `broadcast_revisions`, `render_images`, `live_events`, `output_tokens`; the `gs_*`/`bc_*` functions; the three enum types; the `graphics-assets` bucket and its policies), or simply delete the dedicated project. Never run such a script against Sentinel's project.

## Local development

Docker required.

```bash
npx supabase@2.122.1 start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit
```

```bash
npx supabase@2.122.1 status -o env
```

The local stack applies `migrations/` automatically, and `supabase db reset` re-applies them. Local keys printed by `status` are the CLI's public demo keys. Tests and setup: `tests/cloud/README.md`.

## Security notes and remaining limitations

- **Output tokens are bearer credentials.** Whoever holds the URL sees the live graphic, which is public on air anyway, until it expires (≤ 72 h, renewable), is revoked, or the session ends. Tokens are 256-bit random values stored only as SHA-256 hashes and kept in the URL fragment.
- **Fake nudges are harmless.** The Realtime nudge channel is a public broadcast topic named with a random per-session key. Anyone who learns the key can see sequence numbers or send fake nudges, which only make outputs re-check their state (rate-limited). They can't see or change graphics.
- **Previews are trusted renders.** The server checks the PNG's signature, size and dimensions, not its content. A Graphics Editor previewing an approved project could in principle upload a different image under that project's name. The safeguard is that only producers can publish, and they see the exact image before Take Live.
- **Rate limits** are per user and per token inside Postgres (fixed one-minute windows). Supabase's own Auth rate limits apply to sign-in. There's no IP-level limiting beyond Supabase's platform defaults.
- **The audit log is append-only for clients** (no write grants). The service role and database owner can still alter it; restrict dashboard access accordingly.
- **Single organisation.** There's one NWTT organisation, not multi-tenant.
- **Not tested here:** the hosted Supabase project (only the local stack, CLI 2.122.1, Postgres 17), OBS's own Chromium (CEF) build (only Chromium via Playwright), real email delivery, and MFA.
