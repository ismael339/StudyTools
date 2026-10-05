// The weekly marketing email.
//
// This replaces the GitHub Actions job (.github/workflows/weekly-email.yml)
// that used to run on Mondays and failed on every run: GitHub needs its own
// copies of the Firebase and Resend secrets, and when one of them is missing
// the script dies before sending anything. Vercel already holds a working
// service account for billing, so the send now lives here and is triggered by
// the cron entry in vercel.json.
//
//   GET /api/newsletter?dryRun=1     public: counts only, sends nothing
//   GET /api/newsletter              called by Vercel Cron every Monday 09:00
//   GET /api/newsletter?secret=X     manual run of the current week
//   GET /api/newsletter?test=1&to=a@b.c&secret=X   one email, to yourself
//
// A run is recorded per ISO week in newsletter_runs/{week}, so the same week is
// never sent twice and a failed run (for example the free Resend daily quota of
// 100 emails) can be resumed with another call using the remaining list.

import { getAdmin, adminEnabled } from '../lib/admin.js';
import {
  renderWeeklyEmail,
  mergeRecipients,
  maskEmail,
  weekKeyOf,
  fromAddress,
  normaliseEmail,
  isEmailLike
} from '../lib/newsletter.js';

// Resend accepts at most 100 messages in one batch request.
const BATCH_URL = 'https://api.resend.com/emails/batch';
const BATCH_SIZE = 100;
const TEST_COOLDOWN_MS = 10 * 60 * 1000;
const lastTestSend = { at: 0 };

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function sendJson(res, status, body) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(status).json(body);
}

function isCronRequest(req) {
  const headers = req.headers || {};
  const agent = String(headers['user-agent'] || '');
  return agent.indexOf('vercel-cron') === 0 || Boolean(headers['x-vercel-cron-schedule']);
}

// Cron passes on its user agent; anything else has to present CRON_SECRET.
function isAuthorized(req, query) {
  if (isCronRequest(req)) return true;
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && query.secret === secret;
}

// Every address from both sources, minus unsubscribes and hard bounces.
async function collectRecipients(db, auth, includeUsers) {
  const subscribers = [];
  const excluded = [];
  let lastDoc = null;
  for (let page = 0; page < 40; page++) {
    let query = db.collection('emails').orderBy('__name__').limit(500);
    if (lastDoc) query = query.startAfter(lastDoc);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    snapshot.docs.forEach(function (doc) {
      const data = doc.data() || {};
      const email = normaliseEmail(data.email || doc.id);
      if (!isEmailLike(email)) return;
      if (data.unsubscribed === true || data.bounced === true) {
        excluded.push(email);
        return;
      }
      if (data.subscribed === true) subscribers.push(email);
    });
    if (snapshot.docs.length < 500) break;
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  const registered = [];
  let authError = null;
  if (includeUsers && auth) {
    try {
      let pageToken;
      for (let page = 0; page < 20; page++) {
        const result = await auth.listUsers(1000, pageToken);
        result.users.forEach(function (user) { if (user.email) registered.push(user.email); });
        pageToken = result.pageToken;
        if (!pageToken) break;
      }
    } catch (error) {
      authError = error && error.message;
    }
  }

  return {
    subscribers: subscribers,
    registered: registered,
    excluded: excluded,
    authError: authError,
    recipients: mergeRecipients({ subscribers: subscribers, registered: registered, excluded: excluded })
  };
}

// One batch call. If Resend rejects the batch the addresses are split in half
// and retried, so a single dead mailbox never blocks the other ninety-nine.
async function sendChunk(apiKey, recipients, messageFor) {
  const payload = recipients.map(function (recipient) {
    const message = messageFor(recipient.email);
    return {
      from: fromAddress(),
      to: [recipient.email],
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: {
        'List-Unsubscribe': '<' + message.unsubscribeUrl + '>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      }
    };
  });

  let response;
  try {
    response = await fetch(BATCH_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    return { sent: [], failed: recipients.map(function (r) { return { email: r.email, error: 'network: ' + (error && error.message) }; }), stop: 'network_error' };
  }

  const bodyText = await response.text();
  if (response.ok) {
    return { sent: recipients.map(function (r) { return r.email; }), failed: [] };
  }

  // 429 is the daily quota (100/day on the free plan) or the rate limit:
  // stop, keep the unsent addresses and let the next call resume.
  if (response.status === 429) {
    return { sent: [], failed: [], stop: bodyText.slice(0, 300) };
  }
  if (recipients.length === 1) {
    return {
      sent: [],
      failed: [{ email: recipients[0].email, error: 'HTTP ' + response.status + ': ' + bodyText.slice(0, 300) }]
    };
  }
  const mid = Math.ceil(recipients.length / 2);
  await sleep(150);
  const first = await sendChunk(apiKey, recipients.slice(0, mid), messageFor);
  const second = await sendChunk(apiKey, recipients.slice(mid), messageFor);
  return {
    sent: first.sent.concat(second.sent),
    failed: first.failed.concat(second.failed),
    stop: first.stop || second.stop || null
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const query = req.query || {};
  const dryRun = query.dryRun === '1' || query.dryRun === 'true';
  const includeUsers = process.env.NEWSLETTER_INCLUDE_USERS !== 'false';
  const resendKey = process.env.RESEND_API_KEY;
  const authorized = isAuthorized(req, query);

  if (!adminEnabled() || !getAdmin()) {
    return sendJson(res, 503, {
      ok: false,
      error: 'FIREBASE_SERVICE_ACCOUNT is not configured in Vercel, so the recipient list cannot be read.'
    });
  }
  const admin = getAdmin();
  const db = admin.db;
  const now = new Date();
  const week = weekKeyOf(now);
  const started = Date.now();

  let auth = null;
  try {
    auth = admin.admin.auth();
  } catch (error) {
    auth = null;
  }

  if (dryRun) {
    const list = await collectRecipients(db, auth, includeUsers);
    const preview = renderWeeklyEmail(now);
    return sendJson(res, 200, {
      ok: true,
      dryRun: true,
      week: week,
      recipients: list.recipients.length,
      sources: {
        confirmedSubscribers: list.subscribers.length,
        registeredAccounts: list.registered.length,
        excludedUnsubscribedOrBounced: list.excluded.length
      },
      sample: authorized && list.recipients.length ? maskEmail(list.recipients[0].email) : undefined,
      listUsersError: list.authError || undefined,
      subject: preview.subject,
      includeRegisteredUsers: includeUsers,
      resendConfigured: Boolean(resendKey),
      hint: resendKey
        ? 'Ready: Vercel Cron sends this every Monday at 09:00 UTC.'
        : 'RESEND_API_KEY is missing in Vercel. Nothing can be sent until it is added (Settings > Environment Variables), then redeploy.'
    });
  }

  if (!authorized) {
    return sendJson(res, 403, {
      ok: false,
      error: 'Not authorized. Vercel Cron calls this every Monday by itself; for a manual run add &secret=YOUR_CRON_SECRET (set CRON_SECRET in Vercel). ?dryRun=1 needs no secret and sends nothing.'
    });
  }

  const emailRender = renderWeeklyEmail(now);
  const messageFor = function (email) {
    return {
      subject: emailRender.subject,
      html: emailRender.htmlFor(email),
      text: emailRender.textFor(email),
      unsubscribeUrl: emailRender.unsubscribeUrlFor(email)
    };
  };

  // One address, one copy of the real email, without touching the weekly run.
  if (query.test === '1') {
    const to = normaliseEmail(query.to);
    if (!isEmailLike(to)) {
      return sendJson(res, 400, { ok: false, error: 'Add the address to test: &test=1&to=you@example.com' });
    }
    if (!resendKey) {
      return sendJson(res, 500, { ok: false, error: 'RESEND_API_KEY is missing in Vercel, so nothing can be sent.' });
    }
    if (Date.now() - lastTestSend.at < TEST_COOLDOWN_MS) {
      return sendJson(res, 429, { ok: false, error: 'A test email was already sent in the last 10 minutes. Check the inbox.' });
    }
    const result = await sendChunk(resendKey, [{ email: to }], messageFor);
    if (result.sent.length) {
      lastTestSend.at = Date.now();
      return sendJson(res, 200, { ok: true, mode: 'test', to: maskEmail(to), subject: emailRender.subject });
    }
    return sendJson(res, 502, { ok: false, mode: 'test', errors: result.failed });
  }

  const runRef = db.collection('newsletter_runs').doc(week);
  const existing = await runRef.get();
  const run = existing.exists ? (existing.data() || {}) : {};
  const force = query.force === '1' || query.force === 'true';

  if (run.status === 'sent' && !force) {
    return sendJson(res, 200, {
      ok: true,
      skipped: 'already_sent_this_week',
      week: week,
      sent: Number(run.sent || 0),
      hint: 'Week ' + week + ' was already delivered. Add &force=1 to send it again.'
    });
  }

  const list = await collectRecipients(db, auth, includeUsers);
  let todo = list.recipients;
  const resumed = run.status === 'partial' && Array.isArray(run.pending) && run.pending.length > 0;
  if (resumed) {
    // Keep only addresses that are still on the list, so anyone who left since
    // the failed attempt does not receive it after all.
    const pendingSet = new Set(run.pending.map(normaliseEmail));
    todo = todo.filter(function (recipient) { return pendingSet.has(recipient.email); });
  }

  if (!resendKey) {
    return sendJson(res, 500, {
      ok: false,
      week: week,
      recipients: todo.length,
      error: 'RESEND_API_KEY is missing in Vercel. Add it under Settings > Environment Variables and redeploy, then call this again.'
    });
  }

  if (!todo.length) {
    await runRef.set({
      week: week,
      status: 'sent',
      total: 0,
      sent: 0,
      note: 'no recipients',
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return sendJson(res, 200, { ok: true, week: week, sent: 0, recipients: 0, hint: 'Nobody to write to: the newsletter list is empty and there are no registered accounts.' });
  }

  let sent = resumed ? Number(run.sent || 0) : 0;
  const total = sent + todo.length;
  const failed = [];
  let stopReason = null;
  let remaining = todo;

  await runRef.set({
    week: week,
    status: 'sending',
    total: total,
    sent: sent,
    resumed: resumed,
    startedAt: new Date().toISOString()
  }, { merge: true });

  for (let index = 0; index < todo.length && !stopReason; index += BATCH_SIZE) {
    const chunk = todo.slice(index, index + BATCH_SIZE);
    const result = await sendChunk(resendKey, chunk, messageFor);
    sent += result.sent.length;
    failed.push.apply(failed, result.failed);
    stopReason = result.stop || null;
    remaining = stopReason ? todo.slice(index) : todo.slice(index + chunk.length);

    await runRef.set({
      week: week,
      status: remaining.length ? 'partial' : 'sent',
      total: total,
      sent: sent,
      failedCount: failed.length,
      pending: remaining.map(function (recipient) { return recipient.email; }),
      lastError: stopReason,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    if (!stopReason) await sleep(200);
  }

  // An address Resend calls bounced or suppressed is removed from next week's
  // list straight away, because a rising bounce rate gets the account paused.
  for (const failure of failed) {
    if (failure.email && /bounce|suppress|blocked|invalid/i.test(failure.error || '')) {
      try {
        await db.collection('emails').doc(failure.email).set({
          email: failure.email,
          bounced: true,
          bouncedAt: new Date().toISOString()
        }, { merge: true });
      } catch (error) { /* not on the newsletter list, nothing to mark */ }
    }
  }

  return sendJson(res, stopReason ? 503 : 200, {
    ok: !stopReason,
    mode: resumed ? 'resume' : 'send',
    week: week,
    total: total,
    sent: sent,
    failed: failed.length,
    pending: remaining.length,
    sources: {
      confirmedSubscribers: list.subscribers.length,
      registeredAccounts: list.registered.length,
      excludedUnsubscribedOrBounced: list.excluded.length
    },
    errors: failed.slice(0, 5),
    stopReason: stopReason,
    durationMs: Date.now() - started,
    hint: stopReason
      ? 'Stopped early (usually the free Resend limit of 100 emails per day). Call the same URL again tomorrow to send the remaining ' + remaining.length + '.'
      : (failed.length
          ? 'Sent ' + sent + ', ' + failed.length + ' address(es) rejected. Rejected addresses are listed above.'
          : 'Delivered to Resend for ' + sent + ' recipient(s).')
  });
}
