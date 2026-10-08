// The onboarding drip: the welcome email plus three follow-ups that introduce
// one method and one tool each, sent by Vercel Cron once a day (vercel.json).
//
//   GET /api/email-drip?dryRun=1   public: who is due; sends nothing
//   GET /api/email-drip            called by Vercel Cron every day at 12:30 UTC
//   GET /api/email-drip?secret=X   manual run of today's batch
//   GET /api/email-drip?secret=X&force=1   run again even if today already ran
//
// Cadence (DRIP_DELAYS_DAYS in lib/newsletter.js): step 0 (welcome) at
// confirmation or registration, then +1, +3 and +6 days. State lives in
// email_drip/{email} as { startedAt, nextStep }, one step per address per run,
// so an old backlog can never turn into four emails at once. Every run is
// recorded in drip_runs/{YYYY-MM-DD}.
//
// The daily cap (DRIP_DAILY_LIMIT, default 40) exists because the free Resend
// plan allows 100 emails per day and Monday's newsletter uses part of that.

import { getAdmin, adminEnabled } from '../lib/admin.js';
import {
  renderDripEmail,
  DRIP_DELAYS_DAYS,
  MAX_DRIP_STEP,
  dripDueAt,
  maskEmail,
  normaliseEmail,
  isEmailLike,
  fromAddress
} from '../lib/newsletter.js';

const RESEND_API = 'https://api.resend.com/emails';
const DEFAULT_DAILY_LIMIT = 40;
// A welcome arriving three weeks late is worse than no welcome at all.
const MAX_AGE_FOR_DRIP_MS = 7 * 86400000;
// Skip a step for good after this many failures (dead mailbox, etc.).
const GIVE_UP_AFTER = 3;
// nextStep >= this means "nothing left to send".
const DONE_STEP = 99;
const SLEEP_MS = 150;

function sendJson(res, status, body) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(status).json(body);
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function isCronRequest(req) {
  const headers = req.headers || {};
  const agent = String(headers['user-agent'] || '');
  return agent.indexOf('vercel-cron') === 0 || Boolean(headers['x-vercel-cron-schedule']);
}

function isAuthorized(req, query) {
  if (isCronRequest(req)) return true;
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && query.secret === secret;
}

function dailyLimit() {
  const raw = parseInt(process.env.DRIP_DAILY_LIMIT || '', 10);
  if (Number.isNaN(raw) || raw < 0) return DEFAULT_DAILY_LIMIT;
  return Math.min(raw, 100);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// --- DRIP_PART2 ---
// Every drip state, keyed by address. The lists here are small (the weekly
// list paginates the same way), so one full scan per run is cheap.
async function loadStates(db) {
  const states = new Map();
  let lastDoc = null;
  for (let page = 0; page < 40; page++) {
    let query = db.collection('email_drip').orderBy('__name__').limit(500);
    if (lastDoc) query = query.startAfter(lastDoc);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    snapshot.docs.forEach(function (doc) {
      const data = doc.data() || {};
      states.set(normaliseEmail(data.email || doc.id), data);
    });
    if (snapshot.docs.length < 500) break;
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }
  return states;
}

// Confirmed subscribers plus their opt-in state from the emails collection.
async function loadEmailDocs(db) {
  const docs = new Map();
  let lastDoc = null;
  for (let page = 0; page < 40; page++) {
    let query = db.collection('emails').orderBy('__name__').limit(500);
    if (lastDoc) query = query.startAfter(lastDoc);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    snapshot.docs.forEach(function (doc) {
      const data = doc.data() || {};
      const email = normaliseEmail(data.email || doc.id);
      if (isEmailLike(email)) docs.set(email, data);
    });
    if (snapshot.docs.length < 500) break;
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }
  return docs;
}

// Every registered account with its creation date. Returns null when the Auth
// API is unavailable, so the run still covers newsletter subscribers.
async function loadAccounts(auth) {
  const accounts = new Map();
  if (!auth) return accounts;
  let pageToken;
  try {
    for (let page = 0; page < 20; page++) {
      const result = await auth.listUsers(1000, pageToken);
      result.users.forEach(function (user) {
        const email = normaliseEmail(user.email);
        if (!isEmailLike(email)) return;
        const created = Date.parse((user.metadata && user.metadata.creationTime) || '');
        accounts.set(email, Number.isNaN(created) ? null : created);
      });
      pageToken = result.pageToken;
      if (!pageToken) break;
    }
  } catch (error) {
    return null;
  }
  return accounts;
}

async function sendOne(apiKey, email, rendered) {
  let response;
  try {
    response = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [email],
        subject: rendered.subject,
        html: rendered.htmlFor(email),
        text: rendered.textFor(email),
        headers: {
          'List-Unsubscribe': '<' + rendered.unsubscribeUrlFor(email) + '>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      })
    });
  } catch (error) {
    return { ok: false, error: 'network: ' + (error && error.message) };
  }
  const bodyText = await response.text();
  if (response.ok) return { ok: true };
  if (response.status === 429) return { ok: false, quota: true, error: 'HTTP 429: ' + bodyText.slice(0, 200) };
  return { ok: false, error: 'HTTP ' + response.status + ': ' + bodyText.slice(0, 200) };
}

// --- DRIP_PART3 ---
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const query = req.query || {};
  const dryRun = query.dryRun === '1' || query.dryRun === 'true';
  const force = query.force === '1' || query.force === 'true';
  const authorized = isAuthorized(req, query);
  const resendKey = process.env.RESEND_API_KEY;

  if (!dryRun && !authorized) {
    return sendJson(res, 403, {
      ok: false,
      error: 'Not authorized. Vercel Cron calls this every day by itself; for a manual run add &secret=YOUR_CRON_SECRET. ?dryRun=1 needs no secret and sends nothing.'
    });
  }

  if (!adminEnabled() || !getAdmin()) {
    return sendJson(res, 503, {
      ok: false,
      error: 'FIREBASE_SERVICE_ACCOUNT is not configured in Vercel, so the drip list cannot be read.'
    });
  }

  const admin = getAdmin();
  const db = admin.db;
  const now = Date.now();
  const limit = dailyLimit();
  const started = Date.now();

  let auth = null;
  try {
    auth = admin.admin.auth();
  } catch (error) {
    auth = null;
  }

  const emailDocs = await loadEmailDocs(db);
  const accountsResult = await loadAccounts(auth);
  const accounts = accountsResult || new Map();
  const states = await loadStates(db);

  // Excluded = unsubscribed or bounced: never created, never advanced.
  const excluded = new Set();
  emailDocs.forEach(function (data, email) {
    if (data.unsubscribed === true || data.bounced === true) excluded.add(email);
  });

  // Candidates: confirmed subscribers first, then registered accounts that are
  // not excluded. A subscriber without confirmedAt has no usable start date.
  const candidates = new Map();
  emailDocs.forEach(function (data, email) {
    if (excluded.has(email) || data.subscribed !== true) return;
    const confirmed = Date.parse(data.confirmedAt || '');
    candidates.set(email, {
      startedAtMs: Number.isNaN(confirmed) ? null : confirmed,
      kind: 'subscriber'
    });
  });
  accounts.forEach(function (createdMs, email) {
    if (excluded.has(email) || candidates.has(email)) return;
    candidates.set(email, { startedAtMs: createdMs, kind: 'account' });
  });

  // Missing state: start the drip only when the address is recent enough for
  // the sequence to still make sense. Everything else is marked done once, so
  // old lists are never re-evaluated on every run.
  const createdStates = [];
  if (!dryRun) {
    for (const entry of candidates) {
      const email = entry[0];
      const cand = entry[1];
      if (states.has(email)) continue;
      let state;
      if (cand.startedAtMs === null || now - cand.startedAtMs > MAX_AGE_FOR_DRIP_MS) {
        state = {
          email: email,
          nextStep: DONE_STEP,
          skipped: cand.startedAtMs === null ? 'no_start_date' : 'started_too_long_ago',
          updatedAt: new Date().toISOString()
        };
      } else {
        state = {
          email: email,
          startedAt: new Date(cand.startedAtMs).toISOString(),
          nextStep: 0,
          source: cand.kind,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }
      await db.collection('email_drip').doc(email).set(state);
      states.set(email, state);
      createdStates.push(email);
    }
  }

  // --- DRIP_PART4 ---
  // What is due right now, oldest first.
  const due = [];
  candidates.forEach(function (cand, email) {
    const state = states.get(email);
    if (!state || typeof state.nextStep !== 'number' || state.nextStep > MAX_DRIP_STEP) return;
    const dueAt = dripDueAt(state.startedAt, state.nextStep);
    if (dueAt === null || dueAt > now) return;
    due.push({ email: email, step: state.nextStep, startedAt: state.startedAt, kind: cand.kind });
  });
  due.sort(function (a, b) { return Date.parse(a.startedAt) - Date.parse(b.startedAt); });

  if (dryRun) {
    const missing = [];
    candidates.forEach(function (cand, email) { if (!states.has(email)) missing.push(email); });
    return sendJson(res, 200, {
      ok: true,
      dryRun: true,
      due: due.length,
      dueSample: due.slice(0, 5).map(function (job) { return maskEmail(job.email) + ' (step ' + job.step + ')'; }),
      candidates: candidates.size,
      states: states.size,
      missingStates: missing.length,
      excludedUnsubscribedOrBounced: excluded.size,
      listUsersError: accountsResult === null ? 'Auth listUsers failed; newsletter subscribers still processed.' : undefined,
      delaysDays: DRIP_DELAYS_DAYS,
      dailyLimit: limit,
      resendConfigured: Boolean(resendKey),
      hint: 'Vercel Cron runs this daily at 12:30 UTC. One step per address per run.'
    });
  }

  const runRef = db.collection('drip_runs').doc(todayKey());
  const existingRun = await runRef.get();
  const run = existingRun.exists ? (existingRun.data() || {}) : {};
  if (run.status === 'done' && !force) {
    return sendJson(res, 200, {
      ok: true,
      skipped: 'already_ran_today',
      sent: Number(run.sent || 0),
      hint: 'Todays batch already went out. Add &force=1 (with your secret) to run it again.'
    });
  }

  if (!resendKey) {
    return sendJson(res, 500, {
      ok: false,
      error: 'RESEND_API_KEY is missing in Vercel. Add it under Settings > Environment Variables and redeploy, then call this again.'
    });
  }

  const jobs = due.slice(0, limit);
  const deferred = due.length - jobs.length;

  await runRef.set({
    status: 'sending',
    due: due.length,
    limit: limit,
    startedAt: new Date().toISOString()
  }, { merge: true });

  let sent = 0;
  const steps = {};
  const errors = [];
  let stopReason = null;

  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index];
    const state = states.get(job.email) || {};
    const rendered = renderDripEmail(job.step);
    if (!rendered) {
      stopReason = 'template_missing_step_' + job.step;
      break;
    }
    const result = await sendOne(resendKey, job.email, rendered);
    const updatedAt = new Date().toISOString();

    if (result.ok) {
      sent++;
      steps[job.step] = (steps[job.step] || 0) + 1;
      await db.collection('email_drip').doc(job.email).set({
        nextStep: job.step + 1,
        lastSentStep: job.step,
        lastSentAt: updatedAt,
        failCount: 0,
        updatedAt: updatedAt
      }, { merge: true });
    } else if (result.quota) {
      // The free Resend plan stops us: leave this step pending so tomorrows
      // run finishes the batch instead of bursting it now.
      stopReason = 'resend_quota';
      break;
    } else {
      const failCount = Number(state.failCount || 0) + 1;
      const giveUp = failCount >= GIVE_UP_AFTER;
      errors.push({ email: maskEmail(job.email), step: job.step, error: String(result.error || '').slice(0, 200) });
      await db.collection('email_drip').doc(job.email).set({
        failCount: giveUp ? 0 : failCount,
        nextStep: giveUp ? job.step + 1 : job.step,
        gaveUpStep: giveUp ? job.step : null,
        updatedAt: updatedAt
      }, { merge: true });
    }

    if (index < jobs.length - 1) await sleep(SLEEP_MS);
  }

  await runRef.set({
    status: stopReason ? 'partial' : 'done',
    sent: sent,
    steps: steps,
    deferred: deferred,
    failed: errors.length,
    stopped: stopReason,
    finishedAt: new Date().toISOString()
  }, { merge: true });

  return sendJson(res, stopReason === 'resend_quota' ? 503 : 200, {
    ok: stopReason !== 'resend_quota',
    mode: 'run',
    due: due.length,
    processed: jobs.length,
    sent: sent,
    failed: errors.length,
    deferred: deferred,
    steps: steps,
    newStates: createdStates.length,
    stopReason: stopReason,
    errors: errors.slice(0, 5),
    durationMs: Date.now() - started,
    hint: stopReason === 'resend_quota'
      ? 'Stopped on the Resend daily quota. Tomorrows run continues where this one stopped.'
      : (sent ? 'Sent ' + sent + ' drip email(s): ' + JSON.stringify(steps) + '.' : 'Nothing was due today.')
  });
}
