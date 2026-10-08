// Newsletter sign-up with double opt-in, plus the unsubscribe link that every
// weekly email carries (handled here because the browser may never write to
// the emails collection).
//
// Subscribing writes one document to the emails collection, which is the same
// collection api/newsletter.js reads on Mondays. Addresses are only marked as
// subscribed after the recipient clicks the link in the confirmation email,
// and nothing is ever written from the browser.

import { getAdmin, adminEnabled } from '../lib/admin.js';
import { verifyUnsubscribe, renderWelcomeEmail } from '../lib/newsletter.js';

const RESEND_API = 'https://api.resend.com/emails';
const FROM = process.env.NEWSLETTER_FROM || 'StudyTools <newsletter@studytools.pro>';
const MIN_INTERVAL_MS = 30 * 1000;

function unsubscribePage(message) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StudyTools newsletter</title></head>' +
    '<body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">' +
    '<div style="max-width:520px;margin:0 auto;padding:60px 20px;text-align:center;">' +
    '<div style="font-size:20px;font-weight:bold;margin-bottom:16px;">StudyTools</div>' +
    '<div style="background:#fff;border-radius:16px;padding:32px;text-align:left;box-shadow:0 8px 30px rgba(15,23,42,.08);">' +
    '<p style="margin:0 0 14px 0;font-size:16px;line-height:1.6;color:#334155;">' + message + '</p>' +
    '<p style="margin:0;font-size:14px;color:#64748b;">The weekly study email stops within a few minutes. The tools and your account keep working exactly as before.</p>' +
    '</div>' +
    '<p style="margin-top:20px;font-size:13px;color:#94a3b8;"><a href="/" style="color:#2563eb;text-decoration:none;">Back to StudyTools</a></p>' +
    '</div></body></html>';
}


// Confirmation result page: a real HTML page (the old raw JSON made browser
// links look broken) with two next steps instead of a dead end.
function confirmPage(message, ok) {
  const next = ok
    ? '<p style="margin:20px 0 0 0;"><a href="/planner.html" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block;">Build my study plan</a></p>' +
      '<p style="margin:12px 0 0 0;font-size:14px;"><a href="/active-recall-study-method.html" style="color:#2563eb;font-weight:700;text-decoration:none;">Read: the active recall method &rarr;</a></p>'
    : '';
  const icon = ok ? '&#9989;' : '&#128269;';
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StudyTools - ' + (ok ? 'you are subscribed' : 'confirmation') + '</title></head>' +
    '<body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">' +
    '<div style="max-width:520px;margin:0 auto;padding:60px 20px;text-align:center;">' +
    '<div style="font-size:20px;font-weight:bold;margin-bottom:16px;">StudyTools</div>' +
    '<div style="background:#fff;border-radius:16px;padding:32px;text-align:left;box-shadow:0 8px 30px rgba(15,23,42,.08);">' +
    '<div style="font-size:34px;margin-bottom:12px;">' + icon + '</div>' +
    '<p style="margin:0 0 14px 0;font-size:16px;line-height:1.6;color:#334155;">' + message + '</p>' +
    next +
    '</div>' +
    '<p style="margin-top:20px;font-size:13px;color:#94a3b8;"><a href="/" style="color:#2563eb;text-decoration:none;">Back to StudyTools</a></p>' +
    '</div></body></html>';
}

// One instance, one throttle: enough to stop a bored spammer without adding
// state that would not survive a cold start anyway.
const lastRequest = new Map();

function emailKey(email) {
  return String(email || '').trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

// Sends one message through Resend and ALWAYS reports the truth: { ok: true }
// or { ok: false, error: 'HTTP 422: ...' }. The old version threw on rejection
// (silently swallowed by the callers) or pretended success when the key was
// missing, which is how subscriptions answered "check your inbox" while no
// email ever left the building.
function sendEmail(to, subject, html, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[newsletter] RESEND_API_KEY is not set in Vercel: the email was NOT sent.');
    return Promise.resolve({ ok: false, error: 'RESEND_API_KEY is not configured in Vercel' });
  }
  return fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text })
  }).then(async function (response) {
    const bodyText = await response.text().catch(function () { return ''; });
    if (!response.ok) {
      return { ok: false, error: 'HTTP ' + response.status + ': ' + bodyText.slice(0, 240) };
    }
    return { ok: true };
  }).catch(function (error) {
    return { ok: false, error: 'network: ' + (error && error.message) };
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  // Confirmation link: /api/subscribe?confirm=TOKEN
  const query = req.query || {};
  if (req.method === 'GET' && query.confirm) {
    const admin = getAdmin();
    if (!admin) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(503).send(confirmPage('Newsletter is being set up. Please try again shortly.', false));
    }
    const snapshot = await admin.db.collection('email_tokens').doc(String(query.confirm)).get();
    if (!snapshot.exists) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(confirmPage('This confirmation link is not valid any more. Sign up again from the homepage or the popup on any tool.', false));
    }
    const token = snapshot.data();
    await admin.db.collection('emails').doc(token.email).set({
      email: token.email,
      subscribed: true,
      confirmedAt: new Date().toISOString(),
      source: token.source || 'website',
      // A fresh confirmation clears any earlier unsubscribe or bounce: this
      // address just received mail from us, so it is reachable and wanted.
      unsubscribed: false,
      bounced: false
    }, { merge: true });
    await admin.db.collection('email_tokens').doc(String(query.confirm)).delete();
    // Step 0 of the drip: the welcome email goes out right at confirmation.
    // A failure here must not undo the confirmation itself.
    try {
      const welcome = renderWelcomeEmail();
      if (welcome) {
        const sent = await sendEmail(token.email, welcome.subject, welcome.htmlFor(token.email), welcome.textFor(token.email));
        if (!sent.ok) {
          console.error('Welcome email failed:', sent.error);
          await admin.db.collection('emails').doc(token.email).set({
            lastSendError: String(sent.error || '').slice(0, 300),
            lastSendErrorAt: new Date().toISOString()
          }, { merge: true });
        }
      }
    } catch (error) {
      console.error('Welcome email failed:', error && error.message);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(confirmPage('You are subscribed. Check your inbox for the welcome email: one study method every Monday, one free tool to try it with, and one click in any message takes you off the list.', true));
  }

  // Unsubscribe: /api/subscribe?u=TOKEN. A GET renders a page for a person,
  // a POST is the one-click protocol mail clients fire from the
  // List-Unsubscribe header of the weekly email.
  if (query.u) {
    const address = verifyUnsubscribe(String(query.u));
    const admin = getAdmin();
    if (!address || !admin) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400)
        .send(unsubscribePage('This unsubscribe link is not valid any more. Use the link at the bottom of the most recent email, or ignore it and nothing else will happen.'));
    }
    await admin.db.collection('emails').doc(address).set({
      email: address,
      subscribed: false,
      unsubscribed: true,
      unsubscribedAt: new Date().toISOString()
    }, { merge: true });
    if (req.method === 'POST') return res.status(204).end();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(unsubscribePage('You have been unsubscribed from the weekly study email. This address will not receive it any more.'));
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
    // Someone asking again is not unsubscribed any more.
    unsubscribed: false,
    requestedAt: new Date().toISOString(),
    source: (body.source || 'website').toString().slice(0, 40)
  }, { merge: true });
  await admin.db.collection('email_tokens').doc(token).set({
    email: email,
    source: (body.source || 'website').toString().slice(0, 40),
    createdAt: new Date().toISOString()
  });

  const sent = await sendEmail(
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
  if (!sent.ok) {
    // A subscription whose confirmation never arrives is worse than an honest
    // failure: say so, remember the reason on the document, and let the person
    // try again once the mail service works.
    console.error('Confirmation email failed:', sent.error);
    try {
      await admin.db.collection('emails').doc(email).set({
        lastSendError: String(sent.error || '').slice(0, 300),
        lastSendErrorAt: new Date().toISOString()
      }, { merge: true });
    } catch (recordError) {
      console.error('Could not record the send error:', recordError && recordError.message);
    }
    return res.status(502).json({
      ok: false,
      error: 'The subscription was saved, but the confirmation email could not be sent (' + String(sent.error || 'unknown error').slice(0, 160) + '). Please try again later.'
    });
  }

  return res.status(200).json({ ok: true, message: 'Check your inbox to confirm your subscription.' });
}