/* Chart, legend and scale components. Each is a fabric.Group built from the user's data and keeps its spec in
   `chartSpec` so it can be re-opened and edited. Values are never invented: empty data renders an empty chart. */
(function () {
  const T = (txt, o) => new fabric.Text(String(txt), Object.assign({ fontFamily: 'Barlow', fontSize: 20, fill: '#E8EDF3', originX: 'left', originY: 'top' }, o));
  const nice = max => { if (max <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(max))), n = max / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
  const PAL = ['#F2453D', '#4C9BFF', '#F2B53D', '#3FB6C9', '#E8EDF3', '#9AA7B8'];
  const lerp = (a, b, t) => a + (b - a) * t;
  const hex2 = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
  const mix = (c1, c2, t) => { const a = hex2(c1), b = hex2(c2); return '#' + a.map((v, i) => Math.round(lerp(v, b[i], t)).toString(16).padStart(2, '0')).join(''); };

  const C = {
    defaults(type) {
      const d = {
        bar: { type: 'bar', title: 'Chart title', unit: '', labels: ['A', 'B', 'C'], values: [0, 0, 0], color: '#F2453D', w: 720, h: 420, font: 'Barlow', textColor: '#E8EDF3', showValues: true },
        line: { type: 'line', title: 'Chart title', unit: '', labels: ['A', 'B', 'C'], values: [0, 0, 0], color: '#4C9BFF', w: 720, h: 420, font: 'Barlow', textColor: '#E8EDF3', showValues: true },
        pie: { type: 'pie', title: 'Chart title', unit: '', labels: ['A', 'B', 'C'], values: [1, 1, 1], colors: PAL, w: 520, h: 420, font: 'Barlow', textColor: '#E8EDF3', showValues: true },
        table: { type: 'table', title: '', columns: ['Name', 'Value'], rows: [['', ''], ['', '']], w: 640, h: 0, font: 'Barlow', textColor: '#E8EDF3', headerFill: '#F2453D', headerText: '#0C1119', rowH: 44 },
        callout: { type: 'callout', value: '0', label: 'Label', unit: '', color: '#F2453D', w: 320, h: 160, font: 'Barlow Condensed', textColor: '#E8EDF3' },
        legend: { type: 'legend', title: 'Legend', unit: '', stops: [{ v: '0', c: '#3FB6C9' }, { v: '50', c: '#F2B53D' }, { v: '100', c: '#F2453D' }], w: 520, h: 90, font: 'Barlow', textColor: '#E8EDF3', continuous: true },
        scalebar: { type: 'scalebar', km: 100, px: 200, font: 'Barlow', textColor: '#E8EDF3', units: 'mi' }
      };
      return JSON.parse(JSON.stringify(d[type]));
    },
    // preset scale definitions (legends). Values are the standard categories, not data.
    PRESETS: {
      temp: { title: 'Temperature', unit: '°F', stops: [{ v: '0', c: '#6C5CE7' }, { v: '32', c: '#4C9BFF' }, { v: '50', c: '#3FB6C9' }, { v: '70', c: '#F2B53D' }, { v: '90', c: '#F2453D' }, { v: '105', c: '#B1121B' }] },
      rain: { title: 'Rainfall accumulation', unit: 'in', stops: [{ v: '0.1', c: '#8FD3E8' }, { v: '0.5', c: '#4C9BFF' }, { v: '1', c: '#3FB6C9' }, { v: '2', c: '#F2B53D' }, { v: '4', c: '#F2453D' }, { v: '6+', c: '#B1121B' }] },
      wind: { title: 'Wind speed', unit: 'mph', stops: [{ v: '10', c: '#8FD3E8' }, { v: '20', c: '#4C9BFF' }, { v: '30', c: '#F2B53D' }, { v: '45', c: '#F2453D' }, { v: '60+', c: '#B1121B' }] }
    },
    build(spec) {
      const objs = [], f = spec.font, tc = spec.textColor;
      let w = spec.w, h = spec.h;
      const title = spec.title ? T(spec.title, { fontFamily: f, fontWeight: 700, fontSize: 26, fill: tc }) : null;
      const top = title ? 44 : 0; if (title) objs.push(title);
      const unit = spec.unit || '';
      if (spec.type === 'bar' || spec.type === 'line') {
        const vals = (spec.values || []).map(Number).map(v => isNaN(v) ? 0 : v), n = vals.length, max = nice(Math.max(0, ...vals)), padL = 56, padB = 36, ph = h - top - padB - 8, pw = w - padL;
        for (let i = 0; i <= 4; i++) { const y = top + ph - ph * i / 4; objs.push(new fabric.Line([padL, y, w, y], { stroke: 'rgba(232,237,243,.18)', strokeWidth: 1 })); objs.push(T(+(max * i / 4).toFixed(2), { left: 0, top: y - 10, fontFamily: f, fontSize: 16, fill: tc, opacity: .75 })); }
        const step = pw / Math.max(1, n);
        if (spec.type === 'bar') vals.forEach((v, i) => {
          const bh = ph * v / max, x = padL + step * i + step * 0.15, bw = step * 0.7; objs.push(new fabric.Rect({ left: x, top: top + ph - bh, width: bw, height: Math.max(0, bh), fill: spec.color }));
          if (spec.showValues) objs.push(T(v + unit, { left: x + bw / 2, top: top + ph - bh - 24, originX: 'center', fontFamily: f, fontSize: 18, fontWeight: 600, fill: tc }));
        });
        else { const pts = vals.map((v, i) => ({ x: padL + step * (i + .5), y: top + ph - ph * v / max })); if (pts.length > 1) objs.push(new fabric.Polyline(pts, { fill: null, stroke: spec.color, strokeWidth: 4, strokeLineJoin: 'round', strokeLineCap: 'round', objectCaching: false }));
          pts.forEach((p, i) => { objs.push(new fabric.Circle({ left: p.x - 6, top: p.y - 6, radius: 6, fill: spec.color })); if (spec.showValues) objs.push(T(vals[i] + unit, { left: p.x, top: p.y - 30, originX: 'center', fontFamily: f, fontSize: 18, fontWeight: 600, fill: tc })); }); }
        (spec.labels || []).forEach((l, i) => objs.push(T(l, { left: padL + step * (i + .5), top: top + ph + 10, originX: 'center', fontFamily: f, fontSize: 18, fill: tc })));
      } else if (spec.type === 'pie') {
        const vals = (spec.values || []).map(Number).map(v => isNaN(v) || v < 0 ? 0 : v), sum = vals.reduce((a, b) => a + b, 0), r = Math.min(h - top, w * 0.55) / 2, cx = r, cy = top + r;
        let a0 = -Math.PI / 2;
        if (sum > 0) vals.forEach((v, i) => {
          if (!v) return; const a1 = a0 + 2 * Math.PI * v / sum, large = a1 - a0 > Math.PI ? 1 : 0;
          const p = 'M ' + cx + ' ' + cy + ' L ' + (cx + r * Math.cos(a0)) + ' ' + (cy + r * Math.sin(a0)) + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + (cx + r * Math.cos(a1)) + ' ' + (cy + r * Math.sin(a1)) + ' Z';
          if (vals.filter(x => x > 0).length === 1) objs.push(new fabric.Circle({ left: cx - r, top: cy - r, radius: r, fill: spec.colors[i % spec.colors.length] })); else objs.push(new fabric.Path(p, { fill: spec.colors[i % spec.colors.length], stroke: '#0C1119', strokeWidth: 2 }));
          a0 = a1;
        });
        vals.forEach((v, i) => { const y = top + 10 + i * 34, x = r * 2 + 28; objs.push(new fabric.Rect({ left: x, top: y + 3, width: 18, height: 18, fill: spec.colors[i % spec.colors.length] })); objs.push(T((spec.labels[i] || '') + (spec.showValues ? '  ' + (sum ? Math.round(v / sum * 100) + '%' : '') : ''), { left: x + 28, top: y, fontFamily: f, fontSize: 20, fill: tc })); });
        w = r * 2 + 28 + 260;
      } else if (spec.type === 'table') {
        const cols = spec.columns, cw = w / cols.length, rh = spec.rowH;
        objs.push(new fabric.Rect({ left: 0, top: top, width: w, height: rh, fill: spec.headerFill }));
        cols.forEach((c, i) => objs.push(T(c, { left: i * cw + 12, top: top + (rh - 22) / 2, fontFamily: f, fontWeight: 700, fontSize: 22, fill: spec.headerText })));
        spec.rows.forEach((r, ri) => { const y = top + rh * (ri + 1); if (ri % 2) objs.push(new fabric.Rect({ left: 0, top: y, width: w, height: rh, fill: 'rgba(232,237,243,.07)' })); r.forEach((c, i) => objs.push(T(c, { left: i * cw + 12, top: y + (rh - 22) / 2, fontFamily: f, fontSize: 22, fill: tc }))); });
        h = top + rh * (spec.rows.length + 1);
      } else if (spec.type === 'callout') {
        objs.push(new fabric.Rect({ left: 0, top: 0, width: 8, height: h, fill: spec.color }));
        objs.push(T(spec.value + (spec.unit || ''), { left: 28, top: 0, fontFamily: f, fontWeight: 800, fontSize: Math.round(h * 0.62), fill: tc }));
        objs.push(T(spec.label, { left: 30, top: h * 0.72, fontFamily: spec.font === 'Barlow Condensed' ? 'Barlow' : f, fontSize: Math.round(h * 0.16), fill: tc, opacity: .85 }));
      } else if (spec.type === 'legend') {
        const st = spec.stops, bx = 0, by = top + (title ? 4 : 0), bw = w, bh = 22;
        if (spec.continuous) {
          const g = new fabric.Rect({ left: bx, top: by, width: bw, height: bh }); g.set('fill', new fabric.Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: 0, y1: 0, x2: bw, y2: 0 }, colorStops: st.map((s, i) => ({ offset: st.length > 1 ? i / (st.length - 1) : 0, color: s.c })) })); objs.push(g);
        } else st.forEach((s, i) => objs.push(new fabric.Rect({ left: bx + bw / st.length * i, top: by, width: bw / st.length, height: bh, fill: s.c })));
        st.forEach((s, i) => objs.push(T(s.v, { left: bx + (st.length > 1 ? (spec.continuous ? bw * i / (st.length - 1) : bw / st.length * (i + .5)) : 0), top: by + bh + 6, originX: 'center', fontFamily: f, fontSize: 18, fill: tc })));
        if (unit) objs.push(T(unit, { left: bw, top: top + (title ? 4 : 0) - 30, originX: 'right', fontFamily: f, fontSize: 18, fill: tc, opacity: .8 }));
        h = by + bh + 34;
      } else if (spec.type === 'scalebar') {
        const L = spec.px, lab = spec.units === 'mi' ? (spec.km * 0.621371).toFixed(spec.km < 20 ? 1 : 0) + ' mi' : spec.km + ' km';
        objs.push(new fabric.Line([0, 10, L, 10], { stroke: spec.textColor, strokeWidth: 3 })); objs.push(new fabric.Line([0, 4, 0, 16], { stroke: spec.textColor, strokeWidth: 3 })); objs.push(new fabric.Line([L, 4, L, 16], { stroke: spec.textColor, strokeWidth: 3 }));
        objs.push(T(lab, { left: L / 2, top: 20, originX: 'center', fontFamily: spec.font, fontSize: 18, fill: spec.textColor }));
      }
      const g = new fabric.Group(objs, { subTargetCheck: false, objectCaching: false });
      g.chartSpec = spec; g.name = ({ bar: 'Bar chart', line: 'Line chart', pie: 'Pie chart', table: 'Data table', callout: 'Callout', legend: 'Legend', scalebar: 'Scale bar' })[spec.type]; return g;
    },
    insert(ed, spec) {
      const g = C.build(spec); g.id = NS.uid('o'); ed.center_(g); return ed.add(g);
    },
    rebuild(ed, old, spec) {
      const g = C.build(spec), cv = ed.canvas, idx = cv.getObjects().indexOf(old);
      g.set({ left: old.left, top: old.top, angle: old.angle, id: old.id }); cv.remove(old); cv.insertAt(g, idx); cv.setActiveObject(g); cv.requestRenderAll(); ed.commit(); return g;
    },
    // scale bar length for a map at a latitude/zoom (Web Mercator): metres per CSS px = 156543.03 * cos(lat) / 2^zoom
    scaleBarFor(zoom, lat, px) { const mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom); const km = mpp * px / 1000; const p = Math.pow(10, Math.floor(Math.log10(km))), n = km / p, step = n >= 5 ? 5 : n >= 2 ? 2 : 1; const nk = step * p; return { km: nk, px: nk * 1000 / mpp }; }
  };
  NS.Charts = C;
})();
