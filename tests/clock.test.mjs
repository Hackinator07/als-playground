import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, pickOffset, msToNextSecond } from '../site/assets/js/clock-core.js';

test('formatClock shows Marquette (Eastern) time, 24-hour, with daylight saving', () => {
  assert.equal(formatClock(Date.UTC(2026, 9, 5, 17, 2, 9)), '13:02:09');   // EDT, UTC-4
  assert.equal(formatClock(Date.UTC(2026, 11, 5, 17, 2, 9)), '12:02:09');  // EST, UTC-5
  assert.equal(formatClock(Date.UTC(2026, 9, 5, 4, 0, 0)), '00:00:00');    // midnight, not 24:00
});

test('pickOffset uses the shortest round trip', () => {
  const r = pickOffset([
    { sent: 1000, received: 1400, server: 5200 },  // rtt 400, offset 5200-1200 = 4000
    { sent: 2000, received: 2040, server: 6020 },  // rtt 40,  offset 6020-2020 = 4000
    { sent: 3000, received: 3010, server: 7005 },  // rtt 10,  offset 7005-3005 = 4000
  ]);
  assert.deepEqual(r, { offset: 4000, rtt: 10 });
});

test('pickOffset ignores bad samples', () => {
  assert.equal(pickOffset([]), null);
  assert.equal(pickOffset([{ sent: 5, received: 1, server: 3 }, { sent: 1, received: 2, server: NaN }]), null);
  assert.equal(pickOffset(null), null);
});

test('msToNextSecond is between 1 and 1000', () => {
  assert.equal(msToNextSecond(10_250), 750);
  assert.equal(msToNextSecond(10_000), 1000);
});
