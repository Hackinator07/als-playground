// Results page: loads the data, ranks it with shared/rules.js and draws the table.
import {
  rankRuns, formatTime, formatDiff, zonedStamp, driverKey, runTag, inSource, realPlacings, theoreticalBest, carKey,
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
// ?view=car opens Best per car and ?car=<car id> picks a car (shareable links).
const VIEWS = ['best', 'car', 'all'];

const state = {
  stage: null,
  groups: [],          // [{name, tag}] in dropdown order
  carGroup: new Map(), // car_id -> group name
  rbrCars: new Map(),  // car_id -> name, the active RBR cars
  carName: new Map(),  // Car filter value (carKey) -> name: RBR cars plus the real LSPR cars that have times
  groupTag: new Map(), // group name -> short tag
  runs: [],
  generatedAt: null,
  view: VIEWS.includes((params.get('view') || '').toLowerCase()) ? params.get('view').toLowerCase() : 'best',
  car: params.get('car') || '',
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
    state.rbrCars = new Map(cars.cars.filter((c) => c.active !== false && !c.id.startsWith('no-rbr-version')).map((c) => [c.id, c.name]));
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
  document.title = `${s.name} Stage Times`;
  $('stage-name').textContent = s.name;
  const meta = $('stage-meta');
  const place = [s.location, `${s.length_km} km`, s.surface].filter(Boolean).join(' · ');
  if (Array.isArray(s.events) && s.events.length) {
    meta.innerHTML = `<span class="meta-events">${s.events.map((e) => `<span class="meta-event meta-${esc(e.year)}"><b>${esc(e.label)}</b> ${esc(e.stages)}</span>`).join('')}</span><span class="meta-place">${esc(place)} · <a class="meta-viewer" href="viewer/">Ride the stage in 3D</a></span>`;
  } else {
    meta.textContent = [s.event, place].filter(Boolean).join(' · ') + ' · ';
    const a = document.createElement('a'); a.className = 'meta-viewer'; a.href = 'viewer/'; a.textContent = 'Ride the stage in 3D'; meta.append(a);
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
  renderCarOptions();
}

/**
 * Car filter: every car that has at least one time (inside the chosen drivetrain), grouped by drivetrain.
 * Original RBR cars come first; real LSPR cars with no RBR version follow, listed by their real name.
 */
function renderCarOptions() {
  const rbr = new Map();   // key -> { name, group }
  const real = new Map();
  for (const r of state.runs) {
    const key = carKey(r);
    const group = state.carGroup.get(r.car_id);
    if (!group) continue;
    if (key.includes('|')) real.set(key, { name: r.car_name, group });
    else if (state.rbrCars.has(key)) rbr.set(key, { name: state.rbrCars.get(key), group });
  }
  state.carName = new Map([...rbr, ...real].map(([k, v]) => [k, v.name]));
  const optgroup = (label, map, group) => {
    const cars = [...map].filter(([, v]) => v.group === group).sort((a, b) => a[1].name.localeCompare(b[1].name));
    return cars.length ? `<optgroup label="${esc(label)}">${cars.map(([key, v]) => `<option value="${esc(key)}">${esc(v.name)}</option>`).join('')}</optgroup>` : '';
  };
  const opts = state.groups
    .filter((g) => !state.group || g.name === state.group)
    .map((g) => optgroup(g.name, rbr, g.name) + optgroup(`${g.name} · real LSPR cars`, real, g.name)).join('');
  const sel = $('f-car');
  sel.innerHTML = `<option value="">All cars</option>${opts}`;
  const ok = [...sel.options].some((o) => o.value === state.car);
  sel.value = ok ? state.car : '';
  state.car = sel.value;
}

function syncUrl() {
  const url = new URL(location.href);
  if (state.view === 'best') url.searchParams.delete('view'); else url.searchParams.set('view', state.view);
  if (state.car) url.searchParams.set('car', state.car); else url.searchParams.delete('car');
  history.replaceState(null, '', url);
}

// ------------------------------------------------------------ the table

function render() {
  const { rows, fastestCp1, fastestCp2, fastestSectors } = rankRuns(state.runs, {
    view: state.view, group: state.group, car: state.car, carGroup: state.carGroup, source: state.source,
  });

  const q = driverKey(state.search);
  let shown = q ? rows.filter((r) => driverKey(r.run.driver).includes(q)) : rows;
  const limit = state.stage?.rows_before_show_all || 100;
  const truncated = !q && !state.showAll && shown.length > limit;
  if (truncated) shown = shown.slice(0, limit);

  document.querySelector('.legend-pb').hidden = state.view === 'best';
  renderSummary(rows);
  renderTheory();
  renderMine();

  if (state.runs.length === 0) {
    setMessage(`<strong>No times yet. Be the first.</strong>Drive ${esc(state.stage?.name || 'the stage')}, then post your checkpoint and finish times.<br><a class="btn-submit" href="submit/">Submit a Time</a>`);
    return;
  }
  if (rows.length === 0 && state.car) {
    setMessage(`<strong>No ${state.source ? esc(SOURCE_NAME[state.source]) + ' ' : ''}times in the ${esc(state.carName.get(state.car) || 'selected car')} yet.</strong><button type="button" class="btn-plain" data-action="all-cars">Show all cars</button>`);
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

  // each driver's own best checkpoint and finish across all their runs (marked green when it isn't the board's fastest)
  const pbs = new Map();
  for (const r of state.runs) {
    if (r.label) continue; // real LSPR runs are different stages and years, so their times can't be compared with each other
    const k = driverKey(r.driver);
    const e = pbs.get(k) || { cp1: Infinity, cp2: Infinity, fin: Infinity, n: 0 };
    if (r.cp1_ms !== null && r.cp1_ms < e.cp1) e.cp1 = r.cp1_ms;
    if (r.cp2_ms !== null && r.cp2_ms < e.cp2) e.cp2 = r.cp2_ms;
    if (r.finish_ms < e.fin) e.fin = r.finish_ms;
    e.n += 1;
    pbs.set(k, e);
  }
  const maxDiff = shown.reduce((m, r) => Math.max(m, r.diffFirst), 0);
  const ctx = { fastestCp1, fastestCp2, fastestSectors, pbs, maxDiff };
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
  const scope = state.car ? `the ${state.carName.get(state.car) || 'selected car'}` : state.group;
  if (scope) text += ` · ${rows.length} ${state.view === 'all' ? (rows.length === 1 ? 'time' : 'times') : (rows.length === 1 ? 'driver' : 'drivers')} in ${scope}`;
  text += state.view === 'best' ? ' · best time per driver' : state.view === 'car' ? (state.car ? ' · best time per driver in this car' : ' · best time per driver in each car') : ' · every run';
  el.innerHTML = esc(text) + pendingNote();
}

function renderTheory() {
  const el = $('theory');
  const all = rankRuns(state.runs, { view: 'all', group: state.group, car: state.car, carGroup: state.carGroup, source: state.source }).rows;
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

// A gap behind another time: "+7.918", "+1:06.308", or a dash for no gap (the leader, or a tie).
function gap(ms) {
  const t = Math.round(ms);
  if (t <= 0) return '—';
  return t < 60000 ? `+${(t / 1000).toFixed(3)}` : `+${formatTime(t)}`;
}

function rowHtml(row, i, ctx) {
  const { run, pos, diffPrev, diffFirst, driverRuns, ownGap } = row;
  // Best per car and All runs: how far this run is behind the same driver's fastest run on the board (within the
  // current filters). Best per driver never shows it: every row there is the driver's best.
  const ownTitle = state.view === 'car'
    ? `Slower than ${run.driver}'s fastest run in another car`
    : `${(ownGap / 1000).toFixed(3)} s behind ${run.driver}'s best run`;
  const own = state.view !== 'best' && ownGap > 0
    ? ` <span class="gap-own" title="${esc(ownTitle)}">+${(ownGap / 1000).toFixed(3)}<span class="gap-own-full"> vs own best</span></span>` : '';
  const group = state.carGroup.get(run.car_id);
  const tag = group ? `<span class="tag" title="${esc(group)}">${esc(state.groupTag.get(group) || group)}</span>` : '';
  const up = zonedStamp(run.uploaded_at, tz());
  const mine = ctx.pbs.get(driverKey(run.driver));
  // Best per driver shows each driver's best run, so green there would mark almost every cell; it only helps when runs differ.
  const multi = !!mine && mine.n > 1 && !run.label && state.view !== 'best';
  const fast1 = run.cp1_ms === ctx.fastestCp1 ? ' fastest' : (multi && run.cp1_ms !== null && run.cp1_ms === mine.cp1 ? ' pb' : '');
  const fast2 = run.cp2_ms === ctx.fastestCp2 ? ' fastest' : (multi && run.cp2_ms !== null && run.cp2_ms === mine.cp2 ? ' pb' : '');
  const finPb = multi && run.finish_ms === mine.fin ? ' pb' : '';
  // thin bar under the gap to first; the square root keeps small gaps visible next to the slow runs
  const bar = diffFirst > 0 && ctx.maxDiff > 0 ? `<i class="gap-bar" style="width:${Math.max(4, Math.round(Math.sqrt(diffFirst / ctx.maxDiff) * 100))}%"></i>` : '';
  const open = state.open.has(run.id);
  const isMine = run.id === highlightId ? ' mine' : '';
  const shot = run.screenshot
    ? `<a class="shot-link" href="${esc(run.screenshot)}" target="_blank" rel="noopener" title="Open screenshot" aria-label="Screenshot of ${esc(run.driver)}'s run" data-stop><svg aria-hidden="true"><use href="#i-camera"/></svg></a>`
    : '';
  const main = `<tr class="run ${i % 2 ? 'even' : 'odd'}${pos <= 3 ? ` podium pod${pos}` : ''}${isMine}" data-id="${esc(run.id)}" tabindex="0" aria-expanded="${open}">
    <td class="c-pos">${pos}</td>
    <td class="c-driver"><span class="driver-name">${esc(run.driver)}</span>${(() => { const t = runTag(run, tz()); return ` <span class="label label-${t.kind} label-${t.key}">${esc(t.text)}</span>`; })()}${own}<span class="car-sub">${esc(run.car_name)}</span></td>
    <td class="c-car"><div class="car-cell"><span class="car-name" title="${esc(run.car_name)}">${esc(run.car_name)}</span>${tag}</div></td>
    <td class="c-time${fast1}">${run.cp1_ms === null ? '—' : formatTime(run.cp1_ms)}</td>
    <td class="c-time${fast2}">${run.cp2_ms === null ? '—' : formatTime(run.cp2_ms)}</td>
    <td class="c-time c-finish finish${finPb}">${formatTime(run.finish_ms)}</td>
    <td class="c-diff c-prev">${gap(diffPrev)}</td>
    <td class="c-diff c-first">${gap(diffFirst)}${bar}</td>
    <td class="c-up" title="${up.date} ${up.time} ${up.zone} (${up.offset}) · ${up.utc}"><span class="up-date">${up.date}</span><span class="up-time">${up.time}</span></td>
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
    return `<div><h3>${label}</h3><div class="val${isBest ? ' fastest' : ''}">${formatTime(t)}<span class="gap">${isBest ? 'fastest' : gap(t - best)}</span></div></div>`;
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
    <div class="only-phone"><h3>Diff. Prev</h3><div class="val">${gap(diffPrev)}</div></div>
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
  const link = state.view !== 'all' ? ` · <button type="button" class="btn-link" data-action="all-runs">Show all runs on the board</button>` : '';
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
  if (action === 'all-cars') { state.car = ''; renderCarOptions(); syncUrl(); render(); return; }
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
  syncUrl();
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

$('f-class').addEventListener('change', (e) => { state.group = e.target.value; renderCarOptions(); syncUrl(); render(); });
$('f-car').addEventListener('change', (e) => { state.car = e.target.value; syncUrl(); render(); });
document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
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
