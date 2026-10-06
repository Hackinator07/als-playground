import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLd, readChannel } from '../shared/ld.js';

// Build a tiny log: header, two channels (float speed, int16 gear), their samples.
function makeLd({ n = 4, cut = 0 } = {}) {
  const META = 0x600; const DATA = META + 2 * 124;
  const buf = new ArrayBuffer(DATA + n * 4 + n * 2);
  const dv = new DataView(buf); const u8 = new Uint8Array(buf);
  const put = (off, s) => { for (let i = 0; i < s.length; i += 1) u8[off + i] = s.charCodeAt(i); };
  dv.setUint32(0, 0x40, true); dv.setUint32(8, META, true); dv.setUint32(12, DATA, true); dv.setUint32(86, 2, true);
  put(94, '06/10/2026'); put(158, 'Test driver'); put(222, '5');
  const chan = (at, next, ptr, type, size, name, unit) => {
    dv.setUint32(at + 4, next, true); dv.setUint32(at + 8, ptr, true); dv.setUint32(at + 12, n, true);
    dv.setUint16(at + 18, type, true); dv.setUint16(at + 20, size, true); dv.setUint16(at + 22, 720, true);
    dv.setInt16(at + 28, 1, true); dv.setInt16(at + 26, 1, true);
    put(at + 32, name); put(at + 72, unit);
  };
  chan(META, META + 124, DATA, 7, 4, 'speed', 'km/h');
  chan(META + 124, 0, DATA + n * 4, 3, 2, 'gear', '');
  for (let i = 0; i < n; i += 1) { dv.setFloat32(DATA + i * 4, 10.5 * i, true); dv.setInt16(DATA + n * 4 + i * 2, i + 1, true); }
  return cut ? buf.slice(0, buf.byteLength - cut) : buf;
}

test('reads the header, channels and samples of a log', () => {
  const buf = makeLd();
  const r = parseLd(buf);
  assert.equal(r.ok, true);
  assert.equal(r.info.driver, 'Test driver');
  assert.deepEqual(r.channels.map((c) => c.name), ['speed', 'gear']);
  assert.equal(r.channels[0].unit, 'km/h');
  assert.deepEqual([...readChannel(buf, r.channels[0])], [0, 10.5, 21, 31.5]);
  assert.deepEqual([...readChannel(buf, r.channels[1])], [1, 2, 3, 4]);
});

test('a cut-off log keeps the samples that are there', () => {
  const r = parseLd(makeLd({ cut: 4 }));
  assert.equal(r.ok, true);
  assert.equal(r.channels[1].n, 2);
});

test('things that are not logs are refused', () => {
  assert.equal(parseLd(new ArrayBuffer(10)).ok, false);
  assert.equal(parseLd(new ArrayBuffer(4096)).ok, false);
  assert.equal(parseLd('nope').ok, false);
});
