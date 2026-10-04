// Turns a PayPal subscription into a Pro entitlement, but only after asking
// PayPal whether that subscription really exists and is paid for.
//
// This is the check pro-success.html used to skip: the browser claimed the
// payment and wrote "premium" into its own localStorage, so a real purchase was
// not recorded server-side and anyone could fake it. Now the client sends the
// subscription id it got from PayPal and this function verifies it with PayPal's
// own API before touching Firestore.

import { applyEntitlement, adminEnabled, isPassSku, parseDate, planFromSku } from '../lib/admin.js';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'studytools-b60e9';
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyDx4StAzPExYbQU_9yJ04R7HO2JX1_sq6w';
const VERIFY_URL = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyIdToken?key=' + WEB_API_KEY;
const PAYPAL_API = process.env.PAYPAL_ENV === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

// Same cooldown as the webhook, so a shared link cannot be replayed for free.
const recentGrants = new Map();
const GRANT_COOLDOWN_MS = 90 * 1000;

const ACTIVE_STATUSES = ['ACTIVE'];
const PENDING_STATUSES = ['APPROVAL_PENDING'];

// The secret was added in Vercel under a name chosen when the panel was filled
// in, so several spellings are accepted. Whichever one exists, it is used.
// PayPal rejects the pair if either value carries stray whitespace from a copy
// and paste, so both are normalised before use.
function clean(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function paypalSecret() {
  return process.env.PAYPAL_CLIENT_SECRET
    || process.env.PAYPAL_SECRET
    || process.env.PAYPAL_API_SECRET
    || process.env.PAYPAL_API_SECRET_KEY
    || '';
}
function bearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.indexOf('Bearer ') === 0 || header.indexOf('bearer ') === 0) return header.slice(7);
  return null;
}

async function verifyFirebaseToken(token) {
  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token })
    });
    if (!response.ok) return null;
    const data = await response.json();
    const uid = data.user_id || data.localId;
    return uid ? { uid, email: data.email || '' } : null;
  } catch (error) {
    return null;
  }
}

let paypalToken = null;
let paypalTokenExpiry = 0;

async function getPayPalAccessToken() {
  const clientId = clean(process.env.PAYPAL_CLIENT_ID);
  const secret = clean(paypalSecret());
  if (!clientId || !secret) return null;
  if (paypalToken && Date.now() < paypalTokenExpiry) return paypalToken;
  const response = await fetch(PAYPAL_API + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64')
    },
    body: 'grant_type=client_credentials'
  });
  if (!response.ok) throw new Error('PayPal credentials rejected (' + response.status + ')');
  const data = await response.json();
  paypalToken = data.access_token;
  paypalTokenExpiry = Date.now() + Math.max(300, Number(data.expires_in || 300) - 60) * 1000;
  return paypalToken;
}

async function fetchSubscription(accessToken, subscriptionId) {
  const response = await fetch(PAYPAL_API + '/v2/billing/subscriptions/' + encodeURIComponent(subscriptionId), {
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    }
  });
  if (response.status === 404) return { found: false };
  if (!response.ok) throw new Error('PayPal lookup failed (' + response.status + ')');
  return { found: true, data: await response.json() };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const subscriptionId = String(body.subscription_id || body.subscriptionId || '').trim();
  if (!subscriptionId || !/^[A-Z0-9]{10,32}$/i.test(subscriptionId)) {
    return res.status(400).json({ error: 'A valid PayPal subscription id is required.' });
  }

  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Sign in with the account you paid from so Pro can be linked to it.' });
  }
  const identity = await verifyFirebaseToken(token);
  if (!identity) {
    return res.status(401).json({ error: 'Your session expired. Log in again and we will activate Pro straight away.' });
  }

  const grantKey = identity.uid + ':' + subscriptionId;
  const lastGrant = recentGrants.get(grantKey) || 0;
  if (Date.now() - lastGrant < GRANT_COOLDOWN_MS) {
    return res.status(200).json({ ok: true, status: 'already_activated', plan: 'premium' });
  }

  let accessToken;
  try {
    accessToken = await getPayPalAccessToken();
  } catch (error) {
    console.error('PayPal auth error:', error && error.message);
    return res.status(502).json({
      error: 'We could not reach PayPal to confirm the payment. Your card was not charged twice, please retry in a minute.',
      code: 'paypal_unreachable'
    });
  }
  if (!accessToken) {
    return res.status(503).json({
      error: 'Pro activation is not configured yet. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in Vercel and redeploy.',
      code: 'billing_not_configured'
    });
  }

  let lookup;
  try {
    lookup = await fetchSubscription(accessToken, subscriptionId);
  } catch (error) {
    console.error('PayPal subscription lookup error:', error && error.message);
    return res.status(502).json({ error: 'PayPal did not answer in time. Try again in a moment.', code: 'paypal_unreachable' });
  }

  if (!lookup.found) {
    return res.status(404).json({
      error: 'PayPal does not know this subscription yet. It can take a minute after the payment, so reload this page in a moment.',
      code: 'subscription_not_found'
    });
  }

  const subscription = lookup.data || {};
  const status = String(subscription.status || '').toUpperCase();
  if (!ACTIVE_STATUSES.includes(status)) {
    const stillPending = PENDING_STATUSES.includes(status);
    return res.status(stillPending ? 202 : 402).json({
      error: stillPending
        ? 'PayPal is still confirming the payment. This page will activate Pro automatically in a few seconds.'
        : 'PayPal reports this subscription as ' + (status || 'inactive') + '. If you were charged, contact support and we will fix it the same day.',
      code: stillPending ? 'payment_pending' : 'subscription_inactive',
      status: status
    });
  }

  const planId = String(subscription.plan_id || '');
  const sku = planId || String(body.plan || 'pro-monthly');
  const payerEmail = String((subscription.payer && subscription.payer.email_address) || '').toLowerCase();
  const periodEnd = parseDate(
    (subscription.billing_info && subscription.billing_info.next_billing_time) || ''
  );
  const email = identity.email || payerEmail;
  const pass = isPassSku(sku);

  if (!adminEnabled()) {
    // Never hand out Pro from a half-configured deployment.
    return res.status(503).json({
      error: 'Payment received and confirmed by PayPal, but Pro activation is still being set up on our side. Email ' + (process.env.SUPPORT_EMAIL || 'support@studytools.pro') + ' with your PayPal receipt and we will switch it on manually today.',
      code: 'billing_not_configured',
      paypalStatus: status
    });
  }

  const result = await applyEntitlement({
    uid: identity.uid,
    email: email,
    plan: planFromSku(sku),
    sku: sku,
    subscriptionId: subscriptionId,
    periodEnd: pass ? Date.now() + 7 * 86400000 : periodEnd,
    status: status,
    source: 'paypal-checkout',
    payerEmail: payerEmail
  });

  if (!result.ok) {
    console.error('Entitlement write failed:', result.reason);
    return res.status(500).json({
      error: 'The payment is confirmed but we could not write your account. Email ' + (process.env.SUPPORT_EMAIL || 'support@studytools.pro') + ' and we will fix it today.',
      code: 'write_failed'
    });
  }

  recentGrants.set(grantKey, Date.now());
  if (recentGrants.size > 500) {
    const cutoff = Date.now() - GRANT_COOLDOWN_MS;
    for (const [key, stamp] of recentGrants.entries()) {
      if (stamp < cutoff) recentGrants.delete(key);
    }
  }

  return res.status(200).json({
    ok: true,
    status: 'active',
    plan: 'premium',
    interval: pass ? 'pass-7d' : (String(body.plan) === 'yearly' ? 'yearly' : 'monthly'),
    expiresAt: result.expiresAt || null,
    email: email || null
  });
}