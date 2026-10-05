// Shared parts of the weekly newsletter: the unsubscribe token, how the
// recipient list is merged and the email itself. api/newsletter.js sends it on
// Mondays and api/subscribe.js serves the unsubscribe link, so both ends have
// to agree on one token format without storing a token per address.

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_SITE = 'https://www.studytools.pro';

export function siteUrl() {
  return (process.env.SITE_URL || DEFAULT_SITE).replace(/\/$/, '');
}

export function fromAddress() {
  return process.env.NEWSLETTER_FROM || 'StudyTools <newsletter@studytools.pro>';
}

// The HMAC key. NEWSLETTER_SECRET is the intended home for it; the other two
// are always present wherever the newsletter can actually run, so a link never
// stops working just because an optional variable was forgotten.
function tokenSecret() {
  return process.env.NEWSLETTER_SECRET || process.env.RESEND_API_KEY || process.env.FIREBASE_SERVICE_ACCOUNT || '';
}

export function normaliseEmail(email) {
  return String(email || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .toLowerCase();
}

export function isEmailLike(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

// <base64url(email)>.<hmac> — no per-address document, nothing to clean up,
// and a token for one address cannot be edited to point at another.
export function signUnsubscribe(email) {
  const normalised = normaliseEmail(email);
  const mac = createHmac('sha256', tokenSecret() || 'studytools-newsletter')
    .update(normalised)
    .digest('base64url')
    .slice(0, 40);
  return Buffer.from(normalised, 'utf8').toString('base64url') + '.' + mac;
}

export function verifyUnsubscribe(token) {
  const raw = String(token || '');
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  let email;
  try {
    email = Buffer.from(raw.slice(0, dot), 'base64url').toString('utf8');
  } catch (error) {
    return null;
  }
  email = normaliseEmail(email);
  if (!isEmailLike(email)) return null;
  const expected = createHmac('sha256', tokenSecret() || 'studytools-newsletter')
    .update(email)
    .digest('base64url')
    .slice(0, 40);
  const given = Buffer.from(raw.slice(dot + 1), 'utf8');
  const want = Buffer.from(expected, 'utf8');
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  return email;
}

// ISO-8601 week number and year, used as the id of one send: 2026-W41. The
// year is the year of the Thursday of that week, so 30 December can never
// collide with 1 January of the following year.
function isoWeekContext(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: week };
}

export function isoWeekNumber(date) {
  return isoWeekContext(date).week;
}

export function weekKeyOf(date) {
  const d = date instanceof Date ? date : new Date(date);
  const context = isoWeekContext(d);
  return context.year + '-W' + String(context.week).padStart(2, '0');
}

export function maskEmail(email) {
  const normalised = normaliseEmail(email);
  const at = normalised.indexOf('@');
  if (at < 1) return '***';
  return normalised.slice(0, Math.min(2, at)) + '***@' + normalised.slice(at + 1);
}

// Confirmed subscribers first, then every registered account, minus anyone who
// unsubscribed or whose address bounced. One address, one email, whatever the
// sources.
export function mergeRecipients({ subscribers = [], registered = [], excluded = [] }) {
  const skip = new Set(excluded.map(normaliseEmail).filter(Boolean));
  const merged = new Map();
  for (const pair of [[subscribers, 'subscriber'], [registered, 'account']]) {
    for (const raw of pair[0]) {
      const email = normaliseEmail(raw);
      if (!email || !isEmailLike(email) || skip.has(email)) continue;
      const existing = merged.get(email);
      if (existing) {
        if (!existing.sources.includes(pair[1])) existing.sources.push(pair[1]);
      } else {
        merged.set(email, { email: email, sources: [pair[1]] });
      }
    }
  }
  return Array.from(merged.values()).sort(function (a, b) { return a.email.localeCompare(b.email); });
}

// One method per week, rotating, so the email never repeats a tip twice in a
// row. Each tip points at the free tool that carries it out.
const TIPS = [
  {
    title: 'Revise it two days later, not the night before',
    body: 'Memory fades on a curve. Five minutes of review two days after class beats an hour the night before, because your brain has to pull the answer back instead of rereading it.',
    link: '/flashcard-maker.html',
    linkText: 'Make the flashcards while it is fresh'
  },
  {
    title: 'Close the book and write what you remember',
    body: 'Rereading feels productive and teaches almost nothing. Cover your notes, write everything you can, then open them and mark only what you missed. That gap is your revision list.',
    link: '/drill.html',
    linkText: 'Get tested on exactly that'
  },
  {
    title: 'Explain it out loud in simple words',
    body: 'If you cannot explain a concept without the textbook in front of you, you do not have it yet. Say it to an empty room, notice where you stumble, and go back only to that part.',
    link: '/study-assistant.html',
    linkText: 'Have the tutor quiz you on it'
  },
  {
    title: 'Mix two subjects in one session',
    body: 'Practising the same type of problem for an hour trains one reflex. Switching between two subjects feels slower and scores noticeably better on the test, because you have to choose the method, not just apply it.',
    link: '/study-schedule.html',
    linkText: 'Build a mixed week'
  },
  {
    title: 'Twenty-five minutes, then stand up',
    body: 'Twenty-five minutes of real concentration followed by five away beats two hours of half-attention. The break is part of the method, not a reward you have to earn.',
    link: '/pomodoro-timer.html',
    linkText: 'Start the focus timer'
  },
  {
    title: 'Keep a list of what you get wrong',
    body: 'Students who track their own mistakes revise a shorter list and pass sooner. Every error written down once stops being a surprise on exam day.',
    link: '/planner.html',
    linkText: 'Let the planner re-space it'
  }
];

export function tipOfWeek(weekNumber) {
  const index = ((weekNumber % TIPS.length) + TIPS.length) % TIPS.length;
  return TIPS[index];
}

export function renderWeeklyEmail(date) {
  const when = date instanceof Date ? date : new Date(date);
  const week = isoWeekNumber(when);
  const tip = tipOfWeek(week);
  const dateLabel = when.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const site = siteUrl();
  const subject = 'StudyTools week ' + week + ': ' + tip.title;

  function unsubscribeUrl(email) {
    return site + '/api/subscribe?u=' + encodeURIComponent(signUnsubscribe(email));
  }

  function htmlFor(email) {
    const unsub = unsubscribeUrl(email);
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + subject + '</title></head>' +
      '<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:24px 12px;">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">' +

      '<tr><td style="background:#0f172a;padding:28px 32px;">' +
      '<div style="font-size:20px;font-weight:bold;color:#ffffff;">StudyTools</div>' +
      '<div style="font-size:13px;color:#93c5fd;margin-top:6px;">Weekly study method &middot; Week ' + week + ' &middot; ' + dateLabel + '</div>' +
      '</td></tr>' +

      '<tr><td style="padding:28px 32px 8px 32px;">' +
      '<p style="margin:0 0 18px 0;font-size:16px;line-height:1.6;color:#334155;">One method that works, one tool that goes with it. Nothing else.</p>' +
      '<div style="background:#eff6ff;border-left:4px solid #2563eb;border-radius:0 10px 10px 0;padding:20px 22px;">' +
      '<div style="font-size:13px;font-weight:bold;color:#2563eb;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Tip of the week</div>' +
      '<div style="font-size:18px;font-weight:bold;color:#0f172a;margin-bottom:10px;">' + tip.title + '</div>' +
      '<p style="margin:0;font-size:15px;line-height:1.65;color:#475569;">' + tip.body + '</p>' +
      '</div>' +
      '<p style="margin:22px 0 0 0;"><a href="' + site + tip.link + '" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block;font-size:15px;">' + tip.linkText + '</a></p>' +
      '</td></tr>' +
      buildTail(sectionNewIn(site), sectionPro(site), site, unsub);
  }

  function textFor(email) {
    return 'StudyTools weekly study method - week ' + week + ' - ' + dateLabel + '\n\n' +
      'TIP OF THE WEEK\n' +
      tip.title + '\n\n' +
      tip.body + '\n\n' +
      'Try it: ' + site + tip.link + '\n\n' +
      'NEW IN STUDIETOOLS\n' +
      '- The Study Coach builds drills from the topics you keep getting wrong: ' + site + '/drill.html\n' +
      '- The revision planner reschedules itself around your weak topics: ' + site + '/planner.html\n\n' +
      'Pro lifts the caps on the tutor, the drills and the planner for EUR 3.99 a month: ' + site + '/pro.html\n\n' +
      'You are receiving this because you created a StudyTools account or asked for the weekly study email.\n' +
      'Unsubscribe (one click): ' + unsubscribeUrl(email) + '\n';
  }

  return {
    subject: subject,
    week: week,
    dateLabel: dateLabel,
    tip: tip,
    htmlFor: htmlFor,
    textFor: textFor,
    unsubscribeUrlFor: unsubscribeUrl
  };
}

// The two cards that sell what a free tool cannot do: memory of the student's
// own mistakes, and a plan that rebuilds itself around them.
function sectionNewIn(site) {
  return '<tr><td style="padding:26px 32px 6px 32px;">' +
    '<div style="font-size:13px;font-weight:bold;color:#2563eb;text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px;">New in StudyTools</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td width="48%" valign="top" style="padding-right:8px;"><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">' +
    '<div style="font-weight:bold;font-size:15px;color:#0f172a;margin-bottom:6px;">The Study Coach remembers</div>' +
    '<p style="margin:0;font-size:14px;line-height:1.55;color:#64748b;">Tell it your subject and it builds drills from the topics <em>you</em> keep getting wrong, not from a generic syllabus.</p>' +
    '<p style="margin:12px 0 0 0;font-size:14px;"><a href="' + site + '/drill.html" style="color:#2563eb;font-weight:bold;text-decoration:none;">Open a drill &rarr;</a></p>' +
    '</div></td>' +
    '<td width="48%" valign="top" style="padding-left:8px;"><div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">' +
    '<div style="font-weight:bold;font-size:15px;color:#0f172a;margin-bottom:6px;">The planner reschedules itself</div>' +
    '<p style="margin:0;font-size:14px;line-height:1.55;color:#64748b;">Give it your exam dates and it spaces each subject across the days you actually have, moving what you failed to later.</p>' +
    '<p style="margin:12px 0 0 0;font-size:14px;"><a href="' + site + '/planner.html" style="color:#2563eb;font-weight:bold;text-decoration:none;">Build your plan &rarr;</a></p>' +
    '</div></td>' +
    '</tr></table>' +
    '</td></tr>';
}

function sectionPro(site) {
  return '<tr><td style="padding:24px 32px 6px 32px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:14px;"><tr><td style="padding:24px 28px;">' +
    '<div style="font-size:17px;font-weight:bold;color:#ffffff;margin-bottom:8px;">Deadlines do not wait for the daily limit</div>' +
    '<p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#cbd5e1;">Pro lifts the caps on the tutor, the drills and the planner. &euro;3.99 a month, or &euro;29.99 a year, cancel any time.</p>' +
    '<a href="' + site + '/pro.html" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:bold;display:inline-block;font-size:15px;">See StudyTools Pro</a>' +
    '</td></tr></table>' +
    '</td></tr>';
}

// Closing rows: the Pro strip, then who sent this and the unsubscribe link,
// which every marketing email has to carry.
function buildTail(newIn, pro, site, unsub) {
  return newIn +
    pro +
    '<tr><td style="padding:24px 32px 30px 32px;">' +
    '<p style="margin:0 0 10px 0;font-size:13px;line-height:1.6;color:#94a3b8;">You are receiving this because you created a StudyTools account or asked for the weekly study email. StudyTools, <a href="' + site + '/" style="color:#64748b;">www.studytools.pro</a></p>' +
    '<p style="margin:0;font-size:13px;color:#94a3b8;"><a href="' + unsub + '" style="color:#64748b;text-decoration:underline;">Unsubscribe from the weekly email</a> &middot; one click, no questions.</p>' +
    '</td></tr>' +
    '</table>' +
    '</td></tr></table>' +
    '</body></html>';
}
