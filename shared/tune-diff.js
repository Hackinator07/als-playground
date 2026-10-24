// Compares two parsed tunes (parseTune output). Pure functions, shared by the browser and the tests.

const SAME_EPS = 1e-9;

const asList = (v) => (Array.isArray(v) ? v : [v]);

export function sameValue(a, b) {
  if (a === undefined || b === undefined) return a === b;
  const x = asList(a); const y = asList(b);
  if (x.length !== y.length) return false;
  return x.every((v, i) => Math.abs(v - y[i]) <= SAME_EPS * Math.max(1, Math.abs(v), Math.abs(y[i])));
}

/**
 * Every setting in either tune, grouped by section in file order (A first, then anything only B has).
 * Returns { sections: [{ name, rows: [{ key, a, b, same }] }], total, differing }.
 * a or b is undefined when that tune doesn't have the setting.
 */
export function diffTunes(tuneA, tuneB) {
  const names = [...tuneA.order];
  for (const n of tuneB.order) if (!names.includes(n)) names.push(n);
  const sections = [];
  let total = 0; let differing = 0;
  for (const name of names) {
    const sa = tuneA.sections[name] || {}; const sb = tuneB.sections[name] || {};
    const keys = [...Object.keys(sa)];
    for (const k of Object.keys(sb)) if (!(k in sa)) keys.push(k);
    const rows = keys.map((key) => {
      const a = sa[key]; const b = sb[key];
      const same = sameValue(a, b);
      total += 1; if (!same) differing += 1;
      return { key, a, b, same };
    });
    if (rows.length) sections.push({ name, rows });
  }
  return { sections, total, differing };
}

const num = (v, d = 3) => String(Number(Number(v).toFixed(d)));

const UNITS = [
  [/^(Helper)?SpringStiffness$/, (v) => `${num(v / 1000, 1)} kN/m`, 1000, 'kN/m', 1],
  [/^(Helper)?Spring(Min)?Length$|^SteeringRodLength$|^StrutPlatformHeight$/, (v) => `${num(v * 1000, 1)} mm`, 1000, 'mm', 1],
  [/Pressure(Front|Rear)?$/, (v) => `${num(v / 1000, 0)} kPa`, 0.001, 'kPa', 0],
  [/^WheelAxisInclination$/, (v) => `${num((v * 180) / Math.PI, 2)}°`, 180 / Math.PI, '°', 2],
];

/** A setting value as text, with the same units the tune pages use. */
export function formatValue(key, v) {
  if (v === undefined) return '—';
  if (Array.isArray(v)) return v.map((x) => num(x, 6)).join(', ');
  for (const [re, f] of UNITS) if (re.test(key)) return f(v);
  return num(v, 6);
}

/** B minus A as text (for example "+2.5 mm"), or '' when it doesn't apply (missing or list values). */
export function formatDelta(key, a, b) {
  if (typeof a !== 'number' || typeof b !== 'number' || sameValue(a, b)) return '';
  const unit = UNITS.find(([re]) => re.test(key));
  const scale = unit ? unit[2] : 1; const suffix = unit ? ` ${unit[3]}` : ''; const d = unit ? unit[4] : 6;
  const diff = (b - a) * scale;
  return `${diff > 0 ? '+' : '−'}${num(Math.abs(diff), d)}${suffix}`;
}
