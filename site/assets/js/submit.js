// Submit page: live checking, screenshot resize, bot check, and posting to the Worker.
// Until data/stage.json has a submit_url, the form runs in test mode: it checks
// everything the same way but saves nothing.
import { parseTime, formatReadback, validateSubmission, formatTime } from '../../shared/rules.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const MAX_IMAGE_BYTES = 600 * 1024;
const TEST_SITE_KEY = '1x00000000000000000000AA'; // Cloudflare's always-pass key, for local previews
const FIELDS = ['driver', 'car', 'cp1', 'cp2', 'finish', 'consent'];

const state = {
  stage: null,
  cars: null,
  existing: [],
  testMode: true,
  open: true,
  image: null, // { type: 'webp' | 'jpeg', data: base64, bytes, width, height }
  token: '',
  widgetId: null,
  touched: new Set(),
  sending: false,
  carId: '',    // the chosen car (the visible box holds its name)
};

// ------------------------------------------------------------ setup

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function init() {
  try {
    const [stage, cars] = await Promise.all([getJson('../data/stage.json'), getJson('../data/cars.json')]);
    state.stage = stage;
    state.cars = cars;
  } catch (err) {
    console.error(err);
    showFatal('Couldn’t load the form. Check your connection and reload the page.');
    return;
  }
  // Existing times are only used to warn about duplicates; the form works without them.
  getJson(`../results.json?t=${Date.now()}`).then((r) => { state.existing = r.runs || []; }).catch(() => {});

  const s = state.stage;
  $('stage-meta').textContent = [s.name, s.event, `${s.length_km} km`, s.surface].join(' · ');
  if (s.repo_url) $('car-missing').href = `${s.repo_url}/issues/new?title=${encodeURIComponent('Car missing: ')}`;
  fillCars();
  restoreLast();

  state.testMode = !s.submit_url;
  if (state.testMode) {
    showMode('<strong>Test mode.</strong> Submissions aren’t open yet. Try the form as much as you like: it checks everything, but nothing is saved.');
  } else {
    try {
      const status = await getJson(`${workerBase()}/status`);
      state.open = status.open !== false;
    } catch { /* if the status check fails, let the submit itself report the problem */ }
    if (!state.open) {
      showMode('<strong>Submissions are closed right now.</strong> Check back later.');
      $('send').disabled = true;
    }
  }
  loadTurnstile();
}

// stage.json's submit_url is the Worker's address, e.g. https://als-playground-submit.hack-jason.workers.dev
const workerBase = () => state.stage.submit_url.replace(/\/+$/, '').replace(/\/submit$/, '');

function showMode(html) {
  const el = $('mode-note');
  el.innerHTML = html;
  el.hidden = false;
}

function showFatal(text) {
  $('submit-form').hidden = true;
  showMode(esc(text));
}

// ------------------------------------------------------------ car picker
// A combobox: a text box that filters a grouped dropdown as you type. Every word
// typed must appear in the car's name or drivetrain ("4wd impreza", "fiesta r2").

const combo = {
  list: [],      // active cars, grouped and sorted
  shown: [],     // cars currently listed
  active: -1,    // index into shown of the keyboard-highlighted car
};

function fillCars() {
  const active = state.cars.cars.filter((c) => c.active !== false);
  combo.list = state.cars.groups.flatMap((g) => active.filter((c) => c.group === g.name).sort((a, b) => a.name.localeCompare(b.name)));
}

const carById = (id) => combo.list.find((c) => c.id === id);
const norm = (t) => String(t).toLocaleLowerCase('en-US').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

function matches(q) {
  const words = norm(q).split(/[\s,]+/).filter(Boolean);
  if (!words.length) return combo.list;
  return combo.list.filter((c) => { const hay = norm(`${c.name} ${c.group}`); return words.every((w) => hay.includes(w)); });
}

function drawList() {
  const ul = $('car-list');
  if (!combo.shown.length) {
    ul.innerHTML = '<li class="combo-empty" role="presentation">No car matches. Try fewer letters, or open the full list with the arrow.</li>';
    return;
  }
  let html = ''; let group = '';
  combo.shown.forEach((c, i) => {
    if (c.group !== group) { group = c.group; html += `<li class="combo-group" role="presentation">${esc(group)}</li>`; }
    const cls = ['combo-opt', i === combo.active ? 'is-active' : '', c.id === state.carId ? 'is-chosen' : ''].join(' ').trim();
    html += `<li class="${cls}" role="option" id="car-opt-${i}" data-i="${i}" aria-selected="${c.id === state.carId}">${esc(c.name)}</li>`;
  });
  ul.innerHTML = html;
  const input = $('f-car');
  if (combo.active >= 0) {
    input.setAttribute('aria-activedescendant', `car-opt-${combo.active}`);
    $(`car-opt-${combo.active}`)?.scrollIntoView({ block: 'nearest' });
  } else input.removeAttribute('aria-activedescendant');
}

function openList(query) {
  combo.shown = query === null ? combo.list : matches(query);
  const chosen = combo.shown.findIndex((c) => c.id === state.carId);
  combo.active = chosen >= 0 ? chosen : (query ? 0 : -1);
  if (!combo.shown.length) combo.active = -1;
  $('car-list').hidden = false;
  $('f-car').setAttribute('aria-expanded', 'true');
  drawList();
}

function closeList() {
  $('car-list').hidden = true;
  $('f-car').setAttribute('aria-expanded', 'false');
  $('f-car').removeAttribute('aria-activedescendant');
}

function chooseCar(id, { silent = false } = {}) {
  const car = carById(id);
  state.carId = car ? car.id : '';
  $('f-car').value = car ? car.name : '';
  closeList();
  if (!silent) { state.touched.add('car'); check(); }
}

/** Leaving the box: keep an exact or single match, otherwise the car is unset (and flagged). */
function settleCar() {
  const text = $('f-car').value.trim();
  const chosen = carById(state.carId);
  if (chosen && chosen.name === $('f-car').value) { closeList(); return; }
  if (!text) { state.carId = ''; closeList(); state.touched.add('car'); check(); return; }
  const exact = combo.list.find((c) => norm(c.name) === norm(text));
  const found = exact ? [exact] : matches(text);
  if (found.length === 1) chooseCar(found[0].id);
  else { state.carId = ''; closeList(); state.touched.add('car'); check(); }
}

$('f-car').addEventListener('focus', () => { $('f-car').select(); openList(null); });
$('f-car').addEventListener('input', () => { state.carId = ''; openList($('f-car').value); if (state.touched.has('car')) check(); });
$('f-car').addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== $('f-car')) settleCar(); }, 120));
$('f-car').addEventListener('keydown', (e) => {
  const open = !$('car-list').hidden;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!open) { openList(state.carId ? null : $('f-car').value); return; }
    if (!combo.shown.length) return;
    const step = e.key === 'ArrowDown' ? 1 : -1;
    combo.active = combo.active < 0 ? (step > 0 ? 0 : combo.shown.length - 1) : (combo.active + step + combo.shown.length) % combo.shown.length;
    drawList();
  } else if (e.key === 'Enter') {
    if (open && combo.active >= 0) { e.preventDefault(); chooseCar(combo.shown[combo.active].id); }
  } else if (e.key === 'Escape') {
    if (open) { e.preventDefault(); const c = carById(state.carId); if (c) $('f-car').value = c.name; closeList(); }
  } else if (e.key === 'Tab' && open && combo.active >= 0 && $('f-car').value.trim() && !state.carId) {
    chooseCar(combo.shown[combo.active].id);
  }
});
$('car-list').addEventListener('mousedown', (e) => e.preventDefault());   // keep focus in the box
$('car-list').addEventListener('click', (e) => {
  const li = e.target.closest('.combo-opt');
  if (li) chooseCar(combo.shown[Number(li.dataset.i)].id);
});
$('car-toggle').addEventListener('mousedown', (e) => e.preventDefault());
$('car-toggle').addEventListener('click', () => {
  if ($('car-list').hidden) { $('f-car').focus(); openList(null); } else closeList();
});

function restoreLast() {
  const driver = store.get('alsp.driver');
  const car = store.get('alsp.car');
  if (driver) $('f-driver').value = driver;
  if (car && carById(car)) chooseCar(car, { silent: true });
}

// ------------------------------------------------------------ Turnstile

function loadTurnstile() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const sitekey = local ? TEST_SITE_KEY : state.stage.turnstile_site_key;
  if (!sitekey) { $('ts-field').hidden = true; return; }
  window.onTurnstileLoad = () => {
    state.widgetId = window.turnstile.render('#turnstile', {
      sitekey,
      theme: 'light',
      callback: (t) => { state.token = t; setError('turnstile', ''); },
      'expired-callback': () => { state.token = ''; },
      'error-callback': () => {
        state.token = '';
        setError('turnstile', 'The bot check couldn’t load. Reload the page, or try without a VPN or strict privacy add-on.');
      },
    });
  };
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad';
  s.async = true;
  s.defer = true;
  s.onerror = () => setError('turnstile', 'The bot check couldn’t load. Reload the page, or try without a VPN or strict privacy add-on.');
  document.head.appendChild(s);
}

function resetTurnstile() {
  state.token = '';
  if (window.turnstile && state.widgetId !== null) window.turnstile.reset(state.widgetId);
}

// ------------------------------------------------------------ checking

function readForm() {
  return {
    driver: $('f-driver').value,
    car_id: state.carId,
    cp1: $('f-cp1').value,
    cp2: $('f-cp2').value,
    finish: $('f-finish').value,
    consent: $('f-consent').checked,
  };
}

function setError(field, message) {
  const el = $(`e-${field}`);
  if (el) el.textContent = message || '';
  const input = { driver: 'f-driver', car: 'f-car', cp1: 'f-cp1', cp2: 'f-cp2', finish: 'f-finish', consent: 'f-consent', shot: 'f-shot' }[field];
  if (input) $(input).setAttribute('aria-invalid', message ? 'true' : 'false');
}

function updateReadback(field) {
  const v = $(`f-${field}`).value;
  const p = parseTime(v);
  $(`r-${field}`).textContent = v.trim() && p.ok ? `= ${formatReadback(p.ms)}` : '';
}

/** Show errors only for fields the driver has already left (or all, on submit). */
function check(showAll = false) {
  const { errors } = validateSubmission(readForm(), { stage: state.stage, cars: state.cars, existing: state.existing });
  const byField = new Map();
  for (const e of errors) if (!byField.has(e.field)) byField.set(e.field, e.message);
  for (const f of FIELDS) {
    const show = showAll || state.touched.has(f);
    setError(f, show ? byField.get(f) || '' : '');
  }
  return errors;
}

for (const f of ['cp1', 'cp2', 'finish']) {
  $(`f-${f}`).addEventListener('input', () => { updateReadback(f); if (state.touched.has(f)) check(); });
  $(`f-${f}`).addEventListener('blur', () => { state.touched.add(f); check(); });
}
$('f-driver').addEventListener('blur', () => { state.touched.add('driver'); check(); });
$('f-driver').addEventListener('input', () => { if (state.touched.has('driver')) check(); });
$('f-consent').addEventListener('change', () => { state.touched.add('consent'); check(); });

// ------------------------------------------------------------ screenshot

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function loadImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file); } catch { /* fall back below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Resize to at most 1920 px wide and re-encode (WebP, or JPEG where WebP can't be made) under 600 KB. */
async function prepareImage(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG, JPG or WebP image.');
  if (file.size > 30 * 1024 * 1024) throw new Error('That image is over 30 MB. Use a normal screenshot.');
  const src = await loadImage(file);
  for (const maxWidth of [1920, 1280]) {
    const scale = Math.min(1, maxWidth / src.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(src.width * scale);
    canvas.height = Math.round(src.height * scale);
    canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
    for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
      let blob = await canvasBlob(canvas, 'image/webp', q);
      let type = 'webp';
      if (!blob || blob.type !== 'image/webp') { blob = await canvasBlob(canvas, 'image/jpeg', q); type = 'jpeg'; }
      if (blob && blob.size <= MAX_IMAGE_BYTES) {
        return { type, data: await blobToBase64(blob), bytes: blob.size, width: canvas.width, height: canvas.height, url: URL.createObjectURL(blob) };
      }
    }
  }
  throw new Error('That image is too large even after resizing. Crop it to the results and try again.');
}

$('f-shot').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  clearImage(false);
  if (!file) return;
  $('shot-info').textContent = 'Preparing…';
  $('shot-preview').hidden = false;
  try {
    state.image = await prepareImage(file);
    $('shot-img').src = state.image.url;
    $('shot-info').textContent = `${state.image.width}×${state.image.height}, ${Math.round(state.image.bytes / 1024)} KB`;
    setError('shot', '');
  } catch (err) {
    clearImage(true);
    setError('shot', err.message || 'Couldn’t read that image. Try a PNG or JPG.');
  }
});

function clearImage(resetInput = true) {
  if (state.image?.url) URL.revokeObjectURL(state.image.url);
  state.image = null;
  $('shot-preview').hidden = true;
  $('shot-img').removeAttribute('src');
  if (resetInput) $('f-shot').value = '';
}
$('shot-remove').addEventListener('click', () => { clearImage(true); setError('shot', ''); });

// ------------------------------------------------------------ sending

$('submit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.sending) return;
  FIELDS.forEach((f) => state.touched.add(f));
  const errors = check(true);
  if (!state.testMode && !state.token && !$('ts-field').hidden) {
    errors.push({ field: 'turnstile', message: 'Wait for the bot check to finish, then submit again.' });
    setError('turnstile', 'Wait for the bot check to finish, then submit again.');
  }
  if (errors.length) {
    $('form-status').textContent = errors.length === 1 ? 'Fix the highlighted field.' : `Fix the ${errors.length} highlighted fields.`;
    const first = { driver: 'f-driver', car: 'f-car', cp1: 'f-cp1', cp2: 'f-cp2', finish: 'f-finish', consent: 'f-consent' }[errors[0].field];
    if (first) $(first).focus();
    return;
  }

  const form = readForm();
  const { value } = validateSubmission(form, { stage: state.stage, cars: state.cars, existing: state.existing });
  store.set('alsp.driver', value.driver);
  store.set('alsp.car', value.car_id);

  if (state.testMode) {
    showResult(value, null);
    return;
  }

  state.sending = true;
  $('send').disabled = true;
  $('form-status').textContent = 'Sending…';
  try {
    const res = await fetch(`${workerBase()}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...form,
        website: $('f-website').value,
        turnstile: state.token,
        screenshot: state.image ? { type: state.image.type, data: state.image.data } : null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) {
      $('form-status').textContent = 'Saved. Taking you to the board…';
      location.href = `../?highlight=${encodeURIComponent(body.id)}`;
      return;
    }
    if (Array.isArray(body.errors) && body.errors.length) {
      for (const err of body.errors) setError(err.field, err.message);
      $('form-status').textContent = body.errors[0].message;
    } else {
      $('form-status').textContent = body.message || `Something went wrong (error ${res.status}). Try again in a minute.`;
    }
  } catch {
    $('form-status').textContent = 'Couldn’t reach the server. Check your connection and try again.';
  } finally {
    state.sending = false;
    $('send').disabled = !state.open;
    resetTurnstile();
  }
});

function showResult(value) {
  const r = $('result');
  r.innerHTML = `
    <h2>Test mode: your time checks out</h2>
    <p>This is what would go on the board. Nothing was saved, because submissions aren’t open yet.</p>
    <table class="howto-table">
      <tr><td>Driver</td><td>${esc(value.driver)}</td></tr>
      <tr><td>Car</td><td>${esc(value.car_name)}</td></tr>
      <tr><td>Checkpoint 1</td><td>${formatTime(value.cp1_ms)}</td></tr>
      <tr><td>Checkpoint 2</td><td>${formatTime(value.cp2_ms)}</td></tr>
      <tr><td>Finish</td><td><strong>${formatTime(value.finish_ms)}</strong></td></tr>
      <tr><td>Screenshot</td><td>${state.image ? `${state.image.width}×${state.image.height}, ${Math.round(state.image.bytes / 1024)} KB ${state.image.type.toUpperCase()}` : 'none'}</td></tr>
    </table>
    <p><button type="button" class="btn-plain" id="again">Try another</button></p>`;
  r.hidden = false;
  $('form-status').textContent = '';
  r.focus();
  $('again').addEventListener('click', () => { r.hidden = true; $('f-cp1').focus(); });
}

init();
