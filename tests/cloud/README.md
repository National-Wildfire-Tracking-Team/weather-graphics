# Phase 2 cloud tests

These run against a **local** Supabase stack only. They create their own test users (`*@test.nwtt.local`) with the local service-role key, which is used only inside the test process. They refuse a non-local database unless `ALLOW_REMOTE_TEST_DB` is set; never set it for production.

## Run

Docker, Node 22 and the pre-installed Playwright Chromium are required.

1. Install the test dependency (`@supabase/supabase-js`, pinned):

   ```bash
   cd tests/cloud && npm ci
   ```

2. Start the local stack from the repo root. It applies `supabase/migrations`:

   ```bash
   npx supabase@2.122.1 start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit
   ```

3. Serve the site:

   ```bash
   cd site && python3 -m http.server 8765
   ```

4. Run the suites from `tests/cloud`:

   ```bash
   node backend.test.mjs
   ```

   ```bash
   node live.e2e.mjs
   ```

If the Supabase CLI isn't on your PATH as `npx supabase`, set `SUPABASE_CLI=/path/to/supabase`, or provide `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from `supabase status -o env`.

## What they cover

- **`backend.test.mjs`** (101 checks), using real Auth, PostgREST, Storage and Realtime:
  - roles and membership, and anonymous/non-member denial
  - RLS on every table
  - shared project editing, locking and optimistic concurrency
  - approval rules and revisions
  - template and asset permissions, storage folder and MIME rules (no SVG)
  - session visibility, preview validation (PNG signature and 1920×1080)
  - Take Live / Update Live / rollback / clear, version conflicts, two simultaneous publishes
  - control transfer and administrator override
  - expiry, output-token issue / renew / revoke, output read-only access
  - the Realtime nudge, rate limiting, ending a session, and the audit trail
- **`live.e2e.mjs`** (53 checks): **Producer on Computer A → Supabase → OBS Browser Output on Computer B**, plus a second producer (C), a viewer, and offline or unconfigured browsers. Each "computer" is an isolated browser context with its own storage and sign-in. It covers:
  - sign-in UI, session creation, Preview, OBS output URL
  - transparent 1920×1080 output with no UI, and Take Live via Realtime (~0.1–0.2 s locally)
  - output health in the console, Update Live with a cut, and fade by default
  - network interruption and reconnection, rollback, and stale-contact hiding
  - expiry, revocation, control transfer seen on another computer
  - explicit migration of local projects, cloud sync, offline draft and recovery, opening the shared project on another computer
  - incident fact-panel attribution (mock incident data; the IPAWS archive labelled as delayed; social posts excluded)
  - viewer restrictions, ending a session, and resilience when the cloud is unreachable or not configured
  - refusal of secret keys

No public livestream, OBS installation or Restream account is needed.
