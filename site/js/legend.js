/* SPC, WPC and CPC outlook legend (convective, excessive rainfall, QPF, snowfall, week-ahead hazards), drawn on the map frame (preview and every export size).
   Entries come from the polygons actually fetched for the enabled SPC/WPC layers: their own labels and colors, nothing invented.
   Only the plain-language descriptions are static text. */
(function () {
  const CATEGORY = {   // dn -> [title, short description]; numbers are SPC's 1-5 scale
    2: ['THUNDER', 'storms possible'], 3: ['1/5 MARGINAL', 'isolated severe storms'], 4: ['2/5 SLIGHT', 'scattered severe storms'],
    5: ['3/5 ENHANCED', 'numerous severe storms'], 6: ['4/5 MODERATE', 'widespread severe storms'], 8: ['5/5 HIGH', 'widespread, intense severe storms']
  };
  const SNOW = { 1: ['SLIGHT SNOW', '10-39% chance of 4+ in'], 2: ['MODERATE SNOW', '40-69% chance of 4+ in'], 3: ['HIGH SNOW', '70-100% chance of 4+ in'] };
  const ERO = { 1: ['1/4 MARGINAL', '5%+ chance of flash flooding rain'], 2: ['2/4 SLIGHT', '15%+ chance of flash flooding rain'],
    3: ['3/4 MODERATE', '40%+ chance of flash flooding rain'], 4: ['4/4 HIGH', '70%+ chance of flash flooding rain'] };
  const outlookLayers = state => NS.Providers.filter(p => /^(spc|rain-fcst|snow-fcst|ero|hazards-outlook)/.test(p.id) && state.layers[p.id] && state.layers[p.id].on);

  /* -> [{title, sub, fill, stroke, order}] for the SPC layers that are on and have data (deduplicated, lowest risk first). */
  NS.legendEntries = function (state) {
    const out = new Map();
    outlookLayers(state).forEach(p => {
      const snap = state.layerData[p.id], feats = snap && snap.data && snap.data.features || [], kind = p.id === 'hazards-outlook' ? 6 : /^ero/.test(p.id) ? 5 : /^rain/.test(p.id) ? 3 : /^snow/.test(p.id) ? 4 : /overview$/.test(p.id) ? 0 : /-int$/.test(p.id) ? 2 : 1;
      feats.forEach(f => {
        const q = f.properties || {};
        let title, sub, fill = q.fill, stroke = q.stroke, ord = q.dn;
        if (kind === 3) { if (q.qpf == null || !q.color) return; title = (+q.qpf < 0.1 ? '0.01' : (+q.qpf).toString()) + '" +'; sub = 'inches of rain forecast'; fill = q.color; stroke = q.color; ord = +q.qpf; }
        else if (kind === 4) { const c = SNOW[Math.round(q.dn)]; if (!c || !q.color) return; title = c[0]; sub = c[1]; fill = q.color; stroke = q.color; ord = Math.round(q.dn); }
        else if (kind === 6) { if (!q.legend || !fill) return; title = q.legend; sub = (q.src === 'snow' ? q.detail : q.hazard).toLowerCase() + ' · ' + q.srcName; ord = 10 - q.level; }
        else if (kind === 5) { const c = ERO[q.dn]; if (!c || !fill) return; title = c[0]; sub = c[1]; }
        else if (!fill || q.dn == null) return;
        else if (kind === 0) { const c = CATEGORY[q.dn]; if (!c) return; title = c[0]; sub = c[1]; }
        else if (kind === 1) { title = String(q.label2 || '').replace(/\s*Risk$/i, '').replace(/^(\d+%)\s+(.*)$/, '$1 $2').toUpperCase(); sub = 'chance within 25 miles of a point'; }
        else { title = String(q.label2 || 'Significant severe').replace(/\s*Risk$/i, '').toUpperCase(); sub = 'significant severe possible'; }
        if (!title) return;
        const key = kind + '|' + title + '|' + fill;
        if (!out.has(key)) out.set(key, { title, sub, fill, stroke: stroke || fill, order: kind * 1000 + ord });
      });
    });
    return [...out.values()].sort((a, b) => a.order - b.order);
  };

  /* Draws the legend box inside the rect (x, y, w, h) of ctx. pos: 'br' | 'bl' | 'tr' | 'tl'. */
  NS.drawLegend = function (ctx, entries, x, y, w, h, pos) {
    if (!entries.length) return;
    const compact = entries.length > 8, k = Math.max(0.35, h / 1080), pad = 22 * k, sw = (compact ? 26 : 40) * k, gap = 16 * k, rowH = (compact ? 36 : 58) * k, margin = 30 * k;
    const tf = '800 ' + 28 * k + 'px "Barlow Condensed", Oswald, sans-serif', sf = '600 ' + 19 * k + 'px Barlow, sans-serif';
    ctx.save();
    let tw = 0; entries.forEach(e => { ctx.font = tf; const a = ctx.measureText(e.title).width; ctx.font = sf; tw = Math.max(tw, a, compact ? 0 : ctx.measureText(e.sub).width); });
    const bw = pad * 2 + sw + gap + tw, bh = pad * 2 + rowH * entries.length - (rowH - sw);
    const bx = /l$/.test(pos) ? x + margin : x + w - margin - bw, by = /^t/.test(pos) ? y + margin : y + h - margin - bh - 26 * k;
    ctx.fillStyle = 'rgba(12,17,25,.82)'; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#3A4558'; ctx.lineWidth = Math.max(1, 2 * k); ctx.strokeRect(bx, by, bw, bh);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    entries.forEach((e, i) => {
      const ry = by + pad + i * rowH;
      ctx.fillStyle = e.fill; ctx.fillRect(bx + pad, ry, sw, sw);
      ctx.strokeStyle = e.stroke; ctx.lineWidth = Math.max(1, 3 * k); ctx.strokeRect(bx + pad + ctx.lineWidth / 2, ry + ctx.lineWidth / 2, sw - ctx.lineWidth, sw - ctx.lineWidth);
      ctx.fillStyle = '#FFFFFF'; ctx.font = tf; ctx.fillText(e.title, bx + pad + sw + gap, ry + (compact ? 21 : 20) * k);
      if (!compact) { ctx.fillStyle = '#9AA7B8'; ctx.font = sf; ctx.fillText(e.sub, bx + pad + sw + gap, ry + 39 * k); }
    });
    ctx.restore();
  };
})();
