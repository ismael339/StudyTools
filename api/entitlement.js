// Reads the caller's real entitlement straight from Firestore, using the same
// Firebase ID token the browser already has, so the security rules stay in
// charge and no service-account key is needed on the read path.
//
// The browser used to decide "am I Pro?" from localStorage, which anyone could
// edit in devtools. Nothing in the client may grant features now: this endpoint
// is the only source of truth, and api/chat.js enforces the quota regardless.

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'studytools-b60e9';
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyDx4StAzPExYbQU_9yJ04R7HO2JX1_sq6w';
const VERIFY_URL = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyIdToken?key=' + WEB_API_KEY;
const DOC_BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/';
const FREE_DAILY_LIMIT = Number(process.env.FREE_DAILY_LIMIT || 15);
const PRO_DAILY_LIMIT = Number(process.env.PRO_DAILY_LIMIT || 2000);

function bearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.indexOf('Bearer ') === 0 || header.indexOf('bearer ') === 0) return header.slice(7);
  return null;
}

async function verifyToken(token) {
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

async function readDoc(path, token) {
  try {
    const response = await fetch(DOC_BASE + path, { headers: { Authorization: 'Bearer ' + token } });
    if (response.status !== 200) return null;
    const json = await response.json();
    return json.fields || null;
  } catch (error) {
    return null;
  }
}

function stringField(fields, name) {
  const value = fields && fields[name];
  return value && typeof value.stringValue === 'string' ? value.stringValue : '';
}

function intField(fields, name) {
  const value = fields && fields[name];
  return value && typeof value.integerValue !== 'undefined' ? Number(value.integerValue) : 0;
}

function timeField(fields, name) {
  const value = fields && fields[name];
  if (!value) return 0;
  if (typeof value.timestampValue === 'string') return Date.parse(value.timestampValue) || 0;
  if (typeof value.integerValue !== 'undefined') return Number(value.integerValue);
  return 0;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = bearerToken(req);
  const anonymous = {
    signedIn: false, plan: 'free', active: false, premiumUntil: null,
    used: 0, limit: FREE_DAILY_LIMIT, remaining: FREE_DAILY_LIMIT, source: 'anonymous'
  };
  if (!token) return res.status(200).json(anonymous);

  const identity = await verifyToken(token);
  if (!identity) return res.status(200).json(anonymous);

  // Accounts created before the uid migration keep a document keyed by email.
  let profile = await readDoc('users/' + identity.uid, token);
  if (!profile && identity.email) profile = await readDoc('users/' + identity.email, token);

  const plan = stringField(profile, 'plan') || 'free';
  const premiumUntil = timeField(profile, 'premiumUntil');
  const cancelAtPeriodEnd = (profile && profile.cancelAtPeriodEnd && profile.cancelAtPeriodEnd.booleanValue) === true;

  // A pass that has run out must read as free, even if the field says premium.
  const expired = premiumUntil > 0 && premiumUntil < Date.now();
  const active = plan === 'premium' && !expired;

  const day = new Date().toISOString().slice(0, 10).split('-').join('');
  const usage = await readDoc('usage/' + identity.uid + '_' + day, token);
  const used = usage ? intField(usage, 'count') : 0;
  const limit = active ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;

  return res.status(200).json({
    signedIn: true,
    email: identity.email || null,
    plan: active ? 'premium' : 'free',
    active: active,
    premiumUntil: active ? (premiumUntil || null) : null,
    cancelAtPeriodEnd: active ? cancelAtPeriodEnd : false,
    subscriptionStatus: stringField(profile, 'subscriptionStatus') || null,
    used: used,
    limit: limit,
    remaining: Math.max(0, limit - used),
    source: 'server'
  });
}