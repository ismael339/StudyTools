// Checks everything about the weekly newsletter that needs no network and no
// credentials: the unsubscribe token, the ISO week key that identifies one
// send, the recipient merge and the rendered email.
//
//   node scripts/newsletter-check.mjs     (or: npm run newsletter:check)

import assert from 'node:assert';
import {
  signUnsubscribe,
  verifyUnsubscribe,
  normaliseEmail,
  isEmailLike,
  isoWeekNumber,
  weekKeyOf,
  maskEmail,
  mergeRecipients,
  tipOfWeek,
  renderWeeklyEmail,
  renderWelcomeEmail,
  renderDripEmail,
  DRIP_DELAYS_DAYS,
  MAX_DRIP_STEP,
  dripDueAt
} from '../lib/newsletter.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

test('an unsubscribe token verifies back to the same address', function () {
  const cases = ['reader@example.com', 'First.Last+tag@Sub.Domain.es', 'alumno@correos.es'];
  for (const email of cases) {
    assert.strictEqual(verifyUnsubscribe(signUnsubscribe(email)), normaliseEmail(email));
  }
});

test('a tampered or foreign token is rejected', function () {
  const token = signUnsubscribe('reader@example.com');
  assert.strictEqual(verifyUnsubscribe(''), null);
  assert.strictEqual(verifyUnsubscribe('garbage'), null);
  assert.strictEqual(verifyUnsubscribe(token + 'x'), null);
  const withoutMac = token.split('.')[0];
  assert.strictEqual(verifyUnsubscribe(withoutMac), null);
  const mac = token.split('.')[1];
  const other = Buffer.from('attacker@example.com', 'utf8').toString('base64url') + '.' + mac;
  assert.strictEqual(verifyUnsubscribe(other), null);
});

test('addresses are normalised before signing', function () {
  assert.strictEqual(normaliseEmail('  USER@X.COM '), 'user@x.com');
  assert.ok(isEmailLike('a@b.co'));
  assert.ok(!isEmailLike('a@b'));
  assert.ok(!isEmailLike('not-an-email'));
});

test('the ISO week key is stable and unique across years', function () {
  assert.strictEqual(weekKeyOf(new Date('2026-10-05T12:00:00Z')), '2026-W41');
  assert.strictEqual(weekKeyOf(new Date('2026-01-01T12:00:00Z')), '2026-W01');
  assert.strictEqual(isoWeekNumber(new Date('2026-10-05T12:00:00Z')), 41);
  // 29-31 December 2025 belong to ISO week 1 of 2026: one week, one key.
  assert.strictEqual(weekKeyOf(new Date('2025-12-29T12:00:00Z')), '2026-W01');
  assert.strictEqual(weekKeyOf(new Date('2025-12-31T12:00:00Z')), '2026-W01');
  // the same numbered week in two different years never shares a key
  assert.notStrictEqual(weekKeyOf(new Date('2025-12-22T12:00:00Z')), weekKeyOf(new Date('2026-12-21T12:00:00Z')));
});

test('subscribers and accounts merge into one list without duplicates', function () {
  const merged = mergeRecipients({
    subscribers: ['a@x.com', 'B@x.com'],
    registered: ['b@x.com', 'c@y.com', 'not-an-email'],
    excluded: ['c@y.com']
  });
  assert.deepStrictEqual(merged.map(function (r) { return r.email; }), ['a@x.com', 'b@x.com']);
  assert.deepStrictEqual(merged[1].sources, ['subscriber', 'account']);
});

test('the mask hides the mailbox', function () {
  assert.strictEqual(maskEmail('ismael@gmail.com'), 'is***@gmail.com');
  assert.strictEqual(maskEmail('broken'), '***');
});

test('the tip rotates every week', function () {
  assert.notStrictEqual(tipOfWeek(41).title, tipOfWeek(42).title);
  assert.strictEqual(tipOfWeek(41).title, tipOfWeek(41 + 6).title);
});

test('the weekly email renders with links, tip and unsubscribe', function () {
  const rendered = renderWeeklyEmail(new Date('2026-10-05T09:00:00Z'));
  assert.ok(rendered.subject.indexOf('StudyTools week 41') === 0, 'subject: ' + rendered.subject);
  const html = rendered.htmlFor('reader@example.com');
  const text = rendered.textFor('reader@example.com');
  assert.ok(html.indexOf('/api/subscribe?u=') > 0, 'missing unsubscribe link');
  assert.ok(html.indexOf('/pro.html') > 0 && html.indexOf('/drill.html') > 0 && html.indexOf('/planner.html') > 0, 'missing tool links');
  assert.ok(html.indexOf(rendered.tip.title) > 0, 'missing tip');
  assert.ok(html.indexOf('{{') === -1, 'no template placeholders may remain');
  assert.strictEqual((html.match(/<div/g) || []).length, (html.match(/<\/div>/g) || []).length, 'div tags must balance');
  assert.ok(text.indexOf('Unsubscribe') > 0, 'text version needs the unsubscribe link');
});

test('the unsubscribe link inside a rendered email verifies', function () {
  const rendered = renderWeeklyEmail(new Date('2026-10-05T09:00:00Z'));
  const html = rendered.htmlFor('reader@example.com');
  const match = html.match(/\/api\/subscribe\?u=([^"&]+)/);
  assert.ok(match, 'link not found');
  assert.strictEqual(verifyUnsubscribe(decodeURIComponent(match[1])), 'reader@example.com');
});

test('the drip cadence: welcome now, then +1, +3 and +6 days', function () {
  assert.deepStrictEqual(DRIP_DELAYS_DAYS, [0, 1, 3, 6]);
  assert.strictEqual(MAX_DRIP_STEP, 3);
  const start = Date.parse('2026-10-05T09:00:00Z');
  assert.strictEqual(dripDueAt('2026-10-05T09:00:00Z', 0), start);
  assert.strictEqual(dripDueAt('2026-10-05T09:00:00Z', 1), start + 86400000);
  assert.strictEqual(dripDueAt('2026-10-05T09:00:00Z', 2), start + 3 * 86400000);
  assert.strictEqual(dripDueAt('2026-10-05T09:00:00Z', 3), start + 6 * 86400000);
  assert.strictEqual(dripDueAt('not-a-date', 1), null);
  assert.strictEqual(dripDueAt('2026-10-05T09:00:00Z', 99), null);
});

test('the welcome email is drip step 0 and carries an unsubscribe link', function () {
  const welcome = renderWelcomeEmail();
  assert.ok(welcome, 'welcome template missing');
  assert.strictEqual(welcome.step, 0);
  const html = welcome.htmlFor('reader@example.com');
  const text = welcome.textFor('reader@example.com');
  assert.ok(welcome.subject.indexOf('Welcome') >= 0, 'subject: ' + welcome.subject);
  assert.ok(html.indexOf('/api/subscribe?u=') > 0, 'missing unsubscribe link');
  assert.ok(html.indexOf('{{') === -1, 'no template placeholders may remain');
  assert.ok(text.indexOf('Unsubscribe') > 0, 'text version needs the unsubscribe link');
  const match = html.match(/\/api\/subscribe\?u=([^"&]+)/);
  assert.ok(match, 'link not found');
  assert.strictEqual(verifyUnsubscribe(decodeURIComponent(match[1])), 'reader@example.com');
});

test('every drip step renders its own subject, links and unsubscribe', function () {
  for (let step = 0; step <= MAX_DRIP_STEP; step++) {
    const rendered = renderDripEmail(step);
    assert.ok(rendered, 'missing step ' + step);
    assert.strictEqual(rendered.step, step);
    const html = rendered.htmlFor('reader@example.com');
    const text = rendered.textFor('reader@example.com');
    assert.ok(rendered.subject.length > 10, 'subject too short on step ' + step);
    assert.ok(html.indexOf('studytools.pro') > 0, 'site links missing on step ' + step);
    assert.ok(html.indexOf('{{') === -1, 'placeholder left in step ' + step);
    assert.strictEqual((html.match(/<div/g) || []).length, (html.match(/<\/div>/g) || []).length, 'div tags must balance on step ' + step);
    assert.ok(text.indexOf('Unsubscribe') > 0, 'text unsubscribe missing on step ' + step);
    const match = html.match(/\/api\/subscribe\?u=([^"&]+)/);
    assert.ok(match, 'unsubscribe link missing on step ' + step);
    assert.strictEqual(verifyUnsubscribe(decodeURIComponent(match[1])), 'reader@example.com');
  }
  assert.strictEqual(renderDripEmail(99), null, 'a missing step must return null');
});

console.log('\n' + passed + ' checks passed.');
