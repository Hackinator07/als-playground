import test from 'node:test';
import assert from 'node:assert/strict';
import { diffTunes, sameValue, formatValue, formatDelta } from '../shared/tune-diff.js';
import { renderComparePage, renderLibrary } from '../scripts/tunes.mjs';

const mk = (sections) => ({ sections, order: Object.keys(sections), count: 0 });

test('sameValue treats equal numbers and lists as the same', () => {
  assert.ok(sameValue(1, 1));
  assert.ok(sameValue([1, 2], [1, 2]));
  assert.ok(!sameValue([1, 2], [1, 3]));
  assert.ok(!sameValue(1, undefined));
  assert.ok(sameValue(undefined, undefined));
});

test('diffTunes lists every setting and flags the ones that differ', () => {
  const a = mk({ Car: { FrontRollBarStiffness: 100, RearRollBarStiffness: 50 } });
  const b = mk({ Car: { FrontRollBarStiffness: 120, RearRollBarStiffness: 50, Extra: 1 } });
  const d = diffTunes(a, b);
  assert.equal(d.total, 3);
  assert.equal(d.differing, 2);
  const rows = d.sections[0].rows;
  assert.deepEqual(rows.map((r) => [r.key, r.same]), [['FrontRollBarStiffness', false], ['RearRollBarStiffness', true], ['Extra', false]]);
  assert.equal(rows[2].a, undefined);
});

test('formatValue and formatDelta use the same units as the tune pages', () => {
  assert.equal(formatValue('SpringStiffness', 45000), '45 kN/m');
  assert.equal(formatValue('Pressure', 160000), '160 kPa');
  assert.equal(formatValue('Missing', undefined), '—');
  assert.equal(formatDelta('SpringLength', 0.25, 0.2525), '+2.5 mm');
  assert.equal(formatDelta('SpringLength', 0.25, 0.2475), '−2.5 mm');
  assert.equal(formatDelta('X', 1, 1), '');
  assert.equal(formatDelta('X', [1], [2]), '');
});

test('compare page and library link to each other', () => {
  assert.match(renderComparePage(), /id="c-a"/);
  assert.match(renderLibrary([], []), /href="compare\/"/);
});
