// Compare two vehicle tunes side by side. Loads the two .lsp files from this site and shows every setting.
import { parseTune } from '../../shared/tune.js';
import { diffTunes, formatValue, formatDelta } from '../../shared/tune-diff.js';

const $ = (id) => document.getElementById(id);
const selA = $('c-a'); const selB = $('c-b'); const only = $('c-only'); const out = $('c-out'); const status = $('c-status');
const cache = new Map();
let list = [];

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const label = (t) => `${t.driver} · ${t.car_name} · ${t.tune_name}`;

async function loadTune(t) {
  if (cache.has(t.id)) return cache.get(t.id);
  const res = await fetch(`../${encodeURIComponent(t.id)}/${encodeURIComponent(t.file_name)}`);
  if (!res.ok) throw new Error(`Couldn’t load ${t.tune_name}.`);
  const parsed = parseTune(await res.text());
  if (!parsed.ok) throw new Error(`${t.tune_name}: ${parsed.errors[0]}`);
  cache.set(t.id, parsed.tune);
  return parsed.tune;
}

function fill(sel, keep) {
  sel.replaceChildren(el('option', '', 'Choose a tune'));
  sel.firstChild.value = '';
  const byCar = new Map();
  for (const t of list) { if (!byCar.has(t.car_name)) byCar.set(t.car_name, []); byCar.get(t.car_name).push(t); }
  for (const [car, ts] of [...byCar].sort((x, y) => x[0].localeCompare(y[0]))) {
    const g = el('optgroup'); g.label = car;
    for (const t of ts) { const o = el('option', '', `${t.driver} · ${t.tune_name}`); o.value = t.id; g.append(o); }
    sel.append(g);
  }
  sel.value = keep || '';
}

function syncUrl() {
  const u = new URL(location.href);
  for (const [k, s] of [['a', selA], ['b', selB]]) { if (s.value) u.searchParams.set(k, s.value); else u.searchParams.delete(k); }
  if (only.checked) u.searchParams.delete('all'); else u.searchParams.set('all', '1');
  history.replaceState(null, '', u);
}

async function render() {
  syncUrl();
  out.replaceChildren(); status.textContent = '';
  const ta = list.find((t) => t.id === selA.value); const tb = list.find((t) => t.id === selB.value);
  if (!ta || !tb) { status.textContent = 'Choose two tunes to compare.'; return; }
  if (ta.id === tb.id) { status.textContent = 'Choose two different tunes.'; return; }
  let a; let b;
  try { [a, b] = await Promise.all([loadTune(ta), loadTune(tb)]); } catch (e) { status.textContent = e.message; return; }
  if (ta.id !== selA.value || tb.id !== selB.value) return; // the choice changed while loading

  const d = diffTunes(a, b);
  const sameCar = ta.car_name === tb.car_name;
  status.textContent = d.differing
    ? `${d.differing} of ${d.total} settings differ.`
    : `All ${d.total} settings match.`;
  if (!sameCar) {
    out.append(el('p', 'callout note', `These tunes are for different cars (${ta.car_name} and ${tb.car_name}). Gear ratio IDs and other car-specific numbers don’t mean the same thing across cars, so read the differences with care.`));
  }
  for (const s of d.sections) {
    const rows = only.checked ? s.rows.filter((r) => !r.same) : s.rows;
    if (!rows.length) continue;
    const h = el('h2', '', s.name);
    const table = el('table', 'values compare');
    const head = el('tr');
    for (const t of ['Setting', `A: ${ta.tune_name}`, `B: ${tb.tune_name}`, 'Change (B − A)']) { const th = el('th', '', t); th.scope = 'col'; head.append(th); }
    table.append(el('thead')); table.firstChild.append(head);
    const body = el('tbody');
    for (const r of rows) {
      const tr = el('tr', r.same ? '' : 'diff');
      const k = el('th', '', r.key); k.scope = 'row';
      tr.append(k, el('td', r.same ? '' : 'differs', formatValue(r.key, r.a)), el('td', r.same ? '' : 'differs', formatValue(r.key, r.b)), el('td', 'delta', formatDelta(r.key, r.a, r.b)));
      body.append(tr);
    }
    table.append(body);
    const wrap = el('div', 'table-scroll'); wrap.append(table);
    out.append(h, wrap);
  }
}

async function start() {
  try {
    const res = await fetch('../tunes.json');
    list = (await res.json()).tunes;
  } catch { status.textContent = 'Couldn’t load the tune list.'; return; }
  const p = new URLSearchParams(location.search);
  only.checked = p.get('all') !== '1';
  fill(selA, p.get('a')); fill(selB, p.get('b'));
  for (const s of [selA, selB]) s.addEventListener('change', render);
  only.addEventListener('change', render);
  $('c-swap').addEventListener('click', () => { const x = selA.value; selA.value = selB.value; selB.value = x; render(); });
  render();
}
start();
