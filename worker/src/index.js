// Al's Playground submissions Worker (Cloudflare Workers, free plan).
//
// POST /submit  checks one time and, if it's good, commits it to the repo as a
//               new file. It never edits or deletes anything that exists.
// GET  /status  { open: true | false } so the form can say when submissions are closed.
// GET  /time    { now: <ms since epoch> } Cloudflare's NTP-synced clock, for the rally clock on the site.
//
// Settings (Cloudflare dashboard → the Worker → Settings → Variables and Secrets):
//   GITHUB_TOKEN       secret  fine-grained token, this repo only, Contents read/write
//   TURNSTILE_SECRET   secret  the Turnstile widget's secret key
//   HASH_SALT          secret  any long random text (used to hash IPs for rate limits)
//   SUBMISSIONS_OPEN   text    "true" to accept times, anything else closes the form
//   DISCORD_WEBHOOK    secret  optional: post each new time to a Discord channel
// Binding:
//   RATE               KV namespace for rate limits and double-submit protection
// Defaults below (REPO, SITE_URL, ...) can be overridden with text variables of the same name.

import { validateSubmission, formatTime, cleanName } from '../../shared/rules.js';

const DEFAULTS = {
  REPO: 'Hackinator07/als-playground',
  BRANCH: 'main',
  SITE_URL: 'https://hackinator07.github.io/als-playground',
  ALLOWED_ORIGINS: 'https://hackinator07.github.io',
  TURNSTILE_HOSTNAME: 'hackinator07.github.io',
};
const MAX_BODY = 1_000_000;          // bytes; the screenshot is capped at 600 KB before base64
const MAX_IMAGE = 600 * 1024;
const LIMITS = { perHour: 5, perDay: 15, globalPerDay: 200 };

const cfg = (env, k) => (env[k] !== undefined && env[k] !== '' ? env[k] : DEFAULTS[k]);

// ------------------------------------------------------------ entry

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '';
    const allowed = cfg(env, 'ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean);
    const cors = {
      'access-control-allow-origin': allowed.includes(origin) ? origin : allowed[0],
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    };
    const reply = (status, body) => new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET' && url.pathname.replace(/\/+$/, '') === '/status') {
      return reply(200, { open: env.SUBMISSIONS_OPEN === 'true' });
    }
    if (request.method === 'GET' && url.pathname.replace(/\/+$/, '') === '/time') {
      return new Response(JSON.stringify({ now: Date.now() }), {
        status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
      });
    }
    if (request.method !== 'POST' || !['/', '/submit'].includes(url.pathname.replace(/\/+$/, '') || '/')) {
      return reply(404, { ok: false, message: 'Not found.' });
    }
    if (!allowed.includes(origin)) return reply(403, { ok: false, message: 'Submit times from the stage times page.' });

    try {
      return await handleSubmit(request, env, ctx, reply);
    } catch (err) {
      console.error('submit failed', err && err.stack || err);
      return reply(500, { ok: false, message: 'Something went wrong on our side. Try again in a minute.' });
    }
  },
};

// ------------------------------------------------------------ submit

async function handleSubmit(request, env, ctx, reply) {
  if (env.SUBMISSIONS_OPEN !== 'true') return reply(503, { ok: false, message: 'Submissions are closed right now.' });
  if (!env.GITHUB_TOKEN || !env.TURNSTILE_SECRET) return reply(503, { ok: false, message: 'Submissions aren’t set up yet.' });

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY) return reply(413, { ok: false, message: 'That submission is too large. Use a smaller screenshot.' });
  const text = await request.text();
  if (text.length > MAX_BODY) return reply(413, { ok: false, message: 'That submission is too large. Use a smaller screenshot.' });
  let body;
  try { body = JSON.parse(text); } catch { return reply(400, { ok: false, message: 'That didn’t look like a submission.' }); }
  if (!body || typeof body !== 'object') return reply(400, { ok: false, message: 'That didn’t look like a submission.' });

  // Honeypot: a hidden field people never see. Bots fill it in.
  if (body.website) return reply(400, { ok: false, message: 'That didn’t look like a submission.' });

  const ip = request.headers.get('cf-connecting-ip') || '';
  const ts = await verifyTurnstile(env, body.turnstile, ip);
  if (!ts.ok) return reply(403, { ok: false, errors: [{ field: 'turnstile', message: 'The bot check didn’t pass. Try it again.' }] });

  const ipKey = await sha(`${env.HASH_SALT || ''}|${ip}`);
  const limited = await rateLimited(env, ipKey);
  if (limited) return reply(429, { ok: false, message: limited });

  const site = cfg(env, 'SITE_URL').replace(/\/+$/, '');
  const [stage, cars, results] = await Promise.all([
    getJson(`${site}/data/stage.json`), getJson(`${site}/data/cars.json`), getJson(`${site}/results.json`).catch(() => ({ runs: [] })),
  ]);

  const { errors, value } = validateSubmission(body, { stage, cars, existing: results.runs || [] });
  if (errors.length) return reply(400, { ok: false, errors });

  const image = checkImage(body.screenshot);
  if (image.error) return reply(400, { ok: false, errors: [{ field: 'shot', message: image.error }] });

  // Double-submit guard: the board can lag a minute behind, so remember recent saves too.
  const dupKey = `dup:${await sha(`${cleanName(value.driver).toLowerCase()}|${value.car_id}|${value.finish_ms}`)}`;
  if (env.RATE && await env.RATE.get(dupKey)) {
    return reply(400, { ok: false, errors: [{ field: 'finish', message: 'This time is already on the board.' }] });
  }

  const now = new Date();
  const id = randomId();
  const year = now.getUTCFullYear();
  const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, ''); // 2026-10-02T231000Z
  const shotPath = image.data ? `screenshots/${year}/${id}.${image.ext}` : null;
  const record = {
    schema: 1,
    id,
    stage: stage.id || 'als-playground',
    ...value,
    uploaded_at: now.toISOString(),
    screenshot: shotPath,
    status: 'published',
  };
  const files = [{ path: `data/submissions/${year}/${stamp}_${id}.json`, content: JSON.stringify(record, null, 2) + '\n', encoding: 'utf-8' }];
  if (shotPath) files.push({ path: shotPath, content: image.data, encoding: 'base64' });

  await commitFiles(env, files, `New time: ${value.driver}, ${formatTime(value.finish_ms)} (${value.car_name})`);

  if (env.RATE) {
    ctx.waitUntil(Promise.all([
      env.RATE.put(dupKey, '1', { expirationTtl: 86400 }),
      bump(env, `h:${ipKey}:${hourBucket(now)}`, 3600),
      bump(env, `d:${ipKey}:${dayBucket(now)}`, 86400),
      bump(env, `g:${dayBucket(now)}`, 86400),
    ]));
  }
  if (env.DISCORD_WEBHOOK) ctx.waitUntil(notifyDiscord(env, record).catch(() => {}));

  return reply(200, { ok: true, id });
}

// ------------------------------------------------------------ checks

async function verifyTurnstile(env, token, ip) {
  if (typeof token !== 'string' || !token || token.length > 2048) return { ok: false };
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const out = await res.json().catch(() => ({}));
  if (!out.success) return { ok: false };
  const host = cfg(env, 'TURNSTILE_HOSTNAME');
  if (host && out.hostname && out.hostname !== host) return { ok: false };
  return { ok: true };
}

/** Accepts { type: 'webp' | 'jpeg', data: base64 } or null. Only the first bytes are decoded. */
function checkImage(shot) {
  if (shot === null || shot === undefined) return { data: null };
  if (typeof shot !== 'object' || typeof shot.data !== 'string') return { error: 'That screenshot couldn’t be read. Try another image.' };
  const ext = shot.type === 'webp' ? 'webp' : shot.type === 'jpeg' ? 'jpg' : null;
  if (!ext) return { error: 'Use a PNG, JPG or WebP image.' };
  const data = shot.data.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { error: 'That screenshot couldn’t be read. Try another image.' };
  const bytes = Math.floor((data.length * 3) / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  if (bytes > MAX_IMAGE) return { error: 'That screenshot is too large. Crop it and try again.' };
  const head = atob(data.slice(0, 16));
  const okSig = ext === 'webp'
    ? head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP'
    : head.charCodeAt(0) === 0xff && head.charCodeAt(1) === 0xd8 && head.charCodeAt(2) === 0xff;
  if (!okSig) return { error: 'That file isn’t the image it says it is. Try another screenshot.' };
  return { data, ext };
}

async function rateLimited(env, ipKey) {
  if (!env.RATE) return null;
  const now = new Date();
  const [h, d, g] = await Promise.all([
    env.RATE.get(`h:${ipKey}:${hourBucket(now)}`),
    env.RATE.get(`d:${ipKey}:${dayBucket(now)}`),
    env.RATE.get(`g:${dayBucket(now)}`),
  ]);
  if (Number(g || 0) >= LIMITS.globalPerDay) return 'The board has had a lot of times today. Try again tomorrow.';
  if (Number(h || 0) >= LIMITS.perHour) return 'That’s a lot of times in an hour. Try again later.';
  if (Number(d || 0) >= LIMITS.perDay) return 'That’s the most times you can post today. Try again tomorrow.';
  return null;
}

async function bump(env, key, ttl) {
  const n = Number((await env.RATE.get(key)) || 0) + 1;
  await env.RATE.put(key, String(n), { expirationTtl: Math.max(60, ttl) });
}

const hourBucket = (d) => d.toISOString().slice(0, 13);
const dayBucket = (d) => d.toISOString().slice(0, 10);

// ------------------------------------------------------------ GitHub

function gh(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${cfg(env, 'REPO')}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'als-playground-submit',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
}

async function ghJson(env, path, init) {
  const res = await gh(env, path, init);
  if (!res.ok) {
    const err = new Error(`GitHub ${init?.method || 'GET'} ${path}: ${res.status} ${await res.text().catch(() => '')}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** One commit with all files. New paths only; retries once if main moved meanwhile. */
async function commitFiles(env, files, message) {
  const branch = cfg(env, 'BRANCH');
  for (let attempt = 0; attempt < 2; attempt++) {
    const ref = await ghJson(env, `/git/ref/heads/${branch}`);
    const head = ref.object.sha;
    const commit = await ghJson(env, `/git/commits/${head}`);
    const tree = await ghJson(env, '/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: commit.tree.sha,
        tree: await Promise.all(files.map(async (f) => {
          const blob = await ghJson(env, '/git/blobs', { method: 'POST', body: JSON.stringify({ content: f.content, encoding: f.encoding }) });
          return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
        })),
      }),
    });
    const created = await ghJson(env, '/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [head] }),
    });
    const res = await gh(env, `/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: created.sha, force: false }) });
    if (res.ok) return created.sha;
    if (res.status !== 422 || attempt === 1) throw new Error(`GitHub ref update: ${res.status} ${await res.text().catch(() => '')}`);
  }
}

// ------------------------------------------------------------ helpers

async function getJson(url) {
  const res = await fetch(url, { cf: { cacheTtl: 60 } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

async function notifyDiscord(env, r) {
  await fetch(env.DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      content: `New time on Al's Playground: **${r.driver}**, ${formatTime(r.finish_ms)} in the ${r.car_name}${r.screenshot ? ' (with screenshot)' : ''}`,
      allowed_mentions: { parse: [] },
    }),
  });
}
