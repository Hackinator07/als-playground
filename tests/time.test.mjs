import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTime, formatTime, formatDiff, formatReadback,
  validateDriver, driverKey, checkTimes, zonedStamp,
} from '../shared/rules.js';

const stage = { min_finish_ms: 300000, max_finish_ms: 1800000 };

test('parseTime accepts the documented forms', () => {
  assert.deepEqual(parseTime('6:48.034'), { ok: true, ms: 408034 });
  assert.deepEqual(parseTime('06:48.034'), { ok: true, ms: 408034 });
  assert.deepEqual(parseTime('6:48,034'), { ok: true, ms: 408034 });
  assert.deepEqual(parseTime('  6:48.034 '), { ok: true, ms: 408034 });
  assert.deepEqual(parseTime('6:48.03'), { ok: true, ms: 408030 });
  assert.deepEqual(parseTime('6:48.5'), { ok: true, ms: 408500 });
  assert.deepEqual(parseTime('0:59.999'), { ok: true, ms: 59999 });
  assert.deepEqual(parseTime('12:00.000'), { ok: true, ms: 720000 });
});

test('parseTime rejects ambiguous or malformed input', () => {
  for (const bad of ['6:48', '6.48.034', '648.034', '6:4.034', '6:61.000', '6:48.0345', '', '   ', 'abc', '-6:48.034', '123:00.000', '6:48.']) {
    assert.equal(parseTime(bad).ok, false, `should reject "${bad}"`);
  }
  assert.match(parseTime('').error, /Enter a time/);
  assert.match(parseTime('6:48').error, /6:48\.034/);
});

test('formatTime always shows thousandths', () => {
  assert.equal(formatTime(408034), '6:48.034');
  assert.equal(formatTime(130258), '2:10.258');
  assert.equal(formatTime(5007), '0:05.007');
  assert.equal(formatTime(600000), '10:00.000');
});

test('formatDiff matches the RSF style', () => {
  assert.equal(formatDiff(0), '00.000');
  assert.equal(formatDiff(444), '00.444');
  assert.equal(formatDiff(1693), '01.693');
  assert.equal(formatDiff(13231), '13.231');
  assert.equal(formatDiff(59999), '59.999');
  assert.equal(formatDiff(60000), '1:00.000');
  assert.equal(formatDiff(64086), '1:04.086');
});

test('round trip: parse(format(x)) === x', () => {
  for (const ms of [0, 1, 59999, 60000, 408034, 1799999]) {
    assert.equal(parseTime(formatTime(ms)).ms, ms);
  }
});

test('formatReadback', () => {
  assert.equal(formatReadback(408034), '6 min 48.034 s');
  assert.equal(formatReadback(408500), '6 min 48.500 s');
});

test('driver names', () => {
  assert.equal(validateDriver('Jane Driver'), null);
  assert.equal(validateDriver('Žarnowski Łukasz'), null);
  assert.equal(validateDriver("O'Neil-Smith_2.0"), null);
  assert.equal(validateDriver('J'), 'Name must be 2–32 characters.');
  assert.equal(validateDriver('x'.repeat(33)), 'Name must be 2–32 characters.');
  assert.match(validateDriver('see www.spam.com'), /links/);
  assert.match(validateDriver('<b>hi</b>'), /links/);
  assert.match(validateDriver('Jane 🚗'), /letters/);
  assert.equal(driverKey('  Jane   DRIVER '), driverKey('jane driver'));
});

test('checkTimes: order and bounds', () => {
  assert.deepEqual(checkTimes({ cp1_ms: 141402, cp2_ms: 280118, finish_ms: 408034 }, stage), []);
  assert.equal(checkTimes({ cp1_ms: 280118, cp2_ms: 141402, finish_ms: 408034 }, stage)[0].field, 'cp2');
  assert.equal(checkTimes({ cp1_ms: 100, cp2_ms: 500, finish_ms: 400 }, stage)[0].field, 'finish');
  assert.match(checkTimes({ cp1_ms: 100000, cp2_ms: 200000, finish_ms: 299999 }, stage)[0].message, /faster/);
  assert.match(checkTimes({ cp1_ms: 100000, cp2_ms: 200000, finish_ms: 1800001 }, stage)[0].message, /longer/);
  assert.deepEqual(checkTimes({ cp1_ms: 100000, cp2_ms: 200000, finish_ms: 300000 }, stage), []);
});

test('Central time: summer is CDT (UTC−5)', () => {
  const s = zonedStamp('2026-10-02T21:05:33.412Z');
  assert.deepEqual(s, { date: '2026-10-02', time: '16:05:33', zone: 'CDT', offset: 'UTC−5', utc: '21:05:33 UTC' });
});

test('Central time: winter is CST (UTC−6)', () => {
  const s = zonedStamp('2026-12-15T03:00:00.000Z');
  assert.equal(s.date, '2026-12-14');
  assert.equal(s.time, '21:00:00');
  assert.equal(s.zone, 'CST');
  assert.equal(s.offset, 'UTC−6');
});

test('Central time: the repeated hour on 1 Nov 2026', () => {
  const first = zonedStamp('2026-11-01T06:30:00Z');
  const second = zonedStamp('2026-11-01T07:30:00Z');
  assert.equal(first.time, '01:30:00');
  assert.equal(second.time, '01:30:00');
  assert.equal(first.zone, 'CDT');
  assert.equal(second.zone, 'CST');
});

test('Central time: spring forward on 8 Mar 2026', () => {
  assert.equal(zonedStamp('2026-03-08T07:59:59Z').time, '01:59:59');
  assert.equal(zonedStamp('2026-03-08T08:00:00Z').time, '03:00:00');
  assert.equal(zonedStamp('2026-03-08T08:00:00Z').zone, 'CDT');
});
