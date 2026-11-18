/* Lower-third renderer + player, shared by the Studio's Lower Thirds view (js/lowerthirds.js) and the
   live browser-source page (lower-thirds-live.html). Pure Canvas 2D, no dependencies.
   Everything is laid out in 1920×1080 units and scaled to the target canvas, so preview, PNG, WebM and
   the live output all frame identically. Styles are generic cable-news / business-news looks
   (no network names or logos). */
(function () {
  const NS = window.NS = window.NS || {};
  const W = 1920, H = 1080, X = 96, R = 1824;   // 5% action-safe margins left/right

  const ease = t => 1 - Math.pow(1 - t, 3);
  const seg = (t, a, b) => t <= a ? 0 : t >= b ? 1 : ease((t - a) / (b - a));
  const FD = '"Barlow Condensed", "Oswald", "Arial Narrow", sans-serif', FS = '"Barlow", "Segoe UI", Arial, sans-serif';
  const fd = (w, s) => w + ' ' + s + 'px ' + FD, fs = (w, s) => w + ' ' + s + 'px ' + FS;

  function shade(hex, amt) {   // amt -1..1, negative darkens
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex;
    const n = parseInt(m[1], 16), f = c => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(c => f(c).toString(16).padStart(2, '0')).join('');
  }

  // layout: which drawing routine; colors: accent = tag / ticker label, bar = headline bar, strip = sub line.
  const STYLES = {
    cable: { name: 'Cable news: white bar', layout: 'cable', colors: { accent: '#CC0000', accentText: '#FFFFFF', bar: '#FFFFFF', bar2: '#E6E6E6', barText: '#111111', strip: '#1B1B1B', stripText: '#FFFFFF', ticker: '#0B0B0B', tickerText: '#FFFFFF' } },
    'cable-red': { name: 'Cable news: red bar', layout: 'cable', colors: { accent: '#111111', accentText: '#FFFFFF', bar: '#D0021B', bar2: '#9E0014', barText: '#FFFFFF', strip: '#FFFFFF', stripText: '#111111', ticker: '#0B0B0B', tickerText: '#FFFFFF' } },
    business: { name: 'Business news: blue', layout: 'business', colors: { accent: '#FFC72C', accentText: '#0A1F44', bar: '#0A2C6B', bar2: '#1257C7', barText: '#FFFFFF', strip: '#FFFFFF', stripText: '#0A1F44', ticker: '#000000', tickerText: '#FFFFFF' } },
    nameplate: { name: 'Name / title strap', layout: 'nameplate', colors: { accent: '#CC0000', accentText: '#FFFFFF', bar: '#FFFFFF', bar2: '#E6E6E6', barText: '#111111', strip: '#12161D', stripText: '#FFFFFF', ticker: '#0B0B0B', tickerText: '#FFFFFF' } },
    weather: { name: 'Weather alert (navy)', layout: 'cable', colors: { accent: '#F2453D', accentText: '#FFFFFF', bar: '#0C1119', bar2: '#1A2230', barText: '#FFFFFF', strip: '#E8EDF3', stripText: '#0C1119', ticker: '#080C12', tickerText: '#E8EDF3' } }
  };

  const DEFAULTS = {
    style: 'cable', tag: 'BREAKING NEWS', headline: 'Headline goes here', sub: 'Supporting line with the key detail', caps: true,
    tickerOn: true, tickerLabel: 'LATEST', ticker: 'Type ticker items here, one per line\nEach line scrolls as its own item',
    clockOn: true, tz: 'ET', liveOn: false, liveText: 'LIVE', liveLoc: '', colors: {}, inDur: 0.9, hold: 0, speed: 140
  };
  const TZ = { ET: 'America/New_York', CT: 'America/Chicago', MT: 'America/Denver', PT: 'America/Los_Angeles', AKT: 'America/Anchorage', HT: 'Pacific/Honolulu', UTC: 'UTC', Local: '' };

  function norm(cfg) {
    const c = Object.assign({}, DEFAULTS, cfg || {}); if (!STYLES[c.style]) c.style = 'cable';
    const k = Object.assign({}, STYLES[c.style].colors);
    const o = c.colors || {};
    ['accent', 'accentText', 'barText', 'stripText'].forEach(n => { if (o[n]) k[n] = o[n]; });
    if (o.bar) { k.bar = o.bar; k.bar2 = shade(o.bar, c.style === 'business' ? 0.18 : -0.12); }
    if (o.strip) k.strip = o.strip;
    return { c, k, layout: STYLES[c.style].layout };
  }

  /* ---- drawing helpers (all in 1920×1080 units) ---- */
  function rect(ctx, x, y, w, h, fill) { if (w <= 0 || h <= 0) return; ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  function vgrad(ctx, y, h, a, b) { const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, a); g.addColorStop(1, b); return g; }
  function clip(ctx, x, y, w, h, fn) { if (w <= 0 || h <= 0) return; ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); fn(); ctx.restore(); }
  function measure(ctx, s, font) { ctx.font = font; return ctx.measureText(s).width; }
  // Draws one line of text vertically centred in a band; shrinks to min size, then condenses horizontally (never truncates).
  function text(ctx, s, x, mid, maxW, mk, size, min, color, align) {
    if (!s) return 0; let sz = size, w;
    for (; ; sz -= 2) { w = measure(ctx, s, mk(sz)); if (w <= maxW || sz <= min) break; }
    const sx = w > maxW ? maxW / w : 1;
    ctx.save(); ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    const tx = align === 'center' ? x + (maxW - w * sx) / 2 : align === 'right' ? x + maxW - w * sx : x;
    ctx.translate(tx, mid + sz * 0.35); ctx.scale(sx, 1); ctx.fillText(s, 0, 0); ctx.restore();
    return w * sx;
  }
  const up = (c, s) => c.caps ? String(s || '').toUpperCase() : String(s || '');

  function liveBug(ctx, c, k, p) {
    if (!c.liveOn) return; const q = seg(p, 0, 0.3); if (q <= 0) return;
    const y = 54, h = 50, t = String(c.liveText || 'LIVE').toUpperCase(), loc = String(c.liveLoc || '').toUpperCase();
    const w1 = measure(ctx, t, fd(800, 36)) + 32, w2 = loc ? measure(ctx, loc, fd(600, 32)) + 32 : 0;
    clip(ctx, X, y, (w1 + w2) * q, h, () => {
      rect(ctx, X, y, w1, h, k.accent === '#111111' ? '#D0021B' : k.accent); text(ctx, t, X + 16, y + h / 2, w1 - 32, s => fd(800, s), 36, 24, '#FFFFFF');
      if (loc) { rect(ctx, X + w1, y, w2, h, 'rgba(0,0,0,0.78)'); text(ctx, loc, X + w1 + 16, y + h / 2, w2 - 32, s => fd(600, s), 32, 22, '#FFFFFF'); }
    });
  }

  // "DOW 38,512 +120.5" → change part coloured green/red with an arrow.
  const CHG = /^(.*?)\s+([+\-−]\s?\d[\d.,]*%?)$/;
  function crawlItems(c) { return String(c.ticker || '').split(/\n+/).map(s => s.trim()).filter(Boolean); }
  function ticker(ctx, c, k, p, o, y, h) {
    if (!c.tickerOn) return; const q = seg(p, 0, 0.35); if (q <= 0) return;
    ctx.save(); ctx.translate(0, (1 - q) * (h + 50));
    rect(ctx, X, y, R - X, h, k.ticker);
    let x0 = X, x1 = R;
    if (c.tickerLabel) { const lw = Math.min(360, measure(ctx, c.tickerLabel.toUpperCase(), fd(800, 30)) + 36); rect(ctx, X, y, lw, h, k.accent); text(ctx, c.tickerLabel.toUpperCase(), X + 18, y + h / 2, lw - 36, s => fd(800, s), 30, 20, k.accentText); x0 += lw; }
    if (c.clockOn && o.clock) { const cw = 150; rect(ctx, R - cw, y, cw, h, shade(k.ticker, 0.14)); text(ctx, o.clock, R - cw, y + h / 2, cw, s => fd(700, s), 30, 20, k.tickerText, 'center'); x1 -= cw; }
    const items = crawlItems(c);
    if (items.length) clip(ctx, x0, y, x1 - x0, h, () => {
      const font = fs(600, 27), gap = 64, parts = items.map(s => { const m = CHG.exec(s); const main = m ? m[1] : s, chg = m ? m[2].replace('−', '-') : ''; const neg = /^-/.test(chg); const ch = chg ? (neg ? '▼ ' : '▲ ') + chg.replace(/^[+-]\s?/, '') : ''; const w = measure(ctx, main, font) + (ch ? 14 + measure(ctx, ch, font) : 0); return { main, ch, neg, w }; });
      const total = parts.reduce((a, b) => a + b.w + gap, 0);
      let x = x0 + 24 - ((o.crawlX || 0) % total);
      ctx.font = font; ctx.textBaseline = 'middle';
      for (let n = 0; x < x1 && n < 500; n++) {
        const it = parts[n % parts.length];
        if (x + it.w > x0) { ctx.fillStyle = k.tickerText; ctx.fillText(it.main, x, y + h / 2 + 1); if (it.ch) { ctx.fillStyle = it.neg ? '#FF5A4E' : '#3DDC84'; ctx.fillText(it.ch, x + it.w - measure(ctx, it.ch, font), y + h / 2 + 1); ctx.font = font; } }
        x += it.w; rect(ctx, x + gap / 2 - 5, y + h / 2 - 5, 10, 10, k.accent === '#111111' ? '#D0021B' : k.accent); x += gap;
      }
    });
    ctx.restore();
  }

  function cable(ctx, c, k, p, o) {
    const dy = c.tickerOn ? 0 : 52, tagY = 780 + dy, barY = 834 + dy, barH = 104, subY = barY + barH, subH = 46, Wd = R - X;
    if (c.tag) {
      const tg = c.tag.toUpperCase(), tw = Math.min(900, measure(ctx, tg, fd(800, 38)) + 44), q = seg(p, 0, 0.3);
      clip(ctx, X, tagY, tw * q, 54, () => { rect(ctx, X, tagY, tw, 54, k.accent); text(ctx, tg, X + 22, tagY + 27, tw - 44, s => fd(800, s), 38, 24, k.accentText); });
    }
    const qb = seg(p, 0.12, 0.5);
    clip(ctx, X, barY, Wd * qb, barH, () => {
      rect(ctx, X, barY, Wd, barH, vgrad(ctx, barY, barH, k.bar, k.bar2));
      const qt = seg(p, 0.35, 0.72); ctx.globalAlpha = qt; ctx.translate(0, (1 - qt) * 40);
      text(ctx, up(c, c.headline), X + 30, barY + barH / 2, Wd - 60, s => fd(800, s), 72, 40, k.barText);
    });
    if (c.sub) {
      const qs = seg(p, 0.3, 0.66);
      clip(ctx, X, subY, Wd * qs, subH, () => {
        rect(ctx, X, subY, Wd, subH, k.strip);
        const qt = seg(p, 0.5, 0.82); ctx.globalAlpha = qt;
        text(ctx, c.sub, X + 30, subY + subH / 2, Wd - 60, s => fs(600, s), 29, 20, k.stripText);
      });
    }
    ticker(ctx, c, k, p, o, 996, 48);
  }

  function business(ctx, c, k, p, o) {
    const dy = c.tickerOn ? 0 : 52, lineY = 836 + dy, barY = lineY + 5, barH = 103, subY = barY + barH, subH = 44, Wd = R - X;
    if (c.tag) {   // tab rises from behind the bar
      const tg = c.tag.toUpperCase(), tw = Math.min(900, measure(ctx, tg, fd(700, 32)) + 40), q = seg(p, 0.45, 0.72);
      clip(ctx, X, lineY - 44, tw, 44, () => { const y = lineY - 44 + (1 - q) * 44; rect(ctx, X, y, tw, 44, k.accent); text(ctx, tg, X + 20, y + 22, tw - 40, s => fd(700, s), 32, 22, k.accentText); });
    }
    rect(ctx, X, lineY, Wd * seg(p, 0, 0.25), 5, k.accent);
    const qb = seg(p, 0.15, 0.5);
    clip(ctx, X, barY, Wd, barH * qb, () => {
      const g = ctx.createLinearGradient(X, 0, R, 0); g.addColorStop(0, k.bar); g.addColorStop(1, k.bar2); rect(ctx, X, barY, Wd, barH, g);
      const qt = seg(p, 0.35, 0.66); ctx.globalAlpha = qt; ctx.translate((1 - qt) * -40, 0);
      text(ctx, up(c, c.headline), X + 30, barY + barH / 2, Wd - 60, s => fd(700, s), 66, 38, k.barText);
    });
    if (c.sub) {
      clip(ctx, X, subY, Wd * seg(p, 0.4, 0.72), subH, () => { rect(ctx, X, subY, Wd, subH, k.strip); ctx.globalAlpha = seg(p, 0.55, 0.85); text(ctx, c.sub, X + 30, subY + subH / 2, Wd - 60, s => fs(600, s), 28, 20, k.stripText); });
    }
    ticker(ctx, c, k, p, o, 996, 48);
  }

  function nameplate(ctx, c, k, p, o) {
    const dy = c.tickerOn ? 0 : 52, y = 846 + dy, nh = 88, th = c.sub ? 48 : 0, x = X + 14;
    const name = up(c, c.headline), nw = Math.max(520, Math.min(1300, measure(ctx, name, fd(800, 62)) + 64));
    const tw = c.sub ? Math.max(360, Math.min(1300, measure(ctx, c.sub, fs(600, 30)) + 48)) : 0;
    const tg = String(c.tag || '').toUpperCase(), gw = tg ? Math.min(R - x - nw, measure(ctx, tg, fd(700, 34)) + 40) : 0;
    rect(ctx, X, y, 14, (nh + th) * seg(p, 0, 0.25), k.accent);
    clip(ctx, x, y, nw * seg(p, 0.15, 0.55), nh, () => {
      rect(ctx, x, y, nw, nh, vgrad(ctx, y, nh, k.bar, k.bar2)); const qt = seg(p, 0.35, 0.7); ctx.globalAlpha = qt; ctx.translate((1 - qt) * -30, 0);
      text(ctx, name, x + 32, y + nh / 2, nw - 64, s => fd(800, s), 62, 36, k.barText);
    });
    if (c.sub) clip(ctx, x, y + nh, tw * seg(p, 0.35, 0.7), th, () => { rect(ctx, x, y + nh, tw, th, k.strip); ctx.globalAlpha = seg(p, 0.5, 0.85); text(ctx, c.sub, x + 24, y + nh + th / 2, tw - 48, s => fs(600, s), 30, 20, k.stripText); });
    if (tg && gw > 60) clip(ctx, x + nw, y, gw * seg(p, 0.5, 0.82), nh, () => { rect(ctx, x + nw, y, gw, nh, k.accent); text(ctx, tg, x + nw + 20, y + nh / 2, gw - 40, s => fd(700, s), 34, 22, k.accentText); });
    ticker(ctx, c, k, p, o, 996, 48);
  }
  const LAYOUTS = { cable, business, nameplate };

  /* Draw a frame. o.p: 0 (off) .. 1 (fully on); o.crawlX: crawl offset px; o.clock: clock text (live only). Clears the canvas. */
  function draw(canvas, cfg, o) {
    o = o || {}; const ctx = canvas.getContext('2d'), s = canvas.width / W, p = o.p == null ? 1 : o.p;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (o.background) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    if (p <= 0) return;
    const { c, k, layout } = norm(cfg);
    ctx.setTransform(s, 0, 0, canvas.height / H, 0, 0);
    LAYOUTS[layout](ctx, c, k, p, o); liveBug(ctx, c, k, p);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function clockText(c, d) {
    try { const tz = TZ[c.tz]; return new Intl.DateTimeFormat('en-US', Object.assign({ hour: 'numeric', minute: '2-digit', hour12: true }, tz ? { timeZone: tz } : {})).format(d || new Date()).replace(/\s?[AP]M$/, '') + (c.tz && c.tz !== 'Local' ? ' ' + c.tz : ''); }
    catch (e) { return ''; }
  }

  /* Player: animates in/out, scrolls the crawl, keeps the clock live. state: 'off' | 'in' | 'on' | 'out'. */
  function Player(canvas, cfg, opts) {
    opts = opts || {};
    const P = { canvas, cfg, state: 'off', p: 0, crawlX: 0, onstate: opts.onstate || null };
    let t0 = 0, last = 0, raf = 0, onAt = 0;
    const set = st => { P.state = st; P.onstate && P.onstate(st); };
    function frame(now) {
      const c = norm(P.cfg).c, dIn = Math.max(0.2, +c.inDur || 0.9), dOut = dIn * 0.7, dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
      if (P.state === 'in') { P.p = Math.min(1, (now - t0) / 1000 / dIn); if (P.p >= 1) { set('on'); onAt = now; } }
      else if (P.state === 'out') { P.p = Math.max(0, 1 - (now - t0) / 1000 / dOut); if (P.p <= 0) set('off'); }
      else if (P.state === 'on' && +c.hold > 0 && opts.autoOut !== false && now - onAt > c.hold * 1000) P.out();
      if (P.p > 0.25) P.crawlX += dt * (+c.speed || 140);
      draw(canvas, P.cfg, { p: P.p, crawlX: P.crawlX, clock: clockText(c), background: opts.background });
      raf = requestAnimationFrame(frame);
    }
    P.in = () => { if (P.state === 'on' || P.state === 'in') return; t0 = performance.now() - (P.state === 'out' ? (P.p * Math.max(0.2, +norm(P.cfg).c.inDur || 0.9)) * 1000 : 0); if (P.state === 'off') P.crawlX = 0; set('in'); };
    P.out = () => { if (P.state === 'off' || P.state === 'out') return; t0 = performance.now() - (1 - P.p) * Math.max(0.2, +norm(P.cfg).c.inDur || 0.9) * 0.7 * 1000; set('out'); };
    P.toggle = () => (P.state === 'on' || P.state === 'in') ? P.out() : P.in();
    P.show = () => { P.p = 1; set('on'); onAt = performance.now(); };
    P.start = () => { if (!raf) raf = requestAnimationFrame(frame); return P; };
    P.stop = () => { cancelAnimationFrame(raf); raf = 0; last = 0; };
    return P;
  }

  // URL-safe base64 of the config JSON, for the live browser-source link.
  function encode(cfg) { const b = new TextEncoder().encode(JSON.stringify(cfg)); let s = ''; b.forEach(x => { s += String.fromCharCode(x); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function decode(str) { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); return JSON.parse(new TextDecoder().decode(Uint8Array.from(s, ch => ch.charCodeAt(0)))); }

  async function fontsReady() {
    if (!document.fonts) return;
    await Promise.all(['800 40px "Barlow Condensed"', '700 40px "Barlow Condensed"', '600 40px "Barlow Condensed"', '600 30px "Barlow"'].map(f => document.fonts.load(f).catch(() => {})));
  }

  NS.LT = { W, H, STYLES, DEFAULTS, TZ, norm, draw, Player, clockText, encode, decode, fontsReady, crawlItems };
})();
