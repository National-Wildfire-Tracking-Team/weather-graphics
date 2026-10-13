/* SPC outlook legend, drawn on the map frame (preview and every export size).
   Entries come from the polygons actually fetched for the enabled SPC layers: SPC's own labels and colors, nothing invented.
   Only the plain-language descriptions are static text. */
(function () {
  const CATEGORY = {   // dn -> [title, short description]; numbers are SPC's 1-5 scale
    2: ['THUNDER', 'storms possible'], 3: ['1/5 MARGINAL', 'isolated severe storms'], 4: ['2/5 SLIGHT', 'scattered severe storms'],
    5: ['3/5 ENHANCED', 'numerous severe storms'], 6: ['4/5 MODERATE', 'widespread severe storms'], 8: ['5/5 HIGH', 'widespread, intense severe storms']
  };
  const spcLayers = state => NS.Providers.filter(p => /^spc-/.test(p.id) && state.layers[p.id] && state.layers[p.id].on);

  /* -> [{title, sub, fill, stroke, order}] for the SPC layers that are on and have data (deduplicated, lowest risk first). */
  NS.legendEntries = function (state) {
    const out = new Map();
    spcLayers(state).forEach(p => {
      const snap = state.layerData[p.id], feats = snap && snap.data && snap.data.features || [], kind = /overview$/.test(p.id) ? 0 : /-int$/.test(p.id) ? 2 : 1;
      feats.forEach(f => {
        const q = f.properties || {}; if (!q.fill || q.dn == null) return;
        let title, sub;
        if (kind === 0) { const c = CATEGORY[q.dn]; if (!c) return; title = c[0]; sub = c[1]; }
        else if (kind === 1) { title = String(q.label2 || '').replace(/\s*Risk$/i, '').replace(/^(\d+%)\s+(.*)$/, '$1 $2').toUpperCase(); sub = 'chance within 25 miles of a point'; }
        else { title = String(q.label2 || 'Significant severe').replace(/\s*Risk$/i, '').toUpperCase(); sub = 'significant severe possible'; }
        if (!title) return;
        const key = kind + '|' + title + '|' + q.fill;
        if (!out.has(key)) out.set(key, { title, sub, fill: q.fill, stroke: q.stroke || q.fill, order: kind * 1000 + q.dn });
      });
    });
    return [...out.values()].sort((a, b) => a.order - b.order);
  };

  /* Draws the legend box inside the rect (x, y, w, h) of ctx. pos: 'br' | 'bl' | 'tr' | 'tl'. */
  NS.drawLegend = function (ctx, entries, x, y, w, h, pos) {
    if (!entries.length) return;
    const k = Math.max(0.35, h / 1080), pad = 22 * k, sw = 40 * k, gap = 16 * k, rowH = 58 * k, margin = 30 * k;
    const tf = '800 ' + 28 * k + 'px "Barlow Condensed", Oswald, sans-serif', sf = '600 ' + 19 * k + 'px Barlow, sans-serif';
    ctx.save();
    let tw = 0; entries.forEach(e => { ctx.font = tf; const a = ctx.measureText(e.title).width; ctx.font = sf; tw = Math.max(tw, a, ctx.measureText(e.sub).width); });
    const bw = pad * 2 + sw + gap + tw, bh = pad * 2 + rowH * entries.length - (rowH - sw);
    const bx = /l$/.test(pos) ? x + margin : x + w - margin - bw, by = /^t/.test(pos) ? y + margin : y + h - margin - bh - 26 * k;
    ctx.fillStyle = 'rgba(12,17,25,.82)'; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#3A4558'; ctx.lineWidth = Math.max(1, 2 * k); ctx.strokeRect(bx, by, bw, bh);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    entries.forEach((e, i) => {
      const ry = by + pad + i * rowH;
      ctx.fillStyle = e.fill; ctx.fillRect(bx + pad, ry, sw, sw);
      ctx.strokeStyle = e.stroke; ctx.lineWidth = Math.max(1, 3 * k); ctx.strokeRect(bx + pad + ctx.lineWidth / 2, ry + ctx.lineWidth / 2, sw - ctx.lineWidth, sw - ctx.lineWidth);
      ctx.fillStyle = '#FFFFFF'; ctx.font = tf; ctx.fillText(e.title, bx + pad + sw + gap, ry + 20 * k);
      ctx.fillStyle = '#9AA7B8'; ctx.font = sf; ctx.fillText(e.sub, bx + pad + sw + gap, ry + 39 * k);
    });
    ctx.restore();
  };
})();
