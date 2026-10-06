import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('site/guide/index.html', 'utf8');

test('guide page: contents links all point at real sections', () => {
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  const links = [...html.matchAll(/<a href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(links.length >= 8);
  for (const l of links) assert.ok(ids.has(l), `missing section #${l}`);
});

test('guide page: ids are unique and the PDF it links to exists', () => {
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
  const pdf = html.match(/href="\.\.\/(assets\/downloads\/[^"]+\.pdf)"/)[1];
  assert.ok(fs.statSync(`site/${pdf}`).size > 10_000);
});

test('leaderboard footer links to the guide', () => {
  assert.match(fs.readFileSync('site/index.html', 'utf8'), /href="guide\/"/);
});
