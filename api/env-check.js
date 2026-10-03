// Reports which environment variables reached this function, and whether the
// Firebase service account could be parsed. It never prints a secret value, only
// whether it exists and how long it is, so it is safe to leave deployed while
// setting the account up. Delete it once billing works.

import { getAdmin, adminEnabled } from '../lib/admin.js';

function describe(name) {
  const value = process.env[name];
  if (!value) return { set: false };
  const trimmed = value.trim();
  return {
    set: true,
    length: trimmed.length,
    looksLikeJson: trimmed.startsWith('{'),
    lines: trimmed.split(/\r?\n/).length
  };
}

// Every secret that reached the function is tested against PayPal, one at a
// time, and the report says which one authenticated. The value is never
// printed. This removes the guesswork when several PayPal apps exist and it is
// unclear which secret belongs to the live one.
async function trySecret(clientId, secret, flavour) {
  const api = (process.env.PAYPAL_ENV || flavour) === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
  try {
    const response = await fetch(api + '/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64')
      },
      body: 'grant_type=client_credentials'
    });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: data.error_description || data.error || 'unknown'
      };
    }
    return { ok: true, environment: api.indexOf('sandbox') > -1 ? 'sandbox' : 'live', scope: data.scope };
  } catch (error) {
    return { ok: false, error: (error && error.message) || 'request failed' };
  }
}

async function testPayPal() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const names = ['PAYPAL_CLIENT_SECRET', 'PAYPAL_SECRET', 'PAYPAL_API_SECRET', 'PAYPAL_API_SECRET_KEY'];
  const candidates = names
    .filter(function (name) { return Boolean(process.env[name]); })
    .map(function (name) { return { name: name, value: process.env[name] }; });
  if (!clientId) return { tested: false, reason: 'PAYPAL_CLIENT_ID not set' };
  if (!candidates.length) return { tested: false, reason: 'no secret variable is set' };

  const flavour = /^b/i.test(String(clientId)) ? 'sandbox' : 'live';
  const results = [];
  let working = null;
  for (const candidate of candidates) {
    const result = await trySecret(clientId, candidate.value, flavour);
    results.push({ variable: candidate.name, ok: result.ok, status: result.status || null, error: result.error || null });
    if (result.ok && !working) {
      working = { variable: candidate.name, environment: result.environment, scope: result.scope };
    }
  }
  return {
    tested: true,
    clientIdLooksLike: flavour,
    attempts: results,
    workingVariable: working ? working.variable : null,
    ok: Boolean(working),
    environment: working ? working.environment : null,
    hint: working
      ? 'Use ' + working.variable + ' as the PayPal secret. Billing can verify payments.'
      : (flavour === 'sandbox'
          ? 'The client id looks like a sandbox id, so a live site cannot verify payments. Copy the client id and secret of the LIVE app instead.'
          : 'No secret authenticated. Check that the secret belongs to the same app as this client id.')
  };
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const admin = getAdmin();
  let firestore = 'not_tested';
  if (admin) {
    try {
      await admin.db.collection('paypal_events').limit(1).get();
      firestore = 'ok';
    } catch (error) {
      firestore = 'error: ' + (error && error.message ? error.message.slice(0, 160) : 'unknown');
    }
  } else {
    firestore = adminEnabled() ? 'admin_initialisation_failed' : 'service_account_not_set';
  }

  const paypal = await testPayPal();

  return res.status(200).json({
    ok: firestore === 'ok' && paypal.ok === true,
    paypal: paypal,
    firestore: firestore,
    serviceAccountConfigured: adminEnabled(),
    vars: {
      FIREBASE_SERVICE_ACCOUNT: describe('FIREBASE_SERVICE_ACCOUNT'),
      PAYPAL_CLIENT_ID: describe('PAYPAL_CLIENT_ID'),
      PAYPAL_CLIENT_SECRET: describe('PAYPAL_CLIENT_SECRET'),
      PAYPAL_SECRET: describe('PAYPAL_SECRET'),
      PAYPAL_API_SECRET: describe('PAYPAL_API_SECRET'),
      PAYPAL_WEBHOOK_ID: describe('PAYPAL_WEBHOOK_ID'),
      GROQ_API_KEY: describe('GROQ_API_KEY'),
      RESEND_API_KEY: describe('RESEND_API_KEY'),
      FIREBASE_PROJECT_ID: describe('FIREBASE_PROJECT_ID'),
      FIREBASE_WEB_API_KEY: describe('FIREBASE_WEB_API_KEY')
    },
    hint: firestore === 'ok'
      ? 'Billing is fully configured. A real payment will now activate Pro automatically.'
      : 'Add FIREBASE_SERVICE_ACCOUNT in Vercel (all three environments), then Redeploy from the Deployments tab.'
  });
}