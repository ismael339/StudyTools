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

  return res.status(200).json({
    ok: firestore === 'ok',
    firestore: firestore,
    serviceAccountConfigured: adminEnabled(),
    vars: {
      FIREBASE_SERVICE_ACCOUNT: describe('FIREBASE_SERVICE_ACCOUNT'),
      PAYPAL_CLIENT_ID: describe('PAYPAL_CLIENT_ID'),
      PAYPAL_CLIENT_SECRET: describe('PAYPAL_CLIENT_SECRET'),
      PAYPAL_WEBHOOK_ID: describe('PAYPAL_WEBHOOK_ID'),
      GROQ_API_KEY: describe('GROQ_API_KEY'),
      RESEND_API_KEY: describe('RESEND_API_KEY'),
      FIREBASE_PROJECT_ID: describe('FIREBASE_PROJECT_ID')
    },
    hint: firestore === 'ok'
      ? 'Billing is fully configured. A real payment will now activate Pro automatically.'
      : 'Add FIREBASE_SERVICE_ACCOUNT in Vercel (all three environments), then Redeploy from the Deployments tab.'
  });
}