/* Resources tab: curated links to official forecast centers, data services used by the Studio, and the team's own tools/docs.
   Links only; nothing here fetches data. Add or edit entries in RESOURCES. */
(function () {
  const { h } = NS.ui;
  const RESOURCES = [
    { group: 'Forecast centers', items: [
      ['Storm Prediction Center (SPC)', 'https://www.spc.noaa.gov/', 'Convective outlooks, watches, mesoscale discussions.'],
      ['Weather Prediction Center (WPC)', 'https://www.wpc.ncep.noaa.gov/', 'Excessive rainfall, winter weather, national forecast charts.'],
      ['Climate Prediction Center (CPC)', 'https://www.cpc.ncep.noaa.gov/', '3-7 and 8-14 day hazards outlooks, 6-10/8-14 day outlooks.'],
      ['National Hurricane Center (NHC)', 'https://www.nhc.noaa.gov/', 'Tropical outlooks, advisories, cone graphics.'],
      ['National Weather Service', 'https://www.weather.gov/', 'Local forecast offices and current warnings.'],
      ['Aviation Weather Center', 'https://aviationweather.gov/', 'SIGMETs, ceilings and visibility.']
    ] },
    { group: 'Fire weather', items: [
      ['SPC Fire Weather Outlooks', 'https://www.spc.noaa.gov/products/fire_wx/', 'Day 1-8 critical and extremely critical fire weather areas.'],
      ['NIFC / National Fire News', 'https://www.nifc.gov/fire-information/nfn', 'National preparedness level and large-fire summary.'],
      ['InciWeb', 'https://inciweb.wildfire.gov/', 'Official incident information and evacuations.'],
      ['NIFC Open Data (WFIGS)', 'https://data-nifc.opendata.arcgis.com/', 'Current fire perimeters (the Studio\'s fire layer source).'],
      ['Predictive Services Outlooks', 'https://www.nifc.gov/nicc-files/predictive/outlooks/monthly_seasonal_outlook.pdf', 'Monthly and seasonal significant fire potential.']
    ] },
    { group: 'Radar & observations', items: [
      ['NWS Radar', 'https://radar.weather.gov/', 'National and local radar loops.'],
      ['Iowa Environmental Mesonet', 'https://mesonet.agron.iastate.edu/', 'Archived warnings, radar mosaics (the Studio\'s radar tiles).'],
      ['GOES Satellite (STAR)', 'https://www.star.nesdis.noaa.gov/GOES/', 'Live GOES-East/West imagery.'],
      ['NWS Storm Reports', 'https://www.spc.noaa.gov/climo/reports/today.html', 'Preliminary tornado, wind and hail reports.']
    ] },
    { group: 'Data APIs (used by the Studio)', items: [
      ['api.weather.gov docs', 'https://www.weather.gov/documentation/services-web-api', 'Active alerts and zone shapes.'],
      ['NOAA MapServices', 'https://mapservices.weather.noaa.gov/', 'SPC, WPC, CPC and NHC GIS layers.'],
      ['Mapbox GL JS docs', 'https://docs.mapbox.com/mapbox-gl-js/', 'Map engine (v3.9.0).'],
      ['Mapbox Studio', 'https://studio.mapbox.com/', 'Edit the Weather Broadcast Dark basemap style.']
    ] },
    { group: 'Our tools', items: [
      ['Plate Builder (counties)', 'plate-builder.html', 'Paint county risk areas and export 1080p/4K/720p plates.'],
      ['NWS Alert Graphics', '#/alerts', 'Turn active alerts into a map graphic.'],
      ['Week-Ahead Hazards', '#/hazards', '5-7 day outlook overview graphic.'],
      ['Template Library', '#/templates', 'Starting layouts for weather, news and social.'],
      ['Export Center', '#/exports', 'Re-render saved projects; OBS and StreamYard sizes.']
    ] }
  ];
  NS.Resources = RESOURCES;

  NS.ResourcesView = async function () {
    const q = h('input', { type: 'search', id: 'resSearch', placeholder: 'Filter resources…', 'aria-label': 'Filter resources', style: 'width:280px' });
    const body = h('div', { id: 'resList' });
    const draw = () => {
      const t = q.value.trim().toLowerCase();
      body.replaceChildren(...RESOURCES.map(g => {
        const items = g.items.filter(([n, u, d]) => !t || (n + ' ' + d + ' ' + g.group).toLowerCase().includes(t));
        if (!items.length) return null;
        return h('section', {}, h('h2', {}, g.group), h('div', { class: 'grid' }, items.map(([n, u, d]) => {
          const ext = /^https?:/.test(u), local = !ext && !u.startsWith('#');
          return h('a', Object.assign({ class: 'tile reslink', href: u }, ext || local ? { target: '_blank', rel: 'noopener' } : {}),
            h('div', { class: 'meta' }, h('b', {}, n + (ext ? ' ↗' : '')), h('span', {}, d), ext ? h('span', { class: 'hint' }, new URL(u).hostname) : null));
        })));
      }).filter(Boolean));
      if (!body.children.length) body.append(h('div', { class: 'empty' }, 'No resources match "' + q.value + '".'));
    };
    q.addEventListener('input', draw);
    draw();
    return h('div', {}, h('h1', {}, 'Resources'), h('p', { class: 'sub' }, 'Official forecast centers, the data services behind the Studio\'s layers, and our own tools.'), h('div', { class: 'bar' }, q), body);
  };
})();
