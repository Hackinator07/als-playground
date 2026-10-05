// Pure helpers for the rally clock (no DOM), so they can be tested.

export const CLOCK_ZONE = 'America/Detroit'; // Eastern Time: Marquette and the whole Upper Peninsula

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: CLOCK_ZONE, hour12: false, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// "08:42:17" for a moment in time, 24-hour, in Marquette's time zone.
export function formatClock(ms, zone = CLOCK_ZONE) {
  const f = zone === CLOCK_ZONE ? fmt : new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hour12: false, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

// samples: [{ sent, received, server }] in ms (sent/received on the device clock, server from the Worker).
// The server stamp is assumed to be taken halfway through the round trip. The sample with the shortest
// round trip is the most trustworthy, so its offset (server minus device) wins.
// Returns { offset, rtt } or null when there is nothing usable.
export function pickOffset(samples) {
  let best = null;
  for (const s of samples || []) {
    if (![s?.sent, s?.received, s?.server].every(Number.isFinite)) continue;
    const rtt = s.received - s.sent;
    if (rtt < 0) continue;
    const offset = s.server - (s.sent + rtt / 2);
    if (!best || rtt < best.rtt) best = { offset, rtt };
  }
  return best;
}

// Milliseconds until the next whole second of the corrected clock (never 0).
export function msToNextSecond(nowMs) {
  const r = 1000 - (((nowMs % 1000) + 1000) % 1000);
  return r;
}
