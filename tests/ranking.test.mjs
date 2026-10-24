import test from 'node:test';
import assert from 'node:assert/strict';
import { rankRuns, sectorsOf } from '../shared/rules.js';

let n = 0;
function run(driver, finish, opts = {}) {
  n++;
  return {
    id: `r${n}`,
    driver,
    car_id: opts.car || 'skoda-fabia-rs-rally2',
    car_name: 'x',
    cp1_ms: opts.cp1 ?? Math.round(finish * 0.35),
    cp2_ms: opts.cp2 ?? Math.round(finish * 0.69),
    finish_ms: finish,
    uploaded_at: opts.at || `2026-10-${String(10 + n).padStart(2, '0')}T12:00:00Z`,
    screenshot: null,
  };
}

const carGroup = new Map([
  ['skoda-fabia-rs-rally2', 'Rally 2'],
  ['subaru-impreza-gc8-555-grpa', 'Group A8'],
]);

test('no runs: empty result', () => {
  const r = rankRuns([], { carGroup });
  assert.deepEqual(r.rows, []);
  assert.equal(r.fastestCp1, null);
});

test('one run: P1 with both diffs 0', () => {
  const r = rankRuns([run('Jane', 408034)], { carGroup });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].pos, 1);
  assert.equal(r.rows[0].diffPrev, 0);
  assert.equal(r.rows[0].diffFirst, 0);
  assert.equal(r.fastestCp1, r.rows[0].run.cp1_ms);
});

test('sorted by finish, diffs from the row above and from P1', () => {
  const r = rankRuns([run('C', 412000), run('A', 408034), run('B', 410500)], { carGroup });
  assert.deepEqual(r.rows.map((x) => x.run.driver), ['A', 'B', 'C']);
  assert.deepEqual(r.rows.map((x) => x.diffPrev), [0, 2466, 1500]);
  assert.deepEqual(r.rows.map((x) => x.diffFirst), [0, 2466, 3966]);
});

test('ties share a position, the next one skips, earlier upload listed first', () => {
  const runs = [
    run('A', 408034),
    run('Late', 410500, { at: '2026-10-20T00:00:00Z' }),
    run('Early', 410500, { at: '2026-10-19T00:00:00Z' }),
    run('D', 472120),
  ];
  const r = rankRuns(runs, { carGroup });
  assert.deepEqual(r.rows.map((x) => [x.pos, x.run.driver]), [[1, 'A'], [2, 'Early'], [2, 'Late'], [4, 'D']]);
  assert.equal(r.rows[2].diffPrev, 0);
  assert.equal(r.rows[2].diffFirst, 2466);
});

test('a tie for first: both P1, both diffs 0', () => {
  const r = rankRuns([run('A', 400000), run('B', 400000)], { carGroup });
  assert.deepEqual(r.rows.map((x) => [x.pos, x.diffPrev, x.diffFirst]), [[1, 0, 0], [1, 0, 0]]);
});

test('best per driver keeps each driver once, at their fastest; names match loosely', () => {
  const runs = [
    run('Jane Driver', 425200),
    run('jane  driver', 418900),
    run('Jane Driver', 412400),
    run('Alex', 415000),
  ];
  const best = rankRuns(runs, { view: 'best', carGroup });
  assert.deepEqual(best.rows.map((x) => [x.pos, x.run.finish_ms]), [[1, 412400], [2, 415000]]);
  assert.equal(best.rows[0].driverRuns, 3);
  assert.equal(best.rows[1].driverRuns, 1);

  const all = rankRuns(runs, { view: 'all', carGroup });
  assert.equal(all.rows.length, 4);
  assert.deepEqual(all.rows.map((x) => x.pos), [1, 2, 3, 4]);
});

test('best per driver: equal best times keep the earlier upload', () => {
  const runs = [
    run('Jane', 412400, { at: '2026-10-21T00:00:00Z' }),
    run('Jane', 412400, { at: '2026-10-20T00:00:00Z' }),
  ];
  const r = rankRuns(runs, { view: 'best', carGroup });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].run.uploaded_at, '2026-10-20T00:00:00Z');
});

test('class filter ranks within the class, using the best run in that class', () => {
  const runs = [
    run('Jane', 405000, { car: 'skoda-fabia-rs-rally2' }),
    run('Jane', 420000, { car: 'subaru-impreza-gc8-555-grpa' }),
    run('Pat', 415000, { car: 'subaru-impreza-gc8-555-grpa' }),
  ];
  const a8 = rankRuns(runs, { view: 'best', group: 'Group A8', carGroup });
  assert.deepEqual(a8.rows.map((x) => [x.pos, x.run.driver, x.run.finish_ms]), [[1, 'Pat', 415000], [2, 'Jane', 420000]]);
  assert.equal(a8.rows[1].diffFirst, 5000);

  const all = rankRuns(runs, { view: 'best', carGroup });
  assert.deepEqual(all.rows.map((x) => [x.run.driver, x.run.finish_ms]), [['Jane', 405000], ['Pat', 415000]]);
});

test('fastest checkpoints can belong to different drivers than the winner', () => {
  const runs = [
    run('A', 408034, { cp1: 141402, cp2: 280118 }),
    run('B', 410500, { cp1: 141390, cp2: 281900 }),
  ];
  const r = rankRuns(runs, { carGroup });
  assert.equal(r.fastestCp1, 141390);
  assert.equal(r.fastestCp2, 280118);
});

test('sectors from cumulative checkpoints', () => {
  assert.deepEqual(sectorsOf({ cp1_ms: 141402, cp2_ms: 280118, finish_ms: 408034 }), [141402, 138716, 127916]);
});

test('many runs: positions are 1..n with no gaps when there are no ties', () => {
  const runs = Array.from({ length: 250 }, (_, i) => run(`D${i}`, 400000 + i * 137));
  const r = rankRuns(runs, { carGroup });
  assert.equal(r.rows.length, 250);
  assert.ok(r.rows.every((x, i) => x.pos === i + 1));
  assert.equal(r.rows.at(-1).diffFirst, 249 * 137);
});

test('source filter: virtual (RBR) vs real (curated label) runs, ranked within the selection', () => {
  const base = { car_id: 'x', cp1_ms: 100000, cp2_ms: 200000, screenshot: null };
  const runs = [
    { ...base, id: 'r1', driver: 'Real One', finish_ms: 400000, uploaded_at: '2026-10-02T23:10:00.000Z', label: 'LSPR 2024' },
    { ...base, id: 'v1', driver: 'Sim One', finish_ms: 450000, uploaded_at: '2026-10-03T01:00:00.000Z' },
    { ...base, id: 'v2', driver: 'Real One', finish_ms: 470000, uploaded_at: '2026-10-03T02:00:00.000Z' },
  ];
  const v = rankRuns(runs, { source: 'virtual' });
  assert.deepEqual(v.rows.map((r) => [r.run.id, r.pos, r.diffFirst]), [['v1', 1, 0], ['v2', 2, 20000]]);
  assert.deepEqual(rankRuns(runs, { source: 'real' }).rows.map((r) => r.run.id), ['r1']);
  assert.deepEqual(rankRuns(runs).rows.map((r) => r.run.id), ['r1', 'v1']);
});

test('realPlacings: place among each real stage, with the runs either side', async () => {
  const { realPlacings } = await import('../shared/rules.js');
  const mk = (id, ms, note) => ({ id, driver: id, finish_ms: ms, uploaded_at: '2026-10-02T23:10:00.000Z', label: 'LSPR 2024', note });
  const runs = [
    mk('a', 400000, 'Real LSPR 2024 SS1 time'), mk('b', 450000, 'Real LSPR 2024 SS1 time'), mk('c', 500000, 'Real LSPR 2024 SS1 time'),
    mk('d', 420000, 'Real LSPR 2024 SS10 time'),
    { id: 'v', driver: 'v', finish_ms: 410000, uploaded_at: '2026-10-03T01:00:00.000Z' },
  ];
  const p = realPlacings(456127, runs);
  assert.deepEqual(p.map((x) => [x.stage, x.place, x.of, x.faster?.id, x.slower?.id]), [['SS1', 3, 3, 'b', 'c'], ['SS10', 2, 1, 'd', undefined]]);
  assert.deepEqual(realPlacings(390000, runs).map((x) => x.place), [1, 1]);
});

test('realPlacings only compares against the same LSPR year', async () => {
  const { realPlacings } = await import('../shared/rules.js');
  const mk = (id, ms, year, stage) => ({ id, driver: id, finish_ms: ms, uploaded_at: '2026-10-10T23:10:00.000Z', label: `LSPR ${year}`, note: `Real LSPR ${year} ${stage} time` });
  const runs = [mk('a', 400000, '2024', 'SS1'), mk('b', 380000, '2026', 'SS12'), mk('c', 500000, '2026', 'SS12')];
  assert.deepEqual(realPlacings(450000, runs).map((x) => [x.stage, x.place, x.of]), [['SS1', 2, 1]]);
  assert.deepEqual(realPlacings(450000, runs, '2026').map((x) => [x.stage, x.place, x.of]), [['SS12', 2, 2]]);
  assert.deepEqual(realPlacings(450000, [mk('a', 400000, '2024', 'SS1')], '2026'), []);
});

test('inSource filters by year and the combined board keeps one best time per driver across years', async () => {
  const { inSource, rankRuns } = await import('../shared/rules.js');
  const mk = (id, driver, ms, year) => ({ id, driver, finish_ms: ms, uploaded_at: '2026-10-10T23:10:00.000Z', label: `LSPR ${year}`, note: `Real LSPR ${year} SS1 time` });
  const a24 = mk('a24', 'Ann Lee', 400000, '2024'), a26 = mk('a26', 'Ann Lee', 390000, '2026'), b24 = mk('b24', 'Bob', 410000, '2024');
  const v = { id: 'v', driver: 'Vic', finish_ms: 420000, uploaded_at: '2026-10-03T01:00:00.000Z' };
  assert.equal(inSource(a26, 'lspr2026'), true);
  assert.equal(inSource(a24, 'lspr2026'), false);
  assert.equal(inSource(a24, 'real'), true);
  assert.equal(inSource(v, 'virtual'), true);
  assert.equal(inSource(v, ''), true);
  const all = rankRuns([a24, a26, b24, v]).rows.map((r) => r.run.id);
  assert.deepEqual(all, ['a26', 'b24', 'v']);
  assert.deepEqual(rankRuns([a24, a26, b24, v], { source: 'lspr2024' }).rows.map((r) => r.run.id), ['a24', 'b24']);
  assert.deepEqual(rankRuns([a24, b24, v], { source: 'lspr2026' }).rows, []);
});

test('theoreticalBest adds the fastest sector of each part, skipping missing ones', async () => {
  const { theoreticalBest } = await import('../shared/rules.js');
  const row = (id, s, up = '2026-10-03T01:00:00.000Z') => ({ run: { id, uploaded_at: up }, sectors: s });
  const t = theoreticalBest([row('a', [150000, 200000, 90000]), row('b', [140000, 210000, null]), row('c', [160000, 190000, 95000])]);
  assert.equal(t.total, 140000 + 190000 + 90000);
  assert.deepEqual(t.parts.map((p) => p.run.id), ['b', 'c', 'a']);
  assert.equal(theoreticalBest([row('b', [140000, null, null])]), null);
});

test('best per car: one row per driver and car, with the gap to the driver\'s own best', async () => {
  const { rankRuns, carKey } = await import('../shared/rules.js');
  const mk = (id, driver, car, ms, extra = {}) => ({ id, driver, car_id: car, car_name: car, finish_ms: ms, uploaded_at: '2026-10-10T20:00:00.000Z', ...extra });
  const runs = [
    mk('a1', 'Ann Lee', 'rally1', 400000), mk('a2', 'Ann Lee', 'rally1', 405000), mk('a3', 'Ann Lee', 'quattro', 406000),
    mk('b1', 'Bob', 'quattro', 403000),
  ];
  const r = rankRuns(runs, { view: 'car' });
  assert.deepEqual(r.rows.map((x) => [x.run.id, x.pos, x.ownGap]), [['a1', 1, 0], ['b1', 2, 0], ['a3', 3, 6000]]);
  assert.deepEqual(rankRuns(runs, { view: 'car', car: 'quattro' }).rows.map((x) => [x.run.id, x.ownGap]), [['b1', 0], ['a3', 0]]);
  assert.deepEqual(rankRuns(runs, { view: 'best' }).rows.map((x) => x.run.id), ['a1', 'b1']);
  assert.deepEqual(rankRuns(runs, { view: 'all', car: 'rally1' }).rows.map((x) => x.run.id), ['a1', 'a2']);
  // real LSPR cars share one placeholder id, so the real car name keeps them apart
  const real = [mk('x1', 'Cy', 'no-rbr-version-4wd', 400000, { car_name: '2015 Subaru WRX' }), mk('x2', 'Cy', 'no-rbr-version-4wd', 410000, { car_name: '2018 Subaru STi' })];
  assert.equal(rankRuns(real, { view: 'car' }).rows.length, 2);
  assert.notEqual(carKey(real[0]), carKey(real[1]));
});

test('car filter accepts a real LSPR car by its carKey', async () => {
  const { rankRuns, carKey } = await import('../shared/rules.js');
  const mk = (id, name, ms) => ({ id, driver: id, car_id: 'no-rbr-version-4wd', car_name: name, finish_ms: ms, uploaded_at: '2026-10-10T20:00:00.000Z' });
  const runs = [mk('a', '2015 Subaru WRX', 400000), mk('b', '2018 Subaru STi', 410000), mk('c', '2015 Subaru WRX', 420000)];
  assert.deepEqual(rankRuns(runs, { view: 'all', car: carKey(runs[0]) }).rows.map((x) => x.run.id), ['a', 'c']);
});

test('sortRows reorders by a column, keeps positions, and puts missing values last', async () => {
  const { sortRows } = await import('../shared/rules.js');
  const mk = (id, finish, cp1, up, driver) => ({ pos: 0, run: { id, finish_ms: finish, cp1_ms: cp1, cp2_ms: null, uploaded_at: up, driver } });
  const rows = [
    mk('a', 400000, 130000, '2026-10-01T00:00:00Z', 'Zed'),
    mk('b', 410000, null, '2026-10-03T00:00:00Z', 'Amy'),
    mk('c', 420000, 120000, '2026-10-02T00:00:00Z', 'Bob'),
  ];
  assert.deepEqual(sortRows(rows, 'cp1', 'asc').map((r) => r.run.id), ['c', 'a', 'b']);
  assert.deepEqual(sortRows(rows, 'cp1', 'desc').map((r) => r.run.id), ['a', 'c', 'b']);
  assert.deepEqual(sortRows(rows, 'uploaded', 'desc').map((r) => r.run.id), ['b', 'c', 'a']);
  assert.deepEqual(sortRows(rows, 'driver', 'asc').map((r) => r.run.id), ['b', 'c', 'a']);
  assert.deepEqual(sortRows(rows, 'cp2', 'asc').map((r) => r.run.id), ['a', 'b', 'c']);
  assert.equal(sortRows(rows, 'nope', 'asc'), rows);
});
