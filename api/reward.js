// Grants the "watched a rewarded video" top-up for free accounts.
//
//   POST /api/reward   Authorization: Bearer <firebase id token>
//
// Freemium flow: when a free student hits 15/15 they can watch a short Adsterra
// rewarded video to earn a few extra AI requests for the day. Pro never calls
// this (they already have 2000).
//
// Trust model — read this before relying on it. Adsterra signals "video
// completed" in the browser; there is no server-to-server callback to verify
// the view. So this endpoint cannot prove a video was watched. What it DOES do
// is cap the damage: the daily bonus is limited by the Firestore security rule
// (reward may only rise by +3 per write and stop at REWARD_DAILY_CAP), using the
// same user-token write pattern as api/chat.js. A client that fakes the
// completion callback can at most reach the cap — e.g. 15 + 9 = 24 free
// requests a day — never unlimited. That bounded ceiling is the accepted cost
// of rewarded ads on a micro-SaaS; the ad revenue offsets the extra tokens.

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'studytools-b60e9';
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyDx4StAzPExYbQU_9yJ04R7HO2JX1_sq6w';
const VERIFY_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + WEB_API_KEY;
const DOC_BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/';
const FREE_DAILY_LIMIT = Number(process.env.FREE_DAILY_LIMIT || 15);
// Each completed video grants this many, and the daily bonus stops here. Keep
// the ratio honest: 3 videos/day is a reasonable free ceiling, not a loophole.
const REWARD_PER_VIDEO = Number(process.env.REWARD_PER_VIDEO || 3);
const REWARD_DAILY_CAP = Number(process.env.REWARD_DAILY_CAP || 9);

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
    const user = (data.users && data.users[0]) || null;
    return user && user.localId ? { uid: user.localId, email: user.email || '' } : null;
  } catch (error) {
    return null;
  }
}

async function readDoc(path, token) {
  try {
    const response = await fetch(DOC_BASE + path, { headers: { Authorization: 'Bearer ' + token } });
    if (response.status !== 200) return null;
    return (await response.json()).fields || null;
  } catch (error) {
    return null;
  }
}

function intField(fields, name) {
  const value = fields && fields[name];
  return value && typeof value.integerValue !== 'undefined' ? Number(value.integerValue) : 0;
}

function sendJson(res, status, body) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  const token = bearerToken(req);
  if (!token) return sendJson(res, 401, { error: 'Sign in to earn video bonus requests.' });

  const identity = await verifyToken(token);
  if (!identity) return sendJson(res, 401, { error: 'Sign in to earn video bonus requests.' });

  const day = new Date().toISOString().slice(0, 10).split('-').join('');
  const path = 'usage/' + identity.uid + '_' + day;
  const usage = await readDoc(path, token);
  const currentReward = usage ? intField(usage, 'reward') : 0;

  // Hard daily ceiling. The Firestore rule enforces the +3 step and this cap on
  // every write too; this check just answers politely instead of erroring.
  if (currentReward >= REWARD_DAILY_CAP) {
    return sendJson(res, 429, {
      error: 'You have already earned today’s video bonus. It resets in 24 hours — or go Pro for no daily limit.',
      code: 'reward_cap',
      reward: currentReward,
      limit: FREE_DAILY_LIMIT + REWARD_DAILY_CAP
    });
  }

  const granted = Math.min(REWARD_PER_VIDEO, REWARD_DAILY_CAP - currentReward);
  const nextReward = currentReward + granted;

  // PATCH with the caller's own token: the security rule is what allows only a
  // +3 step up to the cap, so a forged request cannot jump past it.
  try {
    const response = await fetch(DOC_BASE + path + '?currentDocument.exists=' + (usage ? 'true' : 'false') +
      '&updateMask.fieldPath=reward', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        fields: {
          uid: { stringValue: identity.uid },
          day: { stringValue: day },
          reward: { integerValue: String(nextReward) },
          updatedAt: { timestampValue: new Date().toISOString() }
        }
      })
    });
    if (!response.ok) {
      // A rejected write means the rule refused the step (cap reached, or a
      // count-only doc shape). Do not claim a reward that did not stick.
      return sendJson(res, 429, {
        error: 'Could not add the bonus right now. Please try again in a moment.',
        code: 'reward_rejected'
      });
    }
  } catch (error) {
    return sendJson(res, 500, { error: 'Could not add the bonus right now. Please try again.' });
  }

  return sendJson(res, 200, {
    granted: granted,
    reward: nextReward,
    // Effective free ceiling for the day so the UI can show the new total.
    limit: FREE_DAILY_LIMIT + nextReward,
    message: '+' + granted + ' requests added for today. Keep studying.'
  });
}
