// Telemetry viewer: reads MoTeC .ld logs in the browser and draws them. Nothing is uploaded or stored.
import { parseLd, readChannel } from '../../shared/ld.js';

const $ = (id) => document.getElementById(id);
const MAX_RUNS = 6;
const COL = { a: '#1F3B2D', b: '#C8641E', grid: '#E3E6DD', axis: '#5F5E5A', cursor: '#A9521A', text: '#1C1C1A' };
const EXTRA = ['#24506E', '#6B3FA0', '#2E6B45', '#B3261E', '#7A5A00', '#007A78'];

const state = { runs: [], a: -1, b: -1, mode: 'd', view: null, cursor: null, extra: [] };

// ------------------------------------------------------------------ units and names

/** Conversion for one channel: { k, add, unit, title }. Dash and RBR give raw SI units; show friendlier ones. */
function conv(name, ch) {
  const unit = ch?.unit || '';
  const title = name.replace(/([a-z])([A-Z])/g, '$1 $2');
  const intLike = ch && ch.type !== 7;
  if (/^(throttle|brake|clutch)$/.test(name)) return { k: 100, add: 0, unit: '%', title };
  if (name === 'steering') return { k: 100, add: 0, unit: '%', title: 'Steering (left −, right +)' };
  if (unit === 'K') return { k: intLike && ch.size === 4 ? 1e-6 : 1, add: -273.15, unit: '°C', title };
  if (unit === '%' && intLike && ch.size === 4) return { k: 1e-6, add: 0, unit: '%', title };
  if (unit === 'Pa') return { k: 0.001, add: 0, unit: 'kPa', title };
  if (unit === 'm' && /deflection/i.test(name)) return { k: 1000, add: 0, unit: 'mm', title };
  return { k: 1, add: 0, unit, title };
}

function fmt(v, digits) {
  if (!Number.isFinite(v)) return '–';
  if (digits != null) return v.toFixed(digits);
  const a = Math.abs(v);
  return a >= 1000 ? v.toFixed(0) : a >= 100 ? v.toFixed(1) : v.toFixed(2);
}
const fmtTime = (s) => {
  if (!Number.isFinite(s)) return '–';
  const sign = s < 0 ? '−' : '';
  s = Math.abs(s);
  const m = Math.floor(s / 60);
  return `${sign}${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
};

function runLabel(fileName) {
  const m = /Car_\d+-(.+?)-Stage_(\d+)-.*?[._]run(\d+)/i.exec(fileName);
  if (!m) return fileName.replace(/\.ld$/i, '');
  return `${m[1].replace(/_+/g, ' ').trim()} · run ${m[3]}`;
}

// ------------------------------------------------------------------ runs

class Run {
  constructor(file, buf, parsed) {
    this.file = file;
    this.buf = buf;
    this.info = parsed.info;
    this.channels = parsed.channels;
    this.byName = new Map(parsed.channels.map((c) => [c.name, c]));
    this.cache = new Map();
    this.label = runLabel(file);
    const ref = this.byName.get('travelDistance') || this.byName.get('speed') || parsed.channels[0];
    this.N = ref.n;
    this.freq = ref.freq;
    const dist = this.raw('travelDistance');
    this.hasDist = !!dist;
    this.dist = monotone(dist || new Float32Array(this.N));
    const rt = this.raw('raceTime');
    this.time = rt ? monotone(rt) : Float32Array.from({ length: this.N }, (_, i) => i / this.freq);
    this._map = null;
  }

  raw(name) {
    const key = `raw:${name}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const ch = this.byName.get(name);
    if (!ch) return null;
    let a = readChannel(this.buf, ch);
    if (a.length !== this.N) {
      const out = new Float32Array(this.N);
      for (let i = 0; i < this.N; i += 1) out[i] = a[Math.min(a.length - 1, Math.floor((i * a.length) / this.N))];
      a = out;
    }
    this.cache.set(key, a);
    return a;
  }

  /** Samples in friendly units. */
  series(name) {
    const key = `v:${name}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const a = this.raw(name);
    if (!a) return null;
    const c = conv(name, this.byName.get(name));
    let out = a;
    if (c.k !== 1 || c.add !== 0) { out = new Float32Array(a.length); for (let i = 0; i < a.length; i += 1) out[i] = a[i] * c.k + c.add; }
    this.cache.set(key, out);
    return out;
  }

  xs(mode) { return mode === 'd' && this.hasDist ? this.dist : this.time; }
}

function monotone(src) {
  const out = new Float32Array(src.length);
  let m = -Infinity;
  for (let i = 0; i < src.length; i += 1) { const v = src[i]; if (Number.isFinite(v) && v > m) m = v; out[i] = m === -Infinity ? 0 : m; }
  return out;
}

function lowerBound(xs, x) {
  let lo = 0; let hi = xs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

const runA = () => state.runs[state.a] || null;
const runB = () => (state.b >= 0 && state.b !== state.a ? state.runs[state.b] || null : null);

// ------------------------------------------------------------------ loading files

function say(text, bad) {
  const el = $('msg');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('bad', !!bad);
}

async function load(files) {
  const list = [...files];
  const notes = [];
  for (const f of list) {
    if (/\.ldx$/i.test(f.name)) { continue; }
    if (!/\.ld$/i.test(f.name)) { notes.push(`${f.name}: not a .ld file.`); continue; }
    if (state.runs.length >= MAX_RUNS) { notes.push(`Only ${MAX_RUNS} runs can be open at once. Remove one first.`); break; }
    say(`Reading ${f.name} (${(f.size / 1048576).toFixed(1)} MB)…`);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const buf = await f.arrayBuffer();
      const parsed = parseLd(buf);
      if (!parsed.ok) { notes.push(`${f.name}: ${parsed.error}`); continue; }
      const run = new Run(f.name, buf, parsed);
      state.runs.push(run);
      const idx = state.runs.length - 1;
      if (state.a < 0) state.a = idx; else if (state.b < 0) state.b = idx;
    } catch (e) {
      notes.push(`${f.name}: couldn’t be read (${e && e.message ? e.message : 'unknown error'}).`);
    }
  }
  say(notes.join(' '), notes.length > 0);
  if (state.runs.length) { $('workspace').hidden = false; resetView(); renderAll(); }
}

function removeRun(i) {
  state.runs.splice(i, 1);
  const fix = (v) => (v === i ? -1 : v > i ? v - 1 : v);
  state.a = fix(state.a); state.b = fix(state.b);
  if (state.a < 0 && state.runs.length) { state.a = state.b >= 0 ? state.b : 0; if (state.b === state.a) state.b = -1; }
  if (!state.runs.length) { $('workspace').hidden = true; state.a = state.b = -1; return; }
  state.extra = state.extra.filter((n) => runA()?.byName.has(n));
  resetView(); renderAll();
}

// ------------------------------------------------------------------ view

function extent() {
  const runs = [runA(), runB()].filter(Boolean);
  let lo = Infinity; let hi = -Infinity;
  for (const r of runs) { const x = r.xs(state.mode); lo = Math.min(lo, x[0]); hi = Math.max(hi, x[x.length - 1]); }
  if (!Number.isFinite(lo) || hi <= lo) { lo = 0; hi = 1; }
  return [lo, hi];
}
function resetView() { const [lo, hi] = extent(); state.view = { x0: lo, x1: hi }; state.cursor = null; }

function clampView(x0, x1) {
  const [lo, hi] = extent();
  const min = (hi - lo) / 400;
  let span = Math.max(min, Math.min(hi - lo, x1 - x0));
  x0 = Math.max(lo, Math.min(hi - span, x0));
  return { x0, x1: x0 + span };
}

// ------------------------------------------------------------------ lanes

function lanes() {
  const a = runA(); const b = runB();
  if (!a) return [];
  const out = [];
  const has = (n) => a.byName.has(n);
  if (has('speed')) out.push({ id: 'speed', title: 'Speed', unit: 'km/h', series: [{ ch: 'speed', color: COL.a, bColor: COL.b }], dual: true });
  if (has('throttle') || has('brake')) out.push({ id: 'pedals', title: 'Throttle and brake', unit: '%', fixed: [0, 100], series: [{ ch: 'throttle', color: '#2E6B45', name: 'Throttle' }, { ch: 'brake', color: '#B3261E', name: 'Brake' }] });
  if (has('steering')) out.push({ id: 'steer', title: 'Steering (left −, right +)', unit: '%', fixed: [-100, 100], series: [{ ch: 'steering', color: '#24506E' }] });
  if (has('engineRotation')) out.push({ id: 'rpm', title: 'Engine speed', unit: 'RPM', series: [{ ch: 'engineRotation', color: '#6B3FA0' }] });
  if (has('gear')) out.push({ id: 'gear', title: 'Gear', unit: '', series: [{ ch: 'gear', color: '#7A5A00' }], step: true });
  if (b && state.mode === 'd' && a.hasDist && b.hasDist) out.push({ id: 'delta', title: 'Time gap, B against A (above zero: B is slower)', unit: 's', delta: true, series: [] });
  state.extra.forEach((n, i) => {
    const c = conv(n, a.byName.get(n));
    out.push({ id: `x:${n}`, extra: n, title: n, unit: c.unit, series: [{ ch: n, color: EXTRA[i % EXTRA.length] }] });
  });
  return out;
}

// time gap by distance, computed on a 1 m grid
let deltaCache = null;
function deltaSeries(a, b) {
  if (deltaCache && deltaCache.a === a && deltaCache.b === b) return deltaCache;
  const end = Math.floor(Math.min(a.dist[a.N - 1], b.dist[b.N - 1]));
  const xs = new Float32Array(Math.max(0, end + 1)); const ys = new Float32Array(xs.length);
  const at = (r, d) => {
    const i = Math.max(1, Math.min(r.N - 1, lowerBound(r.dist, d)));
    const d0 = r.dist[i - 1]; const d1 = r.dist[i];
    const f = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
    return r.time[i - 1] + (r.time[i] - r.time[i - 1]) * Math.max(0, Math.min(1, f));
  };
  // time measured from the moment each car starts moving, so a longer wait at the start doesn't show up as a gap
  const t0 = (r) => { const i = lowerBound(r.dist, 1); return r.time[Math.max(0, i - 1)]; };
  const ta0 = t0(a); const tb0 = t0(b);
  for (let d = 0; d <= end; d += 1) { xs[d] = d; ys[d] = (at(b, d) - tb0) - (at(a, d) - ta0); }
  deltaCache = { a, b, xs, ys };
  return deltaCache;
}

// ------------------------------------------------------------------ the trace chart

const chart = $('chart');
const cx = chart.getContext('2d');
const L = 62; const R = 12; const LANE_H = 124; const AXIS_H = 28;
let chartW = 0; let chartH = 0; let dpr = 1;

function sizeCanvas(cv, w, h) {
  dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.width = `${w}px`; cv.style.height = `${h}px`;
}

function niceStep(span, count) {
  const raw = span / count; const mag = 10 ** Math.floor(Math.log10(raw)); const f = raw / mag;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
}

/** Min and max of a series for each pixel column across the visible window. */
function columns(xs, ys, x0, x1, W) {
  const mn = new Float32Array(W).fill(NaN); const mx = new Float32Array(W).fill(NaN);
  const span = x1 - x0;
  const lo = Math.max(0, lowerBound(xs, x0) - 1);
  const hi = Math.min(xs.length, lowerBound(xs, x1) + 2);
  for (let i = lo; i < hi; i += 1) {
    const v = ys[i]; if (!Number.isFinite(v)) continue;
    const c = Math.round(((xs[i] - x0) / span) * (W - 1));
    if (c < 0 || c >= W) continue;
    if (!(v >= mn[c])) mn[c] = v;
    if (!(v <= mx[c])) mx[c] = v;
  }
  return { mn, mx };
}

function drawChart() {
  const a = runA();
  const wrap = chart.parentElement;
  if (!a) return;
  const ls = lanes();
  chartW = Math.max(300, Math.floor(wrap.clientWidth));
  chartH = ls.length * LANE_H + AXIS_H;
  sizeCanvas(chart, chartW, chartH);
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.clearRect(0, 0, chartW, chartH);
  const W = chartW - L - R;
  const { x0, x1 } = state.view;
  const span = x1 - x0;
  const px = (x) => L + ((x - x0) / span) * W;
  const b = runB();
  cx.font = '12px "Segoe UI", system-ui, sans-serif';

  ls.forEach((lane, li) => {
    const top = li * LANE_H; const h = LANE_H - 18; const y0 = top + 20; // plot area y0..y0+h
    // collect data
    const data = [];
    if (lane.delta) {
      const d = deltaSeries(a, b);
      data.push({ color: COL.b, ...columns(d.xs, d.ys, x0, x1, W), dash: false });
    } else {
      for (const s of lane.series) {
        for (const [r, isB] of [[a, false], [b, true]]) {
          if (!r) continue;
          const ys = r.series(s.ch); if (!ys) continue;
          data.push({ color: isB ? (s.bColor || s.color) : s.color, dash: isB, s, run: r, isB, ...columns(r.xs(state.mode), ys, x0, x1, W) });
        }
      }
    }
    // y range
    let lo = Infinity; let hi = -Infinity;
    if (lane.fixed) [lo, hi] = lane.fixed;
    else {
      for (const d of data) for (let c = 0; c < W; c += 1) { if (d.mn[c] < lo) lo = d.mn[c]; if (d.mx[c] > hi) hi = d.mx[c]; }
      if (lane.delta) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
      if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
      const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    }
    const py = (v) => y0 + h - ((v - lo) / (hi - lo)) * h;
    // grid and labels
    cx.strokeStyle = COL.grid; cx.fillStyle = COL.axis; cx.lineWidth = 1; cx.textAlign = 'right'; cx.textBaseline = 'middle';
    const step = niceStep(hi - lo, 3);
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      const y = Math.round(py(v)) + 0.5;
      cx.beginPath(); cx.moveTo(L, y); cx.lineTo(L + W, y); cx.stroke();
      cx.fillText(Math.abs(v) < 1e-9 ? '0' : fmt(v, step < 1 ? 1 : 0), L - 6, y);
    }
    if (lane.delta) { cx.strokeStyle = '#8A8D83'; const y = Math.round(py(0)) + 0.5; cx.beginPath(); cx.moveTo(L, y); cx.lineTo(L + W, y); cx.stroke(); }
    cx.strokeStyle = '#C9CDC2'; cx.strokeRect(L + 0.5, y0 + 0.5, W - 1, h - 1);
    // traces
    cx.save(); cx.beginPath(); cx.rect(L, y0, W, h); cx.clip();
    cx.lineWidth = 1.6; cx.lineJoin = 'round';
    for (const d of data) {
      cx.strokeStyle = d.color; cx.setLineDash(d.dash ? [6, 4] : []);
      cx.beginPath();
      let prev = null; let started = false;
      for (let c = 0; c < W; c += 1) {
        if (Number.isNaN(d.mn[c])) continue;
        const ymin = py(d.mn[c]); const ymax = py(d.mx[c]);
        const first = prev !== null && Math.abs(prev - ymin) <= Math.abs(prev - ymax) ? [ymin, ymax] : [ymax, ymin];
        const x = L + c + 0.5;
        if (lane.step && started) cx.lineTo(x, prev);
        if (!started) { cx.moveTo(x, first[0]); started = true; } else cx.lineTo(x, first[0]);
        if (first[0] !== first[1]) cx.lineTo(x, first[1]);
        prev = first[1];
      }
      cx.stroke();
    }
    cx.restore(); cx.setLineDash([]);
    // title and cursor readout
    cx.textAlign = 'left'; cx.textBaseline = 'alphabetic'; cx.fillStyle = COL.text; cx.font = '600 12.5px "Segoe UI", system-ui, sans-serif';
    const head = lane.unit ? `${lane.title} (${lane.unit})` : lane.title;
    cx.fillText(head, L, top + 14);
    if (state.cursor != null) {
      let tx = L + cx.measureText(head).width + 16; cx.font = '12.5px "Segoe UI", system-ui, sans-serif';
      const parts = [];
      if (lane.delta) { const d = deltaSeries(a, b); const i = Math.min(d.xs.length - 1, Math.max(0, Math.round(state.cursor))); parts.push({ t: `${fmt(d.ys[i], 3)} s`, c: COL.b }); }
      else for (const s of lane.series) {
        for (const [r, isB] of [[a, false], [b, true]]) {
          if (!r) continue; const ys = r.series(s.ch); if (!ys) continue;
          const i = Math.min(r.N - 1, lowerBound(r.xs(state.mode), state.cursor));
          const tag = b ? (isB ? 'B ' : 'A ') : '';
          parts.push({ t: `${s.name ? `${s.name} ` : ''}${tag}${fmt(ys[i])}`, c: isB ? (s.bColor || s.color) : s.color });
        }
      }
      for (const p of parts) { cx.fillStyle = p.c; cx.fillText(p.t, tx, top + 14); tx += cx.measureText(p.t).width + 14; }
    }
    if (lane.extra) { cx.fillStyle = COL.axis; cx.textAlign = 'right'; cx.fillText('✕ remove', L + W, top + 14); lane.removeBox = { x: L + W - 70, y: top, w: 70, h: 18 }; }
  });

  // x axis
  const ay = ls.length * LANE_H;
  cx.fillStyle = COL.axis; cx.strokeStyle = COL.grid; cx.textBaseline = 'top'; cx.textAlign = 'center'; cx.font = '12px "Segoe UI", system-ui, sans-serif';
  const step = niceStep(span, Math.max(3, Math.floor(W / 90)));
  for (let v = Math.ceil(x0 / step) * step; v <= x1 + 1e-9; v += step) {
    const x = Math.round(px(v)) + 0.5;
    cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, ay); cx.stroke();
    cx.fillText(state.mode === 'd' ? `${fmt(v, step < 1 ? 1 : 0)} m` : `${fmt(v, step < 1 ? 1 : 0)} s`, x, ay + 6);
  }
  // cursor
  if (state.cursor != null && state.cursor >= x0 && state.cursor <= x1) {
    const x = Math.round(px(state.cursor)) + 0.5;
    cx.strokeStyle = COL.cursor; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, ay); cx.stroke();
  }
  chart._lanes = ls;
}

// chart interaction
const chartX = (ev) => { const r = chart.getBoundingClientRect(); return ev.clientX - r.left; };
const xAt = (cxpx) => state.view.x0 + ((cxpx - L) / (chartW - L - R)) * (state.view.x1 - state.view.x0);
let drag = null;
chart.addEventListener('pointerdown', (ev) => {
  const r = chart.getBoundingClientRect(); const y = ev.clientY - r.top; const x = ev.clientX - r.left;
  for (const l of chart._lanes || []) if (l.removeBox && x > l.removeBox.x && x < l.removeBox.x + l.removeBox.w && y > l.removeBox.y && y < l.removeBox.y + l.removeBox.h) { state.extra = state.extra.filter((n) => n !== l.extra); renderAll(); return; }
  chart.setPointerCapture(ev.pointerId);
  drag = { x: ev.clientX, view: { ...state.view }, moved: false };
});
chart.addEventListener('pointermove', (ev) => {
  if (drag) {
    const dx = ev.clientX - drag.x;
    if (Math.abs(dx) > 3) drag.moved = true;
    if (drag.moved) {
      const per = (drag.view.x1 - drag.view.x0) / (chartW - L - R);
      state.view = clampView(drag.view.x0 - dx * per, drag.view.x1 - dx * per);
    }
  }
  state.cursor = xAt(chartX(ev));
  frame();
});
chart.addEventListener('pointerup', () => { drag = null; });
chart.addEventListener('pointerleave', () => { if (!drag) { state.cursor = null; frame(); } });
chart.addEventListener('dblclick', () => { resetView(); frame(); });
chart.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const at = xAt(chartX(ev)); const f = Math.exp(ev.deltaY * 0.0015);
  const { x0, x1 } = state.view;
  state.view = clampView(at - (at - x0) * f, at + (x1 - at) * f);
  frame();
}, { passive: false });

// ------------------------------------------------------------------ the track map

const mapCv = $('map');
const mx2 = mapCv.getContext('2d');
let mapSize = 0;

function mapData(run) {
  if (run._map !== null) return run._map;
  const px = run.raw('position.x'); const py = run.raw('position.y'); const sp = run.series('speed');
  if (!px || !py) { run._map = false; return false; }
  const stride = Math.max(1, Math.round(run.N / 9000));
  const idx = []; for (let i = 0; i < run.N; i += stride) idx.push(i);
  let max = 1; if (sp) for (const v of sp) if (v > max) max = v;
  run._map = { idx: Int32Array.from(idx), px, py, sp, max };
  return run._map;
}

function drawMap() {
  const a = runA(); if (!a) return;
  const wrap = mapCv.parentElement;
  mapSize = Math.max(220, Math.floor(wrap.clientWidth));
  sizeCanvas(mapCv, mapSize, mapSize);
  mx2.setTransform(dpr, 0, 0, dpr, 0, 0); mx2.clearRect(0, 0, mapSize, mapSize);
  const ma = mapData(a); if (!ma) { mapCv.hidden = true; return; } mapCv.hidden = false;
  const b = runB(); const mb = b ? mapData(b) : null;
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const m of [ma, mb]) { if (!m) continue; for (const i of m.idx) { const x = m.px[i]; const y = m.py[i]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } }
  const pad = 14; const sc = Math.min((mapSize - 2 * pad) / Math.max(1, maxX - minX), (mapSize - 2 * pad) / Math.max(1, maxY - minY));
  const ox = (mapSize - (maxX - minX) * sc) / 2; const oy = (mapSize - (maxY - minY) * sc) / 2;
  const X = (v) => ox + (v - minX) * sc; const Y = (v) => mapSize - (oy + (v - minY) * sc);
  mapCv._proj = { X, Y, ma };
  mx2.lineCap = 'round'; mx2.lineJoin = 'round';
  if (mb) { mx2.strokeStyle = '#B9BDB2'; mx2.lineWidth = 2; mx2.beginPath(); mb.idx.forEach((i, k) => (k ? mx2.lineTo(X(mb.px[i]), Y(mb.py[i])) : mx2.moveTo(X(mb.px[i]), Y(mb.py[i])))); mx2.stroke(); }
  const xs = a.xs(state.mode); const { x0, x1 } = state.view;
  const BUCKETS = 20;
  for (const [pass, alpha] of [[0, 0.28], [1, 1]]) {
    const paths = Array.from({ length: BUCKETS }, () => new Path2D());
    for (let k = 1; k < ma.idx.length; k += 1) {
      const i = ma.idx[k]; const j = ma.idx[k - 1];
      const inside = xs[i] >= x0 && xs[i] <= x1;
      if (pass === 0 ? inside : !inside) continue;
      const t = ma.sp ? Math.min(BUCKETS - 1, Math.floor((ma.sp[i] / ma.max) * BUCKETS)) : 0;
      paths[t].moveTo(X(ma.px[j]), Y(ma.py[j])); paths[t].lineTo(X(ma.px[i]), Y(ma.py[i]));
    }
    mx2.globalAlpha = alpha; mx2.lineWidth = pass ? 3.4 : 3;
    paths.forEach((p, t) => { mx2.strokeStyle = `hsl(${Math.round(215 - 215 * ((t + 0.5) / BUCKETS))} 75% 45%)`; mx2.stroke(p); });
  }
  mx2.globalAlpha = 1;
  // start marker and cursor
  mx2.fillStyle = '#1C1C1A'; mx2.beginPath(); mx2.arc(X(ma.px[0]), Y(ma.py[0]), 4, 0, 6.3); mx2.fill();
  if (state.cursor != null) {
    for (const [r, m, col] of [[a, ma, COL.a], [b, mb, COL.b]]) {
      if (!r || !m) continue; const i = Math.min(r.N - 1, lowerBound(r.xs(state.mode), state.cursor));
      mx2.fillStyle = '#fff'; mx2.strokeStyle = col; mx2.lineWidth = 3; mx2.beginPath(); mx2.arc(X(m.px[i]), Y(m.py[i]), 6, 0, 6.3); mx2.fill(); mx2.stroke();
    }
  }
}

mapCv.addEventListener('pointermove', (ev) => {
  const p = mapCv._proj; if (!p) return;
  const r = mapCv.getBoundingClientRect(); const x = ev.clientX - r.left; const y = ev.clientY - r.top;
  let best = -1; let bd = Infinity;
  for (const i of p.ma.idx) { const dx = p.X(p.ma.px[i]) - x; const dy = p.Y(p.ma.py[i]) - y; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
  if (best >= 0 && bd < 40 * 40) { state.cursor = runA().xs(state.mode)[best]; frame(); }
});
mapCv.addEventListener('pointerleave', () => { state.cursor = null; frame(); });

// ------------------------------------------------------------------ run chips, stats, corner tables, channel list

function renderRuns() {
  const el = $('runs'); el.textContent = '';
  state.runs.forEach((r, i) => {
    const row = document.createElement('div'); row.className = 'run';
    const name = document.createElement('span'); name.className = 'run-name';
    const dur = r.time[r.N - 1];
    name.textContent = `${r.label} · ${fmtTime(dur)}`;
    name.title = r.file;
    row.append(name);
    for (const [key, text] of [['a', 'A'], ['b', 'B']]) {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = `pick pick-${key}`; btn.textContent = text;
      const on = state[key] === i; btn.setAttribute('aria-pressed', String(on)); btn.classList.toggle('on', on);
      btn.title = key === 'a' ? 'Use as run A (the main run)' : 'Use as run B (compared against A)';
      btn.addEventListener('click', () => {
        if (key === 'a') { if (state.b === i) state.b = state.a; state.a = i; } else state.b = state.b === i ? -1 : i;
        if (state.b === state.a) state.b = -1;
        deltaCache = null; resetView(); renderAll();
      });
      row.append(btn);
    }
    const x = document.createElement('button'); x.type = 'button'; x.className = 'rm'; x.textContent = '✕'; x.title = 'Close this run'; x.setAttribute('aria-label', `Close ${r.label}`);
    x.addEventListener('click', () => removeRun(i));
    row.append(x); el.append(row);
  });
}

function stats(run) {
  const sp = run.series('speed'); const th = run.series('throttle'); const br = run.series('brake'); const g = run.raw('gear'); const rpm = run.series('engineRotation');
  const dur = run.time[run.N - 1]; const dist = run.dist[run.N - 1];
  let top = 0; let full = 0; let brk = 0; let moving = 0; let shifts = 0; let rmax = 0;
  for (let i = 0; i < run.N; i += 1) {
    if (sp && sp[i] > top) top = sp[i];
    if (rpm && rpm[i] > rmax) rmax = rpm[i];
    if (sp && sp[i] > 5) { moving += 1; if (th && th[i] > 98) full += 1; if (br && br[i] > 5) brk += 1; }
    if (g && i && g[i] !== g[i - 1]) shifts += 1;
  }
  return {
    time: dur, dist, top, avg: dur > 0 ? (dist / dur) * 3.6 : NaN, rpm: rmax,
    full: moving ? (full / moving) * 100 : NaN, brake: moving ? (brk / moving) * 100 : NaN, shifts,
  };
}

function renderStats() {
  const a = runA(); const b = runB(); const el = $('stats'); el.textContent = '';
  if (!a) return;
  const sa = stats(a); const sb = b ? stats(b) : null;
  const rows = [
    ['Time', (s) => fmtTime(s.time), 'time', 's', 3],
    ['Distance', (s) => `${fmt(s.dist, 0)} m`, 'dist', 'm', 0],
    ['Top speed', (s) => `${fmt(s.top, 1)} km/h`, 'top', 'km/h', 1],
    ['Average speed', (s) => `${fmt(s.avg, 1)} km/h`, 'avg', 'km/h', 1],
    ['Highest RPM', (s) => fmt(s.rpm, 0), 'rpm', '', 0],
    ['Full throttle', (s) => `${fmt(s.full, 0)}%`, 'full', 'pts', 0],
    ['Braking', (s) => `${fmt(s.brake, 0)}%`, 'brake', 'pts', 0],
    ['Gear changes', (s) => String(s.shifts), 'shifts', '', 0],
  ];
  const t = document.createElement('table'); t.className = 'values';
  const head = document.createElement('tr');
  head.innerHTML = `<th></th><th>${b ? 'A' : 'This run'}</th>${b ? '<th>B</th><th>B − A</th>' : ''}`;
  const thead = document.createElement('thead'); thead.append(head); t.append(thead);
  const tb = document.createElement('tbody');
  for (const [label, f, key, unit, d] of rows) {
    const tr = document.createElement('tr');
    let diff = '';
    if (sb && Number.isFinite(sa[key]) && Number.isFinite(sb[key])) { const v = sb[key] - sa[key]; diff = `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}${unit ? ` ${unit}` : ''}`; }
    tr.innerHTML = `<th scope="row">${label}</th><td>${f(sa)}</td>${sb ? `<td>${f(sb)}</td><td>${diff}</td>` : ''}`;
    tb.append(tr);
  }
  t.append(tb); el.append(t);
  const note = document.createElement('p'); note.className = 'hint-line';
  note.textContent = `${a.info.driver ? `Driver in the log: ${a.info.driver}. ` : ''}${a.channels.length} channels at ${a.freq} samples per second.`;
  el.append(note);
}

function minMaxAvg(arr) { let mn = Infinity; let mx = -Infinity; let s = 0; for (const v of arr) { if (v < mn) mn = v; if (v > mx) mx = v; s += v; } return { mn, mx, avg: s / arr.length }; }

function renderCorners() {
  const el = $('corners'); el.textContent = '';
  const a = runA(); if (!a) return;
  const build = (run, tag) => {
    const t = document.createElement('table'); t.className = 'values';
    t.innerHTML = '<thead><tr><th>Corner</th><th>Tread °C avg</th><th>Tread °C max</th><th>Pressure kPa avg</th><th>Suspension travel mm</th><th>Brake disc °C max</th><th>Strut force kN max</th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const [c, name] of [['LF', 'Left front'], ['RF', 'Right front'], ['LB', 'Left rear'], ['RB', 'Right rear']]) {
      const get = (n) => { const s = run.series(`${c}.${n}`); return s && s.length ? minMaxAvg(s) : null; };
      const tread = get('treadTemperature'); const pr = get('pressure'); const defl = get('deflection'); const disc = get('brakeDiskTemp'); const strut = get('strutForce');
      const tr = document.createElement('tr');
      tr.innerHTML = `<th scope="row">${name}</th><td>${tread ? fmt(tread.avg, 1) : '–'}</td><td>${tread ? fmt(tread.mx, 1) : '–'}</td><td>${pr ? fmt(pr.avg, 0) : '–'}</td><td>${defl ? `${fmt(defl.mn, 0)} to ${fmt(defl.mx, 0)}` : '–'}</td><td>${disc ? fmt(disc.mx, 0) : '–'}</td><td>${strut ? fmt(strut.mx / 1000, 1) : '–'}</td>`;
      tb.append(tr);
    }
    t.append(tb);
    if (tag) { const h = document.createElement('p'); h.className = 'tag-line'; h.textContent = tag; el.append(h); }
    el.append(t);
  };
  build(a, runB() ? 'Run A' : '');
  if (runB()) build(runB(), 'Run B');
}

function renderChannels() {
  const a = runA(); const list = $('chan-list'); list.textContent = '';
  if (!a) return;
  const q = $('chan-search').value.trim().toLowerCase();
  const hits = a.channels.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 80);
  for (const c of hits) {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'chan';
    const on = state.extra.includes(c.name); btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on));
    const cv = conv(c.name, c);
    btn.textContent = `${c.name}${cv.unit ? ` (${cv.unit})` : ''}`;
    btn.addEventListener('click', () => {
      state.extra = on ? state.extra.filter((n) => n !== c.name) : [...state.extra, c.name].slice(-8);
      renderAll();
    });
    list.append(btn);
  }
  if (!hits.length) list.textContent = 'No channel has that name.';
}

function renderLegend() {
  const a = runA(); const m = a && mapData(a);
  $('legend').innerHTML = `<span class="ramp"></span><span>slow</span><span class="grow"></span><span>${m ? fmt(m.max, 0) : ''} km/h</span>${runB() ? '<span class="key"><i class="solid"></i>A</span><span class="key"><i class="dash"></i>B</span>' : ''}`;
}

// ------------------------------------------------------------------ drawing loop and wiring

let queued = false;
function frame() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; drawChart(); drawMap(); }); }

function renderAll() {
  renderRuns(); renderStats(); renderCorners(); renderChannels(); renderLegend();
  $('ax-d').disabled = !(runA() && runA().hasDist);
  frame();
}

$('ax-d').addEventListener('click', () => setMode('d'));
$('ax-t').addEventListener('click', () => setMode('t'));
function setMode(m) {
  state.mode = m;
  $('ax-d').classList.toggle('on', m === 'd'); $('ax-d').setAttribute('aria-pressed', String(m === 'd'));
  $('ax-t').classList.toggle('on', m === 't'); $('ax-t').setAttribute('aria-pressed', String(m === 't'));
  resetView(); frame();
}
$('reset').addEventListener('click', () => { resetView(); frame(); });
$('chan-search').addEventListener('input', renderChannels);

const drop = $('drop'); const input = $('file');
drop.addEventListener('click', () => input.click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
input.addEventListener('change', () => { load(input.files).then(() => { input.value = ''; }); });
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
drop.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) load(e.dataTransfer.files); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { if (!drop.contains(e.target)) { e.preventDefault(); if (e.dataTransfer?.files?.length) load(e.dataTransfer.files); } });
new ResizeObserver(() => { if (runA()) frame(); }).observe(document.querySelector('.grid'));

// for tests and debugging
window.__tele = { state, load };
