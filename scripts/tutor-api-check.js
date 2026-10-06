// Integration check for the tutor mode of /api/chat with a mocked Groq
// response: proves the extended contract {reply, quota, actions, profile}
// while the classic {system, messages} callers stay byte-compatible, and that
// the anonymous rate limit still fires. No keys, no network.
//
//   node scripts/tutor-api-check.js     (or: npm run tutor:api-check)

import assert from 'node:assert';
import { pathToFileURL } from 'node:url';

const GROQ_REPLY =
  'Hola Ana! Empezamos por derivadas. ' +
  '###STUDYTOOLS### {"profile":{"name":"Ana","subjects":["Mates"],"examDate":"2026-06-01"},' +
  '"actions":[{"type":"plan","label":"Ver plan de examen"},{"type":"timer","minutes":25},{"type":"evil","label":"x"}]}';

const CLASSIC_REPLY = 'Short answer with a stray tag: ###STUDYTOOLS### {"profile":{"hacked":true}}';

let groqCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async function (url, options) {
  if (String(url).indexOf('api.groq.com') !== -1) {
    groqCalls++;
    const content = groqCalls === 1 ? GROQ_REPLY : CLASSIC_REPLY;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: content } }] }),
      text: async () => ''
    };
  }
  return realFetch ? realFetch(url, options) : undefined;
};

const { default: handler } = await import(pathToFileURL(process.cwd() + '/api/chat.js').href);

function makeRes() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

async function post(body) {
  const res = makeRes();
  await handler({ method: 'POST', headers: {}, body: body }, res);
  return res;
}

// 1) Tutor mode: protocol stripped, actions routed, profile merged.
const tutor = await post({
  messages: [{ role: 'user', content: 'Hola, soy Ana y tengo examen el 1 de junio' }],
  assistant: true,
  profile: { goal: 'Aprobar mates' }
});
assert.strictEqual(tutor.statusCode, 200);
assert.ok(tutor.body.reply.indexOf('###STUDYTOOLS###') === -1);
assert.match(tutor.body.reply, /Hola Ana/);
assert.strictEqual(tutor.body.quota.limit, 15);
assert.strictEqual(tutor.body.quota.used, 1);
assert.deepStrictEqual(tutor.body.actions.map(a => a.type), ['plan', 'timer']);
assert.strictEqual(tutor.body.actions[0].href, '/planner.html');
assert.strictEqual(tutor.body.actions[1].minutes, 25);
assert.strictEqual(tutor.body.profile.name, 'Ana');
assert.strictEqual(tutor.body.profile.goal, 'Aprobar mates');
assert.deepStrictEqual(tutor.body.profile.subjects, ['Mates']);
assert.ok(tutor.body.profile.updatedAt);
console.log('ok - tutor mode answers with {reply, quota, actions, profile}');

// 2) Classic mode: same contract as before, reply untouched, no new keys.
const classic = await post({
  system: 'Be brief.',
  messages: [{ role: 'user', content: 'Explain photosynthesis' }]
});
assert.strictEqual(classic.statusCode, 200);
assert.strictEqual(classic.body.reply, CLASSIC_REPLY);
assert.strictEqual(Object.prototype.hasOwnProperty.call(classic.body, 'actions'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(classic.body, 'profile'), false);
assert.strictEqual(classic.body.quota.limit, 15);
console.log('ok - classic {system, messages} contract is unchanged');

// 3) Anonymous per-instance hourly cap still answers 429.
let limited = null;
for (let i = 0; i < 25 && !limited; i++) {
  const res = await post({ messages: [{ role: 'user', content: 'again' }], assistant: true });
  if (res.statusCode === 429) limited = res;
}
assert.ok(limited && limited.body.code === 'quota');
console.log('ok - anonymous rate limit still enforces 429');

globalThis.fetch = realFetch;
console.log('\n3 API checks passed.');
