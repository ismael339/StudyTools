// Server-side Firestore access, used only to grant or revoke Pro.
//
// The browser is never trusted with billing fields (see firestore.rules), so
// every entitlement change goes through here with a Firebase service account.
// The key arrives in the FIREBASE_SERVICE_ACCOUNT environment variable, either
// as the service-account JSON itself, that JSON base64-encoded, or as a path in
// FIREBASE_SERVICE_ACCOUNT_PATH for local development.

let adminApp = null;
let adminDb = null;
let initError = null;

function normalisePrivateKey(key) {
  return String(key || '').replace(/\\n/g, '\n').replace(/\r/g, '').trim();
}

// The secret is pasted by hand from a JSON viewer, so it arrives in several
// shapes: valid JSON, JSON with real newlines inside the string, JSON with the
// fields split across lines, base64, or single quotes. All of them are accepted
// rather than failing silently with a generic error.
function parseCredentials() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  const candidates = [raw];
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    if (decoded.trim().startsWith('{')) candidates.push(decoded);
  } catch (error) { /* not base64 */ }
  for (const candidate of candidates) {
    let text = String(candidate || '').trim()
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start > 0 && end > start) text = text.slice(start, end + 1);
    if (!text.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(text.replace(/\r?\n\s*/g, ' '));
      if (parsed && parsed.client_email && parsed.private_key) {
        return { project_id: parsed.project_id, client_email: parsed.client_email, private_key: normalisePrivateKey(parsed.private_key) };
      }
    } catch (error) { /* fall through to the field extraction */ }
    const email = (text.match(/"client_email"\s*:\s*"([^"]+)"/) || [])[1];
    const key = (text.match(/"private_key"\s*:\s*"([\s\S]*?)"\s*[,}]/) || [])[1];
    const project = (text.match(/"project_id"\s*:\s*"([^"]+)"/) || [])[1];
    if (email && key) {
      return { project_id: project, client_email: email, private_key: normalisePrivateKey(key) };
    }
  }
  return null;
}
export function adminEnabled() {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  );
}

export function getAdmin() {
  if (adminDb) return { db: adminDb, admin: adminApp };
  if (initError) return null;
  if (!adminEnabled()) {
    initError = new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
    return null;
  }
  try {
    const mod = require('firebase-admin');
    const admin = mod.default || mod;
    const credentials = parseCredentials();
    if (credentials) {
      const app = admin.apps.length
        ? admin.app()
        : admin.initializeApp({
            credential: admin.credential.cert(credentials),
            projectId: process.env.FIREBASE_PROJECT_ID || credentials.project_id || undefined
          });
      adminDb = admin.firestore(app);
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
      const app = admin.apps.length ? admin.app() : admin.initializeApp({
        credential: admin.applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID || undefined
      });
      adminDb = admin.firestore(app);
    }
    adminApp = admin;
    return { db: adminDb, admin };
  } catch (error) {
    initError = error;
    console.error('Firebase admin initialisation failed:', error && error.message);
    return null;
  }
}

export function planFromSku(sku) {
  const value = String(sku || '').trim().toLowerCase();
  if (!value) return 'free';
  const yearly = (process.env.SKU_PRO_YEARLY || 'pro-yearly').toLowerCase();
  if (value === yearly || value.indexOf('year') >= 0) return 'premium';
  if (value === 'free') return 'free';
  if (isPassSku(value)) return 'premium';
  // An unknown sku still means money arrived, so grant Pro but keep the raw
  // value on the record to be mapped later without losing the customer.
  return 'premium';
}

export function isPassSku(sku) {
  const value = String(sku || '').trim().toLowerCase();
  if (value.indexOf('pass') >= 0 || value.indexOf('week') >= 0) return true;
  return value === (process.env.SKU_PASS_7D || 'pass-7d').toLowerCase();
}

export function parseDate(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * Grants (or revokes) Pro for one account and records the purchase.
 * Accepts a uid, an email, or both, and mirrors the change onto a legacy
 * email-keyed document when one exists, so no paying customer loses access.
 */
export async function applyEntitlement(params) {
  const admin = getAdmin();
  if (!admin) return { ok: false, reason: 'not_configured' };
  const db = admin.db;

  const uid = String(params.uid || '').trim();
  const email = String(params.email || '').trim().toLowerCase();
  const plan = params.plan === 'free' ? 'free' : 'premium';
  const now = Date.now();

  let docId = uid;
  if (!docId && email) {
    const found = await db.collection('users').where('email', '==', email).limit(1).get();
    if (!found.empty) docId = found.docs[0].id;
  }
  if (!docId) docId = email;
  if (!docId) return { ok: false, reason: 'no_account' };

  const snapshot = await db.collection('users').doc(docId).get();
  const previous = snapshot.exists ? snapshot.data() : null;
  const pass = plan === 'premium' && isPassSku(params.sku);
  const requested = Number(params.periodEnd) || 0;
  const periodEnd = pass ? Math.max(requested, now + 7 * 86400000) : requested || null;

  const fields = {
    plan: plan,
    planSource: params.source || 'paypal',
    entitlementUpdatedAt: new Date(now).toISOString()
  };
  if (params.sku) fields.sku = params.sku;
  if (params.subscriptionId) fields.subscriptionId = params.subscriptionId;
  if (params.captureId) fields.lastCaptureId = params.captureId;
  if (params.payerEmail) fields.paypalPayerEmail = params.payerEmail;
  if (params.status) fields.subscriptionStatus = params.status;
  if (typeof params.cancelAtPeriodEnd === 'boolean') fields.cancelAtPeriodEnd = params.cancelAtPeriodEnd;
  if (plan === 'premium') {
    fields.planSince = previous && previous.planSince ? previous.planSince : new Date(now).toISOString();
    fields.premiumUntil = periodEnd ? new Date(periodEnd).toISOString() : null;
  } else {
    fields.premiumUntil = null;
    fields.downgradedAt = new Date(now).toISOString();
  }

  await db.collection('users').doc(docId).set(fields, { merge: true });

  if (params.subscriptionId) {
    await db.collection('subscriptions').doc(String(params.subscriptionId)).set({
      uid: uid || null,
      email: email || null,
      plan: plan,
      status: params.status || null,
      sku: params.sku || null,
      currentPeriodEnd: periodEnd ? new Date(periodEnd).toISOString() : null,
      provider: 'paypal',
      eventType: params.eventType || null,
      updatedAt: new Date(now).toISOString()
    }, { merge: true });
  }

  // The deployed rules key user documents by email, while newer writes use the
// uid. A paying customer reads their own document with their own ID token, so
// both copies are always written: whichever path the rules accept, the browser
// finds the entitlement instead of silently falling back to free.
  let mirrored = null;
  if (email && docId !== email) {
    await db.collection('users').doc(email).set(fields, { merge: true });
    mirrored = email;
  }

  return { ok: true, docId, plan, mirrored, expiresAt: periodEnd || null };
}

/** Returns false when the event was already processed, so retries are safe. */
export async function claimEvent(db, eventId) {
  if (!eventId) return true;
  const ref = db.collection('paypal_events').doc(String(eventId));
  const existing = await ref.get();
  if (existing.exists) return false;
  await ref.set({ receivedAt: new Date().toISOString() });
  return true;
}