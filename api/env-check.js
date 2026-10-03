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

async function testPayPal() {
  const clientId = process.env.PAYPAL_CLIENT_ID
    || process.env.PAYPAL_CLIENT_ID_LIVE;
  const secret = process.env.PAYPAL_CLIENT_SECRET
    || process.env.PAYPAL_SECRET
    || process.env.PAYPAL_API_SECRET
    || process.env.PAYPAL_API_SECRET_KEY;
  if (!clientId || !secret) {
    return { tested: false, reason: 'client id or secret not found' };
  }
  // Sandbox client ids start with BAA0 or Baa0, live ones with A. Mixing them
  // is the most common cause of a 401 when asking PayPal for a token.
  const flavour = /^b/i.test(String(clientId)) ? 'sandbox' : 'live';
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
      return { tested: true, ok: false, status: response.status, clientIdLooksLike: flavour, hint: flavour === 'sandbox' ? 'You are using a sandbox client id. A live site needs the Live app credentials, so switch to Live in the PayPal developer dashboard.' : undefined, error: data.error_description || data.error || 'unknown' };
    }
    return { tested: true, ok: true, clientIdLooksLike: flavour, environment: api.indexOf('sandbox') > -1 ? 'sandbox' : 'live', scope: data.scope };
  } catch (error) {
    return { tested: true, ok: false, error: (error && error.message) || 'request failed' };
  }
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