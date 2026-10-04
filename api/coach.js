// Study Coach: the part of StudyTools that no free site can copy.
//
// Free AI tutors answer a question and forget it. This one keeps a memory of
// every topic the student has struggled with, and drills exactly those, from the
// student's own material. That history lives in the student's account, which is
// the reason to pay rather than paste the same question into a free chatbot.
//
// It is deliberately not a better chatbot. It is the same model with a memory.

import { getAdmin, adminEnabled } from '../lib/admin.js';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'studytools-b60e9';
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyDx4StAzPExYbQU_9yJ04R7HO2JX1_sq6w';
const VERIFY_URL = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyIdToken?key=' + WEB_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const SITE = (process.env.SITE_URL || 'https://www.studytools.pro').replace(/\/$/, '');

const FREE_DRILLS_PER_MONTH = 2;
const PRO_DRILLS_PER_MONTH = 40;

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

function monthKey() {
  return new Date().toISOString().slice(0, 7);
}

function timeField(value) {
  if (!value) return 0;
  if (typeof value.timestampValue === 'string') return Date.parse(value.timestampValue) || 0;
  if (typeof value.integerValue !== 'undefined') return Number(value.integerValue);
  return 0;
}

function stringField(fields, name) {
  const value = fields && fields[name];
  return value && typeof value.stringValue === 'string' ? value.stringValue : '';
}

// Turns a raw student message into a short topic label, so the same question
// asked twice counts as the same weak spot instead of two separate ones.
function normaliseTopic(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(function (word) { return word.length > 3; })
    .slice(0, 4)
    .join(' ')
    .trim();
}

function buildCoachPrompt(profile, material, mode) {
  const weak = profile.length
    ? profile.map(function (item) {
        return '- ' + item.topic + ' (wrong ' + item.wrong + ' times, last seen ' + (item.lastSeen || 'unknown') + ')';
      }).join('\n')
    : '- no history yet, this is the first session';

  return [
    'You are the Study Coach inside StudyTools, a study platform for students.',
    'You are NOT ChatGPT and not an OpenAI product. If asked, say you are StudyTools at studytools.pro.',
    '',
    'WHAT MAKES YOU DIFFERENT FROM A GENERIC CHATBOT: you remember this student.',
    'Their weak topics so far:',
    weak,
    '',
    'The material they just submitted:',
    (material || '(none, they only tapped the button)').slice(0, 6000),
    '',
    mode === 'quiz'
      ? 'Build a quiz of 5 questions ONLY on their weak topics. Mix difficulty. Do not give the answers yet. Put each question under QUESTION 1, QUESTION 2 and so on, and never answer them in this message.'
      : 'Give a short, focused coaching response: name the one thing blocking them, explain it in under 150 words, then give the single next action. No long essays.',
    '',
    'Rules: never invent facts, keep the language of the student, and never mention OpenAI or other models.'
  ].join('\n');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const mode = body.mode === 'quiz' ? 'quiz' : 'coach';
  const token = bearerToken(req);

  if (!token) return res.status(401).json({ error: 'Sign in to use the Study Coach.' });
  const identity = await verifyToken(token);
  if (!identity) return res.status(401).json({ error: 'Your session expired. Log in again.' });

  const admin = getAdmin();
  if (!admin) {
    return res.status(503).json({ error: 'The Study Coach is being set up. Try again shortly.' });
  }
  const db = admin.db;
  const now = Date.now();

  const userRef = db.collection('users').doc(identity.uid);
  const profileRef = db.collection('coach_profiles').doc(identity.uid);

  // Read the memory of this student.
  const memory = await db.collection('coach_events')
    .where('uid', '==', identity.uid)
    .orderBy('at', 'desc')
    .limit(120)
    .get();

  const events = memory.docs.map(function (doc) { return doc.data(); });
  const profileSnapshot = await profileRef.get();
  const stored = profileSnapshot.exists ? profileSnapshot.data() : {};
  const storedTopics = Array.isArray(stored.topics) ? stored.topics : [];

  const nowMonth = monthKey();
  const drillsThisMonth = events.filter(function (event) {
    return event.kind === 'drill' && String(event.month || '') === nowMonth;
  }).length;

  // Plan state: free accounts get a taste, Pro gets the full version.
  let isPro = false;
  let premiumUntil = 0;
  try {
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const data = userSnap.data();
      isPro = data.plan === 'premium';
      const until = data.premiumUntil && data.premiumUntil.toDate ? data.premiumUntil.toDate().getTime() : timeField(data.premiumUntil);
      if (isPro && until > 0 && until < now) isPro = false;
    }
  } catch (error) {
    /* treated as free */
  }

  const allowance = isPro ? PRO_DRILLS_PER_MONTH : FREE_DRILLS_PER_MONTH;
  if (drillsThisMonth >= allowance) {
    return res.status(402).json({
      error: isPro
        ? 'You have used this month drills. They reset on the first of next month.'
        : 'You have used your ' + FREE_DRILLS_PER_MONTH + ' free Study Coach drills this month. Pro includes ' + PRO_DRILLS_PER_MONTH + '.',
      code: 'coach_limit',
      isPro: isPro
    });
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(503).json({ error: 'The Study Coach is not configured yet.' });

  const weakProfile = storedTopics
    .filter(function (item) { return item && item.wrong > 0; })
    .sort(function (a, b) { return (b.wrong || 0) - (a.wrong || 0); })
    .slice(0, 8);

  const material = body.material || '';
  const newTopic = normaliseTopic(body.topic || body.message || material.slice(0, 120));

  const system = buildCoachPrompt(weakProfile, material, mode);

  const userMessage = mode === 'quiz'
    ? 'Build the drill now.'
    : 'Coach me on what I just submitted.';

  let reply = '';
  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqKey },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userMessage }
        ],
        max_tokens: mode === 'quiz' ? 1200 : 400,
        temperature: 0.7
      })
    });
    if (!response.ok) {
      console.error('Coach AI error:', await response.text());
      return res.status(502).json({ error: 'The Study Coach could not answer just now. Try again.' });
    }
    const data = await response.json();
    const first = data.choices && data.choices[0];
    reply = (first && first.message && first.message.content) || '';
  } catch (error) {
    return res.status(502).json({ error: 'The Study Coach is unreachable. Try again.' });
  }

  // Update the memory so the next visit is different from a fresh chatbot.
  if (newTopic) {
    const list = storedTopics.slice();
    const existing = list.find(function (item) { return item.topic === newTopic; });
    if (existing) {
      existing.wrong = (existing.wrong || 0) + 1;
      existing.lastSeen = new Date(now).toISOString();
    } else {
      list.push({ topic: newTopic, wrong: 1, lastSeen: new Date(now).toISOString() });
    }
    await profileRef.set({ uid: identity.uid, email: identity.email || null, topics: list.slice(-60), updatedAt: new Date(now).toISOString() }, { merge: true });
  }

  await db.collection('coach_events').add({
    uid: identity.uid,
    kind: mode === 'quiz' ? 'drill' : 'coach',
    topic: newTopic || null,
    month: nowMonth,
    at: new Date(now).toISOString()
  });

  return res.status(200).json({
    ok: true,
    reply: reply,
    mode: mode,
    isPro: isPro,
    drillsLeft: Math.max(0, allowance - drillsThisMonth - 1),
    allowance: allowance,
    weakTopics: weakProfile.slice(0, 6).map(function (item) { return item.topic; }),
    upgradeUrl: SITE + '/pro.html'
  });
}