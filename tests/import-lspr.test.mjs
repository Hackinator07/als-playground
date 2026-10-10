import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planImport } from '../scripts/import-lspr.mjs';

const stage = JSON.parse(fs.readFileSync(new URL('../data/stage.json', import.meta.url)));
const cars = JSON.parse(fs.readFileSync(new URL('../data/cars.json', import.meta.url))).cars;
const car = cars[0];
const row = (o = {}) => ({ stage: 'SS12', number: 7, driver: 'Test Driver', codriver: 'Co Driver', car: car.name, cp1: '2:46.1', cp2: '6:18.4', finish: '8:00.1', ...o });
const spec = (rows, extra = {}) => ({ year: '2026', uploaded_at: '2026-10-11T00:00:00Z', timed_to: 'tenth', rows, ...extra });

test('import: builds a stored run in the existing data format', () => {
  const p = planImport(spec([row()]), { cars, stage, existing: [] });
  assert.equal(p.write.length, 1);
  const r = p.write[0];
  assert.equal(r.id, 'lspr26s12n7');
  assert.equal(r.label, 'LSPR 2026');
  assert.equal(r.finish_ms, 480100);
  assert.match(r.note, /^Real LSPR 2026 SS12 time, timed to the tenth: car #7, .*co-driver Co Driver$/);
});

test('import: unknown car names are flagged, not written or guessed', () => {
  const p = planImport(spec([row({ car: 'Totally Unknown Car' })]), { cars, stage, existing: [] });
  assert.equal(p.write.length, 0);
  assert.equal(p.flagged.length, 1);
  assert.equal(planImport(spec([row({ car: 'Totally Unknown Car' })], { carMap: { 'Totally Unknown Car': car.id } }), { cars, stage, existing: [] }).write.length, 1);
});

test('import: running twice adds nothing, and 2024 rows are left alone', () => {
  const first = planImport(spec([row()]), { cars, stage, existing: [] }).write;
  const again = planImport(spec([row(), row({ number: 8, driver: 'Test Driver' })]), { cars, stage, existing: first });
  assert.equal(again.write.length, 0);
  assert.equal(again.skipped.length, 2);
  const old = { id: 'lspr24s1n7', label: 'LSPR 2024', driver: 'Test Driver', finish_ms: 480100 };
  assert.equal(planImport(spec([row()]), { cars, stage, existing: [old] }).write.length, 1);
});

test('import: bad times are reported', () => {
  const p = planImport(spec([row({ finish: 'abc' }), row({ number: 9, finish: '0:10.0' })]), { cars, stage, existing: [] });
  assert.equal(p.write.length, 0);
  assert.equal(p.errors.length, 2);
});

test('import: a run with only checkpoint 2 published is accepted and shows blanks for the rest', async () => {
  const { sectorsOf, checkStoredRun } = await import('../shared/rules.js');
  const p = planImport(spec([row({ cp1: null, cp2: '5:47.4', finish: '8:45.4' })]), { cars, stage, existing: [] });
  assert.equal(p.write.length, 1);
  const r = p.write[0];
  assert.equal(r.cp1_ms, null);
  assert.equal(r.entered.cp1, null);
  assert.deepEqual(sectorsOf(r), [null, null, 8 * 60000 + 45400 - 347400]);
  assert.equal(checkStoredRun({ ...r, cp2_ms: null }, new Set(cars.map((c) => c.id)), stage), 'at least one checkpoint time is needed');
});
