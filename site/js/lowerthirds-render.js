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
    wxlive: { name: 'Weather live shot (full package)', layout: 'wxlive', colors: { accent: '#D7142B', accentText: '#FFFFFF', bar: '#FFFFFF', bar2: '#EEF1F6', barText: '#0B1220', strip: '#1E3A99', stripText: '#FFFFFF', ticker: '#C8102E', tickerText: '#FFFFFF' } },
    weather: { name: 'Weather alert (navy)', layout: 'cable', colors: { accent: '#F2453D', accentText: '#FFFFFF', bar: '#0C1119', bar2: '#1A2230', barText: '#FFFFFF', strip: '#E8EDF3', stripText: '#0C1119', ticker: '#080C12', tickerText: '#E8EDF3' } }
  };

  const DEFAULTS = {
    style: 'cable', tag: 'BREAKING NEWS', headline: 'Headline goes here', sub: 'Supporting line with the key detail', caps: true,
    tickerOn: true, tickerLabel: 'LATEST', ticker: 'Type ticker items here, one per line\nEach line scrolls as its own item',
    clockOn: true, tz: 'ET', liveOn: false, liveText: 'LIVE', liveLoc: '', colors: {}, inDur: 0.9, hold: 0, speed: 140,
    // Weather live shot only
    reporter: 'REPORTER NAME', reporterTitle: 'Storm Specialist', logoTop: 'WX', logoBottom: 'WEATHER', logoImg: '',
    boxOn: true, boxTitle: 'WINTER STORM', boxSub: 'LIVE RADAR', boxImg: '',
    panelOn: false, wxLoc: 'City, ST', wxTemp: '', wxLo: '', wxHi: '', wxCond: '', wxRows: 'Wind Chill | \nSnow to Come | \nWind | \nVisibility | '
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
  function rr(ctx, x, y, w, h, r, fill) { if (w <= 0 || h <= 0) return; r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } }
  const IMG = new Map();
  function img(src) { if (!src) return null; let i = IMG.get(src); if (!i) { i = new Image(); i.src = src; IMG.set(src, i); } return i.complete && i.naturalWidth ? i : null; }
  function preload(cfg) { return Promise.all([cfg && cfg.logoImg, cfg && cfg.boxImg].filter(Boolean).map(s => { img(s); return IMG.get(s).decode().catch(() => {}); })); }
  function drawCover(ctx, im, x, y, w, h, contain) { const s = (contain ? Math.min : Math.max)(w / im.naturalWidth, h / im.naturalHeight), dw = im.naturalWidth * s, dh = im.naturalHeight * s; clip(ctx, x, y, w, h, () => ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)); }
  // Several coloured runs on one line, fitted together like text().
  function runs(ctx, parts, x, mid, maxW, mk, size, min, align) {
    parts = parts.filter(r => r[0]); if (!parts.length) return; let sz = size, w;
    for (; ; sz -= 2) { ctx.font = mk(sz); w = parts.reduce((a, r) => a + ctx.measureText(r[0]).width, 0); if (w <= maxW || sz <= min) break; }
    const sx = w > maxW ? maxW / w : 1; ctx.save(); ctx.textBaseline = 'alphabetic';
    ctx.translate(align === 'center' ? x + (maxW - w * sx) / 2 : x, mid + sz * 0.35); ctx.scale(sx, 1); ctx.font = mk(sz);
    let cx = 0; parts.forEach(([t, col]) => { ctx.fillStyle = col; ctx.fillText(t, cx, 0); cx += ctx.measureText(t).width; }); ctx.restore();
  }
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
  function crawl(ctx, c, k, o, x0, x1, y, h, font, dot) {
    const items = crawlItems(c).map(t => c.style === 'wxlive' && c.caps ? t.toUpperCase() : t); if (!items.length) return;
    clip(ctx, x0, y, x1 - x0, h, () => {
      const gap = 64, parts = items.map(s => { const m = CHG.exec(s); const main = m ? m[1] : s, chg = m ? m[2].replace('−', '-') : ''; const neg = /^-/.test(chg); const ch = chg ? (neg ? '▼ ' : '▲ ') + chg.replace(/^[+-]\s?/, '') : ''; const w = measure(ctx, main, font) + (ch ? 14 + measure(ctx, ch, font) : 0); return { main, ch, neg, w }; });
      const total = parts.reduce((a, b) => a + b.w + gap, 0);
      let x = x0 + 24 - ((o.crawlX || 0) % total);
      ctx.font = font; ctx.textBaseline = 'middle';
      for (let n = 0; x < x1 && n < 500; n++) {
        const it = parts[n % parts.length];
        if (x + it.w > x0) { ctx.fillStyle = k.tickerText; ctx.fillText(it.main, x, y + h / 2 + 1); if (it.ch) { ctx.fillStyle = it.neg ? '#FF5A4E' : '#3DDC84'; ctx.fillText(it.ch, x + it.w - measure(ctx, it.ch, font), y + h / 2 + 1); ctx.font = font; } }
        x += it.w; rect(ctx, x + gap / 2 - 5, y + h / 2 - 5, 10, 10, dot); x += gap;
      }
    });
  }
  function ticker(ctx, c, k, p, o, y, h) {
    if (!c.tickerOn) return; const q = seg(p, 0, 0.35); if (q <= 0) return;
    ctx.save(); ctx.translate(0, (1 - q) * (h + 50));
    rect(ctx, X, y, R - X, h, k.ticker);
    let x0 = X, x1 = R;
    if (c.tickerLabel) { const lw = Math.min(360, measure(ctx, c.tickerLabel.toUpperCase(), fd(800, 30)) + 36); rect(ctx, X, y, lw, h, k.accent); text(ctx, c.tickerLabel.toUpperCase(), X + 18, y + h / 2, lw - 36, s => fd(800, s), 30, 20, k.accentText); x0 += lw; }
    if (c.clockOn && o.clock) { const cw = 150; rect(ctx, R - cw, y, cw, h, shade(k.ticker, 0.14)); text(ctx, o.clock, R - cw, y + h / 2, cw, s => fd(700, s), 30, 20, k.tickerText, 'center'); x1 -= cw; }
    crawl(ctx, c, k, o, x0, x1, y, h, fs(600, 27), k.accent === '#111111' ? '#D0021B' : k.accent);
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
  /* Weather live shot: logo box | reporter strip over a two-line headline | promo box, red LIVE crawl underneath,
     optional current-conditions panel top right. Every value is typed by the user. */
  function wxlive(ctx, c, k, p, o) {
    const top = c.tickerOn ? 796 : 850, lx = X, lw = 196, bh = 178, gx = lx + lw + 12;
    const boxW = c.boxOn ? 316 : 0, mx1 = R - (boxW ? boxW + 12 : 0), mw = mx1 - gx, nameH = 50, headH = bh - nameH;
    // logo box pops in
    const ql = seg(p, 0, 0.3);
    if (ql > 0) {
      ctx.save(); ctx.translate(lx + lw / 2, top + bh / 2); ctx.scale(0.6 + 0.4 * ql, 0.6 + 0.4 * ql); ctx.globalAlpha = ql; ctx.translate(-(lx + lw / 2), -(top + bh / 2));
      rr(ctx, lx, top, lw, bh, 14, '#FFFFFF'); ctx.lineWidth = 4; ctx.strokeStyle = k.strip; ctx.stroke();
      const li = img(c.logoImg);
      if (li) drawCover(ctx, li, lx + 12, top + 12, lw - 24, bh - 24, true);
      else {
        text(ctx, String(c.logoTop || '').toUpperCase(), lx + 12, top + 66, lw - 24, s => fd(800, s), 92, 40, k.strip, 'center');
        if (c.logoBottom) { rr(ctx, lx + 12, top + 112, lw - 24, 52, 8, k.accent); text(ctx, String(c.logoBottom).toUpperCase(), lx + 20, top + 138, lw - 40, s => fd(800, s), 44, 22, k.accentText, 'center'); }
      }
      ctx.restore();
    }
    // reporter strip
    clip(ctx, gx, top, mw * seg(p, 0.1, 0.42), nameH, () => {
      ctx.save(); rr(ctx, gx, top, mw, nameH + 12, 10); ctx.clip();
      const g = ctx.createLinearGradient(gx, 0, mx1, 0); g.addColorStop(0, k.strip); g.addColorStop(1, shade(k.strip, -0.25)); rect(ctx, gx, top, mw, nameH, g); ctx.restore();
      ctx.globalAlpha = seg(p, 0.3, 0.6);
      runs(ctx, [['▶  ', k.accent], [up(c, c.reporter), k.stripText], [c.reporter && c.reporterTitle ? '  |  ' : '', k.accent], [up(c, c.reporterTitle), k.stripText]], gx + 22, top + nameH / 2, mw - 44, sz => fd(700, sz), 40, 24);
    });
    // headline + sub on white
    clip(ctx, gx, top + nameH, mw * seg(p, 0.2, 0.55), headH, () => {
      ctx.save(); rr(ctx, gx, top + nameH - 12, mw, headH + 12, 10); ctx.clip(); rect(ctx, gx, top + nameH, mw, headH, vgrad(ctx, top + nameH, headH, k.bar, k.bar2)); ctx.restore();
      const qt = seg(p, 0.42, 0.8); ctx.globalAlpha = qt; ctx.translate(0, (1 - qt) * 24);
      const tag = c.tag ? String(c.tag).toUpperCase().replace(/\s*$/, ' ') : '';
      runs(ctx, [[tag, k.accent], [up(c, c.headline), k.barText]], gx + 22, top + nameH + (c.sub ? 44 : headH / 2), mw - 44, sz => fd(800, sz), 72, 36);
      if (c.sub) text(ctx, up(c, c.sub), gx + 22, top + nameH + 98, mw - 44, sz => fd(700, sz), 38, 22, shade(k.barText, 0.15));
    });
    // promo box slides in from the right
    if (c.boxOn) {
      const qb = seg(p, 0.3, 0.66), bx = mx1 + 12 + (1 - qb) * 120;
      if (qb > 0) clip(ctx, mx1 + 12, top - 10, boxW + 40, bh + 20, () => {
        ctx.globalAlpha = qb; rr(ctx, bx, top, boxW, bh, 12, '#FFFFFF'); ctx.save(); rr(ctx, bx, top, boxW, bh, 12); ctx.clip();
        text(ctx, String(c.boxTitle || '').toUpperCase(), bx + 12, top + 26, boxW - 24, s => fd(800, s), 38, 20, k.barText, 'center');
        rect(ctx, bx, top + 50, boxW, 34, k.accent); text(ctx, String(c.boxSub || '').toUpperCase(), bx + 12, top + 67, boxW - 24, s => fd(800, s), 30, 18, k.accentText, 'center');
        const bi = img(c.boxImg); const iy = top + 84, ih = bh - 84;
        if (bi) drawCover(ctx, bi, bx, iy, boxW, ih); else { rect(ctx, bx, iy, boxW, ih, vgrad(ctx, iy, ih, '#1A2230', '#0C1119')); if (o.preview) text(ctx, 'ADD IMAGE', bx, iy + ih / 2, boxW, s => fd(600, s), 26, 16, '#5A6A82', 'center'); }
        ctx.restore(); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.25)'; rr(ctx, bx, top, boxW, bh, 12); ctx.stroke();
      });
    }
    // red LIVE crawl
    if (c.tickerOn) {
      const q = seg(p, 0, 0.35), y = 990, h = 54;
      if (q > 0) {
        ctx.save(); ctx.translate(0, (1 - q) * (h + 60));
        rr(ctx, X, y, R - X, h, 10, vgrad(ctx, y, h, k.ticker, shade(k.ticker, -0.22)));
        ctx.save(); rr(ctx, X, y, R - X, h, 10); ctx.clip();
        let x0 = X; const lt = String(c.liveText || 'LIVE').toUpperCase();
        if (lt) { const w = measure(ctx, lt, fd(800, 40)) + 56; rect(ctx, X, y, w, h, shade(k.ticker, 0.12)); text(ctx, lt, X, y + h / 2, w, s => fd(800, s), 40, 24, k.tickerText, 'center'); x0 += w; }
        if (c.tickerLabel) { const t = '((•))  ' + c.tickerLabel.toUpperCase(), w = measure(ctx, t, fd(800, 38)) + 40; text(ctx, t, x0 + 18, y + h / 2, w - 30, s => fd(800, s), 38, 22, k.tickerText); x0 += w; rect(ctx, x0, y + 10, 3, h - 20, 'rgba(255,255,255,0.6)'); x0 += 3; }
        let x1 = R;
        if (c.clockOn && o.clock) { const cw = 150; rect(ctx, R - cw, y, cw, h, shade(k.ticker, -0.3)); text(ctx, o.clock, R - cw, y + h / 2, cw, s => fd(700, s), 32, 20, k.tickerText, 'center'); x1 -= cw; }
        crawl(ctx, c, k, o, x0, x1, y, h, fd(800, 38), 'rgba(255,255,255,0.7)');
        ctx.restore(); ctx.restore();
      }
    }
    if (c.panelOn) conditions(ctx, c, k, p);
  }
  function conditions(ctx, c, k, p) {
    const q = seg(p, 0.2, 0.6); if (q <= 0) return;
    const rows = String(c.wxRows || '').split(/\n+/).map(l => l.split('|').map(s => s.trim())).filter(r => r[0]).slice(0, 5);
    const w = 400, x = R - w + (1 - q) * (w + 120), y = 36, hh = 320 + rows.length * 76 + 6;
    ctx.save(); ctx.globalAlpha = q;
    rr(ctx, x, y, w, hh, 24, 'rgba(10,18,40,0.86)');
    rr(ctx, x + 20, y + 22, w - 40, 66, 33, k.strip); text(ctx, c.wxLoc || '', x + 40, y + 55, w - 80, s => fd(700, s), 42, 24, k.stripText, 'center');
    if (c.wxTemp) text(ctx, c.wxTemp, x + 90, y + 170, w - 180, s => fd(700, s), 132, 60, '#FFFFFF', 'center');
    if (c.wxLo) text(ctx, '▼ ' + c.wxLo, x + 18, y + 158, 100, s => fd(700, s), 40, 22, '#FFFFFF', 'center');
    if (c.wxHi) text(ctx, '▲ ' + c.wxHi, x + w - 118, y + 158, 100, s => fd(700, s), 40, 22, '#FFFFFF', 'center');
    if (c.wxCond) text(ctx, c.wxCond, x + 20, y + 268, w - 40, s => fd(600, s), 40, 22, '#FFFFFF', 'center');
    rows.forEach((r, i) => {
      const ry = y + 314 + i * 76; rr(ctx, x + 20, ry, w - 40, 62, 31, shade(k.strip, -0.1));
      text(ctx, r[0], x + 46, ry + 31, (w - 92) * 0.6, s => fd(600, s), 36, 20, '#FFFFFF');
      if (r[1]) text(ctx, r[1], x + 46 + (w - 92) * 0.45, ry + 31, (w - 92) * 0.55, s => fd(800, s), 36, 20, '#FFFFFF', 'right');
    });
    ctx.restore();
  }
  const LAYOUTS = { cable, business, nameplate, wxlive };

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
      draw(canvas, P.cfg, { p: P.p, crawlX: P.crawlX, clock: clockText(c), background: opts.background, preview: opts.preview });
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

  NS.LT = { W, H, STYLES, DEFAULTS, TZ, norm, draw, Player, clockText, encode, decode, fontsReady, crawlItems, preload };
})();
