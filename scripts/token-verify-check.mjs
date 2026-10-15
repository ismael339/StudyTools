// Regression check for Firebase ID-token verification. Google retired the
// identitytoolkit v3/relyingparty endpoint (it answers 404 now), so every
// signed-in request used to read as "Your session expired. Log in again."
// even with a valid session. The handlers must call v1/accounts:lookup and
// parse users[0].localId. No keys, no network: fetch is mocked.
//
//   node scripts/token-verify-check.mjs    (or: npm run verify:check)

import assert from 'node:assert';
import { pathToFileURL } from 'node:url';

// Hermetic environment: chat needs a key to exist, and the planner must reach
// the admin gate as "not configured" so the test stays deterministic even on a
// machine that has the real service account.
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key';
delete process.env.FIREBASE_SERVICE_ACCOUNT;
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
delete process.env.PAYPAL_CLIENT_ID;
delete process.env.PAYPAL_CLIENT_SECRET;
delete process.env.PAYPAL_SECRET;
delete process.env.PAYPAL_API_SECRET;
delete process.env.PAYPAL_API_SECRET_KEY;

const LOOKUP = 'identitytoolkit.googleapis.com/v1/accounts:lookup';
const LEGACY = 'identitytoolkit/v3/relyingparty';

let verifyMode = 'ok'; // 'ok' | 'rejected'
let verifyUrl = null;
const calls = [];

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

globalThis.fetch = async function (url, options) {
  const target = String(url);
  calls.push(target);
  if (target.indexOf('accounts:lookup') !== -1) {
    verifyUrl = target;
    if (verifyMode === 'rejected') {
      return jsonResponse(400, { error: { code: 400, message: 'INVALID_ID_TOKEN' } });
    }
    return jsonResponse(200, { users: [{ localId: 'uid-test-1', email: 'ana@example.com' }] });
  }
  if (target.indexOf('firestore.googleapis.com') !== -1) {
    // The per-uid usage document reads as 7 so the signed-in path is visible
    // in the response; anonymous requests would report 1 instead.
    if (target.indexOf('/usage/') !== -1) {
      return jsonResponse(200, { fields: { count: { integerValue: '7' } } });
    }
    return jsonResponse(404, {});
  }
  if (target.indexOf('api.groq.com') !== -1) {
    return jsonResponse(200, { choices: [{ message: { content: 'Short answer.' } }] });
  }
  return jsonResponse(500, { error: 'unexpected call: ' + target });
};

function makeRes() {
  return {
    statusCode: 0,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

async function load(route) {
  return (await import(pathToFileURL(process.cwd() + route).href)).default;
}

const entitlement = await load('/api/entitlement.js');
const planner = await load('/api/planner.js');
const chat = await load('/api/chat.js');

// 1) A valid token reaches the signed-in path through v1/accounts:lookup.
verifyMode = 'ok';
let res = makeRes();
await entitlement({ method: 'GET', headers: { authorization: 'Bearer tok-1' } }, res);
assert.strictEqual(res.statusCode, 200);
assert.strictEqual(res.body.signedIn, true, 'valid token must be accepted');
assert.strictEqual(res.body.email, 'ana@example.com');
assert.strictEqual(res.body.used, 7, 'usage must be read for the verified uid');
assert.ok(verifyUrl && verifyUrl.indexOf(LOOKUP) > -1, 'must verify through v1/accounts:lookup: ' + verifyUrl);
console.log('ok - entitlement accepts a valid token via v1/accounts:lookup');

// 2) A rejected token still degrades to the anonymous answer.
verifyMode = 'rejected';
res = makeRes();
await entitlement({ method: 'GET', headers: { authorization: 'Bearer tok-2' } }, res);
assert.strictEqual(res.statusCode, 200);
assert.strictEqual(res.body.signedIn, false);
assert.strictEqual(res.body.source, 'anonymous');
console.log('ok - entitlement falls back to anonymous when the token is rejected');

// 3) The planner must get past token verification (the old bug answered 401
//    here for every valid session) and stop at the unconfigured admin gate.
verifyMode = 'ok';
res = makeRes();
await planner({ method: 'POST', headers: { authorization: 'Bearer tok-3' }, body: {} }, res);
assert.strictEqual(res.statusCode, 503, 'valid token must not be a 401');
assert.strictEqual(res.body.error, 'The planner is being set up.');
console.log('ok - planner no longer answers "session expired" for a valid session');

// 4) ...while a genuinely invalid token still gets the auth error.
verifyMode = 'rejected';
res = makeRes();
await planner({ method: 'POST', headers: { authorization: 'Bearer tok-4' }, body: {} }, res);
assert.strictEqual(res.statusCode, 401);
assert.strictEqual(res.body.error, 'Your session expired. Log in again.');
console.log('ok - planner still rejects an invalid token with the 401 message');

// 5) /api/chat parses users[0].localId: the quota is read from the verified
//    uid's usage document (7 read + 1 for this request), not from the
//    anonymous in-memory bucket (which would report 1).
verifyMode = 'ok';
res = makeRes();
await chat({ method: 'POST', headers: { authorization: 'Bearer tok-5' }, body: { messages: [{ role: 'user', content: 'Hola' }] } }, res);
assert.strictEqual(res.statusCode, 200);
assert.ok(res.body.reply, 'chat must answer');
assert.strictEqual(res.body.quota.used, 8, 'quota must be the verified uid counter');
assert.strictEqual(res.body.quota.server, true);
console.log('ok - chat resolves the identity from users[0] and counts per uid');

// 6) The coach uses the same verification and must reach the admin gate.
verifyMode = 'ok';
const coach = await load('/api/coach.js');
res = makeRes();
await coach({ method: 'POST', headers: { authorization: 'Bearer tok-6' }, body: {} }, res);
assert.strictEqual(res.statusCode, 503, 'valid token must not be a 401');
assert.strictEqual(res.body.error, 'The Study Coach is being set up. Try again shortly.');
console.log('ok - coach no longer answers "session expired" for a valid session');

// 7) Pro activation used to reject every valid session before PayPal; it must
//    now clear verification and stop at the unconfigured billing gate instead.
const subscription = await load('/api/subscription.js');
res = makeRes();
await subscription({ method: 'POST', headers: { authorization: 'Bearer tok-7' }, body: { subscription_id: 'IJKLmnopQR12' } }, res);
assert.strictEqual(res.statusCode, 503);
assert.strictEqual(res.body.code, 'billing_not_configured');
console.log('ok - subscription activation clears token verification with a valid session');

// 8) Nothing anywhere may still target the retired endpoint.
assert.ok(calls.every(u => u.indexOf(LEGACY) === -1), 'the retired v3/relyingparty endpoint was called');
console.log('ok - no handler calls the retired v3/relyingparty endpoint');

console.log('8 checks passed.');