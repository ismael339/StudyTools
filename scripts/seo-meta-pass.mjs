// SEO metadata pass for every public page (Phase 2 of the image/SEO work).
//
//   node scripts/seo-meta-pass.mjs           (apply, idempotent)
//   node scripts/seo-meta-pass.mjs --dry     (report only, write nothing)
//
// What it does, safely and repeatably, to each indexable page that owns a
// generated image in /images:
//   • point og:image at the page's OWN image (/images/<slug>-og.png) instead
//     of the two shared generic PNGs, and add og:image:width/height/alt so
//     Google and social crawlers render a full-size card;
//   • ensure twitter:image matches (summary_large_image);
//   • stamp article:published_time on BlogPosting pages (from existing JSON-LD
//     datePublished, else a curated fallback), which Google uses for Discover;
//   • rewrite the ImageObject schema to the new PNG and strip the keyword
//     stuffing ("StudyTools, StudyHelper, StudeTools") that reads as spam;
//   • leave canonical, og:title, og:type and every other tag untouched.
// HowTo schema is NOT touched here — see scripts/seo-howto-pass.mjs.

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ORIGIN = 'https://www.studytools.pro';
const DRY = process.argv.includes('--dry');

// Private pages that must never be touched.
const SKIP = new Set(['404.html', 'login.html', 'register.html', 'profile.html', 'pro-success.html']);

// Pages that are genuinely tools (og:type website), not articles.
const TOOL_PAGES = new Set([
  'gpa-calculator', 'grade-calculator', 'pomodoro-timer', 'flashcard-maker',
  'citation-generator', 'study-assistant', 'exam-solver', 'study-schedule',
  'drill', 'planner', 'app',
]);

// Published dates for BlogPosting pages whose JSON-LD has none, taken from the
// earliest git commit date of each file so Discover gets a real timestamp.
const PUBLISHED_FALLBACK = {
  'best-study-routine-for-high-school-students': '2026-06-14',
  'best-time-to-study-for-students': '2026-06-14',
  'how-ai-improves-learning': '2026-06-01',
  'how-to-make-a-study-plan-for-finals': '2026-06-07',
  'how-to-reduce-exam-stress': '2026-06-23',
  'how-to-summarize-a-chapter': '2026-06-07',
  'how-to-use-ai-to-summarize-notes': '2026-06-07',
  'study-mistakes-students-make': '2026-06-14',
  'blog': '2026-05-01',
  'index': '2026-05-01',
  'about': '2026-05-01',
  'pro': '2026-05-10',
  'play': '2026-06-01',
  'contact': '2026-05-01',
  'privacy': '2026-05-01',
  'terms': '2026-05-01',
};

// Pull the <meta ...> tag for a property/name, or null.
function findMeta(html, attr, key) {
  const re = new RegExp('<meta[^>]*' + attr + '="' + key + '"[^>]*>', 'i');
  const m = html.match(re);
  return m ? m[0] : null;
}

function getAttr(tag, name) {
  const m = tag.match(new RegExp(name + '="([^"]*)"', 'i'));
  return m ? m[1] : null;
}

// Build the block of image meta tags for a page, matching the site's style.
function imageMetaBlock(slug, altText) {
  const url = ORIGIN + '/images/' + slug + '-og.png';
  return [
    '<meta property="og:image" content="' + url + '" />',
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:alt" content="' + altText + '" />',
    '<meta name="twitter:image" content="' + url + '" />',
    '<meta name="twitter:image:alt" content="' + altText + '" />',
  ].join('\n  ');
}

// Strip every image meta tag (og:image*, twitter:image*) so the function is
// genuinely idempotent: re-running — or cleaning up a previous partial run —
// always ends with exactly one clean block.
function stripImageMeta(html) {
  return html
    .replace(/\s*<meta[^>]*property="og:image(?::[^"]*)?"[^>]*>/gi, '')
    .replace(/\s*<meta[^>]*name="twitter:image(?::[^"]*)?"[^>]*>/gi, '');
}

// Replace the shared-generic og:image (and twitter:image) with the page's own,
// adding width/height/alt. Idempotent: always yields one clean block.
function upsertOgImage(html, slug, altText) {
  html = stripImageMeta(html);
  html = html.replace(/<\/head>/i, '  ' + imageMetaBlock(slug, altText) + '\n</head>');
  // Guarantee exactly one twitter:card = summary_large_image.
  html = html.replace(/\s*<meta[^>]*name="twitter:card"[^>]*>/gi, '');
  html = html.replace(/<\/head>/i, '  <meta name="twitter:card" content="summary_large_image" />\n</head>');
  return html;
}

// Keyword-rich, human alt text for the money pages; derived from <title> for
// the rest. Alt text is one of the strongest signals for Google Images.
const ALT = {
  'gpa-calculator': 'Free GPA calculator showing a 3.72 cumulative GPA from AP Calculus, English, Biology and History grades',
  'grade-calculator': 'Free grade calculator showing a student needs 87.4% on the final exam to finish with a 90%',
  'pomodoro-timer': 'Pomodoro timer running an 18:42 focus session with a 5 minute break queued and a 6 day streak',
  'flashcard-maker': 'Flashcard maker with biology flashcards: photosynthesis, mitochondria and DNA vs RNA questions',
  'citation-generator': 'Citation generator formatting an APA 7 website citation plus MLA, Chicago and YouTube sources',
  'study-assistant': 'AI tutor chat with 12 free requests left today, explaining a step and quizzing chapter 4',
  'exam-solver': 'Exam solver showing a worked step-by-step solution rather than only the final answer',
  'study-schedule': 'Weekly study schedule with 12 and a half hours planned across calculus, biology, essay and past papers',
  'drill': 'Study coach drill showing 92% accuracy and a weak topic in quadratics being targeted',
  'planner': 'Adaptive revision planner that reorders topics by weakness and tracks what is finished',
  'app': 'AI notes summarizer turning pasted notes into a summary, outline and flashcards',
  'spaced-repetition-for-students': 'Forgetting curve infographic comparing memory without review to memory with spaced repetition reviews',
  'pomodoro-technique-for-students': 'Pomodoro technique diagram: 25 minutes focus, 5 minute break, then a 15 minute long break after four cycles',
  'active-recall-study-method': 'Active recall versus re-reading comparison chart showing why testing yourself beats rereading notes',
  'what-grade-do-i-need-on-my-final': 'Grade needed on final exam formula with examples showing 96% for an A and 60% to pass with a C',
};

function altFor(slug, html) {
  if (ALT[slug]) return ALT[slug];
  const t = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || slug;
  return t.replace(/\s*\|?\s*StudyTools\s*$/i, '').replace(/\s*[-–—]\s*StudyTools.*$/i, '').trim();
}

// Point the ImageObject schema at the new PNG and drop keyword stuffing.
// Only /assets/*.svg|png URLs inside JSON-LD are rewritten, so other schema
// (WebApplication, FAQPage, Organization logo) is untouched.
function fixImageObject(html, slug) {
  const pngUrl = ORIGIN + '/images/' + slug + '-og.png';
  return html
    .replace(/"(?:contentUrl|url)":\s*"[^"]*\/assets\/[^"]*\.(?:svg|png)"/g, (m) =>
      m.replace(/"[^"]*\/assets\/[^"]*\.(?:svg|png)"/, '"' + pngUrl + '"'))
    // Strip the "StudyTools, StudyHelper, StudeTools" keyword stuffing.
    .replace(/\s*-\s*StudyTools,\s*StudyHelper,\s*StudeTools/g, '');
}

// Ensure article:published_time on BlogPosting pages.
function stampPublished(html, slug) {
  if (/<meta[^>]*property="article:published_time"/i.test(html)) return html;
  const ldDates = [...html.matchAll(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]);
  const date = ldDates[0] || PUBLISHED_FALLBACK[slug];
  if (!date) return html;
  const tag = '<meta property="article:published_time" content="' + date + '" />';
  // Place it right after og:type (article) if present, else before </head>.
  const ogType = findMeta(html, 'property', 'og:type');
  if (ogType && /content="article"/i.test(ogType)) return html.replace(ogType, ogType + '\n  ' + tag);
  return html.replace(/<\/head>/i, '  ' + tag + '\n</head>');
}

// ------------------------------------------------------------------- main
function main() {
  const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html') && !SKIP.has(f));
  let changed = 0;
  for (const file of pages) {
    const slug = file.replace(/\.html$/, '');
    const imgPath = join(ROOT, 'images', slug + '-og.png');
    if (!existsSync(imgPath)) continue; // no bespoke art → leave page untouched
    const before = readFileSync(join(ROOT, file), 'utf8');
    let html = before;
    const alt = altFor(slug, html);
    html = upsertOgImage(html, slug, alt);
    html = fixImageObject(html, slug);
    if (!TOOL_PAGES.has(slug)) html = stampPublished(html, slug);
    if (html !== before) {
      changed++;
      if (!DRY) writeFileSync(join(ROOT, file), html);
      console.log((DRY ? 'would edit ' : 'updated  ') + file);
    }
  }
  console.log('\n' + (DRY ? '[dry run] ' : '') + changed + ' of ' + pages.length + ' pages processed.');
}

main();
