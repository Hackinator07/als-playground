// Reads MoTeC i2 data logs (.ld files), as written by the RBR NGP telemetry plugin.
// Runs in the browser (the telemetry page) and in Node (the tests). Nothing here ever leaves the machine.
//
// File shape (little endian):
//   header   marker 0x40, pointer to the first channel record (@8), pointer to the sample data (@12),
//            date / time / driver / vehicle / venue text, number of channels (@86)
//   channel  a linked list of 124-byte records: previous, next, data pointer, sample count,
//            data type, sample size, sample rate, scaling, name, short name, unit
//   samples  every channel's samples stored back to back at its data pointer
//
// Channels are only decoded when asked for (readChannel), so a big file costs memory for one copy of the file
// and a small amount for each channel actually drawn.

export const LD_MAX_CHANNELS = 2000;
const REC = 124;

const text = (u8, start, len) => {
  let end = start;
  const stop = start + len;
  while (end < stop && u8[end] !== 0) end += 1;
  let s = '';
  for (let i = start; i < end; i += 1) s += String.fromCharCode(u8[i]);
  return s.trim();
};

function half(h) {
  const s = (h & 0x8000) ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 5.960464477539063e-8 * f;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/**
 * Open a log. buf is an ArrayBuffer.
 * Returns { ok: true, info, channels } or { ok: false, error }.
 * info = { date, time, driver, vehicle, venue, device, declared }
 * channel = { name, short, unit, freq, n, type, size, ptr, shift, mul, scale, dec }
 */
export function parseLd(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 0x600) return { ok: false, error: 'That file is too small to be a MoTeC log.' };
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  if (dv.getUint32(0, true) !== 0x40) return { ok: false, error: 'That doesn’t look like a MoTeC .ld log (the header is wrong).' };
  const metaPtr = dv.getUint32(8, true);
  const declared = dv.getUint32(86, true);
  const info = {
    device: text(u8, 74, 8),
    declared,
    date: text(u8, 94, 16),
    time: text(u8, 126, 16),
    driver: text(u8, 158, 64),
    vehicle: text(u8, 222, 64),
    venue: text(u8, 350, 64),
  };
  if (!metaPtr || metaPtr + REC > buf.byteLength) return { ok: false, error: 'That log has no channels in it.' };

  const channels = [];
  const seen = new Set();
  let p = metaPtr;
  while (p && p + REC <= buf.byteLength && channels.length < LD_MAX_CHANNELS && !seen.has(p)) {
    seen.add(p);
    const next = dv.getUint32(p + 4, true);
    const ptr = dv.getUint32(p + 8, true);
    let n = dv.getUint32(p + 12, true);
    const type = dv.getUint16(p + 18, true);
    const size = dv.getUint16(p + 20, true);
    const freq = dv.getUint16(p + 22, true);
    const okShape = (type === 7 && (size === 4 || size === 2)) || (type !== 7 && (size === 2 || size === 4 || size === 1));
    if (okShape && freq > 0 && ptr > 0) {
      if (ptr + n * size > buf.byteLength) n = Math.max(0, Math.floor((buf.byteLength - ptr) / size)); // cut-off file
      if (n > 0) {
        channels.push({
          name: text(u8, p + 32, 32),
          short: text(u8, p + 64, 8),
          unit: text(u8, p + 72, 12),
          freq, n, type, size, ptr,
          shift: dv.getInt16(p + 24, true),
          mul: dv.getInt16(p + 26, true),
          scale: dv.getInt16(p + 28, true),
          dec: dv.getInt16(p + 30, true),
        });
      }
    }
    p = next;
  }
  if (!channels.length) return { ok: false, error: 'No readable channels were found in that log.' };
  return { ok: true, info, channels };
}

/** Samples of one channel as a Float32Array (integers are scaled the way MoTeC does). */
export function readChannel(buf, ch) {
  const out = new Float32Array(ch.n);
  const aligned = ch.ptr % ch.size === 0;
  if (ch.type === 7 && ch.size === 4 && aligned) return new Float32Array(buf, ch.ptr, ch.n).slice();
  const dv = new DataView(buf);
  if (ch.type === 7) {
    for (let i = 0; i < ch.n; i += 1) out[i] = ch.size === 4 ? dv.getFloat32(ch.ptr + i * 4, true) : half(dv.getUint16(ch.ptr + i * 2, true));
    return out;
  }
  const scale = ch.scale || 1;
  const mul = ch.mul || 1;
  const k = (mul / scale) * 10 ** -ch.dec;
  const plain = k === 1 && ch.shift === 0;
  for (let i = 0; i < ch.n; i += 1) {
    const raw = ch.size === 4 ? dv.getInt32(ch.ptr + i * 4, true) : ch.size === 2 ? dv.getInt16(ch.ptr + i * 2, true) : dv.getInt8(ch.ptr + i);
    out[i] = plain ? raw : raw * k + ch.shift;
  }
  return out;
}
