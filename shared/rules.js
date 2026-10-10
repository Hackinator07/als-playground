// Shared rules for Al's Playground stage times.
// Used by the results page, the submit page, the Worker and the build script,
// so a time is parsed, checked, ranked and formatted the same way everywhere.
// Plain ES module, no dependencies.

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------- times

const TIME_RE = /^(\d{1,2}):([0-5]\d)[.,](\d{1,3})$/;

/**
 * Parse a typed time like "6:48.034" into whole milliseconds.
 * Accepts a leading zero on minutes, a comma decimal, and 1–3 decimals
 * (padded: "6:48.5" is 6:48.500). Decimals are required.
 * Returns { ok: true, ms } or { ok: false, error }.
 */
export function parseTime(input) {
  const s = String(input ?? '').trim();
  if (s === '') return { ok: false, error: 'Enter a time, like 8:31.274' };
  const m = TIME_RE.exec(s);
  if (!m) return { ok: false, error: 'Use minutes:seconds.thousandths, like 8:31.274' };
  const minutes = Number(m[1]);
  const seconds = Number(m[2]);
  const millis = Number(m[3].padEnd(3, '0'));
  return { ok: true, ms: (minutes * 60 + seconds) * 1000 + millis };
}

/** 408034 -> "6:48.034" (stage, checkpoint and sector times). */
export function formatTime(ms) {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Gap in RSF style: under a minute "02.466" (two-digit seconds, no sign),
 * a minute or more "1:04.086".
 */
export function formatDiff(ms) {
  const total = Math.max(0, Math.round(ms));
  if (total < 60000) {
    const seconds = Math.floor(total / 1000);
    const millis = total % 1000;
    return `${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  }
  return formatTime(total);
}

/** Readback shown under a time box: 408034 -> "6 min 48.034 s". */
export function formatReadback(ms) {
  const minutes = Math.floor(ms / 60000);
  const rest = ms - minutes * 60000;
  const sec = (rest / 1000).toFixed(3);
  return `${minutes} min ${sec} s`;
}

// ---------------------------------------------------------------- names

/** Collapse runs of whitespace and trim. */
export function cleanName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim();
}

/** Key used to treat "Jane Driver" and "jane  driver" as the same driver. */
export function driverKey(name) {
  return cleanName(name).normalize('NFKC').toLocaleLowerCase('en-US');
}

const NAME_RE = /^[\p{L}\p{M}\p{N} .\-_']+$/u;

export function validateDriver(name) {
  const n = cleanName(name);
  if (n.length < 2 || n.length > 32) return 'Name must be 2–32 characters.';
  if (/https?:|www\.|[<>]/i.test(n)) return 'Names can’t contain links or < >.';
  if (!NAME_RE.test(n)) return 'Use letters, numbers, spaces and . - _ \' only.';
  return null;
}

// ---------------------------------------------------------------- whole run

/**
 * Check one run's times against each other and the stage bounds.
 * times: { cp1_ms, cp2_ms, finish_ms }; stage: stage.json.
 * Returns a list of { field, message }; empty means valid.
 */
export function checkTimes(times, stage) {
  const errors = [];
  const { cp1_ms, cp2_ms, finish_ms } = times;
  if (!(cp1_ms < cp2_ms)) errors.push({ field: 'cp2', message: 'Checkpoint 2 must be later than Checkpoint 1.' });
  if (!(cp2_ms < finish_ms)) errors.push({ field: 'finish', message: 'Finish must be later than Checkpoint 2.' });
  if (stage) {
    if (finish_ms < stage.min_finish_ms) {
      errors.push({ field: 'finish', message: 'That’s faster than looks possible on this stage. Check the digits.' });
    } else if (finish_ms > stage.max_finish_ms) {
      errors.push({ field: 'finish', message: `That’s longer than ${formatTime(stage.max_finish_ms)}. Check the digits.` });
    }
  }
  return errors;
}

/**
 * Schema check for a stored submission file (used by the build).
 * Returns null if valid, otherwise a short reason.
 */
export function checkStoredRun(run, carIds, stage) {
  if (!run || typeof run !== 'object') return 'not an object';
  if (run.schema !== SCHEMA_VERSION) return `schema must be ${SCHEMA_VERSION}`;
  if (typeof run.id !== 'string' || !/^[a-z0-9]{4,16}$/.test(run.id)) return 'bad id';
  const nameErr = validateDriver(run.driver);
  if (nameErr) return `driver: ${nameErr}`;
  if (!carIds.has(run.car_id)) return `unknown car_id "${run.car_id}"`;
  if (typeof run.car_name !== 'string' || !run.car_name) return 'missing car_name';
  for (const k of ['cp1_ms', 'cp2_ms', 'finish_ms']) {
    if ((k === 'cp1_ms' || k === 'cp2_ms') && run[k] === null) continue;   // stored real results only: a checkpoint the organisers didn't publish
    if (!Number.isInteger(run[k]) || run[k] <= 0) return `${k} must be a positive whole number`;
  }
  if (run.cp1_ms === null && run.cp2_ms === null) return 'at least one checkpoint time is needed';
  const cp1 = run.cp1_ms === null ? run.cp2_ms / 2 : run.cp1_ms;
  const cp2 = run.cp2_ms === null ? (cp1 + run.finish_ms) / 2 : run.cp2_ms;
  const timeErr = checkTimes({ ...run, cp1_ms: cp1, cp2_ms: cp2 }, stage);
  if (timeErr.length) return timeErr[0].message;
  if (typeof run.uploaded_at !== 'string' || Number.isNaN(Date.parse(run.uploaded_at))) return 'bad uploaded_at';
  if (run.screenshot !== null && run.screenshot !== undefined && typeof run.screenshot !== 'string') return 'bad screenshot';
  if (!['published', 'hidden'].includes(run.status)) return 'status must be "published" or "hidden"';
  if (run.label !== undefined && (typeof run.label !== 'string' || run.label.length > 20)) return 'label must be text, 20 characters at most';
  if (run.note !== undefined && (typeof run.note !== 'string' || run.note.length > 200)) return 'note must be text, 200 characters at most';
  if (run.tune !== undefined && run.tune !== null) {
    const t = run.tune;
    if (typeof t !== 'object') return 'tune must be an object';
    if (typeof t.file !== 'string' || !/^tunes\/\d{4}\/[a-z0-9]{4,16}\.lsp$/.test(t.file)) return 'tune.file must look like tunes/2026/<id>.lsp';
    if (typeof t.name !== 'string' || !t.name || t.name.length > 60) return 'tune.name must be text, 60 characters at most';
    if (t.status !== undefined && !['published', 'hidden'].includes(t.status)) return 'tune.status must be "published" or "hidden"';
  }
  return null;
}

/**
 * Check a submission exactly as typed on the form. Used by the submit page
 * (live, before sending) and again by the Worker (before saving).
 *
 * input:   { driver, car_id, cp1, cp2, finish, consent }  (times as typed)
 * context: { stage, cars: cars.json, existing: published runs (optional) }
 * Returns  { errors: [{ field, message }], value } where value is the cleaned
 *          run (driver, car_id, car_name, *_ms, entered) when errors is empty.
 */
export function validateSubmission(input, { stage, cars, existing = [] }) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });
  const src = input || {};

  const driver = cleanName(src.driver);
  const driverErr = validateDriver(driver);
  if (driverErr) add('driver', driverErr);

  const car = (cars?.cars || []).find((c) => c.id === src.car_id && c.active !== false);
  if (!car) add('car', 'Choose a car from the list.');

  const times = {};
  for (const field of ['cp1', 'cp2', 'finish']) {
    const p = parseTime(src[field]);
    if (p.ok) times[field] = p.ms;
    else add(field, p.error);
  }
  if ('cp1' in times && 'cp2' in times && 'finish' in times) {
    for (const e of checkTimes({ cp1_ms: times.cp1, cp2_ms: times.cp2, finish_ms: times.finish }, stage)) add(e.field, e.message);
  }

  if (src.consent !== true) add('consent', 'Tick the box to agree your name, and your screenshot or tune if you add them, are shown publicly.');

  if (!errors.length) {
    const key = driverKey(driver);
    const dup = existing.some((r) => driverKey(r.driver) === key && r.car_id === car.id && r.finish_ms === times.finish);
    if (dup) add('finish', 'This time is already on the board.');
  }

  if (errors.length) return { errors, value: null };
  return {
    errors,
    value: {
      driver,
      car_id: car.id,
      car_name: car.name,
      cp1_ms: times.cp1,
      cp2_ms: times.cp2,
      finish_ms: times.finish,
      entered: { cp1: String(src.cp1).trim(), cp2: String(src.cp2).trim(), finish: String(src.finish).trim() },
    },
  };
}

// ---------------------------------------------------------------- ranking

function byFinishThenUpload(a, b) {
  if (a.finish_ms !== b.finish_ms) return a.finish_ms - b.finish_ms;
  return Date.parse(a.uploaded_at) - Date.parse(b.uploaded_at);
}

/**
 * Rank runs for display.
 * runs:    published runs (from results.json)
 * options: { view: 'best' | 'all', group: '' | group name, carGroup: Map car_id -> group }
 *
 * - The class filter is applied first, so "best per driver" in Group A is
 *   each driver's best Group A run.
 * - Best per driver keeps each driver's fastest run (earliest upload on a tie).
 * - Sorted by finish, ties by upload time. Competition ranking: 1, 2, 2, 4.
 * - Diffs use finish only. Leader shows 0 in both; a tie shows 0 Diff. Prev.
 *
 * Returns { rows, fastestCp1, fastestCp2, fastestSectors, runsByDriver }.
 */
export function rankRuns(runs, options = {}) {
  const { view = 'best', group = '', carGroup = new Map(), source = '' } = options;

  // source: '' all runs, 'virtual' RBR runs only, 'real' any curated real-world result, 'lspr2024' / 'lspr2026' one year only (see runTag)
  const inSourceRuns = source ? runs.filter((r) => inSource(r, source)) : runs;

  const runsByDriver = new Map();
  for (const r of inSourceRuns) {
    const k = driverKey(r.driver);
    runsByDriver.set(k, (runsByDriver.get(k) || 0) + 1);
  }

  let pool = group ? inSourceRuns.filter((r) => carGroup.get(r.car_id) === group) : inSourceRuns.slice();

  if (view === 'best') {
    const best = new Map();
    for (const r of pool) {
      const k = driverKey(r.driver);
      const cur = best.get(k);
      if (!cur || byFinishThenUpload(r, cur) < 0) best.set(k, r);
    }
    pool = [...best.values()];
  }

  pool.sort(byFinishThenUpload);

  const rows = [];
  for (let i = 0; i < pool.length; i++) {
    const run = pool[i];
    const prev = i > 0 ? rows[i - 1] : null;
    const pos = prev && prev.run.finish_ms === run.finish_ms ? prev.pos : i + 1;
    rows.push({
      run,
      pos,
      diffPrev: prev ? run.finish_ms - prev.run.finish_ms : 0,
      diffFirst: i > 0 ? run.finish_ms - pool[0].finish_ms : 0,
      sectors: sectorsOf(run),
      driverRuns: runsByDriver.get(driverKey(run.driver)) || 1,
    });
  }

  const min = (f) => {
    const v = rows.map(f).filter((x) => x !== null && x !== undefined);
    return v.length ? Math.min(...v) : null;
  };
  return {
    rows,
    fastestCp1: min((x) => x.run.cp1_ms),
    fastestCp2: min((x) => x.run.cp2_ms),
    fastestSectors: [0, 1, 2].map((s) => min((x) => x.sectors[s])),
  };
}

/** Sector times from cumulative checkpoints: [S1, S2, S3]. */
export function sectorsOf(run) {
  if (run.cp1_ms === null || run.cp1_ms === undefined) return [null, null, run.finish_ms - run.cp2_ms];   // only checkpoint 2 was published
  if (run.cp2_ms === null || run.cp2_ms === undefined) return [run.cp1_ms, null, null];
  return [run.cp1_ms, run.cp2_ms - run.cp1_ms, run.finish_ms - run.cp2_ms];
}

// ---------------------------------------------------------------- timestamps

const fmtCache = new Map();
function zoneFormatter(timeZone) {
  if (!fmtCache.has(timeZone)) {
    fmtCache.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', timeZoneName: 'short',
    }));
  }
  return fmtCache.get(timeZone);
}

/**
 * Show a stored UTC timestamp in a fixed zone (US Central by default).
 * Returns { date: "2026-10-02", time: "16:05:33", zone: "CDT",
 *           offset: "UTC−5", utc: "21:05:33 UTC" }.
 */
export function zonedStamp(iso, timeZone = 'America/Chicago') {
  const d = new Date(iso);
  const parts = Object.fromEntries(zoneFormatter(timeZone).formatToParts(d).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}:${parts.second}`;
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetH = Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 3600000);
  const offset = offsetH === 0 ? 'UTC' : `UTC${offsetH < 0 ? '−' : '+'}${Math.abs(offsetH)}`;
  const utc = d.toISOString().slice(11, 19) + ' UTC';
  return { date, time, zone: parts.timeZoneName, offset, utc };
}

/**
 * The tag shown beside a driver's name. Curated real-world times carry their own
 * label (e.g. "LSPR 2024", "LSPR 2026"); every other run is a virtual one and is tagged
 * "RBR <year>", the year it was uploaded in the display time zone.
 * Returns { text, kind, year, key }:
 *   kind "virtual" (RBR runs) or "real"
 *   year the LSPR year ("2024", "2026") for real runs, otherwise null
 *   key  "virtual", "lspr2024", "lspr2026" ("lspr" alone when a label has no year); used for the colour and the source filter
 */
export function runTag(run, timeZone = 'America/Chicago') {
  const text = run.label || `RBR ${zonedStamp(run.uploaded_at, timeZone).date.slice(0, 4)}`;
  const kind = /^RBR\b/.test(text) ? 'virtual' : 'real';
  const year = kind === 'real' ? ((/\b(\d{4})\b/.exec(text) || [])[1] || null) : null;
  return { text, kind, year, key: kind === 'virtual' ? 'virtual' : `lspr${year || ''}` };
}

/**
 * Does a run belong to a source filter? source: '' everything, 'virtual', 'real' (any LSPR year),
 * or one year such as 'lspr2024' / 'lspr2026'.
 */
export function inSource(run, source, timeZone = 'America/Chicago') {
  if (!source) return true;
  const t = runTag(run, timeZone);
  return source === 'real' ? t.kind === 'real' : t.key === source;
}

// ---------------------------------------------------------------- real-world comparison

/** The real event a curated run came from: { year: '2024', stage: 'SS1' } (from its note), or null. */
export function realEvent(run) {
  if (runTag(run).kind !== 'real') return null;
  const m = /LSPR (\d{4}) (SS\d+)/.exec(run.note || '');
  return m ? { year: m[1], stage: m[2] } : null;
}

/** The real stage a curated run came from, e.g. "SS1" / "SS10" (from its note), or null. */
export function realStage(run) {
  const e = realEvent(run);
  return e ? e.stage : null;
}

/**
 * Where a finish time would have placed among the real results of one LSPR year (2024 unless told otherwise),
 * per real stage.
 * Returns [{ stage: 'SS1', place, of, faster: run|null, slower: run|null }] in stage order,
 * where faster / slower are the real runs just ahead of / just behind that time.
 */
export function realPlacings(finishMs, runs, year = '2024') {
  const byStage = new Map();
  for (const r of runs) {
    const e = realEvent(r);
    if (!e || e.year !== year) continue;
    const s = e.stage;
    if (!byStage.has(s)) byStage.set(s, []);
    byStage.get(s).push(r);
  }
  const num = (s) => Number(s.replace(/\D/g, ''));
  return [...byStage.keys()].sort((a, b) => num(a) - num(b)).map((stage) => {
    const list = byStage.get(stage).slice().sort((a, b) => a.finish_ms - b.finish_ms);
    const ahead = list.filter((r) => r.finish_ms < finishMs);
    return {
      stage,
      place: ahead.length + 1,
      of: list.length,
      faster: ahead.length ? ahead[ahead.length - 1] : null,
      slower: list.find((r) => r.finish_ms >= finishMs) || null,
    };
  });
}

/**
 * Theoretical best: the fastest sector 1, 2 and 3 across the given rows (any runs), added up.
 * Returns { total, parts: [{ ms, run }] x3 } or null when a sector has no time.
 */
export function theoreticalBest(rows) {
  const parts = [0, 1, 2].map((s) => {
    let best = null;
    for (const row of rows) {
      const t = row.sectors[s];
      if (t === null || t === undefined) continue;
      if (!best || t < best.ms || (t === best.ms && Date.parse(row.run.uploaded_at) < Date.parse(best.run.uploaded_at))) best = { ms: t, run: row.run };
    }
    return best;
  });
  if (parts.some((p) => !p)) return null;
  return { total: parts.reduce((a, p) => a + p.ms, 0), parts };
}
