// Rally clock: Marquette, Michigan time (America/Detroit), shown as a seven-segment readout.
// The device clock is corrected against the Worker's /time (Cloudflare's NTP-synced clock) on load
// and every 10 minutes. If the Worker can't be reached the device clock is used and the label says so.
import { formatClock, pickOffset, msToNextSecond } from './clock-core.js';

const el = document.getElementById('rally-clock');
if (el) {
  const digits = el.querySelector('.clock-digits');
  const status = el.querySelector('.clock-status');
  let offset = 0;
  let synced = false;

  const now = () => Date.now() + offset;

  function draw() {
    digits.textContent = formatClock(now());
    el.dataset.sync = synced ? 'synced' : 'device';
    status.textContent = synced ? 'ET \u00B7 MARQUETTE' : 'ET \u00B7 DEVICE CLOCK';
  }

  function tick() {
    draw();
    setTimeout(tick, msToNextSecond(now()) + 5);
  }

  async function sync(url) {
    const samples = [];
    for (let i = 0; i < 4; i += 1) {
      try {
        const sent = Date.now();
        const res = await fetch(`${url}/time`, { cache: 'no-store' });
        const received = Date.now();
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        samples.push({ sent, received, server: Number(body.now) });
      } catch { /* try again; a failed sample is simply skipped */ }
    }
    const best = pickOffset(samples);
    if (best) { offset = best.offset; synced = true; } else if (!synced) { offset = 0; }
    draw();
  }

  tick();
  fetch(new URL('../../data/stage.json', import.meta.url), { cache: 'no-cache' })
    .then((r) => r.json())
    .then((stage) => {
      const url = String(stage.submit_url || '').replace(/\/+$/, '');
      if (!url) return;
      sync(url);
      setInterval(() => sync(url), 10 * 60 * 1000);
    })
    .catch(() => { /* stays on the device clock */ });
}
