// Reading and checking Richard Burns Rally car tunes (.lsp files).
// Used by the submit page (before sending), the Worker (before saving) and the build (to draw the tune pages).
// A tune is only ever read as text and checked line by line. It is never run.
//
// File shape:
//   (("CarSetup"
//    Car             ("Car"
//                     MaxSteeringLock 0.751000
//                     )
//    WheelLF         (":-D"
//                     vecTopMountPosition +0.551000 -2.481000 +0.725000
//                     )
//    ))

export const TUNE_MAX_BYTES = 64 * 1024;
export const TUNE_MAX_LINES = 1500;
const MAX_ERRORS = 4;

const NUM = '[+-]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
const HEAD = /^\s*\(\("CarSetup"\s*$/;
const TAIL = /^\s*\)\)\s*$/;
const SECTION = /^\s*([A-Za-z][A-Za-z0-9_]{0,47})\s+\("([^"\n]{0,24})"\s*$/;
const VALUE = new RegExp(`^\\s*([A-Za-z][A-Za-z0-9_]{0,63})\\s+(${NUM}(?:\\s+${NUM}){0,2})\\s*$`);
const CLOSE = /^\s*\)\s*$/;
const RESERVED = /^(__proto__|constructor|prototype)$/;

/**
 * Check and read a tune.
 * Returns { ok: true, tune } or { ok: false, errors: [text] }.
 * tune = { sections: { Name: { key: number | [numbers] } }, order: [section names], count: number of settings }
 */
export function parseTune(text) {
  const errors = [];
  const fail = (line, msg) => { if (errors.length < MAX_ERRORS) errors.push(line ? `Line ${line}: ${msg}` : msg); };

  if (typeof text !== 'string' || !text.trim()) return { ok: false, errors: ['That file is empty.'] };
  if (text.length > TUNE_MAX_BYTES) return { ok: false, errors: ['That file is too big to be a car tune (over 64 KB).'] };
  if (/[^\x09\x0A\x0D\x20-\x7E]/.test(text)) return { ok: false, errors: ['That file isn’t a plain-text car tune.'] };

  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > TUNE_MAX_LINES) return { ok: false, errors: ['That file is too long to be a car tune.'] };

  let first = 0;
  while (first < lines.length && !lines[first].trim()) first += 1;
  let last = lines.length - 1;
  while (last > first && !lines[last].trim()) last -= 1;
  if (!HEAD.test(lines[first] || '')) return { ok: false, errors: ['That doesn’t look like a Richard Burns Rally car tune (it should start with ((“CarSetup”).'] };
  if (!TAIL.test(lines[last] || '')) return { ok: false, errors: ['That tune looks cut off (it should end with a closing )).'] };

  const sections = {};
  const order = [];
  let current = null;
  let count = 0;
  for (let i = first + 1; i < last; i += 1) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    let m;
    if (current === null) {
      if ((m = SECTION.exec(raw)) && !RESERVED.test(m[1])) {
        if (Object.prototype.hasOwnProperty.call(sections, m[1])) { fail(i + 1, `section ${m[1]} appears twice.`); continue; }
        current = m[1];
        sections[current] = Object.create(null);
        order.push(current);
      } else {
        fail(i + 1, 'expected the start of a section, such as Car ("Car".');
      }
    } else if (CLOSE.test(raw)) {
      current = null;
    } else if ((m = VALUE.exec(raw)) && !RESERVED.test(m[1])) {
      if (m[1] in sections[current]) { fail(i + 1, `${m[1]} is set twice in ${current}.`); continue; }
      const nums = m[2].trim().split(/\s+/).map(Number);
      if (!nums.every(Number.isFinite)) { fail(i + 1, 'a value isn’t a number.'); continue; }
      sections[current][m[1]] = nums.length === 1 ? nums[0] : nums;
      count += 1;
    } else {
      fail(i + 1, 'expected a setting and its number, such as SpringLength 0.245000.');
    }
    if (errors.length >= MAX_ERRORS) break;
  }
  if (!errors.length && current !== null) fail(0, 'A section is missing its closing bracket.');
  if (!errors.length && (order.length < 1 || count < 5)) fail(0, 'That tune has hardly any settings in it.');
  if (errors.length) return { ok: false, errors };

  for (const k of order) sections[k] = { ...sections[k] };
  return { ok: true, tune: { sections, order, count } };
}

/** "My Tune.lsp" or "C:\\...\\My Tune.lsp" becomes "My Tune": safe to show and to use as a file name. */
export function cleanTuneName(fileName) {
  const base = String(fileName ?? '').split(/[\\/]/).pop().replace(/\.lsp$/i, '');
  const name = base.replace(/[^A-Za-z0-9 _.()+-]/g, '_').replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '').slice(0, 60);
  return name || 'Tune';
}

/** True when the file name ends in .lsp. */
export function isLspName(fileName) {
  return /\.lsp$/i.test(String(fileName ?? '').trim());
}

/**
 * Things worth a second look. Returns a list of plain sentences (empty when nothing stands out).
 * Differential throttle maps and speed factors that are all zero usually mean the tune was saved
 * incompletely, which leaves the differentials open or unpredictable (see the setup guide).
 */
export function checkTune(tune) {
  const notes = [];
  const vcu = tune?.sections?.VehicleControlUnit;
  if (!vcu) return notes;
  const groups = new Map();
  for (const [key, value] of Object.entries(vcu)) {
    const m = /^(.*)_(\d{2})$/.exec(key);
    if (!m || typeof value !== 'number') continue;
    if (!groups.has(m[1])) groups.set(m[1], []);
    groups.get(m[1]).push(value);
  }
  for (const [name, values] of groups) {
    if (!/DiffThrottle$|SpeedMapFactor$/.test(name)) continue;
    if (values.length >= 3 && values.every((v) => v === 0)) {
      notes.push(`${name} is zero at every point. Zeroed differential values leave the differentials open or unpredictable.`);
    }
  }
  return notes;
}
