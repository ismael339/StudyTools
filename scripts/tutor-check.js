// Checks everything about the StudyTools AI tutor core that needs no network
// and no credentials: the student profile schema, the coach memory decoding,
// the orchestrator prompt and the tagged reply protocol.
//
//   node scripts/tutor-check.js     (or: npm run tutor:check)

import assert from 'node:assert';
import {
  TUTOR_TAG,
  ACTION_ROUTES,
  buildTutorSystemPrompt,
  decodeStudyProfile,
  decodeWeakTopics,
  encodeProfileToFields,
  hasProfile,
  mergeProfile,
  normaliseProfile,
  parseTutorReply,
  weakTopicsContext
} from '../lib/tutor.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

test('a brand new student triggers the onboarding context', function () {
  const prompt = buildTutorSystemPrompt({ profile: null });
  assert.match(prompt, /brand new student/);
  assert.match(prompt, /Output protocol/);
  assert.match(prompt, /STUDYTOOLS AI/i);
});

test('the profile context carries name, goal and exam countdown', function () {
  const now = Date.parse('2026-04-10T12:00:00Z');
  const prompt = buildTutorSystemPrompt({
    profile: { name: 'Lucia', goal: 'Pass calculus', examDate: '2026-04-20', hoursPerDay: 1.5 },
    now: now
  });
  assert.match(prompt, /Name: Lucia/);
  assert.match(prompt, /Goal: Pass calculus/);
  assert.match(prompt, /Next exam: 2026-04-20 \(in 1[01] days\)/);
  assert.match(prompt, /1\.5 hours\/day/);
});

test('quick-mode styles ride along as a one-turn hint', function () {
  const prompt = buildTutorSystemPrompt({ profile: null, modeSystem: 'Explain like Feynman' });
  assert.match(prompt, /quick style for their current question, apply it to this turn: Explain like Feynman/);
  assert.ok(!buildTutorSystemPrompt({ profile: null }).includes('quick style'));
});

test('missed coach topics decode from Firestore typed values, worst first', function () {
  const fields = { topics: { arrayValue: { values: [
    { mapValue: { fields: { topic: { stringValue: 'derivatives' }, wrong: { integerValue: '2' } } } },
    { mapValue: { fields: { topic: { stringValue: 'integrals' }, wrong: { integerValue: '5' } } } },
    { mapValue: { fields: { topic: { stringValue: 'passed once' }, wrong: { integerValue: '0' } } } }
  ] } } };
  const list = decodeWeakTopics(fields);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].topic, 'integrals');
  assert.match(weakTopicsContext(list), /integrals \(5 misses\)/);
  assert.deepStrictEqual(decodeWeakTopics(null), []);
  assert.deepStrictEqual(decodeWeakTopics({ topics: { arrayValue: {} } }), []);
});

test('studyProfile roundtrips through Firestore typed values', function () {
  const profile = mergeProfile(null, {
    name: 'Ana',
    subjects: ['History', 'Physics'],
    examDate: '2026-06-01',
    hoursPerDay: 2
  }, 1700000000000);
  const decoded = decodeStudyProfile({ studyProfile: { mapValue: { fields: encodeProfileToFields(profile) } } });
  assert.strictEqual(decoded.name, 'Ana');
  assert.deepStrictEqual(decoded.subjects, ['History', 'Physics']);
  assert.strictEqual(decoded.examDate, '2026-06-01');
  assert.strictEqual(decoded.hoursPerDay, 2);
  assert.deepStrictEqual(decodeStudyProfile(null), normaliseProfile(null));
});

test('the model cannot smuggle billing keys through the profile', function () {
  const parsed = parseTutorReply('Hola!\n' + TUTOR_TAG +
    ' {"profile":{"name":"Leo","plan":"premium","isAdmin":true},"actions":[]}');
  assert.deepStrictEqual(parsed.profile, { name: 'Leo' });
  const merged = mergeProfile({ name: 'Old', goal: 'keep me' }, parsed.profile, 1700000000000);
  assert.strictEqual(merged.name, 'Leo');
  assert.strictEqual(merged.goal, 'keep me');
  assert.ok(!Object.prototype.hasOwnProperty.call(merged, 'plan'));
  assert.ok(!Object.prototype.hasOwnProperty.call(merged, 'isAdmin'));
});

test('actions are whitelisted, capped at 3 and routed to real tools', function () {
  const parsed = parseTutorReply('Listo\n' + TUTOR_TAG + ' {"profile":{},"actions":[' +
    '{"type":"plan","label":"See the 4-day plan"},' +
    '{"type":"evil","label":"hack"},' +
    '{"type":"timer","minutes":400},' +
    '{"type":"drill","label":""},' +
    '{"type":"flashcards","label":"Make cards"}]}');
  assert.strictEqual(parsed.text, 'Listo');
  assert.strictEqual(parsed.actions.length, 3);
  assert.strictEqual(parsed.actions[0].href, '/planner.html');
  assert.strictEqual(parsed.actions[1].type, 'timer');
  assert.strictEqual(parsed.actions[1].minutes, 180);
  assert.strictEqual(parsed.actions[1].href, '');
  assert.strictEqual(parsed.actions[2].label, 'Start a drill');
});

test('a reply without the protocol still survives as plain text', function () {
  const parsed = parseTutorReply('Solo texto, sin protocolo.');
  assert.strictEqual(parsed.text, 'Solo texto, sin protocolo.');
  assert.strictEqual(parsed.profile, null);
  assert.deepStrictEqual(parsed.actions, []);
});

test('broken protocol JSON never throws and keeps the visible reply', function () {
  const parsed = parseTutorReply('Mira esto\n' + TUTOR_TAG + ' {no-json}');
  assert.strictEqual(parsed.text, 'Mira esto');
  assert.strictEqual(parsed.profile, null);
  assert.deepStrictEqual(parsed.actions, []);
  assert.deepStrictEqual(parseTutorReply(null).actions, []);
});

test('profile emptiness rules decide onboarding vs memory', function () {
  assert.strictEqual(hasProfile(normaliseProfile({})), false);
  assert.strictEqual(hasProfile(normaliseProfile({ name: 'Ana' })), true);
  assert.strictEqual(hasProfile(normaliseProfile({ subjects: ['Math'] })), true);
  const capped = normaliseProfile({ name: 'x'.repeat(200), subjects: ['a', 3, '  ', 'b'], hoursPerDay: 99 });
  assert.strictEqual(capped.name.length, 60);
  assert.deepStrictEqual(capped.subjects, ['a', 'b']);
  assert.strictEqual(capped.hoursPerDay, 24);
});

test('every route is a site-relative path (timer runs inline)', function () {
  Object.keys(ACTION_ROUTES).forEach(function (type) {
    const href = ACTION_ROUTES[type];
    if (type === 'timer') assert.strictEqual(href, '');
    else assert.match(href, /^\//);
  });
});

console.log('\n' + passed + ' checks passed.');
