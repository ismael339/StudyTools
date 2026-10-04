// Adaptive revision planner.
//
// A generic study planner gives everyone the same advice. This one reads the
// student's real situation, their weak topics from the Study Coach, and their
// own grades, then produces a day by day plan that recalculates every time they
// come back. It is deliberately dependent on data the student enters, which is
// what no free generic planner has.

import { getAdmin } from '../lib/admin.js';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'studytools-b60e9';
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyDx4StAzPExYbQU_9yJ04R7HO2JX1_sq6w';
const VERIFY_URL = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyIdToken?key=' + WEB_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const SITE = (process.env.SITE_URL || 'https://www.studytools.pro').replace(/\/$/, '');

function bearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.indexOf('Bearer ') === 0 || header.indexOf('bearer ') === 0) return header.slice(7);
  return null;
}

async function verifyToken(token) {
  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token })
    });
    if (!response.ok) return null;
    const data = await response.json();
    const uid = data.user_id || data.localId;
    return uid ? { uid, email: data.email || '' } : null;
  } catch (error) { return null; }
}

function dateKey(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

// Spaced repetition: the gap grows each time the student says they got it right.
function nextReviewDay(history, offset) {
  const entries = Array.isArray(history) ? history : [];
  const wins = entries.filter(function (e) { return e && e.right; }).length;
  const base = [1, 2, 4, 7, 15, 30][Math.min(wins, 5)];
  return dateKey(offset + base);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'Sign in to build your revision plan.' });
  const identity = await verifyToken(token);
  if (!identity) return res.status(401).json({ error: 'Your session expired. Log in again.' });

  const admin = getAdmin();
  if (!admin) return res.status(503).json({ error: 'The planner is being set up.' });
  const db = admin.db;

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const subjects = Array.isArray(body.subjects) ? body.subjects.filter(Boolean).slice(0, 10) : [];
  const examDate = /^\d{4}-\d{2}-\d{2}$/.test(body.examDate || '') ? body.examDate : '';
  const hoursPerDay = Number(body.hoursPerDay) || 2;

  if (subjects.length < 1) {
    return res.status(400).json({ error: 'Add at least one subject so the plan has something to schedule.' });
  }

  // Read what the Study Coach already knows about this student.
  let weakTopics = [];
  let reviewHistory = [];
  try {
    const profile = await db.collection('coach_profiles').doc(identity.uid).get();
    if (profile.exists) {
      const data = profile.data();
      weakTopics = (Array.isArray(data.topics) ? data.topics : [])
        .filter(function (t) { return t && t.wrong; })
        .sort(function (a, b) { return (b.wrong || 0) - (a.wrong || 0); })
        .slice(0, 8)
        .map(function (t) { return t.topic; });
    }
    const events = await db.collection('coach_events')
      .where('uid', '==', identity.uid)
      .orderBy('at', 'desc')
      .limit(50)
      .get();
    reviewHistory = events.docs.map(function (doc) { return { topic: doc.data().topic, right: doc.data().kind === 'drill' }; });
  } catch (error) {
    console.warn('planner history read failed:', error && error.message);
  }

  const daysLeft = examDate
    ? Math.max(1, Math.ceil((Date.parse(examDate + 'T12:00:00Z') - Date.now()) / 86400000))
    : 14;

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(503).json({ error: 'The planner is not configured yet.' });

  const system = [
    'You are the revision planner inside StudyTools, a study platform for students.',
    'You are NOT ChatGPT and not an OpenAI product.',
    '',
    'Produce a realistic revision plan. Rules:',
    '- Give a numbered plan, one line per item, each with a time estimate.',
    '- Start with the weakest topics, because they carry the most marks.',
    '- Include at least two active recall or self-testing sessions per day.',
    '- Do not schedule more than the hours the student actually has.',
    '- Finish with one sentence telling them the single most important thing tonight.',
    '- Never invent facts about their syllabus.'
  ].join('\n');

  const userMessage = [
    'My subjects: ' + subjects.join(', '),
    'Days until the exam: ' + daysLeft,
    'Hours I can study each day: ' + hoursPerDay,
    weakTopics.length ? 'Topics I keep failing: ' + weakTopics.join(', ') : 'No weak topics recorded yet.',
    '',
    'Build me today and tomorrow, concretely, and say what to do if I fall behind.'
  ].join('\n');

  let reply = '';
  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groqKey },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        messages: [{ role: 'system', content: system }, { role: 'user', content: userMessage }],
        max_tokens: 900,
        temperature: 0.6
      })
    });
    if (!response.ok) return res.status(502).json({ error: 'The planner could not answer just now.' });
    const data = await response.json();
    const first = data.choices && data.choices[0];
    reply = (first && first.message && first.message.content) || '';
  } catch (error) {
    return res.status(502).json({ error: 'The planner is unreachable. Try again.' });
  }

  await db.collection('plans').doc(identity.uid).set({
    uid: identity.uid,
    subjects: subjects,
    examDate: examDate || null,
    hoursPerDay: hoursPerDay,
    daysLeft: daysLeft,
    generatedAt: new Date().toISOString(),
    nextReview: weakTopics.length ? nextReviewDay(reviewHistory, 1) : null
  }, { merge: true });

  return res.status(200).json({
    ok: true,
    plan: reply,
    daysLeft: daysLeft,
    weakTopics: weakTopics,
    subjects: subjects,
    upgradeUrl: SITE + '/pro.html'
  });
}