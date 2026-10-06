// Tests the bundled Worker (worker/dist/worker.js, the file pasted into Cloudflare)
// with GitHub, Turnstile and the site faked in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkStoredRun } from '../shared/rules.js';

const worker = (await import('../worker/dist/worker.js')).default;
const stage = JSON.parse(fs.readFileSync(new URL('../data/stage.json', import.meta.url)));
const cars = JSON.parse(fs.readFileSync(new URL('../data/cars.json', import.meta.url)));
const carIds = new Set(cars.cars.map((c) => c.id));

const ORIGIN = 'https://hackinator07.github.io';
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(200)]).toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100)]).toString('base64');

function fakeWorld({ turnstileOk = true, existing = [], conflictOnce = false } = {}) {
  const world = { blobs: [], trees: [], commits: [], patches: 0, conflict: conflictOnce, head: 'c0' };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('turnstile/v0/siteverify')) return json(200, { success: turnstileOk, hostname: 'hackinator07.github.io' });
    if (u.endsWith('/data/stage.json')) return json(200, stage);
    if (u.endsWith('/data/cars.json')) return json(200, cars);
    if (u.endsWith('/results.json')) return json(200, { runs: existing });
    if (u.startsWith('https://api.github.com/repos/Hackinator07/als-playground')) {
      assert.match(init.headers.authorization, /^Bearer tok$/);
      const p = u.replace('https://api.github.com/repos/Hackinator07/als-playground', '');
      const body = init.body ? JSON.parse(init.body) : null;
      if (p === '/git/ref/heads/main') return json(200, { object: { sha: world.head } });
      if (p.startsWith('/git/commits/')) return json(200, { tree: { sha: 't0' } });
      if (p === '/git/blobs') { world.blobs.push(body); return json(201, { sha: `b${world.blobs.length}` }); }
      if (p === '/git/trees') { world.trees.push(body); return json(201, { sha: 't1' }); }
      if (p === '/git/commits') { world.commits.push(body); return json(201, { sha: `c${world.commits.length}` }); }
      if (p === '/git/refs/heads/main') {
        world.patches++;
        assert.equal(body.force, false);
        if (world.conflict) { world.conflict = false; world.head = 'c-other'; return json(422, { message: 'Update is not a fast forward' }); }
        return json(200, {});
      }
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return world;
}

function kv() {
  const m = new Map();
  return { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, _m: m };
}

function env(extra = {}) {
  return { GITHUB_TOKEN: 'tok', TURNSTILE_SECRET: 'sec', HASH_SALT: 'salt', SUBMISSIONS_OPEN: 'true', RATE: kv(), ...extra };
}

async function call(e, { method = 'POST', path = '/submit', origin = ORIGIN, body, ip = '203.0.113.9' } = {}) {
  const pending = [];
  const headers = { origin, 'cf-connecting-ip': ip };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const req = new Request(`https://als-submit.example.workers.dev${path}`, {
    method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const res = await worker.fetch(req, e, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const good = (over = {}) => ({
  driver: 'Jane Driver', car_id: 'skoda-fabia-rs-rally2', cp1: '2:21.402', cp2: '4:40.118', finish: '6:48.034',
  consent: true, website: '', turnstile: 'token', screenshot: null, ...over,
});

test('time endpoint returns the Worker clock, uncached, with CORS', async () => {
  fakeWorld();
  const before = Date.now();
  const r = await call(env(), { method: 'GET', path: '/time' });
  assert.equal(r.status, 200);
  assert.ok(r.body.now >= before && r.body.now <= Date.now());
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
});

test('status and preflight', async () => {
  fakeWorld();
  assert.deepEqual((await call(env(), { method: 'GET', path: '/status' })).body, { open: true });
  assert.deepEqual((await call(env({ SUBMISSIONS_OPEN: 'false' }), { method: 'GET', path: '/status' })).body, { open: false });
  const pre = await call(env(), { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
});

test('a good time is committed as one new file, and passes the build check', async () => {
  const w = fakeWorld();
  const r = await call(env(), { body: good() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.match(r.body.id, /^[a-z0-9]{8}$/);
  assert.equal(w.blobs.length, 1);
  assert.equal(w.patches, 1);
  const entry = w.trees[0].tree[0];
  assert.match(entry.path, new RegExp(`^data/submissions/\\d{4}/\\d{4}-\\d\\d-\\d\\dT\\d{6}Z_${r.body.id}\\.json$`));
  assert.equal(w.trees[0].base_tree, 't0');
  assert.deepEqual(w.commits[0].parents, ['c0']);
  const rec = JSON.parse(w.blobs[0].content);
  assert.equal(checkStoredRun(rec, carIds, stage), null);
  assert.equal(rec.finish_ms, 408034);
  assert.equal(rec.car_name, 'Skoda Fabia RS Rally2');
  assert.deepEqual(rec.entered, { cp1: '2:21.402', cp2: '4:40.118', finish: '6:48.034' });
  assert.equal(rec.screenshot, null);
  assert.ok(!('turnstile' in rec) && !('website' in rec) && !('consent' in rec));
});

const TUNE = fs.readFileSync(new URL('./fixtures/gravel_gem_GDA_AlsPlayground.lsp', import.meta.url), 'utf8');

test('a car tune goes in the same commit, saved exactly as sent', async () => {
  const w = fakeWorld();
  const r = await call(env(), { body: good({ tune: { name: 'My Tune', text: TUNE } }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(w.commits.length, 1);
  assert.equal(w.blobs.length, 2);
  const tuneEntry = w.trees[0].tree.find((t) => t.path.startsWith('tunes/'));
  assert.match(tuneEntry.path, new RegExp(`^tunes/\\d{4}/${r.body.id}\\.lsp$`));
  const blob = w.blobs[w.trees[0].tree.indexOf(tuneEntry)];
  assert.equal(blob.content, TUNE);
  const rec = JSON.parse(w.blobs[0].content);
  assert.deepEqual(rec.tune, { file: tuneEntry.path, name: 'My Tune' });
  assert.equal(checkStoredRun(rec, carIds, stage), null);
});

test('the tune is optional: without one nothing changes', async () => {
  const w = fakeWorld();
  for (const tune of [undefined, null]) {
    const r = await call(env(), { body: good({ tune, driver: `Jane ${tune === null ? 'Null' : 'Undef'}` }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  assert.ok(w.trees.every((t) => t.tree.length === 1));
  assert.ok(w.blobs.every((b) => !('tune' in JSON.parse(b.content))));
});

test('a bad tune is refused and nothing is saved', async () => {
  const w = fakeWorld();
  for (const tune of [{ name: 'x', text: 'hello' }, { name: 'x', text: TUNE.replace('0.751000', 'nope') }, { name: 'x', text: 'a'.repeat(70000) }, { name: 5, text: TUNE }, 'text', { name: 'x' }]) {
    const r = await call(env(), { body: good({ tune }) });
    assert.equal(r.status, 400, JSON.stringify(tune).slice(0, 40));
    assert.equal(r.body.errors[0].field, 'tune');
  }
  assert.equal(w.commits.length, 0);
});

test('tune names are cleaned before they are saved', async () => {
  const w = fakeWorld();
  const r = await call(env(), { body: good({ tune: { name: 'C:\\Games\\E<v>il.lsp', text: TUNE } }) });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(w.blobs[0].content).tune.name, 'E_v_il');
});

test('a screenshot goes in the same commit', async () => {
  const w = fakeWorld();
  const r = await call(env(), { body: good({ screenshot: { type: 'webp', data: WEBP } }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(w.commits.length, 1);
  const paths = w.trees[0].tree.map((t) => t.path);
  assert.ok(paths.includes(`screenshots/${new Date().getUTCFullYear()}/${r.body.id}.webp`));
  const shotBlob = w.blobs.find((b) => b.encoding === 'base64');
  assert.equal(shotBlob.content, WEBP);
  const rec = JSON.parse(w.blobs.find((b) => b.encoding === 'utf-8').content);
  assert.equal(rec.screenshot, `screenshots/${new Date().getUTCFullYear()}/${r.body.id}.webp`);
});

test('rejects: wrong origin, closed, honeypot, bot check, bad times, bad image, too big', async () => {
  let w = fakeWorld();
  assert.equal((await call(env(), { origin: 'https://evil.example', body: good() })).status, 403);
  assert.equal((await call(env({ SUBMISSIONS_OPEN: 'false' }), { body: good() })).status, 503);
  assert.equal((await call(env(), { body: good({ website: 'http://spam' }) })).status, 400);
  assert.equal((await call(env(), { body: 'not json' })).status, 400);

  w = fakeWorld({ turnstileOk: false });
  const bot = await call(env(), { body: good() });
  assert.equal(bot.status, 403);
  assert.equal(bot.body.errors[0].field, 'turnstile');

  w = fakeWorld();
  const swapped = await call(env(), { body: good({ cp1: '4:40.118', cp2: '2:21.402' }) });
  assert.equal(swapped.status, 400);
  assert.equal(swapped.body.errors[0].field, 'cp2');
  const fmt = await call(env(), { body: good({ finish: '6:48' }) });
  assert.equal(fmt.body.errors[0].field, 'finish');
  const nocar = await call(env(), { body: good({ car_id: 'batmobile' }) });
  assert.equal(nocar.body.errors[0].field, 'car');
  const noconsent = await call(env(), { body: good({ consent: 'yes' }) });
  assert.equal(noconsent.body.errors[0].field, 'consent');

  const png = await call(env(), { body: good({ screenshot: { type: 'webp', data: PNG } }) });
  assert.equal(png.status, 400);
  assert.equal(png.body.errors[0].field, 'shot');
  const huge = await call(env(), { body: good({ screenshot: { type: 'webp', data: WEBP + 'A'.repeat(900000) } }) });
  assert.equal(huge.status, 400);
  const tooBig = await call(env(), { body: JSON.stringify(good({ pad: 'x'.repeat(1_100_000) })) });
  assert.equal(tooBig.status, 413);

  assert.equal(w.commits.length, 0, 'nothing rejected may be committed');
});

test('duplicates: already on the board, or just submitted', async () => {
  let w = fakeWorld({ existing: [{ driver: 'jane  driver', car_id: 'skoda-fabia-rs-rally2', finish_ms: 408034 }] });
  const onBoard = await call(env(), { body: good() });
  assert.equal(onBoard.status, 400);
  assert.match(onBoard.body.errors[0].message, /already on the board/);
  assert.equal(w.commits.length, 0);

  w = fakeWorld();
  const e = env();
  assert.equal((await call(e, { body: good() })).status, 200);
  const again = await call(e, { body: good() });
  assert.equal(again.status, 400);
  assert.equal(w.commits.length, 1);
});

test('rate limit: 5 per hour from one visitor, others unaffected', async () => {
  fakeWorld();
  const e = env();
  for (let i = 0; i < 5; i++) {
    const r = await call(e, { body: good({ finish: `6:5${i}.000` }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const sixth = await call(e, { body: good({ finish: '6:59.000' }) });
  assert.equal(sixth.status, 429);
  const other = await call(e, { body: good({ finish: '6:59.000' }), ip: '198.51.100.7' });
  assert.equal(other.status, 200);
});

test('if main moved during the commit, it retries once on the new head', async () => {
  const w = fakeWorld({ conflictOnce: true });
  const r = await call(env(), { body: good() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(w.patches, 2);
  assert.deepEqual(w.commits[1].parents, ['c-other']);
});

test('not set up yet: no token means a friendly 503, nothing written', async () => {
  const w = fakeWorld();
  const r = await call(env({ GITHUB_TOKEN: '' }), { body: good() });
  assert.equal(r.status, 503);
  assert.equal(w.commits.length, 0);
});
