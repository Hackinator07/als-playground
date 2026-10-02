import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkStoredRun } from '../shared/rules.js';

const stage = JSON.parse(fs.readFileSync(new URL('../data/stage.json', import.meta.url)));
const cars = JSON.parse(fs.readFileSync(new URL('../data/cars.json', import.meta.url)));
const carIds = new Set(cars.cars.map((c) => c.id));

test('cars.json: 102 cars, unique ids, every car in a listed group', () => {
  assert.equal(cars.cars.length, 102);
  assert.equal(carIds.size, cars.cars.length);
  const groups = new Set(cars.groups.map((g) => g.name));
  for (const c of cars.cars) assert.ok(groups.has(c.group), `${c.name} has unknown group ${c.group}`);
  for (const g of groups) assert.ok(cars.cars.some((c) => c.group === g), `group ${g} is empty`);
});

test('stage.json has what the page and the checks need', () => {
  assert.equal(stage.length_km, 12.5);
  assert.ok(stage.min_finish_ms < stage.max_finish_ms);
  assert.equal(stage.display_time_zone, 'America/Chicago');
});

const good = {
  schema: 1, id: 'k7f3q9', stage: 'als-playground', driver: 'Jane Driver',
  car_id: 'subaru-impreza-gc8-555-grpa', car_name: 'Subaru Impreza GC8 555 GrpA',
  cp1_ms: 141402, cp2_ms: 280118, finish_ms: 408034,
  entered: { cp1: '2:21.402', cp2: '4:40.118', finish: '6:48.034' },
  uploaded_at: '2026-10-02T21:05:33.412Z', screenshot: null, status: 'published',
};

test('stored run: the documented example is valid', () => {
  assert.equal(checkStoredRun(good, carIds, stage), null);
  assert.equal(checkStoredRun({ ...good, status: 'hidden' }, carIds, stage), null);
  assert.equal(checkStoredRun({ ...good, screenshot: 'screenshots/2026/k7f3q9.webp' }, carIds, stage), null);
});

test('stored run: each kind of damage is caught', () => {
  assert.match(checkStoredRun({ ...good, schema: 2 }, carIds, stage), /schema/);
  assert.match(checkStoredRun({ ...good, car_id: 'nope' }, carIds, stage), /unknown car_id/);
  assert.match(checkStoredRun({ ...good, finish_ms: 408034.5 }, carIds, stage), /whole number/);
  assert.match(checkStoredRun({ ...good, cp2_ms: 100 }, carIds, stage), /Checkpoint 2/);
  assert.match(checkStoredRun({ ...good, status: 'published ' }, carIds, stage), /status/);
  assert.match(checkStoredRun({ ...good, uploaded_at: 'yesterday' }, carIds, stage), /uploaded_at/);
  assert.match(checkStoredRun({ ...good, driver: 'x' }, carIds, stage), /driver/);
  assert.match(checkStoredRun({ ...good, id: '../x' }, carIds, stage), /id/);
  assert.match(checkStoredRun(null, carIds, stage), /object/);
});
