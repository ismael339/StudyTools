// Reports which environment variables reached this function, and whether the
// Firebase service account could be parsed. It never prints a secret value, only
// whether it exists and how long it is, so it is safe to leave deployed while
// setting the account up. Delete it once billing works.

import { getAdmin, adminEnabled } from '../lib/admin.js';

function describe(name) {
  const value = process.env[name];
  if (!value) return { set: false };
  // A pasted client id often arrives with a trailing space, a line break or a
  // stray character, which is exactly what makes PayPal answer 401.
  const trimmed = value.replace(/\s+/g, '').trim();
  if (trimmed.length !== value.trim().length) {
    return { set: true, length: trimmed.length, rawLength: value.trim().length, cleaned: true, looksLikeJson: false, lines: 1, note: 'Had whitespace, it is stripped before use' };
  }
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
    return { ok: true, environment: api.indexOf('sandbox') > -1 ? 'sandbox' : 'live', scope: data.scope, accessToken: data.access_token };
  } catch (error) {
    return { ok: false, error: (error && error.message) || 'request failed' };
  }
}

// Is Resend actually able to send? The key existing is not enough: the
// sending domain has to be added in the Resend dashboard and verified with DNS
// records (DKIM + SPF), and until it is, every email fails with HTTP 422 and
// nobody notices because the subscribe endpoint used to swallow the error.
// This asks Resend directly for the domain list, so /api/env-check answers
// "why did my test email never arrive" in one request.
async function checkResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { configured: false, ok: false, reason: 'RESEND_API_KEY is not set' };
  try {
    const response = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: 'Bearer ' + key }
    });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      return { configured: true, ok: false, status: response.status, error: data.message || data.name || 'Resend rejected the key' };
    }
    const domains = (Array.isArray(data.data) ? data.data : []).map(function (entry) {
      return { domain: entry.domain, status: entry.status, region: entry.region || null };
    });
    const own = domains.find(function (entry) { return entry.domain === 'studytools.pro'; });
    return {
      configured: true,
      ok: true,
      from: process.env.NEWSLETTER_FROM || 'StudyTools <newsletter@studytools.pro>',
      domainFound: Boolean(own),
      domainStatus: own ? own.status : null,
      domains: domains,
      hint: !own
        ? 'studytools.pro is not in Resend at all. Add it in Resend (Domains > Add Domain) and copy the DNS records it shows.'
        : (own.status !== 'verified'
          ? 'studytools.pro is in Resend but NOT verified (' + own.status + '). Add the TXT records Resend shows in Porkbun, then press Verify in Resend. Until then every send fails with HTTP 422.'
          : 'Domain verified: confirmation, welcome, drip and weekly emails can leave.')
    };
  } catch (error) {
    return { configured: true, ok: false, error: 'network: ' + (error && error.message) };
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

  // No guessing from the prefix: live ids can start with A or B, so the only
  // reliable signal is whether PayPal itself accepts the pair.
  const flavour = String(process.env.PAYPAL_ENV || 'live').toLowerCase();
  const results = [];
  let working = null;
  for (const candidate of candidates) {
    const result = await trySecret(clientId, candidate.value, flavour);
    results.push({ variable: candidate.name, ok: result.ok, status: result.status || null, error: result.error || null });
    if (result.ok && !working) {
      working = { variable: candidate.name, environment: result.environment, scope: result.scope, accessToken: result.accessToken || null };
    }
  }
  return {
    tested: true,
    clientIdLooksLike: flavour,
    attempts: results,
    workingVariable: working ? working.variable : null,
    ok: Boolean(working),
    environment: working ? working.environment : null,
    accessToken: working ? working.accessToken : null,
    hint: working
      ? 'Use ' + working.variable + ' as the PayPal secret. Billing can verify payments.'
      : 'No secret authenticated. Confirm that PAYPAL_CLIENT_ID and the secret come from the same PayPal app, copied without any trailing dot, dash or line break.'
  };
}
// A plan belongs to the app that created it, so an id from the previous app is
// rejected even with valid credentials. This asks PayPal about each plan the
// checkout uses and reports whether the current app can still charge for it.
async function checkPlans(accessToken, flavour) {
  const ids = [
    { key: 'monthly', id: process.env.PLAN_ID_MONTHLY || 'P-5GW019469S153851ANLBHLNQ' },
    { key: 'yearly', id: process.env.PLAN_ID_YEARLY || 'P-17W830833G852291FNLBHLNY' }
  ];
  const api = (process.env.PAYPAL_ENV || flavour) === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
  const out = [];
  for (const entry of ids) {
    try {
      const response = await fetch(api + '/v1/billing/plans/' + encodeURIComponent(entry.id), {
        headers: { Authorization: 'Bearer ' + accessToken }
      });
      if (response.ok) {
        const data = await response.json();
        const price = data.price && data.price.value ? Number(data.price.value) : null;
        const status = data.status || 'UNKNOWN';
        out.push({
          key: entry.key, id: entry.id, ok: true, status: status,
          price: price,
          active: status === 'ACTIVE',
          priceMatchesPage: price === null ? null : (entry.key === 'monthly' ? price === 3.99 : price === 29.99)
        });
      } else {
        let detail = '';
        try {
          const body = await response.json();
          detail = body.message || body.name || '';
        } catch (error) { /* ignore */ }
        out.push({ key: entry.key, id: entry.id, ok: false, status: response.status, error: detail || 'plan not available for this app' });
      }
    } catch (error) {
      out.push({ key: entry.key, id: entry.id, ok: false, error: (error && error.message) || 'request failed' });
    }
  }
  return out;
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
  const newsletter = await checkResend();
  let plans = [];
  if (paypal.ok && paypal.accessToken) {
    plans = await checkPlans(paypal.accessToken, paypal.environment);
  }

  return res.status(200).json({
    ok: firestore === 'ok' && paypal.ok === true,
    paypal: paypal.ok
      ? { ok: paypal.ok, workingVariable: paypal.workingVariable, environment: paypal.environment, hint: paypal.hint }
      : paypal,
    plans: plans,
    newsletter: newsletter,
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
      CRON_SECRET: describe('CRON_SECRET'),
      NEWSLETTER_FROM: describe('NEWSLETTER_FROM'),
      FIREBASE_PROJECT_ID: describe('FIREBASE_PROJECT_ID'),
      FIREBASE_WEB_API_KEY: describe('FIREBASE_WEB_API_KEY')
    },
    hint: firestore !== 'ok'
      ? 'Firebase is not usable yet. Check FIREBASE_SERVICE_ACCOUNT in Vercel and redeploy.'
      : (!newsletter.ok || newsletter.domainStatus !== 'verified'
          ? 'Email is the broken part: ' + (newsletter.hint || newsletter.error || newsletter.reason || 'see the newsletter section above')
          : (paypal.ok
              ? 'Billing is fully configured: Firestore and PayPal both verified. A real payment will activate Pro automatically.'
              : 'Firestore is ready, but PayPal rejected the secret. See paypal.hint above.'))
  });
}