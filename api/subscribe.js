// Newsletter sign-up with double opt-in.
//
// Subscribing writes one document to the emails collection, which is the same
// collection .github/scripts/send-weekly-email.js already reads, so the weekly
// email starts working again instead of exiting with NO_EMAILS. Addresses are
// only marked as subscribed after the recipient clicks the link in the
// confirmation email, and nothing is ever written from the browser.

import { getAdmin, adminEnabled } from '../lib/admin.js';

const RESEND_API = 'https://api.resend.com/emails';
const FROM = process.env.NEWSLETTER_FROM || 'StudyTools <newsletter@studytools.pro>';
const MIN_INTERVAL_MS = 30 * 1000;

// One instance, one throttle: enough to stop a bored spammer without adding
// state that would not survive a cold start anyway.
const lastRequest = new Map();

function emailKey(email) {
  return String(email || '').trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

function sendEmail(to, subject, html, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return Promise.resolve({ skipped: true });
  return fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text })
  }).then(function (response) {
    if (!response.ok) throw new Error('Resend rejected the message (' + response.status + ')');
    return response.json();
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  // Confirmation link: /api/subscribe?confirm=TOKEN
  const query = req.query || {};
  if (req.method === 'GET' && query.confirm) {
    const admin = getAdmin();
    if (!admin) {
      return res.status(503).json({ ok: false, error: 'Newsletter is being set up. Please try again shortly.' });
    }
    const snapshot = await admin.db.collection('email_tokens').doc(String(query.confirm)).get();
    if (!snapshot.exists) {
      return res.status(400).json({ ok: false, error: 'This confirmation link is not valid any more. Sign up again from the homepage.' });
    }
    const token = snapshot.data();
    await admin.db.collection('emails').doc(token.email).set({
      email: token.email,
      subscribed: true,
      confirmedAt: new Date().toISOString(),
      source: token.source || 'website'
    }, { merge: true });
    await admin.db.collection('email_tokens').doc(String(query.confirm)).delete();
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const email = emailKey(body.email);

  if (body.website) {
    // Honeypot: a hidden field only a bot fills in. Pretend it worked.
    return res.status(200).json({ ok: true, message: 'Check your inbox to confirm your subscription.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: 'That email address does not look right. Check it and try again.' });
  }
  if (!adminEnabled() || !getAdmin()) {
    return res.status(503).json({
      ok: false,
      error: 'The newsletter is not switched on yet. The study guides and tools all work without it in the meantime.'
    });
  }

  const admin = getAdmin();
  const bucket = Math.floor(Date.now() / MIN_INTERVAL_MS);
  const throttleKey = email + '|' + bucket;
  if (lastRequest.has(throttleKey)) {
    return res.status(200).json({ ok: true, message: 'Check your inbox to confirm your subscription.' });
  }
  lastRequest.set(throttleKey, true);
  if (lastRequest.size > 2000) {
    for (const key of lastRequest.keys()) {
      if (!key.endsWith('|' + bucket)) lastRequest.delete(key);
    }
  }

  const existing = await admin.db.collection('emails').doc(email).get();
  if (existing.exists && existing.data().subscribed === true) {
    return res.status(200).json({ ok: true, message: 'You are already on the list. Nothing else to do.' });
  }

  const token = Buffer.from(email + ':' + Date.now() + ':' + Math.random().toString(36).slice(2)).toString('base64url');
  const site = (process.env.SITE_URL || 'https://www.studytools.pro').replace(/\/$/, '');
  await admin.db.collection('emails').doc(email).set({
    email: email,
    subscribed: false,
    requestedAt: new Date().toISOString(),
    source: (body.source || 'website').toString().slice(0, 40)
  }, { merge: true });
  await admin.db.collection('email_tokens').doc(token).set({
    email: email,
    source: (body.source || 'website').toString().slice(0, 40),
    createdAt: new Date().toISOString()
  });

  try {
    await sendEmail(
      email,
      'One click and you are in',
      '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">' +
        '<h2 style="color:#0f172a">Confirm your StudyTools newsletter</h2>' +
        '<p style="color:#475569;line-height:1.6">Once a week, one study method that actually works and the free tools that go with it. No promotions, and you can leave with one click.</p>' +
        '<p style="margin:26px 0"><a href="' + site + '/api/subscribe?confirm=' + encodeURIComponent(token) + '" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-weight:700;display:inline-block">Confirm my subscription</a></p>' +
        '<p style="color:#64748b;font-size:14px">If you did not ask for this, ignore this email and nothing will happen.</p>' +
        '</div>',
      'Confirm your StudyTools newsletter: ' + site + '/api/subscribe?confirm=' + encodeURIComponent(token) +
        '\n\nIf you did not ask for this, ignore this email.'
    );
  } catch (error) {
    console.error('Confirmation email failed:', error && error.message);
  }

  return res.status(200).json({ ok: true, message: 'Check your inbox to confirm your subscription.' });
}