// Draws the vehicle tune pages at build time: the library (/tunes/) and one page per tune (/tunes/<id>/).
// Pure functions that return HTML text, so the build and the tests can both use them.
// Every value on a page comes from a tune that parseTune() has already checked (identifiers and numbers only);
// names and text are still escaped.

import { zonedStamp, formatTime } from '../shared/rules.js';
import { checkTune } from '../shared/tune.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- number formatting

const n = (v, d = 3) => String(Number(Number(v).toFixed(d)));
const pct = (v) => `${n(v * 100, 1)}%`;
const kn = (v) => `${n(v / 1000, 1)} kN/m`;
const mm = (v) => `${n(v * 1000, 1)} mm`;
const kpa = (v) => `${n(v / 1000, 0)} kPa`;
const psi = (v) => `${n(v / 6894.757, 1)} psi`;
const deg = (v) => `${n((v * 180) / Math.PI, 2)}°`;
const onoff = (v) => (v ? 'On' : 'Off');
const raw = (v) => (Array.isArray(v) ? v.map((x) => n(x, 6)).join(', ') : n(v, 6));
const nm = (v) => `${n(v, 0)} Nm`;

const CORNERS = [['LF', 'Front left'], ['RF', 'Front right'], ['LB', 'Rear left'], ['RB', 'Rear right']];

// ---------------------------------------------------------------- small building blocks

function table(headers, rows, cls = 'values') {
  const head = headers.map((h) => `<th scope="col">${h}</th>`).join('');
  const body = rows.map((r) => `<tr><th scope="row">${r[0]}</th>${r.slice(1).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<div class="table-scroll"><table class="${cls}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>\n`;
}

function card(id, title, inner, guide) {
  const link = guide ? ` <a class="what" href="${guide}" title="What this does">What does this do?</a>` : '';
  return `<article class="param" id="${id}"><h3>${esc(title)}${link}</h3>\n${inner}</article>\n`;
}

const labelOf = (text, key, guideHref) =>
  `${guideHref ? `<a href="${guideHref}">${esc(text)}</a>` : esc(text)}<span class="key">${esc(key)}</span>`;

function callout(kind, html) {
  const label = { advice: 'Advice', note: 'Note', important: 'Important' }[kind];
  return `<p class="callout ${kind}"><b>${label}</b> ${html}</p>\n`;
}

/** A small line chart. ys are 0..yMax; xs are optional x positions (even spacing when missing). */
function chart({ title, ys, xs, yMax = 1, yFmt = pct, xFmt = (v) => n(v, 0), color }) {
  if (!ys || ys.length < 2) return '';
  const W = 200; const H = 104; const L = 36; const R = 8; const T = 8; const B = 24;
  const pw = W - L - R; const ph = H - T - B;
  const x = xs || ys.map((_, i) => i);
  const x0 = Math.min(...x); const x1 = Math.max(...x);
  const px = (v) => L + ((v - x0) / (x1 - x0 || 1)) * pw;
  const py = (v) => T + ph - (Math.min(Math.max(v, 0), yMax) / yMax) * ph;
  const pts = ys.map((y, i) => `${n(px(x[i]), 1)},${n(py(y), 1)}`);
  const dots = ys.map((y, i) => `<circle cx="${n(px(x[i]), 1)}" cy="${n(py(y), 1)}" r="2.4" fill="${color}"/>`).join('');
  const label = `${title}: ${yFmt(ys[0])} to ${yFmt(ys[ys.length - 1])}`;
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`
    + `<rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="#fff" stroke="#D9DDD3"/>`
    + `<line x1="${L}" x2="${L + pw}" y1="${T + ph / 2}" y2="${T + ph / 2}" stroke="#E6E9E1"/>`
    + `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${dots}`
    + `<text x="${L - 4}" y="${T + 4}" text-anchor="end" font-size="9" fill="#5F5E5A">${esc(yFmt(yMax))}</text>`
    + `<text x="${L - 4}" y="${T + ph + 3}" text-anchor="end" font-size="9" fill="#5F5E5A">${esc(yFmt(0))}</text>`
    + `<text x="${L}" y="${H - 8}" font-size="9" fill="#5F5E5A">${esc(xFmt(x0))}</text>`
    + `<text x="${L + pw}" y="${H - 8}" text-anchor="end" font-size="9" fill="#5F5E5A">${esc(xFmt(x1))}</text>`
    + `</svg><figcaption>${esc(title)}</figcaption></figure>`;
}

// ---------------------------------------------------------------- the sections

/**
 * Turns a parsed tune into display sections: [{ id, title, html }].
 * The groups follow the setup guide. Anything not placed in a group lands in "Other settings",
 * so every value in the file is shown somewhere.
 */
export function buildSections(tune, guide = '../../guide/') {
  const used = new Set();
  const get = (sec, key) => {
    const v = tune.sections[sec]?.[key];
    if (v !== undefined) used.add(`${sec}.${key}`);
    return v;
  };
  const g = (id) => `${guide}#${id}`;
  const out = [];

  /** Rows of one value per corner. defs: [{ label, key, fmt, guide }] */
  function cornerTable(prefix, defs) {
    const mismatches = [];
    const rows = [];
    for (const d of defs) {
      const vals = CORNERS.map(([c]) => get(`${prefix}${c}`, d.key));
      if (vals.every((v) => v === undefined)) continue;
      const same = (a, b) => a === undefined || b === undefined || JSON.stringify(a) === JSON.stringify(b);
      const unequal = !same(vals[0], vals[1]) || !same(vals[2], vals[3]);
      if (unequal) mismatches.push(d.label);
      const cells = vals.map((v) => (v === undefined ? '—' : d.fmt(v)));
      rows.push([labelOf(d.label, d.key, d.guide), ...cells.map((c) => (unequal ? `<span class="differs">${c}</span>` : c))]);
    }
    if (!rows.length) return { html: '', mismatches };
    return { html: table(['Setting', ...CORNERS.map((c) => c[1])], rows), mismatches };
  }
  const mismatchNote = (list) => (list.length
    ? callout('note', `Left and right differ for ${list.map(esc).join(', ')}. The guide recommends making the same suspension change on both sides of the car.`)
    : '');

  // ---- Differentials
  {
    let html = '';
    const torque = [
      ['Centre differential, maximum torque', 'CenterDiffMaxTorque'],
      ['Front differential, maximum torque', 'FrontDiffMaxTorque'],
      ['Rear differential, maximum torque', 'RearDiffMaxTorque'],
    ].map(([label, key]) => [label, key, get('Drive', key)]).filter((r) => r[2] !== undefined);
    if (torque.length) {
      html += card('t-torque', 'Differential torque', table(['Setting', 'Value'], torque.map(([l, k, v]) => [labelOf(l, k), nm(v)])), g('diff-torque'));
    }
    const hb = [
      ['Handbrake', 'HandbrakePercentage_NGP', 'Drive', pct, g('diff-handbrake')],
      ['Centre differential handbrake release', 'CenterDiffHandbrakeRelease', 'VehicleControlUnit', raw, g('diff-handbrake')],
      ['Left-foot brake threshold', 'LeftFootBrakeThreshold', 'VehicleControlUnit', raw, g('diff-centre-lfb')],
    ].map(([l, k, s, f, gh]) => [l, k, get(s, k), f, gh]).filter((r) => r[2] !== undefined);
    if (hb.length) {
      html += card('t-handbrake', 'Handbrake and left-foot brake', table(['Setting', 'Value'], hb.map(([l, k, v, f, gh]) => [labelOf(l, k, gh), f(v)])), g('diff-handbrake'));
    }
    const diffs = [
      ['t-centre', 'Centre differential map', 'CenterDiff', 'CenterSpeedMap', 'diff-centre'],
      ['t-centre-lfb', 'Centre map, left-foot brake', 'LFCenterDiff', 'LFCenterSpeedMap', 'diff-centre-lfb'],
      ['t-front', 'Front differential map', 'FrontDiff', 'FrontSpeedMap', 'diff-front'],
      ['t-rear', 'Rear differential map', 'RearDiff', 'RearSpeedMap', 'diff-rear'],
    ];
    for (const [id, title, p, sm, gid] of diffs) {
      const series = (prefix, kind) => {
        const arr = [];
        for (let i = 0; i < 11; i += 1) arr.push(get('VehicleControlUnit', `${prefix}${kind}_${String(i).padStart(2, '0')}`));
        return arr;
      };
      const thr = series(p, 'Throttle'); const brk = series(p, 'Brake');
      const vel = series(sm, 'Velocity'); const fac = series(sm, 'Factor');
      if ([thr, brk, vel, fac].every((a) => a.every((v) => v === undefined))) continue;
      const rows = [];
      for (let i = 0; i < 11; i += 1) {
        rows.push([`Point ${i}`, thr[i] === undefined ? '—' : pct(thr[i]), brk[i] === undefined ? '—' : pct(brk[i]),
          vel[i] === undefined ? '—' : `${n(vel[i] * 3.6, 1)} km/h`, fac[i] === undefined ? '—' : pct(fac[i])]);
      }
      const defined = (a) => a.filter((v) => v !== undefined);
      const pairs = [];
      for (let i = 0; i < 11; i += 1) if (vel[i] !== undefined && fac[i] !== undefined) pairs.push([vel[i] * 3.6, fac[i]]);
      const charts = `<div class="charts">`
        + chart({ title: 'Lock under throttle', ys: defined(thr), color: '#1F3B2D' })
        + chart({ title: 'Lock under braking', ys: defined(brk), color: '#A9521A' })
        + chart({ title: 'Speed factor', ys: pairs.map((q) => q[1]), xs: pairs.map((q) => q[0]), yMax: Math.max(1, ...pairs.map((q) => q[1])), xFmt: (v) => `${n(v, 0)} km/h`, color: '#2E6B45' })
        + `</div>\n`;
      const names = `<p class="keys">Settings: <code>${esc(p)}Throttle_00</code> to <code>_10</code>, <code>${esc(p)}Brake_00</code> to <code>_10</code>, <code>${esc(sm)}Velocity</code> and <code>${esc(sm)}Factor</code>.</p>\n`;
      html += card(id, title, charts + table(['Point', 'Throttle lock', 'Brake lock', 'Speed', 'Speed factor'], rows, 'values curve') + names, g(gid));
    }
    if (html) {
      out.push({ id: 'differentials', title: 'Differentials', html: html + callout('note', 'Points run from 0 (no input, or standstill) to 10 (full input, or top of the speed range).') });
    }
  }

  // ---- Suspension
  {
    const sd = cornerTable('SpringDamper', [
      { label: 'Spring length', key: 'SpringLength', fmt: mm, guide: g('spring-len') },
      { label: 'Spring stiffness', key: 'SpringStiffness', fmt: kn, guide: g('spring-stiff') },
      { label: 'Helper spring length', key: 'HelperSpringLength', fmt: mm },
      { label: 'Helper spring stiffness', key: 'HelperSpringStiffness', fmt: kn },
      { label: 'Helper spring minimum length', key: 'HelperSpringMinLength', fmt: mm },
      { label: 'Compression damping', key: 'DampingBump', fmt: raw, guide: g('damp-comp') },
      { label: 'Rebound damping', key: 'DampingRebound', fmt: raw, guide: g('damp-reb') },
      { label: 'Fast compression limit (m/s)', key: 'BumpHighSpeedBreak', fmt: raw, guide: g('damp-fastlim') },
      { label: 'Fast compression damping', key: 'DampingBumpHighSpeed', fmt: raw, guide: g('damp-fast') },
    ]);
    let html = '';
    if (sd.html) html += card('t-springs', 'Springs and dampers', sd.html + mismatchNote(sd.mismatches), g('susp-note'));
    const extras = [
      ['Fast rebound limit (m/s)', 'HighSpeedBreakRebound', raw],
      ['Fast rebound damping', 'HighSpeedDampingRebound', raw],
      ['Bump stop stiffness', 'BumpStopStiffness', raw],
      ['Bump stop damping, compression', 'BumpStopDampingBump', raw],
      ['Bump stop damping, rebound', 'BumpStopDampingRebound', raw],
    ];
    const rows = [];
    for (const [label, base, f] of extras) {
      const fr = get('Drive', `${base}Front_NGP`); const rr = get('Drive', `${base}Rear_NGP`);
      if (fr === undefined && rr === undefined) continue;
      rows.push([labelOf(label, `${base}Front_NGP / Rear_NGP`), fr === undefined ? '—' : f(fr), rr === undefined ? '—' : f(rr)]);
    }
    if (rows.length) html += card('t-ngp-dampers', 'Fast rebound and bump stops (NGP)', table(['Setting', 'Front', 'Rear'], rows));
    if (html) out.push({ id: 'suspension', title: 'Suspension', html });
  }

  // ---- Geometry
  {
    const geo = cornerTable('Wheel', [
      { label: 'Top mount position (x, y, z)', key: 'vecTopMountPosition', fmt: raw, guide: g('geo-top') },
      { label: 'Top mount slot', key: 'TopMountSlot', fmt: raw, guide: g('geo-top') },
      { label: 'Track rod length', key: 'SteeringRodLength', fmt: mm, guide: g('geo-rod') },
      { label: 'Ride height (strut platform height)', key: 'StrutPlatformHeight', fmt: mm, guide: g('geo-height') },
      { label: 'Camber (wheel axis inclination)', key: 'WheelAxisInclination', fmt: deg, guide: g('geo-camber') },
    ]);
    if (geo.html) out.push({ id: 'geometry', title: 'Geometry', html: card('t-geometry', 'Wheel geometry', geo.html + mismatchNote(geo.mismatches), g('geo-intro')) });
  }

  // ---- Anti-roll bars and steering
  {
    const rows = [
      ['Maximum steering lock', 'MaxSteeringLock', 'steer-lock'],
      ['Front anti-roll bar stiffness', 'FrontRollBarStiffness', 'arb-front'],
      ['Rear anti-roll bar stiffness', 'RearRollBarStiffness', 'arb-rear'],
    ].map(([l, k, gid]) => [l, k, get('Car', k), gid]).filter((r) => r[2] !== undefined);
    if (rows.length) {
      out.push({ id: 'arb', title: 'Anti-roll bars and steering', html: card('t-arb', 'Anti-roll bars and steering', table(['Setting', 'Value'], rows.map(([l, k, v, gid]) => [labelOf(l, k, g(gid)), raw(v)])), g('arb-intro')) });
    }
  }

  // ---- Tyres
  {
    const t = cornerTable('Tyre', [{ label: 'Pressure (cold)', key: 'Pressure', fmt: (v) => `${kpa(v)} · ${psi(v)}`, guide: g('tyre-pressure') }]);
    if (t.html) out.push({ id: 'tyres', title: 'Tyres', html: card('t-tyres', 'Tyre pressure', t.html, g('tyre-pressure')) });
  }

  // ---- Brakes
  {
    const rows = [['Maximum brake pressure, front', 'MaxBrakePressureFront'], ['Maximum brake pressure, rear', 'MaxBrakePressureRear']]
      .map(([l, k]) => [l, k, get('Drive', k)]).filter((r) => r[2] !== undefined);
    if (rows.length) {
      out.push({ id: 'brakes', title: 'Brakes', html: card('t-brakes', 'Brake pressure', table(['Setting', 'Value'], rows.map(([l, k, v]) => [labelOf(l, k, g('brake-max')), kpa(v)])), g('brake-max')) });
    }
  }

  // ---- Gearbox
  {
    let html = '';
    const ids = [];
    for (let i = 0; i < 10; i += 1) {
      const v = get('Drive', `GearId${i}`);
      if (v !== undefined) ids.push([`Gear ${i + 1}`, `GearId${i}`, v]);
    }
    const fd = get('Drive', 'FinalDriveId'); const dg = get('Drive', 'DropGearId');
    if (fd !== undefined) ids.push(['Final drive', 'FinalDriveId', fd]);
    if (dg !== undefined) ids.push(['Drop gear', 'DropGearId', dg]);
    if (ids.length) {
      html += card('t-gears', 'Gear ratios', table(['Setting', 'Ratio ID'], ids.map(([l, k, v]) => [labelOf(l, k, g('gb-ratio')), raw(v)]))
        + `<p class="keys">Ratio IDs point into the car’s own gear-ratio table, so the same number gives different ratios in different cars.</p>\n`, g('gb-ratio'));
    }
    const aids = [['Gear protector', 'GearGuard', g('gb-protect')], ['Automatic gears', 'AutoGears'], ['Neutral lock', 'NeutralLock'], ['Clutch help', 'ClutchHelp']]
      .map(([l, k, gh]) => [l, k, get('VehicleControlUnit', k), gh]).filter((r) => r[2] !== undefined);
    if (aids.length) html += card('t-aids', 'Gearbox aids', table(['Setting', 'Value'], aids.map(([l, k, v, gh]) => [labelOf(l, k, gh), onoff(v)])), g('gb-protect'));
    if (html) out.push({ id: 'gearbox', title: 'Gearbox', html });
  }

  // ---- Everything else
  {
    const rows = [];
    for (const name of tune.order) {
      for (const [key, v] of Object.entries(tune.sections[name])) {
        if (!used.has(`${name}.${key}`)) rows.push([`${esc(name)}`, `<code>${esc(key)}</code>`, raw(v)]);
      }
    }
    if (rows.length) {
      out.push({ id: 'other', title: 'Other settings', html: card('t-other', 'Other settings in the file', table(['Section', 'Setting', 'Value'], rows, 'values other')
        + `<p class="keys">Settings this page doesn’t group are listed here as stored, so nothing in the file is hidden.</p>\n`) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- page shell

const CLOCK = `<div class="rally-clock" id="rally-clock" role="img" aria-label="Rally time, Marquette, Michigan (Eastern)" data-sync="device">
        <span class="clock-lcd" aria-hidden="true"><span class="clock-ghost">88:88:88</span><span class="clock-digits">--:--:--</span></span>
        <span class="clock-status" aria-hidden="true">ET &middot; MARQUETTE</span>
      </div>`;

function shell({ title, description, up, css = [], body, scripts = [] }) {
  const base = up;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="icon" href="${base}assets/img/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${base}assets/css/style.css">
${css.map((c) => `  <link rel="stylesheet" href="${base}assets/css/${c}">`).join('\n')}
</head>
<body>
  <header class="titlebar">
    <div class="wrap titlebar-inner">
      <a class="titlebar-name titlebar-link" href="${base}">Al's Playground stage times</a>
      <span class="titlebar-game">Richard Burns Rally</span>
      ${CLOCK}
    </div>
  </header>

  <main class="wrap">
${body}
  </main>
  <script type="module" src="${base}assets/js/clock.js"></script>
${scripts.map((s) => `  <script type="module" src="${base}assets/js/${s}"></script>`).join('\n')}
</body>
</html>
`;
}

const dateOf = (iso) => zonedStamp(iso).date;

// ---------------------------------------------------------------- the pages

/**
 * One tune page.
 * meta: { id, driver, car_name, group_tag, tune_name, file_name, uploaded_at, finish_ms (or null), run_published }
 */
export function renderTunePage(meta, tune, rawText) {
  const sections = buildSections(tune);
  const warnings = checkTune(tune);
  const toc = sections.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join('') + '<li><a href="#raw">Raw file</a></li>';
  const time = meta.run_published && meta.finish_ms
    ? `<a href="../../?highlight=${esc(meta.id)}">${esc(formatTime(meta.finish_ms))}</a>` : '';
  const facts = [
    `<span><b>Driver</b> ${esc(meta.driver)}</span>`,
    `<span><b>Car</b> ${esc(meta.car_name)}${meta.group_tag ? ` <span class="tag">${esc(meta.group_tag)}</span>` : ''}</span>`,
    time ? `<span><b>Stage time</b> ${time}</span>` : '',
    `<span><b>Uploaded</b> ${esc(dateOf(meta.uploaded_at))}</span>`,
  ].filter(Boolean).join('');
  const body = `    <section class="board guide tune-page" aria-labelledby="page-title">
      <div class="band"><h1 id="page-title">${esc(meta.tune_name)}</h1></div>
      <p class="tune-facts">${facts}</p>
      <div class="guide-actions">
        <a class="btn-submit" href="${esc(meta.file_name)}" download>Download .lsp</a>
        <a class="btn-plain" href="../">All vehicle tunes</a>
        <a class="btn-plain" href="../../guide/">Setup guide</a>
      </div>
      <div class="guide-layout">
        <nav class="guide-toc" aria-label="Tune sections"><p class="toc-title">On this page</p><ol>${toc}</ol></nav>
        <div class="guide-body">
          ${callout('note', `To use this tune, save <code>${esc(meta.file_name)}</code> in the car’s own folder: <code>&lt;Richard Burns Rally&gt;\\SavedGames\\&lt;Vehicle Name&gt;\\</code>. Then load it from the car setup screen in the game. Values are shown as stored in the file.`)}
          ${warnings.length ? callout('important', `${warnings.map(esc).join(' ')} See the <a href="../../guide/#diff-caveat">guide’s caveat</a>.`) : ''}
${sections.map((s) => `          <section class="gsec" id="${s.id}" aria-labelledby="${s.id}-h"><h2 id="${s.id}-h">${esc(s.title)}</h2>\n${s.html}          </section>\n`).join('')}          <section class="gsec" id="raw" aria-labelledby="raw-h"><h2 id="raw-h">Raw file</h2>
            <details class="raw"><summary>Show the original .lsp text</summary><pre>${esc(rawText)}</pre></details>
          </section>
        </div>
      </div>
    </section>

    <footer class="footer">
      <p><a href="../">All vehicle tunes</a> &middot; <a href="../../">Stage times</a> &middot; <a href="../../guide/">Car setup guide</a></p>
    </footer>`;
  return shell({
    title: `${meta.tune_name} · ${meta.car_name} tune · Al's Playground`,
    description: `${meta.driver}'s ${meta.car_name} setup for Al's Playground in Richard Burns Rally, broken down by differentials, suspension, geometry, anti-roll bars, tyres, brakes and gearbox.`,
    up: '../../', css: ['guide.css', 'tunes.css'], body,
  });
}

/** The library page. tunes: [{ id, driver, car_name, group, group_tag, tune_name, file_name, uploaded_at, finish_ms, run_published }] */
export function renderLibrary(tunes, groups) {
  const sorted = [...tunes].sort((a, b) => Date.parse(b.uploaded_at) - Date.parse(a.uploaded_at));
  const rows = sorted.map((t) => {
    const time = t.run_published && t.finish_ms ? `<a href="../?highlight=${esc(t.id)}">${esc(formatTime(t.finish_ms))}</a>` : '<span class="none">—</span>';
    const search = `${t.driver} ${t.car_name} ${t.tune_name}`.toLowerCase();
    return `<tr class="tune-row" data-search="${esc(search)}" data-group="${esc(t.group || '')}">`
      + `<td class="c-driver"><a href="${esc(t.id)}/">${esc(t.driver)}</a></td>`
      + `<td class="c-car">${esc(t.car_name)}${t.group_tag ? ` <span class="tag" title="${esc(t.group)}">${esc(t.group_tag)}</span>` : ''}</td>`
      + `<td class="c-tune"><a href="${esc(t.id)}/">${esc(t.tune_name)}</a></td>`
      + `<td class="c-time">${time}</td>`
      + `<td class="c-date">${esc(dateOf(t.uploaded_at))}</td>`
      + `<td class="c-act"><a href="${esc(t.id)}/">View</a> <a class="dl" href="${esc(t.id)}/${esc(t.file_name)}" download>Download</a></td></tr>`;
  }).join('\n');
  const options = groups.filter((g) => tunes.some((t) => t.group === g.name)).map((g) => `<option value="${esc(g.name)}">${esc(g.name)}</option>`).join('');
  const body = `    <section class="board tunes-board" aria-labelledby="page-title">
      <div class="band"><h1 id="page-title">Vehicle Tune Library</h1></div>
      <p class="stage-meta">Setups shared by drivers &middot; ${tunes.length} ${tunes.length === 1 ? 'tune' : 'tunes'}</p>
      <div class="controls">
        <a class="btn-submit" href="../submit/">Submit a time</a>
        <label class="control">
          <span class="control-label">Drivetrain</span>
          <select id="t-group"><option value="">All drivetrains</option>${options}</select>
        </label>
        <label class="control control-search">
          <span class="visually-hidden">Search tunes</span>
          <input id="t-search" type="search" placeholder="Find a driver, car or tune" autocomplete="off">
        </label>
      </div>
      <p class="tune-count" id="t-count" aria-live="polite"></p>
      <table class="results tunes-table">
        <thead><tr><th>Driver</th><th>Vehicle</th><th>Tune</th><th>Stage time</th><th class="c-date">Uploaded</th><th>Get it</th></tr></thead>
        <tbody id="t-body">
${rows}
        </tbody>
      </table>
      <p class="empty" id="t-empty"${tunes.length ? ' hidden' : ''}>${tunes.length ? 'No tunes match that search.' : 'No tunes yet. Add your car setup when you submit a time.'}</p>
      <p class="tunes-note">Tunes are shared by drivers and not checked for how they drive. To add yours, attach the <code>.lsp</code> file on the <a href="../submit/#tune">submit page</a>.</p>
    </section>

    <footer class="footer">
      <p><a href="../">Back to the stage times</a> &middot; <a href="../guide/">Car setup guide</a></p>
    </footer>`;
  return shell({
    title: "Vehicle tune library · Al's Playground",
    description: "Browse car setups other drivers have shared for Al's Playground in Richard Burns Rally. Preview every setting and download the .lsp file.",
    up: '../', css: ['guide.css', 'tunes.css'], body, scripts: ['tunes.js'],
  });
}
