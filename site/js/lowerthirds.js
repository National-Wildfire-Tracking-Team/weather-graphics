/* Lower Thirds (sidebar → Lower Thirds, #/lowerthirds): fast cable-news / business-news style straps.
   Fill in the text, pick a look, then: copy a live browser-source URL (OBS / vMix, animated in/out with a
   scrolling ticker and live clock), download a transparent PNG (1080p, StreamYard 720p overlay, 4K), or record
   a transparent WebM of the in/hold/out animation. Rendering lives in js/lowerthirds-render.js (NS.LT).
   Working copy + saved lower thirds are kept in this browser's localStorage only. */
(function () {
  const { h, toast } = NS.ui, LT = NS.LT;
  const KEY = 'nsgs.lt.current', SAVED = 'nsgs.lt.saved';
  const load = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch (e) { return fb; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

  // One-click starting points. They only fill in text and style; nothing here is real news.
  const PRESETS = [
    ['Breaking news', { style: 'cable', tag: 'BREAKING NEWS', headline: 'Headline goes here', sub: 'Supporting line with the key detail', tickerOn: true, tickerLabel: 'LATEST', liveOn: false }],
    ['Developing story', { style: 'cable-red', tag: 'DEVELOPING STORY', headline: 'Headline goes here', sub: 'What we know right now', tickerOn: true, tickerLabel: 'LATEST', liveOn: false }],
    ['Live report', { style: 'cable', tag: 'HAPPENING NOW', headline: 'Headline goes here', sub: 'Reporter name · Location', liveOn: true, liveText: 'LIVE', liveLoc: 'CITY, ST', tickerOn: true }],
    ['Guest / interview', { style: 'nameplate', tag: '', headline: 'Guest Name', sub: 'Title, Organization', tickerOn: false, liveOn: false }],
    ['Markets', { style: 'business', tag: 'MARKETS', headline: 'Headline goes here', sub: 'Supporting line with the key detail', tickerOn: true, tickerLabel: 'MARKETS', ticker: 'SYMBOL 100.00 +1.25\nSYMBOL 100.00 -0.50\nType your own items: name, value, then +/- change', liveOn: false }],
    ['Weather live shot', { style: 'wxlive', tag: 'NOW:', headline: 'Headline goes here', sub: 'Supporting line with the key detail', reporter: 'Reporter Name', reporterTitle: 'Storm Specialist', tickerOn: true, tickerLabel: 'WEATHER WIRE', liveText: 'LIVE', liveOn: false, boxOn: true, boxTitle: 'WINTER STORM', boxSub: 'LIVE RADAR' }],
    ['Weather alert', { style: 'weather', tag: 'WEATHER ALERT', headline: 'Alert headline goes here', sub: 'Counties / area · Until time', tickerOn: true, tickerLabel: 'ALERTS', liveOn: false }]
  ];

  NS.LowerThirdsView = async function () {
    let cfg = Object.assign({}, LT.DEFAULTS, load(KEY, {}));
    cfg.colors = Object.assign({}, cfg.colors);
    await LT.fontsReady(); await LT.preload(cfg);
    const bc = 'BroadcastChannel' in window ? new BroadcastChannel('nsgs-lowerthirds') : null;

    /* ---- preview ---- */
    const cv = h('canvas', { id: 'ltCanvas', width: 1920, height: 1080, 'aria-label': 'Lower third preview' });
    const stage = h('div', { class: 'lt-stage bg-checker', id: 'ltStage' }, cv);
    const stateTag = h('span', { class: 'tag', id: 'ltState' }, 'off');
    const player = LT.Player(cv, cfg, { autoOut: true, preview: true, onstate: s => { stateTag.textContent = s; } });
    // Stop animating once the view has been navigated away from.
    let seen = false; (function watch() { if (cv.isConnected) seen = true; else if (seen) { player.stop(); bc && bc.close(); return; } setTimeout(watch, 1000); })();
    player.start(); player.show();

    const changed = () => { player.cfg = cfg; store(KEY, cfg); bc && bc.postMessage({ cfg }); syncLabels(); };
    const set = (k, v) => { cfg[k] = v; changed(); };

    /* ---- form ---- */
    const inputs = {};
    function field(label, key, el, id) {
      el.id = id || 'lt-' + key; inputs[key] = el;
      const read = () => el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value;
      el.addEventListener('input', () => set(key, read())); el.addEventListener('change', () => set(key, read()));
      const lab = h('label', { for: el.id }, label);
      return h('div', { class: 'prop' }, lab, h('div', { class: 'ctl' }, el));
    }
    const txt = (k, ph) => h('input', { type: 'text', value: cfg[k] || '', placeholder: ph || '' });
    const chk = k => h('input', { type: 'checkbox', checked: !!cfg[k] });
    const num = (k, min, max, step) => h('input', { type: 'number', value: cfg[k], min, max, step });

    const styleSel = h('select', {}, Object.entries(LT.STYLES).map(([id, s]) => h('option', { value: id, selected: id === cfg.style }, s.name)));
    const tz = h('select', {}, Object.keys(LT.TZ).map(z => h('option', { value: z, selected: z === cfg.tz }, z)));
    const ta = h('textarea', { rows: 4, placeholder: 'One item per line. End a line with +1.2 or -0.8 to colour it green/red.', style: 'width:100%;resize:vertical' }); ta.value = cfg.ticker || '';

    const colorRow = (label, key) => {
      const base = () => LT.norm(cfg).k[key];
      const el = h('input', { type: 'color', id: 'lt-color-' + key, value: base() });
      el.addEventListener('input', () => { cfg.colors = Object.assign({}, cfg.colors, { [key]: el.value }); changed(); });
      el._sync = () => { el.value = base(); };
      return [h('div', { class: 'prop' }, h('label', { for: el.id }, label), h('div', { class: 'ctl' }, el)), el];
    };
    const colors = [colorRow('Accent / tag', 'accent'), colorRow('Bar', 'bar'), colorRow('Bar text', 'barText')];
    const syncColors = () => colors.forEach(c => c[1]._sync());

    const labHead = h('span'), labSub = h('span'), labTag = h('span');
    function syncLabels() {
      const np = LT.STYLES[cfg.style].layout === 'nameplate';
      const wx = cfg.style === 'wxlive';
      labHead.textContent = np ? 'Name' : 'Headline'; labSub.textContent = np ? 'Title' : 'Sub line'; labTag.textContent = np ? 'Side box' : wx ? 'Red prefix' : 'Tag';
      if (typeof wxSec !== 'undefined') wxSec.hidden = !wx;
    }
    const relabel = (row, span) => { const l = row.querySelector('label'); l.textContent = ''; l.append(span); return row; };

    const presetBtns = PRESETS.map(([name, p]) => h('button', { class: 'chip', 'data-preset': name, onclick: () => {
      cfg = Object.assign({}, cfg, JSON.parse(JSON.stringify(p)), { colors: {} }); refill(); changed(); player.p = 0; player.state = 'off'; player.in();
    } }, name));

    function refill() {
      Object.entries(inputs).forEach(([k, el]) => { if (el.type === 'image') el.value = cfg[k]; else if (el.type === 'checkbox') el.checked = !!cfg[k]; else el.value = cfg[k] == null ? '' : cfg[k]; });
      syncColors();
    }
    styleSel.addEventListener('change', () => { cfg.colors = {}; syncColors(); changed(); });

    // Images are downscaled and stored inside the config (so the live URL carries them). Logo keeps transparency.
    function imagePicker(key, label, maxW, maxH, png) {
      const file = h('input', { type: 'file', accept: 'image/*', hidden: true, id: 'lt-file-' + key });
      const st = h('span', { class: 'hint', id: 'lt-img-' + key }, cfg[key] ? 'Image set' : 'None');
      file.addEventListener('change', async () => {
        const f = file.files[0]; if (!f) return;
        try {
          const im = await NS.ui.loadImage(await NS.ui.fileToDataURL(f)), k = Math.min(1, maxW / im.width, maxH / im.height);
          const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          set(key, png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85)); st.textContent = 'Image set'; await LT.preload(cfg);
        } catch (e) { toast('Could not use that image: ' + e.message, 'err'); }
        file.value = '';
      });
      inputs[key] = { type: 'image', set value(v) { st.textContent = v ? 'Image set' : 'None'; } };
      return h('div', { class: 'prop' }, h('label', {}, label), h('div', { class: 'ctl' }, file,
        h('button', { class: 'btn sm', id: 'lt-pick-' + key, onclick: () => file.click() }, 'Upload…'),
        h('button', { class: 'btn sm', onclick: () => { set(key, ''); st.textContent = 'None'; } }, 'Clear'), st));
    }
    const rowsTa = h('textarea', { rows: 5, placeholder: 'Label | value, one per line (max 5)', style: 'width:100%;resize:vertical' }); rowsTa.value = cfg.wxRows || '';
    const wxSec = h('div', { class: 'sec', id: 'ltWxSec' }, h('h4', {}, 'Weather live shot'),
      field('Reporter', 'reporter', txt('reporter', 'Reporter Name')), field('Role', 'reporterTitle', txt('reporterTitle', 'Storm Specialist')),
      field('Logo line 1', 'logoTop', txt('logoTop', 'WX')), field('Logo line 2', 'logoBottom', txt('logoBottom', 'WEATHER')),
      imagePicker('logoImg', 'Logo image', 400, 400, true),
      h('p', { class: 'hint' }, 'A logo image replaces the two logo lines. Use a PNG with transparency.'),
      field('Right box', 'boxOn', chk('boxOn')), field('Box title', 'boxTitle', txt('boxTitle', 'WINTER STORM')), field('Box strip', 'boxSub', txt('boxSub', 'LIVE RADAR')),
      imagePicker('boxImg', 'Box image', 640, 360, false),
      h('p', { class: 'hint' }, 'E.g. a radar or map screenshot (export one from Map Studio).'),
      h('h4', { style: 'margin-top:12px' }, 'Conditions panel (top right)'),
      field('Show', 'panelOn', chk('panelOn')), field('Location', 'wxLoc', txt('wxLoc', 'City, ST')), field('Temp', 'wxTemp', txt('wxTemp', 'e.g. 27°')),
      field('Low', 'wxLo', txt('wxLo', 'e.g. 24°')), field('High', 'wxHi', txt('wxHi', 'e.g. 30°')), field('Conditions', 'wxCond', txt('wxCond', 'e.g. Snow Showers/Wind')),
      field('Rows', 'wxRows', rowsTa),
      h('p', { class: 'hint' }, 'Type the current observation and forecast values from your source (NWS, your forecast). Nothing is filled in automatically.'));
    const form = h('div', { class: 'lt-form' },
      h('div', { class: 'sec' }, h('h4', {}, 'Quick start'), h('div', { class: 'row lt-presets' }, presetBtns)),
      h('div', { class: 'sec' }, h('h4', {}, 'Text'),
        relabel(field('Tag', 'tag', txt('tag', 'BREAKING NEWS')), labTag),
        relabel(field('Headline', 'headline', txt('headline')), labHead),
        relabel(field('Sub line', 'sub', txt('sub', 'Optional')), labSub),
        field('ALL CAPS', 'caps', chk('caps'))),
      h('div', { class: 'sec' }, h('h4', {}, 'Look'), field('Style', 'style', styleSel), colors.map(c => c[0]),
        h('div', { class: 'btnrow' }, h('button', { class: 'btn sm', onclick: () => { cfg.colors = {}; syncColors(); changed(); } }, 'Reset colours'))),
      wxSec,
      h('div', { class: 'sec' }, h('h4', {}, 'Ticker'), field('Show ticker', 'tickerOn', chk('tickerOn')), field('Label', 'tickerLabel', txt('tickerLabel', 'LATEST')),
        field('Items', 'ticker', ta), field('Clock (live)', 'clockOn', chk('clockOn')), field('Time zone', 'tz', tz), field('Speed px/s', 'speed', num('speed', 20, 600, 10))),
      h('div', { class: 'sec' }, h('h4', {}, 'Live bug (top left)'), field('Show', 'liveOn', chk('liveOn')), field('Text', 'liveText', txt('liveText', 'LIVE')), field('Location', 'liveLoc', txt('liveLoc', 'CITY, ST'))),
      h('div', { class: 'sec' }, h('h4', {}, 'Animation'), field('In time (s)', 'inDur', num('inDur', 0.2, 3, 0.1)), field('Auto-out (s)', 'hold', num('hold', 0, 600, 1)),
        h('p', { class: 'hint' }, 'Auto-out 0 = stays up until you take it out (click the live output or press Space).'))
    );
    syncLabels();

    /* ---- transport + output ---- */
    const liveUrl = () => new URL('lower-thirds-live.html#c=' + LT.encode(cfg), location.href).href;
    const slug = () => (cfg.headline || 'lower-third').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'lower-third';
    async function png(w, hh, tagName) {
      const c = document.createElement('canvas'); c.width = w; c.height = hh;
      await LT.fontsReady(); await LT.preload(cfg); LT.draw(c, cfg, { p: 1 });
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      if (!blob) { toast('PNG export failed.', 'err'); return null; }
      const bmp = await createImageBitmap(blob); const ok = bmp.width === w && bmp.height === hh; bmp.close && bmp.close();
      if (!ok) toast('Exported PNG is not ' + w + '×' + hh + '.', 'err');
      NS.ui.download(blob, 'lower-third_' + slug() + '_' + (tagName || w + 'x' + hh) + '.png'); toast('Transparent PNG ' + w + '×' + hh + ' downloaded.', 'ok');
      return blob;
    }
    const recStatus = h('span', { class: 'status', id: 'ltRecStatus' });
    async function webm() {
      const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      const type = window.MediaRecorder && types.find(t => MediaRecorder.isTypeSupported(t));
      if (!type) { toast('This browser cannot record video (MediaRecorder unavailable). Use Chrome or Edge.', 'err'); return; }
      const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
      await LT.preload(cfg); const rp = LT.Player(c, cfg, { autoOut: false }).start();
      const stream = c.captureStream(30), rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12e6 }), chunks = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      const done = new Promise(r => { rec.onstop = r; });
      const inD = Math.max(0.2, +cfg.inDur || 0.9), hold = +cfg.hold > 0 ? +cfg.hold : 4, total = inD + hold + inD * 0.7 + 0.5;
      recBtn.disabled = true; rec.start(250);
      const tick = setInterval(() => { recStatus.textContent = 'Recording… ' + Math.max(0, Math.ceil(total - (performance.now() - st) / 1000)) + ' s'; }, 250), st = performance.now();
      await new Promise(r => setTimeout(r, 300)); rp.in();
      await new Promise(r => setTimeout(r, (inD + hold) * 1000)); rp.out();
      await new Promise(r => setTimeout(r, (inD * 0.7 + 0.4) * 1000));
      rec.stop(); await done; rp.stop(); clearInterval(tick); recBtn.disabled = false; recStatus.textContent = '';
      const blob = new Blob(chunks, { type: 'video/webm' });
      if (!blob.size) { toast('Recording came out empty.', 'err'); return; }
      NS.ui.download(blob, 'lower-third_' + slug() + '_1920x1080.webm');
      toast('WebM downloaded (' + NS.ui.fmtBytes(blob.size) + ', ' + type.split('=')[1] + '). Transparency is kept by Chrome/Edge VP8/VP9; check it in your switcher.', 'ok', 8000);
    }
    async function copyUrl() {
      const u = liveUrl();
      if (u.length > 1.5e6) toast('This URL is very long (' + NS.ui.fmtBytes(u.length) + ') because of the uploaded images. Use smaller images if OBS will not load it.', 'err', 9000);
      try { await navigator.clipboard.writeText(u); toast('Browser-source URL copied. In OBS: Sources → + → Browser, paste it, set 1920×1080.', 'ok', 7000); }
      catch (e) { const inp = h('input', { type: 'text', value: u, readonly: true, style: 'width:560px' }); NS.ui.dialog('Browser-source URL', h('div', {}, h('p', {}, 'Copy this URL into an OBS / vMix browser source (1920×1080):'), inp), null, { onOpen: () => inp.select() }); }
    }
    const recBtn = h('button', { class: 'btn', id: 'ltWebm', onclick: webm }, 'Animated WebM (alpha)');
    const bgSel = h('select', { id: 'ltBg', 'aria-label': 'Preview background', onchange: () => { stage.className = 'lt-stage bg-' + bgSel.value; } },
      h('option', { value: 'checker' }, 'Transparent'), h('option', { value: 'studio' }, 'Studio shot'), h('option', { value: 'grey' }, 'Grey'));
    const transport = h('div', { class: 'bar' },
      h('button', { class: 'btn primary', id: 'ltIn', onclick: () => { player.in(); bc && bc.postMessage({ cmd: 'in', cfg }); } }, '▶ Take in'),
      h('button', { class: 'btn', id: 'ltOut', onclick: () => { player.out(); bc && bc.postMessage({ cmd: 'out', cfg }); } }, '■ Take out'),
      h('button', { class: 'btn', id: 'ltReplay', onclick: () => { player.p = 0; player.state = 'off'; player.in(); } }, '↺ Replay'),
      stateTag, h('span', { class: 'sp', style: 'flex:1' }), h('label', { for: 'ltBg', class: 'hint' }, 'Preview on'), bgSel);
    const out = h('div', { class: 'lt-out' },
      h('div', { class: 'sec' }, h('h4', {}, 'Live (animated, ticker scrolls, clock runs)'), h('div', { class: 'btnrow' },
        h('button', { class: 'btn primary', id: 'ltCopy', onclick: copyUrl }, 'Copy OBS / vMix URL'),
        h('button', { class: 'btn', id: 'ltOpen', onclick: () => window.open(liveUrl(), 'nsgs-lt-live', 'width=1280,height=720') }, 'Open live output'))),
      h('div', { class: 'sec' }, h('h4', {}, 'Files'), h('div', { class: 'btnrow' },
        h('button', { class: 'btn', id: 'ltPng1080', onclick: () => png(1920, 1080) }, 'PNG 1920×1080'),
        h('button', { class: 'btn', id: 'ltPng720', onclick: () => png(1280, 720, 'streamyard-overlay') }, 'PNG 1280×720 (StreamYard)'),
        h('button', { class: 'btn', id: 'ltPng4k', onclick: () => png(3840, 2160) }, 'PNG 3840×2160'), recBtn, recStatus)),
      h('details', { class: 'lt-help' }, h('summary', {}, 'How to use it in OBS, vMix, StreamYard'), h('ul', {},
        h('li', {}, h('b', {}, 'OBS: '), 'Sources → + → Browser → paste the URL, width 1920, height 1080. It animates in when the source loads. Tick "Refresh browser when scene becomes active" to replay the animation each time you cut to the scene. Right-click → Interact, then click or press Space to take it in/out.'),
        h('li', {}, h('b', {}, 'vMix: '), 'Add Input → Web Browser → paste the URL, 1920×1080. Put it on an overlay channel.'),
        h('li', {}, h('b', {}, 'StreamYard: '), 'Brand → Overlays → upload the 1280×720 PNG. Overlays sit on top of the cameras, which is why the PNG is transparent.'),
        h('li', {}, h('b', {}, 'Video editors / switchers: '), 'the WebM keeps the transparent background (Chrome/Edge). Premiere, Resolve and OBS Media Source read VP8/VP9 alpha; if yours does not, use the PNG.'),
        h('li', {}, 'The URL contains the whole lower third, so editing here does not change a URL you already pasted: copy it again after changes. "Open live output" in this browser does follow your edits and the Take buttons.'))));

    /* ---- saved ---- */
    const saveName = h('input', { type: 'text', id: 'ltSaveName', placeholder: 'Name, e.g. Mayor presser', style: 'flex:1' });
    const savedList = h('div', { id: 'ltSaved', class: 'lt-saved' });
    function drawSaved() {
      const all = load(SAVED, []);
      savedList.replaceChildren(...(all.length ? all.map((s, i) => h('div', { class: 'layer' }, h('span', { class: 'nm', title: s.cfg.headline }, s.name),
        h('button', { title: 'Load', 'aria-label': 'Load ' + s.name, onclick: () => { cfg = Object.assign({}, LT.DEFAULTS, JSON.parse(JSON.stringify(s.cfg))); refill(); changed(); player.p = 0; player.state = 'off'; player.in(); } }, 'Load'),
        h('button', { title: 'Delete', 'aria-label': 'Delete ' + s.name, onclick: async () => { if (!await NS.ui.confirm('Delete lower third', 'Delete "' + s.name + '"?', 'Delete', true)) return; all.splice(i, 1); store(SAVED, all); drawSaved(); } }, '✕')))
        : [h('p', { class: 'hint' }, 'Nothing saved yet. Saved lower thirds stay in this browser only.')]));
    }
    drawSaved();
    const saved = h('div', { class: 'sec' }, h('h4', {}, 'Saved in this browser'), h('div', { class: 'row', style: 'margin-bottom:6px' }, saveName,
      h('button', { class: 'btn sm', id: 'ltSave', onclick: () => {
        const name = saveName.value.trim() || cfg.headline || 'Lower third'; const all = load(SAVED, []); const i = all.findIndex(s => s.name === name);
        const rec = { name, cfg: JSON.parse(JSON.stringify(cfg)), t: Date.now() }; if (i >= 0) all[i] = rec; else all.unshift(rec);
        if (store(SAVED, all)) { toast('Saved "' + name + '".', 'ok'); saveName.value = ''; drawSaved(); } else toast('Could not save: browser storage is unavailable.', 'err');
      } }, 'Save')), savedList);

    return h('div', {}, h('h1', {}, 'Lower Thirds'),
      h('p', { class: 'sub' }, 'Cable- and business-news style lower thirds with a tag, headline, sub line, scrolling ticker and live clock. Type, pick a look, then copy the live URL into OBS / vMix or download a transparent PNG or WebM.'),
      h('div', { class: 'lt-wrap' }, form, h('div', { class: 'lt-right' }, transport, stage, out, saved)));
  };
})();
