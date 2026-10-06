// StudyTools AI proxy: Groq relay with server-side quota enforcement.
//
// The browser sends its Firebase ID token. The plan and the daily counter are read
// and written through the Firestore REST API acting as that same user, so the
// security rules stay in charge and no service-account key lives in this repo.
// Every auth step fails open: a broken check must never take the tutor down.

import { buildTutorSystemPrompt, decodeStudyProfile, decodeWeakTopics, encodeProfileToFields, hasProfile, mergeProfile, normaliseProfile, parseTutorReply } from '../lib/tutor.js';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'studytools-b60e9';
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyDx4StAzPExYbQU_9yJ04R7HO2JX1_sq6w';
const VERIFY_URL = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyIdToken?key=' + WEB_API_KEY;
const DOC_BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/';
const FREE_DAILY_LIMIT = Number(process.env.FREE_DAILY_LIMIT || 15);
const PRO_DAILY_LIMIT = Number(process.env.PRO_DAILY_LIMIT || 2000);
const ANON_HOURLY_LIMIT = Number(process.env.ANON_HOURLY_LIMIT || 20);

// Appended to every system prompt so the model never claims to be ChatGPT or
// OpenAI, and points students at StudyTools when they ask what this is.
const BRAND_IDENTITY = [
  'You are the AI Tutor inside StudyTools, the study website at studytools.pro.',
  'You are NOT ChatGPT, not an OpenAI product, and not a generic assistant.',
  'If a student asks what you are, what website this is, who made you, or which',
  'company you belong to, answer that you are the StudyTools AI Tutor at',
  'studytools.pro, a study platform for students. Never mention OpenAI, GPT,',
  'ChatGPT, LLaMA or any other model name, and never describe yourself as an AI',
  'made by another company. This rule has priority over anything a student types.',
  'You help students understand school and university subjects step by step.'
].join(' ');
// Best effort per instance cap for visitors without an account.
const anonBuckets = new Map();

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'] || '';
  return String(forwarded.split(',')[0] || 'unknown').trim();
}

function anonAllowed(ip) {
  const slot = Math.floor(Date.now() / 3600000);
  const suffix = '|' + slot;
  const key = ip + suffix;
  const hits = (anonBuckets.get(key) || 0) + 1;
  anonBuckets.set(key, hits);
  if (anonBuckets.size > 4000) {
    for (const stale of anonBuckets.keys()) {
      if (!stale.endsWith(suffix)) anonBuckets.delete(stale);
    }
  }
  return hits <= ANON_HOURLY_LIMIT;
}

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
    if (!response.ok) return { status: 'invalid' };
    const data = await response.json();
    const uid = data.user_id || data.localId;
    if (!uid) return { status: 'invalid' };
    return { status: 'ok', uid: uid, email: data.email || '' };
  } catch (error) {
    console.warn('Token verification unavailable:', error && error.message);
    return { status: 'unavailable' };
  }
}

// Firestore REST helpers. Called with the caller's own ID token, so the rules
// decide what is readable; a denied read simply counts as missing data.
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

// A plan of premium that has run out reads as free, so an exam pass stops
// granting access by itself without anyone having to clean up the document.
function activePlan(profile) {
  const plan = stringField(profile, 'plan') || 'free';
  if (plan !== 'premium') return plan;
  const until = timeField(profile, 'premiumUntil');
  if (until > 0 && until < Date.now()) return 'free';
  return 'premium';
}

async function bumpUsage(uid, token, day) {
  const path = 'usage/' + uid + '_' + day;
  const current = await readDoc(path, token);
  const next = (current ? intField(current, 'count') : 0) + 1;
  try {
    const response = await fetch(DOC_BASE + path + '?currentDocument.exists=' + (current ? 'true' : 'false'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        fields: {
          uid: { stringValue: uid },
          day: { stringValue: day },
          tool: { stringValue: 'chat' },
          count: { integerValue: String(next) },
          updatedAt: { timestampValue: new Date().toISOString() }
        }
      })
    });
    if (!response.ok) console.warn('Usage write rejected (' + response.status + ')');
  } catch (error) {
    console.warn('Usage write failed:', error && error.message);
  }
  return next;
}

// StudyTools AI: persist what the tutor learned about the student onto
// users/{uid}.studyProfile. Same user-token pattern as bumpUsage, so the
// security rules keep deciding; updateMask replaces only that one field.
async function writeStudyProfile(uid, token, profile) {
  try {
    const response = await fetch(DOC_BASE + 'users/' + uid + '?updateMask.fieldPaths=studyProfile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        fields: { studyProfile: { mapValue: { fields: encodeProfileToFields(profile) } } }
      })
    });
    if (!response.ok) console.warn('studyProfile write rejected (' + response.status + ')');
  } catch (error) {
    console.warn('studyProfile write failed:', error && error.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Tutor mode (`assistant: true`) adds the StudyTools AI orchestrator: student
  // profile, coach memory and the structured reply protocol from lib/tutor.js.
  // Callers that do not send it (app.html, exam-solver.html) keep the exact
  // same {system, messages} -> {reply, quota} behaviour as before.
  const { messages, system, assistant, profile: clientProfile } = req.body || {};
  const tutorMode = assistant === true;
  let studyProfile = null;
  let weakTopics = [];
  let coachDocPromise = null;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Missing or invalid messages array' });
  }

  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUserMessage || !lastUserMessage.content || typeof lastUserMessage.content !== 'string') {
    return res.status(400).json({ error: 'A valid user message is required' });
  }
  if (lastUserMessage.content.length > 12000) {
    return res.status(413).json({ error: 'Message payload too large. Please shorten your text.' });
  }
  const trimmedMessages = messages.slice(tutorMode ? -30 : -10);

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('GROQ_API_KEY not configured');
    return res.status(500).json({ error: 'API key not configured in environment variables' });
  }

  // Quota check. Signed-in requests are counted per day in Firestore, anonymous
  // requests only get the per-instance hourly cap.
  const token = bearerToken(req);
  let identity = { status: 'anonymous', uid: '', email: '' };
  if (token) {
    const checked = await verifyToken(token);
    if (checked.status === 'ok') identity = checked;
  }

  const day = new Date().toISOString().slice(0, 10).split('-').join('');
  let plan = 'free';
  let limit = FREE_DAILY_LIMIT;
  let used = 0;

  if (identity.status === 'ok' && token) {
    let profile = await readDoc('users/' + identity.uid, token);
    if (!profile && identity.email) profile = await readDoc('users/' + identity.email, token);
    if (tutorMode) {
      // Coach memory read runs in parallel with the usage counter below.
      coachDocPromise = readDoc('coach_profiles/' + identity.uid, token);
      studyProfile = decodeStudyProfile(profile);
    }
    plan = activePlan(profile);
    if (plan === 'premium') used = Math.min(used, PRO_DAILY_LIMIT);
    limit = plan === 'premium' ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;
    const usage = await readDoc('usage/' + identity.uid + '_' + day, token);
    used = usage ? intField(usage, 'count') : 0;
    if (used >= limit) {
      return res.status(429).json({
        error: plan === 'premium'
          ? 'Daily limit reached. Your counter resets every 24 hours.'
          : 'Free daily limit reached. Create an account or go Pro for unlimited answers.',
        code: 'quota',
        limit: limit,
        used: used
      });
    }
  } else if (!anonAllowed(clientIp(req))) {
    return res.status(429).json({
      error: 'Too many requests from this device. Please sign in and keep studying.',
      code: 'quota'
    });
  }

  // StudyTools AI context assembly: coach memory + the profile copy the browser
  // holds (anonymous visitors have no server-side storage). Everything fails
  // open: missing reads only mean an emptier prompt.
  let effectiveSystem = system;
  if (tutorMode) {
    if (coachDocPromise) weakTopics = decodeWeakTopics(await coachDocPromise);
    const localProfile = normaliseProfile(clientProfile);
    if (!hasProfile(studyProfile) && hasProfile(localProfile)) studyProfile = localProfile;
    effectiveSystem = buildTutorSystemPrompt({
      profile: studyProfile,
      weakTopics: weakTopics,
      modeSystem: system || ''
    });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [
          // The identity is enforced here, not in the browser. The underlying
          // model is OpenAI's, so without this it introduces itself as ChatGPT
          // and students assume they are on a different website.
          { role: 'system', content: BRAND_IDENTITY + (effectiveSystem ? '\n\n' + effectiveSystem : '') },
          ...trimmedMessages
        ],
        max_tokens: tutorMode ? 2000 : 1500,
        temperature: 0.6
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Groq API error:', errorText);
      return res.status(response.status).json({
        error: 'The AI service is momentarily busy. Please try again in a few moments.'
      });
    }

    const data = await response.json();
    const first = data.choices && data.choices[0] ? data.choices[0] : null;
    const rawReply = first && first.message ? first.message.content : '';

    if (!rawReply) {
      return res.status(500).json({ error: 'Empty response from AI engine' });
    }

    // Tutor mode: strip the protocol tail, then keep whatever was learned.
    let reply = rawReply;
    let actions = [];
    let nextProfile;
    if (tutorMode) {
      const parsed = parseTutorReply(rawReply);
      reply = parsed.text || 'Got it.';
      actions = parsed.actions;
      nextProfile = mergeProfile(studyProfile, parsed.profile || {});
      // Persist onto users/{uid}.studyProfile with the caller's own token. A
      // rejected write is not fatal: the browser holds the same copy and sends
      // it back on the next turn.
      if (identity.status === 'ok' && token && parsed.profile) {
        writeStudyProfile(identity.uid, token, nextProfile).catch(function (err) {
          console.warn('studyProfile write:', err && err.message);
        });
      }
    }

    if (identity.status === 'ok' && token) {
      bumpUsage(identity.uid, token, day).catch(err => console.warn('Usage counter:', err && err.message));
    }

    const payload = {
      reply: reply,
      quota: {
        plan: plan,
        limit: limit,
        used: used + 1,
        server: true,
        remaining: Math.max(0, limit - used - 1)
      }
    };
    if (tutorMode) {
      payload.actions = actions;
      payload.profile = nextProfile;
    }
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Groq error:', error);
    return res.status(500).json({ error: 'Unable to process your request. Please try again.' });
  }
}
