import test from 'node:test';
import assert from 'node:assert/strict';
import { injectSocial, SITE_URL } from '../scripts/social.mjs';

const page = '<!doctype html><html><head><title>Tune &amp; Co · Al\'s Playground</title><meta name="description" content="Jason &quot;J&quot; Hack&#39;s setup"></head><body></body></html>';

test('adds preview tags from the page title and description, escaped', () => {
  const out = injectSocial(page, 'tunes/ab12cd34/index.html');
  assert.match(out, /property="og:title" content="Tune &amp; Co · Al's Playground"/);
  assert.match(out, /property="og:description" content="Jason &quot;J&quot; Hack's setup"/);
  assert.match(out, new RegExp(`property="og:url" content="${SITE_URL}/tunes/ab12cd34/"`));
  assert.match(out, new RegExp(`property="og:image" content="${SITE_URL}/assets/img/preview.png"`));
  assert.match(out, /name="twitter:card" content="summary_large_image"/);
  assert.ok(out.indexOf('og:title') < out.indexOf('</head>'));
});

test('leaves a page alone that already has preview tags or no title', () => {
  const done = injectSocial(page, 'index.html');
  assert.equal(injectSocial(done, 'index.html'), done);
  assert.equal(injectSocial('<head></head>', 'index.html'), '<head></head>');
});

test('the home page URL has no index.html', () => {
  assert.match(injectSocial(page, 'index.html'), new RegExp(`og:url" content="${SITE_URL}/"`));
});
