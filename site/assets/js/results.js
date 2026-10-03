// Results page: loads the data, ranks it with shared/rules.js and draws the table.
import {
  rankRuns, formatTime, formatDiff, zonedStamp, driverKey,
} from '../../shared/rules.js';

const SAMPLES = [
  ['empty', 'Empty'], ['one', 'One time'], ['ties', 'Ties'],
  ['repeat', 'Repeat drivers'], ['many', 'Many'], ['broken', 'Load failure'],
];

const params = new URLSearchParams(location.search);
const sample = (params.get('sample') || '').toLowerCase();
const highlightId = params.get('highlight') || '';

const state = {
  stage: null,
  groups: [],          // [{name, tag}] in dropdown order
  carGroup: new Map(), // car_id -> group name
  groupTag: new Map(), // group name -> short tag
  runs: [],
  generatedAt: null,
  view: 'best',
  group: '',
  search: '',
  showAll: false,
  open: new Set(),     // ids of expanded rows
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tz = () => state.stage?.display_time_zone || 'America/Chicago';

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
  $('stage-meta').textContent = [s.event, s.location, `${s.length_km} km`, s.surface].filter(Boolean).join(' · ');
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
    view: state.view, group: state.group, carGroup: state.carGroup,
  });

  const q = driverKey(state.search);
  let shown = q ? rows.filter((r) => driverKey(r.run.driver).includes(q)) : rows;
  const limit = state.stage?.rows_before_show_all || 100;
  const truncated = !q && !state.showAll && shown.length > limit;
  if (truncated) shown = shown.slice(0, limit);

  renderSummary(rows);

  if (state.runs.length === 0) {
    setMessage(`<strong>No times yet. Be the first.</strong>Drive ${esc(state.stage?.name || 'the stage')}, then post your checkpoint and finish times.<br><a class="btn-submit" href="submit/">Submit a time</a>`);
    return;
  }
  if (rows.length === 0) {
    setMessage(`<strong>No times in ${esc(state.group)} yet.</strong><button type="button" class="btn-plain" data-action="all-classes">Show all drivetrains</button>`);
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
  const drivers = new Set(state.runs.map((r) => driverKey(r.driver))).size;
  const runsWord = state.runs.length === 1 ? 'time' : 'times';
  const driversWord = drivers === 1 ? 'driver' : 'drivers';
  let text = `${state.runs.length} ${runsWord} from ${drivers} ${driversWord}`;
  if (state.group) text += ` · ${rows.length} ${state.view === 'best' ? (rows.length === 1 ? 'driver' : 'drivers') : (rows.length === 1 ? 'time' : 'times')} in ${state.group}`;
  text += state.view === 'best' ? ' · best time per driver' : ' · every run';
  el.innerHTML = esc(text) + pendingNote();
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
    <td class="c-driver"><span class="driver-name">${esc(run.driver)}</span>${run.label ? ` <span class="label">${esc(run.label)}</span>` : ''}<span class="car-sub">${esc(run.car_name)}</span></td>
    <td class="c-car">${esc(run.car_name)}${tag}</td>
    <td class="c-time${fast1}">${formatTime(run.cp1_ms)}</td>
    <td class="c-time${fast2}">${formatTime(run.cp2_ms)}</td>
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
    const best = ctx.fastestSectors[s];
    const isBest = t === best;
    return `<div><h3>${label}</h3><div class="val${isBest ? ' fastest' : ''}">${formatTime(t)}<span class="gap">${isBest ? 'fastest' : '+' + formatDiff(t - best)}</span></div></div>`;
  };
  const runsNote = state.view === 'best' && driverRuns > 1
    ? `<div><h3>Runs</h3><div class="val">${driverRuns} runs · <button type="button" class="btn-link" data-action="all-runs">All runs</button></div></div>`
    : '';
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
    ${runsNote}
    ${run.note ? `<div class="detail-note"><h3>Note</h3><div class="val">${esc(run.note)}</div></div>` : ''}
    ${shot}
  </div></td></tr>`;
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
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  render();
}
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

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
