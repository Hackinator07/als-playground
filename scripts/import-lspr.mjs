// Import real LSPR results (typed from the published screenshots) as stored runs.
//
//   node scripts/import-lspr.mjs rows.json            dry run: shows what would be written, writes nothing
//   node scripts/import-lspr.mjs rows.json --write    writes data/submissions/<year>/*.json
//
// rows.json: { "year": "2026", "uploaded_at": "2026-10-11T00:00:00Z", "timed_to": "tenth"|"thousandth",
//              "carMap": { "screenshot car name": "cars.json id" },        (optional, decisions on flagged cars)
//              "rows": [ { "stage": "SS12", "number": 14, "driver": "...", "codriver": "...", "car": "...",
//                          "cp1": "2:46.1", "cp2": "6:18.4", "finish": "8:00.1" } ] }
// Rows that already exist (same year, stage and car number, or the same driver and finish time) are skipped, so
// the script is safe to run twice. Cars that don't match data/cars.json are flagged and not written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTime, checkStoredRun, driverKey } from '../shared/rules.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function planImport(spec, { cars, stage, existing }) {
  const year = String(spec.year);
  const byName = new Map(cars.map((c) => [norm(c.name), c]));
  const byId = new Map(cars.map((c) => [c.id, c]));
  const carMap = spec.carMap || {};
  const seen = new Set(existing.map((r) => `${r.label}|${r.id}`));
  const finishes = new Set(existing.map((r) => `${r.label}|${driverKey(r.driver)}|${r.finish_ms}`));
  const carIds = new Set(cars.map((c) => c.id));
  const out = { write: [], skipped: [], flagged: [], errors: [] };
  for (const row of spec.rows) {
    const where = `${row.stage} #${row.number} ${row.driver}`;
    const car = byId.get(carMap[row.car]) || byName.get(norm(row.car));
    if (!car) { out.flagged.push({ where, car: row.car, why: 'car name not in data/cars.json' }); continue; }
    const t = {};
    let bad = null;
    for (const k of ['cp1', 'cp2', 'finish']) {
      const p = parseTime(row[k]);
      if (!p.ok) bad = `${k}: ${p.error}`; else t[k] = p.ms;
    }
    if (bad) { out.errors.push({ where, why: bad }); continue; }
    const stageNo = /^SS\d+$/.test(row.stage) ? row.stage.toLowerCase().replace('ss', 's') : null;
    if (!stageNo || !Number.isInteger(row.number)) { out.errors.push({ where, why: 'stage must look like SS12 and number must be a whole number' }); continue; }
    const id = `lspr${year.slice(2)}${stageNo}n${row.number}`;
    const label = `LSPR ${year}`;
    if (seen.has(`${label}|${id}`) || finishes.has(`${label}|${driverKey(row.driver)}|${t.finish}`)) { out.skipped.push({ where, why: 'already imported' }); continue; }
    seen.add(`${label}|${id}`);
    const precision = spec.timed_to === 'tenth' ? ', timed to the tenth' : '';
    const run = {
      schema: 1, id, stage: stage.id, driver: row.driver, car_id: car.id, car_name: car.name,
      cp1_ms: t.cp1, cp2_ms: t.cp2, finish_ms: t.finish,
      entered: { cp1: row.cp1, cp2: row.cp2, finish: row.finish },
      uploaded_at: new Date(spec.uploaded_at).toISOString(), screenshot: null, status: 'published', label,
      note: `Real LSPR ${year} ${row.stage} time${precision}: car #${row.number}, ${row.car}${row.codriver ? `, co-driver ${row.codriver}` : ''}`,
    };
    const problem = checkStoredRun(run, carIds, stage);
    if (problem) { out.errors.push({ where, why: problem }); continue; }
    out.write.push(run);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/import-lspr.mjs rows.json [--write]'); process.exit(2); }
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const stage = JSON.parse(fs.readFileSync(path.join(root, 'data/stage.json'), 'utf8'));
  const cars = JSON.parse(fs.readFileSync(path.join(root, 'data/cars.json'), 'utf8')).cars;
  const dir = path.join(root, 'data/submissions');
  const existing = [];
  for (const y of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    for (const f of fs.readdirSync(path.join(dir, y))) if (f.endsWith('.json')) existing.push(JSON.parse(fs.readFileSync(path.join(dir, y, f), 'utf8')));
  }
  const plan = planImport(spec, { cars, stage, existing });
  const fmt = (r) => `${r.id}  ${r.driver}  ${r.car_name}  ${r.entered.cp1} / ${r.entered.cp2} / ${r.entered.finish}`;
  plan.write.forEach((r) => console.log('write  ', fmt(r)));
  plan.skipped.forEach((s) => console.log('skip   ', s.where, '-', s.why));
  plan.flagged.forEach((s) => console.log('FLAG   ', s.where, '-', s.car, '-', s.why));
  plan.errors.forEach((s) => console.log('ERROR  ', s.where, '-', s.why));
  if (process.argv.includes('--write')) {
    if (plan.flagged.length || plan.errors.length) { console.error('\nNothing written: fix the flagged / error rows first (add carMap entries or correct the times).'); process.exit(1); }
    const out = path.join(dir, String(new Date(spec.uploaded_at).getUTCFullYear()));
    fs.mkdirSync(out, { recursive: true });
    for (const r of plan.write) fs.writeFileSync(path.join(out, `${r.uploaded_at.replace(/:/g, '').replace(/\.\d+Z$/, 'Z')}_${r.id}.json`), JSON.stringify(r, null, 2) + '\n');
    console.log(`\nWrote ${plan.write.length} run(s).`);
  } else console.log(`\nDry run: ${plan.write.length} to write, ${plan.skipped.length} skipped, ${plan.flagged.length} flagged, ${plan.errors.length} errors. Add --write to save.`);
}
