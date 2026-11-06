/* WX Headlines tab: a live, read-only briefing of what is happening now, built only from official sources
   (active NWS alerts from api.weather.gov, and today's / tomorrow's SPC-WPC-CPC outlooks via NS.Hazards).
   Nothing is invented: a source that fails shows its error, an empty source says so. */
(function () {
  const { h, toast } = NS.ui;
  const SEV = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];
  const sevRank = s => { const i = SEV.indexOf(s); return i < 0 ? SEV.length : i; };
  const fmtTime = t => t ? new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
  const fmtDay = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied headline.'); } catch (e) { toast('Clipboard unavailable: ' + e.message, 'err'); }
  }

  NS.HeadlinesView = async function () {
    const st = { state: '', alerts: null, alertErr: '', hz: null, hzErr: '', busy: false };
    const root = h('div', { class: 'headlines' }, h('h1', {}, 'WX Headlines'),
      h('p', { class: 'sub' }, 'What is happening right now, from official sources only: active NWS alerts and today\'s and tomorrow\'s SPC, WPC and CPC outlooks. Confirm details with the issuing office before going on air.'));
    const bar = h('div', { class: 'bar' }), outlook = h('section', { id: 'hlOutlook' }), alerts = h('section', { id: 'hlAlerts' });
    root.append(bar, outlook, alerts);

    async function load(force) {
      st.busy = true; drawBar();
      await Promise.all([
        NS.NWS.loadActive().then(d => { st.alerts = d; st.alertErr = ''; }, e => { st.alerts = null; st.alertErr = 'Could not load NWS alerts: ' + e.message; }),
        NS.Hazards.load(force).then(d => { st.hz = d; st.hzErr = ''; }, e => { st.hz = null; st.hzErr = 'Could not load the outlooks: ' + e.message; })
      ]);
      st.busy = false; draw();
    }
    function draw() { drawBar(); drawOutlook(); drawAlerts(); }

    function drawBar() {
      const states = st.alerts ? [...new Set(st.alerts.alerts.flatMap(a => a.states))].filter(s => s.length === 2).sort() : [];
      bar.replaceChildren(
        h('button', { class: 'btn', id: 'hlRefresh', disabled: st.busy, onclick: () => load(true) }, st.busy ? 'Loading…' : 'Refresh'),
        h('label', { class: 'row' }, 'State ', h('select', { id: 'hlState', 'aria-label': 'Filter alerts by state', onchange: e => { st.state = e.target.value; drawAlerts(); } },
          h('option', { value: '' }, 'All states'), states.map(s => h('option', { value: s, selected: s === st.state }, s)))),
        st.alerts ? h('span', { class: 'hint' }, 'Alerts loaded ' + new Date(st.alerts.fetchedAt).toLocaleTimeString()) : null);
    }

    function drawOutlook() {
      outlook.replaceChildren(h('h2', {}, 'Outlook headlines'));
      if (st.hzErr) { outlook.append(h('div', { class: 'tag err', style: 'white-space:normal' }, st.hzErr)); return; }
      if (!st.hz) { outlook.append(h('p', { class: 'hint' }, 'Contacting NOAA outlook services…')); return; }
      const today = NS.Hazards.isoDay(NS.Hazards.today());
      const days = NS.Hazards.range(today, 2);
      outlook.append(h('div', { class: 'hlgrid' }, days.map((iso, i) => {
        const s = NS.Hazards.summary(iso);
        const label = (i === 0 ? 'Today' : 'Tomorrow') + ' · ' + fmtDay(iso);
        return h('div', { class: 'hlcard', 'data-day': iso }, h('b', {}, label),
          s.items.length ? h('ul', {}, s.items.map(it => {
            const line = it.hazard + (it.detail ? ' · ' + it.detail : '');
            return h('li', {}, h('span', { class: 'sw', style: 'background:' + (it.color || 'var(--border-strong)') }), h('span', { class: 'grow' }, line), h('span', { class: 'tag' }, it.srcName),
              h('button', { class: 'btn sm', title: 'Copy headline', onclick: () => copy(label.split(' · ')[0] + ': ' + line + ' (' + it.srcName + ')') }, 'Copy'));
          })) : h('p', { class: 'hint' }, s.covered.length ? 'No hazard areas in ' + s.covered.join(', ') + '.' : 'No official outlook reaches this day.'));
      })), h('div', { class: 'row' }, st.hz.sources.filter(s => s.error).map(s => h('span', { class: 'tag err', 'data-src': s.id }, s.short + ' unavailable')),
        h('a', { class: 'btn sm', href: '#/hazards' }, 'Open Week-Ahead Hazards →')));
    }

    function drawAlerts() {
      alerts.replaceChildren(h('h2', {}, 'Active NWS alerts'));
      if (st.alertErr) { alerts.append(h('div', { class: 'tag err', style: 'white-space:normal' }, st.alertErr)); return; }
      if (!st.alerts) { alerts.append(h('p', { class: 'hint' }, 'Contacting api.weather.gov…')); return; }
      const list = st.alerts.alerts.filter(a => !st.state || a.states.includes(st.state));
      if (!list.length) { alerts.append(h('div', { class: 'empty' }, 'No active alerts' + (st.state ? ' in ' + st.state : '') + '.')); return; }
      const groups = new Map();
      list.forEach(a => { if (!groups.has(a.event)) groups.set(a.event, []); groups.get(a.event).push(a); });
      const rows = [...groups.entries()].map(([event, as]) => ({ event, as, sev: Math.min(...as.map(a => sevRank(a.severity))), states: [...new Set(as.flatMap(a => a.states))].filter(s => s.length === 2).sort() }))
        .sort((a, b) => a.sev - b.sev || b.as.length - a.as.length || a.event.localeCompare(b.event));
      alerts.append(h('p', { class: 'hint' }, list.length + ' active alerts in ' + rows.length + ' categories, most severe first.'),
        h('div', { class: 'hllist' }, rows.map(r => {
          const color = NS.NWS.eventColor ? NS.NWS.eventColor(r.event) : 'var(--border-strong)';
          const line = r.event + ': ' + r.as.length + ' active' + (r.states.length ? ' · ' + (r.states.length > 8 ? r.states.slice(0, 8).join(', ') + ' +' + (r.states.length - 8) : r.states.join(', ')) : '');
          return h('details', { class: 'hlrow', 'data-event': r.event },
            h('summary', {}, h('span', { class: 'sw', style: 'background:' + color }), h('b', { class: 'grow' }, r.event), h('span', { class: 'tag' + (r.sev <= 1 ? ' err' : '') }, SEV[r.sev] || 'Unknown'),
              h('span', { class: 'hint' }, r.as.length + ' · ' + (r.states.slice(0, 6).join(', ') || 'marine/other') + (r.states.length > 6 ? ' …' : '')),
              h('button', { class: 'btn sm', title: 'Copy headline', onclick: e => { e.preventDefault(); copy(line); } }, 'Copy')),
            h('ul', {}, r.as.slice().sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || String(b.sent).localeCompare(String(a.sent))).slice(0, 25).map(a =>
              h('li', {}, h('div', {}, a.headline || a.event), h('div', { class: 'hint' }, (a.sender || 'NWS') + ' · until ' + fmtTime(a.expires) + ' · ' + (a.areaDesc || '').slice(0, 220))))),
            r.as.length > 25 ? h('p', { class: 'hint' }, '…and ' + (r.as.length - 25) + ' more.') : null);
        })),
        h('div', { class: 'row', style: 'margin-top:10px' }, h('a', { class: 'btn sm', href: '#/alerts' }, 'Make an alert graphic →'),
          h('span', { class: 'hint' }, 'Source: National Weather Service, api.weather.gov.')));
    }

    draw(); load(false);
    return root;
  };
})();
