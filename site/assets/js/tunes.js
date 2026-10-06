// Vehicle tune library: search and drivetrain filter over the rows already on the page.
const search = document.getElementById('t-search');
const group = document.getElementById('t-group');
const count = document.getElementById('t-count');
const empty = document.getElementById('t-empty');
const rows = [...document.querySelectorAll('.tune-row')];

function apply() {
  const q = search.value.trim().toLowerCase();
  const g = group.value;
  let shown = 0;
  for (const row of rows) {
    const ok = (!q || row.dataset.search.includes(q)) && (!g || row.dataset.group === g);
    row.hidden = !ok;
    if (ok) shown += 1;
  }
  const filtered = q || g;
  count.textContent = rows.length && filtered ? `${shown} of ${rows.length} tunes` : '';
  if (rows.length) empty.hidden = shown > 0;
}

if (rows.length) {
  search.addEventListener('input', apply);
  group.addEventListener('change', apply);
  apply();
}
