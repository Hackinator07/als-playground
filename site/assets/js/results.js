// Results page: loads the data, ranks it with shared/rules.js and draws the table.
import {
  rankRuns, formatTime, formatDiff, zonedStamp, driverKey, runTag, inSource, realPlacings, theoreticalBest,
} from '../../shared/rules.js';

const SAMPLES = [
  ['empty', 'Empty'], ['one', 'One time'], ['ties', 'Ties'],
  ['repeat', 'Repeat drivers'], ['many', 'Many'], ['broken', 'Load failure'],
];

const params = new URLSearchParams(location.search);
const sample = (params.get('sample') || '').toLowerCase();
const highlightId = params.get('highlight') || '';
// ?runs=virtual | lspr2024 | lspr2026 picks the Virtual / LSPR 2024 / LSPR 2026 switch (shareable links).
// ?runs=lspr is the older link for LSPR 2024 and keeps working. The first name listed for a source is the one written to the address bar.
const SOURCE_PARAM = { virtual: 'virtual', lspr2024: 'lspr2024', lspr2026: 'lspr2026', lspr: 'lspr2024' };
const SOURCE_NAME = { virtual: 'virtual', lspr2024: 'LSPR 2024', lspr2026: 'LSPR 2026' };
const LSPR_YEARS = ['2024', '2026'];

const state = {
  stage: null,
  groups: [],          // [{name, tag}] in dropdown order
  carGroup: new Map(), // car_id -> group name
  groupTag: new Map(), // group name -> short tag
  runs: [],
  generatedAt: null,
  view: 'best',
  source: SOURCE_PARAM[(params.get('runs') || '').toLowerCase()] || '',
  group: '',
  search: '',
  showAll: false,
  open: new Set(),     // ids of expanded rows
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tz = () => state.stage?.display_time_zone || 'America/Chicago';
/** A gap in prose: "8.539 s" under a minute, "1:04.086" above. */
const gapText = (ms) => (ms < 60000 ? `${(ms / 1000).toFixed(3)} s` : formatDiff(ms));
const ordinal = (n) => {
  const t = n % 100;
  const suf = t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${suf}`;
};
/** "9th of 72 on SS1, between Jimmy Pelizzari (7:51.800) and Ryan Booth (7:52.500)" */
function placingText(p) {
  const who = (r) => `${esc(r.driver)} (${formatTime(r.finish_ms)})`;
  const head = `<strong>${ordinal(p.place)} of ${p.of + 1}</strong> on ${p.stage}`;
  if (!p.faster) return `${head}, ahead of ${who(p.slower)}`;
  if (!p.slower) return `${head}, behind ${who(p.faster)}`;
  return `${head}, between ${who(p.faster)} and ${who(p.slower)}`;
}

// Phones hide Car, Diff. Prev, Uploaded and the camera column, so full-width
// cells must span 6 columns there (spanning hidden columns breaks the layout).
const phone = window.matchMedia('(max-width: 640px)');
const cols = () => (phone.matches ? 6 : 10);

// ------------------------------------------------------------ loading

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function load() {
  setMessage('Loading times…');
  try {
    const resultsUrl = sample
      ? `assets/samples/${/^[a-z]+$/.test(sample) ? sample : 'none'}.json`
      : `results.json?t=${Date.now()}`;
    const [stage, cars, results] = await Promise.all([
      getJson('data/stage.json'), getJson('data/cars.json'), getJson(resultsUrl),
    ]);
    state.stage = stage;
    state.groups = cars.groups;
    state.carGroup = new Map(cars.cars.map((c) => [c.id, c.group]));
    state.groupTag = new Map(cars.groups.map((g) => [g.name, g.tag]));
    state.runs = Array.isArray(results.runs) ? results.runs : [];
    state.generatedAt = results.generated_at || null;
    renderStage();
    renderClassOptions();
    render();
    if (highlightId) document.querySelector('tr.run.mine')?.scrollIntoView({ block: 'center' });
  } catch (err) {
    console.error(err);
    setMessage('<strong>Couldn’t load results.</strong>Check your connection and try again.<br><button type="button" class="btn-plain" id="retry">Retry</button>');
    $('summary').textContent = '';
    $('retry').addEventListener('click', load);
  }
}

function setMessage(html) {
  $('rows').innerHTML = `<tr class="msg-row"><td colspan="${cols()}">${html}</td></tr>`;
  $('show-all-wrap').hidden = true;
}

// ------------------------------------------------------------ static bits

function renderSampleBar() {
  if (!sample) return;
  const bar = $('sample-bar');
  const links = SAMPLES.map(([k, label]) =>
    `<a href="?sample=${k}"${k === sample ? ' aria-current="true"' : ''}>${label}</a>`).join(' · ');
  bar.innerHTML = `<strong>Sample data</strong> with fictional drivers. Show: ${links} · <a href="./">Live board</a>`;
  bar.hidden = false;
}

function renderStage() {
  const s = state.stage;
  document.title = `${s.name} stage times`;
  $('stage-name').textContent = s.name;
  const meta = $('stage-meta');
  const place = [s.location, `${s.length_km} km`, s.surface].filter(Boolean).join(' · ');
  if (Array.isArray(s.events) && s.events.length) {
    meta.innerHTML = `<span class="meta-events">${s.events.map((e) => `<span class="meta-event meta-${esc(e.year)}"><b>${esc(e.label)}</b> ${esc(e.stages)}</span>`).join('')}</span><span class="meta-place">${esc(place)}</span>`;
  } else {
    meta.textContent = [s.event, place].filter(Boolean).join(' · ');
  }
  if (s.repo_url) $('repo-link').href = s.repo_url;
  if (state.generatedAt && !sample) {
    const t = zonedStamp(state.generatedAt, tz());
    $('updated').textContent = `Board updated ${t.date} ${t.time.slice(0, 5)} ${t.zone}.`;
  }
}

function renderClassOptions() {
  const used = new Set(state.runs.map((r) => state.carGroup.get(r.car_id)).filter(Boolean));
  const sel = $('f-class');
  const keep = state.group;
  sel.innerHTML = '<option value="">All drivetrains</option>' + state.groups
    .filter((g) => used.has(g.name))
    .map((g) => `<option value="${esc(g.name)}">${esc(g.name)}</option>`).join('');
  sel.value = used.has(keep) ? keep : '';
  state.group = sel.value;
}

// ------------------------------------------------------------ the table

function render() {
  const { rows, fastestCp1, fastestCp2, fastestSectors } = rankRuns(state.runs, {
    view: state.view, group: state.group, carGroup: state.carGroup, source: state.source,
  });

  const q = driverKey(state.search);
  let shown = q ? rows.filter((r) => driverKey(r.run.driver).includes(q)) : rows;
  const limit = state.stage?.rows_before_show_all || 100;
  const truncated = !q && !state.showAll && shown.length > limit;
  if (truncated) shown = shown.slice(0, limit);

  renderSummary(rows);
  renderTheory();
  renderMine();

  if (state.runs.length === 0) {
    setMessage(`<strong>No times yet. Be the first.</strong>Drive ${esc(state.stage?.name || 'the stage')}, then post your checkpoint and finish times.<br><a class="btn-submit" href="submit/">Submit a time</a>`);
    return;
  }
  if (rows.length === 0 && state.source && !state.group) {
    setMessage(`<strong>No ${esc(SOURCE_NAME[state.source])} times yet.</strong><button type="button" class="btn-plain" data-action="all-sources">Show all times</button>`);
    return;
  }
  if (rows.length === 0) {
    setMessage(`<strong>No ${state.source ? esc(SOURCE_NAME[state.source]) + ' ' : ''}times in ${esc(state.group)} yet.</strong><button type="button" class="btn-plain" data-action="all-classes">Show all drivetrains</button>`);
    return;
  }
  if (shown.length === 0) {
    setMessage(`<strong>No driver matches “${esc(state.search)}”.</strong><button type="button" class="btn-plain" data-action="clear-search">Clear search</button>`);
    return;
  }

  const ctx = { fastestCp1, fastestCp2, fastestSectors };
  $('rows').innerHTML = shown.map((row, i) => rowHtml(row, i, ctx)).join('');

  const wrap = $('show-all-wrap');
  wrap.hidden = !truncated;
  if (truncated) $('show-all').textContent = `Show all ${rows.length}`;
}

function renderSummary(rows) {
  const el = $('summary');
  if (state.runs.length === 0) { el.textContent = ''; return; }
  const pool = state.source ? state.runs.filter((r) => inSource(r, state.source, tz())) : state.runs;
  const drivers = new Set(pool.map((r) => driverKey(r.driver))).size;
  const runsWord = pool.length === 1 ? 'time' : 'times';
  const driversWord = drivers === 1 ? 'driver' : 'drivers';
  const kind = state.source ? `${SOURCE_NAME[state.source]} ` : '';
  let text = `${pool.length} ${kind}${runsWord} from ${drivers} ${driversWord}`;
  if (state.group) text += ` · ${rows.length} ${state.view === 'best' ? (rows.length === 1 ? 'driver' : 'drivers') : (rows.length === 1 ? 'time' : 'times')} in ${state.group}`;
  text += state.view === 'best' ? ' · best time per driver' : ' · every run';
  el.innerHTML = esc(text) + pendingNote();
}

function renderTheory() {
  const el = $('theory');
  const all = rankRuns(state.runs, { view: 'all', group: state.group, carGroup: state.carGroup, source: state.source }).rows;
  const t = all.length >= 2 ? theoreticalBest(all) : null;
  if (!t) { el.hidden = true; return; }
  const names = t.parts.map((p, i) => `<span class="theory-part">S${i + 1} ${esc(p.run.driver)} <span class="theory-ms">${formatTime(p.ms)}</span></span>`).join('');
  el.innerHTML = `<span class="theory-head">Theoretical best <strong>${formatTime(t.total)}</strong></span>${names}`;
  el.title = 'The fastest sector 1, 2 and 3 in this selection, added together';
  el.hidden = false;
}

/** After submitting: where the new time ranks among virtual times, and against 2024. */
function renderMine() {
  const el = $('mine-banner');
  const run = highlightId && state.runs.find((r) => r.id === highlightId);
  if (!run || runTag(run, tz()).kind !== 'virtual') { el.hidden = true; return; }
  const v = rankRuns(state.runs, { view: 'best', source: 'virtual' }).rows;
  const me = v.find((r) => driverKey(r.run.driver) === driverKey(run.driver));
  let text = `Your <strong>${formatTime(run.finish_ms)}</strong>`;
  if (me && me.run.id === run.id) {
    const leader = v[0].run;
    text += me.pos === 1
      ? (v.length > 1 ? ` is the <strong>fastest virtual time</strong>, ${gapText(v[1].run.finish_ms - run.finish_ms)} ahead of ${esc(v[1].run.driver)}.` : ' is the <strong>fastest virtual time</strong>.')
      : ` is <strong>P${me.pos} of ${v.length}</strong> in Virtual, ${gapText(me.diffFirst)} behind ${esc(leader.driver)}.`;
  } else if (me) {
    text += ` is saved. Your best is still <strong>${formatTime(me.run.finish_ms)}</strong> (P${me.pos} of ${v.length} in Virtual).`;
  }
  for (const year of LSPR_YEARS) {
    const pl = realPlacings(run.finish_ms, state.runs, year);
    if (pl.length) text += ` In ${year} it would have been ${pl.map(placingText).join('; ')}.`;
  }
  el.innerHTML = text;
  el.hidden = false;
}

function pendingNote() {
  if (!highlightId || state.runs.some((r) => r.id === highlightId)) return '';
  return ' · <span class="pending">Your time is being published. The board refreshes by itself in a minute or two.</span>';
}

function rowHtml(row, i, ctx) {
  const { run, pos, diffPrev, diffFirst, driverRuns } = row;
  const group = state.carGroup.get(run.car_id);
  const tag = group ? `<span class="tag" title="${esc(group)}">${esc(state.groupTag.get(group) || group)}</span>` : '';
  const up = zonedStamp(run.uploaded_at, tz());
  const fast1 = run.cp1_ms === ctx.fastestCp1 ? ' fastest' : '';
  const fast2 = run.cp2_ms === ctx.fastestCp2 ? ' fastest' : '';
  const open = state.open.has(run.id);
  const mine = run.id === highlightId ? ' mine' : '';
  const shot = run.screenshot
    ? `<a class="shot-link" href="${esc(run.screenshot)}" target="_blank" rel="noopener" title="Open screenshot" aria-label="Screenshot of ${esc(run.driver)}'s run" data-stop><svg aria-hidden="true"><use href="#i-camera"/></svg></a>`
    : '';
  const main = `<tr class="run ${i % 2 ? 'even' : 'odd'}${mine}" data-id="${esc(run.id)}" tabindex="0" aria-expanded="${open}">
    <td class="c-pos">${pos}</td>
    <td class="c-driver"><span class="driver-name">${esc(run.driver)}</span>${(() => { const t = runTag(run, tz()); return ` <span class="label label-${t.kind} label-${t.key}">${esc(t.text)}</span>`; })()}<span class="car-sub">${esc(run.car_name)}</span></td>
    <td class="c-car">${esc(run.car_name)}${tag}</td>
    <td class="c-time${fast1}">${run.cp1_ms === null ? '—' : formatTime(run.cp1_ms)}</td>
    <td class="c-time${fast2}">${run.cp2_ms === null ? '—' : formatTime(run.cp2_ms)}</td>
    <td class="c-time c-finish finish">${formatTime(run.finish_ms)}</td>
    <td class="c-diff c-prev">${formatDiff(diffPrev)}</td>
    <td class="c-diff">${formatDiff(diffFirst)}</td>
    <td class="c-up" title="${up.zone} (${up.offset}) · ${up.utc}"><span class="up-date">${up.date}</span><span class="up-time">${up.time}</span></td>
    <td class="c-shot">${shot}</td>
  </tr>`;
  return open ? main + detailHtml(row, ctx, up, group, driverRuns) : main;
}

function detailHtml(row, ctx, up, group, driverRuns) {
  const { run, diffPrev } = row;
  const sector = (s, label) => {
    const t = row.sectors[s];
    if (t === null) return `<div><h3>${label}</h3><div class="val">—</div></div>`;
    const best = ctx.fastestSectors[s];
    const isBest = t === best;
    return `<div><h3>${label}</h3><div class="val${isBest ? ' fastest' : ''}">${formatTime(t)}<span class="gap">${isBest ? 'fastest' : '+' + formatDiff(t - best)}</span></div></div>`;
  };
  const vsReal = runTag(run, tz()).kind === 'virtual'
    ? LSPR_YEARS.map((year) => {
      const placings = realPlacings(run.finish_ms, state.runs, year);
      return placings.length
        ? `<div class="detail-wide"><h3>If driven at LSPR ${year}</h3><div class="val">${placings.map(placingText).join('<br>')}</div></div>`
        : '';
    }).join('')
    : '';
  const runsNote = historyHtml(run, driverRuns);
  const shot = run.screenshot
    ? `<div class="detail-shot"><h3>Screenshot</h3><a href="${esc(run.screenshot)}" target="_blank" rel="noopener" data-stop><img src="${esc(run.screenshot)}" alt="Screenshot of ${esc(run.driver)}'s run" loading="lazy"></a></div>`
    : '';
  return `<tr class="detail" data-detail-for="${esc(run.id)}"><td colspan="${cols()}"><div class="detail-grid">
    ${sector(0, 'Sector 1 · start to chkpt 1')}
    ${sector(1, 'Sector 2 · chkpt 1 to 2')}
    ${sector(2, 'Sector 3 · chkpt 2 to finish')}
    <div class="only-phone"><h3>Car</h3><div class="val">${esc(run.car_name)}${group ? ` <span class="tag">${esc(state.groupTag.get(group) || group)}</span>` : ''}</div></div>
    <div class="only-phone"><h3>Diff. Prev</h3><div class="val">${formatDiff(diffPrev)}</div></div>
    <div><h3>Uploaded</h3><div class="val">${up.date} ${up.time} ${up.zone}<span class="gap">${up.utc}</span></div></div>
    ${vsReal}
    ${runsNote}
    ${run.note ? `<div class="detail-note"><h3>Note</h3><div class="val">${esc(run.note)}</div></div>` : ''}
    ${shot}
  </div></td></tr>`;
}

/** Every run by this driver, oldest first, with the change from their previous best. */
function historyHtml(run, driverRuns) {
  const key = driverKey(run.driver);
  const mine = state.runs.filter((r) => driverKey(r.driver) === key)
    .sort((a, b) => Date.parse(a.uploaded_at) - Date.parse(b.uploaded_at) || a.finish_ms - b.finish_ms);
  if (mine.length < 2) return '';
  const fastest = Math.min(...mine.map((r) => r.finish_ms));
  let best = Infinity;
  const rows = mine.map((r) => {
    const tag = runTag(r, tz());
    const when = tag.kind === 'real' ? esc((/LSPR \d{4} (SS\d+)/.exec(r.note || '') || [])[1] || tag.text) : zonedStamp(r.uploaded_at, tz()).date;
    const change = Number.isFinite(best)
      ? (r.finish_ms < best ? `<span class="hist-better">−${formatDiff(best - r.finish_ms)}</span>` : `<span class="hist-worse">+${formatDiff(r.finish_ms - best)}</span>`)
      : '';
    best = Math.min(best, r.finish_ms);
    const cls = [r.id === run.id ? 'hist-this' : '', r.finish_ms === fastest ? 'hist-best' : ''].join(' ').trim();
    return `<tr${cls ? ` class="${cls}"` : ''}><td><span class="label label-${tag.kind} label-${tag.key}">${esc(tag.text)}</span> ${when}</td><td class="hist-car">${esc(r.car_name)}</td><td class="hist-t">${formatTime(r.finish_ms)}</td><td class="hist-t">${change}</td></tr>`;
  }).join('');
  const link = state.view === 'best' ? ` · <button type="button" class="btn-link" data-action="all-runs">Show all runs on the board</button>` : '';
  return `<div class="detail-wide"><h3>${driverRuns} runs by ${esc(run.driver)}${link}</h3>
    <table class="history"><thead><tr><th>When</th><th class="hist-car">Car</th><th class="hist-t">Finish</th><th class="hist-t">vs. best before</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ------------------------------------------------------------ events

function toggleRow(tr) {
  const id = tr.dataset.id;
  if (state.open.has(id)) state.open.delete(id); else state.open.add(id);
  render();
  const again = document.querySelector(`tr.run[data-id="${CSS.escape(id)}"]`);
  if (again) again.focus({ preventScroll: true });
}

$('rows').addEventListener('click', (e) => {
  if (e.target.closest('[data-stop]')) return;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'all-runs') { setView('all'); return; }
  if (action === 'all-sources') { setSource(''); return; }
  if (action === 'all-classes') { $('f-class').value = ''; state.group = ''; render(); return; }
  if (action === 'clear-search') { $('f-search').value = ''; state.search = ''; render(); return; }
  const tr = e.target.closest('tr.run');
  if (tr) toggleRow(tr);
});

$('rows').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.run')) {
    e.preventDefault();
    toggleRow(e.target);
  }
});

function setView(view) {
  state.view = view;
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  render();
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

function setSource(source, { draw = true } = {}) {
  state.source = source;
  document.querySelectorAll('[data-source]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.source === source)));
  const url = new URL(location.href);
  const key = Object.keys(SOURCE_PARAM).find((k) => SOURCE_PARAM[k] === source);
  if (key) url.searchParams.set('runs', key); else url.searchParams.delete('runs');
  history.replaceState(null, '', url);
  if (draw) render();
}
document.querySelectorAll('[data-source]').forEach((b) => b.addEventListener('click', () => setSource(b.dataset.source)));
setSource(state.source, { draw: false });

$('f-class').addEventListener('change', (e) => { state.group = e.target.value; render(); });
$('f-search').addEventListener('input', (e) => { state.search = e.target.value; render(); });
phone.addEventListener('change', () => { if (state.stage) render(); });
$('show-all').addEventListener('click', () => { state.showAll = true; render(); });

// After submitting, the driver lands here with ?highlight=<id>. Until the new
// deploy is live, refresh the data every 20 s for up to 4 minutes.
if (highlightId && !sample) {
  let tries = 0;
  const timer = setInterval(async () => {
    tries++;
    if (state.runs.some((r) => r.id === highlightId) || tries > 12) { clearInterval(timer); return; }
    try {
      const results = await getJson(`results.json?t=${Date.now()}`);
      state.runs = results.runs || [];
      state.generatedAt = results.generated_at || null;
      if (!state.runs.some((r) => r.id === highlightId)) return;
      clearInterval(timer);
      renderStage();
      renderClassOptions();
      render();
      document.querySelector('tr.run.mine')?.scrollIntoView({ block: 'center' });
    } catch { /* try again next tick */ }
  }, 20000);
}

renderSampleBar();
load();
