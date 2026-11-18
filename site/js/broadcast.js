/* NWTT live production (Phase 1: OBS Studio + Restream, static PNG graphics).
   - NS.Broadcast.KIT: the 11 standard graphics, each mapped to existing/NWTT templates and the OBS export to use.
   - NS.Broadcast.SCENES: the recommended OBS scene collection (00-10), bottom-to-top source order.
   - Views: the kit table (Broadcast Graphics page) and the docs in site/docs/*.md (route #/obs, #/obs/onboarding).
   Nothing here streams, publishes or talks to OBS/Restream; broadcasters load exported files by hand. */
(function () {
  const { h } = NS.ui;
  // [templateId, OBS export target]. obs = transparent overlay, obs-full = opaque full-screen.
  const KIT = [
    { slot: 'Breaking News', scene: '01', use: [['bn-breaking', 'obs-full'], ['bc-strap', 'obs']] },
    { slot: 'Wildfire Incident Coverage', scene: '02', use: [['sf-wildfire', 'obs-full'], ['nwtt-wildfire-facts', 'obs']] },
    { slot: 'Severe Weather Coverage', scene: '03', use: [['sv-outlook', 'obs-full'], ['sv-tornado', 'obs-full'], ['bc-strap', 'obs']] },
    { slot: 'Hurricane / Tropical Weather Coverage', scene: '04', use: [['tr-track', 'obs-full'], ['tr-update', 'obs-full']] },
    { slot: 'Live Incident Updates', scene: '02 / 05 / 06', use: [['nwtt-incident-update', 'obs']] },
    { slot: 'Evacuation Orders and Warnings', scene: '02 / 05', use: [['nwtt-evac-list', 'obs-full'], ['sf-evac', 'obs-full']] },
    { slot: 'Reporter / Correspondent Lower Thirds', scene: '06 / 07 / 08', use: [['bc-reporter', 'obs'], ['bc-nameplate', 'obs'], ['bc-interview', 'obs']] },
    { slot: 'Source Attribution', scene: 'all live scenes', use: [['nwtt-source', 'obs']] },
    { slot: 'Starting Soon', scene: '00', use: [['nwtt-starting-soon', 'obs-full']] },
    { slot: 'Technical Difficulties', scene: '09', use: [['nwtt-technical', 'obs-full']] },
    { slot: 'Broadcast Ending', scene: '10', use: [['nwtt-ending', 'obs-full']] }
  ];
  // Sources listed bottom → top, as they appear reversed in OBS's Sources dock (top of the list = drawn on top).
  const SCENES = [
    { id: '00', name: '00 — Starting Soon', sources: ['Image: NWTT Starting Soon (full-screen)', 'Optional: Media source for music'] },
    { id: '01', name: '01 — Breaking News', sources: ['Image: Breaking news full-screen card, or host camera', 'Video capture: host camera (if not using the card)', 'Image: Breaking news strap (overlay)', 'Image: Source attribution (overlay)', 'Image: LIVE indicator (overlay)'] },
    { id: '02', name: '02 — Wildfire Coverage', sources: ['Window capture: Sentinel live tracker, or Image: wildfire map (full-screen)', 'Image: Wildfire fact panel (overlay)', 'Image: Live incident update (overlay, hidden until needed)', 'Image: Source attribution (overlay)'] },
    { id: '03', name: '03 — Severe Weather', sources: ['Image: severe weather map (full-screen), or Window capture: Sentinel', 'Image: Breaking news strap (overlay, optional)', 'Image: Source attribution (overlay)'] },
    { id: '04', name: '04 — Hurricane Coverage', sources: ['Image: Hurricane tracking map (full-screen)', 'Image: Source attribution (overlay)', 'Image: LIVE indicator (overlay, optional)'] },
    { id: '05', name: '05 — Full-Screen Map', sources: ['Window capture: Sentinel live tracker, or Image: any map export (full-screen)', 'Image: Evacuation list (full-screen, hidden until needed)', 'Image: Source attribution (overlay)'] },
    { id: '06', name: '06 — Host + Map', sources: ['Window capture: Sentinel live tracker (or map image), full frame', 'Video capture: host camera, picture-in-picture', 'Image: Anchor nameplate (overlay)', 'Image: Live incident update (overlay, hidden until needed)', 'Image: Source attribution (overlay)'] },
    { id: '07', name: '07 — Correspondent', sources: ['Window or video capture: correspondent feed', 'Image: Reporter ID banner (overlay)', 'Image: LIVE indicator (overlay)'] },
    { id: '08', name: '08 — Official Briefing', sources: ['Window/media capture: official briefing feed', 'Image: Interview identification for the speaker (overlay)', 'Image: Source attribution naming the agency feed (overlay)', 'Image: LIVE indicator (overlay)'] },
    { id: '09', name: '09 — Technical Standby', sources: ['Image: NWTT Technical Difficulties (full-screen)'] },
    { id: '10', name: '10 — Ending Coverage', sources: ['Image: NWTT Broadcast Ending (full-screen)'] }
  ];
  const DOCS = { '': ['OBS Setup Guide', 'docs/obs-setup-guide.md'], onboarding: ['Broadcaster Onboarding', 'docs/broadcaster-onboarding.md'] };

  /* Minimal Markdown → DOM for our own docs: headings, paragraphs, lists, tables, code, quotes, **bold**, `code`, links.
     Builds DOM nodes (no innerHTML), so document text can never inject markup. */
  function inline(text) {
    const out = [], re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g; let i = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > i) out.push(text.slice(i, m.index));
      if (m[2]) out.push(h('b', {}, m[2])); else if (m[3]) out.push(h('code', {}, m[3]));
      else { const href = m[5], safe = /^(https?:|#|\.{0,2}\/?[\w.-]+(\.html|\.md)?(#[\w/-]*)?$)/.test(href) && !/^javascript:/i.test(href);
        const doc = href.match(/^(?:\.\/)?([\w-]+)\.md$/), target = doc ? (doc[1] === 'obs-setup-guide' ? '#/obs' : '#/obs/' + doc[1].replace('broadcaster-', '')) : href;
        out.push(safe ? h('a', Object.assign({ href: target }, /^https?:/.test(href) ? { target: '_blank', rel: 'noopener' } : {}), m[4]) : m[4]); }
      i = re.lastIndex;
    }
    if (i < text.length) out.push(text.slice(i)); return out;
  }
  function markdown(src) {
    const root = h('div', { class: 'doc' }), lines = src.replace(/\r/g, '').split('\n'); let i = 0;
    const slug = t => t.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; root.append(h('pre', {}, h('code', {}, buf.join('\n')))); continue; }
      const hm = l.match(/^(#{1,4})\s+(.*)$/); if (hm) { root.append(h('h' + Math.min(hm[1].length, 4), { id: slug(hm[2]) }, inline(hm[2]))); i++; continue; }
      if (/^\|/.test(l)) { const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]); const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const body = rows.slice(rows[1] && /^[\s|:-]+$/.test(rows[1]) ? 2 : 1); root.append(h('table', { class: 't' }, h('thead', {}, h('tr', {}, cells(rows[0]).map(c => h('th', {}, inline(c))))), h('tbody', {}, body.map(r => h('tr', {}, cells(r).map(c => h('td', {}, inline(c)))))))); continue; }
      if (/^\s*([-*]|\d+\.)\s+/.test(l)) { const ordered = /^\s*\d+\./.test(l), list = h(ordered ? 'ol' : 'ul', {});
        let li = null, sub = null;   // one level of nesting: indented items go into a sub-list of the previous item
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { const nested = /^\s{2,}/.test(lines[i]) && li; let t = lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, '').replace(/^\[ \]\s*/, '☐ '); while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) t += ' ' + lines[i++].trim();
          if (nested) { if (!sub) { sub = h('ul', {}); li.append(sub); } sub.append(h('li', {}, inline(t))); } else { li = h('li', {}, inline(t)); sub = null; list.append(li); } }
        root.append(list); continue; }
      if (/^>\s?/.test(l)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); root.append(h('blockquote', {}, inline(buf.join(' ')))); continue; }
      if (!l.trim()) { i++; continue; }
      const buf = []; while (i < lines.length && lines[i].trim() && !/^(#|```|\||>|\s*([-*]|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++].trim()); root.append(h('p', {}, inline(buf.join(' '))));
    }
    return root;
  }

  const tpl = id => NS.Templates.list.find(t => t.id === id);
  function kitTable() {
    const T = NS.Export.TARGETS;
    return h('div', { id: 'nwttKit' }, h('h2', {}, 'NWTT broadcast kit'),
      h('p', { class: 'hint' }, 'The standard graphics for NWTT livestreams in OBS. Each row lists the templates to use, the OBS scene they belong to (see the ', h('a', { href: '#/obs' }, 'OBS Setup Guide'), ') and the Export → Destination to pick. Overlays are transparent and go at the top of a scene; full-screen graphics and maps go at the bottom.'),
      h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Graphic', 'OBS scene', 'Template → export as'].map(x => h('th', {}, x)))),
        h('tbody', {}, KIT.map(k => h('tr', {}, h('td', {}, h('b', {}, k.slot)), h('td', {}, k.scene),
          h('td', {}, k.use.map(([id, tg]) => { const t = tpl(id); return t ? h('div', { class: 'row', style: 'margin:2px 0' }, h('button', { class: 'btn sm', 'data-tpl': id, onclick: () => NS.App.newFromTemplate(id) }, t.name), h('span', { class: 'tag' + (tg === 'obs' ? ' ok' : '') }, T[tg].label.replace('OBS Studio — ', ''))) : null; })))))));
  }
  async function guideView(arg) {
    const d = DOCS[arg || ''] || DOCS[''], root = h('div', { class: 'docview' });
    root.append(h('div', { class: 'bar' }, Object.entries(DOCS).map(([k, v]) => h('a', { class: 'chip' + (v === d ? ' on' : ''), href: '#/obs' + (k ? '/' + k : '') }, v[0]))));
    try { const r = await fetch(d[1], { cache: 'no-cache' }); if (!r.ok) throw new Error('HTTP ' + r.status); root.append(markdown(await r.text())); }
    catch (e) { root.append(h('div', { class: 'tag err', style: 'display:block' }, 'Could not load ' + d[1] + ': ' + e.message)); }
    if (d === DOCS['']) root.append(kitTable());
    return root;
  }
  NS.Broadcast = { KIT, SCENES, DOCS, markdown, kitTable, guideView };
})();
