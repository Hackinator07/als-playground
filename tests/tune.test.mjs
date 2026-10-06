import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseTune, cleanTuneName, isLspName, checkTune, TUNE_MAX_BYTES } from '../shared/tune.js';
import { buildSections, renderTunePage, renderLibrary } from '../scripts/tunes.mjs';
import { checkStoredRun } from '../shared/rules.js';

const SAMPLE = fs.readFileSync(new URL('./fixtures/gravel_gem_GDA_AlsPlayground.lsp', import.meta.url), 'utf8');
const stage = JSON.parse(fs.readFileSync(new URL('../data/stage.json', import.meta.url)));
const cars = JSON.parse(fs.readFileSync(new URL('../data/cars.json', import.meta.url)));
const carIds = new Set(cars.cars.map((c) => c.id));

test('reads the real example tune', () => {
  const r = parseTune(SAMPLE);
  assert.equal(r.ok, true);
  assert.equal(r.tune.order.length, 16);
  assert.equal(r.tune.sections.Car.MaxSteeringLock, 0.751);
  assert.deepEqual(r.tune.sections.WheelLF.vecTopMountPosition, [0.551, -2.481, 0.725]);
  assert.equal(r.tune.sections.SpringDamperLB.SpringStiffness, 36000);
  assert.equal(r.tune.sections.TyreLF.Pressure, 170000);
  assert.deepEqual(checkTune(r.tune), []);
});

test('also reads Windows line endings', () => {
  assert.equal(parseTune(SAMPLE.replace(/\n/g, '\r\n')).ok, true);
});

test('rejects things that are not a car tune', () => {
  for (const bad of ['', '   ', 'hello', '<html></html>', '((“CarSetup”', SAMPLE.slice(0, 300), SAMPLE.replace('MaxSteeringLock 0.751000', 'MaxSteeringLock abc')]) {
    assert.equal(parseTune(bad).ok, false, bad.slice(0, 30));
  }
  assert.equal(parseTune('x'.repeat(TUNE_MAX_BYTES + 1)).ok, false);
  assert.equal(parseTune(SAMPLE + '\u0000').ok, false);
  assert.equal(parseTune(SAMPLE.replace('Car             ("Car"', 'Car ("Car"\n A 1\n )\n Car ("Car"')).ok, false);   // section twice
  assert.equal(parseTune(SAMPLE.replace('MaxSteeringLock 0.751000', '__proto__ 1')).ok, false);                      // reserved names
});

test('tune names are made safe', () => {
  assert.equal(cleanTuneName('C:\\Games\\RBR\\SavedGames\\GDA\\My Tune.lsp'), 'My Tune');
  assert.equal(cleanTuneName('../../etc/passwd.lsp'), 'passwd');
  assert.equal(cleanTuneName('a<b>c"d.lsp'), 'a_b_c_d');
  assert.equal(cleanTuneName('.lsp'), 'Tune');
  assert.equal(cleanTuneName('a'.repeat(200) + '.lsp').length, 60);
  assert.equal(isLspName('x.LSP'), true);
  assert.equal(isLspName('x.txt'), false);
});

test('zeroed differential maps are flagged', () => {
  const zeroed = SAMPLE.replace(/(FrontDiffThrottle_\d\d) [\d.]+/g, '$1 0.000000').replace(/(CenterSpeedMapFactor_\d\d) [\d.]+/g, '$1 0.000000');
  const notes = checkTune(parseTune(zeroed).tune);
  assert.equal(notes.length, 3);   // front throttle, centre speed factor and the left-foot centre speed factor
  assert.match(notes.join(' '), /FrontDiffThrottle/);
  assert.match(notes.join(' '), /CenterSpeedMapFactor/);
  // brake maps that are zero at the top end are normal
  assert.deepEqual(checkTune(parseTune(SAMPLE).tune), []);
});

test('every value in the file ends up on the page', () => {
  const { tune } = parseTune(SAMPLE);
  const sections = buildSections(tune);
  assert.deepEqual(sections.map((s) => s.id), ['differentials', 'suspension', 'geometry', 'arb', 'tyres', 'brakes', 'gearbox', 'other']);
  const all = sections.map((s) => s.html).join('');
  // unit conversions
  assert.match(all, /245 mm/); assert.match(all, /45 kN\/m/); assert.match(all, /170 kPa/); assert.match(all, /24\.7 psi/);
  assert.match(all, /3800 kPa/); assert.match(all, /-3\.86°/); assert.match(all, /3800 Nm/);
  // every key name appears (by name or in a pattern group)
  const other = sections.find((s) => s.id === 'other').html;
  assert.match(other, /Features_NGP/);
  assert.match(other, /BumpStop|Engine/);
  for (const key of ['SpringLength', 'MaxSteeringLock', 'FrontRollBarStiffness', 'MaxBrakePressureFront', 'FinalDriveId', 'GearGuard', 'Pressure']) {
    assert.ok(all.includes(key), key);
  }
});

const meta = { id: 'gnkwm01d', driver: 'Jason <b>Hack</b>', car_name: 'Subaru Impreza GDA WRC2003 (S9)', group: '4WD', group_tag: '4WD', tune_name: 'gravel_gem_GDA_AlsPlayground', file_name: 'gravel_gem_GDA_AlsPlayground.lsp', uploaded_at: '2026-10-05T15:44:57.941Z', finish_ms: 439604, run_published: true };

test('tune page: names are escaped, download and guide links are there', () => {
  const html = renderTunePage(meta, parseTune(SAMPLE).tune, SAMPLE);
  assert.ok(!html.includes('<b>Hack</b>'));
  assert.match(html, /Jason &lt;b&gt;Hack&lt;\/b&gt;/);
  assert.match(html, /href="gravel_gem_GDA_AlsPlayground\.lsp" download/);
  assert.match(html, /href="\.\.\/\.\.\/guide\/#diff-front"/);
  assert.match(html, /\?highlight=gnkwm01d/);
  assert.match(html, /<details class="raw">/);
});

test('tune page: every guide link points at a real guide section', () => {
  const guide = fs.readFileSync(new URL('../site/guide/index.html', import.meta.url), 'utf8');
  const html = renderTunePage(meta, parseTune(SAMPLE).tune, SAMPLE);
  const ids = new Set([...guide.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  const links = [...html.matchAll(/href="\.\.\/\.\.\/guide\/#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(links.length > 10);
  for (const l of links) assert.ok(ids.has(l), `guide has no #${l}`);
});

test('a hidden run keeps its tune but loses the stage time', () => {
  const lib = renderLibrary([{ ...meta, run_published: false }], cars.groups);
  assert.match(lib, /gravel_gem_GDA_AlsPlayground/);
  assert.ok(!lib.includes('highlight=gnkwm01d'));
  assert.match(renderLibrary([], cars.groups), /No tunes yet/);
});

test('stored runs may carry a tune, but only a well-formed one', () => {
  const run = JSON.parse(fs.readFileSync('data/submissions/2026/2026-10-05T154457Z_gnkwm01d.json', 'utf8'));
  assert.equal(checkStoredRun(run, carIds, stage), null);
  assert.match(checkStoredRun({ ...run, tune: { file: '../../etc/passwd', name: 'x' } }, carIds, stage), /tune\.file/);
  assert.match(checkStoredRun({ ...run, tune: { file: run.tune.file, name: '' } }, carIds, stage), /tune\.name/);
  assert.match(checkStoredRun({ ...run, tune: { ...run.tune, status: 'gone' } }, carIds, stage), /tune\.status/);
  assert.equal(checkStoredRun({ ...run, tune: null }, carIds, stage), null);
});

test('every tune file in the repo is referenced by a run and reads cleanly', () => {
  const dir = 'tunes/2026';
  const referenced = new Set();
  for (const f of fs.readdirSync('data/submissions/2026')) {
    const r = JSON.parse(fs.readFileSync(`data/submissions/2026/${f}`, 'utf8'));
    if (r.tune) { referenced.add(r.tune.file); assert.ok(fs.existsSync(r.tune.file), r.tune.file); }
  }
  for (const f of fs.readdirSync(dir)) {
    assert.ok(referenced.has(`${dir}/${f}`), `${f} isn't used by any run`);
    assert.equal(parseTune(fs.readFileSync(`${dir}/${f}`, 'utf8')).ok, true, f);
  }
});
