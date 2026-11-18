/* NWTT OBS Browser Source output (Phase 2). Read-only.
   - Credential: a narrowly scoped, expiring, revocable output token in the URL fragment (#t=…), which browsers never
     send to servers or in Referer headers. It can only read the session's CURRENT live graphic and report this
     output's health; it cannot publish, clear, preview or read anything else (see bc_output_state/bc_output_image).
   - Updates: a Realtime broadcast "nudge" (sequence number only) triggers an immediate fetch; polling every few
     seconds is the fallback and the reconnect path, so a missed or duplicate event cannot leave the output wrong.
     States with an older sequence than the one shown are ignored (out-of-order safety).
   - Safety: a graphic is hidden at its expiry time (server clock), and time-sensitive graphics (stale_after_s) are
     hidden if this output cannot confirm the live state for that long, so an outage never leaves outdated warning or
     evacuation information on air as if current. Holding cards without a stale limit stay up during an outage.
   - Nothing is ever drawn except the approved PNG: no text, no controls, transparent background. */
(function () {
  const POLL_MS = 4000, OFFLINE_POLL_MS = 8000, stage = document.getElementById('stage');
  const params = new URLSearchParams(location.hash.slice(1)), token = params.get('t') || '';
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const S = window.__nwttOutput = { status: 'starting', seq: -1, shownRevision: null, renderedSeq: null, live: null, lastContact: 0, offset: 0, hiddenReason: null, errors: 0, events: [] };
  let client = null, channel = null, inflight = false, again = false, timer = null, stopped = false, current = null;

  function fit() { const k = Math.min(innerWidth / 1920, innerHeight / 1080) || 1; stage.style.transform = 'scale(' + k + ')'; }
  addEventListener('resize', fit); fit();
  const log = e => { S.events.push([Date.now(), e]); if (S.events.length > 50) S.events.shift(); };
  const now = () => Date.now() + S.offset;

  function hide(reason, transition) {
    S.hiddenReason = reason; if (!current) return;
    const el = current; current = null; S.shownRevision = null;
    if (transition === 'cut' || reduce) { el.remove(); return; }
    el.classList.remove('on'); setTimeout(() => el.remove(), 600);
  }
  async function show(rev, transition, src) {
    const img = new Image(); img.decoding = 'async'; img.alt = '';
    img.src = src; await img.decode();
    const cut = transition === 'cut' || reduce; if (cut) img.classList.add('cut');
    const prev = current; stage.append(img); current = img; S.shownRevision = rev; S.hiddenReason = null;
    if (cut) { img.classList.add('on'); if (prev) prev.remove(); return; }
    requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add('on')));     // fade in over the old one…
    if (prev) { prev.classList.remove('on'); setTimeout(() => prev.remove(), 600); }        // …while the old one fades out
  }
  // Expiry and stale-contact watchdog (runs even when the network is down).
  setInterval(() => {
    const L = S.live; if (!L || !current) return;
    if (L.expires_at && now() >= Date.parse(L.expires_at)) { log('expired'); hide('expired', 'cut'); S.status = 'expired'; return; }
    if (L.stale_after_s && Date.now() - S.lastContact > L.stale_after_s * 1000) { log('stale'); hide('stale', 'fade'); S.status = 'stale-hidden'; }
  }, 500);

  async function tick() {
    if (stopped) return; if (inflight) { again = true; return; } inflight = true; clearTimeout(timer);
    try {
      const r = await client.rpc('bc_output_state', { p_token: token, p_rendered_seq: S.renderedSeq, p_status: S.status.slice(0, 80), p_user_agent: navigator.userAgent.slice(0, 300) });
      if (r.error) throw r.error;
      const d = r.data; S.lastContact = Date.now(); S.errors = 0;
      if (!d.ok) { log('refused:' + d.reason); hide(d.reason, 'cut'); S.status = d.reason; S.live = null; if (['revoked', 'ended', 'invalid'].includes(d.reason)) stop(); else schedule(30000); return; }
      S.offset = Date.parse(d.server_now) - Date.now();
      if (d.seq < S.seq) { log('ignored older seq ' + d.seq); schedule(POLL_MS); return; }          // out-of-order / duplicate
      if (!channel && d.channel) subscribe(d.channel);
      S.seq = d.seq; S.live = d.live;
      if (!d.live) { if (current) log('clear seq ' + d.seq); hide(d.expired ? 'expired' : 'cleared', S.lastTransition || 'fade'); S.status = d.expired ? 'expired' : 'idle'; S.renderedSeq = d.seq; }
      else if (d.live.revision !== S.shownRevision) {
        S.status = 'loading';
        const img = await client.rpc('bc_output_image', { p_token: token, p_revision: d.live.revision });
        if (img.error) throw img.error;
        if (S.seq !== d.seq) { again = true; return; }                                          // superseded while downloading
        await show(d.live.revision, d.live.transition, 'data:image/png;base64,' + img.data);
        S.lastTransition = d.live.transition; S.renderedSeq = d.seq; S.status = 'rendered'; log('rendered seq ' + d.seq + ' rev ' + d.live.revision);
      } else { S.renderedSeq = d.seq; S.status = 'rendered'; }
      schedule(POLL_MS);
    } catch (e) {
      S.errors++; S.status = navigator.onLine ? 'error' : 'offline'; log('error ' + (e.message || e));
      schedule(Math.min(OFFLINE_POLL_MS * S.errors, 30000));                                     // back off; keep the last approved graphic (watchdog handles expiry/stale)
    } finally { inflight = false; if (again) { again = false; setTimeout(tick, 50); } }
  }
  const schedule = ms => { clearTimeout(timer); if (!stopped) timer = setTimeout(tick, ms + Math.random() * 400); };
  function subscribe(name) {
    channel = client.channel(name).on('broadcast', { event: 'live' }, m => { const s = m.payload && +m.payload.seq; log('nudge ' + s); if (!(s <= S.seq)) tick(); })
      .subscribe(st => { S.realtime = st; if (st === 'SUBSCRIBED') tick(); });                    // re-fetch on every (re)connect
  }
  function stop() { stopped = true; clearTimeout(timer); if (channel) client.removeChannel(channel); channel = null; }
  addEventListener('online', () => tick());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

  async function start() {
    if (!/^[0-9a-f]{64}$/.test(token)) { S.status = 'no-token'; return; }
    try {
      const cfg = await (await fetch('/config.json', { cache: 'no-store' })).json(), sb = cfg.supabase || {};
      if (!sb.url || !sb.anonKey || !window.supabase) throw new Error('not configured');
      client = window.supabase.createClient(sb.url, sb.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    } catch (e) { S.status = 'config-error'; log('config ' + e.message); setTimeout(start, 15000); return; }
    tick();
  }
  start();
})();
